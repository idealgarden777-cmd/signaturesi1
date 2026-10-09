/*
=========================================================
NEYO — DEEP RESEARCH ENGINE v2 (free meta-search)
Own search + scraping pipeline. No paid search API.
Engines (all free, in parallel): Brave, Bing, DuckDuckGo, Yahoo,
Mojeek, Bing News, Google News headlines, Wikipedia, Hacker News
(tech), Reddit (opinions). Links several engines agree on rank
higher. Blocked engines rest automatically. 10-minute cache.
Google grounding (paid) is OFF unless NEYO_GOOGLE_GROUNDING is
set to "fallback" or "always".

1. Plan     : model turns the question into 4-6 web queries
2. Search   : scrapes Brave + Bing RSS in parallel, falls back to
              DuckDuckGo / Bing HTML, (+ Wikipedia API), filters
              junk by query match, merges and ranks results
3. Read     : fetches the best pages in parallel and extracts
              the readable article text (SSRF-safe)
4. Follow-up: one extra round of queries for gaps (time budget)
5. Context  : numbered sources [1]..[n] handed to the writer

Every step reports progress via onStatus(stage, info) so the
chat thinking indicator can show what is happening.
=========================================================
*/

import { lookup } from "node:dns/promises";
import net from "node:net";
import { trustBonus, trustLabel, isPakistanQuery, pakistanSiteQuery, topicSiteQuery } from "./trusted-sources.js";

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const DEFAULTS = Object.freeze({
    maxQueries: 5,
    resultsPerQuery: 10,
    maxPages: 12,
    pageChars: 5500,
    totalContextChars: 60000,
    searchTimeoutMs: 7000,
    pageTimeoutMs: 8000,
    maxPageBytes: 1_500_000,
    budgetMs: 45000,
    minCandidates: 8,
    readerFallbacks: 3,
    snippetSources: 10,
    followUpMinRemainingMs: 20000,
    verify: true,
    verifyChars: 24000,
    verifyTimeoutMs: 12000
});

const SKIP_HOSTS = [
    "bing.com",
    "duckduckgo.com",
    "google.com",
    "facebook.com",
    "instagram.com",
    "tiktok.com",
    "pinterest.com",
    "linkedin.com",
    "x.com",
    "twitter.com",
    "youtube.com",
    "accounts.",
    "login."
];

/* ---------------------------------------------------------
   SMALL HELPERS
   --------------------------------------------------------- */

function decodeEntities(text = "") {
    return String(text)
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => safeChar(Number(dec)));
}

function safeChar(code) {
    try {
        return Number.isFinite(code) && code > 0 && code < 0x10ffff
            ? String.fromCodePoint(code)
            : " ";
    } catch {
        return " ";
    }
}

function stripTags(html = "") {
    return decodeEntities(String(html).replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeUrl(raw) {
    try {
        const url = new URL(raw);
        if (!/^https?:$/.test(url.protocol)) {
            return "";
        }
        url.hash = "";
        [...url.searchParams.keys()].forEach(key => {
            if (/^(utm_|fbclid|gclid|mc_|ref$|ref_src)/i.test(key)) {
                url.searchParams.delete(key);
            }
        });
        return url.toString();
    } catch {
        return "";
    }
}

function hostOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return "";
    }
}

function isSkippable(url) {
    const host = hostOf(url);
    if (!host) {
        return true;
    }
    if (/\.(pdf|zip|exe|dmg|mp4|mp3|jpg|jpeg|png|gif|webp)(\?|$)/i.test(url)) {
        return true;
    }
    return SKIP_HOSTS.some(item =>
        item.endsWith(".")
            ? host.startsWith(item)
            : host === item || host.endsWith(`.${item}`)
    );
}

async function timedFetch(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                "User-Agent": UA,
                "Accept-Language": "en-US,en;q=0.9",
                ...(options.headers || {})
            }
        });
    } finally {
        clearTimeout(timer);
    }
}

/* ---------------------------------------------------------
   SSRF GUARD
   --------------------------------------------------------- */

function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split(".").map(Number);
        return (
            a === 10 ||
            a === 127 ||
            a === 0 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127) ||
            a >= 224
        );
    }
    const v6 = ip.toLowerCase();
    return (
        v6 === "::1" ||
        v6 === "::" ||
        v6.startsWith("fc") ||
        v6.startsWith("fd") ||
        v6.startsWith("fe80") ||
        v6.startsWith("::ffff:127.") ||
        v6.startsWith("::ffff:10.") ||
        v6.startsWith("::ffff:192.168.")
    );
}

async function isPublicUrl(url) {
    try {
        const { hostname, protocol } = new URL(url);
        if (!/^https?:$/.test(protocol)) {
            return false;
        }
        if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
            return false;
        }
        if (net.isIP(hostname)) {
            return !isPrivateIp(hostname);
        }
        const addresses = await lookup(hostname, { all: true });
        return addresses.length > 0 && addresses.every(item => !isPrivateIp(item.address));
    } catch {
        return false;
    }
}

/* ---------------------------------------------------------
   SEARCH SCRAPERS
   --------------------------------------------------------- */

async function searchBingRss(query, opts) {
    const url =
        `https://www.bing.com/search?format=rss&setlang=en&count=${opts.resultsPerQuery}` +
        `&q=${encodeURIComponent(query)}`;
    const response = await timedFetch(url, {}, opts.searchTimeoutMs);
    if (!response.ok) {
        return [];
    }
    const xml = await response.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    return items.map(item => ({
        title: stripTags((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""),
        url: decodeEntities((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "").trim(),
        snippet: stripTags((item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "")
    }));
}

function decodeDdgLink(href = "") {
    const raw = decodeEntities(href);
    try {
        const url = new URL(raw, "https://duckduckgo.com");
        const target = url.searchParams.get("uddg");
        return target ? decodeURIComponent(target) : url.toString();
    } catch {
        return "";
    }
}

async function searchDuckDuckGo(query, opts) {
    const response = await timedFetch(
        "https://html.duckduckgo.com/html/",
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `q=${encodeURIComponent(query)}&kl=wt-wt`
        },
        opts.searchTimeoutMs
    );
    if (!response.ok) {
        return [];
    }
    const html = await response.text();
    const results = [];
    const blocks = html.split(/class="result results_links/).slice(1);
    for (const block of blocks) {
        const link = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!link) {
            continue;
        }
        const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
        results.push({
            title: stripTags(link[2]),
            url: decodeDdgLink(link[1]),
            snippet: stripTags(snippet?.[1] || "")
        });
    }
    return results;
}

function decodeBingCk(href = "") {
    const raw = decodeEntities(href);
    try {
        const url = new URL(raw);
        const encoded = url.searchParams.get("u");
        if (url.hostname.endsWith("bing.com") && encoded && encoded.startsWith("a1")) {
            const b64 = encoded.slice(2).replace(/-/g, "+").replace(/_/g, "/");
            return Buffer.from(b64, "base64").toString("utf8");
        }
        return raw;
    } catch {
        return "";
    }
}

async function searchBingHtml(query, opts) {
    const response = await timedFetch(
        `https://www.bing.com/search?setlang=en&q=${encodeURIComponent(query)}`,
        {},
        opts.searchTimeoutMs
    );
    if (!response.ok) {
        return [];
    }
    const html = await response.text();
    const results = [];
    const blocks = html.split(/<li class="b_algo"/).slice(1);
    for (const block of blocks) {
        const link = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!link) {
            continue;
        }
        const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
        results.push({
            title: stripTags(link[2]),
            url: decodeBingCk(link[1]),
            snippet: stripTags(snippet?.[1] || "")
        });
    }
    return results;
}

let braveBlockedUntil = 0;
let braveNextSlot = 0;

async function searchBrave(query, opts) {
    const now = Date.now();
    if (now < braveBlockedUntil) {
        return [];
    }
    // Space Brave requests out a little to avoid 429s.
    const wait = Math.max(0, braveNextSlot - now);
    braveNextSlot = Math.max(now, braveNextSlot) + 1200;
    if (wait > 0) {
        await new Promise(resolve => setTimeout(resolve, wait));
    }
    const response = await timedFetch(
        `https://search.brave.com/search?source=web&q=${encodeURIComponent(query)}`,
        { headers: { Accept: "text/html" } },
        opts.searchTimeoutMs
    );
    if (response.status === 429) {
        braveBlockedUntil = Date.now() + 60000;
        return [];
    }
    if (!response.ok) {
        return [];
    }
    const html = await response.text();
    const results = [];
    const blocks = html.split(/class="snippet[^"]*"[^>]*data-type="web"/).slice(1);
    for (const block of blocks) {
        const link = block.match(/<a href="(https?:\/\/[^"]+)"/);
        const title = block.match(/class="title[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        if (!link || !title) {
            continue;
        }
        const snippet = block.match(/class="content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        results.push({
            title: stripTags(title[1]),
            url: decodeEntities(link[1]),
            snippet: stripTags(snippet?.[1] || "")
        });
    }
    return results;
}

/*
 * Last-resort engine: Gemini's built-in Google Search grounding.
 * Returns the grounded source links; the pages are then read by
 * our own scraper like any other result.
 */
async function searchGeminiGrounding(query, opts) {
    if (!opts.apiKey || !opts.groundingModel) {
        return [];
    }
    const response = await timedFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.groundingModel)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: `Today is ${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date())}. Use Google Search for: ${query}\nReply with ${opts.groundBullets || "3-6"} short factual bullet points: exact names, numbers, dates (with "as of" date) from the newest results, each with the site it came from. No opinions.` }] }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0, maxOutputTokens: opts.groundTokens || 500 }
            })
        },
        opts.groundTimeoutMs || 12000
    );
    if (!response.ok) {
        return [];
    }
    const data = await response.json();
    const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const links = chunks
        .map(chunk => chunk?.web)
        .filter(web => web?.uri)
        .map(web => ({
            title: web.title || "",
            url: web.uri,
            snippet: web.title || "",
            grounded: true
        }));
    const answer = (data?.candidates?.[0]?.content?.parts || [])
        .filter(part => !part.thought)
        .map(part => part.text || "")
        .join("")
        .trim()
        .slice(0, 1500);
    links.answer = answer ? `Q: ${query}\n${answer}` : "";
    return links;
}

function decodeBingNewsLink(href = "") {
    const raw = decodeEntities(href).trim();
    try {
        const url = new URL(raw);
        const target = url.searchParams.get("url");
        return target || raw;
    } catch {
        return "";
    }
}

async function searchBingNews(query, opts) {
    const response = await timedFetch(
        `https://www.bing.com/news/search?format=rss&setlang=en&q=${encodeURIComponent(query)}`,
        {},
        opts.searchTimeoutMs
    );
    if (!response.ok) {
        return [];
    }
    const xml = await response.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    return items.map(item => {
        const date = stripTags((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "");
        return {
            title: stripTags((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""),
            url: decodeBingNewsLink((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || ""),
            snippet:
                (date ? `(${date}) ` : "") +
                stripTags((item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || ""),
            published: date
        };
    });
}

async function searchWikipedia(query, opts) {
    const url =
        "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=2" +
        `&srsearch=${encodeURIComponent(query)}`;
    const response = await timedFetch(url, {}, opts.searchTimeoutMs);
    if (!response.ok) {
        return [];
    }
    const data = await response.json();
    return (data?.query?.search || []).map(item => ({
        title: `${item.title} - Wikipedia`,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
        snippet: stripTags(item.snippet || "")
    }));
}

const STOP_WORDS = new Set(
    "a an and are as at be best by for from how in is it of on or the to vs what when where which who why with latest new top 2024 2025 2026 2027 analysis guide review".split(" ")
);

function queryTerms(query) {
    return [...new Set(
        String(query)
            .replace(/\(?-?site:[^\s)]+\)?/gi, " ")
            .replace(/\bOR\b/g, " ")
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .filter(term => term.length > 1 && !STOP_WORDS.has(term))
    )];
}

// Search engines sometimes return junk for scrapers (e.g. only
// matching the first word). Keep results that match the query.
function isRelevant(item, terms) {
    if (!terms.length) {
        return true;
    }
    const haystack = `${item.title} ${item.snippet} ${item.url}`.toLowerCase();
    const hits = terms.filter(term => haystack.includes(term)).length;
    return hits / terms.length >= (terms.length <= 2 ? 0.5 : 0.4);
}

function cleanResults(list, terms) {
    return (list || [])
        .map(item => ({ ...item, url: item.grounded ? item.url : normalizeUrl(item.url) }))
        .filter(item =>
            item.url &&
            (item.grounded || (!isSkippable(item.url) && isRelevant(item, terms)))
        );
}

/* ---------------------------------------------------------
   MORE FREE ENGINES (meta-search, no paid API)
   --------------------------------------------------------- */

function decodeYahooLink(href = "") {
    const raw = decodeEntities(href);
    const match = raw.match(/\/RU=([^/]+)\/R[KS]=/);
    if (match) {
        try {
            return decodeURIComponent(match[1]);
        } catch {
            return "";
        }
    }
    return raw;
}

async function searchYahoo(query, opts) {
    const response = await timedFetch(
        `https://search.yahoo.com/search?p=${encodeURIComponent(query)}&ei=UTF-8`,
        {},
        opts.searchTimeoutMs
    );
    if (!response.ok) {
        throw engineError(response.status);
    }
    const html = await response.text();
    const results = [];
    const blocks = html.split(/class="[^"]*\balgo\b[^"]*"/).slice(1);
    for (const block of blocks) {
        const link = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!link) {
            continue;
        }
        const title = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
        const snippet = block.match(/class="[^"]*compText[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        const url = decodeYahooLink(link[1]);
        if (/^https?:/.test(url) && !/yahoo\.com\//.test(url)) {
            results.push({
                title: stripTags(title?.[1] || link[2]).trim(),
                url,
                snippet: stripTags(snippet?.[1] || "")
            });
        }
    }
    return results;
}

async function searchMojeek(query, opts) {
    const response = await timedFetch(
        `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`,
        {},
        opts.searchTimeoutMs
    );
    if (!response.ok) {
        throw engineError(response.status);
    }
    const html = await response.text();
    const results = [];
    const blocks = html.split(/<li[^>]*>\s*<a class="ob"/).slice(1);
    for (const block of blocks) {
        const link = block.match(/<a class="title" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!link) {
            continue;
        }
        const snippet = block.match(/<p class="s">([\s\S]*?)<\/p>/);
        results.push({
            title: stripTags(link[2]),
            url: decodeEntities(link[1]),
            snippet: stripTags(snippet?.[1] || "")
        });
    }
    return results;
}

// Tech / AI / startup questions: Hacker News (free Algolia API).
async function searchHackerNews(query, opts) {
    const response = await timedFetch(
        `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=6&query=${encodeURIComponent(query)}`,
        {},
        opts.searchTimeoutMs
    );
    if (!response.ok) {
        throw engineError(response.status);
    }
    const data = await response.json();
    return (data?.hits || [])
        .filter(hit => hit?.url && (hit.points || 0) >= 20)
        .map(hit => ({
            title: hit.title || "",
            url: hit.url,
            snippet: `(Hacker News, ${hit.points} points) ${hit.title || ""}`,
            published: hit.created_at || ""
        }));
}

// Real people's opinions/experience: Reddit (often blocked from cloud IPs).
async function searchReddit(query, opts) {
    const response = await timedFetch(
        `https://www.reddit.com/search.json?sort=relevance&t=year&limit=6&q=${encodeURIComponent(query)}`,
        { headers: { Accept: "application/json" } },
        opts.searchTimeoutMs
    );
    if (!response.ok) {
        throw engineError(response.status);
    }
    const data = await response.json();
    return (data?.data?.children || [])
        .map(child => child?.data)
        .filter(post => post?.permalink && (post.score || 0) >= 5)
        .map(post => ({
            title: `${post.title} (r/${post.subreddit})`,
            url: `https://www.reddit.com${post.permalink}`,
            snippet: String(post.selftext || post.title || "").slice(0, 300),
            published: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : ""
        }));
}

// Google News RSS: free, fresh headlines with dates and outlet names.
// Links are Google redirects, so these are used as dated headline
// evidence (not pages to read).
async function searchGoogleNewsHeadlines(query, opts) {
    const response = await timedFetch(
        `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
        {},
        opts.searchTimeoutMs
    );
    if (!response.ok) {
        throw engineError(response.status);
    }
    const xml = await response.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    return items.slice(0, 8).map(item => ({
        title: stripTags((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""),
        outlet: stripTags((item.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || ""),
        published: stripTags((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "")
    })).filter(item => item.title);
}

/* ---------------------------------------------------------
   ENGINE HEALTH + CACHE
   Each engine that gets blocked (403/429/503) rests for a while
   so we don't waste time on it. Results are cached per query so
   repeat questions are instant and free.
   --------------------------------------------------------- */

function engineError(status) {
    const error = new Error(`HTTP ${status}`);
    error.status = status;
    return error;
}

const engineRestUntil = new Map();
const engineStats = new Map();

async function runEngine(name, fn, query, opts) {
    if ((engineRestUntil.get(name) || 0) > Date.now()) {
        return [];
    }
    const cacheKey = `${name}|${query.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
        return cached;
    }
    if (!engineStats.has(name)) {
        engineStats.set(name, { ok: 0, fail: 0 });
    }
    const stat = engineStats.get(name);
    try {
        const list = (await fn(query, opts)) || [];
        stat.ok += 1;
        cacheSet(cacheKey, list, 10 * 60 * 1000);
        return list;
    } catch (error) {
        stat.fail += 1;
        const status = error?.status || 0;
        const rest = status === 429 || status === 403 || status === 503 ? 10 * 60 * 1000 : 60 * 1000;
        engineRestUntil.set(name, Date.now() + rest);
        return [];
    }
}

const cacheStore = new Map();

function cacheGet(key) {
    const hit = cacheStore.get(key);
    if (!hit) {
        return null;
    }
    if (hit.expires < Date.now()) {
        cacheStore.delete(key);
        return null;
    }
    return hit.value;
}

function cacheSet(key, value, ttlMs) {
    if (cacheStore.size > 400) {
        cacheStore.delete(cacheStore.keys().next().value);
    }
    cacheStore.set(key, { value, expires: Date.now() + ttlMs });
}

// Google Search grounding (Gemini 2.5 Flash-Lite): free up to 500
// grounded prompts a day on the free tier (1,500 on paid). Used as a
// BACKUP only when the free scrapers come back weak, and capped per
// day (NEYO_GROUNDING_DAILY_CAP, default 400) so it stays free.
// NEYO_GOOGLE_GROUNDING = "off" (default: free search only) | "fallback" | "always"
function groundingMode() {
    const mode = String(process.env.NEYO_GOOGLE_GROUNDING || "off").toLowerCase();
    return ["always", "fallback", "off"].includes(mode) ? mode : "off";
}

function groundingDailyCap() {
    const cap = Number(process.env.NEYO_GROUNDING_DAILY_CAP);
    return Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : 400;
}

const groundingDay = { day: "", used: 0 };

// One shared counter for all servers (Supabase neyo_rate_hit), with a
// per-server memory counter when the shared one is not available.
export async function takeGroundingSlot() {
    const cap = groundingDailyCap();
    if (!cap) {
        return false;
    }
    const day = new Date().toISOString().slice(0, 10);
    try {
        const { takeSharedRateLimit } = await import("./guard.js");
        const shared = await takeSharedRateLimit(`grounding:${day}`, cap, 864e5, 1200);
        if (shared) {
            return shared.ok;
        }
    } catch {
        /* memory counter below */
    }
    if (groundingDay.day !== day) {
        groundingDay.day = day;
        groundingDay.used = 0;
    }
    if (groundingDay.used >= cap) {
        return false;
    }
    groundingDay.used += 1;
    return true;
}

/* Optional search APIs. Each has a free plan; add the key in Vercel
   and it joins the free scrapers automatically (more and steadier
   results, because scrapers get blocked on cloud servers).
   TAVILY_API_KEY | BRAVE_SEARCH_API_KEY | SERPER_API_KEY */
function envKey(name) {
    return String(process.env[name] || "").trim();
}

async function searchTavily(query, opts) {
    const response = await timedFetch(
        "https://api.tavily.com/search",
        {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${envKey("TAVILY_API_KEY")}` },
            body: JSON.stringify({ query, max_results: 8, search_depth: "basic", topic: opts.news ? "news" : "general" })
        },
        opts.searchTimeoutMs + 2000
    );
    if (!response.ok) {
        throw engineError(response.status);
    }
    const data = await response.json();
    return (data?.results || []).map(item => ({
        title: item.title || "",
        url: item.url || "",
        snippet: String(item.content || "").slice(0, 400),
        published: item.published_date || ""
    }));
}

async function searchBraveApi(query, opts) {
    const response = await timedFetch(
        `https://api.search.brave.com/res/v1/web/search?count=10&q=${encodeURIComponent(query)}`,
        { headers: { Accept: "application/json", "X-Subscription-Token": envKey("BRAVE_SEARCH_API_KEY") } },
        opts.searchTimeoutMs + 2000
    );
    if (!response.ok) {
        throw engineError(response.status);
    }
    const data = await response.json();
    return (data?.web?.results || []).map(item => ({
        title: stripTags(item.title || ""),
        url: item.url || "",
        snippet: stripTags(item.description || ""),
        published: item.page_age || ""
    }));
}

async function searchSerper(query, opts) {
    const response = await timedFetch(
        "https://google.serper.dev/search",
        {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-KEY": envKey("SERPER_API_KEY") },
            body: JSON.stringify({ q: query, num: 10 })
        },
        opts.searchTimeoutMs + 2000
    );
    if (!response.ok) {
        throw engineError(response.status);
    }
    const data = await response.json();
    return (data?.organic || []).map(item => ({
        title: item.title || "",
        url: item.link || "",
        snippet: item.snippet || "",
        published: item.date || ""
    }));
}

export function keyedEngines() {
    return [
        ["tavily", searchTavily, "TAVILY_API_KEY"],
        ["braveapi", searchBraveApi, "BRAVE_SEARCH_API_KEY"],
        ["serper", searchSerper, "SERPER_API_KEY"]
    ].filter(([, , key]) => envKey(key)).map(([name, fn]) => [name, fn]);
}

const WEB_ENGINES = [
    ["brave", searchBrave],
    ["bing", async (query, opts) => {
        const list = await searchBingRss(query, opts);
        return list.length ? list : searchBingHtml(query, opts);
    }],
    ["duckduckgo", searchDuckDuckGo],
    ["yahoo", searchYahoo],
    ["mojeek", searchMojeek]
];

const TECH_PATTERN = /\b(ai|gpt|llm|openai|gemini|claude|grok|model|app|software|startup|code|coding|programming|api|javascript|python|iphone|android|laptop|chip|nvidia|apple|google|microsoft|tesla|crypto|bitcoin)\b/i;
const OPINION_PATTERN = /\b(review|reviews|worth|experience|opinion|vs|better|best|recommend|kaisa|kaisi|acha|achi)\b/i;

async function searchWeb(query, opts) {
    const terms = queryTerms(query);

    // Every free engine in parallel. A link that several engines agree
    // on ranks higher (consensus ranking, like a meta-search engine).
    const engines = [...keyedEngines(), ...WEB_ENGINES];
    if (TECH_PATTERN.test(query)) {
        engines.push(["hackernews", searchHackerNews]);
    }
    if (OPINION_PATTERN.test(query)) {
        engines.push(["reddit", searchReddit]);
    }
    const lists = await Promise.all(
        engines.map(([name, fn]) => runEngine(name, fn, query, opts))
    );
    const byUrl = new Map();
    lists.forEach(list => {
        cleanResults(list, terms).forEach((item, rank) => {
            const entry = byUrl.get(item.url) || { ...item, engines: 0, rankScore: 0 };
            entry.engines += 1;
            entry.rankScore += 1 / (rank + 1);
            if (!entry.snippet && item.snippet) {
                entry.snippet = item.snippet;
            }
            if (!entry.published && item.published) {
                entry.published = item.published;
            }
            byUrl.set(item.url, entry);
        });
    });
    const scoreOf = item => item.engines * 1.2 + item.rankScore + trustBonus(item.url) * 2;
    const results = [...byUrl.values()].sort((a, b) => scoreOf(b) - scoreOf(a));
    // Google grounding is no longer tried per query: runDeepResearch
    // calls it once for the whole question when results are weak.
    return results.slice(0, opts.resultsPerQuery);
}

/* ---------------------------------------------------------
   PAGE READER
   --------------------------------------------------------- */

function extractReadable(html = "") {
    const title =
        stripTags((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1] || "") ||
        stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");

    const published =
        (html.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|date|pubdate|og:updated_time)["'][^>]+content=["']([^"']+)/i) || [])[1] ||
        (html.match(/"date(?:Published|Modified|Created)"\s*:\s*"([^"]+)"/i) || [])[1] ||
        (html.match(/<meta[^>]+(?:property|name)=["'](?:article:modified_time|parsely-pub-date|sailthru\.date|dc\.date)["'][^>]+content=["']([^"']+)/i) || [])[1] ||
        (html.match(/<time[^>]+datetime=["']([^"']+)/i) || [])[1] ||
        "";

    let body = html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|noscript|svg|iframe|form|button|select|template)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, " ");

    const main =
        body.match(/<article[\s\S]*?<\/article>/i)?.[0] ||
        body.match(/<main[\s\S]*?<\/main>/i)?.[0] ||
        body.match(/<body[\s\S]*?<\/body>/i)?.[0] ||
        body;

    const text = decodeEntities(
        main
            .replace(/<(h[1-6])[^>]*>/gi, "\n\n## ")
            .replace(/<\/(p|div|section|h[1-6]|tr|table|ul|ol)>/gi, "\n")
            .replace(/<li[^>]*>/gi, "\n- ")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<td[^>]*>/gi, " | ")
            .replace(/<[^>]+>/g, " ")
    )
        .replace(/[ \t\f\v]+/g, " ")
        .replace(/\n\s*\n\s*\n+/g, "\n\n")
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 2 && !/^(share|tweet|subscribe|sign in|log in|cookie|accept|advertisement)/i.test(line))
        .join("\n")
        .trim();

    return { title, published, text };
}

// Reader backup for pages that block servers or need JavaScript:
// r.jina.ai turns a page into clean text (free; JINA_API_KEY raises
// the limit). Used only for a few pages per search.
async function readViaReader(url, opts) {
    const key = envKey("JINA_API_KEY");
    let response;
    try {
        response = await timedFetch(
            `https://r.jina.ai/${url}`,
            {
                headers: {
                    Accept: "text/plain",
                    "X-Timeout": "7",
                    ...(key ? { Authorization: `Bearer ${key}` } : {})
                }
            },
            Math.max(opts.pageTimeoutMs, 8000)
        );
    } catch {
        return null;
    }
    if (!response.ok) {
        return null;
    }
    const raw = (await response.text()).slice(0, opts.maxPageBytes);
    const title = (raw.match(/^Title:\s*(.+)$/m) || [])[1] || "";
    const published = (raw.match(/^Published Time:\s*(.+)$/m) || [])[1] || "";
    const body = raw.includes("Markdown Content:") ? raw.split("Markdown Content:").slice(1).join("Markdown Content:") : raw;
    const text = body
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n\s*\n+/g, "\n\n")
        .trim();
    if (text.length < 300 || /^(access denied|just a moment|attention required)/i.test(text)) {
        return null;
    }
    return { title: title.trim(), published: published.trim(), finalUrl: url, text: text.slice(0, opts.pageChars), viaReader: true };
}

function pageLinks(html, base) {
    const seen = new Set();
    const links = [];
    for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        let href;
        try {
            href = new URL(decodeEntities(match[1]), base).toString();
        } catch {
            continue;
        }
        const text = stripTags(match[2]).replace(/\s+/g, " ").trim().slice(0, 100);
        if (!/^https?:/.test(href) || text.length < 2 || seen.has(href)) {
            continue;
        }
        seen.add(href);
        links.push({ text, url: href });
        if (links.length >= 60) {
            break;
        }
    }
    return links;
}

async function readPage(url, opts) {
    const page = await readPageDirect(url, opts);
    if (page || !opts.reader || opts.reader.left <= 0 || !(await isPublicUrl(url))) {
        return page;
    }
    opts.reader.left -= 1;
    return readViaReader(url, opts);
}

async function readPageDirect(url, opts) {
    if (!(await isPublicUrl(url))) {
        return null;
    }
    let response;
    try {
        response = await timedFetch(
            url,
            { redirect: "follow", headers: { Accept: "text/html,application/xhtml+xml" } },
            opts.pageTimeoutMs
        );
    } catch {
        return null;
    }
    if (!response.ok) {
        return null;
    }
    if (response.url && response.url !== url && !(await isPublicUrl(response.url))) {
        return null;
    }
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("xhtml") && !type.includes("text/plain")) {
        return null;
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > opts.maxPageBytes) {
        return null;
    }
    let html = await response.text();
    if (html.length > opts.maxPageBytes) {
        html = html.slice(0, opts.maxPageBytes);
    }
    const page = type.includes("text/plain")
        ? { title: "", published: "", text: html }
        : extractReadable(html);
    if (page.text.length < 300) {
        return null;
    }
    const finalUrl = response.url ? normalizeUrl(response.url) || url : url;
    return {
        ...page,
        finalUrl,
        text: page.text.slice(0, opts.pageChars),
        ...(opts.wantLinks && !type.includes("text/plain") ? { links: pageLinks(html, finalUrl) } : {})
    };
}

/* ---------------------------------------------------------
   PLANNER (model)
   --------------------------------------------------------- */

function thinkingOffConfig(model) {
    const name = String(model || "").toLowerCase();
    if (/gemini-3/.test(name)) {
        return { thinkingLevel: "minimal" };
    }
    if (/gemini-2\.5/.test(name)) {
        return /pro/.test(name) ? { thinkingBudget: 128 } : { thinkingBudget: 0 };
    }
    return null;
}

export async function askModelJson({ apiKey, model, prompt, timeoutMs = 12000, shape = "array", maxOutputTokens = 1024, thinkingConfig = null }) {
    if (!apiKey || !model) {
        return null;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const thinking = thinkingConfig || thinkingOffConfig(model);

    const call = async (withExtras) => {
        const generationConfig = { temperature: 0.1, maxOutputTokens };
        if (withExtras) {
            generationConfig.responseMimeType = "application/json";
            if (thinking) {
                generationConfig.thinkingConfig = thinking;
            }
        }
        const response = await timedFetch(
            url,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig
                })
            },
            timeoutMs
        );
        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            console.warn("[askModelJson]", model, response.status, detail.slice(0, 200));
            return { ok: false, status: response.status };
        }
        const data = await response.json();
        const text = (data?.candidates?.[0]?.content?.parts || [])
            .filter(part => !part.thought)
            .map(part => part.text || "")
            .join("");
        const json = shape === "object"
            ? text.match(/\{[\s\S]*\}/)?.[0]
            : text.match(/\[[\s\S]*\]/)?.[0];
        if (!json) {
            console.warn("[askModelJson] no JSON from", model, text.slice(0, 120));
        }
        return { ok: true, value: json ? JSON.parse(json) : null };
    };

    try {
        let result = await call(true);
        // Some models reject thinkingConfig / JSON mode: retry plain once.
        if (!result.ok && result.status === 400) {
            result = await call(false);
        }
        return result.ok ? result.value : null;
    } catch (error) {
        console.warn("[askModelJson] failed", model, error?.message || error);
        return null;
    }
}

function cleanQueries(list, max) {
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
        .map(item => String(item || "").replace(/\s+/g, " ").trim().slice(0, 160))
        .filter(item => {
            const key = item.toLowerCase();
            if (item.length < 3 || seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        })
        .slice(0, max);
}

async function planQueries(question, context, opts) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
    const planned = await askModelJson({
        apiKey: opts.apiKey,
        model: opts.plannerModel,
        prompt:
`Today is ${today}. You plan web searches for a deep research task.
Recent conversation (for context only):
${context || "(none)"}

User request:
${question}

Return ONLY a JSON array of ${opts.maxQueries} short (3 to 7 words), specific English web search queries that together cover the request from different angles (facts, latest news, comparisons, expert analysis, numbers). Include the current year or month when freshness matters (news, prices, scores, releases). No explanations.`
    });
    const queries = cleanQueries(planned, opts.maxQueries);
    if (queries.length) {
        return queries;
    }
    const base = question.replace(/\s+/g, " ").trim().slice(0, 150);
    const keywords = queryTerms(base).slice(0, 6).join(" ");
    return cleanQueries([base, keywords, `${keywords} ${new Date().getFullYear()}`], opts.maxQueries);
}

// DISCOVERY: open-ended "explore this topic" searches. One planner
// call returns diverse angles to search AND follow-up ideas the user
// may want to explore next.
export async function planDiscovery(question, context, opts) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
    const plan = await askModelJson({
        apiKey: opts.apiKey,
        model: opts.plannerModel,
        shape: "object",
        maxOutputTokens: 500,
        timeoutMs: 8000,
        prompt:
`Today is ${today}. The user wants to DISCOVER / explore a topic, not get one narrow fact.
Recent chat: ${context || "(none)"}
Request: ${String(question).slice(0, 800)}

Reply ONLY with JSON: {"queries": ["4-5 short English web queries (3-7 words) that each cover a DIFFERENT angle: overview, latest developments (add month and year), main players or options, pros/cons or criticism, numbers or data"], "explore": ["3 short follow-up questions the user could ask next, in the user's language"]}`
    }).catch(() => null);
    return {
        queries: cleanQueries(plan?.queries, 5),
        explore: cleanQueries(plan?.explore, 3)
    };
}

async function planFollowUps(question, sources, opts) {
    const titles = sources.map((item, index) => `[${index + 1}] ${item.title}`).join("\n");
    const planned = await askModelJson({
        apiKey: opts.apiKey,
        model: opts.plannerModel,
        prompt:
`Research question:
${question}

Sources already read:
${titles}

What important angle is still missing? Return ONLY a JSON array of up to 2 new English web search queries that fill the gaps. Return [] if nothing important is missing.`
    });
    return cleanQueries(planned, 2);
}

/* ---------------------------------------------------------
   FACT CHECK
   A second model reads every source + Google's own answer and
   writes a short fact sheet: each key fact with the sources
   that support it, conflicts, and what is still unknown. The
   answer model is told to trust only this + the sources.
   --------------------------------------------------------- */

function lightThinking(model) {
    const name = String(model || "").toLowerCase();
    if (/gemini-3/.test(name)) {
        return { thinkingLevel: "low" };
    }
    if (/gemini-2\.5/.test(name)) {
        return { thinkingBudget: 512 };
    }
    return null;
}

async function verifyFacts(question, sources, briefs, opts) {
    if (!opts.apiKey || !(opts.verifyModel || opts.plannerModel) || (!sources.length && !briefs.length)) {
        return "";
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
    const perSource = Math.max(900, Math.floor(opts.verifyChars / Math.max(1, sources.length)));
    const sourceText = sources
        .map((item, index) =>
            `[${index + 1}] ${item.title} (${hostOf(item.url)}, ${trustLabel(item.url)}, published ${formatDate(item.published) || "unknown"})\n` +
            String(item.text || "").slice(0, perSource))
        .join("\n\n");
    const googleText = briefs.length ? briefs.join("\n\n") : "(none)";

    const sheet = await askModelJson({
        apiKey: opts.apiKey,
        model: opts.verifyModel || opts.plannerModel,
        shape: "object",
        timeoutMs: opts.verifyTimeoutMs,
        maxOutputTokens: 3000,
        thinkingConfig: lightThinking(opts.verifyModel || opts.plannerModel),
        prompt:
`You are a strict fact-checker. Today is ${today}.
Question: ${question}

EXTRA EVIDENCE: latest news headlines / quick answers (independent check, label them G):
${googleText}

WEB SOURCES:
${sourceText}

Extract only the facts needed to answer the question. For every fact list which sources support it (source numbers, and "G" for the extra evidence). Prefer the newest dated information, and official / trusted-outlet sources over unrated ones; mark a fact "confirmed" only when 2+ independent sources (or a source + G) agree, "single" when only one source says it. List real conflicts between sources (with which is newer). List what the question asks that NO source answers. If the question needs a calculation or comparison, do it carefully from the facts and show the numbers. Never add facts that are not in the text above.

Reply ONLY with JSON: {"facts":[{"fact":"...","sources":["1","G"],"date":"YYYY-MM-DD or unknown","status":"confirmed|single"}],"conflicts":["..."],"unknown":["..."],"calculation":"... or empty","best_answer":"one or two sentence answer supported by the facts"}`
    });

    if (!sheet || typeof sheet !== "object" || !Array.isArray(sheet.facts)) {
        return "";
    }
    const lines = [];
    sheet.facts.slice(0, 14).forEach(item => {
        const refs = (Array.isArray(item?.sources) ? item.sources : [])
            .map(ref => /^g$/i.test(String(ref)) ? "News headlines" : `[${String(ref).replace(/[^0-9]/g, "")}]`)
            .filter(ref => ref !== "[]")
            .join(" ");
        const fact = String(item?.fact || "").trim();
        if (fact) {
            lines.push(`- ${fact} — ${refs || "no source"}${item?.date && item.date !== "unknown" ? `, ${item.date}` : ""} (${item?.status === "confirmed" ? "CONFIRMED" : "single source"})`);
        }
    });
    if (!lines.length) {
        return "";
    }
    const conflicts = (sheet.conflicts || []).filter(Boolean).slice(0, 5);
    const unknown = (sheet.unknown || []).filter(Boolean).slice(0, 5);
    return [
        "Key facts:",
        ...lines,
        conflicts.length ? `Conflicts:\n${conflicts.map(item => `- ${item}`).join("\n")}` : "",
        unknown.length ? `Not found in any source:\n${unknown.map(item => `- ${item}`).join("\n")}` : "",
        sheet.calculation ? `Calculation: ${String(sheet.calculation).slice(0, 600)}` : "",
        sheet.best_answer ? `Checked answer: ${String(sheet.best_answer).slice(0, 600)}` : ""
    ].filter(Boolean).join("\n");
}

/* ---------------------------------------------------------
   RANKING
   --------------------------------------------------------- */

function parseDate(value) {
    if (!value) {
        return 0;
    }
    const time = Date.parse(String(value).trim());
    return Number.isFinite(time) && time > 0 && time < Date.now() + 3 * 864e5 ? time : 0;
}

// Guess a year from URL / title / snippet when the page gives no date.
function guessYear(item) {
    const text = `${item.url || ""} ${item.title || ""} ${String(item.snippet || "").slice(0, 200)}`;
    const years = (text.match(/\b20[12]\d\b/g) || []).map(Number);
    return years.length ? Math.max(...years) : 0;
}

function ageDays(item) {
    const time = parseDate(item.published);
    if (time) {
        return (Date.now() - time) / 864e5;
    }
    const year = guessYear(item);
    if (year) {
        return Math.max(0, (new Date().getFullYear() - year) * 365);
    }
    return null;
}

function recencyBonus(item) {
    const age = ageDays(item);
    if (age === null) {
        return 0;
    }
    if (age <= 14) return 0.9;
    if (age <= 60) return 0.6;
    if (age <= 180) return 0.3;
    if (age <= 365) return 0;
    return -0.6;
}

function formatDate(value) {
    const time = parseDate(value);
    return time ? new Date(time).toISOString().slice(0, 10) : "";
}

function mergeResults(resultLists, already = new Set(), fresh = false) {
    const byUrl = new Map();
    resultLists.forEach(list => {
        list.forEach((item, rank) => {
            if (already.has(item.url)) {
                return;
            }
            const entry = byUrl.get(item.url) || { ...item, score: 0, hits: 0 };
            entry.hits += 1;
            entry.score += 1 / (rank + 1.5) + 0.35 + (entry.hits === 1 ? trustBonus(item.url) : 0);
            if (!entry.snippet && item.snippet) {
                entry.snippet = item.snippet;
            }
            byUrl.set(item.url, entry);
        });
    });

    if (fresh) {
        byUrl.forEach(entry => {
            entry.score += recencyBonus(entry) + (entry.grounded ? 0.4 : 0);
        });
    }

    const perHost = new Map();
    return [...byUrl.values()]
        .sort((a, b) => b.score - a.score)
        .filter(item => {
            // Google grounding links all share one redirect host; their
            // title is the real site.
            const host = item.grounded ? String(item.title || item.url).toLowerCase() : hostOf(item.url);
            const count = perHost.get(host) || 0;
            perHost.set(host, count + 1);
            return count < 2;
        });
}

async function readCandidates(candidates, want, opts, onRead) {
    const picked = [];
    const queue = [...candidates];
    while (picked.length < want && queue.length) {
        const batch = queue.splice(0, Math.max(want - picked.length + 4, 4));
        const pages = await Promise.all(
            batch.map(async item => {
                const page = await readPage(item.url, opts).catch(() => null);
                return page
                    ? {
                        title: page.title || item.title || hostOf(page.finalUrl || item.url),
                        url: page.finalUrl || item.url,
                        published: page.published || item.published || "",
                        snippet: item.snippet,
                        text: page.text
                    }
                    : null;
            })
        );
        pages.filter(Boolean).forEach(page => {
            if (picked.length < want) {
                picked.push(page);
                onRead?.(page);
            }
        });
    }
    return picked;
}

/* ---------------------------------------------------------
   MAIN
   --------------------------------------------------------- */

export async function runDeepResearch({
    question,
    context = "",
    apiKey,
    plannerModel,
    groundingModel = "",
    onStatus = () => {},
    options = {}
} = {}) {
    const opts = {
        ...DEFAULTS,
        news: NEWS_PATTERN.test(String(question || "")),
        ...options,
        apiKey,
        plannerModel,
        groundingModel
    };
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    const status = (stage, info = {}) => {
        try {
            onStatus(stage, info);
        } catch {}
    };

    const cleanQuestion = String(question || "").trim().slice(0, 2000);
    if (!cleanQuestion) {
        return { sources: [], queries: [], contextText: "" };
    }

    // Same question asked again within 10 minutes: answer from cache (instant, free).
    const researchKey = `research|${cleanQuestion.toLowerCase()}|${opts.hard ? 1 : 0}|${(Array.isArray(opts.queries) ? opts.queries : []).join("|").toLowerCase()}`;
    const cachedResearch = cacheGet(researchKey);
    if (cachedResearch) {
        status("writing", { count: cachedResearch.sources.length });
        return { ...cachedResearch, cached: true, tookMs: elapsed() };
    }

    status("planning");
    const preset = cleanQueries(opts.queries, opts.maxQueries);
    const queries = preset.length
        ? preset
        : await planQueries(cleanQuestion, context, opts);

    status("searching", { queries });
    const briefs = [];
    // Pakistani questions: one extra search limited to trusted Pakistani sites.
    const searchQueries = [...queries];
    if (isPakistanQuery(`${cleanQuestion} ${queries.join(" ")}`)) {
        searchQueries.push(pakistanSiteQuery(queries[0] || cleanQuestion));
    }
    const topicQuery = topicSiteQuery(`${cleanQuestion} ${queries.join(" ")}`, queries[0] || cleanQuestion);
    if (topicQuery) {
        searchQueries.push(topicQuery);
    }
    const lists = await Promise.all(
        searchQueries.map(query => searchWeb(query, opts).catch(() => []))
    );
    const fresh = Boolean(opts.fresh || opts.news);
    // Google Search grounding, at most ONE call per question (free
    // daily quota). Its links join the candidates and its short
    // answer becomes extra evidence for the fact check.
    let groundingUsed = false;
    const groundOnce = async () => {
        if (groundingUsed || groundingMode() === "off" || !opts.apiKey || !opts.groundingModel) {
            return [];
        }
        groundingUsed = true;
        if (!(await takeGroundingSlot())) {
            console.log("[GROUNDING] daily cap reached");
            return [];
        }
        status("searching", { queries: ["Google"] });
        const list = await searchGeminiGrounding(
            `${cleanQuestion.slice(0, 500)}\n(Look up: ${queries.join("; ")})`,
            { ...opts, groundBullets: "6-10", groundTokens: 900, groundTimeoutMs: Math.min(12000, Math.max(6000, opts.budgetMs - elapsed() - 6000)) }
        ).catch(() => []);
        if (list?.answer) {
            briefs.push(`Google Search summary:\n${list.answer}`);
        }
        console.log("[GROUNDING]", list.length, "links");
        return Array.isArray(list) ? list : [];
    };
    const newsQueries = fresh ? queries : (opts.news ? [queries[0]] : []);
    const headlinesPromise = fresh
        ? Promise.all(
            queries.slice(0, 2).map(query => runEngine("googlenews", searchGoogleNewsHeadlines, query, opts))
        ).then(all => {
            const seenTitles = new Set();
            return all.flat().filter(item => {
                const key = item.title.toLowerCase();
                if (seenTitles.has(key)) {
                    return false;
                }
                seenTitles.add(key);
                return true;
            }).sort((a, b) => (parseDate(b.published) || 0) - (parseDate(a.published) || 0)).slice(0, 10);
        })
        : Promise.resolve([]);
    const [wiki, newsLists, grounded, headlines] = await Promise.all([
        opts.news ? [] : runEngine("wikipedia", searchWikipedia, queries[0], opts),
        Promise.all(
            newsQueries.map(query =>
                runEngine("bingnews", searchBingNews, query, opts)
                    .then(list => cleanResults(list, queryTerms(query)).slice(0, 6))
                    .catch(() => [])
            )
        ),
        groundingMode() === "always" ? groundOnce() : [],
        headlinesPromise
    ]);
    if (headlines.length) {
        briefs.push(
            "Latest news headlines (Google News):\n" +
            headlines.map(item => `- ${formatDate(item.published) || "undated"} | ${item.outlet || "news"} | ${item.title}`).join("\n")
        );
    }
    console.log("[SEARCH_ENGINES]", JSON.stringify(Object.fromEntries(engineStats)), "grounding:", groundingMode());
    let candidates = mergeResults([
        ...(grounded.length ? [grounded] : []),
        ...newsLists.filter(list => list.length),
        ...lists,
        cleanResults(wiki, queryTerms(queries[0]))
    ], new Set(), fresh);

    // Free engines came back weak (often blocked on cloud servers):
    // ask Google once.
    if (groundingMode() === "fallback" && candidates.length < opts.minCandidates) {
        const extra = await groundOnce();
        if (extra.length) {
            candidates = mergeResults([extra, ...newsLists.filter(list => list.length), ...lists, cleanResults(wiki, queryTerms(queries[0]))], new Set(), fresh);
        }
    }

    // For current questions, skip clearly old pages when fresher ones exist.
    // maxAgeDays (day/week/month/year freshness from the planner) is stricter.
    if (fresh || opts.maxAgeDays) {
        const limit = opts.maxAgeDays || 400;
        const recent = candidates.filter(item => {
            const age = ageDays(item);
            return age === null || age <= limit;
        });
        if (recent.length >= 3) {
            candidates = recent;
        }
    }

    status("reading", { count: Math.min(opts.maxPages, candidates.length) });
    let read = 0;
    const onRead = () => {
        read += 1;
        status("reading", { count: read });
    };
    opts.reader = { left: opts.readerFallbacks };
    const sources = await readCandidates(candidates, Math.max(3, opts.maxPages), opts, onRead);

    // Pages could not be read (blocked / JavaScript only): one Google
    // grounding call brings fresh links, then read those.
    if (sources.length < 3 && groundingMode() === "fallback" && !groundingUsed && opts.budgetMs - elapsed() > 7000) {
        const extra = await groundOnce();
        if (extra.length) {
            const seen = new Set(sources.map(item => item.url));
            const fresher = mergeResults([extra], seen, fresh);
            candidates = mergeResults([extra, candidates], new Set(), fresh);
            sources.push(...await readCandidates(fresher, Math.max(0, opts.maxPages - sources.length), opts, onRead));
        }
    }

    if (fresh && sources.length > 2) {
        const recentRead = sources.filter(item => {
            const age = ageDays(item);
            return age === null || age <= 400;
        });
        if (recentRead.length >= 2) {
            sources.splice(0, sources.length, ...recentRead);
        }
        sources.sort((a, b) => (parseDate(b.published) || 0) - (parseDate(a.published) || 0));
    }

    // Redirected/grounded links can land on the same page twice.
    {
        const seenFinal = new Set();
        for (let i = sources.length - 1; i >= 0; i -= 1) {
            if (seenFinal.has(sources[i].url)) {
                sources.splice(i, 1);
            } else {
                seenFinal.add(sources[i].url);
            }
        }
    }

    // Follow-up round for gaps, only if time allows.
    const remaining = opts.budgetMs - elapsed();
    if (sources.length && remaining > opts.followUpMinRemainingMs) {
        const followUps = await planFollowUps(cleanQuestion, sources, opts);
        if (followUps.length) {
            status("searching", { queries: followUps });
            const more = await Promise.all(
                followUps.map(query => searchWeb(query, opts).catch(() => []))
            );
            const seen = new Set(sources.map(item => item.url));
            const extra = mergeResults(more, seen);
            const extraPages = await readCandidates(extra, Math.max(0, opts.maxPages - sources.length), opts, onRead);
            candidates = candidates.concat(extra);
            sources.push(...extraPages);
            queries.push(...followUps);
        }
    }

    // Breadth: results we did not open still add their search snippet
    // (clearly marked), so the answer sees many more sites.
    {
        const have = new Set(sources.map(item => item.url));
        const haveHosts = new Map();
        sources.forEach(item => haveHosts.set(hostOf(item.url), (haveHosts.get(hostOf(item.url)) || 0) + 1));
        const wantSnippets = sources.length ? opts.snippetSources : Math.max(opts.snippetSources, 6);
        let added = 0;
        for (const item of candidates) {
            if (added >= wantSnippets) {
                break;
            }
            const snippet = String(item.snippet || "").replace(/\s+/g, " ").trim();
            const host = item.grounded ? String(item.title || "").toLowerCase() : hostOf(item.url);
            if (have.has(item.url) || snippet.length < 60 || snippet === item.title || (haveHosts.get(host) || 0) >= 2) {
                continue;
            }
            have.add(item.url);
            haveHosts.set(host, (haveHosts.get(host) || 0) + 1);
            sources.push({ title: item.title, url: item.url, published: item.published || "", snippet, text: snippet.slice(0, 500), partial: true });
            added += 1;
        }
    }

    // Fact check across all sources + Google's own answer.
    let factSheet = "";
    if (opts.verify && (sources.length || briefs.length)) {
        status("verifying", { count: sources.length });
        factSheet = await verifyFacts(cleanQuestion, sources, briefs, opts).catch(error => {
            console.warn("[verifyFacts] failed", error?.message || error);
            return "";
        });
    }
    if (!factSheet && briefs.length) {
        factSheet = `Extra evidence (unverified):\n${briefs.join("\n\n").slice(0, 2500)}`;
    }

    // Build the numbered context within the total budget.
    // Snippets are small: keep room for them so every listed source is in the context.
    const snippetRoom = sources.filter(item => item.partial).length * 700;
    let budget = opts.totalContextChars;
    const blocks = [];
    sources.forEach((item, index) => {
        const room = item.partial ? budget : budget - snippetRoom;
        if (room <= 400) {
            return;
        }
        const body = item.text.slice(0, Math.min(item.text.length, room));
        budget -= body.length;
        blocks.push(
            `[${index + 1}] ${item.title}\nURL: ${item.url}\nSource type: ${trustLabel(item.url)}` +
            (formatDate(item.published) ? `\nPublished: ${formatDate(item.published)}` : "\nPublished: unknown") +
            (item.partial ? "\nText: search snippet only (cut, may miss context: use only clear, complete statements)" : "") +
            `\n\n${body}`
        );
    });

    status("writing", { count: sources.length });

    const result = {
        queries,
        sources: sources.map(item => ({
            title: item.title,
            url: item.url,
            published: item.published || "",
            snippet: String(item.snippet || item.text || "").replace(/\s+/g, " ").trim().slice(0, 220),
            ...(item.partial ? { partial: true } : {})
        })),
        contextText: (factSheet ? `=== FACT CHECK (cross-checked across sources) ===\n${factSheet}\n\n=== SOURCES ===\n` : "") + blocks.join("\n\n---\n\n"),
        factSheet,
        tookMs: elapsed()
    };
    if (sources.filter(item => !item.partial).length >= 2) {
        cacheSet(researchKey, result, 10 * 60 * 1000);
    }
    return result;
}

export function buildResearchPrompt(question, research) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
    if (!research?.contextText) {
        return `${question}

(Deep research mode: live web search returned no usable sources right now. Answer from your own knowledge, say clearly that live sources could not be checked, and mention anything that may be out of date.)`;
    }
    return `${question}

=== DEEP RESEARCH MODE ===
Today is ${today}. I searched the web (queries: ${research.queries.join(" | ")}) and read these sources for you:

${research.contextText}

=== HOW TO ANSWER ===
- Write a thorough, well-structured research answer in the user's language, using markdown headings and short paragraphs.
- Start with a short direct answer / summary, then the details, then a clear conclusion or recommendation.
- Base facts, numbers and dates on the sources above and cite them inline like [1] or [2][4]. Only cite numbers that exist.
- The FACT CHECK section was cross-checked across sources and Google: rely on CONFIRMED facts first, word "single source" facts carefully, never invent numbers, names or dates.
- If sources disagree, say so and explain which looks more reliable and why.
- If something is not covered by the sources, say so instead of guessing.
- Do not paste URLs in the text and do not add a separate sources list; the app shows the sources.

${ACCURACY_RULES}`;
}


/* ---------------------------------------------------------
   LIVE SEARCH FOR NORMAL CHAT
   --------------------------------------------------------- */

const FRESH_PATTERNS = [
    /\b(today|tonight|yesterday|tomorrow|right now|this (week|month|year)|currently|current|latest|recent|recently|newest|breaking|live|update[sd]?|news|headlines?)\b/i,
    /\b(aaj|aj|abhi|abi|kal|taza|tazah|khabar|khabr|khabrein|khabren|halaat|haalat|filhal|aajkal|ajkal)\b/i,
    /\b(price|prices|rate|rates|qeemat|keemat|cost|dollar|gold|sona|petrol|diesel|bitcoin|btc|crypto|stock|shares?|market|exchange rate|psx)\b/i,
    /\b(score|match|won|win|winner|jeeta|jeeti|haara|result|results|standings|fixture|schedule|election|elections|vote|poll)\b/i,
    /\b(weather|mosam|mausam|temperature|forecast)\b/i,
    /\b(president|prime minister|pm of|ceo of|chief minister|wazir|wazir-e-azam|governor|minister|captain of|coach of)\b/i,
    /\b(released?|launch(ed)?|announced?|new version|iphone \d+|android \d+|gpt-?\d|gemini \d|model \d)\b/i,
    /\b(20(2[5-9]|3\d))\b/
];

const NEWS_PATTERN =
    /\b(news|headlines?|breaking|khabar|khabr|khabrein|khabren|today|aaj|aj|yesterday|kal|latest|election|match|score|won|jeeta|attack|war|protest|announced?)\b/i;

export function needsFreshInfo(text = "") {
    const value = String(text || "").trim();
    if (value.length < 4 || value.length > 1500) {
        return false;
    }
    // Pure code / writing tasks don't need the web.
    if (/```|\b(function|const|let|class|import|def |SELECT )\b/.test(value)) {
        return false;
    }
    // Creative writing (poem, story, essay...) without a news angle.
    if (
        /\b(poem|poetry|story|kahani|essay|shayari|nazm|ghazal|joke|lyrics|caption)\b/i.test(value) &&
        !/\b(news|khabar|latest|today|aaj)\b/i.test(value)
    ) {
        return false;
    }
    return FRESH_PATTERNS.some(pattern => pattern.test(value));
}

export function isNewsQuery(text = "") {
    return NEWS_PATTERN.test(String(text || ""));
}

export async function runLiveSearch(args = {}) {
    const hard = Boolean(args.options?.hard);
    return runDeepResearch({
        ...args,
        options: {
            maxQueries: hard ? 4 : 3,
            maxPages: hard ? 10 : 7,
            pageChars: hard ? 4500 : 3500,
            totalContextChars: hard ? 38000 : 26000,
            snippetSources: hard ? 12 : 8,
            minCandidates: hard ? 8 : 6,
            readerFallbacks: hard ? 3 : 2,
            pageTimeoutMs: 6000,
            searchTimeoutMs: 5000,
            budgetMs: hard ? 30000 : 18000,
            followUpMinRemainingMs: hard ? 9000 : Number.POSITIVE_INFINITY,
            verifyChars: hard ? 26000 : 18000,
            verifyTimeoutMs: hard ? 12000 : 8000,
            news: isNewsQuery(args.question),
            fresh: true,
            ...(args.options || {})
        }
    });
}

export const ACCURACY_RULES = `=== ACCURACY RULES (most important) ===
- A number, score, benchmark, price or percentage may be used ONLY when the result says clearly what it measures AND which product/model/person it belongs to. Text with "..." gaps or broken tables is cut: never take a number from around a gap. If unsure, leave the number out.
- Never connect facts from different results into cause and effect ("chip X makes model Y fast") unless one result says exactly that.
- Never add a product, model or version name that is not written in the results. Do not guess family members (e.g. a "Mini" or "Haiku" version) from a pattern.
- For "latest / best / which is ahead" questions: name each company's newest and most capable item as the results state, with its date. If the results don't make the top one clear, say so.
- Do not declare a winner unless the results support it; otherwise explain which one fits which need.
- Keep the personality's tone, but no hype or fake certainty: words like "dhamaka", "zabardast", "sab se best" only when a source backs it.
- Better a shorter correct answer than a longer one with doubtful details.
- In Smart UI cards (charts, compare) use only numbers and facts that pass these rules; skip the card if you have too few solid facts.`;

// Search was needed but nothing usable came back: the model must not
// pass old knowledge off as the latest.
export const WEAK_SEARCH_NOTE = `=== LIVE SEARCH NOTE ===
A live web search was run for this message but no usable results came back right now. Your own knowledge is old (it can be a year or more behind).
- If the answer depends on what is latest, newest, top, best or current (AI models, versions, prices, people in a role, rankings, news), say in one short line at the start that you could not check live sources right now, so the list may be out of date.
- Do not call anything "the newest" or "the latest" from memory. Never invent new names, versions, scores or numbers.
- Do not make charts, scores or ratings from memory (no Smart UI card with numbers).
- Timeless parts (how something works, general advice) you can still answer normally.`;

// Flexible answer shape: the search mode the planner picked decides
// how the writer lays out the answer.
const STYLE_GUIDES = {
    quick: "QUICK: give the direct answer in the first 1-2 sentences, then only the few details that matter. Short.",
    news: "NEWS: newest first. Each item with its date and a one-line what-happened; group by story; say what is still developing.",
    deep: "DEEP: short summary first, then sections with headings, numbers with their source, where sources disagree, and a clear conclusion.",
    discover: "DISCOVER: a short overview, then the main angles (each 2-4 lines: what it is, why it matters), then a short 'Explore next' list with the follow-up ideas given below.",
    memory: "MEMORY: some facts come from the user's EARLIER CHATS (dated). Say so naturally (\"pichli baar ...\") and prefer fresh web results when they disagree."
};

export function searchStyleNote(styles = [], explore = []) {
    const list = [...new Set((styles || []).filter(name => STYLE_GUIDES[name]))];
    if (!list.length) {
        return "";
    }
    return `\n\n=== ANSWER SHAPE (pick what fits the question) ===\n${list.map(name => `- ${STYLE_GUIDES[name]}`).join("\n")}` +
        (explore.length ? `\nFollow-up ideas to offer at the end: ${explore.join(" | ")}` : "");
}

function thinEvidenceNote(research) {
    if (!Array.isArray(research?.sources)) {
        return "";
    }
    const full = research.sources.filter(item => !item.partial).length;
    if (full >= 3) {
        return "";
    }
    return `\n- Only ${full} full page(s) could be read (the rest are short snippets). Use what the results show; for anything they do not cover, say it is from older knowledge and may be out of date.`;
}

export function buildLiveSearchPrompt(question, research) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
    if (!research?.contextText) {
        return `${question}\n\n${WEAK_SEARCH_NOTE}`;
    }
    return `${question}

=== LIVE WEB RESULTS (searched just now, today is ${today}) ===
${research.contextText}

=== HOW TO USE THEM ===
- Answer naturally in your normal style and in the user's language.
- Each result has a Published date. Results can be old: always prefer the NEWEST dated information, and if two results disagree, the newer one wins.
- Never present an old number or old news as current. Say "as of <date>" using the result's date.
- For anything current (news, prices, scores, net worth, who holds a position, AI models, releases) trust these results over your own older knowledge, which is out of date. Do not say something "has not been released yet" unless a recent result says so.
- The FACT CHECK section was cross-checked across all sources and Google. Build the answer on CONFIRMED facts first. A "single source" fact must be worded carefully ("according to ..."). If there are conflicts, say so briefly and go with the newest reliable source.
- Never invent a number, name or date that is not in the results. If something is listed under "Not found in any source", say you couldn't confirm it.
- For calculations or comparisons, use the numbers from the results and double-check the math before answering.
- Cite inline like [1]. If the results don't cover it, say you couldn't confirm the latest instead of guessing.
- Do not paste URLs and do not add a separate sources list.${thinEvidenceNote(research)}${searchStyleNote(research.styles, research.explore)}

${ACCURACY_RULES}`;
}


/* ---------------------------------------------------------
   SMART SEARCH ROUTER
   A small fast model reads the message (+ recent chat) and
   decides if live web info is needed, and writes the queries
   in the same call. Regex is only a fallback when the router
   model is unavailable (rate limit / timeout).
   --------------------------------------------------------- */

export async function decideSearch({
    question,
    context = "",
    apiKey,
    model,
    timeoutMs = 6000
} = {}) {
    const text = String(question || "").trim();
    if (!text) {
        return { search: false, queries: [], news: false, by: "empty" };
    }

    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(now);

    const decision = await askModelJson({
        apiKey,
        model,
        shape: "object",
        maxOutputTokens: 600,
        timeoutMs,
        prompt:
`You are the search router of a chat assistant whose built-in knowledge is old. Today is ${today}.
Decide if answering the LAST user message well needs fresh information from the live web.

Search = true when the answer depends on facts that change or that may be newer than the model's training: news or events, anything "latest/current/today/now", prices, rates, scores, results, weather, schedules, releases, versions, who currently holds a role, a specific recent person/company/product/place the model may not know well, or when the user asks to check, verify or look something up. Use the recent chat to understand follow-ups ("aur uski price?" = search about the earlier topic).
Also search = true for ANY question about a specific named product, AI model, software version, company, person, game, film, phone, law or event, including future or rumored ones ("GPT-6 kaisa hoga", "iPhone 18 kab aayega", "next election"), because there may be news the model does not know. When unsure, choose true.
Search = false for greetings, small talk, feelings, opinions, creative writing, coding help, maths, translations, explaining timeless concepts, or questions about the chat itself.
The user may write in English, Urdu, Roman Urdu, Hindi or any language.

Recent chat:
${context || "(none)"}

Last user message:
${text.slice(0, 1200)}

"hard" = true when the question is tricky: several parts, comparisons, rankings, multi-step facts (e.g. "the CEO of the company that bought X"), calculations with real-world numbers, precise numbers/dates, or anything where one wrong fact would ruin the answer. For hard questions write up to 4 queries that each look up one needed fact.

Reply ONLY with JSON: {"search": true|false, "news": true|false, "hard": true|false, "queries": ["1-4 short English web search queries, 3-7 words, add the current month and year (e.g. "${now.toLocaleString("en-US", { month: "long", year: "numeric" })}") when freshness matters; if the message asks about two different things, write one query for each"]}. If search is false, queries must be [].`
    });

    if (decision && typeof decision === "object" && typeof decision.search === "boolean") {
        return {
            search: decision.search,
            news: Boolean(decision.news),
            hard: Boolean(decision.hard),
            queries: decision.search ? cleanQueries(decision.queries, decision.hard ? 4 : 3) : [],
            by: "model"
        };
    }

    // Router unavailable: cheap fallback so search still works.
    const search = needsFreshInfo(text);
    return { search, news: search && isNewsQuery(text), queries: [], by: "fallback" };
}


/** Read one page (used by the tool agent's read_url tool). */
export async function readUrlText(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) {
        return null;
    }
    return readPage(normalized, { ...DEFAULTS, pageChars: 40000, wantLinks: true, reader: { left: 1 } });
}
