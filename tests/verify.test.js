import test from "node:test";
import assert from "node:assert/strict";
import { applyFixes, findCardRanges, answerCheckEnabled, buildCheckPrompt } from "../lib/verify.js";

const answer = `## OpenAI vs Anthropic

OpenAI ka **GPT-6.1 Sol** sab se naya hai. Jalapeño chip GPT-6 ko fast banata hai.
- Claude 5.5 Haiku bhi aaya hai
- Riemann Zeta Bound: 67.2%

\`\`\`neyo-ui
{"type":"view","blocks":[{"type":"stat","label":"Score","value":"67.2%"}]}
\`\`\`

Dono achhe hain.`;

test("answer check: only the exact unsupported pieces change", () => {
    const out = applyFixes(answer, [
        { quote: "Jalapeño chip GPT-6 ko fast banata hai.", fix: "", why: "no source links them" },
        { quote: "- Claude 5.5 Haiku bhi aaya hai", fix: "- Claude Opus 5.5 aur Sonnet 5.5 aaye hain", why: "Haiku not in sources" },
        { quote: "not in the answer at all", fix: "x" }
    ]);
    assert.equal(out.applied, 2);
    assert.ok(!out.text.includes("Jalapeño"));
    assert.ok(out.text.includes("Claude Opus 5.5 aur Sonnet 5.5"));
    assert.ok(out.text.includes("**GPT-6.1 Sol**"), "the rest stays exactly the same");
    assert.ok(out.text.includes("Dono achhe hain."));
});

test("answer check: a wrong number inside a card removes the card, not the text", () => {
    const out = applyFixes(answer, [{ quote: '"value":"67.2%"', fix: "" }]);
    assert.equal(out.removedCards, 1);
    assert.ok(!out.text.includes("neyo-ui"));
    assert.ok(out.text.includes("Dono achhe hain."));
    assert.equal(findCardRanges(out.text).length, 0);
});

test("answer check: fixes can't inject code fences, junk is ignored", () => {
    const out = applyFixes("Price is Rs 500 today.", [{ quote: "Rs 500", fix: "```neyo-ui\n{}```Rs 450" }, null, { quote: 5 }, { quote: "ab" }]);
    assert.equal(out.text, "Price is neyo-ui\n{}Rs 450 today.");
    assert.equal(applyFixes("x", "nope").applied, 0);
});

test("answer check: switch and prompt", () => {
    assert.equal(answerCheckEnabled(""), true);
    assert.equal(answerCheckEnabled("OFF"), false);
    const prompt = buildCheckPrompt({ question: "q", answer: "a", evidence: "e", today: "2026-10-09" });
    assert.match(prompt, /EXACT, short substring/);
    assert.match(prompt, /EVIDENCE:\ne\n/);
});
