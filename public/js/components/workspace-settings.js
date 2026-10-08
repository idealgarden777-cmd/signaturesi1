/* NEYO • Settings > Workspace
   Instructions, answer length, web search & tools.
   Saved in this browser (localStorage) and sent with every chat. */
(function () {
    "use strict";

    const KEY = "neyo_workspace";
    const MAX = 2000;

    const style = document.createElement("style");
    style.textContent =
        ".ws-block{display:flex;flex-direction:column;gap:8px;padding:6px 0 4px}" +
        ".ws-help{font-size:12px;opacity:.7;line-height:1.45}" +
        ".ws-textarea{width:100%;box-sizing:border-box;min-height:110px;resize:vertical;padding:10px 12px;border-radius:12px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit;font-size:14px;line-height:1.5}" +
        ".ws-textarea:focus{outline:none;border-color:rgba(127,127,127,.6)}" +
        ".ws-foot{display:flex;align-items:center;justify-content:space-between;gap:10px}" +
        ".ws-foot small{font-size:11px;opacity:.6}";
    document.head.appendChild(style);

    function read() {
        try {
            const data = JSON.parse(localStorage.getItem(KEY) || "{}");
            return {
                instructions: String(data.instructions || "").slice(0, MAX),
                length: ["short", "detailed"].includes(data.length) ? data.length : "auto",
                tools: data.tools === "off" ? "off" : "auto"
            };
        } catch {
            return { instructions: "", length: "auto", tools: "auto" };
        }
    }

    function write(next) {
        const data = { ...read(), ...next };
        try {
            localStorage.setItem(KEY, JSON.stringify(data));
        } catch {}
        return data;
    }

    function notify(message, type) {
        const api = window.NeyoNotifications;
        try {
            if (api && typeof api[type] === "function") {
                api[type](message);
                return;
            }
        } catch {}
        window.dispatchEvent(new CustomEvent(`neyo:notification-${type}`, { detail: { message } }));
    }

    window.NeyoWorkspace = { get: read };

    function setPressed(group, value) {
        group?.querySelectorAll("button[data-value]").forEach(button => {
            const on = button.dataset.value === value;
            button.classList.toggle("active", on);
            button.setAttribute("aria-pressed", on ? "true" : "false");
        });
    }

    function fill() {
        const data = read();
        const box = document.getElementById("wsInstructions");
        if (box && document.activeElement !== box) {
            box.value = data.instructions;
        }
        updateCount();
        setPressed(document.getElementById("wsLength"), data.length);
        setPressed(document.getElementById("wsTools"), data.tools);
    }

    function updateCount() {
        const box = document.getElementById("wsInstructions");
        const count = document.getElementById("wsCount");
        if (box && count) {
            count.textContent = `${box.value.length} / ${MAX}`;
        }
    }

    function start() {
        fill();

        document.getElementById("wsInstructions")?.addEventListener("input", updateCount);

        document.getElementById("wsSave")?.addEventListener("click", () => {
            const box = document.getElementById("wsInstructions");
            const text = String(box?.value || "").trim().slice(0, MAX);
            write({ instructions: text });
            if (box) box.value = text;
            updateCount();
            notify(text ? "Instructions saved. NEYO will follow them in every chat." : "Instructions cleared.", "success");
        });

        [["wsLength", "length"], ["wsTools", "tools"]].forEach(([id, field]) => {
            const group = document.getElementById(id);
            group?.addEventListener("click", event => {
                const button = event.target.closest("button[data-value]");
                if (!button) return;
                write({ [field]: button.dataset.value });
                setPressed(group, button.dataset.value);
            });
        });

        document.addEventListener("click", event => {
            if (event.target.closest?.('[data-settings-tab="workspace"]')) {
                fill();
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
