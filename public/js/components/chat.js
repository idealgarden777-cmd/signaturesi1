/*
=========================================================
NEYO — CHAT CORE
SMOOTH STREAMING v13

FILE:
public/js/components/chat.js

OWNS:
- Conversation state
- Conversation ID
- Conversation session persistence
- /api/chat request
- True SSE streaming
- Smooth visual streaming
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
        "neyo-chat-v13-smooth-streaming";


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

    function debug(
        ...args
    ) {

        if (
            !CONFIG.debug
        ) {
            return;
        }


        console.log(
            "[NEYO Chat]",
            ...args
        );

    }


    function emit(
        name,
        detail = {}
    ) {

        window.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail
                }
            )
        );

    }


    function cleanText(
        value
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
                /\u0000/g,
                ""
            )
            .trim();

    }


    function createId() {

        if (
            globalThis.crypto
                ?.randomUUID
        ) {

            return globalThis.crypto
                .randomUUID();

        }


        return (
            `msg_${Date.now()}_` +
            Math.random()
                .toString(36)
                .slice(2)
        );

    }


    function createAbortError() {

        const error =
            new Error(
                "Request aborted"
            );


        error.name =
            "AbortError";


        return error;

    }


    /* =====================================================
       CONVERSATION SESSION STORAGE
       ===================================================== */

    function readStoredConversationId() {

        try {

            const value =
                sessionStorage.getItem(
                    CONFIG
                        .conversationStorageKey
                );


            return cleanText(
                value
            ) || null;

        } catch {

            return null;

        }

    }


    function saveConversationId(
        id
    ) {

        const value =
            cleanText(
                id
            ) || null;


        try {

            if (
                value
            ) {

                sessionStorage.setItem(
                    CONFIG
                        .conversationStorageKey,
                    value
                );

            } else {

                sessionStorage.removeItem(
                    CONFIG
                        .conversationStorageKey
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
                            attachment
                                .mimeType ||
                            attachment
                                .mime ||
                            attachment
                                .type ||
                            "application/octet-stream"
                        ) ||
                        "application/octet-stream";


                    return {

                        provider:
                            cleanText(
                                attachment
                                    .provider
                            ) ||
                            "supabase",

                        bucket:
                            cleanText(
                                attachment
                                    .bucket
                            ) ||
                            "neyo-attachments",

                        path:
                            cleanText(
                                attachment
                                    .path
                            ),

                        name:
                            cleanText(
                                attachment
                                    .name
                            ) ||
                            "Attached file",

                        mimeType,

                        type:
                            mimeType,

                        category:
                            cleanText(
                                attachment
                                    .category
                            ) ||
                            "unknown",

                        size:
                            Math.max(
                                0,
                                Number(
                                    attachment
                                        .size
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
                        ? message
                            .attachments
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
       ADD MESSAGE
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


    /* =====================================================
       UPDATE MESSAGE
       ===================================================== */

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


    /* =====================================================
       REMOVE MESSAGE
       ===================================================== */

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

                id,

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
                preferences
                    .privateChat
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
                preferences
                    .intelligence,

            language:
                preferences
                    .language,

            personality:
                preferences
                    .personality,

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
       SSE PARSER
       ===================================================== */

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

                if (
                    !block.trim()
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


                const raw =
                    dataLines
                        .join(
                            "\n"
                        )
                        .trim();


                if (
                    !raw
                ) {
                    continue;
                }


                if (
                    raw ===
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
                            raw
                        )
                    );

                } catch {

                    console.warn(
                        "[NEYO Chat] Invalid SSE event ignored."
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


    /* =====================================================
       SEND
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


        const displayUserContent =
            clean ||
            "Please analyze the attached file or files.";


        const requestId =
            ++activeRequestId;


        /* =================================================
           USER MESSAGE
           ================================================= */

        const userMessage =
            addMessage(
                "user",
                displayUserContent,
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
         * Build payload BEFORE assistant message exists.
         *
         * Backend expects the final API message
         * to be the user message.
         */

        const payload =
            buildPayload({

                prompt:
                    apiContent,

                attachments:
                    readyAttachments

            });


        /* =================================================
           ASSISTANT STATE
           ================================================= */

        let assistantId =
            null;


        let assistantMessage =
            null;


        /*
         * receivedContent:
         * Full real content received from backend.
         *
         * displayContent:
         * Portion currently visible on screen.
         */

        let receivedContent =
            "";


        let displayContent =
            "";


        let typingFrame =
            null;


        let typingResolve =
            null;


        let streamFinished =
            false;


        let networkFinished =
            false;


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


        let responseEmitted =
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


        /* =================================================
           ASSISTANT MESSAGE
           ================================================= */

        function ensureAssistantMessage() {

            if (
                assistantMessage
            ) {

                return assistantMessage;

            }


            if (
                !displayContent
            ) {

                return null;

            }


            assistantId =
                createId();


            assistantMessage =
                addMessage(
                    "assistant",
                    displayContent,
                    {

                        id:
                            assistantId

                    }
                );


            return assistantMessage;

        }


        /* =================================================
           SMOOTH STREAMING
           ================================================= */

        function getTypingStep(
            remaining
        ) {

            /*
             * Adaptive visual typing.
             *
             * Small backlog:
             * character-by-character.
             *
             * Large backlog:
             * speed up so renderer stays close
             * to the real network stream.
             */

            if (
                remaining >
                1200
            ) {
                return 24;
            }


            if (
                remaining >
                800
            ) {
                return 18;
            }


            if (
                remaining >
                500
            ) {
                return 13;
            }


            if (
                remaining >
                300
            ) {
                return 9;
            }


            if (
                remaining >
                180
            ) {
                return 6;
            }


            if (
                remaining >
                100
            ) {
                return 4;
            }


            if (
                remaining >
                45
            ) {
                return 3;
            }


            if (
                remaining >
                16
            ) {
                return 2;
            }


            return 1;

        }


        function stopTypingAnimation() {

            if (
                typingFrame !==
                null
            ) {

                cancelAnimationFrame(
                    typingFrame
                );


                typingFrame =
                    null;

            }


            if (
                typingResolve
            ) {

                const resolve =
                    typingResolve;


                typingResolve =
                    null;


                resolve();

            }

        }


        function scheduleSmoothTyping() {

            if (
                typingFrame !==
                null
            ) {
                return;
            }


            const tick =
                () => {

                    typingFrame =
                        null;


                    if (
                        controller.signal
                            .aborted
                    ) {

                        if (
                            typingResolve
                        ) {

                            const resolve =
                                typingResolve;


                            typingResolve =
                                null;


                            resolve();

                        }


                        return;

                    }


                    const remaining =
                        receivedContent.length -
                        displayContent.length;


                    if (
                        remaining <=
                        0
                    ) {

                        if (
                            networkFinished &&
                            typingResolve
                        ) {

                            const resolve =
                                typingResolve;


                            typingResolve =
                                null;


                            resolve();

                        }


                        return;

                    }


                    const step =
                        getTypingStep(
                            remaining
                        );


                    const nextLength =
                        Math.min(
                            receivedContent.length,
                            displayContent.length +
                                step
                        );


                    displayContent =
                        receivedContent.slice(
                            0,
                            nextLength
                        );


                    ensureAssistantMessage();


                    if (
                        assistantId
                    ) {

                        updateMessageContent(
                            assistantId,
                            displayContent
                        );

                    }


                    const stillRemaining =
                        receivedContent.length -
                        displayContent.length;


                    if (
                        stillRemaining >
                        0
                    ) {

                        typingFrame =
                            requestAnimationFrame(
                                tick
                            );

                        return;

                    }


                    if (
                        networkFinished &&
                        typingResolve
                    ) {

                        const resolve =
                            typingResolve;


                        typingResolve =
                            null;


                        resolve();

                    }

                };


            typingFrame =
                requestAnimationFrame(
                    tick
                );

        }


        function finishSmoothTyping() {

            networkFinished =
                true;


            if (
                displayContent.length >=
                receivedContent.length
            ) {

                displayContent =
                    receivedContent;


                if (
                    displayContent
                ) {

                    ensureAssistantMessage();


                    if (
                        assistantId
                    ) {

                        updateMessageContent(
                            assistantId,
                            displayContent
                        );

                    }

                }


                return Promise.resolve();

            }


            return new Promise(
                resolve => {

                    typingResolve =
                        resolve;


                    scheduleSmoothTyping();

                }
            );

        }


        /* =================================================
           METADATA
           ================================================= */

        function applyMetadata(
            event
        ) {

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

        }


        /* =================================================
           PROCESS STREAM EVENT
           ================================================= */

        function processStreamEvent(
            event
        ) {

            if (
                !event ||
                typeof event !==
                    "object"
            ) {
                return false;
            }


            applyMetadata(
                event
            );


            /*
             * Extra protection.
             *
             * Backend should already exclude
             * thought/reasoning parts.
             */

            if (
                event.thought ===
                true
            ) {

                return false;

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

                /*
                 * NETWORK SIDE:
                 *
                 * Store real response immediately.
                 */

                receivedContent +=
                    delta;


                /*
                 * UI SIDE:
                 *
                 * Paint progressively.
                 */

                scheduleSmoothTyping();

            }


            const done =
                event.done ===
                    true ||
                event.type ===
                    "done" ||
                event.type ===
                    "end";


            if (
                done
            ) {

                streamFinished =
                    true;

            }


            return done;

        }


        /* =================================================
           FINAL RESPONSE
           ================================================= */

        function finalizeResponse() {

            if (
                responseEmitted
            ) {

                return null;

            }


            if (
                !receivedContent
            ) {

                throw new Error(
                    "Empty response from AI."
                );

            }


            /*
             * At this point smooth renderer must
             * have fully caught up.
             */

            displayContent =
                receivedContent;


            ensureAssistantMessage();


            if (
                assistantId
            ) {

                updateMessageContent(
                    assistantId,
                    displayContent
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


            assistantMessage =
                assistantId
                    ? conversation.find(
                        message =>
                            message.id ===
                            assistantId
                    ) ||
                    assistantMessage
                    : null;


            if (
                assistantMessage
            ) {

                assistantMessage.content =
                    receivedContent;


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
                            receivedContent,

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
                    receivedContent,

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


            return result;

        }


        /* =================================================
           NETWORK
           ================================================= */

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
                "REQUEST (smooth streaming)",
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


            /* =================================================
               RATE LIMIT
               ================================================= */

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


                emit(
                    "neyo:chat-limit-reached",
                    {

                        requestId,

                        data

                    }
                );


                return null;

            }


            /* =================================================
               HTTP ERROR
               ================================================= */

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


            /* =================================================
               STREAM READER
               ================================================= */

            const reader =
                response.body
                    .getReader();


            const decoder =
                new TextDecoder();


            const parser =
                createSSEParser();


            while (
                !streamFinished
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


                if (
                    controller.signal
                        .aborted
                ) {

                    throw createAbortError();

                }


                const chunk =
                    decoder.decode(
                        value,
                        {
                            stream:
                                true
                        }
                    );


                const events =
                    parser.push(
                        chunk
                    );


                for (
                    const event
                    of events
                ) {

                    if (
                        controller.signal
                            .aborted
                    ) {

                        throw createAbortError();

                    }


                    if (
                        processStreamEvent(
                            event
                        )
                    ) {

                        break;

                    }

                }

            }


            /* =================================================
               DECODER TAIL
               ================================================= */

            const decoderTail =
                decoder.decode();


            if (
                decoderTail
            ) {

                const tailEvents =
                    parser.push(
                        decoderTail
                    );


                for (
                    const event
                    of tailEvents
                ) {

                    processStreamEvent(
                        event
                    );

                }

            }


            /* =================================================
               SSE BUFFER TAIL
               ================================================= */

            const remainingEvents =
                parser.flush();


            for (
                const event
                of remainingEvents
            ) {

                processStreamEvent(
                    event
                );

            }


            try {

                await reader.cancel();

            } catch {}


            /* =================================================
               WAIT FOR VISUAL STREAM
               ================================================= */

            await finishSmoothTyping();


            const result =
                finalizeResponse();


            return result;


        } catch (
            error
        ) {

            /* =================================================
               STOP SMOOTH ANIMATION
               ================================================= */

            stopTypingAnimation();


            /* =================================================
               ABORT
               ================================================= */

            if (
                error?.name ===
                    "AbortError" ||
                controller.signal
                    .aborted
            ) {

                /*
                 * Freeze output exactly where user
                 * stopped generation.
                 */

                receivedContent =
                    displayContent;


                emit(
                    "neyo:chat-aborted",
                    {

                        requestId,

                        conversationId:
                            currentConversationId

                    }
                );


                if (
                    displayContent &&
                    assistantId
                ) {

                    updateMessageContent(
                        assistantId,
                        displayContent
                    );

                }


                return null;

            }


            /* =================================================
               ERROR
               ================================================= */

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


            const errorText =
                `⚠️ ${userFacingError}`;


            if (
                !assistantMessage
            ) {

                assistantId =
                    createId();


                assistantMessage =
                    addMessage(
                        "assistant",
                        errorText,
                        {

                            id:
                                assistantId,

                            error:
                                true

                        }
                    );

            } else {

                updateMessageContent(
                    assistantId,
                    errorText
                );


                assistantMessage =
                    conversation.find(
                        message =>
                            message.id ===
                            assistantId
                    ) ||
                    assistantMessage;


                if (
                    assistantMessage
                ) {

                    assistantMessage.error =
                        true;


                    emit(
                        "neyo:chat-message-updated",
                        {

                            id:
                                assistantId,

                            content:
                                assistantMessage
                                    .content,

                            message: {
                                ...assistantMessage
                            },

                            conversation:
                                getConversation()

                        }
                    );

                }

            }


            emit(
                "neyo:chat-error",
                {

                    requestId,

                    error,

                    message:
                        assistantMessage

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
       SEND EVENT
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


    /* =====================================================
       STOP EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:chat-stop-request",
        () => {

            stop();

        }
    );


    /* =====================================================
       NEW CHAT EVENTS
       ===================================================== */

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


    /* =====================================================
       HISTORY LOAD
       ===================================================== */

    function handleConversationLoad(
        event
    ) {

        const detail =
            event.detail ||
            {};


        loadConversation({

            conversationId:
                detail
                    .conversationId ||
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


    /* =====================================================
       PREFERENCES EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:chat-preferences-set",
        event => {

            setPreferences(
                event.detail ||
                {}
            );

        }
    );


    /* =====================================================
       STATE REQUEST
       ===================================================== */

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
        "READY (smooth streaming)",
        {

            version:
                VERSION,

            conversationId:
                currentConversationId,

            storedConversationId:
                readStoredConversationId(),

            streaming:
                true,

            smoothStreaming:
                true,

            lazyAssistantMessage:
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
                true,

            smoothStreaming:
                true

        }
    );

})();
