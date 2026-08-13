/*
=========================================================
NEYO — TOPBAR COMPONENT

Owns:
- Topbar theme button
- Topbar state
- Theme icon sync
- Public topbar events / API

Does NOT own:
- Sidebar behavior
- Model dropdown behavior
- Theme engine itself
- History
- Settings
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const topBar =
        document.querySelector(".top-bar");

    const darkModeToggle =
        document.getElementById(
            "topBarDarkModeToggle"
        );


    if (!topBar) {
        return;
    }


    /* =====================================================
       STATE
       ===================================================== */

    let currentTheme =
        document.documentElement
            .dataset.theme ||
        "light";


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


    const refreshIcons = () => {

        if (
            window.lucide
                ?.createIcons
        ) {

            window.lucide
                .createIcons();

        }

    };


    /* =====================================================
       THEME ICON
       ===================================================== */

    const updateThemeIcon =
        theme => {

            if (!darkModeToggle) {
                return;
            }


            const isDark =
                theme === "dark";


            darkModeToggle.innerHTML =
                isDark
                    ? `
                        <i
                            data-lucide="moon"
                            size="20"
                            aria-hidden="true"
                        ></i>
                    `
                    : `
                        <i
                            data-lucide="sun"
                            size="20"
                            aria-hidden="true"
                        ></i>
                    `;


            darkModeToggle.setAttribute(
                "aria-label",
                isDark
                    ? "Switch to light theme"
                    : "Switch to dark theme"
            );


            darkModeToggle.dataset.tooltip =
                isDark
                    ? "Light theme"
                    : "Dark theme";


            refreshIcons();

        };


    /* =====================================================
       SET THEME STATE
       ===================================================== */

    const setThemeState =
        (
            theme,
            options = {}
        ) => {

            currentTheme =
                theme === "dark"
                    ? "dark"
                    : "light";


            topBar.dataset.theme =
                currentTheme;


            updateThemeIcon(
                currentTheme
            );


            if (
                options.silent !== true
            ) {

                emit(
                    "neyo:topbar-theme-change",
                    {
                        theme:
                            currentTheme
                    }
                );

            }

        };


    /* =====================================================
       THEME REQUEST
       ===================================================== */

    const requestThemeToggle = () => {

        /*
        topbar.js does NOT change the
        application theme directly.

        The future theme.js module will
        listen for this event.
        */

        emit(
            "neyo:theme-toggle-request",
            {
                source:
                    "topbar",

                currentTheme
            }
        );

    };


    /* =====================================================
       BUTTON EVENT
       ===================================================== */

    darkModeToggle?.addEventListener(
        "click",
        event => {

            event.preventDefault();

            requestThemeToggle();

        }
    );


    /* =====================================================
       LISTEN FOR GLOBAL THEME CHANGE
       ===================================================== */

    window.addEventListener(
        "neyo:theme-change",
        event => {

            const theme =
                event.detail?.theme;


            if (!theme) {
                return;
            }


            setThemeState(
                theme,
                {
                    silent:
                        true
                }
            );

        }
    );


    /* =====================================================
       TOPBAR VISIBILITY
       ===================================================== */

    const showTopbar = () => {

        topBar.hidden =
            false;


        topBar.classList.remove(
            "hidden"
        );


        emit(
            "neyo:topbar-show"
        );

    };


    const hideTopbar = () => {

        topBar.classList.add(
            "hidden"
        );


        emit(
            "neyo:topbar-hide"
        );

    };


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:topbar-show-request",
        showTopbar
    );


    window.addEventListener(
        "neyo:topbar-hide-request",
        hideTopbar
    );


    window.addEventListener(
        "neyo:topbar-theme-set",
        event => {

            setThemeState(
                event.detail?.theme
            );

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    setThemeState(
        currentTheme,
        {
            silent:
                true
        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoTopbar =
        Object.freeze({

            show:
                showTopbar,

            hide:
                hideTopbar,

            setTheme:
                setThemeState,

            getTheme:
                () =>
                    currentTheme,

            requestThemeToggle

        });

})();
