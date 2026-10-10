/*
=========================================================
NEYO — HERO CAST v2 (motion by character-life.js)
The four characters (Neyo, Zadi, Wizi, Crony) live on the
welcome screen instead of a logo.

- Each one has its own temperament: blinks, glances, hops
  and tilts at random moments (nothing loops mechanically)
- Eyes follow the pointer; while you type they look at the
  message box
- The character you chat with stands forward with a smile
- Tap a character to chat with it (NeyoPersonalities), it
  hops and says hi, the others turn to look
- Pauses when the welcome screen is hidden or the tab is
  in the background; respects reduced motion
=========================================================
*/

(() => {
  "use strict";

  if (window.NeyoHeroCast) return;

  const R = window.NeyoRoster;
  const SHOW = 5;

  const FALLBACK = [
    { id: "neyo", name: "Neyo", tag: "Calm and smart", hi: "Hi, I'm Neyo." }
  ];

  // active character + 4 others, a fresh mix each visit
  function pickCast() {
    const all = R ? R.list() : FALLBACK;
    const active = R ? R.current() : "neyo";
    const others = all.filter(c => c.id !== active).sort(() => Math.random() - 0.5);
    const chosen = [all.find(c => c.id === active) || all[0], ...others.slice(0, SHOW - 1)];
    // active stands in the middle
    const mid = Math.floor(chosen.length / 2);
    const rest = chosen.slice(1);
    return [...rest.slice(0, mid), chosen[0], ...rest.slice(mid)];
  }


  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  let root = null;
  const members = new Map();
  let bubbleTimer = 0;

  const current = () => {
    try {
      return window.NeyoPersonalities?.getCharacter?.() ||
        String(localStorage.getItem("neo_default_personality") || "neyo");
    } catch {
      return "neyo";
    }
  };


  /* ---------------- build ---------------- */

  function addMember(c, before = null) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cast-member";
    btn.dataset.id = c.id;
    const nm = R ? R.name(c.id) : c.name;
    btn.setAttribute("aria-label", `Chat with ${nm}, ${c.tag}`);
    const bubble = document.createElement("span");
    bubble.className = "cast-bubble";
    bubble.setAttribute("aria-hidden", "true");
    const float = document.createElement("span");
    float.className = "cast-float";
    const body = R ? R.avatar(c.id, { size: "var(--size)" }) : document.createElement("span");
    body.classList.add("cast-body");
    float.appendChild(body);
    const shadow = document.createElement("span");
    shadow.className = "cast-shadow";
    shadow.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "cast-name";
    name.dataset.nrName = c.id;
    name.textContent = nm;
    const role = document.createElement("span");
    role.className = "cast-role";
    role.textContent = c.tag;
    btn.append(bubble, float, shadow, name, role);
    root.insertBefore(btn, before);
    const m = { ...c, el: btn, float, body, bubble, detach: null };
    members.set(c.id, m);
    return m;
  }


  function build(host) {
    root = document.createElement("div");
    root.className = "hero-cast";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "Choose who chats with you");

    for (const c of pickCast()) addMember(c);

    if (R) {
      const all = document.createElement("button");
      all.type = "button";
      all.className = "cast-all";
      all.innerHTML = `<span>+${R.ids.length - SHOW}</span><small>All</small>`;
      all.setAttribute("aria-label", "See all characters");
      all.addEventListener("click", () => {
        document.getElementById("sidebarPersonalitiesBtn")?.click();
      });
      root.appendChild(all);
    }

    host.replaceWith(root);
    sync(false);
    wire();
    if (!reduce) for (const m of members.values()) live(m);
    setTimeout(() => say(current()), reduce ? 0 : 650);
  }

  /* ---------------- state ---------------- */

  function sync(celebrate = true) {
    const id = current();
    if (R && root && !members.has(id) && R.get(id)) {
      // chosen somewhere else and not standing here: swap in for the middle one
      const old = [...members.values()].find(m => m.el.classList.contains("is-active")) ||
        [...members.values()][Math.floor(members.size / 2)];
      const fresh = addMember(R.get(id), old ? old.el : root.querySelector(".cast-all"));
      if (old) {
        old.detach?.();
        old.el.remove();
        members.delete(old.id);
      }
      if (!reduce) live(fresh);
    }
    for (const m of members.values()) {
      const on = m.id === id;
      m.el.classList.toggle("is-active", on);
      m.el.setAttribute("aria-pressed", String(on));
    }
    if (celebrate) {
      say(id);
      const chosen = members.get(id);
      if (chosen && !reduce) {
        hop(chosen, 1.6);
        for (const m of members.values()) {
          if (m !== chosen) glanceAt(m, chosen, 1400);
        }
      }
    }
  }

  function say(id) {
    const m = members.get(id);
    if (!m || !root) return;
    clearTimeout(bubbleTimer);
    for (const o of members.values()) o.el.classList.remove("is-saying");
    const nm = R ? R.name(id) : m.name;
    m.bubble.textContent = R && nm !== m.name ? m.hi.split(m.name).join(nm) : m.hi;
    m.el.classList.add("is-saying");
    bubbleTimer = setTimeout(() => m.el.classList.remove("is-saying"), 3200);
  }

  /* ---------------- motion (character-life.js) ---------------- */

  const L = () => window.NeyoLife;

  function neighbours() {
    return [...members.values()].map(m => m.body);
  }

  function live(m) {
    if (!L() || reduce) return;
    m.detach = L().attach(m.body, { host: m.float, hero: true, neighbours });
  }

  function hop(m, power = 1) {
    L()?.hop(m.body, power);
  }

  function glanceAt(m, other, hold) {
    const a = m.el.getBoundingClientRect();
    const b = other.el.getBoundingClientRect();
    L()?.lookAt(m.body, Math.sign(b.left - a.left), -0.15, hold);
  }

  function blink() {}

  function kick() {}

  /* ---------------- wiring ---------------- */

  function wire() {
    root.addEventListener("click", e => {
      const btn = e.target.closest(".cast-member");
      if (!btn) return;
      const id = btn.dataset.id;
      if (id === current()) {
        say(id);
        const m = members.get(id);
        if (m && !reduce) hop(m, 1.2);
        return;
      }
      if (window.NeyoPersonalities?.selectCharacter) {
        window.NeyoPersonalities.selectCharacter(id);
      } else {
        try { localStorage.setItem("neo_default_personality", id); } catch {}
      }
      sync(true);
    });



    // character changed somewhere else (settings, voice mode)
    const external = e => {
      if (e.detail?.source === "hero-cast") return;
      setTimeout(() => sync(false), 0);
    };
    // woke up after a nap: the active character says so
    window.addEventListener("neyo:life-mood", e => {
      const { mood, was } = e.detail || {};
      if (was === "asleep" && (mood === "awake" || mood === "working")) {
        const id = current();
        const m = members.get(id);
        if (!m || !root || root.offsetParent === null) return;
        const nm = R ? R.name(id) : m.name;
        const lines = [`Oh, you're back! ${nm} was napping.`, "Mmm... I'm awake, I'm awake!", "Yawn... okay, ready when you are."];
        setTimeout(() => {
          m.bubble.textContent = lines[Math.floor(Math.random() * lines.length)];
          for (const o of members.values()) o.el.classList.remove("is-saying");
          m.el.classList.add("is-saying");
          clearTimeout(bubbleTimer);
          bubbleTimer = setTimeout(() => m.el.classList.remove("is-saying"), 3000);
        }, 700);
      }
    });

    window.addEventListener("neyo:character-select", external);
    window.addEventListener("neyo:character-change", external);
    window.addEventListener("storage", e => {
      if (e.key === "neo_default_personality") sync(false);
    });

  }

  function init() {
    const host = document.querySelector("[data-hero-cast]");
    if (host) build(host);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.NeyoHeroCast = Object.freeze({ say, sync: () => sync(false) });
})();
