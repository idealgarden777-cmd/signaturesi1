/*
=========================================================
NEYO — LANGUAGE COMPONENT

Owns:
- Chat language preference
- Language selection state
- UI sync
- Chat preference sync
- Public language events / API

Does NOT own:
- Translation
- Chat API implementation
- Settings modal layout
- Browser locale detection beyond initial fallback
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const VALID_LANGUAGES =
        new Set([
            "auto",
            "en",
            "ur",
            "hi",
            "es",
            "fr",
            "de",
            "ar"
        ]);


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const languageSelect =
        document.getElementById(
            "languageSelect"
        );

    const languageBtn =
        document.getElementById(
            "languageBtn"
        );


    /* =====================================================
       STATE
       ===================================================== */

    let currentLanguage =
        "auto";


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


    const normalizeLanguage =
        value => {

            const language =
                String(
                    value || "auto"
                )
                    .trim()
                    .toLowerCase();


            return VALID_LANGUAGES.has(
                language
            )
                ? language
                : "auto";

        };


    /* =====================================================
       UI SYNC
       ===================================================== */

    const updateUi = () => {

        if (languageSelect) {

            languageSelect.value =
                currentLanguage;

        }


        if (languageBtn) {

            languageBtn.dataset.language =
                currentLanguage;


            languageBtn.setAttribute(
                "aria-label",
                currentLanguage === "auto"
                    ? "Language: Auto"
                    : `Language: ${currentLanguage.toUpperCase()}`
            );

        }

    };


    /* =====================================================
       CHAT SYNC
       ===================================================== */

    const syncChatPreference = () => {

        window.NeyoChat
            ?.setPreferences?.({
                language:
                    currentLanguage
            });

    };


    /* =====================================================
       SET LANGUAGE
       ===================================================== */

    const setLanguage = (
        value,
        options = {}
    ) => {

        const next =
            normalizeLanguage(
                value
            );


        if (
            currentLanguage === next &&
            options.force !== true
        ) {
            return currentLanguage;
        }


        currentLanguage =
            next;


        updateUi();

        syncChatPreference();


        if (
            options.silent !== true
        ) {

            emit(
                "neyo:language-change",
                {
                    language:
                        currentLanguage
                }
            );

        }


        return currentLanguage;

    };


    /* =====================================================
       SELECT EVENT
       ===================================================== */

    languageSelect
        ?.addEventListener(
            "change",
            event => {

                setLanguage(
                    event.target.value
                );

            }
        );


    /* =====================================================
       OPTIONAL LANGUAGE BUTTON
       ===================================================== */

    languageBtn
        ?.addEventListener(
            "click",
            () => {

                emit(
                    "neyo:language-menu-request",
                    {
                        language:
                            currentLanguage
                    }
                );

            }
        );


    /* =====================================================
       EXTERNAL EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:language-set",
        event => {

            setLanguage(
                event.detail?.language,
                {
                    silent:
                        Boolean(
                            event.detail?.silent
                        )
                }
            );

        }
    );


    /* =====================================================
       AUTH / PROFILE SYNC
       ===================================================== */

    window.addEventListener(
        "neyo:profile-loaded",
        event => {

            const preferredLanguage =
                event.detail
                    ?.profile
                    ?.language;


            if (preferredLanguage) {

                setLanguage(
                    preferredLanguage
                );

            }

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    if (
        languageSelect?.value
    ) {

        currentLanguage =
            normalizeLanguage(
                languageSelect.value
            );

    }


    updateUi();

    syncChatPreference();


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoLanguage =
        Object.freeze({

            set:
                setLanguage,

            get:
                () =>
                    currentLanguage,

            isAuto:
                () =>
                    currentLanguage ===
                    "auto",

            getSupported:
                () =>
                    [
                        ...VALID_LANGUAGES
                    ]

        });

})();
