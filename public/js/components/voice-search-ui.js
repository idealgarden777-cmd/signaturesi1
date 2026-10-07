/* =========================================================
   NEYO • VOICE SEARCH UI  v1
   - While the voice model searches the web, the status
     under the mascot says "Searching the web…".
   - After a search, a ChatGPT-style "Sources" button shows
     in voice mode. Click opens the same Sources panel as chat.
   ========================================================= */

(() => {
    "use strict";

    if (window.__neyoVoiceSearchUi) {
        return;
    }
    window.__neyoVoiceSearchUi = true;

    let bar = null;

    function stage() {
        return document.querySelector("#neyoVoiceMode .voice-mode-stage");
    }

    function statusEl() {
        return document.getElementById("neyoMascotStatus");
    }

    function ensureBar() {
        const host = stage();
        if (!host) {
            return null;
        }
        if (bar && bar.isConnected) {
            return bar;
        }
        bar = document.createElement("div");
        bar.className = "voice-src-bar";
        bar.setAttribute("aria-live", "polite");
        const status = statusEl();
        if (status && status.parentNode === host) {
            status.after(bar);
        } else {
            host.appendChild(bar);
        }
        return bar;
    }

    function clearBar() {
        if (bar) {
            bar.textContent = "";
            bar.classList.remove("is-visible");
        }
    }

    window.addEventListener("neyo:voice-search", event => {
        const stageName = event.detail?.stage;
        const shell = document.getElementById("neyoVoiceMode");
        if (stageName === "start") {
            shell?.classList.add("is-searching");
            const status = statusEl();
            if (status) {
                status.textContent = "Searching the web…";
            }
        } else {
            shell?.classList.remove("is-searching");
            const status = statusEl();
            if (status && status.textContent === "Searching the web…") {
                status.textContent = "Thinking…";
            }
        }
    });

    window.addEventListener("neyo:voice-sources", event => {
        const api = window.NeyoSources;
        if (!api) {
            return;
        }
        const sources = api.normalize(event.detail?.sources);
        const target = ensureBar();
        if (!sources.length || !target) {
            return;
        }
        target.textContent = "";
        target.appendChild(api.buildButton(sources));
        target.classList.add("is-visible");
    });

    window.addEventListener("neyo:voice-session-ended", () => {
        clearBar();
        window.NeyoSources?.closePanel();
        document.getElementById("neyoVoiceMode")?.classList.remove("is-searching");
    });

    window.addEventListener("neyo:voice-mode-closed", () => {
        clearBar();
        window.NeyoSources?.closePanel();
    });
})();
