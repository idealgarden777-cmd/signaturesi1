/*
=========================================================
NEYO — MASCOT INTELLIGENCE v1
Semantic mood + continuity controller

Purpose:
- Analyze hidden user / assistant transcript text
- Detect emotional intent
- Resolve conflicting tones
- Preserve mood across conversational turns
- Decay strong emotion naturally
- Avoid expression flicker
- Feed unified mascot.js only

Works with:
- voice.js
- mascot.js v3

Does NOT own:
- Gemini
- WebSocket
- audio
- body motion
- eye geometry
- mouth geometry
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     DEPENDENCY
     ===================================================== */

  function getMascot() {
    return window.NeyoMascot;
  }


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG = Object.freeze({

    defaultMood:
      "friendly",

    minConfidence:
      2,

    userWeight:
      1.15,

    assistantWeight:
      1.0,

    strongConfidence:
      6,

    veryStrongConfidence:
      9,

    neutralDecayDelayMs:
      2600,

    strongDecayDelayMs:
      4200,

    emotionalCarryMs:
      3200,

    repeatedSignalBoost:
      1.35,

    maxTextLength:
      6000,

    debug:
      false
  });


  /* =====================================================
     STATE
     ===================================================== */

  const state = {

    currentMood:
      "friendly",

    currentConfidence:
      0,

    currentSource:
      "system",

    previousMood:
      "friendly",

    previousConfidence:
      0,

    lastUserMood:
      "friendly",

    lastUserConfidence:
      0,

    lastAssistantMood:
      "friendly",

    lastAssistantConfidence:
      0,

    lastSignalAt:
      0,

    lastText:
      "",

    currentPhase:
      "idle",

    decayTimer:
      0
  };


  /* =====================================================
     HELPERS
     ===================================================== */

  function debug(...args) {
    if (!CONFIG.debug) return;

    console.log(
      "[NEYO Intelligence]",
      ...args
    );
  }


  function normalizeText(text) {
    return String(
      text || ""
    )
      .slice(
        0,
        CONFIG.maxTextLength
      )
      .toLowerCase()
      .replace(
        /[“”]/g,
        "\""
      )
      .replace(
        /[‘’]/g,
        "'"
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }


  function countMatches(
    text,
    patterns
  ) {
    let count = 0;

    for (
      const pattern
      of patterns
    ) {
      if (
        pattern.test(text)
      ) {
        count += 1;
      }
    }

    return count;
  }


  /* =====================================================
     RULES
     ===================================================== */

  const RULES = Object.freeze({

    excited: {
      base:
        4,

      patterns: [
        /\bso excited\b/,
        /\bvery excited\b/,
        /\bcan't wait\b/,
        /\bcannot wait\b/,
        /\bamazing\b/,
        /\bawesome\b/,
        /\bfantastic\b/,
        /\bincredible\b/,
        /\bbrilliant\b/,
        /\bwonderful\b/,
        /\byay\b/,
        /\bwoo+h?o*\b/
      ]
    },


    happy: {
      base:
        3,

      patterns: [
        /\bi am happy\b/,
        /\bi'm happy\b/,
        /\bso happy\b/,
        /\bvery happy\b/,
        /\bfeeling happy\b/,
        /\bfeel happy\b/,
        /\bglad\b/,
        /\bdelighted\b/,
        /\bpleased\b/,
        /\bgood news\b/,
        /\bgreat news\b/,
        /\blove this\b/,
        /\bi love\b/,
        /\bcelebrat(?:e|ing|ion)\b/
      ]
    },


    empathetic: {
      base:
        4,

      patterns: [
        /\bi am sad\b/,
        /\bi'm sad\b/,
        /\bfeel sad\b/,
        /\bfeeling sad\b/,
        /\bhurt\b/,
        /\bheartbroken\b/,
        /\blonely\b/,
        /\bworried\b/,
        /\banxious\b/,
        /\bafraid\b/,
        /\bscared\b/,
        /\bcrying\b/,
        /\bterrible\b/,
        /\bnot doing well\b/,
        /\bnot feeling good\b/
      ]
    },


    surprised: {
      base:
        4,

      patterns: [
        /\bwow\b/,
        /\bno way\b/,
        /\bunbelievable\b/,
        /\bunexpected\b/,
        /\bsurpris(?:e|ed|ing)\b/,
        /\boh my\b/,
        /\breally\?\b/
      ]
    },


    serious: {
      base:
        3,

      patterns: [
        /\bserious\b/,
        /\bimportant\b/,
        /\bcritical\b/,
        /\burgent\b/,
        /\bemergency\b/,
        /\bwarning\b/,
        /\bdanger\b/,
        /\bsecurity\b/,
        /\brisk\b/,
        /\bfailure\b/,
        /\bproblem\b/
      ]
    },


    curious: {
      base:
        2,

      patterns: [
        /\bwhy\b/,
        /\bhow\b/,
        /\bwhat if\b/,
        /\bi wonder\b/,
        /\bcurious\b/,
        /\binteresting\b/,
        /\btell me more\b/,
        /\bwhat do you think\b/,
        /\bcan you explain\b/
      ]
    },


    playful: {
      base:
        3,

      patterns: [
        /\bhaha+\b/,
        /\blol\b/,
        /\bfunny\b/,
        /\bjoke\b/,
        /\bkidding\b/,
        /\bjust kidding\b/,
        /😂/,
        /🤣/,
        /😄/
      ]
    },


    focused: {
      base:
        2,

      patterns: [
        /\bcode\b/,
        /\bdebug\b/,
        /\barchitecture\b/,
        /\banalyze\b/,
        /\banalysis\b/,
        /\bcalculate\b/,
        /\btechnical\b/,
        /\bproduction\b/,
        /\bperformance\b/
      ]
    },


    calm: {
      base:
        2,

      patterns: [
        /\bcalm\b/,
        /\bpeaceful\b/,
        /\brelax\b/,
        /\bgentle\b/,
        /\bquiet\b/,
        /\bcomfortable\b/
      ]
    },


    skeptical: {
      base:
        3,

      patterns: [
        /\bi don't think\b/,
        /\bi do not think\b/,
        /\bare you sure\b/,
        /\bnot convinced\b/,
        /\bdoubt\b/,
        /\bskeptical\b/,
        /\bdoesn't make sense\b/,
        /\bdoes not make sense\b/
      ]
    },


    confused: {
      base:
        3,

      patterns: [
        /\bi'm confused\b/,
        /\bi am confused\b/,
        /\bdon't understand\b/,
        /\bdo not understand\b/,
        /\bconfusing\b/,
        /\bwhat do you mean\b/,
        /\bdoesn't make sense\b/,
        /\bdoes not make sense\b/
      ]
    }
  });


  /* =====================================================
     NEGATION
     ===================================================== */

  const NEGATIONS = Object.freeze({

    happy: [
      /\bnot happy\b/,
      /\bunhappy\b/,
      /\bnot glad\b/,
      /\bnot excited\b/
    ],

    excited: [
      /\bnot excited\b/,
      /\bnot amazing\b/
    ]
  });


  /* =====================================================
     DETECT
     ===================================================== */

  function detectMood(
    rawText,
    source = "user"
  ) {

    const text =
      normalizeText(
        rawText
      );


    if (!text) {
      return {
        mood:
          CONFIG.defaultMood,

        confidence:
          0,

        scores:
          {}
      };
    }


    const scores = {};


    for (
      const [mood, rule]
      of Object.entries(RULES)
    ) {

      const matches =
        countMatches(
          text,
          rule.patterns
        );


      scores[mood] =
        matches *
        rule.base;
    }


    /*
    Negation corrections
    */

    for (
      const pattern
      of NEGATIONS.happy
    ) {

      if (
        pattern.test(text)
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
    }


    for (
      const pattern
      of NEGATIONS.excited
    ) {

      if (
        pattern.test(text)
      ) {

        scores.excited =
          0;
      }
    }


    /*
    Punctuation energy
    */

    const bangs =
      (
        text.match(/!/g) ||
        []
      ).length;


    if (
      bangs >= 2
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


    if (
      text.includes("?")
    ) {

      scores.curious =
        (
          scores.curious ||
          0
        ) +
        1;
    }


    /*
    Source weighting
    */

    const sourceWeight =
      source === "user"
        ? CONFIG.userWeight
        : CONFIG.assistantWeight;


    for (
      const key
      of Object.keys(scores)
    ) {

      scores[key] *=
        sourceWeight;
    }


    /*
    Strong emotional priorities
    */

    const priority = [
      "empathetic",
      "excited",
      "happy",
      "surprised",
      "serious",
      "confused",
      "skeptical",
      "playful",
      "curious",
      "focused",
      "calm"
    ];


    let winner =
      CONFIG.defaultMood;

    let confidence =
      0;


    for (
      const mood
      of priority
    ) {

      const value =
        scores[mood] ||
        0;


      if (
        value >
        confidence
      ) {

        winner =
          mood;

        confidence =
          value;
      }
    }


    /*
    Repetition boost
    */

    if (
      winner ===
      state.currentMood &&
      confidence > 0
    ) {

      confidence *=
        CONFIG.repeatedSignalBoost;
    }


    return {
      mood:
        winner,

      confidence,

      scores,

      text
    };
  }


  /* =====================================================
     RESOLVE SOURCE CONFLICTS
     ===================================================== */

  function resolveMood(
    result,
    source
  ) {

    const incomingMood =
      result.mood;


    let incomingConfidence =
      result.confidence;


    if (
      incomingConfidence <
      CONFIG.minConfidence
    ) {

      return null;
    }


    /*
    User emotional signal has preference
    while assistant is merely speaking.
    */

    if (
      source ===
        "assistant" &&
      state.lastUserConfidence >=
        CONFIG.strongConfidence &&
      performance.now() -
        state.lastSignalAt <
        CONFIG.emotionalCarryMs
    ) {

      const userMood =
        state.lastUserMood;


      const userEmotional =
        [
          "happy",
          "excited",
          "empathetic",
          "serious",
          "surprised"
        ].includes(
          userMood
        );


      if (
        userEmotional &&
        incomingConfidence <
          state.lastUserConfidence
      ) {

        return {
          mood:
            userMood,

          confidence:
            state.lastUserConfidence,

          source:
            "user-carry"
        };
      }
    }


    /*
    Don't let a weak generic mood instantly
    kill a stronger emotion.
    */

    if (
      state.currentConfidence >=
        CONFIG.strongConfidence &&
      incomingConfidence <
        state.currentConfidence *
        0.65
    ) {

      return null;
    }


    return {
      mood:
        incomingMood,

      confidence:
        incomingConfidence,

      source
    };
  }


  /* =====================================================
     APPLY
     ===================================================== */

  function applyMood({
    mood,
    confidence,
    source
  }) {

    const mascot =
      getMascot();


    if (
      !mascot?.setMood
    ) {

      debug(
        "Mascot API unavailable"
      );

      return;
    }


    state.previousMood =
      state.currentMood;


    state.previousConfidence =
      state.currentConfidence;


    state.currentMood =
      mood;


    state.currentConfidence =
      confidence;


    state.currentSource =
      source;


    state.lastSignalAt =
      performance.now();


    mascot.setMood(
      mood,
      {
        confidence
      }
    );


    window.dispatchEvent(
      new CustomEvent(
        "neyo:mascot-intelligence",
        {
          detail: {
            mood,
            confidence,
            source
          }
        }
      )
    );


    scheduleDecay();


    debug(
      "Applied",
      {
        mood,
        confidence,
        source
      }
    );
  }


  /* =====================================================
     ANALYZE
     ===================================================== */

  function analyze(
    text,
    source = "user"
  ) {

    const result =
      detectMood(
        text,
        source
      );


    state.lastText =
      result.text;


    if (
      source ===
      "user"
    ) {

      state.lastUserMood =
        result.mood;


      state.lastUserConfidence =
        result.confidence;

    } else {

      state.lastAssistantMood =
        result.mood;


      state.lastAssistantConfidence =
        result.confidence;
    }


    const resolved =
      resolveMood(
        result,
        source
      );


    if (resolved) {

      applyMood(
        resolved
      );
    }


    return {
      detected:
        result,

      resolved
    };
  }


  /* =====================================================
     DECAY
     ===================================================== */

  function scheduleDecay() {

    clearTimeout(
      state.decayTimer
    );


    const strong =
      state.currentConfidence >=
      CONFIG.strongConfidence;


    const delay =
      strong
        ? CONFIG.strongDecayDelayMs
        : CONFIG.neutralDecayDelayMs;


    state.decayTimer =
      setTimeout(
        decayMood,
        delay
      );
  }


  function decayMood() {

    const mascot =
      getMascot();


    if (!mascot?.setMood) {
      return;
    }


    /*
    Strong emotional states soften first.
    */

    if (
      [
        "excited",
        "surprised"
      ].includes(
        state.currentMood
      )
    ) {

      state.currentMood =
        "happy";


      state.currentConfidence =
        Math.max(
          2,
          state.currentConfidence *
          0.45
        );


      mascot.setMood(
        "happy",
        {
          confidence:
            state.currentConfidence,
          force:
            true
        }
      );


      state.decayTimer =
        setTimeout(
          decayMood,
          CONFIG.neutralDecayDelayMs
        );


      return;
    }


    if (
      [
        "empathetic",
        "serious",
        "skeptical",
        "confused"
      ].includes(
        state.currentMood
      )
    ) {

      state.currentMood =
        "calm";


      state.currentConfidence =
        2;


      mascot.setMood(
        "calm",
        {
          confidence:
            2,
          force:
            true
        }
      );


      state.decayTimer =
        setTimeout(
          decayMood,
          CONFIG.neutralDecayDelayMs
        );


      return;
    }


    /*
    Final neutral recovery.
    */

    state.currentMood =
      "friendly";


    state.currentConfidence =
      0;


    mascot.setMood(
      "friendly",
      {
        confidence:
          1,
        force:
          true
      }
    );
  }


  /* =====================================================
     PHASE AWARENESS
     ===================================================== */

  window.addEventListener(
    "neyo:voice-idle",
    () => {
      state.currentPhase =
        "idle";
    }
  );


  window.addEventListener(
    "neyo:voice-listening",
    () => {
      state.currentPhase =
        "listening";
    }
  );


  window.addEventListener(
    "neyo:voice-thinking",
    () => {
      state.currentPhase =
        "thinking";
    }
  );


  window.addEventListener(
    "neyo:voice-speaking",
    () => {
      state.currentPhase =
        "speaking";
    }
  );


  window.addEventListener(
    "neyo:voice-interrupted",
    () => {
      state.currentPhase =
        "interrupted";
    }
  );


  /* =====================================================
     TRANSCRIPT EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:voice-user-text",
    event => {

      const text =
        event?.detail?.text;


      if (!text) return;


      analyze(
        text,
        "user"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-assistant-text",
    event => {

      const text =
        event?.detail?.text;


      if (!text) return;


      analyze(
        text,
        "assistant"
      );
    }
  );


  /* =====================================================
     RESET
     ===================================================== */

  function reset() {

    clearTimeout(
      state.decayTimer
    );


    state.currentMood =
      "friendly";


    state.currentConfidence =
      0;


    state.currentSource =
      "system";


    state.previousMood =
      "friendly";


    state.previousConfidence =
      0;


    state.lastUserMood =
      "friendly";


    state.lastUserConfidence =
      0;


    state.lastAssistantMood =
      "friendly";


    state.lastAssistantConfidence =
      0;


    state.lastSignalAt =
      0;


    state.lastText =
      "";


    state.currentPhase =
      "idle";


    getMascot()
      ?.setMood
      ?.(
        "friendly",
        {
          confidence:
            1,
          force:
            true
        }
      );
  }


  window.addEventListener(
    "neyo:voice-open",
    reset
  );


  window.addEventListener(
    "neyo:voice-close",
    reset
  );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  window.NeyoMascotIntelligence =
    Object.freeze({

      analyze,

      detect:
        detectMood,

      reset,

      getState:
        () => ({
          currentMood:
            state.currentMood,

          currentConfidence:
            state.currentConfidence,

          currentSource:
            state.currentSource,

          previousMood:
            state.previousMood,

          lastUserMood:
            state.lastUserMood,

          lastUserConfidence:
            state.lastUserConfidence,

          lastAssistantMood:
            state.lastAssistantMood,

          lastAssistantConfidence:
            state.lastAssistantConfidence,

          currentPhase:
            state.currentPhase
        })
    });


  /* =====================================================
     INIT
     ===================================================== */

  console.log(
    "[NEYO Intelligence] Mood continuity engine loaded"
  );

})();
