/*
=========================================================
NEYO — GEMINI AUDIO TRANSCRIPTION API
CONTEXT-AWARE / NON-HARDCODED VERSION

Flow:
FormData:
- audio
- context (optional)

→ validate
→ base64 audio
→ Gemini
→ faithful transcript
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


const MAX_CONTEXT_CHARS =
    6000;


/* =========================================================
   SUPPORTED AUDIO MIME TYPES
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
        "no-store"
    );

    return res.end(
        JSON.stringify(body)
    );
}


/* =========================================================
   PARSE MULTIPART FORM DATA
   ========================================================= */

async function parseMultipart(req) {

    const chunks = [];

    let totalBytes = 0;


    for await (
        const chunk of req
    ) {

        totalBytes +=
            chunk.length;


        /*
        Small multipart overhead allowance.
        */

        if (
            totalBytes >
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


    const rawBody =
        Buffer.concat(
            chunks
        );


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

                body:
                    rawBody
            }
        );


    return request.formData();
}


/* =========================================================
   MIME NORMALIZATION
   ========================================================= */

function normalizeMimeType(
    value
) {

    return String(
        value || ""
    )
        .toLowerCase()
        .split(";")[0]
        .trim();
}


/* =========================================================
   CONTEXT SANITIZATION
   ========================================================= */

function normalizeContext(
    value
) {

    return String(
        value || ""
    )
        .replace(
            /\u0000/g,
            ""
        )
        .trim()
        .slice(
            0,
            MAX_CONTEXT_CHARS
        );
}


/* =========================================================
   TRANSCRIPTION PROMPT
   No hardcoded vocabulary.
   Context only helps disambiguation.
   ========================================================= */

function buildPrompt(
    context
) {

    const contextSection =
        context
            ? `
Recent conversation context:

${context}

Use this context only to resolve genuinely ambiguous speech.
Do not copy information from the context into the transcript unless it was actually spoken.
`
            : `
No recent conversation context is available.
`;


    return `
Transcribe the supplied audio as accurately and naturally as possible.

Important rules:

- Return only the transcript.
- Do not answer the speaker.
- Do not summarize.
- Do not explain.
- Do not translate.
- Preserve the language actually spoken.
- Preserve mixed-language speech naturally.
- Preserve the speaker's original meaning.
- Add normal punctuation and capitalization.
- Correct an obvious recognition error only when the intended wording is clear from the audio or surrounding context.
- Do not invent words.
- Do not add facts.
- Do not rewrite the speaker's ideas.
- Do not make the speech more formal than it was.
- Keep natural conversational phrasing.
- Remove only obvious accidental repetitions or meaningless filler sounds when doing so does not change meaning.
- If a word is genuinely uncertain, prefer the interpretation that best fits the audio and conversation context.
- Context is evidence for disambiguation only, not source text to copy.

${contextSection}

Return only the final transcript.
`.trim();
}


/* =========================================================
   GEMINI REQUEST
   ========================================================= */

async function transcribeWithGemini({
    apiKey,
    audioBuffer,
    mimeType,
    context
}) {

    const audioBase64 =
        audioBuffer.toString(
            "base64"
        );


    const prompt =
        buildPrompt(
            context
        );


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
                                0.1,

                            topP:
                                0.85,

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
   API HANDLER
   ========================================================= */

export default async function handler(
    req,
    res
) {

    /* -----------------------------------------------------
       METHOD
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
       API KEY
       ----------------------------------------------------- */

    const apiKey =
        process.env
            .GEMINI_API_KEY;


    if (!apiKey) {

        console.error(
            "NEYO transcription: GEMINI_API_KEY missing."
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

        /* -------------------------------------------------
           FORM DATA
           ------------------------------------------------- */

        const formData =
            await parseMultipart(
                req
            );


        const audioFile =
            formData.get(
                "audio"
            );


        const context =
            normalizeContext(
                formData.get(
                    "context"
                )
            );


        if (
            !audioFile ||
            typeof audioFile.arrayBuffer !==
                "function"
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


        /* -------------------------------------------------
           AUDIO BUFFER
           ------------------------------------------------- */

        const arrayBuffer =
            await audioFile
                .arrayBuffer();


        const audioBuffer =
            Buffer.from(
                arrayBuffer
            );


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


        /* -------------------------------------------------
           MIME
           ------------------------------------------------- */

        const mimeType =
            normalizeMimeType(
                audioFile.type
            );


        if (
            !SUPPORTED_MIME_TYPES
                .has(mimeType)
        ) {

            return sendJson(
                res,
                415,
                {
                    error:
                        `Unsupported audio format: ${
                            mimeType ||
                            "unknown"
                        }.`
                }
            );
        }


        /* -------------------------------------------------
           TRANSCRIBE
           ------------------------------------------------- */

        const transcript =
            await transcribeWithGemini({
                apiKey,
                audioBuffer,
                mimeType,
                context
            });


        /* -------------------------------------------------
           SUCCESS
           ------------------------------------------------- */

        return sendJson(
            res,
            200,
            {
                transcript
            }
        );


    } catch (error) {

        /* -------------------------------------------------
           KNOWN ERRORS
           ------------------------------------------------- */

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
            "EMPTY_TRANSCRIPT"
        ) {

            return sendJson(
                res,
                422,
                {
                    error:
                        "No speech could be transcribed."
                }
            );
        }


        /* -------------------------------------------------
           UNKNOWN / GEMINI ERROR
           ------------------------------------------------- */

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
