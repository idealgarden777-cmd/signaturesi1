/*
=========================================================
NEYO — PREMIUM MASCOT / FACE ENGINE
FINAL PRODUCTION MIXER v9

FILE:
public/js/components/mascot.js

OWNS
---------------------------------------------------------
- Mascot active/inactive visual lifecycle
- Active character visual identity
- Mood / tone
- Eye expression
- Mouth expression
- Phase-aware visual overrides
- Blink
- Rare personality-aware wink
- Micro gaze
- Pointer-responsive gaze
- Thinking scan
- Body float / motion
- Character-specific motion personality
- Real microphone energy response
- Real assistant-output energy response
- Speech-bar animation
- Character transition animation
- Reduced-motion support
- Visual CSS variables / datasets
- Mascot public API

READS
---------------------------------------------------------
- window.NeyoCharacters
- window.NeyoCharacter
- voice.js events
- voice-mode.js events
- mascot-intelligence.js events
- character-picker.js selection events

DOES NOT OWN
---------------------------------------------------------
- Gemini transport
- Microphone acquisition
- Audio playback
- Fullscreen voice shell
- Status text
- Camera acquisition
- Mic / speaker buttons
- Character picker DOM
- Semantic mood detection
- Chat transport
- History

ARCHITECTURE
---------------------------------------------------------

voice.js
  ├─ phase
  ├─ mic level
  ├─ output level
  └─ interruption/error
         ↓
      mascot.js
         ↓
   face / eyes / mouth
   gaze / body / speech

mascot-intelligence.js
         ↓
       mood
         ↓
      mascot.js

character-picker.js
         ↓
neyo:character-select
         ↓
      mascot.js
         ↓
neyo:character-change
         ↓
       voice.js

MIGRATION RULE
---------------------------------------------------------
No neo.js dependency.

After neo.js removal this file continues unchanged.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-mascot-final-v9";

  if (
    window.NeyoMascot
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     DOM
     ===================================================== */

  const mascot =
    document.getElementById(
      "neyoMascot"
    );

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
      "[NEYO Mascot] Required mascot DOM is missing."
    );

    return;
  }

  const mouthBars =
    Array.from(
      mouth.querySelectorAll(
        ".neyo-mouth-bar"
      )
    );

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
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

      winkMs:
        190,

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
        0.10,

      /*
       * Prevent impossible CSS values from
       * malformed/custom character definitions.
       */

      minCharacterScale:
        0.72,

      maxCharacterScale:
        1.30
    });

  /* =====================================================
     VALID PHASES
     ===================================================== */

  const PHASES =
    new Set([
      "idle",
      "listening",
      "thinking",
      "speaking",
      "interrupted",
      "error"
    ]);

  /* =====================================================
     REDUCED MOTION
     ===================================================== */

  const reducedMotionQuery =
    window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

  let reducedMotion =
    reducedMotionQuery.matches;

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
      false,

    visible:
      !document.hidden,

    lastRenderAt:
      null,

    lastCharacterChangeAt:
      null,

    lastMoodChangeAt:
      null
  };

  const metrics = {
    renders:
      0,

    blinks:
      0,

    winks:
      0,

    characterChanges:
      0,

    moodChanges:
      0,

    phaseChanges:
      0
  };

  /* =====================================================
     BODY STATE
     ===================================================== */

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

  /* =====================================================
     SPEECH STATE
     ===================================================== */

  const speechBars =
    mouthBars.map(
      () => 1
    );

  /* =====================================================
     TIMERS / RAF
     ===================================================== */

  let blinkTimer =
    0;

  let blinkHoldTimer =
    0;

  let blinkAnimationTimer =
    0;

  let rafId =
    0;

  let shellObserver =
    null;

  /* =====================================================
     EVENTS
     ===================================================== */

  function emit(
    name,
    detail = {}
  ) {
    window.dispatchEvent(
      new CustomEvent(
        name,
        {
          detail
        }
      )
    );
  }

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

  function clamp01(
    value
  ) {
    return clamp(
      Number(value) || 0,
      0,
      1
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

  function cleanId(
    value
  ) {
    return String(
      value || ""
    )
      .trim()
      .toLowerCase()
      .replace(
        /[^a-z0-9_-]/g,
        ""
      )
      .slice(
        0,
        50
      );
  }

  function safeNumber(
    value,
    fallback
  ) {
    const number =
      Number(
        value
      );

    return Number.isFinite(
      number
    )
      ? number
      : fallback;
  }

  /* =====================================================
     SHELL OPEN

     Supports both old .is-open and final
     aria-hidden="false" contract.
     ===================================================== */

  function shellOpen() {
    if (
      !voiceShell
    ) {
      return false;
    }

    if (
      voiceShell
        .getAttribute(
          "aria-hidden"
        ) ===
      "false"
    ) {
      return true;
    }

    if (
      voiceShell
        .classList
        .contains(
          "is-open"
        )
    ) {
      return true;
    }

    return (
      document.body
        .classList
        .contains(
          "neyo-voice-mode-open"
        )
    );
  }

  /* =====================================================
     CHARACTER REGISTRY
     ===================================================== */

  function getCharacter(
    id =
      state.characterId
  ) {
    const key =
      cleanId(
        id
      );

    const helper =
      window.NeyoCharacter;

    /*
     * Preferred registry helper.
     */

    try {
      if (
        typeof helper?.get ===
        "function"
      ) {
        const result =
          helper.get(
            key
          ) ||
          helper
            .getActive
            ?.();

        if (
          result
        ) {
          return result;
        }
      }
    } catch {}

    /*
     * Plain object registry fallback.
     */

    try {
      return (
        window
          .NeyoCharacters
          ?.[key] ||
        window
          .NeyoCharacters
          ?.neyo ||
        null
      );

    } catch {
      return null;
    }
  }

  /* =====================================================
     ACTIVE CHARACTER FALLBACK
     ===================================================== */

  function getActiveCharacter() {
    return (
      getCharacter(
        state.characterId
      ) ||
      {
        id:
          CONFIG.defaultCharacter,

        name:
          "NEYO",

        visual:
          {},

        expressions:
          {},

        personality:
          {},

        motion:
          {},

        phases:
          {}
      }
    );
  }

  /* =====================================================
     REGISTRY ACTIVE ID
     ===================================================== */

  function registryActiveId() {
    try {
      const helper =
        window.NeyoCharacter;

      if (
        typeof helper
          ?.getActive ===
        "function"
      ) {
        const character =
          helper
            .getActive();

        if (
          character?.id
        ) {
          return cleanId(
            character.id
          );
        }
      }
    } catch {}

    try {
      const value =
        window
          .NeyoCharacters
          ?.active;

      if (
        typeof value ===
        "string"
      ) {
        return cleanId(
          value
        );
      }

    } catch {}

    return "";
  }

  /* =====================================================
     SET REGISTRY ACTIVE
     ===================================================== */

  function syncRegistryActive(
    id
  ) {
    const key =
      cleanId(
        id
      );

    if (!key) {
      return false;
    }

    const helper =
      window.NeyoCharacter;

    try {
      if (
        typeof helper
          ?.setActive ===
        "function"
      ) {
        helper.setActive(
          key
        );

        return true;
      }
    } catch {}

    /*
     * Compatibility with original mutable registry.
     */

    try {
      if (
        window.NeyoCharacters &&
        !Object.isFrozen(
          window.NeyoCharacters
        )
      ) {
        window
          .NeyoCharacters
          .active =
          key;

        return true;
      }
    } catch {}

    return false;
  }

  /* =====================================================
     BASE EXPRESSIONS

     Preserve premium geometric vocabulary.
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
     CHARACTER EXPRESSION
     ===================================================== */

  function getCharacterExpression(
    mood =
      state.mood
  ) {
    const character =
      getActiveCharacter();

    return (
      character
        ?.expressions
        ?.[mood] ||
      BASE_EXPRESSIONS[
        mood
      ] ||
      BASE_EXPRESSIONS
        .friendly
    );
  }

  /* =====================================================
     RESOLVE EXPRESSION
     ===================================================== */

  function resolveExpression() {
    const base =
      getCharacterExpression(
        state.mood
      );

    let eye =
      base.eye ||
      "arc";

    let mouthMode =
      base.mouth ||
      "smile";

    /* -------------------------------------------------
       MUTED
       ------------------------------------------------- */

    if (
      state.muted
    ) {
      eye =
        "half";

      mouthMode =
        "neutral";
    }

    /* -------------------------------------------------
       THINKING
       ------------------------------------------------- */

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

    /* -------------------------------------------------
       LISTENING
       ------------------------------------------------- */

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

    /* -------------------------------------------------
       SPEAKING
       ------------------------------------------------- */

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

    /* -------------------------------------------------
       INTERRUPTION
       ------------------------------------------------- */

    if (
      state.phase ===
      "interrupted"
    ) {
      eye =
        "round";

      mouthMode =
        "neutral";
    }

    /* -------------------------------------------------
       ERROR
       ------------------------------------------------- */

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
     CHARACTER SCALE
     ===================================================== */

  function characterScale(
    value,
    fallback =
      1
  ) {
    return clamp(
      safeNumber(
        value,
        fallback
      ),
      CONFIG.minCharacterScale,
      CONFIG.maxCharacterScale
    );
  }

  /* =====================================================
     RENDER

     STATUS TEXT IS INTENTIONALLY NOT TOUCHED.
     voice-mode.js owns #neyoMascotStatus.
     ===================================================== */

  function render() {
    const character =
      getActiveCharacter();

    const expression =
      resolveExpression();

    const characterId =
      cleanId(
        character?.id ||
        state.characterId
      ) ||
      CONFIG.defaultCharacter;

    mascot.dataset.character =
      characterId;

    mascot.dataset.phase =
      state.phase;

    mascot.dataset.mood =
      state.mood;

    /*
     * Preserve old CSS contract:
     * data-tone was used before "mood"
     * became the preferred terminology.
     */

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

    mascot.dataset.active =
      String(
        state.active
      );

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
        characterScale(
          character
            ?.visual
            ?.faceScale
        )
      )
    );

    mascot.style.setProperty(
      "--neyo-character-body-scale",
      String(
        characterScale(
          character
            ?.visual
            ?.bodyScale
        )
      )
    );

    state.lastRenderAt =
      Date.now();

    metrics.renders +=
      1;

    emit(
      "neyo:mascot-render",
      {
        character:
          characterId,

        phase:
          state.phase,

        mood:
          state.mood,

        eye:
          expression.eye,

        mouth:
          expression.mouth,

        muted:
          state.muted,

        speakerOn:
          state.speakerOn,

        cameraOn:
          state.cameraOn,

        micLevel:
          state.micLevel,

        outputLevel:
          state.outputLevel
      }
    );

    return true;
  }

  /* =====================================================
     CHARACTER TRANSITION
     ===================================================== */

  function animateCharacterChange() {
    if (
      reducedMotion ||
      !state.active ||
      typeof face.animate !==
        "function"
    ) {
      return false;
    }

    try {
      face.animate(
        [
          {
            transform:
              "scale(.97)",

            opacity:
              0.86
          },

          {
            transform:
              "scale(1.015)",

            opacity:
              1,

            offset:
              0.58
          },

          {
            transform:
              "scale(1)",

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

      return true;

    } catch {
      return false;
    }
  }

  /* =====================================================
     SET CHARACTER
     ===================================================== */

  function setCharacter(
    id,
    options = {}
  ) {
    const key =
      cleanId(
        id
      );

    if (!key) {
      return false;
    }

    const character =
      getCharacter(
        key
      );

    if (!character) {
      console.warn(
        "[NEYO Mascot] Unknown character:",
        key
      );

      return false;
    }

    const nextId =
      cleanId(
        character.id ||
        key
      );

    if (!nextId) {
      return false;
    }

    const changed =
      state.characterId !==
      nextId;

    state.characterId =
      nextId;

    syncRegistryActive(
      nextId
    );

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

    state.lastCharacterChangeAt =
      Date.now();

    render();

    if (
      changed
    ) {
      metrics.characterChanges +=
        1;

      animateCharacterChange();
    }

    /*
     * Canonical character event.
     *
     * voice.js listens to this and updates its
     * session character. During active Live voice,
     * voice.js emits restart-required and voice-mode
     * coordinates clean restart.
     */

    if (
      options.emitChange !==
      false
    ) {
      emit(
        "neyo:character-change",
        {
          id:
            nextId,

          character,

          source:
            options.source ||
            "mascot"
        }
      );
    }

    emit(
      "neyo:mascot-character-change",
      {
        id:
          nextId,

        character,

        changed
      }
    );

    return true;
  }

  /* =====================================================
     SET MOOD
     ===================================================== */

  function setMood(
    mood,
    options = {}
  ) {
    const value =
      cleanId(
        mood
      );

    if (!value) {
      return false;
    }

    const character =
      getActiveCharacter();

    if (
      !BASE_EXPRESSIONS[
        value
      ] &&
      !character
        ?.expressions
        ?.[value]
    ) {
      return false;
    }

    const changed =
      state.mood !==
      value;

    state.mood =
      value;

    state.lastMoodChangeAt =
      Date.now();

    if (
      changed
    ) {
      metrics.moodChanges +=
        1;
    }

    render();

    if (
      options.emit !==
      false
    ) {
      emit(
        "neyo:mascot-mood-change",
        {
          mood:
            value,

          character:
            state.characterId
        }
      );
    }

    return true;
  }

  /* =====================================================
     SET PHASE
     ===================================================== */

  function setPhase(
    phase
  ) {
    const value =
      PHASES.has(
        phase
      )
        ? phase
        : "idle";

    const changed =
      state.phase !==
      value;

    state.phase =
      value;

    if (
      changed
    ) {
      metrics.phaseChanges +=
        1;
    }

    render();

    scheduleBlink();

    return state.phase;
  }

  /* =====================================================
     CLEAR BLINK
     ===================================================== */

  function clearBlink() {
    window.clearTimeout(
      blinkTimer
    );

    window.clearTimeout(
      blinkHoldTimer
    );

    window.clearTimeout(
      blinkAnimationTimer
    );

    blinkTimer =
      0;

    blinkHoldTimer =
      0;

    blinkAnimationTimer =
      0;

    state.blinking =
      false;

    mascot.classList.remove(
      "is-blinking",
      "is-blink-hold",
      "is-wink-left",
      "is-wink-right"
    );
  }

  /* =====================================================
     SCHEDULE BLINK
     ===================================================== */

  function scheduleBlink() {
    window.clearTimeout(
      blinkTimer
    );

    blinkTimer =
      0;

    if (
      !state.active ||
      !state.visible ||
      reducedMotion ||
      state.phase ===
        "error" ||
      state.phase ===
        "interrupted"
    ) {
      return false;
    }

    const delay =
      state.phase ===
        "listening"

        ? randomBetween(
            CONFIG
              .listeningBlinkMinMs,
            CONFIG
              .listeningBlinkMaxMs
          )

        : randomBetween(
            CONFIG.blinkMinMs,
            CONFIG.blinkMaxMs
          );

    blinkTimer =
      window.setTimeout(
        blink,
        delay
      );

    return true;
  }

  /* =====================================================
     BLINK
     ===================================================== */

  function blink() {
    if (
      state.blinking ||
      !state.active ||
      !state.visible ||
      reducedMotion
    ) {
      scheduleBlink();

      return false;
    }

    state.blinking =
      true;

    metrics.blinks +=
      1;

    const character =
      getActiveCharacter();

    const playfulness =
      safeNumber(
        character
          ?.personality
          ?.playfulness,
        0
      );

    const allowWink =
      playfulness >
        0.55 &&
      [
        "happy",
        "playful"
      ].includes(
        state.mood
      );

    /*
     * Rare enough to feel intentional,
     * not like a broken eye.
     */

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

      metrics.winks +=
        1;

      mascot.classList.add(
        className
      );

      blinkAnimationTimer =
        window.setTimeout(
          () => {
            mascot.classList.remove(
              className
            );

            state.blinking =
              false;

            scheduleBlink();
          },
          CONFIG.winkMs
        );

      return true;
    }

    mascot.classList.add(
      "is-blinking"
    );

    blinkHoldTimer =
      window.setTimeout(
        () => {
          if (
            !state.blinking
          ) {
            return;
          }

          mascot.classList.add(
            "is-blink-hold"
          );
        },
        CONFIG.blinkCloseMs
      );

    blinkAnimationTimer =
      window.setTimeout(
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

    return true;
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
      !state.visible ||
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
      safeNumber(
        character
          ?.motion
          ?.gazeMovement,
        0.5
      );

    const thinkingStrength =
      safeNumber(
        character
          ?.motion
          ?.thinkingScan,
        0.5
      );

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

  function pointerMove(
    event
  ) {
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

    const centerX =
      rect.left +
      rect.width /
      2;

    const centerY =
      rect.top +
      rect.height /
      2;

    state.pointerTargetX =
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

    state.pointerTargetY =
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

    /*
     * Avoid infinitely tiny residual values.
     */

    if (
      state.micLevel <
      0.0005
    ) {
      state.micLevel =
        0;
    }

    if (
      state.outputLevel <
      0.0005
    ) {
      state.outputLevel =
        0;
    }

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
     BASE MOTION
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
      },

      interrupted: {
        y:
          0.55,

        x:
          0.20,

        rotation:
          0.10,

        scale:
          0.002,

        speed:
          0.88
      },

      error: {
        y:
          0.20,

        x:
          0.10,

        rotation:
          0.08,

        scale:
          0.001,

        speed:
          0.40
      }
    });

  /* =====================================================
     BODY MOTION
     ===================================================== */

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
      safeNumber(
        phaseProfile.energy ??
        character
          ?.personality
          ?.energy,
        0.5
      );

    const idleMotion =
      safeNumber(
        motionProfile
          .idleFloat,
        0.5
      );

    const speechMotion =
      safeNumber(
        motionProfile
          .speechMovement,
        0.5
      );

    const asymmetry =
      safeNumber(
        motionProfile
          .asymmetry,
        0.15
      );

    const time =
      now /
      1000;

    const baseStrength =
      0.60 +
      generalEnergy *
      0.75;

    let y =
      (
        Math.sin(
          time *
          profile.speed *
          1.20
        ) *
        profile.y
      ) +
      (
        Math.sin(
          time *
          profile.speed *
          0.51 +
          0.7
        ) *
        profile.y *
        asymmetry
      );

    let x =
      Math.sin(
        time *
        profile.speed *
        0.53 +
        1.1
      ) *
      profile.x;

    let rotation =
      Math.sin(
        time *
        profile.speed *
        0.47
      ) *
      profile.rotation;

    let scale =
      1 +
      Math.sin(
        time *
        profile.speed *
        1.34
      ) *
      profile.scale;

    /* -------------------------------------------------
       IDLE PERSONALITY
       ------------------------------------------------- */

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

    /* -------------------------------------------------
       LISTENING

       More mic energy = more visual attention/stillness.
       ------------------------------------------------- */

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

    /* -------------------------------------------------
       SPEAKING
       ------------------------------------------------- */

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
          time *
          4
        ) *
        state.outputLevel *
        speechMotion *
        0.18;
    }

    /* -------------------------------------------------
       MOOD POSTURE
       ------------------------------------------------- */

    if (
      state.mood ===
      "curious"
    ) {
      rotation +=
        0.25 +
        safeNumber(
          character
            ?.personality
            ?.curiosity,
          0
        ) *
        0.30;
    }

    if (
      state.mood ===
      "skeptical"
    ) {
      rotation -=
        0.30;
    }

    /* -------------------------------------------------
       POINTER RESPONSE
       ------------------------------------------------- */

    if (
      state.pointerInside
    ) {
      const response =
        safeNumber(
          motionProfile
            .pointerResponse,
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
      safeNumber(
        character
          ?.motion
          ?.pointerResponse,
        0.3
      );

    let x =
      state.microX;

    let y =
      state.microY;

    /* -------------------------------------------------
       POINTER GAZE
       ------------------------------------------------- */

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

    /* -------------------------------------------------
       THINKING SCAN

       Gives geometric "searching" eye behavior.
       ------------------------------------------------- */

    if (
      state.phase ===
        "thinking" &&
      !state.pointerInside
    ) {
      const thinking =
        safeNumber(
          character
            ?.motion
            ?.thinkingScan,
          0.5
        );

      const time =
        now /
        1000;

      x +=
        Math.sin(
          time *
          1.05
        ) *
        thinking *
        3;

      y +=
        Math.sin(
          time *
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
      safeNumber(
        character
          ?.motion
          ?.speechMovement,
        0.5
      );

    /* -------------------------------------------------
       RESET WHEN NOT SPEAKING
       ------------------------------------------------- */

    if (
      state.phase !==
      "speaking"
    ) {
      for (
        let index = 0;
        index <
        speechBars.length;
        index += 1
      ) {
        speechBars[
          index
        ] =
          lerp(
            speechBars[
              index
            ],
            1,
            0.18
          );

        mouthBars[
          index
        ]
          .style
          .setProperty(
            "--neyo-speech-scale",
            speechBars[
              index
            ]
              .toFixed(3)
          );

        mouthBars[
          index
        ]
          .style
          .setProperty(
            "--neyo-speech-y",
            "0px"
          );
      }

      return;
    }

    const defaultWeights = [
      0.45,
      0.78,
      1,
      0.74,
      0.50
    ];

    const time =
      now /
      1000;

    for (
      let index = 0;
      index <
      mouthBars.length;
      index += 1
    ) {
      /*
       * Supports any future mouth-bar count.
       */

      const normalized =
        mouthBars.length <=
          1
          ? 1
          : index /
            (
              mouthBars.length -
              1
            );

      const centerWeight =
        1 -
        Math.abs(
          normalized -
          0.5
        ) *
        1.1;

      const weight =
        defaultWeights[
          index
        ] ??
        clamp(
          centerWeight,
          0.42,
          1
        );

      const irregular =
        0.86 +
        Math.sin(
          time *
          (
            5.8 +
            index *
            0.71
          ) +
          index
        ) *
        0.09 +
        Math.sin(
          time *
          (
            9.7 +
            index *
            0.37
          )
        ) *
        0.05;

      const target =
        1 +
        state.outputLevel *
        weight *
        irregular *
        (
          0.4 +
          speechEnergy *
          0.75
        );

      speechBars[
        index
      ] =
        lerp(
          speechBars[
            index
          ],
          target,
          target >
            speechBars[
              index
            ]
            ? 0.30
            : 0.17
        );

      const y =
        Math.sin(
          time *
          3.4 +
          index *
          0.78
        ) *
        state.outputLevel *
        (
          0.25 +
          speechEnergy *
          0.55
        );

      mouthBars[
        index
      ]
        .style
        .setProperty(
          "--neyo-speech-scale",
          speechBars[
            index
          ]
            .toFixed(3)
        );

      mouthBars[
        index
      ]
        .style
        .setProperty(
          "--neyo-speech-y",
          `${y.toFixed(2)}px`
        );
    }
  }

  /* =====================================================
     RESET PHYSICAL MOTION
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

    for (
      let index = 0;
      index <
      mouthBars.length;
      index += 1
    ) {
      speechBars[
        index
      ] =
        1;

      mouthBars[
        index
      ]
        .style
        .setProperty(
          "--neyo-speech-scale",
          "1"
        );

      mouthBars[
        index
      ]
        .style
        .setProperty(
          "--neyo-speech-y",
          "0px"
        );
    }
  }

  /* =====================================================
     OPEN VISUAL ENGINE
     ===================================================== */

  function open({
    resetMood =
      false
  } = {}) {
    if (
      state.active
    ) {
      return true;
    }

    state.active =
      true;

    const registryId =
      registryActiveId();

    if (
      registryId &&
      getCharacter(
        registryId
      )
    ) {
      state.characterId =
        registryId;
    }

    const character =
      getActiveCharacter();

    /*
     * Do NOT blindly reset phase to idle if voice.js
     * already emitted connecting/thinking before shell
     * became visible.
     */

    if (
      !PHASES.has(
        state.phase
      )
    ) {
      state.phase =
        "idle";
    }

    if (
      resetMood
    ) {
      state.mood =
        character
          ?.defaultExpression
          ?.mood ||
        CONFIG.defaultMood;
    }

    state.nextMicroGazeAt =
      performance.now() +
      800;

    render();

    scheduleBlink();

    emit(
      "neyo:mascot-opened",
      {
        character:
          state.characterId
      }
    );

    return true;
  }

  /* =====================================================
     CLOSE VISUAL ENGINE
     ===================================================== */

  function close() {
    if (
      !state.active
    ) {
      return true;
    }

    state.active =
      false;

    clearBlink();

    state.phase =
      "idle";

    state.micTarget =
      0;

    state.outputTarget =
      0;

    state.micLevel =
      0;

    state.outputLevel =
      0;

    resetPhysicalMotion();

    render();

    emit(
      "neyo:mascot-closed"
    );

    return true;
  }

  /* =====================================================
     MAIN LOOP
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
      !state.visible
    ) {
      return;
    }

    /*
     * Even reduced-motion users still get
     * energy CSS state updated without movement.
     */

    updateEnergy();

    if (
      reducedMotion
    ) {
      return;
    }

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
     VOICE PHASE EVENTS
     ===================================================== */

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

  /* =====================================================
     INTERRUPTION
     ===================================================== */

  window.addEventListener(
    "neyo:voice-interrupted",
    () => {
      state.outputTarget =
        0;

      state.mood =
        "surprised";

      /*
       * voice.js has already returned transport
       * state to listening before this event.
       */
      setPhase(
        "listening"
      );
    }
  );

  /* =====================================================
     ERROR
     ===================================================== */

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

  /* =====================================================
     MIC ENERGY
     ===================================================== */

  window.addEventListener(
    "neyo:voice-mic-level",
    event => {
      state.micTarget =
        clamp01(
          event.detail
            ?.level
        );
    }
  );

  /* =====================================================
     OUTPUT ENERGY
     ===================================================== */

  window.addEventListener(
    "neyo:voice-output-level",
    event => {
      state.outputTarget =
        clamp01(
          event.detail
            ?.level
        );
    }
  );

  /* =====================================================
     MUTED STATE
     ===================================================== */

  window.addEventListener(
    "neyo:voice-muted",
    event => {
      state.muted =
        Boolean(
          event.detail
            ?.muted
        );

      if (
        state.muted
      ) {
        state.micTarget =
          0;
      }

      render();
    }
  );

  /* =====================================================
     SPEAKER STATE
     ===================================================== */

  window.addEventListener(
    "neyo:voice-speaker",
    event => {
      state.speakerOn =
        event.detail
          ?.enabled !==
        false;

      if (
        !state.speakerOn
      ) {
        state.outputTarget =
          0;
      }

      render();
    }
  );

  /* =====================================================
     CAMERA STATE

     mascot only reflects state visually.
     voice-mode.js owns actual camera.
     ===================================================== */

  function syncCameraEvent(
    event
  ) {
    state.cameraOn =
      Boolean(
        event.detail
          ?.enabled
      );

    render();
  }

  window.addEventListener(
    "neyo:voice-camera",
    syncCameraEvent
  );

  /* =====================================================
     MASCOT INTELLIGENCE

     Semantic decision remains external.
     ===================================================== */

  window.addEventListener(
    "neyo:mascot-intelligence",
    event => {
      const mood =
        event.detail
          ?.mood;

      if (
        mood
      ) {
        setMood(
          mood,
          {
            emit:
              false
          }
        );
      }
    }
  );

  /* =====================================================
     CHARACTER PICKER SELECTION

     Mascot turns picker selection into canonical
     neyo:character-change used by voice.js.
     ===================================================== */

  window.addEventListener(
    "neyo:character-select",
    event => {
      const id =
        event.detail
          ?.id ||
        event.detail
          ?.character;

      if (!id) {
        return;
      }

      setCharacter(
        id,
        {
          source:
            "character-picker"
        }
      );
    }
  );

  /* =====================================================
     EXTERNAL CHARACTER CHANGE

     Support another module setting canonical character
     directly, without creating a character-change loop.
     ===================================================== */

  window.addEventListener(
    "neyo:character-change",
    event => {
      const id =
        event.detail
          ?.id ||
        event.detail
          ?.character
          ?.id;

      if (
        !id ||
        event.detail
          ?.source ===
        "mascot"
      ) {
        return;
      }

      const key =
        cleanId(
          id
        );

      if (
        !key ||
        key ===
        state.characterId
      ) {
        return;
      }

      setCharacter(
        key,
        {
          emitChange:
            false,

          source:
            event.detail
              ?.source ||
            "external"
        }
      );
    }
  );

  /* =====================================================
     VOICE-MODE OPEN / CLOSE

     Final canonical shell lifecycle.
     ===================================================== */

  window.addEventListener(
    "neyo:voice-mode-opened",
    () => {
      open();
    }
  );

  window.addEventListener(
    "neyo:voice-mode-closed",
    () => {
      close();
    }
  );

  /* =====================================================
     LEGACY VOICE OPEN / CLOSE COMPATIBILITY
     ===================================================== */

  window.addEventListener(
    "neyo:voice-open",
    open
  );

  window.addEventListener(
    "neyo:voice-close",
    close
  );

  /* =====================================================
     SHELL FALLBACK OBSERVER

     Protects against loader order or external UI code.
     ===================================================== */

  if (
    voiceShell
  ) {
    shellObserver =
      new MutationObserver(
        () => {
          const openState =
            shellOpen();

          if (
            openState &&
            !state.active
          ) {
            open();
          }

          if (
            !openState &&
            state.active
          ) {
            close();
          }
        }
      );

    shellObserver.observe(
      voiceShell,
      {
        attributes:
          true,

        attributeFilter: [
          "class",
          "aria-hidden",
          "style"
        ]
      }
    );
  }

  /* =====================================================
     DOCUMENT VISIBILITY

     Avoid wasting animation work in background tabs.
     ===================================================== */

  document.addEventListener(
    "visibilitychange",
    () => {
      state.visible =
        !document.hidden;

      if (
        !state.visible
      ) {
        clearBlink();

        state.micTarget =
          0;

        state.outputTarget =
          0;

        return;
      }

      if (
        state.active
      ) {
        state.nextMicroGazeAt =
          performance.now() +
          800;

        scheduleBlink();
      }
    }
  );

  /* =====================================================
     REDUCED MOTION CHANGE
     ===================================================== */

  reducedMotionQuery
    .addEventListener
    ?.(
      "change",
      event => {
        reducedMotion =
          event.matches;

        if (
          reducedMotion
        ) {
          clearBlink();

          resetPhysicalMotion();

        } else if (
          state.active
        ) {
          scheduleBlink();
        }

        render();
      }
    );

  /* =====================================================
     EXPLICIT ENERGY APIs
     ===================================================== */

  function setMicLevel(
    value
  ) {
    state.micTarget =
      clamp01(
        value
      );

    return state.micTarget;
  }

  function setOutputLevel(
    value
  ) {
    state.outputTarget =
      clamp01(
        value
      );

    return state.outputTarget;
  }

  /* =====================================================
     FORCE EXPRESSION

     Useful for controlled UI/tests without changing
     semantic mood intelligence.
     ===================================================== */

  function setExpression({
    mood,
    phase
  } = {}) {
    if (
      mood
    ) {
      setMood(
        mood
      );
    }

    if (
      phase
    ) {
      setPhase(
        phase
      );
    }

    return {
      mood:
        state.mood,

      phase:
        state.phase
    };
  }

  /* =====================================================
     SYNC FROM VOICE
     ===================================================== */

  function hydrateFromVoice() {
    const voice =
      window.NeyoVoice;

    if (!voice) {
      return false;
    }

    let snapshot =
      {};

    try {
      snapshot =
        voice.getState?.() ||
        voice.getSessionInfo?.() ||
        {};
    } catch {}

    if (
      snapshot
        .selectedCharacter ||
      snapshot
        .sessionCharacter ||
      snapshot
        .character
    ) {
      const id =
        snapshot
          .selectedCharacter ||
        snapshot
          .sessionCharacter ||
        snapshot.character;

      if (
        getCharacter(
          id
        )
      ) {
        state.characterId =
          cleanId(
            id
          );
      }
    }

    if (
      PHASES.has(
        snapshot.phase
      )
    ) {
      state.phase =
        snapshot.phase;
    }

    state.muted =
      Boolean(
        snapshot.muted
      );

    state.speakerOn =
      snapshot
        .speakerEnabled !==
      false;

    return true;
  }

  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({
      __controller:
        true,

      version:
        VERSION,

      active:
        true,

      /*
       * Lifecycle
       */

      open,

      close,

      isActive() {
        return state.active;
      },

      /*
       * Character
       */

      setCharacter,

      getCharacter() {
        return getActiveCharacter();
      },

      getCharacterId() {
        return state.characterId;
      },

      /*
       * Expression
       */

      setMood,

      /*
       * Old terminology compatibility.
       */

      setTone:
        setMood,

      setPhase,

      setExpression,

      resolveExpression,

      /*
       * Physical behavior
       */

      blink,

      resetPhysicalMotion,

      /*
       * Energy
       */

      setMicLevel,

      setOutputLevel,

      /*
       * Render
       */

      render,

      /*
       * State
       */

      getState() {
        const expression =
          resolveExpression();

        return {
          version:
            VERSION,

          active:
            state.active,

          visible:
            state.visible,

          reducedMotion,

          characterId:
            state.characterId,

          character:
            getActiveCharacter(),

          phase:
            state.phase,

          mood:
            state.mood,

          eye:
            expression.eye,

          mouth:
            expression.mouth,

          micTarget:
            state.micTarget,

          micLevel:
            state.micLevel,

          outputTarget:
            state.outputTarget,

          outputLevel:
            state.outputLevel,

          muted:
            state.muted,

          speakerOn:
            state.speakerOn,

          cameraOn:
            state.cameraOn,

          blinking:
            state.blinking,

          pointerInside:
            state.pointerInside,

          lastRenderAt:
            state.lastRenderAt,

          lastCharacterChangeAt:
            state
              .lastCharacterChangeAt,

          lastMoodChangeAt:
            state
              .lastMoodChangeAt,

          metrics: {
            ...metrics
          }
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoMascot",
    {
      value:
        api,

      writable:
        false,

      configurable:
        true,

      enumerable:
        true
    }
  );

  /* =====================================================
     INIT CHARACTER
     ===================================================== */

  const initialCharacter =
    registryActiveId();

  if (
    initialCharacter &&
    getCharacter(
      initialCharacter
    )
  ) {
    state.characterId =
      initialCharacter;
  }

  hydrateFromVoice();

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

  /* =====================================================
     READY
     ===================================================== */

  emit(
    "neyo:mascot-ready",
    {
      version:
        VERSION,

      active:
        state.active,

      character:
        state.characterId,

      reducedMotion
    }
  );
})();
