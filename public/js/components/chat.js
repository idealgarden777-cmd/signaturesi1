/*
=========================================================
NEYO — CHAT CORE (STREAMING)

FILE:
public/js/components/chat.js

OWNS:
- Conversation state
- Conversation ID
- Conversation session persistence
- /api/chat request (streaming)
- Request lifecycle
- Stop / Abort
- Duplicate send protection
- History conversation loading
- Attachment metadata
- Preferences
- Error handling
- History refresh events

DOES NOT OWN:
- Message DOM
- Markdown rendering
- Send button
- Composer
- Attachment uploading
- Sidebar rendering
=========================================================
*/

(() => {
    "use strict";

    /* =====================================================
       VERSION
       ===================================================== */

    const VERSION =
        "neyo-chat-v11-streaming-final";

    if (
        window.NeyoChat
            ?.__controller === true
    ) {
        console.warn(
            "[NEYO Chat] Already initialized."
        );
        return;
    }

    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG =
        Object.freeze({
            endpoint:
                "/api/chat",
            maxHistoryMessages:
                50,
            maxAttachments:
                5,
            requestTimeoutMs:
                180000,
            conversationStorageKey:
                "neyo_current_conversation_id",
            debug:
                true
        });

    /* =====================================================
       HELPERS
       ===================================================== */

    function debug(...args) {
        if (!CONFIG.debug) return;
        console.log("[NEYO Chat]", ...args);
    }

    function emit(name, detail = {}) {
        window.dispatchEvent(
            new CustomEvent(name, { detail })
        );
    }

    function cleanText(value) {
        if (typeof value !== "string") return "";

        return value
            .replace(/\r\n?/g, "\n")
            .replace(/\u0000/g, "")
            .trim();
    }

    function createId() {
        if (globalThis.crypto?.randomUUID) {
            return globalThis.crypto.randomUUID();
        }

        return (
            `msg_${Date.now()}_` +
            Math.random()
                .toString(36)
                .slice(2)
        );
    }

    /* =====================================================
       CONVERSATION SESSION STORAGE
       ===================================================== */

    function readStoredConversationId() {
        try {
            const value =
                sessionStorage.getItem(
                    CONFIG.conversationStorageKey
                );

            return cleanText(value) || null;

        } catch {
            return null;
        }
    }

    function saveConversationId(id) {
        const value =
            cleanText(id) || null;

        try {
            if (value) {
                sessionStorage.setItem(
                    CONFIG.conversationStorageKey,
                    value
                );

            } else {
                sessionStorage.removeItem(
                    CONFIG.conversationStorageKey
                );
            }

        } catch {
            // Storage unavailable.
        }

        return value;
    }

    /* =====================================================
       STATE
       ===================================================== */

    let conversation =
        [];

    let currentConversationId =
        readStoredConversationId();

    let generating =
        false;

    let activeController =
        null;

    let activeRequestId =
        0;

    let preferences = {
        intelligence:
            "standard",
        language:
            "auto",
        personality:
            "neyo",
        privateChat:
            false,
        isDeepResearch:
            false
    };

    /* =====================================================
       ATTACHMENTS
       ===================================================== */

    function normalizeAttachments(
        attachments
    ) {
        if (
            !Array.isArray(
                attachments
            )
        ) {
            return [];
        }

        return attachments
            .filter(
                attachment =>
                    attachment &&
                    typeof attachment ===
                        "object"
            )
            .slice(
                0,
                CONFIG.maxAttachments
            )
            .map(
                attachment => {
                    const mimeType =
                        cleanText(
                            attachment.mimeType ||
                            attachment.mime ||
                            attachment.type ||
                            "application/octet-stream"
                        ) ||
                        "application/octet-stream";

                    return {
                        provider:
                            cleanText(
                                attachment.provider
                            ) ||
                            "supabase",

                        bucket:
                            cleanText(
                                attachment.bucket
                            ) ||
                            "neyo-attachments",

                        path:
                            cleanText(
                                attachment.path
                            ),

                        name:
                            cleanText(
                                attachment.name
                            ) ||
                            "Attached file",

                        mimeType,

                        type:
                            mimeType,

                        category:
                            cleanText(
                                attachment.category
                            ) ||
                            "unknown",

                        size:
                            Math.max(
                                0,
                                Number(
                                    attachment.size
                                ) || 0
                            )
                    };
                }
            )
            .filter(
                attachment =>
                    Boolean(
                        attachment.path
                    )
            );
    }

    /* =====================================================
       MESSAGE NORMALIZATION
       ===================================================== */

    function normalizeMessage(
        message
    ) {
        if (
            !message ||
            typeof message !==
                "object"
        ) {
            return null;
        }

        if (
            message.role !==
                "user" &&
            message.role !==
                "assistant"
        ) {
            return null;
        }

        const normalized = {
            id:
                cleanText(
                    message.id
                ) ||
                createId(),

            role:
                message.role,

            content:
                cleanText(
                    message.content
                )
        };

        const attachments =
            normalizeAttachments(
                message.attachments
            );

        if (
            attachments.length >
            0
        ) {
            normalized.attachments =
                attachments;
        }

        if (
            Array.isArray(
                message.sources
            ) &&
            message.sources.length >
            0
        ) {
            normalized.sources =
                [
                    ...message.sources
                ];
        }

        if (
            message.error ===
            true
        ) {
            normalized.error =
                true;
        }

        return normalized;
    }

    /* =====================================================
       API MESSAGE
       ===================================================== */

    function toApiMessage(
        message
    ) {
        const result = {
            role:
                message.role,

            content:
                cleanText(
                    message.content
                )
        };

        if (
            Array.isArray(
                message.attachments
            ) &&
            message.attachments.length >
            0
        ) {
            result.attachments =
                normalizeAttachments(
                    message.attachments
                );
        }

        return result;
    }

    /* =====================================================
       CONVERSATION STATE
       ===================================================== */

    function boundConversation() {
        if (
            conversation.length <=
            CONFIG.maxHistoryMessages
        ) {
            return;
        }

        conversation =
            conversation.slice(
                -CONFIG.maxHistoryMessages
            );
    }

    function getConversation() {
        return conversation.map(
            message => ({
                ...message,

                attachments:
                    Array.isArray(
                        message.attachments
                    )
                        ? message.attachments
                            .map(
                                attachment => ({
                                    ...attachment
                                })
                            )
                        : undefined,

                sources:
                    Array.isArray(
                        message.sources
                    )
                        ? [
                            ...message.sources
                        ]
                        : undefined
            })
        );
    }

    /* =====================================================
       ADD / UPDATE / REMOVE MESSAGE
       ===================================================== */

    function addMessage(
        role,
        content,
        options = {}
    ) {
        const message =
            normalizeMessage({
                id:
                    options.id ||
                    createId(),

                role,

                content,

                attachments:
                    options.attachments,

                sources:
                    options.sources,

                error:
                    options.error
            });

        if (
            !message
        ) {
            return null;
        }

        conversation.push(
            message
        );

        boundConversation();

        emit(
            "neyo:chat-message-added",
            {
                message: {
                    ...message
                },

                conversation:
                    getConversation()
            }
        );

        return message;
    }

    function updateMessageContent(
        id,
        newContent
    ) {
        const message =
            conversation.find(
                item =>
                    item.id ===
                    id
            );

        if (
            !message
        ) {
            return false;
        }

        message.content =
            typeof newContent ===
                "string"
                ? newContent
                : "";

        emit(
            "neyo:chat-message-updated",
            {
                id:
                    message.id,

                content:
                    message.content,

                message: {
                    ...message
                },

                conversation:
                    getConversation()
            }
        );

        return true;
    }

    function removeMessage(
        id
    ) {
        const index =
            conversation.findIndex(
                message =>
                    message.id ===
                    id
            );

        if (
            index ===
            -1
        ) {
            return false;
        }

        const [
            removed
        ] =
            conversation.splice(
                index,
                1
            );

        emit(
            "neyo:chat-message-removed",
            {
                message:
                    removed,

                conversation:
                    getConversation()
            }
        );

        return true;
    }

    /* =====================================================
       MODEL
       ===================================================== */

    function getSelectedModel() {
        try {
            return (
                window
                    .NeyoModelMenu
                    ?.getSelected
                    ?.() ||
                "l1.0"
            );

        } catch {
            return "l1.0";
        }
    }

    /* =====================================================
       TITLE
       ===================================================== */

    function createTitle(
        text,
        attachments
    ) {
        const clean =
            cleanText(
                text
            );

        if (
            clean
        ) {
            return clean
                .replace(
                    /\s+/g,
                    " "
                )
                .slice(
                    0,
                    80
                );
        }

        if (
            Array.isArray(
                attachments
            ) &&
            attachments.length >
            0
        ) {
            return String(
                attachments[0]
                    ?.name ||
                "New conversation"
            )
                .slice(
                    0,
                    80
                );
        }

        return "New conversation";
    }

    /* =====================================================
       BUILD PAYLOAD
       ===================================================== */

    function buildPayload({
        prompt,
        attachments
    }) {
        const privateChat =
            Boolean(
                preferences.privateChat
            );

        return {
            messages:
                conversation
                    .slice(
                        -CONFIG
                            .maxHistoryMessages
                    )
                    .map(
                        toApiMessage
                    ),

            attachments:
                normalizeAttachments(
                    attachments
                ),

            conversationId:
                privateChat
                    ? null
                    : currentConversationId,

            model:
                getSelectedModel(),

            intelligence:
                preferences.intelligence,

            language:
                preferences.language,

            personality:
                preferences.personality,

            privateChat,

            isDeepResearch:
                Boolean(
                    preferences
                        .isDeepResearch
                ),

            title:
                createTitle(
                    prompt,
                    attachments
                ),

            stream:
                true
        };
    }

    /* =====================================================
       SSE PARSER HELPER
       ===================================================== */

    function parseSSEChunk(
        chunk,
        buffer = ""
    ) {
        const combined =
            `${buffer}${chunk}`
                .replace(
                    /\r\n/g,
                    "\n"
                )
                .replace(
                    /\r/g,
                    "\n"
                );

        const blocks =
            combined.split(
                "\n\n"
            );

        const remainder =
            blocks.pop() ||
            "";

        const events =
            [];

        for (
            const block
            of blocks
        ) {
            if (
                !block
            ) {
                continue;
            }

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

            const data =
                dataLines
                    .join(
                        "\n"
                    )
                    .trim();

            if (
                !data
            ) {
                continue;
            }

            if (
                data ===
                "[DONE]"
            ) {
                events.push({
                    type:
                        "done",

                    done:
                        true
                });

                continue;
            }

            try {
                events.push(
                    JSON.parse(
                        data
                    )
                );

            } catch {
                // Ignore malformed SSE data blocks.
            }
        }

        return {
            events,

            buffer:
                remainder
        };
    }

    /* =====================================================
       SEND (STREAMING)
       ===================================================== */

    async function send({
        text = "",
        attachments = []
    } = {}) {
        if (
            generating
        ) {
            emit(
                "neyo:chat-busy"
            );

            return null;
        }

        const clean =
            cleanText(
                text
            );

        const readyAttachments =
            normalizeAttachments(
                attachments
            );

        if (
            !clean &&
            readyAttachments.length ===
                0
        ) {
            return null;
        }

        const apiContent =
            clean ||
            "Please analyze the attached file or files.";

        const displayContent =
            clean ||
            "Please analyze the attached file or files.";

        const requestId =
            ++activeRequestId;

        /* -------------------------------------------------
           USER MESSAGE
           ------------------------------------------------- */

        const userMessage =
            addMessage(
                "user",
                displayContent,
                {
                    attachments:
                        readyAttachments
                }
            );

        if (
            !userMessage
        ) {
            return null;
        }

        /*
         * IMPORTANT:
         *
         * Build payload BEFORE assistant placeholder.
         * Backend requires the final API message
         * to remain a user message.
         */

        const payload =
            buildPayload({
                prompt:
                    apiContent,

                attachments:
                    readyAttachments
            });

        /* -------------------------------------------------
           ASSISTANT PLACEHOLDER
           ------------------------------------------------- */

        const assistantId =
            createId();

        const assistantPlaceholder =
            addMessage(
                "assistant",
                "…",
                {
                    id:
                        assistantId
                }
            );

        if (
            !assistantPlaceholder
        ) {
            removeMessage(
                userMessage.id
            );

            return null;
        }

        generating =
            true;

        const controller =
            new AbortController();

        activeController =
            controller;

        emit(
            "neyo:chat-send-start",
            {
                requestId,

                text:
                    clean,

                attachments:
                    readyAttachments,

                conversationId:
                    currentConversationId
            }
        );

        let timeout =
            null;

        let accumulatedContent =
            "";

        let responseEmitted =
            false;

        let streamEnded =
            false;

        let finalSources =
            [];

        let newConversationId =
            currentConversationId;

        let privateChatFlag =
            Boolean(
                preferences.privateChat
            );

        let usedUrlContext =
            false;

        let creditType =
            null;

        const applyMetadata =
            event => {
                if (
                    !event ||
                    typeof event !==
                        "object"
                ) {
                    return;
                }

                if (
                    typeof event
                        .conversationId ===
                        "string" &&
                    event.conversationId
                        .trim()
                ) {
                    newConversationId =
                        event
                            .conversationId
                            .trim();
                }

                if (
                    Array.isArray(
                        event.sources
                    )
                ) {
                    finalSources =
                        event.sources;
                }

                if (
                    event.privateChat !==
                    undefined
                ) {
                    privateChatFlag =
                        Boolean(
                            event.privateChat
                        );
                }

                if (
                    event.usedUrlContext !==
                    undefined
                ) {
                    usedUrlContext =
                        Boolean(
                            event.usedUrlContext
                        );
                }

                if (
                    event.creditType !==
                        undefined &&
                    event.creditType !==
                        null
                ) {
                    creditType =
                        event.creditType;
                }
            };

        const finalizeResponse =
            () => {
                if (
                    responseEmitted
                ) {
                    return;
                }

                if (
                    !accumulatedContent
                ) {
                    throw new Error(
                        "Empty response from AI."
                    );
                }

                if (
                    !preferences.privateChat &&
                    newConversationId
                ) {
                    currentConversationId =
                        saveConversationId(
                            newConversationId
                        );

                    debug(
                        "CONVERSATION_ID_SAVED",
                        currentConversationId
                    );
                }

                const assistantMessage =
                    conversation.find(
                        message =>
                            message.id ===
                            assistantId
                    ) ||
                    null;

                if (
                    assistantMessage
                ) {
                    assistantMessage.content =
                        accumulatedContent;

                    if (
                        finalSources.length >
                        0
                    ) {
                        assistantMessage.sources =
                            finalSources;
                    }

                    emit(
                        "neyo:chat-message-updated",
                        {
                            id:
                                assistantId,

                            content:
                                accumulatedContent,

                            sources:
                                finalSources,

                            message: {
                                ...assistantMessage
                            },

                            conversation:
                                getConversation()
                        }
                    );
                }

                const result = {
                    requestId,

                    reply:
                        accumulatedContent,

                    sources:
                        finalSources,

                    message:
                        assistantMessage,

                    conversationId:
                        currentConversationId,

                    privateChat:
                        privateChatFlag,

                    usedUrlContext,

                    creditType
                };

                emit(
                    "neyo:chat-response",
                    result
                );

                responseEmitted =
                    true;

                if (
                    !preferences.privateChat
                ) {
                    emit(
                        "neyo:history-load-request",
                        {
                            conversationId:
                                currentConversationId
                        }
                    );
                }
            };

        try {
            timeout =
                window.setTimeout(
                    () => {
                        try {
                            controller.abort();
                        } catch {}
                    },
                    CONFIG
                        .requestTimeoutMs
                );

            debug(
                "REQUEST (streaming)",
                {
                    requestId,

                    conversationId:
                        payload
                            .conversationId,

                    messages:
                        payload
                            .messages
                            .length,

                    attachments:
                        payload
                            .attachments
                            .length
                }
            );

            const response =
                await fetch(
                    CONFIG.endpoint,
                    {
                        method:
                            "POST",

                        credentials:
                            "include",

                        cache:
                            "no-store",

                        headers: {
                            "Content-Type":
                                "application/json",

                            Accept:
                                "text/event-stream",

                            "X-Neyo-Chat-Client":
                                VERSION
                        },

                        body:
                            JSON.stringify(
                                payload
                            ),

                        signal:
                            controller.signal
                    }
                );

            /* ---------------------------------------------
               LIMIT
               --------------------------------------------- */

            if (
                response.status ===
                429
            ) {
                const data =
                    await response
                        .json()
                        .catch(
                            () => ({})
                        );

                removeMessage(
                    assistantId
                );

                emit(
                    "neyo:chat-limit-reached",
                    {
                        requestId,

                        data
                    }
                );

                return null;
            }

            /* ---------------------------------------------
               HTTP ERROR
               --------------------------------------------- */

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

                if (
                    raw
                ) {
                    try {
                        data =
                            JSON.parse(
                                raw
                            );

                    } catch {}
                }

                const message =
                    cleanText(
                        data?.message ||
                        data?.error ||
                        raw
                    ) ||
                    `Request failed (${response.status}).`;

                const error =
                    new Error(
                        message
                    );

                error.status =
                    response.status;

                error.data =
                    data;

                throw error;
            }

            if (
                !response.body ||
                typeof response.body
                    .getReader !==
                    "function"
            ) {
                throw new Error(
                    "Streaming response is unavailable."
                );
            }

            /* ---------------------------------------------
               STREAM
               --------------------------------------------- */

            const reader =
                response.body
                    .getReader();

            const decoder =
                new TextDecoder();

            let buffer =
                "";

            while (
                !streamEnded
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

                const parsed =
                    parseSSEChunk(
                        chunk,
                        buffer
                    );

                buffer =
                    parsed.buffer;

                for (
                    const event
                    of parsed.events
                ) {
                    if (
                        controller.signal
                            .aborted
                    ) {
                        try {
                            await reader
                                .cancel();
                        } catch {}

                        const abortError =
                            new Error(
                                "Request aborted"
                            );

                        abortError.name =
                            "AbortError";

                        throw abortError;
                    }

                    applyMetadata(
                        event
                    );

                    /*
                     * Extra client-side protection.
                     * Backend should already strip thought parts.
                     */

                    if (
                        event.thought ===
                        true
                    ) {
                        continue;
                    }

                    const delta =
                        typeof event.delta ===
                            "string"
                            ? event.delta
                            : typeof event.content ===
                                "string"
                                ? event.content
                                : "";

                    if (
                        delta
                    ) {
                        accumulatedContent +=
                            delta;

                        updateMessageContent(
                            assistantId,
                            accumulatedContent
                        );
                    }

                    if (
                        event.done ===
                            true ||
                        event.type ===
                            "done" ||
                        event.type ===
                            "end"
                    ) {
                        streamEnded =
                            true;

                        break;
                    }
                }
            }

            /*
             * Flush decoder and final incomplete SSE block.
             */

            if (
                !streamEnded
            ) {
                const tail =
                    decoder.decode();

                const parsedTail =
                    parseSSEChunk(
                        `${tail}\n\n`,
                        buffer
                    );

                for (
                    const event
                    of parsedTail.events
                ) {
                    applyMetadata(
                        event
                    );

                    if (
                        event.thought ===
                        true
                    ) {
                        continue;
                    }

                    const delta =
                        typeof event.delta ===
                            "string"
                            ? event.delta
                            : typeof event.content ===
                                "string"
                                ? event.content
                                : "";

                    if (
                        delta
                    ) {
                        accumulatedContent +=
                            delta;

                        updateMessageContent(
                            assistantId,
                            accumulatedContent
                        );
                    }
                }
            }

            try {
                await reader.cancel();
            } catch {}

            finalizeResponse();

            return {
                requestId,

                reply:
                    accumulatedContent,

                sources:
                    finalSources,

                message:
                    conversation.find(
                        message =>
                            message.id ===
                            assistantId
                    ) ||
                    null,

                conversationId:
                    currentConversationId,

                privateChat:
                    privateChatFlag,

                usedUrlContext,

                creditType
            };

        } catch (
            error
        ) {
            if (
                error?.name ===
                    "AbortError" ||
                controller.signal
                    .aborted
            ) {
                emit(
                    "neyo:chat-aborted",
                    {
                        requestId,

                        conversationId:
                            currentConversationId
                    }
                );

                /*
                 * Preserve partial visible answer.
                 * If nothing arrived, remove placeholder.
                 */

                if (
                    accumulatedContent
                ) {
                    updateMessageContent(
                        assistantId,
                        accumulatedContent
                    );

                } else {
                    removeMessage(
                        assistantId
                    );
                }

                return null;
            }

            console.error(
                "[NEYO Chat] Request failed:",
                error
            );

            let userFacingError =
                "Something went wrong. Please try again.";

            if (
                error?.status ===
                401
            ) {
                userFacingError =
                    "Your session has expired. Please sign in again.";

            } else if (
                error?.status ===
                413
            ) {
                userFacingError =
                    "This request is too large.";

            } else if (
                error?.status >=
                500
            ) {
                userFacingError =
                    "NEYO is temporarily unavailable. Please try again.";

            } else if (
                error?.message
            ) {
                userFacingError =
                    error.message;
            }

            updateMessageContent(
                assistantId,
                `⚠️ ${userFacingError}`
            );

            const errorMessage =
                conversation.find(
                    message =>
                        message.id ===
                        assistantId
                ) ||
                null;

            if (
                errorMessage
            ) {
                errorMessage.error =
                    true;

                emit(
                    "neyo:chat-message-updated",
                    {
                        id:
                            assistantId,

                        content:
                            errorMessage.content,

                        message: {
                            ...errorMessage
                        },

                        conversation:
                            getConversation()
                    }
                );
            }

            emit(
                "neyo:chat-error",
                {
                    requestId,

                    error,

                    message:
                        errorMessage
                }
            );

            return null;

        } finally {
            if (
                timeout !==
                null
            ) {
                window.clearTimeout(
                    timeout
                );
            }

            if (
                requestId ===
                activeRequestId
            ) {
                generating =
                    false;

                activeController =
                    null;

                emit(
                    "neyo:chat-send-end",
                    {
                        requestId,

                        conversationId:
                            currentConversationId
                    }
                );
            }
        }
    }

    /* =====================================================
       STOP
       ===================================================== */

    function stop() {
        if (
            !activeController
        ) {
            return false;
        }

        try {
            activeController.abort();

            return true;

        } catch {
            return false;
        }
    }

    /* =====================================================
       NEW CONVERSATION
       ===================================================== */

    function newConversation() {
        activeRequestId +=
            1;

        stop();

        activeController =
            null;

        generating =
            false;

        conversation =
            [];

        currentConversationId =
            null;

        saveConversationId(
            null
        );

        emit(
            "neyo:messages-clear"
        );

        emit(
            "neyo:chat-new",
            {
                conversation:
                    [],

                conversationId:
                    null
            }
        );

        emit(
            "neyo:chat-send-end",
            {
                conversationId:
                    null
            }
        );

        return true;
    }

    /* =====================================================
       LOAD CONVERSATION FROM HISTORY
       ===================================================== */

    function loadConversation({
        conversationId,
        messages = []
    } = {}) {
        activeRequestId +=
            1;

        stop();

        activeController =
            null;

        generating =
            false;

        currentConversationId =
            cleanText(
                conversationId
            ) ||
            null;

        saveConversationId(
            currentConversationId
        );

        conversation =
            Array.isArray(
                messages
            )
                ? messages
                    .map(
                        normalizeMessage
                    )
                    .filter(
                        Boolean
                    )
                    .slice(
                        -CONFIG
                            .maxHistoryMessages
                    )
                : [];

        emit(
            "neyo:messages-clear"
        );

        conversation.forEach(
            message => {
                emit(
                    "neyo:chat-message-added",
                    {
                        message: {
                            ...message
                        },

                        conversation:
                            getConversation(),

                        historyLoad:
                            true
                    }
                );
            }
        );

        emit(
            "neyo:chat-state-loaded",
            {
                conversationId:
                    currentConversationId,

                messages:
                    getConversation()
            }
        );

        emit(
            "neyo:chat-send-end",
            {
                conversationId:
                    currentConversationId
            }
        );

        return true;
    }

    /* =====================================================
       SET CONVERSATION ID
       ===================================================== */

    function setConversationId(
        id
    ) {
        currentConversationId =
            cleanText(
                id
            ) ||
            null;

        saveConversationId(
            currentConversationId
        );

        return true;
    }

    /* =====================================================
       PREFERENCES
       ===================================================== */

    function setPreferences(
        values
    ) {
        if (
            !values ||
            typeof values !==
                "object"
        ) {
            return false;
        }

        preferences = {
            ...preferences,
            ...values
        };

        if (
            preferences.privateChat
        ) {
            currentConversationId =
                null;

            saveConversationId(
                null
            );
        }

        emit(
            "neyo:chat-preferences-change",
            {
                preferences: {
                    ...preferences
                }
            }
        );

        return true;
    }

    /* =====================================================
       EVENT LISTENERS
       ===================================================== */

    window.addEventListener(
        "neyo:chat-send-request",
        event => {
            const detail =
                event.detail ||
                {};

            void send({
                text:
                    detail.text ||
                    "",

                attachments:
                    detail.attachments ||
                    []
            });
        }
    );

    window.addEventListener(
        "neyo:chat-stop-request",
        () => {
            stop();
        }
    );

    window.addEventListener(
        "neyo:chat-new-request",
        () => {
            newConversation();
        }
    );

    window.addEventListener(
        "neyo:new-chat-start",
        () => {
            if (
                currentConversationId
            ) {
                currentConversationId =
                    null;

                saveConversationId(
                    null
                );
            }
        }
    );

    function handleConversationLoad(
        event
    ) {
        const detail =
            event.detail ||
            {};

        loadConversation({
            conversationId:
                detail.conversationId ||
                detail.id ||
                null,

            messages:
                detail.messages ||
                detail.conversation ||
                []
        });
    }

    window.addEventListener(
        "neyo:conversation-loaded",
        handleConversationLoad
    );

    window.addEventListener(
        "neyo:history-conversation-loaded",
        handleConversationLoad
    );

    window.addEventListener(
        "neyo:chat-preferences-set",
        event => {
            setPreferences(
                event.detail ||
                {}
            );
        }
    );

    window.addEventListener(
        "neyo:chat-state-sync-request",
        () => {
            emit(
                "neyo:chat-state",
                {
                    conversationId:
                        currentConversationId,

                    messages:
                        getConversation(),

                    generating,

                    preferences: {
                        ...preferences
                    }
                }
            );
        }
    );

    /* =====================================================
       PUBLIC API
       ===================================================== */

    const publicApi =
        Object.freeze({
            __controller:
                true,

            version:
                VERSION,

            send,

            stop,

            newConversation,

            loadConversation,

            addMessage,

            updateMessageContent,

            removeMessage,

            setPreferences,

            getConversation,

            getConversationId:
                () =>
                    currentConversationId,

            setConversationId,

            getPreferences:
                () => ({
                    ...preferences
                }),

            isGenerating:
                () =>
                    generating,

            getState:
                () => ({
                    version:
                        VERSION,

                    generating,

                    conversationId:
                        currentConversationId,

                    storedConversationId:
                        readStoredConversationId(),

                    messageCount:
                        conversation.length,

                    requestId:
                        activeRequestId,

                    preferences: {
                        ...preferences
                    }
                })
        });

    Object.defineProperty(
        window,
        "NeyoChat",
        {
            value:
                publicApi,

            writable:
                false,

            configurable:
                true,

            enumerable:
                true
        }
    );

    /* =====================================================
       READY
       ===================================================== */

    debug(
        "READY (streaming)",
        {
            version:
                VERSION,

            conversationId:
                currentConversationId,

            storedConversationId:
                readStoredConversationId(),

            streaming:
                true
        }
    );

    emit(
        "neyo:chat-ready",
        {
            version:
                VERSION,

            conversationId:
                currentConversationId,

            streaming:
                true
        }
    );

})();
