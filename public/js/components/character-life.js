/*
=========================================================
NEYO — CHARACTER LIFE v1
One smooth engine (single requestAnimationFrame, spring
physics) that makes every character feel alive:

  awake    breathes, blinks, looks at you / the message box /
           each other, little hops and head tilts
  drowsy   nobody touched NEYO for a while: heavy eyelids,
           slow blinks, yawns, head nods
  asleep   eyes shut, deep slow breathing, floating "z"
  waking   any touch/keypress: eyes pop open, stretch, hop
  working  NEYO is writing a reply: focused eyes, busy bob
  happy    reply arrived: smile + happy hop

Night time (22:00-06:00) they get sleepy sooner.
Each character keeps its own temperament (roster temper)
and its own timing, so they never move in sync.

API: window.NeyoLife.attach(avatarEl, { host, neighbours,
     hero }) → detach()
Pauses off-screen and in background tabs.
=========================================================
*/

(() => {
  "use strict";

  if (window.NeyoLife) return;

  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const chance = p => Math.random() < p;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------------- shared world ---------------- */

  const world = {
    lastActivity: performance.now(),
    busy: false,
    happyUntil: 0,
    pointer: null,
    wakeAt: 0
  };

  const night = () => {
    const h = new Date().getHours();
    return h >= 22 || h < 6;
  };

  const DROWSY_MS = () => (night() ? 16000 : 32000);
  const ASLEEP_MS = () => (night() ? 30000 : 58000);

  function activity() {
    const now = performance.now();
    const idle = now - world.lastActivity;
    world.lastActivity = now;
    if (idle > DROWSY_MS() - 2000) world.wakeAt = now;
    kick();
  }

  ["pointerdown", "keydown", "wheel", "touchstart"].forEach(type =>
    window.addEventListener(type, activity, { passive: true, capture: true })
  );

  let lastMove = 0;
  window.addEventListener("pointermove", e => {
    world.pointer = { x: e.clientX, y: e.clientY, at: performance.now() };
    const now = performance.now();
    if (now - lastMove > 400) {
      lastMove = now;
      activity();
    }
  }, { passive: true });

  document.addEventListener("pointerleave", () => {
    world.pointer = null;
  });

  window.addEventListener("neyo:chat-send-start", () => {
    world.busy = true;
    activity();
  }, true);

  ["neyo:chat-response", "neyo:chat-send-end"].forEach(name =>
    window.addEventListener(name, () => {
      if (world.busy) world.happyUntil = performance.now() + 2200;
      world.busy = false;
      kick();
    })
  );

  ["neyo:chat-error", "neyo:chat-aborted"].forEach(name =>
    window.addEventListener(name, () => {
      world.busy = false;
    })
  );

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) kick();
  });

  let lastGlobal = "awake";

  function announce(now) {
    const m = mood(now);
    if (m === lastGlobal) return;
    const was = lastGlobal;
    lastGlobal = m;
    try {
      window.dispatchEvent(new CustomEvent("neyo:life-mood", { detail: { mood: m, was } }));
    } catch {}
  }

  function mood(now) {
    if (world.busy) return "working";
    if (now < world.happyUntil) return "happy";
    const idle = now - world.lastActivity;
    if (idle > ASLEEP_MS()) return "asleep";
    if (idle > DROWSY_MS()) return "drowsy";
    return "awake";
  }

  /* ---------------- springs ---------------- */

  const spring = (v, k = 140, d = 15) => ({ v, t: v, vel: 0, k, d });

  function step(s, dt) {
    const f = (s.t - s.v) * s.k - s.vel * s.d;
    s.vel += f * dt;
    s.v += s.vel * dt;
  }

  /* ---------------- characters ---------------- */

  const lives = new Set();
  const DEFAULT_TEMPER = { pace: 1.1, tilt: 5, hop: 5, hopChance: 0.15, squish: 0.06 };

  function attach(avatar, opts = {}) {
    if (!avatar || avatar.__life) return avatar?.__life?.detach || (() => {});
    const id = avatar.dataset.character;
    const temper = { ...DEFAULT_TEMPER, ...(window.NeyoRoster?.get?.(id)?.temper || {}) };
    const host = opts.host || avatar;

    const L = {
      id,
      avatar,
      host,
      temper,
      hero: Boolean(opts.hero),
      neighbours: opts.neighbours || null,
      // springs
      x: spring(0, 120, 14),
      y: spring(0, 170, 13),
      rot: spring(0, 90, 12),
      sx: spring(1, 230, 15),
      sy: spring(1, 230, 15),
      gx: spring(0, 150, 17),
      gy: spring(0, 150, 17),
      lid: spring(0, 260, 22),
      // timing (own offsets so they never move in sync)
      phase: rand(0, Math.PI * 2),
      sleepOffset: rand(0, 9000),
      nextAct: performance.now() + rand(500, 2200),
      nextBlink: performance.now() + rand(700, 2600),
      blinkUntil: 0,
      look: null,
      mood: "awake",
      zTimer: 0,
      visible: true,
      rect: null,
      rectAt: 0,
      mouthUntil: 0,
      mouthClass: ""
    };

    avatar.classList.add("nr-live");
    avatar.__life = L;

    if (typeof IntersectionObserver === "function") {
      L.io = new IntersectionObserver(entries => {
        L.visible = entries.some(e => e.isIntersecting);
        if (L.visible) kick();
      });
      L.io.observe(avatar);
    }

    L.detach = () => {
      lives.delete(L);
      L.io?.disconnect();
      delete avatar.__life;
      avatar.classList.remove("nr-live", "is-asleep", "is-drowsy", "is-working", "is-yawning", "is-smiling-life");
      host.style.transform = "";
    };

    lives.add(L);
    kick();
    return L.detach;
  }

  /* ---------------- actions ---------------- */

  function hop(L, power = 1) {
    const h = L.temper.hop * power;
    const s = L.temper.squish;
    L.sy.vel -= 2.2 * s * 10;
    L.sx.vel += 2.2 * s * 10;
    setTimeout(() => {
      L.y.vel -= h * 16;
      L.sy.vel += s * 30;
      L.sx.vel -= s * 20;
    }, 90);
  }

  function setMouth(L, cls, ms) {
    L.mouthClass = cls;
    L.mouthUntil = performance.now() + ms;
  }

  function yawn(L) {
    setMouth(L, "is-yawning", 1500);
    L.stretchUntil = performance.now() + 1300;
  }

  function stretch(L) {
    L.sy.vel += 3.2;
    L.sx.vel -= 2;
    setTimeout(() => hop(L, 0.8), 260);
    setTimeout(() => setMouth(L, "is-smiling-life", 1200), 200);
  }

  function zzz(L) {
    const z = document.createElement("span");
    z.className = "nr-z";
    z.textContent = "z";
    z.style.setProperty("--zx", `${rand(-6, 10).toFixed(0)}px`);
    z.style.setProperty("--zs", rand(0.75, 1.15).toFixed(2));
    (L.host.parentElement && L.hero ? L.host : L.avatar).appendChild(z);
    setTimeout(() => z.remove(), 2700);
  }

  function neighbourTarget(L) {
    const list = L.neighbours?.() || [];
    const others = list.filter(o => o !== L.avatar);
    if (!others.length) return null;
    const o = others[Math.floor(Math.random() * others.length)];
    const a = L.avatar.getBoundingClientRect();
    const b = o.getBoundingClientRect();
    return { x: Math.sign(b.left - a.left), y: -0.15 };
  }

  function act(L, now) {
    const t = L.temper;
    if (L.mood === "awake") {
      const roll = Math.random();
      if (roll < 0.28) {
        L.nextBlink = now;
      } else if (roll < 0.28 + t.hopChance) {
        hop(L);
      } else if (roll < 0.66) {
        const n = neighbourTarget(L);
        L.look = n
          ? { ...n, until: now + rand(700, 1500) }
          : { x: rand(-1, 1), y: rand(-0.6, 0.3), until: now + rand(600, 1300) };
        if (n) L.rot.t = n.x * t.tilt * 0.45;
      } else if (roll < 0.86) {
        L.rot.t = (chance(0.5) ? 1 : -1) * t.tilt;
        setTimeout(() => (L.rot.t = 0), rand(600, 1100));
      } else {
        // little wiggle
        L.x.vel += (chance(0.5) ? 1 : -1) * 40;
      }
      L.nextAct = now + rand(1700, 4300) * t.pace;
    } else if (L.mood === "drowsy") {
      if (chance(0.45)) yawn(L);
      else L.rot.t = (chance(0.5) ? 1 : -1) * t.tilt * 0.8;
      L.nextAct = now + rand(3200, 6200) * t.pace;
    } else if (L.mood === "working") {
      if (chance(0.3)) L.look = { x: rand(-0.8, 0.8), y: 0.6, until: now + rand(500, 900) };
      L.nextAct = now + rand(900, 1800);
    } else {
      L.nextAct = now + 4000;
    }
  }

  /* ---------------- frame ---------------- */

  let raf = 0;
  let last = 0;

  function kick() {
    if (!raf && !reduce && lives.size) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  function target(L, now) {
    if (L.look && L.look.until > now) return L.look;
    L.look = null;
    const input = document.getElementById("chatInput");
    const typing = input && (document.activeElement === input || input.value.trim());
    let goal = null;
    if (L.hero && typing) {
      const r = input.getBoundingClientRect();
      goal = { x: r.left + r.width * 0.3, y: r.top + r.height / 2 };
    } else if (world.pointer && now - world.pointer.at < 6000) {
      goal = world.pointer;
    }
    if (!goal) return { x: 0, y: 0 };
    if (!L.rect || now - L.rectAt > 500) {
      L.rect = L.avatar.getBoundingClientRect();
      L.rectAt = now;
    }
    const dx = goal.x - (L.rect.left + L.rect.width / 2);
    const dy = goal.y - (L.rect.top + L.rect.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 170);
    return { x: (dx / d) * k, y: (dy / d) * k * 0.85 };
  }

  function frame(ts) {
    raf = 0;
    if (document.hidden) return;
    const now = performance.now();
    const dt = clamp(last ? (ts - last) / 1000 : 1 / 60, 0.001, 0.05);
    last = ts;
    const global = mood(now);
    announce(now);
    let any = false;

    for (const L of lives) {
      if (!L.avatar.isConnected) {
        L.detach();
        continue;
      }
      if (!L.visible || L.host.offsetParent === null) continue;
      any = true;

      // each character falls asleep at its own moment
      let m = global;
      if ((m === "asleep" || m === "drowsy") && now - world.lastActivity < (m === "asleep" ? ASLEEP_MS() : DROWSY_MS()) + L.sleepOffset) {
        m = m === "asleep" ? "drowsy" : "awake";
      }
      if (m !== L.mood) {
        const was = L.mood;
        L.mood = m;
        L.avatar.classList.toggle("is-asleep", m === "asleep");
        L.avatar.classList.toggle("is-drowsy", m === "drowsy");
        L.avatar.classList.toggle("is-working", m === "working");
        if ((was === "asleep" || was === "drowsy") && (m === "awake" || m === "working")) {
          setTimeout(() => stretch(L), rand(0, 420));
        }
        if (m === "happy") {
          setMouth(L, "is-smiling-life", 2000);
          setTimeout(() => hop(L, 1.2), rand(0, 250));
        }
        L.rot.t = 0;
        L.nextAct = now + rand(300, 1200);
      }

      // breathing + mood pose
      const t = now / 1000;
      let breathAmp = 0.012, breathSpeed = 1.6, lid = 0, lean = 0, sink = 0;
      if (L.mood === "drowsy") { breathAmp = 0.018; breathSpeed = 1.0; lid = 0.55; sink = 1; }
      if (L.mood === "asleep") { breathAmp = 0.03; breathSpeed = 0.62; lid = 1; lean = L.temper.tilt * 0.9; sink = 2; }
      if (L.mood === "working") { breathAmp = 0.01; breathSpeed = 2.4; lid = 0.28; }

      const breath = Math.sin(t * breathSpeed * Math.PI + L.phase);
      const yawning = now < (L.stretchUntil || 0) ? 0.06 : 0;
      L.sy.t = 1 + breath * breathAmp + yawning;
      L.sx.t = 1 - breath * breathAmp * 0.6 - yawning * 0.6;
      if (yawning) lid = Math.max(lid, 0.8);
      if (L.mood === "asleep") L.rot.t = lean * (L.phase > Math.PI ? 1 : -1);
      if (L.mood === "working") L.y.t = -Math.abs(Math.sin(t * 5.2 + L.phase)) * 1.6;
      else L.y.t = sink;

      // blinks
      if (L.mood !== "asleep" && now >= L.nextBlink) {
        L.blinkUntil = now + (L.mood === "drowsy" ? 420 : 120);
        L.nextBlink = now + (L.mood === "drowsy" ? rand(1800, 3400) : rand(2000, 5200));
        if (L.mood === "awake" && chance(0.18)) L.nextBlink = now + 260;
      }
      if (L.lid.t < 0.9 || L.mood !== "asleep") L.lid.t = now < L.blinkUntil ? 1 : lid;

      // actions
      if (now >= L.nextAct) act(L, now);

      // eyes
      const goal = L.mood === "asleep" ? { x: 0, y: 0.3 } : L.mood === "working" && !L.look ? { x: 0, y: 0.55 } : target(L, now);
      L.gx.t = goal.x;
      L.gy.t = goal.y;

      // mouth classes
      const mouth = now < L.mouthUntil ? L.mouthClass : "";
      L.avatar.classList.toggle("is-yawning", mouth === "is-yawning");
      L.avatar.classList.toggle("is-smiling-life", mouth === "is-smiling-life");

      // z's
      if (L.mood === "asleep" && now > L.zTimer) {
        zzz(L);
        L.zTimer = now + rand(1700, 2600);
      }

      for (const s of [L.x, L.y, L.rot, L.sx, L.sy, L.gx, L.gy, L.lid]) step(s, dt);
      L.lid.v = clamp(L.lid.v, 0, 1);

      L.host.style.transform =
        `translate3d(${L.x.v.toFixed(2)}px, ${L.y.v.toFixed(2)}px, 0) rotate(${L.rot.v.toFixed(2)}deg) scale(${L.sx.v.toFixed(4)}, ${L.sy.v.toFixed(4)})`;
      const st = L.avatar.style;
      st.setProperty("--ex", L.gx.v.toFixed(3));
      st.setProperty("--ey", L.gy.v.toFixed(3));
      st.setProperty("--blink", (1 - L.lid.v * 0.9).toFixed(3));
    }

    if (any) raf = requestAnimationFrame(frame);
  }

  window.NeyoLife = Object.freeze({
    attach,
    hop: (el, power = 1.4) => el?.__life && hop(el.__life, power),
    lookAt: (el, x, y, ms = 1200) => {
      const L = el?.__life;
      if (!L) return;
      L.look = { x, y, until: performance.now() + ms };
      L.rot.t = Math.sign(x) * L.temper.tilt * 0.45;
      setTimeout(() => (L.rot.t = 0), ms);
      kick();
    },
    smile: (el, ms = 1600) => el?.__life && setMouth(el.__life, "is-smiling-life", ms),
    wake: activity,
    mood: () => mood(performance.now()),
    world
  });
})();
