/*
=========================================================
NEYO — MOBILE KEYBOARD COMPONENT

Owns:
- Keyboard focus coordination
- Composer focus behavior
- Keep latest messages visible
- Prevent whole-page scroll jumps
- Keyboard open/close lifecycle
- Public keyboard API

Does NOT own:
- Viewport measurement
- Composer styling
- Topbar styling
- Chat rendering
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const chatInput =
        document.getElementById(
            "chatInput"
        );

    const scrollArea =
        document.getElementById(
            "scrollArea"
        );

    const composerDock =
        document.querySelector(
            ".composer-dock"
        );


    if (
        !chatInput ||
        !scrollArea
    ) {
        return;
    }


    /* =====================================================
       STATE
       ===================================================== */

    let keyboardOpen =
        false;

    let wasNearBottom =
        true;

    let scrollFrame =
        null;


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


    const isMobile = () => {

        return (
            window.NeyoResponsive
                ?.isMobile?.() ??
            window.matchMedia(
                "(max-width: 767px)"
            ).matches
        );

    };


    const distanceFromBottom = () => {

        return (
            scrollArea.scrollHeight -
            scrollArea.scrollTop -
            scrollArea.clientHeight
        );

    };


    const isNearBottom = (
        threshold = 120
    ) => {

        return (
            distanceFromBottom() <=
            threshold
        );

    };


    /* =====================================================
       SCROLL TO BOTTOM
       ===================================================== */

    const scrollToBottom = (
        behavior = "auto"
    ) => {

        if (scrollFrame) {

            cancelAnimationFrame(
                scrollFrame
            );

        }


        scrollFrame =
            requestAnimationFrame(
                () => {

                    scrollFrame =
                        null;


                    scrollArea.scrollTo({
                        top:
                            scrollArea.scrollHeight,

                        behavior
                    });

                }
            );

    };


    /* =====================================================
       STABILIZE VIEW
       ===================================================== */

    const stabilizeKeyboardView = () => {

        if (!isMobile()) {
            return;
        }


        /*
        If user was already reading latest
        content, keep them at the bottom.

        If user intentionally scrolled upward,
        do not yank them back down.
        */

        if (wasNearBottom) {

            scrollToBottom(
                "auto"
            );

        }


        emit(
            "neyo:mobile-keyboard-stabilized",
            {
                keyboardOpen
            }
        );

    };


    /* =====================================================
       PREVENT BODY SCROLL JUMPS
       ===================================================== */

    const resetDocumentScroll = () => {

        if (!isMobile()) {
            return;
        }


        /*
        Our app-shell is fixed.
        The document itself should stay at Y=0.
        */

        if (
            window.scrollY !== 0
        ) {

            window.scrollTo(
                0,
                0
            );

        }

    };


    /* =====================================================
       INPUT FOCUS
       ===================================================== */

    chatInput.addEventListener(
        "focus",
        () => {

            if (!isMobile()) {
                return;
            }


            wasNearBottom =
                isNearBottom();


            document.documentElement
                .classList
                .add(
                    "composer-focused"
                );


            document.body
                ?.classList
                .add(
                    "composer-focused"
                );


            /*
            Browser keyboard animation takes time.
            These checkpoints keep the shell stable
            during Safari / Chrome transitions.
            */

            [
                0,
                80,
                180,
                320
            ].forEach(
                delay => {

                    window.setTimeout(
                        () => {

                            resetDocumentScroll();

                            stabilizeKeyboardView();

                        },
                        delay
                    );

                }
            );


            emit(
                "neyo:mobile-composer-focus"
            );

        }
    );


    /* =====================================================
       INPUT BLUR
       ===================================================== */

    chatInput.addEventListener(
        "blur",
        () => {

            document.documentElement
                .classList
                .remove(
                    "composer-focused"
                );


            document.body
                ?.classList
                .remove(
                    "composer-focused"
                );


            window.setTimeout(
                () => {

                    resetDocumentScroll();

                },
                120
            );


            emit(
                "neyo:mobile-composer-blur"
            );

        }
    );


    /* =====================================================
       VISUAL VIEWPORT CONNECTION
       ===================================================== */

    window.addEventListener(
        "neyo:mobile-viewport-change",
        event => {

            const nextKeyboardState =
                Boolean(
                    event.detail
                        ?.keyboardOpen
                );


            const changed =
                nextKeyboardState !==
                keyboardOpen;


            keyboardOpen =
                nextKeyboardState;


            if (!isMobile()) {
                return;
            }


            resetDocumentScroll();


            if (keyboardOpen) {

                stabilizeKeyboardView();

            }


            if (changed) {

                emit(
                    keyboardOpen
                        ? "neyo:mobile-keyboard-open"
                        : "neyo:mobile-keyboard-close",
                    {
                        keyboardHeight:
                            event.detail
                                ?.keyboardHeight ||
                            0
                    }
                );

            }

        }
    );


    /* =====================================================
       TRACK USER SCROLL POSITION
       ===================================================== */

    scrollArea.addEventListener(
        "scroll",
        () => {

            if (!keyboardOpen) {
                return;
            }


            wasNearBottom =
                isNearBottom();

        },
        {
            passive: true
        }
    );


    /* =====================================================
       NEW MESSAGE
       ===================================================== */

    window.addEventListener(
        "neyo:chat-message-added",
        () => {

            if (
                !isMobile() ||
                !isNearBottom(
                    180
                )
            ) {
                return;
            }


            window.setTimeout(
                () => {

                    scrollToBottom(
                        "smooth"
                    );

                },
                20
            );

        }
    );


    /* =====================================================
       MESSAGE RENDER COMPLETE
       ===================================================== */

    window.addEventListener(
        "neyo:message-rendered",
        () => {

            if (
                !isMobile() ||
                !keyboardOpen ||
                !wasNearBottom
            ) {
                return;
            }


            /*
            Markdown / images can change height
            after message shell was created.
            */

            requestAnimationFrame(
                () => {

                    scrollToBottom(
                        "auto"
                    );

                }
            );

        }
    );


    /* =====================================================
       ORIENTATION
       ===================================================== */

    window.addEventListener(
        "orientationchange",
        () => {

            window.setTimeout(
                () => {

                    resetDocumentScroll();

                    stabilizeKeyboardView();

                },
                250
            );

        }
    );


    /* =====================================================
       COMPOSER DOCK SAFETY
       ===================================================== */

    if (composerDock) {

        composerDock.addEventListener(
            "touchmove",
            event => {

                /*
                Prevent accidental vertical scrolling
                on the composer itself.

                Horizontal suggestion scrolling remains
                owned by the suggestions rail.
                */

                if (
                    event.target.closest(
                        ".live-suggestions"
                    )
                ) {
                    return;
                }

            },
            {
                passive: true
            }
        );

    }


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:mobile-scroll-bottom-request",
        () => {

            scrollToBottom(
                "smooth"
            );

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    wasNearBottom =
        isNearBottom();


    resetDocumentScroll();


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoMobileKeyboard =
        Object.freeze({

            scrollToBottom,

            stabilize:
                stabilizeKeyboardView,

            isKeyboardOpen:
                () =>
                    keyboardOpen,

            isNearBottom,

            getDistanceFromBottom:
                distanceFromBottom

        });

})();
