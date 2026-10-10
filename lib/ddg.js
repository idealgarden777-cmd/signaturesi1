/*
=========================================================
NEYO — DuckDuckGo engine (free, no key)
- ddgWeb     : web results (lite page first, html page backup),
               with freshness filter df = d | w | m | y and region
- ddgNews    : fresh news with real dates (news.js + vqd token)
- ddgInstant : DuckDuckGo's official Instant Answer API (facts)
- ddgFreshness / ddgRegion : pick the filter from the question
Each page backs off on its own when DuckDuckGo shows a bot check,
so one blocked page never stops the others.
=========================================================
*/

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'", "#x2F": "/" };

function decode(text = "") {
    return String(text)
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&([a-z0-9#]+);/gi, (m, name) => ENTITIES[name] ?? m);
}

function strip(html = "") {
    return decode(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// DuckDuckGo wraps links as //duckduckgo.com/l/?uddg=<real url>
export function ddgLink(href = "") {
    const raw = decode(href).trim();
    try {
        const url = new URL(raw, "https://duckduckgo.com");
        const target = url.searchParams.get("uddg");
        if (target) {
            return target;
        }
        if (url.hostname.endsWith("duckduckgo.com")) {
            return "";
        }
        return url.toString();
    } catch {
        return "";
    }
}

const ISO_DATE = /(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/;

function isAd(href = "") {
    return /duckduckgo\.com\/y\.js|ad_domain=|ad_provider=/.test(href);
}

// lite.duckduckgo.com/lite: one table, rows of link / snippet / url+date.
export function parseDdgLite(html = "") {
    const anchors = [...String(html).matchAll(/<a\b([^>]*class=['"]result-link['"][^>]*)>([\s\S]*?)<\/a>/gi)];
    const results = [];
    anchors.forEach((match, index) => {
        const href = (match[1].match(/href=['"]([^'"]+)['"]/i) || [])[1] || "";
        if (isAd(href)) {
            return;
        }
        const url = ddgLink(href);
        if (!url) {
            return;
        }
        const end = index + 1 < anchors.length ? anchors[index + 1].index : html.length;
        const block = html.slice(match.index, end);
        const snippet = (block.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i) || [])[1] || "";
        const date = (block.match(ISO_DATE) || [])[1] || "";
        results.push({ title: strip(match[2]), url, snippet: strip(snippet), published: date ? `${date}Z` : "" });
    });
    return results;
}

// html.duckduckgo.com/html: div.result blocks.
export function parseDdgHtml(html = "") {
    const results = [];
    const blocks = String(html).split(/class="result results_links/).slice(1);
    for (const block of blocks) {
        if (/result--ad/.test(block.slice(0, 200))) {
            continue;
        }
        const link = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!link || isAd(link[1])) {
            continue;
        }
        const url = ddgLink(link[1]);
        if (!url) {
            continue;
        }
        const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(a|div|td)>/);
        const date = (block.match(ISO_DATE) || [])[1] || "";
        results.push({ title: strip(link[2]), url, snippet: strip(snippet?.[1] || ""), published: date ? `${date}Z` : "" });
    }
    return results;
}

export function isDdgBlocked(status, html = "") {
    return (
        status === 202 || status === 403 || status === 429 ||
        /anomaly-modal|bots use DuckDuckGo too|challenge-form|Unfortunately, bots/i.test(String(html).slice(0, 20000))
    );
}

/* ---------- freshness and region ---------- */

const DAY = /\b(today|tonight|right now|live|breaking|yesterday|abhi|abi|aaj|aj|kal|filhal|score|scores|weather|mausam|mosam|temperature|forecast|price|prices|rate|rates|qeemat|keemat|dollar|gold|sona|petrol|diesel|bitcoin|btc|crypto|stock|psx|exchange rate)\b/i;
const WEEK = /\b(news|headlines?|latest|khabar|khabr|khabrein|khabren|taza|this week|is hafte|is hafta|recent|recently|update|updates|match|result|results|election|announced?)\b/i;
const MONTH = /\b(this month|is mahine|is maheene|new|newest|released?|launch(ed)?|current)\b/i;

export function ddgFreshness(text = "", maxAgeDays = 0) {
    const days = Number(maxAgeDays) || 0;
    if (days > 0) {
        return days <= 1 ? "d" : days <= 7 ? "w" : days <= 31 ? "m" : "y";
    }
    const value = String(text || "");
    if (DAY.test(value)) {
        return "d";
    }
    if (WEEK.test(value)) {
        return "w";
    }
    if (MONTH.test(value)) {
        return "m";
    }
    return "";
}

export function ddgRegion(pakistani = false) {
    return pakistani ? "pk-en" : "wt-wt";
}

/* ---------- network ---------- */

const restUntil = new Map(); // endpoint -> time

function resting(name) {
    return (restUntil.get(name) || 0) > Date.now();
}

function rest(name, ms) {
    restUntil.set(name, Date.now() + ms);
}

async function get(url, options = {}, timeoutMs = 6000, fetchFn = fetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetchFn(url, {
            ...options,
            signal: controller.signal,
            headers: {
                "User-Agent": UA,
                "Accept-Language": "en-US,en;q=0.9",
                Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
                ...(options.headers || {})
            }
        });
    } finally {
        clearTimeout(timer);
    }
}

function blockedError() {
    const error = new Error("duckduckgo blocked");
    error.status = 429;
    return error;
}

async function liteOnce(query, { df = "", region = "wt-wt", timeoutMs = 6000, fetchFn } = {}) {
    if (resting("lite")) {
        return null;
    }
    const params = new URLSearchParams({ q: query, kl: region });
    if (df) {
        params.set("df", df);
    }
    const response = await get(`https://lite.duckduckgo.com/lite/?${params}`, {}, timeoutMs, fetchFn);
    const html = await response.text();
    if (isDdgBlocked(response.status, html)) {
        rest("lite", 5 * 60 * 1000);
        return null;
    }
    return response.ok ? parseDdgLite(html) : null;
}

async function htmlOnce(query, { df = "", region = "wt-wt", timeoutMs = 6000, fetchFn } = {}) {
    if (resting("html")) {
        return null;
    }
    const params = new URLSearchParams({ q: query, kl: region });
    if (df) {
        params.set("df", df);
    }
    const response = await get(
        "https://html.duckduckgo.com/html/",
        { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() },
        timeoutMs,
        fetchFn
    );
    const html = await response.text();
    if (isDdgBlocked(response.status, html)) {
        rest("html", 5 * 60 * 1000);
        return null;
    }
    return response.ok ? parseDdgHtml(html) : null;
}

async function webOnce(query, opts) {
    const lite = await liteOnce(query, opts).catch(() => null);
    if (lite && lite.length) {
        return lite;
    }
    const html = await htmlOnce(query, opts).catch(() => null);
    if (html) {
        return html;
    }
    if (lite) {
        return lite;
    }
    if (resting("lite") && resting("html")) {
        throw blockedError();
    }
    return [];
}

// Web results. With a freshness filter, a thin result set is topped up
// from an unfiltered search so fresh pages come first but nothing is lost.
export async function ddgWeb(query, opts = {}) {
    const first = await webOnce(query, opts);
    if (!opts.df || first.length >= 4) {
        return first;
    }
    const more = await webOnce(query, { ...opts, df: "" }).catch(() => []);
    const seen = new Set(first.map(item => item.url));
    return [...first, ...more.filter(item => !seen.has(item.url))];
}

const vqdCache = new Map();

export function parseVqd(html = "") {
    return (
        (String(html).match(/vqd=["']?(\d-[\d-]+)["'&]/) || [])[1] ||
        (String(html).match(/"vqd"\s*:\s*"(\d-[\d-]+)"/) || [])[1] ||
        ""
    );
}

async function vqdFor(query, { region, timeoutMs, fetchFn }) {
    const key = `${region}|${query.toLowerCase()}`;
    const hit = vqdCache.get(key);
    if (hit && hit.expires > Date.now()) {
        return hit.value;
    }
    if (vqdPending.has(key)) {
        return vqdPending.get(key);
    }
    const pending = fetchVqd(query, key, { region, timeoutMs, fetchFn }).finally(() => vqdPending.delete(key));
    vqdPending.set(key, pending);
    return pending;
}

const vqdPending = new Map();

async function fetchVqd(query, key, { region, timeoutMs, fetchFn }) {
    const params = new URLSearchParams({ q: query, ia: "news", iar: "news", kl: region });
    const response = await get(`https://duckduckgo.com/?${params}`, {}, timeoutMs, fetchFn);
    const html = await response.text();
    if (isDdgBlocked(response.status, html)) {
        rest("news", 5 * 60 * 1000);
        return "";
    }
    const value = parseVqd(html);
    if (value) {
        if (vqdCache.size > 200) {
            vqdCache.delete(vqdCache.keys().next().value);
        }
        vqdCache.set(key, { value, expires: Date.now() + 10 * 60 * 1000 });
    }
    return value;
}

export function parseDdgNews(data) {
    return (data?.results || [])
        .filter(item => item && item.url && item.title)
        .map(item => ({
            title: strip(item.title),
            url: item.url,
            snippet: strip(item.excerpt || ""),
            outlet: item.source || "",
            published: Number(item.date) ? new Date(Number(item.date) * 1000).toISOString() : ""
        }));
}

export async function ddgNews(query, { df = "", region = "wt-wt", timeoutMs = 6000, fetchFn } = {}) {
    if (resting("news")) {
        throw blockedError();
    }
    const vqd = await vqdFor(query, { region, timeoutMs, fetchFn });
    if (!vqd) {
        return [];
    }
    const params = new URLSearchParams({ l: region, o: "json", noamp: "1", q: query, vqd, p: "-1" });
    if (df) {
        params.set("df", df);
    }
    const response = await get(
        `https://duckduckgo.com/news.js?${params}`,
        { headers: { Referer: "https://duckduckgo.com/", Accept: "application/json" } },
        timeoutMs,
        fetchFn
    );
    if (isDdgBlocked(response.status)) {
        rest("news", 5 * 60 * 1000);
        throw blockedError();
    }
    if (!response.ok) {
        return [];
    }
    const data = await response.json().catch(() => null);
    return parseDdgNews(data).sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
}

export function parseDdgInstant(data) {
    if (!data || typeof data !== "object") {
        return null;
    }
    const facts = (data.Infobox?.content || [])
        .filter(item => item && item.label && typeof item.value === "string" && item.value.length < 120)
        .slice(0, 8)
        .map(item => `${item.label}: ${item.value}`);
    const text = [data.Answer, data.AbstractText, data.Definition]
        .map(value => (typeof value === "string" ? strip(value) : ""))
        .filter(Boolean)
        .join("\n");
    if (!text && !facts.length) {
        return null;
    }
    return {
        heading: data.Heading || "",
        text: [text, facts.join("\n")].filter(Boolean).join("\n"),
        source: data.AbstractSource || (data.Answer ? "DuckDuckGo" : ""),
        url: data.AbstractURL || data.DefinitionURL || ""
    };
}

// Official free API: short facts only (Wikipedia box, answers, definitions).
export async function ddgInstant(query, { timeoutMs = 4000, fetchFn } = {}) {
    const params = new URLSearchParams({ q: query, format: "json", no_html: "1", skip_disambig: "1", t: "neyo" });
    const response = await get(`https://api.duckduckgo.com/?${params}`, { headers: { Accept: "application/json" } }, timeoutMs, fetchFn);
    if (!response.ok) {
        return null;
    }
    return parseDdgInstant(await response.json().catch(() => null));
}

export function _resetDdg() {
    restUntil.clear();
    vqdCache.clear();
}
