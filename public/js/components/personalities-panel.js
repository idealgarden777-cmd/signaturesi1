/*
=========================================================
NEYO — PERSONALITIES PANEL v2
Owns:
- Character cards (Neyo, Zadi, Wizi, Crony) in
  Settings > NEYO Personalities
- Character thinking indicator in chat (mini mascot +
  "Zadi is thinking")
- Keeps chat character, mascot and voice character
  in sync through localStorage + neyo:character-select
Storage:
- neo_default_personality  (character, read by neo.js
  and sent to /api/chat as `personality`)
=========================================================
*/
(() => {
  "use strict";

  const CHARACTER_KEY = "neo_default_personality";
  const CHARACTERS = ["neyo", "zadi", "wizi", "crony"];

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



  /* ---------------- character thinking indicator ---------------- */

  const NAMES = { neyo: "Neyo", zadi: "Zadi", wizi: "Wizi", crony: "Crony" };

  function buildMascot(id) {
    const mascot = document.createElement("span");
    mascot.className = "neyo-thinking-mascot personality-mascot";
    mascot.dataset.character = id;
    mascot.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 2; i += 1) {
      const eye = document.createElement("span");
      eye.className = "personality-mascot-eye";
      mascot.appendChild(eye);
    }
    return mascot;
  }

  function decorateThinking(message) {
    if (!message || message.dataset.characterThinking === "1") {
      return;
    }
    const content = message.querySelector(".message-content");
    if (!content) {
      return;
    }

    const id = getCharacter();
    const name = NAMES[id] || "Neyo";
    message.dataset.characterThinking = "1";
    message.dataset.character = id;

    const row = document.createElement("span");
    row.className = "neyo-character-thinking";
    row.setAttribute("aria-label", `${name} is thinking`);

    const label = document.createElement("span");
    label.className = "neyo-character-thinking-label";
    label.textContent = `${name} is thinking`;

    const dots = document.createElement("span");
    dots.className = "neyo-character-thinking-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i += 1) {
      dots.appendChild(document.createElement("i"));
    }

    row.append(buildMascot(id), label, dots);
    content.replaceChildren(row);
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) {
      return;
    }
    if (root.matches?.(".message.assistant.is-thinking")) {
      decorateThinking(root);
    }
    root
      .querySelectorAll?.(".message.assistant.is-thinking")
      .forEach(decorateThinking);
  }

  function watchThinking() {
    const target = document.getElementById("chatMessages") || document.body;
    scan(target);
    try {
      new MutationObserver(records => {
        records.forEach(record => record.addedNodes.forEach(scan));
      }).observe(target, { childList: true, subtree: true });
    } catch {}
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
    watchThinking();

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
    selectCharacter: id => selectCharacter(String(id || "").toLowerCase())
  });
})();
