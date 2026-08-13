/*
=========================================================
NEYO — SETTINGS CORE COMPONENT

Owns:
- Settings modal open / close
- Settings tab switching
- Active tab state
- Escape key close
- Click outside close
- Public settings events

Does NOT own:
- Theme logic
- Memory logic
- Notification settings
- Accessibility settings
- Account/profile saving
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const settingsModal =
        document.getElementById("settingsModal");

    if (!settingsModal) {
        return;
    }


    const settingsCloseBtn =
        document.getElementById("settingsCloseBtn");

    const settingsTabs =
        Array.from(
            document.querySelectorAll(
                "[data-settings-tab]"
            )
        );

    const settingsPanels =
        Array.from(
            document.querySelectorAll(
                "[data-settings-panel]"
            )
        );


    /* =====================================================
       STATE
       ===================================================== */

    let activeTab = null;


    /* =====================================================
       HELPERS
       ===================================================== */

    const isOpen = () =>
        settingsModal.classList.contains("show") ||
        settingsModal.classList.contains("open");


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
       TAB SWITCHING
       ===================================================== */

    const activateTab = tabName => {

        if (!tabName) {
            return;
        }


        activeTab = tabName;


        settingsTabs.forEach(
            tab => {

                const selected =
                    tab.dataset.settingsTab ===
                    tabName;

                tab.classList.toggle(
                    "active",
                    selected
                );

                tab.setAttribute(
                    "aria-selected",
                    String(selected)
                );
            }
        );


        settingsPanels.forEach(
            panel => {

                const selected =
                    panel.dataset.settingsPanel ===
                    tabName;

                panel.classList.toggle(
                    "active",
                    selected
                );

                panel.hidden =
                    !selected;
            }
        );


        emit(
            "neyo:settings-tab-change",
            {
                tab:
                    tabName
            }
        );
    };


    /* =====================================================
       OPEN
       ===================================================== */

    const openSettings = (
        tabName = null
    ) => {

        settingsModal.classList.add(
            "show"
        );

        settingsModal.classList.add(
            "open"
        );

        settingsModal.setAttribute(
            "aria-hidden",
            "false"
        );

        document.body.classList.add(
            "settings-open"
        );


        if (tabName) {
            activateTab(
                tabName
            );
        }

        else if (!activeTab) {

            const currentTab =
                settingsTabs.find(
                    tab =>
                        tab.classList.contains(
                            "active"
                        )
                );

            const fallback =
                currentTab?.dataset.settingsTab ||
                settingsTabs[0]
                    ?.dataset.settingsTab;

            if (fallback) {
                activateTab(
                    fallback
                );
            }
        }


        emit(
            "neyo:settings-open",
            {
                tab:
                    activeTab
            }
        );
    };


    /* =====================================================
       CLOSE
       ===================================================== */

    const closeSettings = () => {

        settingsModal.classList.remove(
            "show"
        );

        settingsModal.classList.remove(
            "open"
        );

        settingsModal.setAttribute(
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
    };


    /* =====================================================
       TOGGLE
       ===================================================== */

    const toggleSettings = (
        tabName = null
    ) => {

        if (isOpen()) {
            closeSettings();
        } else {
            openSettings(
                tabName
            );
        }
    };


    /* =====================================================
       TAB EVENTS
       ===================================================== */

    settingsTabs.forEach(
        tab => {

            tab.addEventListener(
                "click",
                () => {

                    activateTab(
                        tab.dataset.settingsTab
                    );
                }
            );
        }
    );


    /* =====================================================
       CLOSE BUTTON
       ===================================================== */

    settingsCloseBtn?.addEventListener(
        "click",
        closeSettings
    );


    /* =====================================================
       ESCAPE KEY
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "Escape" &&
                isOpen()
            ) {
                closeSettings();
            }
        }
    );


    /* =====================================================
       CLICK BACKDROP
       ===================================================== */

    settingsModal.addEventListener(
        "click",
        event => {

            if (
                event.target ===
                settingsModal
            ) {
                closeSettings();
            }
        }
    );


    /* =====================================================
       PUBLIC EVENTS
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


    window.addEventListener(
        "neyo:settings-close-request",
        closeSettings
    );


    window.addEventListener(
        "neyo:settings-toggle-request",
        event => {

            toggleSettings(
                event.detail?.tab ||
                null
            );
        }
    );


    window.addEventListener(
        "neyo:settings-tab-request",
        event => {

            activateTab(
                event.detail?.tab
            );
        }
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
                () => activeTab
        });

})();
