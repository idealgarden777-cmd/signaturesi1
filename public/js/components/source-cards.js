/* =========================================================
   NEYO • SOURCE CARDS  v1
   - Shows web sources under an assistant answer as small
     clickable cards (number, site letter, site name, title).
   - Turns inline citations like [1] or [2, 3] into small
     clickable badges that open the matching source.
   - Works for live streaming (neyo:chat-message-updated)
     and for old chats loaded from history (.message-sources).
   - No external images (CSP img-src is self only).
   ========================================================= */

(() => {
    "use strict";

    if (window.__neyoSourceCards) {
        return;
    }
    window.__neyoSourceCards = true;

    const store = new WeakMap(); // message element -> sources[]
    const MAX_CARDS = 10;

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
            return "Source";
        }
        if (/vertexaisearch|googleusercontent/.test(host)) {
            return "Web";
        }
        const parts = host.split(".");
        const core = parts.length > 2 && parts[parts.length - 2].length <= 3
            ? parts[parts.length - 3]
            : parts[parts.length - 2] || parts[0];
        return core.charAt(0).toUpperCase() + core.slice(1);
    }

    function hue(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i += 1) {
            hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
        }
        return hash % 360;
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
                    title: String(item.title || item.name || host || "Source")
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 160)
                };
            })
            .filter(Boolean)
            .slice(0, MAX_CARDS);
    }

    function messageById(id) {
        if (!id) {
            return null;
        }
        return Array.from(document.querySelectorAll("[data-neyo-message-id]"))
            .find(el => el.dataset.neyoMessageId === String(id)) || null;
    }

    /* ---------- cards ---------- */

    function buildCards(sources) {
        const wrap = document.createElement("div");
        wrap.className = "neyo-sources";
        wrap.setAttribute("data-neyo-sources", "1");

        const head = document.createElement("div");
        head.className = "neyo-sources__head";

        const stack = document.createElement("span");
        stack.className = "neyo-sources__stack";
        sources.slice(0, 3).forEach(source => {
            const dot = document.createElement("span");
            dot.className = "neyo-sources__dot";
            dot.style.setProperty("--src-hue", hue(source.host));
            dot.textContent = siteName(source.host).charAt(0);
            stack.appendChild(dot);
        });

        const label = document.createElement("span");
        label.className = "neyo-sources__label";
        label.textContent = sources.length === 1 ? "1 source" : `${sources.length} sources`;

        head.append(stack, label);

        const row = document.createElement("div");
        row.className = "neyo-sources__row";

        sources.forEach((source, index) => {
            const card = document.createElement("a");
            card.className = "neyo-source-card";
            card.href = source.url;
            card.target = "_blank";
            card.rel = "noopener noreferrer";
            card.title = source.title;
            card.dataset.sourceIndex = String(index + 1);

            const top = document.createElement("span");
            top.className = "neyo-source-card__top";

            const badge = document.createElement("span");
            badge.className = "neyo-source-card__icon";
            badge.style.setProperty("--src-hue", hue(source.host));
            badge.textContent = siteName(source.host).charAt(0);

            const site = document.createElement("span");
            site.className = "neyo-source-card__site";
            site.textContent = siteName(source.host);

            const num = document.createElement("span");
            num.className = "neyo-source-card__num";
            num.textContent = String(index + 1);

            top.append(badge, site, num);

            const title = document.createElement("span");
            title.className = "neyo-source-card__title";
            title.textContent = source.title;

            card.append(top, title);
            row.appendChild(card);
        });

        wrap.append(head, row);
        return wrap;
    }

    function placeCards(messageEl, sources) {
        if (!messageEl || !sources.length) {
            return;
        }
        store.set(messageEl, sources);

        const old = messageEl.querySelector(":scope > .neyo-sources, :scope > .message-sources");
        const cards = buildCards(sources);

        if (old) {
            old.replaceWith(cards);
        } else {
            const content = messageEl.querySelector(".message-content");
            const actions = messageEl.querySelector(":scope > .message-actions");
            if (actions) {
                messageEl.insertBefore(cards, actions);
            } else if (content && content.parentNode === messageEl) {
                content.after(cards);
            } else {
                messageEl.appendChild(cards);
            }
        }

        linkCitations(messageEl);
    }

    /* ---------- inline citations ---------- */

    const CITE = /\[(\d{1,2}(?:\s*[,–-]\s*\d{1,2})*)\]/g;

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
            CITE.lastIndex = 0;
            if (!CITE.test(text)) {
                return;
            }
            CITE.lastIndex = 0;

            const frag = document.createDocumentFragment();
            let last = 0;
            let match;
            while ((match = CITE.exec(text))) {
                const numbers = expand(match[1]).filter(n => n >= 1 && n <= sources.length);
                if (!numbers.length) {
                    continue;
                }
                frag.appendChild(document.createTextNode(text.slice(last, match.index)));
                const group = document.createElement("span");
                group.className = "neyo-cite";
                numbers.forEach(n => {
                    const source = sources[n - 1];
                    const link = document.createElement("a");
                    link.className = "neyo-cite__link";
                    link.href = source.url;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    link.title = `${siteName(source.host)}: ${source.title}`;
                    link.textContent = String(n);
                    group.appendChild(link);
                });
                frag.appendChild(group);
                last = match.index + match[0].length;
            }
            if (last === 0) {
                return;
            }
            frag.appendChild(document.createTextNode(text.slice(last)));
            node.parentNode.replaceChild(frag, node);
        });
    }

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

    /* ---------- live stream ---------- */

    window.addEventListener("neyo:chat-message-updated", event => {
        const detail = event.detail || {};
        const sources = normalize(detail.sources || detail.message?.sources);
        if (!sources.length) {
            return;
        }
        const id = detail.id || detail.message?.id;
        // Let messages.js / renderer finish their own update first.
        setTimeout(() => placeCards(messageById(id), sources), 30);
    });

    /* ---------- history + re-renders ---------- */

    function upgradeLegacy(root) {
        root.querySelectorAll?.(".message-sources").forEach(box => {
            const messageEl = box.closest("[data-neyo-message-id]");
            if (!messageEl) {
                return;
            }
            const sources = normalize(
                Array.from(box.querySelectorAll("a.source-pill, a")).map(a => ({
                    url: a.href,
                    title: a.textContent
                }))
            );
            if (sources.length) {
                placeCards(messageEl, sources);
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
            list.forEach(el => {
                if (el === document.body) {
                    upgradeLegacy(document);
                } else {
                    // Renderer may have rebuilt content: relink + make sure cards exist.
                    if (!el.querySelector(":scope > .neyo-sources")) {
                        placeCards(el, store.get(el));
                    } else {
                        linkCitations(el);
                    }
                }
            });
        }, 60);
    });

    function start() {
        upgradeLegacy(document);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
