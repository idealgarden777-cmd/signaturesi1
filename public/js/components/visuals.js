/*
=========================================================
NEYO — VISUAL INTELLIGENCE v1
Turns ```neyo-visual blocks in NEYO's answers into real
diagrams, drawn in NEYO's own style (light + dark):

- JSON spec → our own layout engine (visual-core.js):
  flow, steps, timeline, cycle, tree, mindmap, pyramid,
  funnel, venn, layers, stats. Nothing overlaps.
- Raw <svg> → sanitised here (no scripts, no outside files,
  no events), colours mapped to the theme, ids scoped.
- Dynamic: soft build-in animation, ▶ Play walks through it
  step by step with an explanation, hover / tap tips,
  optional flowing arrows.
- Zoom (pan + pinch), Download PNG / SVG, Copy as text.
- Broken data after the answer ends = quietly removed.
=========================================================
*/

import { parseVisualSource, layoutVisual, visualToText, remapColor, safeStyle } from "./visual-core.js?v=1";

(() => {
    if (window.NeyoVisuals) return;

    const NS = "http://www.w3.org/2000/svg";
    const cache = new Map();
    let streaming = false;
    let seq = 0;

    /* ---------------- helpers ---------------- */

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null && text !== "") node.textContent = text;
        return node;
    }

    function svgEl(tag, attrs = {}) {
        const node = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v !== undefined && v !== null && v !== "") node.setAttribute(k, String(v));
        }
        return node;
    }

    const ICONS = {
        visual: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><rect x="14" y="3" width="7" height="6" rx="1.5"/><path d="M9 6h5M6 9v6a3 3 0 0 0 3 3h6"/>',
        play: '<path d="M7 5v14l11-7z"/>',
        stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
        prev: '<path d="m15 6-6 6 6 6"/>',
        next: '<path d="m9 6 6 6-6 6"/>',
        zoom: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M11 8v6M8 11h6"/>',
        out: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M8 11h6"/>',
        fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
        close: '<path d="M6 6l12 12M18 6 6 18"/>',
        download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
        copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'
    };

    function icon(name, size = 15) {
        const span = el("span", "sui-icon");
        span.setAttribute("aria-hidden", "true");
        // our own constants only
        span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
        return span;
    }

    function button(name, label, className = "sui-btn", hideLabel = false) {
        const b = el("button", className);
        b.type = "button";
        b.append(icon(name, 14));
        if (label && !hideLabel) b.append(el("span", "sui-btn-label", label));
        if (label) b.setAttribute("aria-label", label);
        return b;
    }

    function flash(b, text, ms = 1600) {
        const label = b.querySelector(".sui-btn-label");
        if (!label) return;
        const before = b.dataset.label || label.textContent;
        b.dataset.label = before;
        label.textContent = text;
        clearTimeout(b._nvTimer);
        b._nvTimer = setTimeout(() => { label.textContent = before; }, ms);
    }

    const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    /* real text widths, in the answer's own font */
    let ctx = null;
    let fontFamily = "";
    function measure(text, size = 14, weight = 400) {
        if (!ctx) {
            ctx = document.createElement("canvas").getContext("2d");
            const host = document.querySelector(".message.assistant .message-content") || document.body;
            fontFamily = getComputedStyle(host).fontFamily || "Inter, system-ui, sans-serif";
        }
        ctx.font = `${weight} ${size}px ${fontFamily}`;
        return ctx.measureText(String(text)).width;
    }

    /* ---------------- scene → SVG ---------------- */

    function arrowMarker(defs, id) {
        const marker = svgEl("marker", { id, viewBox: "0 0 10 10", refX: 8.5, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse", markerUnits: "strokeWidth" });
        marker.append(svgEl("path", { d: "M1.5 1.2 L8.8 5 L1.5 8.8 Q3 5 1.5 1.2 Z", class: "nv-arrow" }));
        defs.append(marker);
    }

    function renderScene(sc, title) {
        const id = `nv${++seq}`;
        const svg = svgEl("svg", { viewBox: `0 0 ${sc.width} ${sc.height}`, class: "nv-svg", role: "img", "aria-label": title || "Diagram" });
        svg.style.maxWidth = `${Math.round(sc.width * 1.08)}px`;
        // a diagram wider than the column: keep text readable and let it scroll
        if (sc.width > (sc.column || 720) * 1.12) {
            svg.style.minWidth = `${Math.round(Math.min(sc.width * 0.82, sc.width))}px`;
            svg.classList.add("is-wide");
        }
        const defs = svgEl("defs");
        arrowMarker(defs, `${id}-a`);
        svg.append(defs);
        let order = 0;
        for (const it of sc.items) {
            let node;
            if (it.t === "rect") node = svgEl("rect", { x: r1(it.x), y: r1(it.y), width: r1(it.w), height: r1(it.h), rx: it.r });
            else if (it.t === "circle") node = svgEl("circle", { cx: r1(it.cx), cy: r1(it.cy), r: r1(it.r) });
            else if (it.t === "poly") node = svgEl("polygon", { points: it.points.map(p => `${r1(p[0])},${r1(p[1])}`).join(" ") });
            else if (it.t === "path") {
                node = svgEl("path", { d: it.d, fill: "none" });
                if (it.arrow) node.setAttribute("marker-end", `url(#${id}-a)`);
            } else if (it.t === "text") {
                node = svgEl("text", { x: r1(it.x), y: r1(it.y), "text-anchor": it.anchor || "middle" });
                if (it.size) node.setAttribute("font-size", it.size);
                it.lines.forEach((line, i) => {
                    const span = svgEl("tspan", { x: r1(it.x), dy: i ? it.lh : 0 });
                    span.textContent = line;
                    node.append(span);
                });
            }
            if (!node) continue;
            node.setAttribute("class", it.cls || "");
            node.setAttribute("data-step", it.step ?? 0);
            node.style.setProperty("--i", String(order++));
            if (it.tip) node.setAttribute("data-tip", it.tip);
            svg.append(node);
        }
        return svg;
    }

    const r1 = v => Math.round(v * 10) / 10;

    /* ---------------- raw SVG sanitiser ---------------- */

    const ALLOWED = new Set(["svg", "g", "defs", "symbol", "use", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textpath", "title", "desc", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "marker", "animate", "animatetransform", "animatemotion", "set", "mpath", "filter", "fegaussianblur", "feoffset", "fedropshadow", "femerge", "femergenode", "feflood", "fecomposite", "feblend", "fecolormatrix"]);
    const ATTRS = new Set(["id", "class", "style", "viewbox", "preserveaspectratio", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "width", "height", "d", "points", "transform", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "opacity", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "alignment-baseline", "letter-spacing", "dx", "dy", "rotate", "textlength", "lengthadjust", "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform", "spreadmethod", "patternunits", "patterntransform", "clippathunits", "maskunits", "markerwidth", "markerheight", "refx", "refy", "orient", "markerunits", "marker-start", "marker-mid", "marker-end", "clip-path", "mask", "filter", "href", "xlink:href", "attributename", "attributetype", "from", "to", "by", "values", "keytimes", "keysplines", "calcmode", "begin", "dur", "end", "repeatcount", "repeatdur", "fill-mode", "additive", "accumulate", "type", "path", "keypoints", "stddeviation", "in", "in2", "result", "mode", "operator", "k1", "k2", "k3", "k4", "flood-color", "flood-opacity", "visibility", "display", "paint-order", "vector-effect", "pathlength", "startoffset", "method", "spacing", "data-step", "data-tip", "data-label", "data-note", "role", "aria-label", "xml:space"]);
    const CLASS_OK = /^(?:[fst]-(?:accent|good|bad|warn|muted|soft|fg|strong|line|bg|c[1-5])|flow|pulse|spin|float|draw|bold|small|label|sub)$/;

    function sanitizeSvg(source, scope) {
        if (source.length > 150000) return null;
        let doc;
        // the model often forgets the namespaces
        let text = source.replace(/^[\s\S]*?(<svg[\s>])/i, "$1");
        if (!/<svg[^>]*\sxmlns=/i.test(text)) text = text.replace(/<svg/i, `<svg xmlns="${NS}"`);
        if (/xlink:/i.test(text) && !/xmlns:xlink=/i.test(text)) text = text.replace(/<svg/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
        try {
            doc = new DOMParser().parseFromString(text, "image/svg+xml");
        } catch {
            return null;
        }
        const root = doc.documentElement;
        if (!root || root.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) return null;
        let count = 0;
        const ids = new Map();
        const walk = node => {
            for (const child of [...node.childNodes]) {
                if (child.nodeType === 3) continue;
                if (child.nodeType !== 1) { child.remove(); continue; }
                const tag = child.nodeName.toLowerCase();
                if (!ALLOWED.has(tag) || ++count > 2500) {
                    // keep the text inside a link, drop everything else
                    if (tag === "a") {
                        const g = doc.createElementNS(NS, "g");
                        while (child.firstChild) g.append(child.firstChild);
                        child.replaceWith(g);
                        cleanAttrs(g, "g");
                        walk(g);
                    } else child.remove();
                    continue;
                }
                if (/^(animate|animatetransform|animatemotion|set)$/.test(tag)) {
                    const what = String(child.getAttribute("attributeName") || "").toLowerCase();
                    if (/href|^on|style/.test(what)) { child.remove(); continue; }
                }
                cleanAttrs(child, tag);
                walk(child);
            }
        };
        const cleanAttrs = (node, tag) => {
            for (const attr of [...node.attributes]) {
                const name = attr.name.toLowerCase();
                const value = attr.value;
                if (!ATTRS.has(name) || name.startsWith("on")) { node.removeAttribute(attr.name); continue; }
                if (name === "href" || name === "xlink:href") {
                    if (!/^#[\w-]+$/.test(value.trim())) node.removeAttribute(attr.name);
                    continue;
                }
                if (name === "style") {
                    const safe = safeStyle(value);
                    if (safe) node.setAttribute("style", safe); else node.removeAttribute("style");
                    continue;
                }
                if (name === "class") {
                    const keep = value.split(/\s+/).filter(c => CLASS_OK.test(c));
                    if (keep.length) node.setAttribute("class", keep.join(" ")); else node.removeAttribute("class");
                    continue;
                }
                if (/^(fill|stroke|stop-color|flood-color)$/.test(name)) {
                    if (/url\(/i.test(value) && !/^url\(\s*#[\w-]+\s*\)$/i.test(value.trim())) { node.removeAttribute(attr.name); continue; }
                    const mapped = remapColor(value, name === "stroke" ? "stroke" : "fill", name === "fill" && (tag === "text" || tag === "tspan" || tag === "textpath"));
                    if (mapped) node.setAttribute(attr.name, mapped);
                    continue;
                }
                if (/url\(/i.test(value) && !/url\(\s*#[\w-]+\s*\)/i.test(value)) node.removeAttribute(attr.name);
                if (name === "id") ids.set(value, `${scope}-${value.replace(/[^\w-]/g, "")}`);
            }
            if (tag === "text" && !node.getAttribute("fill") && !/(^|\s)t-/.test(node.getAttribute("class") || "")) {
                node.setAttribute("class", `${node.getAttribute("class") || ""} nv-rt`.trim());
            }
        };
        cleanAttrs(root, "svg");
        walk(root);
        // scope ids so two visuals never clash
        if (ids.size) {
            const all = [root, ...root.querySelectorAll("*")];
            all.forEach(node => {
                for (const attr of [...node.attributes]) {
                    if (attr.name === "id" && ids.has(attr.value)) node.setAttribute("id", ids.get(attr.value));
                    else if (/^(href|xlink:href)$/.test(attr.name) && ids.has(attr.value.slice(1))) node.setAttribute(attr.name, `#${ids.get(attr.value.slice(1))}`);
                    else if (/url\(\s*#/.test(attr.value)) {
                        node.setAttribute(attr.name, attr.value.replace(/url\(\s*#([\w-]+)\s*\)/g, (m, k) => ids.has(k) ? `url(#${ids.get(k)})` : m));
                    }
                }
            });
        }
        // size: always scale by viewBox
        let vb = root.getAttribute("viewBox");
        const w = parseFloat(root.getAttribute("width")) || 0;
        const h = parseFloat(root.getAttribute("height")) || 0;
        if (!vb && w && h) vb = `0 0 ${w} ${h}`;
        if (!vb) vb = "0 0 720 400";
        const parts = vb.split(/[\s,]+/).map(Number);
        root.setAttribute("viewBox", vb);
        root.removeAttribute("width");
        root.removeAttribute("height");
        root.setAttribute("class", "nv-svg nv-raw");
        root.setAttribute("role", "img");
        const svg = document.importNode(root, true);
        if (parts[2] > 0) svg.style.maxWidth = `${Math.round(Math.max(parts[2], 280) * 1.1)}px`;
        // steps for Play: data-step on the drawing's parts
        const steps = [];
        svg.querySelectorAll("[data-step]").forEach(node => {
            const n = Math.max(0, Math.min(30, parseInt(node.getAttribute("data-step"), 10) || 0));
            node.setAttribute("data-step", n);
            if (!steps[n]) steps[n] = { label: node.getAttribute("data-label") || "", note: node.getAttribute("data-note") || node.getAttribute("data-tip") || "", sub: "" };
        });
        const list = [];
        for (let i = 0; i < steps.length; i++) list.push(steps[i] || { label: "", note: "", sub: "" });
        let order = 0;
        svg.querySelectorAll("path,rect,circle,ellipse,line,polyline,polygon,text,g").forEach(node => node.style.setProperty("--i", String(Math.min(order++, 40))));
        return { svg, steps: list.length > 1 ? list : [], text: [...svg.querySelectorAll("text")].map(t => t.textContent.trim()).filter(Boolean).join(" · ") };
    }

    /* ---------------- tooltip ---------------- */

    function wireTips(card, stage) {
        const tip = el("div", "nv-tip");
        tip.hidden = true;
        stage.append(tip);
        let pinned = null;
        const show = (target, x, y) => {
            tip.textContent = target.getAttribute("data-tip");
            tip.hidden = false;
            const box = stage.getBoundingClientRect();
            const left = Math.min(Math.max(8, x - box.left + 12), box.width - tip.offsetWidth - 8);
            const top = y - box.top + 14;
            tip.style.left = `${left}px`;
            tip.style.top = `${Math.min(top, box.height - tip.offsetHeight - 6)}px`;
            stage.querySelectorAll(".is-hot").forEach(n => n.classList.remove("is-hot"));
            target.classList.add("is-hot");
        };
        const hide = () => {
            tip.hidden = true;
            stage.querySelectorAll(".is-hot").forEach(n => n.classList.remove("is-hot"));
        };
        stage.addEventListener("pointermove", event => {
            if (event.pointerType === "touch") return;
            const target = event.target.closest?.("[data-tip]");
            if (target && stage.contains(target)) show(target, event.clientX, event.clientY);
            else if (!pinned) hide();
        });
        stage.addEventListener("pointerleave", () => { if (!pinned) hide(); });
        stage.addEventListener("click", event => {
            const target = event.target.closest?.("[data-tip]");
            if (target && stage.contains(target)) {
                pinned = pinned === target ? null : target;
                if (pinned) show(target, event.clientX, event.clientY); else hide();
            } else {
                pinned = null;
                hide();
            }
        });
    }

    /* ---------------- export ---------------- */

    const PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "letter-spacing", "paint-order", "visibility", "display"];

    function standalone(svg, card, scale = 1) {
        const clone = svg.cloneNode(true);
        const src = [svg, ...svg.querySelectorAll("*")];
        const dst = [clone, ...clone.querySelectorAll("*")];
        src.forEach((node, i) => {
            const cs = getComputedStyle(node);
            const out = dst[i];
            const style = PROPS.map(p => `${p}:${cs.getPropertyValue(p)}`).join(";");
            out.removeAttribute("class");
            out.setAttribute("style", style + (node.tagName.toLowerCase() === "svg" ? "" : ";animation:none;transition:none"));
            out.removeAttribute("data-tip");
            out.removeAttribute("data-step");
        });
        const vb = (svg.getAttribute("viewBox") || "0 0 720 400").split(/[\s,]+/).map(Number);
        clone.setAttribute("xmlns", NS);
        clone.setAttribute("width", String(Math.round(vb[2] * scale)));
        clone.setAttribute("height", String(Math.round(vb[3] * scale)));
        clone.style.maxWidth = "";
        const bg = svgEl("rect", { x: vb[0] - 16, y: vb[1] - 16, width: vb[2] + 32, height: vb[3] + 32, fill: getComputedStyle(card).backgroundColor || "#ffffff" });
        clone.insertBefore(bg, clone.firstChild);
        clone.setAttribute("viewBox", `${vb[0] - 16} ${vb[1] - 16} ${vb[2] + 32} ${vb[3] + 32}`);
        return new XMLSerializer().serializeToString(clone);
    }

    function save(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = el("a");
        a.href = url;
        a.download = name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    async function toPng(svg, card) {
        const text = standalone(svg, card, 2);
        const img = new Image();
        const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
        try {
            await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            canvas.getContext("2d").drawImage(img, 0, 0);
            return await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    /* ---------------- zoom ---------------- */

    function openZoom(svg, card, title) {
        const overlay = el("div", "nv-zoom");
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-label", title || "Diagram");
        // carry the theme colours out of the chat
        const cs = getComputedStyle(card);
        ["--nv-bg", "--nv-fg", "--nv-strong", "--nv-muted", "--nv-line", "--nv-line-strong", "--nv-soft", "--nv-accent", "--nv-good", "--nv-bad", "--nv-warn", "--nv-c1", "--nv-c2", "--nv-c3", "--nv-c4", "--nv-c5"].forEach(v => overlay.style.setProperty(v, cs.getPropertyValue(v)));
        overlay.style.fontFamily = fontFamily || cs.fontFamily;
        const bar = el("div", "nv-zoom-bar");
        bar.append(el("div", "nv-zoom-title", title || "Visual"));
        const zin = button("zoom", "Zoom in", "nv-zbtn", true);
        const zout = button("out", "Zoom out", "nv-zbtn", true);
        const fit = button("fit", "Fit", "nv-zbtn", true);
        const close = button("close", "Close", "nv-zbtn", true);
        bar.append(zout, zin, fit, close);
        const view = el("div", "nv-zoom-view");
        const clone = svg.cloneNode(true);
        clone.classList.remove("is-intro");
        clone.style.maxWidth = "none";
        const wrap = el("div", "nv-zoom-canvas");
        wrap.append(clone);
        view.append(wrap);
        overlay.append(bar, view);
        document.body.append(overlay);
        document.documentElement.classList.add("nya-lock");
        // start with the whole diagram in view
        const vb = (clone.getAttribute("viewBox") || "0 0 720 400").split(/[\s,]+/).map(Number);
        const box = view.getBoundingClientRect();
        const fitScale = Math.max(0.2, Math.min((box.width - 48) / vb[2], (box.height - 48) / vb[3], 2.4));
        clone.style.width = `${Math.round(vb[2] * fitScale)}px`;
        clone.style.height = `${Math.round(vb[3] * fitScale)}px`;
        clone.style.minWidth = "0";

        let k = 1, tx = 0, ty = 0;
        const apply = () => { wrap.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`; };
        const zoomAt = (factor, cx, cy) => {
            const box = view.getBoundingClientRect();
            const px = (cx ?? box.left + box.width / 2) - box.left;
            const py = (cy ?? box.top + box.height / 2) - box.top;
            const nk = Math.min(8, Math.max(0.4, k * factor));
            tx = px - (px - tx) * (nk / k);
            ty = py - (py - ty) * (nk / k);
            k = nk;
            apply();
        };
        const reset = () => { k = 1; tx = 0; ty = 0; apply(); };
        view.addEventListener("wheel", event => {
            event.preventDefault();
            zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
        }, { passive: false });
        const pts = new Map();
        let last = null;
        view.addEventListener("pointerdown", event => {
            view.setPointerCapture(event.pointerId);
            pts.set(event.pointerId, [event.clientX, event.clientY]);
            last = null;
        });
        view.addEventListener("pointermove", event => {
            if (!pts.has(event.pointerId)) return;
            const prev = pts.get(event.pointerId);
            pts.set(event.pointerId, [event.clientX, event.clientY]);
            if (pts.size === 1) {
                tx += event.clientX - prev[0];
                ty += event.clientY - prev[1];
                apply();
            } else if (pts.size === 2) {
                const [a, b] = [...pts.values()];
                const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
                if (last) zoomAt(dist / last, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
                last = dist;
            }
        });
        const up = event => { pts.delete(event.pointerId); last = null; };
        view.addEventListener("pointerup", up);
        view.addEventListener("pointercancel", up);
        zin.addEventListener("click", () => zoomAt(1.3));
        zout.addEventListener("click", () => zoomAt(1 / 1.3));
        fit.addEventListener("click", reset);
        const done = () => {
            overlay.remove();
            document.documentElement.classList.remove("nya-lock");
            document.removeEventListener("keydown", onKey);
        };
        const onKey = event => {
            if (event.key === "Escape") done();
            if (event.key === "+" || event.key === "=") zoomAt(1.3);
            if (event.key === "-") zoomAt(1 / 1.3);
            if (event.key === "0") reset();
        };
        close.addEventListener("click", done);
        document.addEventListener("keydown", onKey);
        close.focus();
    }

    /* ---------------- one visual card ---------------- */

    function build(parsed, fresh) {
        let svg;
        let steps = [];
        let title = "";
        let caption = "";
        let text = "";
        let kind = "Visual";
        if (parsed.kind === "spec") {
            const sc = layoutVisual(parsed.spec, measure, { width: parsed.width });
            if (sc) sc.column = parsed.width || 720;
            if (!sc || !sc.items.length) return null;
            title = parsed.spec.title;
            caption = parsed.spec.caption;
            svg = renderScene(sc, title);
            steps = sc.steps.length > 1 ? sc.steps : [];
            text = visualToText(parsed.spec);
            kind = { flow: "Flowchart", steps: "Process", timeline: "Timeline", cycle: "Cycle", tree: "Tree", mindmap: "Mind map", pyramid: "Pyramid", funnel: "Funnel", venn: "Venn diagram", layers: "Layers", stats: "At a glance" }[parsed.spec.type] || "Visual";
        } else {
            const out = sanitizeSvg(parsed.svg, `nvr${++seq}`);
            if (!out) return null;
            svg = out.svg;
            steps = out.steps;
            title = svg.querySelector("title")?.textContent?.trim().slice(0, 90) || "";
            text = [title, out.text].filter(Boolean).join("\n");
            kind = "Illustration";
        }

        const root = el("section", "sui-card nv-card");
        root.setAttribute("aria-label", title || kind);
        const head = el("header", "sui-head nv-head");
        const top = el("div", "nv-top");
        const kicker = el("div", "sui-kicker");
        kicker.append(icon("visual", 14), el("span", "", kind));
        const tools = el("div", "nv-tools");
        const playBtn = steps.length ? button("play", "Play", "sui-btn nv-tool") : null;
        const zoomBtn = button("zoom", "Zoom", "sui-btn nv-tool");
        if (playBtn) tools.append(playBtn);
        tools.append(zoomBtn);
        top.append(kicker, tools);
        head.append(top);
        if (title) head.append(el("h4", "sui-title", title));

        const stage = el("div", "nv-stage");
        stage.append(svg);
        if (fresh && !reduceMotion()) {
            svg.classList.add("is-intro");
            setTimeout(() => svg.classList.remove("is-intro"), 2600);
        }

        // step player
        const player = el("div", "nv-player");
        player.hidden = true;
        const prevBtn = button("prev", "Previous", "sui-btn nv-tool", true);
        const nextBtn = button("next", "Next", "sui-btn nv-tool", true);
        const count = el("span", "nv-count");
        const say = el("div", "nv-say");
        say.setAttribute("aria-live", "polite");
        const sayLabel = el("div", "nv-say-label");
        const sayNote = el("div", "nv-say-note");
        say.append(sayLabel, sayNote);
        const ctrls = el("div", "nv-ctrls");
        ctrls.append(prevBtn, count, nextBtn);
        player.append(say, ctrls);

        root.append(head, stage, player);
        if (caption) root.append(el("p", "sui-note nv-caption", caption));

        const actions = el("div", "sui-actions");
        const pngBtn = button("download", "PNG");
        const svgBtn = button("download", "SVG");
        const copyBtn = button("copy", "Copy");
        actions.append(pngBtn, svgBtn, copyBtn);
        root.append(actions);

        wireTips(root, stage);

        /* play */
        let at = -1;
        let timer = 0;
        const show = i => {
            at = Math.max(0, Math.min(steps.length - 1, i));
            svg.classList.add("is-stepping");
            svg.querySelectorAll("[data-step]").forEach(node => {
                const s = Number(node.getAttribute("data-step"));
                node.classList.toggle("is-hidden", s > at);
                node.classList.toggle("is-now", s === at);
            });
            const st = steps[at] || {};
            sayLabel.textContent = st.label || `Step ${at + 1}`;
            sayNote.textContent = st.note || st.sub || "";
            count.textContent = `${at + 1} / ${steps.length}`;
            prevBtn.disabled = at === 0;
            nextBtn.disabled = at === steps.length - 1;
        };
        const stop = (keep = false) => {
            clearInterval(timer);
            timer = 0;
            if (playBtn) playBtn.replaceChildren(icon("play", 14), el("span", "sui-btn-label", "Play"));
            if (!keep) {
                svg.classList.remove("is-stepping");
                svg.querySelectorAll(".is-hidden,.is-now").forEach(n => n.classList.remove("is-hidden", "is-now"));
                player.hidden = true;
                at = -1;
            }
        };
        const auto = () => {
            clearInterval(timer);
            timer = setInterval(() => {
                if (at >= steps.length - 1) { stop(true); return; }
                show(at + 1);
            }, 2200);
        };
        playBtn?.addEventListener("click", () => {
            if (timer) { stop(true); return; }
            if (!player.hidden && at >= steps.length - 1) { stop(); return; }
            player.hidden = false;
            show(player.hidden || at < 0 || at >= steps.length - 1 ? 0 : at);
            playBtn.replaceChildren(icon("stop", 14), el("span", "sui-btn-label", "Pause"));
            auto();
        });
        prevBtn.addEventListener("click", () => { stop(true); show(at - 1); });
        nextBtn.addEventListener("click", () => {
            stop(true);
            if (at >= steps.length - 1) stop(); else show(at + 1);
        });

        // lay out again for the real column width (first paint, phone rotate, sidebar)
        if (parsed.kind === "spec" && "ResizeObserver" in window) {
            let laid = parsed.width || 720;
            const ro = new ResizeObserver(() => {
                const real = stage.clientWidth;
                if (!real) return;
                const w = Math.max(300, Math.min(720, real));
                if (Math.abs(w - laid) < 40) return;
                laid = w;
                const next = layoutVisual(parsed.spec, measure, { width: w });
                if (!next || !next.items.length) return;
                next.column = w;
                const fresh = renderScene(next, title);
                stop();
                svg.replaceWith(fresh);
                svg = fresh;
                if (svg.classList.contains("is-wide")) stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
            });
            ro.observe(stage);
        }

        zoomBtn.addEventListener("click", () => openZoom(svg, root, title || kind));
        stage.addEventListener("dblclick", () => openZoom(svg, root, title || kind));

        const fileName = (title || kind).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "neyo-visual";
        svgBtn.addEventListener("click", () => {
            try {
                save(new Blob([standalone(svg, root, 1)], { type: "image/svg+xml" }), `${fileName}.svg`);
                flash(svgBtn, "Saved");
            } catch {
                flash(svgBtn, "Failed");
            }
        });
        pngBtn.addEventListener("click", async () => {
            pngBtn.disabled = true;
            try {
                const blob = await toPng(svg, root);
                if (!blob) throw new Error("no image");
                save(blob, `${fileName}.png`);
                flash(pngBtn, "Saved");
            } catch {
                flash(pngBtn, "Failed");
            } finally {
                pngBtn.disabled = false;
            }
        });
        copyBtn.addEventListener("click", async () => {
            let ok = false;
            try {
                if (window.NeyoUI?.copy) ok = await window.NeyoUI.copy(text);
                else { await navigator.clipboard.writeText(text); ok = true; }
            } catch {}
            flash(copyBtn, ok === false ? "Copy failed" : "Copied");
        });

        // a wide mind map opens centred on its middle
        if (svg.classList.contains("is-wide")) {
            requestAnimationFrame(() => setTimeout(() => {
                stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
            }, 30));
        }

        root._nvText = () => text;
        return root;
    }

    function placeholder(source) {
        const node = el("section", "nv-building");
        node.append(el("span", "sui-dot"), el("span", "", "Drawing visual…"));
        node._nvSource = source;
        return node;
    }

    /* ---------------- scan rendered messages ---------------- */

    /* the inside width of a card in this chat column (design width for layouts) */
    function columnWidth(node) {
        // the new message may not be on screen yet (width 0): fall back to one that is
        const candidates = [
            node?.closest?.(".message-content"),
            node,
            ...document.querySelectorAll(".message.assistant .message-content"),
            document.querySelector(".message")?.parentElement
        ];
        const host = candidates.find(c => c && c.clientWidth > 0);
        const w = host ? host.clientWidth - 38 : 720;
        return Math.max(300, Math.min(720, w));
    }

    function findBlocks(root) {
        return Array.from(root.querySelectorAll("pre > code"))
            .filter(code =>
                code.classList.contains("language-neyo-visual") ||
                code.classList.contains("language-neyo-svg") ||
                ["neyo-visual", "neyo-svg"].includes(code.parentElement?.dataset.language)
            );
    }

    function enhance(root, { final = !streaming } = {}) {
        if (!(root instanceof Element)) return;
        findBlocks(root).forEach(code => {
            const pre = code.parentElement;
            const frame = pre.closest(".neyo-code") || pre;
            const source = (code.textContent || "").trim();
            const cached = cache.get(source);
            if (cached && !cached.isConnected) {
                frame.replaceWith(cached);
                return;
            }
            const parsed = parseVisualSource(source);
            parsed.width = columnWidth(root);
            if (parsed.kind === "spec" || parsed.kind === "svg") {
                const node = build(parsed, !cached);
                if (node) {
                    cache.set(source, node);
                    if (cache.size > 60) cache.delete(cache.keys().next().value);
                    frame.replaceWith(node);
                    return;
                }
            }
            if (!final && (parsed.kind === "partial" || parsed.kind === "empty")) frame.replaceWith(placeholder(source));
            else frame.remove(); // broken after the answer ended: the written answer stays
        });
    }

    function enhanceAll() {
        document.querySelectorAll(".message.assistant .message-content").forEach(content => enhance(content, { final: !streaming }));
    }

    window.addEventListener("neyo:message-rendered", event => {
        if (event.detail?.role && event.detail.role !== "assistant") return;
        enhance(event.detail?.element, { final: !streaming });
    });

    window.addEventListener("neyo:chat-send-start", () => { streaming = true; });
    ["neyo:chat-send-end", "neyo:chat-aborted", "neyo:chat-error"].forEach(name =>
        window.addEventListener(name, () => {
            streaming = false;
            setTimeout(() => {
                enhanceAll();
                // still "drawing" after the answer ended: build what arrived, or drop it
                document.querySelectorAll(".nv-building").forEach(node => {
                    const parsed = parseVisualSource(node._nvSource || "");
                    parsed.width = columnWidth(node.parentElement);
                    const built = parsed.kind === "spec" || parsed.kind === "svg" ? build(parsed, true) : null;
                    if (built) node.replaceWith(built); else node.remove();
                });
            }, 70);
        })
    );

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhanceAll, { once: true });
    else enhanceAll();

    window.NeyoVisuals = Object.freeze({
        enhance,
        enhanceAll,
        textOf: node => node?._nvText?.() || "",
        version: 1
    });
})();
