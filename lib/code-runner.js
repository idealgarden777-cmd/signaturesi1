/* =========================================================
   NEYO CODE RUNNER
   Runs user JavaScript inside a QuickJS WebAssembly sandbox:
   no file system, no network, no Node APIs, memory + time
   limits. Used by the code doctor to PROVE a bug and a fix
   with real test runs.
   ========================================================= */

import {
    newQuickJSWASMModuleFromVariant,
    shouldInterruptAfterDeadline
} from "quickjs-emscripten-core";
import releaseSyncVariant from "@jitl/quickjs-wasmfile-release-sync";

let quickJsPromise = null;

function getQuickJs() {
    if (!quickJsPromise) {
        quickJsPromise = newQuickJSWASMModuleFromVariant(releaseSyncVariant).catch(error => {
            quickJsPromise = null;
            throw error;
        });
    }
    return quickJsPromise;
}

// Turn browser/ESM code into something a plain script can run.
export function prepareJs(code = "") {
    const blockers = [];
    let source = String(code);
    if (/^\s*import\s[^;]*from\s/m.test(source) || /\brequire\(\s*["']/.test(source)) {
        blockers.push("imports other modules");
    }
    if (/<[A-Za-z][\w-]*[\s>/]/.test(source) && /return\s*\(?\s*</.test(source)) {
        blockers.push("JSX");
    }
    if (/:\s*(string|number|boolean|any|void)\b|\binterface\s+\w+|<\w+>\s*\(/.test(source) && /\btype\s+\w+\s*=|\binterface\b|\):\s*\w+/.test(source)) {
        blockers.push("TypeScript types");
    }
    source = source
        .replace(/^\s*export\s+default\s+/gm, "")
        .replace(/^\s*export\s+(?=(async\s+)?function|const|let|var|class)/gm, "")
        .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "");
    return { source, blockers };
}

// Light browser stubs so pure logic in front-end files can still be tested.
const PRELUDE = `
var __logs = [];
var __fmt = function (v) {
  if (typeof v === "string") return v;
  try { return __show(v); } catch (e) { return String(v); }
};
var __show = function (v) {
  if (v === undefined) return "undefined";
  if (typeof v === "number" && v !== v) return "NaN";
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  if (typeof v === "function") return "[Function]";
  if (typeof v === "bigint") return v + "n";
  if (v instanceof Error) return v.name + ": " + v.message;
  if (typeof v === "object" && v !== null) {
    var seen = [];
    return JSON.stringify(v, function (k, x) {
      if (x === undefined) return "__undefined__";
      if (typeof x === "number" && x !== x) return "__NaN__";
      if (typeof x === "object" && x !== null) { if (seen.indexOf(x) >= 0) return "[Circular]"; seen.push(x); }
      if (x instanceof Map) return { Map: Array.from(x.entries()) };
      if (x instanceof Set) return { Set: Array.from(x.values()) };
      return x;
    }).replace(/"__undefined__"/g, "undefined").replace(/"__NaN__"/g, "NaN");
  }
  return JSON.stringify(v);
};
var console = {
  log: function () { __logs.push(Array.prototype.map.call(arguments, __fmt).join(" ")); },
  info: function () { console.log.apply(null, arguments); },
  warn: function () { console.log.apply(null, arguments); },
  error: function () { console.log.apply(null, arguments); },
  table: function (x) { console.log(x); }
};
var __results = [];
var __test = function (name, actualFn, expectedFn) {
  var expected, actual, ok = false, error = "";
  try { expected = expectedFn(); } catch (e) { error = "bad expected value: " + e; }
  var wantThrow = expected === "__THROWS__";
  try {
    actual = actualFn();
    if (actual && typeof actual.then === "function") { actual = "[Promise]"; }
    ok = !error && !wantThrow && __show(actual) === __show(expected);
  } catch (e) {
    actual = "THROWS " + (e && e.name ? e.name + ": " + e.message : String(e));
    ok = wantThrow;
  }
  __results.push({ name: String(name), ok: ok, actual: __show(actual).slice(0, 300), expected: wantThrow ? "throws an error" : __show(expected).slice(0, 300), error: error });
};
`;

function runScript(QuickJS, script, timeoutMs, memoryMb) {
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(memoryMb * 1024 * 1024);
    runtime.setMaxStackSize(1024 * 1024);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));
    const context = runtime.newContext();
    try {
        const result = context.evalCode(script, "user-code.js");
        let error = "";
        if (result.error) {
            const dumped = context.dump(result.error);
            result.error.dispose();
            error = dumped && typeof dumped === "object"
                ? `${dumped.name || "Error"}: ${dumped.message || JSON.stringify(dumped)}${dumped.stack ? `\n${String(dumped.stack).split("\n").slice(0, 3).join("\n")}` : ""}`
                : String(dumped);
            if (/interrupted/i.test(error)) {
                error = `Timeout: stopped after ${timeoutMs} ms (infinite loop or very slow code).`;
            }
        } else {
            result.value.dispose();
        }
        try {
            runtime.executePendingJobs(100);
        } catch {
            // ignore
        }
        const read = context.evalCode("JSON.stringify({ logs: __logs.slice(0, 50), results: __results })");
        let state = { logs: [], results: [] };
        if (!read.error) {
            try {
                state = JSON.parse(context.dump(read.value));
            } catch {
                // ignore
            }
            read.value.dispose();
        } else {
            read.error.dispose();
        }
        return { error, ...state };
    } finally {
        context.dispose();
        runtime.dispose();
    }
}

/**
 * Run code + tests. Each test: { name, call, expected } where call and
 * expected are JS expressions (expected "THROWS" means it should throw).
 * Every test runs in a fresh sandbox, so one crash never hides another.
 */
export async function runJsTests(code = "", tests = [], { timeoutMs = 1500, memoryMb = 32 } = {}) {
    const started = Date.now();
    const prepared = prepareJs(code);
    if (prepared.blockers.length) {
        return { ran: false, reason: `cannot run in sandbox (${prepared.blockers.join(", ")})` };
    }
    let QuickJS;
    try {
        QuickJS = await getQuickJs();
    } catch (error) {
        return { ran: false, reason: `sandbox failed to start: ${error?.message || error}` };
    }

    // 1) Load the code once on its own: syntax/top-level errors + console output.
    const load = runScript(QuickJS, `${PRELUDE}\n${prepared.source}`, timeoutMs, memoryMb);

    // 2) Each test in a fresh sandbox.
    const results = [];
    for (const test of (Array.isArray(tests) ? tests : []).slice(0, 15)) {
        if (Date.now() - started > 8000) {
            break;
        }
        const call = String(test?.call || "").trim();
        if (!call) {
            continue;
        }
        const expected = /^\s*["']?THROWS["']?\s*$/i.test(String(test?.expected ?? "")) ? '"__THROWS__"' : String(test?.expected ?? "undefined");
        const script = `${PRELUDE}\n${prepared.source}\n;__test(${JSON.stringify(String(test?.name || call).slice(0, 120))}, function () { return (${call}); }, function () { return (${expected}); });`;
        const run = runScript(QuickJS, script, timeoutMs, memoryMb);
        const row = run.results?.[0];
        results.push(row || {
            name: String(test?.name || call).slice(0, 120),
            ok: false,
            actual: run.error ? `CRASH ${run.error.split("\n")[0]}` : "no result",
            expected: String(test?.expected ?? ""),
            error: run.error
        });
    }

    return {
        ran: true,
        loadError: load.error,
        logs: load.logs || [],
        results,
        passed: results.filter(row => row.ok).length,
        total: results.length,
        ms: Date.now() - started
    };
}

export function formatTestRun(label, run) {
    if (!run) {
        return `${label}: not run.`;
    }
    if (!run.ran) {
        return `${label}: NOT RUN (${run.reason}).`;
    }
    const lines = [`${label}: ${run.passed}/${run.total} tests passed${run.loadError ? ` | loading the code crashed: ${run.loadError.split("\n")[0]}` : ""}`];
    run.results.forEach(row => {
        lines.push(`  ${row.ok ? "PASS" : "FAIL"} ${row.name} -> got ${row.actual}${row.ok ? "" : `, expected ${row.expected}`}`);
    });
    if (run.logs?.length) {
        lines.push(`  console: ${run.logs.slice(0, 5).join(" | ").slice(0, 400)}`);
    }
    return lines.join("\n");
}
