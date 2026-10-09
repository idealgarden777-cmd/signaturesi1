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

export const CARD_TYPES = ["view", "calculator", "checklist", "chart", "tabs", "compare", "quiz"];

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
    ln: Math.log,
    if: (c, a, b = 0) => (c ? a : b),
    clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
    sum: (...xs) => xs.reduce((a, b) => a + b, 0),
    avg: (...xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
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
        const two = s.slice(i, i + 2);
        if ([">=", "<=", "==", "!=", "&&", "||"].includes(two)) {
            tokens.push({ t: two });
            i += 2;
            continue;
        }
        if ("+-*/^%(),<>?:!".includes(ch)) {
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
  expr   := or ("?" expr ":" expr)?
  or     := and ("||" and)*
  and    := cmp ("&&" cmp)*
  cmp    := sum ((">"|"<"|">="|"<="|"=="|"!=") sum)?
  sum    := term (("+"|"-") term)*
  term   := power (("*"|"/"|"%") power)*
  power  := unary ("^" power)?
  unary  := ("-"|"+"|"!") unary | atom
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
        const c = or();
        let v = c;
        if (peek()?.t === "?") {
            take();
            const a = expr();
            take(":");
            const b = expr();
            v = c ? a : b;
        }
        depth--;
        return v;
    }
    function or() {
        let v = and();
        while (peek()?.t === "||") { take(); const r = and(); v = v || r ? 1 : 0; }
        return v;
    }
    function and() {
        let v = compare();
        while (peek()?.t === "&&") { take(); const r = compare(); v = v && r ? 1 : 0; }
        return v;
    }
    function compare() {
        const l = sum();
        const op = peek()?.t;
        if ([">", "<", ">=", "<=", "==", "!="].includes(op)) {
            take();
            const r = sum();
            const ok = op === ">" ? l > r : op === "<" ? l < r : op === ">=" ? l >= r
                : op === "<=" ? l <= r : op === "==" ? Math.abs(l - r) < 1e-9 : Math.abs(l - r) >= 1e-9;
            return ok ? 1 : 0;
        }
        return l;
    }
    function sum() {
        let v = term();
        while (peek() && (peek().t === "+" || peek().t === "-")) {
            const op = take().t;
            const r = term();
            v = op === "+" ? v + r : v - r;
        }
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
        if (peek()?.t === "!") { take(); return unary() ? 0 : 1; }
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

/* =========================================================
   VIEW: NEYO composes its own visual from safe blocks
   ========================================================= */

export const VIEW_BLOCKS = [
    "text", "heading", "stat", "grid", "card", "input", "progress", "chart",
    "table", "list", "timeline", "callout", "kv", "badges", "tabs", "accordion", "divider"
];

const BLOCK_ALIASES = {
    row: "grid", columns: "grid", cols: "grid",
    group: "card", panel: "card", section: "card",
    metric: "stat", kpi: "stat", number: "stat",
    slider: "input", select: "input", toggle: "input", segment: "input", field: "input",
    meter: "progress", ring: "progress", gauge: "progress",
    bar: "chart", line: "chart", area: "chart", pie: "chart", donut: "chart", hbar: "chart",
    steps: "list", checklist: "list", bullets: "list",
    note: "callout", alert: "callout", tip: "callout", warning: "callout",
    keyvalue: "kv", facts: "kv", details: "kv",
    tags: "badges", chips: "badges",
    markdown: "text", md: "text", paragraph: "text", p: "text",
    title: "heading", h: "heading",
    hr: "divider", separator: "divider",
    faq: "accordion", expand: "accordion"
};

const TONES = ["neutral", "accent", "good", "bad", "warn", "info"];
const VIEW_LIMITS = { nodes: 80, depth: 4, inputs: 8, rows: 20, cols: 6, options: 8, kids: 16 };

function tone(value, fallback = "neutral") {
    const t = String(value || "").toLowerCase();
    const map = { success: "good", positive: "good", green: "good", danger: "bad", error: "bad", negative: "bad", red: "bad", warning: "warn", caution: "warn", yellow: "warn", blue: "info", primary: "accent" };
    const v = map[t] || t;
    return TONES.includes(v) ? v : fallback;
}

function validExpr(text) {
    try {
        tokenize(text);
        return true;
    } catch {
        return false;
    }
}

/* number -> {num}; "=a*b" -> {expr}; other text -> {text} (may hold {expr}) */
function cleanValue(value, max = 120) {
    if (typeof value === "number" && Number.isFinite(value)) return { num: value };
    if (typeof value === "string") {
        const v = value.trim();
        if (v.startsWith("=") && v.length > 1 && validExpr(v.slice(1))) return { expr: v.slice(1, 301) };
        const n = Number(v.replace(/,/g, ""));
        if (v && /^-?[\d,]*\.?\d+$/.test(v) && Number.isFinite(n)) return { num: n };
        return { text: cleanText(v, max) };
    }
    return { text: "" };
}

function cleanShow(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const v = value.trim().replace(/^=/, "");
    return validExpr(v) ? v.slice(0, 300) : "";
}

function normKids(raw, ctx, depth) {
    return list(raw, VIEW_LIMITS.kids)
        .map(child => normBlock(child, ctx, depth + 1))
        .filter(Boolean);
}

function normBlock(raw, ctx, depth = 0) {
    if (typeof raw === "string") raw = { type: "text", text: raw };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (depth > VIEW_LIMITS.depth || ctx.nodes >= VIEW_LIMITS.nodes) return null;
    let type = String(raw.type || "").toLowerCase().trim();
    const alias = BLOCK_ALIASES[type];
    if (alias) {
        if (alias === "input" && !raw.kind) raw = { ...raw, kind: type };
        if (alias === "chart" && !raw.kind) raw = { ...raw, kind: type };
        if (alias === "progress" && !raw.style && type !== "meter") raw = { ...raw, style: "ring" };
        if (alias === "list" && !raw.style) raw = { ...raw, style: type === "steps" ? "number" : type === "checklist" ? "check" : "bullet" };
        if (alias === "callout" && !raw.tone) raw = { ...raw, tone: type === "warning" ? "warn" : type === "tip" ? "good" : "info" };
        type = alias;
    }
    if (!VIEW_BLOCKS.includes(type)) return null;
    ctx.nodes++;
    ctx.ids = (ctx.ids || 0) + 1;
    const path = `b${ctx.ids}`;
    const base = { type, path, show: cleanShow(raw.show ?? raw.when ?? raw.if) };
    let body = null;

    switch (type) {
        case "text": {
            const text = cleanText(raw.text ?? raw.content ?? raw.value, LIMITS.text * 2);
            body = text ? { text, size: ["sm", "lg"].includes(raw.size) ? raw.size : "md", tone: tone(raw.tone) } : null;
            break;
        }
        case "heading": {
            const text = cleanText(raw.text ?? raw.title, LIMITS.title);
            body = text ? { text } : null;
            break;
        }
        case "stat": {
            const label = cleanText(raw.label ?? raw.title, LIMITS.label);
            const rawValue = raw.value !== undefined ? raw.value : raw.formula !== undefined ? `=${raw.formula}` : "";
            const value = cleanValue(rawValue);
            if (!label && value.text === "") break;
            body = {
                label,
                value,
                prefix: cleanPrefix(raw.prefix),
                unit: cleanText(raw.unit, 16),
                decimals: raw.decimals === undefined ? null : clamp(Math.trunc(num(raw.decimals, 0)), 0, 6),
                hint: cleanText(raw.hint ?? raw.note ?? raw.sub, 140),
                tone: tone(raw.tone),
                trend: ["up", "down"].includes(raw.trend) ? raw.trend : "",
                big: Boolean(raw.big)
            };
            break;
        }
        case "grid": {
            const blocks = normKids(raw.blocks ?? raw.items ?? raw.children, ctx, depth);
            body = blocks.length ? { cols: clamp(Math.trunc(num(raw.cols ?? raw.columns, Math.min(blocks.length, 3))), 1, 4), blocks } : null;
            break;
        }
        case "card": {
            const blocks = normKids(raw.blocks ?? raw.items ?? raw.children, ctx, depth);
            const title = cleanText(raw.title ?? raw.name, LIMITS.title);
            body = blocks.length || title ? { title, tag: cleanText(raw.tag ?? raw.badge, 30), tone: tone(raw.tone), blocks } : null;
            break;
        }
        case "input": {
            if (ctx.inputs.length >= VIEW_LIMITS.inputs) break;
            let kind = String(raw.kind || "").toLowerCase();
            const options = list(raw.options, VIEW_LIMITS.options)
                .map((o, i) => typeof o === "object" && o
                    ? { label: cleanText(o.label ?? o.name ?? o.value, 40), value: num(o.value, i) }
                    : { label: cleanText(o, 40), value: i })
                .filter(o => o.label);
            if (!["slider", "number", "select", "toggle", "segment"].includes(kind)) kind = options.length ? "select" : "slider";
            if ((kind === "select" || kind === "segment") && options.length < 2) kind = "number";
            if (kind === "segment" && options.length > 5) kind = "select";
            let min = num(raw.min, 0);
            let max = Math.max(min, num(raw.max, min + 100));
            let step = Math.abs(num(raw.step, 1)) || 1;
            if (kind === "toggle") { min = 0; max = 1; step = 1; }
            let id = cleanId(raw.id ?? raw.name, `x${ctx.inputs.length + 1}`);
            while (ctx.inputs.some(input => input.id === id)) id = `${id}_${ctx.inputs.length}`;
            let value = num(raw.value ?? raw.default, kind === "select" || kind === "segment" ? options[0]?.value ?? 0 : min);
            if (kind === "toggle") value = raw.value === true || Number(raw.value) === 1 ? 1 : 0;
            else if (kind !== "select" && kind !== "segment") value = clamp(value, min, max);
            body = {
                id,
                label: cleanText(raw.label, LIMITS.label) || id,
                kind,
                min, max, step, value,
                unit: cleanText(raw.unit, 16),
                prefix: cleanPrefix(raw.prefix),
                options
            };
            ctx.inputs.push({ id, value });
            break;
        }
        case "progress": {
            const value = cleanValue(raw.value);
            if (value.text !== undefined && !value.text) break;
            body = {
                label: cleanText(raw.label ?? raw.title, LIMITS.label),
                value,
                max: cleanValue(raw.max ?? 100),
                unit: cleanText(raw.unit, 16),
                style: raw.style === "ring" ? "ring" : "bar",
                tone: tone(raw.tone, "accent")
            };
            break;
        }
        case "chart": {
            const kinds = ["bar", "line", "area", "pie", "donut", "hbar"];
            const kind = kinds.includes(raw.kind) ? raw.kind : "bar";
            let labels = list(raw.labels, LIMITS.points).map(l => cleanText(l, 24));
            let series = list(raw.series, LIMITS.series);
            // shorthand: {"data":[{"label":"A","value":3}]} or {"values":[...]}
            if (!series.length && Array.isArray(raw.data)) {
                if (raw.data.every(d => d && typeof d === "object" && !Array.isArray(d))) {
                    labels = raw.data.slice(0, LIMITS.points).map(d => cleanText(d.label ?? d.name, 24));
                    series = [{ name: cleanText(raw.name, 40), data: raw.data.slice(0, LIMITS.points).map(d => d.value) }];
                } else {
                    series = [{ name: cleanText(raw.name, 40), data: raw.data }];
                }
            } else if (!series.length && Array.isArray(raw.values)) {
                series = [{ name: cleanText(raw.name, 40), data: raw.values }];
            }
            series = series
                .map(sr => ({
                    name: cleanText(sr?.name, 40),
                    data: list(sr?.data ?? sr?.values, labels.length || LIMITS.points).map(v => {
                        const c = cleanValue(v);
                        return c.expr ? { expr: c.expr } : { num: num(c.num, 0) };
                    })
                }))
                .filter(sr => sr.data.length);
            if (!labels.length || !series.length) break;
            if (kind === "pie" || kind === "donut") series = series.slice(0, 1);
            body = {
                kind,
                labels,
                series,
                unit: cleanText(raw.unit, 16),
                prefix: cleanPrefix(raw.prefix),
                height: clamp(Math.trunc(num(raw.height, 0)), 0, 420)
            };
            break;
        }
        case "table": {
            const columns = list(raw.columns ?? raw.headers, VIEW_LIMITS.cols).map(c => cleanText(typeof c === "object" ? c?.label : c, 40));
            const rows = list(raw.rows, VIEW_LIMITS.rows)
                .map(row => list(Array.isArray(row) ? row : columns.map((_, i) => row?.[i]), columns.length || VIEW_LIMITS.cols).map(cell => cleanText(cell, 140)))
                .filter(row => row.some(Boolean));
            if (!rows.length) break;
            const hl = Math.trunc(num(raw.highlight, -1));
            body = { columns, rows, highlight: hl >= 0 && hl < rows.length ? hl : -1 };
            break;
        }
        case "list": {
            const style = ["bullet", "number", "check"].includes(raw.style) ? raw.style : "bullet";
            const items = list(raw.items, LIMITS.items * 2)
                .map(item => typeof item === "string"
                    ? { title: cleanText(item, 200), text: "", time: "" }
                    : { title: cleanText(item?.title ?? item?.label, 200), text: cleanText(item?.text, LIMITS.text), time: cleanText(item?.time, 24) })
                .filter(item => item.title);
            body = items.length ? { style, items } : null;
            break;
        }
        case "timeline": {
            const items = list(raw.items, LIMITS.items * 2)
                .map(item => typeof item === "string"
                    ? { time: "", title: cleanText(item, 140), text: "", tone: "neutral" }
                    : { time: cleanText(item?.time ?? item?.date, 30), title: cleanText(item?.title, 140), text: cleanText(item?.text, LIMITS.text), tone: tone(item?.tone) })
                .filter(item => item.title);
            body = items.length ? { items } : null;
            break;
        }
        case "callout": {
            const text = cleanText(raw.text ?? raw.content, LIMITS.text);
            const title = cleanText(raw.title, LIMITS.label);
            body = text || title ? { tone: tone(raw.tone, "info"), title, text } : null;
            break;
        }
        case "kv": {
            const source = Array.isArray(raw.items) ? raw.items
                : raw.items && typeof raw.items === "object" ? Object.entries(raw.items).map(([label, value]) => ({ label, value }))
                : [];
            const items = source.slice(0, LIMITS.items * 2)
                .map(item => Array.isArray(item)
                    ? { label: cleanText(item[0], LIMITS.label), value: cleanText(item[1], 200) }
                    : { label: cleanText(item?.label ?? item?.key, LIMITS.label), value: cleanText(item?.value, 200) })
                .filter(item => item.label);
            body = items.length ? { items } : null;
            break;
        }
        case "badges": {
            const items = list(raw.items, LIMITS.items * 2)
                .map(item => typeof item === "string" ? { text: cleanText(item, 40), tone: "neutral" } : { text: cleanText(item?.text ?? item?.label, 40), tone: tone(item?.tone) })
                .filter(item => item.text);
            body = items.length ? { items } : null;
            break;
        }
        case "tabs": {
            const tabs = list(raw.tabs ?? raw.items, LIMITS.tabs)
                .map(tab => ({
                    label: cleanText(tab?.label ?? tab?.title, 40),
                    blocks: normKids(tab?.blocks ?? (tab?.content ? [{ type: "text", text: tab.content }] : []), ctx, depth)
                }))
                .filter(tab => tab.label && tab.blocks.length);
            body = tabs.length >= 2 ? { tabs } : null;
            break;
        }
        case "accordion": {
            const items = list(raw.items, LIMITS.items)
                .map(item => ({
                    title: cleanText(item?.title ?? item?.q, 140),
                    blocks: normKids(item?.blocks ?? (item?.text || item?.a ? [{ type: "text", text: item.text ?? item.a }] : []), ctx, depth)
                }))
                .filter(item => item.title && item.blocks.length);
            body = items.length ? { items } : null;
            break;
        }
        case "divider":
            body = {};
            break;
    }

    if (!body) {
        ctx.nodes--;
        return null;
    }
    return { ...base, ...body };
}

function normView(raw) {
    const ctx = { nodes: 0, inputs: [] };
    const blocks = list(raw.blocks ?? raw.children ?? raw.items, VIEW_LIMITS.kids * 2)
        .map(block => normBlock(block, ctx, 0))
        .filter(Boolean);
    if (!blocks.length) return null;
    const values = {};
    ctx.inputs.forEach(input => { values[input.id] = input.value; });
    return {
        kicker: cleanText(raw.kicker ?? raw.label, 24),
        accent: tone(raw.accent ?? raw.tone, "neutral"),
        values,
        blocks
    };
}

/* ---------------- view evaluation ---------------- */

export function viewVars(card, state = {}) {
    const vars = { ...(card.values || {}) };
    Object.entries(state.values || {}).forEach(([k, v]) => {
        if (Object.prototype.hasOwnProperty.call(vars, k) && Number.isFinite(Number(v))) vars[k] = Number(v);
    });
    return vars;
}

export function evalValue(value, vars) {
    if (!value) return NaN;
    if (value.num !== undefined) return value.num;
    if (value.expr) {
        try {
            const v = evaluateFormula(value.expr, vars);
            return Number.isFinite(v) ? v : NaN;
        } catch {
            return NaN;
        }
    }
    return NaN;
}

/* "Total {a*b} Rs" -> fills {…} that are valid formulas; "{a*b:2}" = 2 decimals */
export function fillTemplate(text, vars) {
    return String(text || "").replace(/\{([^{}]{1,200})\}/g, (whole, inner) => {
        const m = inner.match(/^(.*?)(?::(\d))?$/);
        const exprText = (m?.[1] || inner).trim();
        if (!/[A-Za-z_0-9]/.test(exprText)) return whole;
        try {
            const v = evaluateFormula(exprText, vars);
            return formatNumber(v, m?.[2] !== undefined ? Number(m[2]) : null);
        } catch {
            return whole;
        }
    });
}

export function valueText(block, vars) {
    const v = block.value || {};
    if (v.text !== undefined) return fillTemplate(v.text, vars);
    const n = evalValue(v, vars);
    return `${block.prefix || ""}${formatNumber(n, block.decimals)}${block.unit ? ` ${block.unit}` : ""}`;
}

export function isVisible(block, vars) {
    if (!block.show) return true;
    try {
        return Boolean(evaluateFormula(block.show, vars));
    } catch {
        return true;
    }
}

export function chartNumbers(block, vars) {
    return block.series.map(sr => ({
        name: sr.name,
        data: sr.data.map(d => {
            const v = d.expr ? evalValue(d, vars) : d.num;
            return Number.isFinite(v) ? v : 0;
        })
    }));
}

export function walkBlocks(blocks, fn) {
    (blocks || []).forEach(block => {
        fn(block);
        if (block.blocks) walkBlocks(block.blocks, fn);
        if (block.tabs) block.tabs.forEach(tab => walkBlocks(tab.blocks, fn));
        if (block.type === "accordion") block.items.forEach(item => walkBlocks(item.blocks, fn));
    });
}

function viewLines(blocks, vars, state, lines, indent = "") {
    blocks.forEach(block => {
        if (!isVisible(block, vars)) return;
        const f = t => fillTemplate(t, vars).replace(/\*\*|__|`/g, "");
        switch (block.type) {
            case "text": lines.push(indent + f(block.text)); break;
            case "heading": lines.push("", `${indent}## ${f(block.text)}`); break;
            case "stat": lines.push(`${indent}${block.label}: ${valueText(block, vars)}${block.hint ? ` (${f(block.hint)})` : ""}`); break;
            case "input": {
                const v = vars[block.id];
                const opt = block.options.find(o => o.value === v);
                const shown = block.kind === "toggle" ? (v ? "Yes" : "No") : opt ? opt.label : `${block.prefix}${formatNumber(v)}${block.unit ? ` ${block.unit}` : ""}`;
                lines.push(`${indent}${block.label}: ${shown}`);
                break;
            }
            case "progress": {
                const v = evalValue(block.value, vars);
                const max = evalValue(block.max, vars) || 100;
                lines.push(`${indent}${block.label ? `${block.label}: ` : ""}${formatNumber(v)}${block.unit ? ` ${block.unit}` : ""} / ${formatNumber(max)} (${formatNumber((v / max) * 100, 0)}%)`);
                break;
            }
            case "chart": {
                const series = chartNumbers(block, vars);
                block.labels.forEach((label, i) => {
                    lines.push(`${indent}${label}: ${series.map(sr => `${sr.name ? `${sr.name} ` : ""}${block.prefix}${formatNumber(sr.data[i] ?? 0)}${block.unit ? ` ${block.unit}` : ""}`).join(", ")}`);
                });
                break;
            }
            case "table":
                if (block.columns.length) lines.push(indent + block.columns.join("\t"));
                block.rows.forEach(row => lines.push(indent + row.map(f).join("\t")));
                break;
            case "list":
                block.items.forEach((item, i) => {
                    const mark = block.style === "check" ? (state.checks?.[`${block.path}_${i}`] ? "[x] " : "[ ] ") : block.style === "number" ? `${i + 1}. ` : "- ";
                    lines.push(`${indent}${mark}${item.time ? `${item.time} — ` : ""}${f(item.title)}${item.text ? `: ${f(item.text)}` : ""}`);
                });
                break;
            case "timeline":
                block.items.forEach(item => lines.push(`${indent}${item.time ? `${item.time} — ` : ""}${item.title}${item.text ? `: ${item.text}` : ""}`));
                break;
            case "callout": lines.push(`${indent}${block.title ? `${block.title}: ` : ""}${f(block.text)}`); break;
            case "kv": block.items.forEach(item => lines.push(`${indent}${item.label}: ${f(item.value)}`)); break;
            case "badges": lines.push(indent + block.items.map(item => item.text).join(" · ")); break;
            case "divider": lines.push(""); break;
            case "grid": viewLines(block.blocks, vars, state, lines, indent); break;
            case "card":
                lines.push("", `${indent}${block.title}${block.tag ? ` (${block.tag})` : ""}`);
                viewLines(block.blocks, vars, state, lines, `${indent}  `);
                break;
            case "tabs":
                block.tabs.forEach(tab => { lines.push("", `${indent}## ${tab.label}`); viewLines(tab.blocks, vars, state, lines, indent); });
                break;
            case "accordion":
                block.items.forEach(item => { lines.push("", `${indent}${item.title}`); viewLines(item.blocks, vars, state, lines, `${indent}  `); });
                break;
        }
    });
}

export function viewToText(card, state = {}) {
    const lines = [];
    viewLines(card.blocks, viewVars(card, state), state, lines);
    return lines.join("\n");
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
    view: normView,
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
    const asBlock = () => {
        const { title, note, kicker, ...block } = raw;
        const view = normView({ kicker, blocks: [block] });
        return view ? { type: "view", title: cleanText(title, LIMITS.title), note: cleanText(note, 300), ...view } : null;
    };
    const isBlock = VIEW_BLOCKS.includes(type) || Object.prototype.hasOwnProperty.call(BLOCK_ALIASES, type);
    if (!CARD_TYPES.includes(type)) return isBlock ? asBlock() : null;
    // a chart kind only the view draws (pie, donut, hbar, area, formulas)
    if (type === "chart" && (!["bar", "line", undefined].includes(raw.kind) || JSON.stringify(raw.series || []).includes('"='))) return asBlock();
    const body = NORMALISERS[type](raw);
    if (!body) return isBlock ? asBlock() : null;
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
        case "view":
            lines.push(viewToText(card, state));
            break;
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
