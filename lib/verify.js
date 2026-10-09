/*
=========================================================
NEYO — ANSWER CHECK v1
After an answer is written from live web results, a second
model reads the answer next to the same evidence and lists
the exact sentences the evidence does not support (invented
names, numbers that belong to something else, links the
sources never make, wrong "latest" claims, winners without
proof). Only those exact pieces are replaced, so the rest of
the answer (style, personality, layout) stays untouched.

- Pure helpers (applyFixes, findCardRanges) are tested in
  tests/verify.test.js.
- Any failure or timeout = the answer is kept as it is.
- Server setting NEYO_ANSWER_CHECK=off switches it off.
=========================================================
*/

import { askModelJson } from "./deep-research.js";

const MAX_FIXES = 8;
const MAX_QUOTE = 400;

/* Ranges of ```neyo-ui ... ``` blocks (Smart UI cards). */
export function findCardRanges(text = "") {
    const ranges = [];
    const pattern = /```neyo-ui[^\n]*\n[\s\S]*?(?:```|$)/g;
    let match;
    while ((match = pattern.exec(text))) {
        ranges.push([match.index, match.index + match[0].length]);
        if (match[0].length === 0) pattern.lastIndex++;
    }
    return ranges;
}

function inside(ranges, start, end) {
    return ranges.find(([a, b]) => start < b && end > a) || null;
}

/*
Replaces each issue's exact quote with its fix.
- quote must appear in the answer exactly (otherwise skipped)
- a problem inside a Smart UI card removes the whole card
  (a wrong card is worse than no card; the text still explains)
Returns { text, applied, removedCards }.
*/
export function applyFixes(answer = "", issues = []) {
    let text = String(answer || "");
    let applied = 0;
    let removedCards = 0;
    const list = (Array.isArray(issues) ? issues : []).slice(0, MAX_FIXES);

    for (const issue of list) {
        const quote = typeof issue?.quote === "string" ? issue.quote.trim() : "";
        if (quote.length < 4 || quote.length > MAX_QUOTE) continue;
        const start = text.indexOf(quote);
        if (start < 0) continue;
        const end = start + quote.length;

        const card = inside(findCardRanges(text), start, end);
        if (card) {
            text = `${text.slice(0, card[0]).replace(/\n+$/, "\n")}${text.slice(card[1]).replace(/^\n+/, "\n")}`;
            removedCards++;
            applied++;
            continue;
        }

        let fix = typeof issue?.fix === "string" ? issue.fix : "";
        fix = fix.replace(/```/g, "").slice(0, MAX_QUOTE * 2);
        text = text.slice(0, start) + fix + text.slice(end);
        applied++;
    }

    if (applied) {
        text = text
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/^\s*[-*]\s*$/gm, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    return { text, applied, removedCards };
}

export function answerCheckEnabled(setting = "") {
    return String(setting || "").trim().toLowerCase() !== "off";
}

export function buildCheckPrompt({ question, answer, evidence, today }) {
    return `You are NEYO's strict fact checker. Today is ${today}.
Compare the ANSWER with the EVIDENCE (live web results read just now). Find statements in the ANSWER that the EVIDENCE does not support:
- product, model, version, person or company names that are not in the evidence, or a family member guessed from a pattern
- numbers, scores, benchmarks, prices, percentages or dates that are not in the evidence, or that belong to a different thing in the evidence
- cause and effect or connections between facts that no single source states
- "latest", "newest", "most powerful", "best" or winner claims that the evidence contradicts or does not support
- something important that the evidence says clearly but the answer gets wrong (e.g. leaves out the actual newest or most capable item when the question asks for it)
Do NOT flag: style, tone, greetings, opinions clearly worded as opinions, safe general knowledge that never changes, or wording that is a fair summary of the evidence.

For each problem give:
- "quote": an EXACT, short substring copied character for character from the ANSWER (one sentence or less; keep Markdown symbols exactly)
- "fix": the replacement for that quote, in the same language, style and Markdown as the answer, true to the evidence; use "" to delete it. If the right fact is unknown, write that it could not be confirmed.
- "why": a few words
At most ${MAX_FIXES} problems, the most important first. If everything is supported, return an empty list.

Reply ONLY with JSON: {"issues":[{"quote":"...","fix":"...","why":"..."}]}

QUESTION:
${String(question || "").slice(0, 1200)}

EVIDENCE:
${String(evidence || "").slice(0, 24000)}

ANSWER:
${String(answer || "").slice(0, 12000)}`;
}

/*
Returns { text, fixes, removedCards, checked } — never throws.
*/
export async function verifyAnswer({
    question,
    answer,
    evidence,
    apiKey,
    model,
    timeoutMs = 9000
} = {}) {
    const keep = { text: answer, fixes: 0, removedCards: 0, checked: false };
    if (!answer || !evidence || !apiKey || !model) return keep;
    try {
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
        const result = await askModelJson({
            apiKey,
            model,
            shape: "object",
            maxOutputTokens: 1800,
            timeoutMs,
            prompt: buildCheckPrompt({ question, answer, evidence, today })
        });
        if (!result || !Array.isArray(result.issues)) return keep;
        const fixed = applyFixes(answer, result.issues);
        if (!fixed.applied || !fixed.text) return { ...keep, checked: true };
        return { text: fixed.text, fixes: fixed.applied, removedCards: fixed.removedCards, checked: true };
    } catch (error) {
        console.warn("[ANSWER CHECK] failed", error?.message || error);
        return keep;
    }
}
