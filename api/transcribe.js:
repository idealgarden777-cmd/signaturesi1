/*
=========================================================
NEYO — GEMINI AUDIO TRANSCRIPTION API
Vercel / Node serverless endpoint

Flow:
FormData(audio)
→ validate
→ base64
→ Gemini 3.5 Flash-Lite
→ transcript
=========================================================
*/

export const config = {
    api: {
        bodyParser: false
    }
};


const MODEL =
    "gemini-3.5-flash-lite";


const MAX_AUDIO_BYTES =
    18 * 1024 * 1024;


/* =========================================================
   SUPPORTED AUDIO
   Gemini documented audio formats.
   ========================================================= */

const SUPPORTED_MIME_TYPES =
    new Set([
        "audio/wav",
        "audio/x-wav",

        "audio/mpeg",
        "audio/mp3",

        "audio/aiff",
        "audio/x-aiff",

        "audio/aac",

        "audio/ogg",

        "audio/flac",
        "audio/x-flac"
    ]);


/* =========================================================
   RESPONSE HELPERS
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
   GET MULTIPART AUDIO
   Uses native Request/FormData APIs available
   in modern Node/Vercel runtimes.
   ========================================================= */

async function getAudioFile(req) {

    const chunks = [];

    let total = 0;


    for await (
        const chunk of req
    ) {

        total +=
            chunk.length;


        /*
        Multipart has small overhead,
        so allow a little room above audio limit.
        */

        if (
            total >
            MAX_AUDIO_BYTES +
            1024 * 1024
        ) {
            throw new Error(
                "AUDIO_TOO_LARGE"
            );
        }


        chunks.push(
            chunk
        );
    }


    const body =
        Buffer.concat(
            chunks
        );


    const contentType =
        req.headers[
            "content-type"
        ];


    if (
        !contentType ||
        !contentType.includes(
            "multipart/form-data"
        )
    ) {
        throw new Error(
            "INVALID_CONTENT_TYPE"
        );
    }


    /*
    Convert incoming Node request into
    standard Web Request so FormData parser
    can handle multipart safely.
    */

    const request =
        new Request(
            "http://localhost/api/transcribe",
            {
                method:
                    "POST",

                headers: {
                    "content-type":
                        contentType
                },

                body
            }
        );


    const formData =
        await request.formData();


    const audio =
        formData.get(
            "audio"
        );


    if (
        !audio ||
        typeof audio.arrayBuffer !==
            "function"
    ) {
        throw new Error(
            "AUDIO_REQUIRED"
        );
    }


    return audio;
}


/* =========================================================
   MIME NORMALIZATION
   ========================================================= */

function normalizeMimeType(
    value
) {

    const mime =
        String(
            value || ""
        )
            .toLowerCase()
            .split(";")[0]
            .trim();


    if (
        mime ===
        "audio/webm"
    ) {
        return "audio/webm";
    }


    if (
        mime ===
        "audio/ogg"
    ) {
        return "audio/ogg";
    }


    if (
        mime ===
        "audio/mpeg"
    ) {
        return "audio/mpeg";
    }


    return mime;
}


/* =========================================================
   GEMINI TRANSCRIPTION
   ========================================================= */

async function transcribeWithGemini({
    apiKey,
    audioBuffer,
    mimeType
}) {

    const audioBase64 =
        audioBuffer.toString(
            "base64"
        );


    const prompt = `
Transcribe the speech in this audio accurately.

Rules:
- Return only the transcript.
- Do not explain anything.
- Do not summarize.
- Do not translate.
- Preserve the language actually spoken.
- Preserve Urdu, English, Hindi, Hinglish, Roman Urdu, or mixed-language speech naturally.
- Add normal punctuation where appropriate.
- Do not invent words that are not audible.
- If a small portion is unclear, infer conservatively from context.
- Do not add speaker labels unless multiple speakers are clearly present.
`.trim();


    const response =
        await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json",

                    "x-goog-api-key":
                        apiKey
                },

                body:
                    JSON.stringify({
                        contents: [
                            {
                                role:
                                    "user",

                                parts: [
                                    {
                                        text:
                                            prompt
                                    },

                                    {
                                        inlineData: {
                                            mimeType,
                                            data:
                                                audioBase64
                                        }
                                    }
                                ]
                            }
                        ],

                        generationConfig: {
                            temperature:
                                0,

                            maxOutputTokens:
                                4096
                        }
                    })
            }
        );


    let data = null;


    try {

        data =
            await response.json();

    } catch {
        // handled below
    }


    if (
        !response.ok
    ) {

        const message =
            data?.error
                ?.message ||
            `Gemini request failed (${response.status})`;


        throw new Error(
            message
        );
    }


    const transcript =
        data?.candidates?.[0]
            ?.content?.parts
            ?.map(
                part =>
                    part?.text || ""
            )
            .join("")
            .trim() ||
        "";


    if (!transcript) {
        throw new Error(
            "EMPTY_TRANSCRIPT"
        );
    }


    return transcript;
}


/* =========================================================
   HANDLER
   ========================================================= */

export default async function handler(
    req,
    res
) {

    /* ---------------------------------------------------------
       METHOD
       --------------------------------------------------------- */

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


    /* ---------------------------------------------------------
       API KEY
       --------------------------------------------------------- */

    const apiKey =
        process.env
            .GEMINI_API_KEY;


    if (!apiKey) {

        console.error(
            "Missing GEMINI_API_KEY"
        );


        return sendJson(
            res,
            500,
            {
                error:
                    "Transcription service is not configured."
            }
        );
    }


    try {

        /* -----------------------------------------------------
           READ AUDIO
           ----------------------------------------------------- */

        const audioFile =
            await getAudioFile(
                req
            );


        const audioArrayBuffer =
            await audioFile
                .arrayBuffer();


        const audioBuffer =
            Buffer.from(
                audioArrayBuffer
            );


        /* -----------------------------------------------------
           SIZE
           ----------------------------------------------------- */

        if (
            audioBuffer.length ===
            0
        ) {

            return sendJson(
                res,
                400,
                {
                    error:
                        "Recorded audio is empty."
                }
            );
        }


        if (
            audioBuffer.length >
            MAX_AUDIO_BYTES
        ) {

            return sendJson(
                res,
                413,
                {
                    error:
                        "Recording is too large."
                }
            );
        }


        /* -----------------------------------------------------
           MIME
           ----------------------------------------------------- */

        const mimeType =
            normalizeMimeType(
                audioFile.type
            );


        /*
        Google currently documents:
        WAV / MP3 / AIFF / AAC / OGG / FLAC.

        Do NOT pretend WebM is OGG.
        */

        if (
            mimeType ===
            "audio/webm"
        ) {

            return sendJson(
                res,
                415,
                {
                    error:
                        "This browser recorded WebM audio. Use OGG recording or convert the audio before transcription."
                }
            );
        }


        if (
            !SUPPORTED_MIME_TYPES
                .has(mimeType)
        ) {

            return sendJson(
                res,
                415,
                {
                    error:
                        `Unsupported audio format: ${mimeType || "unknown"}.`
                }
            );
        }


        /* -----------------------------------------------------
           GEMINI
           ----------------------------------------------------- */

        const transcript =
            await transcribeWithGemini({
                apiKey,
                audioBuffer,
                mimeType
            });


        /* -----------------------------------------------------
           SUCCESS
           ----------------------------------------------------- */

        return sendJson(
            res,
            200,
            {
                transcript
            }
        );


    } catch (error) {

        /* -----------------------------------------------------
           KNOWN ERRORS
           ----------------------------------------------------- */

        if (
            error?.message ===
            "AUDIO_TOO_LARGE"
        ) {

            return sendJson(
                res,
                413,
                {
                    error:
                        "Recording is too large."
                }
            );
        }


        if (
            error?.message ===
            "INVALID_CONTENT_TYPE"
        ) {

            return sendJson(
                res,
                400,
                {
                    error:
                        "Expected multipart audio upload."
                }
            );
        }


        if (
            error?.message ===
            "AUDIO_REQUIRED"
        ) {

            return sendJson(
                res,
                400,
                {
                    error:
                        "Audio file is required."
                }
            );
        }


        /* -----------------------------------------------------
           UNKNOWN / GEMINI ERROR
           ----------------------------------------------------- */

        console.error(
            "NEYO transcription error:",
            error
        );


        return sendJson(
            res,
            500,
            {
                error:
                    "Voice transcription failed."
            }
        );
    }
}
