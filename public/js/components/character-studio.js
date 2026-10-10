/*
=========================================================
NEYO — CHARACTER STUDIO v1
- "Customize" card in Settings > Personalities: rename the
  character, change its colour and skin (saved per user,
  roster.js stores it, chat + voice use the new name)
- Voice mode: image characters replace the classic body,
  blink, follow the mascot's gaze and talk while speaking
- Voice character picker: shows the real characters
Needs window.NeyoRoster (public/js/characters/roster.js).
=========================================================
*/

(() => {
  "use strict";

  const R = window.NeyoRoster;
  if (!R || window.NeyoCharacterStudio) return;

  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  /* ---------------- shared: eyes follow + blink ---------------- */

  function lookAt(el, x, y) {
    const r = el.getBoundingClientRect();
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 180);
    el.style.setProperty("--ex", ((dx / d) * k).toFixed(3));
    el.style.setProperty("--ey", ((dy / d) * k).toFixed(3));
  }

  function blinkLoop(el) {
    if (reduce) return;
    const tick = () => {
      if (!el.isConnected) return;
      el.classList.add("is-blinking");
      setTimeout(() => el.classList.remove("is-blinking"), 120);
      if (Math.random() < 0.2) {
        setTimeout(() => {
          el.classList.add("is-blinking");
          setTimeout(() => el.classList.remove("is-blinking"), 110);
        }, 260);
      }
      setTimeout(tick, 1800 + Math.random() * 3600);
    };
    setTimeout(tick, 600 + Math.random() * 1600);
  }

  /* ---------------- Customize card ---------------- */

  let studio = null;

  function buildStudio() {
    const grid = document.getElementById("personalityCharacterGrid");
    if (!grid || document.getElementById("nrStudio")) return;

    studio = document.createElement("section");
    studio.className = "nr-studio";
    studio.id = "nrStudio";
    studio.innerHTML = `
      <div class="nr-studio-preview"><div class="nr-studio-stage"></div><span class="nr-studio-shadow"></span></div>
      <div class="nr-studio-controls">
        <div class="nr-studio-title"><strong>Customize</strong><small>Make your character yours. Only you see this.</small></div>
        <label class="nr-field"><span>Name</span><input type="text" maxlength="20" autocomplete="off" spellcheck="false"></label>
        <div class="nr-field"><span>Colour</span><div class="nr-swatches" role="radiogroup" aria-label="Colour"></div>
          <input class="nr-hue" type="range" min="0" max="359" step="1" aria-label="Fine colour"></div>
        <div class="nr-field"><span>Skin</span><div class="nr-skins" role="radiogroup" aria-label="Skin"></div></div>
        <button type="button" class="nr-reset">Reset to original</button>
      </div>`;
    grid.insertAdjacentElement("afterend", studio);

    const sw = studio.querySelector(".nr-swatches");
    for (const hue of R.colors) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "nr-swatch";
      b.dataset.hue = String(hue);
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", hue ? `Colour ${hue}` : "Original colour");
      sw.appendChild(b);
    }
    const sk = studio.querySelector(".nr-skins");
    for (const s of R.skins) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "nr-skin";
      b.dataset.skin = s.id;
      b.setAttribute("role", "radio");
      b.textContent = s.label;
      sk.appendChild(b);
    }

    const input = studio.querySelector("input[type=text]");
    const hue = studio.querySelector(".nr-hue");
    input.addEventListener("input", () => R.setCustom(R.current(), { name: input.value }));
    hue.addEventListener("input", () => R.setCustom(R.current(), { hue: +hue.value }));
    studio.addEventListener("click", e => {
      const s = e.target.closest(".nr-swatch");
      if (s) R.setCustom(R.current(), { hue: +s.dataset.hue });
      const k = e.target.closest(".nr-skin");
      if (k) R.setCustom(R.current(), { skin: k.dataset.skin });
      if (e.target.closest(".nr-reset")) R.resetCustom(R.current());
      if (s || k || e.target.closest(".nr-reset")) {
        const a = studio.querySelector(".nr-studio-stage .nr-avatar");
        if (a && !reduce) {
          a.classList.remove("is-pop");
          void a.offsetWidth;
          a.classList.add("is-pop");
        }
        syncStudio(false);
      }
    });

    studio.addEventListener("pointermove", e => {
      const a = studio.querySelector(".nr-studio-stage .nr-avatar");
      if (a && !reduce) lookAt(a, e.clientX, e.clientY);
    });
    studio.addEventListener("pointerleave", () => {
      const a = studio.querySelector(".nr-studio-stage .nr-avatar");
      a?.style.setProperty("--ex", "0");
      a?.style.setProperty("--ey", "0");
    });

    syncStudio(true);
  }

  function syncStudio(rebuildAvatar = true) {
    if (!studio) return;
    const id = R.current();
    const ch = R.get(id);
    const c = R.custom(id);
    const stage = studio.querySelector(".nr-studio-stage");
    if (rebuildAvatar || stage.firstElementChild?.dataset.character !== id) {
      const a = R.avatar(id, { size: 96 });
      a.classList.add("is-smiling");
      stage.replaceChildren(a);
      blinkLoop(a);
    }
    studio.querySelector(".nr-studio-preview").style.setProperty("--nr-studio-color", ch.color);
    const label = document.getElementById("settingsDefaultPersonalityValue");
    if (label) label.textContent = R.name(id);
    const input = studio.querySelector("input[type=text]");
    if (document.activeElement !== input) input.value = c.name;
    input.placeholder = ch.name;
    studio.querySelector(".nr-studio-title small").textContent =
      `Rename ${c.name || ch.name}, change colour and skin. Only you see this.`;
    const hue = studio.querySelector(".nr-hue");
    hue.value = String(c.hue);
    studio.querySelectorAll(".nr-swatch").forEach(b => {
      const on = +b.dataset.hue === c.hue;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", String(on));
      b.style.setProperty("--sw", ch.color);
      b.style.setProperty("--sw-filter", +b.dataset.hue ? `hue-rotate(${b.dataset.hue}deg)` : "none");
      if (ch.kind === "css" && +b.dataset.hue) b.style.setProperty("--sw", `hsl(${b.dataset.hue} 68% 58%)`), b.style.setProperty("--sw-filter", "none");
    });
    studio.querySelectorAll(".nr-skin").forEach(b => {
      const on = b.dataset.skin === c.skin;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", String(on));
    });
  }

  /* ---------------- voice mode mascot ---------------- */

  function syncVoice() {
    const m = document.getElementById("neyoMascot");
    if (!m) return;
    const id = String(m.dataset.character || "neyo");
    const ch = R.get(id);
    const isImage = ch?.kind === "image";
    let layer = m.querySelector(":scope > .nr-voice");
    if (!isImage) {
      if (m.dataset.kind) delete m.dataset.kind;
      layer?.remove();
      return;
    }
    m.dataset.kind = "image";
    if (!layer || layer.dataset.character !== id) {
      layer?.remove();
      layer = R.avatar(id, { size: 0, className: "nr-voice" });
      m.appendChild(layer);
      blinkLoop(layer);
    }
  }

  function watchVoice() {
    const m = document.getElementById("neyoMascot");
    if (!m) return;
    new MutationObserver(syncVoice).observe(m, { attributes: true, attributeFilter: ["data-character"] });
    syncVoice();
  }

  /* ---------------- voice character picker ---------------- */

  function syncPicker() {
    const list = document.getElementById("characterPickerList");
    if (!list) return;
    list.querySelectorAll("[data-character-id]").forEach(item => {
      const id = item.dataset.characterId;
      const ch = R.get(id);
      if (!ch) return;
      const prev = item.querySelector(".character-picker-preview");
      if (prev && ch.kind === "image" && !prev.querySelector(".nr-avatar")) {
        prev.classList.add("has-nr-avatar");
        prev.replaceChildren(R.avatar(id, { size: "100%" }));
      }
    });
  }

  function watchPicker() {
    const list = document.getElementById("characterPickerList");
    if (!list) return;
    new MutationObserver(syncPicker).observe(list, { childList: true, subtree: true });
    syncPicker();
  }

  /* ---------------- wiring ---------------- */

  function init() {
    buildStudio();
    watchVoice();
    watchPicker();
    window.addEventListener("neyo:character-select", () => setTimeout(() => syncStudio(true), 0));
    window.addEventListener("neyo:character-change", () => setTimeout(() => syncStudio(true), 0));
    window.addEventListener("neyo:character-custom", () => syncStudio(false));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.NeyoCharacterStudio = Object.freeze({ lookAt, blinkLoop, syncStudio });
})();
