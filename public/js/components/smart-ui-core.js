/*
=========================================================
NEYO — SMART UI CORE v1
Pure logic, no DOM (tested in Node: tests/smart-ui.test.js)

NEYO writes a card as a fenced code block:
    ```neyo-ui
    {"type":"calculator", ...}
    ```
This file:
- repairs half-streamed JSON so a card can appear while
  the answer is still arriving
- checks every card against a strict whitelist and cleans
  every value (text only, length limits, number limits)
- evaluates calculator formulas with its own tiny parser
  (never eval / Function)
The AI only ever sends data. It can never run code or
inject HTML into the page.
=========================================================
*/

export const CARD_TYPES = ["calculator", "checklist", "chart", "tabs", "compare", "quiz"];

const LIMITS = {
    title: 90,
    label: 60,
    text: 400,
    longText: 2400,
    items: 12,
    inputs: 4,
    outputs: 8,
    tabs: 6,
    series: 4,
    points: 24,
    questions: 8,
    options: 6
};

/* ---------------- text helpers ---------------- */

export function cleanText(value, max = LIMITS.text) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number" || typeof value === "boolean") value = String(value);
    if (typeof value !== "string") return "";
    return value
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .replace(/<[^>]*>/g, "")
        .trim()
        .slice(0, max);
}

function cleanId(value, fallback) {
    const id = String(value ?? "")
        .replace(/[^A-Za-z0-9_]/g, "")
        .replace(/^[0-9]+/, "")
        .slice(0, 32);
    return id || fallback;
}

function num(value, fallback = 0) {
    const n = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}

function list(value, max) {
    return Array.isArray(value) ? value.slice(0, max) : [];
}

/* ---------------- partial JSON repair ---------------- */

/*
Closes open strings, arrays and objects of a JSON prefix so it
can be parsed while streaming. Returns null if nothing usable.
*/
export function repairPartialJson(source) {
    const text = String(source ?? "").trim();
    if (!text.startsWith("{")) return null;

    const stack = [];
    let inString = false;
    let escaped = false;
    let lastSafe = -1; // index after the last complete value

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{" || ch === "[") stack.push(ch);
        else if (ch === "}" || ch === "]") {
            stack.pop();
            lastSafe = i + 1;
        } else if (ch === ",") lastSafe = i;
    }

    let body = text;
    if (inString) {
        // drop a trailing lone backslash, then close the string
        body = body.replace(/\\$/, "") + '"';
    }

    // remove dangling `,` / `:` / `"key"` that has no value yet
    const tidy = s => s
        .replace(/,\s*$/, "")
        .replace(/,\s*"[^"]*"\s*:?\s*$/, "")
        .replace(/\{\s*"[^"]*"\s*:?\s*$/, "{")
        .replace(/:\s*$/, ": null")
        .replace(/:\s*(t|tr|tru|f|fa|fal|fals|n|nu|nul)$/, ": null")
        .replace(/:\s*-?$/, ": null");

    const attempt = candidate => {
        let s = tidy(candidate);
        const open = [];
        let str = false;
        let esc = false;
        for (const ch of s) {
            if (str) {
                if (esc) esc = false;
                else if (ch === "\\") esc = true;
                else if (ch === '"') str = false;
                continue;
            }
            if (ch === '"') str = true;
            else if (ch === "{" || ch === "[") open.push(ch);
            else if (ch === "}" || ch === "]") open.pop();
        }
        if (str) return null;
        s = s.replace(/,\s*$/, "");
        for (let i = open.length - 1; i >= 0; i--) s += open[i] === "{" ? "}" : "]";
        try {
            return JSON.parse(s);
        } catch {
            return null;
        }
    };

    return attempt(body) ?? (lastSafe > 0 ? attempt(text.slice(0, lastSafe)) : null);
}

/* ---------------- safe formula evaluator ---------------- */

const FUNCS = {
    min: Math.min,
    max: Math.max,
    round: (x, d = 0) => {
        const f = Math.pow(10, clamp(Math.trunc(d), 0, 6));
        return Math.round(x * f) / f;
    },
    floor: Math.floor,
    ceil: Math.ceil,
    abs: Math.abs,
    sqrt: Math.sqrt,
    pow: Math.pow,
    log: Math.log10,
    ln: Math.log
};

function tokenize(src) {
    const tokens = [];
    const s = String(src ?? "");
    if (s.length > 300) throw new Error("formula too long");
    let i = 0;
    while (i < s.length) {
        const ch = s[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (/[0-9.]/.test(ch)) {
            let j = i;
            while (j < s.length && /[0-9.]/.test(s[j])) j++;
            if (s[j] === "e" || s[j] === "E") {
                j++;
                if (s[j] === "+" || s[j] === "-") j++;
                while (j < s.length && /[0-9]/.test(s[j])) j++;
            }
            const n = Number(s.slice(i, j));
            if (!Number.isFinite(n)) throw new Error("bad number");
            tokens.push({ t: "num", v: n });
            i = j;
            continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
            let j = i;
            while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
            tokens.push({ t: "id", v: s.slice(i, j) });
            i = j;
            continue;
        }
        if ("+-*/^%(),".includes(ch)) {
            tokens.push({ t: ch });
            i++;
            continue;
        }
        throw new Error(`bad character ${ch}`);
    }
    return tokens;
}

/*
Grammar:
  expr   := term (("+"|"-") term)*
  term   := power (("*"|"/"|"%") power)*
  power  := unary ("^" power)?
  unary  := ("-"|"+") unary | atom
  atom   := number | id | id "(" args ")" | "(" expr ")"
*/
export function evaluateFormula(formula, vars = {}) {
    const tokens = tokenize(formula);
    let pos = 0;
    let depth = 0;
    const peek = () => tokens[pos];
    const take = t => {
        const tok = tokens[pos];
        if (!tok || (t && tok.t !== t)) throw new Error("syntax");
        pos++;
        return tok;
    };

    function expr() {
        if (++depth > 40) throw new Error("too deep");
        let v = term();
        while (peek() && (peek().t === "+" || peek().t === "-")) {
            const op = take().t;
            const r = term();
            v = op === "+" ? v + r : v - r;
        }
        depth--;
        return v;
    }
    function term() {
        let v = power();
        while (peek() && ["*", "/", "%"].includes(peek().t)) {
            const op = take().t;
            const r = power();
            v = op === "*" ? v * r : op === "/" ? v / r : v % r;
        }
        return v;
    }
    function power() {
        const base = unary();
        if (peek()?.t === "^") {
            take();
            return Math.pow(base, power());
        }
        return base;
    }
    function unary() {
        if (peek()?.t === "-") { take(); return -unary(); }
        if (peek()?.t === "+") { take(); return unary(); }
        return atom();
    }
    function atom() {
        const tok = take();
        if (tok.t === "num") return tok.v;
        if (tok.t === "(") {
            const v = expr();
            take(")");
            return v;
        }
        if (tok.t === "id") {
            if (peek()?.t === "(") {
                const fn = FUNCS[tok.v.toLowerCase()];
                if (!fn) throw new Error(`unknown function ${tok.v}`);
                take("(");
                const args = [];
                if (peek()?.t !== ")") {
                    args.push(expr());
                    while (peek()?.t === ",") { take(); args.push(expr()); }
                }
                take(")");
                return fn(...args);
            }
            if (Object.prototype.hasOwnProperty.call(vars, tok.v)) return Number(vars[tok.v]);
            throw new Error(`unknown name ${tok.v}`);
        }
        throw new Error("syntax");
    }

    const value = expr();
    if (pos !== tokens.length) throw new Error("syntax");
    return value;
}

export function formatNumber(value, decimals = null, locale = "en-US") {
    if (!Number.isFinite(value)) return "—";
    const d = decimals === null || decimals === undefined
        ? (Math.abs(value) >= 100 || Number.isInteger(value) ? 0 : 2)
        : clamp(Math.trunc(num(decimals, 0)), 0, 6);
    try {
        return value.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: d });
    } catch {
        return value.toFixed(d);
    }
}

export function compactNumber(value) {
    if (!Number.isFinite(value)) return "—";
    const abs = Math.abs(value);
    if (abs < 10000) return formatNumber(value);
    const units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
    for (const [size, suffix] of units) {
        if (abs >= size) {
            const n = value / size;
            return `${Number(n.toFixed(Math.abs(n) < 10 ? 1 : 0))}${suffix}`;
        }
    }
    return formatNumber(value);
}

// "Rs" -> "Rs ", "$" stays "$"
function cleanPrefix(value) {
    const p = cleanText(value, 8);
    return /[A-Za-z]$/.test(p) ? `${p} ` : p;
}

/* ---------------- card normalisers ---------------- */

function normCalculator(raw) {
    const inputs = list(raw.inputs, LIMITS.inputs).map((input, i) => {
        const min = num(input?.min, 0);
        const max = Math.max(min, num(input?.max, min + 100));
        const step = Math.abs(num(input?.step, 1)) || 1;
        return {
            id: cleanId(input?.id, `x${i + 1}`),
            label: cleanText(input?.label, LIMITS.label) || `Value ${i + 1}`,
            min,
            max,
            step,
            value: clamp(num(input?.value, min), min, max),
            unit: cleanText(input?.unit, 16),
            slider: Boolean(input?.slider) || (max - min) / step > 30
        };
    });
    // ids must be unique
    const seen = new Set();
    inputs.forEach((input, i) => {
        while (seen.has(input.id)) input.id = `${input.id}_${i}`;
        seen.add(input.id);
    });

    const outputs = list(raw.outputs, LIMITS.outputs)
        .map(output => ({
            label: cleanText(output?.label, LIMITS.label),
            formula: cleanText(output?.formula, 300),
            unit: cleanText(output?.unit, 16),
            prefix: cleanPrefix(output?.prefix),
            decimals: output?.decimals === undefined ? null : clamp(Math.trunc(num(output.decimals, 0)), 0, 6),
            big: Boolean(output?.big)
        }))
        .filter(output => output.label && output.formula);

    if (!inputs.length || !outputs.length) return null;
    return { inputs, outputs };
}

function normChecklist(raw) {
    const items = list(raw.items, LIMITS.items)
        .map(item => typeof item === "string"
            ? { title: cleanText(item, 140), text: "", time: "" }
            : {
                title: cleanText(item?.title, 140),
                text: cleanText(item?.text, LIMITS.text),
                time: cleanText(item?.time, 24)
            })
        .filter(item => item.title);
    return items.length ? { items } : null;
}

function normChart(raw) {
    const labels = list(raw.labels, LIMITS.points).map(l => cleanText(l, 24));
    const series = list(raw.series, LIMITS.series)
        .map(s => ({
            name: cleanText(s?.name, 40),
            data: list(s?.data, labels.length || LIMITS.points).map(v => num(v, 0))
        }))
        .filter(s => s.data.length);
    if (!labels.length || !series.length) return null;
    return {
        kind: raw.kind === "line" ? "line" : "bar",
        labels,
        series,
        unit: cleanText(raw.unit, 16),
        prefix: cleanPrefix(raw.prefix)
    };
}

function normTabs(raw) {
    const tabs = list(raw.tabs, LIMITS.tabs)
        .map(tab => ({
            label: cleanText(tab?.label, 32),
            content: cleanText(tab?.content, LIMITS.longText)
        }))
        .filter(tab => tab.label && tab.content);
    return tabs.length >= 2 ? { tabs } : null;
}

function normCompare(raw) {
    const items = list(raw.items, 4)
        .map(item => ({
            name: cleanText(item?.name, 48),
            tag: cleanText(item?.tag, 24),
            summary: cleanText(item?.summary, 220),
            points: list(item?.points, 6).map(p => cleanText(p, 120)).filter(Boolean),
            best: Boolean(item?.best)
        }))
        .filter(item => item.name);
    if (items.length < 2) return null;
    // only one "best"
    let found = false;
    items.forEach(item => {
        if (item.best && !found) found = true;
        else item.best = false;
    });
    return { items };
}

function normQuiz(raw) {
    const questions = list(raw.questions, LIMITS.questions)
        .map(q => {
            const options = list(q?.options, LIMITS.options).map(o => cleanText(o, 140)).filter(Boolean);
            const answer = Math.trunc(num(q?.answer, -1));
            return {
                q: cleanText(q?.q ?? q?.question, 300),
                options,
                answer,
                explain: cleanText(q?.explain, 300)
            };
        })
        .filter(q => q.q && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length);
    return questions.length ? { questions } : null;
}

const NORMALISERS = {
    calculator: normCalculator,
    checklist: normChecklist,
    chart: normChart,
    tabs: normTabs,
    compare: normCompare,
    quiz: normQuiz
};

/*
Returns a clean card or null. Unknown keys are dropped,
unknown types are rejected.
*/
export function normalizeCard(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const type = String(raw.type || "").toLowerCase();
    if (!CARD_TYPES.includes(type)) return null;
    const body = NORMALISERS[type](raw);
    if (!body) return null;
    return {
        type,
        title: cleanText(raw.title, LIMITS.title),
        note: cleanText(raw.note, 300),
        ...body
    };
}

/*
Parses the text inside a ```neyo-ui block.
complete=false lets half-streamed JSON through repair.
*/
export function parseCardSource(source, { complete = true } = {}) {
    const text = String(source ?? "").trim();
    if (!text) return { card: null, partial: !complete };
    let raw = null;
    try {
        raw = JSON.parse(text);
    } catch {
        raw = complete ? null : repairPartialJson(text);
    }
    return { card: normalizeCard(raw), partial: !complete };
}

/* ---------------- calculator ---------------- */

export function computeOutputs(card, values) {
    const vars = {};
    card.inputs.forEach(input => {
        vars[input.id] = clamp(num(values?.[input.id], input.value), input.min, input.max);
    });
    return card.outputs.map(output => {
        let value = NaN;
        try {
            value = evaluateFormula(output.formula, vars);
        } catch {
            value = NaN;
        }
        return { ...output, value, text: formatNumber(value, output.decimals) };
    });
}

/* ---------------- plain text (Copy / Save) ---------------- */

export function cardToText(card, state = {}) {
    if (!card) return "";
    const lines = [];
    if (card.title) lines.push(card.title, "");
    switch (card.type) {
        case "calculator": {
            card.inputs.forEach(input => {
                const v = state.values?.[input.id] ?? input.value;
                lines.push(`${input.label}: ${formatNumber(Number(v))}${input.unit ? ` ${input.unit}` : ""}`);
            });
            lines.push("");
            computeOutputs(card, state.values || {}).forEach(o => {
                lines.push(`${o.label}: ${o.prefix}${o.text}${o.unit ? ` ${o.unit}` : ""}`);
            });
            break;
        }
        case "checklist":
            card.items.forEach((item, i) => {
                const mark = state.done?.[i] ? "[x]" : "[ ]";
                lines.push(`${mark} ${item.time ? `${item.time} — ` : ""}${item.title}${item.text ? `: ${item.text}` : ""}`);
            });
            break;
        case "chart":
            lines.push(["", ...card.series.map(s => s.name || "Value")].join("\t"));
            card.labels.forEach((label, i) => {
                lines.push([label, ...card.series.map(s => `${card.prefix}${formatNumber(s.data[i] ?? 0)}${card.unit ? ` ${card.unit}` : ""}`)].join("\t"));
            });
            break;
        case "tabs":
            card.tabs.forEach(tab => lines.push(`## ${tab.label}`, tab.content, ""));
            break;
        case "compare":
            card.items.forEach(item => {
                lines.push(`${item.name}${item.tag ? ` (${item.tag})` : ""}${item.best ? " ★" : ""}`);
                if (item.summary) lines.push(item.summary);
                item.points.forEach(p => lines.push(`- ${p}`));
                lines.push("");
            });
            break;
        case "quiz":
            card.questions.forEach((q, i) => {
                lines.push(`${i + 1}. ${q.q}`);
                q.options.forEach((o, j) => lines.push(`   ${String.fromCharCode(65 + j)}) ${o}`));
                lines.push(`   Answer: ${String.fromCharCode(65 + q.answer)}${q.explain ? ` — ${q.explain}` : ""}`, "");
            });
            break;
    }
    if (card.note) lines.push("", card.note);
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------------- chart geometry ---------------- */

export function niceScale(maxValue, minValue = 0) {
    const hi = Math.max(maxValue, 0);
    const lo = Math.min(minValue, 0);
    const span = hi - lo || 1;
    const rough = span / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const top = Math.ceil(hi / step) * step;
    const bottom = Math.floor(lo / step) * step;
    const ticks = [];
    for (let v = bottom; v <= top + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
    return { min: bottom, max: top || step, step, ticks };
}
