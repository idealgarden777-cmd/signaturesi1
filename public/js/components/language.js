/*
=========================================================
NEYO — LANGUAGE COMPONENT

Owns:
- Language preference
- Settings language menu
- Active option UI
- Chat preference sync
- Public events / API

Does NOT own:
- Translation engine
- Chat API implementation
- Settings modal layout
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const languageBtn =
        document.getElementById(
            "settingsLanguageBtn"
        );

    const languageValue =
        document.getElementById(
            "settingsLanguageValue"
        );

    const languageMenu =
        document.getElementById(
            "settingsLanguageMenu"
        );

    const languageOptions =
        languageMenu
            ? Array.from(
                languageMenu.querySelectorAll(
                    ".settings-select-option[data-value]"
                )
            )
            : [];


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const LABELS =
        Object.freeze({

            auto:
                "Auto-detect",

            english:
                "English",

            urdu:
                "Urdu",

            "roman-urdu":
                "Roman Urdu"

        });


    const VALID_LANGUAGES =
        new Set(
            Object.keys(
                LABELS
            )
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

            const normalized =
                String(
                    value || "auto"
                )
                    .trim()
                    .toLowerCase();


            return VALID_LANGUAGES
                .has(normalized)
                ? normalized
                : "auto";

        };


    const isMenuOpen = () => {

        return (
            languageMenu &&
            languageMenu.hidden ===
                false
        );

    };


    /* =====================================================
       UI SYNC
       ===================================================== */

    const updateUi = () => {

        const label =
            LABELS[
                currentLanguage
            ] ||
            LABELS.auto;


        if (languageValue) {

            languageValue.textContent =
                label;

        }


        languageOptions.forEach(
            option => {

                const selected =
                    option.dataset.value ===
                    currentLanguage;


                option.classList.toggle(
                    "active",
                    selected
                );


                option.setAttribute(
                    "aria-selected",
                    String(selected)
                );

            }
        );

    };


    /* =====================================================
       MENU
       ===================================================== */

    const openMenu = () => {

        if (
            !languageMenu ||
            !languageBtn
        ) {
            return false;
        }


        languageMenu.hidden =
            false;


        languageBtn.setAttribute(
            "aria-expanded",
            "true"
        );


        return true;

    };


    const closeMenu = () => {

        if (
            !languageMenu ||
            !languageBtn
        ) {
            return false;
        }


        languageMenu.hidden =
            true;


        languageBtn.setAttribute(
            "aria-expanded",
            "false"
        );


        return true;

    };


    const toggleMenu = () => {

        return isMenuOpen()
            ? closeMenu()
            : openMenu();

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

            updateUi();

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
                        currentLanguage,

                    label:
                        LABELS[
                            currentLanguage
                        ]
                }
            );

        }


        return currentLanguage;

    };


    /* =====================================================
       BUTTON
       ===================================================== */

    languageBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();

                event.stopPropagation();


                toggleMenu();

            }
        );


    /* =====================================================
       OPTIONS
       ===================================================== */

    languageOptions.forEach(
        option => {

            option.addEventListener(
                "click",
                event => {

                    event.preventDefault();

                    event.stopPropagation();


                    setLanguage(
                        option.dataset.value
                    );


                    closeMenu();

                }
            );

        }
    );


    /* =====================================================
       OUTSIDE CLICK
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            if (!isMenuOpen()) {
                return;
            }


            const target =
                event.target;


            if (
                languageBtn?.contains(
                    target
                ) ||
                languageMenu?.contains(
                    target
                )
            ) {
                return;
            }


            closeMenu();

        }
    );


    /* =====================================================
       ESCAPE
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                    "Escape" &&
                isMenuOpen()
            ) {

                closeMenu();

            }

        }
    );


    /* =====================================================
       EXTERNAL SET
       ===================================================== */

    window.addEventListener(
        "neyo:language-set",
        event => {

            setLanguage(
                event.detail
                    ?.language,
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

            const language =
                event.detail
                    ?.preferences
                    ?.language;


            if (language) {

                setLanguage(
                    language,
                    {
                        silent:
                            true
                    }
                );

            }

        }
    );


    /* =====================================================
       SETTINGS CLOSE
       ===================================================== */

    window.addEventListener(
        "neyo:settings-close",
        closeMenu
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    const initialOption =
        languageOptions.find(
            option =>
                option.classList
                    .contains(
                        "active"
                    )
        );


    currentLanguage =
        normalizeLanguage(
            initialOption
                ?.dataset
                ?.value ||
            "auto"
        );


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

            open:
                openMenu,

            close:
                closeMenu,

            toggle:
                toggleMenu,

            isOpen:
                isMenuOpen,

            getLabel:
                () =>
                    LABELS[
                        currentLanguage
                    ],

            getSupported:
                () =>
                    [
                        ...VALID_LANGUAGES
                    ]

        });

})();
