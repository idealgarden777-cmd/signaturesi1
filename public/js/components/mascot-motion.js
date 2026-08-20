/*
=========================================================
NEYO — PREMIUM MASCOT MOTION ENGINE v2

Purpose:
- Visible but premium natural mascot movement
- Automatic activation when Voice Mode opens
- Idle breathing / floating
- Listening attention
- Thinking scan
- Speaking movement from REAL assistant audio
- Pointer gaze + subtle 3D tilt
- Micro eye movement
- Natural mouth physics
- Interruption reaction
- Tone-aware movement
- Mobile + desktop safe
- Reduced-motion support

Works with:
voice.js
mascot.js
mascot-tone.js
voice-mode.js
mascot.css
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     DOM
     ===================================================== */

  const mascot =
    document.getElementById("neyoMascot");

  const face =
    mascot?.querySelector(
      ".neyo-mascot-face"
    );

  const features =
    mascot?.querySelector(
      ".neyo-mascot-features"
    );

  const leftEye =
    document.getElementById(
      "neyoMascotLeftEye"
    );

  const rightEye =
    document.getElementById(
      "neyoMascotRightEye"
    );

  const mouth =
    document.getElementById(
      "neyoMascotMouth"
    );

  const mouthBars =
    mouth
      ? Array.from(
          mouth.querySelectorAll(
            ".neyo-mouth-bar"
          )
        )
      : [];

  const voiceShell =
    document.getElementById(
      "neyoVoiceMode"
    );


  if (
    !mascot ||
    !face ||
    !leftEye ||
    !rightEye
  ) {
    console.warn(
      "[NEYO Motion] Required mascot DOM missing."
    );

    return;
  }


  /* =====================================================
     REDUCED MOTION
     ===================================================== */

  const motionPreference =
    window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

  let reducedMotion =
    motionPreference.matches;


  motionPreference
    .addEventListener?.(
      "change",
      event => {
        reducedMotion =
          event.matches;

        if (reducedMotion) {
          resetVisualMotion();
        }
      }
    );


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({

      pointer:
        true,

      microGaze:
        true,

      /*
      Slightly stronger than previous version
      so movement is actually visible.
      */

      pointerRotateX:
        3.2,

      pointerRotateY:
        3.8,

      pointerTranslateX:
        2.2,

      pointerTranslateY:
        1.5,

      pointerSmoothing:
        0.10,

      bodySmoothing:
        0.075,

      gazeSmoothing:
        0.10,

      energyRise:
        0.22,

      energyFall:
        0.10,

      microGazeMinMs:
        1200,

      microGazeMaxMs:
        3200,

      microGazeX:
        2.2,

      microGazeY:
        1.5,

      maxEyePointerX:
        3.4,

      maxEyePointerY:
        2.3
    });


  /* =====================================================
     PHASE MOTION PROFILES
     ===================================================== */

  const MOTION =
    Object.freeze({

      idle: {
        floatY:
          4.2,

        floatX:
          1.15,

        rotate:
          0.70,

        scale:
          0.010,

        speed:
          0.78
      },


      listening: {
        floatY:
          1.4,

        floatX:
          0.45,

        rotate:
          0.24,

        scale:
          0.005,

        speed:
          0.72
      },


      thinking: {
        floatY:
          2.2,

        floatX:
          1.15,

        rotate:
          0.82,

        scale:
          0.006,

        speed:
          0.62
      },


      speaking: {
        floatY:
          2.2,

        floatX:
          0.70,

        rotate:
          0.38,

        scale:
          0.008,

        speed:
          1.05
      },


      interrupted: {
        floatY:
          0.4,

        floatX:
          0,

        rotate:
          0,

        scale:
          0.002,

        speed:
          1
      },


      error: {
        floatY:
          0.6,

        floatX:
          0,

        rotate:
          0.18,

        scale:
          0,

        speed:
          0.5
      },


      muted: {
        floatY:
          1.1,

        floatX:
          0.20,

        rotate:
          0.10,

        scale:
          0.002,

        speed:
          0.55
      }
    });


  /* =====================================================
     TONE ENERGY
     ===================================================== */

  const TONE =
    Object.freeze({

      friendly:
        1,

      happy:
        1.18,

      excited:
        1.42,

      calm:
        0.68,

      focused:
        0.72,

      curious:
        1.02,

      surprised:
        1.35,

      confused:
        0.88,

      skeptical:
        0.76,

      empathetic:
        0.70,

      playful:
        1.22,

      serious:
        0.60
    });


  /* =====================================================
     STATE
     ===================================================== */

  const state = {

    active:
      false,

    phase:
      "idle",

    tone:
      "friendly",

    micTarget:
      0,

    micLevel:
      0,

    outputTarget:
      0,

    outputLevel:
      0,

    pointerInside:
      false,

    pointerTargetX:
      0,

    pointerTargetY:
      0,

    pointerX:
      0,

    pointerY:
      0,

    microTargetX:
      0,

    microTargetY:
      0,

    microX:
      0,

    microY:
      0,

    nextMicroGaze:
      0
  };


  const body = {

    x:
      0,

    y:
      0,

    rotation:
      0,

    scale:
      1,

    tiltX:
      0,

    tiltY:
      0
  };


  const mouthEnergy =
    mouthBars.map(
      () => 1
    );


  let raf =
    0;


  /* =====================================================
     HELPERS
     ===================================================== */

  function clamp(
    value,
    min,
    max
  ) {
    return Math.max(
      min,
      Math.min(
        max,
        value
      )
    );
  }


  function lerp(
    current,
    target,
    amount
  ) {
    return (
      current +
      (
        target -
        current
      ) *
      amount
    );
  }


  function random(
    min,
    max
  ) {
    return (
      min +
      Math.random() *
      (
        max -
        min
      )
    );
  }


  function shellOpen() {
    return Boolean(
      voiceShell
        ?.classList
        .contains(
          "is-open"
        )
    );
  }


  function getPhase() {
    return (
      mascot.dataset.phase ||
      state.phase ||
      "idle"
    );
  }


  function getTone() {
    return (
      mascot.dataset.tone ||
      state.tone ||
      "friendly"
    );
  }


  function toneEnergy() {
    return (
      TONE[getTone()] ??
      1
    );
  }


  /* =====================================================
     ACTIVATION

     This fixes the biggest issue:
     engine no longer depends only on
     one specific event firing.
     ===================================================== */

  function activate() {

    if (state.active) {
      return;
    }


    state.active =
      true;


    state.phase =
      getPhase();


    state.tone =
      getTone();


    state.nextMicroGaze =
      performance.now() +
      800;


    console.log(
      "[NEYO Motion] ACTIVE",
      {
        phase:
          state.phase,

        tone:
          state.tone
      }
    );
  }


  function deactivate() {

    state.active =
      false;


    state.micTarget =
      0;

    state.outputTarget =
      0;


    resetVisualMotion();


    console.log(
      "[NEYO Motion] INACTIVE"
    );
  }


  /* =====================================================
     VOICE SHELL OBSERVER

     Even if voice-open event was emitted
     before this module loaded, motion starts.
     ===================================================== */

  if (voiceShell) {

    const shellObserver =
      new MutationObserver(
        () => {

          if (shellOpen()) {

            activate();

          } else {

            deactivate();
          }
        }
      );


    shellObserver.observe(
      voiceShell,
      {
        attributes:
          true,

        attributeFilter:
          [
            "class",
            "aria-hidden"
          ]
      }
    );


    if (shellOpen()) {
      activate();
    }
  }


  /* =====================================================
     POINTER
     ===================================================== */

  function pointerMove(event) {

    if (
      !CONFIG.pointer ||
      !state.active ||
      reducedMotion
    ) {
      return;
    }


    const rect =
      mascot
        .getBoundingClientRect();


    if (
      !rect.width ||
      !rect.height
    ) {
      return;
    }


    const cx =
      rect.left +
      rect.width / 2;


    const cy =
      rect.top +
      rect.height / 2;


    state.pointerTargetX =
      clamp(
        (
          event.clientX -
          cx
        ) /
        (
          rect.width *
          0.72
        ),
        -1,
        1
      );


    state.pointerTargetY =
      clamp(
        (
          event.clientY -
          cy
        ) /
        (
          rect.height *
          0.72
        ),
        -1,
        1
      );


    state.pointerInside =
      true;
  }


  function pointerLeave() {

    state.pointerInside =
      false;

    state.pointerTargetX =
      0;

    state.pointerTargetY =
      0;
  }


  voiceShell
    ?.addEventListener(
      "pointermove",
      pointerMove,
      {
        passive:
          true
      }
    );


  voiceShell
    ?.addEventListener(
      "pointerleave",
      pointerLeave,
      {
        passive:
          true
      }
    );


  /* =====================================================
     MICRO GAZE
     ===================================================== */

  function updateMicroGaze(now) {

    if (
      !CONFIG.microGaze ||
      !state.active ||
      reducedMotion
    ) {
      return;
    }


    if (state.pointerInside) {

      state.microTargetX =
        0;

      state.microTargetY =
        0;

      return;
    }


    const phase =
      getPhase();


    if (
      phase ===
        "interrupted" ||
      phase ===
        "error"
    ) {

      state.microTargetX =
        0;

      state.microTargetY =
        0;

      return;
    }


    if (
      now <
      state.nextMicroGaze
    ) {
      return;
    }


    state.nextMicroGaze =
      now +
      random(
        CONFIG.microGazeMinMs,
        CONFIG.microGazeMaxMs
      );


    let multiplier =
      1;


    if (
      phase ===
      "listening"
    ) {

      multiplier =
        0.40;
    }


    if (
      phase ===
      "speaking"
    ) {

      multiplier =
        0.35;
    }


    if (
      phase ===
      "thinking"
    ) {

      multiplier =
        1.35;
    }


    state.microTargetX =
      random(
        -CONFIG.microGazeX,
        CONFIG.microGazeX
      ) *
      multiplier;


    state.microTargetY =
      random(
        -CONFIG.microGazeY,
        CONFIG.microGazeY
      ) *
      multiplier;
  }


  /* =====================================================
     EYES
     ===================================================== */

  function updateEyes(
    now
  ) {

    updateMicroGaze(
      now
    );


    state.pointerX =
      lerp(
        state.pointerX,
        state.pointerTargetX,
        CONFIG.pointerSmoothing
      );


    state.pointerY =
      lerp(
        state.pointerY,
        state.pointerTargetY,
        CONFIG.pointerSmoothing
      );


    state.microX =
      lerp(
        state.microX,
        state.microTargetX,
        CONFIG.gazeSmoothing
      );


    state.microY =
      lerp(
        state.microY,
        state.microTargetY,
        CONFIG.gazeSmoothing
      );


    let x =
      state.microX;


    let y =
      state.microY;


    if (state.pointerInside) {

      x +=
        state.pointerX *
        CONFIG.maxEyePointerX;


      y +=
        state.pointerY *
        CONFIG.maxEyePointerY;
    }


    const phase =
      getPhase();


    /*
    Thinking scan.
    */

    if (
      phase === "thinking" &&
      !state.pointerInside
    ) {

      const time =
        now /
        1000;


      x +=
        Math.sin(
          time * 1.12
        ) *
        2.3;


      y +=
        Math.sin(
          time * 0.72
        ) *
        1.0;
    }


    leftEye.style.translate =
      `${(
        x -
        0.18
      ).toFixed(2)}px ${(
        y +
        0.06
      ).toFixed(2)}px`;


    rightEye.style.translate =
      `${(
        x +
        0.18
      ).toFixed(2)}px ${(
        y -
        0.06
      ).toFixed(2)}px`;
  }


  /* =====================================================
     ENERGY
     ===================================================== */

  function updateEnergy() {

    const micAmount =
      state.micTarget >
      state.micLevel
        ? CONFIG.energyRise
        : CONFIG.energyFall;


    const outputAmount =
      state.outputTarget >
      state.outputLevel
        ? CONFIG.energyRise
        : CONFIG.energyFall;


    state.micLevel =
      lerp(
        state.micLevel,
        state.micTarget,
        micAmount
      );


    state.outputLevel =
      lerp(
        state.outputLevel,
        state.outputTarget,
        outputAmount
      );
  }


  /* =====================================================
     BODY
     ===================================================== */

  function updateBody(now) {

    const phase =
      getPhase();


    const profile =
      MOTION[phase] ||
      MOTION.idle;


    const emotion =
      toneEnergy();


    const time =
      now /
      1000;


    /*
    Two overlapping waves prevent
    robotic perfect sinusoidal motion.
    */

    let y =
      (
        Math.sin(
          time *
          profile.speed *
          1.18
        ) *
        profile.floatY
      ) +
      (
        Math.sin(
          time *
          profile.speed *
          0.51 +
          1.3
        ) *
        profile.floatY *
        0.20
      );


    let x =
      (
        Math.sin(
          time *
          profile.speed *
          0.57 +
          0.8
        ) *
        profile.floatX
      );


    let rotation =
      (
        Math.sin(
          time *
          profile.speed *
          0.48
        ) *
        profile.rotate
      );


    let scale =
      1 +
      (
        Math.sin(
          time *
          profile.speed *
          1.30
        ) *
        profile.scale
      );


    y *=
      emotion;


    x *=
      emotion;


    rotation *=
      emotion;


    /*
    Listening becomes attentive:
    stronger user speech = less idle drift.
    */

    if (
      phase ===
      "listening"
    ) {

      const stillness =
        1 -
        state.micLevel *
        0.62;


      x *=
        stillness;


      y *=
        stillness;


      rotation *=
        stillness;


      /*
      Tiny forward energy while user speaks.
      */

      scale +=
        state.micLevel *
        0.003;
    }


    /*
    Speaking uses actual assistant audio.
    */

    if (
      phase ===
      "speaking"
    ) {

      y -=
        state.outputLevel *
        1.25;


      scale +=
        state.outputLevel *
        0.009;


      rotation +=
        Math.sin(
          time * 4.3
        ) *
        state.outputLevel *
        0.17;
    }


    let tiltX =
      0;


    let tiltY =
      0;


    if (
      state.pointerInside &&
      CONFIG.pointer
    ) {

      x +=
        state.pointerX *
        CONFIG.pointerTranslateX;


      y +=
        state.pointerY *
        CONFIG.pointerTranslateY;


      tiltX =
        -state.pointerY *
        CONFIG.pointerRotateX;


      tiltY =
        state.pointerX *
        CONFIG.pointerRotateY;
    }


    body.x =
      lerp(
        body.x,
        x,
        CONFIG.bodySmoothing
      );


    body.y =
      lerp(
        body.y,
        y,
        CONFIG.bodySmoothing
      );


    body.rotation =
      lerp(
        body.rotation,
        rotation,
        CONFIG.bodySmoothing
      );


    body.scale =
      lerp(
        body.scale,
        scale,
        CONFIG.bodySmoothing
      );


    body.tiltX =
      lerp(
        body.tiltX,
        tiltX,
        CONFIG.bodySmoothing
      );


    body.tiltY =
      lerp(
        body.tiltY,
        tiltY,
        CONFIG.bodySmoothing
      );


    /*
    Important:
    transform applied on ROOT mascot.
    Face CSS remains independent.
    */

    mascot.style.transform =
      `
        translate3d(
          ${body.x.toFixed(2)}px,
          ${body.y.toFixed(2)}px,
          0
        )
        rotate(${body.rotation.toFixed(3)}deg)
        scale(${body.scale.toFixed(4)})
      `;


    /*
    Tiny pseudo-3D face transform.
    */

    face.style.transform =
      `
        perspective(800px)
        rotateX(${body.tiltX.toFixed(2)}deg)
        rotateY(${body.tiltY.toFixed(2)}deg)
      `;
  }


  /* =====================================================
     MOUTH PHYSICS
     ===================================================== */

  function updateMouth(now) {

    if (!mouthBars.length) {
      return;
    }


    const phase =
      getPhase();


    if (
      phase !==
      "speaking"
    ) {

      for (
        let i = 0;
        i < mouthBars.length;
        i += 1
      ) {

        mouthEnergy[i] =
          lerp(
            mouthEnergy[i],
            1,
            0.15
          );


        mouthBars[i]
          .style
          .removeProperty(
            "--motion-mouth-scale"
          );


        mouthBars[i]
          .style
          .removeProperty(
            "--motion-mouth-y"
          );
      }


      return;
    }


    const weights =
      [
        0.42,
        0.74,
        1,
        0.80,
        0.47
      ];


    const time =
      now /
      1000;


    for (
      let i = 0;
      i < mouthBars.length;
      i += 1
    ) {

      const waveA =
        Math.sin(
          time *
          (
            6.2 +
            i * 0.73
          ) +
          i * 1.4
        );


      const waveB =
        Math.sin(
          time *
          (
            10.3 +
            i * 0.39
          ) +
          0.7
        );


      const irregular =
        0.82 +
        waveA *
        0.11 +
        waveB *
        0.06;


      const target =
        1 +
        state.outputLevel *
        weights[i] *
        irregular *
        0.90;


      const smoothing =
        target >
        mouthEnergy[i]
          ? 0.32
          : 0.18;


      mouthEnergy[i] =
        lerp(
          mouthEnergy[i],
          target,
          smoothing
        );


      const y =
        Math.sin(
          time * 3.8 +
          i * 0.77
        ) *
        state.outputLevel *
        0.85;


      /*
      CSS variables instead of overriding
      the expression system's transform.
      */

      mouthBars[i]
        .style
        .setProperty(
          "--motion-mouth-scale",
          mouthEnergy[i]
            .toFixed(3)
        );


      mouthBars[i]
        .style
        .setProperty(
          "--motion-mouth-y",
          `${y.toFixed(2)}px`
        );
    }
  }


  /* =====================================================
     EVENT ANIMATIONS
     ===================================================== */

  function listeningReaction() {

    if (
      reducedMotion ||
      !state.active
    ) {
      return;
    }


    face.animate(
      [
        {
          scale:
            "1"
        },

        {
          scale:
            "0.985",
          offset:
            0.42
        },

        {
          scale:
            "1"
        }
      ],
      {
        duration:
          320,

        easing:
          "cubic-bezier(.22,.88,.32,1)"
      }
    );
  }


  function speakingReaction() {

    if (
      reducedMotion ||
      !state.active
    ) {
      return;
    }


    face.animate(
      [
        {
          scale:
            "0.99"
        },

        {
          scale:
            "1.018",
          offset:
            0.42
        },

        {
          scale:
            "1"
        }
      ],
      {
        duration:
          390,

        easing:
          "cubic-bezier(.22,.88,.32,1)"
      }
    );
  }


  function interruptionReaction() {

    if (
      reducedMotion ||
      !state.active
    ) {
      return;
    }


    face.animate(
      [
        {
          transform:
            "translateX(0)"
        },

        {
          transform:
            "translateX(-3px)",
          offset:
            0.38
        },

        {
          transform:
            "translateX(1px)",
          offset:
            0.72
        },

        {
          transform:
            "translateX(0)"
        }
      ],
      {
        duration:
          230,

        easing:
          "cubic-bezier(.22,.88,.32,1)"
      }
    );
  }


  /* =====================================================
     RESET
     ===================================================== */

  function resetVisualMotion() {

    state.pointerInside =
      false;

    state.pointerTargetX =
      0;

    state.pointerTargetY =
      0;

    state.pointerX =
      0;

    state.pointerY =
      0;

    state.microTargetX =
      0;

    state.microTargetY =
      0;

    state.microX =
      0;

    state.microY =
      0;


    body.x =
      0;

    body.y =
      0;

    body.rotation =
      0;

    body.scale =
      1;

    body.tiltX =
      0;

    body.tiltY =
      0;


    mascot.style.removeProperty(
      "transform"
    );


    face.style.removeProperty(
      "transform"
    );


    leftEye.style.removeProperty(
      "translate"
    );


    rightEye.style.removeProperty(
      "translate"
    );


    for (
      const bar
      of mouthBars
    ) {

      bar.style.removeProperty(
        "--motion-mouth-scale"
      );


      bar.style.removeProperty(
        "--motion-mouth-y"
      );
    }
  }


  /* =====================================================
     VOICE EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:voice-open",
    () => {

      activate();
    }
  );


  window.addEventListener(
    "neyo:voice-close",
    () => {

      deactivate();
    }
  );


  window.addEventListener(
    "neyo:voice-idle",
    event => {

      state.phase =
        "idle";


      if (
        event?.detail?.tone
      ) {

        state.tone =
          event.detail.tone;
      }
    }
  );


  window.addEventListener(
    "neyo:voice-listening",
    event => {

      const previous =
        state.phase;


      state.phase =
        "listening";


      if (
        event?.detail?.tone
      ) {

        state.tone =
          event.detail.tone;
      }


      if (
        previous !==
        "listening"
      ) {

        listeningReaction();
      }
    }
  );


  window.addEventListener(
    "neyo:voice-thinking",
    event => {

      state.phase =
        "thinking";


      if (
        event?.detail?.tone
      ) {

        state.tone =
          event.detail.tone;
      }
    }
  );


  window.addEventListener(
    "neyo:voice-speaking",
    event => {

      const previous =
        state.phase;


      state.phase =
        "speaking";


      if (
        event?.detail?.tone
      ) {

        state.tone =
          event.detail.tone;
      }


      if (
        previous !==
        "speaking"
      ) {

        speakingReaction();
      }
    }
  );


  window.addEventListener(
    "neyo:voice-interrupted",
    () => {

      state.phase =
        "interrupted";


      state.outputTarget =
        0;


      interruptionReaction();
    }
  );


  window.addEventListener(
    "neyo:voice-error",
    () => {

      state.phase =
        "error";


      state.micTarget =
        0;

      state.outputTarget =
        0;
    }
  );


  /* =====================================================
     IMPORTANT FALLBACK BRIDGE

     Mascot renderer becomes another
     state source, preventing desync.
     ===================================================== */

  window.addEventListener(
    "neyo:mascot-render",
    event => {

      const detail =
        event?.detail;


      if (!detail) {
        return;
      }


      if (detail.phase) {

        state.phase =
          detail.phase;
      }


      if (detail.tone) {

        state.tone =
          detail.tone;
      }


      if (
        shellOpen() &&
        !state.active
      ) {

        activate();
      }
    }
  );


  /* =====================================================
     TONE
     ===================================================== */

  window.addEventListener(
    "neyo:mascot-tone",
    event => {

      const tone =
        event?.detail?.tone;


      if (tone) {

        state.tone =
          tone;
      }
    }
  );


  /* =====================================================
     REAL AUDIO ENERGY
     ===================================================== */

  window.addEventListener(
    "neyo:voice-mic-level",
    event => {

      state.micTarget =
        clamp(
          Number(
            event?.detail?.level
          ) || 0,
          0,
          1
        );
    }
  );


  window.addEventListener(
    "neyo:voice-output-level",
    event => {

      state.outputTarget =
        clamp(
          Number(
            event?.detail?.level
          ) || 0,
          0,
          1
        );
    }
  );


  /* =====================================================
     MAIN LOOP
     ===================================================== */

  function animate(now) {

    raf =
      requestAnimationFrame(
        animate
      );


    /*
    Automatic recovery:
    if UI is open, engine must be active.
    */

    if (
      shellOpen() &&
      !state.active
    ) {

      activate();
    }


    if (
      !state.active ||
      reducedMotion
    ) {
      return;
    }


    updateEnergy();

    updateEyes(
      now
    );

    updateBody(
      now
    );

    updateMouth(
      now
    );
  }


  /* =====================================================
     MANUAL TEST
     ===================================================== */

  function pulse() {

    activate();


    face.animate(
      [
        {
          scale:
            "1"
        },

        {
          scale:
            "1.05"
        },

        {
          scale:
            "1"
        }
      ],
      {
        duration:
          500,

        easing:
          "cubic-bezier(.22,.88,.32,1)"
      }
    );
  }


  /* =====================================================
     PUBLIC API
     ===================================================== */

  window.NeyoMascotMotion =
    Object.freeze({

      activate,

      deactivate,

      pulse,

      reset:
        resetVisualMotion,

      getState:
        () => ({
          active:
            state.active,

          phase:
            state.phase,

          tone:
            state.tone,

          micLevel:
            state.micLevel,

          outputLevel:
            state.outputLevel,

          shellOpen:
            shellOpen(),

          reducedMotion
        })
    });


  /* =====================================================
     INIT
     ===================================================== */

  if (shellOpen()) {
    activate();
  }


  raf =
    requestAnimationFrame(
      animate
    );


  console.log(
    "[NEYO Motion] Premium Motion v2 loaded"
  );

})();
