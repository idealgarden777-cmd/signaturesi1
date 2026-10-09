import test from "node:test";
import assert from "node:assert/strict";
import {
    evaluateFormula,
    repairPartialJson,
    normalizeCard,
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

test("every example in the model rule is a valid card", () => {
    const lines = SMART_UI_RULE.split("\n").filter(l => l.trim().startsWith('{"type"'));
    assert.ok(lines.length >= 6);
    for (const line of lines) {
        const json = line.trim().replace(/\s+\(.*\)$/, "");
        const card = normalizeCard(JSON.parse(json));
        assert.ok(card, `rule example should be valid: ${json.slice(0, 40)}`);
    }
});
