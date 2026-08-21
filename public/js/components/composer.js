/*
=========================================================
NEYO — COMPOSER CORE COMPONENT v2
ATTACHMENT-AWARE COMPOSER STATE

Purpose:
Handles the core composer input behavior.

Owns:
- Textarea auto-resize
- Composer text state
- Empty / filled state
- Multiline state
- Attachment-aware visual state
- Composer input events
- Composer public API
- Custom composer events

Does NOT own:
- Sending messages
- File upload
- File processing
- Attachment storage
- Voice / microphone
- Suggestions
- Chat API
- Message rendering

Architecture:

attachments.js
      ↓
neyo:attachments-change
      ↓
chat.js
      ↓
neyo:chat-attachments-state
      ↓
composer.js
      ↓
visual composer state

=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const composer =
        document.getElementById(
            "glassInputContainer"
        );


    const textarea =
        document.getElementById(
            "chatInput"
        );


    /* =====================================================
       SAFETY
       ===================================================== */

    if (
        !composer ||
        !textarea
    ) {

        console.warn(
            "[NEYO Composer] Required DOM missing."
        );

        return;
    }


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const MIN_HEIGHT =
        38;


    const MAX_HEIGHT =
        160;


    /* =====================================================
       STATE
       ===================================================== */

    const state = {

        value:
            "",

        hasText:
            false,

        isMultiline:
            false,


        /*
        Attachment state is mirrored here
        only for composer visual behavior.

        composer.js DOES NOT manipulate files.
        */

        attachmentCount:
            0,

        readyAttachments:
            0,

        pendingAttachments:
            0,

        attachmentErrors:
            0,

        hasAttachments:
            false,

        attachmentsPending:
            false,


        /*
        Chat generation state.
        */

        generating:
            false
    };


    /* =====================================================
       EVENT HELPER
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


    /* =====================================================
       TEXT CLEANING
       ===================================================== */

    const getValue =
        () => {

            return textarea.value;
        };


    const getTrimmedValue =
        () => {

            return textarea
                .value
                .trim();
        };


    /* =====================================================
       TEXTAREA RESIZE
       ===================================================== */

    const resizeTextarea =
        () => {

            textarea.style.height =
                "auto";


            const scrollHeight =
                textarea.scrollHeight;


            const nextHeight =
                Math.min(
                    Math.max(
                        scrollHeight,
                        MIN_HEIGHT
                    ),
                    MAX_HEIGHT
                );


            textarea.style.height =
                `${nextHeight}px`;


            /*
            A textarea becomes multiline when
            its natural content height exceeds
            the minimum composer height.
            */

            state.isMultiline =
                scrollHeight >
                MIN_HEIGHT;


            composer.classList.toggle(
                "is-multiline",
                state.isMultiline
            );
        };


    /* =====================================================
       TEXT STATE
       ===================================================== */

    const updateTextState =
        () => {

            const value =
                getValue();


            const trimmed =
                value.trim();


            state.value =
                value;


            state.hasText =
                trimmed.length >
                0;


            composer.classList.toggle(
                "has-text",
                state.hasText
            );


            composer.dataset.empty =
                String(
                    !state.hasText
                );
        };


    /* =====================================================
       ATTACHMENT VISUAL STATE
       ===================================================== */

    const updateAttachmentState =
        ({
            count = 0,
            ready = 0,
            pending = false,
            errors = 0
        } = {}) => {

            state.attachmentCount =
                Math.max(
                    0,
                    Number(count) ||
                    0
                );


            state.readyAttachments =
                Math.max(
                    0,
                    Number(ready) ||
                    0
                );


            state.attachmentErrors =
                Math.max(
                    0,
                    Number(errors) ||
                    0
                );


            state.attachmentsPending =
                Boolean(
                    pending
                );


            state.pendingAttachments =
                state.attachmentsPending
                    ? Math.max(
                        0,
                        state.attachmentCount -
                        state.readyAttachments -
                        state.attachmentErrors
                    )
                    : 0;


            state.hasAttachments =
                state.attachmentCount >
                0;


            /* -----------------------------------------
               CSS STATES
               ----------------------------------------- */

            composer.classList.toggle(
                "has-attachments",
                state.hasAttachments
            );


            composer.classList.toggle(
                "attachments-pending",
                state.attachmentsPending
            );


            composer.classList.toggle(
                "has-attachment-errors",
                state.attachmentErrors >
                0
            );


            composer.classList.toggle(
                "attachments-ready",
                state.hasAttachments &&
                !state.attachmentsPending &&
                state.readyAttachments >
                0
            );


            /* -----------------------------------------
               DATA ATTRIBUTES
               ----------------------------------------- */

            composer.dataset
                .attachmentCount =
                String(
                    state.attachmentCount
                );


            composer.dataset
                .attachmentsPending =
                String(
                    state.attachmentsPending
                );


            composer.dataset
                .attachmentErrors =
                String(
                    state.attachmentErrors
                );


            updateEmptyState();


            emitComposerState();
        };


    /* =====================================================
       EMPTY STATE

       Composer isn't visually empty if files exist,
       even when textarea has no text.
       ===================================================== */

    const updateEmptyState =
        () => {

            const trulyEmpty =
                !state.hasText &&
                !state.hasAttachments;


            composer.classList.toggle(
                "is-empty",
                trulyEmpty
            );


            composer.dataset.empty =
                String(
                    trulyEmpty
                );
        };


    /* =====================================================
       GENERATION STATE
       ===================================================== */

    const setGenerating =
        value => {

            state.generating =
                Boolean(
                    value
                );


            composer.classList.toggle(
                "is-generating",
                state.generating
            );


            composer.dataset.generating =
                String(
                    state.generating
                );


            emitComposerState();
        };


    /* =====================================================
       CAN SEND

       composer.js only reports ability.
       It DOES NOT initiate sending.
       ===================================================== */

    const canSend =
        () => {

            if (
                state.generating
            ) {

                return false;
            }


            if (
                state.attachmentsPending
            ) {

                return false;
            }


            /*
            Text-only
            */

            if (
                state.hasText
            ) {

                return true;
            }


            /*
            Attachment-only
            */

            if (
                state.readyAttachments >
                0
            ) {

                return true;
            }


            return false;
        };


    /* =====================================================
       PUBLIC COMPOSER STATE EVENT
       ===================================================== */

    const emitComposerState =
        () => {

            emit(
                "neyo:composer-change",
                {

                    value:
                        state.value,

                    hasText:
                        state.hasText,

                    isMultiline:
                        state.isMultiline,


                    hasAttachments:
                        state.hasAttachments,

                    attachmentCount:
                        state.attachmentCount,

                    readyAttachments:
                        state.readyAttachments,

                    pendingAttachments:
                        state.pendingAttachments,

                    attachmentErrors:
                        state.attachmentErrors,

                    attachmentsPending:
                        state.attachmentsPending,


                    generating:
                        state.generating,


                    canSend:
                        canSend()
                }
            );
        };


    /* =====================================================
       UPDATE
       ===================================================== */

    const update =
        () => {

            resizeTextarea();


            updateTextState();


            updateEmptyState();


            emitComposerState();
        };


    /* =====================================================
       SET VALUE
       ===================================================== */

    const setValue =
        (
            value,
            {
                focus = false
            } = {}
        ) => {

            textarea.value =
                typeof value ===
                    "string"
                    ? value
                    : "";


            update();


            if (
                focus
            ) {

                try {

                    textarea.focus({
                        preventScroll:
                            true
                    });

                } catch {

                    textarea.focus();
                }
            }
        };


    /* =====================================================
       APPEND VALUE
       ===================================================== */

    const append =
        (
            value,
            {
                focus = true
            } = {}
        ) => {

            const addition =
                typeof value ===
                    "string"
                    ? value
                    : "";


            if (
                !addition
            ) {

                return;
            }


            const current =
                textarea.value;


            textarea.value =
                current
                    ? `${current}${addition}`
                    : addition;


            update();


            if (
                focus
            ) {

                textarea.focus();


                /*
                Cursor to end.
                */

                const length =
                    textarea.value.length;


                try {

                    textarea.setSelectionRange(
                        length,
                        length
                    );

                } catch {}
            }
        };


    /* =====================================================
       RESET TEXT

       IMPORTANT:
       Does NOT clear attachments.

       attachments.js owns attachments.
       ===================================================== */

    const reset =
        () => {

            textarea.value =
                "";


            textarea.style.height =
                `${MIN_HEIGHT}px`;


            state.value =
                "";


            state.hasText =
                false;


            state.isMultiline =
                false;


            composer.classList.remove(
                "has-text",
                "is-multiline"
            );


            updateEmptyState();


            emitComposerState();
        };


    /* =====================================================
       COMPLETE COMPOSER RESET

       Still does not directly clear files.
       It emits request so attachment owner decides.
       ===================================================== */

    const resetAll =
        () => {

            reset();


            emit(
                "neyo:attachments-clear-request"
            );
        };


    /* =====================================================
       FOCUS
       ===================================================== */

    const focus =
        () => {

            try {

                textarea.focus({
                    preventScroll:
                        true
                });

            } catch {

                textarea.focus();
            }
        };


    /* =====================================================
       TEXTAREA EVENTS
       ===================================================== */

    textarea.addEventListener(
        "input",
        update
    );


    /*
    Browser resize changes wrapping,
    therefore textarea scrollHeight can change.
    */

    window.addEventListener(
        "resize",
        resizeTextarea,
        {
            passive:
                true
        }
    );


    /* =====================================================
       ATTACHMENT STATE

       Produced by chat.js after attachments.js changes.
       ===================================================== */

    window.addEventListener(
        "neyo:chat-attachments-state",
        event => {

            const detail =
                event.detail ||
                {};


            updateAttachmentState({

                count:
                    detail.count ||
                    0,

                ready:
                    detail.ready ||
                    0,

                pending:
                    Boolean(
                        detail.pending
                    ),

                errors:
                    detail.errors ||
                    0
            });
        }
    );


    /* =====================================================
       DIRECT ATTACHMENT FALLBACK

       Useful if chat.js loads after attachments.js or
       if attachment component is used independently.

       Does NOT manipulate attachments.
       ===================================================== */

    window.addEventListener(
        "neyo:attachments-change",
        event => {

            const attachments =
                Array.isArray(
                    event.detail
                        ?.attachments
                )
                    ? event.detail
                        .attachments
                    : [];


            const ready =
                attachments.filter(
                    attachment =>
                        attachment.status ===
                        "ready"
                ).length;


            const pending =
                attachments.some(
                    attachment =>
                        [
                            "queued",
                            "authorizing",
                            "uploading",
                            "uploaded",
                            "processing",
                            "queued-processing"
                        ].includes(
                            attachment.status
                        )
                );


            const errors =
                attachments.filter(
                    attachment =>
                        attachment.status ===
                        "error"
                ).length;


            updateAttachmentState({

                count:
                    attachments.length,

                ready,

                pending,

                errors
            });
        }
    );


    /* =====================================================
       CHAT GENERATION STATE
       ===================================================== */

    window.addEventListener(
        "neyo:chat-send-start",
        () => {

            setGenerating(
                true
            );
        }
    );


    window.addEventListener(
        "neyo:chat-send-end",
        () => {

            setGenerating(
                false
            );
        }
    );


    window.addEventListener(
        "neyo:chat-aborted",
        () => {

            setGenerating(
                false
            );
        }
    );


    window.addEventListener(
        "neyo:chat-error",
        () => {

            setGenerating(
                false
            );
        }
    );


    /* =====================================================
       MESSAGE SENT

       Once chat successfully consumes attachments,
       chat.js clears NeyoAttachments.

       We only reset textarea here.
       ===================================================== */

    window.addEventListener(
        "neyo:chat-response",
        () => {

            reset();
        }
    );


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:composer-reset",
        reset
    );


    window.addEventListener(
        "neyo:composer-reset-all",
        resetAll
    );


    window.addEventListener(
        "neyo:composer-refresh",
        update
    );


    window.addEventListener(
        "neyo:composer-focus",
        focus
    );


    window.addEventListener(
        "neyo:composer-set-value",
        event => {

            setValue(
                event.detail
                    ?.value ||
                "",
                {
                    focus:
                        Boolean(
                            event.detail
                                ?.focus
                        )
                }
            );
        }
    );


    window.addEventListener(
        "neyo:composer-append",
        event => {

            append(
                event.detail
                    ?.value ||
                "",
                {
                    focus:
                        event.detail
                            ?.focus !==
                        false
                }
            );
        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoComposer =
        Object.freeze({

            getValue,

            getTrimmedValue,

            setValue,

            append,

            reset,

            resetAll,

            focus,

            refresh:
                update,


            hasText:
                () =>
                    state.hasText,


            hasAttachments:
                () =>
                    state.hasAttachments,


            attachmentsPending:
                () =>
                    state.attachmentsPending,


            canSend,


            getState:
                () => ({

                    value:
                        state.value,

                    hasText:
                        state.hasText,

                    isMultiline:
                        state.isMultiline,

                    hasAttachments:
                        state.hasAttachments,

                    attachmentCount:
                        state.attachmentCount,

                    readyAttachments:
                        state.readyAttachments,

                    pendingAttachments:
                        state.pendingAttachments,

                    attachmentErrors:
                        state.attachmentErrors,

                    attachmentsPending:
                        state.attachmentsPending,

                    generating:
                        state.generating,

                    canSend:
                        canSend()
                }),


            version:
                "composer-v2-attachment-aware"
        });


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    update();


    /*
    If attachments.js loaded before composer.js,
    recover its current state immediately.
    */

    try {

        const attachmentState =
            window
                .NeyoAttachments
                ?.getState
                ?.();


        if (
            attachmentState
        ) {

            const attachments =
                Array.isArray(
                    attachmentState
                        .attachments
                )
                    ? attachmentState
                        .attachments
                    : [];


            updateAttachmentState({

                count:
                    attachments.length,

                ready:
                    attachments.filter(
                        attachment =>
                            attachment.status ===
                            "ready"
                    ).length,

                pending:
                    attachments.some(
                        attachment =>
                            [
                                "queued",
                                "authorizing",
                                "uploading",
                                "uploaded",
                                "processing",
                                "queued-processing"
                            ].includes(
                                attachment.status
                            )
                    ),

                errors:
                    attachments.filter(
                        attachment =>
                            attachment.status ===
                            "error"
                    ).length
            });
        }

    } catch {}


    console.log(
        "[NEYO Composer] Attachment-aware composer ready"
    );

})();
