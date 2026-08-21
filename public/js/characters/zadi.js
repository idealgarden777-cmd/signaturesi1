/*
=========================================================
ZADI — CHARACTER PROFILE
Character #2

Identity:
- Confident
- Energetic
- Expressive
- Slightly playful
- Fast reactions
- Strong male voice
- Sharper premium geometry

Purpose:
- Register Zadi as a selectable NEYO character
- Define visual identity
- Define expression preferences
- Define motion personality
- Define voice metadata

Does NOT own:
- Gemini connection
- WebSocket
- actual speech setup
- mascot rendering
- mood detection
=========================================================
*/

(() => {
  "use strict";

  const ZADI = Object.freeze({
    id: "zadi",

    name: "Zadi",

    role: "Expressive Companion",

    description:
      "Confident, energetic, expressive and playful.",


    /* =====================================================
       VISUAL IDENTITY
       ===================================================== */

    visual: Object.freeze({
      bodyShape:
        "soft-diamond",

      surface:
        "light",

      baseTone:
        "warm-neutral",

      faceInk:
        "dark",

      cornerStyle:
        "angular-soft",

      faceScale:
        0.99,

      bodyScale:
        1.01
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
        0.82,

      curiosity:
        0.64,

      confidence:
        0.88,

      seriousness:
        0.46,

      playfulness:
        0.72,

      empathy:
        0.68,

      precision:
        0.58
    }),


    /* =====================================================
       DEFAULT EXPRESSION
       ===================================================== */

    defaultExpression: Object.freeze({
      mood:
        "friendly",

      eye:
        "oval",

      mouth:
        "smile"
    }),


    /* =====================================================
       EXPRESSION IDENTITY
       ===================================================== */

    expressions: Object.freeze({

      friendly: Object.freeze({
        eye:
          "oval",

        mouth:
          "smile",

        intensity:
          0.70
      }),


      happy: Object.freeze({
        eye:
          "soft-arc",

        mouth:
          "smile-wide",

        intensity:
          0.86
      }),


      excited: Object.freeze({
        eye:
          "round",

        mouth:
          "speak-active",

        intensity:
          0.96
      }),


      calm: Object.freeze({
        eye:
          "half",

        mouth:
          "smile",

        intensity:
          0.44
      }),


      focused: Object.freeze({
        eye:
          "diamond",

        mouth:
          "neutral",

        intensity:
          0.68
      }),


      curious: Object.freeze({
        eye:
          "asymmetric",

        mouth:
          "curious",

        intensity:
          0.78
      }),


      surprised: Object.freeze({
        eye:
          "round",

        mouth:
          "surprise",

        intensity:
          0.94
      }),


      empathetic: Object.freeze({
        eye:
          "soft-arc",

        mouth:
          "smile",

        intensity:
          0.50
      }),


      serious: Object.freeze({
        eye:
          "pill",

        mouth:
          "serious",

        intensity:
          0.60
      }),


      playful: Object.freeze({
        eye:
          "asymmetric",

        mouth:
          "smirk",

        intensity:
          0.88
      }),


      skeptical: Object.freeze({
        eye:
          "asymmetric",

        mouth:
          "smirk",

        intensity:
          0.64
      }),


      confused: Object.freeze({
        eye:
          "asymmetric",

        mouth:
          "error",

        intensity:
          0.68
      })
    }),


    /* =====================================================
       PHASE PERSONALITY
       ===================================================== */

    phases: Object.freeze({

      idle: Object.freeze({
        energy:
          0.62,

        gaze:
          "alive",

        bodyMotion:
          "light",

        blinkRate:
          "natural"
      }),


      listening: Object.freeze({
        energy:
          0.50,

        gaze:
          "engaged",

        bodyMotion:
          "attentive",

        blinkRate:
          "natural"
      }),


      thinking: Object.freeze({
        energy:
          0.58,

        gaze:
          "quick",

        bodyMotion:
          "controlled",

        blinkRate:
          "reduced"
      }),


      speaking: Object.freeze({
        energy:
          0.82,

        gaze:
          "expressive",

        bodyMotion:
          "lively",

        blinkRate:
          "natural"
      }),


      interrupted: Object.freeze({
        energy:
          0.92,

        gaze:
          "alert",

        bodyMotion:
          "quick-recoil",

        blinkRate:
          "none"
      })
    }),


    /* =====================================================
       MOTION IDENTITY
       ===================================================== */

    motion: Object.freeze({
      idleFloat:
        0.56,

      breathing:
        0.48,

      gazeMovement:
        0.72,

      thinkingScan:
        0.72,

      speechMovement:
        0.80,

      reactionStrength:
        0.86,

      pointerResponse:
        0.52,

      asymmetry:
        0.30
    }),


    /* =====================================================
       VOICE IDENTITY
       Metadata only.
       voice.js reads preferredVoice.
       ===================================================== */

    voice: Object.freeze({
      gender:
        "male",

      identity:
        "confident-expressive-male",

      tone:
        "confident",

      pace:
        "natural",

      energy:
        "energetic",

      warmth:
        "medium",

      confidence:
        "strong",

      preferredVoice:
        "Orus"
    }),


    /* =====================================================
       BEHAVIORAL STYLE
       ===================================================== */

    behavior: Object.freeze({
      responseStyle:
        "expressive",

      emotionalMirroring:
        0.78,

      expressionPersistence:
        0.58,

      interruptionSensitivity:
        0.86,

      conversationalEnergy:
        0.84
    })
  });


  /* =====================================================
     REGISTRY
     ===================================================== */

  window.NeyoCharacters =
    window.NeyoCharacters ||
    {};


  window.NeyoCharacters.zadi =
    ZADI;


  /* =====================================================
     FALLBACK ACCESS HELPER
     ===================================================== */

  if (
    !window.NeyoCharacter
  ) {

    window.NeyoCharacter =
      Object.freeze({

        get(id) {
          return (
            window.NeyoCharacters?.[id] ||
            null
          );
        },


        getActive() {

          const id =
            window
              .NeyoCharacters
              ?.active ||
            "neyo";


          return (
            window.NeyoCharacters?.[id] ||
            null
          );
        }
      });
  }


  console.log(
    "[NEYO Character] Zadi profile loaded",
    {
      voice:
        ZADI.voice.preferredVoice,

      gender:
        ZADI.voice.gender
    }
  );

})();
