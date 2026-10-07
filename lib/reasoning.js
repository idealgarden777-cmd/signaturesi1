/*
=========================================================
NEYO — REASONING TOOLS v1
1) deep_reason : "teen dimaagh, ek faisla"
   - medium : 1 attempt + Python check
   - hard   : 2 attempts in parallel (different methods),
              3rd attempt only when they disagree,
              then a checker runs Python to verify.
   - hard cap ~20 seconds, then best verified result.
2) solve_logic : Z3 theorem prover (SMT-LIB2). Proves
   constraint / logic / scheduling / optimisation problems.
   Only the solver language is run (no files, no JS).
Private chain-of-thought is never returned: only short
approach, key steps, final answer and check results.
=========================================================
*/

const REASON_MODEL_DEFAULT = "gemma-4-31b-it";
const REASON_FALLBACK_MODEL = "gemini-3.1-flash-lite";
const CHECK_MODEL_DEFAULT = "gemini-3.1-flash-lite";
const REASON_CAP_MS = 20000;

/* ---------------------------------------------------------
   GEMINI / GEMMA CALL
   --------------------------------------------------------- */

async function generate({ apiKey, model, prompt, temperature = 0.3, maxTokens = 3000, timeoutMs = 12000, withCode = false }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(2000, timeoutMs));
    const generationConfig = { temperature, maxOutputTokens: maxTokens };
    if (/gemini-3/i.test(model)) {
        generationConfig.thinkingConfig = { thinkingLevel: withCode ? "low" : "medium" };
    } else if (/gemini-2\.5/i.test(model)) {
        generationConfig.thinkingConfig = { thinkingBudget: withCode ? 0 : 2048 };
    }
    const body = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig };
    if (withCode) {
        body.tools = [{ codeExecution: {} }];
    }
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal }
        );
        if (!response.ok) {
            const error = new Error(`${model} ${response.status}`);
            error.status = response.status;
            throw error;
        }
        const data = await response.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const runs = [];
        parts.forEach(part => {
            if (part.executableCode?.code) {
                runs.push({ code: String(part.executableCode.code).slice(0, 1200) });
            }
            if (part.codeExecutionResult) {
                runs.push({ outcome: part.codeExecutionResult.outcome || "OK", output: String(part.codeExecutionResult.output || "").slice(0, 1200) });
            }
        });
        const text = parts.filter(part => part.text && !part.thought).map(part => part.text).join("\n").trim();
        return { text, runs, model };
    } finally {
        clearTimeout(timer);
    }
}

async function generateWithFallback(options) {
    const models = [...new Set([options.model, REASON_FALLBACK_MODEL].filter(Boolean))];
    let lastError = null;
    for (const model of models) {
        try {
            const result = await generate({ ...options, model });
            if (result.text) {
                return result;
            }
        } catch (error) {
            lastError = error;
            if (error?.name === "AbortError") {
                break;
            }
        }
    }
    throw lastError || new Error("no answer");
}

/* ---------------------------------------------------------
   DEEP REASON
   --------------------------------------------------------- */

const ANGLES = [
    "Solve it directly, step by step, checking each step.",
    "Solve it with a DIFFERENT method (work backwards, check every case, or estimate first and then compute exactly). Do not reuse the obvious approach.",
    "You are the tie-breaker. Solve it very carefully from scratch, listing every assumption."
];

function attemptPrompt({ problem, goal, constraints, facts, angle }) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
    return `Today is ${today}. Solve this problem carefully. ${angle}
PROBLEM: ${problem}
${goal ? `GOAL: ${goal}\n` : ""}${constraints ? `CONSTRAINTS: ${constraints}\n` : ""}${facts ? `KNOWN FACTS (verified, use them): ${facts}\n` : ""}
Think privately first. Then reply ONLY in this format (short):
APPROACH: <one line>
ASSUMPTIONS: <assumptions or missing info, or NONE>
STEPS:
1. <key step with the numbers>
2. ...
FINAL: <the final answer in one line, with units>
CONFIDENCE: <high | medium | low>`;
}

function field(text = "", name = "") {
    const match = String(text).match(new RegExp(`${name}:\\s*([\\s\\S]*?)(?:\\n[A-Z][A-Z ]{3,}:|$)`));
    return match ? match[1].trim() : "";
}

function parseAttempt(result, index) {
    const text = String(result?.text || "");
    return {
        id: String.fromCharCode(65 + index),
        model: result?.model || "",
        approach: field(text, "APPROACH").slice(0, 300),
        assumptions: field(text, "ASSUMPTIONS").slice(0, 400),
        steps: field(text, "STEPS").slice(0, 1800),
        final: (field(text, "FINAL") || text.split("\n").filter(Boolean).pop() || "").slice(0, 400),
        confidence: (field(text, "CONFIDENCE").match(/high|medium|low/i) || ["medium"])[0].toLowerCase()
    };
}

function numbersOf(text = "") {
    return (String(text).replace(/(\d),(?=\d{3}\b)/g, "$1").match(/-?\d+(?:\.\d+)?/g) || [])
        .map(Number)
        .filter(Number.isFinite);
}

function normalize(text = "") {
    return String(text).toLowerCase().replace(/[*_`"'.,;:!?()]/g, "").replace(/\s+/g, " ").trim();
}

export function sameAnswer(a = "", b = "") {
    if (!a || !b) {
        return false;
    }
    if (normalize(a) === normalize(b)) {
        return true;
    }
    const na = numbersOf(a);
    const nb = numbersOf(b);
    if (na.length && nb.length) {
        // The main numbers must match (1% tolerance for rounding).
        const close = (x, y) => Math.abs(x - y) <= Math.max(1e-9, Math.abs(y) * 0.01);
        const main = na.filter(x => Math.abs(x) >= 1 || x === 0);
        const other = nb.filter(x => Math.abs(x) >= 1 || x === 0);
        if (main.length && other.length) {
            return main.every(x => other.some(y => close(x, y))) || other.every(y => main.some(x => close(x, y)));
        }
        return na.every(x => nb.some(y => close(x, y)));
    }
    const wa = new Set(normalize(a).split(" ").filter(word => word.length > 2));
    const wb = new Set(normalize(b).split(" ").filter(word => word.length > 2));
    if (!wa.size || !wb.size) {
        return false;
    }
    const shared = [...wa].filter(word => wb.has(word)).length;
    return shared / Math.min(wa.size, wb.size) >= 0.8;
}

function checkPrompt({ problem, facts, attempts }) {
    return `You are NEYO's checker. Verify the candidate solutions of this problem.
PROBLEM: ${problem}
${facts ? `KNOWN FACTS: ${facts}\n` : ""}
${attempts.map(item => `CANDIDATE ${item.id}:\nSTEPS:\n${item.steps}\nFINAL: ${item.final}`).join("\n\n")}

Steps:
1. Re-compute every number and check the logic. Use the Python code execution tool for ALL arithmetic, formulas, counting, dates and logic checks (brute force small cases when possible).
2. Find the first wrong step in any candidate.
Reply ONLY in this format:
VERDICT: <letter of the correct candidate, or NONE if all are wrong>
CORRECT FINAL: <the verified final answer in one line, with units>
ISSUES: <short list of mistakes found, or NONE>
PYTHON: <PASSED | FAILED | NOT RUN>`;
}

/**
 * deep_reason tool.
 * args: { problem, goal, constraints, facts, difficulty }
 */
export async function deepReason({ apiKey, question = "", args = {}, timeoutMs = REASON_CAP_MS, onStatus = () => {} } = {}) {
    const started = Date.now();
    const cap = Math.min(REASON_CAP_MS, Math.max(6000, timeoutMs));
    const left = () => cap - (Date.now() - started);
    const difficulty = String(args.difficulty || "").toLowerCase() === "hard" ? "hard" : "medium";
    const problem = String(args.problem || question || "").slice(0, 4000);
    const base = {
        problem,
        goal: String(args.goal || "").slice(0, 600),
        constraints: String(args.constraints || "").slice(0, 1200),
        facts: String(args.facts || "").slice(0, 3000)
    };
    const model = process.env.NEYO_REASON_MODEL?.trim() || REASON_MODEL_DEFAULT;
    const checkModel = process.env.NEYO_REASON_CHECK_MODEL?.trim() || CHECK_MODEL_DEFAULT;

    try {
        onStatus("reasoning");
    } catch {}

    const runAttempt = (index, timeLimit) => generateWithFallback({
        apiKey,
        model,
        prompt: attemptPrompt({ ...base, angle: ANGLES[index] }),
        temperature: index === 0 ? 0.2 : 0.7,
        maxTokens: 3000,
        timeoutMs: timeLimit
    }).then(result => parseAttempt(result, index)).catch(error => {
        console.warn("[REASON] attempt failed", error?.message || error);
        return null;
    });

    const firstCount = difficulty === "hard" ? 2 : 1;
    const attemptTime = Math.min(12000, left() - 4000);
    let attempts = (await Promise.all(Array.from({ length: firstCount }, (_, index) => runAttempt(index, attemptTime)))).filter(Boolean);

    if (!attempts.length) {
        return { error: "Reasoning models did not answer in time.", difficulty, ms: Date.now() - started };
    }

    let agreement = attempts.length > 1 ? (sameAnswer(attempts[0].final, attempts[1].final) ? "agree" : "disagree") : "single";

    // Tie-breaker only when the two disagree and there is time.
    if (agreement === "disagree" && left() > 9000) {
        const third = await runAttempt(2, Math.min(9000, left() - 5000));
        if (third) {
            attempts.push(third);
            const votes = attempts.map(item => attempts.filter(other => sameAnswer(item.final, other.final)).length);
            agreement = Math.max(...votes) >= 2 ? "majority" : "disagree";
        }
    }

    // Python check of the maths/logic.
    let check = null;
    if (left() > 4500) {
        try {
            onStatus("checking");
        } catch {}
        try {
            const result = await generate({
                apiKey,
                model: checkModel,
                prompt: checkPrompt({ problem, facts: base.facts, attempts }),
                temperature: 0.1,
                maxTokens: 2000,
                timeoutMs: left() - 500,
                withCode: true
            });
            const text = result.text;
            const executed = result.runs.some(run => run.code);
            check = {
                verdict: ((field(text, "VERDICT").match(/\b([A-C])\b|NONE/i) || [""])[1] || "").toUpperCase(),
                correct_final: field(text, "CORRECT FINAL").slice(0, 400),
                issues: field(text, "ISSUES").slice(0, 800),
                python: executed ? (field(text, "PYTHON").match(/PASSED|FAILED/i) || ["RUN"])[0].toUpperCase() : "NOT RUN",
                python_output: result.runs.filter(run => run.output).map(run => run.output).slice(-2).join("\n").slice(0, 800)
            };
        } catch (error) {
            console.warn("[REASON] check failed", error?.message || error);
        }
    }

    // Pick the answer: checker > majority > first attempt.
    let chosen = attempts[0];
    if (agreement === "majority") {
        chosen = attempts.find(item => attempts.filter(other => sameAnswer(item.final, other.final)).length >= 2) || chosen;
    }
    let final = chosen.final;
    let verified = false;
    if (check?.correct_final && check.python !== "NOT RUN") {
        const picked = attempts.find(item => item.id === check.verdict);
        if (picked) {
            chosen = picked;
        }
        final = check.correct_final;
        verified = check.python === "PASSED" || check.python === "RUN";
    }

    const ms = Date.now() - started;
    console.log("[REASON]", difficulty, `attempts=${attempts.length}`, agreement, `check=${check?.python || "none"}`, `${ms}ms`);

    return {
        difficulty,
        attempts: attempts.length,
        agreement,
        final,
        verified,
        confidence: verified && agreement !== "disagree" ? "high" : agreement === "disagree" && !verified ? "low" : chosen.confidence,
        approach: chosen.approach,
        assumptions: chosen.assumptions,
        steps: chosen.steps,
        other_answers: attempts.filter(item => !sameAnswer(item.final, final)).map(item => item.final).slice(0, 2),
        check,
        ms
    };
}

/* ---------------------------------------------------------
   Z3 THEOREM PROVER
   --------------------------------------------------------- */

let z3Promise = null;
let z3Busy = Promise.resolve();

function loadZ3() {
    if (!z3Promise) {
        z3Promise = import("z3-solver")
            .then(module => module.init())
            .catch(error => {
                z3Promise = null;
                throw error;
            });
    }
    return z3Promise;
}

const BLOCKED_SMT = /\(\s*(include|exit|reset|set-option\s+:(?:trace|dump|output|regular-output-channel|diagnostic-output-channel|proof|produce-proofs))/i;

/**
 * solve_logic tool: runs an SMT-LIB2 script in Z3.
 * args: { smtlib, goal }
 */
export async function solveLogic({ args = {}, timeoutMs = 8000 } = {}) {
    let script = String(args.smtlib || "")
        .replace(/```[a-z0-9-]*\n?/gi, "")
        .replace(/```/g, "")
        .trim()
        .slice(0, 15000);
    if (!script) {
        return { error: "No SMT-LIB2 script given." };
    }
    if (BLOCKED_SMT.test(script)) {
        return { error: "Script uses a blocked command (include/exit/reset/trace/output)." };
    }
    if (!/\(\s*check-sat/i.test(script)) {
        script += "\n(check-sat)\n(get-model)";
    }

    let Z3;
    try {
        ({ Z3 } = await loadZ3());
    } catch (error) {
        console.warn("[Z3] load failed", error?.message || error);
        return { error: "Z3 solver is not available right now. Use deep_reason instead." };
    }

    const run = async () => {
        const solverMs = Math.max(1000, Math.min(6000, timeoutMs - 1500));
        const config = Z3.mk_config();
        Z3.set_param_value(config, "timeout", String(solverMs));
        const ctx = Z3.mk_context_rc(config);
        Z3.del_config(config);
        let timedOut = false;
        try {
            const output = await Promise.race([
                Z3.eval_smtlib2_string(ctx, script),
                new Promise(resolve => setTimeout(() => {
                    timedOut = true;
                    resolve("timeout");
                }, solverMs + 1500))
            ]);
            return String(output || "");
        } finally {
            if (!timedOut) {
                try {
                    Z3.del_context(ctx);
                } catch {}
            }
        }
    };

    const started = Date.now();
    const job = z3Busy.then(run, run);
    z3Busy = job.catch(() => {});
    let output;
    try {
        output = await job;
    } catch (error) {
        return { error: `Z3 error: ${String(error?.message || error).slice(0, 300)}` };
    }

    const errors = (output.match(/\(error "[^"]*"\)/g) || []).slice(0, 3);
    const results = (output.match(/^(sat|unsat|unknown|timeout)\s*$/gm) || []).map(item => item.trim());
    const status = results[results.length - 1] || (errors.length ? "error" : "unknown");
    const meaning = {
        sat: "SATISFIABLE: a solution exists; the model below gives exact values that satisfy every constraint (or the optimum if minimize/maximize was used).",
        unsat: "UNSATISFIABLE: proven impossible; no values can satisfy all constraints together (or a claim checked by asserting its negation is PROVEN TRUE).",
        unknown: "UNKNOWN: the solver could not decide in time; do not claim a proof.",
        timeout: "TIMEOUT: the solver ran out of time; do not claim a proof.",
        error: "The script had errors; fix the SMT-LIB2 and call again."
    }[status] || "";

    console.log("[Z3]", status, `${Date.now() - started}ms`);
    return {
        status,
        meaning,
        goal: String(args.goal || "").slice(0, 300),
        output: output.replace(/\(error "[^"]*"\)\n?/g, "").trim().slice(0, 3000),
        errors,
        ms: Date.now() - started
    };
}

/* ---------------------------------------------------------
   SELF-REVIEW (general editor pass, no per-mistake rules)
   Runs on answers that used reasoning/maths/code/law tools,
   before the user sees them. Returns the draft unchanged
   when it is fine or when the review fails/times out.
   --------------------------------------------------------- */

const REVIEW_MODEL_DEFAULT = "gemini-3.1-flash-lite";

export async function reviewAnswer({ apiKey, question = "", draft = "", evidence = "", timeoutMs = 12000 } = {}) {
    const started = Date.now();
    if (!apiKey || !draft || draft.length < 40) {
        return { answer: draft, changed: false, issues: [] };
    }
    const prompt = `You are NEYO's final reviewer. Check the DRAFT answer before the user sees it.
USER QUESTION:
${String(question).slice(0, 3000)}

TOOL RESULTS (exact, trust these over the draft):
${String(evidence).slice(0, 9000) || "none"}

DRAFT ANSWER:
${String(draft).slice(0, 14000)}

Look only for REAL problems:
1. It misreads the question, or the question can be read in two ways and the draft mixes them or adds options that cannot exist. Fix: use the most natural reading and state that assumption in one short line.
2. Contradictions, impossible or meaningless options, or steps that do not add up.
3. Numbers, facts, code or conclusions that disagree with the TOOL RESULTS.
4. Assumptions about the user that the user never stated (gender, name, age, location, feelings). Address the user in neutral form (in Urdu/Hindi use the masculine-plural respectful "aap kar sakte hain" style unless the user stated their gender). The assistant may keep its own gendered self-reference.
5. Wrong language/script compared with the user's message.
Do NOT rewrite style, tone, length, markdown, code blocks or citation markers like [1]. Do not add new facts.
Reply with JSON only:
{"ok": true}
or
{"ok": false, "issues": ["short issue", ...], "answer": "<the complete corrected answer, everything else unchanged>"}`;

    const model = process.env.NEYO_REVIEW_MODEL?.trim() || REVIEW_MODEL_DEFAULT;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(3000, timeoutMs));
    try {
        const generationConfig = { temperature: 0.1, maxOutputTokens: 8000, responseMimeType: "application/json" };
        if (/gemini-3/i.test(model)) {
            generationConfig.thinkingConfig = { thinkingLevel: "low" };
        } else if (/gemini-2\.5/i.test(model)) {
            generationConfig.thinkingConfig = { thinkingBudget: 512 };
        }
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig }),
                signal: controller.signal
            }
        );
        if (!response.ok) {
            throw new Error(`review ${response.status}`);
        }
        const data = await response.json();
        const text = (data?.candidates?.[0]?.content?.parts || []).filter(part => part.text && !part.thought).map(part => part.text).join("").trim();
        const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
        const fixed = typeof json.answer === "string" ? json.answer.trim() : "";
        // Safety: ignore a "fix" that throws away most of the answer.
        if (json.ok === false && fixed && fixed.length >= draft.length * 0.6) {
            console.log("[REVIEW] fixed", JSON.stringify(json.issues || []).slice(0, 300), `${Date.now() - started}ms`);
            return { answer: fixed, changed: true, issues: Array.isArray(json.issues) ? json.issues.slice(0, 6) : [] };
        }
        console.log("[REVIEW] ok", `${Date.now() - started}ms`);
        return { answer: draft, changed: false, issues: [] };
    } catch (error) {
        console.warn("[REVIEW] skipped", error?.message || error);
        return { answer: draft, changed: false, issues: [] };
    } finally {
        clearTimeout(timer);
    }
}
