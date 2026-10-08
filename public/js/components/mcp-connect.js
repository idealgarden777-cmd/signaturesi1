/* NEYO • one-click app connections (MCP)
   Settings > Workspace > Connected apps.
   Connect = go to the app's login page; it comes back with ?mcp=... */
(function () {
    "use strict";

    const style = document.createElement("style");
    style.textContent =
        ".mcp-connections .settings-row strong{display:flex;align-items:center;gap:6px}" +
        ".mcp-connections .mcp-badge{font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;background:rgba(34,197,94,.14);color:#16a34a}" +
        ".mcp-connections .mcp-action[disabled]{opacity:.55;cursor:default}" +
        ".pd-box{margin-top:14px;display:flex;flex-direction:column;gap:10px}" +
        ".pd-box .pd-note{font-size:12px;opacity:.7}" +
        ".pd-search{width:100%;box-sizing:border-box;padding:9px 12px;border-radius:10px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit}" +
        ".pd-list{display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto}" +
        ".pd-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;border:1px solid rgba(127,127,127,.18)}" +
        ".pd-item img{width:24px;height:24px;border-radius:6px;object-fit:contain;flex:none;background:#fff}" +
        ".pd-item .pd-text{flex:1;min-width:0;display:flex;flex-direction:column}" +
        ".pd-item .pd-text b{font-size:13px;font-weight:600}" +
        ".pd-item .pd-text small{font-size:11px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
        ".pd-item button{flex:none}";
    document.head.appendChild(style);

    const TEXT = {
        idle: "Let NEYO read your repos, issues and pull requests, and act on them when you ask.",
        notConfigured: "Not set up on the server yet (GitHub OAuth app keys missing).",
        login: "Log in to NEYO first.",
        error: "Couldn't load connection status."
    };

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

    function rows() {
        return Array.from(document.querySelectorAll("[data-mcp-server]"));
    }

    function render(server) {
        const row = document.querySelector(`[data-mcp-server="${server.id}"]`);
        if (!row) return;
        const title = row.querySelector("strong");
        const status = row.querySelector(".mcp-status");
        const button = row.querySelector(".mcp-action");
        title.querySelector(".mcp-badge")?.remove();

        if (server.connected) {
            const badge = document.createElement("span");
            badge.className = "mcp-badge";
            badge.textContent = "Connected";
            title.appendChild(badge);
            status.textContent = server.account
                ? `Connected as @${server.account}. Ask NEYO about your repos, issues or PRs.`
                : "Connected. Ask NEYO about your repos, issues or PRs.";
            button.textContent = "Disconnect";
            button.dataset.mcpAction = "disconnect";
            button.className = "settings-ghost-btn mcp-action";
            button.disabled = false;
        } else {
            status.textContent = server.configured ? TEXT.idle : TEXT.notConfigured;
            button.textContent = "Connect";
            button.dataset.mcpAction = "connect";
            button.className = "settings-primary-btn mcp-action";
            button.disabled = !server.configured;
        }
    }


    /* ---------- Pipedream: 3,000+ apps ---------- */
    let pdState = { configured: false, accounts: [] };
    let searchTimer = null;

    function esc(text) {
        return String(text || "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }

    function pdItem(app, button) {
        const img = app.img ? `<img src="${esc(app.img)}" alt="" loading="lazy">` : "";
        return `<div class="pd-item">${img}<div class="pd-text"><b>${esc(app.name)}</b><small>${esc(app.sub || app.description || "")}</small></div>${button}</div>`;
    }

    function pdBox() {
        const host = document.getElementById("mcpConnections");
        if (!host) return null;
        let box = document.getElementById("pdApps");
        if (!box) {
            box = document.createElement("div");
            box.id = "pdApps";
            box.className = "pd-box";
            box.innerHTML =
                '<div class="pd-list" id="pdConnected"></div>' +
                '<input class="pd-search" id="pdSearch" type="search" placeholder="Search 3,000+ apps (Gmail, Notion, Slack…)" autocomplete="off">' +
                '<div class="pd-list" id="pdResults"></div>' +
                '<small class="pd-note" id="pdNote"></small>';
            host.appendChild(box);
            box.querySelector("#pdSearch").addEventListener("input", event => {
                clearTimeout(searchTimer);
                const q = event.target.value;
                searchTimer = setTimeout(() => searchApps(q), 300);
            });
        }
        return box;
    }

    function renderPipedream(data) {
        pdState = { configured: Boolean(data.configured), accounts: data.accounts || [] };
        const box = pdBox();
        if (!box) return;
        const note = box.querySelector("#pdNote");
        const search = box.querySelector("#pdSearch");
        if (!pdState.configured) {
            box.querySelector("#pdConnected").innerHTML = "";
            box.querySelector("#pdResults").innerHTML = "";
            search.style.display = "none";
            note.textContent = "More apps: not set up on the server yet (Pipedream keys missing).";
            return;
        }
        search.style.display = "";
        note.textContent = "Connected apps are used only when your message is about them. NEYO asks before changing anything.";
        box.querySelector("#pdConnected").innerHTML = pdState.accounts.map(account => pdItem(
            { ...account.app, sub: account.healthy ? (account.name || "Connected") : "Needs reconnect" },
            `<button type="button" class="settings-ghost-btn pd-off" data-account="${esc(account.id)}" data-name="${esc(account.app.name)}">Disconnect</button>`
        )).join("");
        if (!box.querySelector("#pdResults").dataset.loaded) {
            searchApps("");
        }
    }

    let searchSeq = 0;
    async function searchApps(q) {
        const box = pdBox();
        if (!box || !pdState.configured) return;
        const results = box.querySelector("#pdResults");
        const seq = ++searchSeq;
        try {
            const response = await fetch(`/api/mcp?action=apps&q=${encodeURIComponent(q || "")}`, { credentials: "same-origin", cache: "no-store" });
            const data = await response.json();
            if (seq !== searchSeq) return;
            results.dataset.loaded = "1";
            const have = new Set(pdState.accounts.map(account => account.app.slug));
            const apps = (data.apps || []).filter(app => !have.has(app.slug));
            results.innerHTML = apps.length
                ? apps.map(app => pdItem(app, `<button type="button" class="settings-primary-btn pd-on" data-app="${esc(app.slug)}">Connect</button>`)).join("")
                : `<small class="pd-note">No apps found.</small>`;
        } catch {
            if (seq === searchSeq) results.innerHTML = `<small class="pd-note">Couldn't load apps.</small>`;
        }
    }

    document.addEventListener("click", async event => {
        const on = event.target.closest?.(".pd-on");
        const off = event.target.closest?.(".pd-off");
        if (!on && !off) return;
        const button = on || off;
        if (button.disabled) return;
        if (off && !window.confirm(`Disconnect ${off.dataset.name || "this app"} from NEYO?`)) return;
        button.disabled = true;
        const label = button.textContent;
        button.textContent = on ? "Opening…" : "Removing…";
        try {
            const response = await fetch(`/api/mcp?action=${on ? "pd_connect" : "pd_disconnect"}`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(on ? { app: on.dataset.app } : { account: off.dataset.account })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error();
            if (on && data.url) {
                window.location.href = data.url;
                return;
            }
            notify(`${off.dataset.name || "App"} disconnected.`, "success");
            refresh();
        } catch {
            notify(on ? "Couldn't open the app login. Try again." : "Couldn't disconnect. Try again.", "error");
            button.disabled = false;
            button.textContent = label;
        }
    });

    let loading = null;
    function refresh() {
        if (loading) return loading;
        loading = fetch("/api/mcp?action=status", { credentials: "same-origin", cache: "no-store" })
            .then(async response => {
                if (response.status === 401) {
                    rows().forEach(row => {
                        row.querySelector(".mcp-status").textContent = TEXT.login;
                        row.querySelector(".mcp-action").disabled = true;
                    });
                    return;
                }
                const data = await response.json();
                (data.servers || []).forEach(render);
                renderPipedream(data.pipedream || {});
            })
            .catch(() => {
                rows().forEach(row => {
                    row.querySelector(".mcp-status").textContent = TEXT.error;
                });
            })
            .finally(() => {
                loading = null;
            });
        return loading;
    }

    document.addEventListener("click", async event => {
        const button = event.target.closest?.(".mcp-action");
        if (button) {
            const server = button.closest("[data-mcp-server]")?.dataset.mcpServer;
            if (!server || button.disabled) return;
            if (button.dataset.mcpAction === "connect") {
                button.disabled = true;
                button.textContent = "Opening…";
                window.location.href = `/api/mcp?action=connect&server=${encodeURIComponent(server)}`;
                return;
            }
            if (!window.confirm("Disconnect GitHub from NEYO?")) return;
            button.disabled = true;
            try {
                const response = await fetch("/api/mcp?action=disconnect", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ server })
                });
                if (!response.ok) throw new Error();
                notify("GitHub disconnected.", "success");
            } catch {
                notify("Couldn't disconnect. Try again.", "error");
            }
            refresh();
            return;
        }
        if (event.target.closest?.('[data-settings-tab="workspace"]')) {
            refresh();
        }
    });

    // Back from the login page: show the result and open the Workspace tab.
    function handleReturn() {
        const params = new URLSearchParams(window.location.search);
        const result = params.get("mcp");
        if (!result) return;
        const slug = String(params.get("server") || "");
        const app = slug === "github" || !slug
            ? "GitHub"
            : slug.split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
        const messages = {
            connected: [`${app} connected. Ask NEYO about it in chat.`, "success"],
            cancelled: [`${app} connection cancelled.`, "info"],
            not_configured: [`${app} isn't set up on the server yet.`, "warning"],
            login: ["Log in to NEYO first.", "warning"],
            error: [`Couldn't connect ${app}. Please try again.`, "error"]
        };
        const [message, type] = messages[result] || messages.error;
        params.delete("mcp");
        params.delete("server");
        const query = params.toString();
        window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : "") + window.location.hash);
        setTimeout(() => {
            notify(message, type);
            try {
                window.NeyoSettings?.open?.("workspace");
            } catch {}
            refresh();
        }, 600);
    }

    function start() {
        refresh();
        handleReturn();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
