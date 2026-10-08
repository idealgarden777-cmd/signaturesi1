/* =========================================================
   NEYO • WORKSPACES v2
   Sidebar "Workspaces" → a full project space:
   Overview · Tasks · Notes & decisions · Files · Members ·
   Approvals · Activity, plus search, invite links, comments,
   due dates and priorities.
   In chat: "Use in chat" chip, NEYO's suggestions as
   Approve / Reject cards, and "Save to workspace" on answers.
   Linked to Bean: each workspace has its own Bean group.
   API: /api/history?resource=workspaces
   ========================================================= */
(function () {
  "use strict";

  const API = "/api/history?resource=workspaces";
  const UPLOAD_API = "/api/attachments/upload";
  const ACTIVE_KEY = "neyo_active_workspace";
  const JOIN_KEY = "neyo_pending_join";
  const MAX_UPLOAD = 25 * 1024 * 1024;

  const state = {
    list: [],
    current: null,
    tab: "overview",
    noteKind: "note",
    taskFilter: "all",
    query: "",
    busy: false,
    lastInvite: null
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

  function dueLabel(due, overdue) {
    if (!due) return "";
    const d = new Date(`${due}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((d - today) / 86400000);
    const text = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return `<span class="nw-due ${overdue ? "late" : days <= 1 ? "soon" : ""}">📅 ${esc(text)}</span>`;
  }

  const initials = name =>
    String(name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";

  const size = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n || 0} B`);

  function fileIcon(name = "", type = "") {
    const ext = String(name).split(".").pop().toLowerCase();
    if (/^image\//.test(type) || ["jpg", "jpeg", "png", "webp", "gif", "svg", "avif", "bmp"].includes(ext)) return "🖼️";
    if (ext === "pdf") return "📕";
    if (["doc", "docx", "odt", "rtf"].includes(ext)) return "📘";
    if (["xls", "xlsx", "csv", "ods", "tsv"].includes(ext)) return "📗";
    if (["ppt", "pptx", "odp"].includes(ext)) return "📙";
    if (/^(audio|video)\//.test(type)) return "🎞️";
    return "📄";
  }

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
    refreshSaveButtons();
  }

  window.NeyoWorkspaces = {
    activeId: () => readActive()?.id || null,
    open: id => openPanel(id)
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
    if (!response.ok) {
      const error = new Error(data.error || "Something went wrong. Please try again.");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  const RANK = { owner: 4, admin: 3, member: 2, viewer: 1 };
  const can = min => (RANK[state.current?.workspace?.role] || 0) >= RANK[min];
  const matches = (...fields) => {
    const q = state.query.trim().toLowerCase();
    return !q || fields.some(f => String(f || "").toLowerCase().includes(q));
  };

  /* ---------------- styles ---------------- */

  const css = `
.nw-overlay{position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.32);backdrop-filter:blur(2px)}
.nw-overlay.open{display:flex}
.nw-panel{position:relative;width:min(1120px,96vw);height:min(760px,92vh);display:flex;background:var(--neyo-surface,#fff);color:var(--neyo-text,#171717);border-radius:20px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.18);font-family:var(--neyo-font-text,Inter,sans-serif)}
.nw-side{width:250px;flex:none;background:var(--neyo-surface-soft,#f5f5f5);display:flex;flex-direction:column;border-right:1px solid var(--neyo-border,rgba(0,0,0,.08))}
.nw-side-head{display:flex;align-items:center;justify-content:space-between;padding:20px 18px 12px}
.nw-side-head h2{margin:0;font:600 18px var(--neyo-font-display,Sora,sans-serif)}
.nw-list{flex:1;overflow:auto;padding:4px 10px 10px}
.nw-ws{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:10px 12px;border-radius:12px;cursor:pointer;margin-bottom:2px}
.nw-ws:hover{background:var(--neyo-surface-hover,#ececec)}
.nw-ws.active{background:var(--neyo-surface,#fff);box-shadow:0 1px 3px rgba(0,0,0,.06)}
.nw-ws-text{flex:1;min-width:0}
.nw-ws strong{display:block;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nw-ws small{font-size:12px;color:var(--neyo-text-secondary,#737373)}
.nw-pill{flex:none;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--neyo-text,#171717);color:var(--neyo-surface,#fff);font-size:11px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.nw-pill.amber{background:#f59e0b;color:#fff}
.nw-new{margin:10px;border:1px dashed var(--neyo-border-strong,rgba(0,0,0,.18));background:transparent;color:inherit;border-radius:12px;padding:10px;font:500 14px inherit;cursor:pointer}
.nw-new:hover{background:var(--neyo-surface-hover,#ececec)}
.nw-main{flex:1;display:flex;flex-direction:column;min-width:0}
.nw-head{display:flex;align-items:flex-start;gap:12px;padding:20px 22px 0}
.nw-head-text{flex:1;min-width:0}
.nw-head h3{margin:0;font:600 20px var(--neyo-font-display,Sora,sans-serif);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nw-head p{margin:4px 0 0;font-size:13px;color:var(--neyo-text-secondary,#737373);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.nw-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.nw-btn{border:1px solid var(--neyo-border-strong,rgba(0,0,0,.14));background:var(--neyo-surface,#fff);color:inherit;border-radius:999px;padding:7px 14px;font:500 13px inherit;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.nw-btn:hover{background:var(--neyo-surface-hover,#f1f1f1)}
.nw-btn.primary{background:var(--neyo-text,#171717);color:var(--neyo-surface,#fff);border-color:transparent}
.nw-btn.primary:hover{opacity:.88}
.nw-btn.small{padding:4px 10px;font-size:12px}
.nw-btn.danger{color:#c62828}
.nw-btn.ok{color:#15803d}
.nw-btn:disabled{opacity:.45;cursor:default}
.nw-x{border:0;background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:8px}
.nw-x:hover{background:var(--neyo-surface-hover,#f1f1f1)}
.nw-bar{display:flex;align-items:flex-end;gap:12px;padding:12px 22px 0;border-bottom:1px solid var(--neyo-border,rgba(0,0,0,.08))}
.nw-tabs{display:flex;gap:2px;overflow-x:auto;flex:1;scrollbar-width:none}
.nw-tab{border:0;background:transparent;color:var(--neyo-text-secondary,#737373);padding:9px 11px;font:500 13px inherit;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.nw-tab.active{color:var(--neyo-text,#171717);border-bottom-color:var(--neyo-text,#171717)}
.nw-tab .nw-count{font-size:11px;opacity:.6;margin-left:3px}
.nw-tab .nw-count.hot{opacity:1;color:#d97706;font-weight:700}
.nw-search{width:180px;margin-bottom:6px;border:1px solid var(--neyo-border-strong,rgba(0,0,0,.14));background:var(--neyo-surface,#fff);color:inherit;border-radius:999px;padding:6px 12px;font:13px inherit}
.nw-search:focus{outline:none;border-color:var(--neyo-text-secondary,#737373)}
.nw-body{flex:1;overflow:auto;padding:18px 22px 28px}
.nw-empty{padding:50px 20px;text-align:center;color:var(--neyo-text-secondary,#737373);font-size:14px;line-height:1.6}
.nw-empty strong{display:block;color:var(--neyo-text,#171717);font-size:16px;margin-bottom:6px}
.nw-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:6px}
.nw-stat{background:var(--neyo-surface-soft,#f5f5f5);border-radius:14px;padding:12px 14px;border:0;text-align:left;color:inherit;cursor:pointer;font:inherit}
.nw-stat:hover{background:var(--neyo-surface-hover,#efefef)}
.nw-stat b{display:block;font:600 22px var(--neyo-font-display,Sora,sans-serif)}
.nw-stat b.late{color:#dc2626}
.nw-stat span{font-size:12px;color:var(--neyo-text-secondary,#737373)}
.nw-label{display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--neyo-text-muted,#9b9b9b);margin:20px 0 8px}
.nw-input,.nw-select,.nw-area{box-sizing:border-box;border:1px solid var(--neyo-border-strong,rgba(0,0,0,.14));background:var(--neyo-surface,#fff);color:inherit;border-radius:10px;padding:8px 10px;font:14px inherit}
.nw-input,.nw-area{width:100%}
.nw-area{min-height:80px;resize:vertical;line-height:1.5}
.nw-select{width:auto;max-width:160px}
.nw-input:focus,.nw-select:focus,.nw-area:focus{outline:none;border-color:var(--neyo-text-secondary,#737373)}
.nw-form{display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
.nw-form .nw-input{flex:1;min-width:180px;width:auto}
.nw-form input[type=date]{width:auto;flex:none}
.nw-stack{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}
.nw-row{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--neyo-border,rgba(0,0,0,.06))}
.nw-row:last-child{border-bottom:0}
.nw-av{position:relative;width:34px;height:34px;flex:none;border-radius:50%;background:var(--neyo-surface-soft,#eee);display:flex;align-items:center;justify-content:center;font:600 12.5px inherit}
.nw-av.on::after{content:"";position:absolute;right:0;bottom:0;width:10px;height:10px;border-radius:50%;background:#22c55e;border:2px solid var(--neyo-surface,#fff)}
.nw-grow{flex:1;min-width:0}
.nw-grow strong{display:block;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nw-grow small{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:12px;color:var(--neyo-text-secondary,#737373)}
.nw-link{border:0;background:transparent;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer;max-width:100%}
.nw-link:hover strong{text-decoration:underline}
.nw-badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--neyo-surface-soft,#f0f0f0);text-transform:capitalize;white-space:nowrap}
.nw-badge.owner{background:#171717;color:#fff}
.nw-badge.decision{background:#fff4d6;color:#8a5a00}
.nw-badge.ai{background:#ede9fe;color:#6d28d9}
.nw-badge.doing{background:#e0ecff;color:#1d4ed8}
.nw-badge.done{background:#dcfce7;color:#15803d}
.nw-badge.high{background:#ffedd5;color:#c2410c}
.nw-badge.urgent{background:#fee2e2;color:#b91c1c}
.nw-badge.low{background:#f1f5f9;color:#64748b}
.nw-due{white-space:nowrap}
.nw-due.soon{color:#d97706;font-weight:600}
.nw-due.late{color:#dc2626;font-weight:600}
.nw-del{border:0;background:transparent;color:var(--neyo-text-muted,#9b9b9b);cursor:pointer;font-size:18px;padding:2px 6px;border-radius:8px;flex:none}
.nw-del:hover{color:#c62828;background:var(--neyo-surface-hover,#f1f1f1)}
.nw-check{flex:none;width:20px;height:20px;border-radius:50%;border:1.6px solid var(--neyo-border-strong,rgba(0,0,0,.3));background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;padding:0}
.nw-check.on{background:#16a34a;border-color:#16a34a}
.nw-check:disabled{cursor:default}
.nw-group h4{margin:16px 0 2px;font-size:13px;font-weight:600;display:flex;gap:6px;align-items:center}
.nw-card{border:1px solid var(--neyo-border,rgba(0,0,0,.08));border-radius:14px;padding:12px 14px;margin-bottom:10px}
.nw-card-top{display:flex;gap:8px;align-items:center}
.nw-card-top .nw-link{flex:1;min-width:0}
.nw-card-top strong{font-size:14px}
.nw-card p{margin:8px 0 0;font-size:13px;line-height:1.55;white-space:pre-wrap;color:var(--neyo-text,#171717);display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.nw-card small{display:block;margin-top:8px;font-size:11px;color:var(--neyo-text-muted,#9b9b9b)}
.nw-seg{display:inline-flex;background:var(--neyo-surface-soft,#f0f0f0);border-radius:999px;padding:3px;flex-wrap:wrap}
.nw-seg button{border:0;background:transparent;color:inherit;border-radius:999px;padding:5px 12px;font:500 13px inherit;cursor:pointer}
.nw-seg button.active{background:var(--neyo-surface,#fff);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.nw-hint{font-size:12px;color:var(--neyo-text-secondary,#737373);margin:-4px 0 12px;line-height:1.5}
.nw-act{display:flex;gap:10px;padding:7px 0;font-size:13px;line-height:1.45}
.nw-act time{flex:none;width:70px;color:var(--neyo-text-muted,#9b9b9b);font-size:12px}
.nw-sugg{border:1px solid var(--neyo-border,rgba(0,0,0,.08));border-left:3px solid #8b5cf6;border-radius:12px;padding:10px 12px;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start}
.nw-sugg .nw-grow strong{white-space:normal}
.nw-sugg-btns{display:flex;gap:6px;flex:none}
.nw-invite{display:flex;gap:8px;align-items:center;background:var(--neyo-surface-soft,#f5f5f5);border-radius:12px;padding:10px 12px;margin-bottom:10px}
.nw-invite code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}
.nw-chip{display:none;align-items:center;gap:8px;margin:0 auto 8px;width:fit-content;max-width:90%;padding:6px 8px 6px 12px;border-radius:999px;background:var(--neyo-surface-soft,#f2f2f2);border:1px solid var(--neyo-border,rgba(0,0,0,.08));font:500 12.5px var(--neyo-font-text,Inter,sans-serif);color:var(--neyo-text,#171717)}
.nw-chip.show{display:flex}
.nw-chip span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.nw-chip button{border:0;background:transparent;color:inherit;opacity:.6;cursor:pointer;font-size:15px;line-height:1;padding:0 4px}
.nw-chip button:hover{opacity:1}
.nw-modal{position:absolute;inset:0;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:5}
.nw-modal-box{width:min(520px,92%);max-height:86%;overflow:auto;background:var(--neyo-surface,#fff);border-radius:18px;padding:20px;box-shadow:0 18px 50px rgba(0,0,0,.2)}
.nw-modal-box h3{margin:0 0 12px;font:600 17px var(--neyo-font-display,Sora,sans-serif)}
.nw-modal-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap}
.nw-two{display:flex;gap:8px;flex-wrap:wrap}
.nw-two > *{flex:1;min-width:120px;max-width:none}
.nw-comment{padding:8px 0;border-bottom:1px solid var(--neyo-border,rgba(0,0,0,.06));font-size:13px;line-height:1.5}
.nw-comment b{font-weight:600}
.nw-comment small{color:var(--neyo-text-muted,#9b9b9b);font-size:11px;margin-left:6px}
.nw-back{display:none}
.nw-chat-card{margin-top:10px;border:1px solid var(--neyo-border,rgba(0,0,0,.1));border-radius:14px;padding:10px 12px;font:13px var(--neyo-font-text,Inter,sans-serif);max-width:560px;background:var(--neyo-surface,#fff)}
.nw-chat-card h5{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--neyo-text-secondary,#737373)}
.nw-chat-item{display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--neyo-border,rgba(0,0,0,.06))}
.nw-chat-item .nw-grow strong{font-size:13px;white-space:normal}
.nw-chat-item.done{opacity:.6}
.nw-chat-foot{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}
.ws-save-msg-btn{font-size:15px}
body.dark-mode .nw-badge.owner{background:#fff;color:#111}
body.dark-mode .nw-badge.decision{background:#3a2f12;color:#f5c451}
body.dark-mode .nw-badge.ai{background:#2e1f52;color:#c4b5fd}
body.dark-mode .nw-badge.doing{background:#16284a;color:#8db4ff}
body.dark-mode .nw-badge.done{background:#123522;color:#6ee7a0}
body.dark-mode .nw-badge.high{background:#3b2210;color:#fdba74}
body.dark-mode .nw-badge.urgent{background:#3f1515;color:#fca5a5}
body.dark-mode .nw-badge.low{background:#1f2933;color:#a3b1c2}
@media (max-width:820px){
 .nw-panel{width:100vw;height:100dvh;border-radius:0}
 .nw-side{width:100%;border-right:0}
 .nw-panel.detail .nw-side{display:none}
 .nw-panel:not(.detail) .nw-main{display:none}
 .nw-back{display:inline-flex}
 .nw-stats{grid-template-columns:repeat(2,1fr)}
 .nw-head{flex-wrap:wrap}
 .nw-actions{justify-content:flex-start;width:100%}
 .nw-bar{flex-direction:column;align-items:stretch;gap:6px}
 .nw-search{width:100%;box-sizing:border-box}
 .nw-row{flex-wrap:wrap}
 .nw-head{position:relative;padding-right:52px}
 .nw-head > .nw-x{position:absolute;top:16px;right:14px}
 .nw-sugg{flex-wrap:wrap}
 .nw-sugg .nw-grow{flex-basis:calc(100% - 80px)}
 .nw-sugg-btns{width:100%;justify-content:flex-end}
 .nw-stats{grid-template-columns:repeat(3,1fr)}
 .nw-stat{padding:10px}
 .nw-stat b{font-size:18px}
}`

  /* ---------------- DOM ---------------- */

  let overlay, panel, side, main;

  function build() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    overlay = document.createElement("div");
    overlay.className = "nw-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="nw-panel" role="dialog" aria-label="Workspaces">
        <aside class="nw-side">
          <div class="nw-side-head"><h2>Workspaces</h2><button class="nw-x" data-nw="close" aria-label="Close">×</button></div>
          <div class="nw-list" id="nwList"></div>
          <button class="nw-new" data-nw="new">+ New workspace</button>
        </aside>
        <section class="nw-main" id="nwMain"></section>
        <input type="file" id="nwFile" multiple hidden>
      </div>`;
    document.body.appendChild(overlay);
    panel = overlay.querySelector(".nw-panel");
    side = overlay.querySelector("#nwList");
    main = overlay.querySelector("#nwMain");

    overlay.addEventListener("click", onClick);
    overlay.addEventListener("change", onChange);
    overlay.addEventListener("input", event => {
      if (event.target.id === "nwSearch") {
        state.query = event.target.value;
        const body = main.querySelector(".nw-body");
        if (body) body.innerHTML = renderTab();
      }
    });
    overlay.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (panel.querySelector(".nw-modal")) closeModal();
        else closePanel();
      }
      if (event.key === "Enter" && event.target.matches("input[data-enter]")) {
        event.preventDefault();
        overlay.querySelector(`[data-nw="${event.target.dataset.enter}"]`)?.click();
      }
    });
    overlay.addEventListener("mousedown", event => {
      if (event.target === overlay) closePanel();
    });

    addSidebarButton();
    addChip();
    watchMessages();
    document.addEventListener("click", onDocumentClick);
    window.addEventListener("neyo:workspace-suggestions", onSuggestions);
    checkJoinLink();
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
    chip.querySelector("span").textContent = active ? `🗂️ ${active.name} · NEYO knows this project` : "";
  }

  /* ---------------- join by invite link ---------------- */

  async function checkJoinLink() {
    let token = null;
    try {
      const url = new URL(window.location.href);
      token = url.searchParams.get("join");
      if (token) {
        localStorage.setItem(JOIN_KEY, token);
        url.searchParams.delete("join");
        history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
      } else {
        token = localStorage.getItem(JOIN_KEY);
      }
    } catch {}
    if (!token) return;
    try {
      const data = await api("POST", { action: "join", token });
      localStorage.removeItem(JOIN_KEY);
      setCurrent(data);
      writeActive({ id: data.workspace.id, name: data.workspace.name });
      toast(data.joined ? `You joined "${data.workspace.name}".` : `You're already in "${data.workspace.name}".`);
      openPanel(data.workspace.id);
    } catch (error) {
      if (error.status === 401) return; // try again after login
      localStorage.removeItem(JOIN_KEY);
      toast(error.message, "error");
    }
  }

  /* ---------------- open / load ---------------- */

  async function loadList() {
    const data = await api("GET");
    state.list = data.workspaces || [];
    renderSide();
  }

  async function openPanel(id) {
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    renderSide();
    if (!state.current) main.innerHTML = `<div class="nw-empty">Loading…</div>`;
    try {
      await loadList();
      const pick = id || state.current?.workspace?.id || readActive()?.id || state.list[0]?.id;
      if (pick && state.list.some(w => w.id === pick)) await select(pick);
      else {
        state.current = null;
        renderMain();
      }
    } catch (error) {
      main.innerHTML = `<div class="nw-head"><div class="nw-head-text"></div><button class="nw-x" data-nw="close" aria-label="Close">×</button></div><div class="nw-empty"><strong>Workspaces couldn't load</strong>${esc(error.message)}</div>`;
    }
  }

  function closePanel() {
    closeModal();
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
  }

  async function select(id, tab) {
    try {
      const data = await api("GET", null, `&id=${encodeURIComponent(id)}`);
      if (state.current?.workspace?.id !== id) {
        state.query = "";
        state.lastInvite = null;
      }
      setCurrent(data);
      if (tab) state.tab = tab;
      panel.classList.add("detail");
      renderSide();
      renderMain();
    } catch (error) {
      if (error.status === 404) {
        state.list = state.list.filter(w => w.id !== id);
        if (readActive()?.id === id) writeActive(null);
        renderSide();
      }
      toast(error.message, "error");
    }
  }

  function setCurrent(data) {
    state.current = data;
    const w = data.workspace;
    const me = data.me?.id;
    const entry = state.list.find(x => x.id === w.id);
    const summary = {
      id: w.id,
      name: w.name,
      role: w.role,
      members: data.members.length,
      myOpenTasks: data.items.filter(i => i.kind === "task" && i.status !== "done" && i.assignee?.id === me).length,
      pending: (data.suggestions || []).length
    };
    if (entry) Object.assign(entry, summary);
    else state.list.unshift(summary);
    const active = readActive();
    if (active?.id === w.id && active.name !== w.name) writeActive({ id: w.id, name: w.name });
  }

  async function act(body, okMessage) {
    if (state.busy) return null;
    state.busy = true;
    try {
      const data = await api("POST", { id: state.current?.workspace?.id, ...body });
      if (data.workspace) {
        setCurrent(data);
        renderSide();
        renderMain();
      }
      if (okMessage) toast(typeof okMessage === "function" ? okMessage(data) : okMessage);
      return data;
    } catch (error) {
      toast(error.message, "error");
      return null;
    } finally {
      state.busy = false;
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
          <span class="nw-ws-text"><strong>${activeId === w.id ? "● " : ""}${esc(w.name)}</strong>
          <small>${w.members} member${w.members === 1 ? "" : "s"} · ${esc(w.role)}</small></span>
          ${w.pending ? `<span class="nw-pill amber" title="Waiting for approval">${w.pending}</span>` : ""}
          ${w.myOpenTasks ? `<span class="nw-pill" title="Your open tasks">${w.myOpenTasks}</span>` : ""}
        </button>`
      )
      .join("");
  }

  function renderMain() {
    const data = state.current;
    if (!data) {
      main.innerHTML = `<div class="nw-head"><div class="nw-head-text"></div><button class="nw-x" data-nw="close" aria-label="Close">×</button></div>
        <div class="nw-empty"><strong>One place for a whole project</strong>
        Bring your team in with their Bean ID or an invite link. Keep tasks, decisions, notes and files together,<br>
        and NEYO knows the project in every chat. Each workspace also gets its own Bean group.<br><br>
        <button class="nw-btn primary" data-nw="new">+ Create your first workspace</button></div>`;
      return;
    }
    const { workspace: w, members, items, suggestions } = data;
    const count = (...kinds) => items.filter(i => kinds.includes(i.kind)).length;
    const using = readActive()?.id === w.id;
    const tabs = [
      ["overview", "Overview", ""],
      ["tasks", "Tasks", count("task")],
      ["notes", "Notes & decisions", count("note", "decision", "ai")],
      ["files", "Files", count("file")],
      ["members", "Members", members.length],
      ["approvals", "Approvals", suggestions.length],
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
          <button class="nw-btn" data-nw="bean">💬 Bean chat</button>
          ${can("admin") ? `<button class="nw-btn" data-nw="tab" data-tab="members" data-focus="invite">+ Invite</button><button class="nw-btn" data-nw="edit">Edit</button>` : ""}
        </div>
        <button class="nw-x" data-nw="close" aria-label="Close">×</button>
      </div>
      <div class="nw-bar">
        <nav class="nw-tabs">${tabs
          .map(([id, label, n]) => `<button class="nw-tab ${state.tab === id ? "active" : ""}" data-nw="tab" data-tab="${id}">${label}${n !== "" ? `<span class="nw-count ${id === "approvals" && n ? "hot" : ""}">${n}</span>` : ""}</button>`)
          .join("")}</nav>
        <input class="nw-search" id="nwSearch" type="search" placeholder="Search workspace…" value="${esc(state.query)}" autocomplete="off">
      </div>
      <div class="nw-body">${renderTab()}</div>`;
  }

  function renderTab() {
    switch (state.tab) {
      case "tasks":
        return tasksTab();
      case "notes":
        return notesTab();
      case "files":
        return filesTab();
      case "members":
        return membersTab();
      case "approvals":
        return approvalsTab();
      case "activity":
        return activityTab();
      default:
        return state.query ? searchResults() : overview();
    }
  }

  function searchResults() {
    const hits = state.current.items.filter(i => matches(i.title, i.body, i.assignee?.name));
    const people = state.current.members.filter(m => matches(m.name, m.beanId));
    if (!hits.length && !people.length) return `<div class="nw-empty">Nothing matches "${esc(state.query)}".</div>`;
    return `${people.length ? `<span class="nw-label">People</span>${people.map(memberRow).join("")}` : ""}
      ${hits.length ? `<span class="nw-label">Items</span>${hits.map(i => (i.kind === "task" ? taskRow(i) : i.kind === "file" ? fileRow(i) : noteCard(i))).join("")}` : ""}`;
  }

  function overview() {
    const { workspace: w, members, items, activity, suggestions, me } = state.current;
    const tasks = items.filter(i => i.kind === "task");
    const open = tasks.filter(t => t.status !== "done");
    const late = open.filter(t => t.overdue);
    const mine = open.filter(t => t.assignee?.id === me?.id).sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")));
    const done = tasks.length - open.length;
    const online = members.filter(m => m.online).length;
    return `
      <div class="nw-stats">
        <button class="nw-stat" data-nw="tab" data-tab="members"><b>${members.length}</b><span>Members${online ? ` · ${online} online` : ""}</span></button>
        <button class="nw-stat" data-nw="tab" data-tab="tasks"><b>${open.length}</b><span>Open tasks${tasks.length ? ` · ${Math.round((done / tasks.length) * 100)}% done` : ""}</span></button>
        <button class="nw-stat" data-nw="filter" data-filter="overdue"><b class="${late.length ? "late" : ""}">${late.length}</b><span>Overdue</span></button>
        <button class="nw-stat" data-nw="tab" data-tab="notes"><b>${items.filter(i => i.kind === "decision").length}</b><span>Decisions</span></button>
        <button class="nw-stat" data-nw="tab" data-tab="files"><b>${items.filter(i => i.kind === "file").length}</b><span>Files</span></button>
      </div>
      ${
        suggestions.length
          ? `<span class="nw-label">Waiting for approval <button class="nw-btn small" data-nw="tab" data-tab="approvals">Review ${suggestions.length}</button></span>
             ${suggestions.slice(0, 3).map(suggestionRow).join("")}`
          : ""
      }
      <span class="nw-label">Your tasks</span>
      ${mine.length ? mine.slice(0, 6).map(taskRow).join("") : `<div class="nw-hint" style="margin:0">Nothing assigned to you. 🎉</div>`}
      <span class="nw-label">Instructions for NEYO</span>
      ${
        can("admin")
          ? `<div class="nw-hint">NEYO follows these whenever this workspace is used in chat. Example: "Client ke liye formal English, prices PKR mein."</div>
             <textarea class="nw-area" id="nwInstr" maxlength="3000" placeholder="How should NEYO work on this project?">${esc(w.instructions)}</textarea>
             <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="nw-btn primary" data-nw="save-instr">Save</button></div>`
          : `<div class="nw-card"><p style="margin:0">${esc(w.instructions || "No instructions yet.")}</p></div>`
      }
      <span class="nw-label">Recent activity <button class="nw-btn small" data-nw="tab" data-tab="activity">See all</button></span>
      ${activity.length ? activity.slice(0, 6).map(actRow).join("") : `<div class="nw-hint">Nothing yet.</div>`}`;
  }

  /* members */

  function memberRow(m) {
    const myRole = state.current.workspace.role;
    const manage = can("admin") && m.role !== "owner" && !(myRole === "admin" && m.role === "admin" && !m.you) && state.tab === "members";
    const openTasks = state.current.items.filter(i => i.kind === "task" && i.status !== "done" && i.assignee?.id === m.id).length;
    return `<div class="nw-row">
      <div class="nw-av ${m.online ? "on" : ""}">${esc(initials(m.name))}</div>
      <div class="nw-grow"><strong>${esc(m.name)}${m.you ? " (you)" : ""}</strong>
        <small><span>@${esc(m.beanId)}</span><span>${m.online ? "online" : m.lastSeen ? `seen ${ago(m.lastSeen)}` : "offline"}</span>${openTasks ? `<span>${openTasks} open task${openTasks === 1 ? "" : "s"}</span>` : ""}</small></div>
      ${
        manage
          ? `<select class="nw-select" data-nw="role" data-user="${esc(m.id)}">${["admin", "member", "viewer"]
              .map(r => `<option value="${r}" ${m.role === r ? "selected" : ""}>${r[0].toUpperCase() + r.slice(1)}</option>`)
              .join("")}${myRole === "owner" ? `<option value="owner">Make owner…</option>` : ""}</select>
             <button class="nw-del" data-nw="remove-member" data-user="${esc(m.id)}" title="Remove">×</button>`
          : `<span class="nw-badge ${m.role}">${esc(m.role)}</span>`
      }
    </div>`;
  }

  function membersTab() {
    const { members, invites = [], workspace } = state.current;
    const list = members.filter(m => matches(m.name, m.beanId, m.role));
    const liveInvites = invites.filter(v => !v.expired);
    return `
      ${
        can("admin")
          ? `<div class="nw-form">
              <input class="nw-input" id="nwBeanId" placeholder="Add by Bean ID, e.g. ali or @ali" data-enter="add-member" autocomplete="off">
              <select class="nw-select" id="nwRole"><option value="member">Member</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select>
              <button class="nw-btn primary" data-nw="add-member">Add</button>
            </div>
            <div class="nw-hint">Admin: manage people. Member: add and edit work. Viewer: can only look. Everyone also joins the Bean group.</div>
            <span class="nw-label" id="nwInviteLabel">Invite link</span>
            ${
              state.lastInvite
                ? `<div class="nw-invite"><code>${esc(state.lastInvite)}</code><button class="nw-btn small primary" data-nw="copy-invite">Copy</button></div>
                   <div class="nw-hint">Send this link on Bean or anywhere. It works for 7 days, up to 25 people. Anyone with a Bean ID who opens it joins.</div>`
                : ""
            }
            <div class="nw-form">
              <select class="nw-select" id="nwInviteRole"><option value="member">Join as Member</option><option value="viewer">Join as Viewer</option><option value="admin">Join as Admin</option></select>
              <button class="nw-btn" data-nw="create-invite">Create invite link</button>
              ${liveInvites.length ? `<small class="nw-hint" style="margin:0">${liveInvites.length} active link${liveInvites.length === 1 ? "" : "s"}</small>` : ""}
            </div>
            ${liveInvites
              .map(
                v => `<div class="nw-row"><div class="nw-grow"><strong style="font-weight:500">Link · joins as ${esc(v.role)}</strong><small><span>${v.uses}/${v.maxUses} used</span><span>expires ${new Date(v.expiresAt).toLocaleDateString()}</span></small></div>
                  <button class="nw-btn small danger" data-nw="revoke-invite" data-invite="${esc(v.id)}">Turn off</button></div>`
              )
              .join("")}
            <span class="nw-label">Members · ${members.length}</span>`
          : ""
      }
      ${list.map(memberRow).join("") || `<div class="nw-hint">No one matches.</div>`}
      ${workspace.role !== "owner" ? `<div style="margin-top:18px"><button class="nw-btn danger" data-nw="leave">Leave workspace</button></div>` : ""}`;
  }

  /* tasks */

  function assigneeOptions(selected) {
    return `<option value="">Unassigned</option>` +
      state.current.members
        .filter(m => m.role !== "viewer")
        .map(m => `<option value="${esc(m.id)}" ${selected === m.id ? "selected" : ""}>${esc(m.you ? `${m.name} (you)` : m.name)}</option>`)
        .join("");
  }

  function taskRow(t) {
    const doneNow = t.status === "done";
    return `<div class="nw-row">
      <button class="nw-check ${doneNow ? "on" : ""}" data-nw="toggle-task" data-item="${esc(t.id)}" ${can("member") ? "" : "disabled"} title="${doneNow ? "Mark not done" : "Mark done"}">${doneNow ? "✓" : ""}</button>
      <button class="nw-link nw-grow" data-nw="open-item" data-item="${esc(t.id)}">
        <strong style="${doneNow ? "text-decoration:line-through;opacity:.55" : ""}">${esc(t.title)}</strong>
        <small>
          ${t.status === "doing" ? `<span class="nw-badge doing">In progress</span>` : ""}
          ${t.priority !== "normal" ? `<span class="nw-badge ${t.priority}">${t.priority}</span>` : ""}
          ${doneNow ? "" : dueLabel(t.due, t.overdue)}
          <span>${t.assignee ? `→ ${esc(t.assignee.name)}` : "Unassigned"}</span>
          ${t.comments.length ? `<span>💬 ${t.comments.length}</span>` : ""}
        </small>
      </button>
      ${
        can("member")
          ? `<select class="nw-select" data-nw="task-status" data-item="${esc(t.id)}" aria-label="Status">${[["todo", "To do"], ["doing", "In progress"], ["done", "Done"]]
              .map(([v, l]) => `<option value="${v}" ${v === t.status ? "selected" : ""}>${l}</option>`)
              .join("")}</select>`
          : ""
      }
    </div>`;
  }

  function tasksTab() {
    const me = state.current.me?.id;
    let tasks = state.current.items.filter(i => i.kind === "task" && matches(i.title, i.body, i.assignee?.name));
    if (state.taskFilter === "mine") tasks = tasks.filter(t => t.assignee?.id === me);
    if (state.taskFilter === "overdue") tasks = tasks.filter(t => t.overdue);
    const pr = { urgent: 0, high: 1, normal: 2, low: 3 };
    const sort = list => list.sort((a, b) => (pr[a.priority] - pr[b.priority]) || String(a.due || "9999").localeCompare(String(b.due || "9999")));
    const groups = [
      ["doing", "In progress"],
      ["todo", "To do"],
      ["done", "Done"]
    ];
    return `
      ${
        can("member")
          ? `<div class="nw-form">
              <input class="nw-input" id="nwTaskTitle" placeholder="New task, e.g. Garden quotation prepare karni hai" maxlength="200" data-enter="add-task">
              <select class="nw-select" id="nwTaskWho" aria-label="Assign to">${assigneeOptions("")}</select>
              <input class="nw-input" type="date" id="nwTaskDue" aria-label="Due date">
              <select class="nw-select" id="nwTaskPri" aria-label="Priority"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></select>
              <button class="nw-btn primary" data-nw="add-task">Add</button>
            </div>`
          : ""
      }
      <div class="nw-seg" style="margin-bottom:6px">
        ${[["all", "All"], ["mine", "Mine"], ["overdue", "Overdue"]]
          .map(([v, l]) => `<button data-nw="filter" data-filter="${v}" class="${state.taskFilter === v ? "active" : ""}">${l}</button>`)
          .join("")}
      </div>
      ${
        tasks.length
          ? groups
              .map(([status, label]) => {
                const list = sort(tasks.filter(t => t.status === status));
                if (!list.length) return "";
                return `<div class="nw-group"><h4>${label} <span class="nw-badge ${status}">${list.length}</span></h4>${list.map(taskRow).join("")}</div>`;
              })
              .join("")
          : `<div class="nw-empty">${state.query || state.taskFilter !== "all" ? "No tasks here." : "No tasks yet. Add one, or ask NEYO in chat: \"Is project ke tasks plan karo\"."}</div>`
      }`;
  }

  /* notes */

  function noteCard(n) {
    return `<div class="nw-card">
      <div class="nw-card-top"><span class="nw-badge ${n.kind}">${n.kind === "ai" ? "NEYO" : n.kind}</span>
        <button class="nw-link" data-nw="open-item" data-item="${esc(n.id)}"><strong>${esc(n.title)}</strong></button>
        ${n.comments.length ? `<small style="margin:0">💬 ${n.comments.length}</small>` : ""}
      </div>
      ${n.body ? `<p>${esc(n.body)}</p>` : ""}
      <small>${esc(n.createdBy)} · ${ago(n.createdAt)}</small>
    </div>`;
  }

  function notesTab() {
    const list = state.current.items.filter(i => ["note", "decision", "ai"].includes(i.kind) && matches(i.title, i.body));
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
      ${list.length ? list.map(noteCard).join("") : `<div class="nw-empty">${state.query ? "Nothing matches." : "No notes or decisions yet. NEYO remembers every decision saved here. Tip: use the 🗂️ button under a NEYO answer to save it."}</div>`}`;
  }

  /* files */

  function fileRow(f) {
    const readable = f.textChars > 0;
    return `<div class="nw-row">
      <div class="nw-av">${fileIcon(f.title, f.file?.type)}</div>
      <button class="nw-link nw-grow" data-nw="open-item" data-item="${esc(f.id)}"><strong>${esc(f.title)}</strong>
        <small><span>${size(f.file?.size || 0)}</span><span>${esc(f.createdBy)}</span><span>${ago(f.createdAt)}</span><span>${readable ? "NEYO can read" : "stored only"}</span>${f.comments.length ? `<span>💬 ${f.comments.length}</span>` : ""}</small></button>
      ${f.file?.stored ? `<button class="nw-btn small" data-nw="download" data-item="${esc(f.id)}">Open</button>` : ""}
    </div>`;
  }

  function filesTab() {
    const files = state.current.items.filter(i => i.kind === "file" && matches(i.title));
    return `
      ${
        can("member")
          ? `<div class="nw-form"><button class="nw-btn primary" data-nw="pick-file">+ Add files</button><span class="nw-hint" id="nwUploadStatus" style="margin:0"></span></div>
             <div class="nw-hint">PDF, Word, Excel, CSV, PowerPoint, text and code: NEYO reads them as project knowledge. Photos and other files are stored for the team. Up to 25 MB each.</div>`
          : ""
      }
      ${files.length ? files.map(fileRow).join("") : `<div class="nw-empty">${state.query ? "Nothing matches." : "No files yet."}</div>`}`;
  }

  /* approvals */

  function suggestionText(s) {
    const bits = [];
    if (s.type === "task") {
      if (s.assignee) bits.push(`→ @${esc(s.assignee)}`);
      if (s.due) bits.push(`📅 ${esc(s.due)}`);
      if (s.priority && s.priority !== "normal") bits.push(esc(s.priority));
    }
    return bits.join(" · ");
  }

  function suggestionRow(s) {
    const mineToDecide = s.requestedById === state.current.me?.id || can("admin");
    return `<div class="nw-sugg">
      <span class="nw-badge ${s.type === "decision" ? "decision" : s.type === "note" ? "" : "doing"}">${s.type}</span>
      <div class="nw-grow"><strong>${esc(s.title)}</strong>
        <small>${suggestionText(s) ? `<span>${suggestionText(s)}</span>` : ""}<span>NEYO for ${esc(s.requestedBy)} · ${ago(s.at)}</span></small>
        ${s.body ? `<div class="nw-hint" style="margin:6px 0 0">${esc(s.body.slice(0, 300))}</div>` : ""}</div>
      ${
        mineToDecide && can("member")
          ? `<div class="nw-sugg-btns"><button class="nw-btn small ok" data-nw="approve" data-sugg="${esc(s.id)}">Approve</button><button class="nw-btn small danger" data-nw="reject" data-sugg="${esc(s.id)}">Reject</button></div>`
          : `<small class="nw-hint" style="margin:0">waiting</small>`
      }
    </div>`;
  }

  function approvalsTab() {
    const list = state.current.suggestions.filter(s => matches(s.title, s.body));
    return `
      <div class="nw-hint">NEYO never changes the workspace on its own. When you ask it in chat to plan tasks, record a decision or save a note, it suggests them here, and they're added only when you approve.</div>
      ${list.length > 1 && can("member") ? `<div class="nw-form"><button class="nw-btn primary" data-nw="approve-all">Approve all ${list.length}</button><button class="nw-btn danger" data-nw="reject-all">Reject all</button></div>` : ""}
      ${list.length ? list.map(suggestionRow).join("") : `<div class="nw-empty">Nothing waiting. Try in chat: "Is project ke liye agle hafte ke tasks plan karo aur Ali ko assign karo."</div>`}`;
  }

  /* activity */

  function actRow(a) {
    return `<div class="nw-act"><time>${ago(a.at)}</time><div><b>${esc(a.who)}</b> ${esc(a.action)}${a.detail ? `: ${esc(a.detail)}` : ""}</div></div>`;
  }

  function activityTab() {
    const list = state.current.activity.filter(a => matches(a.who, a.action, a.detail));
    return list.length ? list.map(actRow).join("") : `<div class="nw-empty">No activity yet.</div>`;
  }

  /* ---------------- modals ---------------- */

  let modalItemId = null;

  function modal(html) {
    closeModal();
    const box = document.createElement("div");
    box.className = "nw-modal";
    box.innerHTML = `<div class="nw-modal-box">${html}</div>`;
    box.addEventListener("mousedown", event => {
      if (event.target === box) closeModal();
    });
    panel.appendChild(box);
    setTimeout(() => box.querySelector("[autofocus],input:not([type=date]),textarea")?.focus(), 30);
  }

  function closeModal() {
    modalItemId = null;
    panel?.querySelector(".nw-modal")?.remove();
  }

  function newModal() {
    modal(`<h3>New workspace</h3>
      <div class="nw-stack">
        <input class="nw-input" id="nwNewName" maxlength="80" placeholder="Name, e.g. Ideal Garden Project" data-enter="create">
        <textarea class="nw-area" id="nwNewDesc" maxlength="2000" placeholder="What is this project about? (optional, NEYO reads it)"></textarea>
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

  function itemModal(id) {
    const item = state.current.items.find(i => i.id === id);
    if (!item) return closeModal();
    modalItemId = id;
    const editable = can("member") && item.kind !== "file";
    const canDelete = can("admin") || item.createdById === state.current.me?.id;
    const comments = item.comments
      .map(
        c => `<div class="nw-comment"><b>${esc(c.who)}</b><small>${ago(c.at)}</small>
          ${c.userId === state.current.me?.id || can("admin") ? `<button class="nw-del" style="float:right;font-size:14px" data-nw="delete-comment" data-comment="${esc(c.id)}" title="Delete">×</button>` : ""}
          <div style="white-space:pre-wrap">${esc(c.body)}</div></div>`
      )
      .join("");
    modal(`<h3>${item.kind === "file" ? `${fileIcon(item.title, item.file?.type)} ` : ""}${esc(item.kind === "ai" ? "Saved NEYO answer" : item.kind[0].toUpperCase() + item.kind.slice(1))}</h3>
      <div class="nw-stack">
        ${
          editable
            ? `<input class="nw-input" id="nwItemTitle" maxlength="200" value="${esc(item.title)}">
               <textarea class="nw-area" id="nwItemBody" maxlength="8000" placeholder="Details">${esc(item.body)}</textarea>`
            : `<strong>${esc(item.title)}</strong>${item.body ? `<div style="white-space:pre-wrap;font-size:13px;line-height:1.55;max-height:260px;overflow:auto">${esc(item.body)}</div>` : ""}`
        }
        ${
          item.kind === "task" && can("member")
            ? `<div class="nw-two">
                 <select class="nw-select" id="nwItemWho">${assigneeOptions(item.assignee?.id)}</select>
                 <input class="nw-input" type="date" id="nwItemDue" value="${esc(item.due || "")}">
                 <select class="nw-select" id="nwItemPri">${["low", "normal", "high", "urgent"].map(p => `<option value="${p}" ${item.priority === p ? "selected" : ""}>${p[0].toUpperCase() + p.slice(1)}</option>`).join("")}</select>
               </div>`
            : ""
        }
        ${item.kind === "file" ? `<div class="nw-hint" style="margin:0">${size(item.file?.size || 0)} · ${item.textChars ? "NEYO can read this file" : "Stored for the team (NEYO can't read its text)"}</div>` : ""}
        <div class="nw-hint" style="margin:0">Added by ${esc(item.createdBy)} · ${ago(item.createdAt)}</div>
      </div>
      <span class="nw-label">Comments · ${item.comments.length}</span>
      ${comments || `<div class="nw-hint">No comments yet.</div>`}
      ${
        can("member")
          ? `<div class="nw-form" style="margin-top:10px"><input class="nw-input" id="nwComment" maxlength="2000" placeholder="Write a comment…" data-enter="add-comment"><button class="nw-btn" data-nw="add-comment">Send</button></div>`
          : ""
      }
      <div class="nw-modal-foot" style="justify-content:space-between">
        ${canDelete && can("member") ? `<button class="nw-btn danger" data-nw="delete-item" data-item="${esc(item.id)}">Delete</button>` : "<span></span>"}
        <span style="display:flex;gap:8px">
          ${item.kind === "file" && item.file?.stored ? `<button class="nw-btn" data-nw="download" data-item="${esc(item.id)}">Open file</button>` : ""}
          <button class="nw-btn" data-nw="modal-close">Close</button>
          ${editable || (item.kind === "task" && can("member")) ? `<button class="nw-btn primary" data-nw="save-item">Save</button>` : ""}
        </span>
      </div>`);
  }

  /* ---------------- file upload (same storage as chat files) ---------------- */

  async function uploadFile(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const sessionRes = await fetch(UPLOAD_API, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, mime: file.type || "application/octet-stream", extension: ext, category: "workspace" })
    });
    const session = await sessionRes.json().catch(() => ({}));
    if (!sessionRes.ok || !session.signedUrl) throw new Error(session.error || "Upload couldn't start.");
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file, file.name);
    const put = await fetch(session.signedUrl, { method: "PUT", headers: { "x-upsert": "false" }, body: form });
    if (!put.ok) throw new Error("Upload failed.");
    return { path: session.path, name: file.name, size: file.size, mime: file.type || "", extension: ext };
  }

  async function addFiles(files) {
    const status = () => overlay.querySelector("#nwUploadStatus");
    let i = 0;
    for (const file of files) {
      i += 1;
      if (file.size > MAX_UPLOAD) {
        toast(`${file.name} is too big (max 25 MB).`, "error");
        continue;
      }
      if (status()) status().textContent = `Uploading ${i}/${files.length}: ${file.name}…`;
      try {
        const up = await uploadFile(file);
        if (status()) status().textContent = `Reading ${file.name}…`;
        const data = await api("POST", { action: "add_file", id: state.current.workspace.id, ...up });
        setCurrent(data);
        renderSide();
        renderMain();
        toast(`${file.name} ${data.fileNote || "saved"}.`);
      } catch (error) {
        toast(`${file.name}: ${error.message}`, "error");
      }
    }
    if (status()) status().textContent = "";
  }

  /* ---------------- events ---------------- */

  const val = id => String(overlay.querySelector(`#${id}`)?.value || "").trim();

  async function onClick(event) {
    const el = event.target.closest("[data-nw]");
    if (!el || el.tagName === "SELECT" || el.tagName === "INPUT") return;
    const what = el.dataset.nw;

    if (what === "close") return closePanel();
    if (what === "back") return panel.classList.remove("detail");
    if (what === "new") return newModal();
    if (what === "modal-close") return closeModal();
    if (what === "select") {
      state.tab = "overview";
      state.taskFilter = "all";
      return select(el.dataset.id);
    }

    if (what === "create") {
      const name = val("nwNewName");
      if (!name) return toast("Give the workspace a name.", "error");
      el.disabled = true;
      try {
        const data = await api("POST", { action: "create", name, description: val("nwNewDesc") });
        closeModal();
        setCurrent(data);
        state.tab = "members";
        state.query = "";
        writeActive({ id: data.workspace.id, name: data.workspace.name });
        panel.classList.add("detail");
        renderSide();
        renderMain();
        toast("Workspace created. Add your team by Bean ID or invite link.");
      } catch (error) {
        toast(error.message, "error");
        el.disabled = false;
      }
      return;
    }

    if (!state.current) return;
    const w = state.current.workspace;

    switch (what) {
      case "tab":
        state.tab = el.dataset.tab;
        renderMain();
        if (el.dataset.focus === "invite") overlay.querySelector("#nwInviteLabel")?.scrollIntoView({ block: "start" });
        break;
      case "filter":
        state.tab = "tasks";
        state.taskFilter = el.dataset.filter;
        renderMain();
        break;
      case "note-kind":
        state.noteKind = el.dataset.kind;
        renderMain();
        break;
      case "use":
        if (readActive()?.id === w.id) {
          writeActive(null);
          toast("NEYO stopped using this workspace in chat.");
          renderSide();
          renderMain();
        } else {
          writeActive({ id: w.id, name: w.name });
          toast(`NEYO will use "${w.name}" in your chats.`);
          closePanel();
        }
        break;
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
      case "create-invite": {
        const data = await act({ action: "create_invite", role: val("nwInviteRole") || "member" });
        if (data?.inviteUrl) {
          state.lastInvite = data.inviteUrl;
          renderMain();
          copy(data.inviteUrl, "Invite link copied.");
        }
        break;
      }
      case "copy-invite":
        copy(state.lastInvite, "Invite link copied.");
        break;
      case "revoke-invite":
        if (await act({ action: "revoke_invite", inviteId: el.dataset.invite }, "Link turned off.")) state.lastInvite = null;
        renderMain();
        break;
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
        await act({ action: "add_item", kind: "task", title, assigneeId: val("nwTaskWho") || null, due: val("nwTaskDue") || null, priority: val("nwTaskPri") || "normal" });
        overlay.querySelector("#nwTaskTitle")?.focus();
        break;
      }
      case "toggle-task": {
        const t = state.current.items.find(i => i.id === el.dataset.item);
        if (t) await act({ action: "update_item", itemId: t.id, status: t.status === "done" ? "todo" : "done" });
        break;
      }
      case "add-note": {
        const title = val("nwNoteTitle");
        if (!title) return toast("Write a title.", "error");
        await act({ action: "add_item", kind: state.noteKind, title, body: val("nwNoteBody") }, state.noteKind === "decision" ? "Decision saved." : "Note saved.");
        break;
      }
      case "open-item":
        itemModal(el.dataset.item);
        break;
      case "save-item": {
        const item = state.current.items.find(i => i.id === modalItemId);
        if (!item) return closeModal();
        const patch = { action: "update_item", itemId: item.id };
        if (item.kind !== "file") {
          patch.title = val("nwItemTitle");
          patch.body = val("nwItemBody");
        }
        if (item.kind === "task") {
          patch.assigneeId = val("nwItemWho") || null;
          patch.due = val("nwItemDue") || null;
          patch.priority = val("nwItemPri") || "normal";
        }
        if (await act(patch, "Saved.")) closeModal();
        break;
      }
      case "delete-item": {
        const item = state.current.items.find(i => i.id === el.dataset.item);
        if (!confirm(`Delete "${item?.title || "this item"}"?`)) return;
        if (await act({ action: "delete_item", itemId: el.dataset.item }, "Deleted.")) closeModal();
        break;
      }
      case "add-comment": {
        const body = val("nwComment");
        if (!body || !modalItemId) return;
        const id = modalItemId;
        if (await act({ action: "add_comment", itemId: id, body })) itemModal(id);
        break;
      }
      case "delete-comment": {
        const id = modalItemId;
        if (await act({ action: "delete_comment", commentId: el.dataset.comment })) itemModal(id);
        break;
      }
      case "pick-file":
        overlay.querySelector("#nwFile")?.click();
        break;
      case "download": {
        const tab = window.open("about:blank", "_blank");
        try {
          const data = await api("POST", { action: "file_url", id: w.id, itemId: el.dataset.item });
          if (tab) tab.location.href = data.url;
          else window.location.href = data.url;
        } catch (error) {
          if (tab) tab.close();
          toast(error.message, "error");
        }
        break;
      }
      case "approve":
      case "reject":
        await act(
          { action: "decide", suggestionId: el.dataset.sugg, decision: what },
          what === "approve" ? "Approved and added." : "Rejected."
        );
        break;
      case "approve-all":
      case "reject-all": {
        const ids = state.current.suggestions.map(s => s.id);
        await act(
          { action: "decide", suggestionIds: ids, decision: what === "approve-all" ? "approve" : "reject" },
          data => (what === "approve-all" ? `${data.made || 0} added.` : "All rejected.")
        );
        break;
      }
    }
  }

  async function onChange(event) {
    const el = event.target;
    if (el.id === "nwFile") {
      const files = [...(el.files || [])].slice(0, 10);
      el.value = "";
      if (files.length && state.current) await addFiles(files);
      return;
    }
    const what = el.dataset?.nw;
    if (what === "role") {
      if (el.value === "owner") {
        const m = state.current.members.find(x => x.id === el.dataset.user);
        if (!confirm(`Make ${m?.name || "this member"} the owner? You'll become an admin.`)) return renderMain();
        await act({ action: "transfer_owner", userId: el.dataset.user }, "Ownership transferred.");
        return;
      }
      await act({ action: "set_role", userId: el.dataset.user, role: el.value }, "Role updated.");
    }
    if (what === "task-status") await act({ action: "update_item", itemId: el.dataset.item, status: el.value });
  }

  function copy(textValue, message) {
    if (!textValue) return;
    const done = () => toast(message);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(textValue).then(done, () => prompt("Copy this link:", textValue));
    else prompt("Copy this link:", textValue);
  }

  /* ---------------- in chat: suggestions + save answer ---------------- */

  function onSuggestions(event) {
    const info = event.detail || {};
    const list = Array.isArray(info.suggestions) ? info.suggestions : [];
    if (!info.id || !list.length) return;
    setTimeout(() => {
      const answers = document.querySelectorAll(".message.assistant");
      const last = answers[answers.length - 1];
      if (!last) return;
      const host = last.querySelector(".message-content") || last;
      host.querySelector(".nw-chat-card")?.remove();
      const card = document.createElement("div");
      card.className = "nw-chat-card";
      card.dataset.ws = info.id;
      card.innerHTML = `<h5>🗂️ NEYO suggests for ${esc(readActive()?.id === info.id ? readActive().name : "the workspace")} · needs your approval</h5>
        ${list
          .map(
            s => `<div class="nw-chat-item" data-sugg="${esc(s.id)}">
              <span class="nw-badge ${s.type === "decision" ? "decision" : s.type === "note" ? "" : "doing"}">${esc(s.type)}</span>
              <div class="nw-grow"><strong>${esc(s.title)}</strong><small>${suggestionText(s)}</small></div>
              <button class="nw-btn small ok" data-nwchat="approve">Approve</button>
              <button class="nw-btn small danger" data-nwchat="reject">Reject</button>
            </div>`
          )
          .join("")}
        ${list.length > 1 ? `<div class="nw-chat-foot"><button class="nw-btn small primary" data-nwchat="approve-all">Approve all</button></div>` : ""}`;
      host.appendChild(card);
    }, 450);
  }

  async function decideFromChat(card, ids, decision) {
    const rows = ids.map(id => card.querySelector(`[data-sugg="${CSS.escape(id)}"]`)).filter(Boolean);
    rows.forEach(r => r.querySelectorAll("button").forEach(b => (b.disabled = true)));
    try {
      const data = await api("POST", { action: "decide", id: card.dataset.ws, suggestionIds: ids, decision });
      rows.forEach(r => {
        r.classList.add("done");
        r.querySelectorAll("button").forEach(b => b.remove());
        const tag = document.createElement("span");
        tag.className = `nw-badge ${decision === "approve" ? "done" : ""}`;
        tag.textContent = decision === "approve" ? "Added ✓" : "Rejected";
        r.appendChild(tag);
      });
      if (!card.querySelector(".nw-chat-item:not(.done)")) card.querySelector(".nw-chat-foot")?.remove();
      if (state.current?.workspace?.id === card.dataset.ws && data.workspace) setCurrent(data);
      toast(decision === "approve" ? `${data.made || ids.length} added to the workspace.` : "Rejected.");
    } catch (error) {
      rows.forEach(r => r.querySelectorAll("button").forEach(b => (b.disabled = false)));
      toast(error.message, "error");
    }
  }

  async function onDocumentClick(event) {
    const chatBtn = event.target.closest("[data-nwchat]");
    if (chatBtn) {
      const card = chatBtn.closest(".nw-chat-card");
      const what = chatBtn.dataset.nwchat;
      if (what === "approve-all") {
        const ids = [...card.querySelectorAll(".nw-chat-item:not(.done)")].map(r => r.dataset.sugg);
        if (ids.length) await decideFromChat(card, ids, "approve");
      } else {
        await decideFromChat(card, [chatBtn.closest(".nw-chat-item").dataset.sugg], what);
      }
      return;
    }
    const save = event.target.closest(".ws-save-msg-btn");
    if (save) {
      const active = readActive();
      const message = save.closest(".message");
      const content = message?.querySelector(".message-content");
      if (!active || !content) return;
      const clone = content.cloneNode(true);
      clone.querySelectorAll(".nw-chat-card,.neyo-memory-chip,.source-cards,button").forEach(n => n.remove());
      const body = (clone.innerText || "").trim().slice(0, 8000);
      if (!body) return;
      let question = "";
      let prev = message.previousElementSibling;
      while (prev && !prev.classList?.contains("user")) prev = prev.previousElementSibling;
      if (prev) question = (prev.querySelector(".message-content")?.innerText || "").trim();
      const title = (question || body.split("\n")[0]).replace(/\s+/g, " ").slice(0, 120) || "NEYO answer";
      save.disabled = true;
      try {
        await api("POST", { action: "add_item", id: active.id, kind: "ai", title, body });
        if (state.current?.workspace?.id === active.id) select(active.id);
        toast(`Saved to "${active.name}".`);
        save.title = "Saved to workspace";
      } catch (error) {
        save.disabled = false;
        toast(error.message, "error");
      }
    }
  }

  function addSaveButton(actions) {
    if (!actions || actions.querySelector(".ws-save-msg-btn")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "msg-action-btn ws-save-msg-btn";
    button.title = "Save to workspace";
    button.setAttribute("aria-label", "Save to workspace");
    button.textContent = "🗂️";
    actions.appendChild(button);
  }

  function refreshSaveButtons() {
    const on = Boolean(readActive());
    document.querySelectorAll(".message.assistant .message-actions").forEach(actions => {
      if (on) addSaveButton(actions);
      else actions.querySelector(".ws-save-msg-btn")?.remove();
    });
  }

  function watchMessages() {
    const host = document.getElementById("chatMessages");
    if (!host) return;
    let queued = false;
    new MutationObserver(() => {
      if (queued || !readActive()) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        refreshSaveButtons();
      });
    }).observe(host, { childList: true, subtree: true });
    refreshSaveButtons();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
