/* =========================================================
   NEYO SETTINGS — APPEARANCE MODULE
   File: /js/settings/settings-appearance.js

   Purpose:
   - Accent presets
   - Custom accent picker
   - Text size
   - Content width
   - Sidebar density
   - Interface motion
   - Sync Appearance controls
   - Reuse existing NEYO preference storage

   IMPORTANT:
   Load AFTER neo.js.
   ========================================================= */

(() => {
    "use strict";


    /* =========================================================
       STORAGE
       ========================================================= */

    const STORAGE_KEYS = {
        accent: "neo_accent",
        textSize: "neo_text_size",
        contentWidth: "neo_content_width",
        sidebarDensity: "neo_sidebar_density",
        motion: "neo_motion"
    };


    const DEFAULTS = {
        accent: "neutral",
        textSize: "default",
        contentWidth: "balanced",
        sidebarDensity: "comfortable",
        motion: "on"
    };


    const ACCENT_COLORS = {
        neutral: "#171717",
        blue: "#3377e8",
        emerald: "#0f8f66",
        violet: "#7660e8"
    };


    /* =========================================================
       HELPERS
       ========================================================= */

    function normalizeHexColor(value) {
        const color =
            String(value || "").trim();

        if (
            /^#[0-9a-fA-F]{6}$/.test(
                color
            )
        ) {
            return color.toLowerCase();
        }

        return null;
    }


    function hexToRgb(hex) {
        const safeHex =
            normalizeHexColor(hex);

        if (!safeHex) {
            return {
                r: 23,
                g: 23,
                b: 23
            };
        }

        const number =
            parseInt(
                safeHex.slice(1),
                16
            );

        return {
            r: (number >> 16) & 255,
            g: (number >> 8) & 255,
            b: number & 255
        };
    }


    function getStoredPreference(
        key
    ) {
        /*
         * Prefer existing app preference
         * function if exposed globally.
         */
        if (
            typeof window.getPreference ===
            "function"
        ) {
            return window.getPreference(
                key
            );
        }

        const storageKey =
            STORAGE_KEYS[key];

        if (!storageKey) {
            return DEFAULTS[key];
        }

        const stored =
            localStorage.getItem(
                storageKey
            );

        return stored === null
            ? DEFAULTS[key]
            : stored;
    }


    function setStoredPreference(
        key,
        value
    ) {
        /*
         * Prefer existing app state system.
         */
        if (
            typeof window.updatePreference ===
            "function"
        ) {
            window.updatePreference(
                key,
                value
            );

            return;
        }

        const storageKey =
            STORAGE_KEYS[key];

        if (!storageKey) return;

        localStorage.setItem(
            storageKey,
            String(value)
        );

        applyPreferenceVisual(
            key,
            value
        );

        syncAppearanceControls();
    }


    /* =========================================================
       ACCENT
       ========================================================= */

    function applyAccentVisual(
        value
    ) {
        const preset =
            ACCENT_COLORS[value];

        const custom =
            normalizeHexColor(
                value
            );

        const color =
            preset ||
            custom ||
            ACCENT_COLORS.neutral;

        const rgb =
            hexToRgb(color);

        document
            .documentElement
            .style
            .setProperty(
                "--neyo-accent",
                color
            );

        document
            .documentElement
            .style
            .setProperty(
                "--neyo-accent-soft",
                `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.10)`
            );

        document.body.dataset.neyoAccent =
            custom
                ? "custom"
                : (
                    ACCENT_COLORS[value]
                        ? value
                        : "neutral"
                );
    }


    function syncAccentControl() {
        const value =
            getStoredPreference(
                "accent"
            );

        const custom =
            normalizeHexColor(
                value
            );

        const control =
            document.getElementById(
                "appearanceAccentControl"
            ) ||
            document.getElementById(
                "settingsAccentControl"
            );

        if (control) {
            control
                .querySelectorAll(
                    "button[data-value], button[data-accent]"
                )
                .forEach(button => {
                    const buttonValue =
                        button.dataset.value ||
                        button.dataset.accent;

                    const active =
                        !custom &&
                        buttonValue ===
                            value;

                    button
                        .classList
                        .toggle(
                            "active",
                            active
                        );

                    button
                        .setAttribute(
                            "aria-pressed",
                            String(active)
                        );
                });

            const customButton =
                control.querySelector(
                    ".settings-pill-custom"
                );

            if (customButton) {
                customButton
                    .classList
                    .toggle(
                        "active",
                        Boolean(custom)
                    );

                customButton.setAttribute(
                    "aria-pressed",
                    String(
                        Boolean(custom)
                    )
                );
            }
        }

        const picker =
            document.getElementById(
                "customAccentPicker"
            );

        if (
            picker &&
            custom
        ) {
            picker.value =
                custom;
        }

        applyAccentVisual(
            value
        );
    }


    function setupAccentControl() {
        const control =
            document.getElementById(
                "appearanceAccentControl"
            ) ||
            document.getElementById(
                "settingsAccentControl"
            );

        const picker =
            document.getElementById(
                "customAccentPicker"
            );

        if (!control) return;

        control
            .querySelectorAll(
                "button[data-value], button[data-accent]"
            )
            .forEach(button => {
                button.addEventListener(
                    "click",
                    () => {
                        const value =
                            button.dataset.value ||
                            button.dataset.accent;

                        if (!value) return;

                        if (
                            value ===
                            "custom"
                        ) {
                            picker?.click();
                            return;
                        }

                        setStoredPreference(
                            "accent",
                            value
                        );

                        syncAccentControl();
                    }
                );
            });


        const customButton =
            control.querySelector(
                ".settings-pill-custom"
            );

        customButton
            ?.addEventListener(
                "click",
                event => {
                    event.preventDefault();

                    picker?.click();
                }
            );


        picker
            ?.addEventListener(
                "input",
                () => {
                    const color =
                        normalizeHexColor(
                            picker.value
                        );

                    if (!color) return;

                    setStoredPreference(
                        "accent",
                        color
                    );

                    syncAccentControl();
                }
            );


        picker
            ?.addEventListener(
                "change",
                () => {
                    const color =
                        normalizeHexColor(
                            picker.value
                        );

                    if (!color) return;

                    setStoredPreference(
                        "accent",
                        color
                    );

                    syncAccentControl();
                }
            );


        syncAccentControl();
    }


    /* =========================================================
       GENERIC SEGMENTED CONTROL
       ========================================================= */

    function setupSegmentedControl({
        controlId,
        preferenceKey,
        allowed,
        fallback,
        bodyDataset
    }) {
        const control =
            document.getElementById(
                controlId
            );

        if (!control) return;

        const buttons =
            Array.from(
                control.querySelectorAll(
                    "button"
                )
            );


        function sync() {
            let value =
                getStoredPreference(
                    preferenceKey
                );

            if (
                !allowed.includes(
                    value
                )
            ) {
                value =
                    fallback;
            }

            buttons.forEach(
                button => {
                    const active =
                        button.dataset.value ===
                        value;

                    button
                        .classList
                        .toggle(
                            "active",
                            active
                        );

                    button
                        .setAttribute(
                            "aria-pressed",
                            String(active)
                        );
                }
            );

            if (bodyDataset) {
                document.body.dataset[
                    bodyDataset
                ] = value;
            }
        }


        buttons.forEach(
            button => {
                button.addEventListener(
                    "click",
                    () => {
                        const value =
                            button.dataset.value;

                        if (
                            !allowed.includes(
                                value
                            )
                        ) {
                            return;
                        }

                        setStoredPreference(
                            preferenceKey,
                            value
                        );

                        sync();
                    }
                );
            }
        );


        sync();
    }


    /* =========================================================
       TEXT SIZE
       ========================================================= */

    function setupTextSize() {
        setupSegmentedControl({
            controlId:
                "appearanceTextSizeControl",

            preferenceKey:
                "textSize",

            allowed: [
                "small",
                "default",
                "large"
            ],

            fallback:
                "default",

            bodyDataset:
                "neyoTextSize"
        });
    }


    /* =========================================================
       CONTENT WIDTH
       ========================================================= */

    function setupContentWidth() {
        setupSegmentedControl({
            controlId:
                "appearanceContentWidthControl",

            preferenceKey:
                "contentWidth",

            allowed: [
                "compact",
                "balanced",
                "wide"
            ],

            fallback:
                "balanced",

            bodyDataset:
                "neyoContentWidth"
        });
    }


    /* =========================================================
       SIDEBAR DENSITY
       ========================================================= */

    function setupSidebarDensity() {
        setupSegmentedControl({
            controlId:
                "appearanceSidebarDensityControl",

            preferenceKey:
                "sidebarDensity",

            allowed: [
                "compact",
                "comfortable"
            ],

            fallback:
                "comfortable",

            bodyDataset:
                "neyoSidebarDensity"
        });
    }


    /* =========================================================
       MOTION
       ========================================================= */

    function setupMotion() {
        setupSegmentedControl({
            controlId:
                "appearanceMotionControl",

            preferenceKey:
                "motion",

            allowed: [
                "on",
                "reduced"
            ],

            fallback:
                "on",

            bodyDataset:
                "neyoMotion"
        });
    }


    /* =========================================================
       FALLBACK VISUAL APPLY
       ========================================================= */

    function applyPreferenceVisual(
        key,
        value
    ) {
        switch (key) {

            case "accent":
                applyAccentVisual(
                    value
                );
                break;

            case "textSize":
                document.body.dataset
                    .neyoTextSize =
                    value;
                break;

            case "contentWidth":
                document.body.dataset
                    .neyoContentWidth =
                    value;
                break;

            case "sidebarDensity":
                document.body.dataset
                    .neyoSidebarDensity =
                    value;
                break;

            case "motion":
                document.body.dataset
                    .neyoMotion =
                    value;
                break;
        }
    }


    /* =========================================================
       FULL SYNC
       ========================================================= */

    function syncAppearanceControls() {
        syncAccentControl();

        document.body.dataset
            .neyoTextSize =
            getStoredPreference(
                "textSize"
            );

        document.body.dataset
            .neyoContentWidth =
            getStoredPreference(
                "contentWidth"
            );

        document.body.dataset
            .neyoSidebarDensity =
            getStoredPreference(
                "sidebarDensity"
            );

        document.body.dataset
            .neyoMotion =
            getStoredPreference(
                "motion"
            );
    }


    /* =========================================================
       INIT
       ========================================================= */

    function initAppearanceModule() {
        setupAccentControl();

        setupTextSize();

        setupContentWidth();

        setupSidebarDensity();

        setupMotion();

        syncAppearanceControls();
    }


    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            initAppearanceModule,
            {
                once: true
            }
        );
    } else {
        initAppearanceModule();
    }


    /*
     * Optional small public API.
     * Useful later when other modules
     * need to refresh Appearance.
     */

    window.NeyoAppearance = {
        sync:
            syncAppearanceControls,

        applyAccent:
            applyAccentVisual
    };

})();
