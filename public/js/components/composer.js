/*
=========================================================
NEYO — COMPOSER CORE COMPONENT

Purpose:
Handles only the core composer textarea behavior.

Owns:
- Textarea auto-resize
- Composer text state
- Empty / filled state
- Composer input events
- Custom composer events

Does NOT own:
- Send message
- Attachments
- Voice / microphone
- Suggestions
- Expand / collapse
- Chat API
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const composer = document.getElementById(
        "glassInputContainer"
    );

    const textarea = document.getElementById(
        "chatInput"
    );


    /* =====================================================
       SAFETY
       ===================================================== */

    if (!composer || !textarea) {
        return;
    }


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const MIN_HEIGHT = 38;
    const MAX_HEIGHT = 160;


    /* =====================================================
       TEXTAREA RESIZE
       ===================================================== */

    const resizeTextarea = () => {

        textarea.style.height = "auto";

        const nextHeight = Math.min(
            Math.max(
                textarea.scrollHeight,
                MIN_HEIGHT
            ),
            MAX_HEIGHT
        );

        textarea.style.height =
            `${nextHeight}px`;
    };


    /* =====================================================
       COMPOSER STATE
       ===================================================== */

    const updateComposerState = () => {

        const value = textarea.value.trim();

        const hasText =
            value.length > 0;

        const isMultiline =
            textarea.scrollHeight >
            MIN_HEIGHT;

        composer.classList.toggle(
            "has-text",
            hasText
        );

        composer.classList.toggle(
            "is-multiline",
            isMultiline
        );

        composer.dataset.empty =
            String(!hasText);


        /*
        Public event for future components.

        Example:
        send-state.js can listen for this
        without directly depending on composer.js.
        */

        window.dispatchEvent(
            new CustomEvent(
                "neyo:composer-change",
                {
                    detail: {
                        value:
                            textarea.value,

                        hasText,

                        isMultiline
                    }
                }
            )
        );
    };


    /* =====================================================
       UPDATE
       ===================================================== */

    const update = () => {

        resizeTextarea();

        updateComposerState();
    };


    /* =====================================================
       RESET
       ===================================================== */

    const reset = () => {

        textarea.value = "";

        textarea.style.height =
            `${MIN_HEIGHT}px`;

        updateComposerState();
    };


    /* =====================================================
       EVENTS
       ===================================================== */

    textarea.addEventListener(
        "input",
        update
    );


    /*
    Browser resize can change text wrapping,
    therefore scrollHeight can also change.
    */

    window.addEventListener(
        "resize",
        resizeTextarea,
        {
            passive: true
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
        "neyo:composer-refresh",
        update
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    update();

})();
