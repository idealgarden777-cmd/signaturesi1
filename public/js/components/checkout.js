/*
=========================================================
NEYO — CHECKOUT COMPONENT

Owns:
- Checkout request
- Upgrade button loading state
- /api/checkout request
- Secure checkout redirect
- Checkout lifecycle events
- Public checkout API

Does NOT own:
- Upgrade modal UI
- Billing provider backend logic
- Subscription verification
- Plan refresh after purchase
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const CHECKOUT_ENDPOINT =
        "/api/checkout";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const upgradeActionBtn =
        document.getElementById(
            "upgradeActionBtn"
        );

    const settingsUpgradeBtn =
        document.getElementById(
            "settingsUpgradeBtn"
        );


    /* =====================================================
       STATE
       ===================================================== */

    let checkoutPending =
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


    const readJson =
        async response => {

            const data =
                await response
                    .json()
                    .catch(
                        () => ({})
                    );


            if (
                !response.ok ||
                !data?.url
            ) {

                const error =
                    new Error(
                        data?.error ||
                        "Unable to open secure checkout."
                    );


                error.status =
                    response.status;

                error.data =
                    data;


                throw error;

            }


            return data;

        };


    /* =====================================================
       BUTTON STATE
       ===================================================== */

    const setButtonLoading =
        loading => {

            if (!upgradeActionBtn) {
                return;
            }


            if (
                loading &&
                !upgradeActionBtn
                    .dataset.originalText
            ) {

                upgradeActionBtn
                    .dataset.originalText =
                    upgradeActionBtn
                        .textContent ||
                    "Upgrade to Pro";

            }


            upgradeActionBtn.disabled =
                loading;


            upgradeActionBtn
                .classList
                .toggle(
                    "is-loading",
                    loading
                );


            upgradeActionBtn
                .setAttribute(
                    "aria-busy",
                    String(loading)
                );


            if (loading) {

                upgradeActionBtn.textContent =
                    "Opening secure checkout...";

            }

            else {

                upgradeActionBtn.textContent =
                    upgradeActionBtn
                        .dataset
                        .originalText ||
                    "Upgrade to Pro";

            }

        };


    /* =====================================================
       START CHECKOUT
       ===================================================== */

    const startCheckout =
        async ({
            plan = "pro",
            source = "upgrade",
            reason = null
        } = {}) => {

            if (checkoutPending) {
                return false;
            }


            checkoutPending =
                true;


            setButtonLoading(
                true
            );


            emit(
                "neyo:checkout-start",
                {
                    plan,
                    source,
                    reason
                }
            );


            try {

                const response =
                    await fetch(
                        CHECKOUT_ENDPOINT,
                        {
                            method:
                                "POST",

                            credentials:
                                "include",

                            cache:
                                "no-store",

                            headers: {

                                "Content-Type":
                                    "application/json",

                                Accept:
                                    "application/json"

                            },

                            /*
                            Current legacy neo.js sends
                            an empty JSON object.

                            Keep the same backend contract
                            until api/checkout.js is
                            intentionally upgraded.
                            */

                            body:
                                JSON.stringify(
                                    {}
                                )
                        }
                    );


                const data =
                    await readJson(
                        response
                    );


                const checkoutUrl =
                    String(
                        data.url
                    ).trim();


                if (!checkoutUrl) {

                    throw new Error(
                        "Checkout URL was not returned."
                    );

                }


                emit(
                    "neyo:checkout-ready",
                    {
                        url:
                            checkoutUrl,

                        plan,
                        source
                    }
                );


                /*
                Match current neo.js behavior.
                */

                window.location.assign(
                    checkoutUrl
                );


                return true;

            }

            catch (error) {

                console.error(
                    "NEYO Pro checkout failed:",
                    error
                );


                emit(
                    "neyo:checkout-error",
                    {
                        error,
                        plan,
                        source
                    }
                );


                window.NeyoNotifications
                    ?.error?.(
                        error?.message ||
                        "Checkout could not be opened. Please try again."
                    );


                return false;

            }

            finally {

                checkoutPending =
                    false;


                setButtonLoading(
                    false
                );


                emit(
                    "neyo:checkout-end",
                    {
                        plan,
                        source
                    }
                );

            }

        };


    /* =====================================================
       UPGRADE COMPONENT CONNECTION
       ===================================================== */

    window.addEventListener(
        "neyo:checkout-request",
        event => {

            startCheckout({
                plan:
                    event.detail?.plan ||
                    "pro",

                source:
                    event.detail?.source ||
                    "upgrade",

                reason:
                    event.detail?.reason ||
                    null
            });

        }
    );


    /* =====================================================
       PRIMARY UPGRADE BUTTON
       ===================================================== */

    upgradeActionBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();


                startCheckout({
                    plan:
                        "pro",

                    source:
                        "upgrade-modal"
                });

            }
        );


    /* =====================================================
       SETTINGS UPGRADE BUTTON
       ===================================================== */

    settingsUpgradeBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();


                /*
                Keep settings independent from
                the upgrade modal.

                Both routes can request the
                exact same checkout service.
                */

                startCheckout({
                    plan:
                        "pro",

                    source:
                        "settings"
                });

            }
        );


    /* =====================================================
       GENERIC PUBLIC EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:checkout-start-request",
        event => {

            startCheckout(
                event.detail ||
                {}
            );

        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoCheckout =
        Object.freeze({

            start:
                startCheckout,

            isPending:
                () =>
                    checkoutPending,

            getEndpoint:
                () =>
                    CHECKOUT_ENDPOINT

        });

})();
