/* =========================================================
   NEYO • LONG USER MESSAGES (collapse / expand)  v1
   - A user bubble taller than ~8 lines is folded with a soft
     fade and a "Show more" button under it.
   - Click toggles "Show more" / "Show less".
   - Works for live messages, history after refresh and edits.
   ========================================================= */

(() => {
    "use strict";

    if (window.__neyoUserCollapse) {
        return;
    }
    window.__neyoUserCollapse = true;

    const LIMIT = 220;      // px of text before folding
    const COLLAPSED = "neyo-user-collapsed";
    const CAN = "neyo-user-collapsible";

    const chevron =
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

    function setLabel(button, collapsed) {
        button.setAttribute("aria-expanded", String(!collapsed));
        button.innerHTML = `<span>${collapsed ? "Show more" : "Show less"}</span>${chevron}`;
    }

    function check(message) {
        if (!(message instanceof Element) || !message.isConnected) {
            return;
        }
        const content = message.querySelector(".message-wrapper > .message-content, .message-content");
        if (!content || message.querySelector(".edit-message-box")) {
            return;
        }

        const key = `${content.textContent.length}:${content.textContent.slice(0, 40)}`;
        if (message.dataset.neyoCollapseKey === key) {
            return;
        }
        message.dataset.neyoCollapseKey = key;

        message.querySelector(":scope .neyo-user-toggle")?.remove();
        message.classList.remove(CAN, COLLAPSED);

        if (content.scrollHeight <= LIMIT + 60) {
            return;
        }

        message.classList.add(CAN, COLLAPSED);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "neyo-user-toggle";
        setLabel(button, true);

        button.addEventListener("click", event => {
            event.stopPropagation();
            const collapsed = !message.classList.contains(COLLAPSED);
            message.classList.toggle(COLLAPSED, collapsed);
            setLabel(button, collapsed);
            if (collapsed) {
                message.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
        });

        content.insertAdjacentElement("afterend", button);
    }

    function checkAll(root = document) {
        root.querySelectorAll?.(".message.user").forEach(check);
    }

    let queued = new Set();
    let frame = 0;

    function queue(message) {
        queued.add(message);
        if (frame) {
            return;
        }
        frame = requestAnimationFrame(() => {
            frame = 0;
            const list = [...queued];
            queued = new Set();
            list.forEach(check);
        });
    }

    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            const target = mutation.target instanceof Element
                ? mutation.target
                : mutation.target?.parentElement;
            if (target?.closest?.(".neyo-user-toggle")) {
                return;
            }
            const own = target?.closest?.(".message.user");
            if (own) {
                queue(own);
            }
            mutation.addedNodes.forEach(node => {
                if (!(node instanceof Element)) {
                    return;
                }
                if (node.matches(".message.user")) {
                    queue(node);
                }
                node.querySelectorAll?.(".message.user").forEach(queue);
            });
        });
    });

    let resizeTimer = 0;

    function start() {
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        checkAll();
        window.addEventListener("resize", () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                document.querySelectorAll(".message.user").forEach(message => {
                    delete message.dataset.neyoCollapseKey;
                    check(message);
                });
            }, 200);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
