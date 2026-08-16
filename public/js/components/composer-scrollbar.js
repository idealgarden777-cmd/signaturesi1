/*
=========================================================
NEYO — COMPOSER SCROLLBAR CONTROLLER
FINAL NORMAL + EXPANDED VERSION

Owns:
- multiline detection
- overflow detection
- custom scrollbar rail/thumb
- normal + expanded scrollbar sync

Does NOT own:
- textarea autosize
- expand/collapse behavior
- send logic
- voice logic
- attachments
- neo.js
=========================================================
*/

(() => {
    "use strict";

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
       STATE
       ===================================================== */

    let rafId = 0;
    let hideTimer = 0;


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


    function getLineHeight() {

        const styles =
            window.getComputedStyle(
                textarea
            );

        const parsed =
            parseFloat(
                styles.lineHeight
            );


        return Number.isFinite(
            parsed
        )
            ? parsed
            : 22;

    }


    /* =====================================================
       MULTILINE DETECTION

       Important:
       Multiline layout class is used
       ONLY in normal composer mode.

       Expanded mode remains owned by
       composer-expand.css.
       ===================================================== */

    function detectMultiline() {

        if (
            isExpanded() ||
            !hasContent()
        ) {
            return false;
        }


        const lineHeight =
            getLineHeight();


        const explicitLines =
            textarea.value
                .split("\n")
                .length;


        const visualLines =
            textarea.scrollHeight /
            Math.max(
                lineHeight,
                1
            );


        return (
            explicitLines > 1 ||
            visualLines > 1.55
        );

    }


    /* =====================================================
       OVERFLOW

       Works in BOTH:
       - normal composer
       - expanded composer
       ===================================================== */

    function detectOverflow() {

        return (
            textarea.scrollHeight >
            textarea.clientHeight + 2
        );

    }


    /* =====================================================
       STATE CLASSES
       ===================================================== */

    function syncClasses() {

        const expanded =
            isExpanded();

        const content =
            hasContent();

        const multiline =
            detectMultiline();

        const overflow =
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
       THUMB POSITION
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


        const minimumThumb =
            state.expanded
                ? 24
                : 20;


        const thumbHeight =
            Math.max(
                minimumThumb,
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


        const progress =
            Math.min(
                1,
                Math.max(
                    0,
                    scrollTop /
                        maxScroll
                )
            );


        thumb.style.height =
            `${thumbHeight}px`;


        thumb.style.transform =
            `translateY(${
                maxThumbTravel *
                progress
            }px)`;

    }


    /* =====================================================
       SCHEDULE
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


    /* =====================================================
       ACTIVE VISIBILITY
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


        clearTimeout(
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

            /*
            Let neo.js / composer-expand.js
            finish textarea resizing first.
            */

            requestAnimationFrame(
                scheduleUpdate
            );

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
        scheduleUpdate
    );


    textarea.addEventListener(
        "blur",
        scheduleUpdate
    );


    /* =====================================================
       RESIZE OBSERVER

       Detect:
       - normal autosize
       - expand
       - collapse
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
       EXPAND CLASS OBSERVER
       ===================================================== */

    let previousExpandedState =
        isExpanded();


    const classObserver =
        new MutationObserver(
            () => {

                const currentExpanded =
                    isExpanded();


                if (
                    currentExpanded ===
                    previousExpandedState
                ) {
                    return;
                }


                previousExpandedState =
                    currentExpanded;


                /*
                Expand/collapse CSS needs
                one paint before measuring.
                */

                requestAnimationFrame(
                    () => {

                        requestAnimationFrame(
                            scheduleUpdate
                        );

                    }
                );

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
       MOBILE VIEWPORT
       ===================================================== */

    if (
        window.visualViewport
    ) {

        window.visualViewport
            .addEventListener(
                "resize",
                scheduleUpdate,
                {
                    passive: true
                }
            );

    }


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
       PUBLIC API
       ===================================================== */

    window.NeyoComposerScrollbar =
        Object.freeze({

            refresh:
                scheduleUpdate,


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

    scheduleUpdate();


    window.setTimeout(
        scheduleUpdate,
        120
    );


    window.setTimeout(
        scheduleUpdate,
        500
    );

})();
