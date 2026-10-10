/*
=========================================================
NEYO — CHARACTER ROSTER v1 (browser)
One list of every character + one avatar renderer used
everywhere (welcome cast, personalities, settings menu,
thinking indicator, voice mode).

- 15 characters. Image characters use a faceless 3D body
  (/characters/<id>.webp) with a LIVE face drawn on top at
  the exact spot of the original face, so they can blink,
  look around, smile and talk.
- Zadi, Wizi, Crony keep their classic CSS bodies.
- Per-user customisation (name, colour, skin) saved in
  localStorage "neyo_character_custom".
- Loaded as a plain script BEFORE neo.js, so neo.js and the
  settings menu already see every character.
Server roster with personas/voices: lib/characters.js
=========================================================
*/

(() => {
  "use strict";

  if (window.NeyoRoster) return;

  const KEY = "neyo_character_custom";
  const CHARACTER_KEY = "neo_default_personality";

  // eyes: [x%, y%, w%, h%] centre-based; mouth same. shape: round|square
  const LIST = [
    { id: "neyo", name: "Neyo", tag: "Calm, smart and reliable", hi: "Hi, I'm Neyo. Let's think it through.", color: "#f7849a", kind: "image", gender: "female",
      face: { eyes: [[35.61, 57.74, 6.89, 10.04], [63.66, 57.68, 6.89, 10.16]], mouth: [49.64, 67.59, 14.87, 1.93] },
      temper: { pace: 1.2, tilt: 4, hop: 5, hopChance: 0.14, squish: 0.05 } },
    { id: "zadi", name: "Zadi", tag: "Bold, energetic motivator", hi: "Hey! I'm Zadi. Let's go!", color: "#1b1b1b", kind: "css", gender: "male",
      temper: { pace: 0.7, tilt: 8, hop: 9, hopChance: 0.36, squish: 0.1 } },
    { id: "wizi", name: "Wizi", tag: "Curious idea explorer", hi: "Wizi here. What are we exploring?", color: "#1b1b1b", kind: "css", gender: "male",
      temper: { pace: 1.05, tilt: 9, hop: 5, hopChance: 0.14, squish: 0.05 } },
    { id: "crony", name: "Crony", tag: "Playful, upbeat buddy", hi: "Yo! Crony's ready. Hit me.", color: "#4fa3f7", kind: "css", gender: "male",
      temper: { pace: 0.85, tilt: 6, hop: 7, hopChance: 0.24, squish: 0.16 } },
    { id: "starry", name: "Starry", tag: "Bookish, patient tutor", hi: "Hi! I'm Starry. What are we learning?", color: "#f2785c", kind: "image", gender: "female",
      face: { eyes: [[38.84, 47.9, 6.91, 6.78], [61.65, 47.84, 6.66, 6.91]], mouth: [50.25, 62.95, 16.4, 1.6] },
      temper: { pace: 1.1, tilt: 6, hop: 4, hopChance: 0.12, squish: 0.05 } },
    { id: "bobo", name: "Bobo", tag: "Chill music lover", hi: "Bobo here. Good vibes only.", color: "#7cc0f5", kind: "image", gender: "male", eyeShape: "square",
      face: { eyes: [[40.54, 43.0, 5.16, 5.9], [58.97, 43.0, 5.16, 5.9]], mouth: [49.82, 61.55, 14.37, 1.47] },
      temper: { pace: 1.3, tilt: 7, hop: 3, hopChance: 0.1, squish: 0.06 } },
    { id: "mochi", name: "Mochi", tag: "Artsy and creative", hi: "Hi, I'm Mochi. Let's make something pretty.", color: "#6fdcae", kind: "image", gender: "female",
      face: { eyes: [[41.46, 38.35, 5.44, 5.57], [64.87, 38.35, 5.44, 5.57]], mouth: [50.89, 75.0, 17.22, 1.65] },
      temper: { pace: 1.0, tilt: 8, hop: 5, hopChance: 0.18, squish: 0.08 } },
    { id: "yumi", name: "Yumi", tag: "Dreamy and gentle", hi: "Hi, I'm Yumi. Take a deep breath.", color: "#b9a7f5", kind: "image", gender: "female",
      face: { eyes: [[40.01, 66.87, 6.08, 9.43], [63.96, 66.87, 6.33, 9.43]], mouth: [51.92, 76.43, 13.52, 1.74] },
      temper: { pace: 1.45, tilt: 5, hop: 3, hopChance: 0.08, squish: 0.07 } },
    { id: "yuzu", name: "Yuzu", tag: "Zesty and cheerful", hi: "Yuzu here! Fresh ideas coming up.", color: "#f5cc4f", kind: "image", gender: "female",
      face: { eyes: [[36.51, 62.84, 6.87, 10.77], [64.79, 62.84, 6.87, 10.77]], mouth: [50.52, 73.67, 15.69, 2.08] },
      temper: { pace: 0.8, tilt: 7, hop: 8, hopChance: 0.3, squish: 0.1 } },
    { id: "mimi", name: "Mimi", tag: "Loving and caring", hi: "Hi, I'm Mimi. How are you feeling?", color: "#f7808f", kind: "image", gender: "female",
      face: { eyes: [[35.79, 55.03, 7.73, 11.22], [66.62, 55.03, 7.58, 11.22]], mouth: [51.17, 66.33, 15.45, 2.04] },
      temper: { pace: 1.15, tilt: 6, hop: 5, hopChance: 0.16, squish: 0.08 } },
    { id: "coco", name: "Coco", tag: "Calm, wise thinker", hi: "Coco here. Let's plan it calmly.", color: "#8cc8f7", kind: "image", gender: "male",
      face: { eyes: [[36.31, 53.27, 7.04, 9.3], [61.56, 53.27, 7.04, 9.3]], mouth: [48.93, 65.7, 13.44, 1.76] },
      temper: { pace: 1.35, tilt: 4, hop: 3, hopChance: 0.08, squish: 0.05 } },
    { id: "pogo", name: "Pogo", tag: "Sporty and energetic", hi: "Pogo here! Ready to win?", color: "#f59a52", kind: "image", gender: "male",
      face: { eyes: [[32.08, 68.97, 6.06, 8.9], [56.61, 68.97, 5.93, 8.9]], mouth: [44.25, 76.02, 11.87, 1.73] },
      temper: { pace: 0.7, tilt: 7, hop: 10, hopChance: 0.38, squish: 0.12 } },
    { id: "nini", name: "Nini", tag: "Magical storyteller", hi: "Hi, I'm Nini. Want a little magic?", color: "#ad94f2", kind: "image", gender: "female", eyeShape: "square",
      face: { eyes: [[35.4, 53.06, 9.32, 8.76], [66.69, 53.06, 9.32, 8.76]], mouth: [50.97, 66.48, 21.84, 2.23] },
      temper: { pace: 1.1, tilt: 9, hop: 5, hopChance: 0.16, squish: 0.05 } },
    { id: "minto", name: "Minto", tag: "Adventurous explorer", hi: "Minto here. Where are we off to?", color: "#63d7a3", kind: "image", gender: "male",
      face: { eyes: [[38.12, 55.17, 8.05, 11.81], [67.11, 55.17, 8.05, 11.81]], mouth: [52.48, 67.58, 15.3, 2.28] },
      temper: { pace: 0.95, tilt: 7, hop: 6, hopChance: 0.22, squish: 0.08 } },
    { id: "koko", name: "Koko", tag: "Cool and witty", hi: "Koko. Keep it cool.", color: "#e9e6e0", kind: "image", gender: "male",
      face: { eyes: [], mouth: [51.0, 72.51, 14.07, 1.99] },
      temper: { pace: 1.4, tilt: 3, hop: 3, hopChance: 0.06, squish: 0.06 } }
  ];

  const BY_ID = Object.fromEntries(LIST.map(c => [c.id, c]));
  const IDS = LIST.map(c => c.id);

  const SKINS = [
    { id: "original", label: "Original", filter: "" },
    { id: "pastel", label: "Pastel", filter: "saturate(0.62) brightness(1.08)" },
    { id: "vivid", label: "Vivid", filter: "saturate(1.45) contrast(1.06)" },
    { id: "candy", label: "Candy", filter: "saturate(1.3) brightness(1.06) hue-rotate(-8deg)" },
    { id: "gold", label: "Gold", filter: "sepia(0.55) saturate(1.8) hue-rotate(-12deg) brightness(1.04)" },
    { id: "night", label: "Night", filter: "brightness(0.78) saturate(1.3) contrast(1.12)" },
    { id: "mono", label: "Mono", filter: "grayscale(1) contrast(1.08)" },
    { id: "glow", label: "Glow", filter: "drop-shadow(0 0 0.09em var(--nr-color)) drop-shadow(0 0 0.18em var(--nr-color))" },
    { id: "sticker", label: "Sticker", filter: "drop-shadow(0.03em 0 0 #fff) drop-shadow(-0.03em 0 0 #fff) drop-shadow(0 0.03em 0 #fff) drop-shadow(0 -0.03em 0 #fff) drop-shadow(0 0.05em 0.06em rgba(0,0,0,.22))" }
  ];

  const COLORS = [0, 25, 55, 90, 140, 180, 210, 250, 290, 330];

  /* ---------------- storage ---------------- */

  let custom = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (raw && typeof raw === "object") custom = raw;
  } catch {}

  const cleanName = v =>
    String(v || "").normalize("NFKC").replace(/[^\p{L}\p{N} '._-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 20);

  function customOf(id) {
    const c = custom[id] || {};
    return {
      name: cleanName(c.name),
      hue: Number.isFinite(+c.hue) ? Math.round(((+c.hue % 360) + 360) % 360) : 0,
      skin: SKINS.some(s => s.id === c.skin) ? c.skin : "original"
    };
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(custom)); } catch {}
  }

  function setCustom(id, patch) {
    if (!BY_ID[id]) return;
    const next = { ...customOf(id), ...patch };
    next.name = cleanName(next.name);
    custom[id] = next;
    if (!next.name && !next.hue && next.skin === "original") delete custom[id];
    save();
    refresh(id);
    try {
      window.dispatchEvent(new CustomEvent("neyo:character-custom", { detail: { id, custom: customOf(id) } }));
    } catch {}
  }

  const resetCustom = id => {
    delete custom[id];
    save();
    refresh(id);
    try { window.dispatchEvent(new CustomEvent("neyo:character-custom", { detail: { id, custom: customOf(id) } })); } catch {}
  };

  const get = id => BY_ID[String(id || "").toLowerCase()] || null;
  const name = id => customOf(id).name || get(id)?.name || "Neyo";
  const customName = id => customOf(id).name;
  const current = () => {
    try {
      const v = String(localStorage.getItem(CHARACTER_KEY) || "").trim().toLowerCase();
      return BY_ID[v] ? v : "neyo";
    } catch {
      return "neyo";
    }
  };

  /* ---------------- avatar ---------------- */

  function filterFor(id) {
    const c = customOf(id);
    const skin = SKINS.find(s => s.id === c.skin)?.filter || "";
    const hue = c.hue ? ` hue-rotate(${c.hue}deg)` : "";
    return (skin + hue).trim() || "none";
  }

  function applyLook(el) {
    const id = el.dataset.character;
    const ch = get(id);
    if (!ch) return;
    const c = customOf(id);
    el.style.setProperty("--nr-color", ch.color);
    el.style.setProperty("--nr-filter", filterFor(id));
    el.dataset.skin = c.skin;
    if (ch.kind === "css") {
      // classic bodies are black/white: colour = a real tint
      if (c.hue) el.style.setProperty("--nr-tint", `hsl(${c.hue} 68% 58%)`);
      else el.style.removeProperty("--nr-tint");
    }
  }

  const pct = v => `${v}%`;

  function avatar(id, { size = 40, className = "", live = true } = {}) {
    const ch = get(id) || BY_ID.neyo;
    const el = document.createElement("span");
    el.className = `nr-avatar ${className}`.trim();
    el.dataset.character = ch.id;
    el.dataset.kind = ch.kind;
    el.setAttribute("aria-hidden", "true");
    if (size) el.style.setProperty("--nr-size", typeof size === "number" ? `${size}px` : size);

    if (ch.kind === "image") {
      const art = document.createElement("span");
      art.className = "nr-art";
      const img = document.createElement("img");
      img.src = `/characters/${ch.id}.webp?v=1`;
      img.alt = "";
      img.draggable = false;
      img.decoding = "async";
      img.loading = "lazy";
      art.appendChild(img);
      const face = document.createElement("span");
      face.className = "nr-face";
      for (const [x, y, w, h] of ch.face.eyes) {
        const eye = document.createElement("i");
        eye.className = `nr-eye${ch.eyeShape === "square" ? " is-square" : ""}`;
        Object.assign(eye.style, { left: pct(x), top: pct(y), width: pct(w), height: pct(h) });
        face.appendChild(eye);
      }
      const [mx, my, mw, mh] = ch.face.mouth;
      const mouth = document.createElement("i");
      mouth.className = "nr-mouth";
      Object.assign(mouth.style, { left: pct(mx), top: pct(my), width: pct(mw) });
      mouth.style.setProperty("--mt", `${mh}cqw`);
      face.appendChild(mouth);
      el.append(art, face);
    } else {
      const body = document.createElement("span");
      body.className = "nr-css-body";
      body.innerHTML = '<span class="nr-css-eyes"><i class="nr-eye"></i><i class="nr-eye"></i></span><i class="nr-mouth"></i>';
      el.appendChild(body);
    }
    if (!live) el.classList.add("is-static");
    applyLook(el);
    return el;
  }

  function refresh(id) {
    const sel = id ? `.nr-avatar[data-character="${id}"]` : ".nr-avatar";
    document.querySelectorAll(sel).forEach(applyLook);
    document.querySelectorAll(id ? `[data-nr-name="${id}"]` : "[data-nr-name]").forEach(n => {
      n.textContent = name(n.dataset.nrName);
    });
  }

  /* ---------------- voice / picker registry ---------------- */

  // Let the voice picker + mascot discover the new characters.
  window.NeyoCharacters = window.NeyoCharacters || {};
  for (const ch of LIST) {
    if (ch.kind !== "image" || ch.id === "neyo" || window.NeyoCharacters[ch.id]) continue;
    window.NeyoCharacters[ch.id] = Object.freeze({
      id: ch.id,
      name: ch.name,
      role: ch.tag,
      description: ch.tag,
      visual: Object.freeze({ bodyShape: "image", surface: "light", faceInk: "dark", faceScale: 1, bodyScale: 1 }),
      voice: Object.freeze({ gender: ch.gender })
    });
  }

  /* ---------------- static markup (settings + personalities) ---------------- */

  function buildSettingsMenu() {
    const menu = document.getElementById("settingsDefaultPersonalityMenu");
    if (!menu || menu.dataset.nrBuilt) return;
    menu.dataset.nrBuilt = "1";
    const selected = current();
    menu.replaceChildren(...LIST.map(ch => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `settings-select-option${ch.id === selected ? " active" : ""}`;
      b.dataset.value = ch.id;
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(ch.id === selected));
      const text = document.createElement("span");
      text.className = "settings-option-text";
      text.innerHTML = `<strong data-nr-name="${ch.id}"></strong><small></small>`;
      text.querySelector("small").textContent = ch.tag;
      b.append(avatar(ch.id, { size: 28, className: "settings-option-mascot", live: false }), text);
      return b;
    }));
    const old = document.getElementById("settingsDefaultPersonalityMascot");
    if (old) {
      const a = avatar(selected, { size: 20, live: false });
      a.id = "settingsDefaultPersonalityMascot";
      old.replaceWith(a);
    }
  }

  function buildPersonalityGrid() {
    const grid = document.getElementById("personalityCharacterGrid");
    if (!grid || grid.dataset.nrBuilt) return;
    grid.dataset.nrBuilt = "1";
    grid.replaceChildren(...LIST.map(ch => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "personality-card personality-character-card";
      b.dataset.characterChoice = ch.id;
      b.setAttribute("aria-pressed", "false");
      const strong = document.createElement("strong");
      strong.dataset.nrName = ch.id;
      const small = document.createElement("small");
      small.textContent = ch.tag;
      b.append(avatar(ch.id, { size: 44, className: "personality-avatar" }), strong, small);
      return b;
    }));
  }

  function syncSmallMascot() {
    const el = document.getElementById("settingsDefaultPersonalityMascot");
    if (!el) return;
    const id = current();
    if (el.dataset.character === id) return;
    const a = avatar(id, { size: 20, live: false });
    a.id = "settingsDefaultPersonalityMascot";
    el.replaceWith(a);
  }

  function buildStatic() {
    buildSettingsMenu();
    buildPersonalityGrid();
    refresh();
  }

  buildStatic();

  window.addEventListener("neyo:character-select", () => setTimeout(syncSmallMascot, 0));
  window.addEventListener("storage", e => {
    if (e.key === KEY) {
      try { custom = JSON.parse(e.newValue || "{}") || {}; } catch { custom = {}; }
      refresh();
    }
    if (e.key === CHARACTER_KEY) syncSmallMascot();
  });

  window.NeyoRoster = Object.freeze({
    list: () => LIST.slice(),
    ids: IDS.slice(),
    get,
    name,
    customName,
    custom: customOf,
    setCustom,
    resetCustom,
    avatar,
    refresh,
    current,
    labels: () => Object.fromEntries(IDS.map(id => [id, name(id)])),
    skins: SKINS.slice(),
    colors: COLORS.slice(),
    syncSmallMascot
  });
})();
