/*
=========================================================
NEYO — MINI APPS v1
NEYO can answer with a small app it wrote itself (```neyo-app
block = one HTML file). It runs here inside the answer, in a
locked sandbox:

- <iframe sandbox="allow-scripts ..."> WITHOUT allow-same-origin:
  the app can't read NEYO's page, cookies, storage or account.
- A Content-Security-Policy is put first in the app's <head>:
  no network at all (no fetch, no CDN, no outside images).
- No popups, no top navigation, no downloads from inside.
- localStorage inside the app is a small per-app store kept by
  NEYO (so high scores survive), max 100 KB.
- The app tells us its height, errors and blocked files only
  through postMessage, checked against its own window.
=========================================================
*/

(() => {
    if (window.NeyoMiniApp) return;

    const STORE_PREFIX = "neyo_app_";
    const MAX_SOURCE = 120000;
    const MAX_STORE = 100000;
    const frames = new Map(); // contentWindow -> controller
    const cache = new Map(); // source -> card node (keeps a running app when the message re-renders)
    let streaming = false;
    let seq = 0;

    /* ---------------- helpers ---------------- */

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null && text !== "") node.textContent = text;
        return node;
    }

    const ICONS = {
        app: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
        restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
        code: '<path d="m9 8-5 4 5 4M15 8l5 4-5 4"/>',
        copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
        download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
        expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
        shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
        warn: '<path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
        fix: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
        play: '<path d="M7 5v14l12-7z"/>'
    };

    function icon(name, size = 15) {
        const span = el("span", "sui-icon");
        span.setAttribute("aria-hidden", "true");
        // our own constants only
        span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
        return span;
    }

    function button(name, label, className = "sui-btn") {
        const b = el("button", className);
        b.type = "button";
        b.append(icon(name, 14), el("span", "sui-btn-label", label));
        return b;
    }

    function flash(b, text, ms = 1600) {
        const label = b.querySelector(".sui-btn-label");
        if (!label) return;
        const before = b.dataset.label || label.textContent;
        b.dataset.label = before;
        label.textContent = text;
        clearTimeout(b._nyaTimer);
        b._nyaTimer = setTimeout(() => { label.textContent = before; }, ms);
    }

    function hash(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(36);
    }

    function decodeEntities(text) {
        const t = document.createElement("textarea");
        t.innerHTML = text;
        return t.value;
    }

    function appTitle(source) {
        const t = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "";
        const clean = decodeEntities(t.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
        return clean.slice(0, 70) || "Mini App";
    }

    function fixedHeight(source) {
        const v = Number(source.match(/<meta[^>]+name=["']neyo-height["'][^>]*content=["'](\d{2,4})["']/i)?.[1] || source.match(/<meta[^>]+content=["'](\d{2,4})["'][^>]*name=["']neyo-height["']/i)?.[1]);
        return Number.isFinite(v) && v > 0 ? Math.min(Math.max(v, 160), 1400) : 0;
    }

    function isDark() {
        return document.body.classList.contains("dark-mode");
    }

    /* the app wears NEYO's real colours: read them from the card it sits in */
    let probe = null;
    function toRgb(color) {
        try {
            probe = probe || document.createElement("canvas").getContext("2d");
            probe.fillStyle = "#000";
            probe.fillStyle = color;
            const c = probe.fillStyle;
            if (c.startsWith("#")) return [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
            return (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
        } catch {
            return [0, 0, 0];
        }
    }
    function hex(color) {
        return "#" + toRgb(color).map(n => Math.round(n).toString(16).padStart(2, "0")).join("");
    }
    function light(color) {
        const [r, g, b] = toRgb(color).map(n => {
            n /= 255;
            return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
    }

    function palette(host) {
        const dark = isDark();
        const cs = host && host.isConnected ? getComputedStyle(host) : null;
        const v = (name, fallback) => (cs && cs.getPropertyValue(name).trim()) || fallback;
        let bg = cs ? cs.backgroundColor : "";
        if (!bg || bg === "transparent" || /rgba\(.*,\s*0\)$/.test(bg)) bg = dark ? "#171717" : "#ffffff";
        const accent = v("--sui-accent", dark ? "#ffffff" : "#0f0f10");
        return {
            dark,
            bg: hex(bg),
            fg: hex(v("--r-text", dark ? "#e7e7ea" : "#1d1d1f")),
            strong: hex(v("--r-strong", dark ? "#ffffff" : "#0f0f10")),
            muted: hex(v("--r-muted", dark ? "#a1a1a8" : "#6e6e73")),
            line: hex(v("--r-line", dark ? "#2c2c31" : "#ececee")),
            soft: hex(v("--r-surface", dark ? "#1f1f23" : "#f7f7f8")),
            accent: hex(accent),
            accentFg: light(accent) ? "#111111" : "#ffffff",
            good: dark ? "#3ccf91" : "#15935f",
            bad: dark ? "#ff6b6b" : "#d64545",
            warn: dark ? "#f2b84b" : "#c98a12"
        };
    }

    function loadStore(key) {
        try {
            const data = JSON.parse(localStorage.getItem(STORE_PREFIX + key) || "{}");
            return data && typeof data === "object" && !Array.isArray(data) ? data : {};
        } catch {
            return {};
        }
    }

    function saveStore(key, data) {
        try {
            const text = JSON.stringify(data || {});
            if (text.length > MAX_STORE) return;
            if (text === "{}") localStorage.removeItem(STORE_PREFIX + key);
            else localStorage.setItem(STORE_PREFIX + key, text);
        } catch {}
    }

    /* ---------------- the app document ---------------- */

    const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none'";

    /* NEYO kit: every app starts already looking like NEYO.
       Element defaults use :where() (zero weight) so an app's own CSS still wins. */
    const KIT_CSS = `
:root{--bg:#fff;--fg:#1d1d1f;--strong:#0f0f10;--muted:#6e6e73;--line:#ececee;--soft:#f7f7f8;--card:var(--soft);--accent:#0f0f10;--accent-fg:#fff;--good:#15935f;--bad:#d64545;--warn:#c98a12;
--accent-soft:color-mix(in srgb,var(--accent) 10%,transparent);--hover:color-mix(in srgb,var(--fg) 6%,transparent);
--r-sm:10px;--r:14px;--r-lg:18px;--ease:cubic-bezier(.2,.8,.2,1);--shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px -12px rgba(0,0,0,.14);
--font:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color-scheme:light}
:root.dark{--shadow:0 1px 2px rgba(0,0,0,.3),0 10px 28px -12px rgba(0,0,0,.6);color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
:where(html,body){margin:0;background:var(--bg);color:var(--fg)}
:where(body){padding:6px 4px 10px;font:15px/1.55 var(--font);letter-spacing:-.006em;-webkit-font-smoothing:antialiased;overflow-x:hidden}
::selection{background:var(--accent-soft)}
:where(h1,h2,h3,h4){color:var(--strong);margin:0 0 .35em;line-height:1.2;letter-spacing:-.02em}
:where(h1){font-size:21px;font-weight:650}:where(h2){font-size:17px;font-weight:620}:where(h3){font-size:15px;font-weight:600}
:where(p){margin:0 0 .6em}:where(small){color:var(--muted)}
:where(a){color:var(--strong);text-underline-offset:3px}
:where(hr){border:0;border-top:1px solid var(--line);margin:14px 0}
:where(button){font:inherit;font-size:14px;font-weight:550;letter-spacing:-.005em;height:38px;padding:0 16px;display:inline-flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--strong);white-space:nowrap;user-select:none;-webkit-tap-highlight-color:transparent;transition:background .15s var(--ease),border-color .15s var(--ease),transform .12s var(--ease),opacity .15s}
:where(button:hover){background:var(--hover)}
:where(button:active){transform:scale(.97)}
:where(button:disabled){opacity:.4;cursor:default;transform:none}
:where(button.primary,button[data-primary]){background:var(--accent);border-color:transparent;color:var(--accent-fg)}
:where(button.primary:hover,button[data-primary]:hover){background:color-mix(in srgb,var(--accent) 88%,var(--bg))}
:where(button.ghost){border-color:transparent;background:transparent}
:where(button.ghost:hover){background:var(--hover)}
:where(button.danger){color:var(--bad)}
:where(button.icon){width:38px;padding:0}
:where(button.sm){height:30px;padding:0 11px;font-size:13px;border-radius:10px}
:where(button.sm.icon){width:30px}
:where(button.lg){height:46px;padding:0 22px;font-size:15px;border-radius:14px}
:where(button.pill){border-radius:999px}
:where(button.on,button[aria-pressed=true]){background:var(--accent);color:var(--accent-fg);border-color:transparent}
:where(input,select,textarea){font:inherit;font-size:14px;color:var(--strong);background:var(--soft);border:1px solid transparent;border-radius:12px;outline:none;transition:border-color .15s,box-shadow .15s,background .15s}
:where(input:not([type=checkbox],[type=radio],[type=range],[type=color]),select){height:40px;padding:0 12px}
:where(textarea){padding:10px 12px;min-height:90px;resize:vertical}
:where(input,select,textarea):focus{background:var(--bg);border-color:color-mix(in srgb,var(--accent) 55%,var(--line));box-shadow:0 0 0 3px var(--accent-soft)}
:where(input)::placeholder,:where(textarea)::placeholder{color:var(--muted)}
:where(input[type=checkbox],input[type=radio]){accent-color:var(--accent);width:17px;height:17px;margin:0}
:where(input[type=color]){width:38px;height:38px;padding:3px;border-radius:12px;background:var(--soft);cursor:pointer}
:where(input[type=range]){-webkit-appearance:none;appearance:none;width:100%;height:22px;background:transparent;padding:0;border:0;box-shadow:none}
:where(input[type=range])::-webkit-slider-runnable-track{height:4px;border-radius:4px;background:var(--line)}
:where(input[type=range])::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;margin-top:-7px;border-radius:50%;background:var(--bg);border:2px solid var(--accent);box-shadow:0 1px 3px rgba(0,0,0,.18)}
:where(input[type=range])::-moz-range-track{height:4px;border-radius:4px;background:var(--line)}
:where(input[type=range])::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--bg);border:2px solid var(--accent)}
:where(label){font-size:13px;color:var(--muted);font-weight:500}
:where(table){width:100%;border-collapse:collapse;font-size:14px}
:where(th){text-align:left;font-size:12px;font-weight:600;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line)}
:where(td){padding:9px 10px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
:where(canvas,svg){max-width:100%}
:where(canvas){display:block;touch-action:none}
:where(kbd){font:12px var(--mono);padding:2px 6px;border-radius:6px;border:1px solid var(--line);background:var(--soft);color:var(--strong)}
:focus-visible{outline:2px solid color-mix(in srgb,var(--accent) 70%,transparent);outline-offset:2px}
.app{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.header{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}
.header h1,.header h2{margin:0}
.sub{color:var(--muted);font-size:13.5px;margin:3px 0 0}
.muted{color:var(--muted)}.strong{color:var(--strong);font-weight:600}.small{font-size:13px}
.card{background:var(--soft);border-radius:var(--r-lg);padding:16px}
.card.outline{background:var(--bg);border:1px solid var(--line)}
.stage{position:relative;background:var(--soft);border-radius:var(--r-lg);overflow:hidden;display:grid;place-items:center;min-height:120px}
.stage>canvas{width:100%;height:auto}
.overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:20px;background:color-mix(in srgb,var(--bg) 72%,transparent);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:kit-in .22s var(--ease)}
.overlay[hidden]{display:none}
.overlay h2{margin:0}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.row.between{justify-content:space-between}.row.center,.center{justify-content:center;text-align:center}
.stack{display:flex;flex-direction:column;gap:10px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.spacer{flex:1}
.field{display:flex;flex-direction:column;gap:6px}
.stat{background:var(--soft);border-radius:var(--r);padding:12px 14px;min-width:0}
.stat .label{font-size:12px;color:var(--muted);font-weight:500}
.stat .value{font-size:22px;font-weight:650;color:var(--strong);letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.25}
.big{font-size:44px;font-weight:650;letter-spacing:-.035em;color:var(--strong);font-variant-numeric:tabular-nums;line-height:1.05}
.chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:999px;background:var(--soft);color:var(--fg);font-size:13px;font-weight:500;font-variant-numeric:tabular-nums}
.chip b{color:var(--strong);font-weight:650}
.chip.accent{background:var(--accent-soft);color:var(--strong)}
.badge{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:7px;font-size:12px;font-weight:600;background:var(--soft);color:var(--fg)}
.badge.good{color:var(--good);background:color-mix(in srgb,var(--good) 12%,transparent)}
.badge.bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 12%,transparent)}
.badge.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 14%,transparent)}
.seg{display:inline-flex;padding:3px;gap:2px;border-radius:12px;background:var(--soft)}
.seg button{height:32px;border:0;background:transparent;border-radius:9px;color:var(--muted);font-weight:550;padding:0 13px}
.seg button:hover{background:transparent;color:var(--strong)}
.seg button.on,.seg button[aria-pressed=true]{background:var(--bg);color:var(--strong);box-shadow:0 1px 2px rgba(0,0,0,.08),0 0 0 1px var(--line)}
.list{display:flex;flex-direction:column}
.list>*{display:flex;align-items:center;gap:10px;padding:10px 2px;border-bottom:1px solid var(--line)}
.list>*:last-child{border-bottom:0}
.progress{height:6px;border-radius:6px;background:var(--line);overflow:hidden}
.progress>i{display:block;height:100%;background:var(--accent);border-radius:inherit;transition:width .3s var(--ease)}
.good{color:var(--good)}.bad{color:var(--bad)}.warn{color:var(--warn)}
.pad{display:grid;grid-template-columns:repeat(3,46px);gap:6px;justify-content:center}
.pad button{width:46px;height:46px;padding:0;border-radius:14px}
.toast{position:fixed;left:50%;bottom:14px;translate:-50% 0;background:var(--strong);color:var(--bg);font-size:13.5px;font-weight:500;padding:9px 14px;border-radius:12px;box-shadow:var(--shadow);animation:kit-in .22s var(--ease);z-index:9}
.fade-in{animation:kit-in .25s var(--ease)}
@keyframes kit-in{from{opacity:0;translate:0 4px}to{opacity:1;translate:none}}
@media (max-width:480px){.big{font-size:36px}.grid.three{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;

    function bootScript(id, store, colors) {
        // runs inside the sandbox; talks to NEYO only by postMessage
        return `(function(){
var ID=${JSON.stringify(id)};
function send(type,data){try{parent.postMessage(Object.assign({__neyoApp:ID,type:type},data||{}),"*")}catch(e){}}
var store=${JSON.stringify(store).replace(/</g, "\\u003c")};
var timer=0;function save(){clearTimeout(timer);timer=setTimeout(function(){send("store",{data:store})},150)}
var mem={getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(store,k)?store[k]:null},setItem:function(k,v){store[String(k)]=String(v);save()},removeItem:function(k){delete store[String(k)];save()},clear:function(){store={};save()},key:function(i){return Object.keys(store)[i]||null},get length(){return Object.keys(store).length}};
try{Object.defineProperty(window,"localStorage",{value:mem,configurable:true})}catch(e){}
try{Object.defineProperty(window,"sessionStorage",{value:mem,configurable:true})}catch(e){}
var colors={},fns=[];
var NAMES={bg:"--bg",fg:"--fg",strong:"--strong",muted:"--muted",line:"--line",soft:"--soft",accent:"--accent",accentFg:"--accent-fg",good:"--good",bad:"--bad",warn:"--warn"};
function setTheme(c){if(!c)return;colors=c;var r=document.documentElement;r.classList.toggle("dark",!!c.dark);for(var k in NAMES){if(c[k])r.style.setProperty(NAMES[k],c[k])}for(var i=0;i<fns.length;i++){try{fns[i](colors)}catch(e){}}}
window.NEYO=Object.freeze({colors:function(){return Object.assign({},colors)},onTheme:function(fn){if(typeof fn==="function")fns.push(fn)},toast:function(text,ms){var t=document.createElement("div");t.className="toast";t.textContent=String(text);document.body.appendChild(t);setTimeout(function(){t.remove()},ms||1800)}});
setTheme(${JSON.stringify(colors)});
window.addEventListener("message",function(e){if(e.source!==parent)return;var m=e.data||{};if(m.__neyoHost&&m.type==="theme")setTheme(m.colors)});
window.addEventListener("error",function(e){send("error",{message:String(e.message||"Script error"),line:e.lineno||0})});
window.addEventListener("unhandledrejection",function(e){var r=e.reason;send("error",{message:String(r&&r.message||r||"Promise error")})});
document.addEventListener("securitypolicyviolation",function(e){send("blocked",{url:String(e.blockedURI||"").slice(0,200)})});
var last=0;function size(){var b=document.body,h=Math.ceil(Math.max(b?b.scrollHeight:0,b?b.offsetHeight:0,document.documentElement.offsetHeight));if(h&&Math.abs(h-last)>2){last=h;send("size",{height:h})}}
window.addEventListener("load",function(){size();send("ready",{})});
try{new ResizeObserver(size).observe(document.documentElement)}catch(e){setInterval(size,500)}
document.addEventListener("DOMContentLoaded",function(){size();try{new ResizeObserver(size).observe(document.body)}catch(e){}});
window.open=function(){return null};
})();`;
    }

    function buildDoc(source, id, store, colors = palette(null)) {
        const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${KIT_CSS}</style><script>${bootScript(id, store, colors)}<\/script>`;
        const dark = colors.dark ? ' class="dark"' : "";
        if (/<head[^>]*>/i.test(source)) return source.replace(/<head[^>]*>/i, match => `${match}${head}`);
        if (/<html[^>]*>/i.test(source)) return source.replace(/<html[^>]*>/i, match => `${match}<head>${head}</head>`);
        return `<!doctype html><html${dark}><head>${head}</head><body>${source}</body></html>`;
    }

    /* ---------------- one app card ---------------- */

    function build(source) {
        const id = `nya${++seq}`;
        const key = hash(source);
        const title = appTitle(source);
        const fixed = fixedHeight(source);
        const errors = [];
        const blocked = new Set();

        const root = el("section", "sui-card nya-card is-new");
        root.setAttribute("aria-label", title);
        const head = el("header", "sui-head nya-head");
        // one slim bar: the app shows its own big title inside
        const kicker = el("div", "sui-kicker nya-kicker");
        kicker.append(icon("app", 14), el("span", "", "Mini App"), el("span", "nya-name", title));
        const titleRow = el("div", "nya-title-row");
        const tools = el("div", "nya-tools");
        const restartBtn = button("restart", "Restart", "sui-btn nya-tool");
        const codeBtn = button("code", "Code", "sui-btn nya-tool");
        const fullBtn = button("expand", "Full screen", "sui-btn nya-tool");
        tools.append(restartBtn, codeBtn, fullBtn);
        titleRow.append(kicker, tools);
        head.append(titleRow);

        const stage = el("div", "nya-stage");
        const frame = document.createElement("iframe");
        frame.className = "nya-frame";
        frame.setAttribute("aria-label", title);
        frame.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-pointer-lock");
        frame.setAttribute("referrerpolicy", "no-referrer");
        frame.setAttribute("allow", "fullscreen 'none'; camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; payment 'none'; usb 'none'");
        frame.setAttribute("loading", "lazy");
        frame.style.height = `${fixed || 420}px`;
        const loading = el("div", "nya-loading");
        loading.append(icon("play", 18), el("span", "", "Starting app…"));
        stage.append(frame, loading);

        const issue = el("div", "nya-issue");
        issue.hidden = true;
        issue.setAttribute("role", "status");
        const issueText = el("span", "nya-issue-text");
        const fixBtn = button("fix", "Fix with NEYO", "sui-btn is-primary nya-fix");
        issue.append(icon("warn", 16), issueText, fixBtn);

        const codeBox = el("div", "nya-code");
        codeBox.hidden = true;
        const pre = el("pre", "nya-pre");
        pre.textContent = source;
        codeBox.append(pre);

        const actions = el("div", "sui-actions");
        const copyBtn = button("copy", "Copy code");
        const downloadBtn = button("download", "Download");
        actions.append(copyBtn, downloadBtn);

        root.append(head, stage, issue, codeBox, actions);

        let started = false;
        let autoHeight = 420;
        const ctrl = {
            frame,
            root,
            onMessage(msg) {
                switch (msg.type) {
                    case "size": {
                        if (fixed) return;
                        if (root.classList.contains("is-full")) return;
                        const h = Math.min(Math.max(Number(msg.height) || 0, 140), 1400);
                        autoHeight = h;
                        frame.style.height = `${h}px`;
                        break;
                    }
                    case "ready":
                        loading.hidden = true;
                        break;
                    case "store":
                        saveStore(key, msg.data);
                        break;
                    case "error":
                        loading.hidden = true;
                        if (errors.length < 5) errors.push(String(msg.message || "").slice(0, 240) + (msg.line ? ` (line ${msg.line})` : ""));
                        showIssue();
                        break;
                    case "blocked":
                        if (msg.url && msg.url !== "inline" && msg.url !== "eval") blocked.add(String(msg.url).slice(0, 120));
                        if (blocked.size) showIssue();
                        break;
                }
            }
        };

        function showIssue() {
            const parts = [];
            if (errors.length) parts.push(`Something broke: ${errors[0]}`);
            if (blocked.size) parts.push(`Outside files are blocked (${[...blocked][0]})`);
            issueText.textContent = parts.join(" · ");
            issue.hidden = !parts.length;
        }

        function start() {
            started = true;
            errors.length = 0;
            blocked.clear();
            issue.hidden = true;
            loading.hidden = false;
            frames.forEach((c, win) => { if (c === ctrl) frames.delete(win); });
            frame.srcdoc = buildDoc(source, id, loadStore(key), palette(root));
            // contentWindow exists right after srcdoc is set
            requestAnimationFrame(() => { if (frame.contentWindow) frames.set(frame.contentWindow, ctrl); });
            if (frame.contentWindow) frames.set(frame.contentWindow, ctrl);
            setTimeout(() => { loading.hidden = true; }, 2500);
        }
        root._nyaStart = () => { if (!started) start(); };
        root._nyaRestart = () => { if (started) requestAnimationFrame(start); };

        restartBtn.addEventListener("click", start);

        codeBtn.addEventListener("click", () => {
            codeBox.hidden = !codeBox.hidden;
            codeBtn.classList.toggle("is-on", !codeBox.hidden);
            codeBtn.setAttribute("aria-pressed", String(!codeBox.hidden));
        });

        function setFull(on) {
            root.classList.toggle("is-full", on);
            document.documentElement.classList.toggle("nya-lock", on);
            // an animated message (translate) would trap position:fixed
            root.closest(".message")?.classList.toggle("nya-host-full", on);
            try {
                if (on && root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
                if (!on && document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
            } catch {}
            fullBtn.replaceChildren(icon(on ? "shrink" : "expand", 14), el("span", "sui-btn-label", on ? "Exit" : "Full screen"));
            if (on) frame.style.height = "";
            else if (fixed) frame.style.height = `${fixed}px`;
            else frame.style.height = `${autoHeight}px`;
            (on ? frame : fullBtn).focus?.();
        }
        fullBtn.addEventListener("click", () => setFull(!root.classList.contains("is-full")));
        // browser Esc / swipe that leaves real full screen
        document.addEventListener("fullscreenchange", () => {
            if (!document.fullscreenElement && root.classList.contains("is-full")) setFull(false);
        });
        root.addEventListener("keydown", event => {
            if (event.key === "Escape" && root.classList.contains("is-full")) setFull(false);
        });

        copyBtn.addEventListener("click", async () => {
            let ok = false;
            try {
                if (window.NeyoUI?.copy) ok = await window.NeyoUI.copy(source);
                else { await navigator.clipboard.writeText(source); ok = true; }
            } catch {}
            flash(copyBtn, ok === false ? "Copy failed" : "Copied");
        });

        downloadBtn.addEventListener("click", () => {
            const html = /<html[\s>]/i.test(source) ? source : `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<&]/g, "")}</title></head><body>${source}</body></html>`;
            const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
            const a = el("a");
            a.href = url;
            a.download = `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "neyo-app"}.html`;
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        });

        fixBtn.addEventListener("click", () => {
            const problem = [errors[0], blocked.size ? `outside files were blocked: ${[...blocked].join(", ")}` : ""].filter(Boolean).join("; ");
            const text = `Is mini app "${title}" mein masla aaya: ${problem}. Isay theek karke poora app dobara do (sirf ek self-contained file, bina outside files ke).`;
            if (window.NeyoChat?.send && !window.NeyoChat.isGenerating?.()) {
                window.NeyoChat.send({ text });
            } else {
                const input = document.querySelector("#messageInput, #chatInput, textarea");
                if (input) {
                    input.value = text;
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                    input.focus();
                }
            }
        });

        root._nyaText = () => `${title} (mini app)\n\n${source}`;
        return root;
    }

    /* start apps only when they come near the screen */
    const watcher = "IntersectionObserver" in window
        ? new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                entry.target._nyaStart?.();
                watcher.unobserve(entry.target);
            });
        }, { rootMargin: "300px" })
        : null;

    function arm(node) {
        if (watcher) watcher.observe(node);
        else node._nyaStart?.();
    }

    function building(source) {
        const node = el("section", "nya-building");
        const lines = source.split("\n").length;
        const title = appTitle(source);
        node.append(el("span", "sui-dot"), el("span", "", `Building ${title === "Mini App" ? "app" : `“${title}”`}… ${lines} lines`));
        node._nyaSource = source;
        return node;
    }

    /* ---------------- scan rendered messages ---------------- */

    function findBlocks(root) {
        return Array.from(root.querySelectorAll("pre > code"))
            .filter(code =>
                code.classList.contains("language-neyo-app") ||
                code.parentElement?.dataset.language === "neyo-app"
            );
    }

    function enhance(root, { final = !streaming } = {}) {
        if (!(root instanceof Element)) return;
        findBlocks(root).forEach(code => {
            const pre = code.parentElement;
            const frameBox = pre.closest(".neyo-code") || pre;
            const source = (code.textContent || "").trim().slice(0, MAX_SOURCE);
            if (!source) {
                frameBox.remove();
                return;
            }
            const complete = final || /<\/html>\s*$/i.test(source);
            if (!complete) {
                frameBox.replaceWith(building(source));
                return;
            }
            frameBox.replaceWith(appFor(source));
        });
    }

    function appFor(source) {
        const cached = cache.get(source);
        const reuse = cached && !cached.isConnected;
        const node = reuse ? cached : build(source);
        if (!reuse) {
            cache.set(source, node);
            if (cache.size > 30) cache.delete(cache.keys().next().value);
        }
        // a moved iframe reloads with a new window: start it again so we keep hearing it
        if (reuse) node._nyaRestart?.();
        else arm(node);
        return node;
    }

    function enhanceAll() {
        document.querySelectorAll(".message.assistant .message-content").forEach(content => enhance(content, { final: !streaming }));
    }

    window.addEventListener("message", event => {
        const ctrl = frames.get(event.source);
        const msg = event.data;
        if (!ctrl || !msg || typeof msg !== "object" || typeof msg.__neyoApp !== "string") return;
        ctrl.onMessage(msg);
    });

    // follow NEYO light/dark + accent
    let themeTimer = 0;
    new MutationObserver(() => {
        // wait a beat: the theme cross-fade changes colours after the class flips
        clearTimeout(themeTimer);
        themeTimer = setTimeout(() => {
            frames.forEach((ctrl, win) => {
                try { win.postMessage({ __neyoHost: true, type: "theme", colors: palette(ctrl.root) }, "*"); } catch {}
            });
        }, 360);
    }).observe(document.body, { attributes: true, attributeFilter: ["class", "data-neyo-accent"] });

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
                // an app still "building" after the answer ended: run what we have
                document.querySelectorAll(".nya-building").forEach(node => {
                    if (node._nyaSource) node.replaceWith(appFor(node._nyaSource));
                    else node.remove();
                });
            }, 80);
        })
    );

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhanceAll, { once: true });
    else enhanceAll();

    window.NeyoMiniApp = Object.freeze({
        enhance,
        enhanceAll,
        buildDoc,
        textOf: node => node?._nyaText?.() || "",
        version: 2
    });
})();
