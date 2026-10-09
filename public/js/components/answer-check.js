/*
=========================================================
NEYO — ANSWER CHECK CHIP v1
Shows a small line under an answer that was written from
web sources while NEYO re-checks it, and the result:
  "Checking with sources…"  ->  "Checked with sources"
                             ->  "Checked with sources · 2 fixes"
The fixed text itself is swapped in by chat.js.
=========================================================
*/

(() => {
    "use strict";

    if (window.NeyoAnswerCheck) return;

    const states = new Map(); // message id -> { state, fixes }

    function messageById(id) {
        if (!id) return null;
        return Array.from(document.querySelectorAll("[data-neyo-message-id]"))
            .find(node => node.dataset.neyoMessageId === String(id)) || null;
    }

    function label({ state, fixes }) {
        if (state === "checking") return "Checking with sources…";
        if (state === "revised") return `Checked with sources · ${fixes} ${fixes === 1 ? "fix" : "fixes"}`;
        if (state === "ok") return "Checked with sources";
        return "";
    }

    function place(id) {
        const info = states.get(id);
        const message = messageById(id);
        if (!message || !info) return;
        let chip = message.querySelector(".neyo-check");
        const text = label(info);
        if (!text) {
            chip?.remove();
            return;
        }
        if (!chip) {
            chip = document.createElement("div");
            chip.className = "neyo-check";
            chip.setAttribute("role", "status");
            const dot = document.createElement("span");
            dot.className = "neyo-check-dot";
            dot.setAttribute("aria-hidden", "true");
            const span = document.createElement("span");
            span.className = "neyo-check-text";
            chip.append(dot, span);
            const content = message.querySelector(".message-content");
            if (content && content.parentNode) content.after(chip);
            else message.append(chip);
        }
        chip.dataset.state = info.state;
        chip.querySelector(".neyo-check-text").textContent = text;
        if (info.state === "revised") {
            chip.title = "NEYO re-read this answer next to its sources and corrected the parts they did not support.";
        } else if (info.state === "ok") {
            chip.title = "NEYO re-read this answer next to its sources.";
        } else {
            chip.removeAttribute("title");
        }
    }

    window.addEventListener("neyo:answer-check", event => {
        const id = event.detail?.id;
        if (!id) return;
        states.set(id, { state: String(event.detail.state || ""), fixes: Number(event.detail.fixes) || 0 });
        if (states.size > 60) states.delete(states.keys().next().value);
        place(id);
    });

    // message re-renders can rebuild the row: put the chip back
    window.addEventListener("neyo:message-rendered", event => {
        const row = event.detail?.element?.closest?.("[data-neyo-message-id]");
        const id = row?.dataset.neyoMessageId;
        if (id && states.has(id)) setTimeout(() => place(id), 0);
    });

    window.NeyoAnswerCheck = Object.freeze({ version: 1 });
})();
