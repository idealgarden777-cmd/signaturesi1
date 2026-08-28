/*
=========================================================
NEYO — LEVERAGE INTRO
v1 — 5 CARD INTRO FLOW

Purpose:
- Free user clicks Leverage
- Show 5 introduction cards
- No price shown in intro cards
- Final card opens existing upgrade flow
- Keep current model-menu / checkout untouched

Listens:
- neyo:leverage-intro-request

Emits:
- neyo:leverage-intro-open
- neyo:leverage-intro-close
- neyo:leverage-intro-change
- neyo:leverage-upgrade-request

Does NOT own:
- Checkout
- Subscription state
- Model access
- Billing
- Backend routing
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       SINGLETON GUARD
       ===================================================== */

    if (
        window.NeyoLeverageIntro
            ?.__controller ===
        true
    ) {
        return;
    }


    /* =====================================================
       STATE
       ===================================================== */

    let overlay =
        null;


    let card =
        null;


    let content =
        null;


    let dots =
        null;


    let backBtn =
        null;


    let nextBtn =
        null;


    let closeBtn =
        null;


    let currentIndex =
        0;


    let isOpen =
        false;


    /* =====================================================
       CARDS
       ===================================================== */

    const CARDS =
        Object.freeze([
            {
                eyebrow:
                    "Leverage",

                title:
                    "Meet Leverage",

                description:
                    "A more capable NEYO experience for demanding work, deeper reasoning, and advanced tasks.",

                icon:
                    "sparkles"
            },

            {
                eyebrow:
                    "More capability",

                title:
                    "Built for harder tasks",

                description:
                    "Leverage uses stronger intelligence routing for complex questions, coding, planning, analysis, and long-form work.",

                icon:
                    "brain-circuit"
            },

            {
                eyebrow:
                    "Advanced reasoning",

                title:
                    "Go deeper when needed",

                description:
                    "Handle multi-step problems, technical work, structured reasoning, and more demanding conversations with greater depth.",

                icon:
                    "workflow"
            },

            {
                eyebrow:
                    "More tools",

                title:
                    "A broader NEYO experience",

                description:
                    "Leverage is designed to unlock advanced capabilities across research, files, multimodal tasks, and specialist workflows.",

                icon:
                    "layers-3"
            },

            {
                eyebrow:
                    "Leverage",

                title:
                    "Ready to unlock more?",

                description:
                    "View the available upgrade options and choose whether Leverage is right for you.",

                icon:
                    "arrow-up-right",

                final:
                    true
            }
        ]);


    /* =====================================================
       HELPERS
       ===================================================== */

    const emit =
        (
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


    const refreshIcons =
        () => {

            try {

                window.lucide
                    ?.createIcons
                    ?.();

            } catch {
                // Ignore icon refresh failure.
            }

        };


    const clampIndex =
        value => {

            return Math.max(
                0,
                Math.min(
                    Number(
                        value
                    ) || 0,
                    CARDS.length - 1
                )
            );

        };


    /* =====================================================
       CREATE UI
       ===================================================== */

    const createUI =
        () => {

            if (overlay) {
                return;
            }


            overlay =
                document.createElement(
                    "div"
                );


            overlay.id =
                "leverageIntroOverlay";


            overlay.className =
                "leverage-intro-overlay";


            overlay.setAttribute(
                "aria-hidden",
                "true"
            );


            overlay.innerHTML = `
                <div
                    class="leverage-intro-card"
                    id="leverageIntroCard"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="leverageIntroTitle"
                    aria-describedby="leverageIntroDescription"
                >
                    <button
                        class="leverage-intro-close"
                        id="leverageIntroCloseBtn"
                        type="button"
                        aria-label="Close Leverage introduction"
                    >
                        <i
                            data-lucide="x"
                            width="18"
                            height="18"
                            aria-hidden="true"
                        ></i>
                    </button>

                    <div
                        class="leverage-intro-content"
                        id="leverageIntroContent"
                    ></div>

                    <div
                        class="leverage-intro-footer"
                    >
                        <div
                            class="leverage-intro-dots"
                            id="leverageIntroDots"
                            aria-label="Introduction progress"
                        ></div>

                        <div
                            class="leverage-intro-actions"
                        >
                            <button
                                class="leverage-intro-back"
                                id="leverageIntroBackBtn"
                                type="button"
                            >
                                Back
                            </button>

                            <button
                                class="leverage-intro-next"
                                id="leverageIntroNextBtn"
                                type="button"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </div>
            `;


            document.body
                .appendChild(
                    overlay
                );


            card =
                document.getElementById(
                    "leverageIntroCard"
                );


            content =
                document.getElementById(
                    "leverageIntroContent"
                );


            dots =
                document.getElementById(
                    "leverageIntroDots"
                );


            backBtn =
                document.getElementById(
                    "leverageIntroBackBtn"
                );


            nextBtn =
                document.getElementById(
                    "leverageIntroNextBtn"
                );


            closeBtn =
                document.getElementById(
                    "leverageIntroCloseBtn"
                );


            bindUIEvents();


            buildDots();


            render();


            refreshIcons();

        };


    /* =====================================================
       BUILD DOTS
       ===================================================== */

    const buildDots =
        () => {

            if (!dots) {
                return;
            }


            dots.replaceChildren();


            CARDS.forEach(
                (
                    item,
                    index
                ) => {

                    const dot =
                        document.createElement(
                            "button"
                        );


                    dot.type =
                        "button";


                    dot.className =
                        "leverage-intro-dot";


                    dot.setAttribute(
                        "aria-label",
                        `Go to introduction card ${index + 1}`
                    );


                    dot.dataset.index =
                        String(
                            index
                        );


                    dot.addEventListener(
                        "click",
                        event => {

                            event.preventDefault();

                            event.stopPropagation();


                            goTo(
                                index
                            );

                        }
                    );


                    dots.appendChild(
                        dot
                    );

                }
            );

        };


    /* =====================================================
       RENDER
       ===================================================== */

    const render =
        () => {

            if (
                !content ||
                !nextBtn ||
                !backBtn
            ) {
                return;
            }


            currentIndex =
                clampIndex(
                    currentIndex
                );


            const item =
                CARDS[
                    currentIndex
                ];


            content.innerHTML = `
                <div
                    class="leverage-intro-slide"
                    data-index="${currentIndex}"
                >
                    <div
                        class="leverage-intro-icon"
                        aria-hidden="true"
                    >
                        <i
                            data-lucide="${item.icon}"
                            width="24"
                            height="24"
                        ></i>
                    </div>

                    <div
                        class="leverage-intro-copy"
                    >
                        <span
                            class="leverage-intro-eyebrow"
                        >
                            ${item.eyebrow}
                        </span>

                        <h2
                            id="leverageIntroTitle"
                        >
                            ${item.title}
                        </h2>

                        <p
                            id="leverageIntroDescription"
                        >
                            ${item.description}
                        </p>
                    </div>
                </div>
            `;


            backBtn.hidden =
                currentIndex ===
                0;


            if (
                item.final ===
                true
            ) {

                nextBtn.textContent =
                    "View upgrade options";

            } else {

                nextBtn.textContent =
                    "Next";

            }


            if (dots) {

                const dotButtons =
                    Array.from(
                        dots.querySelectorAll(
                            ".leverage-intro-dot"
                        )
                    );


                dotButtons.forEach(
                    (
                        dot,
                        index
                    ) => {

                        const active =
                            index ===
                            currentIndex;


                        dot.classList
                            .toggle(
                                "active",
                                active
                            );


                        dot.setAttribute(
                            "aria-current",
                            active
                                ? "step"
                                : "false"
                        );

                    }
                );

            }


            refreshIcons();


            emit(
                "neyo:leverage-intro-change",
                {
                    index:
                        currentIndex,

                    total:
                        CARDS.length,

                    card:
                        item
                }
            );

        };


    /* =====================================================
       NAVIGATION
       ===================================================== */

    const goTo =
        index => {

            currentIndex =
                clampIndex(
                    index
                );


            render();

        };


    const next =
        () => {

            const item =
                CARDS[
                    currentIndex
                ];


            if (
                item?.final ===
                true
            ) {

                close();


                emit(
                    "neyo:leverage-upgrade-request",
                    {
                        source:
                            "leverage-intro"
                    }
                );


                return;

            }


            goTo(
                currentIndex +
                1
            );

        };


    const back =
        () => {

            if (
                currentIndex <=
                0
            ) {
                return;
            }


            goTo(
                currentIndex -
                1
            );

        };


    /* =====================================================
       OPEN
       ===================================================== */

    const open =
        () => {

            createUI();


            if (!overlay) {
                return false;
            }


            currentIndex =
                0;


            render();


            isOpen =
                true;


            overlay
                .classList
                .add(
                    "show"
                );


            overlay
                .setAttribute(
                    "aria-hidden",
                    "false"
                );


            document.body
                .classList
                .add(
                    "leverage-intro-open"
                );


            requestAnimationFrame(
                () => {

                    nextBtn
                        ?.focus
                        ?.();

                }
            );


            emit(
                "neyo:leverage-intro-open",
                {
                    total:
                        CARDS.length
                }
            );


            return true;

        };


    /* =====================================================
       CLOSE
       ===================================================== */

    const close =
        () => {

            if (!overlay) {
                return false;
            }


            isOpen =
                false;


            overlay
                .classList
                .remove(
                    "show"
                );


            overlay
                .setAttribute(
                    "aria-hidden",
                    "true"
                );


            document.body
                .classList
                .remove(
                    "leverage-intro-open"
                );


            emit(
                "neyo:leverage-intro-close"
            );


            return true;

        };


    /* =====================================================
       UI EVENTS
       ===================================================== */

    function bindUIEvents() {

        closeBtn
            ?.addEventListener(
                "click",
                event => {

                    event.preventDefault();

                    event.stopPropagation();


                    close();

                }
            );


        nextBtn
            ?.addEventListener(
                "click",
                event => {

                    event.preventDefault();

                    event.stopPropagation();


                    next();

                }
            );


        backBtn
            ?.addEventListener(
                "click",
                event => {

                    event.preventDefault();

                    event.stopPropagation();


                    back();

                }
            );


        overlay
            ?.addEventListener(
                "click",
                event => {

                    if (
                        event.target ===
                        overlay
                    ) {

                        close();

                    }

                }
            );

    }


    /* =====================================================
       KEYBOARD
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {

            if (!isOpen) {
                return;
            }


            if (
                event.key ===
                "Escape"
            ) {

                event.preventDefault();


                close();


                return;

            }


            if (
                event.key ===
                "ArrowRight"
            ) {

                event.preventDefault();


                next();


                return;

            }


            if (
                event.key ===
                "ArrowLeft"
            ) {

                event.preventDefault();


                back();

            }

        },
        true
    );


    /* =====================================================
       MODEL MENU EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:leverage-intro-request",
        event => {

            event
                ?.preventDefault
                ?.();


            open();

        }
    );


    /* =====================================================
       EXTERNAL OPEN / CLOSE
       ===================================================== */

    window.addEventListener(
        "neyo:leverage-intro-open-request",
        open
    );


    window.addEventListener(
        "neyo:leverage-intro-close-request",
        close
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoLeverageIntro =
        Object.freeze({

            __controller:
                true,


            version:
                "v1",


            open,


            close,


            next,


            back,


            goTo,


            isOpen:
                () =>
                    isOpen,


            getIndex:
                () =>
                    currentIndex,


            getCards:
                () =>
                    CARDS.map(
                        item => ({
                            ...item
                        })
                    )

        });

})();
