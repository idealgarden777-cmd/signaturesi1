/*
=========================================================
NEYO — MOBILE VIEWPORT COMPONENT

Owns:
- VisualViewport tracking
- Mobile keyboard detection
- Viewport height CSS variables
- Viewport top offset
- Keyboard height estimate
- Keyboard open/close state
- Public viewport API

Does NOT own:
- Composer styling
- Topbar styling
- Chat scroll styling
- Keyboard dismissal
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const KEYBOARD_THRESHOLD =
        120;


    /* =====================================================
       STATE
       ===================================================== */

    let keyboardOpen =
        false;

    let layoutViewportHeight =
        window.innerHeight;

    let visualViewportHeight =
        window.visualViewport
            ?.height ||
        window.innerHeight;

    let visualViewportOffsetTop =
        window.visualViewport
            ?.offsetTop ||
        0;

    let keyboardHeight =
        0;

    let frameId =
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


    const px =
        value =>
            `${Math.max(
                0,
                Number(value) || 0
            )}px`;


    /* =====================================================
       CALCULATE
       ===================================================== */

    const calculateState = () => {

        const viewport =
            window.visualViewport;


        layoutViewportHeight =
            window.innerHeight;


        visualViewportHeight =
            viewport?.height ||
            layoutViewportHeight;


        visualViewportOffsetTop =
            viewport?.offsetTop ||
            0;


        const estimatedKeyboard =
            layoutViewportHeight -
            visualViewportHeight -
            visualViewportOffsetTop;


        keyboardHeight =
            Math.max(
                0,
                estimatedKeyboard
            );


        keyboardOpen =
            keyboardHeight >=
            KEYBOARD_THRESHOLD;

    };


    /* =====================================================
       CSS VARIABLES
       ===================================================== */

    const applyCssVariables = () => {

        const root =
            document.documentElement;


        root.style.setProperty(
            "--layout-viewport-height",
            px(
                layoutViewportHeight
            )
        );


        root.style.setProperty(
            "--visual-viewport-height",
            px(
                visualViewportHeight
            )
        );


        root.style.setProperty(
            "--visual-viewport-offset-top",
            px(
                visualViewportOffsetTop
            )
        );


        root.style.setProperty(
            "--keyboard-height",
            px(
                keyboardHeight
            )
        );


        root.style.setProperty(
            "--app-height",
            px(
                visualViewportHeight
            )
        );


        root.classList.toggle(
            "keyboard-open",
            keyboardOpen
        );


        root.classList.toggle(
            "keyboard-closed",
            !keyboardOpen
        );


        document.body
            ?.classList
            .toggle(
                "keyboard-open",
                keyboardOpen
            );

    };


    /* =====================================================
       UPDATE
       ===================================================== */

    const update = (
        source = "viewport"
    ) => {

        calculateState();

        applyCssVariables();


        emit(
            "neyo:mobile-viewport-change",
            {
                source,

                keyboardOpen,

                keyboardHeight,

                layoutViewportHeight,

                visualViewportHeight,

                visualViewportOffsetTop
            }
        );

    };


    /* =====================================================
       RAF THROTTLE
       ===================================================== */

    const scheduleUpdate = (
        source
    ) => {

        if (frameId) {
            return;
        }


        frameId =
            requestAnimationFrame(
                () => {

                    frameId =
                        null;


                    update(
                        source
                    );

                }
            );

    };


    /* =====================================================
       WINDOW RESIZE
       ===================================================== */

    window.addEventListener(
        "resize",
        () => {

            scheduleUpdate(
                "window-resize"
            );

        },
        {
            passive: true
        }
    );


    /* =====================================================
       VISUAL VIEWPORT
       ===================================================== */

    if (
        window.visualViewport
    ) {

        window.visualViewport
            .addEventListener(
                "resize",
                () => {

                    scheduleUpdate(
                        "visual-resize"
                    );

                },
                {
                    passive: true
                }
            );


        window.visualViewport
            .addEventListener(
                "scroll",
                () => {

                    scheduleUpdate(
                        "visual-scroll"
                    );

                },
                {
                    passive: true
                }
            );

    }


    /* =====================================================
       ORIENTATION
       ===================================================== */

    window.addEventListener(
        "orientationchange",
        () => {

            window.setTimeout(
                () => {

                    update(
                        "orientation"
                    );

                },
                120
            );

        }
    );


    /* =====================================================
       FOCUS
       ===================================================== */

    document.addEventListener(
        "focusin",
        event => {

            const target =
                event.target;


            if (
                target instanceof
                    HTMLInputElement ||
                target instanceof
                    HTMLTextAreaElement ||
                target instanceof
                    HTMLSelectElement ||
                target?.isContentEditable
            ) {

                window.setTimeout(
                    () => {

                        update(
                            "focusin"
                        );

                    },
                    80
                );

            }

        }
    );


    /* =====================================================
       FOCUS OUT
       ===================================================== */

    document.addEventListener(
        "focusout",
        () => {

            /*
            Mobile browsers animate keyboard close.
            A few delayed checks make the final
            viewport state much more reliable.
            */

            [
                50,
                180,
                350
            ].forEach(
                delay => {

                    window.setTimeout(
                        () => {

                            update(
                                "focusout"
                            );

                        },
                        delay
                    );

                }
            );

        }
    );


    /* =====================================================
       PAGE RESTORE
       ===================================================== */

    window.addEventListener(
        "pageshow",
        () => {

            update(
                "pageshow"
            );

        }
    );


    /* =====================================================
       VISIBILITY
       ===================================================== */

    document.addEventListener(
        "visibilitychange",
        () => {

            if (
                !document.hidden
            ) {

                window.setTimeout(
                    () => {

                        update(
                            "visibility"
                        );

                    },
                    50
                );

            }

        }
    );


    /* =====================================================
       PUBLIC REFRESH
       ===================================================== */

    window.addEventListener(
        "neyo:mobile-viewport-refresh",
        () => {

            update(
                "manual"
            );

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    update(
        "initial"
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoMobileViewport =
        Object.freeze({

            refresh:
                () =>
                    update(
                        "manual"
                    ),

            isKeyboardOpen:
                () =>
                    keyboardOpen,

            getKeyboardHeight:
                () =>
                    keyboardHeight,

            getVisualHeight:
                () =>
                    visualViewportHeight,

            getLayoutHeight:
                () =>
                    layoutViewportHeight,

            getOffsetTop:
                () =>
                    visualViewportOffsetTop,

            getState:
                () => ({
                    keyboardOpen,
                    keyboardHeight,
                    layoutViewportHeight,
                    visualViewportHeight,
                    visualViewportOffsetTop
                })

        });

})();
