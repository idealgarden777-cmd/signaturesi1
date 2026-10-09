import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    parseVisualSource,
    normalizeVisual,
    layoutVisual,
    visualToText,
    wrapText,
    remapColor,
    safeStyle,
    VISUAL_TYPES
} from "../public/js/components/visual-core.js";
import { VISUAL_RULE, VISUAL_DRAW_RULE, wantsVisual } from "../lib/visuals.js";

const SAMPLES = {
    flow: { type: "flow", items: [{ id: "a", label: "Start" }, { id: "b", label: "Ready?", shape: "diamond" }, { id: "c", label: "Go" }, { id: "d", label: "Wait" }], edges: [["a", "b"], ["b", "c", "Yes"], ["b", "d", "No"], ["d", "b"]] },
    steps: { type: "steps", items: ["Plan", "Build", "Test"] },
    timeline: { type: "timeline", items: [{ date: "1947", label: "Independence" }, { date: "1973", label: "Constitution" }] },
    cycle: { type: "cycle", center: "Water", items: ["Evaporation", "Condensation", "Rain", "Collection"] },
    tree: { type: "tree", root: { label: "AI", children: [{ label: "ML", children: ["Supervised", "Unsupervised"] }, "Rules"] } },
    mindmap: { type: "mindmap", center: "Study", children: ["A", "B", { label: "C", children: ["c1"] }, "D"] },
    pyramid: { type: "pyramid", items: [{ label: "Self-actualization", sub: "growth" }, "Esteem", "Love", "Safety", "Body"] },
    funnel: { type: "funnel", items: [{ label: "Visit", value: "10k" }, { label: "Pay", value: "90" }] },
    venn: { type: "venn", items: [{ label: "Cats", items: ["quiet"] }, { label: "Dogs" }, { label: "Birds" }], both: ["pets"], all: ["animals"] },
    layers: { type: "layers", items: [{ label: "UI", sub: "html" }, { label: "DB" }] },
    stats: { type: "stats", items: [{ value: "72%", label: "Users" }, { value: "4.8", label: "Rating" }] }
};

function finite(scene) {
    const bad = [];
    for (const it of scene.items) {
        for (const [k, v] of Object.entries(it)) {
            if (typeof v === "number" && !Number.isFinite(v)) bad.push(`${it.t}.${k}`);
        }
        if (it.points) it.points.flat().forEach(v => { if (!Number.isFinite(v)) bad.push("points"); });
        if (it.d && /NaN|Infinity/.test(it.d)) bad.push("d");
    }
    return bad;
}

test("visuals: every layout draws, at phone and desktop width", () => {
    assert.equal(Object.keys(SAMPLES).length, VISUAL_TYPES.length);
    for (const [type, raw] of Object.entries(SAMPLES)) {
        for (const width of [320, 540, 720]) {
            const parsed = parseVisualSource(JSON.stringify(raw));
            assert.equal(parsed.kind, "spec", type);
            const scene = layoutVisual(parsed.spec, undefined, { width });
            assert.ok(scene && scene.items.length > 2, `${type} has shapes`);
            assert.ok(scene.width > 0 && scene.height > 0, `${type} has a size`);
            assert.deepEqual(finite(scene), [], `${type} numbers are finite`);
            assert.ok(scene.steps.length >= 2, `${type} has steps for Play`);
        }
    }
});

test("visuals: flow boxes never overlap", () => {
    const spec = normalizeVisual({ type: "flow", items: ["One", "Two", "Three", "Four", "Five"].map((label, i) => ({ id: String(i), label })), edges: [["0", "1"], ["0", "2"], ["0", "3"], ["1", "4"], ["2", "4"], ["3", "4"]] });
    const scene = layoutVisual(spec, undefined, { width: 540 });
    const boxes = scene.items.filter(it => it.t === "rect" && /nv-node/.test(it.cls));
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
            assert.ok(apart, `box ${i} and ${j} overlap`);
        }
    }
});

test("visuals: messy model output still works", () => {
    // aliases, trailing commas, plain strings, edges to unknown ids
    assert.equal(parseVisualSource('{"type":"flowchart","items":["A","B",],"edges":[["A","C"]],}').kind, "spec");
    assert.equal(parseVisualSource('{"type":"process","steps":["x","y"]}').spec.type, "steps");
    assert.equal(parseVisualSource('{"type":"flow","items":[').kind, "partial");
    assert.equal(parseVisualSource('{"type":"unknown"}').kind, "bad");
    assert.equal(parseVisualSource("<svg viewBox='0 0 10 10'><rect/></svg>").kind, "svg");
    assert.equal(parseVisualSource("<svg viewBox='0 0 10 10'><rect/>").kind, "partial");
    const chain = normalizeVisual({ type: "flow", items: ["a", "b", "c"] });
    assert.equal(chain.edges.length, 2, "a list with no edges becomes a chain");
    const text = visualToText(normalizeVisual(SAMPLES.timeline));
    assert.match(text, /1947 · Independence/);
});

test("visuals: long words wrap without spilling", () => {
    const lines = wrapText("Supercalifragilisticexpialidocious is long", 80, 14, 600);
    assert.ok(lines.length >= 2);
    assert.ok(lines.length <= 4);
});

test("visuals: raw svg colours follow the theme, styles can't load anything", () => {
    assert.equal(remapColor("#000"), "var(--nv-strong)");
    assert.equal(remapColor("#ffffff"), "var(--nv-bg)");
    assert.equal(remapColor("#333", "fill", true), "var(--nv-strong)");
    assert.equal(remapColor("#f5b400"), null, "real colours stay");
    assert.equal(remapColor("url(#g1)"), null);
    assert.equal(safeStyle("fill:url(https://evil.example/x.png)"), "fill:none");
    assert.equal(safeStyle("fill:url(#grad)"), "fill:url(#grad)");
    assert.equal(safeStyle("background:expression(alert(1))"), "");
});

test("visuals: the model gets the rules, sandbox list is strict", () => {
    assert.match(VISUAL_RULE, /neyo-visual/);
    assert.match(VISUAL_DRAW_RULE, /script, style, foreignObject/);
    assert.equal(wantsVisual("photosynthesis kaise hota hai samjhao"), true);
    assert.equal(wantsVisual("water cycle explain karo"), true);
    assert.equal(wantsVisual("hi"), false);
    const chat = readFileSync(new URL("../api/chat.js", import.meta.url), "utf8");
    assert.match(chat, /wantsVisual\(userText\)/);
    const client = readFileSync(new URL("../public/js/components/visuals.js", import.meta.url), "utf8");
    const allowed = client.match(/const ALLOWED = new Set\(\[([^\]]+)\]/)[1];
    for (const bad of ["script", "foreignobject", "image", "style", "iframe", "a\""]) {
        assert.ok(!allowed.includes(`"${bad.replace('"', "")}"`), bad);
    }
    assert.match(client, /name\.startsWith\("on"\)/);
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    assert.match(html, /\/js\/components\/visuals\.js\?v=\d+/);
    assert.match(html, /\/css\/components\/visuals\.css\?v=\d+/);
});
