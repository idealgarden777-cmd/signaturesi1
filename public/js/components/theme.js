/*
=========================================================
NEYO — THEME ENGINE COMPONENT

Owns:
- Light / dark / system theme
- Theme persistence
- System preference detection
- Document theme application
- Global theme events
- Public theme API

Does NOT own:
- Topbar button UI
- Settings modal UI
- Accent colors
- Typography
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const STORAGE_KEY =
        "neyo-theme";

    const VALID_MODES =
        new Set([
            "light",
            "dark",
            "system"
        ]);


    /* =====================================================
       SYSTEM THEME
       ===================================================== */

    const systemThemeQuery =
        window.matchMedia(
            "(prefers-color-scheme: dark)"
        );


    const getSystemTheme = () =>
        systemThemeQuery.matches
            ? "dark"
            : "light";


    /* =====================================================
       STORAGE
       ===================================================== */

    const readStoredTheme = () => {

        try {

            const stored =
                localStorage.getItem(
                    STORAGE_KEY
                );


            if (
                stored &&
                VALID_MODES.has(stored)
            ) {
                return stored;
            }

        }

        catch {
            // Storage unavailable.
        }


        return null;
    };


    const saveTheme = mode => {

        try {

            localStorage.setItem(
                STORAGE_KEY,
                mode
            );

        }

        catch {
            // Storage unavailable.
        }

    };


    /* =====================================================
       STATE
       ===================================================== */

    let themeMode =
        readStoredTheme() ||
        document.documentElement
            .dataset.themeMode ||
        "system";


    let resolvedTheme =
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


    const resolveTheme =
        mode => {

            if (mode === "system") {
                return getSystemTheme();
            }


            return mode === "dark"
                ? "dark"
                : "light";

        };


    /* =====================================================
       APPLY THEME
       ===================================================== */

    const applyTheme =
        (
            mode,
            options = {}
        ) => {

            if (
                !VALID_MODES.has(mode)
            ) {
                return false;
            }


            themeMode =
                mode;


            resolvedTheme =
                resolveTheme(mode);


            const root =
                document.documentElement;


            /* -----------------------------------------
               DATA ATTRIBUTES
               ----------------------------------------- */

            root.dataset.themeMode =
                themeMode;


            root.dataset.theme =
                resolvedTheme;


            /* -----------------------------------------
               CLASSES
               ----------------------------------------- */

            root.classList.toggle(
                "dark",
                resolvedTheme === "dark"
            );


            root.classList.toggle(
                "light",
                resolvedTheme === "light"
            );


            document.body?.classList.toggle(
                "dark-theme",
                resolvedTheme === "dark"
            );


            document.body?.classList.toggle(
                "light-theme",
                resolvedTheme === "light"
            );


            /* -----------------------------------------
               COLOR SCHEME
               ----------------------------------------- */

            root.style.colorScheme =
                resolvedTheme;


            /* -----------------------------------------
               SAVE
               ----------------------------------------- */

            if (
                options.persist !== false
            ) {

                saveTheme(
                    themeMode
                );

            }


            /* -----------------------------------------
               EVENT
               ----------------------------------------- */

            if (
                options.silent !== true
            ) {

                emit(
                    "neyo:theme-change",
                    {
                        mode:
                            themeMode,

                        theme:
                            resolvedTheme,

                        source:
                            options.source ||
                            "theme"
                    }
                );

            }


            return true;

        };


    /* =====================================================
       SET THEME
       ===================================================== */

    const setTheme =
        (
            mode,
            options = {}
        ) => {

            return applyTheme(
                mode,
                options
            );

        };


    /* =====================================================
       TOGGLE
       ===================================================== */

    const toggleTheme = (
        options = {}
    ) => {

        /*
        Manual toggle intentionally switches
        between light and dark.

        If current mode is "system", toggle
        from the currently resolved theme.
        */

        const nextTheme =
            resolvedTheme === "dark"
                ? "light"
                : "dark";


        applyTheme(
            nextTheme,
            {
                ...options,

                source:
                    options.source ||
                    "toggle"
            }
        );


        return nextTheme;

    };


    /* =====================================================
       SYSTEM MODE
       ===================================================== */

    const useSystemTheme = (
        options = {}
    ) => {

        applyTheme(
            "system",
            {
                ...options,

                source:
                    options.source ||
                    "system"
            }
        );

    };


    /* =====================================================
       SYSTEM PREFERENCE CHANGE
       ===================================================== */

    const handleSystemThemeChange = () => {

        if (
            themeMode !== "system"
        ) {
            return;
        }


        /*
        Do not rewrite stored preference.
        User still selected "system".
        */

        applyTheme(
            "system",
            {
                persist:
                    false,

                source:
                    "system-change"
            }
        );

    };


    if (
        typeof systemThemeQuery
            .addEventListener ===
        "function"
    ) {

        systemThemeQuery.addEventListener(
            "change",
            handleSystemThemeChange
        );

    }

    else {

        /*
        Legacy Safari fallback.
        */

        systemThemeQuery.addListener?.(
            handleSystemThemeChange
        );

    }


    /* =====================================================
       TOPBAR TOGGLE REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:theme-toggle-request",
        event => {

            toggleTheme({
                source:
                    event.detail?.source ||
                    "request"
            });

        }
    );


    /* =====================================================
       GENERIC SET REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:theme-set-request",
        event => {

            const mode =
                event.detail?.mode ||
                event.detail?.theme;


            if (!mode) {
                return;
            }


            setTheme(
                mode,
                {
                    source:
                        event.detail?.source ||
                        "request"
                }
            );

        }
    );


    /* =====================================================
       SYSTEM REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:theme-system-request",
        () => {

            useSystemTheme({
                source:
                    "request"
            });

        }
    );


    /* =====================================================
       INITIALIZE
       ===================================================== */

    applyTheme(
        themeMode,
        {
            /*
            Existing preference does not need
            to be written back on startup.
            */

            persist:
                false,

            source:
                "initial",

            silent:
                false
        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoTheme =
        Object.freeze({

            set:
                setTheme,

            toggle:
                toggleTheme,

            useSystem:
                useSystemTheme,

            getMode:
                () =>
                    themeMode,

            getResolved:
                () =>
                    resolvedTheme,

            getSystem:
                getSystemTheme,

            isDark:
                () =>
                    resolvedTheme ===
                    "dark",

            isLight:
                () =>
                    resolvedTheme ===
                    "light"

        });

})();
