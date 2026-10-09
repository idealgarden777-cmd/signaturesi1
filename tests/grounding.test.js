import test from "node:test";
import assert from "node:assert/strict";
import { shouldUpgradeForGrounding, isGroundedHardQuestion } from "../lib/decide.js";
import { buildLiveSearchPrompt, ACCURACY_RULES } from "../lib/deep-research.js";
import { SMART_UI_RULE } from "../lib/smart-ui.js";

const base = {
    sourceCount: 4,
    effort: "low",
    isDeepResearch: false,
    currentModel: "gemma-4-26b-a4b-it",
    advancedModel: "gemma-4-31b-it",
    setting: ""
};

test("grounding: comparisons from web results use the bigger writer", () => {
    assert.equal(shouldUpgradeForGrounding({ ...base, question: "OpenAI vs Anthropic latest models" }), true);
    assert.equal(shouldUpgradeForGrounding({ ...base, question: "kaunsa phone behtar hai 2026" }), true);
    assert.equal(shouldUpgradeForGrounding({ ...base, question: "aaj Lahore ka mausam", effort: "high" }), true);
    assert.equal(shouldUpgradeForGrounding({ ...base, question: "x", isDeepResearch: true }), true);
});

test("grounding: no upgrade without sources, when already advanced, or switched off", () => {
    assert.equal(shouldUpgradeForGrounding({ ...base, question: "aaj ki khabar" }), false);
    assert.equal(shouldUpgradeForGrounding({ ...base, question: "compare A vs B", sourceCount: 0 }), false);
    assert.equal(shouldUpgradeForGrounding({ ...base, question: "compare A vs B", currentModel: "gemma-4-31b-it" }), false);
    assert.equal(shouldUpgradeForGrounding({ ...base, question: "compare A vs B", setting: "off" }), false);
    assert.equal(isGroundedHardQuestion("hello"), false);
});

test("web answers carry the accuracy rules", () => {
    const prompt = buildLiveSearchPrompt("who is ahead?", { contextText: "[1] Example\nURL: https://example.com\n\ntext" });
    assert.ok(prompt.includes(ACCURACY_RULES));
    for (const must of ["which product/model/person", "cause and effect", "not written in the results", "winner", "hype"]) {
        assert.ok(ACCURACY_RULES.includes(must), `rule mentions ${must}`);
    }
    assert.ok(buildLiveSearchPrompt("q", null).startsWith("q\n\n=== LIVE SEARCH NOTE ==="));
});

test("Smart UI: no automatic 'best' pick", () => {
    assert.match(SMART_UI_RULE, /pick[^\n]*ONLY when the user asked which one to choose/);
    const examples = SMART_UI_RULE.split("\n").filter(line => line.trim().startsWith('{"type"'));
    assert.ok(examples.every(line => !line.includes('"best":true')), "examples don't teach a best pick");
});
