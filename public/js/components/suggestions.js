/*
=========================================================
NEYO — ADAPTIVE SUGGESTIONS COMPONENT

Owns:
- Suggestion chip rendering
- Context-aware suggestions
- Suggestion selection
- Composer text insertion
- Public suggestion events / API

Does NOT own:
- Message sending
- Chat API
- Composer resize internals
- History
- Attachments
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const liveSuggestions =
        document.getElementById("liveSuggestions");

    const chatInput =
        document.getElementById("chatInput");


    if (
        !liveSuggestions ||
        !chatInput
    ) {
        return;
    }


    /* =====================================================
       SUGGESTION SETS
       ===================================================== */

    const SUGGESTIONS =
        Object.freeze({

            default: [
                "Write code",
                "Summarize this",
                "Make a plan",
                "Improve text",
                "Research this"
            ],

            code: [
                "Fix this code",
                "Explain this error",
                "Make it production ready",
                "Find bugs",
                "Write cleaner version"
            ],

            business: [
                "Make launch plan",
                "Improve pricing",
                "Write marketing copy",
                "Find risks",
                "Make growth strategy"
            ],

            writing: [
                "Improve this writing",
                "Make it clearer",
                "Rewrite professionally",
                "Make it shorter",
                "Fix grammar"
            ]

        });


    /* =====================================================
       STATE
       ===================================================== */

    let currentCategory =
        "default";

    let customSuggestions =
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


    const getInputText = () =>
        chatInput.value
            .trim()
            .toLowerCase();


    /* =====================================================
       CATEGORY DETECTION
       ===================================================== */

    const detectCategory =
        text => {

            if (
                text.includes("code") ||
                text.includes("error") ||
                text.includes("javascript") ||
                text.includes(" js ") ||
                text.includes("css") ||
                text.includes("html") ||
                text.includes("bug")
            ) {

                return "code";

            }


            if (
                text.includes("business") ||
                text.includes("launch") ||
                text.includes("pricing") ||
                text.includes("grow") ||
                text.includes("growth") ||
                text.includes("marketing")
            ) {

                return "business";

            }


            if (
                text.includes("write") ||
                text.includes("rewrite") ||
                text.includes("grammar") ||
                text.includes("paragraph") ||
                text.includes("email") ||
                text.includes("text")
            ) {

                return "writing";

            }


            return "default";

        };


    /* =====================================================
       GET SUGGESTIONS
       ===================================================== */

    const getSuggestions = () => {

        if (
            Array.isArray(
                customSuggestions
            )
        ) {

            return [
                ...customSuggestions
            ];

        }


        const text =
            getInputText();


        currentCategory =
            detectCategory(
                text
            );


        return [
            ...SUGGESTIONS[
                currentCategory
            ]
        ];

    };


    /* =====================================================
       SELECT SUGGESTION
       ===================================================== */

    const selectSuggestion =
        label => {

            if (!label) {
                return;
            }


            chatInput.value =
                label;


            chatInput.focus();


            /*
            Notify composer.js so it can
            resize and refresh its state.
            */

            window.dispatchEvent(
                new CustomEvent(
                    "neyo:composer-refresh"
                )
            );


            emit(
                "neyo:suggestion-selected",
                {
                    label,
                    category:
                        currentCategory
                }
            );


            renderSuggestions();

        };


    /* =====================================================
       RENDER
       ===================================================== */

    const renderSuggestions = () => {

        const suggestions =
            getSuggestions();


        liveSuggestions
            .replaceChildren();


        suggestions.forEach(
            label => {

                const button =
                    document.createElement(
                        "button"
                    );


                button.type =
                    "button";


                button.className =
                    "suggestion-chip";


                button.textContent =
                    label;


                button.addEventListener(
                    "click",
                    () => {

                        selectSuggestion(
                            label
                        );

                    }
                );


                liveSuggestions
                    .appendChild(
                        button
                    );

            }
        );


        emit(
            "neyo:suggestions-rendered",
            {
                category:
                    currentCategory,

                suggestions: [
                    ...suggestions
                ]
            }
        );

    };


    /* =====================================================
       SHOW / HIDE
       ===================================================== */

    const showSuggestions = () => {

        liveSuggestions.hidden =
            false;


        liveSuggestions
            .classList
            .remove("hidden");

    };


    const hideSuggestions = () => {

        liveSuggestions.hidden =
            true;


        liveSuggestions
            .classList
            .add("hidden");

    };


    /* =====================================================
       CUSTOM SUGGESTIONS
       ===================================================== */

    const setSuggestions =
        suggestions => {

            if (
                !Array.isArray(
                    suggestions
                )
            ) {
                return;
            }


            customSuggestions =
                suggestions
                    .filter(
                        item =>
                            typeof item ===
                                "string" &&
                            item.trim()
                    )
                    .map(
                        item =>
                            item.trim()
                    );


            renderSuggestions();

        };


    const resetSuggestions = () => {

        customSuggestions =
            null;


        renderSuggestions();

    };


    /* =====================================================
       INPUT EVENT
       ===================================================== */

    chatInput.addEventListener(
        "input",
        renderSuggestions
    );


    /* =====================================================
       COMPOSER CHANGE EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:composer-change",
        renderSuggestions
    );


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:suggestions-refresh",
        renderSuggestions
    );


    window.addEventListener(
        "neyo:suggestions-show",
        showSuggestions
    );


    window.addEventListener(
        "neyo:suggestions-hide",
        hideSuggestions
    );


    window.addEventListener(
        "neyo:suggestions-set",
        event => {

            setSuggestions(
                event.detail?.suggestions
            );

        }
    );


    window.addEventListener(
        "neyo:suggestions-reset",
        resetSuggestions
    );


    /* =====================================================
       INITIAL RENDER
       ===================================================== */

    renderSuggestions();


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoSuggestions =
        Object.freeze({

            render:
                renderSuggestions,

            refresh:
                renderSuggestions,

            show:
                showSuggestions,

            hide:
                hideSuggestions,

            select:
                selectSuggestion,

            set:
                setSuggestions,

            reset:
                resetSuggestions,

            getCategory:
                () =>
                    currentCategory,

            getCurrent:
                () =>
                    getSuggestions()

        });

})();
