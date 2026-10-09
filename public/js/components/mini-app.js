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

    function accentColor() {
        const v = getComputedStyle(document.body).getPropertyValue("--neyo-accent").trim();
        const custom = document.body.dataset.neyoAccent && document.body.dataset.neyoAccent !== "neutral";
        return custom && /^#|^rgb|^hsl/.test(v) ? v : "";
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

    function baseStyle() {
        return `
:root{--bg:#ffffff;--card:#f6f6f7;--fg:#141416;--muted:#6b6b73;--line:#e4e4e8;--accent:#141416;--accent-fg:#ffffff;--good:#15935f;--bad:#d64545;--warn:#c98a12;--radius:12px;color-scheme:light}
:root.dark{--bg:#17171a;--card:#222227;--fg:#f4f4f6;--muted:#a1a1aa;--line:#34343b;--accent:#f4f4f6;--accent-fg:#141416;color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg)}
body{padding:16px;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,"Noto Sans",Arial,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
button{font:inherit;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:8px 14px;border-radius:10px;transition:transform .12s,background .15s}
button:hover{border-color:var(--muted)}button:active{transform:scale(.97)}
button.primary,button[data-primary]{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
input,select,textarea{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px 10px}
input[type=range]{padding:0;accent-color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
canvas{max-width:100%;display:block;touch-action:none}
h1,h2,h3{line-height:1.2;margin:0 0 .5em}h1{font-size:22px}h2{font-size:18px}
`;
    }

    function bootScript(id, store, dark, accent) {
        // runs inside the sandbox; talks to NEYO only by postMessage
        return `(function(){
var ID=${JSON.stringify(id)};
function send(type,data){try{parent.postMessage(Object.assign({__neyoApp:ID,type:type},data||{}),"*")}catch(e){}}
var store=${JSON.stringify(store).replace(/</g, "\\u003c")};
var timer=0;function save(){clearTimeout(timer);timer=setTimeout(function(){send("store",{data:store})},150)}
var mem={getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(store,k)?store[k]:null},setItem:function(k,v){store[String(k)]=String(v);save()},removeItem:function(k){delete store[String(k)];save()},clear:function(){store={};save()},key:function(i){return Object.keys(store)[i]||null},get length(){return Object.keys(store).length}};
try{Object.defineProperty(window,"localStorage",{value:mem,configurable:true})}catch(e){}
try{Object.defineProperty(window,"sessionStorage",{value:mem,configurable:true})}catch(e){}
function setTheme(d,a){var r=document.documentElement;r.classList.toggle("dark",!!d);if(a){r.style.setProperty("--accent",a);r.style.setProperty("--accent-fg","#ffffff")}else{r.style.removeProperty("--accent");r.style.removeProperty("--accent-fg")}}
setTheme(${dark ? "true" : "false"},${JSON.stringify(accent || "")});
window.addEventListener("message",function(e){if(e.source!==parent)return;var m=e.data||{};if(m.__neyoHost&&m.type==="theme")setTheme(m.dark,m.accent)});
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

    function buildDoc(source, id, store) {
        const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseStyle()}</style><script>${bootScript(id, store, isDark(), accentColor())}<\/script>`;
        const dark = isDark() ? ' class="dark"' : "";
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
        const kicker = el("div", "sui-kicker");
        kicker.append(icon("app", 14), el("span", "", "Mini App"));
        const titleRow = el("div", "nya-title-row");
        const tools = el("div", "nya-tools");
        const restartBtn = button("restart", "Restart", "sui-btn nya-tool");
        const codeBtn = button("code", "Code", "sui-btn nya-tool");
        const fullBtn = button("expand", "Full screen", "sui-btn nya-tool");
        tools.append(restartBtn, codeBtn, fullBtn);
        titleRow.append(el("h4", "sui-title", title), tools);
        head.append(kicker, titleRow);

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
            frame.srcdoc = buildDoc(source, id, loadStore(key));
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
    new MutationObserver(() => {
        const dark = isDark();
        const accent = accentColor();
        frames.forEach((ctrl, win) => {
            try { win.postMessage({ __neyoHost: true, type: "theme", dark, accent }, "*"); } catch {}
        });
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
        version: 1
    });
})();
