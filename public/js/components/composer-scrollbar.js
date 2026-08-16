/*
=========================================================
NEYO — COMPOSER STATE + CUSTOM SCROLLBAR
Stable matched-pair controller

States:
- empty / one-line
- multiline
- overflow

Owns:
- state classes
- custom scrollbar visibility
- thumb size / position

Does NOT own:
- send logic
- voice logic
- attachments
- composer colors / shadows
- neo.js
=========================================================
*/

(() => {
    "use strict";

    const chatInput =
        document.getElementById("chatInput");

    const container =
        document.getElementById("glassInputContainer");

    if (!chatInput || !container) {
        return;
    }

    let rail =
        container.querySelector(
            ".composer-custom-scrollbar"
        );

    let thumb = null;

    if (!rail) {
        rail =
            document.createElement("div");

        rail.className =
            "composer-custom-scrollbar";

        rail.setAttribute(
            "aria-hidden",
            "true"
        );

        thumb =
            document.createElement("div");

        thumb.className =
            "composer-custom-scrollbar-thumb";

        rail.appendChild(thumb);
        container.appendChild(rail);
    } else {
        thumb =
            rail.querySelector(
                ".composer-custom-scrollbar-thumb"
            );
    }

    if (!thumb) {
        return;
    }

    let rafId = null;
    let hideTimer = null;

    function isEmpty() {
        return (
            chatInput.value.trim().length === 0
        );
    }

    function detectMultiline() {
        const style =
            window.getComputedStyle(chatInput);

        const lineHeight =
            parseFloat(style.lineHeight) || 24;

        const visibleHeight =
            chatInput.clientHeight;

        return (
            visibleHeight >
            lineHeight * 1.65
        );
    }

    function updateStateClasses() {
        const empty =
            isEmpty();

        const multiline =
            !empty &&
            detectMultiline();

        const overflow =
            chatInput.scrollHeight >
            chatInput.clientHeight + 2;

        container.classList.toggle(
            "composer-empty",
            empty
        );

        container.classList.toggle(
            "composer-has-content",
            !empty
        );

        container.classList.toggle(
            "composer-multiline",
            multiline
        );

        container.classList.toggle(
            "composer-overflow",
            overflow
        );

        rail.classList.toggle(
            "is-visible",
            overflow
        );

        return {
            empty,
            multiline,
            overflow
        };
    }

    function updateScrollbar() {
        const state =
            updateStateClasses();

        if (!state.overflow) {
            thumb.style.height = "";
            thumb.style.transform = "";
            return;
        }

        const scrollHeight =
            chatInput.scrollHeight;

        const clientHeight =
            chatInput.clientHeight;

        const scrollTop =
            chatInput.scrollTop;

        const railHeight =
            rail.clientHeight;

        if (
            railHeight <= 0 ||
            scrollHeight <= clientHeight
        ) {
            return;
        }

        const ratio =
            clientHeight / scrollHeight;

        const thumbHeight =
            Math.max(
                20,
                railHeight * ratio
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

        const progress =
            Math.min(
                1,
                Math.max(
                    0,
                    scrollTop / maxScroll
                )
            );

        thumb.style.height =
            `${thumbHeight}px`;

        thumb.style.transform =
            `translateY(${maxThumbTravel * progress}px)`;
    }

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

    function showScrollbarBriefly() {
        if (
            !container.classList.contains(
                "composer-overflow"
            )
        ) {
            return;
        }

        rail.classList.add("is-active");

        clearTimeout(hideTimer);

        hideTimer =
            setTimeout(() => {
                rail.classList.remove(
                    "is-active"
                );
            }, 850);
    }

    chatInput.addEventListener(
        "input",
        scheduleUpdate
    );

    chatInput.addEventListener(
        "scroll",
        () => {
            showScrollbarBriefly();
            scheduleUpdate();
        },
        {
            passive: true
        }
    );

    chatInput.addEventListener(
        "focus",
        scheduleUpdate
    );

    chatInput.addEventListener(
        "blur",
        scheduleUpdate
    );

    const resizeObserver =
        new ResizeObserver(
            scheduleUpdate
        );

    resizeObserver.observe(chatInput);
    resizeObserver.observe(container);

    if (window.visualViewport) {
        window.visualViewport.addEventListener(
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

    window.NeyoComposerScrollbar =
        Object.freeze({
            refresh:
                scheduleUpdate,

            getState:
                () => ({
                    empty:
                        container.classList.contains(
                            "composer-empty"
                        ),

                    multiline:
                        container.classList.contains(
                            "composer-multiline"
                        ),

                    overflow:
                        container.classList.contains(
                            "composer-overflow"
                        )
                })
        });

    scheduleUpdate();

    setTimeout(
        scheduleUpdate,
        100
    );

    setTimeout(
        scheduleUpdate,
        400
    );
})();
