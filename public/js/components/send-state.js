/*
=========================================================
NEYO — SEND STATE COMPONENT

Owns:
- Send button visual state
- Send / stop icon state
- Generating state
- Disabled / enabled state
- Stop request bridge
- Public send-state API

Does NOT own:
- Chat API
- Composer text
- Attachment upload
- Actual send orchestration
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const sendBtn =
        document.getElementById(
            "sendBtn"
        );


    if (!sendBtn) {
        return;
    }


    /* =====================================================
       STATE
       ===================================================== */

    let generating =
        false;

    let canSend =
        false;


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


    const refreshIcons = () => {

        try {

            window.lucide
                ?.createIcons
                ?.();

        } catch {
            // Ignore icon refresh failures.
        }

    };


    /* =====================================================
       SEND ICON
       ===================================================== */

    const renderSendIcon = () => {

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
            "aria-hidden",
            "true"
        );


        icon.setAttribute(
            "size",
            "18"
        );


        sendBtn.appendChild(
            icon
        );


        sendBtn.classList.remove(
            "is-generating"
        );


        sendBtn.setAttribute(
            "aria-label",
            "Send message"
        );


        sendBtn.setAttribute(
            "data-tooltip",
            "Send message"
        );


        refreshIcons();

    };


    /* =====================================================
       STOP ICON
       ===================================================== */

    const renderStopIcon = () => {

        sendBtn.replaceChildren();


        const stop =
            document.createElement(
                "span"
            );


        stop.className =
            "send-stop-square";


        stop.setAttribute(
            "aria-hidden",
            "true"
        );


        sendBtn.appendChild(
            stop
        );


        sendBtn.classList.add(
            "is-generating"
        );


        sendBtn.setAttribute(
            "aria-label",
            "Stop generating"
        );


        sendBtn.setAttribute(
            "data-tooltip",
            "Stop generating"
        );

    };


    /* =====================================================
       RENDER STATE
       ===================================================== */

    const render = () => {

        if (generating) {

            renderStopIcon();


            sendBtn.disabled =
                false;


            sendBtn.setAttribute(
                "aria-disabled",
                "false"
            );


            return;

        }


        renderSendIcon();


        sendBtn.disabled =
            !canSend;


        sendBtn.setAttribute(
            "aria-disabled",
            String(
                !canSend
            )
        );

    };


    /* =====================================================
       SET GENERATING
       ===================================================== */

    const setGenerating =
        value => {

            generating =
                Boolean(
                    value
                );


            render();


            emit(
                "neyo:send-state-change",
                {
                    generating,
                    canSend
                }
            );


            return generating;

        };


    /* =====================================================
       SET CAN SEND
       ===================================================== */

    const setCanSend =
        value => {

            canSend =
                Boolean(
                    value
                );


            render();


            emit(
                "neyo:send-state-change",
                {
                    generating,
                    canSend
                }
            );


            return canSend;

        };


    /* =====================================================
       CLICK ROUTING
       ===================================================== */

    sendBtn.addEventListener(
        "click",
        event => {

            if (!generating) {
                return;
            }


            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();


            emit(
                "neyo:chat-stop-request"
            );

        },
        true
    );


    /* =====================================================
       CHAT EVENTS
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
        "neyo:chat-error",
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
        "neyo:chat-limit-reached",
        () => {

            setGenerating(
                false
            );

        }
    );


    /* =====================================================
       SEND AVAILABILITY
       ===================================================== */

    window.addEventListener(
        "neyo:send-state-set",
        event => {

            setCanSend(
                event.detail
                    ?.canSend
            );

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    render();


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoSendState =
        Object.freeze({

            setGenerating,

            setCanSend,

            refresh:
                render,

            isGenerating:
                () =>
                    generating,

            canSend:
                () =>
                    canSend,

            getState:
                () => ({
                    generating,
                    canSend
                })

        });

})();
