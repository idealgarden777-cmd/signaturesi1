/*
=========================================================
NEYO — ACCOUNT MENU COMPONENT

Owns:
- Account menu open / close
- Profile button state
- Settings action bridge
- Appearance action bridge
- Logout request bridge
- Escape / outside click handling

Does NOT own:
- Actual logout API
- Settings modal internals
- Theme engine
- Profile loading
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const userProfileBtn =
        document.getElementById(
            "userProfileBtn"
        );

    const userPopupMenu =
        document.getElementById(
            "userPopupMenu"
        );

    const settingsBtn =
        document.getElementById(
            "settingsBtn"
        );

    const sidebarDarkModeToggle =
        document.getElementById(
            "sidebarDarkModeToggle"
        );

    const logoutBtn =
        document.getElementById(
            "logoutBtn"
        );


    if (
        !userProfileBtn ||
        !userPopupMenu
    ) {
        return;
    }


    /* =====================================================
       STATE
       ===================================================== */

    let open = false;


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
       OPEN
       ===================================================== */

    const openMenu = () => {

        if (open) {
            return;
        }


        open = true;


        userPopupMenu.classList.add(
            "show"
        );


        userPopupMenu.classList.add(
            "open"
        );


        userPopupMenu.setAttribute(
            "aria-hidden",
            "false"
        );


        userProfileBtn.setAttribute(
            "aria-expanded",
            "true"
        );


        emit(
            "neyo:account-menu-open"
        );

    };


    /* =====================================================
       CLOSE
       ===================================================== */

    const closeMenu = () => {

        if (!open) {
            return;
        }


        open = false;


        userPopupMenu.classList.remove(
            "show"
        );


        userPopupMenu.classList.remove(
            "open"
        );


        userPopupMenu.setAttribute(
            "aria-hidden",
            "true"
        );


        userProfileBtn.setAttribute(
            "aria-expanded",
            "false"
        );


        emit(
            "neyo:account-menu-close"
        );

    };


    /* =====================================================
       TOGGLE
       ===================================================== */

    const toggleMenu = () => {

        if (open) {

            closeMenu();

        } else {

            openMenu();

        }

    };


    /* =====================================================
       PROFILE BUTTON
       ===================================================== */

    userProfileBtn.addEventListener(
        "click",
        event => {

            event.preventDefault();
            event.stopPropagation();


            toggleMenu();

        }
    );


    /* =====================================================
       SETTINGS
       ===================================================== */

    settingsBtn?.addEventListener(
        "click",
        event => {

            event.preventDefault();


            closeMenu();


            /*
            Generic request.

            settings.js will own opening
            the actual settings UI.
            */

            emit(
                "neyo:settings-open-request",
                {
                    tab:
                        "general",

                    source:
                        "account-menu"
                }
            );

        }
    );


    /* =====================================================
       APPEARANCE
       ===================================================== */

    sidebarDarkModeToggle
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();


                closeMenu();


                /*
                Open Appearance settings instead of
                duplicating theme controls here.
                */

                emit(
                    "neyo:settings-open-request",
                    {
                        tab:
                            "appearance",

                        source:
                            "account-menu"
                    }
                );

            }
        );


    /* =====================================================
       LOGOUT
       ===================================================== */

    logoutBtn?.addEventListener(
        "click",
        event => {

            event.preventDefault();


            closeMenu();


            /*
            account-menu.js intentionally does not
            perform logout itself.

            auth.js will own the real logout flow.
            */

            emit(
                "neyo:logout-request",
                {
                    source:
                        "account-menu"
                }
            );

        }
    );


    /* =====================================================
       CLICK OUTSIDE
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            if (!open) {
                return;
            }


            const clickedButton =
                userProfileBtn.contains(
                    event.target
                );


            const clickedMenu =
                userPopupMenu.contains(
                    event.target
                );


            if (
                !clickedButton &&
                !clickedMenu
            ) {

                closeMenu();

            }

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
                !open
            ) {
                return;
            }


            closeMenu();


            userProfileBtn.focus();

        }
    );


    /* =====================================================
       CLOSE ON SIDEBAR CLOSE
       ===================================================== */

    window.addEventListener(
        "neyo:sidebar-close",
        closeMenu
    );


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:account-menu-open-request",
        openMenu
    );


    window.addEventListener(
        "neyo:account-menu-close-request",
        closeMenu
    );


    window.addEventListener(
        "neyo:account-menu-toggle-request",
        toggleMenu
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    userPopupMenu.setAttribute(
        "aria-hidden",
        "true"
    );


    userProfileBtn.setAttribute(
        "aria-expanded",
        "false"
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoAccountMenu =
        Object.freeze({

            open:
                openMenu,

            close:
                closeMenu,

            toggle:
                toggleMenu,

            isOpen:
                () =>
                    open

        });

})();
