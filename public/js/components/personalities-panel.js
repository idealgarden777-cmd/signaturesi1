/*
=========================================================
NEYO — PERSONALITIES PANEL v1
Owns:
- Character cards (Neyo, Zadi, Wizi, Crony) in
  Settings > NEYO Personalities
- Response style cards (Default, Teacher, Coder ...)
- Keeps chat character, mascot and voice character
  in sync through localStorage + neyo:character-select
Storage:
- neo_default_personality  (character, read by neo.js
  and sent to /api/chat as `personality`)
- neo_response_style       (sent to /api/chat as
  `responseStyle`)
=========================================================
*/
(() => {
  "use strict";

  const CHARACTER_KEY = "neo_default_personality";
  const STYLE_KEY = "neo_response_style";
  const CHARACTERS = ["neyo", "zadi", "wizi", "crony"];
  const STYLES = [
    "default",
    "teacher",
    "coder",
    "researcher",
    "business",
    "creative",
    "calm",
    "direct"
  ];

  const read = (key, fallback, allowed) => {
    try {
      const value = String(localStorage.getItem(key) || "").trim().toLowerCase();
      return allowed.includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };

  const write = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };

  const getCharacter = () => read(CHARACTER_KEY, "neyo", CHARACTERS);
  const getStyle = () => read(STYLE_KEY, "default", STYLES);

  const isPro = () => {
    const badge = document.getElementById("userPlanBadge");
    const text = String(badge?.textContent || "").toLowerCase();
    return Boolean(text) && !text.includes("free");
  };

  /* ---------------- UI sync ---------------- */

  function syncCharacterUi() {
    const current = getCharacter();

    document
      .querySelectorAll("[data-character-choice]")
      .forEach(card => {
        const active = card.dataset.characterChoice === current;
        card.classList.toggle("active", active);
        card.setAttribute("aria-pressed", String(active));
      });

    const label = document.getElementById("settingsDefaultPersonalityValue");
    if (label) {
      label.textContent = current.charAt(0).toUpperCase() + current.slice(1);
    }

    document
      .querySelectorAll("#settingsDefaultPersonalityMenu .settings-select-option")
      .forEach(option => {
        const active = option.dataset.value === current;
        option.classList.toggle("active", active);
        option.setAttribute("aria-selected", String(active));
      });
  }

  function syncStyleUi() {
    const current = getStyle();

    document
      .querySelectorAll("#personalityGrid [data-personality]")
      .forEach(card => {
        const active = card.dataset.personality === current;
        card.classList.toggle("active", active);
        card.setAttribute("aria-pressed", String(active));
      });
  }

  /* ---------------- actions ---------------- */

  let applying = false;

  function selectCharacter(id, { broadcast = true } = {}) {
    if (!CHARACTERS.includes(id)) {
      return;
    }

    write(CHARACTER_KEY, id);
    syncCharacterUi();

    if (broadcast) {
      applying = true;
      try {
        window.dispatchEvent(
          new CustomEvent("neyo:character-select", {
            detail: { id, source: "personalities-panel" }
          })
        );
      } catch {}
      applying = false;
    }
  }

  function selectStyle(id) {
    if (id === "custom") {
      if (!isPro()) {
        document.getElementById("settingsUpgradeBtn")?.click();
      }
      return;
    }

    if (!STYLES.includes(id)) {
      return;
    }

    write(STYLE_KEY, id);
    syncStyleUi();
  }

  /* ---------------- wiring ---------------- */

  function init() {
    document.addEventListener(
      "click",
      event => {
        const characterCard = event.target.closest?.("[data-character-choice]");
        if (characterCard) {
          event.preventDefault();
          selectCharacter(characterCard.dataset.characterChoice);
          return;
        }

        const styleCard = event.target.closest?.("#personalityGrid [data-personality]");
        if (styleCard) {
          event.preventDefault();
          selectStyle(styleCard.dataset.personality);
          return;
        }

        const settingsOption = event.target.closest?.(
          "#settingsDefaultPersonalityMenu .settings-select-option"
        );
        if (settingsOption) {
          // neo.js saves the value; we only mirror it to mascot + voice.
          const id = settingsOption.dataset.value;
          setTimeout(() => selectCharacter(id), 0);
          return;
        }

        if (event.target.closest?.("#sidebarPersonalitiesBtn, #personalMemoryBtn, [data-settings-tab='personalities']")) {
          setTimeout(() => {
            syncCharacterUi();
            syncStyleUi();
          }, 0);
        }
      },
      true
    );

    // Voice-mode character picker changed the character → remember it for chat too.
    window.addEventListener("neyo:character-change", event => {
      if (applying) {
        return;
      }
      const id = String(
        event.detail?.id || event.detail?.character?.id || event.detail?.character || ""
      ).toLowerCase();
      if (CHARACTERS.includes(id) && id !== getCharacter()) {
        selectCharacter(id, { broadcast: false });
      }
    });

    syncCharacterUi();
    syncStyleUi();

    // Start mascot + voice on the saved character once modules are ready.
    const restore = () => {
      const saved = getCharacter();
      if (saved !== "neyo") {
        selectCharacter(saved);
      }
    };

    if (document.readyState === "complete") {
      setTimeout(restore, 0);
    } else {
      window.addEventListener("load", () => setTimeout(restore, 0), { once: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.NeyoPersonalities = Object.freeze({
    getCharacter,
    getStyle,
    selectCharacter: id => selectCharacter(String(id || "").toLowerCase()),
    selectStyle: id => selectStyle(String(id || "").toLowerCase())
  });
})();
