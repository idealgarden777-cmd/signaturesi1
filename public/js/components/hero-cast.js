/*
=========================================================
NEYO — HERO CAST v1
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

  const TEMPER_DEFAULT = { pace: 1.1, tilt: 5, hop: 5, hopChance: 0.15, squish: 0.06 };

  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const chance = p => Math.random() < p;

  let root = null;
  const members = new Map();
  let pointer = null;
  let raf = 0;
  let bubbleTimer = 0;

  const current = () => {
    try {
      return window.NeyoPersonalities?.getCharacter?.() ||
        String(localStorage.getItem("neo_default_personality") || "neyo");
    } catch {
      return "neyo";
    }
  };

  const visible = () =>
    root && root.isConnected && !document.hidden && root.offsetParent !== null;

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
    const m = { ...c, el: btn, float, body, bubble, t: c.temper || TEMPER_DEFAULT, look: null, timers: new Set() };
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
        old.timers.forEach(clearTimeout);
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

  /* ---------------- motion ---------------- */

  function later(m, fn, ms) {
    const h = setTimeout(() => {
      m.timers.delete(h);
      fn();
    }, ms);
    m.timers.add(h);
  }

  function pose(m, { x = 0, y = 0, r = 0, sx = 1, sy = 1 }, ms) {
    m.float.style.transitionDuration = `${Math.round(ms)}ms`;
    m.float.style.transform =
      `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${r.toFixed(1)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
  }

  function eyes(m, x, y) {
    m.body.style.setProperty("--ex", (x / 3).toFixed(3));
    m.body.style.setProperty("--ey", (y / 3).toFixed(3));
  }

  function blink(m, twice = false) {
    m.body.classList.add("is-blinking");
    later(m, () => {
      m.body.classList.remove("is-blinking");
      if (twice) later(m, () => blink(m), 160);
    }, 130);
  }

  function hop(m, power = 1) {
    const h = m.t.hop * power;
    const s = m.t.squish;
    pose(m, { y: 1, sx: 1 + s, sy: 1 - s }, 110);
    later(m, () => pose(m, { y: -h, sx: 1 - s * 0.6, sy: 1 + s * 0.6 }, 200), 110);
    later(m, () => pose(m, { y: 0, sx: 1 + s * 0.5, sy: 1 - s * 0.5 }, 180), 330);
    later(m, () => pose(m, {}, 260), 520);
  }

  function glanceAt(m, other, hold) {
    const a = m.el.getBoundingClientRect();
    const b = other.el.getBoundingClientRect();
    m.look = { x: Math.sign(b.left - a.left) * 3, y: -0.5, until: performance.now() + hold };
    pose(m, { r: Math.sign(b.left - a.left) * m.t.tilt * 0.5 }, 380);
    later(m, () => pose(m, {}, 500), hold);
    kick();
  }

  // one small random action, then schedule the next
  function live(m) {
    const next = () => later(m, () => {
      if (visible()) act(m);
      next();
    }, rand(1600, 4200) * m.t.pace);
    later(m, () => blink(m), rand(600, 2400));
    next();
  }

  function act(m) {
    const roll = Math.random();
    if (roll < 0.34) {
      blink(m, chance(0.25));
    } else if (roll < 0.34 + m.t.hopChance) {
      hop(m);
    } else if (roll < 0.72) {
      const others = [...members.values()].filter(o => o !== m);
      glanceAt(m, others[Math.floor(Math.random() * others.length)], rand(700, 1500));
    } else {
      const dir = chance(0.5) ? 1 : -1;
      pose(m, { r: dir * m.t.tilt, y: -1 }, 420);
      later(m, () => pose(m, {}, 520), rand(600, 1100));
    }
  }

  /* ---------------- eyes follow ---------------- */

  function target() {
    const input = document.getElementById("chatInput");
    if (input && (document.activeElement === input || input.value.trim())) {
      const r = input.getBoundingClientRect();
      return { x: r.left + r.width * 0.3, y: r.top + r.height / 2, typing: true };
    }
    return pointer;
  }

  function frame() {
    raf = 0;
    if (!visible()) return;
    const goal = target();
    const now = performance.now();
    for (const m of members.values()) {
      if (m.look && m.look.until > now) {
        eyes(m, m.look.x, m.look.y);
        continue;
      }
      m.look = null;
      if (!goal) {
        eyes(m, 0, 0);
        continue;
      }
      const r = m.body.getBoundingClientRect();
      const dx = goal.x - (r.left + r.width / 2);
      const dy = goal.y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const pull = Math.min(1, d / 160) * (goal.typing ? 3.4 : 3);
      eyes(m, (dx / d) * pull, (dy / d) * pull * 0.8);
    }
    if (members.size && [...members.values()].some(m => m.look)) kick();
  }

  function kick() {
    if (!raf && !reduce) raf = requestAnimationFrame(frame);
  }

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

    root.addEventListener("pointerenter", e => {
      const btn = e.target.closest?.(".cast-member");
      const m = btn && members.get(btn.dataset.id);
      if (m && !reduce) blink(m);
    }, true);

    window.addEventListener("pointermove", e => {
      pointer = { x: e.clientX, y: e.clientY };
      kick();
    }, { passive: true });

    document.addEventListener("pointerleave", () => {
      pointer = null;
      kick();
    });

    const input = document.getElementById("chatInput");
    input?.addEventListener("focus", kick);
    input?.addEventListener("blur", kick);
    input?.addEventListener("input", kick);

    // character changed somewhere else (settings, voice mode)
    const external = e => {
      if (e.detail?.source === "hero-cast") return;
      setTimeout(() => sync(false), 0);
    };
    window.addEventListener("neyo:character-select", external);
    window.addEventListener("neyo:character-change", external);
    window.addEventListener("storage", e => {
      if (e.key === "neo_default_personality") sync(false);
    });

    document.addEventListener("visibilitychange", kick);
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
