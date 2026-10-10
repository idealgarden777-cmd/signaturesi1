/*
=========================================================
NEYO SOURCE READERS
Search can open more than normal web pages:
- PDF files (reports, papers, notices, price lists)
- YouTube videos (Gemini watches the video itself)
- Reddit threads (post + top comments)
- X / Twitter posts (one post at a time, via a public mirror)
Each reader returns { title, published, text, finalUrl, kind }
or null when it could not read the source.
=========================================================
*/

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function env(name) {
    return String(process.env[name] || "").trim();
}

async function timed(url, options = {}, ms = 9000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...(options.headers || {}) }
        });
    } finally {
        clearTimeout(timer);
    }
}

function host(url) {
    try {
        return new URL(url).hostname.replace(/^www\.|^m\.|^old\./, "").toLowerCase();
    } catch {
        return "";
    }
}

/* ---------- what kind of source is this? ---------- */

export function sourceKind(url = "") {
    const h = host(url);
    let path = "";
    try {
        path = new URL(url).pathname;
    } catch {
        return "";
    }
    if (/\.pdf$/i.test(path)) return "pdf";
    if (h === "youtu.be" || ((h === "youtube.com" || h.endsWith(".youtube.com")) && /^\/(watch|shorts\/|live\/)/.test(path))) return "video";
    if ((h === "reddit.com" || h.endsWith(".reddit.com")) && /\/comments\//.test(path)) return "reddit";
    if ((h === "x.com" || h === "twitter.com" || h === "mobile.twitter.com") && /\/status(es)?\/\d+/.test(path)) return "post";
    return "";
}

/* ---------- PDF ---------- */

async function readPdf(url, { pageChars = 6000, maxBytes = 15_000_000, response = null } = {}) {
    try {
        const res = response || await timed(url, { redirect: "follow", headers: { Accept: "application/pdf,*/*" } }, 12000);
        if (!res.ok) return null;
        const length = Number(res.headers.get("content-length") || 0);
        if (length > maxBytes) return null;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > maxBytes || bytes.slice(0, 5).toString() !== "%PDF-") return null;
        // package root runs demo code in pdf-parse v1: import the lib file
        const mod = await import("pdf-parse/lib/pdf-parse.js");
        const parse = mod.default || mod;
        const out = await Promise.race([
            parse(bytes, { max: 40 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("pdf timeout")), 10000))
        ]);
        const text = String(out?.text || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
        if (text.length < 200) return null;
        const info = out?.info || {};
        const raw = String(info.ModDate || info.CreationDate || "");
        const m = raw.match(/D:(\d{4})(\d{2})(\d{2})/);
        return {
            kind: "pdf",
            title: String(info.Title || "").trim() || decodeURIComponent(url.split("/").pop() || "PDF"),
            published: m ? `${m[1]}-${m[2]}-${m[3]}` : "",
            finalUrl: res.url || url,
            text: `[PDF, ${out?.numpages || "?"} pages]\n${text}`.slice(0, pageChars)
        };
    } catch (error) {
        console.warn("[READ_PDF]", error?.message || error);
        return null;
    }
}

/* ---------- YouTube: Gemini watches the video ---------- */

const VIDEO_MODELS = [env("NEYO_VIDEO_MODEL"), "gemini-3.8-flash", "gemini-2.5-flash"].filter(Boolean);

async function readVideo(url, { pageChars = 6000, apiKey = "", focus = "" } = {}) {
    const key = apiKey || env("GEMINI_API_KEY");
    let title = "";
    let author = "";
    try {
        const meta = await timed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {}, 4000);
        if (meta.ok) {
            const data = await meta.json();
            title = data?.title || "";
            author = data?.author_name || "";
        }
    } catch {}
    if (!key) return null;
    const prompt =
        "Watch this video and write notes a researcher can rely on: what it is about, every important claim, number, name, date and step in order with rough timestamps (mm:ss), and the conclusion. " +
        "Quote exact words for key statements. Say the upload date if it is shown or said. Plain text, no markdown tables." +
        (focus ? ` Focus especially on: ${String(focus).slice(0, 200)}.` : "");
    for (const model of VIDEO_MODELS) {
        try {
            const res = await timed(
                `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ role: "user", parts: [{ fileData: { fileUri: url } }, { text: prompt }] }],
                        generationConfig: { maxOutputTokens: 2500, temperature: 0.2, mediaResolution: "MEDIA_RESOLUTION_LOW" }
                    })
                },
                28000
            );
            const data = await res.json().catch(() => ({}));
            const text = (data?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("").trim();
            if (res.ok && text.length > 100) {
                console.log("[READ_VIDEO]", model, text.length);
                return {
                    kind: "video",
                    title: title ? `${title}${author ? ` (YouTube, ${author})` : " (YouTube)"}` : "YouTube video",
                    published: "",
                    finalUrl: url,
                    text: `[Video notes made by watching the video]\n${text}`.slice(0, pageChars)
                };
            }
            console.warn("[READ_VIDEO] no notes from", model, res.status);
        } catch (error) {
            console.warn("[READ_VIDEO]", model, error?.message || error);
        }
    }
    return null;
}

/* ---------- Reddit thread ---------- */

function unescapeXml(text = "") {
    return String(text)
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

// Reddit often blocks the JSON API for cloud servers; the RSS feed
// of the same thread sometimes still works.
async function readRedditRss(clean, pageChars) {
    try {
        const res = await timed(`${clean}/.rss?limit=30`, { headers: { Accept: "application/atom+xml,text/xml" } }, 7000);
        if (!res.ok) return null;
        const xml = await res.text();
        const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
            const body = m[1];
            const title = unescapeXml((body.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
            const author = unescapeXml((body.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || "");
            const updated = (body.match(/<updated>([^<]+)<\/updated>/) || [])[1] || "";
            const content = unescapeXml((body.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || "")
                .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            return { title, author, updated, content };
        });
        if (!entries.length) return null;
        const [post, ...comments] = entries;
        return {
            kind: "reddit",
            title: post.title,
            published: post.updated.slice(0, 10),
            finalUrl: clean,
            text: `${post.title} (by ${post.author})\n${post.content.slice(0, 2500)}\n\nComments:\n${comments.slice(0, 25).map(c => `- ${c.author}: ${c.content.slice(0, 500)}`).join("\n")}`.slice(0, pageChars)
        };
    } catch {
        return null;
    }
}

async function readReddit(url, { pageChars = 6000 } = {}) {
    const clean = url.split("?")[0].replace(/\/$/, "");
    try {
        const res = await timed(`${clean}.json?limit=40&sort=top&raw_json=1`, { headers: { Accept: "application/json" } }, 8000);
        if (!res.ok) return readRedditRss(clean, pageChars);
        const data = await res.json();
        const post = data?.[0]?.data?.children?.[0]?.data;
        if (!post) return null;
        const comments = (data?.[1]?.data?.children || [])
            .map(item => item?.data)
            .filter(c => c?.body && c.body !== "[deleted]" && c.body !== "[removed]")
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 25)
            .map(c => `- (${c.score} points) ${String(c.body).replace(/\s+/g, " ").slice(0, 600)}`);
        const text =
            `r/${post.subreddit} post by u/${post.author}, ${post.score} points, ${post.num_comments} comments\n` +
            `${post.title}\n${String(post.selftext || post.url || "").slice(0, 2500)}\n\nTop comments:\n${comments.join("\n")}`;
        return {
            kind: "reddit",
            title: `${post.title} (r/${post.subreddit})`,
            published: post.created_utc ? new Date(post.created_utc * 1000).toISOString().slice(0, 10) : "",
            finalUrl: url,
            text: text.slice(0, pageChars)
        };
    } catch {
        return null;
    }
}

/* ---------- one X / Twitter post ---------- */

async function readPost(url, { pageChars = 6000 } = {}) {
    try {
        const m = new URL(url).pathname.match(/^\/([^/]+)\/status(?:es)?\/(\d+)/);
        if (!m) return null;
        const res = await timed(`https://api.fxtwitter.com/${m[1]}/status/${m[2]}`, { headers: { Accept: "application/json" } }, 7000);
        if (!res.ok) return null;
        const tweet = (await res.json())?.tweet;
        if (!tweet?.text) return null;
        const quote = tweet.quote?.text ? `\nQuoting @${tweet.quote.author?.screen_name}: ${tweet.quote.text}` : "";
        const text =
            `@${tweet.author?.screen_name} (${tweet.author?.name}) posted:\n${tweet.text}${quote}\n` +
            `Likes ${tweet.likes ?? "?"}, reposts ${tweet.retweets ?? "?"}, replies ${tweet.replies ?? "?"}, views ${tweet.views ?? "?"}`;
        return {
            kind: "post",
            title: `Post by @${tweet.author?.screen_name} on X`,
            published: tweet.created_at ? new Date(tweet.created_at).toISOString().slice(0, 10) : "",
            finalUrl: url,
            text: text.slice(0, pageChars)
        };
    } catch {
        return null;
    }
}

/* ---------- entry point ---------- */

/**
 * Read a special source. Returns undefined when the url is a
 * normal web page (the caller reads it the usual way).
 * opts.special = { pdf: n, video: n } limits slow readers per search.
 */
export async function readSpecialSource(url, opts = {}) {
    const kind = sourceKind(url);
    if (!kind) return undefined;
    const left = opts.special;
    if (left && (kind === "pdf" || kind === "video")) {
        if ((left[kind] || 0) <= 0) return null;
        left[kind] -= 1;
    }
    if (kind === "pdf") return readPdf(url, opts);
    if (kind === "video") return readVideo(url, opts);
    if (kind === "reddit") return readReddit(url, opts);
    if (kind === "post") return readPost(url, opts);
    return undefined;
}

/* a page that turned out to be a PDF after the request */
export async function readPdfResponse(url, response, opts = {}) {
    const left = opts.special;
    if (left) {
        if ((left.pdf || 0) <= 0) return null;
        left.pdf -= 1;
    }
    return readPdf(url, { ...opts, response });
}
