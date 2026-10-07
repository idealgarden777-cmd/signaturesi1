/*
=========================================================
NEYO — MASCOT LIFE v1
Makes the voice-mode mascot feel alive instead of looping.

- Spring physics (no CSS keyframe loops)
- Random, phase-aware behaviours:
  idle      -> looks around, tilts, stretches, double blinks
  listening -> leans in, looks at you, nods when you pause
  thinking  -> looks up and away, squints, small tilts
  speaking  -> nods on emphasis, glances away and back
- Reacts to phase changes (perks up, settles, lifts)
- Per-character temperament (Neyo calm, Zadi energetic,
  Wizi curious, Crony bouncy/squishy)

Writes only CSS variables on #neyoMascot:
--life-x, --life-y, --life-rot, --life-sx, --life-sy,
--life-gx, --life-gy
mascot.js keeps owning eyes/mouth/mood; this only adds life.
=========================================================
*/

(() => {
  "use strict";

  const mascot = document.getElementById("neyoMascot");
  if (!mascot) {
    return;
  }

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  const TEMPERAMENT = {
    neyo: { energy: 0.8, pace: 1.25, tilt: 3, hop: 5, squish: 0.03, look: 4 },
    zadi: { energy: 1.35, pace: 0.7, tilt: 5, hop: 10, squish: 0.05, look: 5 },
    wizi: { energy: 1.0, pace: 1.0, tilt: 6, hop: 6, squish: 0.035, look: 6 },
    crony: { energy: 1.15, pace: 0.85, tilt: 4, hop: 8, squish: 0.08, look: 4 }
  };

  const rand = (min, max) => min + Math.random() * (max - min);
  const chance = p => Math.random() < p;
  const pick = list => list[Math.floor(Math.random() * list.length)];

  /* ---------------- springs ---------------- */

  function spring(value, stiffness = 120, damping = 14) {
    return { value, target: value, velocity: 0, stiffness, damping, rest: value };
  }

  const ch = {
    x: spring(0),
    y: spring(0, 160, 13),
    rot: spring(0, 90, 12),
    sx: spring(1, 220, 15),
    sy: spring(1, 220, 15),
    gx: spring(0, 140, 16),
    gy: spring(0, 140, 16)
  };

  function stepSprings(dt) {
    Object.values(ch).forEach(s => {
      const force = s.stiffness * (s.target - s.value) - s.damping * s.velocity;
      s.velocity += force * dt;
      s.value += s.velocity * dt;
    });
  }

  function write() {
    const st = mascot.style;
    st.setProperty("--life-x", `${ch.x.value.toFixed(2)}px`);
    st.setProperty("--life-y", `${ch.y.value.toFixed(2)}px`);
    st.setProperty("--life-rot", `${ch.rot.value.toFixed(2)}deg`);
    st.setProperty("--life-sx", ch.sx.value.toFixed(4));
    st.setProperty("--life-sy", ch.sy.value.toFixed(4));
    st.setProperty("--life-gx", `${ch.gx.value.toFixed(2)}px`);
    st.setProperty("--life-gy", `${ch.gy.value.toFixed(2)}px`);
  }

  /* ---------------- state ---------------- */

  let phase = mascot.dataset.phase || "idle";
  let micLevel = 0;
  let micPeak = 0;
  let outLevel = 0;
  let outAvg = 0;
  let lastNod = 0;
  let nextActionAt = 0;
  const timers = new Set();

  const temper = () => TEMPERAMENT[mascot.dataset.character] || TEMPERAMENT.neyo;

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  }

  function clearLater() {
    timers.forEach(clearTimeout);
    timers.clear();
  }

  function settle() {
    ch.x.target = 0;
    ch.y.target = 0;
    ch.rot.target = 0;
    ch.sx.target = 1;
    ch.sy.target = 1;
  }

  function look(x, y) {
    ch.gx.target = x;
    ch.gy.target = y;
  }

  function blink(twice = false) {
    mascot.dataset.blink = "true";
    later(() => {
      mascot.dataset.blink = "false";
      if (twice) later(() => blink(false), rand(120, 180));
    }, rand(90, 140));
  }

  function hop(scale = 1) {
    const t = temper();
    ch.sy.target = 1 - t.squish;
    ch.sx.target = 1 + t.squish;
    later(() => {
      ch.y.target = -t.hop * scale;
      ch.sy.target = 1 + t.squish * 0.7;
      ch.sx.target = 1 - t.squish * 0.5;
    }, 90);
    later(() => {
      ch.y.target = 0;
      ch.sy.target = 1 - t.squish * 0.5;
      ch.sx.target = 1 + t.squish * 0.4;
    }, 280);
    later(() => {
      ch.sy.target = 1;
      ch.sx.target = 1;
    }, 440);
  }

  function nod(strength = 1) {
    const t = temper();
    ch.y.target = 2.2 * strength;
    ch.rot.target += rand(-0.6, 0.6);
    ch.sy.target = 1 - t.squish * 0.35 * strength;
    later(() => {
      ch.y.target = 0;
      ch.sy.target = 1;
    }, rand(150, 220));
  }

  /* ---------------- behaviours by phase ---------------- */

  const BEHAVIOURS = {
    idle: [
      () => { // look around
        const t = temper();
        look(rand(-t.look, t.look), rand(-t.look * 0.5, t.look * 0.4));
        ch.rot.target = rand(-t.tilt, t.tilt) * 0.4;
        return rand(900, 2600);
      },
      () => { // look at the user
        look(0, 0);
        ch.rot.target = 0;
        if (chance(0.4)) blink(chance(0.4));
        return rand(1200, 3200);
      },
      () => { // curious tilt
        const t = temper();
        ch.rot.target = pick([-1, 1]) * t.tilt * rand(0.6, 1);
        look(ch.rot.target * 0.5, -1.5);
        return rand(900, 1800);
      },
      () => { // stretch / sigh
        const t = temper();
        ch.sy.target = 1 + t.squish * 0.8;
        ch.sx.target = 1 - t.squish * 0.5;
        ch.y.target = -2;
        later(settle, rand(500, 800));
        return rand(1400, 2400);
      },
      () => { // little happy hop (rare)
        if (chance(0.45)) hop(0.6);
        return rand(1500, 3000);
      },
      () => { // double blink
        blink(true);
        return rand(800, 1800);
      }
    ],

    listening: [
      () => { // lean in, eyes on the user
        ch.y.target = -1.5;
        ch.sx.target = 1.012;
        ch.sy.target = 1.012;
        look(rand(-0.8, 0.8), rand(-0.3, 0.6));
        return rand(1200, 2600);
      },
      () => { // attentive tilt
        const t = temper();
        ch.rot.target = pick([-1, 1]) * t.tilt * rand(0.3, 0.6);
        return rand(1300, 2600);
      },
      () => {
        if (chance(0.5)) blink(false);
        return rand(900, 2000);
      }
    ],

    thinking: [
      () => { // look up and away
        const t = temper();
        look(pick([-1, 1]) * rand(2.5, t.look), -rand(2.5, 4));
        ch.rot.target = rand(-t.tilt, t.tilt) * 0.6;
        return rand(700, 1600);
      },
      () => { // look down, considering
        look(rand(-2, 2), rand(1, 2.5));
        ch.y.target = 1;
        return rand(600, 1200);
      },
      () => { // small "hmm" squish
        const t = temper();
        ch.sx.target = 1 + t.squish * 0.6;
        ch.sy.target = 1 - t.squish * 0.6;
        later(() => { ch.sx.target = 1; ch.sy.target = 1; }, 260);
        return rand(500, 1000);
      },
      () => {
        blink(chance(0.3));
        return rand(500, 1000);
      }
    ],

    speaking: [
      () => { // eyes on the user
        look(rand(-0.6, 0.6), rand(-0.3, 0.3));
        return rand(1200, 2800);
      },
      () => { // glance away while talking, then back
        const t = temper();
        look(pick([-1, 1]) * rand(2, t.look * 0.8), rand(-2, 0.5));
        later(() => look(0, 0), rand(500, 900));
        return rand(1300, 2600);
      },
      () => { // expressive tilt
        const t = temper();
        ch.rot.target = rand(-t.tilt, t.tilt) * 0.5;
        return rand(900, 2000);
      },
      () => {
        blink(false);
        return rand(1000, 2200);
      }
    ]
  };

  function runBehaviour(now) {
    const list = BEHAVIOURS[phase] || BEHAVIOURS.idle;
    const duration = pick(list)();
    nextActionAt = now + duration * temper().pace;
  }

  /* ---------------- reactions ---------------- */

  function onPhase(next) {
    if (!next || next === phase) {
      return;
    }
    const prev = phase;
    phase = next;
    clearLater();
    settle();

    if (next === "listening") {
      hop(prev === "idle" ? 0.7 : 0.4); // perk up
      look(0, 0);
    } else if (next === "thinking") {
      ch.y.target = 1.5; // settle into thought
      look(pick([-1, 1]) * 3, -3);
    } else if (next === "speaking") {
      ch.y.target = -2; // lift to speak
      look(0, 0);
      later(() => { ch.y.target = 0; }, 260);
    } else if (next === "interrupted") {
      ch.sy.target = 0.96; // flinch
      ch.sx.target = 1.03;
      look(0, 0);
      later(settle, 220);
    } else if (next === "error") {
      ch.rot.target = -4;
    }

    nextActionAt = performance.now() + rand(600, 1300);
  }

  window.addEventListener("neyo:mascot-render", event => {
    onPhase(event.detail?.phase);
  });

  window.addEventListener("neyo:voice-mic-level", event => {
    micLevel = Math.max(0, Math.min(1, Number(event.detail?.level) || 0));
  });

  window.addEventListener("neyo:voice-output-level", event => {
    outLevel = Math.max(0, Math.min(1, Number(event.detail?.level) || 0));
  });

  /* ---------------- frame loop ---------------- */

  let lastFrame = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    const visible = mascot.offsetParent !== null || mascot.getClientRects().length > 0;

    if (!visible || reduceMotion?.matches) {
      requestAnimationFrame(frame);
      return;
    }

    // keep phase in sync even if no render event fired
    const domPhase = mascot.dataset.phase;
    if (domPhase && domPhase !== phase) {
      onPhase(domPhase);
    }

    // listening: nod when the user pauses after speaking
    if (phase === "listening") {
      micPeak = Math.max(micPeak * 0.985, micLevel);
      if (micPeak > 0.28 && micLevel < micPeak * 0.35 && now - lastNod > 900) {
        if (chance(0.55)) nod(0.8);
        lastNod = now;
        micPeak = micLevel;
      }
      // lean in a bit more while they talk loudly
      if (micLevel > 0.12 && now - lastNod > 350) {
        ch.y.target = Math.min(ch.y.target, -micLevel * 2.5);
      }
    }

    // speaking: nod on emphasis (sudden rise above average)
    if (phase === "speaking") {
      outAvg += (outLevel - outAvg) * 0.06;
      if (outLevel > 0.35 && outLevel > outAvg * 1.55 && now - lastNod > rand(450, 900)) {
        nod(0.5 + temper().energy * 0.4);
        lastNod = now;
      }
    }

    if (now >= nextActionAt) {
      runBehaviour(now);
    }

    stepSprings(dt);
    write();
    requestAnimationFrame(frame);
  }

  nextActionAt = performance.now() + 800;
  requestAnimationFrame(frame);
})();
