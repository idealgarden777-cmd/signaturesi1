/*
=========================================================
NEYO — LEVERAGE INTRO
CHATGPT-STYLE PREMIUM INTRO
VERSION 2

Owns:
- Leverage introduction modal
- 5-card onboarding flow
- Slide navigation
- Keyboard navigation
- Close behavior
- Upgrade handoff
- Free-user introduction experience

Does NOT own:
- Checkout
- Billing
- Subscription state
- Model authorization
- Pricing
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       SINGLETON
       ===================================================== */

    if (
        window.NeyoLeverageIntro
            ?.__controller
    ) {
        return;
    }


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG =
        Object.freeze({

            overlayId:
                "leverageIntroOverlay",

            modalId:
                "leverageIntroModal",

            requestEvent:
                "neyo:leverage-intro-request",

            upgradeEvent:
                "neyo:leverage-upgrade-request"

        });


    /* =====================================================
       CONTENT
       ===================================================== */

    const CARDS =
        Object.freeze([

            {
                eyebrow:
                    "NEYO LEVERAGE",

                title:
                    "Meet NEYO Leverage",

                description:
                    "A more capable NEYO experience for demanding work, deeper reasoning, and advanced tasks.",

                learnMore:
                    true
            },

            {
                eyebrow:
                    "BUILT FOR MORE",

                title:
                    "Take on harder tasks",

                description:
                    "Leverage is designed for complex questions, coding, planning, analysis, and longer structured work.",

                learnMore:
                    false
            },

            {
                eyebrow:
                    "DEEPER REASONING",

                title:
                    "Go deeper when needed",

                description:
                    "Work through multi-step, technical, and structured problems with stronger reasoning and more capable task handling.",

                learnMore:
                    false
            },

            {
                eyebrow:
                    "ADVANCED WORKFLOWS",

                title:
                    "A broader NEYO experience",

                description:
                    "Use advanced capabilities across files, research, multimodal work, coding, analysis, and future specialist workflows.",

                learnMore:
                    false
            },

            {
                eyebrow:
                    "NEYO LEVERAGE",

                title:
                    "Ready to unlock more?",

                description:
                    "Explore the available Leverage options and decide whether the advanced NEYO experience is right for you.",

                learnMore:
                    false
            }

        ]);


    /* =====================================================
       STATE
       ===================================================== */

    let currentIndex =
        0;

    let open =
        false;

    let overlay =
        null;

    let modal =
        null;

    let titleElement =
        null;

    let eyebrowElement =
        null;

    let descriptionElement =
        null;

    let learnMoreElement =
        null;

    let backButton =
        null;

    let nextButton =
        null;

    let closeButton =
        null;

    let dotsContainer =
        null;

    let cardStage =
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


    const refreshIcons =
        () => {

            if (
                window.lucide
                    ?.createIcons
            ) {

                window.lucide
                    .createIcons();

            }

        };


    const clampIndex =
        value => {

            return Math.max(
                0,
                Math.min(
                    CARDS.length - 1,
                    value
                )
            );

        };


    const isLastCard =
        () => {

            return (
                currentIndex ===
                CARDS.length - 1
            );

        };


    const isFirstCard =
        () => {

            return (
                currentIndex === 0
            );

        };


    /* =====================================================
       CREATE ELEMENT
       ===================================================== */

    const createElement =
        (
            tag,
            className = "",
            text = ""
        ) => {

            const element =
                document.createElement(
                    tag
                );


            if (className) {

                element.className =
                    className;

            }


            if (
                typeof text ===
                    "string" &&
                text
            ) {

                element.textContent =
                    text;

            }


            return element;

        };


    /* =====================================================
       SEGMENTED CONTROL
       ===================================================== */

    const createSegmentedControl =
        () => {

            const wrapper =
                createElement(
                    "div",
                    "leverage-intro-segmented"
                );


            const neyoTab =
                createElement(
                    "button",
                    "leverage-intro-segment",
                    "NEYO"
                );


            const leverageTab =
                createElement(
                    "button",
                    "leverage-intro-segment active",
                    "Leverage"
                );


            neyoTab.type =
                "button";

            leverageTab.type =
                "button";


            neyoTab.setAttribute(
                "aria-label",
                "NEYO"
            );


            leverageTab.setAttribute(
                "aria-label",
                "Leverage"
            );


            neyoTab.addEventListener(
                "click",
                () => {

                    closeIntro();

                }
            );


            leverageTab.addEventListener(
                "click",
                () => {

                    goToSlide(
                        currentIndex
                    );

                }
            );


            wrapper.append(
                neyoTab,
                leverageTab
            );


            return wrapper;

        };


    /* =====================================================
       DOTS
       ===================================================== */

    const createDots =
        () => {

            const container =
                createElement(
                    "div",
                    "leverage-intro-dots"
                );


            CARDS.forEach(
                (
                    card,
                    index
                ) => {

                    const dot =
                        createElement(
                            "button",
                            "leverage-intro-dot"
                        );


                    dot.type =
                        "button";


                    dot.setAttribute(
                        "aria-label",
                        `Go to Leverage introduction ${index + 1}`
                    );


                    dot.dataset.index =
                        String(index);


                    dot.addEventListener(
                        "click",
                        () => {

                            goToSlide(
                                index
                            );

                        }
                    );


                    container
                        .appendChild(
                            dot
                        );

                }
            );


            return container;

        };


    /* =====================================================
       BUILD MODAL
       ===================================================== */

    const build =
        () => {

            if (overlay) {
                return overlay;
            }


            overlay =
                createElement(
                    "div",
                    "leverage-intro-overlay"
                );


            overlay.id =
                CONFIG.overlayId;


            overlay.setAttribute(
                "aria-hidden",
                "true"
            );


            modal =
                createElement(
                    "section",
                    "leverage-intro-modal"
                );


            modal.id =
                CONFIG.modalId;


            modal.setAttribute(
                "role",
                "dialog"
            );


            modal.setAttribute(
                "aria-modal",
                "true"
            );


            modal.setAttribute(
                "aria-labelledby",
                "leverageIntroTitle"
            );


            /* =============================================
               DECORATIVE GRADIENT
               ============================================= */

            const gradient =
                createElement(
                    "div",
                    "leverage-intro-gradient"
                );


            gradient.setAttribute(
                "aria-hidden",
                "true"
            );


            /* =============================================
               CLOSE BUTTON
               ============================================= */

            closeButton =
                createElement(
                    "button",
                    "leverage-intro-close"
                );


            closeButton.type =
                "button";


            closeButton.setAttribute(
                "aria-label",
                "Close Leverage introduction"
            );


            closeButton.innerHTML =
                '<i data-lucide="x" size="20"></i>';


            closeButton.addEventListener(
                "click",
                () => {

                    closeIntro();

                }
            );


            /* =============================================
               TOP AREA
               ============================================= */

            const top =
                createElement(
                    "div",
                    "leverage-intro-top"
                );


            const segmented =
                createSegmentedControl();


            top.appendChild(
                segmented
            );


            /* =============================================
               CONTENT
               ============================================= */

            cardStage =
                createElement(
                    "div",
                    "leverage-intro-stage"
                );


            const content =
                createElement(
                    "div",
                    "leverage-intro-content"
                );


            eyebrowElement =
                createElement(
                    "div",
                    "leverage-intro-eyebrow"
                );


            titleElement =
                createElement(
                    "h2",
                    "leverage-intro-title"
                );


            titleElement.id =
                "leverageIntroTitle";


            descriptionElement =
                createElement(
                    "p",
                    "leverage-intro-description"
                );


            learnMoreElement =
                createElement(
                    "button",
                    "leverage-intro-learn-more",
                    "Learn more"
                );


            learnMoreElement.type =
                "button";


            learnMoreElement.addEventListener(
                "click",
                () => {

                    goToSlide(
                        1
                    );

                }
            );


            content.append(
                eyebrowElement,
                titleElement,
                descriptionElement,
                learnMoreElement
            );


            cardStage.appendChild(
                content
            );


            /* =============================================
               DOTS
               ============================================= */

            dotsContainer =
                createDots();


            /* =============================================
               FOOTER ACTIONS
               ============================================= */

            const footer =
                createElement(
                    "div",
                    "leverage-intro-footer"
                );


            backButton =
                createElement(
                    "button",
                    "leverage-intro-back",
                    "Back"
                );


            backButton.type =
                "button";


            backButton.addEventListener(
                "click",
                () => {

                    previousSlide();

                }
            );


            nextButton =
                createElement(
                    "button",
                    "leverage-intro-next",
                    "Next"
                );


            nextButton.type =
                "button";


            nextButton.addEventListener(
                "click",
                () => {

                    if (
                        isLastCard()
                    ) {

                        requestUpgrade();

                        return;

                    }


                    nextSlide();

                }
            );


            footer.append(
                backButton,
                nextButton
            );


            /* =============================================
               ASSEMBLE
               ============================================= */

            modal.append(
                gradient,
                closeButton,
                top,
                cardStage,
                dotsContainer,
                footer
            );


            overlay.appendChild(
                modal
            );


            document.body.appendChild(
                overlay
            );


            /* =============================================
               OVERLAY CLICK
               ============================================= */

            overlay.addEventListener(
                "click",
                event => {

                    if (
                        event.target ===
                        overlay
                    ) {

                        closeIntro();

                    }

                }
            );


            render();


            refreshIcons();


            return overlay;

        };


    /* =====================================================
       RENDER
       ===================================================== */

    const render =
        () => {

            if (
                !overlay ||
                !modal
            ) {
                return;
            }


            const card =
                CARDS[
                    currentIndex
                ];


            if (
                !card
            ) {
                return;
            }


            if (
                eyebrowElement
            ) {

                eyebrowElement.textContent =
                    card.eyebrow;

            }


            if (
                titleElement
            ) {

                titleElement.textContent =
                    card.title;

            }


            if (
                descriptionElement
            ) {

                descriptionElement.textContent =
                    card.description;

            }


            if (
                learnMoreElement
            ) {

                learnMoreElement.hidden =
                    !card.learnMore;

            }


            if (
                backButton
            ) {

                backButton.hidden =
                    isFirstCard();

            }


            if (
                nextButton
            ) {

                nextButton.textContent =
                    isLastCard()
                        ? "Explore Leverage"
                        : "Next";


                nextButton.classList.toggle(
                    "is-final",
                    isLastCard()
                );

            }


            if (
                dotsContainer
            ) {

                const dots =
                    dotsContainer
                        .querySelectorAll(
                            ".leverage-intro-dot"
                        );


                dots.forEach(
                    (
                        dot,
                        index
                    ) => {

                        const active =
                            index ===
                            currentIndex;


                        dot.classList.toggle(
                            "active",
                            active
                        );


                        dot.setAttribute(
                            "aria-current",
                            active
                                ? "true"
                                : "false"
                        );

                    }
                );

            }


            modal.dataset.slide =
                String(
                    currentIndex
                );


            modal.dataset.lastSlide =
                isLastCard()
                    ? "true"
                    : "false";


            refreshIcons();

        };


    /* =====================================================
       SLIDE NAVIGATION
       ===================================================== */

    const goToSlide =
        index => {

            const nextIndex =
                clampIndex(
                    Number(index) || 0
                );


            if (
                currentIndex ===
                nextIndex
            ) {

                render();

                return;

            }


            if (
                cardStage
            ) {

                cardStage.classList.add(
                    "is-changing"
                );

            }


            window.setTimeout(
                () => {

                    currentIndex =
                        nextIndex;


                    render();


                    if (
                        cardStage
                    ) {

                        requestAnimationFrame(
                            () => {

                                cardStage
                                    .classList
                                    .remove(
                                        "is-changing"
                                    );

                            }
                        );

                    }

                },
                120
            );

        };


    const nextSlide =
        () => {

            goToSlide(
                currentIndex + 1
            );

        };


    const previousSlide =
        () => {

            goToSlide(
                currentIndex - 1
            );

        };


    /* =====================================================
       OPEN
       ===================================================== */

    const openIntro =
        ({
            startIndex = 0
        } = {}) => {

            build();


            currentIndex =
                clampIndex(
                    Number(
                        startIndex
                    ) || 0
                );


            render();


            open =
                true;


            overlay.classList.add(
                "open"
            );


            overlay.setAttribute(
                "aria-hidden",
                "false"
            );


            document.documentElement
                .classList
                .add(
                    "leverage-intro-open"
                );


            document.body
                .classList
                .add(
                    "leverage-intro-open"
                );


            window.setTimeout(
                () => {

                    closeButton
                        ?.focus?.();

                },
                50
            );


            emit(
                "neyo:leverage-intro-opened",
                {
                    index:
                        currentIndex
                }
            );

        };


    /* =====================================================
       CLOSE
       ===================================================== */

    const closeIntro =
        ({
            reason = "close"
        } = {}) => {

            if (
                !overlay ||
                !open
            ) {
                return;
            }


            open =
                false;


            overlay.classList.remove(
                "open"
            );


            overlay.setAttribute(
                "aria-hidden",
                "true"
            );


            document.documentElement
                .classList
                .remove(
                    "leverage-intro-open"
                );


            document.body
                .classList
                .remove(
                    "leverage-intro-open"
                );


            emit(
                "neyo:leverage-intro-closed",
                {
                    reason,
                    index:
                        currentIndex
                }
            );

        };


    /* =====================================================
       UPGRADE HANDOFF
       ===================================================== */

    const requestUpgrade =
        () => {

            closeIntro({
                reason:
                    "upgrade"
            });


            window.setTimeout(
                () => {

                    emit(
                        CONFIG.upgradeEvent,
                        {
                            modelId:
                                "l1.2",

                            plan:
                                "leverage",

                            source:
                                "leverage-intro"
                        }
                    );

                },
                140
            );

        };


    /* =====================================================
       KEYBOARD
       ===================================================== */

    const handleKeydown =
        event => {

            if (!open) {
                return;
            }


            if (
                event.key ===
                "Escape"
            ) {

                event.preventDefault();


                closeIntro({
                    reason:
                        "escape"
                });


                return;

            }


            if (
                event.key ===
                "ArrowRight"
            ) {

                event.preventDefault();


                if (
                    isLastCard()
                ) {
                    return;
                }


                nextSlide();


                return;

            }


            if (
                event.key ===
                "ArrowLeft"
            ) {

                event.preventDefault();


                if (
                    isFirstCard()
                ) {
                    return;
                }


                previousSlide();

            }

        };


    document.addEventListener(
        "keydown",
        handleKeydown
    );


    /* =====================================================
       INTRO REQUEST EVENT
       ===================================================== */

    window.addEventListener(
        CONFIG.requestEvent,
        event => {

            const startIndex =
                Number(
                    event
                        ?.detail
                        ?.startIndex
                ) || 0;


            openIntro({
                startIndex
            });

        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    const controller =
        {

            __controller:
                true,

            open:
                openIntro,

            close:
                closeIntro,

            next:
                nextSlide,

            back:
                previousSlide,

            goTo:
                goToSlide,

            upgrade:
                requestUpgrade,

            isOpen:
                () =>
                    open,

            getIndex:
                () =>
                    currentIndex,

            getCards:
                () =>
                    CARDS.map(
                        card => ({
                            ...card
                        })
                    )

        };


    window.NeyoLeverageIntro =
        Object.freeze(
            controller
        );

})();
