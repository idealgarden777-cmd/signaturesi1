/*
=========================================================
NEYO — COMPOSER SCROLLBAR CONTROLLER
CLEAN PRODUCTION VERSION

Owns:
- content state
- reliable multiline detection
- overflow detection
- custom scrollbar rail/thumb
- normal + expanded scrollbar sync

Does NOT own:
- textarea autosize
- composer width
- composer shape
- send logic
- voice logic
- attachment logic
- expand/collapse behavior
- neo.js
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
       CREATE CUSTOM SCROLLBAR
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

    let previousExpanded =
        composer.classList.contains(
            "is-writing-expanded"
        );


    /* =====================================================
       BASIC HELPERS
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


    function getTextareaMetrics() {

        const styles =
            window.getComputedStyle(
                textarea
            );


        const lineHeight =
            parseFloat(
                styles.lineHeight
            ) || 22;


        const paddingTop =
            parseFloat(
                styles.paddingTop
            ) || 0;


        const paddingBottom =
            parseFloat(
                styles.paddingBottom
            ) || 0;


        return {
            lineHeight,
            paddingTop,
            paddingBottom
        };

    }


    /* =====================================================
       RELIABLE MULTILINE DETECTION

       Rules:
       - Empty = false
       - Expanded mode = no normal multiline class
       - Explicit Enter/newline = true
       - One visual line = false
       - Actual wrapped second line = true
       ===================================================== */

    function detectMultiline() {

        if (
            isExpanded() ||
            !hasContent()
        ) {
            return false;
        }


        const value =
            textarea.value || "";


        /*
        Explicit newline always means multiline.
        */

        if (
            value.includes("\n")
        ) {
            return true;
        }


        const {
            lineHeight,
            paddingTop,
            paddingBottom
        } =
            getTextareaMetrics();


        /*
        scrollHeight includes vertical padding.
        Remove it before estimating text lines.
        */

        const textHeight =
            Math.max(
                0,
                textarea.scrollHeight -
                paddingTop -
                paddingBottom
            );


        /*
        Browser subpixel rounding can make
        one line appear slightly taller.

        1.35 gives a safe margin so typing:
        "t"
        "hello"
        "hello Samuel"

        does NOT trigger multiline.
        */

        const oneLineLimit =
            lineHeight * 1.35;


        return (
            textHeight >
            oneLineLimit
        );

    }


    /* =====================================================
       OVERFLOW DETECTION

       Works in both:
       - normal multiline
       - expanded writing mode
       ===================================================== */

    function detectOverflow() {

        return (
            textarea.scrollHeight >
            textarea.clientHeight + 2
        );

    }


    /* =====================================================
       SYNC STATE CLASSES
       ===================================================== */

    function syncClasses() {

        const expanded =
            isExpanded();

        const content =
            hasContent();


        const multiline =
            !expanded &&
            content &&
            detectMultiline();


        const overflow =
            content &&
            detectOverflow();


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


        rail.classList.toggle(
            "is-expanded-scrollbar",
            expanded
        );


        return {
            expanded,
            content,
            multiline,
            overflow
        };

    }


    /* =====================================================
       UPDATE CUSTOM THUMB
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


        const scrollTop =
            textarea.scrollTop;


        if (
            railHeight <= 0 ||
            scrollHeight <= clientHeight
        ) {
            return;
        }


        const viewportRatio =
            clientHeight /
            scrollHeight;


        const minimumThumbHeight =
            state.expanded
                ? 24
                : 20;


        const thumbHeight =
            Math.max(
                minimumThumbHeight,
                railHeight *
                    viewportRatio
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


        const scrollProgress =
            Math.min(
                1,
                Math.max(
                    0,
                    scrollTop /
                        maxScroll
                )
            );


        const thumbOffset =
            maxThumbTravel *
            scrollProgress;


        thumb.style.height =
            `${thumbHeight}px`;


        thumb.style.transform =
            `translateY(${thumbOffset}px)`;

    }


    /* =====================================================
       RAF SCHEDULER
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

                    updateThumb();

                }
            );

    }


    /*
    Existing composer code may resize
    textarea one frame after input.

    Two frames ensures we measure the
    FINAL textarea height, not stale height.
    */

    function scheduleAfterLayout() {

        requestAnimationFrame(
            () => {

                requestAnimationFrame(
                    scheduleUpdate
                );

            }
        );

    }


    /* =====================================================
       SCROLLBAR ACTIVE STATE
       ===================================================== */

    function showScrollbarBriefly() {

        if (
            !composer.classList.contains(
                "composer-overflow"
            )
        ) {
            return;
        }


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
                900
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


            /*
            Let legacy autosize / expand
            logic finish first.
            */

            scheduleAfterLayout();

        }
    );


    /* =====================================================
       SCROLL
       ===================================================== */

    textarea.addEventListener(
        "scroll",
        () => {

            showScrollbarBriefly();

            scheduleUpdate();

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
        scheduleAfterLayout
    );


    textarea.addEventListener(
        "blur",
        scheduleUpdate
    );


    /* =====================================================
       RESIZE OBSERVER

       Detects:
       - legacy textarea autosize
       - composer vertical growth
       - expanded height changes
       - responsive layout changes
       ===================================================== */

    const resizeObserver =
        new ResizeObserver(
            () => {

                scheduleUpdate();

            }
        );


    resizeObserver.observe(
        textarea
    );


    resizeObserver.observe(
        composer
    );


    /* =====================================================
       CLASS OBSERVER

       Watches:
       .is-writing-expanded

       Important:
       Ignore our own state classes to avoid
       unnecessary update loops.
       ===================================================== */

    const classObserver =
        new MutationObserver(
            () => {

                const expanded =
                    isExpanded();


                if (
                    expanded ===
                    previousExpanded
                ) {
                    return;
                }


                previousExpanded =
                    expanded;


                scheduleAfterLayout();

            }
        );


    classObserver.observe(
        composer,
        {
            attributes: true,
            attributeFilter: [
                "class"
            ]
        }
    );


    /* =====================================================
       PROGRAMMATIC VALUE CHANGES

       textarea.value changes made by JS
       do not fire "input".

       Covers:
       - send cleanup
       - new chat
       - clear
       - restored draft
       - programmatic prompt insertion
       ===================================================== */

    const valueWatcher =
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


                scheduleAfterLayout();

            },
            180
        );


    /* =====================================================
       MOBILE VIEWPORT
       ===================================================== */

    if (
        window.visualViewport
    ) {

        window.visualViewport
            .addEventListener(
                "resize",
                scheduleAfterLayout,
                {
                    passive: true
                }
            );


        window.visualViewport
            .addEventListener(
                "scroll",
                scheduleUpdate,
                {
                    passive: true
                }
            );

    }


    /* =====================================================
       WINDOW
       ===================================================== */

    window.addEventListener(
        "resize",
        scheduleAfterLayout,
        {
            passive: true
        }
    );


    window.addEventListener(
        "orientationchange",
        scheduleAfterLayout,
        {
            passive: true
        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoComposerScrollbar =
        Object.freeze({

            refresh:
                scheduleAfterLayout,


            getState:
                () => ({

                    expanded:
                        isExpanded(),

                    hasContent:
                        composer.classList.contains(
                            "composer-has-content"
                        ),

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
       INITIAL SYNC
       ===================================================== */

    scheduleAfterLayout();


    window.setTimeout(
        scheduleAfterLayout,
        120
    );


    window.setTimeout(
        scheduleAfterLayout,
        500
    );


    /* =====================================================
       OPTIONAL CLEANUP
       Useful if composer is ever dynamically destroyed.
       ===================================================== */

    window.addEventListener(
        "pagehide",
        () => {

            window.clearInterval(
                valueWatcher
            );

            window.clearTimeout(
                hideTimer
            );

            resizeObserver.disconnect();
            classObserver.disconnect();

        },
        {
            once: true
        }
    );

})();
