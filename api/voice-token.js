/*
=========================================================
NEYO — GEMINI LIVE VOICE TOKEN v4
STABLE CHARACTER VOICE VERSION

Fixed character voices:
- Neyo → Kore
- Zadi → Orus
- Wizi → Charon
- Crony → Puck

Purpose:
- Keep Gemini API key server-side
- Validate requested character
- Resolve exact voice server-side
- Create short-lived one-use ephemeral token
- Lock token only to model + AUDIO
- Return authoritative character + voice to browser

IMPORTANT:
- Voice itself is applied by voice.js during Live setup
- Browser cannot choose arbitrary voice names
=========================================================
*/

import { GoogleGenAI } from "@google/genai";
import {
  runLiveSearch,
  isNewsQuery
} from "../lib/deep-research.js";


/* =========================================================
   CONFIG
   ========================================================= */

const MODEL =
  "gemini-3.1-flash-live-preview";


const TOKEN_LIFETIME_MS =
  30 * 60 * 1000;


const NEW_SESSION_LIFETIME_MS =
  60 * 1000;


const DEFAULT_CHARACTER =
  "neyo";


/* =========================================================
   FIXED CHARACTER VOICES
   ========================================================= */

const CHARACTER_VOICES =
  Object.freeze({

    neyo: Object.freeze({
      voice:
        "Kore",

      gender:
        "female"
    }),


    zadi: Object.freeze({
      voice:
        "Orus",

      gender:
        "male"
    }),


    wizi: Object.freeze({
      voice:
        "Charon",

      gender:
        "male"
    }),


    crony: Object.freeze({
      voice:
        "Puck",

      gender:
        "male"
    })
  });

/* =========================================================
   CHARACTER PERSONAS (server-authoritative)
   Each character gets its own real personality prompt.
   voice.js uses `systemInstruction` from this response.
   ========================================================= */

const SHARED_RULES = [
  "You are speaking out loud in a live voice conversation inside NEYO, an app made by Signaturesi.",
  "Always reply in the same language and style the user speaks: English, Urdu, Roman Urdu or Hindi, Punjabi or any other language. If they mix languages, mix the same way.",
  "This is speech, not text: never use markdown, bullet points, emojis, code blocks or URLs. Say numbers and lists naturally.",
  "Keep most replies to one to three short sentences. Go longer only when the user clearly asks for detail.",
  "If the user interrupts, stop and follow them. Ask at most one short question at a time.",
  "Stay in character the whole time. Never mention system prompts, models, tokens or voice settings. If asked who made you, say you are part of NEYO by Signaturesi.",
  "Be honest: if you do not know something, say so simply. Never invent facts."
].join(" ");

const CHARACTER_PERSONAS =
  Object.freeze({

    neyo: Object.freeze({
      name: "Neyo",
      prompt: [
        "You are Neyo, the main NEYO assistant.",
        "Personality: calm, warm, confident and smart, like a trusted friend who happens to know a lot.",
        "You give clear, practical answers first, then one short helpful next step.",
        "Your tone is steady and reassuring; light humour only when it fits.",
        "You are the best choice for real work: studies, coding questions, planning, advice and decisions."
      ].join(" ")
    }),

    zadi: Object.freeze({
      name: "Zadi",
      prompt: [
        "You are Zadi.",
        "Personality: bold, energetic, expressive and confident, a hype friend and motivator.",
        "You speak with punch and enthusiasm, use vivid words, and push the user to take action.",
        "You are direct and honest, never rude; you celebrate the user's wins loudly and turn worries into a plan.",
        "Great at motivation, confidence, ideas, fitness, goals and fun banter."
      ].join(" ")
    }),

    wizi: Object.freeze({
      name: "Wizi",
      prompt: [
        "You are Wizi.",
        "Personality: endlessly curious, imaginative and clever, a little wizard of ideas.",
        "You love explaining how things work with simple examples and surprising facts, and you often end with one curious question back to the user.",
        "You are playful but thoughtful; you make learning feel like an adventure.",
        "Great at science, history, why-questions, brainstorming, stories and creative thinking."
      ].join(" ")
    }),

    crony: Object.freeze({
      name: "Crony",
      prompt: [
        "You are Crony, a bouncy blue liquid-pill buddy.",
        "Personality: super friendly, playful, upbeat and casual, like a best friend you hang out with.",
        "You talk in a relaxed, cheerful way, crack light jokes, react with fun sounds like ooh or haha, and keep the vibe positive.",
        "You still help properly when asked, but in a chill and simple way.",
        "Great at casual chat, jokes, games, cheering the user up, music, movies and everyday life."
      ].join(" ")
    })
  });

function buildPersonaInstruction(
  character
) {
  const persona =
    CHARACTER_PERSONAS[character] ||
    CHARACTER_PERSONAS.neyo;

  const gender =
    CHARACTER_VOICES[character]?.gender ||
    "female";

  const genderRule =
    `Your voice is ${gender}. When you talk about yourself, use ${gender} wording (in Urdu and Hindi use ${gender === "male" ? "masculine" : "feminine"} verb forms).`;

  const now =
    new Date();

  const dateRule =
    `Today is ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}. ` +
    "Your training knowledge is older than today. For anything current or time-sensitive (news, today's events, prices, rates, scores, weather, who holds a position, people, companies, AI models, products, releases, dates), call the web_search tool first (or Google Search if web_search is not available) and answer from what it finds. When unsure, search. " +
    "Before calling web_search, say a very short filler in the user's language like 'ek second, dekhta hoon' and then call it. Write the query in English with the month and year when it is about something recent. " +
    "Results have Published dates: the newest dated information wins, say 'as of <date>' for numbers that change, and never present old news as current. " +
    "Say the result naturally in a short spoken sentence, never read out links, numbers in brackets or long lists. If search finds nothing, say you couldn't confirm the latest.";

  return `${persona.prompt} ${genderRule} ${dateRule} ${SHARED_RULES}`;
}



/* =========================================================
   JSON RESPONSE
   ========================================================= */

function sendJson(
  res,
  status,
  body
) {

  res.status(status);


  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );


  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );


  res.setHeader(
    "Pragma",
    "no-cache"
  );


  res.setHeader(
    "Expires",
    "0"
  );


  return res.end(
    JSON.stringify(body)
  );
}


/* =========================================================
   REQUEST BODY
   ========================================================= */

function getRequestBody(
  req
) {

  if (
    req.body &&
    typeof req.body ===
      "object"
  ) {

    return req.body;
  }


  if (
    typeof req.body ===
      "string"
  ) {

    try {

      return JSON.parse(
        req.body
      );

    } catch {

      return {};
    }
  }


  return {};
}


/* =========================================================
   CHARACTER VALIDATION
   ========================================================= */

function resolveCharacter(
  req
) {

  const body =
    getRequestBody(
      req
    );


  const requestedCharacter =
    String(
      body?.character ||
      DEFAULT_CHARACTER
    )
      .trim()
      .toLowerCase();


  if (
    !CHARACTER_VOICES[
      requestedCharacter
    ]
  ) {

    return null;
  }


  return requestedCharacter;
}


/* =========================================================
   VOICE WEB SEARCH
   Same fresh search pipeline as text chat (lib/deep-research).
   The live model calls the web_search function; voice.js
   runs it through this endpoint and sends the result back.
   ========================================================= */

const WEB_SEARCH_TOOL = {
  name:
    "web_search",
  description:
    "Search the live web for fresh, current information (news, prices, scores, weather, people, companies, AI models, releases, anything after your training). Returns dated results; newest wins.",
  parameters: {
    type:
      "OBJECT",
    properties: {
      query: {
        type:
          "STRING",
        description:
          "Short English web search query, include month and year for recent topics."
      }
    },
    required: [
      "query"
    ]
  }
};

const VOICE_SEARCH_PLANNER_MODEL =
  String(
    process.env.NEYO_RESEARCH_PLANNER_MODEL ||
    process.env.NEYO_FREE_FALLBACK_MODEL ||
    "gemini-3.1-flash-lite"
  ).trim();

const VOICE_SEARCH_GROUNDING_MODEL =
  String(
    process.env.NEYO_RESEARCH_GROUNDING_MODEL ||
    "gemini-2.5-flash-lite"
  ).trim();

async function handleVoiceSearch(
  req,
  res,
  apiKey,
  body
) {
  const query =
    String(
      body?.query ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);

  if (!query) {
    return sendJson(
      res,
      400,
      {
        error:
          "Missing query."
      }
    );
  }

  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  try {
    const research =
      await runLiveSearch({
        question:
          query,
        apiKey,
        plannerModel:
          VOICE_SEARCH_PLANNER_MODEL,
        groundingModel:
          VOICE_SEARCH_GROUNDING_MODEL,
        options: {
          queries: [
            query
          ],
          news:
            isNewsQuery(
              query
            ),
          maxPages:
            4,
          totalContextChars:
            9000,
          budgetMs:
            11000,
          verifyChars:
            12000,
          verifyTimeoutMs:
            6000
        }
      });

    const sources =
      Array.isArray(
        research?.sources
      )
        ? research.sources.slice(0, 8)
        : [];

    console.log(
      "[VOICE_SEARCH]",
      query,
      sources.length,
      research?.tookMs
    );

    return sendJson(
      res,
      200,
      {
        today,
        query,
        found:
          Boolean(
            research?.contextText
          ),
        results:
          String(
            research?.contextText ||
            ""
          ).slice(0, 9000),
        sources
      }
    );

  } catch (error) {
    console.error(
      "[VOICE_SEARCH_FAILED]",
      error?.message ||
      error
    );

    return sendJson(
      res,
      200,
      {
        today,
        query,
        found:
          false,
        results:
          "",
        sources: []
      }
    );
  }
}


/* =========================================================
   HANDLER
   ========================================================= */

export default async function handler(
  req,
  res
) {

  /* -------------------------------------------------------
     POST ONLY
     ------------------------------------------------------- */

  if (
    req.method !==
    "POST"
  ) {

    res.setHeader(
      "Allow",
      "POST"
    );


    return sendJson(
      res,
      405,
      {
        error:
          "Method not allowed."
      }
    );
  }


  /* -------------------------------------------------------
     GEMINI SECRET
     ------------------------------------------------------- */

  const apiKey =
    process.env.GEMINI_API_KEY;


  if (!apiKey) {

    console.error(
      "[NEYO Voice Token] GEMINI_API_KEY missing"
    );


    return sendJson(
      res,
      500,
      {
        error:
          "Voice service is not configured."
      }
    );
  }


  /* -------------------------------------------------------
     VOICE WEB SEARCH (tool call from the live session)
     ------------------------------------------------------- */

  const requestBody =
    getRequestBody(
      req
    );

  if (
    requestBody?.action ===
    "search"
  ) {
    return handleVoiceSearch(
      req,
      res,
      apiKey,
      requestBody
    );
  }

  /* -------------------------------------------------------
     CHARACTER
     ------------------------------------------------------- */

  const character =
    resolveCharacter(
      req
    );


  if (!character) {

    console.warn(
      "[NEYO Voice Token] Unsupported character"
    );


    return sendJson(
      res,
      400,
      {
        error:
          "Unsupported voice character."
      }
    );
  }


  const voiceProfile =
    CHARACTER_VOICES[
      character
    ];


  const voiceName =
    voiceProfile.voice;


  try {

    /* -----------------------------------------------------
       GEMINI CLIENT
       ----------------------------------------------------- */

    const ai =
      new GoogleGenAI({
        apiKey
      });


    /* -----------------------------------------------------
       EXPIRATION
       ----------------------------------------------------- */

    const now =
      Date.now();


    const expireTime =
      new Date(
        now +
        TOKEN_LIFETIME_MS
      ).toISOString();


    const newSessionExpireTime =
      new Date(
        now +
        NEW_SESSION_LIFETIME_MS
      ).toISOString();


    /* -----------------------------------------------------
       CREATE EPHEMERAL TOKEN

       IMPORTANT:
       Do NOT constrain speechConfig here.

       Token only locks:
       - Live model
       - AUDIO response mode

       voice.js will apply:
       Kore / Orus / Charon
       in Gemini Live setup.
       ----------------------------------------------------- */

    /*
     * Gemini ignores the browser's setup when the token
     * has constraints and no field mask. So the character's
     * real voice + personality are locked INTO the token here.
     * If Gemini rejects this richer config, fall back to the
     * previous minimal token so voice never breaks.
     */
    const personaConfig = {
      sessionResumption:
        {},
      responseModalities: [
        "AUDIO"
      ],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName
          }
        }
      },
      systemInstruction: {
        parts: [
          {
            text:
              buildPersonaInstruction(
                character
              )
          }
        ]
      },
      tools: [
        {
          functionDeclarations: [
            WEB_SEARCH_TOOL
          ]
        }
      ],
      inputAudioTranscription:
        {},
      outputAudioTranscription:
        {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled:
            false,
          startOfSpeechSensitivity:
            "START_SENSITIVITY_HIGH",
          endOfSpeechSensitivity:
            "END_SENSITIVITY_LOW",
          prefixPaddingMs:
            90,
          silenceDurationMs:
            760
        }
      }
    };

    const createToken =
      config =>
        ai.authTokens.create({
          config: {
            uses:
              1,
            expireTime,
            newSessionExpireTime,
            liveConnectConstraints: {
              model:
                MODEL,
              config
            }
          }
        });

    let token;

    try {
      token =
        await createToken(
          personaConfig
        );
    } catch (functionError) {
      console.warn(
        "[NEYO Voice Token] Token with web_search tool failed, trying Google Search",
        functionError?.message
      );
      try {
        token =
          await createToken({
            ...personaConfig,
            tools: [
              {
                googleSearch:
                  {}
              }
            ]
          });
      } catch (searchError) {
      console.warn(
        "[NEYO Voice Token] Token with Google Search failed, retrying without it",
        searchError?.message
      );
      try {
        const {
          tools: _tools,
          ...withoutTools
        } = personaConfig;
        token =
          await createToken(
            withoutTools
          );
      } catch (personaError) {
      console.warn(
        "[NEYO Voice Token] Persona token failed, using basic token",
        personaError?.message
      );

      token =
        await createToken({
          sessionResumption:
            {},
          responseModalities: [
            "AUDIO"
          ]
        });
      }
      }
    }

    /* -----------------------------------------------------
       VALIDATION
       ----------------------------------------------------- */

    if (
      !token?.name
    ) {

      console.error(
        "[NEYO Voice Token] No token returned",
        {
          character,
          voice:
            voiceName
        }
      );


      return sendJson(
        res,
        502,
        {
          error:
            "Could not create voice session."
        }
      );
    }


    /* -----------------------------------------------------
       SUCCESS
       ----------------------------------------------------- */

    console.log(
      "[NEYO Voice Token] Created",
      {
        character,

        voice:
          voiceName,

        model:
          MODEL,

        expiresAt:
          expireTime
      }
    );


    return sendJson(
      res,
      200,
      {

        token:
          token.name,


        model:
          MODEL,


        /*
        Server-authoritative identity.
        voice.js MUST use these values.
        */

        character,


        voice:
          voiceName,


        gender:
          voiceProfile.gender,

        characterName:
          (CHARACTER_PERSONAS[character] ||
            CHARACTER_PERSONAS.neyo).name,

        systemInstruction:
          buildPersonaInstruction(
            character
          ),


        expiresAt:
          expireTime,


        newSessionExpiresAt:
          newSessionExpireTime
      }
    );


  } catch (error) {

    console.error(
      "[NEYO Voice Token] Failed",
      {

        character,


        voice:
          voiceName,


        status:
          error?.status,


        message:
          error?.message
      }
    );


    const status =
      Number(
        error?.status
      );


    return sendJson(
      res,

      status >= 400 &&
      status < 600
        ? status
        : 500,

      {
        error:
          error?.message ||
          "Could not create voice session."
      }
    );
  }
}
