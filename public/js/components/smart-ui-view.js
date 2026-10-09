/*
=========================================================
NEYO — SMART UI VIEW RENDERER v1
Draws a "view" card: a visual NEYO composed for this answer
from safe building blocks (stats, inputs, charts, tables,
lists, timelines, callouts, tabs, accordions, grids…).

- Every value is text or an SVG node built here; AI text
  never becomes HTML (Markdown goes through the shared,
  sanitised renderer).
- Inputs update every number, chart, text "{formula}" and
  "show" rule live, with the safe formula parser.
- State (inputs, ticks, open tab) is kept per card.
=========================================================
*/

import {
    viewVars,
    evalValue,
    fillTemplate,
    valueText,
    isVisible,
    chartNumbers,
    formatNumber,
    compactNumber,
    splitDuration,
    clockText,
    pomodoroPhase
} from "./smart-ui-core.js?v=3";

const SVG = "http://www.w3.org/2000/svg";

const TONE_ICON = {
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    good: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16 10"/>',
    warn: '<path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
    bad: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
    accent: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
    neutral: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="M7 14l5-5 5 5"/>',
    down: '<path d="M7 10l5 5 5-5"/>'
};

/* ---------------- live time: one shared ticker ----------------
   Each live block keeps its tick function on its own node; the
   ticker holds only weak refs, so removed cards are freed and a
   cached card that comes back on screen keeps ticking. Times are
   computed from Date.now(), so they stay right in hidden tabs. */
const tickers = new Set();
let tickHandle = 0;

function tickAll() {
    if (typeof document !== "undefined" && document.hidden) return;
    tickers.forEach(ref => {
        const node = ref.deref();
        if (!node) {
            tickers.delete(ref);
            return;
        }
        if (!node.isConnected) return;
        try { node._neyoTick?.(); } catch (error) { console.warn("[NEYO view] tick failed", error); }
    });
    if (!tickers.size) {
        clearInterval(tickHandle);
        tickHandle = 0;
    }
}

function addTicker(node, fn) {
    node._neyoTick = fn;
    fn();
    tickers.add(typeof WeakRef === "function" ? new WeakRef(node) : { deref: () => node });
    if (!tickHandle) tickHandle = setInterval(tickAll, 200);
    if (typeof document !== "undefined" && !addTicker.wired) {
        addTicker.wired = true;
        document.addEventListener("visibilitychange", tickAll);
    }
}

let audioCtx = null;
function chime() {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const t = audioCtx.currentTime;
        [0, 0.28, 0.56].forEach((at, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.frequency.value = i === 2 ? 1046 : 880;
            gain.gain.setValueAtTime(0.0001, t + at);
            gain.gain.exponentialRampToValueAtTime(0.25, t + at + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.24);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(t + at);
            osc.stop(t + at + 0.26);
        });
    } catch {}
}

function alertUser(title, text, sound) {
    if (sound) chime();
    try { navigator.vibrate?.([200, 100, 200]); } catch {}
    try {
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            new Notification(title, { body: text, silent: !sound });
        }
    } catch {}
    const before = document.title;
    let n = 0;
    const flash = setInterval(() => {
        document.title = n % 2 ? before : `⏰ ${title}`;
        if (++n > 7 || !document.hidden) {
            clearInterval(flash);
            document.title = before;
        }
    }, 900);
}

function askNotify() {
    try {
        if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch?.(() => {});
    } catch {}
}

function zoneParts(date, tz, hour12, seconds) {
    const opts = { hour: "numeric", minute: "2-digit", hour12 };
    if (seconds) opts.second = "2-digit";
    if (tz) opts.timeZone = tz;
    const time = new Intl.DateTimeFormat(undefined, opts).formatToParts(date);
    const dateOpts = { weekday: "long", day: "numeric", month: "short", year: "numeric" };
    if (tz) dateOpts.timeZone = tz;
    const hm = { hour: "numeric", minute: "numeric", second: "numeric", hour12: false };
    if (tz) hm.timeZone = tz;
    const raw = Object.fromEntries(new Intl.DateTimeFormat("en-GB", hm).formatToParts(date).map(p => [p.type, p.value]));
    return {
        main: time.filter(p => p.type !== "dayPeriod").map(p => p.value).join("").trim(),
        period: time.find(p => p.type === "dayPeriod")?.value || "",
        date: new Intl.DateTimeFormat(undefined, dateOpts).format(date),
        h: Number(raw.hour) % 24,
        m: Number(raw.minute),
        s: Number(raw.second)
    };
}

function zoneName(tz) {
    if (!tz) {
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}
        return tz ? `${tz.split("/").pop().replace(/_/g, " ")} (you)` : "Your time";
    }
    return tz.split("/").pop().replace(/_/g, " ");
}

export function buildView(card, body, state, persist, kit) {
    const { el, svg, icon, buildChart } = kit;
    state.values = state.values && typeof state.values === "object" ? state.values : {};
    state.checks = state.checks && typeof state.checks === "object" ? state.checks : {};
    state.tabs = state.tabs && typeof state.tabs === "object" ? state.tabs : {};
    state.live = state.live && typeof state.live === "object" ? state.live : {};
    const live = Object.keys(card.values || {}).length > 0;
    const updaters = [];
    const vars = () => viewVars(card, state);

    function glyph(name, size = 16) {
        const span = el("span", "sui-icon");
        span.setAttribute("aria-hidden", "true");
        // our own constants only
        span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TONE_ICON[name] || ""}</svg>`;
        return span;
    }

    function markdownInto(node, text) {
        const renderer = window.NeyoMessageRenderer;
        if (renderer?.markdownToHtml && /[*_`#\-\d]/.test(text)) {
            node.innerHTML = renderer.markdownToHtml(text); // sanitised by the shared renderer
        } else {
            node.textContent = text;
        }
    }

    function refresh() {
        updaters.forEach(fn => {
            try { fn(); } catch (error) { console.warn("[NEYO view] update failed", error); }
        });
    }

    function setValue(id, value) {
        state.values[id] = value;
        persist();
        refresh();
    }

    /* reactive leaf: paint now, and again after every input change */
    function reactive(node, paint) {
        paint();
        if (live) updaters.push(paint);
        return node;
    }

    /* ---------------- blocks ---------------- */

    function renderBlocks(blocks, parent) {
        blocks.forEach(block => {
            const node = renderBlock(block);
            if (node) parent.append(node);
        });
    }

    function renderBlock(block) {
        let node = null;
        try {
            node = BUILD[block.type]?.(block);
        } catch (error) {
            console.warn("[NEYO view] block failed", block.type, error);
            node = null;
        }
        if (!node) return null;
        node.classList.add("suv-block");
        if (block.show) {
            const paint = () => { node.hidden = !isVisible(block, vars()); };
            paint();
            updaters.push(paint);
        }
        return node;
    }

    const BUILD = {
        text(block) {
            const node = el("div", `suv-text is-${block.size} tone-${block.tone}`);
            return reactive(node, () => markdownInto(node, fillTemplate(block.text, vars())));
        },

        heading(block) {
            const node = el("h5", "suv-heading");
            return reactive(node, () => { node.textContent = fillTemplate(block.text, vars()); });
        },

        stat(block) {
            const tile = el("div", `suv-stat tone-${block.tone}${block.big ? " is-big" : ""}`);
            const label = el("div", "suv-stat-label", block.label);
            const value = el("div", "suv-stat-value");
            value.setAttribute("aria-live", "polite");
            const hint = el("div", "suv-stat-hint");
            tile.append(label, value);
            if (block.hint) tile.append(hint);
            return reactive(tile, () => {
                const v = vars();
                value.textContent = "";
                if (block.value.text !== undefined) {
                    value.textContent = fillTemplate(block.value.text, v);
                } else {
                    const n = evalValue(block.value, v);
                    if (block.prefix) value.append(el("span", "suv-unit suv-prefix", block.prefix.trim()));
                    value.append(document.createTextNode(formatNumber(n, block.decimals)));
                    if (block.unit) value.append(el("span", "suv-unit", ` ${block.unit}`));
                }
                if (block.trend) value.append(glyph(block.trend, 16));
                if (block.hint) hint.textContent = fillTemplate(block.hint, v);
            });
        },

        grid(block) {
            const node = el("div", "suv-grid");
            node.style.setProperty("--suv-cols", String(block.cols));
            if (block.blocks.every(child => child.type === "stat")) node.classList.add("is-stats");
            renderBlocks(block.blocks, node);
            return node;
        },

        card(block) {
            const node = el("div", `suv-card tone-${block.tone}`);
            if (block.title || block.tag) {
                const top = el("div", "suv-card-top");
                if (block.title) top.append(el("div", "suv-card-title", block.title));
                if (block.tag) top.append(el("span", `suv-badge tone-${block.tone === "neutral" ? "accent" : block.tone}`, block.tag));
                node.append(top);
            }
            renderBlocks(block.blocks, node);
            return node;
        },

        input(block) {
            const current = () => {
                const v = Number(state.values[block.id]);
                return Number.isFinite(v) ? v : block.value;
            };
            const row = el("div", `suv-input is-${block.kind}`);
            const labelId = `suv-${block.path}-${Math.random().toString(36).slice(2, 7)}`;
            const label = el("label", "sui-input-label", block.label);
            label.id = labelId;

            if (block.kind === "toggle") {
                const sw = el("button", "suv-switch");
                sw.type = "button";
                sw.setAttribute("role", "switch");
                sw.setAttribute("aria-labelledby", labelId);
                sw.append(el("span", "suv-knob"));
                const paint = () => sw.setAttribute("aria-checked", current() ? "true" : "false");
                sw.addEventListener("click", () => { setValue(block.id, current() ? 0 : 1); paint(); });
                paint();
                row.append(label, sw);
                return row;
            }

            if (block.kind === "segment") {
                const group = el("div", "suv-segment");
                group.setAttribute("role", "radiogroup");
                group.setAttribute("aria-labelledby", labelId);
                const buttons = block.options.map(option => {
                    const b = el("button", "suv-seg", option.label);
                    b.type = "button";
                    b.setAttribute("role", "radio");
                    b.addEventListener("click", () => { setValue(block.id, option.value); paint(); });
                    group.append(b);
                    return b;
                });
                const paint = () => buttons.forEach((b, i) => b.setAttribute("aria-checked", block.options[i].value === current() ? "true" : "false"));
                paint();
                row.append(label, group);
                return row;
            }

            if (block.kind === "select") {
                const select = el("select", "suv-select");
                select.setAttribute("aria-labelledby", labelId);
                block.options.forEach((option, i) => {
                    const o = el("option", "", option.label);
                    o.value = String(i);
                    select.append(o);
                });
                const index = Math.max(0, block.options.findIndex(o => o.value === current()));
                select.value = String(index);
                select.addEventListener("change", () => {
                    const option = block.options[Number(select.value)];
                    if (option) setValue(block.id, option.value);
                });
                row.append(label, select);
                return row;
            }

            // slider / number: stepper, plus a slider for wide ranges
            const set = v => {
                const fixed = Number(Math.min(block.max, Math.max(block.min, v)).toFixed(6));
                setValue(block.id, fixed);
                show();
            };
            const control = el("div", "sui-stepper");
            const minus = el("button", "sui-step");
            minus.type = "button";
            minus.setAttribute("aria-label", `Decrease ${block.label}`);
            minus.append(icon("minus", 15));
            const plus = el("button", "sui-step");
            plus.type = "button";
            plus.setAttribute("aria-label", `Increase ${block.label}`);
            plus.append(icon("plus", 15));
            const value = el("output", "sui-step-value");
            control.append(minus, value, plus);
            let slider = null;
            if (block.kind === "slider" || (block.max - block.min) / block.step > 30) {
                slider = el("input", "sui-slider");
                slider.type = "range";
                slider.min = block.min;
                slider.max = block.max;
                slider.step = block.step;
                slider.setAttribute("aria-labelledby", labelId);
                slider.addEventListener("input", () => set(Number(slider.value)));
            }
            function show() {
                const v = current();
                value.textContent = `${block.prefix}${formatNumber(v)}${block.unit ? ` ${block.unit}` : ""}`;
                minus.disabled = v <= block.min;
                plus.disabled = v >= block.max;
                if (slider) {
                    slider.value = v;
                    slider.style.setProperty("--sui-fill", `${((v - block.min) / (block.max - block.min || 1)) * 100}%`);
                }
            }
            minus.addEventListener("click", () => set(current() - block.step));
            plus.addEventListener("click", () => set(current() + block.step));
            const top = el("div", "sui-input-top");
            top.append(label, control);
            row.classList.add("sui-input");
            row.append(top);
            if (slider) row.append(slider);
            show();
            return row;
        },

        progress(block) {
            const node = el("div", `suv-progress is-${block.style} tone-${block.tone}`);
            if (block.style === "ring") {
                const ring = svg("svg", { viewBox: "0 0 120 120", class: "suv-ring", role: "img" });
                const r = 50;
                const c = 2 * Math.PI * r;
                ring.append(svg("circle", { cx: 60, cy: 60, r, class: "suv-ring-track" }));
                const arc = svg("circle", { cx: 60, cy: 60, r, class: "suv-ring-fill", "stroke-dasharray": c, transform: "rotate(-90 60 60)" });
                ring.append(arc);
                const center = el("div", "suv-ring-center");
                const big = el("div", "suv-ring-value");
                const small = el("div", "suv-ring-label", block.label);
                center.append(big, small);
                const wrap = el("div", "suv-ring-wrap");
                wrap.append(ring, center);
                node.append(wrap);
                return reactive(node, () => {
                    const v = vars();
                    const value = evalValue(block.value, v);
                    const max = evalValue(block.max, v) || 100;
                    const pct = Math.max(0, Math.min(1, value / max));
                    arc.setAttribute("stroke-dashoffset", String(c * (1 - pct)));
                    big.textContent = `${formatNumber(pct * 100, 0)}%`;
                    ring.setAttribute("aria-label", `${block.label} ${formatNumber(pct * 100, 0)}%`);
                });
            }
            const top = el("div", "suv-progress-top");
            const label = el("span", "suv-progress-label", block.label);
            const text = el("span", "suv-progress-value");
            top.append(label, text);
            const bar = el("div", "sui-progress-bar");
            const fill = el("span", "sui-progress-fill");
            bar.append(fill);
            node.append(top, bar);
            return reactive(node, () => {
                const v = vars();
                const value = evalValue(block.value, v);
                const max = evalValue(block.max, v) || 100;
                const pct = Math.max(0, Math.min(1, value / max));
                fill.style.width = `${pct * 100}%`;
                text.textContent = `${formatNumber(value)}${block.unit ? ` ${block.unit}` : ""} / ${formatNumber(max)}${block.unit ? ` ${block.unit}` : ""}`;
            });
        },

        chart(block) {
            const node = el("div", `suv-chart is-${block.kind}`);
            return reactive(node, () => {
                node.textContent = "";
                const series = chartNumbers(block, vars());
                if (block.kind === "pie" || block.kind === "donut") drawPie(node, block, series[0]);
                else if (block.kind === "hbar") drawHBars(node, block, series);
                else buildChart({ kind: block.kind === "bar" ? "bar" : "line", labels: block.labels, series, prefix: block.prefix, unit: block.unit, title: "" }, node);
            });
        },

        table(block) {
            const wrap = el("div", "suv-table-wrap");
            const table = el("table", "suv-table");
            if (block.columns.length) {
                const thead = el("thead");
                const tr = el("tr");
                block.columns.forEach(col => tr.append(el("th", "", col)));
                thead.append(tr);
                table.append(thead);
            }
            const tbody = el("tbody");
            const cells = [];
            block.rows.forEach((row, r) => {
                const tr = el("tr", r === block.highlight ? "is-highlight" : "");
                row.forEach(cell => {
                    const td = el("td");
                    cells.push([td, cell]);
                    tr.append(td);
                });
                tbody.append(tr);
            });
            table.append(tbody);
            wrap.append(table);
            return reactive(wrap, () => {
                const v = vars();
                cells.forEach(([td, text]) => { td.textContent = fillTemplate(text, v); });
            });
        },

        list(block) {
            const tag = block.style === "number" ? "ol" : "ul";
            const node = el(tag, `suv-list is-${block.style}`);
            let progressText = null;
            let progressFill = null;
            let wrap = node;
            if (block.style === "check") {
                wrap = el("div", "suv-checklist");
                const progress = el("div", "sui-progress");
                const bar = el("div", "sui-progress-bar");
                progressFill = el("span", "sui-progress-fill");
                bar.append(progressFill);
                progressText = el("span", "sui-progress-text");
                progress.append(bar, progressText);
                wrap.append(progress, node);
            }
            const keys = block.items.map((_, i) => `${block.path}_${i}`);
            const updateProgress = () => {
                if (!progressText) return;
                const done = keys.filter(k => state.checks[k]).length;
                progressText.textContent = `${done} of ${keys.length}`;
                progressFill.style.width = `${(done / keys.length) * 100}%`;
                progressFill.parentElement.parentElement.classList.toggle("is-complete", done === keys.length);
            };
            const texts = [];
            block.items.forEach((item, i) => {
                const li = el("li", "suv-li");
                const text = el("span", "sui-item-text");
                if (item.time) text.append(el("span", "sui-time", item.time));
                const title = el("span", "sui-item-title");
                text.append(title);
                const desc = item.text ? el("span", "sui-item-desc") : null;
                if (desc) text.append(desc);
                texts.push([title, item.title, desc, item.text]);
                if (block.style === "check") {
                    li.classList.add("sui-item");
                    const button = el("button", "sui-check");
                    button.type = "button";
                    button.setAttribute("role", "checkbox");
                    const box = el("span", "sui-box");
                    box.append(icon("check", 13));
                    button.append(box, text);
                    const paint = () => {
                        const on = Boolean(state.checks[keys[i]]);
                        li.classList.toggle("is-done", on);
                        button.setAttribute("aria-checked", on ? "true" : "false");
                    };
                    button.addEventListener("click", () => {
                        state.checks[keys[i]] = !state.checks[keys[i]];
                        paint();
                        updateProgress();
                        persist();
                    });
                    paint();
                    li.append(button);
                } else {
                    li.append(text);
                }
                node.append(li);
            });
            updateProgress();
            return reactive(wrap, () => {
                const v = vars();
                texts.forEach(([t, a, d, b]) => {
                    t.textContent = fillTemplate(a, v);
                    if (d) d.textContent = fillTemplate(b, v);
                });
            });
        },

        timeline(block) {
            const node = el("ol", "suv-timeline");
            block.items.forEach(item => {
                const li = el("li", `suv-tl tone-${item.tone}`);
                li.append(el("span", "suv-tl-dot"));
                const body = el("div", "suv-tl-body");
                if (item.time) body.append(el("div", "suv-tl-time", item.time));
                body.append(el("div", "suv-tl-title", item.title));
                if (item.text) body.append(el("div", "suv-tl-text", item.text));
                li.append(body);
                node.append(li);
            });
            return node;
        },

        callout(block) {
            const node = el("div", `suv-callout tone-${block.tone}`);
            node.append(glyph(block.tone, 18));
            const body = el("div", "suv-callout-body");
            const title = block.title ? el("div", "suv-callout-title", block.title) : null;
            const text = el("div", "suv-callout-text");
            if (title) body.append(title);
            body.append(text);
            node.append(body);
            return reactive(node, () => markdownInto(text, fillTemplate(block.text, vars())));
        },

        kv(block) {
            const node = el("dl", "suv-kv");
            const values = block.items.map(item => {
                const row = el("div", "suv-kv-row");
                const dd = el("dd");
                row.append(el("dt", "", item.label), dd);
                node.append(row);
                return [dd, item.value];
            });
            return reactive(node, () => {
                const v = vars();
                values.forEach(([dd, text]) => { dd.textContent = fillTemplate(text, v); });
            });
        },

        badges(block) {
            const node = el("div", "suv-badges");
            block.items.forEach(item => node.append(el("span", `suv-badge tone-${item.tone}`, item.text)));
            return node;
        },

        tabs(block) {
            const node = el("div", "suv-tabs");
            const bar = el("div", "sui-tabbar");
            bar.setAttribute("role", "tablist");
            const panels = [];
            const buttons = [];
            const select = (index, focus = false) => {
                state.tabs[block.path] = index;
                buttons.forEach((b, i) => {
                    b.setAttribute("aria-selected", i === index ? "true" : "false");
                    b.tabIndex = i === index ? 0 : -1;
                    panels[i].hidden = i !== index;
                });
                panels[index].classList.remove("is-in");
                void panels[index].offsetWidth;
                panels[index].classList.add("is-in");
                if (focus) buttons[index].focus();
                persist();
            };
            block.tabs.forEach((tab, i) => {
                const b = el("button", "sui-tab", tab.label);
                b.type = "button";
                b.setAttribute("role", "tab");
                b.addEventListener("click", () => select(i));
                b.addEventListener("keydown", event => {
                    if (event.key === "ArrowRight") select((i + 1) % block.tabs.length, true);
                    if (event.key === "ArrowLeft") select((i - 1 + block.tabs.length) % block.tabs.length, true);
                });
                buttons.push(b);
                bar.append(b);
                const panel = el("div", "suv-tabpanel sui-tabpanel");
                panel.setAttribute("role", "tabpanel");
                renderBlocks(tab.blocks, panel);
                panels.push(panel);
            });
            node.append(bar, ...panels);
            select(Math.min(Number(state.tabs[block.path]) || 0, block.tabs.length - 1));
            return node;
        },

        accordion(block) {
            const node = el("div", "suv-accordion");
            block.items.forEach(item => {
                const details = el("details", "suv-acc");
                const summary = el("summary", "suv-acc-head");
                summary.append(el("span", "", item.title), glyph("chevron", 16));
                const body = el("div", "suv-acc-body");
                renderBlocks(item.blocks, body);
                details.append(summary, body);
                node.append(details);
            });
            return node;
        },

        divider() {
            return el("hr", "suv-divider");
        },

        clock(block) {
            const node = el("div", `suv-clock is-${block.style}${block.zones.length > 1 ? " is-multi" : ""}`);
            if (block.label) node.append(el("div", "suv-live-label", block.label));
            const list = el("div", "suv-clock-list");
            node.append(list);
            const painters = block.zones.map(zone => {
                const item = el("div", "suv-clock-item");
                const name = el("div", "suv-clock-zone", zone.label || zoneName(zone.tz));
                let hands = null;
                if (block.style !== "digital") {
                    const face = svg("svg", { viewBox: "0 0 100 100", class: "suv-analog", role: "img" });
                    face.append(svg("circle", { cx: 50, cy: 50, r: 47, class: "suv-analog-face" }));
                    for (let i = 0; i < 60; i++) {
                        const a = (i / 60) * Math.PI * 2;
                        const r1 = i % 5 ? 42 : 38;
                        face.append(svg("line", { x1: 50 + r1 * Math.sin(a), y1: 50 - r1 * Math.cos(a), x2: 50 + 44 * Math.sin(a), y2: 50 - 44 * Math.cos(a), class: i % 5 ? "suv-tick" : "suv-tick is-hour" }));
                    }
                    hands = {
                        h: svg("line", { x1: 50, y1: 50, x2: 50, y2: 27, class: "suv-hand is-h" }),
                        m: svg("line", { x1: 50, y1: 50, x2: 50, y2: 15, class: "suv-hand is-m" }),
                        s: svg("line", { x1: 50, y1: 56, x2: 50, y2: 12, class: "suv-hand is-s" })
                    };
                    face.append(hands.h, hands.m, block.seconds ? hands.s : svg("g"), svg("circle", { cx: 50, cy: 50, r: 2.6, class: "suv-hand-pin" }));
                    item.append(face);
                }
                const digital = el("div", "suv-clock-time");
                digital.setAttribute("aria-live", "off");
                const main = el("span", "suv-clock-main");
                const period = el("span", "suv-clock-period");
                digital.append(main, period);
                const date = el("div", "suv-clock-date");
                const text = el("div", "suv-clock-text");
                text.append(name, digital);
                if (block.date) text.append(date);
                item.append(text);
                list.append(item);
                return now => {
                    const p = zoneParts(now, zone.tz, block.hour12, block.seconds);
                    main.textContent = p.main;
                    period.textContent = p.period;
                    if (block.date) date.textContent = p.date;
                    if (hands) {
                        const sec = p.s + (now.getMilliseconds() / 1000);
                        hands.s.setAttribute("transform", `rotate(${sec * 6} 50 50)`);
                        hands.m.setAttribute("transform", `rotate(${(p.m + p.s / 60) * 6} 50 50)`);
                        hands.h.setAttribute("transform", `rotate(${((p.h % 12) + p.m / 60) * 30} 50 50)`);
                    }
                };
            });
            const live = el("div", "suv-live-dot", "Live");
            node.append(live);
            addTicker(node, () => {
                const now = new Date();
                painters.forEach(paint => paint(now));
            });
            return node;
        },

        countdown(block) {
            const node = el("div", "suv-countdown");
            const target = Date.parse(block.to);
            if (block.label) node.append(el("div", "suv-live-label", block.label));
            const units = el("div", "suv-cd-units");
            const cells = ["days", "hours", "minutes", "seconds"].map(key => {
                const cell = el("div", "suv-cd-cell");
                const value = el("div", "suv-cd-value", "0");
                cell.append(value, el("div", "suv-cd-name", { days: "Days", hours: "Hours", minutes: "Min", seconds: "Sec" }[key]));
                units.append(cell);
                return [key, value];
            });
            const done = el("div", "suv-cd-done", block.done);
            done.hidden = true;
            const when = el("div", "suv-cd-when", new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(target)));
            node.append(units, done, when);
            let fired = target <= Date.now();
            addTicker(node, () => {
                const left = target - Date.now();
                const d = splitDuration(left);
                cells.forEach(([key, value]) => {
                    const text = key === "days" ? String(d.days) : String(d[key]).padStart(2, "0");
                    if (value.textContent !== text) value.textContent = text;
                });
                const over = left <= 0;
                units.hidden = over;
                done.hidden = !over;
                if (over && !fired) {
                    fired = true;
                    alertUser(block.label || "Countdown", block.done, true);
                }
            });
            return node;
        },

        stopwatch(block) {
            const st = state.live[block.path] = { running: false, base: 0, since: 0, laps: [], ...(state.live[block.path] || {}) };
            const node = el("div", "suv-stopwatch");
            if (block.label) node.append(el("div", "suv-live-label", block.label));
            const time = el("div", "suv-big-time");
            const buttons = el("div", "suv-live-btns");
            const go = el("button", "sui-btn is-primary");
            const lap = el("button", "sui-btn");
            const reset = el("button", "sui-btn");
            [go, lap, reset].forEach(b => { b.type = "button"; });
            lap.textContent = "Lap";
            reset.textContent = "Reset";
            buttons.append(go, ...(block.laps ? [lap] : []), reset);
            const laps = el("ol", "suv-laps");
            node.append(time, buttons, laps);
            const elapsed = () => st.base + (st.running ? Date.now() - st.since : 0);
            const paintLaps = () => {
                laps.textContent = "";
                st.laps.slice(-20).forEach((ms, i, arr) => {
                    const prev = i ? arr[i - 1] : 0;
                    const li = el("li", "suv-lap");
                    li.append(el("span", "", `Lap ${st.laps.length - arr.length + i + 1}`), el("span", "suv-lap-split", `+${clockText(ms - prev, { hours: false, tenths: true })}`), el("span", "", clockText(ms, { hours: false, tenths: true })));
                    laps.prepend(li);
                });
            };
            const paintButtons = () => {
                go.textContent = st.running ? "Pause" : elapsed() ? "Resume" : "Start";
                lap.disabled = !st.running;
                reset.disabled = !elapsed();
            };
            go.addEventListener("click", () => {
                if (st.running) { st.base = elapsed(); st.running = false; }
                else { st.since = Date.now(); st.running = true; }
                persist(); paintButtons();
            });
            lap.addEventListener("click", () => { st.laps.push(elapsed()); persist(); paintLaps(); });
            reset.addEventListener("click", () => { Object.assign(st, { running: false, base: 0, since: 0, laps: [] }); persist(); paintLaps(); paintButtons(); time.textContent = clockText(0, { hours: false, tenths: true }); });
            paintLaps();
            paintButtons();
            addTicker(node, () => { time.textContent = clockText(elapsed(), { hours: false, tenths: true }); });
            return node;
        },

        timer(block) {
            const pomodoro = block.mode === "pomodoro";
            const st = state.live[block.path] = { running: false, base: 0, since: 0, total: block.minutes * 60000, fired: -1, ...(state.live[block.path] || {}) };
            const node = el("div", `suv-timer${pomodoro ? " is-pomodoro" : ""}`);
            if (block.label) node.append(el("div", "suv-live-label", block.label));
            const phase = el("div", "suv-timer-phase");
            const R = 54;
            const C = 2 * Math.PI * R;
            const ring = svg("svg", { viewBox: "0 0 128 128", class: "suv-timer-ring" });
            const track = svg("circle", { cx: 64, cy: 64, r: R, class: "suv-ring-track" });
            const bar = svg("circle", { cx: 64, cy: 64, r: R, class: "suv-ring-bar", "stroke-dasharray": C.toFixed(2), transform: "rotate(-90 64 64)" });
            ring.append(track, bar);
            const face = el("div", "suv-timer-face");
            const time = el("div", "suv-big-time");
            face.append(ring, time);
            const dots = el("div", "suv-pomo-dots");
            const presets = el("div", "suv-timer-presets");
            const buttons = el("div", "suv-live-btns");
            const go = el("button", "sui-btn is-primary");
            const reset = el("button", "sui-btn");
            const skip = el("button", "sui-btn");
            [go, reset, skip].forEach(b => { b.type = "button"; });
            reset.textContent = "Reset";
            skip.textContent = "Skip";
            buttons.append(go, reset, ...(pomodoro ? [skip] : []));
            node.append(...(pomodoro ? [phase] : []), face, ...(pomodoro ? [dots] : []), ...(block.presets.length && !pomodoro ? [presets] : []), buttons);

            const elapsed = () => st.base + (st.running ? Date.now() - st.since : 0);
            const totalMs = () => pomodoro ? (block.work + block.short) * 60000 * block.rounds + (block.long - block.short) * 60000 : st.total;
            const stop = () => { st.base = elapsed(); st.running = false; };

            block.presets.forEach(min => {
                const b = el("button", "suv-chip", `${formatNumber(min)} min`);
                b.type = "button";
                b.addEventListener("click", () => {
                    Object.assign(st, { running: false, base: 0, since: 0, total: min * 60000, fired: -1 });
                    persist(); paint(); paintButtons();
                });
                presets.append(b);
            });

            const paintButtons = () => {
                const e = elapsed();
                const finished = !pomodoro ? e >= st.total : pomodoroPhase(block, e).done;
                go.textContent = st.running ? "Pause" : finished ? "Again" : e ? "Resume" : "Start";
                reset.disabled = !e;
                Array.from(presets.children).forEach((b, i) => b.classList.toggle("is-active", block.presets[i] * 60000 === st.total));
            };

            function paint() {
                const e = elapsed();
                let remaining, length, label = "", index = 0, finished;
                if (pomodoro) {
                    const p = pomodoroPhase(block, e);
                    remaining = p.remaining; length = p.ms; index = p.index; finished = p.done;
                    label = finished ? "All rounds done" : p.kind === "work" ? `Focus · round ${p.round}/${block.rounds}` : p.kind === "long" ? "Long break" : "Short break";
                    node.dataset.phase = finished ? "done" : p.kind;
                    phase.textContent = label;
                    dots.textContent = "";
                    for (let r = 1; r <= block.rounds; r++) {
                        const dot = el("span", "suv-pomo-dot");
                        if (r < p.round || finished || (r === p.round && p.kind !== "work")) dot.classList.add("is-done");
                        else if (r === p.round) dot.classList.add("is-now");
                        dots.append(dot);
                    }
                } else {
                    remaining = Math.max(0, st.total - e); length = st.total; finished = remaining <= 0; index = 0;
                }
                const text = clockText(Math.ceil(remaining / 1000) * 1000, { hours: false });
                if (time.textContent !== text) time.textContent = text;
                bar.setAttribute("stroke-dashoffset", (C * (1 - (length ? remaining / length : 0))).toFixed(2));
                // alerts: once per finished phase
                if (st.running && pomodoro && index > 0 && st.fired < index - 1 && !finished) {
                    st.fired = index - 1;
                    persist();
                    alertUser(index % 2 ? "Break time" : "Back to focus", label, block.sound);
                }
                if (st.running && finished) {
                    st.base = Math.min(elapsed(), totalMs());
                    st.running = false;
                    st.fired = 999;
                    persist();
                    paintButtons();
                    alertUser(block.label || (pomodoro ? "Pomodoro" : "Timer"), pomodoro ? "All rounds done" : "Time's up!", block.sound);
                }
                node.classList.toggle("is-running", st.running);
                node.classList.toggle("is-finished", finished);
            }

            go.addEventListener("click", () => {
                const e = elapsed();
                const finished = !pomodoro ? e >= st.total : pomodoroPhase(block, e).done;
                if (st.running) stop();
                else {
                    if (finished) Object.assign(st, { base: 0, fired: -1 });
                    st.since = Date.now();
                    st.running = true;
                    askNotify();
                    if (block.sound) { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch {} }
                }
                persist(); paint(); paintButtons();
            });
            reset.addEventListener("click", () => { Object.assign(st, { running: false, base: 0, since: 0, fired: -1 }); persist(); paint(); paintButtons(); });
            skip.addEventListener("click", () => {
                const p = pomodoroPhase(block, elapsed());
                if (p.done) return;
                st.base += p.remaining;
                st.fired = p.index;
                persist(); paint(); paintButtons();
            });
            paintButtons();
            addTicker(node, paint);
            return node;
        }
    };

    /* ---------------- charts that the base chart doesn't draw ---------------- */

    function drawHBars(node, block, series) {
        const values = series[0]?.data || [];
        const max = Math.max(...values.map(v => Math.abs(v)), 0) || 1;
        const list = el("div", "suv-hbars");
        block.labels.forEach((label, i) => {
            const v = values[i] ?? 0;
            const row = el("div", "suv-hbar");
            const track = el("div", "suv-hbar-track");
            const fill = el("span", `suv-hbar-fill${v < 0 ? " is-neg" : ""}`);
            fill.style.width = `${(Math.abs(v) / max) * 100}%`;
            fill.style.setProperty("--i", String(i));
            track.append(fill);
            row.append(
                el("span", "suv-hbar-label", label),
                track,
                el("span", "suv-hbar-value", `${block.prefix}${compactNumber(v)}${block.unit ? ` ${block.unit}` : ""}`)
            );
            list.append(row);
        });
        node.append(list);
    }

    function drawPie(node, block, sr) {
        const values = (sr?.data || []).map(v => Math.max(0, v));
        const total = values.reduce((a, b) => a + b, 0);
        const wrap = el("div", "suv-pie");
        const size = 180;
        const r = 80;
        const inner = block.kind === "donut" ? 52 : 0;
        const chart = svg("svg", { viewBox: `0 0 ${size} ${size}`, class: "suv-pie-svg", role: "img" });
        chart.setAttribute("aria-label", block.labels.map((l, i) => `${l} ${formatNumber(values[i] || 0)}`).join(", "));
        let angle = -Math.PI / 2;
        const cx = size / 2;
        const cy = size / 2;
        const point = (radius, a) => [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
        values.forEach((v, i) => {
            if (!total || !v) return;
            const slice = (v / total) * Math.PI * 2;
            const end = angle + slice;
            const large = slice > Math.PI ? 1 : 0;
            let d;
            if (slice >= Math.PI * 2 - 1e-6) {
                d = inner
                    ? `M${cx - r},${cy} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0 M${cx - inner},${cy} a${inner},${inner} 0 1,1 ${inner * 2},0 a${inner},${inner} 0 1,1 ${-inner * 2},0`
                    : `M${cx - r},${cy} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
            } else {
                const [x1, y1] = point(r, angle);
                const [x2, y2] = point(r, end);
                if (inner) {
                    const [x3, y3] = point(inner, end);
                    const [x4, y4] = point(inner, angle);
                    d = `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`;
                } else {
                    d = `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`;
                }
            }
            chart.append(svg("path", { d, class: `suv-slice c${i % 8}`, "fill-rule": "evenodd" }));
            angle = end;
        });
        const figure = el("div", "suv-pie-figure");
        figure.append(chart);
        if (inner) {
            const center = el("div", "suv-pie-center");
            center.append(
                el("div", "suv-pie-total", `${block.prefix}${compactNumber(total)}`),
                el("div", "suv-pie-sub", block.unit || "Total")
            );
            figure.append(center);
        }
        const legend = el("div", "suv-pie-legend");
        block.labels.forEach((label, i) => {
            const v = values[i] || 0;
            const row = el("div", "suv-pie-row");
            row.append(
                el("span", `suv-dot c${i % 8}`),
                el("span", "suv-pie-name", label),
                el("span", "suv-pie-val", `${block.prefix}${compactNumber(v)}${block.unit ? ` ${block.unit}` : ""}`),
                el("span", "suv-pie-pct", total ? `${formatNumber((v / total) * 100, 0)}%` : "0%")
            );
            legend.append(row);
        });
        wrap.append(figure, legend);
        node.append(wrap);
    }

    const root = el("div", "suv-root");
    renderBlocks(card.blocks, root);
    body.append(root);
}
