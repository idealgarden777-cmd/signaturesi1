/*
=========================================================
NEYO — INTELLIGENCE COMPONENT

Owns:
- Intelligence mode state
- Intelligence UI sync
- Chat preference sync
- Intelligence lifecycle events
- Public intelligence API

Does NOT own:
- Model selection
- Deep Research
- Chat API implementation
- Billing / Pro enforcement
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       MODES
       ===================================================== */

    const INTELLIGENCE_MODES =
        Object.freeze({

            standard: {
                id:
                    "standard",

                name:
                    "Standard",

                label:
                    "Balanced",

                description:
                    "Fast, capable reasoning for everyday tasks."
            },


            thoughtful: {
                id:
                    "thoughtful",

                name:
                    "Thoughtful",

                label:
                    "Deeper thinking",

                description:
                    "More deliberate reasoning for complex tasks."
            },


            fast: {
                id:
                    "fast",

                name:
                    "Fast",

                label:
                    "Quick response",

                description:
                    "Optimized for speed and simple tasks."
            }

        });


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const intelligenceButtons =
        Array.from(
            document.querySelectorAll(
                "[data-intelligence]"
            )
        );


    const intelligenceSelect =
        document.getElementById(
            "intelligenceSelect"
        );


    const intelligenceDisplay =
        document.getElementById(
            "intelligenceDisplay"
        );


    /* =====================================================
       STATE
       ===================================================== */

    let selectedMode =
        "standard";


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


    const normalizeMode =
        value => {

            const mode =
                String(
                    value || "standard"
                )
                    .trim()
                    .toLowerCase();


            return INTELLIGENCE_MODES[
                mode
            ]
                ? mode
                : "standard";

        };


    const getModeInfo =
        value => {

            const mode =
                normalizeMode(
                    value
                );


            return INTELLIGENCE_MODES[
                mode
            ];

        };


    /* =====================================================
       UI SYNC
       ===================================================== */

    const updateUi = () => {

        intelligenceButtons.forEach(
            button => {

                const active =
                    button.dataset
                        .intelligence ===
                    selectedMode;


                button.classList.toggle(
                    "active",
                    active
                );


                button.setAttribute(
                    "aria-selected",
                    String(active)
                );


                button.setAttribute(
                    "aria-pressed",
                    String(active)
                );

            }
        );


        if (intelligenceSelect) {

            intelligenceSelect.value =
                selectedMode;

        }


        if (intelligenceDisplay) {

            intelligenceDisplay
                .textContent =
                getModeInfo(
                    selectedMode
                ).name;

        }


        document.documentElement
            .dataset.intelligence =
            selectedMode;

    };


    /* =====================================================
       CHAT SYNC
       ===================================================== */

    const syncChatPreference = () => {

        window.NeyoChat
            ?.setPreferences?.({
                intelligence:
                    selectedMode
            });

    };


    /* =====================================================
       SET MODE
       ===================================================== */

    const setMode = (
        value,
        options = {}
    ) => {

        const next =
            normalizeMode(
                value
            );


        if (
            selectedMode === next &&
            options.force !== true
        ) {
            return selectedMode;
        }


        selectedMode =
            next;


        updateUi();

        syncChatPreference();


        if (
            options.silent !== true
        ) {

            emit(
                "neyo:intelligence-change",
                {
                    intelligence:
                        selectedMode,

                    info:
                        {
                            ...getModeInfo(
                                selectedMode
                            )
                        }
                }
            );

        }


        return selectedMode;

    };


    /* =====================================================
       BUTTON EVENTS
       ===================================================== */

    intelligenceButtons.forEach(
        button => {

            button.addEventListener(
                "click",
                event => {

                    event.preventDefault();


                    setMode(
                        button.dataset
                            .intelligence
                    );

                }
            );

        }
    );


    /* =====================================================
       SELECT EVENT
       ===================================================== */

    intelligenceSelect
        ?.addEventListener(
            "change",
            event => {

                setMode(
                    event.target.value
                );

            }
        );


    /* =====================================================
       PROFILE SYNC
       ===================================================== */

    window.addEventListener(
        "neyo:profile-loaded",
        event => {

            const preferred =
                event.detail
                    ?.profile
                    ?.intelligence;


            if (preferred) {

                setMode(
                    preferred
                );

            }

        }
    );


    /* =====================================================
       EXTERNAL EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:intelligence-set",
        event => {

            setMode(
                event.detail
                    ?.intelligence,
                {
                    silent:
                        Boolean(
                            event.detail
                                ?.silent
                        )
                }
            );

        }
    );


    window.addEventListener(
        "neyo:intelligence-reset",
        () => {

            setMode(
                "standard"
            );

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    const initialActive =
        intelligenceButtons.find(
            button =>
                button.classList
                    .contains(
                        "active"
                    )
        );


    if (
        initialActive
            ?.dataset
            ?.intelligence
    ) {

        selectedMode =
            normalizeMode(
                initialActive
                    .dataset
                    .intelligence
            );

    }

    else if (
        intelligenceSelect
            ?.value
    ) {

        selectedMode =
            normalizeMode(
                intelligenceSelect
                    .value
            );

    }


    updateUi();

    syncChatPreference();


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoIntelligence =
        Object.freeze({

            set:
                setMode,

            select:
                setMode,

            get:
                () =>
                    selectedMode,

            getCurrent:
                () =>
                    ({
                        ...getModeInfo(
                            selectedMode
                        )
                    }),

            getAll:
                () =>
                    Object.values(
                        INTELLIGENCE_MODES
                    ).map(
                        mode => ({
                            ...mode
                        })
                    ),

            reset:
                () =>
                    setMode(
                        "standard"
                    )

        });

})();
