/*
=========================================================
NEYO — SEND / STOP CONTROLLER
DIRECT CHAT OWNER v12

FILE:
public/js/components/send-state.js

OWNS
---------------------------------------------------------
- #sendBtn
- Send arrow
- Stop square
- Enabled / disabled state
- Enter to send
- Shift + Enter newline
- IME safety
- Ready attachment eligibility
- Direct NeyoChat.send()
- Direct NeyoChat.stop()

DOES NOT OWN
---------------------------------------------------------
- /api/chat implementation
- Conversation state
- Message DOM
- Attachment upload / processing
- History
- Markdown rendering

IMPORTANT
---------------------------------------------------------
This is the ONLY owner of:
- Send button click
- Enter key send
- Stop button click

chat-runtime.js must NOT intercept these.
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       VERSION / GUARD
       ===================================================== */

    const VERSION =
        "neyo-send-state-direct-v12";


    if (
        window.NeyoSendState
            ?.__controller === true
    ) {
        console.warn(
            "[NEYO Send] Already initialized."
        );

        return;
    }


    /* =====================================================
       DOM
       ===================================================== */

    const sendBtn =
        document.getElementById(
            "sendBtn"
        );


    const chatInput =
        document.getElementById(
            "chatInput"
        );


    if (
        !sendBtn ||
        !chatInput
    ) {
        console.warn(
            "[NEYO Send] Composer DOM missing."
        );

        return;
    }


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG =
        Object.freeze({

            maxMessageLength:
                50_000,

            duplicateWindowMs:
                180

        });


    /* =====================================================
       STATE
       ===================================================== */

    const state = {

        generating:
            false,

        sending:
            false,

        composing:
            false,

        readyAttachments:
            0,

        pendingAttachments:
            0,

        failedAttachments:
            0,

        lastSendAt:
            0

    };


    /* =====================================================
       EVENTS
       ===================================================== */

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


    /* =====================================================
       TEXT
       ===================================================== */

    function getRawText() {

        return String(
            chatInput.value ||
            ""
        )
            .replace(
                /\r\n?/g,
                "\n"
            )
            .replace(
                /\u0000/g,
                ""
            )
            .slice(
                0,
                CONFIG.maxMessageLength
            );

    }


    function getText() {

        return getRawText()
            .trim();

    }


    function hasText() {

        return (
            getText().length >
            0
        );

    }


    /* =====================================================
       ATTACHMENTS
       ===================================================== */

    function getAttachmentController() {

        const controller =
            window.NeyoAttachments;


        if (
            !controller ||
            typeof controller !==
                "object"
        ) {
            return null;
        }


        return controller;

    }


    function getAllAttachments() {

        const controller =
            getAttachmentController();


        if (!controller) {
            return [];
        }


        try {

            const files =
                controller.getAll?.() ??
                controller.getFiles?.() ??
                [];


            return Array.isArray(
                files
            )
                ? files
                : [];

        } catch (
            error
        ) {

            console.warn(
                "[NEYO Send] Attachment state failed:",
                error
            );


            return [];

        }

    }


    function getReadyAttachments() {

        const controller =
            getAttachmentController();


        if (!controller) {
            return [];
        }


        try {

            const files =
                controller.getReady?.();


            if (
                Array.isArray(
                    files
                )
            ) {
                return files;
            }

        } catch {}


        return getAllAttachments()
            .filter(
                file => {

                    const status =
                        String(
                            file?.status ||
                            file?.state ||
                            ""
                        )
                            .trim()
                            .toLowerCase();


                    return (
                        file?.ready === true ||
                        status === "ready" ||
                        status === "complete" ||
                        status === "completed" ||
                        status === "processed"
                    );

                }
            );

    }


    function syncAttachments() {

        const files =
            getAllAttachments();


        state.readyAttachments =
            0;


        state.pendingAttachments =
            0;


        state.failedAttachments =
            0;


        for (
            const file
            of files
        ) {

            const status =
                String(
                    file?.status ||
                    file?.state ||
                    ""
                )
                    .trim()
                    .toLowerCase();


            if (
                file?.ready === true ||
                status === "ready" ||
                status === "complete" ||
                status === "completed" ||
                status === "processed"
            ) {

                state.readyAttachments +=
                    1;

                continue;

            }


            if (
                status === "error" ||
                status === "failed"
            ) {

                state.failedAttachments +=
                    1;

                continue;

            }


            state.pendingAttachments +=
                1;

        }

    }


    /* =====================================================
       REMOVE SENT ATTACHMENTS
       ===================================================== */

    function removeSentAttachments(
        files
    ) {

        if (
            !Array.isArray(
                files
            ) ||
            files.length ===
                0
        ) {
            return;
        }


        const controller =
            getAttachmentController();


        if (!controller) {
            return;
        }


        for (
            const file
            of files
        ) {

            const id =
                file?.id ||
                file?.uploadId ||
                file?.documentId ||
                file?.path ||
                null;


            if (!id) {
                continue;
            }


            try {

                if (
                    typeof controller.remove ===
                    "function"
                ) {

                    controller.remove(
                        id
                    );

                    continue;

                }


                if (
                    typeof controller.removeFile ===
                    "function"
                ) {

                    controller.removeFile(
                        id
                    );

                }

            } catch (
                error
            ) {

                console.warn(
                    "[NEYO Send] Attachment cleanup failed:",
                    error
                );

            }

        }


        syncAttachments();

    }


    /* =====================================================
       CAN SEND
       ===================================================== */

    function canSend() {

        syncAttachments();


        if (
            state.generating
        ) {
            return true;
        }


        if (
            state.sending
        ) {
            return false;
        }


        if (
            hasText()
        ) {
            return true;
        }


        return (
            state.readyAttachments >
            0
        );

    }


    /* =====================================================
       ICONS
       ===================================================== */

    function refreshIcons() {

        try {

            window.lucide
                ?.createIcons
                ?.();

        } catch {}

    }


    function renderSendIcon() {

        sendBtn.replaceChildren();


        const icon =
            document.createElement(
                "i"
            );


        icon.setAttribute(
            "data-lucide",
            "arrow-up"
        );


        icon.setAttribute(
            "size",
            "18"
        );


        icon.setAttribute(
            "aria-hidden",
            "true"
        );


        sendBtn.appendChild(
            icon
        );


        refreshIcons();

    }


    function renderStopIcon() {

        sendBtn.replaceChildren();


        const square =
            document.createElement(
                "span"
            );


        square.className =
            "send-stop-square";


        square.setAttribute(
            "aria-hidden",
            "true"
        );


        sendBtn.appendChild(
            square
        );

    }


    /* =====================================================
       BUTTON STATE
       ===================================================== */

    function updateButton() {

        syncAttachments();


        /* -------------------------------------------------
           GENERATING / STOP
           ------------------------------------------------- */

        if (
            state.generating
        ) {

            sendBtn.disabled =
                false;


            sendBtn.classList.add(
                "is-generating"
            );


            sendBtn.classList.remove(
                "is-disabled",
                "is-ready"
            );


            sendBtn.setAttribute(
                "aria-disabled",
                "false"
            );


            sendBtn.setAttribute(
                "aria-label",
                "Stop generating"
            );


            sendBtn.dataset.tooltip =
                "Stop";


            sendBtn.removeAttribute(
                "title"
            );


            renderStopIcon();


            return true;

        }


        /* -------------------------------------------------
           NORMAL SEND
           ------------------------------------------------- */

        const enabled =
            canSend();


        sendBtn.disabled =
            !enabled;


        sendBtn.classList.remove(
            "is-generating"
        );


        sendBtn.classList.toggle(
            "is-disabled",
            !enabled
        );


        sendBtn.classList.toggle(
            "is-ready",
            enabled
        );


        sendBtn.setAttribute(
            "aria-disabled",
            String(
                !enabled
            )
        );


        sendBtn.setAttribute(
            "aria-label",
            "Send message"
        );


        sendBtn.dataset.tooltip =
            "Send";


        sendBtn.removeAttribute(
            "title"
        );


        renderSendIcon();


        return enabled;

    }


    /* =====================================================
       CLEAR COMPOSER
       ===================================================== */

    function clearComposer() {

        chatInput.value =
            "";


        chatInput.dispatchEvent(
            new Event(
                "input",
                {
                    bubbles:
                        true
                }
            )
        );


        try {

            window.NeyoComposer
                ?.refresh
                ?.();

        } catch {}


        try {

            window
                .NeyoComposerScrollbar
                ?.refresh
                ?.();

        } catch {}

    }


    /* =====================================================
       STOP
       ===================================================== */

    function stopGeneration() {

        if (
            !state.generating
        ) {
            return false;
        }


        const chat =
            window.NeyoChat;


        if (
            chat &&
            typeof chat.stop ===
                "function"
        ) {

            try {

                const result =
                    chat.stop();


                if (
                    result !== false
                ) {

                    emit(
                        "neyo:send-stop-requested"
                    );


                    return true;

                }

            } catch (
                error
            ) {

                console.error(
                    "[NEYO Send] Stop failed:",
                    error
                );

            }

        }


        /*
         * Compatibility fallback.
         */

        emit(
            "neyo:chat-stop-request",
            {
                reason:
                    "user"
            }
        );


        return true;

    }


    /* =====================================================
       SEND
       ===================================================== */

    function sendMessage() {

        if (
            state.generating
        ) {

            return stopGeneration();

        }


        if (
            state.sending
        ) {
            return false;
        }


        const text =
            getText();


        const rawText =
            getRawText();


        const attachments =
            getReadyAttachments();


        if (
            !text &&
            attachments.length ===
                0
        ) {

            updateButton();


            return false;

        }


        /* -------------------------------------------------
           DUPLICATE GUARD
           ------------------------------------------------- */

        const now =
            Date.now();


        if (
            now -
                state.lastSendAt <
            CONFIG.duplicateWindowMs
        ) {

            return false;

        }


        state.lastSendAt =
            now;


        /* -------------------------------------------------
           CHAT CONTROLLER
           ------------------------------------------------- */

        const chat =
            window.NeyoChat;


        if (
            !chat ||
            typeof chat.send !==
                "function"
        ) {

            console.error(
                "[NEYO Send] NeyoChat.send() unavailable."
            );


            updateButton();


            return false;

        }


        state.sending =
            true;


        updateButton();


        let request;


        try {

            /*
             * IMPORTANT:
             *
             * NeyoChat.send() adds the user message and emits
             * neyo:chat-send-start synchronously before its
             * first network await.
             */

            request =
                chat.send({
                    text,
                    attachments
                });

        } catch (
            error
        ) {

            state.sending =
                false;


            state.generating =
                false;


            updateButton();


            console.error(
                "[NEYO Send] Send failed:",
                error
            );


            return false;

        }


        /*
         * chat-send-start listener should already have
         * switched generating=true if chat accepted it.
         */

        const accepted =
            state.generating;


        if (
            accepted
        ) {

            /*
             * Clear only the draft that was actually sent.
             */

            if (
                getRawText() ===
                rawText
            ) {

                clearComposer();

            }


            removeSentAttachments(
                attachments
            );


            state.sending =
                false;


            updateButton();


            emit(
                "neyo:composer-message-dispatched",
                {

                    text,

                    attachmentCount:
                        attachments.length

                }
            );

        } else {

            /*
             * If chat did not immediately report generation,
             * keep user draft intact.
             */

            state.sending =
                false;


            updateButton();

        }


        /*
         * Async rejection safety.
         */

        if (
            request &&
            typeof request.catch ===
                "function"
        ) {

            request.catch(
                error => {

                    console.error(
                        "[NEYO Send] Chat request rejected:",
                        error
                    );


                    state.sending =
                        false;


                    if (
                        !window.NeyoChat
                            ?.isGenerating
                            ?.()
                    ) {

                        state.generating =
                            false;

                    }


                    updateButton();

                }
            );

        }


        return accepted;

    }


    /* =====================================================
       SEND BUTTON CLICK
       ===================================================== */

    function handleButtonClick(
        event
    ) {

        event.preventDefault();


        event.stopPropagation();


        event.stopImmediatePropagation();


        if (
            state.generating
        ) {

            stopGeneration();

        } else {

            sendMessage();

        }

    }


    /*
     * Capture listener intentionally makes this module
     * the first and only Send-button owner.
     */

    sendBtn.addEventListener(
        "click",
        handleButtonClick,
        true
    );


    /* =====================================================
       IME
       ===================================================== */

    chatInput.addEventListener(
        "compositionstart",
        () => {

            state.composing =
                true;

        }
    );


    chatInput.addEventListener(
        "compositionend",
        () => {

            state.composing =
                false;


            updateButton();

        }
    );


    /* =====================================================
       ENTER
       ===================================================== */

    function handleEnter(
        event
    ) {

        if (
            event.key !==
            "Enter"
        ) {
            return;
        }


        if (
            event.shiftKey
        ) {
            return;
        }


        if (
            event.ctrlKey ||
            event.altKey ||
            event.metaKey
        ) {
            return;
        }


        if (
            event.isComposing ||
            state.composing ||
            event.keyCode ===
                229
        ) {
            return;
        }


        /*
         * Enter cannot stop generation.
         */

        if (
            state.generating
        ) {

            event.preventDefault();


            event.stopPropagation();


            event.stopImmediatePropagation();


            return;

        }


        if (
            !canSend()
        ) {
            return;
        }


        event.preventDefault();


        event.stopPropagation();


        event.stopImmediatePropagation();


        sendMessage();

    }


    chatInput.addEventListener(
        "keydown",
        handleEnter,
        true
    );


    /* =====================================================
       INPUT STATE
       ===================================================== */

    chatInput.addEventListener(
        "input",
        updateButton
    );


    /* =====================================================
       ATTACHMENT STATE
       ===================================================== */

    for (
        const eventName
        of [

            "neyo:attachments-change",

            "neyo:attachment-ready",

            "neyo:attachment-error",

            "neyo:attachment-removed"

        ]
    ) {

        window.addEventListener(
            eventName,
            updateButton
        );

    }


    /* =====================================================
       GENERATION START
       ===================================================== */

    window.addEventListener(
        "neyo:chat-send-start",
        () => {

            state.generating =
                true;


            state.sending =
                false;


            updateButton();

        }
    );


    /* =====================================================
       GENERATION FINISH
       ===================================================== */

    function finishGeneration() {

        state.generating =
            false;


        state.sending =
            false;


        updateButton();

    }


    for (
        const eventName
        of [

            "neyo:chat-send-end",

            "neyo:chat-response",

            "neyo:chat-error",

            "neyo:chat-aborted",

            "neyo:chat-limit-reached",

            "neyo:chat-new",

            "neyo:chat-state-loaded"

        ]
    ) {

        window.addEventListener(
            eventName,
            finishGeneration
        );

    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    const api =
        Object.freeze({

            __controller:
                true,

            version:
                VERSION,

            active:
                true,

            send:
                sendMessage,

            stop:
                stopGeneration,

            update:
                updateButton,

            refresh:
                updateButton,

            canSend,


            isGenerating() {

                return state.generating;

            },


            setGenerating(
                value
            ) {

                state.generating =
                    Boolean(
                        value
                    );


                if (
                    !state.generating
                ) {

                    state.sending =
                        false;

                }


                updateButton();


                return state.generating;

            },


            getState() {

                syncAttachments();


                return {

                    version:
                        VERSION,

                    active:
                        true,

                    generating:
                        state.generating,

                    sending:
                        state.sending,

                    composing:
                        state.composing,

                    hasText:
                        hasText(),

                    readyAttachments:
                        state.readyAttachments,

                    pendingAttachments:
                        state.pendingAttachments,

                    failedAttachments:
                        state.failedAttachments,

                    canSend:
                        canSend()

                };

            }

        });


    Object.defineProperty(
        window,
        "NeyoSendState",
        {

            value:
                api,

            writable:
                false,

            configurable:
                true,

            enumerable:
                true

        }
    );


    /* =====================================================
       INITIAL SYNC
       ===================================================== */

    try {

        state.generating =
            Boolean(
                window.NeyoChat
                    ?.isGenerating
                    ?.()
            );

    } catch {

        state.generating =
            false;

    }


    updateButton();


    emit(
        "neyo:send-state-ready",
        {

            version:
                VERSION,

            active:
                true

        }
    );


    console.log(
        "[NEYO Send] Direct controller ready.",
        VERSION
    );

})();
