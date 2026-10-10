/*
=========================================================
NEYO — PERSONALITIES PANEL v4
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
  const CHARACTERS = window.NeyoRoster?.ids || ["neyo", "zadi", "wizi", "crony"];

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
      label.textContent = window.NeyoRoster?.name?.(current) || current.charAt(0).toUpperCase() + current.slice(1);
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
  /*
   * Natural, non-looping thinking:
   * - the mascot picks a new small action at random moments
   *   (blink, glance, tilt, hop, squish, thought bubble), tuned per character
   * - the label follows what the backend is really doing
   *   (reading a link, reading a file, researching, thinking, writing)
   */

  const NAMES = { neyo: "Neyo", zadi: "Zadi", wizi: "Wizi", crony: "Crony" };

  const TEMPERAMENT = {
    neyo: { pace: 1.25, tilt: 5, hop: 2, hopChance: 0.12, glanceUp: 0.25, squish: 0.04 },
    zadi: { pace: 0.7, tilt: 9, hop: 6, hopChance: 0.38, glanceUp: 0.15, squish: 0.1 },
    wizi: { pace: 1.05, tilt: 10, hop: 3, hopChance: 0.14, glanceUp: 0.55, squish: 0.05 },
    crony: { pace: 0.85, tilt: 7, hop: 4, hopChance: 0.22, glanceUp: 0.2, squish: 0.16 }
  };

  const STAGE_TEXT = {
    thinking: "is thinking",
    pondering: "is working it out",
    almost: "is almost there",
    links: "is reading the link",
    files: "is reading your file",
    image: "is looking at your image",
    research: "is researching",
    planning: "is planning the research",
    searching: "is searching the web",
    reading: "is reading sources",
    verifying: "is fact-checking",
    reasoning: "is reasoning it through",
    checking: "is double-checking the maths",
    solving: "is solving the logic",
    analyzing: "is analyzing the code",
    mapping: "is mapping the ideas",
    reviewing: "is double-checking the answer",
    writing: "is writing"
  };

  let activeThinking = null;

  const rand = (min, max) => min + Math.random() * (max - min);
  const chance = p => Math.random() < p;

  function buildMascot(id) {
    if (window.NeyoRoster) {
      return window.NeyoRoster.avatar(id, { size: 24, className: "neyo-thinking-mascot personality-mascot" });
    }
    const mascot = document.createElement("span");
    mascot.className = "neyo-thinking-mascot personality-mascot";
    mascot.dataset.character = id;
    mascot.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 2; i += 1) {
      const eye = document.createElement("span");
      eye.className = "personality-mascot-eye";
      mascot.appendChild(eye);
    }
    const bubble = document.createElement("span");
    bubble.className = "neyo-thinking-bubble";
    mascot.appendChild(bubble);
    return mascot;
  }

  function startLife(mascot, id) {
    const t = TEMPERAMENT[id] || window.NeyoRoster?.get?.(id)?.temper || TEMPERAMENT.neyo;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const timers = new Set();
    const later = (fn, ms) => {
      const handle = setTimeout(() => {
        timers.delete(handle);
        if (mascot.isConnected) fn();
      }, ms);
      timers.add(handle);
    };

    const setBody = ({ x = 0, y = 0, r = 0, sx = 1, sy = 1 }, ms) => {
      mascot.style.transitionDuration = `${Math.round(ms)}ms`;
      mascot.style.transform =
        `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${r.toFixed(1)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
    };

    const setEyes = (x, y, blink = false) => {
      mascot.style.setProperty("--eye-x", `${x.toFixed(1)}px`);
      mascot.style.setProperty("--eye-y", `${y.toFixed(1)}px`);
      mascot.classList.toggle("is-blinking", blink);
    };

    const blink = (twice = false) => {
      mascot.classList.add("is-blinking");
      later(() => {
        mascot.classList.remove("is-blinking");
        if (twice) later(() => blink(false), rand(110, 170));
      }, rand(90, 140));
    };

    const glance = () => {
      if (chance(t.glanceUp)) {
        setEyes(rand(-1, 1.5), -2);
      } else {
        const side = chance(0.5) ? -1 : 1;
        setEyes(side * rand(1, 1.8), rand(-0.5, 0.8));
      }
    };

    const act = () => {
      const roll = Math.random();

      if (roll < t.hopChance) {
        // small hop with anticipation squash
        setBody({ y: 1, sx: 1 + t.squish, sy: 1 - t.squish }, 120 * t.pace);
        later(() => setBody({ y: -t.hop, sx: 1 - t.squish * 0.6, sy: 1 + t.squish * 0.6, r: rand(-t.tilt, t.tilt) * 0.4 }, 200 * t.pace), 120 * t.pace);
        later(() => setBody({ y: 0, sx: 1 + t.squish * 0.5, sy: 1 - t.squish * 0.5 }, 180 * t.pace), 340 * t.pace);
        later(() => setBody({}, 260 * t.pace), 540 * t.pace);
      } else if (roll < 0.45) {
        // pondering tilt + glance
        setBody({ r: rand(-t.tilt, t.tilt), y: rand(-1.5, 0.5) }, rand(380, 700) * t.pace);
        glance();
        if (chance(0.35)) mascot.classList.add("is-pondering");
        later(() => mascot.classList.remove("is-pondering"), rand(900, 1600));
      } else if (roll < 0.62) {
        blink(chance(0.3));
      } else if (roll < 0.78) {
        // look back to center, settle
        setEyes(0, 0);
        setBody({ r: rand(-2, 2), y: 0 }, rand(500, 800) * t.pace);
      } else if (roll < 0.9 && t.squish > 0.08) {
        // playful squish / wobble
        setBody({ sx: 1 + t.squish, sy: 1 - t.squish, r: rand(-4, 4) }, 160 * t.pace);
        later(() => setBody({ sx: 1 - t.squish * 0.5, sy: 1 + t.squish * 0.5 }, 200 * t.pace), 170 * t.pace);
        later(() => setBody({}, 300 * t.pace), 380 * t.pace);
      } else {
        // idea pop
        mascot.classList.add("has-idea");
        later(() => mascot.classList.remove("has-idea"), rand(700, 1100));
        setEyes(rand(-0.5, 0.5), -1.5);
      }

      // random small blinks between actions feel alive
      if (chance(0.25)) later(() => blink(false), rand(200, 600));

      later(act, rand(650, 1500) * t.pace);
    };

    if (!reduce) {
      later(act, rand(150, 450));
    }

    return () => timers.forEach(clearTimeout);
  }

  function stageText(stage, info = {}) {
    const count = Number(info.count) || 0;
    if (stage === "reading" && count > 0) {
      return `is reading ${count} ${count === 1 ? "source" : "sources"}`;
    }
    if (stage === "writing" && count > 0) {
      return `is writing from ${count} ${count === 1 ? "source" : "sources"}`;
    }
    return STAGE_TEXT[stage] || STAGE_TEXT.thinking;
  }

  function setStage(stage, info = {}) {
    if (!activeThinking || !activeThinking.label.isConnected) {
      return;
    }
    const text = `${activeThinking.name} ${stageText(stage, info)}`;
    if (!STAGE_TEXT[stage] || activeThinking.label.textContent === text) {
      return;
    }
    activeThinking.stage = stage;
    const { label } = activeThinking;
    label.classList.add("is-swapping");
    setTimeout(() => {
      label.textContent = text;
      label.classList.remove("is-swapping");
    }, 160);
  }

  function initialStageFor(detail = {}) {
    const attachments = Array.isArray(detail.attachments) ? detail.attachments : [];
    const text = String(detail.text || "");
    let deep = false;
    try {
      deep = Boolean(window.NeyoChat?.getPreferences?.()?.isDeepResearch);
    } catch {}

    if (deep) return "research";
    if (attachments.length) {
      const allImages = attachments.every(file =>
        String(file?.mime || file?.mimeType || file?.type || "").startsWith("image/")
      );
      return allImages ? "image" : "files";
    }
    if (/https?:\/\/\S+/i.test(text)) return "links";
    return "thinking";
  }

  let pendingStage = "thinking";

  function decorateThinking(message) {
    if (!message || message.dataset.characterThinking === "1") {
      return;
    }
    const content = message.querySelector(".message-content");
    if (!content) {
      return;
    }

    activeThinking?.stop?.();

    const id = getCharacter();
    const name = window.NeyoRoster?.name?.(id) || NAMES[id] || "Neyo";
    message.dataset.characterThinking = "1";
    message.dataset.character = id;

    const row = document.createElement("span");
    row.className = "neyo-character-thinking";
    row.setAttribute("role", "status");

    const label = document.createElement("span");
    label.className = "neyo-character-thinking-label";
    label.textContent = `${name} ${STAGE_TEXT[pendingStage] || STAGE_TEXT.thinking}`;

    const mascot = buildMascot(id);
    row.append(mascot, label);

    // Live thoughts (the model's own thinking, streamed while it works).
    const thought = document.createElement("span");
    thought.className = "neyo-character-thought";
    thought.hidden = true;

    const box = document.createElement("span");
    box.className = "neyo-character-thinking-box";
    box.append(row, thought);
    content.replaceChildren(box);

    const stopLife = startLife(mascot, id);
    const startedStage = pendingStage;
    const stageTimers = [];

    activeThinking = {
      label,
      thought,
      thoughtText: "",
      name,
      stage: startedStage,
      stop: () => {
        stopLife();
        stageTimers.forEach(clearTimeout);
      }
    };

    // Natural progression only while plain thinking.
    stageTimers.push(setTimeout(() => {
      if (activeThinking?.stage === "thinking") setStage("pondering");
    }, rand(4200, 5600)));
    stageTimers.push(setTimeout(() => {
      if (["thinking", "pondering"].includes(activeThinking?.stage)) setStage("almost");
    }, rand(11000, 14000)));
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
    // Stage hints from the chat engine (what the backend is doing).
    window.addEventListener(
      "neyo:chat-send-start",
      event => {
        pendingStage = initialStageFor(event.detail || {});
        setStage(pendingStage);
      },
      true
    );

    window.addEventListener("neyo:chat-thought", event => {
      const piece = String(event.detail?.text || "");
      if (!activeThinking || !activeThinking.thought?.isConnected || !piece) {
        return;
      }
      activeThinking.thoughtText = (activeThinking.thoughtText + piece).slice(-2000);
      const lines = activeThinking.thoughtText
        .replace(/[*_`#>]+/g, "")
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean);
      const last = lines[lines.length - 1] || "";
      activeThinking.thought.textContent = last.length > 160 ? `…${last.slice(-160)}` : last;
      activeThinking.thought.hidden = !last;
      if (["thinking", "pondering", "almost", "writing"].includes(activeThinking.stage)) {
        setStage("reasoning");
      }
    });

    window.addEventListener("neyo:chat-status", event => {
      const stage = String(event.detail?.stage || "");
      if (STAGE_TEXT[stage]) {
        pendingStage = stage;
        setStage(stage, event.detail || {});
      }
    });

    ["neyo:chat-response", "neyo:chat-send-end", "neyo:chat-error", "neyo:chat-aborted"].forEach(name =>
      window.addEventListener(name, () => {
        activeThinking?.stop?.();
        activeThinking = null;
        pendingStage = "thinking";
      })
    );

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
