/*
=========================================================
NEYO — DEEP RESEARCH COMPONENT

Owns:
- Deep Research toggle state
- UI sync
- Chat preference sync
- Public events / API

Does NOT own:
- Research execution
- Search provider logic
- Chat API implementation
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const deepResearchToggleBtn =
        document.getElementById(
            "deepResearchToggleBtn"
        );


    /* =====================================================
       STATE
       ===================================================== */

    let enabled = false;


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
       UI SYNC
       ===================================================== */

    const updateUi = () => {

        if (!deepResearchToggleBtn) {
            return;
        }


        deepResearchToggleBtn
            .classList
            .toggle(
                "active",
                enabled
            );


        deepResearchToggleBtn
            .setAttribute(
                "aria-pressed",
                String(enabled)
            );


        deepResearchToggleBtn
            .setAttribute(
                "data-active",
                String(enabled)
            );

    };


    /* =====================================================
       CHAT SYNC
       ===================================================== */

    const syncChatPreference = () => {

        window.NeyoChat
            ?.setPreferences?.({
                isDeepResearch:
                    enabled
            });

    };


    /* =====================================================
       SET STATE
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

        syncChatPreference();


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
       BUTTON EVENT
       ===================================================== */

    deepResearchToggleBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();


                toggleDeepResearch();

            }
        );


    /* =====================================================
       EXTERNAL SET
       ===================================================== */

    window.addEventListener(
        "neyo:deep-research-set",
        event => {

            setDeepResearch(
                event.detail?.enabled,
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
       EXTERNAL TOGGLE
       ===================================================== */

    window.addEventListener(
        "neyo:deep-research-toggle-request",
        toggleDeepResearch
    );


    /* =====================================================
       CHAT PREFERENCE RESTORE
       ===================================================== */

    window.addEventListener(
        "neyo:chat-preferences-change",
        event => {

            const value =
                event.detail
                    ?.preferences
                    ?.isDeepResearch;


            if (
                typeof value ===
                "boolean"
            ) {

                setDeepResearch(
                    value,
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

    enabled =
        deepResearchToggleBtn
            ?.getAttribute(
                "aria-pressed"
            ) === "true";


    updateUi();

    syncChatPreference();


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
