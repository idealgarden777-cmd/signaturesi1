/*
=========================================================
NEYO — GEMINI LIVE VOICE TOKEN v4
STABLE CHARACTER VOICE VERSION

Fixed character voices:
- Neyo → Kore
- Zadi → Orus
- Wizi → Charon

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
    })
  });


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

    const token =
      await ai.authTokens.create({

        config: {

          uses:
            1,


          expireTime,


          newSessionExpireTime,


          liveConnectConstraints: {

            model:
              MODEL,


            config: {

              sessionResumption:
                {},


              responseModalities: [
                "AUDIO"
              ]
            }
          }
        }
      });


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
