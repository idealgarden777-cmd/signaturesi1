/* =========================================================
   NEYO SETTINGS — POPUP SYSTEM
   File: /js/settings/settings-popups.js

   Purpose:
   - Fix popup stacking
   - Keep only one settings popup open
   - Add/remove .is-open on active wrapper
   - Reposition existing menus on scroll/resize
   - Close on Escape / outside click

   IMPORTANT:
   Existing neo.js still owns actual selection logic.
   This module only hardens popup behavior.
   ========================================================= */

(() => {
    "use strict";

    const SETTINGS_OVERLAY_SELECTOR =
        ".neo-settings-overlay";

    const MENU_SELECTOR =
        ".settings-select-menu";

    const BUTTON_SELECTOR =
        ".settings-value-btn, .settings-select-btn";

    const WRAPPER_SELECTOR =
        ".settings-select-wrapper";

    let activeMenu = null;
    let activeButton = null;
    let activeWrapper = null;


    function getSettingsOverlay() {
        return document.querySelector(
            SETTINGS_OVERLAY_SELECTOR
        );
    }


    function clearOpenState() {
        document
            .querySelectorAll(
                `${WRAPPER_SELECTOR}.is-open`
            )
            .forEach(wrapper => {
                wrapper.classList.remove(
                    "is-open"
                );
            });

        document
            .querySelectorAll(
                `${BUTTON_SELECTOR}[aria-expanded="true"]`
            )
            .forEach(button => {
                button.setAttribute(
                    "aria-expanded",
                    "false"
                );
            });

        activeMenu = null;
        activeButton = null;
        activeWrapper = null;
    }


    function closeAllMenus({
        except = null
    } = {}) {
        document
            .querySelectorAll(MENU_SELECTOR)
            .forEach(menu => {
                if (menu === except) return;

                menu.hidden = true;
            });

        document
            .querySelectorAll(
                `${WRAPPER_SELECTOR}.is-open`
            )
            .forEach(wrapper => {
                const menu =
                    wrapper.querySelector(
                        MENU_SELECTOR
                    );

                if (menu === except) return;

                wrapper.classList.remove(
                    "is-open"
                );
            });

        document
            .querySelectorAll(
                `${BUTTON_SELECTOR}[aria-expanded="true"]`
            )
            .forEach(button => {
                const controls =
                    button.getAttribute(
                        "aria-controls"
                    );

                const controlledMenu =
                    controls
                        ? document.getElementById(
                              controls
                          )
                        : null;

                if (
                    controlledMenu &&
                    controlledMenu === except
                ) {
                    return;
                }

                button.setAttribute(
                    "aria-expanded",
                    "false"
                );
            });
    }


    function markMenuOpen(
        menu,
        button
    ) {
        if (!menu || !button) return;

        const wrapper =
            button.closest(
                WRAPPER_SELECTOR
            );

        closeAllMenus({
            except: menu
        });

        wrapper?.classList.add(
            "is-open"
        );

        button.setAttribute(
            "aria-expanded",
            "true"
        );

        activeMenu = menu;
        activeButton = button;
        activeWrapper = wrapper;
    }


    function markMenuClosed(
        menu,
        button
    ) {
        const wrapper =
            button?.closest(
                WRAPPER_SELECTOR
            );

        wrapper?.classList.remove(
            "is-open"
        );

        button?.setAttribute(
            "aria-expanded",
            "false"
        );

        if (activeMenu === menu) {
            activeMenu = null;
            activeButton = null;
            activeWrapper = null;
        }
    }


    function findControlledMenu(
        button
    ) {
        if (!button) return null;

        const controls =
            button.getAttribute(
                "aria-controls"
            );

        if (controls) {
            const controlled =
                document.getElementById(
                    controls
                );

            if (
                controlled?.matches(
                    MENU_SELECTOR
                )
            ) {
                return controlled;
            }
        }

        return button
            .closest(
                WRAPPER_SELECTOR
            )
            ?.querySelector(
                MENU_SELECTOR
            ) || null;
    }


    function syncVisibleMenus() {
        document
            .querySelectorAll(
                MENU_SELECTOR
            )
            .forEach(menu => {
                if (menu.hidden) {
                    const wrapper =
                        menu.closest(
                            WRAPPER_SELECTOR
                        );

                    wrapper?.classList.remove(
                        "is-open"
                    );

                    return;
                }

                const wrapper =
                    menu.closest(
                        WRAPPER_SELECTOR
                    );

                const button =
                    wrapper?.querySelector(
                        BUTTON_SELECTOR
                    );

                if (button) {
                    markMenuOpen(
                        menu,
                        button
                    );
                }
            });
    }


    function handleButtonClick(
        event
    ) {
        const button =
            event.target.closest(
                BUTTON_SELECTOR
            );

        if (!button) return;

        const overlay =
            button.closest(
                SETTINGS_OVERLAY_SELECTOR
            );

        if (!overlay) return;

        const menu =
            findControlledMenu(
                button
            );

        if (!menu) return;

        /*
         * neo.js performs the actual
         * open/close action.
         *
         * Wait one frame, then sync
         * stacking state with the
         * resulting menu state.
         */
        requestAnimationFrame(
            () => {
                if (menu.hidden) {
                    markMenuClosed(
                        menu,
                        button
                    );
                } else {
                    markMenuOpen(
                        menu,
                        button
                    );
                }
            }
        );
    }


    function handleOutsideClick(
        event
    ) {
        if (!activeMenu) return;

        if (
            activeMenu.contains(
                event.target
            ) ||
            activeButton?.contains(
                event.target
            )
        ) {
            return;
        }

        activeMenu.hidden = true;

        markMenuClosed(
            activeMenu,
            activeButton
        );
    }


    function handleEscape(
        event
    ) {
        if (
            event.key !== "Escape" ||
            !activeMenu
        ) {
            return;
        }

        activeMenu.hidden = true;

        const button =
            activeButton;

        markMenuClosed(
            activeMenu,
            button
        );

        button?.focus();
    }


    function handleSettingsScroll() {
        /*
         * Existing neo.js already
         * repositions open menus.
         *
         * We only ensure the stacking
         * state remains correct.
         */
        if (!activeMenu) return;

        if (activeMenu.hidden) {
            markMenuClosed(
                activeMenu,
                activeButton
            );
        }
    }


    function observeMenuState() {
        const overlay =
            getSettingsOverlay();

        if (!overlay) return;

        const observer =
            new MutationObserver(
                mutations => {
                    let shouldSync =
                        false;

                    for (
                        const mutation
                        of mutations
                    ) {
                        if (
                            mutation.type ===
                                "attributes" &&
                            (
                                mutation.attributeName ===
                                    "hidden" ||
                                mutation.attributeName ===
                                    "aria-expanded"
                            )
                        ) {
                            shouldSync =
                                true;
                            break;
                        }
                    }

                    if (shouldSync) {
                        syncVisibleMenus();
                    }
                }
            );

        observer.observe(
            overlay,
            {
                subtree: true,
                attributes: true,
                attributeFilter: [
                    "hidden",
                    "aria-expanded"
                ]
            }
        );
    }


    function initSettingsPopupSystem() {
        const overlay =
            getSettingsOverlay();

        if (!overlay) return;

        document.addEventListener(
            "click",
            handleButtonClick
        );

        document.addEventListener(
            "click",
            handleOutsideClick
        );

        document.addEventListener(
            "keydown",
            handleEscape
        );

        const settingsContent =
            document.querySelector(
                ".neo-settings-content"
            );

        settingsContent
            ?.addEventListener(
                "scroll",
                handleSettingsScroll,
                {
                    passive: true
                }
            );

        window.addEventListener(
            "resize",
            () => {
                requestAnimationFrame(
                    syncVisibleMenus
                );
            },
            {
                passive: true
            }
        );

        observeMenuState();

        syncVisibleMenus();
    }


    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            initSettingsPopupSystem,
            {
                once: true
            }
        );
    } else {
        initSettingsPopupSystem();
    }
})();
