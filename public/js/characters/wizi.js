/*
=========================================================
WIZI — CHARACTER PROFILE
Character #3

Identity:
- Curious
- Imaginative
- Clever
- Exploratory
- Slightly quirky
- Bright female voice
- Organic premium geometry

Purpose:
- Register Wizi as a selectable NEYO character
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

  const WIZI = Object.freeze({
    id: "wizi",

    name: "Wizi",

    role: "Curious Explorer",

    description:
      "Curious, imaginative, clever and exploratory.",


    /* =====================================================
       VISUAL IDENTITY
       ===================================================== */

    visual: Object.freeze({
      bodyShape:
        "soft-orb",

      surface:
        "light",

      baseTone:
        "cool-neutral",

      faceInk:
        "dark",

      cornerStyle:
        "organic-soft",

      faceScale:
        0.98,

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
        0.70,

      energy:
        0.68,

      curiosity:
        0.94,

      confidence:
        0.72,

      seriousness:
        0.44,

      playfulness:
        0.64,

      empathy:
        0.66,

      precision:
        0.62
    }),


    /* =====================================================
       DEFAULT EXPRESSION
       ===================================================== */

    defaultExpression: Object.freeze({
      mood:
        "friendly",

      eye:
        "round",

      mouth:
        "smile"
    }),


    /* =====================================================
       EXPRESSION IDENTITY
       ===================================================== */

    expressions: Object.freeze({

      friendly: Object.freeze({
        eye:
          "round",

        mouth:
          "smile",

        intensity:
          0.68
      }),


      happy: Object.freeze({
        eye:
          "soft-arc",

        mouth:
          "smile-wide",

        intensity:
          0.82
      }),


      excited: Object.freeze({
        eye:
          "round",

        mouth:
          "speak-active",

        intensity:
          0.90
      }),


      calm: Object.freeze({
        eye:
          "half",

        mouth:
          "smile",

        intensity:
          0.40
      }),


      focused: Object.freeze({
        eye:
          "loop",

        mouth:
          "neutral",

        intensity:
          0.66
      }),


      curious: Object.freeze({
        eye:
          "asymmetric",

        mouth:
          "curious",

        intensity:
          0.94
      }),


      surprised: Object.freeze({
        eye:
          "round",

        mouth:
          "surprise",

        intensity:
          0.92
      }),


      empathetic: Object.freeze({
        eye:
          "soft-arc",

        mouth:
          "smile",

        intensity:
          0.46
      }),


      serious: Object.freeze({
        eye:
          "pill",

        mouth:
          "serious",

        intensity:
          0.52
      }),


      playful: Object.freeze({
        eye:
          "asymmetric",

        mouth:
          "smirk",

        intensity:
          0.82
      }),


      skeptical: Object.freeze({
        eye:
          "half",

        mouth:
          "smirk",

        intensity:
          0.58
      }),


      confused: Object.freeze({
        eye:
          "loop",

        mouth:
          "error",

        intensity:
          0.72
      })
    }),


    /* =====================================================
       PHASE PERSONALITY
       ===================================================== */

    phases: Object.freeze({

      idle: Object.freeze({
        energy:
          0.54,

        gaze:
          "exploratory",

        bodyMotion:
          "floaty",

        blinkRate:
          "natural"
      }),


      listening: Object.freeze({
        energy:
          0.42,

        gaze:
          "curious",

        bodyMotion:
          "attentive",

        blinkRate:
          "slow"
      }),


      thinking: Object.freeze({
        energy:
          0.70,

        gaze:
          "searching",

        bodyMotion:
          "soft-orbit",

        blinkRate:
          "reduced"
      }),


      speaking: Object.freeze({
        energy:
          0.68,

        gaze:
          "engaged",

        bodyMotion:
          "light-expressive",

        blinkRate:
          "natural"
      }),


      interrupted: Object.freeze({
        energy:
          0.84,

        gaze:
          "alert",

        bodyMotion:
          "quick-shift",

        blinkRate:
          "none"
      })
    }),


    /* =====================================================
       MOTION IDENTITY
       ===================================================== */

    motion: Object.freeze({
      idleFloat:
        0.68,

      breathing:
        0.44,

      gazeMovement:
        0.90,

      thinkingScan:
        0.94,

      speechMovement:
        0.66,

      reactionStrength:
        0.78,

      pointerResponse:
        0.70,

      asymmetry:
        0.34
    }),


    /* =====================================================
       VOICE IDENTITY
       Metadata only.
       voice.js reads preferredVoice.
       ===================================================== */

    voice: Object.freeze({
      gender:
        "female",

      identity:
        "bright-curious-female",

      tone:
        "bright",

      pace:
        "natural",

      energy:
        "light",

      warmth:
        "medium",

      confidence:
        "curious",

      preferredVoice:
        "Leda"
    }),


    /* =====================================================
       BEHAVIORAL STYLE
       ===================================================== */

    behavior: Object.freeze({
      responseStyle:
        "exploratory",

      emotionalMirroring:
        0.70,

      expressionPersistence:
        0.62,

      interruptionSensitivity:
        0.82,

      conversationalEnergy:
        0.72
    })
  });


  /* =====================================================
     REGISTRY
     ===================================================== */

  window.NeyoCharacters =
    window.NeyoCharacters ||
    {};


  window.NeyoCharacters.wizi =
    WIZI;


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
    "[NEYO Character] Wizi profile loaded"
  );

})();
