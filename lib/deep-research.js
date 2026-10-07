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

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const DEFAULTS = Object.freeze({
    maxQueries: 5,
    resultsPerQuery: 8,
    maxPages: 8,
    pageChars: 6000,
    totalContextChars: 42000,
    searchTimeoutMs: 7000,
    pageTimeoutMs: 8000,
    maxPageBytes: 1_500_000,
    budgetMs: 45000,
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
                contents: [{ role: "user", parts: [{ text: `Today is ${new Date().toISOString().slice(0, 10)}. Use Google Search for: ${query}\nReply with 3-6 short factual bullet points: exact names, numbers, dates (with "as of" date) from the newest results. No opinions.` }] }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0, maxOutputTokens: 500 }
            })
        },
        12000
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
    const stat = engineStats.get(name) || { ok: 0, fail: 0 };
    try {
        const list = (await fn(query, opts)) || [];
        stat.ok += 1;
        engineStats.set(name, stat);
        cacheSet(cacheKey, list, 10 * 60 * 1000);
        return list;
    } catch (error) {
        stat.fail += 1;
        engineStats.set(name, stat);
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

// Google grounding is the only paid part. Default OFF (zero cost).
// NEYO_GOOGLE_GROUNDING = "off" | "fallback" (only when free engines find <3) | "always"
function groundingMode() {
    const mode = String(process.env.NEYO_GOOGLE_GROUNDING || "off").toLowerCase();
    return ["always", "fallback"].includes(mode) ? mode : "off";
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
    const engines = [...WEB_ENGINES];
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
    let results = [...byUrl.values()].sort(
        (a, b) => (b.engines * 1.2 + b.rankScore) - (a.engines * 1.2 + a.rankScore)
    );
    const seen = new Set(results.map(item => item.url));
    const FALLBACK_ENGINES = groundingMode() === "off" ? [] : [["google", searchGeminiGrounding]];

    if (results.length < 3) {
        for (const [, engine] of FALLBACK_ENGINES) {
            try {
                const extra = cleanResults(await engine(query, opts), terms)
                    .filter(item => !seen.has(item.url));
                extra.forEach(item => seen.add(item.url));
                results = results.concat(extra);
                if (results.length >= 3) {
                    break;
                }
            } catch {
                /* next engine */
            }
        }
    }

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

async function readPage(url, opts) {
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
    return {
        ...page,
        finalUrl: response.url ? normalizeUrl(response.url) || url : url,
        text: page.text.slice(0, opts.pageChars)
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

async function askModelJson({ apiKey, model, prompt, timeoutMs = 12000, shape = "array", maxOutputTokens = 1024, thinkingConfig = null }) {
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
    const today = new Date().toISOString().slice(0, 10);
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
    const today = new Date().toISOString().slice(0, 10);
    const perSource = Math.max(900, Math.floor(opts.verifyChars / Math.max(1, sources.length)));
    const sourceText = sources
        .map((item, index) =>
            `[${index + 1}] ${item.title} (${hostOf(item.url)}, published ${formatDate(item.published) || "unknown"})\n` +
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

Extract only the facts needed to answer the question. For every fact list which sources support it (source numbers, and "G" for the extra evidence). Prefer the newest dated information; mark a fact "confirmed" only when 2+ independent sources (or a source + G) agree, "single" when only one source says it. List real conflicts between sources (with which is newer). List what the question asks that NO source answers. If the question needs a calculation or comparison, do it carefully from the facts and show the numbers. Never add facts that are not in the text above.

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
            entry.score += 1 / (rank + 1.5) + 0.35;
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
            const host = hostOf(item.url);
            const count = perHost.get(host) || 0;
            perHost.set(host, count + 1);
            return count < 2;
        });
}

async function readCandidates(candidates, want, opts, onRead) {
    const picked = [];
    const queue = [...candidates];
    while (picked.length < want && queue.length) {
        const batch = queue.splice(0, Math.max(want - picked.length + 2, 3));
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
    const researchKey = `research|${cleanQuestion.toLowerCase()}|${opts.hard ? 1 : 0}`;
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
    const lists = await Promise.all(
        queries.map(query => searchWeb(query, opts).catch(() => []))
    );
    const fresh = Boolean(opts.fresh || opts.news);
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
        groundingMode() === "always" && (fresh || opts.verify) && opts.groundingModel
            ? Promise.all(
                queries.slice(0, 3).map(query => searchGeminiGrounding(query, opts).catch(() => []))
            ).then(all => {
                all.forEach(list => {
                    if (list?.answer) {
                        briefs.push(list.answer);
                    }
                });
                return all.flat();
            })
            : [],
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

    // For current questions, skip clearly old pages when fresher ones exist.
    if (fresh) {
        const recent = candidates.filter(item => {
            const age = ageDays(item);
            return age === null || age <= 400;
        });
        if (recent.length >= 3) {
            candidates = recent;
        }
    }

    status("reading", { count: Math.min(opts.maxPages, candidates.length) });
    let read = 0;
    const sources = await readCandidates(
        candidates,
        Math.max(3, opts.maxPages - 2),
        opts,
        () => {
            read += 1;
            status("reading", { count: read });
        }
    );

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
            const extraPages = await readCandidates(
                extra,
                Math.max(0, opts.maxPages - sources.length),
                opts,
                () => {
                    read += 1;
                    status("reading", { count: read });
                }
            );
            sources.push(...extraPages);
            queries.push(...followUps);
        }
    }

    // Snippet-only fallback when pages could not be read.
    if (!sources.length) {
        candidates.slice(0, 6).forEach(item => {
            if (item.snippet) {
                sources.push({ title: item.title, url: item.url, published: "", snippet: item.snippet, text: item.snippet });
            }
        });
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
    let budget = opts.totalContextChars;
    const blocks = [];
    sources.forEach((item, index) => {
        if (budget <= 400) {
            return;
        }
        const body = item.text.slice(0, Math.min(item.text.length, budget));
        budget -= body.length;
        blocks.push(
            `[${index + 1}] ${item.title}\nURL: ${item.url}` +
            (formatDate(item.published) ? `\nPublished: ${formatDate(item.published)}` : "\nPublished: unknown") +
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
            snippet: String(item.snippet || item.text || "").replace(/\s+/g, " ").trim().slice(0, 220)
        })),
        contextText: (factSheet ? `=== FACT CHECK (cross-checked across sources) ===\n${factSheet}\n\n=== SOURCES ===\n` : "") + blocks.join("\n\n---\n\n"),
        factSheet,
        tookMs: elapsed()
    };
    if (sources.length >= 2) {
        cacheSet(researchKey, result, 10 * 60 * 1000);
    }
    return result;
}

export function buildResearchPrompt(question, research) {
    const today = new Date().toISOString().slice(0, 10);
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
- Do not paste URLs in the text and do not add a separate sources list; the app shows the sources.`;
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
            maxPages: hard ? 7 : 5,
            pageChars: hard ? 4500 : 3500,
            totalContextChars: hard ? 26000 : 16000,
            pageTimeoutMs: 6000,
            searchTimeoutMs: 5000,
            budgetMs: hard ? 30000 : 15000,
            followUpMinRemainingMs: hard ? 9000 : Number.POSITIVE_INFINITY,
            verifyChars: hard ? 22000 : 14000,
            verifyTimeoutMs: hard ? 12000 : 8000,
            news: isNewsQuery(args.question),
            fresh: true,
            ...(args.options || {})
        }
    });
}

export function buildLiveSearchPrompt(question, research) {
    const today = new Date().toISOString().slice(0, 10);
    if (!research?.contextText) {
        return question;
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
- Do not paste URLs and do not add a separate sources list.`;
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
    const today = now.toISOString().slice(0, 10);

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
