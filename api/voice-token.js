/*
=========================================================
NEYO — GEMINI LIVE VOICE TOKEN v3
Server-side character + voice locking

Fixed voices:
- Neyo → Kore
- Zadi → Orus
- Wizi → Charon

Purpose:
- Keep permanent Gemini API key server-side
- Validate requested character
- Resolve character voice server-side
- Create one-use ephemeral Live token
- Lock token to model + AUDIO + exact voice
- Return token + resolved identity to browser

Requires:
- @google/genai
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


/* =========================================================
   CHARACTER VOICE POLICY

   Browser cannot choose arbitrary voices.
   It only requests a known character.
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


const DEFAULT_CHARACTER =
  "neyo";


/* =========================================================
   JSON HELPER
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
   BODY PARSER
   ========================================================= */

function readCharacter(
  req
) {

  let body =
    req.body;


  /*
  Vercel normally parses JSON automatically,
  but keep this defensive.
  */

  if (
    typeof body ===
    "string"
  ) {

    try {

      body =
        JSON.parse(body);

    } catch {

      body =
        {};
    }
  }


  const requested =
    String(
      body?.character ||
      DEFAULT_CHARACTER
    )
      .trim()
      .toLowerCase();


  if (
    CHARACTER_VOICES[
      requested
    ]
  ) {

    return requested;
  }


  return null;
}


/* =========================================================
   API HANDLER
   ========================================================= */

export default async function handler(
  req,
  res
) {

  /* -----------------------------------------------------
     POST ONLY
     ----------------------------------------------------- */

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


  /* -----------------------------------------------------
     SERVER SECRET
     ----------------------------------------------------- */

  const apiKey =
    process.env.GEMINI_API_KEY;


  if (!apiKey) {

    console.error(
      "[NEYO Voice Token] Missing GEMINI_API_KEY"
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


  /* -----------------------------------------------------
     CHARACTER VALIDATION
     ----------------------------------------------------- */

  const character =
    readCharacter(req);


  if (!character) {

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

    /* -------------------------------------------------
       GEMINI CLIENT
       ------------------------------------------------- */

    const ai =
      new GoogleGenAI({
        apiKey
      });


    /* -------------------------------------------------
       EXPIRATION

       expireTime:
       connection/message lifetime

       newSessionExpireTime:
       short window in which browser must start session
       ------------------------------------------------- */

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


    /* -------------------------------------------------
       CREATE CHARACTER-LOCKED TOKEN

       Critical:
       speechConfig is constrained here too.

       This prevents:
       zadi token → Kore
       wizi token → Kore
       etc.
       ------------------------------------------------- */

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

              /*
              Session resumption support
              */

              sessionResumption:
                {},


              /*
              Voice mode only
              */

              responseModalities: [
                "AUDIO"
              ],


              /*
              Exact character voice
              */

              speechConfig: {

                voiceConfig: {

                  prebuiltVoiceConfig: {

                    voiceName
                  }
                }
              }
            }
          },


          /*
          Explicitly state that we're only
          locking the fields supplied above.

          This lets client still configure
          transcription, VAD, system instruction,
          etc. unless separately constrained.
          */

          lockAdditionalFields:
            []
        }
      });


    /* -------------------------------------------------
       VALIDATE TOKEN
       ------------------------------------------------- */

    if (
      !token?.name
    ) {

      console.error(
        "[NEYO Voice Token] Gemini returned no token",
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


    /* -------------------------------------------------
       SUCCESS
       ------------------------------------------------- */

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

        message:
          error?.message,

        status:
          error?.status
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
