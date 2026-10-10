import test from "node:test";
import assert from "node:assert/strict";
import {
    ddgLink, parseDdgLite, parseDdgHtml, parseDdgNews, parseDdgInstant, parseVqd,
    ddgFreshness, ddgRegion, isDdgBlocked, ddgWeb, ddgNews, _resetDdg
} from "../lib/ddg.js";

const LITE = `<table>
<tr><td valign="top">1.&nbsp;</td><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.espn.com%2Fcricket%2Fteam&amp;rut=abc" class='result-link'>Pakistan Cricket &amp; News - ESPN</a></td></tr>
<tr><td>&nbsp;</td><td class='result-snippet'>Read about <b>Pakistan</b> Cricket latest scores.</td></tr>
<tr><td>&nbsp;</td><td><span class='link-text'>www.espn.com/cricket/team</span><span class='timestamp'>2026-10-10T12:06:00.0000000</span></td></tr>
<tr><td valign="top">2.&nbsp;</td><td><a rel="nofollow" href="https://duckduckgo.com/y.js?ad_domain=x.com" class='result-link'>Ad</a></td></tr>
<tr><td valign="top">3.&nbsp;</td><td><a rel="nofollow" class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgulfnews.com%2Fsport">Maaz Sadaqat</a></td></tr>
<tr><td>&nbsp;</td><td class='result-snippet'>Pakistan beat Sri Lanka</td></tr>
</table>`;

test("ddg lite parser: links, snippets, dates, skips ads", () => {
    const list = parseDdgLite(LITE);
    assert.equal(list.length, 2);
    assert.equal(list[0].url, "https://www.espn.com/cricket/team");
    assert.equal(list[0].title, "Pakistan Cricket & News - ESPN");
    assert.match(list[0].snippet, /Pakistan Cricket latest/);
    assert.equal(list[0].published, "2026-10-10T12:06:00Z");
    assert.equal(list[1].url, "https://gulfnews.com/sport");
    assert.equal(list[1].published, "");
});

test("ddg html parser", () => {
    const html = `<div class="result results_links results_links_deep web-result"><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Example <b>A</b></a></h2><a class="result__snippet" href="#">Snippet text</a><span>2026-10-09T00:00:00</span></div>`;
    const list = parseDdgHtml(html);
    assert.deepEqual(list, [{ title: "Example A", url: "https://example.com/a", snippet: "Snippet text", published: "2026-10-09T00:00:00Z" }]);
});

test("ddg link decode", () => {
    assert.equal(ddgLink("//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com%2Fx%3Fy%3D1&rut=1"), "https://a.com/x?y=1");
    assert.equal(ddgLink("https://b.com/p"), "https://b.com/p");
    assert.equal(ddgLink("/html/?q=next"), "");
});

test("ddg news + instant + vqd parsers", () => {
    const news = parseDdgNews({ results: [{ title: "T &amp; U", url: "https://n.com/1", excerpt: "<b>x</b>", source: "Dawn", date: 1760000000 }] });
    assert.equal(news[0].title, "T & U");
    assert.equal(news[0].outlet, "Dawn");
    assert.equal(news[0].published, new Date(1760000000 * 1000).toISOString());
    assert.equal(parseVqd(`<script>vqd="4-123456789012345678901234567890"; </script>`), "4-123456789012345678901234567890");
    assert.equal(parseVqd(`nrj('/d.js?q=x&vqd=4-99887766&kl=wt-wt')`), "4-99887766");
    const ia = parseDdgInstant({ Heading: "K2", AbstractText: "K2 is the second-highest mountain.", AbstractSource: "Wikipedia", AbstractURL: "https://en.wikipedia.org/wiki/K2", Infobox: { content: [{ label: "Elevation", value: "8,611 m" }] } });
    assert.equal(ia.heading, "K2");
    assert.match(ia.text, /second-highest/);
    assert.match(ia.text, /Elevation: 8,611 m/);
    assert.equal(parseDdgInstant({ Heading: "", AbstractText: "" }), null);
});

test("ddg freshness and region", () => {
    assert.equal(ddgFreshness("aaj ka gold rate"), "d");
    assert.equal(ddgFreshness("pakistan ki latest khabar"), "w");
    assert.equal(ddgFreshness("new iphone launched"), "m");
    assert.equal(ddgFreshness("how does photosynthesis work"), "");
    assert.equal(ddgFreshness("anything", 3), "w");
    assert.equal(ddgFreshness("anything", 200), "y");
    assert.equal(ddgRegion(true), "pk-en");
    assert.equal(ddgRegion(false), "wt-wt");
    assert.equal(isDdgBlocked(202, ""), true);
    assert.equal(isDdgBlocked(200, "<div class='anomaly-modal'>"), true);
    assert.equal(isDdgBlocked(200, "<html>ok</html>"), false);
});

function fakeFetch(routes) {
    const calls = [];
    const fn = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        for (const [pattern, reply] of routes) {
            if (pattern.test(String(url))) {
                const r = typeof reply === "function" ? reply(String(url), init) : reply;
                return new Response(r.body, { status: r.status || 200 });
            }
        }
        return new Response("", { status: 404 });
    };
    fn.calls = calls;
    return fn;
}

test("ddgWeb: fresh filter tops up from unfiltered search; html backup when lite blocked", async () => {
    _resetDdg();
    const fetchFn = fakeFetch([[/lite\.duckduckgo\.com/, url => ({ body: /df=d/.test(url) ? LITE : LITE.replace(/espn/g, "other") })]]);
    const list = await ddgWeb("pakistan cricket", { df: "d", fetchFn });
    assert.ok(fetchFn.calls.some(c => /df=d/.test(c.url)));
    assert.ok(fetchFn.calls.some(c => !/df=/.test(c.url)));
    assert.equal(list[0].url, "https://www.espn.com/cricket/team");
    assert.ok(list.some(item => item.url.includes("other.com")));

    _resetDdg();
    const html = `<div class="result results_links"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fh.com%2F">H</a><a class="result__snippet">s</a></div>`;
    const fetch2 = fakeFetch([
        [/lite\.duckduckgo\.com/, { status: 202, body: "" }],
        [/html\.duckduckgo\.com/, { body: html }]
    ]);
    const list2 = await ddgWeb("x", { fetchFn: fetch2 });
    assert.equal(list2[0].url, "https://h.com/");
    // lite now rests: the next search goes straight to html
    await ddgWeb("y", { fetchFn: fetch2 });
    assert.equal(fetch2.calls.filter(c => /lite/.test(c.url)).length, 1);
});

test("ddgWeb throws a 429 when both pages are blocked", async () => {
    _resetDdg();
    const fetchFn = fakeFetch([[/duckduckgo\.com/, { status: 200, body: "Unfortunately, bots use DuckDuckGo too" }]]);
    await assert.rejects(ddgWeb("x", { fetchFn }), error => error.status === 429);
});

test("ddgNews: vqd then news.js, newest first", async () => {
    _resetDdg();
    const fetchFn = fakeFetch([
        [/news\.js/, { body: JSON.stringify({ results: [
            { title: "Old", url: "https://a.com/o", date: 1700000000, source: "A" },
            { title: "New", url: "https://a.com/n", date: 1760000000, source: "B" }
        ] }) }],
        [/duckduckgo\.com\/\?/, { body: `vqd="4-1234567890"` }]
    ]);
    const list = await ddgNews("pakistan", { df: "w", fetchFn });
    assert.deepEqual(list.map(i => i.title), ["New", "Old"]);
    const newsCall = fetchFn.calls.find(c => /news\.js/.test(c.url));
    assert.match(newsCall.url, /vqd=4-1234567890/);
    assert.match(newsCall.url, /df=w/);
});
