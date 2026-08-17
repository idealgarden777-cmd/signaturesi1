/*
=========================================================
NEYO — TRANSCRIBE API
SIMPLE STABLE VERSION
No FFmpeg
No native binaries
=========================================================
*/

export const config = {
    api: {
        bodyParser: false
    }
};

const MODEL = "gemini-3.5-flash-lite";

const MAX_AUDIO_BYTES =
    10 * 1024 * 1024;

const MAX_CONTEXT_CHARS = 5000;


/* =========================================================
   RESPONSE
   ========================================================= */

function sendJson(res, status, body) {
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
   MIME
   ========================================================= */

function normalizeMimeType(value) {
    return String(value || "")
        .toLowerCase()
        .split(";")[0]
        .trim();
}


/* =========================================================
   CONTEXT
   ========================================================= */

function normalizeContext(value) {
    return String(value || "")
        .replace(/\u0000/g, "")
        .trim()
        .slice(0, MAX_CONTEXT_CHARS);
}


/* =========================================================
   MULTIPART
   ========================================================= */

async function parseMultipart(req) {
    const contentType =
        req.headers["content-type"];

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


    const chunks = [];

    let totalBytes = 0;


    for await (const chunk of req) {
        totalBytes += chunk.length;

        if (
            totalBytes >
            MAX_AUDIO_BYTES +
            1024 * 1024
        ) {
            throw new Error(
                "AUDIO_TOO_LARGE"
            );
        }

        chunks.push(chunk);
    }


    const rawBody =
        Buffer.concat(chunks);


    const request =
        new Request(
            "http://localhost/api/transcribe",
            {
                method: "POST",

                headers: {
                    "content-type":
                        contentType
                },

                body: rawBody
            }
        );


    return request.formData();
}


/* =========================================================
   PROMPT
   ========================================================= */

function buildPrompt(context) {
    return `
Transcribe the supplied audio accurately.

Rules:
- Return only the transcript.
- Do not answer the speaker.
- Do not summarize.
- Do not translate.
- Preserve the language actually spoken.
- Preserve mixed-language speech naturally.
- Preserve the speaker's meaning.
- Add normal punctuation and capitalization.
- Correct only obvious recognition mistakes.
- Do not invent information.
- Do not rewrite the speaker's ideas.

${
    context
        ? `
Recent conversation context:

${context}

Use this only to resolve genuinely ambiguous words.
Do not copy context into the transcript unless it was spoken.
`
        : ""
}

Return only the transcript.
`.trim();
}


/* =========================================================
   GEMINI
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


    const response =
        await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
            {
                method: "POST",

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
                                            buildPrompt(
                                                context
                                            )
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
                            maxOutputTokens:
                                4096
                        }
                    })
            }
        );


    const text =
        await response.text();


    let data = null;


    try {
        data =
            JSON.parse(text);
    } catch {
        data = null;
    }


    console.log(
        "[NEYO Transcribe] Gemini status:",
        response.status
    );


    if (!response.ok) {

        console.error(
            "[NEYO Transcribe] Gemini body:",
            text
        );


        throw new Error(
            data?.error?.message ||
            `Gemini failed (${response.status})`
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
            .trim() || "";


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

    try {

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


        const apiKey =
            process.env
                .GEMINI_API_KEY;


        if (!apiKey) {

            console.error(
                "[NEYO Transcribe] Missing GEMINI_API_KEY"
            );


            return sendJson(
                res,
                500,
                {
                    error:
                        "GEMINI_API_KEY is missing."
                }
            );
        }


        const formData =
            await parseMultipart(req);


        const audioFile =
            formData.get("audio");


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


        const buffer =
            Buffer.from(
                await audioFile
                    .arrayBuffer()
            );


        const mimeType =
            normalizeMimeType(
                audioFile.type
            );


        console.log(
            "[NEYO Transcribe] incoming:",
            {
                mimeType,
                bytes:
                    buffer.length,
                contextChars:
                    context.length
            }
        );


        if (!buffer.length) {

            return sendJson(
                res,
                400,
                {
                    error:
                        "Audio is empty."
                }
            );
        }


        if (
            buffer.length >
            MAX_AUDIO_BYTES
        ) {

            return sendJson(
                res,
                413,
                {
                    error:
                        "Recording too large."
                }
            );
        }


        const supported =
            new Set([
                "audio/wav",
                "audio/mp3",
                "audio/mpeg",
                "audio/aiff",
                "audio/aac",
                "audio/ogg",
                "audio/flac"
            ]);


        if (
            !supported.has(
                mimeType
            )
        ) {

            console.error(
                "[NEYO Transcribe] Unsupported MIME:",
                mimeType
            );


            return sendJson(
                res,
                415,
                {
                    error:
                        `Unsupported audio format: ${mimeType}`
                }
            );
        }


        const transcript =
            await transcribeWithGemini({
                apiKey,
                audioBuffer:
                    buffer,
                mimeType:
                    mimeType ===
                        "audio/mpeg"
                        ? "audio/mp3"
                        : mimeType,
                context
            });


        return sendJson(
            res,
            200,
            {
                transcript
            }
        );


    } catch (error) {

        console.error(
            "[NEYO Transcribe] fatal:",
            error
        );


        return sendJson(
            res,
            500,
            {
                error:
                    error?.message ||
                    "Voice transcription failed."
            }
        );
    }
}
