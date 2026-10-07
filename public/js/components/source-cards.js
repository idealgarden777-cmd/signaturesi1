/* =========================================================
   NEYO • SOURCES (ChatGPT style)  v2
   - Inline citations [1] / [2, 3] become small grey pills
     with the site name ("reuters +1"). Hover shows a preview.
   - A "Sources" button (stacked site icons) is added to the
     answer's action row. Click opens a side panel listing
     every source (icon, site, title, snippet).
   - Works for streaming (neyo:chat-message-updated) and
     history (.message-sources).
   ========================================================= */

(() => {
    "use strict";

    if (window.__neyoSourceCards) {
        return;
    }
    window.__neyoSourceCards = true;

    const store = new WeakMap(); // message element -> sources[]
    const MAX_SOURCES = 12;

    /* ---------- helpers ---------- */

    function safeUrl(raw) {
        try {
            const url = new URL(String(raw || "").trim());
            return /^https?:$/.test(url.protocol) ? url.href : "";
        } catch {
            return "";
        }
    }

    function hostOf(url) {
        try {
            return new URL(url).hostname.replace(/^www\./, "");
        } catch {
            return "";
        }
    }

    function siteName(host) {
        if (!host) {
            return "source";
        }
        if (/vertexaisearch|googleusercontent/.test(host)) {
            return "web";
        }
        const parts = host.split(".");
        if (parts.length > 2 && parts[parts.length - 2].length <= 3) {
            return parts[parts.length - 3];
        }
        return parts[parts.length - 2] || parts[0];
    }

    function hue(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i += 1) {
            hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
        }
        return hash % 360;
    }

    function clean(value, max) {
        return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
    }

    function normalize(list) {
        if (!Array.isArray(list)) {
            return [];
        }
        return list
            .map(item => {
                const url = safeUrl(item?.url || item?.link);
                if (!url) {
                    return null;
                }
                const host = hostOf(url);
                return {
                    url,
                    host,
                    site: siteName(host),
                    title: clean(item.title || item.name || host, 160) || host,
                    snippet: clean(item.snippet || item.description, 220),
                    published: clean(item.published, 40)
                };
            })
            .filter(Boolean)
            .slice(0, MAX_SOURCES);
    }

    function messageById(id) {
        if (!id) {
            return null;
        }
        return Array.from(document.querySelectorAll("[data-neyo-message-id]"))
            .find(el => el.dataset.neyoMessageId === String(id)) || null;
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    /* Site icon: real favicon, letter fallback if it fails. */
    function icon(source, className) {
        const box = el("span", `neyo-src-icon ${className || ""}`);
        box.style.setProperty("--src-hue", hue(source.host));
        box.textContent = (source.site.charAt(0) || "?").toUpperCase();
        if (source.site !== "web") {
            const img = new Image();
            img.alt = "";
            img.decoding = "async";
            img.referrerPolicy = "no-referrer";
            img.onload = () => {
                if (img.naturalWidth > 1) {
                    box.textContent = "";
                    box.classList.add("has-img");
                    box.appendChild(img);
                }
            };
            img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(source.host)}&sz=64`;
        }
        return box;
    }

    function prettyDate(value) {
        if (!value) return "";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    }

    /* ---------- Sources button ---------- */

    function buildButton(sources) {
        const btn = el("button", "neyo-sources-btn");
        btn.type = "button";
        btn.setAttribute("data-neyo-sources", "1");
        btn.setAttribute("aria-label", "Sources");

        const stack = el("span", "neyo-sources-btn__stack");
        const seen = new Set();
        sources.forEach(source => {
            if (stack.childElementCount >= 3 || seen.has(source.host)) return;
            seen.add(source.host);
            stack.appendChild(icon(source, "neyo-sources-btn__icon"));
        });

        btn.append(stack, el("span", "neyo-sources-btn__label", "Sources"));
        btn.addEventListener("click", event => {
            event.stopPropagation();
            openPanel(sources);
        });
        return btn;
    }

    function placeButton(messageEl, sources) {
        if (!messageEl || !sources?.length) {
            return;
        }
        store.set(messageEl, sources);

        messageEl.querySelectorAll(".neyo-sources-btn, .neyo-sources-bar, .neyo-sources, .message-sources")
            .forEach(node => node.remove());

        const btn = buildButton(sources);
        const actions = messageEl.querySelector(":scope > .message-actions, .message-actions");
        if (actions) {
            actions.appendChild(btn);
        } else {
            const bar = el("div", "neyo-sources-bar");
            bar.appendChild(btn);
            const content = messageEl.querySelector(".message-content");
            if (content && content.parentNode === messageEl) {
                content.after(bar);
            } else {
                messageEl.appendChild(bar);
            }
        }

        linkCitations(messageEl);
    }

    /* ---------- side panel ---------- */

    let panel = null;
    let backdrop = null;
    let lastFocus = null;

    function ensurePanel() {
        if (panel) return;

        backdrop = el("div", "neyo-src-backdrop");
        backdrop.addEventListener("click", closePanel);

        panel = el("aside", "neyo-src-panel");
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "Sources");

        const head = el("div", "neyo-src-panel__head");
        head.appendChild(el("h2", "neyo-src-panel__title", "Sources"));
        const close = el("button", "neyo-src-panel__close");
        close.type = "button";
        close.setAttribute("aria-label", "Close");
        close.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
        close.addEventListener("click", closePanel);
        head.appendChild(close);

        const body = el("div", "neyo-src-panel__body");
        panel.append(head, body);
        document.body.append(backdrop, panel);

        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && panel.classList.contains("is-open")) {
                closePanel();
            }
        });
    }

    function openPanel(sources) {
        ensurePanel();
        lastFocus = document.activeElement;
        const body = panel.querySelector(".neyo-src-panel__body");
        body.textContent = "";
        body.appendChild(el("div", "neyo-src-panel__section", "Citations"));

        sources.forEach(source => {
            const item = el("a", "neyo-src-item");
            item.href = source.url;
            item.target = "_blank";
            item.rel = "noopener noreferrer";

            const top = el("div", "neyo-src-item__top");
            top.append(icon(source, "neyo-src-item__icon"), el("span", "neyo-src-item__site", source.site));
            const date = prettyDate(source.published);
            if (date) top.appendChild(el("span", "neyo-src-item__date", date));

            item.append(top, el("div", "neyo-src-item__title", source.title));
            if (source.snippet) {
                item.appendChild(el("div", "neyo-src-item__snippet", source.snippet));
            }
            body.appendChild(item);
        });

        body.scrollTop = 0;
        hideHover();
        backdrop.classList.add("is-open");
        panel.classList.add("is-open");
        document.documentElement.classList.add("neyo-src-open");
        panel.querySelector(".neyo-src-panel__close").focus({ preventScroll: true });
    }

    function closePanel() {
        if (!panel) return;
        panel.classList.remove("is-open");
        backdrop.classList.remove("is-open");
        document.documentElement.classList.remove("neyo-src-open");
        if (lastFocus && typeof lastFocus.focus === "function") {
            lastFocus.focus({ preventScroll: true });
        }
    }

    /* ---------- hover preview ---------- */

    let hover = null;
    let hoverTimer = null;
    const canHover = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

    function showHover(anchor, source) {
        if (!canHover) return;
        clearTimeout(hoverTimer);
        if (!hover) {
            hover = el("div", "neyo-src-hover");
            hover.addEventListener("mouseenter", () => clearTimeout(hoverTimer));
            hover.addEventListener("mouseleave", () => { hoverTimer = setTimeout(hideHover, 150); });
            document.body.appendChild(hover);
        }
        hover.textContent = "";
        const link = el("a", "neyo-src-hover__link");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const top = el("div", "neyo-src-item__top");
        top.append(icon(source, "neyo-src-item__icon"), el("span", "neyo-src-item__site", source.site));
        link.append(top, el("div", "neyo-src-item__title", source.title));
        if (source.snippet) link.appendChild(el("div", "neyo-src-item__snippet", source.snippet));
        hover.appendChild(link);

        const rect = anchor.getBoundingClientRect();
        hover.classList.add("is-open");
        const width = hover.offsetWidth;
        const height = hover.offsetHeight;
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
        let y = rect.bottom + 6;
        if (y + height > window.innerHeight - 8) y = rect.top - height - 6;
        hover.style.left = `${left}px`;
        hover.style.top = `${Math.max(8, y)}px`;
    }

    function hideHover() {
        clearTimeout(hoverTimer);
        hover?.classList.remove("is-open");
    }

    /* ---------- inline citations ---------- */

    const CITE = /\s?\[(\d{1,2}(?:\s*[,–-]\s*\d{1,2})*)\]/g;

    function expand(value) {
        const out = [];
        String(value).split(",").forEach(part => {
            const range = part.split(/[–-]/).map(x => parseInt(x, 10));
            if (range.length === 2 && range[1] >= range[0] && range[1] - range[0] < 10) {
                for (let n = range[0]; n <= range[1]; n += 1) out.push(n);
            } else if (!Number.isNaN(range[0])) {
                out.push(range[0]);
            }
        });
        return [...new Set(out)];
    }

    function makePill(sources, numbers) {
        const first = sources[numbers[0] - 1];
        const pill = el("a", "neyo-cite");
        pill.href = first.url;
        pill.target = "_blank";
        pill.rel = "noopener noreferrer";
        pill.appendChild(el("span", "neyo-cite__site", first.site));
        if (numbers.length > 1) {
            pill.appendChild(el("span", "neyo-cite__more", `+${numbers.length - 1}`));
            pill.addEventListener("click", event => {
                event.preventDefault();
                openPanel(numbers.map(n => sources[n - 1]));
            });
        }
        pill.addEventListener("mouseenter", () => showHover(pill, first));
        pill.addEventListener("mouseleave", () => { hoverTimer = setTimeout(hideHover, 150); });
        return pill;
    }

    function linkCitations(messageEl) {
        const sources = store.get(messageEl);
        const content = messageEl?.querySelector(".message-content");
        if (!sources?.length || !content) {
            return;
        }

        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !/\[\d/.test(node.nodeValue)) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (node.parentElement?.closest("pre, code, a, .neyo-cite")) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        const nodes = [];
        while (walker.nextNode()) {
            nodes.push(walker.currentNode);
        }

        nodes.forEach(node => {
            const text = node.nodeValue;
            const frag = document.createDocumentFragment();
            let last = 0;
            let match;
            CITE.lastIndex = 0;
            while ((match = CITE.exec(text))) {
                const numbers = expand(match[1]).filter(n => n >= 1 && n <= sources.length);
                if (!numbers.length) {
                    continue;
                }
                frag.appendChild(document.createTextNode(text.slice(last, match.index)));
                frag.appendChild(makePill(sources, numbers));
                last = match.index + match[0].length;
            }
            if (last === 0) {
                return;
            }
            frag.appendChild(document.createTextNode(text.slice(last)));
            node.parentNode.replaceChild(frag, node);
        });
    }

    /* ---------- live stream ---------- */

    window.addEventListener("neyo:chat-message-updated", event => {
        const detail = event.detail || {};
        const sources = normalize(detail.sources || detail.message?.sources);
        if (!sources.length) {
            return;
        }
        const id = detail.id || detail.message?.id;
        setTimeout(() => placeButton(messageById(id), sources), 30);
    });

    /* ---------- history + re-renders ---------- */

    function upgradeLegacy(root) {
        root.querySelectorAll?.(".message-sources").forEach(box => {
            const messageEl = box.closest("[data-neyo-message-id]");
            if (!messageEl) {
                return;
            }
            const sources = normalize(
                Array.from(box.querySelectorAll("a")).map(a => ({
                    url: a.href,
                    title: a.getAttribute("title") || a.textContent
                }))
            );
            if (sources.length) {
                placeButton(messageEl, sources);
            } else {
                box.remove();
            }
        });
    }

    let pending = null;
    const touched = new Set();

    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            const target = mutation.target instanceof Element
                ? mutation.target
                : mutation.target?.parentElement;
            if (target?.closest?.(".neyo-src-panel, .neyo-src-hover, .neyo-sources-btn")) {
                return;
            }
            const messageEl = target?.closest?.("[data-neyo-message-id]");
            if (messageEl && store.has(messageEl)) {
                touched.add(messageEl);
            }
            mutation.addedNodes.forEach(node => {
                if (node instanceof Element && (node.matches(".message-sources") || node.querySelector(".message-sources"))) {
                    touched.add(document.body);
                }
            });
        });
        if (!touched.size || pending) {
            return;
        }
        pending = setTimeout(() => {
            pending = null;
            const list = [...touched];
            touched.clear();
            list.forEach(node => {
                if (node === document.body) {
                    upgradeLegacy(document);
                } else if (!node.querySelector(".neyo-sources-btn")) {
                    placeButton(node, store.get(node));
                } else {
                    linkCitations(node);
                }
            });
        }, 60);
    });

    function start() {
        upgradeLegacy(document);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        window.addEventListener("scroll", hideHover, { passive: true, capture: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
