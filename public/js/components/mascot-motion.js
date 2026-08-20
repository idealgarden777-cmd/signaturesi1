/*
=========================================================
NEYO — PREMIUM MASCOT MOTION ENGINE

Purpose:
- Natural floating / breathing
- State-aware body motion
- Pointer gaze
- Micro eye movements
- Speaking motion from real output energy
- Listening acknowledgement
- Thinking scan
- Subtle emotional body language
- Smooth inertia
- 60fps requestAnimationFrame loop

Architecture:
voice.js
   ↓
mascot.js           → expression / mood / eye / mouth
   ↓
mascot-motion.js    → physical movement / life

Does NOT own:
- Gemini
- WebSocket
- voice state decisions
- tone detection
- eye geometry
- mouth geometry
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

  const voiceStage =
    voiceShell?.querySelector(
      ".voice-mode-stage"
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

  const reducedMotionQuery =
    window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );


  let reducedMotion =
    reducedMotionQuery.matches;


  reducedMotionQuery.addEventListener?.(
    "change",
    event => {
      reducedMotion =
        event.matches;
    }
  );


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({

      pointerEnabled:
        true,

      microGazeEnabled:
        true,

      maxPointerRotateX:
        2.8,

      maxPointerRotateY:
        3.2,

      maxPointerTranslate:
        1.8,

      pointerSmoothing:
        0.075,

      motionSmoothing:
        0.055,

      gazeSmoothing:
        0.085,

      energySmoothing:
        0.12,

      microGazeMinMs:
        1500,

      microGazeMaxMs:
        4200,

      microGazeX:
        1.8,

      microGazeY:
        1.2,

      listeningNodDuration:
        340,

      speakingStartDuration:
        380,

      interruptionDuration:
        220,

      idlePhaseSpeed:
        1.0
    });


  /* =====================================================
     MOTION PROFILES

     Keep amplitudes intentionally small.
     Premium movement = controlled movement.
     ===================================================== */

  const MOTION =
    Object.freeze({

      idle: {
        floatY:
          1.9,

        floatX:
          0.35,

        rotate:
          0.28,

        scale:
          0.004,

        speed:
          1.0
      },


      listening: {
        floatY:
          0.65,

        floatX:
          0.18,

        rotate:
          0.12,

        scale:
          0.003,

        speed:
          0.82
      },


      thinking: {
        floatY:
          0.9,

        floatX:
          0.45,

        rotate:
          0.42,

        scale:
          0.0025,

        speed:
          0.72
      },


      speaking: {
        floatY:
          0.7,

        floatX:
          0.20,

        rotate:
          0.16,

        scale:
          0.0045,

        speed:
          1.12
      },


      interrupted: {
        floatY:
          0,

        floatX:
          0,

        rotate:
          0,

        scale:
          0,

        speed:
          1
      },


      error: {
        floatY:
          0.15,

        floatX:
          0,

        rotate:
          0.08,

        scale:
          0,

        speed:
          0.6
      }
    });


  /* =====================================================
     TONE MODIFIERS
     ===================================================== */

  const TONE_MOTION =
    Object.freeze({

      friendly: {
        energy:
          1
      },

      happy: {
        energy:
          1.12
      },

      excited: {
        energy:
          1.34
      },

      calm: {
        energy:
          0.70
      },

      focused: {
        energy:
          0.72
      },

      curious: {
        energy:
          0.95
      },

      surprised: {
        energy:
          1.25
      },

      confused: {
        energy:
          0.82
      },

      skeptical: {
        energy:
          0.72
      },

      empathetic: {
        energy:
          0.72
      },

      playful: {
        energy:
          1.15
      },

      serious: {
        energy:
          0.58
      }
    });


  /* =====================================================
     RUNTIME STATE
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

    nextMicroGazeAt:
      0,

    listeningAcknowledged:
      false,

    lastTimestamp:
      performance.now()
  };


  /* =====================================================
     INTERNAL MOTION VALUES
     ===================================================== */

  const motion = {

    x:
      0,

    y:
      0,

    rotation:
      0,

    scale:
      1,

    targetX:
      0,

    targetY:
      0,

    targetRotation:
      0,

    targetScale:
      1
  };


  const barEnergy =
    mouthBars.map(
      () => 0
    );


  let rafId =
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


  function randomBetween(
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


  function getProfile() {
    return (
      MOTION[getPhase()] ||
      MOTION.idle
    );
  }


  function getToneEnergy() {
    return (
      TONE_MOTION[getTone()]
        ?.energy ||
      1
    );
  }


  /* =====================================================
     POINTER GAZE
     ===================================================== */

  function handlePointerMove(
    event
  ) {

    if (
      reducedMotion ||
      !CONFIG.pointerEnabled ||
      !state.active
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


    const centerX =
      rect.left +
      rect.width / 2;


    const centerY =
      rect.top +
      rect.height / 2;


    const normalizedX =
      clamp(
        (
          event.clientX -
          centerX
        ) /
        (
          rect.width *
          0.75
        ),
        -1,
        1
      );


    const normalizedY =
      clamp(
        (
          event.clientY -
          centerY
        ) /
        (
          rect.height *
          0.75
        ),
        -1,
        1
      );


    state.pointerInside =
      true;


    state.pointerTargetX =
      normalizedX;


    state.pointerTargetY =
      normalizedY;
  }


  function handlePointerLeave() {

    state.pointerInside =
      false;

    state.pointerTargetX =
      0;

    state.pointerTargetY =
      0;
  }


  const pointerTarget =
    voiceShell ||
    voiceStage ||
    document;


  pointerTarget
    ?.addEventListener(
      "pointermove",
      handlePointerMove,
      {
        passive:
          true
      }
    );


  pointerTarget
    ?.addEventListener(
      "pointerleave",
      handlePointerLeave,
      {
        passive:
          true
      }
    );


  /* =====================================================
     MICRO GAZE

     Tiny eye adjustments help remove
     the "static icon" feeling.
     ===================================================== */

  function updateMicroGaze(
    now
  ) {

    if (
      !CONFIG.microGazeEnabled ||
      reducedMotion ||
      !state.active ||
      state.pointerInside
    ) {
      return;
    }


    const phase =
      getPhase();


    if (
      phase === "error" ||
      phase === "interrupted"
    ) {
      state.microTargetX =
        0;

      state.microTargetY =
        0;

      return;
    }


    if (
      now <
      state.nextMicroGazeAt
    ) {
      return;
    }


    state.nextMicroGazeAt =
      now +
      randomBetween(
        CONFIG.microGazeMinMs,
        CONFIG.microGazeMaxMs
      );


    let strength =
      1;


    if (
      phase ===
      "listening"
    ) {
      strength =
        0.45;
    }


    if (
      phase ===
      "speaking"
    ) {
      strength =
        0.35;
    }


    if (
      phase ===
      "thinking"
    ) {
      strength =
        1.15;
    }


    state.microTargetX =
      randomBetween(
        -CONFIG.microGazeX,
        CONFIG.microGazeX
      ) *
      strength;


    state.microTargetY =
      randomBetween(
        -CONFIG.microGazeY,
        CONFIG.microGazeY
      ) *
      strength;
  }


  /* =====================================================
     EYE MOTION
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


    let gazeX =
      state.microX;


    let gazeY =
      state.microY;


    if (
      state.pointerInside
    ) {

      gazeX +=
        state.pointerX *
        2.4;


      gazeY +=
        state.pointerY *
        1.65;
    }


    const phase =
      getPhase();


    /*
    Thinking gets a slow geometric scan.
    */

    if (
      phase === "thinking" &&
      !state.pointerInside
    ) {

      const t =
        now /
        1000;


      gazeX +=
        Math.sin(
          t * 1.05
        ) *
        1.6;


      gazeY +=
        Math.sin(
          t * 0.68
        ) *
        0.75;
    }


    /*
    Independent offsets create subtle
    binocular imperfection.
    */

    leftEye.style.translate =
      `${(
        gazeX -
        0.15
      ).toFixed(2)}px ${(
        gazeY +
        0.05
      ).toFixed(2)}px`;


    rightEye.style.translate =
      `${(
        gazeX +
        0.15
      ).toFixed(2)}px ${(
        gazeY -
        0.05
      ).toFixed(2)}px`;
  }


  /* =====================================================
     BODY / FACE MOTION
     ===================================================== */

  function updateBody(
    now
  ) {

    const phase =
      getPhase();


    const profile =
      MOTION[phase] ||
      MOTION.idle;


    const toneEnergy =
      getToneEnergy();


    const t =
      now /
      1000;


    let floatY =
      Math.sin(
        t *
        profile.speed *
        1.17
      ) *
      profile.floatY;


    let floatX =
      Math.sin(
        t *
        profile.speed *
        0.61 +
        0.8
      ) *
      profile.floatX;


    let rotation =
      Math.sin(
        t *
        profile.speed *
        0.54
      ) *
      profile.rotate;


    let scale =
      1 +
      Math.sin(
        t *
        profile.speed *
        1.33
      ) *
      profile.scale;


    floatY *=
      toneEnergy;


    floatX *=
      toneEnergy;


    rotation *=
      toneEnergy;


    /*
    Speaking gets tiny real-audio
    physical energy.
    */

    if (
      phase ===
      "speaking"
    ) {

      const energy =
        state.outputLevel;


      floatY -=
        energy *
        0.65;


      scale +=
        energy *
        0.0045;


      rotation +=
        Math.sin(
          t * 3.8
        ) *
        energy *
        0.08;
    }


    /*
    Listening becomes more still as
    user voice gets stronger.
    This feels attentive instead of noisy.
    */

    if (
      phase ===
      "listening"
    ) {

      const stillness =
        1 -
        state.micLevel *
        0.55;


      floatY *=
        stillness;


      floatX *=
        stillness;


      rotation *=
        stillness;
    }


    /*
    Pointer creates tiny dimensional tilt.
    */

    let pointerRotateY =
      0;


    let pointerRotateX =
      0;


    let pointerTranslateX =
      0;


    let pointerTranslateY =
      0;


    if (
      state.pointerInside &&
      CONFIG.pointerEnabled
    ) {

      pointerRotateY =
        state.pointerX *
        CONFIG.maxPointerRotateY;


      pointerRotateX =
        -state.pointerY *
        CONFIG.maxPointerRotateX;


      pointerTranslateX =
        state.pointerX *
        CONFIG.maxPointerTranslate;


      pointerTranslateY =
        state.pointerY *
        CONFIG.maxPointerTranslate *
        0.65;
    }


    motion.targetX =
      floatX +
      pointerTranslateX;


    motion.targetY =
      floatY +
      pointerTranslateY;


    motion.targetRotation =
      rotation;


    motion.targetScale =
      scale;


    motion.x =
      lerp(
        motion.x,
        motion.targetX,
        CONFIG.motionSmoothing
      );


    motion.y =
      lerp(
        motion.y,
        motion.targetY,
        CONFIG.motionSmoothing
      );


    motion.rotation =
      lerp(
        motion.rotation,
        motion.targetRotation,
        CONFIG.motionSmoothing
      );


    motion.scale =
      lerp(
        motion.scale,
        motion.targetScale,
        CONFIG.motionSmoothing
      );


    /*
    Use individual transform properties.
    This avoids overwriting mascot.css
    transform rules.
    */

    mascot.style.translate =
      `${motion.x.toFixed(2)}px ${motion.y.toFixed(2)}px`;


    mascot.style.rotate =
      `${motion.rotation.toFixed(3)}deg`;


    mascot.style.scale =
      motion.scale.toFixed(4);


    /*
    Face itself gets the tiny 3D response.
    */

    face.style.transformOrigin =
      "center";


    face.style.rotate =
      `${(
        pointerRotateX *
        0.03
      ).toFixed(3)}deg`;


    mascot.style.setProperty(
      "--neyo-motion-rotate-x",
      `${pointerRotateX.toFixed(2)}deg`
    );


    mascot.style.setProperty(
      "--neyo-motion-rotate-y",
      `${pointerRotateY.toFixed(2)}deg`
    );
  }


  /* =====================================================
     SPEECH MOUTH PHYSICS

     CSS already decides mouth geometry.
     JS adds natural irregular movement.

     No perfect sine-wave equalizer.
     ===================================================== */

  function updateMouth(
    now
  ) {

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

        barEnergy[i] =
          lerp(
            barEnergy[i],
            1,
            0.10
          );


        mouthBars[i]
          .style
          .removeProperty(
            "transform"
          );
      }


      return;
    }


    const weights =
      [
        0.42,
        0.74,
        1,
        0.78,
        0.46
      ];


    const t =
      now /
      1000;


    for (
      let i = 0;
      i < mouthBars.length;
      i += 1
    ) {

      const bar =
        mouthBars[i];


      const weight =
        weights[i] ||
        0.6;


      /*
      Deterministic irregular modulation,
      avoiding Math.random every frame.
      */

      const irregular =
        0.84 +
        Math.sin(
          t *
          (
            5.8 +
            i * 0.83
          ) +
          i * 1.9
        ) *
        0.11 +
        Math.sin(
          t *
          (
            9.2 +
            i * 0.41
          )
        ) *
        0.05;


      const target =
        0.82 +
        state.outputLevel *
        weight *
        irregular *
        0.55;


      const smoothing =
        target >
        barEnergy[i]
          ? 0.26
          : 0.16;


      barEnergy[i] =
        lerp(
          barEnergy[i] || 1,
          target,
          smoothing
        );


      const y =
        Math.sin(
          t * 3.3 +
          i * 0.72
        ) *
        state.outputLevel *
        0.65;


      bar.style.transform =
        `translateY(${y.toFixed(2)}px) scaleY(${barEnergy[i].toFixed(3)})`;
    }
  }


  /* =====================================================
     ENERGY
     ===================================================== */

  function updateEnergy() {

    state.micLevel =
      lerp(
        state.micLevel,
        state.micTarget,
        CONFIG.energySmoothing
      );


    state.outputLevel =
      lerp(
        state.outputLevel,
        state.outputTarget,
        CONFIG.energySmoothing
      );
  }


  /* =====================================================
     ACKNOWLEDGEMENT MOTIONS
     ===================================================== */

  function acknowledgeListening() {

    if (
      reducedMotion ||
      !state.active
    ) {
      return;
    }


    mascot.animate(
      [
        {
          transform:
            "translateY(0px) scale(1)"
        },

        {
          transform:
            "translateY(1.2px) scale(.993)",
          offset:
            0.45
        },

        {
          transform:
            "translateY(0px) scale(1)"
        }
      ],
      {
        duration:
          CONFIG.listeningNodDuration,

        easing:
          "cubic-bezier(.22,.88,.32,1)"
      }
    );
  }


  function acknowledgeSpeaking() {

    if (
      reducedMotion ||
      !state.active
    ) {
      return;
    }


    mascot.animate(
      [
        {
          transform:
            "scale(.994)"
        },

        {
          transform:
            "scale(1.012)",
          offset:
            0.42
        },

        {
          transform:
            "scale(1)"
        }
      ],
      {
        duration:
          CONFIG.speakingStartDuration,

        easing:
          "cubic-bezier(.22,.88,.32,1)"
      }
    );
  }


  function acknowledgeInterrupt() {

    if (
      reducedMotion ||
      !state.active
    ) {
      return;
    }


    mascot.animate(
      [
        {
          transform:
            "translateX(0px) scale(1)"
        },

        {
          transform:
            "translateX(-1.4px) scale(.992)",
          offset:
            0.42
        },

        {
          transform:
            "translateX(0px) scale(1)"
        }
      ],
      {
        duration:
          CONFIG.interruptionDuration,

        easing:
          "cubic-bezier(.22,.88,.32,1)"
      }
    );
  }


  /* =====================================================
     MAIN RAF LOOP
     ===================================================== */

  function animate(
    now
  ) {

    rafId =
      requestAnimationFrame(
        animate
      );


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


    state.lastTimestamp =
      now;
  }


  /* =====================================================
     RESET
     ===================================================== */

  function resetMotion() {

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

    state.micTarget =
      0;

    state.micLevel =
      0;

    state.outputTarget =
      0;

    state.outputLevel =
      0;


    motion.x =
      0;

    motion.y =
      0;

    motion.rotation =
      0;

    motion.scale =
      1;


    mascot.style.removeProperty(
      "translate"
    );

    mascot.style.removeProperty(
      "rotate"
    );

    mascot.style.removeProperty(
      "scale"
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
        "transform"
      );
    }
  }


  /* =====================================================
     VOICE EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:voice-open",
    () => {

      state.active =
        true;


      state.phase =
        "idle";


      state.nextMicroGazeAt =
        performance.now() +
        1000;


      resetMotion();
    }
  );


  window.addEventListener(
    "neyo:voice-close",
    () => {

      state.active =
        false;


      resetMotion();
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

      const previousPhase =
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
        previousPhase !==
        "listening"
      ) {

        acknowledgeListening();
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

      const previousPhase =
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
        previousPhase !==
        "speaking"
      ) {

        acknowledgeSpeaking();
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


      acknowledgeInterrupt();
    }
  );


  window.addEventListener(
    "neyo:voice-error",
    () => {

      state.phase =
        "error";


      state.outputTarget =
        0;

      state.micTarget =
        0;
    }
  );


  /* =====================================================
     TONE EVENTS
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
     ENERGY EVENTS
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
     MANUAL API
     ===================================================== */

  function setPointerEnabled(
    enabled
  ) {

    CONFIG.pointerEnabled =
      Boolean(enabled);
  }


  function pulse() {

    if (
      reducedMotion
    ) {
      return;
    }


    mascot.animate(
      [
        {
          transform:
            "scale(1)"
        },

        {
          transform:
            "scale(1.012)"
        },

        {
          transform:
            "scale(1)"
        }
      ],
      {
        duration:
          420,

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

      pulse,

      reset:
        resetMotion,

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

          pointerInside:
            state.pointerInside
        })
    });


  /* =====================================================
     INIT
     ===================================================== */

  rafId =
    requestAnimationFrame(
      animate
    );


  console.log(
    "[NEYO Motion] Premium motion engine loaded"
  );

})();
