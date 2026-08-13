/*
=========================================================
NEYO — PERSONALITY COMPONENT

Owns:
- Personality selection state
- Personality UI sync
- Chat preference sync
- Personality lifecycle events
- Public personality API

Does NOT own:
- Personalities gallery layout
- Mascot rendering
- Chat API implementation
- Subscription logic
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       PERSONALITIES
       ===================================================== */

    const PERSONALITIES =
        Object.freeze({

            neyo: {
                id:
                    "neyo",

                name:
                    "Neyo",

                label:
                    "Balanced Intelligence",

                description:
                    "Thoughtful, capable and reliable for everyday work."
            },


            zadi: {
                id:
                    "zadi",

                name:
                    "Zadi",

                label:
                    "Creative Intelligence",

                description:
                    "Strong for writing, ideas and creative exploration."
            },


            wizi: {
                id:
                    "wizi",

                name:
                    "Wizi",

                label:
                    "Knowledge Intelligence",

                description:
                    "Focused on research, learning and structured knowledge."
            }

        });


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const personalityButtons =
        Array.from(
            document.querySelectorAll(
                "[data-personality]"
            )
        );


    const personalityNameDisplay =
        document.getElementById(
            "personalityNameDisplay"
        );


    /* =====================================================
       STATE
       ===================================================== */

    let selectedPersonality =
        "neyo";


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


    const normalizePersonality =
        value => {

            const id =
                String(
                    value || "neyo"
                )
                    .trim()
                    .toLowerCase();


            return PERSONALITIES[id]
                ? id
                : "neyo";

        };


    const getPersonality =
        id => {

            return PERSONALITIES[
                normalizePersonality(
                    id
                )
            ];

        };


    /* =====================================================
       UI SYNC
       ===================================================== */

    const updateUi = () => {

        personalityButtons.forEach(
            button => {

                const active =
                    button.dataset
                        .personality ===
                    selectedPersonality;


                button.classList.toggle(
                    "active",
                    active
                );


                button.setAttribute(
                    "aria-selected",
                    String(active)
                );

            }
        );


        if (
            personalityNameDisplay
        ) {

            personalityNameDisplay
                .textContent =
                getPersonality(
                    selectedPersonality
                ).name;

        }


        document.documentElement
            .dataset.personality =
            selectedPersonality;

    };


    /* =====================================================
       CHAT SYNC
       ===================================================== */

    const syncChatPreference = () => {

        window.NeyoChat
            ?.setPreferences?.({
                personality:
                    selectedPersonality
            });

    };


    /* =====================================================
       SELECT
       ===================================================== */

    const selectPersonality = (
        value,
        options = {}
    ) => {

        const next =
            normalizePersonality(
                value
            );


        if (
            selectedPersonality === next &&
            options.force !== true
        ) {
            return selectedPersonality;
        }


        selectedPersonality =
            next;


        updateUi();

        syncChatPreference();


        if (
            options.silent !== true
        ) {

            emit(
                "neyo:personality-change",
                {
                    personality:
                        selectedPersonality,

                    info:
                        getPersonality(
                            selectedPersonality
                        )
                }
            );

        }


        return selectedPersonality;

    };


    /* =====================================================
       BUTTON EVENTS
       ===================================================== */

    personalityButtons.forEach(
        button => {

            button.addEventListener(
                "click",
                event => {

                    event.preventDefault();


                    const personality =
                        button.dataset
                            .personality;


                    selectPersonality(
                        personality
                    );

                }
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
                    ?.personality;


            if (preferred) {

                selectPersonality(
                    preferred
                );

            }

        }
    );


    /* =====================================================
       EXTERNAL EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:personality-set",
        event => {

            selectPersonality(
                event.detail
                    ?.personality,
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
        "neyo:personality-reset",
        () => {

            selectPersonality(
                "neyo"
            );

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    const initialActive =
        personalityButtons.find(
            button =>
                button.classList
                    .contains(
                        "active"
                    )
        );


    if (
        initialActive
            ?.dataset
            ?.personality
    ) {

        selectedPersonality =
            normalizePersonality(
                initialActive
                    .dataset
                    .personality
            );

    }


    updateUi();

    syncChatPreference();


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoPersonality =
        Object.freeze({

            select:
                selectPersonality,

            set:
                selectPersonality,

            get:
                () =>
                    selectedPersonality,

            getCurrent:
                () =>
                    ({
                        ...getPersonality(
                            selectedPersonality
                        )
                    }),

            getById:
                id => {

                    const personality =
                        PERSONALITIES[
                            normalizePersonality(
                                id
                            )
                        ];


                    return {
                        ...personality
                    };

                },

            getAll:
                () =>
                    Object.values(
                        PERSONALITIES
                    ).map(
                        personality => ({
                            ...personality
                        })
                    ),

            reset:
                () =>
                    selectPersonality(
                        "neyo"
                    )

        });

})();
