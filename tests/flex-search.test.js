import "./helpers/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { planSearchCalls } from "../lib/agent-tools.js";
import { extractFromPage } from "../lib/web-extract.js";
import { searchPastResearch, memoryTerms } from "../lib/search-memory.js";
import { searchStyleNote, buildLiveSearchPrompt } from "../lib/deep-research.js";

test("flex search: planner calls become one research with the right depth", () => {
    const quick = planSearchCalls([{ args: { query: "PSX index today" } }]);
    assert.deepEqual(quick.modes, ["quick"]);
    assert.equal(quick.options.hard, false);

    const deep = planSearchCalls([
        { args: { query: "EV cars Pakistan 2026", mode: "deep" } },
        { args: { query: "EV tax policy", mode: "news", freshness: "week", site: "https://www.dawn.com/news" } }
    ]);
    assert.deepEqual(deep.modes.sort(), ["deep", "news"]);
    assert.equal(deep.options.hard, true);
    assert.equal(deep.options.news, true);
    assert.equal(deep.options.maxAgeDays, 8);
    assert.equal(deep.options.maxPages, 12);
    assert.ok(deep.queries.includes("site:www.dawn.com EV tax policy"));
    assert.ok(deep.budgetMs >= 40000);

    const discover = planSearchCalls([{ args: { query: "AI tools for students", mode: "discover" } }]);
    assert.deepEqual(discover.modes, ["discover"]);
    assert.equal(discover.options.snippetSources, 14);

    const badSite = planSearchCalls([{ args: { query: "x y", site: "not a site" } }]);
    assert.deepEqual(badSite.queries, ["x y"]);
});

test("live extraction: focus keeps matching parts, tables and lists", () => {
    const filler = "Unrelated history text about the company and its founders. ".repeat(30);
    const text = `## About\n${filler}\n## Price and specs\n- Price: Rs 189,999\n- RAM: 16 GB\n## Fixtures\nDate | Team | Venue\n12 Oct | PAK v ENG | Lahore\n## More\n${filler}`;
    const focused = extractFromPage({ text }, { focus: "price specs", maxChars: 400 });
    assert.match(focused.content, /Rs 189,999/);
    assert.doesNotMatch(focused.content, /founders/);
    const tables = extractFromPage({ text }, { format: "tables" });
    assert.match(tables.content, /PAK v ENG/);
    assert.doesNotMatch(tables.content, /RAM/);
    const list = extractFromPage({ text }, { format: "list" });
    assert.equal(list.content.split("\n").length, 2);
    const links = extractFromPage({ text, links: [{ text: "Home", url: "https://a.com" }] }, { format: "links" });
    assert.equal(links.content[0].url, "https://a.com");
});

function fakeSupabase(tables) {
    const calls = [];
    return {
        calls,
        from(table) {
            const query = { table, filters: [] };
            const builder = {
                select() { return builder; },
                eq(column, value) { query.filters.push(["eq", column, value]); return builder; },
                in(column, value) { query.filters.push(["in", column, value]); return builder; },
                or(value) { query.filters.push(["or", value]); return builder; },
                order() { return builder; },
                limit() { return builder; },
                then(resolve) {
                    calls.push(query);
                    let rows = tables[table] || [];
                    query.filters.forEach(([kind, column, value]) => {
                        if (kind === "eq") rows = rows.filter(row => row[column] === value);
                        if (kind === "in") rows = rows.filter(row => value.includes(row[column]));
                    });
                    resolve({ data: rows, error: null });
                }
            };
            return builder;
        }
    };
}

test("search memory: finds the user's own earlier research only", async () => {
    const supabase = fakeSupabase({
        chat_conversations: [
            { id: "c1", user_id: "u1", title: "Laptop research" },
            { id: "c2", user_id: "u2", title: "Someone else" }
        ],
        chat_messages: [
            { conversation_id: "c1", role: "assistant", content: "Best laptops under 200k: Lenovo LOQ at Rs 189,999 ...", sources: [{ title: "PriceOye", url: "https://priceoye.pk/x" }], created_at: "2026-09-30T10:00:00Z" },
            { conversation_id: "c2", role: "assistant", content: "Laptops under 200k for another user", sources: [], created_at: "2026-09-29T10:00:00Z" },
            { conversation_id: "c1", role: "assistant", content: "Weather in Lahore", sources: [], created_at: "2026-09-28T10:00:00Z" }
        ]
    });
    const result = await searchPastResearch({ supabase, userId: "u1", query: "pichli baar laptop under 200k" });
    assert.equal(result.found, 1);
    assert.equal(result.results[0].date, "2026-09-30");
    assert.match(result.results[0].answer, /Lenovo LOQ/);
    assert.equal(result.results[0].sources[0].url, "https://priceoye.pk/x");
    const orFilter = supabase.calls.find(call => call.table === "chat_messages").filters.find(([kind]) => kind === "or")[1];
    assert.match(orFilter, /^[a-z0-9.,%]+$/i, "filter has only safe characters");

    assert.deepEqual(memoryTerms("pichli baar kya dekha tha?"), []);
    const none = await searchPastResearch({ supabase: null, userId: "u1", query: "x" });
    assert.equal(none.found, 0);
});

test("flexible answers: the search mode shapes the answer", () => {
    assert.equal(searchStyleNote([]), "");
    const note = searchStyleNote(["discover", "memory"], ["Kaunsa sasta hai?"]);
    assert.match(note, /DISCOVER/);
    assert.match(note, /EARLIER CHATS/);
    assert.match(note, /Kaunsa sasta hai\?/);
    const prompt = buildLiveSearchPrompt("q", { contextText: "[1] x", sources: [{ url: "a" }, { url: "b" }, { url: "c" }], styles: ["news"] });
    assert.match(prompt, /NEWS: newest first/);
});
