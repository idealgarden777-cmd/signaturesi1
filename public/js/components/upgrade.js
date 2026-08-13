/*
=========================================================
NEYO — UPGRADE COMPONENT

Owns:
- Upgrade-required events
- Upgrade modal open/close bridge
- Selected upgrade reason
- Plan CTA state
- Checkout request event
- Public upgrade API

Does NOT own:
- Actual checkout API
- Billing provider logic
- Subscription verification
- Profile plan refresh
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

    const upgradeBtn =
        document.getElementById(
            "upgradeBtn"
        );

    const upgradeCloseBtn =
        document.getElementById(
            "upgradeCloseBtn"
        );


    /* =====================================================
       STATE
       ===================================================== */

    let currentReason =
        null;

    let opening =
        false;


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

    const openUpgrade = (
        reason = {}
    ) => {

        currentReason =
            reason || {};


        if (opening) {
            return;
        }


        opening =
            true;


        /* -----------------------------------------
           USE GENERIC MODAL ENGINE IF AVAILABLE
           ----------------------------------------- */

        if (
            upgradeModal &&
            window.NeyoModal
                ?.open
        ) {

            window.NeyoModal.open(
                upgradeModal
            );

        }

        else if (upgradeModal) {

            upgradeModal.classList.add(
                "show"
            );

            upgradeModal.classList.add(
                "open"
            );

            upgradeModal.setAttribute(
                "aria-hidden",
                "false"
            );

        }


        emit(
            "neyo:upgrade-open",
            {
                reason:
                    currentReason
            }
        );


        opening =
            false;

    };


    /* =====================================================
       CLOSE
       ===================================================== */

    const closeUpgrade = () => {

        if (
            upgradeModal &&
            window.NeyoModal
                ?.close
        ) {

            window.NeyoModal.close(
                upgradeModal
            );

        }

        else if (upgradeModal) {

            upgradeModal.classList.remove(
                "show"
            );

            upgradeModal.classList.remove(
                "open"
            );

            upgradeModal.setAttribute(
                "aria-hidden",
                "true"
            );

        }


        emit(
            "neyo:upgrade-close",
            {
                reason:
                    currentReason
            }
        );


        currentReason =
            null;

    };


    /* =====================================================
       CHECKOUT REQUEST
       ===================================================== */

    const requestCheckout = () => {

        /*
        Important:

        upgrade.js intentionally does NOT call
        /api/checkout directly.

        ZIP currently has no api/checkout.js.

        A future checkout.js module will listen
        for this event and own billing logic.
        */

        emit(
            "neyo:checkout-request",
            {
                source:
                    "upgrade",

                plan:
                    "pro",

                reason:
                    currentReason
            }
        );

    };


    /* =====================================================
       UPGRADE REQUIRED EVENT
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
       DIRECT MODEL LOCK FALLBACK
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
       CTA BUTTON
       ===================================================== */

    upgradeBtn?.addEventListener(
        "click",
        event => {

            event.preventDefault();


            requestCheckout();

        }
    );


    /* =====================================================
       CLOSE BUTTON
       ===================================================== */

    upgradeCloseBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();


                closeUpgrade();

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

            getReason:
                () =>
                    currentReason
                        ? {
                            ...currentReason
                        }
                        : null,

            isOpen:
                () => {

                    if (!upgradeModal) {
                        return false;
                    }


                    return (
                        upgradeModal.classList
                            .contains(
                                "show"
                            ) ||
                        upgradeModal.classList
                            .contains(
                                "open"
                            )
                    );

                }

        });

})();
