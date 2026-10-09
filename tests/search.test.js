import "./helpers/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { __setRateDb } from "../lib/guard.js";
import {
    runDeepResearch,
    buildLiveSearchPrompt,
    keyedEngines,
    takeGroundingSlot,
    WEAK_SEARCH_NOTE
} from "../lib/deep-research.js";

// No shared limiter in tests: memory counter is used.
__setRateDb({ rpc: async () => ({ error: { code: "PGRST202", message: "missing" } }) });

const PAGE = n => `<html><head><title>AI model news ${n}</title>
<meta property="article:published_time" content="${new Date(Date.now() - 864e5).toISOString()}"></head>
<body><article><h1>AI model news ${n}</h1><p>${"Company announced a new AI model this week with details about its release and availability. ".repeat(8)}</p></article></body></html>`;

function withFetch(handler, fn) {
    const real = globalThis.fetch;
    globalThis.fetch = async (url, options) => handler(String(url), options);
    return Promise.resolve(fn()).finally(() => {
        globalThis.fetch = real;
    });
}

const html = body => new Response(body, { status: 200, headers: { "content-type": "text/html" } });

test("search: keyed search APIs join only when their key is set", () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.SERPER_API_KEY;
    assert.deepEqual(keyedEngines().map(([name]) => name), []);
    process.env.TAVILY_API_KEY = "tvly-test";
    assert.deepEqual(keyedEngines().map(([name]) => name), ["tavily"]);
    delete process.env.TAVILY_API_KEY;
});

test("search: Google grounding has a daily cap", async () => {
    process.env.NEYO_GROUNDING_DAILY_CAP = "2";
    const results = [await takeGroundingSlot(), await takeGroundingSlot(), await takeGroundingSlot()];
    assert.deepEqual(results, [true, true, false]);
    process.env.NEYO_GROUNDING_DAILY_CAP = "0";
    assert.equal(await takeGroundingSlot(), false);
    delete process.env.NEYO_GROUNDING_DAILY_CAP;
    delete process.env.NEYO_GOOGLE_GROUNDING;
});

test("search: no results -> the model is told its knowledge may be old", () => {
    const prompt = buildLiveSearchPrompt("top 10 AI models compare karo", null);
    assert.ok(prompt.includes(WEAK_SEARCH_NOTE));
    assert.match(WEAK_SEARCH_NOTE, /could not check live sources/);
    const thin = buildLiveSearchPrompt("q", { contextText: "[1] x", sources: [{ url: "a" }, { url: "b", partial: true }] });
    assert.match(thin, /Only 1 full page/);
    const rich = buildLiveSearchPrompt("q", { contextText: "[1] x", sources: [{ url: "a" }, { url: "b" }, { url: "c" }] });
    assert.doesNotMatch(rich, /full page\(s\) could be read/);
});

test("search: blocked scrapers -> one Google grounding call, its pages are read", async () => {
    process.env.NEYO_GROUNDING_DAILY_CAP = "50";
    process.env.NEYO_GOOGLE_GROUNDING = "fallback";
    let groundingCalls = 0;
    await withFetch(async url => {
        if (url.includes("generativelanguage.googleapis.com")) {
            groundingCalls += 1;
            return new Response(JSON.stringify({
                candidates: [{
                    content: { parts: [{ text: "- Model X released Oct 2026 (site-a.com)" }] },
                    groundingMetadata: {
                        groundingChunks: [1, 2, 3, 4].map(n => ({ web: { uri: `https://93.184.215.${n}/story-${n}`, title: `site-${n}.com` } }))
                    }
                }]
            }), { status: 200, headers: { "content-type": "application/json" } });
        }
        const page = url.match(/93\.184\.215\.(\d)\/story/);
        if (page) {
            return html(PAGE(page[1]));
        }
        // every free engine is blocked
        return new Response("blocked", { status: 403 });
    }, async () => {
        const research = await runDeepResearch({
            question: "latest AI models October 2026",
            apiKey: "k",
            plannerModel: "",
            groundingModel: "gemini-2.5-flash-lite",
            options: { queries: ["latest AI models October 2026"], fresh: true, verify: false, budgetMs: 20000, followUpMinRemainingMs: Infinity }
        });
        assert.equal(groundingCalls, 1);
        assert.ok(research.sources.filter(item => !item.partial).length >= 3, "grounded pages were read");
        assert.match(research.contextText, /Google Search summary|site-1\.com|AI model news/);
    });
    delete process.env.NEYO_GROUNDING_DAILY_CAP;
});

test("search: grounding off by default -> never called", async () => {
    delete process.env.NEYO_GOOGLE_GROUNDING;
    let groundingCalls = 0;
    await withFetch(async url => {
        if (url.includes("generativelanguage.googleapis.com")) {
            groundingCalls += 1;
        }
        return new Response("blocked", { status: 403 });
    }, async () => {
        const research = await runDeepResearch({
            question: "latest phones October 2026 off-test",
            apiKey: "k",
            groundingModel: "gemini-2.5-flash-lite",
            options: { queries: ["latest phones October 2026 off-test"], fresh: true, verify: false, budgetMs: 15000, followUpMinRemainingMs: Infinity }
        });
        assert.equal(research.sources.length, 0);
    });
    assert.equal(groundingCalls, 0);
    delete process.env.NEYO_GOOGLE_GROUNDING;
});

test("search: snippets of unread results are added (marked partial)", async () => {
    const rss = n => `<rss><channel>${Array.from({ length: n }, (_, i) => `<item><title>Gadget launch review ${i}</title><link>https://93.184.216.${i + 1}/p${i}</link><description>Gadget launch review number ${i} with the full specs, price and release date for buyers this month.</description></item>`).join("")}</channel></rss>`;
    await withFetch(async url => {
        if (url.includes("bing.com/search?format=rss")) {
            return new Response(rss(9), { status: 200, headers: { "content-type": "application/rss+xml" } });
        }
        const one = url.match(/93\.184\.216\.(1|2)\/p/);
        if (one) {
            return html(PAGE(one[1]));
        }
        return new Response("no", { status: 404 });
    }, async () => {
        process.env.NEYO_GOOGLE_GROUNDING = "off";
        const research = await runDeepResearch({
            question: "gadget launch review",
            apiKey: "",
            options: { queries: ["gadget launch review"], verify: false, maxPages: 4, snippetSources: 5, budgetMs: 15000, followUpMinRemainingMs: Infinity }
        });
        delete process.env.NEYO_GOOGLE_GROUNDING;
        const full = research.sources.filter(item => !item.partial);
        const partial = research.sources.filter(item => item.partial);
        assert.equal(full.length, 2);
        assert.ok(partial.length >= 3, `snippets added: ${partial.length}`);
        assert.match(research.contextText, /search snippet only/);
    });
});
