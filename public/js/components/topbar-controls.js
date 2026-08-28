/*
=========================================================
NEYO — TOP BAR CONTROLS
SAFE UI BRIDGE v1

FILE:
public/js/components/topbar-controls.js

OWNS
---------------------------------------------------------
- Top bar Private Chat button
- Private Chat visual state
- Private Chat preference bridge to NeyoChat
- Private Chat settings-toggle synchronization
- Dynamic top-bar Sun / Moon icon
- Theme icon animation synchronization

DOES NOT OWN
---------------------------------------------------------
- Theme implementation
- Theme persistence engine
- Model selection
- Chat transport
- History API
- Send / Stop
- Sidebar
- Settings modal
- Authentication

IMPORTANT
---------------------------------------------------------
Theme click behavior remains owned by existing neo.js.

This component only observes the resulting theme state and
updates the top-bar icon.

Private Chat uses the existing NeyoChat.setPreferences()
runtime and existing neo_private_chat storage preference.
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       VERSION / SINGLETON
       ===================================================== */

    const VERSION =
        "neyo-topbar-controls-v1";


    if (
        window.NeyoTopbarControls
            ?.__controller === true
    ) {
        return;
    }


    /* =====================================================
       DOM
       ===================================================== */

    const privateChatBtn =
        document.getElementById(
            "topBarPrivateChatBtn"
        );


    const themeBtn =
        document.getElementById(
            "topBarDarkModeToggle"
        );


    const settingsPrivateToggle =
        document.getElementById(
            "settingsPrivateChatToggle"
        );


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const PRIVATE_STORAGE_KEY =
        "neo_private_chat";


    /* =====================================================
       EVENTS
       ===================================================== */

    function emit(
        name,
        detail = {}
    ) {

        window.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail
                }
            )
        );

    }


    /* =====================================================
       ICON REFRESH
       ===================================================== */

    function refreshIcons() {

        try {

            window.lucide
                ?.createIcons
                ?.();

        } catch {}

    }


    /* =====================================================
       SAFE STORAGE
       ===================================================== */

    function readStorage(
        key
    ) {

        try {

            return localStorage
                .getItem(
                    key
                );

        } catch {

            return null;

        }

    }


    function writeStorage(
        key,
        value
    ) {

        try {

            localStorage
                .setItem(
                    key,
                    String(
                        value
                    )
                );


            return true;

        } catch {

            return false;

        }

    }


    /* =====================================================
       BOOLEAN STORAGE
       ===================================================== */

    function parseStoredBoolean(
        value,
        fallback = false
    ) {

        if (
            value === null ||
            value === undefined
        ) {
            return fallback;
        }


        const normalized =
            String(
                value
            )
                .trim()
                .toLowerCase();


        if (
            normalized === "on" ||
            normalized === "true" ||
            normalized === "1"
        ) {
            return true;
        }


        if (
            normalized === "off" ||
            normalized === "false" ||
            normalized === "0"
        ) {
            return false;
        }


        return fallback;

    }


    /* =====================================================
       PRIVATE CHAT — READ
       ===================================================== */

    function getStoredPrivateChat() {

        return parseStoredBoolean(
            readStorage(
                PRIVATE_STORAGE_KEY
            ),
            false
        );

    }


    function getRuntimePrivateChat() {

        try {

            const preferences =
                window.NeyoChat
                    ?.getPreferences
                    ?.();


            if (
                preferences &&
                typeof preferences.privateChat ===
                    "boolean"
            ) {

                return preferences.privateChat;

            }

        } catch {}


        return getStoredPrivateChat();

    }


    /* =====================================================
       PRIVATE CHAT — SETTINGS UI
       ===================================================== */

    function syncSettingsPrivateChat(
        enabled
    ) {

        if (
            !settingsPrivateToggle
        ) {
            return;
        }


        settingsPrivateToggle
            .classList
            .toggle(
                "active",
                enabled
            );


        settingsPrivateToggle
            .setAttribute(
                "aria-checked",
                String(
                    enabled
                )
            );

    }


    /* =====================================================
       PRIVATE CHAT — TOP BAR UI
       ===================================================== */

    function syncPrivateChatButton(
        enabled
    ) {

        if (
            !privateChatBtn
        ) {
            return;
        }


        privateChatBtn
            .classList
            .toggle(
                "active",
                enabled
            );


        privateChatBtn
            .classList
            .toggle(
                "is-active",
                enabled
            );


        privateChatBtn
            .setAttribute(
                "aria-pressed",
                String(
                    enabled
                )
            );


        privateChatBtn
            .setAttribute(
                "aria-label",
                enabled
                    ? "Turn off Private Chat"
                    : "Start Private Chat"
            );


        privateChatBtn
            .setAttribute(
                "title",
                enabled
                    ? "Private Chat On"
                    : "Private Chat"
            );


        privateChatBtn
            .setAttribute(
                "data-tooltip",
                enabled
                    ? "Private Chat On"
                    : "Private Chat"
            );


        /*
         * Keep the same icon language.
         *
         * OFF  = unlocked-style shield/lock feel
         * ON   = locked private session
         */

        const icon =
            privateChatBtn
                .querySelector(
                    "[data-lucide]"
                );


        if (icon) {

            icon.setAttribute(
                "data-lucide",
                enabled
                    ? "lock-keyhole"
                    : "lock"
            );

        }


        refreshIcons();

    }


    /* =====================================================
       PRIVATE CHAT — BODY
       ===================================================== */

    function syncPrivateBody(
        enabled
    ) {

        document.body
            .classList
            .toggle(
                "neo-private-chat",
                enabled
            );


        document.body
            .toggleAttribute(
                "data-private-chat",
                enabled
            );

    }


    /* =====================================================
       PRIVATE CHAT — ALL UI
       ===================================================== */

    function syncPrivateChatUI(
        enabled
    ) {

        const value =
            Boolean(
                enabled
            );


        syncPrivateChatButton(
            value
        );


        syncSettingsPrivateChat(
            value
        );


        syncPrivateBody(
            value
        );


        return value;

    }


    /* =====================================================
       PRIVATE CHAT — RUNTIME
       ===================================================== */

    function applyPrivateChatToRuntime(
        enabled
    ) {

        const chat =
            window.NeyoChat;


        if (
            !chat ||
            chat.__controller !==
                true ||
            typeof chat
                .setPreferences !==
                "function"
        ) {

            return false;

        }


        chat.setPreferences({
            privateChat:
                Boolean(
                    enabled
                )
        });


        return true;

    }


    /* =====================================================
       PRIVATE CHAT — PERSIST
       ===================================================== */

    function persistPrivateChat(
        enabled
    ) {

        return writeStorage(
            PRIVATE_STORAGE_KEY,
            enabled
                ? "on"
                : "off"
        );

    }


    /* =====================================================
       PRIVATE CHAT — START FRESH
       ===================================================== */

    function startFreshConversation() {

        const chat =
            window.NeyoChat;


        if (
            !chat ||
            chat.__controller !==
                true ||
            typeof chat
                .newConversation !==
                "function"
        ) {

            /*
             * Compatibility bridge.
             */

            emit(
                "neyo:chat-new-request"
            );


            return false;

        }


        chat.newConversation();


        return true;

    }


    /* =====================================================
       PRIVATE CHAT — SET
       ===================================================== */

    function setPrivateChat(
        enabled,
        {
            startFresh =
                false,

            persist =
                true,

            emitEvent =
                true
        } = {}
    ) {

        const value =
            Boolean(
                enabled
            );


        if (
            persist
        ) {

            persistPrivateChat(
                value
            );

        }


        /*
         * Set preference BEFORE starting the new conversation.
         *
         * This means:
         *
         * ON:
         * fresh conversation already knows it is private.
         *
         * OFF:
         * fresh conversation already knows it is normal.
         */

        applyPrivateChatToRuntime(
            value
        );


        syncPrivateChatUI(
            value
        );


        if (
            startFresh
        ) {

            startFreshConversation();

        }


        if (
            emitEvent
        ) {

            emit(
                "neyo:private-chat-change",
                {
                    enabled:
                        value
                }
            );

        }


        return value;

    }


    /* =====================================================
       PRIVATE CHAT — TOGGLE
       ===================================================== */

    function togglePrivateChat() {

        const current =
            getRuntimePrivateChat();


        const next =
            !current;


        /*
         * ChatGPT-style behavior:
         *
         * Switching either ON or OFF starts a clean session.
         */

        return setPrivateChat(
            next,
            {
                startFresh:
                    true,

                persist:
                    true,

                emitEvent:
                    true
            }
        );

    }


    /* =====================================================
       PRIVATE CHAT — TOP BUTTON CLICK
       ===================================================== */

    privateChatBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();

                event.stopPropagation();


                togglePrivateChat();

            }
        );


    /* =====================================================
       PRIVATE CHAT — SETTINGS SYNC
       ===================================================== */

    /*
     * Existing neo.js still owns the Settings toggle.
     *
     * We do NOT prevent its click.
     *
     * After its handler runs, read its persisted value
     * and mirror that state into NeyoChat + top bar.
     */

    settingsPrivateToggle
        ?.addEventListener(
            "click",
            () => {

                queueMicrotask(
                    () => {

                        const enabled =
                            getStoredPrivateChat();


                        applyPrivateChatToRuntime(
                            enabled
                        );


                        syncPrivateChatUI(
                            enabled
                        );

                    }
                );

            }
        );


    /* =====================================================
       PRIVATE CHAT — EXTERNAL PREFERENCE EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:chat-preferences-change",
        event => {

            const value =
                event.detail
                    ?.preferences
                    ?.privateChat;


            if (
                typeof value !==
                "boolean"
            ) {
                return;
            }


            persistPrivateChat(
                value
            );


            syncPrivateChatUI(
                value
            );

        }
    );


    /* =====================================================
       PRIVATE CHAT — STORAGE SYNC
       ===================================================== */

    window.addEventListener(
        "storage",
        event => {

            if (
                event.key !==
                PRIVATE_STORAGE_KEY
            ) {
                return;
            }


            const enabled =
                parseStoredBoolean(
                    event.newValue,
                    false
                );


            applyPrivateChatToRuntime(
                enabled
            );


            syncPrivateChatUI(
                enabled
            );

        }
    );


    /* =====================================================
       THEME HELPERS
       ===================================================== */

    function isDarkMode() {

        return document.body
            .classList
            .contains(
                "dark-mode"
            );

    }


    /* =====================================================
       THEME ICON HTML
       ===================================================== */

    function ensureThemeIcons() {

        if (!themeBtn) {
            return false;
        }


        /*
         * Replace only the visual icon contents.
         *
         * Button ID and existing neo.js click listener
         * remain untouched.
         */

        const hasSun =
            Boolean(
                themeBtn.querySelector(
                    ".theme-icon-sun"
                )
            );


        const hasMoon =
            Boolean(
                themeBtn.querySelector(
                    ".theme-icon-moon"
                )
            );


        if (
            hasSun &&
            hasMoon
        ) {
            return true;
        }


        themeBtn
            .replaceChildren();


        const sun =
            document.createElement(
                "i"
            );


        sun.className =
            "theme-icon-sun";


        sun.setAttribute(
            "data-lucide",
            "sun"
        );


        sun.setAttribute(
            "aria-hidden",
            "true"
        );


        const moon =
            document.createElement(
                "i"
            );


        moon.className =
            "theme-icon-moon";


        moon.setAttribute(
            "data-lucide",
            "moon"
        );


        moon.setAttribute(
            "aria-hidden",
            "true"
        );


        themeBtn.append(
            sun,
            moon
        );


        refreshIcons();


        return true;

    }


    /* =====================================================
       THEME ICON SYNC
       ===================================================== */

    function syncThemeIcon({
        animate = false
    } = {}) {

        if (!themeBtn) {
            return false;
        }


        ensureThemeIcons();


        const dark =
            isDarkMode();


        themeBtn
            .setAttribute(
                "aria-label",
                dark
                    ? "Switch to light theme"
                    : "Switch to dark theme"
            );


        themeBtn
            .setAttribute(
                "title",
                dark
                    ? "Light Theme"
                    : "Dark Theme"
            );


        themeBtn
            .setAttribute(
                "data-tooltip",
                dark
                    ? "Light theme"
                    : "Dark theme"
            );


        themeBtn.dataset.theme =
            dark
                ? "dark"
                : "light";


        if (
            animate
        ) {

            themeBtn
                .classList
                .add(
                    "theme-changing"
                );


            window.setTimeout(
                () => {

                    themeBtn
                        .classList
                        .remove(
                            "theme-changing"
                        );

                },
                220
            );

        }


        return true;

    }


    /* =====================================================
       THEME BUTTON CLICK OBSERVER
       ===================================================== */

    /*
     * neo.js owns this click.
     *
     * We do NOT:
     * - preventDefault
     * - stopPropagation
     * - change localStorage
     * - apply dark-mode ourselves
     *
     * We simply update the visual icon AFTER neo.js changes
     * the body state.
     */

    themeBtn
        ?.addEventListener(
            "click",
            () => {

                requestAnimationFrame(
                    () => {

                        syncThemeIcon({
                            animate:
                                true
                        });

                    }
                );

            }
        );


    /* =====================================================
       THEME MUTATION OBSERVER
       ===================================================== */

    /*
     * Covers:
     * - top-bar theme click
     * - sidebar appearance click
     * - Settings theme buttons
     * - System theme updates
     * - any existing neo.js theme change
     */

    const themeObserver =
        new MutationObserver(
            mutations => {

                const changed =
                    mutations.some(
                        mutation =>
                            mutation.type ===
                                "attributes" &&
                            mutation.attributeName ===
                                "class"
                    );


                if (!changed) {
                    return;
                }


                syncThemeIcon({
                    animate:
                        true
                });

            }
        );


    themeObserver.observe(
        document.body,
        {
            attributes:
                true,

            attributeFilter: [
                "class"
            ]
        }
    );


    /* =====================================================
       SYSTEM THEME OBSERVER
       ===================================================== */

    const systemThemeQuery =
        window.matchMedia?.(
            "(prefers-color-scheme: dark)"
        );


    function handleSystemThemeChange() {

        /*
         * Existing theme engine decides whether System mode
         * should actually alter dark-mode.
         *
         * We only refresh the icon afterwards.
         */

        requestAnimationFrame(
            () => {

                syncThemeIcon({
                    animate:
                        true
                });

            }
        );

    }


    try {

        systemThemeQuery
            ?.addEventListener?.(
                "change",
                handleSystemThemeChange
            );

    } catch {

        try {

            systemThemeQuery
                ?.addListener?.(
                    handleSystemThemeChange
                );

        } catch {}

    }


    /* =====================================================
       CHAT READY
       ===================================================== */

    window.addEventListener(
        "neyo:chat-ready",
        () => {

            const enabled =
                getStoredPrivateChat();


            setPrivateChat(
                enabled,
                {
                    startFresh:
                        false,

                    persist:
                        false,

                    emitEvent:
                        false
                }
            );

        }
    );


    /* =====================================================
       STATE REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:topbar-state-sync-request",
        () => {

            syncPrivateChatUI(
                getRuntimePrivateChat()
            );


            syncThemeIcon({
                animate:
                    false
            });

        }
    );


    /* =====================================================
       INITIAL PRIVATE STATE
       ===================================================== */

    function initializePrivateChat() {

        const enabled =
            getStoredPrivateChat();


        syncPrivateChatUI(
            enabled
        );


        /*
         * chat.js loads before this component in the
         * recommended script order, so normally this succeeds.
         */

        applyPrivateChatToRuntime(
            enabled
        );

    }


    /* =====================================================
       INITIAL THEME STATE
       ===================================================== */

    function initializeTheme() {

        ensureThemeIcons();


        syncThemeIcon({
            animate:
                false
        });

    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    const api =
        Object.freeze({

            __controller:
                true,

            version:
                VERSION,

            active:
                true,


            /* ---------------------------------------------
               PRIVATE CHAT
               --------------------------------------------- */

            setPrivateChat,

            togglePrivateChat,

            isPrivateChat() {

                return getRuntimePrivateChat();

            },


            /* ---------------------------------------------
               THEME
               --------------------------------------------- */

            syncThemeIcon,

            isDarkMode,


            /* ---------------------------------------------
               REFRESH
               --------------------------------------------- */

            refresh() {

                syncPrivateChatUI(
                    getRuntimePrivateChat()
                );


                syncThemeIcon({
                    animate:
                        false
                });


                return true;

            },


            getState() {

                return {

                    version:
                        VERSION,

                    privateChat:
                        getRuntimePrivateChat(),

                    darkMode:
                        isDarkMode(),

                    privateButton:
                        Boolean(
                            privateChatBtn
                        ),

                    themeButton:
                        Boolean(
                            themeBtn
                        )

                };

            }

        });


    Object.defineProperty(
        window,
        "NeyoTopbarControls",
        {

            value:
                api,

            writable:
                false,

            configurable:
                true,

            enumerable:
                true

        }
    );


    /* =====================================================
       INIT
       ===================================================== */

    initializePrivateChat();

    initializeTheme();


    emit(
        "neyo:topbar-controls-ready",
        {

            version:
                VERSION,

            privateChat:
                getRuntimePrivateChat(),

            darkMode:
                isDarkMode()

        }
    );


    console.log(
        "[NEYO Topbar] Ready.",
        VERSION
    );

})();
