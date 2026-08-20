/*
=========================================================
NEYO — MASCOT TONE ENGINE
Local semantic expression controller

Purpose:
- Detect conversational tone from text
- Convert meaning → mascot expression
- Keep expression changes smooth and stable
- No extra Gemini/API request
- No extra AI cost
- No transcript shown to user

Flow:
conversation text
→ tone detection
→ confidence scoring
→ expression hold
→ NeyoMascot.setTone()

Does NOT own:
- Gemini connection
- audio capture
- voice playback
- UI layout
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG = Object.freeze({
    defaultTone:
      "friendly",

    minimumConfidence:
      1,

    normalHoldMs:
      1200,

    strongHoldMs:
      1800,

    excitedHoldMs:
      2200,

    maxTextLength:
      5000,

    debug:
      false
  });


  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    currentTone:
      "friendly",

    confidence:
      0,

    source:
      null,

    lockedUntil:
      0,

    pendingTone:
      null,

    pendingConfidence:
      0,

    pendingSource:
      null,

    lastText:
      ""
  };


  let pendingTimer =
    0;


  /* =====================================================
     LOG
     ===================================================== */

  function debug(...args) {
    if (!CONFIG.debug) {
      return;
    }

    console.log(
      "[NEYO Tone]",
      ...args
    );
  }


  /* =====================================================
     NORMALIZE
     ===================================================== */

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
        /[“”‘’]/g,
        "'"
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }


  /* =====================================================
     TONE RULES
     ===================================================== */

  const RULES = Object.freeze({

    excited: {
      weight:
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
        /\bexcellent\b/,
        /\bbrilliant\b/,
        /\bwonderful\b/,
        /\bwoo+h?o*\b/,
        /\byay\b/
      ]
    },


    happy: {
      weight:
        3,

      patterns: [
        /\bi am happy\b/,
        /\bi'm happy\b/,
        /\bfeeling happy\b/,
        /\bvery happy\b/,
        /\bso happy\b/,
        /\bglad\b/,
        /\bdelighted\b/,
        /\bpleased\b/,
        /\bgood news\b/,
        /\bgreat news\b/,
        /\bcelebrat(?:e|ing|ion)\b/,
        /\blove this\b/,
        /\bi love\b/,
        /\bbeautiful\b/
      ]
    },


    empathetic: {
      weight:
        4,

      patterns: [
        /\bi am sad\b/,
        /\bi'm sad\b/,
        /\bfeel sad\b/,
        /\bupset\b/,
        /\bhurt\b/,
        /\blonely\b/,
        /\bdepressed\b/,
        /\bworried\b/,
        /\banxious\b/,
        /\bafraid\b/,
        /\bscared\b/,
        /\bterrible\b/,
        /\bheartbroken\b/,
        /\bsorry\b/,
        /\blost someone\b/,
        /\bdied\b/,
        /\bdeath\b/,
        /\bcrying\b/,
        /\bnot feeling good\b/,
        /\bnot doing well\b/
      ]
    },


    surprised: {
      weight:
        4,

      patterns: [
        /\bwow\b/,
        /\bno way\b/,
        /\breally\?\b/,
        /\bseriously\?\b/,
        /\bunbelievable\b/,
        /\bunexpected\b/,
        /\bsurpris(?:e|ed|ing)\b/,
        /\bwhat!\b/,
        /\boh my\b/
      ]
    },


    curious: {
      weight:
        2,

      patterns: [
        /\bwhy\b/,
        /\bhow\b/,
        /\bwhat if\b/,
        /\bwhat happens\b/,
        /\bi wonder\b/,
        /\bcurious\b/,
        /\binteresting\b/,
        /\bcan you explain\b/,
        /\btell me more\b/,
        /\bdo you think\b/,
        /\bwhat do you think\b/
      ]
    },


    serious: {
      weight:
        3,

      patterns: [
        /\bserious\b/,
        /\bimportant\b/,
        /\bcritical\b/,
        /\burgent\b/,
        /\bemergency\b/,
        /\bwarning\b/,
        /\bdanger\b/,
        /\brisk\b/,
        /\bcareful\b/,
        /\bmust\b/,
        /\bneed to know\b/,
        /\bsecurity\b/,
        /\bproblem\b/,
        /\bfailure\b/
      ]
    },


    playful: {
      weight:
        2,

      patterns: [
        /\bhaha+\b/,
        /\blol\b/,
        /\bfunny\b/,
        /\bjoke\b/,
        /\bkidding\b/,
        /\bjust kidding\b/,
        /\bfun\b/,
        /\bplayful\b/,
        /😂/,
        /🤣/,
        /😄/
      ]
    },


    focused: {
      weight:
        2,

      patterns: [
        /\bcode\b/,
        /\barchitecture\b/,
        /\bdebug\b/,
        /\bimplement\b/,
        /\btechnical\b/,
        /\banalyze\b/,
        /\banalysis\b/,
        /\bcompare\b/,
        /\bcalculate\b/,
        /\bexplain step by step\b/,
        /\bproduction\b/,
        /\bperformance\b/
      ]
    },


    calm: {
      weight:
        2,

      patterns: [
        /\brelax\b/,
        /\bcalm\b/,
        /\bpeaceful\b/,
        /\bslowly\b/,
        /\btake your time\b/,
        /\bquiet\b/,
        /\bgentle\b/,
        /\bcomfortable\b/
      ]
    }
  });


  /* =====================================================
     POSITIVE INTENSIFIERS
     ===================================================== */

  const INTENSIFIERS = [
    /\bvery\b/,
    /\breally\b/,
    /\bextremely\b/,
    /\bso\b/,
    /\bsuper\b/,
    /\babsolutely\b/,
    /\bincredibly\b/
  ];


  /* =====================================================
     NEGATION
     ===================================================== */

  const NEGATIVE_HAPPY_PATTERNS = [
    /\bnot happy\b/,
    /\bnot excited\b/,
    /\bnot glad\b/,
    /\bnot good\b/,
    /\bunhappy\b/
  ];


  /* =====================================================
     SCORE RULE
     ===================================================== */

  function scoreRule(
    text,
    rule
  ) {
    let score =
      0;

    for (
      const pattern
      of rule.patterns
    ) {
      if (
        pattern.test(text)
      ) {
        score +=
          rule.weight;
      }
    }

    return score;
  }


  /* =====================================================
     DETECT
     ===================================================== */

  function detectTone(text) {
    const normalized =
      normalizeText(text);

    if (!normalized) {
      return {
        tone:
          CONFIG.defaultTone,

        confidence:
          0,

        text:
          ""
      };
    }


    const scores = {
      friendly:
        0
    };


    for (
      const [tone, rule]
      of Object.entries(RULES)
    ) {
      scores[tone] =
        scoreRule(
          normalized,
          rule
        );
    }


    /*
    Prevent:
    "I'm not happy"
    → happy face
    */

    if (
      NEGATIVE_HAPPY_PATTERNS.some(
        pattern =>
          pattern.test(
            normalized
          )
      )
    ) {
      scores.happy =
        0;

      scores.excited =
        0;

      scores.empathetic =
        Math.max(
          scores.empathetic,
          4
        );
    }


    /*
    Intensifiers strengthen emotional
    expressions only when an emotion
    already exists.
    */

    const hasIntensifier =
      INTENSIFIERS.some(
        pattern =>
          pattern.test(
            normalized
          )
      );


    if (hasIntensifier) {
      if (
        scores.happy > 0
      ) {
        scores.happy +=
          1;
      }

      if (
        scores.excited > 0
      ) {
        scores.excited +=
          1;
      }

      if (
        scores.empathetic > 0
      ) {
        scores.empathetic +=
          1;
      }

      if (
        scores.serious > 0
      ) {
        scores.serious +=
          1;
      }
    }


    /*
    Exclamation marks add some energy.
    */

    const exclamations =
      (
        normalized.match(
          /!/g
        ) ||
        []
      ).length;


    if (
      exclamations >= 2
    ) {
      if (
        scores.happy > 0
      ) {
        scores.happy +=
          1;
      }

      if (
        scores.excited > 0
      ) {
        scores.excited +=
          2;
      }

      if (
        scores.surprised > 0
      ) {
        scores.surprised +=
          1;
      }
    }


    /*
    Question mark helps curious tone,
    but doesn't override stronger emotion.
    */

    if (
      normalized.includes("?")
    ) {
      scores.curious =
        (
          scores.curious ||
          0
        ) +
        1;
    }


    let winningTone =
      CONFIG.defaultTone;

    let winningScore =
      0;


    for (
      const [tone, score]
      of Object.entries(scores)
    ) {
      if (
        score >
        winningScore
      ) {
        winningTone =
          tone;

        winningScore =
          score;
      }
    }


    /*
    Prefer emotional expressions over
    generic focused/curious when scores
    are almost tied.
    */

    const emotionalPriority = [
      "empathetic",
      "excited",
      "happy",
      "surprised",
      "serious",
      "playful"
    ];


    for (
      const tone
      of emotionalPriority
    ) {
      if (
        scores[tone] > 0 &&
        scores[tone] >=
          winningScore - 1
      ) {
        winningTone =
          tone;

        winningScore =
          scores[tone];

        break;
      }
    }


    if (
      winningScore <
      CONFIG.minimumConfidence
    ) {
      winningTone =
        CONFIG.defaultTone;
    }


    return {
      tone:
        winningTone,

      confidence:
        winningScore,

      scores,

      text:
        normalized
    };
  }


  /* =====================================================
     HOLD DURATION
     ===================================================== */

  function getHoldDuration(
    tone,
    confidence
  ) {
    if (
      tone === "excited" ||
      tone === "surprised"
    ) {
      return CONFIG.excitedHoldMs;
    }

    if (
      confidence >= 5 ||
      tone === "empathetic" ||
      tone === "serious"
    ) {
      return CONFIG.strongHoldMs;
    }

    return CONFIG.normalHoldMs;
  }


  /* =====================================================
     APPLY TONE
     ===================================================== */

  function applyTone(
    tone,
    options = {}
  ) {
    if (!tone) {
      return;
    }


    const confidence =
      Number(
        options.confidence
      ) ||
      1;


    const source =
      options.source ||
      "unknown";


    /*
    Don't let weak friendly results
    instantly erase a strong emotion.
    */

    if (
      performance.now() <
        state.lockedUntil &&
      !options.force
    ) {
      state.pendingTone =
        tone;

      state.pendingConfidence =
        confidence;

      state.pendingSource =
        source;


      clearTimeout(
        pendingTimer
      );


      const delay =
        Math.max(
          0,
          state.lockedUntil -
          performance.now()
        );


      pendingTimer =
        setTimeout(
          () => {
            if (
              !state.pendingTone
            ) {
              return;
            }

            const pending =
              state.pendingTone;

            const pendingConfidence =
              state.pendingConfidence;

            const pendingSource =
              state.pendingSource;


            state.pendingTone =
              null;

            state.pendingConfidence =
              0;

            state.pendingSource =
              null;


            applyTone(
              pending,
              {
                confidence:
                  pendingConfidence,

                source:
                  pendingSource,

                force:
                  true
              }
            );
          },
          delay + 10
        );


      return;
    }


    state.currentTone =
      tone;

    state.confidence =
      confidence;

    state.source =
      source;


    const hold =
      getHoldDuration(
        tone,
        confidence
      );


    state.lockedUntil =
      performance.now() +
      hold;


    /*
    Main mascot API
    */

    window.NeyoMascot
      ?.setTone
      ?.(
        tone,
        {
          force: true,
          major:
            confidence >= 5
        }
      );


    /*
    Optional event for debugging /
    other future UI consumers.
    */

    window.dispatchEvent(
      new CustomEvent(
        "neyo:mascot-tone",
        {
          detail: {
            tone,
            confidence,
            source
          }
        }
      )
    );


    debug(
      "Applied",
      {
        tone,
        confidence,
        source
      }
    );
  }


  /* =====================================================
     ANALYZE + APPLY
     ===================================================== */

  function analyze(
    text,
    options = {}
  ) {
    const result =
      detectTone(text);


    state.lastText =
      result.text;


    if (
      result.confidence === 0 &&
      options.ignoreNeutral
    ) {
      return result;
    }


    applyTone(
      result.tone,
      {
        confidence:
          result.confidence,

        source:
          options.source ||
          "text",

        force:
          options.force
      }
    );


    return result;
  }


  /* =====================================================
     USER TEXT EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:voice-user-text",
    event => {
      const text =
        event?.detail?.text;

      if (!text) {
        return;
      }


      analyze(
        text,
        {
          source:
            "user",

          /*
          User emotion should affect
          Listening / Thinking expression.
          */
          ignoreNeutral:
            true
        }
      );
    }
  );


  /* =====================================================
     ASSISTANT TEXT EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:voice-assistant-text",
    event => {
      const text =
        event?.detail?.text;

      if (!text) {
        return;
      }


      analyze(
        text,
        {
          source:
            "assistant",

          /*
          Assistant response tone can
          drive speaking expression.
          */
          ignoreNeutral:
            true
        }
      );
    }
  );


  /* =====================================================
     GENERIC TEXT EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:mascot-analyze-text",
    event => {
      const text =
        event?.detail?.text;

      if (!text) {
        return;
      }


      analyze(
        text,
        {
          source:
            event?.detail?.source ||
            "manual",

          force:
            event?.detail?.force
        }
      );
    }
  );


  /* =====================================================
     EXPLICIT TONE EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:mascot-set-tone",
    event => {
      const tone =
        event?.detail?.tone;

      if (!tone) {
        return;
      }


      applyTone(
        tone,
        {
          confidence:
            event?.detail?.confidence ||
            5,

          source:
            event?.detail?.source ||
            "explicit",

          force:
            Boolean(
              event?.detail?.force
            )
        }
      );
    }
  );


  /* =====================================================
     SESSION RESET
     ===================================================== */

  window.addEventListener(
    "neyo:voice-open",
    () => {
      state.currentTone =
        "friendly";

      state.confidence =
        0;

      state.source =
        null;

      state.lockedUntil =
        0;

      state.pendingTone =
        null;

      state.lastText =
        "";
    }
  );


  window.addEventListener(
    "neyo:voice-close",
    () => {
      clearTimeout(
        pendingTimer
      );

      pendingTimer =
        0;

      state.currentTone =
        "friendly";

      state.confidence =
        0;

      state.source =
        null;

      state.lockedUntil =
        0;

      state.pendingTone =
        null;

      state.lastText =
        "";
    }
  );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  window.NeyoMascotTone =
    Object.freeze({

      analyze,

      detect:
        detectTone,

      setTone:
        applyTone,

      getState:
        () => ({
          currentTone:
            state.currentTone,

          confidence:
            state.confidence,

          source:
            state.source,

          lockedUntil:
            state.lockedUntil,

          pendingTone:
            state.pendingTone,

          lastText:
            state.lastText
        })
    });


  /* =====================================================
     INIT
     ===================================================== */

  console.log(
    "[NEYO Tone] Local semantic tone engine loaded"
  );

})();
