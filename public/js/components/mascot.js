/*
=========================================================
NEYO — PREMIUM FACE ENGINE v4
Character-aware unified mascot controller

Owns:
- phase state
- active character
- mood expression rendering
- blink
- gaze
- body motion
- speech-bar motion
- mic/output energy
- character-specific expression preferences
- character-specific motion personality

Reads:
window.NeyoCharacters
window.NeyoCharacter

Works with:
- voice.js
- mascot-intelligence.js
- voice-mode.js
- public/js/characters/neyo.js

Does NOT own:
- Gemini
- semantic mood detection
- camera
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

  const statusEl =
    document.getElementById(
      "neyoMascotStatus"
    );

  const voiceShell =
    document.getElementById(
      "neyoVoiceMode"
    );


  if (
    !mascot ||
    !face ||
    !leftEye ||
    !rightEye ||
    !mouth
  ) {
    console.warn(
      "[NEYO Face] Required DOM missing."
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

      if (reducedMotion) {
        resetPhysicalMotion();
      }
    }
  );


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG = Object.freeze({

    defaultCharacter:
      "neyo",

    defaultMood:
      "friendly",

    blinkMinMs:
      3900,

    blinkMaxMs:
      7200,

    listeningBlinkMinMs:
      5200,

    listeningBlinkMaxMs:
      8800,

    blinkCloseMs:
      72,

    blinkHoldMs:
      28,

    blinkOpenMs:
      88,

    microGazeMinMs:
      1500,

    microGazeMaxMs:
      4000,

    bodySmoothing:
      0.065,

    gazeSmoothing:
      0.09,

    pointerSmoothing:
      0.08,

    energyRise:
      0.24,

    energyFall:
      0.10
  });


  /* =====================================================
     STATE
     ===================================================== */

  const state = {

    active:
      false,

    characterId:
      CONFIG.defaultCharacter,

    phase:
      "idle",

    mood:
      CONFIG.defaultMood,

    muted:
      false,

    speakerOn:
      true,

    cameraOn:
      false,

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

    blinking:
      false
  };


  const body = {

    x:
      0,

    y:
      0,

    rotation:
      0,

    scale:
      1
  };


  const speechBars =
    mouthBars.map(
      () => 1
    );


  let blinkTimer =
    0;

  let blinkAnimationTimer =
    0;

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


  function shellOpen() {
    return Boolean(
      voiceShell
        ?.classList
        .contains(
          "is-open"
        )
    );
  }


  function getCharacter(
    id = state.characterId
  ) {

    const helper =
      window.NeyoCharacter;


    if (
      helper?.get
    ) {

      return (
        helper.get(id) ||
        helper.getActive?.() ||
        null
      );
    }


    return (
      window.NeyoCharacters?.[id] ||
      window.NeyoCharacters?.neyo ||
      null
    );
  }


  function getActiveCharacter() {

    return (
      getCharacter(
        state.characterId
      ) ||
      {
        id:
          "neyo",

        visual:
          {},

        expressions:
          {},

        motion:
          {},

        phases:
          {}
      }
    );
  }


  /* =====================================================
     BASE EXPRESSION FALLBACKS
     ===================================================== */

  const BASE_EXPRESSIONS =
    Object.freeze({

      friendly: {
        eye:
          "arc",

        mouth:
          "smile"
      },

      happy: {
        eye:
          "soft-arc",

        mouth:
          "smile-wide"
      },

      excited: {
        eye:
          "round",

        mouth:
          "speak-active"
      },

      calm: {
        eye:
          "half",

        mouth:
          "smile"
      },

      focused: {
        eye:
          "pill",

        mouth:
          "neutral"
      },

      curious: {
        eye:
          "asymmetric",

        mouth:
          "curious"
      },

      surprised: {
        eye:
          "round",

        mouth:
          "surprise"
      },

      empathetic: {
        eye:
          "soft-arc",

        mouth:
          "smile"
      },

      serious: {
        eye:
          "half",

        mouth:
          "serious"
      },

      playful: {
        eye:
          "asymmetric",

        mouth:
          "smirk"
      },

      skeptical: {
        eye:
          "half",

        mouth:
          "smirk"
      },

      confused: {
        eye:
          "asymmetric",

        mouth:
          "error"
      }
    });


  /* =====================================================
     CHARACTER-AWARE EXPRESSION
     ===================================================== */

  function getCharacterExpression(
    mood
  ) {

    const character =
      getActiveCharacter();


    return (
      character
        ?.expressions
        ?.[mood] ||
      BASE_EXPRESSIONS[mood] ||
      BASE_EXPRESSIONS.friendly
    );
  }


  function resolveExpression() {

    const characterExpression =
      getCharacterExpression(
        state.mood
      );


    let eye =
      characterExpression.eye ||
      "arc";


    let mouthMode =
      characterExpression.mouth ||
      "smile";


    /*
    Phase overrides only where needed.
    Character mood remains the base identity.
    */


    if (
      state.muted
    ) {

      eye =
        "half";

      mouthMode =
        "neutral";
    }


    if (
      state.phase ===
      "thinking"
    ) {

      if (
        state.mood ===
        "curious"
      ) {

        eye =
          "loop";

        mouthMode =
          "neutral";

      } else if (
        state.mood ===
        "serious"
      ) {

        eye =
          "diamond";

        mouthMode =
          "serious";

      } else {

        eye =
          "square";

        mouthMode =
          "neutral";
      }
    }


    if (
      state.phase ===
      "listening"
    ) {

      if (
        state.mood ===
        "friendly"
      ) {

        eye =
          "oval";

        mouthMode =
          "listening";
      }


      if (
        state.mood ===
        "focused"
      ) {

        eye =
          "pill";

        mouthMode =
          "listening";
      }
    }


    if (
      state.phase ===
      "speaking"
    ) {

      switch (
        state.mood
      ) {

        case "excited":
          mouthMode =
            "speak-active";
          break;


        case "happy":
        case "playful":
        case "focused":
          mouthMode =
            "speak-medium";
          break;


        case "serious":
          mouthMode =
            "serious";
          break;


        case "curious":
          mouthMode =
            "curious";
          break;


        default:
          mouthMode =
            "speak-soft";
      }
    }


    if (
      state.phase ===
      "interrupted"
    ) {

      eye =
        "round";

      mouthMode =
        "neutral";
    }


    if (
      state.phase ===
      "error"
    ) {

      eye =
        "asymmetric";

      mouthMode =
        "error";
    }


    return {
      eye,
      mouth:
        mouthMode
    };
  }


  /* =====================================================
     STATUS
     ===================================================== */

  function getStatusText() {

    if (state.muted) {
      return "Microphone muted";
    }


    switch (
      state.phase
    ) {

      case "listening":
        return "Listening…";


      case "thinking":
        return "Thinking…";


      case "speaking":
        return `${
          getActiveCharacter()
            ?.name ||
          "NEYO"
        } is speaking`;


      case "interrupted":
        return "Listening…";


      case "error":
        return "Something went wrong";


      default:
        return "Ready";
    }
  }


  /* =====================================================
     RENDER
     ===================================================== */

  function render() {

    const character =
      getActiveCharacter();


    const expression =
      resolveExpression();


    mascot.dataset.character =
      character.id ||
      state.characterId;


    mascot.dataset.phase =
      state.phase;


    mascot.dataset.mood =
      state.mood;


    mascot.dataset.tone =
      state.mood;


    mascot.dataset.eye =
      expression.eye;


    mascot.dataset.mouth =
      expression.mouth;


    mascot.dataset.bodyShape =
      character
        ?.visual
        ?.bodyShape ||
      "rounded-square";


    mascot.dataset.surface =
      character
        ?.visual
        ?.surface ||
      "light";


    mascot.dataset.muted =
      String(
        state.muted
      );


    mascot.dataset.speaker =
      state.speakerOn
        ? "on"
        : "off";


    mascot.dataset.camera =
      state.cameraOn
        ? "on"
        : "off";


    leftEye.dataset.mode =
      expression.eye;


    rightEye.dataset.mode =
      expression.eye;


    mouth.dataset.mode =
      expression.mouth;


    mascot.style.setProperty(
      "--neyo-mic-level",
      state.micLevel
        .toFixed(3)
    );


    mascot.style.setProperty(
      "--neyo-output-level",
      state.outputLevel
        .toFixed(3)
    );


    mascot.style.setProperty(
      "--neyo-character-face-scale",
      String(
        character
          ?.visual
          ?.faceScale ??
        1
      )
    );


    mascot.style.setProperty(
      "--neyo-character-body-scale",
      String(
        character
          ?.visual
          ?.bodyScale ??
        1
      )
    );


    if (statusEl) {

      statusEl.textContent =
        getStatusText();
    }


    window.dispatchEvent(
      new CustomEvent(
        "neyo:mascot-render",
        {
          detail: {
            character:
              character.id,

            phase:
              state.phase,

            mood:
              state.mood,

            eye:
              expression.eye,

            mouth:
              expression.mouth
          }
        }
      )
    );
  }


  /* =====================================================
     CHARACTER CONTROL
     ===================================================== */

  function setCharacter(
    id,
    options = {}
  ) {

    const character =
      getCharacter(id);


    if (!character) {

      console.warn(
        "[NEYO Face] Unknown character:",
        id
      );

      return false;
    }


    state.characterId =
      character.id;


    if (
      window.NeyoCharacters
    ) {

      window.NeyoCharacters.active =
        character.id;
    }


    if (
      options.resetMood !==
      false
    ) {

      state.mood =
        character
          ?.defaultExpression
          ?.mood ||
        CONFIG.defaultMood;
    }


    render();


    if (
      !reducedMotion &&
      state.active
    ) {

      face.animate(
        [
          {
            scale:
              "0.97",
            opacity:
              0.86
          },

          {
            scale:
              "1.015",
            opacity:
              1,
            offset:
              0.58
          },

          {
            scale:
              "1",
            opacity:
              1
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


    window.dispatchEvent(
      new CustomEvent(
        "neyo:character-change",
        {
          detail: {
            id:
              character.id,

            character
          }
        }
      )
    );


    console.log(
      "[NEYO Face] Character:",
      character.id
    );


    return true;
  }


  /* =====================================================
     MOOD
     ===================================================== */

  function setMood(
    mood
  ) {

    if (
      !BASE_EXPRESSIONS[mood] &&
      !getActiveCharacter()
        ?.expressions
        ?.[mood]
    ) {
      return;
    }


    state.mood =
      mood;


    render();
  }


  /* =====================================================
     PHASE
     ===================================================== */

  function setPhase(
    phase
  ) {

    state.phase =
      phase;


    render();


    scheduleBlink();
  }


  /* =====================================================
     BLINK
     ===================================================== */

  function clearBlink() {

    clearTimeout(
      blinkTimer
    );


    clearTimeout(
      blinkAnimationTimer
    );


    state.blinking =
      false;


    mascot.classList.remove(
      "is-blinking",
      "is-blink-hold",
      "is-wink-left",
      "is-wink-right"
    );
  }


  function scheduleBlink() {

    clearTimeout(
      blinkTimer
    );


    if (
      !state.active ||
      reducedMotion ||
      state.phase ===
        "error" ||
      state.phase ===
        "interrupted"
    ) {
      return;
    }


    const delay =
      state.phase ===
      "listening"

        ? randomBetween(
            CONFIG.listeningBlinkMinMs,
            CONFIG.listeningBlinkMaxMs
          )

        : randomBetween(
            CONFIG.blinkMinMs,
            CONFIG.blinkMaxMs
          );


    blinkTimer =
      setTimeout(
        blink,
        delay
      );
  }


  function blink() {

    if (
      state.blinking ||
      !state.active
    ) {

      scheduleBlink();

      return;
    }


    state.blinking =
      true;


    const character =
      getActiveCharacter();


    const playful =
      character
        ?.personality
        ?.playfulness ||
      0;


    const allowWink =
      playful >
        0.55 &&
      [
        "happy",
        "playful"
      ].includes(
        state.mood
      );


    if (
      allowWink &&
      Math.random() >
        0.965
    ) {

      const className =
        Math.random() >
        0.5
          ? "is-wink-left"
          : "is-wink-right";


      mascot.classList.add(
        className
      );


      blinkAnimationTimer =
        setTimeout(
          () => {

            mascot.classList.remove(
              className
            );


            state.blinking =
              false;


            scheduleBlink();

          },
          190
        );


      return;
    }


    mascot.classList.add(
      "is-blinking"
    );


    setTimeout(
      () => {

        mascot.classList.add(
          "is-blink-hold"
        );

      },
      CONFIG.blinkCloseMs
    );


    blinkAnimationTimer =
      setTimeout(
        () => {

          mascot.classList.remove(
            "is-blinking",
            "is-blink-hold"
          );


          state.blinking =
            false;


          scheduleBlink();

        },
        CONFIG.blinkCloseMs +
        CONFIG.blinkHoldMs +
        CONFIG.blinkOpenMs
      );
  }


  /* =====================================================
     MICRO GAZE
     ===================================================== */

  function updateMicroGaze(
    now
  ) {

    if (
      reducedMotion ||
      !state.active ||
      state.pointerInside
    ) {
      return;
    }


    if (
      now <
      state.nextMicroGazeAt
    ) {
      return;
    }


    const character =
      getActiveCharacter();


    const gazeStrength =
      character
        ?.motion
        ?.gazeMovement ??
      0.5;


    const thinkingStrength =
      character
        ?.motion
        ?.thinkingScan ??
      0.5;


    state.nextMicroGazeAt =
      now +
      randomBetween(
        CONFIG.microGazeMinMs,
        CONFIG.microGazeMaxMs
      );


    let phaseMultiplier =
      1;


    if (
      state.phase ===
      "listening"
    ) {

      phaseMultiplier =
        0.34;
    }


    if (
      state.phase ===
      "speaking"
    ) {

      phaseMultiplier =
        0.25;
    }


    if (
      state.phase ===
      "thinking"
    ) {

      phaseMultiplier =
        0.8 +
        thinkingStrength;
    }


    state.microTargetX =
      randomBetween(
        -2,
        2
      ) *
      gazeStrength *
      phaseMultiplier;


    state.microTargetY =
      randomBetween(
        -1.2,
        1.2
      ) *
      gazeStrength *
      phaseMultiplier;
  }


  /* =====================================================
     POINTER
     ===================================================== */

  function pointerMove(event) {

    if (
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
          0.75
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
          0.75
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
     ENERGY
     ===================================================== */

  function updateEnergy() {

    const micSpeed =
      state.micTarget >
      state.micLevel
        ? CONFIG.energyRise
        : CONFIG.energyFall;


    const outputSpeed =
      state.outputTarget >
      state.outputLevel
        ? CONFIG.energyRise
        : CONFIG.energyFall;


    state.micLevel =
      lerp(
        state.micLevel,
        state.micTarget,
        micSpeed
      );


    state.outputLevel =
      lerp(
        state.outputLevel,
        state.outputTarget,
        outputSpeed
      );


    mascot.style.setProperty(
      "--neyo-mic-level",
      state.micLevel
        .toFixed(3)
    );


    mascot.style.setProperty(
      "--neyo-output-level",
      state.outputLevel
        .toFixed(3)
    );
  }


  /* =====================================================
     BODY MOTION
     ===================================================== */

  const BASE_MOTION =
    Object.freeze({

      idle: {
        y:
          2.8,

        x:
          0.7,

        rotation:
          0.38,

        scale:
          0.006,

        speed:
          0.72
      },


      listening: {
        y:
          0.8,

        x:
          0.20,

        rotation:
          0.10,

        scale:
          0.0025,

        speed:
          0.65
      },


      thinking: {
        y:
          1.3,

        x:
          0.65,

        rotation:
          0.50,

        scale:
          0.003,

        speed:
          0.58
      },


      speaking: {
        y:
          1.2,

        x:
          0.35,

        rotation:
          0.18,

        scale:
          0.004,

        speed:
          0.94
      }
    });


  function updateBody(
    now
  ) {

    const character =
      getActiveCharacter();


    const profile =
      BASE_MOTION[
        state.phase
      ] ||
      BASE_MOTION.idle;


    const motionProfile =
      character.motion ||
      {};


    const phaseProfile =
      character
        ?.phases
        ?.[state.phase] ||
      {};


    const generalEnergy =
      Number(
        phaseProfile.energy ??
        character
          ?.personality
          ?.energy ??
        0.5
      );


    const idleMotion =
      Number(
        motionProfile
          .idleFloat ??
        0.5
      );


    const speechMotion =
      Number(
        motionProfile
          .speechMovement ??
        0.5
      );


    const asymmetry =
      Number(
        motionProfile
          .asymmetry ??
        0.15
      );


    const t =
      now /
      1000;


    const baseStrength =
      0.60 +
      generalEnergy *
      0.75;


    let y =
      (
        Math.sin(
          t *
          profile.speed *
          1.20
        ) *
        profile.y
      ) +
      (
        Math.sin(
          t *
          profile.speed *
          0.51 +
          0.7
        ) *
        profile.y *
        asymmetry
      );


    let x =
      Math.sin(
        t *
        profile.speed *
        0.53 +
        1.1
      ) *
      profile.x;


    let rotation =
      Math.sin(
        t *
        profile.speed *
        0.47
      ) *
      profile.rotation;


    let scale =
      1 +
      Math.sin(
        t *
        profile.speed *
        1.34
      ) *
      profile.scale;


    if (
      state.phase ===
      "idle"
    ) {

      y *=
        0.65 +
        idleMotion;

      x *=
        0.65 +
        idleMotion;
    }


    y *=
      baseStrength;


    x *=
      baseStrength;


    rotation *=
      baseStrength;


    if (
      state.phase ===
      "listening"
    ) {

      const stillness =
        1 -
        state.micLevel *
        0.68;


      y *=
        stillness;


      x *=
        stillness;


      rotation *=
        stillness;


      scale +=
        state.micLevel *
        0.0025;
    }


    if (
      state.phase ===
      "speaking"
    ) {

      y -=
        state.outputLevel *
        (
          0.5 +
          speechMotion *
          0.8
        );


      scale +=
        state.outputLevel *
        (
          0.003 +
          speechMotion *
          0.006
        );


      rotation +=
        Math.sin(
          t * 4
        ) *
        state.outputLevel *
        speechMotion *
        0.18;
    }


    if (
      state.mood ===
      "curious"
    ) {

      rotation +=
        0.25 +
        character
          ?.personality
          ?.curiosity *
        0.30;
    }


    if (
      state.mood ===
      "skeptical"
    ) {

      rotation -=
        0.30;
    }


    if (
      state.pointerInside
    ) {

      const response =
        Number(
          motionProfile
            .pointerResponse ??
          0.3
        );


      x +=
        state.pointerX *
        response *
        3;


      y +=
        state.pointerY *
        response *
        1.6;
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


    mascot.style.setProperty(
      "--neyo-body-x",
      `${body.x.toFixed(2)}px`
    );


    mascot.style.setProperty(
      "--neyo-body-y",
      `${body.y.toFixed(2)}px`
    );


    mascot.style.setProperty(
      "--neyo-body-rotation",
      `${body.rotation.toFixed(3)}deg`
    );


    mascot.style.setProperty(
      "--neyo-body-scale",
      body.scale.toFixed(4)
    );
  }


  /* =====================================================
     GAZE
     ===================================================== */

  function updateGaze(
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


    const character =
      getActiveCharacter();


    const pointerResponse =
      Number(
        character
          ?.motion
          ?.pointerResponse ??
        0.3
      );


    let x =
      state.microX;


    let y =
      state.microY;


    if (
      state.pointerInside
    ) {

      x +=
        state.pointerX *
        (
          1.5 +
          pointerResponse *
          3
        );


      y +=
        state.pointerY *
        (
          1 +
          pointerResponse *
          2
        );
    }


    if (
      state.phase ===
        "thinking" &&
      !state.pointerInside
    ) {

      const thinking =
        Number(
          character
            ?.motion
            ?.thinkingScan ??
          0.5
        );


      const t =
        now /
        1000;


      x +=
        Math.sin(
          t *
          1.05
        ) *
        thinking *
        3;


      y +=
        Math.sin(
          t *
          0.68
        ) *
        thinking *
        1.2;
    }


    mascot.style.setProperty(
      "--neyo-gaze-x",
      `${x.toFixed(2)}px`
    );


    mascot.style.setProperty(
      "--neyo-gaze-y",
      `${y.toFixed(2)}px`
    );
  }


  /* =====================================================
     SPEECH BARS
     ===================================================== */

  function updateSpeechBars(
    now
  ) {

    if (
      !mouthBars.length
    ) {
      return;
    }


    const character =
      getActiveCharacter();


    const speechEnergy =
      Number(
        character
          ?.motion
          ?.speechMovement ??
        0.5
      );


    if (
      state.phase !==
      "speaking"
    ) {

      for (
        let i = 0;
        i <
        speechBars.length;
        i += 1
      ) {

        speechBars[i] =
          lerp(
            speechBars[i],
            1,
            0.18
          );


        mouthBars[i]
          .style
          .setProperty(
            "--neyo-speech-scale",
            speechBars[i]
              .toFixed(3)
          );


        mouthBars[i]
          .style
          .setProperty(
            "--neyo-speech-y",
            "0px"
          );
      }


      return;
    }


    const weights = [
      0.45,
      0.78,
      1,
      0.74,
      0.50
    ];


    const t =
      now /
      1000;


    for (
      let i = 0;
      i <
      mouthBars.length;
      i += 1
    ) {

      const irregular =
        0.86 +
        Math.sin(
          t *
          (
            5.8 +
            i *
            0.71
          ) +
          i
        ) *
        0.09 +
        Math.sin(
          t *
          (
            9.7 +
            i *
            0.37
          )
        ) *
        0.05;


      const target =
        1 +
        state.outputLevel *
        weights[i] *
        irregular *
        (
          0.4 +
          speechEnergy *
          0.75
        );


      speechBars[i] =
        lerp(
          speechBars[i],
          target,
          target >
            speechBars[i]
            ? 0.30
            : 0.17
        );


      const y =
        Math.sin(
          t * 3.4 +
          i * 0.78
        ) *
        state.outputLevel *
        (
          0.25 +
          speechEnergy *
          0.55
        );


      mouthBars[i]
        .style
        .setProperty(
          "--neyo-speech-scale",
          speechBars[i]
            .toFixed(3)
        );


      mouthBars[i]
        .style
        .setProperty(
          "--neyo-speech-y",
          `${y.toFixed(2)}px`
        );
    }
  }


  /* =====================================================
     RESET MOTION
     ===================================================== */

  function resetPhysicalMotion() {

    body.x =
      0;

    body.y =
      0;

    body.rotation =
      0;

    body.scale =
      1;


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


    mascot.style.setProperty(
      "--neyo-body-x",
      "0px"
    );


    mascot.style.setProperty(
      "--neyo-body-y",
      "0px"
    );


    mascot.style.setProperty(
      "--neyo-body-rotation",
      "0deg"
    );


    mascot.style.setProperty(
      "--neyo-body-scale",
      "1"
    );


    mascot.style.setProperty(
      "--neyo-gaze-x",
      "0px"
    );


    mascot.style.setProperty(
      "--neyo-gaze-y",
      "0px"
    );
  }


  /* =====================================================
     OPEN / CLOSE
     ===================================================== */

  function open() {

    state.active =
      true;


    const active =
      window
        .NeyoCharacters
        ?.active;


    if (
      active &&
      getCharacter(
        active
      )
    ) {

      state.characterId =
        active;
    }


    const character =
      getActiveCharacter();


    state.phase =
      "idle";


    state.mood =
      character
        ?.defaultExpression
        ?.mood ||
      CONFIG.defaultMood;


    state.nextMicroGazeAt =
      performance.now() +
      800;


    render();

    scheduleBlink();
  }


  function close() {

    state.active =
      false;


    clearBlink();


    state.phase =
      "idle";


    state.micTarget =
      0;

    state.outputTarget =
      0;


    resetPhysicalMotion();


    render();
  }


  /* =====================================================
     MAIN LOOP
     ===================================================== */

  function animate(now) {

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

    updateBody(
      now
    );

    updateGaze(
      now
    );

    updateSpeechBars(
      now
    );
  }


  /* =====================================================
     EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:voice-open",
    open
  );


  window.addEventListener(
    "neyo:voice-close",
    close
  );


  window.addEventListener(
    "neyo:voice-idle",
    () => {
      setPhase(
        "idle"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-listening",
    () => {
      setPhase(
        "listening"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-thinking",
    () => {
      setPhase(
        "thinking"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-speaking",
    () => {
      setPhase(
        "speaking"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-interrupted",
    () => {

      state.outputTarget =
        0;


      state.mood =
        "surprised";


      setPhase(
        "interrupted"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-error",
    () => {

      state.mood =
        "confused";


      setPhase(
        "error"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-mic-level",
    event => {

      state.micTarget =
        clamp(
          Number(
            event
              ?.detail
              ?.level
          ) ||
          0,
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
            event
              ?.detail
              ?.level
          ) ||
          0,
          0,
          1
        );
    }
  );


  window.addEventListener(
    "neyo:voice-muted",
    event => {

      state.muted =
        Boolean(
          event
            ?.detail
            ?.muted
        );


      render();
    }
  );


  window.addEventListener(
    "neyo:voice-speaker",
    event => {

      state.speakerOn =
        Boolean(
          event
            ?.detail
            ?.enabled
        );


      render();
    }
  );


  window.addEventListener(
    "neyo:voice-camera",
    event => {

      state.cameraOn =
        Boolean(
          event
            ?.detail
            ?.enabled
        );


      render();
    }
  );


  /*
  Mood decisions now come from
  mascot-intelligence.js
  */

  window.addEventListener(
    "neyo:mascot-intelligence",
    event => {

      const mood =
        event
          ?.detail
          ?.mood;


      if (mood) {

        setMood(
          mood
        );
      }
    }
  );


  window.addEventListener(
    "neyo:character-select",
    event => {

      const id =
        event
          ?.detail
          ?.id;


      if (id) {

        setCharacter(
          id
        );
      }
    }
  );


  /* =====================================================
     SHELL FALLBACK
     ===================================================== */

  if (voiceShell) {

    const observer =
      new MutationObserver(
        () => {

          if (
            shellOpen() &&
            !state.active
          ) {

            open();
          }


          if (
            !shellOpen() &&
            state.active
          ) {

            close();
          }
        }
      );


    observer.observe(
      voiceShell,
      {
        attributes:
          true,

        attributeFilter: [
          "class",
          "aria-hidden"
        ]
      }
    );
  }


  /* =====================================================
     PUBLIC API
     ===================================================== */

  window.NeyoMascot =
    Object.freeze({

      open,

      close,

      setCharacter,

      setMood,

      /*
      Compatibility with old
      tone terminology.
      */

      setTone:
        setMood,

      setPhase,

      blink,

      getCharacter:
        () =>
          getActiveCharacter(),

      getState:
        () => ({
          active:
            state.active,

          characterId:
            state.characterId,

          phase:
            state.phase,

          mood:
            state.mood,

          micLevel:
            state.micLevel,

          outputLevel:
            state.outputLevel,

          muted:
            state.muted,

          speakerOn:
            state.speakerOn,

          cameraOn:
            state.cameraOn
        })
    });


  /* =====================================================
     INIT
     ===================================================== */

  if (
    window
      .NeyoCharacters
      ?.active
  ) {

    state.characterId =
      window
        .NeyoCharacters
        .active;
  }


  render();


  if (
    shellOpen()
  ) {
    open();
  }


  rafId =
    requestAnimationFrame(
      animate
    );


  console.log(
    "[NEYO Face] Character-aware engine v4 loaded"
  );

})();
