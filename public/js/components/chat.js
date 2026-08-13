/*
=========================================================
NEYO — CHAT CORE COMPONENT

Owns:
- Conversation state
- /api/chat requests
- Send/generation state
- Conversation ID
- API payload
- Reply parsing
- Credit-limit handling
- Chat lifecycle events

Does NOT own:
- File upload
- Message DOM rendering
- Markdown rendering
- History rendering
- Upgrade/ad modal UI
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const CHAT_ENDPOINT =
        "/api/chat";

    const MAX_HISTORY_MESSAGES =
        50;


    /* =====================================================
       STATE
       ===================================================== */

    let conversation = [];

    let currentConversationId =
        null;

    let isGenerating =
        false;

    let abortController =
        null;


    /* =====================================================
       PREFERENCES
       ===================================================== */

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
       HELPERS
       ===================================================== */

    const emit = (
        name,
        detail = {}
    ) => {

        window.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail
                }
            )
        );

    };


    const cleanText =
        value => {

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
                .trim();

        };


    const readJsonResponse =
        async response => {

            const data =
                await response
                    .json()
                    .catch(
                        () => ({})
                    );


            if (!response.ok) {

                const error =
                    new Error(
                        data?.error ||
                        `Request failed (${response.status})`
                    );


                error.status =
                    response.status;


                error.data =
                    data;


                throw error;

            }


            return data;

        };


    /* =====================================================
       MODEL
       ===================================================== */

    const getSelectedModel = () => {

        return (
            window.NeyoModelMenu
                ?.getSelected?.() ||
            "l1.0"
        );

    };


    /* =====================================================
       TITLE
       ===================================================== */

    const makeConversationTitle =
        (
            text,
            attachments = []
        ) => {

            const clean =
                cleanText(text);


            if (clean) {

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
                attachments.length
            ) {

                return (
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

        };


    /* =====================================================
       NORMALIZE ATTACHMENTS
       ===================================================== */

    const normalizeAttachments =
        attachments => {

            if (
                !Array.isArray(
                    attachments
                )
            ) {
                return [];
            }


            return attachments
                .slice(
                    0,
                    5
                )
                .map(
                    file => ({

                        provider:
                            file.provider ||
                            "supabase",

                        bucket:
                            file.bucket ||
                            "neo-uploads",

                        path:
                            file.path ||
                            "",

                        name:
                            file.name ||
                            "Attached file",

                        mimeType:
                            file.mimeType ||
                            file.type ||
                            "application/octet-stream",

                        type:
                            file.type ||
                            file.mimeType ||
                            "application/octet-stream",

                        category:
                            file.category ||
                            "text",

                        size:
                            Number(
                                file.size
                            ) || 0

                    })
                )
                .filter(
                    file =>
                        Boolean(
                            file.path
                        )
                );

        };


    /* =====================================================
       ADD MESSAGE TO STATE
       ===================================================== */

    const addMessage =
        (
            role,
            content,
            options = {}
        ) => {

            if (
                role !== "user" &&
                role !== "assistant"
            ) {
                return null;
            }


            const message = {

                role,

                content:
                    cleanText(
                        content
                    )

            };


            const attachments =
                normalizeAttachments(
                    options.attachments
                );


            if (
                attachments.length
            ) {

                message.attachments =
                    attachments;

            }


            if (
                Array.isArray(
                    options.sources
                ) &&
                options.sources.length
            ) {

                message.sources =
                    options.sources;

            }


            conversation.push(
                message
            );


            /*
            Keep local state bounded too.
            Server already limits history to 50.
            */

            if (
                conversation.length >
                MAX_HISTORY_MESSAGES
            ) {

                conversation =
                    conversation.slice(
                        -MAX_HISTORY_MESSAGES
                    );

            }


            emit(
                "neyo:chat-message-added",
                {
                    message,
                    conversation:
                        [...conversation]
                }
            );


            return message;

        };


    /* =====================================================
       REMOVE LAST USER MESSAGE
       ===================================================== */

    const removeLastUserMessage = () => {

        const last =
            conversation[
                conversation.length - 1
            ];


        if (
            last?.role ===
            "user"
        ) {

            return conversation.pop();

        }


        return null;

    };


    /* =====================================================
       BUILD PAYLOAD
       ===================================================== */

    const buildPayload =
        (
            text,
            attachments
        ) => {

            const privateChat =
                Boolean(
                    preferences.privateChat
                );


            return {

                messages:
                    [...conversation],

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

                privateChat,

                language:
                    preferences.language,

                personality:
                    preferences.personality,

                isDeepResearch:
                    Boolean(
                        preferences
                            .isDeepResearch
                    ),

                title:
                    makeConversationTitle(
                        text,
                        attachments
                    )

            };

        };


    /* =====================================================
       SEND REQUEST
       ===================================================== */

    const send = async ({
        text = "",
        attachments = []
    } = {}) => {

        if (isGenerating) {

            emit(
                "neyo:chat-busy"
            );

            return null;

        }


        const clean =
            cleanText(text);


        const normalizedAttachments =
            normalizeAttachments(
                attachments
            );


        if (
            !clean &&
            normalizedAttachments.length ===
                0
        ) {

            return null;

        }


        const apiContent =
            clean ||
            "Please analyze the attached file.";


        /* -----------------------------------------
           USER MESSAGE STATE
           ----------------------------------------- */

        addMessage(
            "user",
            apiContent,
            {
                attachments:
                    normalizedAttachments
            }
        );


        isGenerating =
            true;


        abortController =
            new AbortController();


        emit(
            "neyo:chat-send-start",
            {
                text:
                    clean,

                attachments:
                    normalizedAttachments,

                conversationId:
                    currentConversationId
            }
        );


        try {

            const payload =
                buildPayload(
                    apiContent,
                    normalizedAttachments
                );


            const response =
                await fetch(
                    CHAT_ENDPOINT,
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
                                "application/json"

                        },

                        body:
                            JSON.stringify(
                                payload
                            ),

                        signal:
                            abortController
                                .signal
                    }
                );


            /* -----------------------------------------
               MESSAGE LIMIT
               ----------------------------------------- */

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


                removeLastUserMessage();


                emit(
                    "neyo:chat-limit-reached",
                    {
                        data
                    }
                );


                return null;

            }


            const data =
                await readJsonResponse(
                    response
                );


            /* -----------------------------------------
               REPLY
               ----------------------------------------- */

            const replyValue =
                data?.reply ??
                data?.choices?.[0]
                    ?.message
                    ?.content ??
                data?.message
                    ?.content ??
                data?.content ??
                data?.text;


            const reply =
                typeof replyValue ===
                    "string"
                    ? replyValue.trim()
                    : "";


            if (!reply) {

                throw new Error(
                    "The AI response was empty."
                );

            }


            /* -----------------------------------------
               CONVERSATION ID
               ----------------------------------------- */

            if (
                !preferences.privateChat &&
                typeof data
                    ?.conversationId ===
                    "string" &&
                data.conversationId
                    .trim()
            ) {

                currentConversationId =
                    data.conversationId
                        .trim();

            }


            /* -----------------------------------------
               SOURCES
               ----------------------------------------- */

            const sources =
                Array.isArray(
                    data?.sources
                )
                    ? data.sources
                    : [];


            /* -----------------------------------------
               ASSISTANT STATE
               ----------------------------------------- */

            addMessage(
                "assistant",
                reply,
                {
                    sources
                }
            );


            const result = {

                reply,

                sources,

                conversationId:
                    currentConversationId,

                privateChat:
                    Boolean(
                        data?.privateChat
                    ),

                usedUrlContext:
                    Boolean(
                        data
                            ?.usedUrlContext
                    ),

                creditType:
                    data?.creditType ||
                    null

            };


            emit(
                "neyo:chat-response",
                result
            );


            /*
            History module decides how to
            refresh its own UI.
            */

            if (
                !preferences.privateChat
            ) {

                emit(
                    "neyo:history-load-request"
                );

            }


            return result;

        }

        catch (error) {

            if (
                error?.name ===
                "AbortError"
            ) {

                emit(
                    "neyo:chat-aborted"
                );


                return null;

            }


            emit(
                "neyo:chat-error",
                {
                    error
                }
            );


            throw error;

        }

        finally {

            isGenerating =
                false;


            abortController =
                null;


            emit(
                "neyo:chat-send-end",
                {
                    conversationId:
                        currentConversationId
                }
            );

        }

    };


    /* =====================================================
       STOP GENERATION
       ===================================================== */

    const stop = () => {

        if (!abortController) {
            return false;
        }


        abortController.abort();


        return true;

    };


    /* =====================================================
       NEW CONVERSATION
       ===================================================== */

    const newConversation = () => {

        stop();


        conversation =
            [];


        currentConversationId =
            null;


        emit(
            "neyo:chat-new",
            {
                conversation: []
            }
        );


        return true;

    };


    /* =====================================================
       LOAD CONVERSATION INTO STATE
       ===================================================== */

    const loadConversation = ({
        conversationId,
        messages = []
    } = {}) => {

        currentConversationId =
            conversationId ||
            null;


        conversation =
            Array.isArray(
                messages
            )
                ? messages
                    .filter(
                        message =>
                            message &&
                            (
                                message.role ===
                                    "user" ||
                                message.role ===
                                    "assistant"
                            )
                    )
                    .map(
                        message => ({
                            ...message
                        })
                    )
                    .slice(
                        -MAX_HISTORY_MESSAGES
                    )
                : [];


        emit(
            "neyo:chat-state-loaded",
            {
                conversationId:
                    currentConversationId,

                messages:
                    [...conversation]
            }
        );

    };


    /* =====================================================
       PREFERENCES
       ===================================================== */

    const setPreferences =
        values => {

            if (
                !values ||
                typeof values !==
                "object"
            ) {
                return;
            }


            preferences = {
                ...preferences,
                ...values
            };


            emit(
                "neyo:chat-preferences-change",
                {
                    preferences:
                        { ...preferences }
                }
            );

        };


    /* =====================================================
       HISTORY CONNECTION
       ===================================================== */

    window.addEventListener(
        "neyo:conversation-loaded",
        event => {

            loadConversation({
                conversationId:
                    event.detail
                        ?.conversationId,

                messages:
                    event.detail
                        ?.messages ||
                    []
            });

        }
    );


    /* =====================================================
       PUBLIC SEND EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:chat-send-request",
        event => {

            send({
                text:
                    event.detail?.text ||
                    "",

                attachments:
                    event.detail
                        ?.attachments ||
                    []
            }).catch(
                error => {

                    console.error(
                        "Chat send failed:",
                        error
                    );

                }
            );

        }
    );


    /* =====================================================
       STOP EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:chat-stop-request",
        stop
    );


    /* =====================================================
       NEW CHAT EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:chat-new-request",
        newConversation
    );


    /* =====================================================
       PREFERENCES EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:chat-preferences-set",
        event => {

            setPreferences(
                event.detail
            );

        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoChat =
        Object.freeze({

            send,

            stop,

            newConversation,

            loadConversation,

            addMessage,

            setPreferences,

            getPreferences:
                () =>
                    ({ ...preferences }),

            getConversation:
                () =>
                    conversation.map(
                        message => ({
                            ...message
                        })
                    ),

            getConversationId:
                () =>
                    currentConversationId,

            setConversationId:
                id => {

                    currentConversationId =
                        id || null;

                },

            isGenerating:
                () =>
                    isGenerating

        });

})();
