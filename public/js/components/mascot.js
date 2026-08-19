/*
=========================================================
NEYO — PREMIUM MASCOT ENGINE
Production expression + state controller

Owns:
- phase states
- 12 expression tones
- eye / mouth mapping
- expression hold timing
- blink variants
- mic / output energy
- micro expressions
- premium stable transitions

Does NOT own:
- Gemini
- WebSocket
- microphone capture
- audio playback
- camera
- voice mode layout
=========================================================
*/

(() => {
  "use strict";

  /* =====================================================
     DOM
     ===================================================== */

  const mascot =
    document.getElementById("neyoMascot");

  const leftEye =
    document.getElementById("neyoMascotLeftEye");

  const rightEye =
    document.getElementById("neyoMascotRightEye");

  const mouth =
    document.getElementById("neyoMascotMouth");

  const statusEl =
    document.getElementById("neyoMascotStatus");

  if (
    !mascot ||
    !leftEye ||
    !rightEye ||
    !mouth
  ) {
    console.warn(
      "[NEYO Mascot] Required DOM missing."
    );

    return;
  }


  /* =====================================================
     ENUMS
     ===================================================== */

  const PHASES = Object.freeze([
    "idle",
    "listening",
    "thinking",
    "speaking",
    "interrupted",
    "error",
    "muted"
  ]);

  const TONES = Object.freeze([
    "friendly",
    "happy",
    "excited",
    "calm",
    "focused",
    "curious",
    "surprised",
    "confused",
    "skeptical",
    "empathetic",
    "playful",
    "serious"
  ]);

  const EYES = Object.freeze([
    "arc",
    "soft-arc",
    "oval",
    "pill",
    "round",
    "square",
    "diamond",
    "loop",
    "double-loop",
    "half",
    "wink-left",
    "wink-right",
    "asymmetric"
  ]);

  const MOUTHS = Object.freeze([
    "smile",
    "smile-wide",
    "neutral",
    "listening",
    "speak-soft",
    "speak-medium",
    "speak-active",
    "serious",
    "curious",
    "surprise",
    "confused",
    "smirk",
    "error"
  ]);


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG = Object.freeze({
    expressionHoldMs:
      700,

    majorExpressionHoldMs:
      1100,

    interruptHoldMs:
      140,

    blinkIdleMin:
      4200,

    blinkIdleMax:
      7200,

    blinkListeningMin:
      5600,

    blinkListeningMax:
      9000,

    blinkSpeakingMin:
      4800,

    blinkSpeakingMax:
      7600,

    blinkCloseMs:
      70,

    blinkHoldMs:
      30,

    blinkOpenMs:
      90,

    doubleBlinkGapMs:
      120,

    slowBlinkHoldMs:
      110,

    microExpressionMinMs:
      5200,

    microExpressionMaxMs:
      9800,

    micSmoothing:
      0.22,

    outputSmoothing:
      0.28,

    energyFloor:
      0.015,

    maxEnergy:
      1
  });


  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    open:
      false,

    phase:
      "idle",

    tone:
      "friendly",

    eyeMode:
      "arc",

    mouthMode:
      "smile",

    micLevel:
      0,

    outputLevel:
      0,

    muted:
      false,

    speakerOn:
      true,

    cameraOn:
      false,

    blinking:
      false,

    blinkVariant:
      "normal",

    expressionLockedUntil:
      0,

    microExpression:
      null
  };


  let blinkTimer = 0;
  let blinkAnimationTimer = 0;
  let microTimer = 0;
  let interruptTimer = 0;
  let pendingTone = null;


  /* =====================================================
     HELPERS
     ===================================================== */

  function clamp01(value) {
    const number =
      Number(value) || 0;

    return Math.max(
      0,
      Math.min(
        CONFIG.maxEnergy,
        number
      )
    );
  }


  function normalizeEnergy(value) {
    const level =
      clamp01(value);

    if (
      level <=
      CONFIG.energyFloor
    ) {
      return 0;
    }

    return clamp01(
      (
        level -
        CONFIG.energyFloor
      ) /
      (
        1 -
        CONFIG.energyFloor
      )
    );
  }


  function randomBetween(
    min,
    max
  ) {
    return (
      min +
      Math.random() *
      (max - min)
    );
  }


  function randomChoice(items) {
    return items[
      Math.floor(
        Math.random() *
        items.length
      )
    ];
  }


  function validPhase(value) {
    return PHASES.includes(value);
  }


  function validTone(value) {
    return TONES.includes(value);
  }


  function now() {
    return performance.now();
  }


  /* =====================================================
     STATUS
     ===================================================== */

  function getStatusText() {
    if (state.muted) {
      return "Microphone muted";
    }

    switch (state.phase) {
      case "listening":
        return "Listening…";

      case "thinking":
        return "Thinking…";

      case "speaking":
        return "NEYO is speaking";

      case "interrupted":
        return "Listening…";

      case "error":
        return "Something went wrong";

      case "muted":
        return "Microphone muted";

      default:
        return "Ready";
    }
  }


  /* =====================================================
     EXPRESSION PROFILES
     ===================================================== */

  const EXPRESSIONS = Object.freeze({

    idle: {
      friendly: {
        eye: "arc",
        mouth: "smile"
      },

      happy: {
        eye: "soft-arc",
        mouth: "smile-wide"
      },

      calm: {
        eye: "half",
        mouth: "smile"
      },

      playful: {
        eye: "asymmetric",
        mouth: "smirk"
      },

      curious: {
        eye: "asymmetric",
        mouth: "curious"
      },

      serious: {
        eye: "half",
        mouth: "neutral"
      },

      default: {
        eye: "arc",
        mouth: "smile"
      }
    },


    listening: {
      friendly: {
        eye: "oval",
        mouth: "listening"
      },

      focused: {
        eye: "pill",
        mouth: "listening"
      },

      curious: {
        eye: "asymmetric",
        mouth: "curious"
      },

      calm: {
        eye: "half",
        mouth: "listening"
      },

      empathetic: {
        eye: "soft-arc",
        mouth: "listening"
      },

      skeptical: {
        eye: "half",
        mouth: "smirk"
      },

      default: {
        eye: "oval",
        mouth: "listening"
      }
    },


    thinking: {
      focused: {
        eye: "square",
        mouth: "neutral"
      },

      curious: {
        eye: "loop",
        mouth: "neutral"
      },

      serious: {
        eye: "diamond",
        mouth: "serious"
      },

      calm: {
        eye: "square",
        mouth: "neutral"
      },

      skeptical: {
        eye: "asymmetric",
        mouth: "smirk"
      },

      default: {
        eye: "loop",
        mouth: "neutral"
      }
    },


    speaking: {
      friendly: {
        eye: "arc",
        mouth: "speak-soft"
      },

      happy: {
        eye: "soft-arc",
        mouth: "speak-medium"
      },

      excited: {
        eye: "round",
        mouth: "speak-active"
      },

      calm: {
        eye: "half",
        mouth: "speak-soft"
      },

      focused: {
        eye: "pill",
        mouth: "speak-medium"
      },

      curious: {
        eye: "asymmetric",
        mouth: "curious"
      },

      surprised: {
        eye: "round",
        mouth: "surprise"
      },

      confused: {
        eye: "asymmetric",
        mouth: "confused"
      },

      skeptical: {
        eye: "half",
        mouth: "smirk"
      },

      empathetic: {
        eye: "soft-arc",
        mouth: "speak-soft"
      },

      playful: {
        eye: "asymmetric",
        mouth: "speak-medium"
      },

      serious: {
        eye: "half",
        mouth: "serious"
      },

      default: {
        eye: "arc",
        mouth: "speak-soft"
      }
    }
  });


  /* =====================================================
     RESOLVE EXPRESSION
     ===================================================== */

  function resolveExpression() {
    if (state.muted) {
      return {
        eye: "half",
        mouth: "neutral"
      };
    }

    if (state.phase === "interrupted") {
      return {
        eye: "round",
        mouth: "neutral"
      };
    }

    if (state.phase === "error") {
      return {
        eye: "asymmetric",
        mouth: "error"
      };
    }

    const phaseMap =
      EXPRESSIONS[state.phase] ||
      EXPRESSIONS.idle;

    const result =
      phaseMap[state.tone] ||
      phaseMap.default;

    return {
      ...result
    };
  }


  /* =====================================================
     MICRO EXPRESSIONS
     ===================================================== */

  function scheduleMicroExpression() {
    clearTimeout(microTimer);

    if (
      !state.open ||
      state.phase === "thinking" ||
      state.phase === "error" ||
      state.phase === "interrupted"
    ) {
      return;
    }

    microTimer =
      setTimeout(
        triggerMicroExpression,
        randomBetween(
          CONFIG.microExpressionMinMs,
          CONFIG.microExpressionMaxMs
        )
      );
  }


  function triggerMicroExpression() {
    if (
      !state.open ||
      state.blinking
    ) {
      scheduleMicroExpression();
      return;
    }

    let micro = null;

    if (state.phase === "idle") {
      micro = randomChoice([
        "look-left",
        "look-right",
        "soft-wink",
        "tiny-smirk"
      ]);
    }

    if (state.phase === "listening") {
      micro = randomChoice([
        "attention",
        "look-center"
      ]);
    }

    if (state.phase === "speaking") {
      micro = randomChoice([
        "soft-wink",
        "micro-nod"
      ]);
    }

    if (!micro) {
      scheduleMicroExpression();
      return;
    }

    state.microExpression =
      micro;

    mascot.dataset.micro =
      micro;

    setTimeout(
      () => {
        state.microExpression =
          null;

        delete mascot.dataset.micro;

        scheduleMicroExpression();
      },
      420
    );
  }


  /* =====================================================
     RENDER
     ===================================================== */

  function render() {
    const expression =
      resolveExpression();

    state.eyeMode =
      expression.eye;

    state.mouthMode =
      expression.mouth;

    mascot.dataset.phase =
      state.phase;

    mascot.dataset.tone =
      state.tone;

    mascot.dataset.eye =
      state.eyeMode;

    mascot.dataset.mouth =
      state.mouthMode;

    mascot.dataset.muted =
      String(state.muted);

    mascot.dataset.speaker =
      state.speakerOn
        ? "on"
        : "off";

    mascot.dataset.camera =
      state.cameraOn
        ? "on"
        : "off";

    mascot.dataset.blink =
      state.blinkVariant;

    mascot.style.setProperty(
      "--neyo-mic-level",
      state.micLevel.toFixed(3)
    );

    mascot.style.setProperty(
      "--neyo-output-level",
      state.outputLevel.toFixed(3)
    );

    leftEye.dataset.mode =
      state.eyeMode;

    rightEye.dataset.mode =
      state.eyeMode;

    mouth.dataset.mode =
      state.mouthMode;

    if (statusEl) {
      const text =
        getStatusText();

      if (
        statusEl.textContent !==
        text
      ) {
        statusEl.textContent =
          text;
      }
    }

    window.dispatchEvent(
      new CustomEvent(
        "neyo:mascot-render",
        {
          detail: {
            ...state
          }
        }
      )
    );
  }


  /* =====================================================
     EXPRESSION HOLD
     ===================================================== */

  function lockExpression(
    duration =
      CONFIG.expressionHoldMs
  ) {
    state.expressionLockedUntil =
      now() + duration;
  }


  function canChangeExpression() {
    return (
      now() >=
      state.expressionLockedUntil
    );
  }


  /* =====================================================
     BLINK ENGINE
     ===================================================== */

  function clearBlink() {
    clearTimeout(blinkTimer);
    clearTimeout(blinkAnimationTimer);

    blinkTimer = 0;
    blinkAnimationTimer = 0;

    mascot.classList.remove(
      "is-blinking",
      "is-blink-hold",
      "is-double-blink",
      "is-slow-blink"
    );

    state.blinking =
      false;
  }


  function getBlinkDelay() {
    switch (state.phase) {
      case "listening":
        return randomBetween(
          CONFIG.blinkListeningMin,
          CONFIG.blinkListeningMax
        );

      case "speaking":
        return randomBetween(
          CONFIG.blinkSpeakingMin,
          CONFIG.blinkSpeakingMax
        );

      default:
        return randomBetween(
          CONFIG.blinkIdleMin,
          CONFIG.blinkIdleMax
        );
    }
  }


  function chooseBlinkVariant() {
    const roll =
      Math.random();

    if (roll < 0.90) {
      return "normal";
    }

    if (roll < 0.96) {
      return "slow";
    }

    if (roll < 0.99) {
      return "double";
    }

    return "wink";
  }


  function scheduleBlink() {
    clearTimeout(blinkTimer);

    if (
      !state.open ||
      state.phase === "thinking" ||
      state.phase === "error" ||
      state.phase === "interrupted"
    ) {
      return;
    }

    blinkTimer =
      setTimeout(
        triggerBlink,
        getBlinkDelay()
      );
  }


  function doSingleBlink(
    slow = false
  ) {
    state.blinking =
      true;

    mascot.classList.add(
      "is-blinking"
    );

    if (slow) {
      mascot.classList.add(
        "is-slow-blink"
      );
    }

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
            "is-blink-hold",
            "is-slow-blink"
          );

          state.blinking =
            false;

          scheduleBlink();
        },
        CONFIG.blinkCloseMs +
        (
          slow
            ? CONFIG.slowBlinkHoldMs
            : CONFIG.blinkHoldMs
        ) +
        CONFIG.blinkOpenMs
      );
  }


  function doDoubleBlink() {
    state.blinking =
      true;

    mascot.classList.add(
      "is-double-blink"
    );

    const blinkOnce = () => {
      mascot.classList.add(
        "is-blinking"
      );

      setTimeout(
        () => {
          mascot.classList.remove(
            "is-blinking"
          );
        },
        CONFIG.blinkCloseMs +
        CONFIG.blinkOpenMs
      );
    };

    blinkOnce();

    setTimeout(
      blinkOnce,
      CONFIG.doubleBlinkGapMs
    );

    setTimeout(
      () => {
        mascot.classList.remove(
          "is-double-blink"
        );

        state.blinking =
          false;

        scheduleBlink();
      },
      CONFIG.doubleBlinkGapMs +
      240
    );
  }


  function doWink() {
    state.blinking =
      true;

    const side =
      Math.random() > 0.5
        ? "left"
        : "right";

    mascot.classList.add(
      side === "left"
        ? "is-wink-left"
        : "is-wink-right"
    );

    setTimeout(
      () => {
        mascot.classList.remove(
          "is-wink-left",
          "is-wink-right"
        );

        state.blinking =
          false;

        scheduleBlink();
      },
      220
    );
  }


  function triggerBlink() {
    if (
      state.blinking ||
      !state.open
    ) {
      scheduleBlink();
      return;
    }

    const variant =
      chooseBlinkVariant();

    state.blinkVariant =
      variant;

    mascot.dataset.blink =
      variant;

    if (variant === "slow") {
      doSingleBlink(true);
      return;
    }

    if (variant === "double") {
      doDoubleBlink();
      return;
    }

    if (variant === "wink") {
      doWink();
      return;
    }

    doSingleBlink(false);
  }


  /* =====================================================
     PHASE CONTROL
     ===================================================== */

  function setPhase(
    phase,
    options = {}
  ) {
    if (!validPhase(phase)) {
      console.warn(
        "[NEYO Mascot] Invalid phase:",
        phase
      );

      return;
    }

    clearTimeout(interruptTimer);

    state.phase =
      phase;

    if (
      options.tone &&
      validTone(options.tone)
    ) {
      state.tone =
        options.tone;
    }

    if (
      phase !== "listening"
    ) {
      state.micLevel =
        0;
    }

    if (
      phase !== "speaking"
    ) {
      state.outputLevel =
        0;
    }

    lockExpression(
      options.major
        ? CONFIG.majorExpressionHoldMs
        : CONFIG.expressionHoldMs
    );

    render();

    scheduleBlink();
    scheduleMicroExpression();
  }


  /* =====================================================
     TONE CONTROL
     ===================================================== */

  function setTone(
    tone,
    options = {}
  ) {
    if (!validTone(tone)) {
      console.warn(
        "[NEYO Mascot] Invalid tone:",
        tone
      );

      return;
    }

    if (
      !canChangeExpression() &&
      !options.force
    ) {
      pendingTone =
        tone;

      const wait =
        Math.max(
          0,
          state.expressionLockedUntil -
          now()
        );

      setTimeout(
        () => {
          if (pendingTone) {
            const next =
              pendingTone;

            pendingTone =
              null;

            setTone(
              next,
              {
                force: true
              }
            );
          }
        },
        wait + 10
      );

      return;
    }

    state.tone =
      tone;

    lockExpression(
      options.major
        ? CONFIG.majorExpressionHoldMs
        : CONFIG.expressionHoldMs
    );

    render();
  }


  /* =====================================================
     ENERGY
     ===================================================== */

  function setMicLevel(value) {
    const target =
      normalizeEnergy(value);

    state.micLevel +=
      (
        target -
        state.micLevel
      ) *
      CONFIG.micSmoothing;

    if (
      state.phase ===
      "listening"
    ) {
      render();
    }
  }


  function setOutputLevel(value) {
    const target =
      normalizeEnergy(value);

    state.outputLevel +=
      (
        target -
        state.outputLevel
      ) *
      CONFIG.outputSmoothing;

    if (
      state.phase ===
      "speaking"
    ) {
      render();
    }
  }


  /* =====================================================
     CONTROLS
     ===================================================== */

  function setMuted(value) {
    state.muted =
      Boolean(value);

    if (state.muted) {
      state.micLevel =
        0;
    }

    render();
  }


  function setSpeakerOn(value) {
    state.speakerOn =
      Boolean(value);

    if (!state.speakerOn) {
      state.outputLevel =
        0;
    }

    render();
  }


  function setCameraOn(value) {
    state.cameraOn =
      Boolean(value);

    render();
  }


  /* =====================================================
     INTERRUPTION
     ===================================================== */

  function interrupt() {
    clearTimeout(interruptTimer);

    state.phase =
      "interrupted";

    state.tone =
      "surprised";

    state.micLevel =
      0;

    state.outputLevel =
      0;

    lockExpression(
      CONFIG.expressionHoldMs
    );

    render();

    interruptTimer =
      setTimeout(
        () => {
          setPhase(
            "listening",
            {
              tone:
                "focused"
            }
          );
        },
        CONFIG.interruptHoldMs
      );
  }


  /* =====================================================
     ERROR
     ===================================================== */

  function showError() {
    clearBlink();

    state.phase =
      "error";

    state.tone =
      "confused";

    state.micLevel =
      0;

    state.outputLevel =
      0;

    lockExpression(
      CONFIG.majorExpressionHoldMs
    );

    render();
  }


  /* =====================================================
     OPEN / CLOSE
     ===================================================== */

  function open() {
    state.open =
      true;

    state.phase =
      "idle";

    state.tone =
      "friendly";

    state.micLevel =
      0;

    state.outputLevel =
      0;

    mascot.classList.add(
      "is-open"
    );

    render();

    scheduleBlink();
    scheduleMicroExpression();
  }


  function close() {
    state.open =
      false;

    clearBlink();

    clearTimeout(microTimer);
    clearTimeout(interruptTimer);

    state.phase =
      "idle";

    state.tone =
      "friendly";

    state.micLevel =
      0;

    state.outputLevel =
      0;

    state.muted =
      false;

    state.speakerOn =
      true;

    state.cameraOn =
      false;

    state.microExpression =
      null;

    mascot.classList.remove(
      "is-open",
      "is-wink-left",
      "is-wink-right"
    );

    delete mascot.dataset.micro;

    render();
  }


  /* =====================================================
     EVENT BRIDGE
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
    event => {
      setPhase(
        "idle",
        {
          tone:
            event?.detail?.tone ||
            "friendly"
        }
      );
    }
  );

  window.addEventListener(
    "neyo:voice-listening",
    event => {
      setPhase(
        "listening",
        {
          tone:
            event?.detail?.tone ||
            "focused"
        }
      );
    }
  );

  window.addEventListener(
    "neyo:voice-thinking",
    event => {
      setPhase(
        "thinking",
        {
          tone:
            event?.detail?.tone ||
            "focused",
          major:
            true
        }
      );
    }
  );

  window.addEventListener(
    "neyo:voice-speaking",
    event => {
      setPhase(
        "speaking",
        {
          tone:
            event?.detail?.tone ||
            "friendly"
        }
      );
    }
  );

  window.addEventListener(
    "neyo:voice-interrupted",
    interrupt
  );

  window.addEventListener(
    "neyo:voice-error",
    showError
  );

  window.addEventListener(
    "neyo:voice-mic-level",
    event => {
      setMicLevel(
        event?.detail?.level
      );
    }
  );

  window.addEventListener(
    "neyo:voice-output-level",
    event => {
      setOutputLevel(
        event?.detail?.level
      );
    }
  );

  window.addEventListener(
    "neyo:voice-muted",
    event => {
      setMuted(
        event?.detail?.muted
      );
    }
  );

  window.addEventListener(
    "neyo:voice-speaker",
    event => {
      setSpeakerOn(
        event?.detail?.enabled
      );
    }
  );

  window.addEventListener(
    "neyo:voice-camera",
    event => {
      setCameraOn(
        event?.detail?.enabled
      );
    }
  );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  window.NeyoMascot =
    Object.freeze({
      open,
      close,

      setPhase,
      setTone,

      setMicLevel,
      setOutputLevel,

      setMuted,
      setSpeakerOn,
      setCameraOn,

      interrupt,
      showError,

      blink:
        triggerBlink,

      getState:
        () => ({
          ...state
        })
    });


  /* =====================================================
     INIT
     ===================================================== */

  render();

  console.log(
    "[NEYO Mascot] Premium expression engine loaded"
  );

})();
