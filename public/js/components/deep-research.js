/*
=========================================================
NEYO — DEEP RESEARCH COMPONENT

Owns:
- Deep Research mode state
- Toggle UI
- Chat preference sync
- Research lifecycle events
- Public research API

Does NOT own:
- Chat API implementation
- Web research execution
- Search provider logic
- Message rendering
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const deepResearchBtn =
        document.getElementById(
            "deepResearchBtn"
        );

    const deepResearchToggle =
        document.getElementById(
            "deepResearchToggle"
        );


    /* =====================================================
       STATE
       ===================================================== */

    let enabled =
        false;


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


    /* =====================================================
       UI
       ===================================================== */

    const updateUi = () => {

        deepResearchBtn
            ?.classList
            .toggle(
                "active",
                enabled
            );


        deepResearchToggle
            ?.classList
            .toggle(
                "active",
                enabled
            );


        deepResearchBtn
            ?.setAttribute(
                "aria-pressed",
                String(enabled)
            );


        deepResearchToggle
            ?.setAttribute(
                "aria-pressed",
                String(enabled)
            );


        document.body
            .classList
            .toggle(
                "deep-research-active",
                enabled
            );

    };


    /* =====================================================
       CHAT SYNC
       ===================================================== */

    const syncChatPreferences = () => {

        window.NeyoChat
            ?.setPreferences?.({
                isDeepResearch:
                    enabled
            });

    };


    /* =====================================================
       SET
       ===================================================== */

    const setDeepResearch = (
        value,
        options = {}
    ) => {

        const next =
            Boolean(value);


        if (
            enabled === next &&
            options.force !== true
        ) {
            return enabled;
        }


        enabled =
            next;


        updateUi();

        syncChatPreferences();


        if (
            options.silent !== true
        ) {

            emit(
                "neyo:deep-research-change",
                {
                    enabled
                }
            );

        }


        return enabled;

    };


    /* =====================================================
       TOGGLE
       ===================================================== */

    const toggleDeepResearch = () => {

        return setDeepResearch(
            !enabled
        );

    };


    /* =====================================================
       BUTTON EVENTS
       ===================================================== */

    deepResearchBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();

                toggleDeepResearch();

            }
        );


    deepResearchToggle
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();

                toggleDeepResearch();

            }
        );


    /* =====================================================
       NEW CHAT
       ===================================================== */

    window.addEventListener(
        "neyo:new-chat-success",
        () => {

            /*
            Keep user's current mode,
            just re-sync preferences.
            */

            syncChatPreferences();

        }
    );


    /* =====================================================
       EXTERNAL EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:deep-research-set",
        event => {

            setDeepResearch(
                event.detail?.enabled,
                {
                    silent:
                        Boolean(
                            event.detail?.silent
                        )
                }
            );

        }
    );


    window.addEventListener(
        "neyo:deep-research-toggle-request",
        toggleDeepResearch
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    updateUi();

    syncChatPreferences();


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoDeepResearch =
        Object.freeze({

            enable:
                () =>
                    setDeepResearch(
                        true
                    ),

            disable:
                () =>
                    setDeepResearch(
                        false
                    ),

            toggle:
                toggleDeepResearch,

            set:
                setDeepResearch,

            isEnabled:
                () =>
                    enabled

        });

})();
