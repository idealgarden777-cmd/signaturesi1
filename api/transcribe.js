/*
=========================================================
NEYO — GEMINI TRANSCRIPTION API
FINAL CROSS-BROWSER VERSION

Flow:
Browser MediaRecorder
→ multipart audio
→ WebM/OGG/etc
→ WebM converted to WAV when necessary
→ Gemini 3.5 Flash-Lite
→ transcript

Requires:
npm install ffmpeg-static
=========================================================
*/

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

import ffmpegPath from "ffmpeg-static";


/* =========================================================
   VERCEL
   ========================================================= */

export const config = {
    api: {
        bodyParser: false
    }
};


/* =========================================================
   CONFIG
   ========================================================= */

const MODEL =
    "gemini-3.5-flash-lite";

const MAX_AUDIO_BYTES =
    18 * 1024 * 1024;

const MAX_CONTEXT_CHARS =
    5000;


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
   NORMALIZE MIME
   ========================================================= */

function normalizeMimeType(value) {
    return String(
        value || ""
    )
        .toLowerCase()
        .split(";")[0]
        .trim();
}


/* =========================================================
   CONTEXT
   ========================================================= */

function normalizeContext(value) {
    return String(
        value || ""
    )
        .replace(/\u0000/g, "")
        .trim()
        .slice(
            0,
            MAX_CONTEXT_CHARS
        );
}


/* =========================================================
   MULTIPART PARSER

   Uses native FormData parsing after reading raw request.
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
        totalBytes +=
            chunk.length;


        /*
        Allow small multipart overhead.
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
   INPUT EXTENSION
   ========================================================= */

function getExtension(mimeType) {
    switch (mimeType) {

        case "audio/webm":
            return "webm";

        case "audio/ogg":
            return "ogg";

        case "audio/wav":
        case "audio/x-wav":
            return "wav";

        case "audio/mpeg":
        case "audio/mp3":
            return "mp3";

        case "audio/aac":
            return "aac";

        case "audio/flac":
        case "audio/x-flac":
            return "flac";

        case "audio/aiff":
        case "audio/x-aiff":
            return "aiff";

        default:
            return "audio";
    }
}


/* =========================================================
   FFMPEG EXECUTOR
   ========================================================= */

function runFfmpeg(args) {
    return new Promise(
        (resolve, reject) => {

            if (!ffmpegPath) {
                reject(
                    new Error(
                        "FFMPEG_UNAVAILABLE"
                    )
                );

                return;
            }


            const process =
                spawn(
                    ffmpegPath,
                    args,
                    {
                        stdio: [
                            "ignore",
                            "ignore",
                            "pipe"
                        ]
                    }
                );


            let stderr = "";


            process.stderr.on(
                "data",
                chunk => {

                    /*
                    Avoid unlimited error output.
                    */

                    if (
                        stderr.length <
                        10000
                    ) {
                        stderr +=
                            chunk.toString();
                    }
                }
            );


            process.once(
                "error",
                reject
            );


            process.once(
                "close",
                code => {

                    if (code === 0) {

                        resolve();

                        return;
                    }


                    console.error(
                        "[NEYO Transcribe] ffmpeg:",
                        stderr
                    );


                    reject(
                        new Error(
                            "AUDIO_CONVERSION_FAILED"
                        )
                    );
                }
            );
        }
    );
}


/* =========================================================
   WEBM → WAV

   Gemini receives clean WAV audio.
   ========================================================= */

async function convertToWav(
    inputBuffer,
    inputMimeType
) {
    const id =
        crypto.randomUUID();


    const extension =
        getExtension(
            inputMimeType
        );


    const inputPath =
        path.join(
            os.tmpdir(),
            `neyo-${id}.${extension}`
        );


    const outputPath =
        path.join(
            os.tmpdir(),
            `neyo-${id}.wav`
        );


    try {

        await fs.writeFile(
            inputPath,
            inputBuffer
        );


        /*
        16 kHz mono PCM is plenty for speech
        and keeps payload reasonably small.
        */

        await runFfmpeg([
            "-hide_banner",
            "-loglevel",
            "error",

            "-y",

            "-i",
            inputPath,

            "-vn",

            "-ac",
            "1",

            "-ar",
            "16000",

            "-c:a",
            "pcm_s16le",

            outputPath
        ]);


        const wavBuffer =
            await fs.readFile(
                outputPath
            );


        if (
            !wavBuffer.length
        ) {
            throw new Error(
                "EMPTY_CONVERTED_AUDIO"
            );
        }


        return wavBuffer;

    } finally {

        await Promise.allSettled([
            fs.unlink(inputPath),
            fs.unlink(outputPath)
        ]);
    }
}


/* =========================================================
   AUDIO PREPARATION

   Browser formats can vary.
   Normalize WebM to WAV.
   ========================================================= */

async function prepareAudio(
    buffer,
    mimeType
) {

    /*
    Chrome commonly gives WebM.
    Convert it to WAV.
    */

    if (
        mimeType === "audio/webm"
    ) {

        const wav =
            await convertToWav(
                buffer,
                mimeType
            );


        return {
            buffer: wav,
            mimeType: "audio/wav"
        };
    }


    /*
    These formats can be passed directly.
    */

    const supported =
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


    if (
        supported.has(
            mimeType
        )
    ) {

        return {
            buffer,
            mimeType:
                mimeType === "audio/x-wav"
                    ? "audio/wav"
                    : mimeType === "audio/x-aiff"
                        ? "audio/aiff"
                        : mimeType === "audio/x-flac"
                            ? "audio/flac"
                            : mimeType === "audio/mpeg"
                                ? "audio/mp3"
                                : mimeType
        };
    }


    /*
    Unknown audio container:
    attempt conversion rather than silently fail.
    */

    const wav =
        await convertToWav(
            buffer,
            mimeType
        );


    return {
        buffer: wav,
        mimeType: "audio/wav"
    };
}


/* =========================================================
   TRANSCRIPTION PROMPT
   GENERAL PURPOSE — NO HARDCODED VOCABULARY
   ========================================================= */

function buildPrompt(context) {

    const contextBlock =
        context
            ? `
Recent conversation context:

${context}

Use this context only when it helps resolve genuinely
ambiguous words. Never copy information from this context
unless the speaker actually said it.
`
            : "";


    return `
Transcribe the supplied speech accurately.

Return only the final transcript.

Rules:
- Preserve what the speaker actually said.
- Preserve the original meaning.
- Do not answer the speaker.
- Do not summarize.
- Do not translate.
- Preserve the language being spoken.
- Preserve natural mixed-language speech.
- Add normal punctuation and capitalization.
- Resolve ambiguous words conservatively using the audio and available conversation context.
- Correct an obvious recognition error only when the intended wording is genuinely clear.
- Do not invent words or information.
- Do not rewrite the speaker's ideas.
- Do not make the speaker sound more formal than they were.
- Remove only meaningless accidental repetitions or filler sounds when doing so does not alter meaning.

${contextBlock}

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

    const base64Audio =
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
                                role: "user",

                                parts: [
                                    {
                                        text:
                                            buildPrompt(
                                                context
                                            )
                                    },

                                    {
                                        inlineData: {
                                            mimeType:
                                                mimeType,

                                            data:
                                                base64Audio
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

        console.error(
            "[NEYO Transcribe] Gemini:",
            response.status,
            data
        );


        throw new Error(
            data?.error?.message ||
            `GEMINI_${response.status}`
        );
    }


    const transcript =
        data?.candidates?.[0]
            ?.content
            ?.parts
            ?.map(
                part =>
                    part?.text || ""
            )
            .join("")
            .trim() ||
        "";


    if (!transcript) {

        console.error(
            "[NEYO Transcribe] empty Gemini response:",
            data
        );


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
       SECRET
       ----------------------------------------------------- */

    const apiKey =
        process.env
            .GEMINI_API_KEY;


    if (!apiKey) {

        console.error(
            "[NEYO Transcribe] GEMINI_API_KEY missing"
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
           BUFFER
           ------------------------------------------------- */

        const originalBuffer =
            Buffer.from(
                await audioFile
                    .arrayBuffer()
            );


        if (
            !originalBuffer.length
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
            originalBuffer.length >
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


        const originalMime =
            normalizeMimeType(
                audioFile.type
            );


        console.log(
            "[NEYO Transcribe] incoming",
            {
                mime:
                    originalMime,

                bytes:
                    originalBuffer.length,

                contextChars:
                    context.length
            }
        );


        /* -------------------------------------------------
           NORMALIZE AUDIO
           ------------------------------------------------- */

        const prepared =
            await prepareAudio(
                originalBuffer,
                originalMime
            );


        if (
            prepared.buffer.length >
            MAX_AUDIO_BYTES
        ) {

            return sendJson(
                res,
                413,
                {
                    error:
                        "Converted recording is too large."
                }
            );
        }


        console.log(
            "[NEYO Transcribe] prepared",
            {
                mime:
                    prepared.mimeType,

                bytes:
                    prepared.buffer.length
            }
        );


        /* -------------------------------------------------
           GEMINI
           ------------------------------------------------- */

        const transcript =
            await transcribeWithGemini({
                apiKey,

                audioBuffer:
                    prepared.buffer,

                mimeType:
                    prepared.mimeType,

                context
            });


        /* -------------------------------------------------
           SUCCESS
           ------------------------------------------------- */

        console.log(
            "[NEYO Transcribe] success",
            {
                chars:
                    transcript.length
            }
        );


        return sendJson(
            res,
            200,
            {
                transcript
            }
        );


    } catch (error) {

        console.error(
            "[NEYO Transcribe] failed:",
            error
        );


        /* -------------------------------------------------
           KNOWN ERRORS
           ------------------------------------------------- */

        switch (
            error?.message
        ) {

            case "AUDIO_TOO_LARGE":

                return sendJson(
                    res,
                    413,
                    {
                        error:
                            "Recording is too large."
                    }
                );


            case "INVALID_CONTENT_TYPE":

                return sendJson(
                    res,
                    400,
                    {
                        error:
                            "Expected multipart audio upload."
                    }
                );


            case "FFMPEG_UNAVAILABLE":

                return sendJson(
                    res,
                    500,
                    {
                        error:
                            "Audio converter is unavailable."
                    }
                );


            case "AUDIO_CONVERSION_FAILED":
            case "EMPTY_CONVERTED_AUDIO":

                return sendJson(
                    res,
                    422,
                    {
                        error:
                            "Could not process the recorded audio."
                    }
                );


            case "EMPTY_TRANSCRIPT":

                return sendJson(
                    res,
                    422,
                    {
                        error:
                            "No speech could be transcribed."
                    }
                );


            default:

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
}
