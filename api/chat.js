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


const MAX_URL_CONTEXT_SOURCES =
    5;


/* =========================================================
   SYSTEM
   ========================================================= */

const NEYO_RESPONSE_FORMAT = `
You are NEYO, a natural, intelligent conversational assistant.

VOICE AND TONE
- Match the user's language and tone.
- When the user writes Roman Urdu, respond in natural Roman Urdu.
- Be direct, useful, calm, and confident.
- Do not sound robotic or scripted.
- Answer the actual request first.

FILES
- When files are attached, inspect the attached files and answer based on them.
- Never claim that no file was attached when valid file content is available.
- If file access genuinely fails, explain that clearly.

ACCURACY
- Do not invent facts.
- Clearly identify uncertainty.
- Prefer correctness over guessing.

WRITING
- Use clean Markdown.
- Use fenced code blocks for code.
- Keep simple answers concise.
`;


/* =========================================================
   HELPERS
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


/* =========================================================
   ATTACHMENTS

   Expected upload path:

   users/<authenticatedUserId>/<uploadId>/<filename>

   IMPORTANT:
   - Do not rebuild path.
   - Do not force a different bucket.
   - uploadId is useful but not required for chat access.
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

            console.warn(
                "[NEYO Chat] Wrong attachment bucket:",
                {
                    bucket,
                    name
                }
            );

            continue;

        }


        if (
            !path
        ) {

            console.warn(
                "[NEYO Chat] Attachment has no storage path:",
                name
            );

            continue;

        }


        if (
            path.startsWith("/") ||
            path.includes("\\") ||
            path.includes("..")
        ) {

            console.warn(
                "[NEYO Chat] Unsafe attachment path:",
                path
            );

            continue;

        }


        /*
        Only allow current authenticated user's files.
        */

        if (
            !path.startsWith(
                userPrefix
            )
        ) {

            console.warn(
                "[NEYO Chat] Attachment user mismatch:",
                {
                    path,
                    expectedPrefix:
                        userPrefix
                }
            );

            continue;

        }


        const dedupeKey =
            `${bucket}:${path}`;


        if (
            seen.has(
                dedupeKey
            )
        ) {
            continue;
        }


        seen.add(
            dedupeKey
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


    console.log(
        "[NEYO Chat] Accepted attachments:",
        output.map(
            item => ({
                name:
                    item.name,

                uploadId:
                    item.uploadId,

                bucket:
                    item.bucket,

                path:
                    item.path
            })
        )
    );


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
   SYSTEM BUILDER
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
                    : preferences.intelligence ===
                        "maximum"
                        ? 0.5
                        : 0.65,

            topP:
                0.95,

            maxOutputTokens:
                (
                    isDeepResearch ||
                    preferences.intelligence ===
                        "maximum"
                )
                    ? 8192
                    : 4096

        }

    };

}


/* =========================================================
   GEMINI
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
            "[NEYO Gemini] Temp cleanup failed:",
            error?.message
        );

    }

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
                "Gemini could not process this attachment."
            );

        }

    }


    throw new Error(
        "Gemini file processing timed out."
    );

}


/* =========================================================
   SUPABASE → GEMINI FILE
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


    console.log(
        "[NEYO Attachment] Downloading:",
        {
            bucket:
                file.bucket,

            path:
                file.path,

            name:
                file.name
        }
    );


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
            "[NEYO Attachment] Download failed:",
            {
                bucket:
                    file.bucket,

                path:
                    file.path,

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
        file.mime ||
        file.mimeType ||
        storedFile.type ||
        "application/octet-stream";


    /* ---------------------------------------------
       INIT GEMINI UPLOAD
       --------------------------------------------- */

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

        const text =
            await startResponse
                .text()
                .catch(
                    () => ""
                );


        throw new Error(
            text ||
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


    /* ---------------------------------------------
       SEND BYTES
       --------------------------------------------- */

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
   URL CONTEXT
   ========================================================= */

async function fetchUrlText(
    url,
    maxChars = 12000
) {

    try {

        const response =
            await fetch(
                url,
                {
                    redirect:
                        "follow"
                }
            );


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


async function callGeminiUrlContext(
    query,
    urls,
    model,
    isDeepResearch,
    preferences
) {

    const contextParts =
        [];


    for (
        const url
        of urls
    ) {

        const content =
            await fetchUrlText(
                url
            );


        contextParts.push({

            url,
            content

        });

    }


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


    /*
    Compatibility with old table schema.
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
   MAIN
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


    let userId =
        null;


    let reservedType =
        null;


    const geminiFiles =
        [];


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


        /* =================================================
           PREFERENCES
           ================================================= */

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
           ATTACHMENT SOURCE

           Prefer body.attachments.
           Fall back to last message attachments.
           ================================================= */

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


        console.log(
            "[NEYO Chat] Incoming attachment counts:",
            {
                body:
                    bodyAttachments.length,

                lastMessage:
                    messageAttachments.length,

                selected:
                    rawAttachments.length
            }
        );


        const attachments =
            validAttachmentList(
                rawAttachments,
                userId
            );


        /* =================================================
           HISTORY FOR GEMINI
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
                );


        /*
        Ensure last user message exists.
        */

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
                            "Please respond to the user."
                    }
                ]

            });

        }


        /* =================================================
           ATTACHMENT → GEMINI
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
                            geminiFile.mimeType,

                        fileUri:
                            geminiFile.uri

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


            const userText =
                cleanString(
                    lastMsg.content ||
                    ""
                ) ||
                "Please inspect the attached file and explain what it contains.";


            lastGeminiMessage.role =
                "user";


            lastGeminiMessage.parts = [

                {
                    text:
                        userText
                },

                ...attachmentParts

            ];


            console.log(
                "[NEYO Chat] Gemini attachments prepared:",
                attachmentParts.length
            );

        }


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
                    conversation,
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
                                lastMsg.content ||
                                attachments[0]?.name ||
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
                conversation.id;

        }


        /* =================================================
           SAVE USER
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
                conversationId,
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
                        process.env.GEMINI_PRO_MODEL
                    ) ||
                    "gemini-3.5-flash-lite"
                )
                : (
                    cleanEnv(
                        process.env.GEMINI_FREE_MODEL
                    ) ||
                    "gemini-3.1-flash-lite"
                );


        /* =================================================
           RESPONSE
           ================================================= */

        let reply =
            "";


        let sources =
            [];


        let usedUrlContext =
            false;


        const urls =
            extractUrlsFromText(
                userText
            );


        /*
        Attached file takes priority over URL handling.
        */

        if (
            attachments.length ===
                0 &&
            urls.length >
                0
        ) {

            try {

                const urlResponse =
                    await callGeminiUrlContext(
                        userText,
                        urls.slice(
                            0,
                            MAX_URL_CONTEXT_SOURCES
                        ),
                        model,
                        Boolean(
                            body.isDeepResearch
                        ),
                        preferences
                    );


                reply =
                    urlResponse
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


                sources =
                    urls.map(
                        url => ({
                            title:
                                url,
                            url
                        })
                    );


                usedUrlContext =
                    true;

            } catch (
                error
            ) {

                console.warn(
                    "[NEYO URL]",
                    error?.message
                );

            }

        }


        /*
        Normal Gemini call, including attachment requests.
        */

        if (
            !reply
        ) {

            const result =
                await callGemini(
                    geminiMessages,
                    model,
                    Boolean(
                        body.isDeepResearch
                    ),
                    preferences
                );


            reply =
                result
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
                conversationId,
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

                stack:
                    error?.stack
            }
        );


        /* =================================================
           REFUND
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

        /*
        Delete Gemini temporary copies only.
        Supabase originals stay intact.
        */

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
