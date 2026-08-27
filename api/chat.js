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
                persistSession:
                    false,

                autoRefreshToken:
                    false
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


const MAX_URL_CONTEXT_SOURCES =
    5;


const DDG_USER_AGENT =
    "NEYO/1.0 (https://signaturesi.com)";


/* =========================================================
   SYSTEM INSTRUCTION
   ========================================================= */

const NEYO_RESPONSE_FORMAT = `
You are NEYO, a natural, intelligent conversational assistant.

VOICE AND TONE
- Match the user's language, tone, and level of formality.
- When the user writes Roman Urdu, respond in natural Roman Urdu.
- Sound human, direct, calm, and confident.
- Do not sound robotic or scripted.
- Do not repeat the user's question unnecessarily.
- Answer the actual question first.

ORGANIZATION
- Keep simple answers concise.
- Use structure only when useful.
- Avoid excessive headings or repeated points.

ACCURACY
- Do not invent facts.
- Clearly distinguish uncertainty from verified information.
- If information cannot be verified, say so.

FILES
- When files are attached, inspect and answer based on the attached content.
- Do not claim to have read a file if file access failed.

WRITING
- Use clean Markdown.
- Use fenced code blocks when needed.
- Keep paragraphs readable.

MATH
- Use \\( ... \\) for inline mathematics.
- Use \\[ ... \\] for display mathematics.
`;


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

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


function cleanEnv(
    value
) {

    return typeof value ===
        "string"
        ? value.trim()
        : "";

}


function sanitizePathSegment(
    value
) {

    return String(
        value ?? ""
    )
        .trim()
        .replace(
            /[^a-zA-Z0-9._-]+/g,
            "_"
        )
        .replace(
            /_+/g,
            "_"
        )
        .replace(
            /^[._-]+/,
            ""
        )
        .replace(
            /[._-]+$/,
            ""
        )
        .slice(
            0,
            180
        );

}


/* =========================================================
   ATTACHMENTS

   IMPORTANT:
   upload.js creates:
   users/<userId>/<uploadId>/<filename>

   chat.js must preserve:
   uploadId
   bucket
   path
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
        sanitizePathSegment(
            userId
        );


    const output =
        [];


    const seen =
        new Set();


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


        const uploadId =
            cleanString(
                raw.uploadId ||
                raw.upload_id ||
                raw.id ||
                "",
                128
            );


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


        const name =
            cleanString(
                raw.name ||
                "Attached file",
                220
            )
                .replace(
                    /[\\/]/g,
                    "-"
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
            Number.isFinite(
                Number(
                    raw.size
                )
            )
                ? Math.max(
                    0,
                    Number(
                        raw.size
                    )
                )
                : 0;


        /*
        -----------------------------------------------------
        Bucket must match upload/process APIs.
        -----------------------------------------------------
        */

        if (
            bucket !==
            ATTACHMENT_BUCKET
        ) {

            console.warn(
                "[NEYO Chat] Invalid attachment bucket:",
                bucket
            );

            continue;

        }


        if (
            !uploadId ||
            !path
        ) {

            console.warn(
                "[NEYO Chat] Attachment metadata incomplete:",
                {
                    uploadId,
                    path,
                    name
                }
            );

            continue;

        }


        if (
            path.startsWith(
                "/"
            ) ||
            path.includes(
                "\\"
            ) ||
            path.includes(
                ".."
            )
        ) {

            console.warn(
                "[NEYO Chat] Invalid attachment path:",
                path
            );

            continue;

        }


        const safeUploadId =
            sanitizePathSegment(
                uploadId
            );


        const requiredPrefix =
            `users/${safeUserId}/${safeUploadId}/`;


        if (
            !path.startsWith(
                requiredPrefix
            )
        ) {

            console.warn(
                "[NEYO Chat] Attachment ownership mismatch:",
                {
                    path,
                    requiredPrefix
                }
            );

            continue;

        }


        const key =
            `${uploadId}:${path}`;


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
                uploadId,

            uploadId,

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
   URL HELPERS
   ========================================================= */

function extractUrlsFromText(
    text
) {

    if (!text) {
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


                const hostname =
                    parsed.hostname
                        .toLowerCase();


                if (
                    hostname ===
                        "localhost" ||
                    hostname.startsWith(
                        "127."
                    ) ||
                    hostname.startsWith(
                        "10."
                    ) ||
                    hostname.startsWith(
                        "192.168."
                    ) ||
                    /^172\.(1[6-9]|2[0-9]|3[0-1])\./
                        .test(
                            hostname
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


function normalizeDuckDuckGoUrl(
    rawHref
) {

    if (!rawHref) {
        return null;
    }


    try {

        const parsed =
            new URL(
                rawHref,
                "https://duckduckgo.com"
            );


        let destination =
            parsed.searchParams
                .get(
                    "uddg"
                );


        if (
            destination
        ) {

            destination =
                decodeURIComponent(
                    destination
                );

        } else {

            destination =
                parsed.href;

        }


        const finalUrl =
            new URL(
                destination
            );


        if (
            ![
                "http:",
                "https:"
            ].includes(
                finalUrl.protocol
            )
        ) {
            return null;
        }


        if (
            finalUrl.hostname
                .toLowerCase()
                .includes(
                    "duckduckgo.com"
                )
        ) {
            return null;
        }


        finalUrl.hash =
            "";


        [
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_term",
            "utm_content"
        ].forEach(
            key => {

                finalUrl
                    .searchParams
                    .delete(
                        key
                    );

            }
        );


        return finalUrl.href;

    } catch {

        return null;

    }

}


/* =========================================================
   DUCKDUCKGO
   ========================================================= */

async function searchDuckDuckGo(
    query,
    limit = 8
) {

    const cleanQuery =
        cleanString(
            query,
            500
        );


    if (
        !cleanQuery
    ) {
        return [];
    }


    const endpoint =
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;


    try {

        const response =
            await fetch(
                endpoint,
                {

                    method:
                        "GET",

                    headers: {

                        "User-Agent":
                            "Mozilla/5.0",

                        Accept:
                            "text/html",

                        "Accept-Language":
                            "en-US,en;q=0.9"

                    },

                    redirect:
                        "follow"

                }
            );


        if (
            !response.ok
        ) {
            return [];
        }


        const html =
            await response
                .text();


        if (
            !html ||
            html.length <
                500
        ) {
            return [];
        }


        const results =
            [];


        const seen =
            new Set();


        const blocks =
            html.split(
                /<div class="result[^"]*">/gi
            );


        for (
            const block
            of blocks
        ) {

            if (
                results.length >=
                limit
            ) {
                break;
            }


            const anchor =
                block.match(
                    /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
                );


            if (
                !anchor
            ) {
                continue;
            }


            const url =
                normalizeDuckDuckGoUrl(
                    anchor[1]
                );


            const title =
                anchor[2]
                    .replace(
                        /<[^>]+>/g,
                        " "
                    )
                    .replace(
                        /\s+/g,
                        " "
                    )
                    .trim();


            if (
                !url ||
                !title ||
                seen.has(
                    url
                )
            ) {
                continue;
            }


            const snippetMatch =
                block.match(
                    /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i
                );


            const snippet =
                snippetMatch
                    ? snippetMatch[1]
                        .replace(
                            /<[^>]+>/g,
                            " "
                        )
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .trim()
                    : "";


            seen.add(
                url
            );


            results.push({

                url,
                title,
                snippet

            });

        }


        return results;

    } catch (
        error
    ) {

        console.warn(
            "[NEYO Web] DuckDuckGo failed:",
            error?.message
        );


        return [];

    }

}


/* =========================================================
   FETCH PAGE TEXT
   ========================================================= */

async function fetchUrlText(
    url,
    maxChars = 10000
) {

    try {

        const response =
            await fetch(
                url,
                {

                    method:
                        "GET",

                    headers: {

                        "User-Agent":
                            DDG_USER_AGENT,

                        Accept:
                            "text/html,text/plain,application/xhtml+xml"

                    },

                    redirect:
                        "follow"

                }
            );


        if (
            !response.ok
        ) {
            return "";
        }


        const contentType =
            String(
                response.headers
                    .get(
                        "content-type"
                    ) ||
                ""
            )
                .toLowerCase();


        if (
            !contentType.includes(
                "text/"
            ) &&
            !contentType.includes(
                "application/xhtml+xml"
            )
        ) {
            return "";
        }


        let text =
            await response
                .text();


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
                    /<noscript[\s\S]*?<\/noscript>/gi,
                    " "
                )
                .replace(
                    /<svg[\s\S]*?<\/svg>/gi,
                    " "
                )
                .replace(
                    /<[^>]+>/g,
                    " "
                )
                .replace(
                    /&nbsp;/gi,
                    " "
                )
                .replace(
                    /&amp;/gi,
                    "&"
                )
                .replace(
                    /&quot;/gi,
                    '"'
                )
                .replace(
                    /&#39;/gi,
                    "'"
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


/* =========================================================
   PREFERENCES
   ========================================================= */

function normalizeIntelligence(
    value
) {

    const clean =
        String(
            value ||
            "standard"
        )
            .trim()
            .toLowerCase();


    return [
        "standard",
        "high",
        "maximum"
    ].includes(
        clean
    )
        ? clean
        : "standard";

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
   SYSTEM BUILDER
   ========================================================= */

function buildSystemInstruction(
    preferences = {}
) {

    const extra =
        [];


    if (
        preferences.intelligence ===
            "high" ||
        preferences.intelligence ===
            "maximum"
    ) {

        extra.push(
            "Use deeper reasoning for difficult requests while keeping the final response readable."
        );

    }


    if (
        preferences.language &&
        preferences.language !==
            "auto"
    ) {

        extra.push(
            `Preferred response language: ${preferences.language}.`
        );

    }


    if (
        preferences.personality &&
        preferences.personality !==
            "neyo"
    ) {

        extra.push(
            `Preferred personality preset: ${preferences.personality}.`
        );

    }


    return [
        NEYO_RESPONSE_FORMAT,
        ...extra
    ].join(
        "\n\n"
    );

}


/* =========================================================
   GEMINI BODY
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
   GEMINI CALL
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

        console.error(
            "[NEYO Gemini]",
            data
        );


        throw new Error(
            data
                ?.error
                ?.message ||
            `Gemini request failed (${response.status}).`
        );

    }


    return data;

}


/* =========================================================
   GEMINI TEMP FILE DELETE
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


    const safeName =
        String(
            fileName
        )
            .replace(
                /^\/+/,
                ""
            );


    try {

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
            "[NEYO Gemini] Temp file delete failed:",
            error?.message
        );

    }

}


/* =========================================================
   DOWNLOAD FROM SUPABASE + UPLOAD TO GEMINI
   ========================================================= */

async function uploadSupabaseFileToGemini(
    file
) {

    if (
        !file?.bucket ||
        !file?.path
    ) {

        throw new Error(
            `Attachment "${file?.name || "file"}" is missing storage metadata.`
        );

    }


    /*
    ---------------------------------------------------------
    CRITICAL:
    Use attachment.bucket directly.

    DO NOT replace it with neo-uploads.
    ---------------------------------------------------------
    */

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

        console.error(
            "[NEYO Attachment] Storage download failed:",
            {
                bucket:
                    file.bucket,

                path:
                    file.path,

                name:
                    file.name,

                error:
                    error?.message
            }
        );


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
        file.mime ||
        storedFile.type ||
        "application/octet-stream";


    /*
    ---------------------------------------------------------
    Gemini resumable upload start
    ---------------------------------------------------------
    */

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

        const details =
            await startResponse
                .text()
                .catch(
                    () => ""
                );


        throw new Error(
            details ||
            "Unable to initialize Gemini file upload."
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
            "Gemini upload URL missing."
        );

    }


    /*
    ---------------------------------------------------------
    Send actual bytes
    ---------------------------------------------------------
    */

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
            "Gemini file upload failed."
        );

    }


    const geminiFile =
        payload?.file;


    if (
        !geminiFile?.name ||
        !geminiFile?.uri
    ) {

        throw new Error(
            "Gemini file information was not returned."
        );

    }


    /*
    ---------------------------------------------------------
    Wait while Gemini processes file
    ---------------------------------------------------------
    */

    if (
        geminiFile.state ===
        "PROCESSING"
    ) {

        return waitForGeminiFile(
            geminiFile.name,
            mimeType
        );

    }


    if (
        geminiFile.state ===
        "FAILED"
    ) {

        throw new Error(
            `Gemini could not process "${file.name}".`
        );

    }


    return {

        name:
            geminiFile.name,

        uri:
            geminiFile.uri,

        mimeType:
            geminiFile.mimeType ||
            mimeType

    };

}


/* =========================================================
   WAIT FOR GEMINI FILE
   ========================================================= */

async function waitForGeminiFile(
    fileName,
    fallbackMimeType
) {

    for (
        let attempt = 0;
        attempt < 60;
        attempt += 1
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
                "Unable to check Gemini file status."
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
                "Gemini could not process the attachment."
            );

        }

    }


    throw new Error(
        "Gemini file processing timed out."
    );

}


/* =========================================================
   WEB SEARCH ANSWER
   ========================================================= */

async function smartWebAnswer(
    query,
    model,
    isDeepResearch,
    preferences
) {

    const results =
        await searchDuckDuckGo(
            query,
            isDeepResearch
                ? 8
                : 5
        );


    if (
        results.length ===
        0
    ) {

        throw new Error(
            "No usable web results found."
        );

    }


    const enriched =
        [];


    for (
        const result
        of results
    ) {

        const content =
            await fetchUrlText(
                result.url,
                isDeepResearch
                    ? 14000
                    : 8000
            );


        enriched.push({

            ...result,
            content

        });

    }


    const context =
        enriched
            .map(
                (
                    source,
                    index
                ) => [

                    `[Source ${index + 1}]`,

                    `Title: ${source.title}`,

                    `URL: ${source.url}`,

                    source.snippet
                        ? `Snippet: ${source.snippet}`
                        : "",

                    source.content
                        ? `Content: ${source.content}`
                        : ""

                ]
                    .filter(
                        Boolean
                    )
                    .join(
                        "\n"
                    )
            )
            .join(
                "\n\n"
            );


    const response =
        await callGemini(
            [
                {

                    role:
                        "user",

                    parts: [
                        {

                            text:
`${query}

Use the fresh web context below when relevant.
Do not invent information.
If sources conflict, explain that.

${context}`

                        }
                    ]

                }
            ],
            model,
            isDeepResearch,
            preferences
        );


    return {

        reply:
            response
                ?.candidates?.[0]
                ?.content
                ?.parts?.[0]
                ?.text ||
            "",

        sources:
            enriched.map(
                source => ({

                    title:
                        source.title,

                    url:
                        source.url,

                    snippet:
                        source.snippet

                })
            ),

        usedUrlContext:
            true

    };

}


/* =========================================================
   DIRECT URL CONTEXT
   ========================================================= */

async function callGeminiUrlContext(
    query,
    urls,
    model,
    isDeepResearch,
    preferences
) {

    const contexts =
        [];


    for (
        const url
        of urls
    ) {

        const content =
            await fetchUrlText(
                url,
                12000
            );


        contexts.push({

            url,
            content

        });

    }


    const context =
        contexts
            .map(
                (
                    item,
                    index
                ) =>
`[URL ${index + 1}]
${item.url}

${item.content}`
            )
            .join(
                "\n\n"
            );


    return callGemini(
        [
            {

                role:
                    "user",

                parts: [
                    {

                        text:
`${query}

Use the following URL content when relevant.
Do not invent information outside the supplied context.

${context}`

                    }
                ]

            }
        ],
        model,
        isDeepResearch,
        preferences
    );

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


    const payload = {

        conversation_id:
            conversationId,

        role,

        content:
            cleanString(
                content
            )

    };


    /*
    Keep attachments if schema supports it.
    */

    if (
        Array.isArray(
            attachments
        ) &&
        attachments.length >
            0
    ) {

        payload.attachments =
            attachments;

    }


    if (
        Array.isArray(
            sources
        ) &&
        sources.length >
            0
    ) {

        payload.sources =
            sources;

    }


    const {
        error
    } =
        await supabase
            .from(
                "chat_messages"
            )
            .insert(
                payload
            );


    if (
        error
    ) {

        /*
        Compatibility fallback if old schema
        does not have attachments/sources columns.
        */

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
                    .insert({

                        conversation_id:
                            conversationId,

                        role,

                        content:
                            cleanString(
                                content
                            )

                    });


            if (
                fallbackError
            ) {
                throw fallbackError;
            }


            return;

        }


        throw error;

    }

}


/* =========================================================
   HANDLER
   ========================================================= */

export default async function handler(
    req,
    res
) {

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


    const geminiFiles =
        [];


    let userId =
        null;


    let reservedType =
        null;


    try {

        /* =================================================
           AUTH
           ================================================= */

        const auth =
            await getAuthenticatedUser(
                req
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


        const {
            messages,
            conversationId,
            isDeepResearch,
            title
        } =
            body;


        if (
            !Array.isArray(
                messages
            ) ||
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


        /* =================================================
           CREDIT
           ================================================= */

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


        if (
            reserveError
        ) {

            console.error(
                "[NEYO Credit]",
                reserveError
            );


            return res
                .status(
                    500
                )
                .json({

                    error:
                        "Unable to check message credits."

                });

        }


        reservedType =
            reserveResult;


        if (
            ![
                "pro",
                "free",
                "reward",
                "limit"
            ].includes(
                reservedType
            )
        ) {

            throw new Error(
                "Invalid credit reservation response."
            );

        }


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


        const isPro =
            reservedType ===
            "pro";


        /* =================================================
           ATTACHMENTS
           ================================================= */

        const rawAttachments =
            Array.isArray(
                body.attachments
            )
                ? body.attachments
                : Array.isArray(
                    lastMsg.attachments
                )
                    ? lastMsg.attachments
                    : [];


        const attachments =
            validAttachmentList(
                rawAttachments,
                userId
            );


        console.log(
            "[NEYO Chat] Attachments:",
            attachments.map(
                item => ({

                    uploadId:
                        item.uploadId,

                    bucket:
                        item.bucket,

                    path:
                        item.path,

                    name:
                        item.name

                })
            )
        );


        /* =================================================
           GEMINI HISTORY
           ================================================= */

        const history =
            messages.slice(
                -MAX_HISTORY_MESSAGES
            );


        const geminiMessages =
            history
                .map(
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
                )
                .filter(
                    message =>
                        Boolean(
                            message
                                .parts?.[0]
                                ?.text
                        )
                );


        /*
        Last user message may be attachment-only.
        Ensure message exists.
        */

        if (
            attachments.length >
                0 &&
            geminiMessages.length ===
                0
        ) {

            geminiMessages.push({

                role:
                    "user",

                parts: [
                    {

                        text:
                            "Please analyze the attached file or files."

                    }
                ]

            });

        }


        /* =================================================
           ATTACH FILES TO LAST USER MESSAGE
           ================================================= */

        if (
            attachments.length >
                0
        ) {

            const lastGeminiMessage =
                geminiMessages[
                    geminiMessages.length -
                    1
                ];


            if (
                !lastGeminiMessage
            ) {

                throw new Error(
                    "Unable to prepare attachment message."
                );

            }


            const attachmentParts =
                [];


            for (
                const file
                of attachments
            ) {

                const geminiFile =
                    await uploadSupabaseFileToGemini(
                        file
                    );


                if (
                    !geminiFile?.uri
                ) {
                    continue;
                }


                geminiFiles.push(
                    geminiFile.name
                );


                attachmentParts.push({

                    fileData: {

                        mimeType:
                            geminiFile
                                .mimeType,

                        fileUri:
                            geminiFile
                                .uri

                    }

                });

            }


            if (
                attachmentParts.length ===
                0
            ) {

                throw new Error(
                    "No attached files could be prepared."
                );

            }


            const originalText =
                cleanString(
                    lastMsg.content ||
                    ""
                ) ||
                "Please analyze the attached file or files.";


            lastGeminiMessage.parts = [

                {
                    text:
                        originalText
                },

                ...attachmentParts

            ];

        }


        /* =================================================
           CONVERSATION
           ================================================= */

        let convId =
            privateChat
                ? null
                : cleanString(
                    conversationId ||
                    "",
                    128
                ) ||
                null;


        if (
            !privateChat &&
            !convId
        ) {

            const {
                data:
                    newConversation,
                error:
                    conversationError
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
                                title ||
                                lastMsg.content ||
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
                conversationError
            ) {
                throw conversationError;
            }


            convId =
                newConversation.id;

        }


        /* =================================================
           SAVE USER MESSAGE
           ================================================= */

        const userText =
            cleanString(
                lastMsg.content ||
                ""
            );


        if (
            !privateChat
        ) {

            await saveMessage(
                convId,
                "user",
                userText ||
                    "Attachment",
                attachments,
                []
            );

        }


        /* =================================================
           MODEL
           ================================================= */

        const model =
            isPro
                ? (
                    cleanEnv(
                        process.env
                            .GEMINI_PRO_MODEL
                    ) ||
                    "gemini-3.5-flash-lite"
                )
                : (
                    cleanEnv(
                        process.env
                            .GEMINI_FREE_MODEL
                    ) ||
                    "gemini-3.1-flash-lite"
                );


        /* =================================================
           WEB / NORMAL DECISION
           ================================================= */

        const lowerQuery =
            userText
                .toLowerCase();


        const hasUrl =
            extractUrlsFromText(
                userText
            )
                .length >
            0;


        const isCurrentQuery =
            /\b(current|now|latest|today|real[- ]time|this week|this month|202[4-9])\b/
                .test(
                    lowerQuery
                );


        let reply =
            "";


        let sources =
            [];


        let usedUrlContext =
            false;


        /*
        Attachments take priority.
        Do not launch web search for attached files.
        */

        if (
            attachments.length ===
                0 &&
            hasUrl
        ) {

            const urls =
                extractUrlsFromText(
                    userText
                )
                    .slice(
                        0,
                        MAX_URL_CONTEXT_SOURCES
                    );


            try {

                const response =
                    await callGeminiUrlContext(
                        userText,
                        urls,
                        model,
                        isDeepResearch,
                        preferences
                    );


                reply =
                    response
                        ?.candidates?.[0]
                        ?.content
                        ?.parts?.[0]
                        ?.text ||
                    "";


                sources =
                    urls.map(
                        url => ({

                            title:
                                url,

                            url,

                            status:
                                "success"

                        })
                    );


                usedUrlContext =
                    true;

            } catch (
                error
            ) {

                console.warn(
                    "[NEYO URL Context]",
                    error?.message
                );

            }

        } else if (
            attachments.length ===
                0 &&
            isCurrentQuery
        ) {

            try {

                const result =
                    await smartWebAnswer(
                        userText,
                        model,
                        isDeepResearch,
                        preferences
                    );


                reply =
                    result.reply;


                sources =
                    result.sources ||
                    [];


                usedUrlContext =
                    true;

            } catch (
                error
            ) {

                console.warn(
                    "[NEYO Search]",
                    error?.message
                );

            }

        }


        /* =================================================
           NORMAL / ATTACHMENT GEMINI
           ================================================= */

        if (
            !reply
        ) {

            const response =
                await callGemini(
                    geminiMessages,
                    model,
                    isDeepResearch,
                    preferences
                );


            reply =
                response
                    ?.candidates?.[0]
                    ?.content
                    ?.parts
                    ?.map(
                        part =>
                            part?.text ||
                            ""
                    )
                    .join(
                        ""
                    )
                    .trim() ||
                "";


            if (
                !reply
            ) {

                throw new Error(
                    "Gemini returned an empty response."
                );

            }

        }


        /* =================================================
           SAVE ASSISTANT
           ================================================= */

        if (
            !privateChat
        ) {

            await saveMessage(
                convId,
                "assistant",
                reply,
                [],
                sources
            );

        }


        /* =================================================
           SUCCESS
           ================================================= */

        return res
            .status(
                200
            )
            .json({

                reply,

                conversationId:
                    privateChat
                        ? null
                        : convId,

                privateChat,

                usedUrlContext,

                sources:
                    sources.length >
                    0
                        ? sources
                        : undefined,

                creditType:
                    reservedType,

                attachmentsProcessed:
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

                stack:
                    error?.stack
            }
        );


        /* =================================================
           REFUND FREE / REWARD CREDIT
           ================================================= */

        if (
            userId &&
            (
                reservedType ===
                    "free" ||
                reservedType ===
                    "reward"
            )
        ) {

            try {

                const {
                    error:
                        refundError
                } =
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


                if (
                    refundError
                ) {

                    console.error(
                        "[NEYO Credit Refund]",
                        refundError
                    );

                }

            } catch (
                refundFailure
            ) {

                console.error(
                    "[NEYO Credit Refund]",
                    refundFailure?.message
                );

            }

        }


        /*
        Return useful storage error instead of hiding
        "Object not found".
        */

        return res
            .status(
                500
            )
            .json({

                error:
                    error?.message ||
                    "Unable to complete request."

            });


    } finally {

        /* =================================================
           DELETE GEMINI TEMP FILES ONLY

           Supabase attachment is NEVER deleted here.
           ================================================= */

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
