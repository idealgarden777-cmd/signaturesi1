/*
=========================================================
NEYO — CHECKOUT COMPONENT

Owns:
- Upgrade checkout flow
- Secure /api/checkout request
- Trusted Lemon Squeezy URL validation
- Upgrade button loading state
- Duplicate checkout prevention
- Checkout return handling
- Public checkout events / API

Does NOT own:
- neo.js
- Lemon Squeezy secrets
- Webhook processing
- Subscription activation
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

    const getUpgradeButton = () =>
        document.getElementById(
            "upgradeActionBtn"
        );


    const getSettingsUpgradeButton = () =>
        document.getElementById(
            "settingsUpgradeBtn"
        );


    /* =====================================================
       EVENT HELPER
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
       SAFE MESSAGE
       ===================================================== */

    const normalizeMessage = (
        value,
        fallback =
            "Something went wrong."
    ) => {

        if (
            typeof value ===
            "string"
        ) {

            const text =
                value.trim();


            return text ||
                fallback;

        }


        if (
            value &&
            typeof value ===
            "object"
        ) {

            if (
                typeof value.message ===
                "string"
            ) {

                return (
                    value.message.trim() ||
                    fallback
                );

            }


            if (
                typeof value.error ===
                "string"
            ) {

                return (
                    value.error.trim() ||
                    fallback
                );

            }

        }


        return fallback;

    };


    /* =====================================================
       TOAST / NOTIFICATION

       IMPORTANT:
       Existing NEYO toast system expects
       a plain message string.

       This prevents:
       [object Object]
       ===================================================== */

    const notify = (
        message,
        type = "info"
    ) => {

        const safeMessage =
            normalizeMessage(
                message
            );


        window.dispatchEvent(
            new CustomEvent(
                "neyo:toast",
                {
                    detail:
                        safeMessage
                }
            )
        );


        /*
        Secondary richer event for any
        newer components that need type.
        */

        emit(
            "neyo:notification",
            {
                message:
                    safeMessage,

                type
            }
        );


        if (
            type ===
            "error"
        ) {

            console.error(
                `[NEYO Checkout] ${safeMessage}`
            );

        }

    };


    /* =====================================================
       TRUSTED CHECKOUT URL
       ===================================================== */

    const isTrustedCheckoutUrl =
        value => {

            if (
                typeof value !==
                "string" ||
                !value.trim()
            ) {

                return false;

            }


            try {

                const url =
                    new URL(
                        value
                    );


                if (
                    url.protocol !==
                    "https:"
                ) {

                    return false;

                }


                const hostname =
                    url.hostname
                        .toLowerCase();


                return CONFIG
                    .allowedCheckoutHosts
                    .some(
                        allowedHost => {

                            return (
                                hostname ===
                                    allowedHost ||
                                hostname.endsWith(
                                    `.${allowedHost}`
                                )
                            );

                        }
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


            const originalText =
                button.dataset
                    .checkoutOriginalText;


            if (originalText) {

                button.textContent =
                    originalText;

            }

        }

    };


    const setAllUpgradeButtonsBusy =
        busy => {

            setButtonBusy(
                getUpgradeButton(),
                busy
            );


            setButtonBusy(
                getSettingsUpgradeButton(),
                busy
            );

        };


    /* =====================================================
       READ RESPONSE BODY
       ===================================================== */

    const readResponseJson =
        async response => {

            try {

                return await response.json();

            } catch {

                return {};

            }

        };


    /* =====================================================
       BUILD ERROR MESSAGE
       ===================================================== */

    const getResponseError = (
        response,
        data
    ) => {

        if (
            response.status ===
            401
        ) {

            return (
                "Your session has expired. Please sign in again."
            );

        }


        if (
            response.status ===
            403
        ) {

            return (
                "Checkout request was blocked for security reasons."
            );

        }


        if (
            response.status ===
            503
        ) {

            return normalizeMessage(
                data?.error,
                "Checkout is not configured yet."
            );

        }


        return normalizeMessage(
            data?.error,
            "Unable to start secure checkout."
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


            setAllUpgradeButtonsBusy(
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
                    await readResponseJson(
                        response
                    );


                if (!response.ok) {

                    throw new Error(
                        getResponseError(
                            response,
                            data
                        )
                    );

                }


                const checkoutUrl =
                    typeof data?.url ===
                    "string"
                        ? data.url.trim()
                        : "";


                if (!checkoutUrl) {

                    throw new Error(
                        "Checkout URL was not returned."
                    );

                }


                if (
                    !isTrustedCheckoutUrl(
                        checkoutUrl
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
                            checkoutUrl
                    }
                );


                /*
                Redirect only after validation.
                */

                window.location.assign(
                    checkoutUrl
                );


                return true;

            } catch (error) {

                const message =
                    normalizeMessage(
                        error,
                        "Checkout could not be opened. Please try again."
                    );


                console.error(
                    "[NEYO Checkout] Request failed:",
                    error
                );


                emit(
                    "neyo:checkout-error",
                    {
                        source,

                        message
                    }
                );


                notify(
                    message,
                    "error"
                );


                return false;

            } finally {

                checkoutRunning =
                    false;


                setAllUpgradeButtonsBusy(
                    false
                );

            }

        };


    /* =====================================================
       CLICK INTERCEPTION

       Capture phase is important.

       neo.js already has a checkout listener.
       This prevents two POST requests.
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            const modalUpgradeButton =
                event.target
                    ?.closest?.(
                        "#upgradeActionBtn"
                    );


            const settingsUpgradeButton =
                event.target
                    ?.closest?.(
                        "#settingsUpgradeBtn"
                    );


            if (
                !modalUpgradeButton &&
                !settingsUpgradeButton
            ) {

                return;

            }


            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation();


            startCheckout({
                source:
                    settingsUpgradeButton
                        ? "settings"
                        : "upgrade-modal"
            });

        },
        true
    );


    /* =====================================================
       PUBLIC REQUEST EVENT
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
       CHECKOUT SUCCESS RETURN
       ===================================================== */

    const handleCheckoutReturn =
        () => {

            let url;


            try {

                url =
                    new URL(
                        window.location.href
                    );

            } catch {

                return;

            }


            const checkoutStatus =
                url.searchParams.get(
                    "checkout"
                );


            if (
                checkoutStatus !==
                "success"
            ) {

                return;

            }


            emit(
                "neyo:checkout-return-success"
            );


            notify(
                "Payment received. Your Pro access is being updated.",
                "success"
            );


            /*
            Remove checkout=success from URL
            without refreshing the page.
            */

            url.searchParams.delete(
                "checkout"
            );


            const cleanUrl =
                url.pathname +
                url.search +
                url.hash;


            window.history.replaceState(
                {},
                document.title,
                cleanUrl
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

            getEndpoint:
                () =>
                    CONFIG.endpoint,

            isTrustedCheckoutUrl

        });


    /* =====================================================
       BOOT
       ===================================================== */

    handleCheckoutReturn();

})();
