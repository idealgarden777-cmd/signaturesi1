/*
=========================================================
NEYO — UI KIT v1
Replaces the browser's own UI with NEYO's:
- every <select> gets a NEYO dropdown (the real select stays
  hidden underneath, so forms and existing code keep working)
- NeyoUI.confirm(): a NEYO dialog instead of window.confirm()
- NeyoUI.copy(): clipboard copy without a browser prompt
=========================================================
*/
(() => {
  "use strict";

  if (window.NeyoUI) return;

  const CHEVRON =
    '<svg class="nyx-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const CHECK =
    '<svg class="nyx-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  const enhanced = new WeakMap();
  let uid = 0;

  /* ---------------- keep label in sync when code sets .value ---------------- */

  function patchSetter(name) {
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, name);
    if (!desc?.set || desc.set.__nyx) return;
    const set = function (value) {
      desc.set.call(this, value);
      enhanced.get(this)?.refresh();
    };
    set.__nyx = true;
    Object.defineProperty(HTMLSelectElement.prototype, name, { ...desc, set });
  }
  patchSetter("value");
  patchSetter("selectedIndex");

  /* ---------------- one floating menu for the whole app ---------------- */

  let menu = null;
  let openFor = null;
  let activeIndex = -1;
  let typed = "";
  let typedTimer = null;

  function menuEl() {
    if (menu) return menu;
    menu = document.createElement("div");
    menu.className = "nyx-menu";
    menu.setAttribute("role", "listbox");
    menu.tabIndex = -1;
    menu.addEventListener("pointerdown", event => event.preventDefault());
    menu.addEventListener("click", event => {
      const opt = event.target.closest(".nyx-option");
      if (!opt || opt.getAttribute("aria-disabled") === "true") return;
      choose(Number(opt.dataset.index));
    });
    menu.addEventListener("pointermove", event => {
      const opt = event.target.closest(".nyx-option");
      if (opt) setActive(Number(opt.dataset.index), false);
    });
    document.body.appendChild(menu);
    return menu;
  }

  function options(select) {
    return Array.from(select.options);
  }

  function esc(text) {
    return String(text ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function place(trigger) {
    const r = trigger.getBoundingClientRect();
    const m = menuEl();
    m.style.minWidth = `${Math.max(r.width, 160)}px`;
    m.style.maxHeight = "";
    const h = Math.min(m.scrollHeight, 300);
    const below = window.innerHeight - r.bottom - 12;
    const up = below < h && r.top - 12 > below;
    const room = up ? r.top - 12 : below;
    m.style.maxHeight = `${Math.max(120, Math.min(300, room))}px`;
    const width = m.offsetWidth;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    m.style.left = `${Math.round(left)}px`;
    m.style.top = up ? "" : `${Math.round(r.bottom + 6)}px`;
    m.style.bottom = up ? `${Math.round(window.innerHeight - r.top + 6)}px` : "";
    m.dataset.side = up ? "top" : "bottom";
  }

  function setActive(index, scroll = true) {
    activeIndex = index;
    menu?.querySelectorAll(".nyx-option").forEach(el => {
      const on = Number(el.dataset.index) === index;
      el.classList.toggle("is-active", on);
      if (on) {
        menu.setAttribute("aria-activedescendant", el.id);
        if (scroll) el.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function open(select) {
    const data = enhanced.get(select);
    if (!data || select.disabled) return;
    if (openFor === select) return close();
    close(false);
    openFor = select;
    const m = menuEl();
    const list = options(select);
    m.innerHTML = list
      .map((o, i) => {
        const selected = i === select.selectedIndex;
        return `<div class="nyx-option${selected ? " is-selected" : ""}" role="option" id="nyx-opt-${data.id}-${i}" data-index="${i}" aria-selected="${selected}" aria-disabled="${o.disabled}"><span>${esc(o.textContent.trim())}</span>${CHECK}</div>`;
      })
      .join("");
    m.setAttribute("aria-labelledby", data.trigger.id);
    data.trigger.setAttribute("aria-expanded", "true");
    data.wrap.classList.add("is-open");
    m.classList.remove("is-open");
    place(data.trigger);
    void m.offsetWidth;
    m.classList.add("is-open");
    setActive(Math.max(0, select.selectedIndex));
  }

  function close(focus = true) {
    if (!openFor) return;
    const data = enhanced.get(openFor);
    openFor = null;
    activeIndex = -1;
    menu?.classList.remove("is-open");
    if (data) {
      data.trigger.setAttribute("aria-expanded", "false");
      data.wrap.classList.remove("is-open");
      if (focus) data.trigger.focus({ preventScroll: true });
    }
  }

  function choose(index) {
    const select = openFor;
    if (!select) return;
    const opt = select.options[index];
    if (!opt || opt.disabled) return;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    close();
    if (changed) {
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function move(step) {
    const list = options(openFor);
    let i = activeIndex;
    for (let n = 0; n < list.length; n++) {
      i = (i + step + list.length) % list.length;
      if (!list[i].disabled) return setActive(i);
    }
  }

  function typeAhead(key) {
    typed += key.toLowerCase();
    clearTimeout(typedTimer);
    typedTimer = setTimeout(() => (typed = ""), 600);
    const list = options(openFor);
    const hit = list.findIndex(o => !o.disabled && o.textContent.trim().toLowerCase().startsWith(typed));
    if (hit >= 0) setActive(hit);
  }

  document.addEventListener(
    "keydown",
    event => {
      const trigger = event.target.closest?.(".nyx-trigger");
      if (!openFor) {
        if (trigger && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
          event.preventDefault();
          open(trigger.parentElement.querySelector("select"));
        }
        return;
      }
      switch (event.key) {
        case "ArrowDown": event.preventDefault(); move(1); break;
        case "ArrowUp": event.preventDefault(); move(-1); break;
        case "Home": event.preventDefault(); setActive(0); break;
        case "End": event.preventDefault(); setActive(options(openFor).length - 1); break;
        case "Enter":
        case " ": event.preventDefault(); choose(activeIndex); break;
        case "Escape": event.preventDefault(); event.stopPropagation(); close(); break;
        case "Tab": close(false); break;
        default:
          if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) typeAhead(event.key);
      }
    },
    true
  );

  document.addEventListener(
    "pointerdown",
    event => {
      if (!openFor) return;
      if (menu?.contains(event.target)) return;
      if (enhanced.get(openFor)?.wrap.contains(event.target)) return;
      close(false);
    },
    true
  );
  window.addEventListener("resize", () => close(false));
  document.addEventListener(
    "scroll",
    event => {
      if (openFor && !menu?.contains(event.target)) close(false);
    },
    true
  );

  /* ---------------- enhance a select ---------------- */

  function enhance(select) {
    if (enhanced.has(select) || select.multiple || select.size > 1) return;
    if (select.closest(".message-content, .nyx-skip, [data-native-select]")) return;

    const id = ++uid;
    const wrap = document.createElement("span");
    wrap.className = "nyx-select";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = `nyx-trigger-${id}`;
    trigger.className = `nyx-trigger ${select.className}`.trim();
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const label = select.getAttribute("aria-label") || select.labels?.[0]?.textContent?.trim();
    if (label) trigger.setAttribute("aria-label", label);
    if (select.dataset.tooltip) trigger.dataset.tooltip = select.dataset.tooltip;
    trigger.innerHTML = `<span class="nyx-value"></span>${CHEVRON}`;

    if (select.style.width) wrap.style.width = select.style.width;
    if (select.style.flex) wrap.style.flex = select.style.flex;

    select.parentNode.insertBefore(wrap, select);
    wrap.append(trigger, select);
    select.classList.add("nyx-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const data = {
      id,
      wrap,
      trigger,
      refresh() {
        const opt = select.options[select.selectedIndex];
        trigger.querySelector(".nyx-value").textContent = opt ? opt.textContent.trim() : "";
        trigger.disabled = select.disabled;
      }
    };
    enhanced.set(select, data);
    trigger.addEventListener("click", () => open(select));
    select.addEventListener("change", () => data.refresh());
    new MutationObserver(() => data.refresh()).observe(select, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["disabled", "selected"]
    });
    data.refresh();
  }

  function scan(root) {
    if (root instanceof HTMLSelectElement) return enhance(root);
    root.querySelectorAll?.("select").forEach(enhance);
  }

  function start() {
    scan(document);
    new MutationObserver(mutations => {
      for (const m of mutations) {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1) scan(node);
        });
        if (openFor && !openFor.isConnected) close(false);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* ---------------- NEYO confirm dialog ---------------- */

  function confirmDialog(options = {}) {
    const opts = typeof options === "string" ? { text: options } : options;
    return new Promise(resolve => {
      const overlay = document.createElement("div");
      overlay.className = "neo-dialog-overlay nyx-dialog";
      overlay.setAttribute("role", "alertdialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.innerHTML = `<div class="neo-dialog-card">
        <h3>${esc(opts.title || "Are you sure?")}</h3>
        ${opts.text ? `<p class="nyx-dialog-text">${esc(opts.text)}</p>` : ""}
        <div class="neo-dialog-actions">
          <button type="button" class="neo-dialog-cancel">${esc(opts.cancelText || "Cancel")}</button>
          <button type="button" class="neo-dialog-confirm${opts.danger ? " nyx-danger" : ""}">${esc(opts.okText || "Confirm")}</button>
        </div>
      </div>`;
      const before = document.activeElement;
      const done = value => {
        overlay.classList.remove("show");
        document.removeEventListener("keydown", onKey, true);
        setTimeout(() => overlay.remove(), 160);
        try { before?.focus?.({ preventScroll: true }); } catch {}
        resolve(value);
      };
      const onKey = event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); done(false); }
        if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); done(true); }
      };
      overlay.addEventListener("click", event => {
        if (event.target === overlay) done(false);
      });
      overlay.querySelector(".neo-dialog-cancel").addEventListener("click", () => done(false));
      overlay.querySelector(".neo-dialog-confirm").addEventListener("click", () => done(true));
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => {
        overlay.classList.add("show");
        overlay.querySelector(opts.danger ? ".neo-dialog-cancel" : ".neo-dialog-confirm").focus({ preventScroll: true });
      });
    });
  }

  /* ---------------- copy without a browser prompt ---------------- */

  async function copy(text) {
    const value = String(text ?? "");
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {}
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    area.remove();
    return ok;
  }

  window.NeyoUI = { confirm: confirmDialog, copy, enhanceSelects: scan };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
