/* =========================================================
   NEYO • WORKSPACES v1
   Sidebar "Workspaces" → panel with: workspace list, Overview,
   Members (Bean IDs + roles + online), Tasks, Notes & decisions,
   Files (text), Activity. "Use in chat" puts a chip on the
   composer; chat.js sends workspaceId so NEYO knows the project.
   Linked to Bean: each workspace has its own Bean group chat.
   API: /api/history?resource=workspaces
   ========================================================= */
(function () {
  "use strict";

  const API = "/api/history?resource=workspaces";
  const ACTIVE_KEY = "neyo_active_workspace";
  const TEXT_FILES = ".txt,.md,.csv,.tsv,.json,.xml,.html,.htm,.css,.js,.ts,.py,.sql,.log,.yaml,.yml,.ini,.env.example";
  const MAX_FILE_CHARS = 60000;

  const state = {
    list: [],
    current: null, // { workspace, members, items, activity }
    tab: "overview",
    noteKind: "note",
    loading: false
  };

  /* ---------------- helpers ---------------- */

  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const toast = (message, type = "success") =>
    window.dispatchEvent(new CustomEvent(`neyo:notification-${type}`, { detail: { message } }));

  function ago(iso) {
    if (!iso) return "";
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  const initials = name =>
    String(name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";

  const size = n => (n > 1024 ? `${(n / 1024).toFixed(n > 10240 ? 0 : 1)} KB` : `${n || 0} B`);

  function readActive() {
    try {
      const data = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null");
      return data && data.id ? data : null;
    } catch {
      return null;
    }
  }

  function writeActive(value) {
    try {
      if (value) localStorage.setItem(ACTIVE_KEY, JSON.stringify(value));
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {}
    renderChip();
  }

  window.NeyoWorkspaces = {
    activeId: () => readActive()?.id || null,
    open: () => openPanel()
  };

  async function api(method, body, query = "") {
    const response = await fetch(API + query, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try {
      data = await response.json();
    } catch {}
    if (!response.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  const can = min => {
    const rank = { owner: 4, admin: 3, member: 2, viewer: 1 };
    return (rank[state.current?.workspace?.role] || 0) >= rank[min];
  };

  /* ---------------- styles ---------------- */

  const css = `
.nw-overlay{position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.32);backdrop-filter:blur(2px)}
.nw-overlay.open{display:flex}
.nw-panel{width:min(1040px,96vw);height:min(720px,92vh);display:flex;background:var(--neyo-surface,#fff);color:var(--neyo-text,#171717);border-radius:20px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.18);font-family:var(--neyo-font-text,Inter,sans-serif)}
.nw-side{width:260px;flex:none;background:var(--neyo-surface-soft,#f5f5f5);display:flex;flex-direction:column;border-right:1px solid var(--neyo-border,rgba(0,0,0,.08))}
.nw-side-head{display:flex;align-items:center;justify-content:space-between;padding:20px 18px 12px}
.nw-side-head h2{margin:0;font:600 18px var(--neyo-font-display,Sora,sans-serif)}
.nw-list{flex:1;overflow:auto;padding:4px 10px 10px}
.nw-ws{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:10px 12px;border-radius:12px;cursor:pointer;margin-bottom:2px}
.nw-ws:hover{background:var(--neyo-surface-hover,#ececec)}
.nw-ws.active{background:var(--neyo-surface,#fff);box-shadow:0 1px 3px rgba(0,0,0,.06)}
.nw-ws strong{display:block;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nw-ws small{font-size:12px;color:var(--neyo-text-secondary,#737373)}
.nw-new{margin:10px;border:1px dashed var(--neyo-border-strong,rgba(0,0,0,.18));background:transparent;color:inherit;border-radius:12px;padding:10px;font:500 14px inherit;cursor:pointer}
.nw-new:hover{background:var(--neyo-surface-hover,#ececec)}
.nw-main{flex:1;display:flex;flex-direction:column;min-width:0}
.nw-head{display:flex;align-items:flex-start;gap:12px;padding:20px 22px 0}
.nw-head-text{flex:1;min-width:0}
.nw-head h3{margin:0;font:600 20px var(--neyo-font-display,Sora,sans-serif);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nw-head p{margin:4px 0 0;font-size:13px;color:var(--neyo-text-secondary,#737373);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.nw-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.nw-btn{border:1px solid var(--neyo-border-strong,rgba(0,0,0,.14));background:var(--neyo-surface,#fff);color:inherit;border-radius:999px;padding:7px 14px;font:500 13px inherit;cursor:pointer;white-space:nowrap}
.nw-btn:hover{background:var(--neyo-surface-hover,#f1f1f1)}
.nw-btn.primary{background:var(--neyo-text,#171717);color:var(--neyo-surface,#fff);border-color:transparent}
.nw-btn.primary:hover{opacity:.88}
.nw-btn.danger{color:#c62828}
.nw-btn:disabled{opacity:.45;cursor:default}
.nw-x{border:0;background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:8px}
.nw-x:hover{background:var(--neyo-surface-hover,#f1f1f1)}
.nw-tabs{display:flex;gap:4px;padding:14px 22px 0;border-bottom:1px solid var(--neyo-border,rgba(0,0,0,.08));overflow-x:auto}
.nw-tab{border:0;background:transparent;color:var(--neyo-text-secondary,#737373);padding:9px 12px;font:500 13px inherit;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.nw-tab.active{color:var(--neyo-text,#171717);border-bottom-color:var(--neyo-text,#171717)}
.nw-tab .nw-count{font-size:11px;opacity:.6;margin-left:3px}
.nw-body{flex:1;overflow:auto;padding:18px 22px 24px}
.nw-empty{padding:60px 20px;text-align:center;color:var(--neyo-text-secondary,#737373);font-size:14px;line-height:1.6}
.nw-empty strong{display:block;color:var(--neyo-text,#171717);font-size:16px;margin-bottom:6px}
.nw-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
.nw-stat{background:var(--neyo-surface-soft,#f5f5f5);border-radius:14px;padding:12px 14px}
.nw-stat b{display:block;font:600 22px var(--neyo-font-display,Sora,sans-serif)}
.nw-stat span{font-size:12px;color:var(--neyo-text-secondary,#737373)}
.nw-label{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--neyo-text-muted,#9b9b9b);margin:16px 0 8px}
.nw-input,.nw-select,.nw-area{width:100%;box-sizing:border-box;border:1px solid var(--neyo-border-strong,rgba(0,0,0,.14));background:var(--neyo-surface,#fff);color:inherit;border-radius:10px;padding:9px 11px;font:14px inherit}
.nw-area{min-height:80px;resize:vertical;line-height:1.5}
.nw-select{width:auto}
.nw-input:focus,.nw-select:focus,.nw-area:focus{outline:none;border-color:var(--neyo-text-secondary,#737373)}
.nw-form{display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
.nw-form .nw-input{flex:1;min-width:160px}
.nw-stack{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}
.nw-row{display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid var(--neyo-border,rgba(0,0,0,.06))}
.nw-row:last-child{border-bottom:0}
.nw-av{position:relative;width:36px;height:36px;flex:none;border-radius:50%;background:var(--neyo-surface-soft,#eee);display:flex;align-items:center;justify-content:center;font:600 13px inherit}
.nw-av.on::after{content:"";position:absolute;right:0;bottom:0;width:10px;height:10px;border-radius:50%;background:#22c55e;border:2px solid var(--neyo-surface,#fff)}
.nw-grow{flex:1;min-width:0}
.nw-grow strong{display:block;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nw-grow small{display:block;font-size:12px;color:var(--neyo-text-secondary,#737373);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nw-badge{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--neyo-surface-soft,#f0f0f0);text-transform:capitalize;white-space:nowrap}
.nw-badge.owner{background:#171717;color:#fff}
.nw-badge.decision{background:#fff4d6;color:#8a5a00}
.nw-badge.doing{background:#e0ecff;color:#1d4ed8}
.nw-badge.done{background:#dcfce7;color:#15803d}
.nw-del{border:0;background:transparent;color:var(--neyo-text-muted,#9b9b9b);cursor:pointer;font-size:18px;padding:2px 6px;border-radius:8px}
.nw-del:hover{color:#c62828;background:var(--neyo-surface-hover,#f1f1f1)}
.nw-group{margin-bottom:8px}
.nw-group h4{margin:14px 0 4px;font-size:13px;font-weight:600;display:flex;gap:6px;align-items:center}
.nw-card{border:1px solid var(--neyo-border,rgba(0,0,0,.08));border-radius:14px;padding:12px 14px;margin-bottom:10px}
.nw-card-top{display:flex;gap:8px;align-items:center}
.nw-card-top strong{flex:1;font-size:14px}
.nw-card p{margin:8px 0 0;font-size:13px;line-height:1.55;white-space:pre-wrap;color:var(--neyo-text,#171717)}
.nw-card small{display:block;margin-top:8px;font-size:11px;color:var(--neyo-text-muted,#9b9b9b)}
.nw-seg{display:inline-flex;background:var(--neyo-surface-soft,#f0f0f0);border-radius:999px;padding:3px}
.nw-seg button{border:0;background:transparent;color:inherit;border-radius:999px;padding:6px 12px;font:500 13px inherit;cursor:pointer}
.nw-seg button.active{background:var(--neyo-surface,#fff);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.nw-hint{font-size:12px;color:var(--neyo-text-secondary,#737373);margin:-4px 0 12px;line-height:1.5}
.nw-act{display:flex;gap:10px;padding:8px 0;font-size:13px;line-height:1.45}
.nw-act time{flex:none;width:70px;color:var(--neyo-text-muted,#9b9b9b);font-size:12px}
.nw-chip{display:none;align-items:center;gap:8px;margin:0 auto 8px;width:fit-content;max-width:90%;padding:6px 8px 6px 12px;border-radius:999px;background:var(--neyo-surface-soft,#f2f2f2);border:1px solid var(--neyo-border,rgba(0,0,0,.08));font:500 12.5px var(--neyo-font-text,Inter,sans-serif);color:var(--neyo-text,#171717)}
.nw-chip.show{display:flex}
.nw-chip span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.nw-chip button{border:0;background:transparent;color:inherit;opacity:.6;cursor:pointer;font-size:15px;line-height:1;padding:0 4px}
.nw-chip button:hover{opacity:1}
.nw-modal{position:absolute;inset:0;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:5}
.nw-modal-box{width:min(440px,92%);background:var(--neyo-surface,#fff);border-radius:18px;padding:20px;box-shadow:0 18px 50px rgba(0,0,0,.2)}
.nw-modal-box h3{margin:0 0 12px;font:600 17px var(--neyo-font-display,Sora,sans-serif)}
.nw-modal-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.nw-back{display:none}
body.dark-mode .nw-badge.owner{background:#fff;color:#111}
body.dark-mode .nw-badge.decision{background:#3a2f12;color:#f5c451}
body.dark-mode .nw-badge.doing{background:#16284a;color:#8db4ff}
body.dark-mode .nw-badge.done{background:#123522;color:#6ee7a0}
@media (max-width:760px){
 .nw-panel{width:100vw;height:100dvh;border-radius:0}
 .nw-side{width:100%;border-right:0}
 .nw-panel.detail .nw-side{display:none}
 .nw-panel:not(.detail) .nw-main{display:none}
 .nw-back{display:inline-flex}
 .nw-stats{grid-template-columns:repeat(2,1fr)}
 .nw-head{flex-wrap:wrap}
 .nw-actions{justify-content:flex-start;width:100%}
}`;

  /* ---------------- DOM ---------------- */

  let overlay, panel, side, main, modalHost;

  function build() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    overlay = document.createElement("div");
    overlay.className = "nw-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="nw-panel" role="dialog" aria-label="Workspaces" style="position:relative">
        <aside class="nw-side">
          <div class="nw-side-head"><h2>Workspaces</h2><button class="nw-x" data-nw="close" aria-label="Close">×</button></div>
          <div class="nw-list" id="nwList"></div>
          <button class="nw-new" data-nw="new">+ New workspace</button>
        </aside>
        <section class="nw-main" id="nwMain"></section>
      </div>`;
    document.body.appendChild(overlay);
    panel = overlay.querySelector(".nw-panel");
    side = overlay.querySelector("#nwList");
    main = overlay.querySelector("#nwMain");
    modalHost = panel;

    overlay.addEventListener("click", onClick);
    overlay.addEventListener("change", onChange);
    overlay.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        if (panel.querySelector(".nw-modal")) closeModal();
        else closePanel();
      }
      if (event.key === "Enter" && event.target.matches("input.nw-input[data-enter]")) {
        event.preventDefault();
        overlay.querySelector(`[data-nw="${event.target.dataset.enter}"]`)?.click();
      }
    });
    overlay.addEventListener("mousedown", event => {
      if (event.target === overlay) closePanel();
    });

    addSidebarButton();
    addChip();
  }

  function addSidebarButton() {
    const nav = document.querySelector(".sidebar-primary-nav");
    if (!nav || document.getElementById("sidebarWorkspacesBtn")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "sidebarWorkspacesBtn";
    button.className = "sidebar-personality-btn";
    button.title = "Workspaces";
    button.setAttribute("data-tooltip", "Workspaces");
    button.setAttribute("data-tooltip-position", "right");
    button.innerHTML = `<span class="sidebar-nav-icon"><svg class="neyo-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="17" height="12.5" rx="3"/><path d="M8.5 7V5.75A1.75 1.75 0 0 1 10.25 4h3.5a1.75 1.75 0 0 1 1.75 1.75V7"/><path d="M3.5 12.5h17"/></svg></span><span>Workspaces</span>`;
    button.addEventListener("click", () => openPanel());
    nav.appendChild(button);
  }

  let chip;
  function addChip() {
    const wrapper = document.getElementById("composerWrapper");
    if (!wrapper) return;
    chip = document.createElement("div");
    chip.className = "nw-chip";
    chip.innerHTML = `<span data-nwchip="open" title="Open workspace"></span><button type="button" data-nwchip="clear" aria-label="Stop using this workspace">×</button>`;
    wrapper.parentNode.insertBefore(chip, wrapper);
    chip.addEventListener("click", event => {
      const what = event.target.closest("[data-nwchip]")?.dataset.nwchip;
      if (what === "clear") {
        writeActive(null);
        toast("NEYO stopped using the workspace in chat.");
      } else if (what === "open") {
        openPanel(readActive()?.id);
      }
    });
    renderChip();
  }

  function renderChip() {
    if (!chip) return;
    const active = readActive();
    chip.classList.toggle("show", Boolean(active));
    chip.querySelector("span").textContent = active ? `🗂️ ${active.name} · NEYO is using this workspace` : "";
  }

  /* ---------------- open / load ---------------- */

  async function openPanel(id) {
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    renderSide();
    if (!state.current) main.innerHTML = `<div class="nw-empty">Loading…</div>`;
    try {
      const data = await api("GET");
      state.list = data.workspaces || [];
      renderSide();
      const pick = id || state.current?.workspace?.id || readActive()?.id || state.list[0]?.id;
      if (pick && state.list.some(w => w.id === pick)) await select(pick);
      else {
        state.current = null;
        renderMain();
      }
    } catch (error) {
      main.innerHTML = `<div class="nw-empty"><strong>Workspaces couldn't load</strong>${esc(error.message)}</div>`;
    }
  }

  function closePanel() {
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
  }

  async function select(id, tab) {
    try {
      const data = await api("GET", null, `&id=${encodeURIComponent(id)}`);
      setCurrent(data);
      if (tab) state.tab = tab;
      panel.classList.add("detail");
      renderSide();
      renderMain();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function setCurrent(data) {
    state.current = data;
    const w = data.workspace;
    const entry = state.list.find(x => x.id === w.id);
    if (entry) {
      entry.name = w.name;
      entry.members = data.members.length;
      entry.role = w.role;
    }
    const active = readActive();
    if (active?.id === w.id && active.name !== w.name) writeActive({ id: w.id, name: w.name });
  }

  async function act(body, okMessage) {
    if (state.loading) return null;
    state.loading = true;
    try {
      const data = await api("POST", { id: state.current?.workspace?.id, ...body });
      if (data.workspace) {
        setCurrent(data);
        renderSide();
        renderMain();
      }
      if (okMessage) toast(okMessage);
      return data;
    } catch (error) {
      toast(error.message, "error");
      return null;
    } finally {
      state.loading = false;
    }
  }

  /* ---------------- render ---------------- */

  function renderSide() {
    if (!state.list.length) {
      side.innerHTML = `<div class="nw-hint" style="padding:8px 12px">No workspaces yet.</div>`;
      return;
    }
    const activeId = readActive()?.id;
    side.innerHTML = state.list
      .map(
        w => `<button class="nw-ws ${state.current?.workspace?.id === w.id ? "active" : ""}" data-nw="select" data-id="${esc(w.id)}">
          <strong>${activeId === w.id ? "● " : ""}${esc(w.name)}</strong>
          <small>${w.members} member${w.members === 1 ? "" : "s"} · ${esc(w.role)}</small>
        </button>`
      )
      .join("");
  }

  function renderMain() {
    const data = state.current;
    if (!data) {
      main.innerHTML = `<div class="nw-head"><div class="nw-head-text"></div><button class="nw-x" data-nw="close" aria-label="Close">×</button></div>
        <div class="nw-empty"><strong>One place for a whole project</strong>
        Add your team by Bean ID, keep tasks, decisions, notes and files together,<br>and NEYO will know the project in every chat. Each workspace also gets its own Bean group.<br><br>
        <button class="nw-btn primary" data-nw="new">+ Create your first workspace</button></div>`;
      return;
    }
    const { workspace: w, members, items } = data;
    const count = kind => items.filter(i => i.kind === kind).length;
    const notes = items.filter(i => i.kind === "note" || i.kind === "decision").length;
    const using = readActive()?.id === w.id;
    const tabs = [
      ["overview", "Overview", ""],
      ["members", "Members", members.length],
      ["tasks", "Tasks", count("task")],
      ["notes", "Notes & decisions", notes],
      ["files", "Files", count("file")],
      ["activity", "Activity", ""]
    ];
    main.innerHTML = `
      <div class="nw-head">
        <button class="nw-btn nw-back" data-nw="back">← All</button>
        <div class="nw-head-text">
          <h3>${esc(w.name)}</h3>
          <p>${esc(w.description || "No description yet.")}</p>
        </div>
        <div class="nw-actions">
          <button class="nw-btn ${using ? "" : "primary"}" data-nw="use">${using ? "✓ Using in chat" : "Use in chat"}</button>
          <button class="nw-btn" data-nw="bean">Open Bean chat</button>
          ${can("admin") ? `<button class="nw-btn" data-nw="edit">Edit</button>` : ""}
        </div>
        <button class="nw-x" data-nw="close" aria-label="Close">×</button>
      </div>
      <nav class="nw-tabs">${tabs
        .map(([id, label, n]) => `<button class="nw-tab ${state.tab === id ? "active" : ""}" data-nw="tab" data-tab="${id}">${label}${n !== "" ? `<span class="nw-count">${n}</span>` : ""}</button>`)
        .join("")}</nav>
      <div class="nw-body">${renderTab()}</div>`;
  }

  function renderTab() {
    const fn = { overview, membersTab, tasksTab, notesTab, filesTab, activityTab }[
      { overview: "overview", members: "membersTab", tasks: "tasksTab", notes: "notesTab", files: "filesTab", activity: "activityTab" }[state.tab] || "overview"
    ];
    return fn();
  }

  function overview() {
    const { workspace: w, members, items, activity } = state.current;
    const open = items.filter(i => i.kind === "task" && i.status !== "done").length;
    const online = members.filter(m => m.online).length;
    return `
      <div class="nw-stats">
        <div class="nw-stat"><b>${members.length}</b><span>Members${online ? ` · ${online} online` : ""}</span></div>
        <div class="nw-stat"><b>${open}</b><span>Open tasks</span></div>
        <div class="nw-stat"><b>${items.filter(i => i.kind === "decision").length}</b><span>Decisions</span></div>
        <div class="nw-stat"><b>${items.filter(i => i.kind === "file").length}</b><span>Files</span></div>
      </div>
      <span class="nw-label">Instructions for NEYO</span>
      ${
        can("admin")
          ? `<div class="nw-hint">NEYO follows these whenever this workspace is used in chat. Example: "Client ke liye formal English, prices PKR mein."</div>
             <textarea class="nw-area" id="nwInstr" maxlength="3000" placeholder="How should NEYO work on this project?">${esc(w.instructions)}</textarea>
             <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="nw-btn primary" data-nw="save-instr">Save</button></div>`
          : `<div class="nw-card"><p style="margin:0">${esc(w.instructions || "No instructions yet.")}</p></div>`
      }
      <span class="nw-label">Team</span>
      ${members.slice(0, 6).map(memberRow).join("")}
      ${members.length > 6 ? `<button class="nw-btn" data-nw="tab" data-tab="members">See all ${members.length}</button>` : ""}
      <span class="nw-label">Recent activity</span>
      ${activity.length ? activity.slice(0, 5).map(actRow).join("") : `<div class="nw-hint">Nothing yet.</div>`}`;
  }

  function memberRow(m) {
    const manage = can("admin") && m.role !== "owner" && !(state.current.workspace.role === "admin" && m.role === "admin" && !m.you);
    return `<div class="nw-row">
      <div class="nw-av ${m.online ? "on" : ""}">${esc(initials(m.name))}</div>
      <div class="nw-grow"><strong>${esc(m.name)}${m.you ? " (you)" : ""}</strong>
        <small>@${esc(m.beanId)} · ${m.online ? "online" : m.lastSeen ? `last seen ${ago(m.lastSeen)}` : "offline"}</small></div>
      ${
        manage && state.tab === "members"
          ? `<select class="nw-select" data-nw="role" data-user="${esc(m.id)}">${["admin", "member", "viewer"]
              .map(r => `<option value="${r}" ${m.role === r ? "selected" : ""}>${r[0].toUpperCase() + r.slice(1)}</option>`)
              .join("")}</select>
             <button class="nw-del" data-nw="remove-member" data-user="${esc(m.id)}" title="Remove">×</button>`
          : `<span class="nw-badge ${m.role}">${esc(m.role)}</span>`
      }
    </div>`;
  }

  function membersTab() {
    const { members } = state.current;
    return `
      ${
        can("admin")
          ? `<div class="nw-form">
              <input class="nw-input" id="nwBeanId" placeholder="Bean ID, e.g. ali or @ali" data-enter="add-member" autocomplete="off">
              <select class="nw-select" id="nwRole"><option value="member">Member</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select>
              <button class="nw-btn primary" data-nw="add-member">Add</button>
            </div>
            <div class="nw-hint">They join this workspace and its Bean group chat. Admin: manage people. Member: add and edit work. Viewer: can only look.</div>`
          : ""
      }
      ${members.map(memberRow).join("")}
      ${
        state.current.workspace.role !== "owner"
          ? `<div style="margin-top:18px"><button class="nw-btn danger" data-nw="leave">Leave workspace</button></div>`
          : ""
      }`;
  }

  function assigneeOptions(selected) {
    return `<option value="">Unassigned</option>` +
      state.current.members
        .filter(m => m.role !== "viewer")
        .map(m => `<option value="${esc(m.id)}" ${selected === m.id ? "selected" : ""}>${esc(m.name)}</option>`)
        .join("");
  }

  function tasksTab() {
    const tasks = state.current.items.filter(i => i.kind === "task");
    const groups = [
      ["todo", "To do"],
      ["doing", "In progress"],
      ["done", "Done"]
    ];
    return `
      ${
        can("member")
          ? `<div class="nw-form">
              <input class="nw-input" id="nwTaskTitle" placeholder="New task, e.g. Garden quotation prepare karni hai" maxlength="200" data-enter="add-task">
              <select class="nw-select" id="nwTaskWho">${assigneeOptions("")}</select>
              <button class="nw-btn primary" data-nw="add-task">Add</button>
            </div>`
          : ""
      }
      ${
        tasks.length
          ? groups
              .map(([status, label]) => {
                const list = tasks.filter(t => (t.status || "todo") === status);
                return `<div class="nw-group"><h4>${label} <span class="nw-badge ${status}">${list.length}</span></h4>
                  ${list
                    .map(
                      t => `<div class="nw-row">
                        <div class="nw-grow"><strong style="${status === "done" ? "text-decoration:line-through;opacity:.6" : ""}">${esc(t.title)}</strong>
                          <small>${t.assignee ? `→ ${esc(t.assignee.name)}` : "Unassigned"} · ${ago(t.updatedAt)}</small></div>
                        ${
                          can("member")
                            ? `<select class="nw-select" data-nw="task-who" data-item="${esc(t.id)}">${assigneeOptions(t.assignee?.id)}</select>
                               <select class="nw-select" data-nw="task-status" data-item="${esc(t.id)}">${groups
                                 .map(([v, l]) => `<option value="${v}" ${v === status ? "selected" : ""}>${l}</option>`)
                                 .join("")}</select>
                               <button class="nw-del" data-nw="delete-item" data-item="${esc(t.id)}" title="Delete">×</button>`
                            : ""
                        }
                      </div>`
                    )
                    .join("") || `<div class="nw-hint" style="margin:4px">—</div>`}
                </div>`;
              })
              .join("")
          : `<div class="nw-empty">No tasks yet. Add the first one, or ask NEYO in chat to plan them.</div>`
      }`;
  }

  function notesTab() {
    const list = state.current.items.filter(i => i.kind === "note" || i.kind === "decision");
    return `
      ${
        can("member")
          ? `<div class="nw-stack">
              <div class="nw-seg">
                <button data-nw="note-kind" data-kind="note" class="${state.noteKind === "note" ? "active" : ""}">Note</button>
                <button data-nw="note-kind" data-kind="decision" class="${state.noteKind === "decision" ? "active" : ""}">Decision</button>
              </div>
              <input class="nw-input" id="nwNoteTitle" maxlength="200" placeholder="${state.noteKind === "decision" ? "Decision, e.g. Final design: Option B" : "Title"}">
              <textarea class="nw-area" id="nwNoteBody" maxlength="8000" placeholder="${state.noteKind === "decision" ? "Why, and anything to remember" : "Write the note"}"></textarea>
              <div style="display:flex;justify-content:flex-end"><button class="nw-btn primary" data-nw="add-note">Save ${state.noteKind}</button></div>
            </div>`
          : ""
      }
      ${
        list.length
          ? list
              .map(
                n => `<div class="nw-card">
                  <div class="nw-card-top"><span class="nw-badge ${n.kind}">${n.kind}</span><strong>${esc(n.title)}</strong>
                  ${can("member") ? `<button class="nw-del" data-nw="delete-item" data-item="${esc(n.id)}" title="Delete">×</button>` : ""}</div>
                  ${n.body ? `<p>${esc(n.body)}</p>` : ""}
                  <small>${esc(n.createdBy)} · ${ago(n.createdAt)}</small>
                </div>`
              )
              .join("")
          : `<div class="nw-empty">No notes or decisions yet. Decisions you save here are remembered by NEYO.</div>`
      }`;
  }

  function filesTab() {
    const files = state.current.items.filter(i => i.kind === "file");
    return `
      ${
        can("member")
          ? `<div class="nw-form">
              <input type="file" id="nwFile" accept="${TEXT_FILES}" multiple hidden>
              <button class="nw-btn primary" data-nw="pick-file">+ Add files</button>
            </div>
            <div class="nw-hint">Text files for now (TXT, MD, CSV, JSON, code). NEYO reads them as project knowledge, so you don't upload them again in every chat. PDF and photos are coming next.</div>`
          : ""
      }
      ${
        files.length
          ? files
              .map(
                f => `<div class="nw-row">
                  <div class="nw-av">📄</div>
                  <div class="nw-grow"><strong>${esc(f.title)}</strong><small>${size(f.file?.size || f.size)} · ${esc(f.createdBy)} · ${ago(f.createdAt)}</small></div>
                  ${can("member") ? `<button class="nw-del" data-nw="delete-item" data-item="${esc(f.id)}" title="Delete">×</button>` : ""}
                </div>`
              )
              .join("")
          : `<div class="nw-empty">No files yet.</div>`
      }`;
  }

  function actRow(a) {
    return `<div class="nw-act"><time>${ago(a.at)}</time><div><b>${esc(a.who)}</b> ${esc(a.action)}${a.detail ? `: ${esc(a.detail)}` : ""}</div></div>`;
  }

  function activityTab() {
    const list = state.current.activity;
    return list.length ? list.map(actRow).join("") : `<div class="nw-empty">No activity yet.</div>`;
  }

  /* ---------------- modals ---------------- */

  function modal(html) {
    closeModal();
    const box = document.createElement("div");
    box.className = "nw-modal";
    box.innerHTML = `<div class="nw-modal-box">${html}</div>`;
    box.addEventListener("mousedown", event => {
      if (event.target === box) closeModal();
    });
    modalHost.appendChild(box);
    setTimeout(() => box.querySelector("input,textarea")?.focus(), 30);
  }

  function closeModal() {
    panel.querySelector(".nw-modal")?.remove();
  }

  function newModal() {
    modal(`<h3>New workspace</h3>
      <div class="nw-stack">
        <input class="nw-input" id="nwNewName" maxlength="80" placeholder="Name, e.g. Ideal Garden Project" data-enter="create">
        <textarea class="nw-area" id="nwNewDesc" maxlength="2000" placeholder="What is this project about? (optional)"></textarea>
      </div>
      <div class="nw-hint">A Bean group chat with the same name is created for your team.</div>
      <div class="nw-modal-foot"><button class="nw-btn" data-nw="modal-close">Cancel</button><button class="nw-btn primary" data-nw="create">Create</button></div>`);
  }

  function editModal() {
    const w = state.current.workspace;
    modal(`<h3>Edit workspace</h3>
      <div class="nw-stack">
        <input class="nw-input" id="nwEditName" maxlength="80" value="${esc(w.name)}">
        <textarea class="nw-area" id="nwEditDesc" maxlength="2000" placeholder="Description">${esc(w.description)}</textarea>
      </div>
      <div class="nw-modal-foot" style="justify-content:space-between">
        ${w.role === "owner" ? `<button class="nw-btn danger" data-nw="delete-ws">Delete workspace</button>` : "<span></span>"}
        <span style="display:flex;gap:8px"><button class="nw-btn" data-nw="modal-close">Cancel</button><button class="nw-btn primary" data-nw="save-edit">Save</button></span>
      </div>`);
  }

  /* ---------------- events ---------------- */

  const val = id => String(overlay.querySelector(`#${id}`)?.value || "").trim();

  async function onClick(event) {
    const el = event.target.closest("[data-nw]");
    if (!el || el.tagName === "SELECT") return;
    const what = el.dataset.nw;

    if (what === "close") return closePanel();
    if (what === "back") {
      panel.classList.remove("detail");
      return;
    }
    if (what === "new") return newModal();
    if (what === "modal-close") return closeModal();
    if (what === "select") {
      state.tab = "overview";
      return select(el.dataset.id);
    }
    if (what === "tab") {
      state.tab = el.dataset.tab;
      return renderMain();
    }
    if (what === "note-kind") {
      state.noteKind = el.dataset.kind;
      return renderMain();
    }

    if (what === "create") {
      const name = val("nwNewName");
      if (!name) return toast("Give the workspace a name.", "error");
      el.disabled = true;
      try {
        const data = await api("POST", { action: "create", name, description: val("nwNewDesc") });
        closeModal();
        state.list.unshift({ id: data.workspace.id, name: data.workspace.name, role: "owner", members: 1 });
        setCurrent(data);
        state.tab = "members";
        writeActive({ id: data.workspace.id, name: data.workspace.name });
        panel.classList.add("detail");
        renderSide();
        renderMain();
        toast("Workspace created. Add your team by Bean ID.");
      } catch (error) {
        toast(error.message, "error");
        el.disabled = false;
      }
      return;
    }

    if (!state.current) return;
    const w = state.current.workspace;

    switch (what) {
      case "use": {
        if (readActive()?.id === w.id) {
          writeActive(null);
          toast("NEYO stopped using this workspace in chat.");
        } else {
          writeActive({ id: w.id, name: w.name });
          toast(`NEYO will use "${w.name}" in your chats.`);
          closePanel();
        }
        renderSide();
        renderMain();
        break;
      }
      case "bean": {
        const tab = window.open("about:blank", "_blank");
        const data = await act({ action: "open_bean" });
        if (data?.url) {
          if (tab) tab.location.href = data.url;
          else window.location.href = data.url;
        } else if (tab) tab.close();
        break;
      }
      case "edit":
        editModal();
        break;
      case "save-edit": {
        const name = val("nwEditName");
        if (!name) return toast("Name can't be empty.", "error");
        if (await act({ action: "update", name, description: val("nwEditDesc") }, "Saved.")) closeModal();
        break;
      }
      case "delete-ws": {
        if (!confirm(`Delete "${w.name}" with all its tasks, notes and files? This can't be undone.`)) return;
        try {
          await api("POST", { action: "delete", id: w.id });
          closeModal();
          if (readActive()?.id === w.id) writeActive(null);
          state.list = state.list.filter(x => x.id !== w.id);
          state.current = null;
          panel.classList.remove("detail");
          toast("Workspace deleted.");
          if (state.list[0]) await select(state.list[0].id);
          else {
            renderSide();
            renderMain();
          }
        } catch (error) {
          toast(error.message, "error");
        }
        break;
      }
      case "save-instr":
        await act({ action: "update", instructions: val("nwInstr") }, "Instructions saved.");
        break;
      case "add-member": {
        const beanId = val("nwBeanId");
        if (!beanId) return toast("Write a Bean ID.", "error");
        await act({ action: "add_member", beanId, role: val("nwRole") || "member" }, `@${beanId.replace(/^@/, "")} added.`);
        break;
      }
      case "remove-member": {
        const m = state.current.members.find(x => x.id === el.dataset.user);
        if (!confirm(`Remove ${m?.name || "this member"} from the workspace and its Bean group?`)) return;
        await act({ action: "remove_member", userId: el.dataset.user }, "Removed.");
        break;
      }
      case "leave": {
        if (!confirm(`Leave "${w.name}"?`)) return;
        const data = await act({ action: "remove_member" });
        if (data?.left) {
          if (readActive()?.id === w.id) writeActive(null);
          state.list = state.list.filter(x => x.id !== w.id);
          state.current = null;
          panel.classList.remove("detail");
          renderSide();
          renderMain();
          toast("You left the workspace.");
        }
        break;
      }
      case "add-task": {
        const title = val("nwTaskTitle");
        if (!title) return toast("Write the task.", "error");
        await act({ action: "add_item", kind: "task", title, assigneeId: val("nwTaskWho") || null });
        break;
      }
      case "add-note": {
        const title = val("nwNoteTitle");
        if (!title) return toast("Write a title.", "error");
        await act({ action: "add_item", kind: state.noteKind, title, body: val("nwNoteBody") }, state.noteKind === "decision" ? "Decision saved." : "Note saved.");
        break;
      }
      case "delete-item": {
        const item = state.current.items.find(i => i.id === el.dataset.item);
        if (!confirm(`Delete "${item?.title || "this item"}"?`)) return;
        await act({ action: "delete_item", itemId: el.dataset.item });
        break;
      }
      case "pick-file":
        overlay.querySelector("#nwFile")?.click();
        break;
    }
  }

  async function onChange(event) {
    const el = event.target;
    if (el.id === "nwFile") {
      const files = [...(el.files || [])].slice(0, 10);
      el.value = "";
      for (const file of files) {
        if (file.size > 2 * 1024 * 1024) {
          toast(`${file.name} is too big (max 2 MB).`, "error");
          continue;
        }
        let content = "";
        try {
          content = await file.text();
        } catch {
          toast(`${file.name} couldn't be read.`, "error");
          continue;
        }
        if (/\u0000/.test(content.slice(0, 2000))) {
          toast(`${file.name} isn't a text file. PDF and photos are coming next.`, "error");
          continue;
        }
        const cut = content.length > MAX_FILE_CHARS;
        await act(
          {
            action: "add_item",
            kind: "file",
            title: file.name,
            body: content.slice(0, MAX_FILE_CHARS),
            file: { name: file.name, size: file.size, type: file.type || "text/plain" }
          },
          cut ? `${file.name} added (first ${MAX_FILE_CHARS.toLocaleString()} characters).` : `${file.name} added.`
        );
      }
      return;
    }
    const what = el.dataset?.nw;
    if (what === "role") await act({ action: "set_role", userId: el.dataset.user, role: el.value }, "Role updated.");
    if (what === "task-status") await act({ action: "update_item", itemId: el.dataset.item, status: el.value });
    if (what === "task-who") await act({ action: "update_item", itemId: el.dataset.item, assigneeId: el.value || null });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
