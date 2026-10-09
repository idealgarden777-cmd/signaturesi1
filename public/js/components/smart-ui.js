/*
=========================================================
NEYO — SMART UI v2
Turns ```neyo-ui blocks in NEYO's answers into live cards:
"view" (NEYO composes its own visual from safe blocks, see
smart-ui-view.js) plus the ready-made calculator, checklist /
timeline, chart, tabs, compare and quiz.

- Data only: everything is built with textContent / SVG
  nodes, never innerHTML from the AI (tabs use the shared,
  sanitised Markdown renderer).
- Appears while the answer streams (half JSON is repaired),
  keeps its state while the rest of the answer types.
- Remembers ticks / numbers per card (localStorage).
- Copy and Save to Workspace on every card.
- If the data is broken after the answer ends, the card is
  quietly removed: the written answer is always there.
Logic lives in smart-ui-core.js (tested in Node).
=========================================================
*/

import {
    parseCardSource,
    computeOutputs,
    cardToText,
    formatNumber,
    compactNumber,
    niceScale
} from "./smart-ui-core.js?v=2";
import { buildView } from "./smart-ui-view.js?v=1";

(() => {
    "use strict";

    if (window.NeyoSmartUI) return;

    const SVG = "http://www.w3.org/2000/svg";
    const STORE_PREFIX = "neyo_sui_";
    const cache = new Map(); // source -> element (keeps state while streaming)
    const texts = new WeakMap(); // card element -> () => plain text
    let streaming = false;

    const TYPE_LABEL = {
        view: "Live view",
        calculator: "Calculator",
        checklist: "Plan",
        chart: "Chart",
        tabs: "Explore",
        compare: "Compare",
        quiz: "Quiz"
    };

    const ICONS = {
        view: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/>',
        calculator: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/>',
        checklist: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>',
        chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
        tabs: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M3 10h18M8 4h5a2 2 0 0 1 2 2v1"/>',
        compare: '<rect x="3" y="4" width="7.5" height="16" rx="2"/><rect x="13.5" y="4" width="7.5" height="16" rx="2"/>',
        quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.6h.01"/>',
        copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
        save: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>',
        check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
        minus: '<path d="M5 12h14"/>',
        plus: '<path d="M12 5v14M5 12h14"/>'
    };

    /* ---------------- tiny DOM helpers ---------------- */

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null && text !== "") node.textContent = text;
        return node;
    }

    function icon(name, size = 16) {
        const span = el("span", "sui-icon");
        span.setAttribute("aria-hidden", "true");
        // ICONS are our own constants, never AI text
        span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
        return span;
    }

    function svg(tag, attrs = {}) {
        const node = document.createElementNS(SVG, tag);
        Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
        return node;
    }

    function hash(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(36);
    }

    function loadState(key) {
        try {
            return JSON.parse(localStorage.getItem(STORE_PREFIX + key) || "null") || {};
        } catch {
            return {};
        }
    }

    function saveState(key, state) {
        try {
            localStorage.setItem(STORE_PREFIX + key, JSON.stringify(state));
        } catch {}
    }

    function flash(button, text, ms = 1600) {
        const label = button.querySelector(".sui-btn-label");
        if (!label) return;
        const before = button.dataset.label || label.textContent;
        button.dataset.label = before;
        label.textContent = text;
        button.classList.add("is-done");
        clearTimeout(button._suiTimer);
        button._suiTimer = setTimeout(() => {
            label.textContent = before;
            button.classList.remove("is-done");
        }, ms);
    }

    /* ---------------- card shell ---------------- */

    function shell(card, partial) {
        const root = el("section", `sui-card sui-${card.type}`);
        root.dataset.suiType = card.type;
        if (partial) root.classList.add("is-partial");
        root.setAttribute("aria-label", card.title || TYPE_LABEL[card.type]);

        const head = el("header", "sui-head");
        const kicker = el("div", "sui-kicker");
        kicker.append(icon(card.type, 14), el("span", "", card.kicker || TYPE_LABEL[card.type]));
        head.append(kicker);
        if (card.title) head.append(el("h4", "sui-title", card.title));

        const body = el("div", "sui-body");
        root.append(head, body);
        return { root, body };
    }

    function footer(root, card, state, partial) {
        if (card.note) root.append(el("p", "sui-note", card.note));
        if (partial) {
            const building = el("div", "sui-building");
            building.append(el("span", "sui-dot"), el("span", "", "Building…"));
            root.append(building);
            return;
        }

        const actions = el("div", "sui-actions");

        const copyBtn = el("button", "sui-btn");
        copyBtn.type = "button";
        copyBtn.append(icon("copy", 14), el("span", "sui-btn-label", "Copy"));
        copyBtn.addEventListener("click", async () => {
            const text = cardToText(card, state);
            let ok = false;
            try {
                if (window.NeyoUI?.copy) ok = await window.NeyoUI.copy(text);
                else {
                    await navigator.clipboard.writeText(text);
                    ok = true;
                }
            } catch {}
            flash(copyBtn, ok === false ? "Copy failed" : "Copied");
        });
        actions.append(copyBtn);

        {
            const saveBtn = el("button", "sui-btn");
            saveBtn.type = "button";
            saveBtn.append(icon("save", 14), el("span", "sui-btn-label", "Save to Workspace"));
            saveBtn.addEventListener("click", async () => {
                if (!window.NeyoWorkspaces?.saveItem) {
                    flash(saveBtn, "Workspaces not ready", 2200);
                    return;
                }
                if (!window.NeyoWorkspaces.activeId?.()) {
                    flash(saveBtn, "Choose a workspace first", 2200);
                    try { window.NeyoWorkspaces.open?.(); } catch {}
                    return;
                }
                saveBtn.disabled = true;
                try {
                    await window.NeyoWorkspaces.saveItem(
                        card.title || TYPE_LABEL[card.type],
                        cardToText(card, state)
                    );
                    flash(saveBtn, "Saved", 2000);
                } catch (error) {
                    flash(saveBtn, "Couldn't save", 2200);
                    console.warn("[NEYO Smart UI] save failed:", error);
                } finally {
                    saveBtn.disabled = false;
                }
            });
            actions.append(saveBtn);
        }

        root.append(actions);
    }

    /* ---------------- calculator ---------------- */

    function buildCalculator(card, body, state, persist) {
        state.values = state.values || {};
        const inputsWrap = el("div", "sui-inputs");
        const outputsWrap = el("div", "sui-outputs");
        outputsWrap.setAttribute("aria-live", "polite");

        const outputNodes = card.outputs.map((output, i) => {
            const tile = el("div", `sui-out${i === 0 || output.big ? " is-big" : ""}`);
            const value = el("div", "sui-out-value");
            tile.append(el("div", "sui-out-label", output.label), value);
            outputsWrap.append(tile);
            return value;
        });

        function refresh() {
            computeOutputs(card, state.values).forEach((out, i) => {
                const node = outputNodes[i];
                node.textContent = "";
                if (out.prefix) node.append(el("span", "sui-unit", out.prefix));
                node.append(document.createTextNode(out.text));
                if (out.unit) node.append(el("span", "sui-unit", ` ${out.unit}`));
            });
        }

        card.inputs.forEach(input => {
            const current = () => {
                const v = Number(state.values[input.id]);
                return Number.isFinite(v) ? v : input.value;
            };
            const set = v => {
                const fixed = Number(Math.min(input.max, Math.max(input.min, v)).toFixed(6));
                state.values[input.id] = fixed;
                show();
                refresh();
                persist();
            };

            const row = el("div", "sui-input");
            const label = el("label", "sui-input-label", input.label);
            const control = el("div", "sui-stepper");
            const minus = el("button", "sui-step");
            minus.type = "button";
            minus.setAttribute("aria-label", `Decrease ${input.label}`);
            minus.append(icon("minus", 15));
            const plus = el("button", "sui-step");
            plus.type = "button";
            plus.setAttribute("aria-label", `Increase ${input.label}`);
            plus.append(icon("plus", 15));
            const value = el("output", "sui-step-value");
            control.append(minus, value, plus);

            let slider = null;
            if (input.slider) {
                slider = el("input", "sui-slider");
                slider.type = "range";
                slider.min = input.min;
                slider.max = input.max;
                slider.step = input.step;
                slider.setAttribute("aria-label", input.label);
                slider.addEventListener("input", () => set(Number(slider.value)));
            }

            function show() {
                const v = current();
                value.textContent = `${formatNumber(v)}${input.unit ? ` ${input.unit}` : ""}`;
                minus.disabled = v <= input.min;
                plus.disabled = v >= input.max;
                if (slider) {
                    slider.value = v;
                    const pct = ((v - input.min) / (input.max - input.min || 1)) * 100;
                    slider.style.setProperty("--sui-fill", `${pct}%`);
                }
            }

            minus.addEventListener("click", () => set(current() - input.step));
            plus.addEventListener("click", () => set(current() + input.step));
            row.addEventListener("keydown", event => {
                if (event.target === slider) return;
                if (event.key === "ArrowUp" || event.key === "ArrowRight") {
                    event.preventDefault();
                    set(current() + input.step);
                } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    set(current() - input.step);
                }
            });

            const top = el("div", "sui-input-top");
            top.append(label, control);
            row.append(top);
            if (slider) row.append(slider);
            inputsWrap.append(row);
            show();
        });

        body.append(inputsWrap, outputsWrap);
        refresh();
    }

    /* ---------------- checklist / timeline ---------------- */

    function buildChecklist(card, body, state, persist) {
        state.done = state.done || {};
        const timeline = card.items.some(item => item.time);
        const progress = el("div", "sui-progress");
        const bar = el("div", "sui-progress-bar");
        const fill = el("span", "sui-progress-fill");
        bar.append(fill);
        const count = el("span", "sui-progress-text");
        progress.append(bar, count);

        const listNode = el("ol", `sui-list${timeline ? " is-timeline" : ""}`);

        function update() {
            const done = card.items.filter((_, i) => state.done[i]).length;
            count.textContent = `${done} of ${card.items.length}`;
            fill.style.width = `${(done / card.items.length) * 100}%`;
            progress.classList.toggle("is-complete", done === card.items.length);
        }

        card.items.forEach((item, i) => {
            const li = el("li", "sui-item");
            const button = el("button", "sui-check");
            button.type = "button";
            button.setAttribute("role", "checkbox");
            const box = el("span", "sui-box");
            box.append(icon("check", 13));
            const text = el("span", "sui-item-text");
            if (item.time) text.append(el("span", "sui-time", item.time));
            text.append(el("span", "sui-item-title", item.title));
            if (item.text) text.append(el("span", "sui-item-desc", item.text));
            button.append(box, text);

            const paint = () => {
                const on = Boolean(state.done[i]);
                li.classList.toggle("is-done", on);
                button.setAttribute("aria-checked", on ? "true" : "false");
            };
            button.addEventListener("click", () => {
                state.done[i] = !state.done[i];
                paint();
                update();
                persist();
            });
            paint();
            li.append(button);
            listNode.append(li);
        });

        update();
        body.append(progress, listNode);
    }

    /* ---------------- chart ---------------- */

    function buildChart(card, body) {
        const W = 640;
        const H = 280;
        const all = card.series.flatMap(s => s.data);
        const scale = niceScale(Math.max(...all), Math.min(...all));
        const tickText = t => `${card.prefix}${compactNumber(t)}`;
        const widest = Math.max(...scale.ticks.map(t => tickText(t).length));
        const pad = { l: Math.min(90, 18 + widest * 7.2), r: 16, t: 14, b: 40 };
        const plotW = W - pad.l - pad.r;
        const plotH = H - pad.t - pad.b;
        const y = v => pad.t + plotH - ((v - scale.min) / (scale.max - scale.min || 1)) * plotH;
        const n = card.labels.length;
        const band = plotW / n;

        const wrap = el("div", "sui-chart-wrap");
        const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "sui-chart", role: "img" });
        chart.setAttribute("aria-label", card.title || "Chart");
        const tip = el("div", "sui-tip");
        tip.hidden = true;

        const fmt = v => `${card.prefix}${formatNumber(v)}${card.unit ? ` ${card.unit}` : ""}`;

        scale.ticks.forEach(t => {
            chart.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: t === 0 ? "sui-axis" : "sui-grid" }));
            const label = svg("text", { x: pad.l - 10, y: y(t) + 4, "text-anchor": "end", class: "sui-tick" });
            label.textContent = tickText(t);
            chart.append(label);
        });

        const every = Math.ceil(n / 8);
        card.labels.forEach((labelText, i) => {
            if (i % every !== 0 && i !== n - 1) return;
            const label = svg("text", { x: pad.l + band * i + band / 2, y: H - 14, "text-anchor": "middle", class: "sui-tick" });
            label.textContent = labelText.length > 12 ? `${labelText.slice(0, 11)}…` : labelText;
            chart.append(label);
        });

        function showTip(event, i) {
            tip.textContent = "";
            tip.append(el("strong", "", card.labels[i]));
            card.series.forEach((s, k) => {
                const row = el("div", "sui-tip-row");
                const dot = el("span", `sui-swatch s${k}`);
                row.append(dot, el("span", "", `${s.name ? `${s.name}: ` : ""}${fmt(s.data[i] ?? 0)}`));
                tip.append(row);
            });
            tip.hidden = false;
            const box = wrap.getBoundingClientRect();
            const x = (event.clientX ?? box.left + box.width / 2) - box.left;
            tip.style.left = `${Math.min(Math.max(x, 70), box.width - 70)}px`;
            tip.style.top = `${Math.max(((event.clientY ?? box.top) - box.top) - 12, 10)}px`;
        }

        if (card.kind === "bar") {
            const groups = card.series.length;
            const gap = Math.min(10, band * 0.18);
            const barW = Math.max(3, Math.min(42, (band - gap * 2) / groups));
            card.labels.forEach((_, i) => {
                const start = pad.l + band * i + (band - barW * groups) / 2;
                card.series.forEach((s, k) => {
                    if (s.data[i] === undefined) return; // still streaming
                    const v = s.data[i];
                    const top = Math.min(y(v), y(0));
                    const h = Math.max(1, Math.abs(y(v) - y(0)));
                    // rounded on the value end only
                    const x = start + barW * k + 1;
                    const w = Math.max(2, barW - 2);
                    const r = Math.min(6, w / 3, h);
                    const up = v >= 0;
                    const d = up
                        ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${top + h} Z`
                        : `M${x},${top} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + w - r} Q${x + w},${top + h} ${x + w},${top + h - r} V${top} Z`;
                    const bar = svg("path", { d, class: `sui-bar s${k}${up ? "" : " is-neg"}`, style: `--i:${i}` });
                    chart.append(bar);
                });
            });
        } else {
            card.series.forEach((s, k) => {
                const pts = s.data.slice(0, n).map((v, i) => [pad.l + band * i + band / 2, y(v)]);
                if (k === 0 && card.series.length === 1 && pts.length > 1) {
                    const area = `M${pts[0][0]},${y(Math.max(scale.min, 0))} ` +
                        pts.map(p => `L${p[0]},${p[1]}`).join(" ") +
                        ` L${pts[pts.length - 1][0]},${y(Math.max(scale.min, 0))} Z`;
                    chart.append(svg("path", { d: area, class: "sui-area" }));
                }
                chart.append(svg("polyline", { points: pts.map(p => p.join(",")).join(" "), class: `sui-line s${k}` }));
                pts.forEach(p => chart.append(svg("circle", { cx: p[0], cy: p[1], r: 3.5, class: `sui-point s${k}` })));
            });
        }

        // one invisible hit area per label: works for touch + mouse
        card.labels.forEach((_, i) => {
            const hit = svg("rect", { x: pad.l + band * i, y: pad.t, width: band, height: plotH, class: "sui-hit" });
            hit.addEventListener("pointerenter", e => showTip(e, i));
            hit.addEventListener("pointermove", e => showTip(e, i));
            hit.addEventListener("pointerleave", () => { tip.hidden = true; });
            chart.append(hit);
        });

        wrap.append(chart, tip);
        body.append(wrap);

        if (card.series.length > 1 || card.series[0].name) {
            const legend = el("div", "sui-legend");
            card.series.forEach((s, k) => {
                const item = el("span", "sui-legend-item");
                item.append(el("span", `sui-swatch s${k}`), el("span", "", s.name || `Series ${k + 1}`));
                legend.append(item);
            });
            body.append(legend);
        }
    }

    /* ---------------- tabs ---------------- */

    function buildTabs(card, body, state, persist) {
        const bar = el("div", "sui-tabbar");
        bar.setAttribute("role", "tablist");
        const panel = el("div", "sui-tabpanel");
        panel.setAttribute("role", "tabpanel");
        const buttons = [];

        function select(index, focus = false) {
            state.tab = index;
            buttons.forEach((b, i) => {
                b.setAttribute("aria-selected", i === index ? "true" : "false");
                b.tabIndex = i === index ? 0 : -1;
            });
            const md = card.tabs[index].content;
            const renderer = window.NeyoMessageRenderer;
            if (renderer?.markdownToHtml) panel.innerHTML = renderer.markdownToHtml(md); // sanitised
            else panel.textContent = md;
            panel.classList.remove("is-in");
            void panel.offsetWidth;
            panel.classList.add("is-in");
            if (focus) buttons[index].focus();
            persist();
        }

        card.tabs.forEach((tab, i) => {
            const b = el("button", "sui-tab", tab.label);
            b.type = "button";
            b.setAttribute("role", "tab");
            b.addEventListener("click", () => select(i));
            b.addEventListener("keydown", event => {
                if (event.key === "ArrowRight") select((i + 1) % card.tabs.length, true);
                if (event.key === "ArrowLeft") select((i - 1 + card.tabs.length) % card.tabs.length, true);
            });
            buttons.push(b);
            bar.append(b);
        });

        body.append(bar, panel);
        select(Math.min(Number(state.tab) || 0, card.tabs.length - 1));
    }

    /* ---------------- compare ---------------- */

    function buildCompare(card, body) {
        const grid = el("div", "sui-compare-grid");
        grid.style.setProperty("--sui-cols", String(card.items.length));
        card.items.forEach(item => {
            const col = el("article", `sui-option${item.best ? " is-best" : ""}`);
            const top = el("div", "sui-option-top");
            top.append(el("h5", "sui-option-name", item.name));
            if (item.best) top.append(el("span", "sui-badge", "NEYO pick"));
            else if (item.tag) top.append(el("span", "sui-tag", item.tag));
            col.append(top);
            if (item.best && item.tag) col.append(el("span", "sui-tag", item.tag));
            if (item.summary) col.append(el("p", "sui-option-summary", item.summary));
            if (item.points.length) {
                const ul = el("ul", "sui-points");
                item.points.forEach(p => ul.append(el("li", "", p)));
                col.append(ul);
            }
            grid.append(col);
        });
        body.append(grid);
    }

    /* ---------------- quiz ---------------- */

    function buildQuiz(card, body, state, persist) {
        state.answers = Array.isArray(state.answers) ? state.answers : [];
        const box = el("div", "sui-quiz");
        body.append(box);

        function render() {
            box.textContent = "";
            const index = state.answers.length;

            if (index >= card.questions.length) {
                const score = state.answers.filter((a, i) => a === card.questions[i].answer).length;
                const done = el("div", "sui-quiz-done");
                done.append(
                    el("div", "sui-score", `${score}/${card.questions.length}`),
                    el("p", "", score === card.questions.length ? "Perfect score!" : score >= card.questions.length / 2 ? "Nice work." : "Keep practising — try again.")
                );
                const again = el("button", "sui-btn is-primary");
                again.type = "button";
                again.append(el("span", "sui-btn-label", "Try again"));
                again.addEventListener("click", () => {
                    state.answers = [];
                    state.picked = null;
                    persist();
                    render();
                });
                done.append(again);
                box.append(done);
                return;
            }

            const q = card.questions[index];
            const meta = el("div", "sui-quiz-meta", `Question ${index + 1} of ${card.questions.length}`);
            const dots = el("div", "sui-quiz-dots");
            card.questions.forEach((_, i) => {
                const d = el("span", "sui-qdot");
                if (i < index) d.classList.add(state.answers[i] === card.questions[i].answer ? "is-right" : "is-wrong");
                if (i === index) d.classList.add("is-now");
                dots.append(d);
            });
            const head = el("div", "sui-quiz-head");
            head.append(meta, dots);
            box.append(head, el("p", "sui-question", q.q));

            const options = el("div", "sui-options");
            const picked = Number.isInteger(state.picked) ? state.picked : null;
            q.options.forEach((text, j) => {
                const b = el("button", "sui-opt");
                b.type = "button";
                b.append(el("span", "sui-opt-key", String.fromCharCode(65 + j)), el("span", "", text));
                if (picked !== null) {
                    b.disabled = true;
                    if (j === q.answer) b.classList.add("is-right");
                    else if (j === picked) b.classList.add("is-wrong");
                }
                b.addEventListener("click", () => {
                    state.picked = j;
                    persist();
                    render();
                });
                options.append(b);
            });
            box.append(options);

            if (picked !== null) {
                const right = picked === q.answer;
                const feedback = el("div", `sui-feedback ${right ? "is-right" : "is-wrong"}`);
                feedback.setAttribute("role", "status");
                feedback.append(el("strong", "", right ? "Correct" : "Not quite"));
                if (q.explain) feedback.append(el("span", "", ` — ${q.explain}`));
                const next = el("button", "sui-btn is-primary");
                next.type = "button";
                next.append(el("span", "sui-btn-label", index + 1 === card.questions.length ? "See score" : "Next"));
                next.addEventListener("click", () => {
                    state.answers.push(picked);
                    state.picked = null;
                    persist();
                    render();
                });
                box.append(feedback, next);
            }
        }

        render();
    }

    const BUILDERS = {
        view: (card, body, state, persist) => buildView(card, body, state, persist, { el, svg, icon, buildChart }),
        calculator: buildCalculator,
        checklist: buildChecklist,
        chart: buildChart,
        tabs: buildTabs,
        compare: buildCompare,
        quiz: buildQuiz
    };

    /* ---------------- build one card ---------------- */

    function build(card, source, partial) {
        const key = hash(source);
        const state = partial ? {} : loadState(key);
        const persist = () => { if (!partial) saveState(key, state); };
        const { root, body } = shell(card, partial);
        try {
            BUILDERS[card.type](card, body, state, persist);
        } catch (error) {
            console.warn("[NEYO Smart UI] card failed:", error);
            return null;
        }
        footer(root, card, state, partial);
        texts.set(root, () => cardToText(card, state));
        return root;
    }

    function skeleton() {
        const root = el("section", "sui-card is-partial is-skeleton");
        root.append(el("div", "sui-sk sui-sk-1"), el("div", "sui-sk sui-sk-2"), el("div", "sui-sk sui-sk-3"));
        const building = el("div", "sui-building");
        building.append(el("span", "sui-dot"), el("span", "", "Building…"));
        root.append(building);
        return root;
    }

    function remember(source, node) {
        cache.set(source, node);
        if (cache.size > 80) cache.delete(cache.keys().next().value);
    }

    /* ---------------- scan rendered messages ---------------- */

    function findBlocks(root) {
        return Array.from(root.querySelectorAll("pre > code"))
            .filter(code =>
                code.classList.contains("language-neyo-ui") ||
                code.parentElement?.dataset.language === "neyo-ui"
            );
    }

    function enhance(root, { final = !streaming } = {}) {
        if (!(root instanceof Element)) return;
        findBlocks(root).forEach(code => {
            const pre = code.parentElement;
            const frame = pre.closest(".neyo-code") || pre;
            const source = code.textContent || "";
            const parsed = parseCardSource(source, { complete: true });
            let node = null;

            if (parsed.card) {
                const cached = cache.get(source);
                node = cached && !cached.isConnected ? cached : build(parsed.card, source, false);
                if (node) {
                    if (!cached) node.classList.add("is-new");
                    remember(source, node);
                }
            } else if (!final) {
                const partial = parseCardSource(source, { complete: false });
                node = partial.card ? build(partial.card, source, true) : skeleton();
            }

            if (node) frame.replaceWith(node);
            else frame.remove(); // broken data after the answer ended: written answer stays
        });
    }

    function enhanceAll() {
        document.querySelectorAll(".message.assistant .message-content").forEach(content => enhance(content, { final: !streaming }));
    }

    window.addEventListener("neyo:message-rendered", event => {
        const element = event.detail?.element;
        if (event.detail?.role && event.detail.role !== "assistant") return;
        // while an answer streams, half data shows as "Building…";
        // the pass at the end of the stream removes anything still broken
        enhance(element, { final: !streaming });
    });

    window.addEventListener("neyo:chat-send-start", () => { streaming = true; });
    ["neyo:chat-send-end", "neyo:chat-aborted", "neyo:chat-error"].forEach(name =>
        window.addEventListener(name, () => {
            streaming = false;
            // finish any card that was still "building"
            setTimeout(() => {
                document.querySelectorAll(".sui-card.is-partial").forEach(card => card.remove());
                enhanceAll();
            }, 60);
        })
    );

    // messages rendered before this file loaded (history)
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhanceAll, { once: true });
    else enhanceAll();

    window.NeyoSmartUI = Object.freeze({
        enhance,
        enhanceAll,
        textOf: node => texts.get(node)?.() || "",
        version: 2
    });
})();
