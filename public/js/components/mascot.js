/*
=========================================================
NEYO — MASCOT ENGINE
Production-grade state + expression controller

Owns:
- mascot state
- phase transitions
- tone mapping
- eye mode
- mouth mode
- blinking
- mic/output energy
- mascot status sync
- public API

Does NOT own:
- Gemini connection
- microphone capture
- audio playback
- camera stream
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

  const PHASES =
    Object.freeze([
      "idle",
      "listening",
      "thinking",
      "speaking",
      "interrupted",
      "error",
      "muted"
    ]);


  const TONES =
    Object.freeze([
      "friendly",
      "happy",
      "calm",
      "focused",
      "curious",
      "excited",
      "serious",
      "surprised",
      "confused"
    ]);


  const EYE_MODES =
    Object.freeze([
      "arc",
      "oval",
      "round",
      "square",
      "loop",
      "half"
    ]);


  const MOUTH_MODES =
    Object.freeze([
      "smile",
      "listening",
      "neutral",
      "speak-soft",
      "speak-active",
      "serious",
      "surprise",
      "error"
    ]);


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({

      blinkIdleMin:
        4200,

      blinkIdleMax:
        7200,

      blinkListeningMin:
        5800,

      blinkListeningMax:
        9000,

      blinkSpeakingMin:
        4800,

      blinkSpeakingMax:
        7600,

      blinkCloseMs:
        70,

      blinkHoldMs:
        35,

      blinkOpenMs:
        90,

      interruptedHoldMs:
        145,

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
      false
  };


  let blinkTimer =
    0;

  let blinkAnimationTimer =
    0;

  let interruptedTimer =
    0;


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
      (
        max -
        min
      )
    );
  }


  function validPhase(value) {

    return PHASES.includes(
      value
    );
  }


  function validTone(value) {

    return TONES.includes(
      value
    );
  }


  function validEye(value) {

    return EYE_MODES.includes(
      value
    );
  }


  function validMouth(value) {

    return MOUTH_MODES.includes(
      value
    );
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


      case "idle":
      default:
        return "Ready";
    }
  }


  /* =====================================================
     EXPRESSION MAPPING
     ===================================================== */

  function resolveIdleExpression() {

    switch (state.tone) {

      case "calm":
        return {
          eye:
            "half",

          mouth:
            "smile"
        };


      case "focused":
        return {
          eye:
            "oval",

          mouth:
            "neutral"
        };


      case "curious":
        return {
          eye:
            "oval",

          mouth:
            "smile"
        };


      case "happy":
      case "friendly":
      default:
        return {
          eye:
            "arc",

          mouth:
            "smile"
        };
    }
  }


  function resolveListeningExpression() {

    if (state.tone === "curious") {

      return {
        eye:
          "round",

        mouth:
          "listening"
      };
    }


    if (
      state.tone ===
      "focused"
    ) {

      return {
        eye:
          "oval",

        mouth:
          "listening"
      };
    }


    return {
      eye:
        "oval",

      mouth:
        "listening"
    };
  }


  function resolveThinkingExpression() {

    switch (state.tone) {

      case "calm":
        return {
          eye:
            "square",

          mouth:
            "neutral"
        };


      case "curious":
        return {
          eye:
            "loop",

          mouth:
            "neutral"
        };


      case "focused":
      default:
        return {
          eye:
            "loop",

          mouth:
            "neutral"
        };
    }
  }


  function resolveSpeakingExpression() {

    switch (state.tone) {

      case "happy":
        return {
          eye:
            "arc",

          mouth:
            "speak-active"
        };


      case "excited":
        return {
          eye:
            "round",

          mouth:
            "speak-active"
        };


      case "calm":
        return {
          eye:
            "half",

          mouth:
            "speak-soft"
        };


      case "focused":
        return {
          eye:
            "oval",

          mouth:
            "serious"
        };


      case "serious":
        return {
          eye:
            "half",

          mouth:
            "serious"
        };


      case "curious":
        return {
          eye:
            "oval",

          mouth:
            "speak-soft"
        };


      case "surprised":
        return {
          eye:
            "round",

          mouth:
            "surprise"
        };


      case "friendly":
      default:
        return {
          eye:
            "arc",

          mouth:
            "speak-soft"
        };
    }
  }


  function resolveExpression() {

    if (state.muted) {

      return {
        eye:
          "half",

        mouth:
          "neutral"
      };
    }


    switch (state.phase) {

      case "listening":
        return resolveListeningExpression();


      case "thinking":
        return resolveThinkingExpression();


      case "speaking":
        return resolveSpeakingExpression();


      case "interrupted":
        return {
          eye:
            "round",

          mouth:
            "neutral"
        };


      case "error":
        return {
          eye:
            "square",

          mouth:
            "error"
        };


      case "muted":
        return {
          eye:
            "half",

          mouth:
            "neutral"
        };


      case "idle":
      default:
        return resolveIdleExpression();
    }
  }


  /* =====================================================
     RENDER
     ===================================================== */

  function render() {

    const expression =
      resolveExpression();


    if (
      validEye(
        expression.eye
      )
    ) {

      state.eyeMode =
        expression.eye;
    }


    if (
      validMouth(
        expression.mouth
      )
    ) {

      state.mouthMode =
        expression.mouth;
    }


    mascot.dataset.phase =
      state.phase;

    mascot.dataset.tone =
      state.tone;

    mascot.dataset.eye =
      state.eyeMode;

    mascot.dataset.mouth =
      state.mouthMode;

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
     BLINK
     ===================================================== */

  function clearBlink() {

    clearTimeout(
      blinkTimer
    );


    clearTimeout(
      blinkAnimationTimer
    );


    blinkTimer =
      0;

    blinkAnimationTimer =
      0;


    mascot.classList.remove(
      "is-blinking",
      "is-blink-hold"
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


      case "idle":
      default:
        return randomBetween(
          CONFIG.blinkIdleMin,
          CONFIG.blinkIdleMax
        );
    }
  }


  function scheduleBlink() {

    clearTimeout(
      blinkTimer
    );


    blinkTimer =
      0;


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


  function triggerBlink() {

    if (
      state.blinking ||
      !state.open
    ) {

      scheduleBlink();

      return;
    }


    state.blinking =
      true;


    mascot.classList.add(
      "is-blinking"
    );


    setTimeout(
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
     PHASE
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


    clearTimeout(
      interruptedTimer
    );


    interruptedTimer =
      0;


    state.phase =
      phase;


    if (
      options.tone &&
      validTone(
        options.tone
      )
    ) {

      state.tone =
        options.tone;
    }


    if (
      phase !==
      "listening"
    ) {

      state.micLevel =
        0;
    }


    if (
      phase !==
      "speaking"
    ) {

      state.outputLevel =
        0;
    }


    render();

    scheduleBlink();
  }


  /* =====================================================
     TONE
     ===================================================== */

  function setTone(tone) {

    if (
      !validTone(tone)
    ) {

      console.warn(
        "[NEYO Mascot] Invalid tone:",
        tone
      );

      return;
    }


    state.tone =
      tone;


    render();
  }


  /* =====================================================
     MIC ENERGY
     ===================================================== */

  function setMicLevel(value) {

    const target =
      normalizeEnergy(
        value
      );


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


  /* =====================================================
     OUTPUT ENERGY
     ===================================================== */

  function setOutputLevel(value) {

    const target =
      normalizeEnergy(
        value
      );


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
     MIC
     ===================================================== */

  function setMuted(value) {

    state.muted =
      Boolean(value);


    if (state.muted) {

      state.micLevel =
        0;
    }


    render();

    scheduleBlink();
  }


  /* =====================================================
     SPEAKER
     ===================================================== */

  function setSpeakerOn(value) {

    state.speakerOn =
      Boolean(value);


    if (
      !state.speakerOn
    ) {

      state.outputLevel =
        0;
    }


    render();
  }


  /* =====================================================
     CAMERA
     ===================================================== */

  function setCameraOn(value) {

    state.cameraOn =
      Boolean(value);


    render();
  }


  /* =====================================================
     INTERRUPTION
     ===================================================== */

  function interrupt() {

    clearTimeout(
      interruptedTimer
    );


    state.phase =
      "interrupted";

    state.micLevel =
      0;

    state.outputLevel =
      0;


    render();


    interruptedTimer =
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
        CONFIG.interruptedHoldMs
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


    render();
  }


  /* =====================================================
     OPEN
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
  }


  /* =====================================================
     CLOSE
     ===================================================== */

  function close() {

    state.open =
      false;


    clearBlink();


    clearTimeout(
      interruptedTimer
    );


    interruptedTimer =
      0;


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


    mascot.classList.remove(
      "is-open"
    );


    render();
  }


  /* =====================================================
     EVENT BRIDGE
     ===================================================== */

  window.addEventListener(
    "neyo:voice-open",
    () => {

      open();
    }
  );


  window.addEventListener(
    "neyo:voice-close",
    () => {

      close();
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
            "focused"
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
    () => {

      interrupt();
    }
  );


  window.addEventListener(
    "neyo:voice-error",
    () => {

      showError();
    }
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
    "[NEYO Mascot] Production engine loaded"
  );

})();
