/*
=========================================================
NEYO — SETTINGS > MEMORY v1
See, search, add, edit and forget what NEYO remembers.
- One memory for every personality (Neyo, Zadi, Wizi, Crony)
- On/off switch (this browser): off = NEYO neither reads nor saves
- API: /api/history?resource=memory
=========================================================
*/
(() => {
  "use strict";

  const API = "/api/history?resource=memory";
  const OFF_KEY = "neyo_memory_off";

  const state = { items: [], max: 200, loaded: false, loading: false, error: "", query: "", filter: "all", editing: null, open: new Set() };

  const KINDS = {
    you: { label: "From you", tip: "You told NEYO to remember this" },
    learned: { label: "Learned", tip: "NEYO picked this up from your chats" },
    saved: { label: "Saved text", tip: "Code or text NEYO saved to reuse later" }
  };

  const ICON = {
    edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    brain: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 3A2.5 2.5 0 0 0 7 5.5v.3A3 3 0 0 0 4.5 9a3 3 0 0 0 .6 4.8A3 3 0 0 0 8 18.5 2.5 2.5 0 0 0 12 20V5a2 2 0 0 0-2.5-2Z"/><path d="M14.5 3A2.5 2.5 0 0 1 17 5.5v.3A3 3 0 0 1 19.5 9a3 3 0 0 1-.6 4.8 3 3 0 0 1-2.9 4.7A2.5 2.5 0 0 1 12 20"/></svg>'
  };

  const esc = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const isOff = () => {
    try { return localStorage.getItem(OFF_KEY) === "1"; } catch { return false; }
  };

  function toast(message, type = "success") {
    const api = window.NeyoNotifications;
    try {
      if (api && typeof api[type] === "function") return api[type](message);
    } catch {}
    window.dispatchEvent(new CustomEvent(`neyo:notification-${type}`, { detail: { message } }));
  }

  function ago(iso) {
    const t = new Date(iso).getTime();
    if (!t) return "";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
    return new Date(t).toLocaleDateString();
  }

  const nice = key => String(key).replace(/^(user|auto)_/, "").replace(/_/g, " ").trim() || "note";

  async function api(method, body) {
    const response = await fetch(API, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(response.status === 401 ? "Log in to see what NEYO remembers." : data.error || "Something went wrong. Please try again.");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  /* ---------------- styles ---------------- */

  const style = document.createElement("style");
  style.textContent = `
.nm{display:flex;flex-direction:column;gap:18px;padding-bottom:12px}
.nm-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--neyo-border,rgba(0,0,0,.08))}
.nm-row strong{display:block;font-size:14px;font-weight:600}
.nm-row small{display:block;margin-top:3px;font-size:12.5px;color:var(--neyo-text-secondary,#737373);line-height:1.45}
.nm-add{display:flex;gap:8px}
.nm-input{flex:1;min-width:0;height:40px;box-sizing:border-box;padding:0 12px;border-radius:12px;border:1px solid var(--neyo-border-strong,rgba(0,0,0,.14));background:var(--neyo-surface,#fff);color:inherit;font:inherit;font-size:14px;transition:border-color 180ms var(--neyo-ease,ease),box-shadow 180ms var(--neyo-ease,ease)}
.nm .nm-input:focus,.nm .nm-input:focus-visible,.nm-edit textarea:focus-visible{outline:none!important;}
.nm-input:focus{outline:none;border-color:var(--neyo-text-secondary,#737373);box-shadow:0 0 0 3px var(--neyo-select,rgba(0,0,0,.08))}
.nm-btn{height:40px;padding:0 16px;border-radius:999px;border:1px solid var(--neyo-border-strong,rgba(0,0,0,.14));background:transparent;color:inherit;font:inherit;font-size:13.5px;font-weight:500;cursor:pointer;white-space:nowrap}
.nm-btn:hover{background:var(--neyo-surface-hover,#f1f1f1)}
.nm-btn.primary{background:var(--neyo-text,#171717);border-color:var(--neyo-text,#171717);color:var(--neyo-surface,#fff)}
.nm-btn.primary:hover{opacity:.88}
.nm-btn:disabled{opacity:.45;cursor:default}
.nm-btn.danger{color:#c2410c;border-color:rgba(194,65,12,.3)}
.nm-btn.danger:hover{background:rgba(194,65,12,.07)}
.nm-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.nm-search{position:relative;flex:1;min-width:180px}
.nm-search svg{position:absolute;left:12px;top:50%;translate:0 -50%;color:var(--neyo-text-muted,#9b9b9b);pointer-events:none}
.nm-search .nm-input{width:100%;padding-left:34px;height:36px}
.nm-seg{display:inline-flex;padding:3px;border-radius:999px;background:var(--neyo-surface-soft,#f5f5f5);gap:2px}
.nm-seg button{white-space:nowrap;height:30px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:var(--neyo-text-secondary,#737373);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer}
.nm-seg button.on{background:var(--neyo-surface,#fff);color:var(--neyo-text,#171717);box-shadow:0 1px 2px rgba(0,0,0,.06),0 1px 6px rgba(0,0,0,.04)}
body.dark-mode .nm-seg{background:rgba(255,255,255,.06)}
body.dark-mode .nm-seg button.on{background:rgba(255,255,255,.12);color:#f5f5f5}
.nm-meta{font-size:12px;color:var(--neyo-text-muted,#9b9b9b)}
.nm-list{display:flex;flex-direction:column}
.nm-item{display:flex;gap:12px;align-items:flex-start;padding:12px 4px;border-bottom:1px solid var(--neyo-border,rgba(0,0,0,.06));animation:neyoRise 260ms var(--neyo-ease-out,ease) both}
.nm-item:last-child{border-bottom:0}
.nm-body{flex:1;min-width:0}
.nm-text{font-size:14px;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap}
.nm-code{margin:6px 0 0;padding:10px 12px;max-height:220px;overflow:auto;border-radius:10px;background:var(--neyo-surface-soft,#f5f5f5);font-family:var(--neyo-font-code,monospace);font-size:12px;line-height:1.5;white-space:pre}
body.dark-mode .nm-code{background:rgba(255,255,255,.05)}
.nm-sub{display:flex;align-items:center;gap:8px;margin-top:4px;font-size:12px;color:var(--neyo-text-muted,#9b9b9b)}
.nm-tag{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;background:var(--neyo-surface-soft,#f5f5f5);color:var(--neyo-text-secondary,#737373);font-size:11.5px;font-weight:500}
.nm-tag.you{background:rgba(23,23,23,.08);color:var(--neyo-text,#171717)}
body.dark-mode .nm-tag{background:rgba(255,255,255,.07)}
body.dark-mode .nm-tag.you{background:rgba(255,255,255,.14);color:#f5f5f5}
.nm-link{border:0;background:none;padding:0;color:inherit;font:inherit;font-size:12px;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.nm-acts{display:flex;gap:2px;opacity:.55;transition:opacity 180ms var(--neyo-ease,ease)}
.nm-item:hover .nm-acts,.nm-acts:focus-within{opacity:1}
@media (hover:none){.nm-acts{opacity:1}}
.nm-icon{width:32px;height:32px;display:grid;place-items:center;border:0;border-radius:9px;background:transparent;color:var(--neyo-text-secondary,#737373);cursor:pointer}
.nm-icon:hover{background:var(--neyo-surface-hover,#f1f1f1);color:var(--neyo-text,#171717)}
.nm-icon.del:hover{color:#c2410c;background:rgba(194,65,12,.08)}
.nm-edit{display:flex;flex-direction:column;gap:8px}
.nm-edit textarea{width:100%;box-sizing:border-box;min-height:84px;padding:10px 12px;border-radius:12px;border:1px solid var(--neyo-border-strong,rgba(0,0,0,.14));background:var(--neyo-surface,#fff);color:inherit;font:inherit;font-size:14px;line-height:1.5;resize:vertical}
.nm-edit textarea:focus{outline:none;border-color:var(--neyo-text-secondary,#737373);box-shadow:0 0 0 3px var(--neyo-select,rgba(0,0,0,.08))}
.nm-edit div{display:flex;gap:8px;justify-content:flex-end}
.nm-edit .nm-btn{height:34px}
.nm-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:36px 16px;text-align:center;color:var(--neyo-text-secondary,#737373);font-size:13.5px;line-height:1.5}
.nm-empty strong{color:var(--neyo-text,#171717);font-size:14.5px;font-weight:600}
.nm-skel{height:52px;border-radius:12px;margin:6px 0;background:linear-gradient(90deg,var(--neyo-surface-soft,#f5f5f5) 0%,var(--neyo-surface-hover,#ececec) 50%,var(--neyo-surface-soft,#f5f5f5) 100%);background-size:200% 100%;animation:nmShimmer 1.2s linear infinite}
body.dark-mode .nm-skel{background:linear-gradient(90deg,rgba(255,255,255,.04) 0%,rgba(255,255,255,.08) 50%,rgba(255,255,255,.04) 100%);background-size:200% 100%}
@keyframes nmShimmer{from{background-position:200% 0}to{background-position:-200% 0}}
.nm-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:6px}
.nm.is-off .nm-list,.nm.is-off .nm-tools{opacity:.5}
@media (max-width:640px){.nm-add{flex-direction:column}.nm-add .nm-input{flex:none;width:100%}.nm-add .nm-btn{width:100%}.nm-seg button{padding:0 8px}.nm-tools{flex-direction:column;align-items:stretch}.nm-seg{justify-content:space-between}.nm-seg button{flex:1}}
`;
  document.head.appendChild(style);

  /* ---------------- render ---------------- */

  let root = null;

  function mount() {
    const panel = document.getElementById("settingsPanelMemory");
    if (!panel) return null;
    if (root && panel.contains(root)) return root;
    panel.querySelector(".neo-settings-placeholder")?.remove();
    root = document.createElement("div");
    root.className = "nm";
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("keydown", onKey);
    panel.appendChild(root);
    return root;
  }

  function visible() {
    const q = state.query.trim().toLowerCase();
    return state.items.filter(item =>
      (state.filter === "all" || item.kind === state.filter) &&
      (!q || `${nice(item.key)} ${item.value}`.toLowerCase().includes(q))
    );
  }

  function itemHtml(item) {
    const kind = KINDS[item.kind] || KINDS.learned;
    if (state.editing === item.key) {
      return `<div class="nm-item" data-key="${esc(item.key)}"><div class="nm-body nm-edit">
        <textarea data-nm="edit-text" maxlength="8000" aria-label="Edit memory">${esc(item.value)}</textarea>
        <div><button class="nm-btn" type="button" data-nm="cancel">Cancel</button><button class="nm-btn primary" type="button" data-nm="save-edit">Save</button></div>
      </div></div>`;
    }
    const long = item.kind === "saved" && (item.lines > 1 || item.value.length > 160);
    const open = state.open.has(item.key);
    const body = long
      ? `<div class="nm-text">${esc(nice(item.key))}</div>${open ? `<pre class="nm-code">${esc(item.value)}</pre>` : ""}`
      : `<div class="nm-text">${esc(item.value)}</div>`;
    return `<div class="nm-item" data-key="${esc(item.key)}">
      <div class="nm-body">${body}
        <div class="nm-sub"><span class="nm-tag ${item.kind}" data-tooltip="${esc(kind.tip)}">${kind.label}</span>
          ${long ? `<span>${item.lines} ${item.lines === 1 ? "line" : "lines"}</span><button class="nm-link" type="button" data-nm="toggle">${open ? "Hide" : "Show"}</button>` : ""}
          <span>${esc(ago(item.updatedAt))}</span></div>
      </div>
      <div class="nm-acts">
        <button class="nm-icon" type="button" data-nm="edit" data-tooltip="Edit" aria-label="Edit memory">${ICON.edit}</button>
        <button class="nm-icon del" type="button" data-nm="delete" data-tooltip="Forget this" aria-label="Forget this memory">${ICON.trash}</button>
      </div>
    </div>`;
  }

  function listHtml() {
    if (state.loading && !state.loaded) return '<div class="nm-skel"></div><div class="nm-skel"></div><div class="nm-skel"></div>';
    if (state.error) return `<div class="nm-empty">${ICON.brain}<strong>${esc(state.error)}</strong>${state.errorStatus === 401 ? "" : '<button class="nm-btn" type="button" data-nm="retry">Try again</button>'}</div>`;
    if (!state.items.length) {
      return `<div class="nm-empty">${ICON.brain}<strong>Nothing remembered yet</strong><span>Tell NEYO in any chat, like “yaad rakho mera naam Ali hai”, or add something here.</span></div>`;
    }
    const rows = visible();
    if (!rows.length) return '<div class="nm-empty"><span>No memories match.</span></div>';
    return rows.map(itemHtml).join("");
  }

  function render({ listOnly = false } = {}) {
    if (!mount()) return;
    const off = isOff();
    root.classList.toggle("is-off", off);
    if (listOnly && root.querySelector(".nm-list")) {
      root.querySelector(".nm-list").innerHTML = listHtml();
      const meta = root.querySelector(".nm-meta");
      if (meta) meta.textContent = metaText();
      return;
    }
    const counts = { all: state.items.length };
    state.items.forEach(i => (counts[i.kind] = (counts[i.kind] || 0) + 1));
    root.innerHTML = `
      <div class="nm-row">
        <div><strong>Use memory</strong><small>${off ? "Off. NEYO won't read or save memories in new chats." : "NEYO remembers useful things across chats. Neyo, Zadi, Wizi and Crony all share this memory."}</small></div>
        <button class="settings-toggle${off ? "" : " active"}" type="button" role="switch" aria-checked="${!off}" aria-label="Use memory" data-nm="switch"><span></span></button>
      </div>
      <div class="nm-add">
        <input class="nm-input" data-nm="new" maxlength="500" placeholder="Tell NEYO something to remember…" aria-label="New memory">
        <button class="nm-btn primary" type="button" data-nm="add" disabled>Remember</button>
      </div>
      <div class="nm-tools">
        <label class="nm-search">${ICON.search}<input class="nm-input" data-nm="search" placeholder="Search memories" aria-label="Search memories" value="${esc(state.query)}"></label>
        <div class="nm-seg" role="tablist" aria-label="Filter memories">
          ${[["all", "All"], ["you", "From you"], ["learned", "Learned"], ["saved", "Saved text"]]
            .map(([id, label]) => `<button type="button" role="tab" aria-selected="${state.filter === id}" class="${state.filter === id ? "on" : ""}" data-nm="filter" data-filter="${id}">${label}</button>`)
            .join("")}
        </div>
      </div>
      <div class="nm-list" aria-live="polite">${listHtml()}</div>
      <div class="nm-foot"><span class="nm-meta">${metaText()}</span>
        ${state.items.length ? '<button class="nm-btn danger" type="button" data-nm="clear">Forget everything</button>' : ""}
      </div>`;
  }

  function metaText() {
    if (!state.loaded) return "";
    return `${state.items.length} ${state.items.length === 1 ? "memory" : "memories"} · keeps up to ${state.max}, oldest go first`;
  }

  /* ---------------- data ---------------- */

  async function load() {
    if (state.loading) return;
    state.loading = true;
    state.error = "";
    if (!state.loaded) render();
    try {
      const data = await api("GET");
      state.items = Array.isArray(data.items) ? data.items : [];
      state.max = data.max || 200;
      state.loaded = true;
    } catch (error) {
      state.error = error.message;
      state.errorStatus = error.status;
    } finally {
      state.loading = false;
      render();
    }
  }

  async function add() {
    const input = root.querySelector('[data-nm="new"]');
    const value = input.value.trim();
    if (!value) return;
    const button = root.querySelector('[data-nm="add"]');
    button.disabled = true;
    try {
      const data = await api("POST", { action: "save", value });
      state.items = [data.item, ...state.items.filter(i => i.key !== data.item.key)];
      input.value = "";
      toast("Remembered.");
      render();
      root.querySelector('[data-nm="new"]')?.focus();
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
    }
  }

  async function saveEdit(key) {
    const value = root.querySelector('[data-nm="edit-text"]')?.value.trim();
    if (!value) return;
    try {
      const data = await api("POST", { action: "save", key, value });
      state.items = [data.item, ...state.items.filter(i => i.key !== key)];
      state.editing = null;
      toast("Updated.");
      render({ listOnly: true });
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function remove(key) {
    const before = state.items;
    state.items = state.items.filter(i => i.key !== key);
    render({ listOnly: true });
    try {
      await api("POST", { action: "delete", key });
      toast("Forgotten.");
      if (!state.items.length) render();
    } catch (error) {
      state.items = before;
      render({ listOnly: true });
      toast(error.message, "error");
    }
  }

  async function clearAll() {
    const ok = window.NeyoUI?.confirm
      ? await window.NeyoUI.confirm({ title: "Forget everything?", text: `NEYO will forget all ${state.items.length} memories. This can't be undone.`, okText: "Forget all", danger: true })
      : window.confirm("Forget everything NEYO remembers?");
    if (!ok) return;
    try {
      await api("POST", { action: "clear" });
      state.items = [];
      toast("NEYO forgot everything.");
      render();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  /* ---------------- events ---------------- */

  function onClick(event) {
    const el = event.target.closest("[data-nm]");
    if (!el) return;
    const key = el.closest(".nm-item")?.dataset.key;
    switch (el.dataset.nm) {
      case "switch": {
        const off = !isOff();
        try { localStorage.setItem(OFF_KEY, off ? "1" : "0"); } catch {}
        toast(off ? "Memory is off." : "Memory is on.");
        render();
        break;
      }
      case "add": add(); break;
      case "filter": state.filter = el.dataset.filter; render(); break;
      case "toggle": state.open.has(key) ? state.open.delete(key) : state.open.add(key); render({ listOnly: true }); break;
      case "edit":
        state.editing = key;
        render({ listOnly: true });
        root.querySelector('[data-nm="edit-text"]')?.focus();
        break;
      case "cancel": state.editing = null; render({ listOnly: true }); break;
      case "save-edit": saveEdit(key); break;
      case "delete": remove(key); break;
      case "clear": clearAll(); break;
      case "retry": load(); break;
    }
  }

  function onInput(event) {
    const el = event.target;
    if (el.dataset.nm === "new") root.querySelector('[data-nm="add"]').disabled = !el.value.trim();
    if (el.dataset.nm === "search") {
      state.query = el.value;
      render({ listOnly: true });
    }
  }

  function onKey(event) {
    const el = event.target;
    if (event.key === "Enter" && el.dataset.nm === "new") { event.preventDefault(); add(); }
    if (el.dataset.nm === "edit-text") {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); saveEdit(el.closest(".nm-item").dataset.key); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); state.editing = null; render({ listOnly: true }); }
    }
  }

  // open the tab -> load (fresh every time it opens)
  function watch() {
    const panel = document.getElementById("settingsPanelMemory");
    if (!panel) return;
    const check = () => {
      if (panel.classList.contains("active")) load();
    };
    new MutationObserver(check).observe(panel, { attributes: true, attributeFilter: ["class"] });
    check();
  }

  // NEYO saved or forgot something in chat -> keep the list fresh
  window.addEventListener("neyo:memory", () => {
    if (state.loaded) load();
  });

  window.NeyoMemorySettings = { reload: load, isOff };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch, { once: true });
  else watch();
})();
