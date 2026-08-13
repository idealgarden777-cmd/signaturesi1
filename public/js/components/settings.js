/*
=========================================================
NEYO — SETTINGS CORE COMPONENT

Owns:
- Settings modal open / close
- Settings tab switching
- Active tab state
- Escape key close
- Backdrop close
- Focus restore
- Public settings events

Does NOT own:
- Theme logic
- Intelligence logic
- Memory logic
- Language logic
- Profile saving
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const settingsOverlay =
        document.getElementById(
            "neoSettingsOverlay"
        );


    if (!settingsOverlay) {
        return;
    }


    const settingsCloseBtn =
        document.getElementById(
            "neoSettingsCloseBtn"
        );


    const settingsTabs =
        Array.from(
            document.querySelectorAll(
                ".neo-settings-tab[data-settings-tab]"
            )
        );


    const settingsPanels =
        Array.from(
            document.querySelectorAll(
                ".neo-settings-panel"
            )
        );


    /* =====================================================
       STATE
       ===================================================== */

    let activeTab =
        null;

    let previousFocusedElement =
        null;


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


    const isOpen = () => {

        return (
            settingsOverlay.classList
                .contains("show") ||
            settingsOverlay.classList
                .contains("open") ||
            settingsOverlay.classList
                .contains("active") ||
            settingsOverlay.getAttribute(
                "aria-hidden"
            ) === "false"
        );

    };


    const normalizeTabName =
        value => {

            if (!value) {
                return null;
            }


            return String(value)
                .trim()
                .toLowerCase();

        };


    const getPanelForTab =
        tabName => {

            const normalized =
                normalizeTabName(
                    tabName
                );


            if (!normalized) {
                return null;
            }


            return settingsPanels.find(
                panel => {

                    const panelName =
                        panel.id
                            .replace(
                                /^settingsPanel/,
                                ""
                            )
                            .toLowerCase();


                    return (
                        panelName ===
                        normalized
                    );

                }
            ) || null;

        };


    /* =====================================================
       TAB SWITCHING
       ===================================================== */

    const activateTab =
        tabName => {

            const normalized =
                normalizeTabName(
                    tabName
                );


            if (!normalized) {
                return false;
            }


            const panel =
                getPanelForTab(
                    normalized
                );


            if (!panel) {

                console.warn(
                    `[NEYO Settings] Panel not found: ${normalized}`
                );

                return false;

            }


            activeTab =
                normalized;


            /* -----------------------------------------
               TAB BUTTONS
               ----------------------------------------- */

            settingsTabs.forEach(
                tab => {

                    const selected =
                        tab.dataset
                            .settingsTab ===
                        normalized;


                    tab.classList.toggle(
                        "active",
                        selected
                    );


                    tab.setAttribute(
                        "aria-selected",
                        String(selected)
                    );


                    tab.setAttribute(
                        "aria-current",
                        selected
                            ? "page"
                            : "false"
                    );

                }
            );


            /* -----------------------------------------
               PANELS
               ----------------------------------------- */

            settingsPanels.forEach(
                item => {

                    const selected =
                        item === panel;


                    item.classList.toggle(
                        "active",
                        selected
                    );


                    item.hidden =
                        !selected;


                    item.setAttribute(
                        "aria-hidden",
                        String(!selected)
                    );

                }
            );


            /* -----------------------------------------
               CONTENT SCROLL RESET
               ----------------------------------------- */

            const content =
                settingsOverlay.querySelector(
                    ".neo-settings-content"
                );


            if (content) {

                content.scrollTop =
                    0;

            }


            emit(
                "neyo:settings-tab-change",
                {
                    tab:
                        activeTab,

                    panelId:
                        panel.id
                }
            );


            return true;

        };


    /* =====================================================
       DEFAULT TAB
       ===================================================== */

    const getDefaultTab = () => {

        const current =
            settingsTabs.find(
                tab =>
                    tab.classList
                        .contains(
                            "active"
                        )
            );


        return (
            current?.dataset
                ?.settingsTab ||
            settingsTabs[0]
                ?.dataset
                ?.settingsTab ||
            "general"
        );

    };


    /* =====================================================
       OPEN SETTINGS
       ===================================================== */

    const openSettings = (
        tabName = null
    ) => {

        previousFocusedElement =
            document.activeElement;


        settingsOverlay.classList.add(
            "show",
            "open",
            "active"
        );


        settingsOverlay.setAttribute(
            "aria-hidden",
            "false"
        );


        document.body.classList.add(
            "settings-open"
        );


        const requestedTab =
            normalizeTabName(
                tabName
            ) ||
            activeTab ||
            getDefaultTab();


        activateTab(
            requestedTab
        );


        requestAnimationFrame(
            () => {

                settingsCloseBtn
                    ?.focus?.();

            }
        );


        emit(
            "neyo:settings-open",
            {
                tab:
                    activeTab
            }
        );


        return true;

    };


    /* =====================================================
       CLOSE SETTINGS
       ===================================================== */

    const closeSettings = () => {

        if (!isOpen()) {
            return false;
        }


        settingsOverlay.classList.remove(
            "show",
            "open",
            "active"
        );


        settingsOverlay.setAttribute(
            "aria-hidden",
            "true"
        );


        document.body.classList.remove(
            "settings-open"
        );


        emit(
            "neyo:settings-close",
            {
                tab:
                    activeTab
            }
        );


        if (
            previousFocusedElement &&
            document.contains(
                previousFocusedElement
            )
        ) {

            requestAnimationFrame(
                () => {

                    previousFocusedElement
                        ?.focus?.();

                }
            );

        }


        previousFocusedElement =
            null;


        return true;

    };


    /* =====================================================
       TOGGLE
       ===================================================== */

    const toggleSettings = (
        tabName = null
    ) => {

        if (isOpen()) {

            return closeSettings();

        }


        return openSettings(
            tabName
        );

    };


    /* =====================================================
       TAB EVENTS
       ===================================================== */

    settingsTabs.forEach(
        tab => {

            tab.addEventListener(
                "click",
                event => {

                    event.preventDefault();


                    activateTab(
                        tab.dataset
                            .settingsTab
                    );

                }
            );

        }
    );


    /* =====================================================
       CLOSE BUTTON
       ===================================================== */

    settingsCloseBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();


                closeSettings();

            }
        );


    /* =====================================================
       ESCAPE
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key !==
                    "Escape" ||
                !isOpen()
            ) {
                return;
            }


            event.preventDefault();


            closeSettings();

        }
    );


    /* =====================================================
       BACKDROP CLICK
       ===================================================== */

    settingsOverlay.addEventListener(
        "click",
        event => {

            if (
                event.target !==
                settingsOverlay
            ) {
                return;
            }


            closeSettings();

        }
    );


    /* =====================================================
       SETTINGS OPEN REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:settings-open-request",
        event => {

            openSettings(
                event.detail?.tab ||
                null
            );

        }
    );


    /* =====================================================
       SETTINGS CLOSE REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:settings-close-request",
        closeSettings
    );


    /* =====================================================
       SETTINGS TOGGLE REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:settings-toggle-request",
        event => {

            toggleSettings(
                event.detail?.tab ||
                null
            );

        }
    );


    /* =====================================================
       TAB REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:settings-tab-request",
        event => {

            activateTab(
                event.detail?.tab
            );

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    settingsOverlay.setAttribute(
        "aria-hidden",
        "true"
    );


    const initialTab =
        getDefaultTab();


    activateTab(
        initialTab
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoSettings =
        Object.freeze({

            open:
                openSettings,

            close:
                closeSettings,

            toggle:
                toggleSettings,

            activateTab,

            isOpen,

            getActiveTab:
                () =>
                    activeTab,

            getAvailableTabs:
                () =>
                    settingsTabs
                        .map(
                            tab =>
                                tab.dataset
                                    .settingsTab
                        )
                        .filter(
                            Boolean
                        )

        });

})();
