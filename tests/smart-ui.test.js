import test from "node:test";
import assert from "node:assert/strict";
import {
    evaluateFormula,
    repairPartialJson,
    normalizeCard,
    walkBlocks,
    parseCardSource,
    computeOutputs,
    cardToText,
    niceScale
} from "../public/js/components/smart-ui-core.js";
import { SMART_UI_RULE } from "../lib/smart-ui.js";

test("formula: maths, precedence and functions", () => {
    assert.equal(evaluateFormula("2+3*4"), 14);
    assert.equal(evaluateFormula("(2+3)*4"), 20);
    assert.equal(evaluateFormula("2^3^2"), 512);
    assert.equal(evaluateFormula("-x+10", { x: 4 }), 6);
    assert.equal(evaluateFormula("round(p*0.125, 2)", { p: 5 }), 0.63);
    assert.equal(evaluateFormula("max(a,b)-min(a,b)", { a: 3, b: 9 }), 6);
    assert.equal(evaluateFormula("1e3/4"), 250);
});

test("formula: refuses anything that is not maths", () => {
    for (const bad of [
        "alert(1)",
        "constructor",
        "x.constructor",
        "this",
        "a;b",
        "`x`",
        "process",
        "__proto__",
        "Math.random()",
        "(1+2",
        "1 2"
    ]) {
        assert.throws(() => evaluateFormula(bad, { x: 1 }), `should reject ${bad}`);
    }
    assert.throws(() => evaluateFormula("1+".repeat(200) + "1"));
});

test("partial JSON from a stream can be shown early", () => {
    const full = '{"type":"checklist","title":"Plan","items":[{"title":"Buy rice"},{"title":"Cook it","text":"30 min"}]}';
    for (let cut = 30; cut < full.length; cut += 7) {
        const value = repairPartialJson(full.slice(0, cut));
        assert.ok(value === null || typeof value === "object", `cut ${cut}`);
    }
    const early = parseCardSource(full.slice(0, 70), { complete: false });
    assert.equal(early.card?.type, "checklist");
    assert.equal(early.card.items[0].title, "Buy rice");
    assert.equal(repairPartialJson("not json"), null);
});

test("cards: unknown types and bad shapes are rejected", () => {
    assert.equal(normalizeCard({ type: "iframe", src: "x" }), null);
    assert.equal(normalizeCard({ type: "tabs", tabs: [{ label: "Only one", content: "x" }] }), null);
    assert.equal(normalizeCard({ type: "compare", items: [{ name: "A" }] }), null);
    assert.equal(normalizeCard({ type: "quiz", questions: [{ q: "?", options: ["a", "b"], answer: 5 }] }), null);
    assert.equal(normalizeCard([1, 2]), null);
    assert.equal(parseCardSource("{broken", { complete: true }).card, null);
});

test("cards: text is cleaned and limited", () => {
    const card = normalizeCard({
        type: "checklist",
        title: "<img src=x onerror=alert(1)>Plan",
        items: Array.from({ length: 40 }, (_, i) => ({ title: `Step ${i} <b>bold</b>` })),
        extra: "dropped"
    });
    assert.equal(card.title, "Plan");
    assert.equal(card.items.length, 12);
    assert.equal(card.items[0].title, "Step 0 bold");
    assert.equal(card.extra, undefined);
});

test("calculator: values are clamped and outputs computed", () => {
    const card = normalizeCard({
        type: "calculator",
        title: "Biryani",
        inputs: [{ id: "people", label: "People", min: 1, max: 20, step: 1, value: 4 }],
        outputs: [
            { label: "Rice", formula: "people*0.125", unit: "kg", decimals: 2 },
            { label: "Bad", formula: "people.constructor" }
        ]
    });
    const out = computeOutputs(card, { people: 8 });
    assert.equal(out[0].value, 1);
    assert.equal(out[1].text, "—");
    assert.equal(computeOutputs(card, { people: 999 })[0].value, 2.5);
    assert.match(cardToText(card, { values: { people: 8 } }), /Rice: 1 kg/);
});

test("chart scale has clean ticks", () => {
    const s = niceScale(87, 0);
    assert.equal(s.min, 0);
    assert.ok(s.max >= 87);
    assert.ok(s.ticks.length >= 3 && s.ticks.length <= 7);
    const neg = niceScale(10, -25);
    assert.ok(neg.min <= -25 && neg.ticks.includes(0));
});

test("every example in the model rule is a valid card or block", () => {
    const filler = '[{"type":"text","text":"x"}]';
    const objects = [];
    SMART_UI_RULE.split("\n").forEach(line => {
        const text = line.replace(/\[\s*\.\.\.(blocks\.\.\.)?\s*\]/g, filler);
        let depth = 0;
        let start = -1;
        let inString = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inString) {
                if (ch === "\\") i++;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') inString = true;
            else if (ch === "{") { if (depth++ === 0) start = i; }
            else if (ch === "}" && --depth === 0 && text.slice(start, start + 8) === '{"type":') objects.push(text.slice(start, i + 1));
        }
    });
    assert.ok(objects.length >= 18, `found ${objects.length} examples`);
    for (const json of objects) {
        const raw = JSON.parse(json);
        const card = ["view", "quiz", "checklist"].includes(raw.type)
            ? normalizeCard(raw)
            : normalizeCard({ type: "view", blocks: [raw] });
        assert.ok(card && (card.type !== "view" || card.blocks.length === 1), `rule example should be valid: ${json.slice(0, 60)}`);
    }
});

test("a block sent as a whole card still renders as a view", () => {
    const tabs = normalizeCard({ type: "tabs", title: "T", tabs: [{ label: "A", blocks: [{ type: "text", text: "hi" }] }, { label: "B", blocks: [{ type: "text", text: "yo" }] }] });
    assert.equal(tabs.type, "view");
    assert.equal(tabs.blocks[0].type, "tabs");
    const pie = normalizeCard({ type: "chart", kind: "donut", labels: ["a", "b"], series: [{ data: [1, 2] }] });
    assert.equal(pie.type, "view");
    assert.equal(pie.blocks[0].kind, "donut");
    const stat = normalizeCard({ type: "stat", label: "X", value: 4 });
    assert.equal(stat.type, "view");
    assert.equal(normalizeCard({ type: "script", src: "x" }), null);
});

test("formulas: comparisons, logic and if()", () => {
    assert.equal(evaluateFormula("a > 3 ? 10 : 20", { a: 5 }), 10);
    assert.equal(evaluateFormula("if(a < 3, 1, 2)", { a: 5 }), 2);
    assert.equal(evaluateFormula("a >= 5 && b == 2", { a: 5, b: 2 }), 1);
    assert.equal(evaluateFormula("!(a > 1) || 0", { a: 0 }), 1);
    assert.equal(evaluateFormula("sum(1,2,3) + avg(2,4) + clamp(9,0,5)"), 14);
    assert.throws(() => evaluateFormula("a = 1", { a: 1 }));
    assert.throws(() => evaluateFormula("constructor", {}));
});

test("view: a planner NEYO composes is cleaned, live and copyable", () => {
    const card = normalizeCard({
        type: "view",
        title: "Loan <b>planner</b>",
        kicker: "Planner",
        blocks: [
            { type: "grid", cols: 2, blocks: [
                { type: "slider", id: "amount", label: "Amount", min: 100000, max: 5000000, step: 50000, value: 1000000, prefix: "Rs" },
                { type: "segment", id: "years", label: "Years", options: [{ label: "1", value: 1 }, { label: "3", value: 3 }, { label: "5", value: 5 }], value: 3 }
            ] },
            { type: "stat", label: "Total", value: "=amount*(1+0.18*years)", prefix: "Rs", big: true },
            { type: "donut", labels: ["Principal", "Profit"], series: [{ data: ["=amount", "=amount*0.18*years"] }] },
            { type: "callout", tone: "warning", text: "Profit {amount*0.18*years} hai", show: "years > 3" },
            { type: "iframe", src: "https://evil" },
            { type: "text", text: "<script>alert(1)</script>Hi" }
        ]
    });
    assert.equal(card.type, "view");
    assert.equal(card.title, "Loan planner");
    assert.deepEqual(card.values, { amount: 1000000, years: 3 });
    assert.equal(card.blocks.length, 5, "unknown block dropped");
    assert.equal(card.blocks[3].tone, "warn");
    assert.ok(!JSON.stringify(card).includes("<script"));

    const text3 = cardToText(card, {});
    assert.match(text3, /Total: Rs 1,540,000/);
    assert.ok(!text3.includes("Profit 540,000"), "hidden until years > 3");
    const text5 = cardToText(card, { values: { years: 5 } });
    assert.match(text5, /Total: Rs 1,900,000/);
    assert.match(text5, /Profit 900,000 hai/);
    assert.match(text5, /Profit: 900,000/);
});

test("view: limits hold and half-streamed views still parse", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ type: "stat", label: `S${i}`, value: i }));
    const card = normalizeCard({ type: "view", blocks: [{ type: "grid", blocks: many }, ...many] });
    let count = 0;
    walkBlocks(card.blocks, () => count++);
    assert.ok(count <= 80);
    const inputs = Array.from({ length: 12 }, (_, i) => ({ type: "slider", id: `x${i}`, label: "x" }));
    assert.equal(Object.keys(normalizeCard({ type: "view", blocks: inputs }).values).length, 8);
    const src = JSON.stringify({ type: "view", title: "T", blocks: [{ type: "stat", label: "A", value: 1 }, { type: "table", columns: ["a", "b"], rows: [["1", "2"], ["3", "4"]] }] });
    const partial = parseCardSource(src.slice(0, src.length - 30), { complete: false });
    assert.equal(partial.card.type, "view");
    assert.ok(partial.card.blocks.length >= 1);
});
