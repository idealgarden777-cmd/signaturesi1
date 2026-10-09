/*
=========================================================
NEYO — VISUAL INTELLIGENCE core v1 (pure: no DOM, tested in Node)

NEYO answers with a ```neyo-visual block. Two kinds:
1. A JSON spec; we do the layout, so boxes never overlap and
   every visual looks like NEYO:
   flow · steps · timeline · cycle · tree · mindmap · pyramid ·
   funnel · venn · layers · stats
2. Raw <svg> for free drawings (sanitised in visuals.js; colours
   remapped to the theme with remapColor here).

layoutVisual(spec, measure) returns a "scene": shapes with
x/y, a CSS class, a step number (for Play / step-by-step) and
an optional tip. visuals.js turns the scene into SVG nodes.
=========================================================
*/

export const VISUAL_TYPES = ["flow", "steps", "timeline", "cycle", "tree", "mindmap", "pyramid", "funnel", "venn", "layers", "stats"];
const ALIASES = {
    flowchart: "flow", diagram: "flow", graph: "flow", process: "steps", sequence: "steps", history: "timeline",
    loop: "cycle", circle: "cycle", hierarchy: "tree", org: "tree", orgchart: "tree", "mind-map": "mindmap", mind: "mindmap",
    stack: "layers", architecture: "layers", levels: "pyramid", sets: "venn", numbers: "stats", infographic: "stats", kpi: "stats"
};
export const TONES = ["accent", "good", "bad", "warn", "muted", "c1", "c2", "c3", "c4", "c5"];
const LIMIT = { nodes: 40, edges: 60, items: 12, depth: 4, children: 8, text: 140, sub: 220, note: 400 };

let W = 720; // design width = the chat column (320-720); the SVG scales from there

/* ---------------- text ---------------- */

export function clean(value, max = LIMIT.text) {
    return String(value ?? "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}

function approxMeasure(text, size = 14, weight = 400) {
    let w = 0;
    for (const ch of String(text)) {
        if (/[ilI.,:;'|!]/.test(ch)) w += 0.3;
        else if (/[mwMW@%]/.test(ch)) w += 0.85;
        else if (/[A-Z0-9]/.test(ch)) w += 0.64;
        else if (ch === " ") w += 0.3;
        else if (ch.charCodeAt(0) > 0x2e80) w += 1;
        else w += 0.53;
    }
    return w * size * (weight >= 600 ? 1.06 : 1);
}

export function wrapText(text, maxWidth, size = 14, weight = 400, measure = approxMeasure, maxLines = 4) {
    const words = clean(text, 400).split(" ").filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (!line || measure(next, size, weight) <= maxWidth) {
            line = next;
            // one very long word: cut it
            while (measure(line, size, weight) > maxWidth && line.length > 4) {
                let cut = line.length - 1;
                while (cut > 1 && measure(line.slice(0, cut), size, weight) > maxWidth) cut--;
                lines.push(line.slice(0, cut));
                line = line.slice(cut);
            }
        } else {
            lines.push(line);
            line = word;
        }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
        const kept = lines.slice(0, maxLines);
        kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S{0,3}$/, "") + "…";
        return kept;
    }
    return lines;
}

const LABEL = { size: 14, weight: 600, lh: 18.5 };
const SUB = { size: 12.5, weight: 400, lh: 16.5 };

function textBlock(label, sub, maxW, measure, { minW = 0, padX = 14, padY = 11, labelLines = 3, subLines = 3 } = {}) {
    const inner = Math.max(40, maxW - padX * 2);
    const l = label ? wrapText(label, inner, LABEL.size, LABEL.weight, measure, labelLines) : [];
    const s = sub ? wrapText(sub, inner, SUB.size, SUB.weight, measure, subLines) : [];
    const widest = Math.max(
        0,
        ...l.map(t => measure(t, LABEL.size, LABEL.weight)),
        ...s.map(t => measure(t, SUB.size, SUB.weight))
    );
    const w = Math.min(maxW, Math.max(minW, Math.ceil(widest) + padX * 2));
    const h = Math.ceil(padY * 2 + l.length * LABEL.lh + (s.length ? 3 + s.length * SUB.lh : 0));
    return { w, h, l, s, padY };
}

/* text lines placed in a box; returns scene items */
function textItems(block, cx, top, step, { anchor = "middle", x = cx } = {}) {
    const out = [];
    let y = top + block.padY + LABEL.size * 0.98;
    if (block.l.length) {
        out.push({ t: "text", x, y, lines: block.l, lh: LABEL.lh, cls: "nv-label", anchor, step });
        y += block.l.length * LABEL.lh + 3;
    }
    if (block.s.length) {
        out.push({ t: "text", x, y: y - (block.l.length ? 2 : 0), lines: block.s, lh: SUB.lh, cls: "nv-sub", anchor, step });
    }
    return out;
}

/* ---------------- spec cleaning ---------------- */

function tone(value, fallback = "") {
    const t = String(value || "").toLowerCase().trim();
    const map = { primary: "accent", main: "accent", success: "good", green: "good", positive: "good", danger: "bad", red: "bad", negative: "bad", error: "bad", warning: "warn", orange: "warn", yellow: "warn", grey: "muted", gray: "muted", neutral: "muted", blue: "c1", purple: "c3", violet: "c3", pink: "c5" };
    const v = map[t] || t;
    return TONES.includes(v) ? v : fallback;
}

function item(raw, i = 0) {
    if (typeof raw === "string" || typeof raw === "number") return { label: clean(raw), sub: "", note: "", tip: "", tone: "", id: clean(raw, 60) || `n${i}`, shape: "", date: "", value: "", items: [], children: [] };
    const r = raw && typeof raw === "object" ? raw : {};
    return {
        id: clean(r.id ?? r.key ?? r.label ?? r.title ?? r.name ?? `n${i}`, 60),
        label: clean(r.label ?? r.title ?? r.name ?? r.text ?? r.id ?? ""),
        sub: clean(r.sub ?? r.detail ?? r.desc ?? r.description ?? r.subtitle ?? "", LIMIT.sub),
        note: clean(r.note ?? r.explain ?? r.explanation ?? "", LIMIT.note),
        tip: clean(r.tip ?? r.hint ?? "", LIMIT.sub),
        tone: tone(r.tone ?? r.color ?? r.colour),
        shape: ["box", "pill", "diamond", "circle"].includes(r.shape) ? r.shape : (r.type === "decision" || r.decision ? "diamond" : ""),
        date: clean(r.date ?? r.year ?? r.time ?? r.when ?? "", 40),
        value: clean(r.value ?? r.number ?? r.stat ?? "", 24),
        items: Array.isArray(r.items) ? r.items.slice(0, 5).map(x => clean(x, 60)).filter(Boolean) : [],
        children: Array.isArray(r.children ?? r.nodes ?? r.items_tree) ? (r.children ?? r.nodes ?? r.items_tree) : []
    };
}

export function normalizeVisual(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    let type = String(raw.type || raw.kind || raw.layout || "").toLowerCase().trim();
    type = ALIASES[type] || type;
    if (!VISUAL_TYPES.includes(type)) {
        if (Array.isArray(raw.edges) || Array.isArray(raw.links)) type = "flow";
        else if (raw.root || raw.center && Array.isArray(raw.children)) type = "mindmap";
        else return null;
    }
    const list = raw.items ?? raw.steps ?? raw.nodes ?? raw.events ?? raw.levels ?? raw.sets ?? raw.stats ?? raw.layers ?? [];
    const spec = {
        type,
        title: clean(raw.title, 90),
        caption: clean(raw.caption ?? raw.subtitle, 220),
        direction: /right|horizontal|lr|left/i.test(String(raw.direction || "")) ? "right" : "down",
        animate: raw.animate === true || raw.animated === true,
        center: clean(raw.center?.label ?? raw.center ?? "", 60),
        items: Array.isArray(list) ? list.slice(0, type === "flow" ? LIMIT.nodes : LIMIT.items).map(item) : [],
        edges: [],
        root: null,
        both: [],
        all: []
    };
    if (type === "flow") {
        const links = Array.isArray(raw.edges) ? raw.edges : Array.isArray(raw.links) ? raw.links : [];
        spec.edges = links.slice(0, LIMIT.edges).map(e => Array.isArray(e)
            ? { from: clean(e[0], 60), to: clean(e[1], 60), label: clean(e[2], 40), dashed: false }
            : { from: clean(e?.from ?? e?.source, 60), to: clean(e?.to ?? e?.target, 60), label: clean(e?.label, 40), dashed: !!e?.dashed || e?.style === "dashed" })
            .filter(e => e.from && e.to && e.from !== e.to);
        // a plain list with no edges = a chain
        if (!spec.edges.length && spec.items.length > 1) {
            spec.edges = spec.items.slice(1).map((n, i) => ({ from: spec.items[i].id, to: n.id, label: "", dashed: false }));
        }
        // ids must be unique
        const seen = new Set();
        spec.items.forEach((n, i) => { if (seen.has(n.id)) n.id = `${n.id}#${i}`; seen.add(n.id); });
    }
    if (type === "tree" || type === "mindmap") {
        const r = raw.root ?? (raw.center && typeof raw.center === "object" ? raw.center : null) ?? { label: raw.center || raw.title || "", children: raw.children ?? raw.items ?? raw.branches ?? [] };
        spec.root = treeNode(r, 0, { count: 0 });
        if (!spec.root || !spec.root.label) return null;
        spec.items = [];
    }
    if (type === "venn") {
        spec.items = spec.items.slice(0, 3);
        spec.both = (Array.isArray(raw.both ?? raw.overlap ?? raw.shared) ? (raw.both ?? raw.overlap ?? raw.shared) : [raw.both ?? raw.overlap ?? raw.shared].filter(Boolean)).slice(0, 4).map(x => clean(x, 60));
        spec.all = (Array.isArray(raw.all ?? raw.center) ? (raw.all ?? raw.center) : [raw.all ?? ""].filter(Boolean)).slice(0, 3).map(x => clean(x, 60));
        if (spec.items.length < 2) return null;
    }
    if (!["tree", "mindmap"].includes(type) && !spec.items.filter(n => n.label || n.value).length) return null;
    return spec;
}

function treeNode(raw, depth, counter) {
    if (counter.count >= LIMIT.nodes) return null;
    counter.count++;
    const n = item(raw, counter.count);
    const kids = depth >= LIMIT.depth ? [] : n.children.slice(0, LIMIT.children).map(c => treeNode(c, depth + 1, counter)).filter(Boolean);
    return { label: n.label, sub: n.sub, note: n.note, tip: n.tip, tone: n.tone, children: kids };
}

/* ---------------- parse a block ---------------- */

export function parseVisualSource(source = "") {
    const text = String(source || "").trim();
    if (!text) return { kind: "empty" };
    if (/^<(\?xml|svg|!--)/i.test(text) || /<svg[\s>]/i.test(text.slice(0, 400))) {
        return /<\/svg>\s*$/i.test(text) ? { kind: "svg", svg: text } : { kind: "partial" };
    }
    const json = text.replace(/^json\s*/i, "");
    let data;
    try {
        data = JSON.parse(json);
    } catch {
        // trailing commas are a common slip
        try {
            data = JSON.parse(json.replace(/,\s*([}\]])/g, "$1"));
        } catch {
            return { kind: "partial" };
        }
    }
    try {
        const spec = normalizeVisual(data);
        return spec ? { kind: "spec", spec } : { kind: "bad" };
    } catch {
        return { kind: "bad" };
    }
}

/* ---------------- layouts ---------------- */

function scene() {
    return { items: [], steps: [], width: 0, height: 0 };
}

function addStep(sc, n) {
    sc.steps.push({ label: n.label || n.value || "", sub: n.sub || "", note: n.note || "" });
    return sc.steps.length - 1;
}

function nodeShape(sc, n, x, y, b, step, extraCls = "") {
    const t = n.tone || "muted";
    const cls = `nv-node tone-${t}${extraCls ? ` ${extraCls}` : ""}`;
    const shape = n.shape || "box";
    if (shape === "diamond") {
        const cx = x + b.ow / 2;
        const cy = y + b.oh / 2;
        sc.items.push({ t: "poly", points: [[cx, y], [x + b.ow, cy], [cx, y + b.oh], [x, cy]], cls, step, tip: n.tip || n.note });
        sc.items.push(...textItems(b, cx, cy - b.h / 2, step));
    } else if (shape === "circle") {
        sc.items.push({ t: "circle", cx: x + b.ow / 2, cy: y + b.oh / 2, r: b.ow / 2, cls, step, tip: n.tip || n.note });
        sc.items.push(...textItems(b, x + b.ow / 2, y + (b.oh - b.h) / 2, step));
    } else {
        sc.items.push({ t: "rect", x, y, w: b.ow, h: b.oh, r: shape === "pill" ? b.oh / 2 : 12, cls, step, tip: n.tip || n.note });
        sc.items.push(...textItems(b, x + b.ow / 2, y, step));
    }
}

function sizeNode(n, maxW, measure, opts) {
    const b = textBlock(n.label, n.sub, maxW, measure, opts);
    if (n.shape === "diamond") {
        b.ow = Math.ceil(b.w * 1.45);
        b.oh = Math.ceil(b.h * 1.7);
    } else if (n.shape === "circle") {
        b.ow = b.oh = Math.ceil(Math.max(b.w, b.h) * 1.12);
    } else {
        b.ow = b.w;
        b.oh = b.h;
    }
    return b;
}

function layoutFlow(spec, measure) {
    const sc = scene();
    const right = spec.direction === "right";
    const byId = new Map(spec.items.map(n => [n.id, n]));
    const byLabel = new Map(spec.items.map(n => [n.label.toLowerCase(), n]));
    const find = key => byId.get(key) || byLabel.get(String(key).toLowerCase());
    const edges = [];
    for (const e of spec.edges) {
        let a = find(e.from);
        let b = find(e.to);
        if (!a && byId.size < LIMIT.nodes) { a = item({ id: e.from, label: e.from }); spec.items.push(a); byId.set(a.id, a); }
        if (!b && byId.size < LIMIT.nodes) { b = item({ id: e.to, label: e.to }); spec.items.push(b); byId.set(b.id, b); }
        if (a && b && a !== b) edges.push({ ...e, a, b });
    }
    const nodes = spec.items;
    // drop back edges (cycles) for ranking only
    const out = new Map(nodes.map(n => [n, []]));
    edges.forEach(e => out.get(e.a).push(e));
    const state = new Map();
    const back = new Set();
    const visit = n => {
        state.set(n, 1);
        for (const e of out.get(n)) {
            if (state.get(e.b) === 1) back.add(e);
            else if (!state.get(e.b)) visit(e.b);
        }
        state.set(n, 2);
    };
    nodes.forEach(n => { if (!state.get(n)) visit(n); });
    const rank = new Map(nodes.map(n => [n, 0]));
    for (let pass = 0; pass < nodes.length; pass++) {
        let changed = false;
        for (const e of edges) {
            if (back.has(e)) continue;
            if (rank.get(e.b) < rank.get(e.a) + 1) { rank.set(e.b, rank.get(e.a) + 1); changed = true; }
        }
        if (!changed) break;
    }
    const ranks = [];
    nodes.forEach(n => { (ranks[rank.get(n)] ||= []).push(n); });
    const rows = ranks.filter(Boolean);
    // order: barycenter of parents, one pass
    const pos = new Map();
    rows.forEach((row, ri) => {
        if (ri > 0) {
            row.sort((p, q) => bary(p) - bary(q));
        }
        row.forEach((n, i) => pos.set(n, i + 0.0001 * nodes.indexOf(n)));
        function bary(n) {
            const parents = edges.filter(e => e.b === n && !back.has(e)).map(e => pos.get(e.a)).filter(v => v !== undefined);
            return parents.length ? parents.reduce((s, v) => s + v, 0) / parents.length : pos.get(n) ?? 99;
        }
    });

    const maxW = right ? (W < 500 ? 130 : 200) : Math.max(W < 500 ? 96 : 130, Math.min(220, (W - 40) / Math.max(...rows.map(r => r.length)) - 24));
    const box = new Map(nodes.map(n => [n, sizeNode(n, maxW, measure)]));
    const gap = right ? 18 : 24;
    const rankGap = right ? 64 : 58;
    const place = new Map();
    let cursor = 0;
    let span = 0;
    rows.forEach(row => {
        const thick = Math.max(...row.map(n => right ? box.get(n).ow : box.get(n).oh));
        const length = row.reduce((s, n) => s + (right ? box.get(n).oh : box.get(n).ow), 0) + gap * (row.length - 1);
        span = Math.max(span, length);
        row._len = length;
        row._at = cursor;
        row._thick = thick;
        cursor += thick + rankGap;
    });
    rows.forEach(row => {
        let p = (span - row._len) / 2;
        row.forEach(n => {
            const b = box.get(n);
            if (right) {
                place.set(n, { x: row._at + (row._thick - b.ow) / 2, y: p });
                p += b.oh + gap;
            } else {
                place.set(n, { x: p, y: row._at + (row._thick - b.oh) / 2 });
                p += b.ow + gap;
            }
        });
    });
    const padX = 24;
    const padY = 12;
    const width = (right ? cursor - rankGap : span) + padX * 2 + 40;
    const height = (right ? span : cursor - rankGap) + padY * 2;
    const order = [...nodes].sort((p, q) => rank.get(p) - rank.get(q) || pos.get(p) - pos.get(q));
    const stepOf = new Map();
    order.forEach(n => stepOf.set(n, addStep(sc, n)));

    // edges first (under the nodes)
    for (const e of edges) {
        const A = place.get(e.a); const B = place.get(e.b);
        const ba = box.get(e.a); const bb = box.get(e.b);
        const ax = A.x + padX; const ay = A.y + padY; const bx = B.x + padX; const by = B.y + padY;
        let d;
        let mid;
        const isBack = back.has(e) || rank.get(e.b) <= rank.get(e.a);
        if (!right && !isBack) {
            const x1 = ax + ba.ow / 2; const y1 = ay + ba.oh; const x2 = bx + bb.ow / 2; const y2 = by - 2;
            const k = (y2 - y1) / 2;
            d = `M${x1} ${y1} C${x1} ${y1 + k} ${x2} ${y2 - k} ${x2} ${y2}`;
            mid = [(x1 + x2) / 2, (y1 + y2) / 2];
        } else if (right && !isBack) {
            const x1 = ax + ba.ow; const y1 = ay + ba.oh / 2; const x2 = bx - 2; const y2 = by + bb.oh / 2;
            const k = (x2 - x1) / 2;
            d = `M${x1} ${y1} C${x1 + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}`;
            mid = [(x1 + x2) / 2, (y1 + y2) / 2];
        } else if (!right) {
            const x1 = ax + ba.ow; const y1 = ay + ba.oh / 2; const x2 = bx + bb.ow + 2; const y2 = by + bb.oh / 2;
            const out = Math.max(x1, x2) + 46;
            d = `M${x1} ${y1} C${out} ${y1} ${out} ${y2} ${x2} ${y2}`;
            mid = [out - 10, (y1 + y2) / 2];
        } else {
            const x1 = ax + ba.ow / 2; const y1 = ay + ba.oh; const x2 = bx + bb.ow / 2; const y2 = by + bb.oh + 2;
            const down = Math.max(y1, y2) + 40;
            d = `M${x1} ${y1} C${x1} ${down} ${x2} ${down} ${x2} ${y2}`;
            mid = [(x1 + x2) / 2, down - 8];
        }
        const step = Math.max(stepOf.get(e.a), stepOf.get(e.b));
        sc.items.push({ t: "path", d, cls: `nv-edge${e.dashed ? " is-dashed" : ""}${spec.animate ? " is-flow" : ""}`, arrow: true, step });
        if (e.label) {
            const w = Math.ceil(measure(e.label, 11.5, 500)) + 12;
            sc.items.push({ t: "rect", x: mid[0] - w / 2, y: mid[1] - 10, w, h: 20, r: 10, cls: "nv-edge-tag", step });
            sc.items.push({ t: "text", x: mid[0], y: mid[1] + 4, lines: [e.label], lh: 14, cls: "nv-edge-text", anchor: "middle", step });
        }
    }
    for (const n of nodes) {
        const p = place.get(n);
        nodeShape(sc, n, p.x + padX, p.y + padY, box.get(n), stepOf.get(n));
    }
    sc.width = Math.ceil(width);
    sc.height = Math.ceil(height + (edges.some(e => back.has(e)) && right ? 40 : 0));
    return sc;
}

function layoutSteps(spec, measure) {
    const sc = scene();
    const list = spec.items;
    const horizontal = list.length <= Math.min(4, Math.floor(W / 165)) && list.every(n => (n.label.length + n.sub.length) < 120);
    if (horizontal) {
        const gap = 34;
        const cw = Math.floor((W - 24 - gap * (list.length - 1)) / list.length);
        const blocks = list.map(n => textBlock(n.label, n.sub, cw, measure, { minW: cw, padY: 12, subLines: 4 }));
        const h = Math.max(...blocks.map(b => b.h)) + 30;
        list.forEach((n, i) => {
            const step = addStep(sc, n);
            const x = 12 + i * (cw + gap);
            const y = 22;
            sc.items.push({ t: "rect", x, y, w: cw, h, r: 14, cls: `nv-node tone-${n.tone || "muted"}`, step, tip: n.tip || n.note });
            sc.items.push({ t: "circle", cx: x + cw / 2, cy: y, r: 15, cls: `nv-num tone-${n.tone || "accent"}`, step });
            sc.items.push({ t: "text", x: x + cw / 2, y: y + 4.5, lines: [String(i + 1)], lh: 14, cls: "nv-num-text", anchor: "middle", step });
            sc.items.push(...textItems(blocks[i], x + cw / 2, y + 18, step));
            if (i < list.length - 1) {
                const ax = x + cw + 6; const ay = y + h / 2;
                sc.items.push({ t: "path", d: `M${ax} ${ay} L${ax + gap - 14} ${ay}`, cls: `nv-edge${spec.animate ? " is-flow" : ""}`, arrow: true, step: step + 1 });
            }
        });
        sc.width = W;
        sc.height = 22 + h + 12;
        return sc;
    }
    // vertical: numbered rail
    let y = 14;
    const x0 = 34;
    const tw = W - 90;
    list.forEach((n, i) => {
        const step = addStep(sc, n);
        const b = textBlock(n.label, n.sub, tw, measure, { minW: tw, padY: 10, subLines: 4 });
        if (i < list.length - 1) sc.items.push({ t: "path", d: `M${x0} ${y + 32} L${x0} ${y + b.h + 16}`, cls: "nv-rail", step: step + 1 });
        sc.items.push({ t: "circle", cx: x0, cy: y + 16, r: 15, cls: `nv-num tone-${n.tone || "accent"}`, step });
        sc.items.push({ t: "text", x: x0, y: y + 20.5, lines: [String(i + 1)], lh: 14, cls: "nv-num-text", anchor: "middle", step });
        sc.items.push({ t: "rect", x: x0 + 28, y, w: tw, h: b.h, r: 12, cls: `nv-node nv-plain tone-${n.tone || "muted"}`, step, tip: n.tip || n.note });
        sc.items.push(...textItems(b, 0, y, step, { anchor: "start", x: x0 + 28 + 14 }));
        y += b.h + 16;
    });
    sc.width = W;
    sc.height = y;
    return sc;
}

function layoutTimeline(spec, measure) {
    const sc = scene();
    const dates = spec.items.map(n => n.date);
    const dw = Math.min(150, Math.max(54, ...dates.map(d => measure(d, 13, 650)))) + 8;
    const L = 14 + dw + 18;
    const tw = W - L - 34;
    let y = 10;
    const first = y;
    const rows = spec.items.map(n => ({ n, b: textBlock(n.label, n.sub, tw, measure, { minW: 0, padX: 0, padY: 2, subLines: 4 }) }));
    rows.forEach(({ n, b }, i) => {
        const step = addStep(sc, n);
        const t = n.tone || (i === rows.length - 1 ? "accent" : "muted");
        sc.items.push({ t: "text", x: L - 18, y: y + 15, lines: [n.date || "•"], lh: 16, cls: `nv-date tone-${t}`, anchor: "end", step });
        sc.items.push({ t: "circle", cx: L, cy: y + 10, r: 6, cls: `nv-dot tone-${t}`, step, tip: n.tip || n.note });
        sc.items.push(...textItems(b, 0, y - 1, step, { anchor: "start", x: L + 20 }));
        y += Math.max(b.h, 22) + 22;
    });
    sc.items.unshift({ t: "path", d: `M${L} ${first + 10} L${L} ${y - 30}`, cls: "nv-rail", step: 0 });
    sc.width = W;
    sc.height = y - 10;
    return sc;
}

function layoutCycle(spec, measure) {
    const sc = scene();
    const list = spec.items.slice(0, 8);
    const n = list.length;
    const maxW = W < 500 ? (n <= 4 ? 120 : 100) : n <= 4 ? 170 : n <= 6 ? 150 : 130;
    const blocks = list.map(item => textBlock(item.label, item.sub, maxW, measure, { subLines: 2 }));
    const bw = Math.max(...blocks.map(b => b.w));
    const bh = Math.max(...blocks.map(b => b.h));
    const R = Math.max(n <= 3 ? 120 : 140, Math.ceil(((Math.max(bw, bh) + 30) * n) / (2 * Math.PI)));
    const cx = R + bw / 2 + 14;
    const cy = R + bh / 2 + 10;
    const ang = i => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    if (spec.center) {
        const cb = textBlock(spec.center, "", Math.min(180, R), measure);
        sc.items.push({ t: "circle", cx, cy, r: Math.max(44, cb.w / 2 + 6), cls: "nv-hub", step: 0 });
        sc.items.push(...textItems(cb, cx, cy - cb.h / 2, 0));
    }
    // arrows between neighbours, along the circle
    const half = Math.hypot(bw, bh) / 2;
    const delta = Math.min(Math.PI / n - 0.06, (half + 6) / R);
    list.forEach((item, i) => {
        const a1 = ang(i) + delta;
        const a2 = ang(i + 1) - delta;
        if (a2 <= a1) return;
        const p1 = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)];
        const p2 = [cx + R * Math.cos(a2), cy + R * Math.sin(a2)];
        sc.items.push({ t: "path", d: `M${p1[0].toFixed(1)} ${p1[1].toFixed(1)} A${R} ${R} 0 0 1 ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`, cls: `nv-edge${spec.animate ? " is-flow" : ""}`, arrow: true, step: (i + 1) % n === 0 ? n - 1 : i + 1 });
    });
    list.forEach((item, i) => {
        const step = addStep(sc, item);
        const b = blocks[i];
        const x = cx + R * Math.cos(ang(i)) - b.w / 2;
        const y = cy + R * Math.sin(ang(i)) - b.h / 2;
        sc.items.push({ t: "rect", x, y, w: b.w, h: b.h, r: 14, cls: `nv-node tone-${item.tone || ["c1", "c2", "c3", "c4", "c5"][i % 5]}`, step, tip: item.tip || item.note });
        sc.items.push(...textItems(b, x + b.w / 2, y, step));
    });
    sc.width = Math.ceil(cx * 2);
    sc.height = Math.ceil(cy * 2);
    return sc;
}

function layoutTree(spec, measure, mind) {
    const sc = scene();
    const root = spec.root;
    const colors = ["c1", "c2", "c3", "c4", "c5"];
    const maxW = W < 620 ? 120 : 150;
    const vgap = 12;
    const hgap = W < 620 ? 34 : 44;
    // size + tone
    const prep = (n, depth, t) => {
        n.depth = depth;
        n.toneName = n.tone || t;
        n.b = textBlock(n.label, n.sub, depth === 0 ? 190 : maxW, measure, { subLines: 2, padY: depth === 0 ? 13 : 9 });
        n.children.forEach((c, i) => prep(c, depth + 1, depth === 0 ? (c.tone || colors[i % 5]) : n.toneName));
    };
    prep(root, 0, root.tone || "accent");
    // column widths per depth (per side)
    const sideOf = new Map();
    let left = [];
    let rightKids = root.children;
    if (mind && root.children.length > 2) {
        const leaves = c => c.children.length ? c.children.reduce((s, k) => s + leaves(k), 0) : 1;
        const total = root.children.reduce((s, c) => s + leaves(c), 0);
        rightKids = [];
        let acc = 0;
        root.children.forEach(c => {
            if (acc < total / 2) { rightKids.push(c); acc += leaves(c); } else left.push(c);
        });
    }
    const colW = side => {
        const widths = [];
        const walk = (n, d) => { widths[d] = Math.max(widths[d] || 0, n.b.w); n.children.forEach(c => walk(c, d + 1)); };
        side.forEach(c => walk(c, 1));
        return widths;
    };
    const rW = colW(rightKids);
    const lW = colW(left);
    // vertical placement: leaves stack
    const heightOf = n => n.children.length ? Math.max(n.b.h, n.children.reduce((s, c) => s + heightOf(c), 0) + vgap * (n.children.length - 1)) : n.b.h;
    const placeSide = (kids, dir, xAt) => {
        const total = kids.reduce((s, c) => s + heightOf(c), 0) + vgap * Math.max(0, kids.length - 1);
        let y = -total / 2;
        kids.forEach(c => {
            const h = heightOf(c);
            placeNode(c, y, h, dir, xAt);
            y += h + vgap;
        });
    };
    const placeNode = (n, top, h, dir, xAt) => {
        n.y = top + h / 2 - n.b.h / 2;
        n.x = xAt(n.depth, n.b.w);
        n.dir = dir;
        if (n.children.length) {
            const inner = n.children.reduce((s, c) => s + heightOf(c), 0) + vgap * (n.children.length - 1);
            let y = top + (h - inner) / 2;
            n.children.forEach(c => { const ch = heightOf(c); placeNode(c, y, ch, dir, xAt); y += ch + vgap; });
        }
    };
    const rootW = root.b.w;
    const offR = d => { let x = rootW / 2 + hgap; for (let i = 1; i < d; i++) x += rW[i] + hgap; return x; };
    const offL = d => { let x = rootW / 2 + hgap; for (let i = 1; i < d; i++) x += lW[i] + hgap; return x; };
    placeSide(rightKids, 1, (d, w) => offR(d));
    placeSide(left, -1, (d, w) => -offL(d) - w);
    root.x = -rootW / 2;
    root.y = -root.b.h / 2;
    if (!mind) {
        // plain tree: root on the left
        const shift = rootW / 2;
        const all = [];
        const walk = n => { all.push(n); n.children.forEach(walk); };
        walk(root);
        all.forEach(n => { n.x += shift; });
    }
    // bounds
    const all = [];
    const walk = n => { all.push(n); n.children.forEach(walk); };
    walk(root);
    const minX = Math.min(...all.map(n => n.x));
    const maxX = Math.max(...all.map(n => n.x + n.b.w));
    const minY = Math.min(...all.map(n => n.y));
    const maxY = Math.max(...all.map(n => n.y + n.b.h));
    const ox = 14 - minX;
    const oy = 10 - minY;
    // steps by depth then order
    const byDepth = [...all].sort((a, b) => a.depth - b.depth);
    const stepOf = new Map();
    byDepth.forEach(n => stepOf.set(n, addStep(sc, n)));
    // links
    all.forEach(n => n.children.forEach(c => {
        const fromX = c.dir === -1 ? n.x + ox : n.x + n.b.w + ox;
        const toX = c.dir === -1 ? c.x + c.b.w + ox : c.x + ox;
        const y1 = n.y + n.b.h / 2 + oy;
        const y2 = c.y + c.b.h / 2 + oy;
        const k = (toX - fromX) / 2;
        sc.items.push({ t: "path", d: `M${fromX} ${y1} C${fromX + k} ${y1} ${toX - k} ${y2} ${toX} ${y2}`, cls: `nv-link tone-${c.toneName}`, step: stepOf.get(c) });
    }));
    all.forEach(n => {
        const step = stepOf.get(n);
        const isRoot = n === root;
        sc.items.push({ t: "rect", x: n.x + ox, y: n.y + oy, w: n.b.w, h: n.b.h, r: isRoot ? 16 : 11, cls: `nv-node tone-${n.toneName}${isRoot ? " is-root" : n.depth === 1 ? " is-branch" : " nv-plain"}`, step, tip: n.tip || n.note });
        sc.items.push(...textItems(n.b, n.x + ox + n.b.w / 2, n.y + oy, step));
    });
    sc.width = Math.ceil(maxX - minX + 28);
    sc.height = Math.ceil(maxY - minY + 20);
    return sc;
}

/* narrow screens: a tree / mind map as an indented outline (fits a phone) */
function layoutOutline(spec, measure) {
    const sc = scene();
    const colors = ["c1", "c2", "c3", "c4", "c5"];
    const indent = 26;
    const rows = [];
    const walk = (n, depth, t, parent) => {
        const row = { n, depth, t, parent };
        rows.push(row);
        n.children.forEach((c, i) => walk(c, depth + 1, depth === 0 ? (c.tone || colors[i % 5]) : t, row));
    };
    walk(spec.root, 0, spec.root.tone || "accent", null);
    let y = 8;
    rows.forEach(row => {
        const x = 10 + row.depth * indent;
        row.b = textBlock(row.n.label, row.n.sub, W - x - 12, measure, { subLines: 2, padY: row.depth ? 8 : 11 });
        row.x = x;
        row.y = y;
        y += row.b.h + 8;
    });
    rows.forEach(row => { row.step = addStep(sc, row.n); });
    rows.forEach(row => {
        if (!row.parent) return;
        const px = row.parent.x + 14;
        const py = row.parent.y + row.parent.b.h;
        const cy = row.y + row.b.h / 2;
        sc.items.push({ t: "path", d: `M${px} ${py} L${px} ${cy - 8} Q${px} ${cy} ${px + 8} ${cy} L${row.x} ${cy}`, cls: `nv-link tone-${row.t}`, step: row.step });
    });
    rows.forEach(row => {
        const isRoot = !row.parent;
        sc.items.push({ t: "rect", x: row.x, y: row.y, w: row.b.w, h: row.b.h, r: isRoot ? 14 : 10, cls: `nv-node tone-${row.t}${isRoot ? " is-root" : row.depth === 1 ? " is-branch" : " nv-plain"}`, step: row.step, tip: row.n.tip || row.n.note });
        sc.items.push(...textItems(row.b, 0, row.y, row.step, { anchor: "start", x: row.x + 14 }));
    });
    sc.width = W;
    sc.height = y;
    return sc;
}

function layoutPyramid(spec, measure, funnel) {
    const sc = scene();
    const list = spec.items.slice(0, 7);
    const n = list.length;
    const hasNotes = list.some(x => x.sub) || list.some(x => measure(x.label.split(" ").sort((a, b) => b.length - a.length)[0] || "", 13.5, 600) > W * 0.2);
    const shapeW = Math.round(hasNotes ? W * 0.56 : Math.min(560, W * 0.86));
    const lvlH = 62;
    const gap = 5;
    const colors = ["c1", "c2", "c3", "c4", "c5"];
    const x0 = 14;
    const widthAt = k => shapeW - (shapeW - shapeW * 0.28) * (k / n);
    list.forEach((it, i) => {
        const step = addStep(sc, it);
        const y = 10 + i * (lvlH + gap);
        const wt = funnel ? widthAt(i) : shapeW * (0.2 + 0.8 * (i / n));
        const wb = funnel ? widthAt(i + 1) : shapeW * (0.2 + 0.8 * ((i + 1) / n));
        const cx = x0 + shapeW / 2;
        const t = it.tone || colors[i % 5];
        sc.items.push({ t: "poly", points: [[cx - wt / 2, y], [cx + wt / 2, y], [cx + wb / 2, y + lvlH], [cx - wb / 2, y + lvlH]], cls: `nv-node nv-band tone-${t}`, step, tip: it.tip || it.note, round: true });
        const label = it.value ? `${it.label} · ${it.value}` : it.label;
        const room = Math.max(50, (wt + wb) / 2 - 18);
        // shrink the words until the longest one fits the band
        let size = 13.5;
        const longest = Math.max(...label.split(" ").map(w => measure(w, size, 600)));
        if (longest > room) size = Math.max(10, size * room / longest);
        const inside = longest * (size / 13.5) <= room + 1;
        if (inside) {
            const lines = wrapText(label, room, size, 600, measure, 2);
            sc.items.push({ t: "text", x: cx, y: y + lvlH / 2 + size * 0.36 - (lines.length - 1) * size * 0.6, lines, lh: size * 1.2, cls: "nv-label nv-band-text", anchor: "middle", step, size });
        }
        if ((hasNotes && it.sub) || !inside) {
            const sx = x0 + shapeW + 24;
            const edgeX = cx + Math.max(wt, wb) / 2;
            sc.items.push({ t: "path", d: `M${edgeX + 6} ${y + lvlH / 2} L${sx - 8} ${y + lvlH / 2}`, cls: "nv-leader", step });
            const head = inside ? [] : wrapText(label, W - sx - 10, 13.5, 600, measure, 2);
            const s = it.sub ? wrapText(it.sub, W - sx - 10, 12.5, 400, measure, inside ? 3 : 2) : [];
            const total = head.length * 17 + s.length * 16;
            let ty = y + lvlH / 2 - total / 2 + 12;
            if (head.length) { sc.items.push({ t: "text", x: sx, y: ty, lines: head, lh: 17, cls: "nv-label", anchor: "start", step }); ty += head.length * 17; }
            if (s.length) sc.items.push({ t: "text", x: sx, y: ty, lines: s, lh: 16, cls: "nv-sub", anchor: "start", step });
        }
    });
    sc.width = hasNotes ? W : shapeW + 28;
    sc.height = 10 + n * (lvlH + gap) + 6;
    return sc;
}

function layoutVenn(spec, measure) {
    const sc = scene();
    const sets = spec.items;
    const r = 120;
    const three = sets.length === 3;
    const centers = three
        ? [[250, 165], [370, 165], [310, 268]]
        : [[250, 160], [400, 160]];
    const colors = ["c1", "c2", "c3"];
    const labelPos = three
        ? [[150, 40, "end"], [470, 40, "start"], [310, 410, "middle"]]
        : [[190, 22, "middle"], [460, 22, "middle"]];
    sets.forEach((s, i) => {
        const step = addStep(sc, s);
        const [cx, cy] = centers[i];
        sc.items.push({ t: "circle", cx, cy, r, cls: `nv-set tone-${s.tone || colors[i]}`, step, tip: s.tip || s.note || s.sub });
        const [lx, ly, anchor] = labelPos[i];
        sc.items.push({ t: "text", x: lx, y: ly, lines: [s.label], lh: 16, cls: `nv-label nv-set-label tone-${s.tone || colors[i]}`, anchor, step });
        // own-only items, pushed away from the middle
        const away = three
            ? [[-55, -30], [55, -30], [0, 62]][i]
            : [[-62, 0], [62, 0]][i];
        const lines = (s.items.length ? s.items : s.sub ? [s.sub] : []).slice(0, 4).flatMap(x => wrapText(x, three ? 92 : 110, 12.5, 400, measure, 2));
        if (lines.length) sc.items.push({ t: "text", x: cx + away[0], y: cy + away[1] - (lines.length - 1) * 8 + 4, lines, lh: 16, cls: "nv-sub nv-set-items", anchor: "middle", step });
    });
    const step = addStep(sc, { label: spec.both.join(", ") || "Both", sub: spec.all.join(", ") });
    const midLines = spec.both.slice(0, 3).flatMap(x => wrapText(x, three ? 70 : 82, 12.5, 600, measure, 2));
    if (midLines.length) {
        const [mx, my] = three ? [310, 148] : [325, 160];
        sc.items.push({ t: "text", x: mx, y: my - (midLines.length - 1) * 8 + 4, lines: midLines, lh: 16, cls: "nv-label nv-small", anchor: "middle", step });
    }
    if (three && spec.all.length) {
        sc.items.push({ t: "text", x: 310, y: 205, lines: spec.all.slice(0, 2).flatMap(x => wrapText(x, 60, 12, 650, measure, 2)), lh: 15, cls: "nv-label nv-small", anchor: "middle", step });
    }
    sc.width = three ? 620 : 650;
    sc.height = three ? 425 : 300;
    return sc;
}

function layoutLayers(spec, measure) {
    const sc = scene();
    let y = 8;
    const colors = ["c1", "c2", "c3", "c4", "c5"];
    const labelW = W < 500 ? Math.round(W * 0.4) : 210;
    spec.items.forEach((it, i) => {
        const step = addStep(sc, it);
        const l = wrapText(it.label, labelW - 30, 14, 600, measure, 2);
        const s = it.sub ? wrapText(it.sub, W - labelW - 50, 12.5, 400, measure, 3) : [];
        const h = Math.max(54, 22 + Math.max(l.length * 18.5, s.length * 16.5));
        const t = it.tone || colors[i % 5];
        sc.items.push({ t: "rect", x: 10, y, w: W - 20, h, r: 14, cls: `nv-node nv-layer tone-${t}`, step, tip: it.tip || it.note });
        sc.items.push({ t: "rect", x: 10, y, w: 5, h, r: 2.5, cls: `nv-layer-mark tone-${t}`, step });
        sc.items.push({ t: "text", x: 30, y: y + h / 2 + 5 - (l.length - 1) * 9.25, lines: l, lh: 18.5, cls: "nv-label", anchor: "start", step });
        if (s.length) sc.items.push({ t: "text", x: labelW + 20, y: y + h / 2 + 4 - (s.length - 1) * 8.25, lines: s, lh: 16.5, cls: "nv-sub", anchor: "start", step });
        y += h + 8;
    });
    sc.width = W;
    sc.height = y;
    return sc;
}

function layoutStats(spec, measure) {
    const sc = scene();
    const list = spec.items.slice(0, 8);
    const cols = W < 480 ? Math.min(2, list.length) : list.length <= 3 ? list.length : list.length === 4 ? 2 : 3;
    const gap = 14;
    const cw = (W - 20 - gap * (cols - 1)) / cols;
    const colors = ["muted", "muted", "muted", "muted", "muted"];
    let rowH = 0;
    let y = 8;
    list.forEach((it, i) => {
        const step = addStep(sc, it);
        const c = i % cols;
        if (c === 0 && i) { y += rowH + gap; rowH = 0; }
        const x = 10 + c * (cw + gap);
        const l = wrapText(it.label, cw - 32, 13, 500, measure, 2);
        const s = it.sub ? wrapText(it.sub, cw - 32, 12, 400, measure, 2) : [];
        const valueSize = cols >= 3 ? 30 : 36;
        const h = 22 + valueSize + 8 + l.length * 17 + (s.length ? 4 + s.length * 15 : 0) + 18;
        rowH = Math.max(rowH, h);
        const t = it.tone || colors[i % 5];
        sc.items.push({ t: "rect", x, y, w: cw, h: 0, r: 16, cls: `nv-node nv-stat tone-${t}`, step, tip: it.tip || it.note, fillRow: true });
        sc.items.push({ t: "text", x: x + 16, y: y + 22 + valueSize * 0.82, lines: [it.value || "—"], lh: valueSize, cls: `nv-value tone-${t}`, anchor: "start", step, size: valueSize });
        sc.items.push({ t: "text", x: x + 16, y: y + 22 + valueSize + 18, lines: l, lh: 17, cls: "nv-label nv-stat-label", anchor: "start", step });
        if (s.length) sc.items.push({ t: "text", x: x + 16, y: y + 22 + valueSize + 18 + l.length * 17 + 2, lines: s, lh: 15, cls: "nv-sub nv-small", anchor: "start", step });
    });
    // equal heights per row
    let currentY = null;
    const cards = sc.items.filter(it => it.fillRow);
    const rowsY = [...new Set(cards.map(c => c.y))];
    rowsY.forEach(ry => {
        const texts = sc.items.filter(it => it.t === "text" && it.y > ry && it.y < ry + 400);
        let h = 0;
        cards.filter(c => c.y === ry).forEach(c => {
            const own = texts.filter(t => t.x === c.x + 16 && t.y > ry);
            own.forEach(t => { h = Math.max(h, t.y - ry + (t.lines.length - 1) * t.lh + 18); });
        });
        cards.filter(c => c.y === ry).forEach(c => { c.h = Math.max(h, 96); });
        currentY = ry + Math.max(h, 96);
    });
    sc.width = W;
    sc.height = Math.ceil((currentY ?? y) + 8);
    return sc;
}

export function layoutVisual(spec, measure = approxMeasure, { width = 720 } = {}) {
    if (!spec) return null;
    W = Math.round(Math.min(720, Math.max(320, Number(width) || 720)));
    const m = (t, s, w) => {
        try { return measure(t, s, w); } catch { return approxMeasure(t, s, w); }
    };
    switch (spec.type) {
        case "flow": return layoutFlow(spec, m);
        case "steps": return layoutSteps(spec, m);
        case "timeline": return layoutTimeline(spec, m);
        case "cycle": return layoutCycle(spec, m);
        case "tree":
        case "mindmap": {
            const sc = layoutTree(spec, m, spec.type === "mindmap");
            // too wide for this column: an outline reads better than a tiny map
            return sc.width > W * 1.2 ? layoutOutline(spec, m) : sc;
        }
        case "pyramid": return layoutPyramid(spec, m, false);
        case "funnel": return layoutPyramid(spec, m, true);
        case "venn": return layoutVenn(spec, m);
        case "layers": return layoutLayers(spec, m);
        case "stats": return layoutStats(spec, m);
        default: return null;
    }
}

/* plain text of a visual (copy / screen readers) */
export function visualToText(spec) {
    if (!spec) return "";
    const lines = [];
    if (spec.title) lines.push(spec.title);
    const one = n => [n.date, n.label, n.value].filter(Boolean).join(" · ") + (n.sub ? ` - ${n.sub}` : "");
    if (spec.root) {
        const walk = (n, d) => { lines.push(`${"  ".repeat(d)}- ${one(n)}`); n.children.forEach(c => walk(c, d + 1)); };
        walk(spec.root, 0);
    } else {
        spec.items.forEach((n, i) => lines.push(`${spec.type === "steps" ? `${i + 1}.` : "-"} ${one(n)}${n.items?.length ? `: ${n.items.join(", ")}` : ""}`));
        if (spec.type === "flow") spec.edges.forEach(e => lines.push(`  ${e.from} → ${e.to}${e.label ? ` (${e.label})` : ""}`));
        if (spec.both.length) lines.push(`- Both: ${spec.both.join(", ")}`);
    }
    if (spec.caption) lines.push(spec.caption);
    return lines.join("\n");
}

/* ---------------- raw SVG colour → theme ---------------- */

const NAMED = { black: "#000000", white: "#ffffff", gray: "#808080", grey: "#808080", red: "#ff0000", green: "#008000", blue: "#0000ff", orange: "#ffa500", yellow: "#ffff00", purple: "#800080", pink: "#ffc0cb", navy: "#000080", teal: "#008080", silver: "#c0c0c0" };

export function parseColor(value) {
    let v = String(value || "").trim().toLowerCase();
    if (NAMED[v]) v = NAMED[v];
    let m = v.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
        let h = m[1];
        if (h.length <= 4) h = [...h].map(c => c + c).join("");
        return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    }
    m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    if (m) return [m[1], m[2], m[3]].map(Number);
    return null;
}

/* hard-coded colours that would break dark mode become theme colours;
   real hues stay (they read fine on both) */
export function remapColor(value, role = "fill", isText = false) {
    const v = String(value || "").trim().toLowerCase();
    if (!v || v === "none" || v.startsWith("url(") || v.startsWith("var(") || v === "currentcolor" || v === "transparent" || v === "inherit") return null;
    const rgb = parseColor(v);
    if (!rgb) return null;
    const [r, g, b] = rgb;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (sat > 0.22) return null; // a real colour: keep it
    if (isText) return lum < 0.5 ? (lum < 0.3 ? "var(--nv-strong)" : "var(--nv-muted)") : "var(--nv-bg)";
    if (role === "stroke") return lum < 0.35 ? "var(--nv-fg)" : lum < 0.85 ? "var(--nv-line-strong)" : "var(--nv-line)";
    if (lum > 0.96) return "var(--nv-bg)";
    if (lum > 0.82) return "var(--nv-soft)";
    if (lum < 0.3) return "var(--nv-strong)";
    return "var(--nv-muted)";
}

/* a style attribute is kept only when it can't load anything */
export function safeStyle(style = "") {
    const s = String(style || "");
    if (/expression|javascript:|@import|behavior|-moz-binding|position\s*:\s*fixed/i.test(s)) return "";
    return s.replace(/url\(\s*(['"]?)(?!#)[^)]*\)/gi, "none").slice(0, 600);
}
