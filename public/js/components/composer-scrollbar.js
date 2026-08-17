/*
=========================================================
NEYO — COMPOSER SCROLLBAR / TYPING CONTROL
SIMPLE PRODUCTION VERSION

Owns:
- reliable multiline detection
- textarea height control
- max-height behavior
- internal scrolling after max-height
- custom scrollbar sync
- cursor visibility during long typing

Does NOT own:
- composer width
- composer shape
- + / mic / send positioning
- send logic
- voice logic
- attachments
- expand/collapse logic
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


    if (!composer || !textarea) {
        return;
    }


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG = Object.freeze({

        desktopMaxHeight: 132,

        mobileMaxHeight: 112,

        landscapeMaxHeight: 92,

        compactHeight: 40,

        multilineTolerance: 1.35,

        overflowTolerance: 2

    });


    /* =====================================================
       CUSTOM SCROLLBAR
       ===================================================== */

    let rail =
        composer.querySelector(
            ".composer-custom-scrollbar"
        );


    let thumb = null;


    if (!rail) {

        rail =
            document.createElement(
                "div"
            );


        rail.className =
            "composer-custom-scrollbar";


        rail.setAttribute(
            "aria-hidden",
            "true"
        );


        thumb =
            document.createElement(
                "div"
            );


        thumb.className =
            "composer-custom-scrollbar-thumb";


        rail.appendChild(
            thumb
        );


        composer.appendChild(
            rail
        );

    } else {

        thumb =
            rail.querySelector(
                ".composer-custom-scrollbar-thumb"
            );

    }


    if (!thumb) {
        return;
    }


    /* =====================================================
       INTERNAL STATE
       ===================================================== */

    let rafId = 0;

    let hideTimer = 0;

    let previousValue =
        textarea.value;


    /* =====================================================
       HELPERS
       ===================================================== */

    function isExpanded() {

        return composer.classList.contains(
            "is-writing-expanded"
        );

    }


    function hasContent() {

        return (
            textarea.value
                .trim()
                .length > 0
        );

    }


    function isMobile() {

        return (
            window.matchMedia(
                "(max-width: 767px)"
            ).matches
        );

    }


    function isLandscapePhone() {

        return (
            window.matchMedia(
                "(max-height: 520px) and (orientation: landscape)"
            ).matches
        );

    }


    function getMaxTextareaHeight() {

        if (isLandscapePhone()) {
            return CONFIG.landscapeMaxHeight;
        }


        if (isMobile()) {
            return CONFIG.mobileMaxHeight;
        }


        return CONFIG.desktopMaxHeight;

    }


    function getMetrics() {

        const styles =
            window.getComputedStyle(
                textarea
            );


        return {

            lineHeight:
                parseFloat(
                    styles.lineHeight
                ) || 22,

            paddingTop:
                parseFloat(
                    styles.paddingTop
                ) || 0,

            paddingBottom:
                parseFloat(
                    styles.paddingBottom
                ) || 0

        };

    }


    /* =====================================================
       MULTILINE DETECTION
       ===================================================== */

    function detectMultiline() {

        if (
            !hasContent() ||
            isExpanded()
        ) {
            return false;
        }


        const value =
            textarea.value || "";


        /*
        Explicit Enter always means multiline.
        */

        if (value.includes("\n")) {
            return true;
        }


        const {
            lineHeight,
            paddingTop,
            paddingBottom
        } =
            getMetrics();


        const textHeight =
            Math.max(
                0,
                textarea.scrollHeight -
                paddingTop -
                paddingBottom
            );


        return (
            textHeight >
            lineHeight *
                CONFIG.multilineTolerance
        );

    }


    /* =====================================================
       AUTOSIZE

       Key behavior:
       - one line = compact
       - multiline grows
       - stops at max-height
       - after that textarea scrolls internally
       ===================================================== */

    function resizeTextarea() {

        if (isExpanded()) {
            return;
        }


        const content =
            hasContent();


        if (!content) {

            textarea.style.height =
                `${CONFIG.compactHeight}px`;


            textarea.style.overflowY =
                "hidden";


            return;
        }


        /*
        Reset first so scrollHeight represents
        actual content height.
        */

        textarea.style.height =
            "auto";


        const multiline =
            detectMultiline();


        if (!multiline) {

            textarea.style.height =
                `${CONFIG.compactHeight}px`;


            textarea.style.overflowY =
                "hidden";


            return;
        }


        const maxHeight =
            getMaxTextareaHeight();


        const targetHeight =
            Math.min(
                textarea.scrollHeight,
                maxHeight
            );


        textarea.style.height =
            `${targetHeight}px`;


        textarea.style.overflowY =
            textarea.scrollHeight >
            maxHeight +
                CONFIG.overflowTolerance

                ? "auto"
                : "hidden";

    }


    /* =====================================================
       CURSOR VISIBILITY

       When user keeps typing after max-height,
       keep the caret visible inside textarea.
       ===================================================== */

    function keepCaretVisible() {

        if (
            isExpanded() ||
            textarea.scrollHeight <=
                textarea.clientHeight +
                    CONFIG.overflowTolerance
        ) {
            return;
        }


        /*
        Browser normally keeps caret visible,
        but this stabilizes mobile behavior when
        textarea height changes during input.
        */

        textarea.scrollTop =
            textarea.scrollHeight;

    }


    /* =====================================================
       STATE CLASSES
       ===================================================== */

    function syncClasses() {

        const content =
            hasContent();


        const multiline =
            content &&
            !isExpanded() &&
            detectMultiline();


        const overflow =
            textarea.scrollHeight >
            textarea.clientHeight +
                CONFIG.overflowTolerance;


        composer.classList.toggle(
            "composer-has-content",
            content
        );


        composer.classList.toggle(
            "composer-multiline",
            multiline
        );


        composer.classList.toggle(
            "composer-overflow",
            overflow
        );


        rail.classList.toggle(
            "is-visible",
            overflow
        );


        return {
            content,
            multiline,
            overflow
        };

    }


    /* =====================================================
       CUSTOM SCROLLBAR THUMB
       ===================================================== */

    function updateThumb() {

        const state =
            syncClasses();


        if (!state.overflow) {

            thumb.style.height =
                "";

            thumb.style.transform =
                "";

            rail.classList.remove(
                "is-active"
            );


            return;
        }


        const railHeight =
            rail.clientHeight;


        const scrollHeight =
            textarea.scrollHeight;


        const clientHeight =
            textarea.clientHeight;


        if (
            railHeight <= 0 ||
            scrollHeight <= clientHeight
        ) {
            return;
        }


        const minimumThumbHeight =
            isExpanded()
                ? 24
                : 20;


        const thumbHeight =
            Math.max(
                minimumThumbHeight,
                railHeight *
                (
                    clientHeight /
                    scrollHeight
                )
            );


        const maxThumbTravel =
            Math.max(
                0,
                railHeight -
                    thumbHeight
            );


        const maxScroll =
            Math.max(
                1,
                scrollHeight -
                    clientHeight
            );


        const progress =
            Math.min(
                1,
                Math.max(
                    0,
                    textarea.scrollTop /
                        maxScroll
                )
            );


        thumb.style.height =
            `${thumbHeight}px`;


        thumb.style.transform =
            `translateY(${maxThumbTravel * progress}px)`;

    }


    /* =====================================================
       FULL UPDATE
       ===================================================== */

    function updateComposer() {

        resizeTextarea();


        /*
        Wait one frame after height update so
        measurements are final.
        */

        requestAnimationFrame(
            () => {

                syncClasses();

                updateThumb();

            }
        );

    }


    /* =====================================================
       SCHEDULER
       ===================================================== */

    function scheduleUpdate() {

        if (rafId) {

            cancelAnimationFrame(
                rafId
            );

        }


        rafId =
            requestAnimationFrame(
                () => {

                    rafId = 0;

                    updateComposer();

                }
            );

    }


    /* =====================================================
       INPUT
       ===================================================== */

    textarea.addEventListener(
        "input",
        () => {

            previousValue =
                textarea.value;


            scheduleUpdate();


            /*
            One extra frame after resize is useful
            on mobile keyboards.
            */

            requestAnimationFrame(
                () => {

                    keepCaretVisible();

                }
            );

        }
    );


    /* =====================================================
       SCROLL
       ===================================================== */

    textarea.addEventListener(
        "scroll",
        () => {

            rail.classList.add(
                "is-active"
            );


            window.clearTimeout(
                hideTimer
            );


            hideTimer =
                window.setTimeout(
                    () => {

                        rail.classList.remove(
                            "is-active"
                        );

                    },
                    800
                );


            updateThumb();

        },
        {
            passive: true
        }
    );


    /* =====================================================
       FOCUS
       ===================================================== */

    textarea.addEventListener(
        "focus",
        scheduleUpdate
    );


    /* =====================================================
       PROGRAMMATIC VALUE CHANGES

       Covers:
       - voice transcription
       - prompt insertion
       - send clear
       - new chat
       - restored draft
       ===================================================== */

    window.setInterval(
        () => {

            const currentValue =
                textarea.value;


            if (
                currentValue ===
                previousValue
            ) {
                return;
            }


            previousValue =
                currentValue;


            scheduleUpdate();

        },
        180
    );


    /* =====================================================
       WINDOW RESIZE

       Important for:
       - mobile portrait/landscape
       - responsive wrap width
       ===================================================== */

    window.addEventListener(
        "resize",
        scheduleUpdate,
        {
            passive: true
        }
    );


    window.addEventListener(
        "orientationchange",
        scheduleUpdate,
        {
            passive: true
        }
    );


    /* =====================================================
       VISUAL VIEWPORT

       Simple mobile keyboard support.
       No new layout system.
       ===================================================== */

    if (window.visualViewport) {

        window.visualViewport
            .addEventListener(
                "resize",
                scheduleUpdate,
                {
                    passive: true
                }
            );

    }


    /* =====================================================
       EXPAND STATE OBSERVER
       ===================================================== */

    const observer =
        new MutationObserver(
            mutations => {

                const changed =
                    mutations.some(
                        mutation =>
                            mutation.type ===
                                "attributes" &&
                            mutation.attributeName ===
                                "class"
                    );


                if (!changed) {
                    return;
                }


                scheduleUpdate();

            }
        );


    observer.observe(
        composer,
        {
            attributes: true,
            attributeFilter: [
                "class"
            ]
        }
    );


    /* =====================================================
       PUBLIC REFRESH
       ===================================================== */

    window.NeyoComposerScrollbar =
        Object.freeze({

            refresh:
                scheduleUpdate,

            getState:
                () => ({

                    expanded:
                        isExpanded(),

                    multiline:
                        composer.classList.contains(
                            "composer-multiline"
                        ),

                    overflow:
                        composer.classList.contains(
                            "composer-overflow"
                        )

                })

        });


    /* =====================================================
       INITIALIZE
       ===================================================== */

    scheduleUpdate();


    window.setTimeout(
        scheduleUpdate,
        100
    );

})();
