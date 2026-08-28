/*
=========================================================
NEYO — SEND / STOP STATE
FINAL SIMPLE SINGLE-OWNER v11

FILE:
public/js/components/send-state.js

OWNS
---------------------------------------------------------
- #sendBtn
- Send arrow
- Stop square
- Grey / active state
- Click to send
- Click to stop
- Enter to send
- Shift + Enter newline
- IME safety
- Ready attachment eligibility
- Composer clear AFTER chat accepts send
- Sent attachment cleanup

DOES NOT OWN
---------------------------------------------------------
- /api/chat
- Conversation state
- Message DOM
- AbortController
- Attachment upload / processing
- History
- Composer autosize

FLOW
---------------------------------------------------------
Text / ready file
    ↓
Send
    ↓
neyo:chat-send-request
    ↓
NeyoChat
    ↓
neyo:chat-send-start
    ↓
STOP square
    ↓
response / error / abort
    ↓
neyo:chat-send-end
    ↓
Send arrow
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       VERSION / SINGLETON
       ===================================================== */

    const VERSION =
        "neyo-send-state-simple-v11";


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
            "[NEYO Send] Required composer DOM missing."
        );

        return;
    }


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG =
        Object.freeze({

            duplicateWindowMs:
                180,

            maxMessageLength:
                50_000

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
                "[NEYO Send] Attachment state read failed:",
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


        /*
         * Canonical attachment controller.
         */

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


        /*
         * Compatibility fallback.
         */

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

        const all =
            getAllAttachments();


        state.readyAttachments =
            0;


        state.pendingAttachments =
            0;


        state.failedAttachments =
            0;


        for (
            const file
            of all
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
       ATTACHMENT CLEANUP
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

            /*
             * Button is STOP while generating,
             * therefore it must stay clickable.
             */

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
       ICON HELPERS
       ===================================================== */

    function refreshIcons() {

        try {

            window.lucide
                ?.createIcons
                ?.();

        } catch {}

    }


    /* =====================================================
       SEND ICON
       ===================================================== */

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


    /* =====================================================
       STOP ICON
       ===================================================== */

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
           GENERATING → STOP
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


        emit(
            "neyo:chat-stop-request",
            {
                reason:
                    "user"
            }
        );


        /*
         * Do NOT set generating=false here.
         *
         * chat.js owns AbortController and will emit
         * chat-aborted / chat-send-end.
         */


        return true;

    }


    /* =====================================================
       SEND
       ===================================================== */

    function sendMessage() {

        /*
         * Same button becomes STOP.
         */

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


        syncAttachments();


        const text =
            getText();


        const rawText =
            getRawText();


        const readyAttachments =
            getReadyAttachments();


        /* -------------------------------------------------
           NOTHING TO SEND
           ------------------------------------------------- */

        if (
            !text &&
            readyAttachments.length ===
                0
        ) {

            updateButton();


            return false;

        }


        /* -------------------------------------------------
           DUPLICATE SEND GUARD
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


        state.sending =
            true;


        /*
         * IMPORTANT:
         *
         * Do NOT fake generating=true here.
         *
         * We first dispatch to chat.js.
         * chat.js will synchronously emit:
         *
         * neyo:chat-send-start
         *
         * if it actually accepts the message.
         */

        emit(
            "neyo:chat-send-request",
            {

                text,

                attachments:
                    readyAttachments

            }
        );


        /*
         * CustomEvent dispatch is synchronous.
         *
         * If chat.js accepted the request,
         * generationStarted() has already run.
         */

        const accepted =
            state.generating;


        state.sending =
            false;


        /* -------------------------------------------------
           ACCEPTED
           ------------------------------------------------- */

        if (
            accepted
        ) {

            /*
             * Clear only the exact draft we sent.
             *
             * If another script/user changed the composer
             * during dispatch, preserve the new value.
             */

            if (
                getRawText() ===
                rawText
            ) {

                clearComposer();

            }


            /*
             * Remove only attachments included in the
             * accepted request.
             */

            removeSentAttachments(
                readyAttachments
            );


            updateButton();


            emit(
                "neyo:composer-message-dispatched",
                {

                    text,

                    attachmentCount:
                        readyAttachments.length

                }
            );


            return true;

        }


        /* -------------------------------------------------
           NOT ACCEPTED
           ------------------------------------------------- */

        /*
         * Leave text and attachments untouched.
         *
         * This prevents the old bug where the composer
         * cleared even though no chat was created.
         */

        updateButton();


        emit(
            "neyo:send-not-accepted",
            {
                text
            }
        );


        return false;

    }


    /* =====================================================
       SEND BUTTON CLICK
       ===================================================== */

    function handleClick(
        event
    ) {

        const target =
            event.target;


        if (
            !(
                target instanceof
                Element
            )
        ) {
            return;
        }


        const button =
            target.closest(
                "#sendBtn"
            );


        if (!button) {
            return;
        }


        /*
         * This controller is the sole Send / Stop click
         * owner.
         *
         * Prevent chat-runtime / neo.js from also sending.
         */

        event.preventDefault();


        event.stopPropagation();


        event.stopImmediatePropagation();


        if (
            state.generating
        ) {

            stopGeneration();


            return;

        }


        sendMessage();

    }


    /*
     * Capture on document deliberately.
     *
     * send-state.js loads before chat-runtime.js, so this
     * listener gets first ownership of #sendBtn.
     */

    document.addEventListener(
        "click",
        handleClick,
        true
    );


    /* =====================================================
       COMPOSITION / IME
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
       ENTER KEY
       ===================================================== */

    function handleKeyDown(
        event
    ) {

        const target =
            event.target;


        if (
            !(
                target instanceof
                Element
            )
        ) {
            return;
        }


        if (
            !target.closest(
                "#chatInput"
            )
        ) {
            return;
        }


        if (
            event.key !==
            "Enter"
        ) {
            return;
        }


        /* Shift + Enter = newline */

        if (
            event.shiftKey
        ) {
            return;
        }


        /* Keep modified shortcuts untouched */

        if (
            event.ctrlKey ||
            event.altKey ||
            event.metaKey
        ) {
            return;
        }


        /* IME safety */

        if (
            event.isComposing ||
            state.composing ||
            event.keyCode ===
                229
        ) {
            return;
        }


        /*
         * Enter must never become STOP.
         * Stop requires explicit button click.
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


    document.addEventListener(
        "keydown",
        handleKeyDown,
        true
    );


    /* =====================================================
       INPUT STATE
       ===================================================== */

    chatInput.addEventListener(
        "input",
        () => {

            updateButton();

        }
    );


    /* =====================================================
       ATTACHMENT STATE EVENTS
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
            () => {

                updateButton();

            }
        );

    }


    /* =====================================================
       GENERATION START
       ===================================================== */

    function generationStarted() {

        state.generating =
            true;


        state.sending =
            false;


        updateButton();

    }


    window.addEventListener(
        "neyo:chat-send-start",
        generationStarted
    );


    /* =====================================================
       GENERATION END
       ===================================================== */

    function generationFinished() {

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

            "neyo:chat-error",

            "neyo:chat-aborted",

            "neyo:chat-limit-reached",

            "neyo:chat-new"

        ]
    ) {

        window.addEventListener(
            eventName,
            generationFinished
        );

    }


    /* =====================================================
       CHAT STATE SYNC
       ===================================================== */

    window.addEventListener(
        "neyo:chat-state",
        event => {

            const generating =
                event.detail
                    ?.generating;


            if (
                typeof generating !==
                "boolean"
            ) {
                return;
            }


            state.generating =
                generating;


            if (
                !generating
            ) {

                state.sending =
                    false;

            }


            updateButton();

        }
    );


    window.addEventListener(
        "neyo:chat-state-loaded",
        () => {

            /*
             * Loading history means there is no active
             * generation from the composer.
             */

            state.generating =
                false;


            state.sending =
                false;


            updateButton();

        }
    );


    /* =====================================================
       CHAT BUSY RECOVERY
       ===================================================== */

    window.addEventListener(
        "neyo:chat-busy",
        () => {

            /*
             * If chat.js says it is already busy,
             * synchronize button with canonical chat state.
             */

            try {

                const busy =
                    Boolean(
                        window.NeyoChat
                            ?.isGenerating
                            ?.()
                    );


                state.generating =
                    busy;


                state.sending =
                    false;


                updateButton();

            } catch {

                state.sending =
                    false;


                updateButton();

            }

        }
    );


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
       INITIAL STATE
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
        "[NEYO Send] Ready",
        {
            version:
                VERSION,

            owner:
                "NeyoSendState"
        }
    );

})();
