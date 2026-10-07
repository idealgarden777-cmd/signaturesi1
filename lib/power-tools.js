/*
=========================================================
NEYO — POWER TOOLS v1 (all run inside one chat request)
1) code_workspace : Micro-Git workspace + AST static analysis
   and AST-safe mutation (rename). User code is parsed,
   NEVER executed. Every edit is a commit: log/diff/revert.
2) probability    : Bayesian inference (Bayes rule, Beta
   updates) + Monte Carlo simulation with a safe formula
   language (no eval).
3) knowledge_graph: dynamic mind-map of facts (subject -
   relation - object), conflict detection, paths, tree.
=========================================================
*/

import * as acorn from "acorn";
import * as walk from "acorn-walk";

/* =========================================================
   1) CODE WORKSPACE (Micro-Git + AST)
   ========================================================= */

const EXT = { javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", python: "py", py: "py", html: "html", css: "css", json: "json", sql: "sql", java: "java", "c++": "cpp", cpp: "cpp", c: "c", go: "go", php: "php", ruby: "rb", rust: "rs", bash: "sh", sh: "sh" };

function seedFiles(text = "") {
    const files = new Map();
    const blocks = [...String(text).matchAll(/```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g)];
    blocks.forEach((block, index) => {
        const lang = String(block[1] || "").toLowerCase();
        const code = block[2].replace(/\s+$/, "") + "\n";
        const named = code.match(/^\s*(?:\/\/|#|<!--|\/\*)\s*(?:file(?:name)?:?\s*)?([\w./-]+\.[a-z0-9]{1,5})\b/i);
        let path = named ? named[1] : `${index ? `file${index + 1}` : "main"}.${EXT[lang] || guessExt(code)}`;
        while (files.has(path)) {
            path = path.replace(/(\.[a-z0-9]+)$/i, "_2$1");
        }
        files.set(path, code);
    });
    return files;
}

function guessExt(code = "") {
    if (/^\s*(def |import \w+$|from \w+ import|print\()/m.test(code)) return "py";
    if (/^\s*<(!doctype|html|div|body)/im.test(code)) return "html";
    if (/^\s*[{[]/.test(code) && (() => { try { JSON.parse(code); return true; } catch { return false; } })()) return "json";
    if (/\b(function|const|let|=>|console\.)/.test(code)) return "js";
    return "txt";
}

const JS_GLOBALS = new Set(("undefined NaN Infinity globalThis window document console Math JSON Date Object Array String Number Boolean Symbol BigInt Promise Map Set WeakMap WeakSet Error TypeError RangeError SyntaxError ReferenceError " +
    "parseInt parseFloat isNaN isFinite setTimeout clearTimeout setInterval clearInterval queueMicrotask structuredClone fetch Request Response Headers URL URLSearchParams " +
    "AbortController TextEncoder TextDecoder Blob File FormData localStorage sessionStorage navigator location history alert confirm prompt requestAnimationFrame cancelAnimationFrame " +
    "process require module exports __dirname __filename Buffer global Intl Reflect Proxy RegExp ArrayBuffer Uint8Array Int32Array Float64Array DataView encodeURIComponent decodeURIComponent " +
    "encodeURI decodeURI escape unescape performance crypto atob btoa Event CustomEvent EventTarget HTMLElement Node Element MutationObserver IntersectionObserver ResizeObserver WebSocket Worker " +
    "Image Audio Notification arguments this super self top parent frames customElements getComputedStyle matchMedia scrollTo open close print screen innerWidth innerHeight devicePixelRatio").split(/\s+/));

function parseJs(code) {
    const opts = { ecmaVersion: "latest", locations: true, allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };
    try {
        return { ast: acorn.parse(code, { ...opts, sourceType: "module" }) };
    } catch (moduleError) {
        try {
            return { ast: acorn.parse(code, { ...opts, sourceType: "script" }) };
        } catch {
            return { error: `${moduleError.message}` };
        }
    }
}

function collectPatternNames(node, out = []) {
    if (!node) return out;
    if (node.type === "Identifier") out.push(node);
    else if (node.type === "ObjectPattern") node.properties.forEach(prop => collectPatternNames(prop.type === "RestElement" ? prop.argument : prop.value, out));
    else if (node.type === "ArrayPattern") node.elements.forEach(el => collectPatternNames(el, out));
    else if (node.type === "RestElement") collectPatternNames(node.argument, out);
    else if (node.type === "AssignmentPattern") collectPatternNames(node.left, out);
    return out;
}

function analyzeJs(code) {
    const parsed = parseJs(code);
    if (parsed.error) {
        return { parses: false, syntax_error: parsed.error };
    }
    const { ast } = parsed;
    const declared = new Map();
    const declare = (id, kind) => {
        if (!declared.has(id.name)) declared.set(id.name, { kind, line: id.loc.start.line, uses: 0 });
    };
    const functions = [];
    const warnings = [];
    let complexity = 1;

    walk.full(ast, node => {
        switch (node.type) {
            case "VariableDeclarator": collectPatternNames(node.id).forEach(id => declare(id, "variable")); break;
            case "FunctionDeclaration":
            case "FunctionExpression":
            case "ArrowFunctionExpression":
                if (node.id) declare(node.id, "function");
                node.params.forEach(param => collectPatternNames(param).forEach(id => declare(id, "param")));
                functions.push({ name: node.id?.name || "(anonymous)", line: node.loc.start.line, params: node.params.length, lines: node.loc.end.line - node.loc.start.line + 1, async: !!node.async });
                break;
            case "ClassDeclaration": if (node.id) declare(node.id, "class"); break;
            case "ImportSpecifier":
            case "ImportDefaultSpecifier":
            case "ImportNamespaceSpecifier": declare(node.local, "import"); break;
            case "CatchClause": if (node.param) collectPatternNames(node.param).forEach(id => declare(id, "param")); break;
            case "IfStatement": case "ConditionalExpression": case "ForStatement": case "ForInStatement": case "ForOfStatement":
            case "WhileStatement": case "DoWhileStatement": case "SwitchCase": complexity += 1; break;
            case "LogicalExpression": complexity += 1; break;
            case "CallExpression":
                if (node.callee.type === "Identifier" && node.callee.name === "eval") warnings.push(`line ${node.loc.start.line}: eval() is dangerous`);
                break;
            case "NewExpression":
                if (node.callee.type === "Identifier" && node.callee.name === "Function") warnings.push(`line ${node.loc.start.line}: new Function() is like eval`);
                break;
            case "BinaryExpression":
                if (node.operator === "==" || node.operator === "!=") warnings.push(`line ${node.loc.start.line}: loose ${node.operator} (use ${node.operator}=)`);
                break;
            case "AssignmentExpression":
                if (node.left.type === "MemberExpression" && !node.left.computed && /^(innerHTML|outerHTML)$/.test(node.left.property.name)) warnings.push(`line ${node.loc.start.line}: ${node.left.property.name} assignment (XSS risk if data is from users)`);
                break;
            case "DebuggerStatement": warnings.push(`line ${node.loc.start.line}: debugger statement left in code`); break;
            default: break;
        }
    });

    // References (identifiers that are read, not property names / declarations).
    const undefinedUses = [];
    walk.ancestor(ast, {
        Identifier(node, ancestors) {
            const parent = ancestors[ancestors.length - 2];
            if (!parent) return;
            if ((parent.type === "MemberExpression" && parent.property === node && !parent.computed) ||
                ((parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") && parent.key === node && !parent.computed && !parent.shorthand) ||
                (parent.type === "VariableDeclarator" && parent.id === node) ||
                ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression" || parent.type === "ClassDeclaration" || parent.type === "ClassExpression") && parent.id === node) ||
                ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression" || parent.type === "ArrowFunctionExpression") && parent.params.includes(node)) ||
                /^(Import|Export)\w*Specifier$/.test(parent.type) || parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement" ||
                parent.type === "CatchClause" || parent.type === "MetaProperty") {
                return;
            }
            const entry = declared.get(node.name);
            if (entry) entry.uses += 1;
            else if (!JS_GLOBALS.has(node.name)) undefinedUses.push(`${node.name} (line ${node.loc.start.line})`);
        }
    });

    const unused = [...declared.entries()].filter(([, info]) => info.uses === 0 && info.kind !== "param").map(([name, info]) => `${name} (${info.kind}, line ${info.line})`);
    return {
        parses: true,
        functions: functions.slice(0, 40),
        possibly_undefined: [...new Set(undefinedUses)].slice(0, 20),
        never_read: unused.slice(0, 20),
        warnings: [...new Set(warnings)].slice(0, 20),
        cyclomatic_complexity: complexity,
        note: "Static analysis only (code was not run). Scope check is approximate: confirm before claiming a bug."
    };
}

function analyzeOther(path, code) {
    const lines = code.split("\n");
    const result = { lines: lines.length, long_lines: lines.filter(line => line.length > 120).length };
    if (/\.json$/.test(path)) {
        try { JSON.parse(code); result.json = "valid"; } catch (error) { result.json = `invalid: ${error.message}`; }
    }
    if (/\.py$/.test(path)) {
        const stack = [];
        lines.forEach((line, index) => {
            if (/\t/.test(line.match(/^\s*/)[0]) && / /.test(line.match(/^\s*/)[0])) stack.push(`line ${index + 1}: mixed tabs and spaces`);
            if (/^\s*(def|class|if|elif|else|for|while|try|except|finally|with)\b[^:#]*$/.test(line) && !/\\$/.test(line) && !/[([{,]\s*$/.test(line)) stack.push(`line ${index + 1}: missing ':'?`);
        });
        result.functions = lines.map((line, index) => (line.match(/^\s*def\s+(\w+)/) || [])[1] ? `${line.match(/^\s*def\s+(\w+)/)[1]} (line ${index + 1})` : null).filter(Boolean).slice(0, 40);
        result.warnings = stack.slice(0, 15);
        if (/\beval\(|\bexec\(/.test(code)) result.warnings.push("eval/exec used (dangerous)");
    }
    const pairs = { "(": ")", "[": "]", "{": "}" };
    const open = [];
    for (const char of code.replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, "")) {
        if (pairs[char]) open.push(char);
        else if (Object.values(pairs).includes(char)) {
            if (pairs[open[open.length - 1]] === char) open.pop();
            else { result.brackets = `unmatched '${char}'`; break; }
        }
    }
    if (!result.brackets) result.brackets = open.length ? `${open.length} unclosed '${open[open.length - 1]}'` : "balanced";
    result.note = "Light static check for this language (no full parser). Use fix_code to run/test it.";
    return result;
}

function lineDiff(a = "", b = "", path = "file") {
    const x = a.split("\n").slice(0, 1500);
    const y = b.split("\n").slice(0, 1500);
    const n = x.length;
    const m = y.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
            dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out = [`--- a/${path}`, `+++ b/${path}`];
    let i = 0;
    let j = 0;
    let changes = 0;
    while (i < n || j < m) {
        if (i < n && j < m && x[i] === y[j]) { i += 1; j += 1; continue; }
        if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) { out.push(`-${i + 1}: ${x[i]}`); i += 1; changes += 1; }
        else { out.push(`+${j + 1}: ${y[j]}`); j += 1; changes += 1; }
    }
    return changes ? out.join("\n").slice(0, 5000) : "No changes.";
}

function renameIdentifier(code, from, to) {
    if (!/^[A-Za-z_$][\w$]*$/.test(to)) throw new Error("New name is not a valid identifier.");
    const parsed = parseJs(code);
    if (parsed.error) throw new Error(`Cannot rename: ${parsed.error}`);
    const spots = [];
    const visit = (node, ancestors) => {
        if (node.name !== from) return;
        const parent = ancestors[ancestors.length - 2];
        if (parent?.type === "MemberExpression" && parent.property === node && !parent.computed) return;
        if (parent?.type === "Property" && parent.key === node && !parent.computed && !parent.shorthand) return;
        spots.push(node);
    };
    walk.ancestor(parsed.ast, { Identifier: visit, VariablePattern: visit });
    // Shorthand {from} must become {to: ...}? keep it simple: {from} -> {from: to} keeps object keys stable.
    const shorthand = new Set();
    walk.full(parsed.ast, node => {
        if (node.type === "Property" && node.shorthand && node.key.name === from) shorthand.add(node.value.start);
    });
    let result = code;
    [...new Map(spots.map(node => [node.start, node])).values()].sort((a, b) => b.start - a.start).forEach(node => {
        const replacement = shorthand.has(node.start) ? `${from}: ${to}` : to;
        result = result.slice(0, node.start) + replacement + result.slice(node.end);
    });
    return { code: result, count: spots.length };
}

export function createWorkspace(question = "") {
    const files = seedFiles(question);
    const commits = [{ id: 0, message: "original code from the user", snapshot: new Map(files) }];

    const commit = message => {
        commits.push({ id: commits.length, message: String(message || "edit").slice(0, 120), snapshot: new Map(files) });
        return commits.length - 1;
    };
    const pick = path => {
        if (path && files.has(path)) return path;
        if (files.size === 1 || !path) return files.keys().next().value;
        const loose = [...files.keys()].find(name => name.endsWith(path) || path.endsWith(name));
        return loose || null;
    };
    const check = (path, code) => /\.(m?js|jsx|cjs)$/.test(path) ? (parseJs(code).error || "parses OK") : "not parsed (not JavaScript)";

    return {
        get size() { return files.size; },
        get changed() { return commits.length > 1; },

        run(args = {}) {
            const action = String(args.action || "list").toLowerCase();
            if (!files.size && action !== "write") {
                return { error: "No code in the user's message. Use action write to add a file first." };
            }
            if (action === "list") {
                return { files: [...files.entries()].map(([path, code]) => ({ path, lines: code.split("\n").length })), head: commits.length - 1 };
            }
            if (action === "log") {
                return { commits: commits.map(item => `#${item.id} ${item.message}`) };
            }
            const path = pick(args.path);
            if (action === "write") {
                const target = args.path || "main.js";
                files.set(target, String(args.content || ""));
                return { commit: commit(args.message || `write ${target}`), path: target, syntax: check(target, files.get(target)) };
            }
            if (!path) {
                return { error: `File not found. Files: ${[...files.keys()].join(", ")}` };
            }
            const code = files.get(path);
            if (action === "read") {
                return { path, code: code.split("\n").map((line, index) => `${index + 1}| ${line}`).join("\n").slice(0, 12000) };
            }
            if (action === "analyze") {
                return { path, ...(/\.(m?js|jsx|cjs)$/.test(path) ? analyzeJs(code) : analyzeOther(path, code)) };
            }
            if (action === "edit") {
                const find = String(args.find ?? "");
                if (!find) return { error: "find text is required." };
                const count = code.split(find).length - 1;
                if (count === 0) return { error: "find text not found exactly. Use action read to see the exact lines." };
                if (count > 1 && !args.all) return { error: `find text appears ${count} times; give more context or set all=true.` };
                const next = args.all ? code.split(find).join(String(args.replace ?? "")) : code.replace(find, () => String(args.replace ?? ""));
                files.set(path, next);
                return { commit: commit(args.message || `edit ${path}`), path, replaced: args.all ? count : 1, syntax: check(path, next), diff: lineDiff(code, next, path) };
            }
            if (action === "rename") {
                if (!/\.(m?js|jsx|cjs)$/.test(path)) return { error: "AST rename works on JavaScript files only; use edit." };
                const { code: next, count } = renameIdentifier(code, String(args.from || ""), String(args.to || ""));
                if (!count) return { error: `Identifier ${args.from} not found.` };
                files.set(path, next);
                return { commit: commit(args.message || `rename ${args.from} -> ${args.to}`), path, renamed: count, syntax: check(path, next) };
            }
            if (action === "diff") {
                const fromId = Math.max(0, Math.min(commits.length - 1, Number(args.version ?? 0) || 0));
                return { path, from_commit: fromId, diff: lineDiff(commits[fromId].snapshot.get(path) || "", code, path) };
            }
            if (action === "revert") {
                const id = Number(args.version);
                const target = commits[id];
                if (!target) return { error: `No commit #${args.version}. Use log.` };
                files.clear();
                target.snapshot.forEach((value, key) => files.set(key, value));
                return { commit: commit(`revert to #${id}`), files: [...files.keys()] };
            }
            return { error: "Unknown action. Use list, read, analyze, edit, rename, write, diff, log, revert." };
        },

        report() {
            if (commits.length < 2) return "";
            const original = commits[0].snapshot;
            const parts = [...files.entries()].map(([path, code]) => {
                const before = original.get(path);
                if (before === code) return "";
                const lang = path.split(".").pop();
                return `File ${path} (${check(path, code)}):\nCHANGES:\n${lineDiff(before || "", code, path)}\nFINAL CODE:\n\`\`\`${lang}\n${code.slice(0, 20000)}\`\`\``;
            }).filter(Boolean);
            return parts.length ? `=== CODE WORKSPACE (commits: ${commits.map(item => `#${item.id} ${item.message}`).join("; ")}) ===\n${parts.join("\n\n")}` : "";
        }
    };
}

/* =========================================================
   2) PROBABILITY ENGINE
   ========================================================= */

// Safe expression compiler: numbers, variables, + - * / % ^, comparisons,
// && || !, ?:, and a few functions. No eval / Function.
const FUNCS = { min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, log: Math.log, ln: Math.log, log10: Math.log10, exp: Math.exp, round: Math.round, floor: Math.floor, ceil: Math.ceil, pow: Math.pow, sin: Math.sin, cos: Math.cos };

export function compileExpression(source = "") {
    const tokens = String(source).match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_]\w*|>=|<=|==|!=|&&|\|\||[-+*/%^()<>!?:,]/gi) || [];
    if (tokens.join("").replace(/\s/g, "") !== String(source).replace(/\s/g, "")) {
        throw new Error(`Bad character in expression: ${source}`);
    }
    let pos = 0;
    const peek = () => tokens[pos];
    const eat = token => {
        if (tokens[pos] !== token) throw new Error(`Expected '${token}' in ${source}`);
        pos += 1;
    };
    const binary = (next, ops) => () => {
        let left = next();
        while (ops[peek()]) {
            const op = ops[tokens[pos++]];
            const right = next();
            const l = left;
            left = env => op(l(env), right(env));
        }
        return left;
    };
    const primary = () => {
        const token = tokens[pos++];
        if (token === undefined) throw new Error("Expression ended early.");
        if (token === "(") { const inner = ternary(); eat(")"); return inner; }
        if (token === "-") { const value = power(); return env => -value(env); }
        if (token === "+") return power();
        if (token === "!") { const value = power(); return env => (value(env) ? 0 : 1); }
        if (/^\d/.test(token)) { const value = Number(token); return () => value; }
        if (/^[A-Za-z_]/.test(token)) {
            if (peek() === "(") {
                const fn = FUNCS[token.toLowerCase()];
                if (!fn) throw new Error(`Unknown function ${token}`);
                eat("(");
                const args = [];
                if (peek() !== ")") {
                    args.push(ternary());
                    while (peek() === ",") { pos += 1; args.push(ternary()); }
                }
                eat(")");
                return env => fn(...args.map(arg => arg(env)));
            }
            if (/^pi$/i.test(token)) return () => Math.PI;
            if (/^e$/.test(token)) return () => Math.E;
            return env => {
                if (!(token in env)) throw new Error(`Unknown variable ${token}`);
                return env[token];
            };
        }
        throw new Error(`Unexpected '${token}'`);
    };
    const power = () => {
        const base = primary();
        if (peek() === "^") { pos += 1; const exponent = unaryPower(); return env => Math.pow(base(env), exponent(env)); }
        return base;
    };
    const unaryPower = () => power();
    const mul = binary(power, { "*": (a, b) => a * b, "/": (a, b) => a / b, "%": (a, b) => a % b });
    const add = binary(mul, { "+": (a, b) => a + b, "-": (a, b) => a - b });
    const cmp = binary(add, { ">": (a, b) => +(a > b), "<": (a, b) => +(a < b), ">=": (a, b) => +(a >= b), "<=": (a, b) => +(a <= b), "==": (a, b) => +(a === b), "!=": (a, b) => +(a !== b) });
    const and = binary(cmp, { "&&": (a, b) => +(a && b) });
    const or = binary(and, { "||": (a, b) => +(a || b) });
    const ternary = () => {
        const test = or();
        if (peek() === "?") {
            pos += 1;
            const yes = ternary();
            eat(":");
            const no = ternary();
            return env => (test(env) ? yes(env) : no(env));
        }
        return test;
    };
    const expression = ternary();
    if (pos !== tokens.length) throw new Error(`Unexpected '${tokens[pos]}' in ${source}`);
    return expression;
}

// Seeded random for repeatable results.
function rng(seed = 12345) {
    let s = seed >>> 0;
    return () => {
        s += 0x6D2B79F5;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function normal(random) {
    let u = 0;
    while (u === 0) u = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function gamma(shape, random) {
    if (shape < 1) return gamma(shape + 1, random) * Math.pow(random(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
        let x;
        let v;
        do { x = normal(random); v = 1 + c * x; } while (v <= 0);
        v = v * v * v;
        const u = random();
        if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
}

function sampler(spec = {}, random) {
    const dist = String(spec.dist || spec.type || "normal").toLowerCase();
    const p = spec;
    const num = (key, fallback) => (Number.isFinite(Number(p[key])) ? Number(p[key]) : fallback);
    switch (dist) {
        case "constant": case "fixed": { const v = num("value", 0); return () => v; }
        case "uniform": { const a = num("min", 0); const b = num("max", 1); return () => a + (b - a) * random(); }
        case "normal": case "gaussian": { const m = num("mean", 0); const s = num("sd", num("std", 1)); return () => m + s * normal(random); }
        case "lognormal": { const m = num("mu", 0); const s = num("sigma", 1); return () => Math.exp(m + s * normal(random)); }
        case "triangular": {
            const a = num("min", 0); const b = num("max", 1); const c = num("mode", (a + b) / 2);
            return () => { const u = random(); const f = (c - a) / (b - a); return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c)); };
        }
        case "bernoulli": { const q = num("p", 0.5); return () => (random() < q ? 1 : 0); }
        case "binomial": { const n = Math.min(10000, Math.round(num("n", 10))); const q = num("p", 0.5); return () => { let k = 0; for (let i = 0; i < n; i += 1) if (random() < q) k += 1; return k; }; }
        case "poisson": { const l = num("lambda", 1); return () => { const L = Math.exp(-l); let k = 0; let prod = random(); while (prod > L) { k += 1; prod *= random(); } return k; }; }
        case "exponential": { const rate = num("rate", 1); return () => -Math.log(1 - random()) / rate; }
        case "beta": { const a = num("a", 1); const b = num("b", 1); return () => { const x = gamma(a, random); return x / (x + gamma(b, random)); }; }
        case "choice": case "discrete": {
            const values = (p.values || []).map(Number);
            const weights = (p.weights || values.map(() => 1)).map(Number);
            const total = weights.reduce((sum, w) => sum + w, 0);
            return () => { let r = random() * total; for (let i = 0; i < values.length; i += 1) { r -= weights[i]; if (r <= 0) return values[i]; } return values[values.length - 1]; };
        }
        default: throw new Error(`Unknown distribution ${dist}. Use normal, uniform, lognormal, triangular, bernoulli, binomial, poisson, exponential, beta, choice, constant.`);
    }
}

function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const index = (sorted.length - 1) * q;
    const low = Math.floor(index);
    return sorted[low] + (sorted[Math.min(sorted.length - 1, low + 1)] - sorted[low]) * (index - low);
}

const round = (value, digits = 6) => (Number.isFinite(value) ? Number(value.toPrecision(digits)) : value);

export function runProbability(args = {}) {
    const mode = String(args.mode || "").toLowerCase();

    if (mode === "bayes") {
        // Hypotheses with prior and likelihood(s) of the evidence.
        let hypotheses = Array.isArray(args.hypotheses) ? args.hypotheses : null;
        if (!hypotheses && args.prior != null) {
            const prior = Number(args.prior);
            const sens = Number(args.likelihood ?? args.sensitivity);
            const fp = args.false_positive != null ? Number(args.false_positive) : 1 - Number(args.specificity);
            hypotheses = [{ name: args.name || "H (true)", prior, likelihoods: [sens] }, { name: "not H", prior: 1 - prior, likelihoods: [fp] }];
        }
        if (!hypotheses?.length) return { error: "Give hypotheses [{name, prior, likelihoods:[P(evidence|H)...]}] or prior + likelihood + false_positive." };
        const rows = hypotheses.map(item => {
            const likes = (Array.isArray(item.likelihoods) ? item.likelihoods : [item.likelihood]).map(Number);
            const joint = Number(item.prior) * likes.reduce((product, value) => product * value, 1);
            return { name: String(item.name), prior: Number(item.prior), likelihood: likes, joint };
        });
        if (rows.some(row => !Number.isFinite(row.joint) || row.joint < 0)) return { error: "Priors and likelihoods must be numbers between 0 and 1." };
        const evidence = rows.reduce((sum, row) => sum + row.joint, 0);
        if (!evidence) return { error: "Evidence has zero probability under every hypothesis." };
        return {
            mode,
            p_evidence: round(evidence),
            posteriors: rows.map(row => ({ name: row.name, prior: row.prior, posterior: round(row.joint / evidence), posterior_percent: `${round((row.joint / evidence) * 100, 4)}%` })).sort((a, b) => b.posterior - a.posterior),
            note: "Exact Bayes' rule: posterior = prior x likelihood / P(evidence)."
        };
    }

    if (mode === "beta_update") {
        const a = Number(args.prior_a ?? 1) + Number(args.successes ?? 0);
        const b = Number(args.prior_b ?? 1) + Number(args.failures ?? 0);
        if (!(a > 0 && b > 0)) return { error: "successes/failures must be >= 0." };
        const random = rng(7);
        const draws = Array.from({ length: 20000 }, () => { const x = gamma(a, random); return x / (x + gamma(b, random)); }).sort((x, y) => x - y);
        const threshold = args.threshold != null ? Number(args.threshold) : null;
        return {
            mode,
            posterior: `Beta(${a}, ${b})`,
            mean: round(a / (a + b)),
            mode_value: a > 1 && b > 1 ? round((a - 1) / (a + b - 2)) : null,
            credible_95: [round(quantile(draws, 0.025), 4), round(quantile(draws, 0.975), 4)],
            ...(threshold != null ? { p_rate_above_threshold: round(draws.filter(x => x > threshold).length / draws.length, 4) } : {}),
            note: "Bayesian update of a success rate (Beta-Binomial). Interval from 20,000 posterior samples."
        };
    }

    if (mode === "simulate") {
        let variables = args.variables;
        if (typeof variables === "string") {
            try {
                variables = JSON.parse(variables);
            } catch {
                return { error: "variables must be valid JSON, e.g. {\"x\":{\"dist\":\"normal\",\"mean\":0,\"sd\":1}}" };
            }
        }
        variables = variables && typeof variables === "object" ? variables : {};
        const names = Object.keys(variables).filter(name => /^[A-Za-z_]\w*$/.test(name)).slice(0, 25);
        if (!names.length || !args.formula) return { error: "Give variables {name: {dist, ...params}} and a formula." };
        const samples = Math.max(1000, Math.min(50000, Number(args.samples) || 20000));
        const random = rng(Number(args.seed) || 12345);
        const draw = Object.fromEntries(names.map(name => [name, sampler(variables[name], random)]));
        const formula = compileExpression(args.formula);
        const condition = args.condition ? compileExpression(args.condition) : null;
        const values = [];
        let hits = 0;
        for (let i = 0; i < samples; i += 1) {
            const env = {};
            names.forEach(name => { env[name] = draw[name](); });
            const value = formula(env);
            if (Number.isFinite(value)) values.push(value);
            if (condition) {
                env.result = value;
                if (condition(env)) hits += 1;
            }
        }
        values.sort((a, b) => a - b);
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1));
        return {
            mode,
            samples: values.length,
            formula: args.formula,
            mean: round(mean),
            median: round(quantile(values, 0.5)),
            sd: round(sd),
            p5: round(quantile(values, 0.05)),
            p95: round(quantile(values, 0.95)),
            min: round(values[0]),
            max: round(values[values.length - 1]),
            ...(condition ? { condition: args.condition, probability: round(hits / samples, 4), probability_percent: `${round((hits / samples) * 100, 4)}%` } : {}),
            note: "Monte Carlo simulation (seeded, repeatable). Results are estimates; more samples = more precise."
        };
    }

    return { error: "mode must be bayes, beta_update or simulate." };
}

/* =========================================================
   3) KNOWLEDGE GRAPH / MIND MAP
   ========================================================= */

const keyOf = text => String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
const SINGLE_VALUE = /^(is|was|equals|costs?|price|born|died|founded|ceo|capital|population|date|located in|height|weight|age|net worth|rate|value|released|launch(ed)? date)$/i;

export function createGraph() {
    const nodes = new Map();
    const edges = [];

    const node = name => {
        const key = keyOf(name);
        if (!nodes.has(key)) nodes.set(key, { name: String(name).trim().slice(0, 80), degree: 0 });
        return key;
    };

    const neighbors = key => edges.filter(edge => edge.from === key || edge.to === key);

    const conflicts = () => {
        const groups = new Map();
        edges.forEach(edge => {
            if (!SINGLE_VALUE.test(edge.relation)) return;
            const group = `${edge.from}|${keyOf(edge.relation)}`;
            if (!groups.has(group)) groups.set(group, new Set());
            groups.get(group).add(`${nodes.get(edge.to).name}${edge.source ? ` [${edge.source}]` : ""}`);
        });
        return [...groups.entries()]
            .filter(([group, values]) => new Set([...values].map(value => keyOf(value.replace(/\s*\[.*\]$/, "")))).size > 1)
            .map(([group, values]) => `${nodes.get(group.split("|")[0]).name} ${group.split("|")[1]}: ${[...values].join(" vs ")}`);
    };

    const tree = (rootKey, depth = 3) => {
        const lines = [];
        const seen = new Set([rootKey]);
        const usedEdges = new Set();
        const visit = (key, level) => {
            if (level > depth || lines.length > 60) return;
            neighbors(key).forEach(edge => {
                if (usedEdges.has(edge)) return;
                usedEdges.add(edge);
                const other = edge.from === key ? edge.to : edge.from;
                const label = edge.from === key ? edge.relation : `(${edge.relation} of)`;
                const line = `${"  ".repeat(level)}- ${label}: ${nodes.get(other).name}${edge.source ? ` [${edge.source}]` : ""}`;
                lines.push(line);
                if (!seen.has(other)) {
                    seen.add(other);
                    visit(other, level + 1);
                }
            });
        };
        lines.push(`- ${nodes.get(rootKey).name}`);
        visit(rootKey, 1);
        return lines.join("\n");
    };

    const center = () => [...nodes.entries()].sort((a, b) => b[1].degree - a[1].degree)[0]?.[0];

    return {
        get size() { return edges.length; },

        run(args = {}) {
            const action = String(args.action || "add").toLowerCase();
            if (action === "add") {
                const facts = Array.isArray(args.facts) ? args.facts.slice(0, 60) : [];
                let added = 0;
                facts.forEach(fact => {
                    if (!fact?.subject || !fact?.relation || fact?.object == null) return;
                    const from = node(fact.subject);
                    const to = node(String(fact.object));
                    const relation = String(fact.relation).slice(0, 60);
                    if (edges.some(edge => edge.from === from && edge.to === to && keyOf(edge.relation) === keyOf(relation))) return;
                    edges.push({ from, to, relation, source: String(fact.source || "").slice(0, 60) });
                    nodes.get(from).degree += 1;
                    nodes.get(to).degree += 1;
                    added += 1;
                });
                return { added, nodes: nodes.size, edges: edges.length, conflicts: conflicts() };
            }
            if (action === "query") {
                const key = keyOf(args.entity);
                const found = nodes.has(key) ? key : [...nodes.keys()].find(item => item.includes(key) || key.includes(item));
                if (!found) return { error: `No node like '${args.entity}'.` };
                return { entity: nodes.get(found).name, mind_map: tree(found, 2) };
            }
            if (action === "path") {
                const start = keyOf(args.from);
                const goal = keyOf(args.to);
                if (!nodes.has(start) || !nodes.has(goal)) return { error: "Both entities must be in the graph." };
                const previous = new Map([[start, null]]);
                const queue = [start];
                while (queue.length) {
                    const current = queue.shift();
                    if (current === goal) break;
                    neighbors(current).forEach(edge => {
                        const other = edge.from === current ? edge.to : edge.from;
                        if (!previous.has(other)) { previous.set(other, { from: current, edge }); queue.push(other); }
                    });
                }
                if (!previous.has(goal)) return { path: null, note: "Not connected." };
                const steps = [];
                for (let at = goal; previous.get(at); at = previous.get(at).from) {
                    const { edge } = previous.get(at);
                    steps.unshift(`${nodes.get(edge.from).name} --${edge.relation}--> ${nodes.get(edge.to).name}`);
                }
                return { path: steps };
            }
            if (action === "summary" || action === "map") {
                const root = args.entity ? keyOf(args.entity) : center();
                if (!root || !nodes.has(root)) return { error: "Graph is empty." };
                return { center: nodes.get(root).name, nodes: nodes.size, edges: edges.length, mind_map: tree(root, 3), conflicts: conflicts() };
            }
            return { error: "action must be add, query, path or summary." };
        },

        report() {
            if (!edges.length) return "";
            const root = center();
            const issues = conflicts();
            return `=== KNOWLEDGE MAP (${nodes.size} items, ${edges.length} links) ===\n${tree(root, 3)}` +
                (issues.length ? `\nCONFLICTS (sources disagree; say so or use the newest/most official): \n- ${issues.join("\n- ")}` : "");
        }
    };
}
