/*
=========================================================
NEYO — CHARACTER PROFILE
Character #1

Purpose:
- Define NEYO visual identity
- Define default personality traits
- Define motion personality
- Define expression preferences
- Define voice identity metadata

Does NOT own:
- Gemini
- WebSocket
- actual speech config
- mascot rendering
- mood detection
=========================================================
*/

(() => {
  "use strict";

  const NEYO = Object.freeze({
    id: "neyo",

    name: "Neyo",

    role: "Primary Assistant",

    description:
      "Balanced, intelligent, friendly and calm-confident.",


    /* =====================================================
       VISUAL IDENTITY
       ===================================================== */

    visual: Object.freeze({
      bodyShape:
        "rounded-square",

      surface:
        "light",

      baseTone:
        "soft-neutral",

      faceInk:
        "dark",

      cornerStyle:
        "soft-premium",

      faceScale:
        1,

      bodyScale:
        1
    }),


    /* =====================================================
       CORE PERSONALITY
       0 → low
       1 → high
       ===================================================== */

    personality: Object.freeze({
      warmth:
        0.72,

      energy:
        0.56,

      curiosity:
        0.68,

      confidence:
        0.76,

      seriousness:
        0.62,

      playfulness:
        0.38,

      empathy:
        0.74,

      precision:
        0.74
    }),


    /* =====================================================
       DEFAULT FACE
       ===================================================== */

    defaultExpression: Object.freeze({
      mood:
        "friendly",

      eye:
        "arc",

      mouth:
        "smile"
    }),


    /* =====================================================
       EXPRESSION PREFERENCES

       These are preferences, not hard rules.
       mascot.js still decides phase + mood combination.
       ===================================================== */

    expressions: Object.freeze({
      friendly: Object.freeze({
        eye:
          "arc",

        mouth:
          "smile",

        intensity:
          0.62
      }),

      happy: Object.freeze({
        eye:
          "soft-arc",

        mouth:
          "smile-wide",

        intensity:
          0.78
      }),

      excited: Object.freeze({
        eye:
          "round",

        mouth:
          "speak-active",

        intensity:
          0.82
      }),

      calm: Object.freeze({
        eye:
          "half",

        mouth:
          "smile",

        intensity:
          0.42
      }),

      focused: Object.freeze({
        eye:
          "pill",

        mouth:
          "neutral",

        intensity:
          0.58
      }),

      curious: Object.freeze({
        eye:
          "asymmetric",

        mouth:
          "curious",

        intensity:
          0.68
      }),

      surprised: Object.freeze({
        eye:
          "round",

        mouth:
          "surprise",

        intensity:
          0.82
      }),

      empathetic: Object.freeze({
        eye:
          "soft-arc",

        mouth:
          "smile",

        intensity:
          0.48
      }),

      serious: Object.freeze({
        eye:
          "half",

        mouth:
          "serious",

        intensity:
          0.54
      }),

      playful: Object.freeze({
        eye:
          "asymmetric",

        mouth:
          "smirk",

        intensity:
          0.64
      }),

      skeptical: Object.freeze({
        eye:
          "half",

        mouth:
          "smirk",

        intensity:
          0.52
      }),

      confused: Object.freeze({
        eye:
          "asymmetric",

        mouth:
          "error",

        intensity:
          0.58
      })
    }),


    /* =====================================================
       PHASE PERSONALITY
       ===================================================== */

    phases: Object.freeze({
      idle: Object.freeze({
        energy:
          0.42,

        gaze:
          "soft",

        bodyMotion:
          "subtle",

        blinkRate:
          "natural"
      }),

      listening: Object.freeze({
        energy:
          0.34,

        gaze:
          "attentive",

        bodyMotion:
          "steady",

        blinkRate:
          "slow"
      }),

      thinking: Object.freeze({
        energy:
          0.46,

        gaze:
          "analytical",

        bodyMotion:
          "minimal",

        blinkRate:
          "reduced"
      }),

      speaking: Object.freeze({
        energy:
          0.58,

        gaze:
          "stable",

        bodyMotion:
          "balanced",

        blinkRate:
          "natural"
      }),

      interrupted: Object.freeze({
        energy:
          0.70,

        gaze:
          "alert",

        bodyMotion:
          "recoil",

        blinkRate:
          "none"
      })
    }),


    /* =====================================================
       MOTION IDENTITY
       ===================================================== */

    motion: Object.freeze({
      idleFloat:
        0.42,

      breathing:
        0.38,

      gazeMovement:
        0.52,

      thinkingScan:
        0.60,

      speechMovement:
        0.55,

      reactionStrength:
        0.62,

      pointerResponse:
        0.34,

      asymmetry:
        0.18
    }),


    /* =====================================================
       VOICE IDENTITY

       Metadata only.
       Actual Gemini voice config stays in voice.js.
       ===================================================== */

    voice: Object.freeze({
      gender:
        "female",

      identity:
        "balanced-female",

      tone:
        "clear",

      pace:
        "natural",

      energy:
        "balanced",

      warmth:
        "medium",

      confidence:
        "calm",

      preferredVoice:
        "Kore"
    }),


    /* =====================================================
       BEHAVIORAL STYLE
       ===================================================== */

    behavior: Object.freeze({
      responseStyle:
        "balanced",

      emotionalMirroring:
        0.72,

      expressionPersistence:
        0.68,

      interruptionSensitivity:
        0.78,

      conversationalEnergy:
        0.58
    })
  });


  /* =====================================================
     REGISTRY
     ===================================================== */

  window.NeyoCharacters =
    window.NeyoCharacters ||
    {};


  window.NeyoCharacters.neyo =
    NEYO;


  /* =====================================================
     ACTIVE CHARACTER FALLBACK
     ===================================================== */

  if (
    !window.NeyoCharacters.active
  ) {
    window.NeyoCharacters.active =
      "neyo";
  }


  /* =====================================================
     PUBLIC HELPER
     ===================================================== */

  window.NeyoCharacter =
    window.NeyoCharacter ||
    Object.freeze({

      get(id) {
        return (
          window.NeyoCharacters?.[id] ||
          null
        );
      },


      getActive() {
        const id =
          window.NeyoCharacters?.active ||
          "neyo";

        return (
          window.NeyoCharacters?.[id] ||
          NEYO
        );
      }
    });


  console.log(
    "[NEYO Character] Neyo profile loaded"
  );

})();
