/* NEYO • memory chip
   Shows a small note under the answer when the model saved or
   forgot something in its memory box ("Yaad kar liya: user name"). */
(function () {
    "use strict";

    const style = document.createElement("style");
    style.textContent =
        ".neyo-memory-chip{display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:3px 10px;border-radius:999px;font-size:12px;line-height:1.6;opacity:.75;border:1px solid currentColor;border-color:rgba(127,127,127,.35);background:rgba(127,127,127,.08);user-select:none}" +
        ".neyo-memory-chip+.neyo-memory-chip{margin-left:6px}";
    document.head.appendChild(style);

    function pretty(key) {
        if (key === "all") return "sab kuch";
        return String(key)
            .replace(/^auto_/, "")
            .replace(/^user_/, "")
            .replace(/\*$/, " (sab)")
            .replace(/_/g, " ");
    }

    function list(keys) {
        const names = keys.slice(0, 3).map(pretty);
        return names.join(", ") + (keys.length > 3 ? ` +${keys.length - 3}` : "");
    }

    function chip(text) {
        const el = document.createElement("span");
        el.className = "neyo-memory-chip";
        el.textContent = text;
        return el;
    }

    window.addEventListener("neyo:memory", event => {
        const info = event.detail || {};
        const saved = Array.isArray(info.saved) ? info.saved : [];
        const forgot = Array.isArray(info.forgot) ? info.forgot : [];
        if (!saved.length && !forgot.length) return;

        setTimeout(() => {
            const answers = document.querySelectorAll(".message.assistant");
            const last = answers[answers.length - 1];
            if (!last) return;
            const host = last.querySelector(".message-content") || last;
            host.querySelectorAll(".neyo-memory-chip").forEach(old => old.remove());
            if (saved.length) host.appendChild(chip(`🧠 Yaad kar liya: ${list(saved)}`));
            if (forgot.length) host.appendChild(chip(`🧹 Bhool gaya: ${list(forgot)}`));
        }, 400);
    });
})();
