/*
=========================================================
NEYO — GEMINI LIVE VOICE TOKEN
Minimal production version

Purpose:
- Keep permanent Gemini API key server-side
- Create one-use ephemeral Live API token
- Lock token to NEYO voice model
- Return token to browser

Requires:
@google/genai
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
        "no-store"
    );

    return res.end(
        JSON.stringify(body)
    );
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
        req.method !== "POST"
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
           ------------------------------------------------- */

        const expireTime =
            new Date(
                Date.now() +
                TOKEN_LIFETIME_MS
            ).toISOString();


        /* -------------------------------------------------
           CREATE EPHEMERAL TOKEN
           ------------------------------------------------- */

        const token =
            await ai.authTokens.create({

                config: {

                    /*
                    One token = one new Live connection.
                    */

                    uses:
                        1,


                    /*
                    Short-lived credential.
                    */

                    expireTime,


                    /*
                    Browser may use this token only
                    for this exact Live configuration.
                    */

                    liveConnectConstraints: {

                        model:
                            MODEL,

                        config: {

                            responseModalities: [
                                "AUDIO"
                            ]
                        }
                    }
                }
            });


        /* -------------------------------------------------
           VALIDATE
           ------------------------------------------------- */

        if (
            !token?.name
        ) {

            console.error(
                "[NEYO Voice Token] Gemini returned no token"
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

                expiresAt:
                    expireTime
            }
        );


    } catch (error) {

        console.error(
            "[NEYO Voice Token] Failed:",
            error
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
