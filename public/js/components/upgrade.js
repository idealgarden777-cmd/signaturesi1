/*
=========================================================
NEYO — UPGRADE COMPONENT

Owns:
- Upgrade modal open / close
- Upgrade reason state
- Upgrade modal buttons
- Checkout request event
- Public upgrade API

Does NOT own:
- Billing provider backend
- Subscription verification
- Checkout API implementation
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const upgradeModal =
        document.getElementById(
            "upgradeModal"
        );

    const modalCloseBtn =
        document.getElementById(
            "modalCloseBtn"
        );

    const upgradeActionBtn =
        document.getElementById(
            "upgradeActionBtn"
        );

    const modalMaybeLaterBtn =
        document.getElementById(
            "modalMaybeLaterBtn"
        );


    if (!upgradeModal) {
        return;
    }


    /* =====================================================
       STATE
       ===================================================== */

    let currentReason =
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
            upgradeModal.classList
                .contains("show") ||
            upgradeModal.classList
                .contains("open") ||
            upgradeModal.classList
                .contains("active") ||
            upgradeModal.getAttribute(
                "aria-hidden"
            ) === "false"
        );

    };


    /* =====================================================
       OPEN
       ===================================================== */

    const openUpgrade = (
        reason = {}
    ) => {

        currentReason =
            reason &&
            typeof reason === "object"
                ? {
                    ...reason
                }
                : {};


        upgradeModal.classList.add(
            "show",
            "open",
            "active"
        );


        upgradeModal.setAttribute(
            "aria-hidden",
            "false"
        );


        document.body.classList.add(
            "upgrade-open"
        );


        requestAnimationFrame(
            () => {

                upgradeActionBtn
                    ?.focus?.();

            }
        );


        emit(
            "neyo:upgrade-open",
            {
                reason:
                    currentReason
            }
        );


        return true;

    };


    /* =====================================================
       CLOSE
       ===================================================== */

    const closeUpgrade = () => {

        if (!isOpen()) {
            return false;
        }


        upgradeModal.classList.remove(
            "show",
            "open",
            "active"
        );


        upgradeModal.setAttribute(
            "aria-hidden",
            "true"
        );


        document.body.classList.remove(
            "upgrade-open"
        );


        emit(
            "neyo:upgrade-close",
            {
                reason:
                    currentReason
            }
        );


        currentReason =
            null;


        return true;

    };


    /* =====================================================
       CHECKOUT REQUEST
       ===================================================== */

    const requestCheckout = () => {

        emit(
            "neyo:checkout-request",
            {
                source:
                    "upgrade-modal",

                plan:
                    "pro",

                reason:
                    currentReason
            }
        );

    };


    /* =====================================================
       CLOSE BUTTON
       ===================================================== */

    modalCloseBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();


                closeUpgrade();

            }
        );


    /* =====================================================
       MAYBE LATER BUTTON
       ===================================================== */

    modalMaybeLaterBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();


                closeUpgrade();

            }
        );


    /* =====================================================
       UPGRADE CTA
       ===================================================== */

    upgradeActionBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();


                requestCheckout();

            }
        );


    /* =====================================================
       BACKDROP
       ===================================================== */

    upgradeModal.addEventListener(
        "click",
        event => {

            if (
                event.target ===
                upgradeModal
            ) {

                closeUpgrade();

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
                event.key === "Escape" &&
                isOpen()
            ) {

                event.preventDefault();


                closeUpgrade();

            }

        }
    );


    /* =====================================================
       UPGRADE REQUIRED
       ===================================================== */

    window.addEventListener(
        "neyo:upgrade-required",
        event => {

            openUpgrade(
                event.detail ||
                {}
            );

        }
    );


    /* =====================================================
       MODEL UPGRADE FALLBACK
       ===================================================== */

    window.addEventListener(
        "neyo:model-upgrade-required",
        event => {

            openUpgrade({
                source:
                    "model",

                model:
                    event.detail
                        ?.model,

                modelInfo:
                    event.detail
                        ?.modelInfo
            });

        }
    );


    /* =====================================================
       CHAT LIMIT FALLBACK
       ===================================================== */

    window.addEventListener(
        "neyo:chat-limit-reached",
        event => {

            openUpgrade({
                source:
                    "chat-limit",

                data:
                    event.detail
                        ?.data ||
                    {}
            });

        }
    );


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:upgrade-open-request",
        event => {

            openUpgrade(
                event.detail ||
                {}
            );

        }
    );


    window.addEventListener(
        "neyo:upgrade-close-request",
        closeUpgrade
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    upgradeModal.setAttribute(
        "aria-hidden",
        "true"
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoUpgrade =
        Object.freeze({

            open:
                openUpgrade,

            close:
                closeUpgrade,

            checkout:
                requestCheckout,

            isOpen,

            getReason:
                () =>
                    currentReason
                        ? {
                            ...currentReason
                        }
                        : null

        });

})();
