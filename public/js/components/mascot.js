(() => {
  "use strict";

  const VERSION = "neyo-mascot-v5";
  if (window.NeyoMascot?.__controller === true) return;

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

  if (
    !mascot ||
    !face ||
    !leftEye ||
    !rightEye ||
    !mouth
  ) {
    console.warn(
      "[NEYO Mascot] Required DOM missing."
    );

    return;
  }

  const mouthBars = Array.from(
    mouth.querySelectorAll(
      ".neyo-mouth-bar"
    )
  );

  const CONFIG = Object.freeze({
    defaultCharacter: "neyo",
    defaultMood: "friendly",

    blinkMinMs: 3900,
    blinkMaxMs: 7200,

    listeningBlinkMinMs: 5200,
    listeningBlinkMaxMs: 8800,

    blinkDurationMs: 190,

    microGazeMinMs: 1500,
    microGazeMaxMs: 4000,

    bodySmoothing: 0.065,
    gazeSmoothing: 0.09,
    pointerSmoothing: 0.08,

    energyRise: 0.24,
    energyFall: 0.1
  });

  const PHASES = new Set([
    "idle",
    "listening",
    "thinking",
    "speaking",
    "interrupted",
    "error"
  ]);

  const BASE_EXPRESSIONS =
    Object.freeze({
      friendly: {
        eye: "arc",
        mouth: "smile"
      },

      happy: {
        eye: "soft-arc",
        mouth: "smile-wide"
      },

      excited: {
        eye: "round",
        mouth: "speak-active"
      },

      calm: {
        eye: "half",
        mouth: "smile"
      },

      focused: {
        eye: "pill",
        mouth: "neutral"
      },

      curious: {
        eye: "asymmetric",
        mouth: "curious"
      },

      surprised: {
        eye: "round",
        mouth: "surprise"
      },

      empathetic: {
        eye: "soft-arc",
        mouth: "smile"
      },

      serious: {
        eye: "half",
        mouth: "serious"
      },

      playful: {
        eye: "asymmetric",
        mouth: "smirk"
      },

      skeptical: {
        eye: "half",
        mouth: "smirk"
      },

      confused: {
        eye: "asymmetric",
        mouth: "error"
      }
    });

  const BASE_MOTION =
    Object.freeze({
      idle: {
        y: 2.8,
        x: 0.7,
        rotation: 0.38,
        scale: 0.006,
        speed: 0.72
      },

      listening: {
        y: 0.8,
        x: 0.2,
        rotation: 0.1,
        scale: 0.0025,
        speed: 0.65
      },

      thinking: {
        y: 1.3,
        x: 0.65,
        rotation: 0.5,
        scale: 0.003,
        speed: 0.58
      },

      speaking: {
        y: 1.2,
        x: 0.35,
        rotation: 0.18,
        scale: 0.004,
        speed: 0.94
      },

      interrupted: {
        y: 0.4,
        x: 0.15,
        rotation: 0.08,
        scale: 0.002,
        speed: 0.8
      },

      error: {
        y: 0.2,
        x: 0.1,
        rotation: 0.05,
        scale: 0,
        speed: 0.5
      }
    });

  const state = {
    active: false,

    characterId:
      CONFIG.defaultCharacter,

    phase: "idle",

    mood:
      CONFIG.defaultMood,

    muted: false,
    speakerOn: true,
    cameraOn: false,

    micTarget: 0,
    micLevel: 0,

    outputTarget: 0,
    outputLevel: 0,

    pointerInside: false,

    pointerTargetX: 0,
    pointerTargetY: 0,

    pointerX: 0,
    pointerY: 0,

    microTargetX: 0,
    microTargetY: 0,

    microX: 0,
    microY: 0,

    nextMicroGazeAt: 0,

    blinking: false
  };

  const body = {
    x: 0,
    y: 0,
    rotation: 0,
    scale: 1
  };

  const speechBars =
    mouthBars.map(() => 1);

  const reducedMotionQuery =
    window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

  let reducedMotion =
    reducedMotionQuery.matches;

  let blinkTimer = 0;
  let blinkAnimationTimer = 0;
  let animationFrame = 0;

  function emit(name, detail = {}) {
    window.dispatchEvent(
      new CustomEvent(name, {
        detail
      })
    );
  }

  function clamp(value, min, max) {
    return Math.max(
      min,
      Math.min(max, value)
    );
  }

  function lerp(current, target, amount) {
    return (
      current +
      (target - current) *
        amount
    );
  }

  function randomBetween(min, max) {
    return (
      min +
      Math.random() *
        (max - min)
    );
  }

  function cleanId(value) {
    return (
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(
          /[^a-z0-9_-]/g,
          ""
        )
        .slice(0, 40) ||
      CONFIG.defaultCharacter
    );
  }

  function getCharacter(
    id = state.characterId
  ) {
    const helper =
      window.NeyoCharacter;

    try {
      if (
        typeof helper?.get ===
        "function"
      ) {
        return (
          helper.get(id) ||
          helper.getActive?.() ||
          null
        );
      }
    } catch {}

    const registry =
      window.NeyoCharacters;

    if (!registry) return null;

    return (
      registry[id] ||
      registry.neyo ||
      null
    );
  }

  function activeCharacter() {
    return (
      getCharacter(
        state.characterId
      ) || {
        id:
          state.characterId ||
          CONFIG.defaultCharacter,

        name: "NEYO",

        visual: {},
        expressions: {},
        motion: {},
        phases: {},
        personality: {}
      }
    );
  }

  function expressionForMood(mood) {
    const character =
      activeCharacter();

    return (
      character
        ?.expressions
        ?.[mood] ||
      BASE_EXPRESSIONS[mood] ||
      BASE_EXPRESSIONS.friendly
    );
  }

  function resolveExpression() {
    const expression =
      expressionForMood(
        state.mood
      );

    let eye =
      expression.eye ||
      "arc";

    let mouthMode =
      expression.mouth ||
      "smile";

    if (state.muted) {
      eye = "half";
      mouthMode = "neutral";
    }

    if (
      state.phase ===
      "thinking"
    ) {
      if (
        state.mood ===
        "curious"
      ) {
        eye = "loop";
      } else if (
        state.mood ===
        "serious"
      ) {
        eye = "diamond";
        mouthMode =
          "serious";
      } else {
        eye = "square";
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
        eye = "oval";
      }

      if (
        state.mood ===
        "focused"
      ) {
        eye = "pill";
      }

      mouthMode =
        "listening";
    }

    if (
      state.phase ===
      "speaking"
    ) {
      switch (state.mood) {
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
      eye = "round";
      mouthMode =
        "neutral";
    }

    if (
      state.phase ===
      "error"
    ) {
      eye = "asymmetric";
      mouthMode =
        "error";
    }

    return {
      eye,
      mouth:
        mouthMode
    };
  }

  function render() {
    const character =
      activeCharacter();

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
      state.micLevel.toFixed(3)
    );

    mascot.style.setProperty(
      "--neyo-output-level",
      state.outputLevel.toFixed(3)
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

    emit(
      "neyo:mascot-render",
      {
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
    );
  }

  function setCharacter(
    id,
    options = {}
  ) {
    const requested =
      cleanId(id);

    const character =
      getCharacter(requested);

    if (!character) {
      return false;
    }

    state.characterId =
      character.id ||
      requested;

    try {
      if (
        window.NeyoCharacters &&
        typeof window.NeyoCharacters ===
          "object"
      ) {
        window.NeyoCharacters.active =
          state.characterId;
      }
    } catch {}

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
      state.active &&
      typeof face.animate ===
        "function"
    ) {
      face.animate(
        [
          {
            transform:
              "scale(.97)",
            opacity: 0.86
          },
          {
            transform:
              "scale(1.015)",
            opacity: 1,
            offset: 0.58
          },
          {
            transform:
              "scale(1)",
            opacity: 1
          }
        ],
        {
          duration: 420,
          easing:
            "cubic-bezier(.22,.88,.32,1)"
        }
      );
    }

    if (
      options.emitChange !==
      false
    ) {
      emit(
        "neyo:character-change",
        {
          id:
            state.characterId,

          character
        }
      );
    }

    return true;
  }

  function setMood(mood) {
    const value =
      String(mood || "")
        .trim()
        .toLowerCase();

    if (!value) {
      return false;
    }

    if (
      !BASE_EXPRESSIONS[value] &&
      !activeCharacter()
        ?.expressions
        ?.[value]
    ) {
      return false;
    }

    state.mood =
      value;

    render();

    return true;
  }

  function setPhase(value) {
    const next =
      PHASES.has(value)
        ? value
        : "idle";

    state.phase =
      next;

    if (
      next !== "speaking"
    ) {
      state.outputTarget =
        0;
    }

    if (
      next === "idle"
    ) {
      state.micTarget = 0;
      state.outputTarget = 0;
    }

    render();
    scheduleBlink();

    return next;
  }

  function clearBlink() {
    clearTimeout(
      blinkTimer
    );

    clearTimeout(
      blinkAnimationTimer
    );

    blinkTimer = 0;
    blinkAnimationTimer = 0;

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
      state.phase === "error"
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
      window.setTimeout(
        blink,
        delay
      );
  }

  function blink() {
    if (
      state.blinking ||
      !state.active ||
      reducedMotion
    ) {
      scheduleBlink();
      return false;
    }

    state.blinking =
      true;

    const character =
      activeCharacter();

    const playfulness =
      Number(
        character
          ?.personality
          ?.playfulness ??
        0
      );

    const canWink =
      playfulness > 0.55 &&
      [
        "happy",
        "playful"
      ].includes(
        state.mood
      ) &&
      Math.random() >
        0.965;

    if (canWink) {
      const className =
        Math.random() > 0.5
          ? "is-wink-left"
          : "is-wink-right";

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
          CONFIG.blinkDurationMs
        );

      return true;
    }

    mascot.classList.add(
      "is-blinking"
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
        CONFIG.blinkDurationMs
      );

    return true;
  }

  function updateMicroGaze(now) {
    if (
      reducedMotion ||
      !state.active ||
      state.pointerInside ||
      now <
        state.nextMicroGazeAt
    ) {
      return;
    }

    const character =
      activeCharacter();

    const strength =
      Number(
        character
          ?.motion
          ?.gazeMovement ??
        0.5
      );

    const thinkingStrength =
      Number(
        character
          ?.motion
          ?.thinkingScan ??
        0.5
      );

    state.nextMicroGazeAt =
      now +
      randomBetween(
        CONFIG.microGazeMinMs,
        CONFIG.microGazeMaxMs
      );

    let multiplier = 1;

    if (
      state.phase ===
      "listening"
    ) {
      multiplier = 0.34;
    }

    if (
      state.phase ===
      "speaking"
    ) {
      multiplier = 0.25;
    }

    if (
      state.phase ===
      "thinking"
    ) {
      multiplier =
        0.8 +
        thinkingStrength;
    }

    state.microTargetX =
      randomBetween(-2, 2) *
      strength *
      multiplier;

    state.microTargetY =
      randomBetween(
        -1.2,
        1.2
      ) *
      strength *
      multiplier;
  }

  function pointerMove(event) {
    if (
      !state.active ||
      reducedMotion
    ) {
      return;
    }

    const rect =
      mascot.getBoundingClientRect();

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

  function updateBody(now) {
    const character =
      activeCharacter();

    const profile =
      BASE_MOTION[
        state.phase
      ] ||
      BASE_MOTION.idle;

    const motion =
      character.motion ||
      {};

    const phaseProfile =
      character
        ?.phases
        ?.[state.phase] ||
      {};

    const energy =
      Number(
        phaseProfile.energy ??
        character
          ?.personality
          ?.energy ??
        0.5
      );

    const idleMotion =
      Number(
        motion.idleFloat ??
        0.5
      );

    const speechMovement =
      Number(
        motion.speechMovement ??
        0.5
      );

    const asymmetry =
      Number(
        motion.asymmetry ??
        0.15
      );

    const time =
      now / 1000;

    const strength =
      0.6 +
      energy * 0.75;

    let y =
      Math.sin(
        time *
        profile.speed *
        1.2
      ) *
      profile.y;

    y +=
      Math.sin(
        time *
        profile.speed *
        0.51 +
        0.7
      ) *
      profile.y *
      asymmetry;

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

    y *= strength;
    x *= strength;
    rotation *= strength;

    if (
      state.phase ===
      "listening"
    ) {
      const stillness =
        1 -
        state.micLevel *
        0.68;

      y *= stillness;
      x *= stillness;
      rotation *= stillness;

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
          speechMovement *
          0.8
        );

      scale +=
        state.outputLevel *
        (
          0.003 +
          speechMovement *
          0.006
        );

      rotation +=
        Math.sin(
          time * 4
        ) *
        state.outputLevel *
        speechMovement *
        0.18;
    }

    if (
      state.mood ===
      "curious"
    ) {
      rotation +=
        0.25 +
        Number(
          character
            ?.personality
            ?.curiosity ??
          0
        ) *
        0.3;
    }

    if (
      state.mood ===
      "skeptical"
    ) {
      rotation -=
        0.3;
    }

    if (
      state.pointerInside
    ) {
      const response =
        Number(
          motion.pointerResponse ??
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

  function updateGaze(now) {
    updateMicroGaze(now);

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
      activeCharacter();

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
          pointerResponse * 3
        );

      y +=
        state.pointerY *
        (
          1 +
          pointerResponse * 2
        );
    }

    if (
      state.phase ===
        "thinking" &&
      !state.pointerInside
    ) {
      const scan =
        Number(
          character
            ?.motion
            ?.thinkingScan ??
          0.5
        );

      const time =
        now / 1000;

      x +=
        Math.sin(
          time * 1.05
        ) *
        scan *
        3;

      y +=
        Math.sin(
          time * 0.68
        ) *
        scan *
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

  function updateSpeechBars(now) {
    if (!mouthBars.length) {
      return;
    }

    const movement =
      Number(
        activeCharacter()
          ?.motion
          ?.speechMovement ??
        0.5
      );

    if (
      state.phase !==
      "speaking"
    ) {
      for (
        let index = 0;
        index < mouthBars.length;
        index++
      ) {
        speechBars[index] =
          lerp(
            speechBars[index],
            1,
            0.18
          );

        mouthBars[index]
          .style
          .setProperty(
            "--neyo-speech-scale",
            speechBars[index]
              .toFixed(3)
          );

        mouthBars[index]
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
      0.5
    ];

    const time =
      now / 1000;

    for (
      let index = 0;
      index < mouthBars.length;
      index++
    ) {
      const weight =
        weights[index] ??
        0.7;

      const irregular =
        0.86 +
        Math.sin(
          time *
          (
            5.8 +
            index * 0.71
          ) +
          index
        ) *
        0.09 +
        Math.sin(
          time *
          (
            9.7 +
            index * 0.37
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
          movement * 0.75
        );

      speechBars[index] =
        lerp(
          speechBars[index],
          target,
          target >
            speechBars[index]
            ? 0.3
            : 0.17
        );

      const y =
        Math.sin(
          time * 3.4 +
          index * 0.78
        ) *
        state.outputLevel *
        (
          0.25 +
          movement * 0.55
        );

      mouthBars[index]
        .style
        .setProperty(
          "--neyo-speech-scale",
          speechBars[index]
            .toFixed(3)
        );

      mouthBars[index]
        .style
        .setProperty(
          "--neyo-speech-y",
          `${y.toFixed(2)}px`
        );
    }
  }

  function resetMotion() {
    body.x = 0;
    body.y = 0;
    body.rotation = 0;
    body.scale = 1;

    state.pointerInside =
      false;

    state.pointerTargetX = 0;
    state.pointerTargetY = 0;

    state.pointerX = 0;
    state.pointerY = 0;

    state.microTargetX = 0;
    state.microTargetY = 0;

    state.microX = 0;
    state.microY = 0;

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

  function open() {
    state.active = true;

    const registryCharacter =
      window.NeyoCharacters
        ?.active;

    if (
      registryCharacter &&
      getCharacter(
        registryCharacter
      )
    ) {
      state.characterId =
        registryCharacter;
    }

    const character =
      activeCharacter();

    state.phase = "idle";

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

    return true;
  }

  function close() {
    state.active = false;

    clearBlink();

    state.phase = "idle";

    state.micTarget = 0;
    state.outputTarget = 0;

    state.micLevel = 0;
    state.outputLevel = 0;

    resetMotion();
    render();

    return true;
  }

  function animate(now) {
    animationFrame =
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
    updateBody(now);
    updateGaze(now);
    updateSpeechBars(now);
  }

  reducedMotionQuery
    .addEventListener?.(
      "change",
      event => {
        reducedMotion =
          event.matches;

        if (reducedMotion) {
          clearBlink();
          resetMotion();
        } else if (
          state.active
        ) {
          scheduleBlink();
        }
      }
    );

  mascot.addEventListener(
    "pointermove",
    pointerMove,
    {
      passive: true
    }
  );

  mascot.addEventListener(
    "pointerleave",
    pointerLeave,
    {
      passive: true
    }
  );

  window.addEventListener(
    "neyo:voice-mode-opened",
    open
  );

  window.addEventListener(
    "neyo:voice-mode-closed",
    close
  );

  window.addEventListener(
    "neyo:voice-idle",
    () => {
      setPhase("idle");
    }
  );

  window.addEventListener(
    "neyo:voice-listening",
    () => {
      setPhase("listening");
    }
  );

  window.addEventListener(
    "neyo:voice-thinking",
    () => {
      setPhase("thinking");
    }
  );

  window.addEventListener(
    "neyo:voice-speaking",
    () => {
      setPhase("speaking");
    }
  );

  window.addEventListener(
    "neyo:voice-interrupted",
    () => {
      state.outputTarget = 0;
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
      state.outputTarget = 0;
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
            event.detail?.level
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
            event.detail?.level
          ) || 0,
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
          event.detail?.muted
        );

      render();
    }
  );

  window.addEventListener(
    "neyo:voice-speaker",
    event => {
      state.speakerOn =
        event.detail?.enabled !==
        false;

      render();
    }
  );

  window.addEventListener(
    "neyo:voice-camera-change",
    event => {
      state.cameraOn =
        Boolean(
          event.detail?.enabled
        );

      render();
    }
  );

  window.addEventListener(
    "neyo:mascot-intelligence",
    event => {
      const mood =
        event.detail?.mood;

      if (mood) {
        setMood(mood);
      }
    }
  );

  window.addEventListener(
    "neyo:character-select",
    event => {
      const id =
        event.detail?.id ||
        event.detail
          ?.character;

      if (id) {
        setCharacter(id);
      }
    }
  );

  const initialCharacter =
    window.NeyoCharacters
      ?.active;

  if (
    initialCharacter &&
    getCharacter(
      initialCharacter
    )
  ) {
    state.characterId =
      initialCharacter;
  }

  render();

  animationFrame =
    requestAnimationFrame(
      animate
    );

  const api =
    Object.freeze({
      __controller: true,
      version: VERSION,

      open,
      close,

      setCharacter,
      setMood,

      setTone:
        setMood,

      setPhase,

      blink,

      getCharacter() {
        return activeCharacter();
      },

      getState() {
        return {
          version: VERSION,

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
            state.cameraOn,

          reducedMotion
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoMascot",
    {
      value: api,
      writable: false,
      configurable: true,
      enumerable: true
    }
  );

  emit(
    "neyo:mascot-ready",
    {
      version: VERSION,
      character:
        state.characterId
    }
  );
})();
