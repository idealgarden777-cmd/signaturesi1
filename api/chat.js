import { createClient } from "@supabase/supabase-js";

import {
    getAuthenticatedUser
} from "../lib/auth.js";


/* =========================================================
   SUPABASE
   ========================================================= */

const supabase =
    createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        }
    );


/* =========================================================
   CONFIG
   ========================================================= */

const GEMINI_API_KEY =
    cleanEnv(
        process.env.GEMINI_API_KEY
    );


const ATTACHMENT_BUCKET =
    "neyo-attachments";


const MAX_ATTACHMENTS =
    5;


const MAX_MESSAGE_LENGTH =
    50000;


const MAX_HISTORY_MESSAGES =
    50;


const MAX_HISTORY_CHARS =
    60000;


const MAX_URL_CONTEXT_SOURCES =
    5;


const URL_FETCH_TIMEOUT_MS =
    8000;


/*
Latency-oriented history budgets.

Simple messages should not repeatedly send
the entire 60k conversation context.
*/

const HISTORY_BUDGET_LIGHT = {
    messages: 12,
    chars: 12000
};


const HISTORY_BUDGET_STANDARD = {
    messages: 30,
    chars: 30000
};


const HISTORY_BUDGET_DEEP = {
    messages: 50,
    chars: MAX_HISTORY_CHARS
};


/* =========================================================
   MODELS
   ========================================================= */

const NEYO_FREE_PRIMARY_MODEL =
    cleanEnv(
        process.env.NEYO_FREE_PRIMARY_MODEL
    ) ||
    "gemma-4-26b-a4b-it";


const NEYO_FREE_FALLBACK_MODEL =
    cleanEnv(
        process.env.NEYO_FREE_FALLBACK_MODEL
    ) ||
    cleanEnv(
        process.env.GEMINI_FREE_MODEL
    ) ||
    "gemini-3.1-flash-lite";


const NEYO_LEVERAGE_PRIMARY_MODEL =
    cleanEnv(
        process.env.NEYO_LEVERAGE_PRIMARY_MODEL
    ) ||
    "gemma-4-26b-a4b-it";


const NEYO_LEVERAGE_ADVANCED_MODEL =
    cleanEnv(
        process.env.NEYO_LEVERAGE_ADVANCED_MODEL
    ) ||
    "gemma-4-31b-it";


const NEYO_LEVERAGE_FALLBACK_MODEL =
    cleanEnv(
        process.env.NEYO_LEVERAGE_FALLBACK_MODEL
    ) ||
    cleanEnv(
        process.env.GEMINI_PRO_MODEL
    ) ||
    "gemini-3.5-flash-lite";


/* =========================================================
   SYSTEM PROMPT
   ========================================================= */

const NEYO_RESPONSE_FORMAT = `
I'm NEYO — an AI personalized model by Signaturesi.

I adapt to how you think, work, and communicate. I can keep things quick when the answer is simple, go deep when the problem is complex, and stay with you across ideas, planning, technical work, writing, research, or everyday questions.
The more context you give me, the better I can work with you.

If the question is simple, answer simply.
If the user needs more detail, give more detail.
If the task is difficult, think carefully and work through it properly.
If the user is exploring ideas, be curious and collaborative.
If the user is confused, guide them clearly without overwhelming them.
If the user is frustrated or under pressure, stay calm, smooth, and helpful.
If the user wants serious work, become focused and thorough.
If the conversation is casual, keep the tone relaxed and natural.

Do not force a fixed response length or reasoning effort.
Let the complexity of the task and the user's needs determine depth.

Be conversational rather than mechanical.
Avoid repeating the user's question or narrating your own process.
Do not sound like a template, evaluator, or scripted assistant.

Match the user's language, tone, pace, and level of detail.
If they use Roman Urdu, respond naturally in Roman Urdu.
If they switch language, adapt seamlessly.

For difficult tasks, guide the user through the work clearly.
Break things down when needed, but don't over-explain obvious points.
When something can be solved directly, solve it directly.

Use Markdown, headings, bullets, or code blocks only when they improve readability.

When files or other context are provided, use them carefully.
If something is uncertain, say so instead of guessing.

The goal is to give the right answer with the right depth, tone, and effort for the situation.
`;


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function cleanEnv(
    value
) {

    return typeof value ===
        "string"
        ? value.trim()
        : "";

}


function cleanString(
    value,
    max = MAX_MESSAGE_LENGTH
) {

    if (
        typeof value !==
        "string"
    ) {
        return "";
    }


    return value
        .replace(
            /\r\n?/g,
            "\n"
        )
        .replace(
            /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
            ""
        )
        .trim()
        .slice(
            0,
            max
        );

}


function elapsed(
    start
) {

    return Math.max(
        0,
        Date.now() -
        start
    );

}


function logTiming(
    name,
    value,
    extra = {}
) {

    console.log(
        `[NEYO Timing] ${name}`,
        {
            ms:
                value,

            ...extra
        }
    );

}


/* =========================================================
   ATTACHMENTS
   ========================================================= */

function validAttachmentList(
    attachments,
    userId,
    max = MAX_ATTACHMENTS
) {

    if (
        !Array.isArray(
            attachments
        )
    ) {
        return [];
    }


    const safeUserId =
        String(
            userId ||
            ""
        ).trim();


    const userPrefix =
        `users/${safeUserId}/`;


    const seen =
        new Set();


    const output =
        [];


    for (
        const raw
        of attachments.slice(
            0,
            max
        )
    ) {

        if (
            !raw ||
            typeof raw !==
                "object"
        ) {
            continue;
        }


        const bucket =
            cleanString(
                raw.bucket ||
                ATTACHMENT_BUCKET,
                128
            );


        const path =
            cleanString(
                raw.path ||
                "",
                1024
            );


        const uploadId =
            cleanString(
                raw.uploadId ||
                raw.upload_id ||
                "",
                128
            );


        const name =
            cleanString(
                raw.name ||
                "Attached file",
                220
            );


        const mime =
            cleanString(
                raw.mime ||
                raw.mimeType ||
                raw.type ||
                "application/octet-stream",
                180
            )
                .toLowerCase();


        const extension =
            cleanString(
                raw.extension ||
                "",
                32
            )
                .replace(
                    /^\./,
                    ""
                )
                .toLowerCase();


        const category =
            cleanString(
                raw.category ||
                "unknown",
                40
            )
                .toLowerCase();


        const size =
            Math.max(
                0,
                Number(
                    raw.size
                ) || 0
            );


        if (
            bucket !==
            ATTACHMENT_BUCKET
        ) {
            continue;
        }


        if (
            !path
        ) {
            continue;
        }


        if (
            path.startsWith("/") ||
            path.includes("\\") ||
            path.includes("..")
        ) {
            continue;
        }


        if (
            !path.startsWith(
                userPrefix
            )
        ) {
            continue;
        }


        const key =
            `${bucket}:${path}`;


        if (
            seen.has(
                key
            )
        ) {
            continue;
        }


        seen.add(
            key
        );


        output.push({

            id:
                cleanString(
                    raw.id ||
                    "",
                    128
                ) ||
                uploadId ||
                null,

            uploadId:
                uploadId ||
                null,

            provider:
                "supabase",

            bucket,

            path,

            name,

            mime,

            mimeType:
                mime,

            type:
                mime,

            extension,

            category,

            size

        });

    }


    return output;

}


/* =========================================================
   PREFERENCES
   ========================================================= */

function normalizeIntelligence(
    value
) {

    const normalized =
        String(
            value ||
            "standard"
        )
            .trim()
            .toLowerCase();


    if (
        [
            "standard",
            "high",
            "maximum"
        ].includes(
            normalized
        )
    ) {
        return normalized;
    }


    return "standard";

}


function normalizeLanguage(
    value
) {

    return cleanString(
        String(
            value ||
            "auto"
        ),
        40
    )
        .toLowerCase() ||
        "auto";

}


function normalizePersonality(
    value
) {

    return cleanString(
        String(
            value ||
            "neyo"
        ),
        50
    )
        .toLowerCase() ||
        "neyo";

}


function normalizePrivateChat(
    value
) {

    return value ===
        true;

}


/* =========================================================
   AUTOMATIC EFFORT
   ========================================================= */

function detectAutomaticEffort(
    text
) {

    const value =
        cleanString(
            text ||
            "",
            12000
        )
            .toLowerCase();


    if (
        !value
    ) {
        return "standard";
    }


    const deepSignals = [

        /\bdeep(?:ly)?\b/,
        /\bthorough(?:ly)?\b/,
        /\bcomplex\b/,
        /\bdifficult\b/,
        /\bhard\b/,
        /\barchitecture\b/,
        /\bdebug\b/,
        /\banaly[sz]e\b/,
        /\breason(?:ing)?\b/,
        /\bresearch\b/,
        /\bcompare\b/,
        /\boptimi[sz]e\b/,
        /\bproduction\b/,
        /\broot cause\b/,
        /\bstep[- ]by[- ]step\b/

    ];


    if (
        value.length >=
            3500 ||
        deepSignals.some(
            pattern =>
                pattern.test(
                    value
                )
        )
    ) {
        return "deep";
    }


    if (
        value.length <=
            180 &&
        !value.includes(
            "```"
        )
    ) {
        return "light";
    }


    return "standard";

}


/* =========================================================
   HISTORY BUDGET
   ========================================================= */

function getHistoryBudget({
    autoEffort,
    isDeepResearch,
    attachments
} = {}) {

    if (
        isDeepResearch ||
        autoEffort ===
            "deep" ||
        (
            Array.isArray(
                attachments
            ) &&
            attachments.length >
                0
        )
    ) {

        return HISTORY_BUDGET_DEEP;

    }


    if (
        autoEffort ===
        "light"
    ) {

        return HISTORY_BUDGET_LIGHT;

    }


    return HISTORY_BUDGET_STANDARD;

}


function selectHistoryMessages(
    messages,
    {
        maxMessages =
            MAX_HISTORY_MESSAGES,

        maxChars =
            MAX_HISTORY_CHARS

    } = {}
) {

    if (
        !Array.isArray(
            messages
        ) ||
        messages.length ===
            0
    ) {
        return [];
    }


    const recent =
        messages.slice(
            -maxMessages
        );


    const selected =
        [];


    let totalChars =
        0;


    for (
        let index =
                recent.length -
                1;
        index >= 0;
        index -= 1
    ) {

        const message =
            recent[
                index
            ];


        const content =
            cleanString(
                message
                    ?.content ||
                ""
            );


        const cost =
            content.length;


        if (
            selected.length >
                0 &&
            totalChars +
                cost >
                maxChars
        ) {

            break;

        }


        selected.push(
            message
        );


        totalChars +=
            cost;

    }


    return selected
        .reverse();

}


/* =========================================================
   MODEL ROUTER
   ========================================================= */

function selectModelRoute({
    isPro = false,
    attachments = [],
    preferences = {},
    isDeepResearch = false,
    autoEffort = "standard"
} = {}) {

    const hasAttachments =
        Array.isArray(
            attachments
        ) &&
        attachments.length >
            0;


    if (
        isPro &&
        hasAttachments
    ) {

        return {

            primary:
                NEYO_LEVERAGE_ADVANCED_MODEL,

            fallback:
                NEYO_LEVERAGE_FALLBACK_MODEL,

            route:
                "leverage-multimodal"

        };

    }


    if (
        isPro &&
        (
            preferences
                .intelligence ===
                "maximum" ||
            isDeepResearch ||
            autoEffort ===
                "deep"
        )
    ) {

        return {

            primary:
                NEYO_LEVERAGE_ADVANCED_MODEL,

            fallback:
                NEYO_LEVERAGE_FALLBACK_MODEL,

            route:
                "leverage-advanced"

        };

    }


    if (
        isPro
    ) {

        return {

            primary:
                NEYO_LEVERAGE_PRIMARY_MODEL,

            fallback:
                NEYO_LEVERAGE_FALLBACK_MODEL,

            route:
                "leverage-standard"

        };

    }


    return {

        primary:
            NEYO_FREE_PRIMARY_MODEL,

        fallback:
            NEYO_FREE_FALLBACK_MODEL,

        route:
            hasAttachments
                ? "free-multimodal"
                : "free-standard"

    };

}


/* =========================================================
   SYSTEM
   ========================================================= */

function buildSystemInstruction(
    preferences = {}
) {

    const parts = [
        NEYO_RESPONSE_FORMAT
    ];


    if (
        preferences.intelligence ===
            "high" ||
        preferences.intelligence ===
            "maximum"
    ) {

        parts.push(
            "Use deeper reasoning when the task requires it."
        );

    }


    if (
        preferences.language &&
        preferences.language !==
            "auto"
    ) {

        parts.push(
            `Preferred response language: ${preferences.language}.`
        );

    }


    if (
        preferences.personality &&
        preferences.personality !==
            "neyo"
    ) {

        parts.push(
            `Preferred personality preset: ${preferences.personality}.`
        );

    }


    return parts.join(
        "\n\n"
    );

}


/* =========================================================
   MODEL BODY
   ========================================================= */

function buildGeminiBody(
    contents,
    isDeepResearch = false,
    preferences = {}
) {

    return {

        systemInstruction: {

            parts: [
                {
                    text:
                        buildSystemInstruction(
                            preferences
                        )
                }
            ]

        },

        contents,

        generationConfig: {

            temperature:
                isDeepResearch
                    ? 0.45
                    : preferences
                        .intelligence ===
                        "maximum"
                        ? 0.5
                        : 0.65,

            topP:
                0.95,

            maxOutputTokens:
                (
                    isDeepResearch ||
                    preferences
                        .intelligence ===
                        "maximum"
                )
                    ? 8192
                    : 4096

        }

    };

}


/* =========================================================
   NORMAL MODEL CALL
   ========================================================= */

async function callGemini(
    messages,
    model,
    isDeepResearch = false,
    preferences = {}
) {

    if (
        !GEMINI_API_KEY
    ) {

        throw new Error(
            "Gemini API key is missing."
        );

    }


    const response =
        await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
            {

                method:
                    "POST",

                headers: {

                    "Content-Type":
                        "application/json"

                },

                body:
                    JSON.stringify(
                        buildGeminiBody(
                            messages,
                            isDeepResearch,
                            preferences
                        )
                    )

            }
        );


    const data =
        await response
            .json()
            .catch(
                () => ({})
            );


    if (
        !response.ok
    ) {

        const error =
            new Error(
                data
                    ?.error
                    ?.message ||
                `Model request failed (${response.status}).`
            );


        error.status =
            response.status;


        error.model =
            model;


        throw error;

    }


    return data;

}


/* =========================================================
   NORMAL ROUTE + FALLBACK
   ========================================================= */

async function callModelRoute(
    messages,
    route,
    isDeepResearch = false,
    preferences = {}
) {

    try {

        const data =
            await callGemini(
                messages,
                route.primary,
                isDeepResearch,
                preferences
            );


        return {

            data,

            usedFallback:
                false

        };

    } catch (
        primaryError
    ) {

        if (
            !route.fallback ||
            route.fallback ===
                route.primary
        ) {

            throw primaryError;

        }


        console.warn(
            "[NEYO Model Router] Primary failed, trying fallback:",
            {

                route:
                    route.route,

                message:
                    primaryError
                        ?.message

            }
        );


        const data =
            await callGemini(
                messages,
                route.fallback,
                isDeepResearch,
                preferences
            );


        return {

            data,

            usedFallback:
                true

        };

    }

}


/* =========================================================
   EXTRACT STREAM TEXT
   ========================================================= */

function extractVisibleStreamText(
    data
) {

    const parts =
        data
            ?.candidates?.[0]
            ?.content
            ?.parts;


    if (
        !Array.isArray(
            parts
        )
    ) {
        return "";
    }


    return parts
        .filter(
            part =>
                part &&
                part.thought !==
                    true &&
                typeof part.text ===
                    "string"
        )
        .map(
            part =>
                part.text
        )
        .join("");

}


/* =========================================================
   UPSTREAM SSE PARSER
   ========================================================= */

function createSSEParser() {

    let buffer =
        "";


    function push(
        chunk
    ) {

        buffer +=
            String(
                chunk ||
                ""
            )
                .replace(
                    /\r\n/g,
                    "\n"
                )
                .replace(
                    /\r/g,
                    "\n"
                );


        const blocks =
            buffer.split(
                "\n\n"
            );


        buffer =
            blocks.pop() ||
            "";


        const events =
            [];


        for (
            const block
            of blocks
        ) {

            const dataLines =
                block
                    .split(
                        "\n"
                    )
                    .filter(
                        line =>
                            line.startsWith(
                                "data:"
                            )
                    )
                    .map(
                        line =>
                            line
                                .slice(
                                    5
                                )
                                .replace(
                                    /^ /,
                                    ""
                                )
                    );


            if (
                dataLines.length ===
                0
            ) {
                continue;
            }


            const raw =
                dataLines
                    .join(
                        "\n"
                    )
                    .trim();


            if (
                !raw ||
                raw ===
                    "[DONE]"
            ) {
                continue;
            }


            try {

                events.push(
                    JSON.parse(
                        raw
                    )
                );

            } catch {

                console.warn(
                    "[NEYO Stream] Malformed upstream SSE event ignored."
                );

            }

        }


        return events;

    }


    function flush() {

        if (
            !buffer.trim()
        ) {
            return [];
        }


        const remaining =
            buffer;


        buffer =
            "";


        return push(
            `${remaining}\n\n`
        );

    }


    return {

        push,

        flush

    };

}


/* =========================================================
   STREAM MODEL CALL
   ========================================================= */

async function callGeminiStream(
    messages,
    model,
    isDeepResearch = false,
    preferences = {},
    {
        signal,
        onText,
        onHeaders,
        onFirstText
    } = {}
) {

    if (
        !GEMINI_API_KEY
    ) {

        throw new Error(
            "Gemini API key is missing."
        );

    }


    const requestStarted =
        Date.now();


    const response =
        await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(GEMINI_API_KEY)}`,
            {

                method:
                    "POST",

                headers: {

                    "Content-Type":
                        "application/json",

                    Accept:
                        "text/event-stream"

                },

                body:
                    JSON.stringify(
                        buildGeminiBody(
                            messages,
                            isDeepResearch,
                            preferences
                        )
                    ),

                signal

            }
        );


    const headersMs =
        elapsed(
            requestStarted
        );


    if (
        typeof onHeaders ===
        "function"
    ) {

        onHeaders(
            headersMs,
            model
        );

    }


    if (
        !response.ok
    ) {

        const raw =
            await response
                .text()
                .catch(
                    () => ""
                );


        let data =
            {};


        try {

            data =
                JSON.parse(
                    raw
                );

        } catch {}


        const error =
            new Error(
                data
                    ?.error
                    ?.message ||
                raw ||
                `Streaming model request failed (${response.status}).`
            );


        error.status =
            response.status;


        error.model =
            model;


        error.emittedText =
            false;


        throw error;

    }


    if (
        !response.body ||
        typeof response.body
            .getReader !==
            "function"
    ) {

        const error =
            new Error(
                "Streaming model response body is unavailable."
            );


        error.model =
            model;


        error.emittedText =
            false;


        throw error;

    }


    const reader =
        response.body
            .getReader();


    const decoder =
        new TextDecoder();


    const parser =
        createSSEParser();


    let reply =
        "";


    let emittedText =
        false;


    let firstTextReported =
        false;


    async function processEvents(
        events
    ) {

        for (
            const data
            of events
        ) {

            const text =
                extractVisibleStreamText(
                    data
                );


            if (
                !text
            ) {
                continue;
            }


            if (
                !firstTextReported
            ) {

                firstTextReported =
                    true;


                if (
                    typeof onFirstText ===
                    "function"
                ) {

                    onFirstText(
                        elapsed(
                            requestStarted
                        ),
                        model
                    );

                }

            }


            emittedText =
                true;


            reply +=
                text;


            if (
                typeof onText ===
                    "function"
            ) {

                await onText(
                    text
                );

            }

        }

    }


    try {

        while (
            true
        ) {

            const {
                done,
                value
            } =
                await reader.read();


            if (
                done
            ) {
                break;
            }


            const chunk =
                decoder.decode(
                    value,
                    {
                        stream:
                            true
                    }
                );


            await processEvents(
                parser.push(
                    chunk
                )
            );

        }


        const tail =
            decoder.decode();


        if (
            tail
        ) {

            await processEvents(
                parser.push(
                    tail
                )
            );

        }


        await processEvents(
            parser.flush()
        );


    } catch (
        error
    ) {

        error.emittedText =
            emittedText;


        error.partialReply =
            reply;


        throw error;


    } finally {

        try {

            await reader.cancel();

        } catch {}

    }


    return {

        reply,

        emittedText

    };

}


/* =========================================================
   STREAM ROUTER
   ========================================================= */

async function callModelRouteStream(
    messages,
    route,
    isDeepResearch = false,
    preferences = {},
    options = {}
) {

    try {

        const result =
            await callGeminiStream(
                messages,
                route.primary,
                isDeepResearch,
                preferences,
                options
            );


        return {

            ...result,

            usedFallback:
                false

        };


    } catch (
        primaryError
    ) {

        if (
            primaryError
                ?.emittedText ===
                true ||
            !route.fallback ||
            route.fallback ===
                route.primary
        ) {

            throw primaryError;

        }


        console.warn(
            "[NEYO Model Router] Streaming primary failed before output, trying fallback:",
            {

                route:
                    route.route,

                message:
                    primaryError
                        ?.message

            }
        );


        const result =
            await callGeminiStream(
                messages,
                route.fallback,
                isDeepResearch,
                preferences,
                options
            );


        return {

            ...result,

            usedFallback:
                true

        };

    }

}


/* =========================================================
   CLIENT SSE
   ========================================================= */

function startSSEResponse(
    res
) {

    res.statusCode =
        200;


    res.setHeader(
        "Content-Type",
        "text/event-stream; charset=utf-8"
    );


    res.setHeader(
        "Cache-Control",
        "no-cache, no-transform"
    );


    res.setHeader(
        "Connection",
        "keep-alive"
    );


    res.setHeader(
        "X-Accel-Buffering",
        "no"
    );


    res.flushHeaders?.();

}


function writeSSE(
    res,
    data
) {

    if (
        res.writableEnded ||
        res.destroyed
    ) {
        return false;
    }


    res.write(
        `data: ${JSON.stringify(data)}\n\n`
    );


    return true;

}


/* =========================================================
   MODEL FILE HELPERS
   ========================================================= */

async function deleteGeminiFile(
    fileName
) {

    if (
        !GEMINI_API_KEY ||
        !fileName
    ) {
        return;
    }


    try {

        const safeName =
            String(
                fileName
            )
                .replace(
                    /^\/+/,
                    ""
                );


        await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${safeName}?key=${encodeURIComponent(GEMINI_API_KEY)}`,
            {
                method:
                    "DELETE"
            }
        );


    } catch (
        error
    ) {

        console.warn(
            "[NEYO File Cleanup]",
            error?.message
        );

    }

}


async function waitForGeminiFile(
    fileName,
    fallbackMimeType
) {

    for (
        let attempt =
                0;
        attempt <
            60;
        attempt +=
            1
    ) {

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    2000
                )
        );


        const response =
            await fetch(
                `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${encodeURIComponent(GEMINI_API_KEY)}`
            );


        const data =
            await response
                .json()
                .catch(
                    () => ({})
                );


        if (
            !response.ok
        ) {

            throw new Error(
                data
                    ?.error
                    ?.message ||
                "Unable to check model file status."
            );

        }


        if (
            data.state ===
            "ACTIVE"
        ) {

            return {

                name:
                    data.name,

                uri:
                    data.uri,

                mimeType:
                    data.mimeType ||
                    fallbackMimeType

            };

        }


        if (
            data.state ===
            "FAILED"
        ) {

            throw new Error(
                "Model could not process this attachment."
            );

        }

    }


    throw new Error(
        "File processing timed out."
    );

}


async function uploadSupabaseFileToGemini(
    file
) {

    const {
        data:
            storedFile,
        error
    } =
        await supabase
            .storage
            .from(
                file.bucket
            )
            .download(
                file.path
            );


    if (
        error ||
        !storedFile
    ) {

        throw new Error(
            error?.message ||
            `Unable to read attachment "${file.name}".`
        );

    }


    const bytes =
        Buffer.from(
            await storedFile
                .arrayBuffer()
        );


    if (
        bytes.length ===
        0
    ) {

        throw new Error(
            `Attachment "${file.name}" is empty.`
        );

    }


    const mimeType =
        file.mimeType ||
        storedFile.type ||
        "application/octet-stream";


    const startResponse =
        await fetch(
            `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(GEMINI_API_KEY)}`,
            {

                method:
                    "POST",

                headers: {

                    "X-Goog-Upload-Protocol":
                        "resumable",

                    "X-Goog-Upload-Command":
                        "start",

                    "X-Goog-Upload-Header-Content-Length":
                        String(
                            bytes.length
                        ),

                    "X-Goog-Upload-Header-Content-Type":
                        mimeType,

                    "Content-Type":
                        "application/json"

                },

                body:
                    JSON.stringify({

                        file: {

                            display_name:
                                file.name ||
                                "NEYO attachment"

                        }

                    })

            }
        );


    if (
        !startResponse.ok
    ) {

        throw new Error(
            await startResponse
                .text()
                .catch(
                    () =>
                        "Unable to initialize file upload."
                )
        );

    }


    const uploadUrl =
        startResponse
            .headers
            .get(
                "x-goog-upload-url"
            );


    if (
        !uploadUrl
    ) {

        throw new Error(
            "Model upload URL missing."
        );

    }


    const uploadResponse =
        await fetch(
            uploadUrl,
            {

                method:
                    "POST",

                headers: {

                    "Content-Length":
                        String(
                            bytes.length
                        ),

                    "X-Goog-Upload-Offset":
                        "0",

                    "X-Goog-Upload-Command":
                        "upload, finalize"

                },

                body:
                    bytes

            }
        );


    const payload =
        await uploadResponse
            .json()
            .catch(
                () => ({})
            );


    if (
        !uploadResponse.ok
    ) {

        throw new Error(
            payload
                ?.error
                ?.message ||
            "Model file upload failed."
        );

    }


    const modelFile =
        payload?.file;


    if (
        !modelFile?.name ||
        !modelFile?.uri
    ) {

        throw new Error(
            "Model file information missing."
        );

    }


    if (
        modelFile.state ===
        "PROCESSING"
    ) {

        return waitForGeminiFile(
            modelFile.name,
            mimeType
        );

    }


    return {

        name:
            modelFile.name,

        uri:
            modelFile.uri,

        mimeType:
            modelFile.mimeType ||
            mimeType

    };

}


/* =========================================================
   URL HELPERS
   ========================================================= */

function extractUrlsFromText(
    text
) {

    if (
        !text
    ) {
        return [];
    }


    const matches =
        text.match(
            /https?:\/\/[^\s<>"']+/g
        ) ||
        [];


    return matches.filter(
        url => {

            try {

                const parsed =
                    new URL(
                        url
                    );


                const host =
                    parsed.hostname
                        .toLowerCase();


                if (
                    ![
                        "http:",
                        "https:"
                    ].includes(
                        parsed.protocol
                    )
                ) {
                    return false;
                }


                if (
                    host ===
                        "localhost" ||
                    host.startsWith(
                        "127."
                    ) ||
                    host.startsWith(
                        "10."
                    ) ||
                    host.startsWith(
                        "192.168."
                    ) ||
                    /^172\.(1[6-9]|2[0-9]|3[0-1])\./
                        .test(
                            host
                        )
                ) {
                    return false;
                }


                return true;

            } catch {

                return false;

            }

        }
    );

}


async function fetchUrlText(
    url,
    maxChars =
        12000
) {

    try {

        const controller =
            new AbortController();


        const timeout =
            setTimeout(
                () =>
                    controller.abort(),
                URL_FETCH_TIMEOUT_MS
            );


        let response;


        try {

            response =
                await fetch(
                    url,
                    {

                        redirect:
                            "follow",

                        signal:
                            controller.signal

                    }
                );

        } finally {

            clearTimeout(
                timeout
            );

        }


        if (
            !response.ok
        ) {
            return "";
        }


        const type =
            String(
                response.headers
                    .get(
                        "content-type"
                    ) ||
                ""
            )
                .toLowerCase();


        if (
            !type.includes(
                "text/"
            ) &&
            !type.includes(
                "application/xhtml+xml"
            )
        ) {
            return "";
        }


        let text =
            await response.text();


        text =
            text
                .replace(
                    /<script[\s\S]*?<\/script>/gi,
                    " "
                )
                .replace(
                    /<style[\s\S]*?<\/style>/gi,
                    " "
                )
                .replace(
                    /<[^>]+>/g,
                    " "
                )
                .replace(
                    /\s+/g,
                    " "
                )
                .trim();


        return text.slice(
            0,
            maxChars
        );


    } catch {

        return "";

    }

}


async function buildUrlContextMessages(
    query,
    urls
) {

    const contextParts =
        await Promise.all(
            urls.map(
                async url => ({

                    url,

                    content:
                        await fetchUrlText(
                            url
                        )

                })
            )
        );


    const context =
        contextParts
            .map(
                (
                    item,
                    index
                ) =>
                    `[URL ${index + 1}]\n${item.url}\n\n${item.content}`
            )
            .join(
                "\n\n"
            );


    return [
        {

            role:
                "user",

            parts: [
                {

                    text:
`${query}

Use the following URL content when relevant.

${context}`

                }
            ]

        }
    ];

}


/* =========================================================
   SAVE MESSAGE
   ========================================================= */

async function saveMessage(
    conversationId,
    role,
    content,
    attachments = [],
    sources = []
) {

    if (
        !conversationId
    ) {
        return;
    }


    const base = {

        conversation_id:
            conversationId,

        role,

        content:
            cleanString(
                content
            )

    };


    const full = {

        ...base,

        attachments:
            Array.isArray(
                attachments
            )
                ? attachments
                : [],

        sources:
            Array.isArray(
                sources
            )
                ? sources
                : []

    };


    const {
        error
    } =
        await supabase
            .from(
                "chat_messages"
            )
            .insert(
                full
            );


    if (
        !error
    ) {
        return;
    }


    if (
        /attachments|sources/i
            .test(
                error.message ||
                ""
            )
    ) {

        const {
            error:
                fallbackError
        } =
            await supabase
                .from(
                    "chat_messages"
                )
                .insert(
                    base
                );


        if (
            fallbackError
        ) {
            throw fallbackError;
        }


        return;

    }


    throw error;

}


/* =========================================================
   EXTRACT NORMAL REPLY
   ========================================================= */

function extractFinalReply(
    parts
) {

    if (
        !Array.isArray(
            parts
        )
    ) {
        return "";
    }


    return parts
        .filter(
            part =>
                part &&
                part.thought !==
                    true &&
                typeof part.text ===
                    "string" &&
                part.text.trim()
        )
        .map(
            part =>
                part.text
        )
        .join("")
        .trim();

}


/* =========================================================
   MAIN
   ========================================================= */

export default async function handler(
    req,
    res
) {

    const totalStarted =
        Date.now();


    let userId =
        null;


    let reservedType =
        null;


    let streamResponseStarted =
        false;


    let streamCompleted =
        false;


    let streamAbortController =
        null;


    const geminiFiles =
        [];


    if (
        req.method !==
        "POST"
    ) {

        res.setHeader(
            "Allow",
            "POST"
        );


        return res
            .status(
                405
            )
            .json({

                error:
                    "Method not allowed"

            });

    }


    try {

        /* =================================================
           AUTH
           ================================================= */

        const authStarted =
            Date.now();


        const auth =
            await getAuthenticatedUser(
                req
            );


        logTiming(
            "AUTH_MS",
            elapsed(
                authStarted
            )
        );


        if (
            !auth?.userId
        ) {

            return res
                .status(
                    401
                )
                .json({

                    error:
                        "Authentication required. Please log in."

                });

        }


        userId =
            auth.userId;


        /* =================================================
           BODY
           ================================================= */

        const body =
            req.body &&
            typeof req.body ===
                "object"
                ? req.body
                : {};


        const messages =
            Array.isArray(
                body.messages
            )
                ? body.messages
                : [];


        if (
            messages.length ===
            0
        ) {

            return res
                .status(
                    400
                )
                .json({

                    error:
                        "Messages array required"

                });

        }


        const lastMsg =
            messages[
                messages.length -
                1
            ];


        if (
            !lastMsg ||
            lastMsg.role !==
                "user"
        ) {

            return res
                .status(
                    400
                )
                .json({

                    error:
                        "Last message must be user"

                });

        }


        const preferences = {

            intelligence:
                normalizeIntelligence(
                    body.intelligence
                ),

            language:
                normalizeLanguage(
                    body.language
                ),

            personality:
                normalizePersonality(
                    body.personality
                )

        };


        const privateChat =
            normalizePrivateChat(
                body.privateChat
            );


        const isDeepResearch =
            Boolean(
                body.isDeepResearch
            );


        /* =================================================
           CREDIT
           ================================================= */

        const creditStarted =
            Date.now();


        const {
            data:
                reserveResult,
            error:
                reserveError
        } =
            await supabase
                .rpc(
                    "reserve_message",
                    {

                        p_user_id:
                            userId

                    }
                );


        logTiming(
            "CREDIT_MS",
            elapsed(
                creditStarted
            )
        );


        if (
            reserveError
        ) {

            throw new Error(
                "Unable to check message credits."
            );

        }


        reservedType =
            reserveResult;


        if (
            reservedType ===
            "limit"
        ) {

            return res
                .status(
                    429
                )
                .json({

                    error:
                        "MESSAGE_LIMIT_REACHED",

                    creditsRemaining:
                        0

                });

        }


        if (
            ![
                "pro",
                "free",
                "reward"
            ].includes(
                reservedType
            )
        ) {

            throw new Error(
                "Invalid credit reservation response."
            );

        }


        const isPro =
            reservedType ===
            "pro";


        /* =================================================
           PREPARATION
           ================================================= */

        const prepStarted =
            Date.now();


        const bodyAttachments =
            Array.isArray(
                body.attachments
            )
                ? body.attachments
                : [];


        const messageAttachments =
            Array.isArray(
                lastMsg.attachments
            )
                ? lastMsg.attachments
                : [];


        const rawAttachments =
            bodyAttachments.length >
                0
                ? bodyAttachments
                : messageAttachments;


        const attachments =
            validAttachmentList(
                rawAttachments,
                userId
            );


        const userText =
            cleanString(
                lastMsg.content ||
                ""
            );


        const autoEffort =
            detectAutomaticEffort(
                userText
            );


        const historyBudget =
            getHistoryBudget({

                autoEffort,

                isDeepResearch,

                attachments

            });


        const history =
            selectHistoryMessages(
                messages,
                {

                    maxMessages:
                        historyBudget
                            .messages,

                    maxChars:
                        historyBudget
                            .chars

                }
            );


        console.log(
            "[NEYO History]",
            {

                effort:
                    autoEffort,

                budgetMessages:
                    historyBudget
                        .messages,

                budgetChars:
                    historyBudget
                        .chars,

                selectedMessages:
                    history.length,

                selectedChars:
                    history.reduce(
                        (
                            total,
                            message
                        ) =>
                            total +
                            String(
                                message
                                    ?.content ||
                                ""
                            ).length,
                        0
                    )

            }
        );


        const modelRoute =
            selectModelRoute({

                isPro,

                attachments,

                preferences,

                isDeepResearch,

                autoEffort

            });


        console.log(
            "[NEYO Model Router]",
            {

                plan:
                    isPro
                        ? "leverage"
                        : "free",

                route:
                    modelRoute.route,

                effort:
                    autoEffort,

                multimodal:
                    attachments.length >
                        0

            }
        );


        const geminiMessages =
            history.map(
                message => ({

                    role:
                        message.role ===
                            "assistant"
                            ? "model"
                            : "user",

                    parts: [
                        {

                            text:
                                cleanString(
                                    message.content ||
                                    ""
                                )

                        }
                    ]

                })
            );


        if (
            geminiMessages.length ===
            0
        ) {

            geminiMessages.push({

                role:
                    "user",

                parts: [
                    {

                        text:
                            userText ||
                            "Please respond to the user."

                    }
                ]

            });

        }


        /* =================================================
           ATTACHMENTS
           ================================================= */

        if (
            attachments.length >
            0
        ) {

            const preparedFiles =
                await Promise.all(
                    attachments.map(
                        file =>
                            uploadSupabaseFileToGemini(
                                file
                            )
                    )
                );


            const lastModelMessage =
                geminiMessages[
                    geminiMessages.length -
                    1
                ];


            const fileParts =
                preparedFiles
                    .filter(
                        Boolean
                    )
                    .map(
                        file => {

                            geminiFiles.push(
                                file.name
                            );


                            return {

                                fileData: {

                                    mimeType:
                                        file.mimeType,

                                    fileUri:
                                        file.uri

                                }

                            };

                        }
                    );


            lastModelMessage.role =
                "user";


            lastModelMessage.parts = [

                {

                    text:
                        userText ||
                        "Please analyze the attached file."

                },

                ...fileParts

            ];

        }


        const urls =
            extractUrlsFromText(
                userText
            );


        logTiming(
            "PREP_MS",
            elapsed(
                prepStarted
            ),
            {

                effort:
                    autoEffort,

                historyMessages:
                    history.length,

                attachments:
                    attachments.length,

                urls:
                    urls.length

            }
        );


        /* =================================================
           CONVERSATION
           ================================================= */

        let conversationId =
            privateChat
                ? null
                : cleanString(
                    body.conversationId ||
                    "",
                    128
                ) ||
                null;


        if (
            !privateChat &&
            !conversationId
        ) {

            const {
                data:
                    conversationRow,
                error
            } =
                await supabase
                    .from(
                        "chat_conversations"
                    )
                    .insert({

                        user_id:
                            userId,

                        title:
                            cleanString(
                                body.title ||
                                userText ||
                                attachments[0]
                                    ?.name ||
                                "New conversation",
                                100
                            ) ||
                            "New conversation"

                    })
                    .select(
                        "id"
                    )
                    .single();


            if (
                error
            ) {
                throw error;
            }


            conversationId =
                conversationRow.id;

        }


        if (
            !privateChat
        ) {

            await saveMessage(
                conversationId,
                "user",
                userText ||
                "Attachment",
                attachments,
                []
            );

        }


        /* =================================================
           STREAMING
           ================================================= */

        if (
            body.stream ===
            true
        ) {

            streamAbortController =
                new AbortController();


            res.on(
                "close",
                () => {

                    if (
                        !streamCompleted &&
                        !streamAbortController
                            .signal
                            .aborted
                    ) {

                        try {

                            streamAbortController
                                .abort();

                        } catch {}

                    }

                }
            );


            let streamMessages =
                geminiMessages;


            let sources =
                [];


            let usedUrlContext =
                false;


            if (
                attachments.length ===
                    0 &&
                urls.length >
                    0
            ) {

                const limitedUrls =
                    urls.slice(
                        0,
                        MAX_URL_CONTEXT_SOURCES
                    );


                streamMessages =
                    await buildUrlContextMessages(
                        userText,
                        limitedUrls
                    );


                sources =
                    limitedUrls.map(
                        url => ({

                            title:
                                url,

                            url

                        })
                    );


                usedUrlContext =
                    true;

            }


            startSSEResponse(
                res
            );


            streamResponseStarted =
                true;


            let firstTokenLogged =
                false;


            const modelStarted =
                Date.now();


            const streamResult =
                await callModelRouteStream(
                    streamMessages,
                    modelRoute,
                    isDeepResearch,
                    preferences,
                    {

                        signal:
                            streamAbortController
                                .signal,


                        onHeaders:
                            (
                                ms,
                                model
                            ) => {

                                logTiming(
                                    "MODEL_HEADERS_MS",
                                    ms,
                                    {

                                        route:
                                            modelRoute.route,

                                        model

                                    }
                                );

                            },


                        onFirstText:
                            (
                                ms,
                                model
                            ) => {

                                if (
                                    firstTokenLogged
                                ) {
                                    return;
                                }


                                firstTokenLogged =
                                    true;


                                logTiming(
                                    "FIRST_TOKEN_MS",
                                    elapsed(
                                        totalStarted
                                    ),
                                    {

                                        modelRequestMs:
                                            ms,

                                        route:
                                            modelRoute.route,

                                        model

                                    }
                                );

                            },


                        onText:
                            text => {

                                writeSSE(
                                    res,
                                    {

                                        type:
                                            "delta",

                                        content:
                                            text

                                    }
                                );

                            }

                    }
                );


            logTiming(
                "MODEL_TOTAL_MS",
                elapsed(
                    modelStarted
                ),
                {

                    route:
                        modelRoute.route,

                    fallback:
                        streamResult
                            .usedFallback

                }
            );


            const reply =
                streamResult.reply;


            if (
                !reply
            ) {

                throw new Error(
                    "NEYO returned an empty response."
                );

            }


            if (
                !privateChat
            ) {

                await saveMessage(
                    conversationId,
                    "assistant",
                    reply,
                    [],
                    sources
                );

            }


            writeSSE(
                res,
                {

                    type:
                        "done",

                    done:
                        true,

                    conversationId:
                        privateChat
                            ? null
                            : conversationId,

                    privateChat,

                    sources,

                    usedUrlContext,

                    creditType:
                        reservedType

                }
            );


            streamCompleted =
                true;


            if (
                !res.writableEnded &&
                !res.destroyed
            ) {

                res.write(
                    "data: [DONE]\n\n"
                );


                res.end();

            }


            logTiming(
                "TOTAL_MS",
                elapsed(
                    totalStarted
                ),
                {

                    streaming:
                        true,

                    route:
                        modelRoute.route

                }
            );


            return;

        }


        /* =================================================
           NON-STREAMING
           ================================================= */

        let normalMessages =
            geminiMessages;


        let sources =
            [];


        let usedUrlContext =
            false;


        if (
            attachments.length ===
                0 &&
            urls.length >
                0
        ) {

            const limitedUrls =
                urls.slice(
                    0,
                    MAX_URL_CONTEXT_SOURCES
                );


            normalMessages =
                await buildUrlContextMessages(
                    userText,
                    limitedUrls
                );


            sources =
                limitedUrls.map(
                    url => ({

                        title:
                            url,

                        url

                    })
                );


            usedUrlContext =
                true;

        }


        const modelStarted =
            Date.now();


        const modelResponse =
            await callModelRoute(
                normalMessages,
                modelRoute,
                isDeepResearch,
                preferences
            );


        logTiming(
            "MODEL_TOTAL_MS",
            elapsed(
                modelStarted
            ),
            {

                streaming:
                    false,

                route:
                    modelRoute.route,

                fallback:
                    modelResponse
                        .usedFallback

            }
        );


        const reply =
            extractFinalReply(
                modelResponse
                    ?.data
                    ?.candidates?.[0]
                    ?.content
                    ?.parts
            );


        if (
            !reply
        ) {

            throw new Error(
                "NEYO returned an empty response."
            );

        }


        if (
            !privateChat
        ) {

            await saveMessage(
                conversationId,
                "assistant",
                reply,
                [],
                sources
            );

        }


        logTiming(
            "TOTAL_MS",
            elapsed(
                totalStarted
            ),
            {

                streaming:
                    false,

                route:
                    modelRoute.route

            }
        );


        return res
            .status(
                200
            )
            .json({

                reply,

                conversationId:
                    privateChat
                        ? null
                        : conversationId,

                privateChat,

                sources:
                    sources.length >
                        0
                        ? sources
                        : undefined,

                usedUrlContext,

                creditType:
                    reservedType,

                attachmentsReceived:
                    rawAttachments.length,

                attachmentsAccepted:
                    attachments.length

            });


    } catch (
        error
    ) {

        console.error(
            "[NEYO Chat Error]",
            {

                message:
                    error?.message,

                name:
                    error?.name

            }
        );


        logTiming(
            "TOTAL_ERROR_MS",
            elapsed(
                totalStarted
            )
        );


        /* =================================================
           REFUND
           ================================================= */

        if (
            !streamCompleted &&
            userId &&
            (
                reservedType ===
                    "free" ||
                reservedType ===
                    "reward"
            )
        ) {

            try {

                await supabase
                    .rpc(
                        "refund_message",
                        {

                            p_user_id:
                                userId,

                            p_type:
                                reservedType

                        }
                    );

            } catch {}

        }


        /* =================================================
           STREAM ERROR
           ================================================= */

        if (
            streamResponseStarted
        ) {

            writeSSE(
                res,
                {

                    type:
                        "error",

                    error:
                        error?.name ===
                            "AbortError"
                            ? "Generation stopped."
                            : error?.message ||
                                "Unable to complete request."

                }
            );


            if (
                !res.writableEnded &&
                !res.destroyed
            ) {

                res.end();

            }


            return;

        }


        return res
            .status(
                error?.status >=
                    400 &&
                error?.status <
                    600
                    ? error.status
                    : 500
            )
            .json({

                error:
                    error?.message ||
                    "Unable to complete request."

            });


    } finally {

        if (
            geminiFiles.length >
            0
        ) {

            await Promise.allSettled(
                geminiFiles.map(
                    fileName =>
                        deleteGeminiFile(
                            fileName
                        )
                )
            );

        }

    }

}
