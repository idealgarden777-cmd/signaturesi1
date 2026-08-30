/*
=========================================================
NEYO — CHAT CORE
Compact Streaming v14

FILE:
public/js/components/chat.js
=========================================================
*/

(() => {
    "use strict";

    const VERSION = "neyo-chat-v14-compact-streaming";

    if (window.NeyoChat?.__controller) {
        console.warn("[NEYO Chat] Already initialized.");
        return;
    }

    const CONFIG = Object.freeze({
        endpoint: "/api/chat",
        maxHistoryMessages: 50,
        maxAttachments: 5,
        timeoutMs: 180000,
        storageKey: "neyo_current_conversation_id",
        debug: true
    });

    let conversation = [];
    let currentConversationId = readConversationId();
    let generating = false;
    let activeController = null;
    let requestCounter = 0;

    let preferences = {
        intelligence: "standard",
        language: "auto",
        personality: "neyo",
        privateChat: false,
        isDeepResearch: false
    };


    /* =====================================================
       HELPERS
       ===================================================== */

    function debug(...args) {
        if (CONFIG.debug) {
            console.log("[NEYO Chat]", ...args);
        }
    }

    function emit(name, detail = {}) {
        window.dispatchEvent(
            new CustomEvent(name, { detail })
        );
    }

    function clean(value) {
        return typeof value === "string"
            ? value
                .replace(/\r\n?/g, "\n")
                .replace(/\u0000/g, "")
                .trim()
            : "";
    }

    function createId() {
        return globalThis.crypto?.randomUUID?.() ||
            `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    function readConversationId() {
        try {
            return clean(
                sessionStorage.getItem(CONFIG.storageKey)
            ) || null;
        } catch {
            return null;
        }
    }

    function saveConversationId(id) {
        const value = clean(id) || null;

        try {
            if (value) {
                sessionStorage.setItem(
                    CONFIG.storageKey,
                    value
                );
            } else {
                sessionStorage.removeItem(
                    CONFIG.storageKey
                );
            }
        } catch {}

        return value;
    }


    /* =====================================================
       ATTACHMENTS
       ===================================================== */

    function normalizeAttachments(items) {
        if (!Array.isArray(items)) {
            return [];
        }

        return items
            .filter(
                item =>
                    item &&
                    typeof item === "object"
            )
            .slice(0, CONFIG.maxAttachments)
            .map(item => {
                const mimeType =
                    clean(
                        item.mimeType ||
                        item.mime ||
                        item.type ||
                        "application/octet-stream"
                    ) ||
                    "application/octet-stream";

                return {
                    provider:
                        clean(item.provider) ||
                        "supabase",

                    bucket:
                        clean(item.bucket) ||
                        "neyo-attachments",

                    path:
                        clean(item.path),

                    name:
                        clean(item.name) ||
                        "Attached file",

                    mimeType,

                    type:
                        mimeType,

                    category:
                        clean(item.category) ||
                        "unknown",

                    size:
                        Math.max(
                            0,
                            Number(item.size) || 0
                        )
                };
            })
            .filter(item => item.path);
    }


    /* =====================================================
       MESSAGE STATE
       ===================================================== */

    function normalizeMessage(message) {
        if (
            !message ||
            !["user", "assistant"].includes(message.role)
        ) {
            return null;
        }

        const result = {
            id:
                clean(message.id) ||
                createId(),

            role:
                message.role,

            content:
                clean(message.content)
        };

        const attachments =
            normalizeAttachments(message.attachments);

        if (attachments.length) {
            result.attachments = attachments;
        }

        if (Array.isArray(message.sources)) {
            result.sources = [...message.sources];
        }

        if (message.error === true) {
            result.error = true;
        }

        return result;
    }

    function getConversation() {
        return conversation.map(message => ({
            ...message,

            attachments:
                Array.isArray(message.attachments)
                    ? message.attachments.map(item => ({
                        ...item
                    }))
                    : undefined,

            sources:
                Array.isArray(message.sources)
                    ? [...message.sources]
                    : undefined
        }));
    }

    function trimConversation() {
        if (
            conversation.length >
            CONFIG.maxHistoryMessages
        ) {
            conversation =
                conversation.slice(
                    -CONFIG.maxHistoryMessages
                );
        }
    }

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

        if (!message) {
            return null;
        }

        conversation.push(message);
        trimConversation();

        emit(
            "neyo:chat-message-added",
            {
                message: { ...message },
                conversation: getConversation()
            }
        );

        return message;
    }

    function updateMessageContent(
        id,
        content
    ) {
        const message =
            conversation.find(
                item => item.id === id
            );

        if (!message) {
            return false;
        }

        message.content =
            typeof content === "string"
                ? content
                : "";

        emit(
            "neyo:chat-message-updated",
            {
                id,
                content: message.content,
                message: { ...message },
                conversation: getConversation()
            }
        );

        return true;
    }

    function removeMessage(id) {
        const index =
            conversation.findIndex(
                item => item.id === id
            );

        if (index < 0) {
            return false;
        }

        const [message] =
            conversation.splice(index, 1);

        emit(
            "neyo:chat-message-removed",
            {
                id,
                message,
                conversation: getConversation()
            }
        );

        return true;
    }


    /* =====================================================
       PAYLOAD
       ===================================================== */

    function getSelectedModel() {
        try {
            return (
                window.NeyoModelMenu
                    ?.getSelected?.() ||
                "l1.0"
            );
        } catch {
            return "l1.0";
        }
    }

    function toApiMessage(message) {
        const result = {
            role: message.role,
            content: clean(message.content)
        };

        if (
            Array.isArray(message.attachments) &&
            message.attachments.length
        ) {
            result.attachments =
                normalizeAttachments(
                    message.attachments
                );
        }

        return result;
    }

    function createTitle(text, attachments) {
        const value =
            clean(text)
                .replace(/\s+/g, " ")
                .slice(0, 80);

        if (value) {
            return value;
        }

        return (
            attachments?.[0]?.name ||
            "New conversation"
        ).slice(0, 80);
    }

    function buildPayload(
        prompt,
        attachments
    ) {
        const privateChat =
            Boolean(preferences.privateChat);

        return {
            messages:
                conversation
                    .slice(
                        -CONFIG.maxHistoryMessages
                    )
                    .map(toApiMessage),

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
                    preferences.isDeepResearch
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
        let buffer = "";

        function push(chunk) {
            buffer +=
                String(chunk || "")
                    .replace(/\r\n/g, "\n")
                    .replace(/\r/g, "\n");

            const blocks =
                buffer.split("\n\n");

            buffer =
                blocks.pop() || "";

            const events = [];

            for (const block of blocks) {

                /*
                 * Heartbeats use:
                 *
                 * : neyo-heartbeat ...
                 *
                 * They contain no data: line,
                 * therefore are safely ignored.
                 */

                const lines =
                    block
                        .split("\n")
                        .filter(
                            line =>
                                line.startsWith(
                                    "data:"
                                )
                        );

                if (!lines.length) {
                    continue;
                }

                const raw =
                    lines
                        .map(
                            line =>
                                line
                                    .slice(5)
                                    .replace(/^ /, "")
                        )
                        .join("\n")
                        .trim();

                if (!raw) {
                    continue;
                }

                if (raw === "[DONE]") {
                    events.push({
                        type: "done",
                        done: true
                    });
                    continue;
                }

                try {
                    events.push(
                        JSON.parse(raw)
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
            if (!buffer.trim()) {
                return [];
            }

            const value = buffer;
            buffer = "";

            return push(
                `${value}\n\n`
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

        if (generating) {
            emit("neyo:chat-busy");
            return null;
        }

        const prompt =
            clean(text);

        const readyAttachments =
            normalizeAttachments(
                attachments
            );

        if (
            !prompt &&
            !readyAttachments.length
        ) {
            return null;
        }

        const userContent =
            prompt ||
            "Please analyze the attached file or files.";

        const requestId =
            ++requestCounter;

        const userMessage =
            addMessage(
                "user",
                userContent,
                {
                    attachments:
                        readyAttachments
                }
            );

        if (!userMessage) {
            return null;
        }

        /*
         * Build payload while last message
         * is still the user message.
         */

        const payload =
            buildPayload(
                userContent,
                readyAttachments
            );

        generating = true;

        const controller =
            new AbortController();

        activeController =
            controller;

        emit(
            "neyo:chat-send-start",
            {
                requestId,
                text: prompt,
                attachments:
                    readyAttachments,
                conversationId:
                    currentConversationId
            }
        );


        let timeout = null;

        let assistantId = null;
        let assistantMessage = null;

        let received = "";
        let displayed = "";

        let typingTimer = null;
        let doneReceived = false;

        let finalSources = [];
        let newConversationId =
            currentConversationId;

        let privateChat =
            Boolean(
                preferences.privateChat
            );

        let usedUrlContext = false;
        let creditType = null;


        /* =================================================
           DISPLAY STREAM
           ================================================= */

        function ensureAssistant() {
            if (assistantMessage) {
                return assistantMessage;
            }

            if (!displayed) {
                return null;
            }

            assistantId = createId();

            assistantMessage =
                addMessage(
                    "assistant",
                    displayed,
                    {
                        id: assistantId
                    }
                );

            return assistantMessage;
        }

        function nextTypingStep() {
            const pending =
                received.length -
                displayed.length;

            if (pending > 700) return 16;
            if (pending > 350) return 10;
            if (pending > 180) return 6;
            if (pending > 80) return 4;
            if (pending > 30) return 3;
            if (pending > 10) return 2;

            return 1;
        }

        function typeTick() {
            typingTimer = null;

            if (controller.signal.aborted) {
                return;
            }

            const remaining =
                received.length -
                displayed.length;

            if (remaining <= 0) {
                return;
            }

            const step =
                nextTypingStep();

            displayed =
                received.slice(
                    0,
                    Math.min(
                        received.length,
                        displayed.length +
                            step
                    )
                );

            ensureAssistant();

            if (assistantId) {
                updateMessageContent(
                    assistantId,
                    displayed
                );
            }

            if (
                displayed.length <
                received.length
            ) {
                typingTimer =
                    window.setTimeout(
                        typeTick,
                        16
                    );
            }
        }

        function startTyping() {
            if (typingTimer !== null) {
                return;
            }

            typingTimer =
                window.setTimeout(
                    typeTick,
                    0
                );
        }

        async function finishTyping() {
            while (
                displayed.length <
                received.length
            ) {
                if (
                    controller.signal.aborted
                ) {
                    return;
                }

                typeTick();

                await new Promise(
                    resolve =>
                        window.setTimeout(
                            resolve,
                            16
                        )
                );
            }
        }

        function stopTyping() {
            if (
                typingTimer !== null
            ) {
                window.clearTimeout(
                    typingTimer
                );

                typingTimer = null;
            }
        }


        /* =================================================
           STREAM EVENT
           ================================================= */

        function processEvent(event) {
            if (
                !event ||
                typeof event !== "object"
            ) {
                return false;
            }

            /*
             * Backend SSE errors must not
             * be silently ignored.
             */

            if (
                event.type === "error"
            ) {
                const error =
                    new Error(
                        clean(event.error) ||
                        "Streaming request failed."
                    );

                error.isStreamError = true;

                throw error;
            }

            if (
                typeof event.conversationId ===
                    "string" &&
                event.conversationId.trim()
            ) {
                newConversationId =
                    event.conversationId.trim();
            }

            if (
                Array.isArray(event.sources)
            ) {
                finalSources =
                    event.sources;
            }

            if (
                event.privateChat !==
                undefined
            ) {
                privateChat =
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
                undefined
            ) {
                creditType =
                    event.creditType;
            }

            if (
                event.thought === true
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

            if (delta) {
                received += delta;
                startTyping();
            }

            const done =
                event.done === true ||
                event.type === "done" ||
                event.type === "end";

            if (done) {
                doneReceived = true;
            }

            return done;
        }


        /* =================================================
           NETWORK
           ================================================= */

        try {

            timeout =
                window.setTimeout(
                    () => controller.abort(),
                    CONFIG.timeoutMs
                );

            const response =
                await fetch(
                    CONFIG.endpoint,
                    {
                        method: "POST",

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


            if (
                response.status === 429
            ) {
                const data =
                    await response
                        .json()
                        .catch(() => ({}));

                emit(
                    "neyo:chat-limit-reached",
                    {
                        requestId,
                        data
                    }
                );

                return null;
            }


            if (!response.ok) {

                const raw =
                    await response
                        .text()
                        .catch(() => "");

                let data = {};

                try {
                    data =
                        raw
                            ? JSON.parse(raw)
                            : {};
                } catch {}

                const error =
                    new Error(
                        clean(
                            data.error ||
                            data.message ||
                            raw
                        ) ||
                        `Request failed (${response.status}).`
                    );

                error.status =
                    response.status;

                throw error;
            }


            if (!response.body) {
                throw new Error(
                    "Streaming response is unavailable."
                );
            }


            const reader =
                response.body.getReader();

            const decoder =
                new TextDecoder();

            const parser =
                createSSEParser();


            while (!doneReceived) {

                const {
                    done,
                    value
                } =
                    await reader.read();

                if (done) {
                    break;
                }

                if (
                    controller.signal.aborted
                ) {
                    const error =
                        new Error(
                            "Request aborted"
                        );

                    error.name =
                        "AbortError";

                    throw error;
                }

                const chunk =
                    decoder.decode(
                        value,
                        {
                            stream: true
                        }
                    );

                const events =
                    parser.push(chunk);

                for (
                    const event
                    of events
                ) {
                    if (
                        processEvent(event)
                    ) {
                        break;
                    }
                }
            }


            const tail =
                decoder.decode();

            if (tail) {
                for (
                    const event
                    of parser.push(tail)
                ) {
                    processEvent(event);
                }
            }

            for (
                const event
                of parser.flush()
            ) {
                processEvent(event);
            }


            try {
                await reader.cancel();
            } catch {}


            await finishTyping();


            if (!received) {
                throw new Error(
                    "Empty response from AI."
                );
            }


            displayed = received;

            ensureAssistant();

            if (assistantId) {
                updateMessageContent(
                    assistantId,
                    received
                );
            }


            if (
                !privateChat &&
                newConversationId
            ) {
                currentConversationId =
                    saveConversationId(
                        newConversationId
                    );
            }


            assistantMessage =
                conversation.find(
                    message =>
                        message.id ===
                        assistantId
                ) ||
                assistantMessage;


            if (assistantMessage) {

                assistantMessage.content =
                    received;

                if (
                    finalSources.length
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
                            received,

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
                reply: received,
                sources: finalSources,
                message:
                    assistantMessage,
                conversationId:
                    currentConversationId,
                privateChat,
                usedUrlContext,
                creditType
            };


            emit(
                "neyo:chat-response",
                result
            );


            if (!privateChat) {
                emit(
                    "neyo:history-load-request",
                    {
                        conversationId:
                            currentConversationId
                    }
                );
            }


            return result;


        } catch (error) {

            stopTyping();


            if (
                error?.name ===
                    "AbortError" ||
                controller.signal.aborted
            ) {

                emit(
                    "neyo:chat-aborted",
                    {
                        requestId,
                        conversationId:
                            currentConversationId
                    }
                );

                if (
                    displayed &&
                    assistantId
                ) {
                    updateMessageContent(
                        assistantId,
                        displayed
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
                error?.status === 401
            ) {

                userFacingError =
                    "Your session has expired. Please sign in again.";

            } else if (
                error?.status === 413
            ) {

                userFacingError =
                    "This request is too large.";

            } else if (
                error?.status >= 500
            ) {

                userFacingError =
                    "NEYO is temporarily unavailable. Please try again.";

            } else if (
                error instanceof TypeError &&
                /failed to fetch|networkerror|network request failed/i
                    .test(
                        error.message || ""
                    )
            ) {

                /*
                 * Never expose raw browser
                 * 'Failed to fetch'.
                 */

                userFacingError =
                    "Connection interrupted. Please try again.";

            } else if (
                error?.message
            ) {

                userFacingError =
                    error.message;
            }


            const errorText =
                `⚠️ ${userFacingError}`;


            if (!assistantMessage) {

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

                assistantMessage.error =
                    true;
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

            stopTyping();

            if (timeout !== null) {
                window.clearTimeout(
                    timeout
                );
            }

            if (
                requestId ===
                requestCounter
            ) {
                generating = false;
                activeController = null;

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
       CONTROLS
       ===================================================== */

    function stop() {
        if (!activeController) {
            return false;
        }

        try {
            activeController.abort();
            return true;
        } catch {
            return false;
        }
    }

    function newConversation() {
        requestCounter += 1;

        stop();

        generating = false;
        activeController = null;

        conversation = [];
        currentConversationId = null;

        saveConversationId(null);

        emit("neyo:messages-clear");

        emit(
            "neyo:chat-new",
            {
                conversation: [],
                conversationId: null
            }
        );

        emit(
            "neyo:chat-send-end",
            {
                conversationId: null
            }
        );

        return true;
    }

    function loadConversation({
        conversationId,
        messages = []
    } = {}) {

        requestCounter += 1;

        stop();

        generating = false;
        activeController = null;

        currentConversationId =
            clean(conversationId) ||
            null;

        saveConversationId(
            currentConversationId
        );

        conversation =
            Array.isArray(messages)
                ? messages
                    .map(normalizeMessage)
                    .filter(Boolean)
                    .slice(
                        -CONFIG.maxHistoryMessages
                    )
                : [];

        emit("neyo:messages-clear");

        for (
            const message
            of conversation
        ) {
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

        emit(
            "neyo:chat-state-loaded",
            {
                conversationId:
                    currentConversationId,

                messages:
                    getConversation()
            }
        );

        return true;
    }

    function setConversationId(id) {
        currentConversationId =
            clean(id) || null;

        saveConversationId(
            currentConversationId
        );

        return true;
    }

    function setPreferences(values) {
        if (
            !values ||
            typeof values !== "object"
        ) {
            return false;
        }

        preferences = {
            ...preferences,
            ...values
        };

        if (preferences.privateChat) {
            currentConversationId = null;
            saveConversationId(null);
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
       EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:chat-send-request",
        event => {
            void send({
                text:
                    event.detail?.text ||
                    "",

                attachments:
                    event.detail
                        ?.attachments ||
                    []
            });
        }
    );

    window.addEventListener(
        "neyo:chat-stop-request",
        stop
    );

    window.addEventListener(
        "neyo:chat-new-request",
        newConversation
    );

    window.addEventListener(
        "neyo:new-chat-start",
        () => {
            currentConversationId = null;
            saveConversationId(null);
        }
    );

    function handleConversationLoad(
        event
    ) {
        loadConversation({
            conversationId:
                event.detail
                    ?.conversationId ||
                event.detail?.id ||
                null,

            messages:
                event.detail?.messages ||
                event.detail?.conversation ||
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
                event.detail || {}
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

    const api =
        Object.freeze({
            __controller: true,
            version: VERSION,

            send,
            stop,
            newConversation,
            loadConversation,

            addMessage,
            updateMessageContent,
            removeMessage,

            getConversation,

            getConversationId:
                () =>
                    currentConversationId,

            setConversationId,

            setPreferences,

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

                    messageCount:
                        conversation.length,

                    requestId:
                        requestCounter,

                    preferences: {
                        ...preferences
                    }
                })
        });


    Object.defineProperty(
        window,
        "NeyoChat",
        {
            value: api,
            writable: false,
            configurable: true,
            enumerable: true
        }
    );


    debug(
        "READY",
        {
            version: VERSION,
            streaming: true,
            heartbeatCompatible: true
        }
    );


    emit(
        "neyo:chat-ready",
        {
            version: VERSION,
            conversationId:
                currentConversationId,

            streaming: true
        }
    );

})();
