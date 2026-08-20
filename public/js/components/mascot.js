/*
=========================================================
NEYO — PREMIUM FACE ENGINE v3
Unified production mascot controller

Owns:
- listening / thinking / speaking states
- semantic mood awareness
- emotional persistence
- eye + mouth expression mapping
- blink behavior
- micro gaze
- subtle body motion
- real mic/output energy response
- interruption reaction
- premium non-random transitions

Replaces:
- old mascot.js
- mascot-tone.js
- mascot-motion.js

Works with:
- voice.js
- voice-mode.js
- mascot.css

Expected DOM:
#neyoMascot
#neyoMascotLeftEye
#neyoMascotRightEye
#neyoMascotMouth
.neyo-mascot-face
.neyo-mascot-features
.neyo-mouth-bar
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
    mascot?.querySelector(".neyo-mascot-face");

  const features =
    mascot?.querySelector(".neyo-mascot-features");

  const leftEye =
    document.getElementById("neyoMascotLeftEye");

  const rightEye =
    document.getElementById("neyoMascotRightEye");

  const mouth =
    document.getElementById("neyoMascotMouth");

  const mouthBars =
    mouth
      ? Array.from(
          mouth.querySelectorAll(".neyo-mouth-bar")
        )
      : [];

  const statusEl =
    document.getElementById("neyoMascotStatus");

  const voiceShell =
    document.getElementById("neyoVoiceMode");


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


  const MOODS = Object.freeze([
    "friendly",
    "happy",
    "excited",
    "calm",
    "focused",
    "curious",
    "surprised",
    "empathetic",
    "serious",
    "playful",
    "skeptical",
    "confused"
  ]);


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG = Object.freeze({

    defaultMood:
      "friendly",

    expressionTransitionMs:
      220,

    normalMoodHoldMs:
      1900,

    happyMoodHoldMs:
      2400,

    excitedMoodHoldMs:
      2100,

    empatheticMoodHoldMs:
      3000,

    seriousMoodHoldMs:
      2600,

    curiousMoodHoldMs:
      1800,

    surpriseMoodHoldMs:
      1500,

    blinkMinMs:
      3800,

    blinkMaxMs:
      7200,

    listeningBlinkMinMs:
      5200,

    listeningBlinkMaxMs:
      9000,

    blinkCloseMs:
      72,

    blinkHoldMs:
      30,

    blinkOpenMs:
      90,

    microGazeMinMs:
      1500,

    microGazeMaxMs:
      4000,

    bodySmoothing:
      0.065,

    gazeSmoothing:
      0.09,

    energyRise:
      0.24,

    energyFall:
      0.10,

    pointerSmoothing:
      0.08,

    pointerEnabled:
      true
  });


  /* =====================================================
     STATE
     ===================================================== */

  const state = {

    active:
      false,

    phase:
      "idle",

    mood:
      "friendly",

    previousMood:
      "friendly",

    moodConfidence:
      0,

    moodLockedUntil:
      0,

    pendingMood:
      null,

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

    expressionVersion:
      0
  };


  /* =====================================================
     PHYSICAL VALUES
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


  const speechBars =
    mouthBars.map(() => 1);


  let blinkTimer =
    0;

  let blinkAnimationTimer =
    0;

  let moodTimer =
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


  function validPhase(value) {
    return PHASES.includes(value);
  }


  function validMood(value) {
    return MOODS.includes(value);
  }


  function shellOpen() {
    return Boolean(
      voiceShell
        ?.classList
        .contains("is-open")
    );
  }


  /* =====================================================
     SEMANTIC MOOD DETECTION
     ===================================================== */

  const SEMANTIC_RULES = Object.freeze({

    excited: {
      weight: 5,

      patterns: [
        /\bso excited\b/i,
        /\bvery excited\b/i,
        /\bcan't wait\b/i,
        /\bcannot wait\b/i,
        /\bamazing\b/i,
        /\bawesome\b/i,
        /\bfantastic\b/i,
        /\bincredible\b/i,
        /\bbrilliant\b/i,
        /\bwonderful\b/i,
        /\byay\b/i
      ]
    },


    happy: {
      weight: 4,

      patterns: [
        /\bi am happy\b/i,
        /\bi'm happy\b/i,
        /\bso happy\b/i,
        /\bvery happy\b/i,
        /\bfeel happy\b/i,
        /\bfeeling happy\b/i,
        /\bglad\b/i,
        /\bdelighted\b/i,
        /\bpleased\b/i,
        /\bgood news\b/i,
        /\bgreat news\b/i,
        /\bi love\b/i,
        /\blove this\b/i,
        /\bcelebrat(?:e|ing|ion)\b/i
      ]
    },


    empathetic: {
      weight: 5,

      patterns: [
        /\bi am sad\b/i,
        /\bi'm sad\b/i,
        /\bfeel sad\b/i,
        /\bfeeling sad\b/i,
        /\bhurt\b/i,
        /\bheartbroken\b/i,
        /\blonely\b/i,
        /\bworried\b/i,
        /\banxious\b/i,
        /\bafraid\b/i,
        /\bscared\b/i,
        /\bterrible\b/i,
        /\bcrying\b/i,
        /\bnot doing well\b/i,
        /\bnot feeling good\b/i
      ]
    },


    surprised: {
      weight: 4,

      patterns: [
        /\bwow\b/i,
        /\bno way\b/i,
        /\bunbelievable\b/i,
        /\bunexpected\b/i,
        /\bsurpris(?:e|ed|ing)\b/i,
        /\boh my\b/i
      ]
    },


    serious: {
      weight: 4,

      patterns: [
        /\bserious\b/i,
        /\bimportant\b/i,
        /\bcritical\b/i,
        /\burgent\b/i,
        /\bemergency\b/i,
        /\bwarning\b/i,
        /\bdanger\b/i,
        /\bsecurity\b/i,
        /\bfailure\b/i,
        /\bproblem\b/i
      ]
    },


    curious: {
      weight: 3,

      patterns: [
        /\bwhy\b/i,
        /\bhow\b/i,
        /\bwhat if\b/i,
        /\bi wonder\b/i,
        /\bcurious\b/i,
        /\binteresting\b/i,
        /\btell me more\b/i,
        /\bwhat do you think\b/i,
        /\bcan you explain\b/i
      ]
    },


    playful: {
      weight: 3,

      patterns: [
        /\bhaha+\b/i,
        /\blol\b/i,
        /\bfunny\b/i,
        /\bjoke\b/i,
        /\bkidding\b/i,
        /\bjust kidding\b/i,
        /😂/,
        /🤣/,
        /😄/
      ]
    },


    focused: {
      weight: 2,

      patterns: [
        /\bcode\b/i,
        /\bdebug\b/i,
        /\barchitecture\b/i,
        /\banalyze\b/i,
        /\banalysis\b/i,
        /\bcalculate\b/i,
        /\bproduction\b/i,
        /\btechnical\b/i
      ]
    },


    calm: {
      weight: 2,

      patterns: [
        /\bcalm\b/i,
        /\bpeaceful\b/i,
        /\bgentle\b/i,
        /\brelax\b/i,
        /\bquiet\b/i
      ]
    }
  });


  function detectMood(text) {

    const value =
      String(text || "")
        .trim()
        .slice(0, 5000);


    if (!value) {
      return {
        mood:
          CONFIG.defaultMood,

        confidence:
          0
      };
    }


    const scores = {};


    for (
      const [mood, rule]
      of Object.entries(
        SEMANTIC_RULES
      )
    ) {

      let score =
        0;


      for (
        const pattern
        of rule.patterns
      ) {

        if (
          pattern.test(value)
        ) {
          score +=
            rule.weight;
        }
      }


      scores[mood] =
        score;
    }


    /*
    Negation protection.
    */

    if (
      /\bnot happy\b/i.test(value) ||
      /\bunhappy\b/i.test(value)
    ) {

      scores.happy =
        0;

      scores.excited =
        0;

      scores.empathetic =
        Math.max(
          scores.empathetic || 0,
          5
        );
    }


    /*
    Question mark gently supports curiosity.
    */

    if (
      value.includes("?")
    ) {

      scores.curious =
        (
          scores.curious ||
          0
        ) +
        1;
    }


    /*
    Multiple ! increases expressive energy.
    */

    const exclamationCount =
      (
        value.match(/!/g) ||
        []
      ).length;


    if (
      exclamationCount >= 2
    ) {

      if (
        scores.excited > 0
      ) {
        scores.excited +=
          2;
      }


      if (
        scores.happy > 0
      ) {
        scores.happy +=
          1;
      }


      if (
        scores.surprised > 0
      ) {
        scores.surprised +=
          1;
      }
    }


    let winner =
      CONFIG.defaultMood;

    let confidence =
      0;


    const priority = [
      "empathetic",
      "excited",
      "happy",
      "surprised",
      "serious",
      "playful",
      "curious",
      "focused",
      "calm"
    ];


    for (
      const mood
      of priority
    ) {

      const score =
        scores[mood] ||
        0;


      if (
        score >
        confidence
      ) {

        winner =
          mood;

        confidence =
          score;
      }
    }


    return {
      mood:
        winner,

      confidence,

      scores
    };
  }


  /* =====================================================
     MOOD HOLD
     ===================================================== */

  function getMoodHold(mood) {

    switch (mood) {

      case "happy":
        return CONFIG.happyMoodHoldMs;


      case "excited":
        return CONFIG.excitedMoodHoldMs;


      case "empathetic":
        return CONFIG.empatheticMoodHoldMs;


      case "serious":
        return CONFIG.seriousMoodHoldMs;


      case "curious":
        return CONFIG.curiousMoodHoldMs;


      case "surprised":
        return CONFIG.surpriseMoodHoldMs;


      default:
        return CONFIG.normalMoodHoldMs;
    }
  }


  /* =====================================================
     SET MOOD
     ===================================================== */

  function setMood(
    mood,
    options = {}
  ) {

    if (!validMood(mood)) {
      return;
    }


    const confidence =
      Number(
        options.confidence
      ) || 1;


    const now =
      performance.now();


    /*
    Avoid weak expression overriding
    a stronger emotion immediately.
    */

    if (
      !options.force &&
      now <
        state.moodLockedUntil &&
      confidence <
        state.moodConfidence
    ) {

      state.pendingMood =
        {
          mood,
          confidence
        };


      clearTimeout(
        moodTimer
      );


      moodTimer =
        setTimeout(
          () => {

            const pending =
              state.pendingMood;


            state.pendingMood =
              null;


            if (pending) {

              setMood(
                pending.mood,
                {
                  confidence:
                    pending.confidence,

                  force:
                    true
                }
              );
            }

          },
          Math.max(
            0,
            state.moodLockedUntil -
            performance.now()
          ) +
          20
        );


      return;
    }


    state.previousMood =
      state.mood;


    state.mood =
      mood;


    state.moodConfidence =
      confidence;


    state.moodLockedUntil =
      now +
      getMoodHold(mood);


    state.expressionVersion +=
      1;


    renderExpression();


    window.dispatchEvent(
      new CustomEvent(
        "neyo:mascot-mood",
        {
          detail: {
            mood,
            confidence
          }
        }
      )
    );
  }


  function analyzeText(
    text,
    source = "text"
  ) {

    const result =
      detectMood(text);


    if (
      result.confidence <= 0
    ) {
      return result;
    }


    setMood(
      result.mood,
      {
        confidence:
          result.confidence
      }
    );


    console.debug?.(
      "[NEYO Face] Mood",
      {
        source,
        mood:
          result.mood,
        confidence:
          result.confidence
      }
    );


    return result;
  }


  /* =====================================================
     EXPRESSION MATRIX
     ===================================================== */

  function expressionFor(
    phase,
    mood
  ) {

    if (
      state.muted
    ) {

      return {
        eye:
          "half",

        mouth:
          "neutral"
      };
    }


    if (
      phase ===
      "interrupted"
    ) {

      return {
        eye:
          "round",

        mouth:
          "neutral"
      };
    }


    if (
      phase ===
      "error"
    ) {

      return {
        eye:
          "asymmetric",

        mouth:
          "error"
      };
    }


    if (
      phase ===
      "thinking"
    ) {

      switch (mood) {

        case "curious":
          return {
            eye:
              "loop",

            mouth:
              "neutral"
          };


        case "serious":
          return {
            eye:
              "diamond",

            mouth:
              "serious"
          };


        case "skeptical":
          return {
            eye:
              "asymmetric",

            mouth:
              "smirk"
          };


        default:
          return {
            eye:
              "square",

            mouth:
              "neutral"
          };
      }
    }


    if (
      phase ===
      "listening"
    ) {

      switch (mood) {

        case "happy":
          return {
            eye:
              "soft-arc",

            mouth:
              "smile"
          };


        case "excited":
          return {
            eye:
              "round",

            mouth:
              "smile-wide"
          };


        case "empathetic":
          return {
            eye:
              "soft-arc",

            mouth:
              "listening"
          };


        case "curious":
          return {
            eye:
              "asymmetric",

            mouth:
              "curious"
          };


        case "serious":
          return {
            eye:
              "pill",

            mouth:
              "neutral"
          };


        case "surprised":
          return {
            eye:
              "round",

            mouth:
              "surprise"
          };


        default:
          return {
            eye:
              "oval",

            mouth:
              "listening"
          };
      }
    }


    if (
      phase ===
      "speaking"
    ) {

      switch (mood) {

        case "happy":
          return {
            eye:
              "soft-arc",

            mouth:
              "speak-medium"
          };


        case "excited":
          return {
            eye:
              "round",

            mouth:
              "speak-active"
          };


        case "empathetic":
          return {
            eye:
              "soft-arc",

            mouth:
              "speak-soft"
          };


        case "curious":
          return {
            eye:
              "asymmetric",

            mouth:
              "curious"
          };


        case "serious":
          return {
            eye:
              "half",

            mouth:
              "serious"
          };


        case "surprised":
          return {
            eye:
              "round",

            mouth:
              "surprise"
          };


        case "playful":
          return {
            eye:
              "asymmetric",

            mouth:
              "speak-medium"
          };


        case "skeptical":
          return {
            eye:
              "half",

            mouth:
              "smirk"
          };


        case "focused":
          return {
            eye:
              "pill",

            mouth:
              "speak-medium"
          };


        case "calm":
          return {
            eye:
              "half",

            mouth:
              "speak-soft"
          };


        default:
          return {
            eye:
              "arc",

            mouth:
              "speak-soft"
          };
      }
    }


    /*
    IDLE
    */

    switch (mood) {

      case "happy":
        return {
          eye:
            "soft-arc",

          mouth:
            "smile-wide"
        };


      case "excited":
        return {
          eye:
            "round",

          mouth:
            "smile-wide"
        };


      case "empathetic":
        return {
          eye:
            "soft-arc",

          mouth:
            "smile"
        };


      case "curious":
        return {
          eye:
            "asymmetric",

          mouth:
            "curious"
        };


      case "serious":
        return {
          eye:
            "half",

          mouth:
            "neutral"
        };


      case "surprised":
        return {
          eye:
            "round",

          mouth:
            "surprise"
        };


      case "playful":
        return {
          eye:
            "asymmetric",

          mouth:
            "smirk"
        };


      case "calm":
        return {
          eye:
            "half",

          mouth:
            "smile"
        };


      default:
        return {
          eye:
            "arc",

          mouth:
            "smile"
        };
    }
  }


  /* =====================================================
     STATUS
     ===================================================== */

  function statusText() {

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


      default:
        return "Ready";
    }
  }


  /* =====================================================
     RENDER
     ===================================================== */

  function renderExpression() {

    const expression =
      expressionFor(
        state.phase,
        state.mood
      );


    mascot.dataset.phase =
      state.phase;


    mascot.dataset.tone =
      state.mood;


    mascot.dataset.mood =
      state.mood;


    mascot.dataset.eye =
      expression.eye;


    mascot.dataset.mouth =
      expression.mouth;


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
      state.micLevel.toFixed(3)
    );


    mascot.style.setProperty(
      "--neyo-output-level",
      state.outputLevel.toFixed(3)
    );


    if (statusEl) {

      statusEl.textContent =
        statusText();
    }


    window.dispatchEvent(
      new CustomEvent(
        "neyo:mascot-render",
        {
          detail: {
            phase:
              state.phase,

            mood:
              state.mood,

            tone:
              state.mood,

            eye:
              expression.eye,

            mouth:
              expression.mouth,

            micLevel:
              state.micLevel,

            outputLevel:
              state.outputLevel
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
      state.phase === "error" ||
      state.phase === "interrupted"
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


    const roll =
      Math.random();


    /*
    Rare one-eye micro wink,
    only in friendly/playful/happy states.
    */

    if (
      roll > 0.97 &&
      [
        "friendly",
        "happy",
        "playful"
      ].includes(
        state.mood
      ) &&
      state.phase !==
        "thinking"
    ) {

      const side =
        Math.random() >
        0.5
          ? "is-wink-left"
          : "is-wink-right";


      mascot.classList.add(
        side
      );


      blinkAnimationTimer =
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

  function updateMicroGaze(now) {

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


    state.nextMicroGazeAt =
      now +
      randomBetween(
        CONFIG.microGazeMinMs,
        CONFIG.microGazeMaxMs
      );


    let strength =
      1;


    if (
      state.phase ===
      "listening"
    ) {
      strength =
        0.35;
    }


    if (
      state.phase ===
      "speaking"
    ) {
      strength =
        0.25;
    }


    if (
      state.phase ===
      "thinking"
    ) {
      strength =
        1.25;
    }


    state.microTargetX =
      randomBetween(
        -2,
        2
      ) *
      strength;


    state.microTargetY =
      randomBetween(
        -1.2,
        1.2
      ) *
      strength;
  }


  /* =====================================================
     POINTER
     ===================================================== */

  function handlePointerMove(event) {

    if (
      !CONFIG.pointerEnabled ||
      !state.active ||
      reducedMotion
    ) {
      return;
    }


    const rect =
      mascot
        .getBoundingClientRect();


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


  function handlePointerLeave() {

    state.pointerInside =
      false;


    state.pointerTargetX =
      0;


    state.pointerTargetY =
      0;
  }


  voiceShell?.addEventListener(
    "pointermove",
    handlePointerMove,
    {
      passive:
        true
    }
  );


  voiceShell?.addEventListener(
    "pointerleave",
    handlePointerLeave,
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
      state.micLevel.toFixed(3)
    );


    mascot.style.setProperty(
      "--neyo-output-level",
      state.outputLevel.toFixed(3)
    );
  }


  /* =====================================================
     BODY MOTION
     ===================================================== */

  const MOTION = Object.freeze({

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
        0,

      x:
        0,

      rotation:
        0,

      scale:
        0,

      speed:
        1
    },


    error: {
      y:
        0.3,

      x:
        0,

      rotation:
        0.10,

      scale:
        0,

      speed:
        0.5
    }
  });


  const MOOD_ENERGY =
    Object.freeze({

      friendly:
        1,

      happy:
        1.12,

      excited:
        1.34,

      calm:
        0.68,

      focused:
        0.70,

      curious:
        0.94,

      surprised:
        1.28,

      empathetic:
        0.66,

      serious:
        0.58,

      playful:
        1.15,

      skeptical:
        0.72,

      confused:
        0.82
    });


  function updateBody(now) {

    const profile =
      MOTION[state.phase] ||
      MOTION.idle;


    const moodEnergy =
      MOOD_ENERGY[
        state.mood
      ] || 1;


    const t =
      now / 1000;


    /*
    Two frequencies avoid obvious
    repetitive bouncing.
    */

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
          0.49 +
          0.7
        ) *
        profile.y *
        0.16
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


    y *=
      moodEnergy;


    x *=
      moodEnergy;


    rotation *=
      moodEnergy;


    /*
    Listening gets steadier when
    user actually speaks.
    */

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


    /*
    Speaking follows real assistant energy.
    */

    if (
      state.phase ===
      "speaking"
    ) {

      y -=
        state.outputLevel *
        0.75;


      scale +=
        state.outputLevel *
        0.006;


      rotation +=
        Math.sin(
          t * 4
        ) *
        state.outputLevel *
        0.10;
    }


    if (
      state.mood ===
      "curious"
    ) {

      rotation +=
        0.45;
    }


    if (
      state.mood ===
      "skeptical"
    ) {

      rotation -=
        0.35;
    }


    /*
    Pointer movement is deliberately tiny.
    */

    if (
      state.pointerInside
    ) {

      x +=
        state.pointerX *
        1.4;


      y +=
        state.pointerY *
        0.8;
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
     GAZE MOTION
     ===================================================== */

  function updateGaze(now) {

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


    if (
      state.pointerInside
    ) {

      x +=
        state.pointerX *
        2.5;


      y +=
        state.pointerY *
        1.6;
    }


    if (
      state.phase ===
        "thinking" &&
      !state.pointerInside
    ) {

      const t =
        now / 1000;


      x +=
        Math.sin(
          t * 1.05
        ) *
        1.7;


      y +=
        Math.sin(
          t * 0.68
        ) *
        0.7;
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
     SPEECH PHYSICS
     ===================================================== */

  function updateSpeechBars(now) {

    if (!mouthBars.length) {
      return;
    }


    if (
      state.phase !==
      "speaking"
    ) {

      for (
        let i = 0;
        i < speechBars.length;
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
      now / 1000;


    for (
      let i = 0;
      i < mouthBars.length;
      i += 1
    ) {

      const irregular =
        0.86 +
        Math.sin(
          t *
          (
            5.8 +
            i * 0.71
          ) +
          i
        ) *
        0.09 +
        Math.sin(
          t *
          (
            9.7 +
            i * 0.37
          )
        ) *
        0.05;


      const target =
        1 +
        state.outputLevel *
        weights[i] *
        irregular *
        0.72;


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
        0.52;


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
     PHASE
     ===================================================== */

  function setPhase(
    phase,
    options = {}
  ) {

    if (
      !validPhase(phase)
    ) {
      return;
    }


    const previous =
      state.phase;


    state.phase =
      phase;


    if (
      options.mood &&
      validMood(
        options.mood
      )
    ) {

      setMood(
        options.mood,
        {
          confidence:
            options.confidence ||
            3
        }
      );

    } else {

      renderExpression();
    }


    if (
      previous !==
      phase
    ) {

      reactionForPhase(
        phase
      );
    }


    scheduleBlink();
  }


  /* =====================================================
     REACTIONS
     ===================================================== */

  function reactionForPhase(
    phase
  ) {

    if (
      reducedMotion ||
      !state.active
    ) {
      return;
    }


    if (
      phase ===
      "listening"
    ) {

      face.animate(
        [
          {
            scale:
              "1"
          },

          {
            scale:
              "0.988",
            offset:
              0.45
          },

          {
            scale:
              "1"
          }
        ],
        {
          duration:
            300,

          easing:
            "cubic-bezier(.22,.88,.32,1)"
        }
      );
    }


    if (
      phase ===
      "speaking"
    ) {

      face.animate(
        [
          {
            scale:
              "0.994"
          },

          {
            scale:
              "1.014",
            offset:
              0.40
          },

          {
            scale:
              "1"
          }
        ],
        {
          duration:
            360,

          easing:
            "cubic-bezier(.22,.88,.32,1)"
        }
      );
    }


    if (
      phase ===
      "interrupted"
    ) {

      face.animate(
        [
          {
            translate:
              "0 0"
          },

          {
            translate:
              "-2px 0",
            offset:
              0.40
          },

          {
            translate:
              "0 0"
          }
        ],
        {
          duration:
            210,

          easing:
            "cubic-bezier(.22,.88,.32,1)"
        }
      );
    }


    if (
      state.mood ===
      "surprised"
    ) {

      face.animate(
        [
          {
            scale:
              "1"
          },

          {
            scale:
              "1.035",
            offset:
              0.35
          },

          {
            scale:
              "1"
          }
        ],
        {
          duration:
            430,

          easing:
            "cubic-bezier(.22,.88,.32,1)"
        }
      );
    }
  }


  /* =====================================================
     ACTIVATION
     ===================================================== */

  function open() {

    state.active =
      true;


    state.phase =
      "idle";


    state.nextMicroGazeAt =
      performance.now() +
      900;


    renderExpression();

    scheduleBlink();
  }


  function close() {

    state.active =
      false;


    clearBlink();


    clearTimeout(
      moodTimer
    );


    state.phase =
      "idle";


    state.mood =
      "friendly";


    state.previousMood =
      "friendly";


    state.moodConfidence =
      0;


    state.moodLockedUntil =
      0;


    state.pendingMood =
      null;


    state.micTarget =
      0;


    state.outputTarget =
      0;


    resetPhysicalMotion();


    renderExpression();
  }


  /* =====================================================
     RESET
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
     VOICE EVENTS
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


      setPhase(
        "interrupted",
        {
          mood:
            "surprised",

          confidence:
            5
        }
      );
    }
  );


  window.addEventListener(
    "neyo:voice-error",
    () => {

      setPhase(
        "error",
        {
          mood:
            "confused",

          confidence:
            5
        }
      );
    }
  );


  /* =====================================================
     SEMANTIC TEXT EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:voice-user-text",
    event => {

      const text =
        event?.detail?.text;


      if (text) {

        analyzeText(
          text,
          "user"
        );
      }
    }
  );


  window.addEventListener(
    "neyo:voice-assistant-text",
    event => {

      const text =
        event?.detail?.text;


      if (text) {

        analyzeText(
          text,
          "assistant"
        );
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
     CONTROLS
     ===================================================== */

  window.addEventListener(
    "neyo:voice-muted",
    event => {

      state.muted =
        Boolean(
          event?.detail?.muted
        );


      if (
        state.muted
      ) {

        state.micTarget =
          0;
      }


      renderExpression();
    }
  );


  window.addEventListener(
    "neyo:voice-speaker",
    event => {

      state.speakerOn =
        Boolean(
          event?.detail?.enabled
        );


      if (
        !state.speakerOn
      ) {

        state.outputTarget =
          0;
      }


      renderExpression();
    }
  );


  window.addEventListener(
    "neyo:voice-camera",
    event => {

      state.cameraOn =
        Boolean(
          event?.detail?.enabled
        );


      renderExpression();
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

      setPhase,

      setMood,

      /*
      Backwards compatibility:
      old code can still call setTone().
      */

      setTone:
        setMood,

      analyzeText,

      detectMood,

      blink,

      getState:
        () => ({
          active:
            state.active,

          phase:
            state.phase,

          mood:
            state.mood,

          previousMood:
            state.previousMood,

          moodConfidence:
            state.moodConfidence,

          micLevel:
            state.micLevel,

          outputLevel:
            state.outputLevel,

          muted:
            state.muted,

          speakerOn:
            state.speakerOn
        })
    });


  /* =====================================================
     INIT
     ===================================================== */

  renderExpression();


  if (shellOpen()) {

    open();
  }


  rafId =
    requestAnimationFrame(
      animate
    );


  console.log(
    "[NEYO Face] Premium Face Engine v3 loaded"
  );

})();
