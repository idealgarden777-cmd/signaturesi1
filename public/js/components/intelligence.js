/*
=========================================================
NEYO — INTELLIGENCE COMPONENT

Owns:
- Intelligence mode state
- Settings segmented control
- Chat preference sync
- Public events / API

Does NOT own:
- Model selection
- Deep Research
- Billing enforcement
- Chat API implementation
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const intelligenceControl =
        document.getElementById(
            "settingsIntelligenceControl"
        );


    const intelligenceButtons =
        intelligenceControl
            ? Array.from(
                intelligenceControl.querySelectorAll(
                    "button[data-value]"
                )
            )
            : [];


    /* =====================================================
       MODES
       ===================================================== */

    const MODES =
        Object.freeze({

            standard: {
                id: "standard",
                name: "Standard"
            },

            maximum: {
                id: "maximum",
                name: "Maximum"
            }

        });


    /* =====================================================
       STATE
       ===================================================== */

    let currentMode =
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


            return MODES[mode]
                ? mode
                : "standard";

        };


    /* =====================================================
       UI SYNC
       ===================================================== */

    const updateUi = () => {

        intelligenceButtons.forEach(
            button => {

                const selected =
                    button.dataset.value ===
                    currentMode;


                button.classList.toggle(
                    "active",
                    selected
                );


                button.setAttribute(
                    "aria-pressed",
                    String(selected)
                );

            }
        );

    };


    /* =====================================================
       CHAT SYNC
       ===================================================== */

    const syncChatPreference = () => {

        window.NeyoChat
            ?.setPreferences?.({
                intelligence:
                    currentMode
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
            currentMode === next &&
            options.force !== true
        ) {

            updateUi();

            return currentMode;

        }


        currentMode =
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
                        currentMode,

                    info:
                        {
                            ...MODES[
                                currentMode
                            ]
                        }
                }
            );

        }


        return currentMode;

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
                        button.dataset.value
                    );

                }
            );

        }
    );


    /* =====================================================
       EXTERNAL SET
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


    /* =====================================================
       CHAT PREFERENCE RESTORE
       ===================================================== */

    window.addEventListener(
        "neyo:chat-preferences-change",
        event => {

            const mode =
                event.detail
                    ?.preferences
                    ?.intelligence;


            if (mode) {

                setMode(
                    mode,
                    {
                        silent:
                            true
                    }
                );

            }

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    const initialButton =
        intelligenceButtons.find(
            button =>
                button.classList
                    .contains(
                        "active"
                    )
        );


    currentMode =
        normalizeMode(
            initialButton
                ?.dataset
                ?.value ||
            "standard"
        );


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
                    currentMode,

            getCurrent:
                () => ({
                    ...MODES[
                        currentMode
                    ]
                }),

            getAll:
                () =>
                    Object.values(
                        MODES
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
