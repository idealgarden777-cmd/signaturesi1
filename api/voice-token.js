/*
=========================================================
NEYO — LIVE VOICE TOKEN API

Purpose:
- Create short-lived Gemini Live API token
- Keep permanent GEMINI_API_KEY server-side
- Restrict token to NEYO voice model
- One token = one Live session

Requires:
npm install @google/genai
=========================================================
*/

import { GoogleGenAI } from "@google/genai";


/* =========================================================
   CONFIG
   ========================================================= */

const MODEL =
    "gemini-2.5-flash-native-audio-preview-12-2025";


/*
Ephemeral token lifetime.

Google allows short-lived tokens for client-side
Live API connections.

30 minutes is enough for a normal voice session.
*/

const TOKEN_LIFETIME_MS =
    30 * 60 * 1000;


/* =========================================================
   RESPONSE HELPER
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

    return res.end(
        JSON.stringify(body)
    );
}


/* =========================================================
   HANDLER
   ========================================================= */

export default async function handler(
    req,
    res
) {

    /* -----------------------------------------------------
       METHOD
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
       SERVER API KEY
       ----------------------------------------------------- */

    const apiKey =
        process.env
            .GEMINI_API_KEY;


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


    try {

        /* -------------------------------------------------
           GEMINI CLIENT
           ------------------------------------------------- */

        const ai =
            new GoogleGenAI({
                apiKey
            });


        /* -------------------------------------------------
           TOKEN EXPIRATION
           ------------------------------------------------- */

        const expireTime =
            new Date(
                Date.now() +
                TOKEN_LIFETIME_MS
            ).toISOString();


        /* -------------------------------------------------
           CREATE EPHEMERAL TOKEN

           Locked to:
           - 1 use
           - selected Live model
           - AUDIO response modality
           ------------------------------------------------- */

        const token =
            await ai.authTokens.create({

                config: {

                    uses:
                        1,

                    expireTime,

                    liveConnectConstraints: {

                        model:
                            MODEL,

                        config: {

                            responseModalities: [
                                "AUDIO"
                            ],

                            /*
                            Enables session recovery support
                            if frontend uses it later.
                            */

                            sessionResumption: {}
                        }
                    }
                }
            });


        /* -------------------------------------------------
           VALIDATE TOKEN
           ------------------------------------------------- */

        if (
            !token ||
            !token.name
        ) {

            console.error(
                "[NEYO Voice Token] Empty token response",
                token
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


        console.log(
            "[NEYO Voice Token] token created",
            {
                model:
                    MODEL,

                expires:
                    expireTime
            }
        );


        /* -------------------------------------------------
           SUCCESS

           token.name is the ephemeral credential.
           Permanent API key is NEVER returned.
           ------------------------------------------------- */

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
            "[NEYO Voice Token] failed:",
            error
        );


        /*
        SDK errors sometimes contain useful
        status/message information.
        */

        const status =
            Number(
                error?.status
            ) || 500;


        const message =
            error?.message ||
            "Could not create voice session.";


        return sendJson(
            res,
            status >= 400 &&
            status < 600
                ? status
                : 500,
            {
                error:
                    message
            }
        );
    }
}
