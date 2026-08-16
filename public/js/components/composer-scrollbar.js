/*
=========================================================
NEYO — COMPOSER SCROLLBAR
Custom premium textarea scrollbar

Owns:
- Custom rail + thumb
- Overflow detection
- Thumb position / size
- Mobile-safe sync
- Resize / input / scroll handling

Does NOT own:
- Composer autosize
- Message sending
- Keyboard logic
- neo.js
=========================================================
*/

(() => {
    "use strict";

    const chatInput =
        document.getElementById("chatInput");

    const glassInputContainer =
        document.getElementById("glassInputContainer");

    if (!chatInput || !glassInputContainer) {
        return;
    }


    /* =====================================================
       CREATE SCROLLBAR
       ===================================================== */

    let scrollbar =
        glassInputContainer.querySelector(
            ".composer-custom-scrollbar"
        );

    let thumb = null;


    if (!scrollbar) {
        scrollbar =
            document.createElement("div");

        scrollbar.className =
            "composer-custom-scrollbar";

        scrollbar.setAttribute(
            "aria-hidden",
            "true"
        );


        thumb =
            document.createElement("div");

        thumb.className =
            "composer-custom-scrollbar-thumb";


        scrollbar.appendChild(thumb);

        glassInputContainer.appendChild(
            scrollbar
        );
    } else {
        thumb =
            scrollbar.querySelector(
                ".composer-custom-scrollbar-thumb"
            );
    }


    if (!thumb) {
        return;
    }


    /* =====================================================
       STATE
       ===================================================== */

    let rafId = null;
    let hideTimer = null;


    /* =====================================================
       HELPERS
       ===================================================== */

    function scheduleUpdate() {
        if (rafId) {
            cancelAnimationFrame(rafId);
        }

        rafId =
            requestAnimationFrame(() => {
                rafId = null;
                updateScrollbar();
            });
    }


    function showScrollbar() {
        scrollbar.classList.add("is-active");

        clearTimeout(hideTimer);

        hideTimer =
            window.setTimeout(() => {
                scrollbar.classList.remove(
                    "is-active"
                );
            }, 900);
    }


    /* =====================================================
       UPDATE
       ===================================================== */

    function updateScrollbar() {
        const scrollHeight =
            chatInput.scrollHeight;

        const clientHeight =
            chatInput.clientHeight;

        const scrollTop =
            chatInput.scrollTop;


        const hasOverflow =
            scrollHeight >
            clientHeight + 2;


        scrollbar.classList.toggle(
            "is-visible",
            hasOverflow
        );


        if (!hasOverflow) {
            thumb.style.height = "";
            thumb.style.transform = "";
            return;
        }


        const railHeight =
            scrollbar.clientHeight;


        if (railHeight <= 0) {
            return;
        }


        const viewportRatio =
            clientHeight / scrollHeight;


        const minThumbHeight =
            22;


        const thumbHeight =
            Math.max(
                minThumbHeight,
                railHeight * viewportRatio
            );


        const maxThumbTravel =
            Math.max(
                0,
                railHeight - thumbHeight
            );


        const maxScroll =
            Math.max(
                1,
                scrollHeight - clientHeight
            );


        const scrollRatio =
            Math.min(
                1,
                Math.max(
                    0,
                    scrollTop / maxScroll
                )
            );


        const thumbOffset =
            maxThumbTravel * scrollRatio;


        thumb.style.height =
            `${thumbHeight}px`;


        thumb.style.transform =
            `translateY(${thumbOffset}px)`;
    }


    /* =====================================================
       INPUT / SCROLL
       ===================================================== */

    chatInput.addEventListener(
        "input",
        () => {
            scheduleUpdate();
        },
        {
            passive: true
        }
    );


    chatInput.addEventListener(
        "scroll",
        () => {
            showScrollbar();
            scheduleUpdate();
        },
        {
            passive: true
        }
    );


    chatInput.addEventListener(
        "focus",
        () => {
            scheduleUpdate();
        }
    );


    chatInput.addEventListener(
        "blur",
        () => {
            scheduleUpdate();
        }
    );


    /* =====================================================
       POINTER / TOUCH ACTIVITY
       ===================================================== */

    chatInput.addEventListener(
        "pointerdown",
        () => {
            if (
                scrollbar.classList.contains(
                    "is-visible"
                )
            ) {
                showScrollbar();
            }
        },
        {
            passive: true
        }
    );


    chatInput.addEventListener(
        "touchmove",
        () => {
            showScrollbar();
        },
        {
            passive: true
        }
    );


    /* =====================================================
       RESIZE
       ===================================================== */

    const resizeObserver =
        new ResizeObserver(() => {
            scheduleUpdate();
        });


    resizeObserver.observe(chatInput);
    resizeObserver.observe(
        glassInputContainer
    );


    /* =====================================================
       MUTATION WATCH
       Useful if other composer modules
       change classes / layout.
       ===================================================== */

    const mutationObserver =
        new MutationObserver(() => {
            scheduleUpdate();
        });


    mutationObserver.observe(
        glassInputContainer,
        {
            attributes: true,
            childList: true,
            subtree: false
        }
    );


    /* =====================================================
       VISUAL VIEWPORT
       Mobile keyboard / orientation
       ===================================================== */

    if (window.visualViewport) {
        window.visualViewport.addEventListener(
            "resize",
            scheduleUpdate,
            {
                passive: true
            }
        );

        window.visualViewport.addEventListener(
            "scroll",
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

            show:
                showScrollbar,

            isVisible:
                () =>
                    scrollbar.classList.contains(
                        "is-visible"
                    )
        });


    /* =====================================================
       INIT
       ===================================================== */

    scheduleUpdate();


    window.setTimeout(
        scheduleUpdate,
        100
    );


    window.setTimeout(
        scheduleUpdate,
        500
    );

})();
