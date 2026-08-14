/*
=========================================================
NEYO — CHECKOUT COMPONENT

Owns:
- Upgrade button checkout flow
- Secure /api/checkout request
- Checkout URL validation
- Button loading state
- Checkout success return detection
- Public checkout API

Does NOT own:
- Lemon Squeezy secrets
- Subscription activation
- Webhook processing
- neo.js

Backend:
POST /api/checkout
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG = Object.freeze({

        endpoint:
            "/api/checkout",

        loadingText:
            "Opening secure checkout...",

        allowedCheckoutHosts: [
            "lemonsqueezy.com"
        ]

    });


    /* =====================================================
       STATE
       ===================================================== */

    let checkoutRunning =
        false;


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const getUpgradeModalButton = () =>
        document.getElementById(
            "upgradeActionBtn"
        );


    const getSettingsUpgradeButton = () =>
        document.getElementById(
            "settingsUpgradeBtn"
        );


    /* =====================================================
       EVENTS
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
       TOAST
       ===================================================== */

    const notify = (
        message,
        type = "info"
    ) => {

        /*
        Let the existing NEYO notification
        system handle presentation.
        */

        emit(
            "neyo:toast",
            {
                message,
                type
            }
        );


        /*
        Console fallback only.
        Avoid browser alert().
        */

        if (type === "error") {

            console.error(
                `[NEYO Checkout] ${message}`
            );

        }

    };


    /* =====================================================
       CHECKOUT URL SECURITY
       ===================================================== */

    const isTrustedCheckoutUrl =
        value => {

            if (
                !value ||
                typeof value !== "string"
            ) {

                return false;

            }


            try {

                const url =
                    new URL(value);


                if (
                    url.protocol !==
                    "https:"
                ) {

                    return false;

                }


                const host =
                    url.hostname
                        .toLowerCase();


                return CONFIG
                    .allowedCheckoutHosts
                    .some(
                        allowed =>
                            host === allowed ||
                            host.endsWith(
                                `.${allowed}`
                            )
                    );

            } catch {

                return false;

            }

        };


    /* =====================================================
       BUTTON STATE
       ===================================================== */

    const setButtonBusy = (
        button,
        busy
    ) => {

        if (!button) {
            return;
        }


        if (busy) {

            if (
                !button.dataset
                    .checkoutOriginalText
            ) {

                button.dataset
                    .checkoutOriginalText =
                    button.textContent
                        ?.trim() ||
                    "Upgrade to Pro";

            }


            button.disabled =
                true;


            button.setAttribute(
                "aria-busy",
                "true"
            );


            button.textContent =
                CONFIG.loadingText;

        } else {

            button.disabled =
                false;


            button.removeAttribute(
                "aria-busy"
            );


            const original =
                button.dataset
                    .checkoutOriginalText;


            if (original) {

                button.textContent =
                    original;

            }

        }

    };


    const setAllButtonsBusy =
        busy => {

            setButtonBusy(
                getUpgradeModalButton(),
                busy
            );


            setButtonBusy(
                getSettingsUpgradeButton(),
                busy
            );

        };


    /* =====================================================
       START CHECKOUT
       ===================================================== */

    const startCheckout =
        async ({
            source =
                "upgrade"
        } = {}) => {

            if (checkoutRunning) {

                return false;

            }


            checkoutRunning =
                true;


            setAllButtonsBusy(
                true
            );


            emit(
                "neyo:checkout-start",
                {
                    source
                }
            );


            try {

                const response =
                    await fetch(
                        CONFIG.endpoint,
                        {
                            method:
                                "POST",

                            credentials:
                                "include",

                            cache:
                                "no-store",

                            headers: {
                                Accept:
                                    "application/json",

                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({
                                    source
                                })
                        }
                    );


                const data =
                    await response
                        .json()
                        .catch(
                            () => ({})
                        );


                if (
                    response.status ===
                    401
                ) {

                    throw new Error(
                        "Please sign in again before upgrading."
                    );

                }


                if (!response.ok) {

                    throw new Error(
                        data?.error ||
                        "Unable to start checkout."
                    );

                }


                if (
                    !isTrustedCheckoutUrl(
                        data?.url
                    )
                ) {

                    throw new Error(
                        "Checkout returned an invalid payment URL."
                    );

                }


                emit(
                    "neyo:checkout-ready",
                    {
                        source,

                        url:
                            data.url
                    }
                );


                /*
                Full-page redirect is safer and
                simpler than popup checkout.
                */

                window.location.assign(
                    data.url
                );


                return true;

            } catch (error) {

                console.error(
                    "[NEYO Checkout] Checkout failed:",
                    error
                );


                emit(
                    "neyo:checkout-error",
                    {
                        source,

                        message:
                            error?.message ||
                            "Checkout failed."
                    }
                );


                notify(
                    error?.message ||
                    "Checkout could not be opened. Please try again.",
                    "error"
                );


                return false;

            } finally {

                checkoutRunning =
                    false;


                setAllButtonsBusy(
                    false
                );

            }

        };


    /* =====================================================
       CLICK INTERCEPTION

       Capture phase is intentional.

       neo.js currently has its own
       upgradeActionBtn click listener.
       We stop that old handler so only
       ONE checkout request is sent.
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            const upgradeModalButton =
                event.target
                    ?.closest?.(
                        "#upgradeActionBtn"
                    );


            const settingsButton =
                event.target
                    ?.closest?.(
                        "#settingsUpgradeBtn"
                    );


            if (
                !upgradeModalButton &&
                !settingsButton
            ) {

                return;

            }


            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation();


            startCheckout({

                source:
                    settingsButton
                        ? "settings"
                        : "upgrade-modal"

            });

        },
        true
    );


    /* =====================================================
       PUBLIC CHECKOUT REQUEST EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:checkout-request",
        event => {

            startCheckout({

                source:
                    event.detail?.source ||
                    "event"

            });

        }
    );


    /* =====================================================
       SUCCESS RETURN DETECTION
       ===================================================== */

    const handleCheckoutReturn = () => {

        const url =
            new URL(
                window.location.href
            );


        const status =
            url.searchParams.get(
                "checkout"
            );


        if (
            status !==
            "success"
        ) {

            return;

        }


        emit(
            "neyo:checkout-return-success"
        );


        notify(
            "Payment received. Your Pro status is being updated.",
            "success"
        );


        /*
        Remove ?checkout=success without reload.
        */

        url.searchParams.delete(
            "checkout"
        );


        window.history.replaceState(
            {},
            document.title,
            url.pathname +
            url.search +
            url.hash
        );

    };


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoCheckout =
        Object.freeze({

            start:
                startCheckout,

            isRunning:
                () =>
                    checkoutRunning,

            endpoint:
                CONFIG.endpoint

        });


    /* =====================================================
       BOOT
       ===================================================== */

    handleCheckoutReturn();

})();
