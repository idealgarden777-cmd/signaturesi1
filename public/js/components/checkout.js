/*
=========================================================
NEYO — CHECKOUT FRONTEND COMPONENT

Owns:
- Upgrade button click
- POST /api/checkout
- Loading state
- Safe Lemon Squeezy redirect
- Error handling
- Duplicate request prevention

Does NOT own:
- API key
- Store ID
- Variant ID
- Subscription webhook
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG = Object.freeze({
        endpoint: "/api/checkout",
        loadingText: "Opening secure checkout..."
    });


    /* =====================================================
       STATE
       ===================================================== */

    let checkoutRunning = false;


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
       MESSAGE HELPER
       ===================================================== */

    const normalizeMessage = (
        value,
        fallback = "Something went wrong."
    ) => {

        if (
            typeof value === "string" &&
            value.trim()
        ) {
            return value.trim();
        }

        if (
            value &&
            typeof value === "object"
        ) {

            if (
                typeof value.message === "string" &&
                value.message.trim()
            ) {
                return value.message.trim();
            }

            if (
                typeof value.error === "string" &&
                value.error.trim()
            ) {
                return value.error.trim();
            }
        }

        return fallback;
    };


    /* =====================================================
       NOTIFICATION
       ===================================================== */

    const notify = (
        message,
        type = "info"
    ) => {

        const safeMessage =
            normalizeMessage(message);

        window.dispatchEvent(
            new CustomEvent(
                "neyo:toast",
                {
                    detail: safeMessage
                }
            )
        );

        window.dispatchEvent(
            new CustomEvent(
                "neyo:notification",
                {
                    detail: {
                        message: safeMessage,
                        type
                    }
                }
            )
        );

        if (type === "error") {
            console.error(
                `[NEYO Checkout] ${safeMessage}`
            );
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
                !button.dataset.checkoutOriginalText
            ) {
                button.dataset.checkoutOriginalText =
                    button.textContent
                        ?.trim() ||
                    "Go to NEYO Leverage";
            }

            button.disabled = true;

            button.setAttribute(
                "aria-busy",
                "true"
            );

            button.textContent =
                CONFIG.loadingText;

        } else {

            button.disabled = false;

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
                getUpgradeButton(),
                busy
            );

            setButtonBusy(
                getSettingsUpgradeButton(),
                busy
            );
        };


    /* =====================================================
       TRUSTED URL CHECK
       ===================================================== */

    const isTrustedCheckoutUrl =
        value => {

            if (
                typeof value !== "string" ||
                !value.trim()
            ) {
                return false;
            }

            try {

                const url =
                    new URL(value);

                const hostname =
                    url.hostname
                        .toLowerCase();

                const trusted =
                    hostname ===
                        "lemonsqueezy.com" ||
                    hostname.endsWith(
                        ".lemonsqueezy.com"
                    );

                return (
                    url.protocol === "https:" &&
                    trusted
                );

            } catch {
                return false;
            }
        };


    /* =====================================================
       START CHECKOUT
       ===================================================== */

    const startCheckout =
        async ({
            source = "upgrade"
        } = {}) => {

            if (checkoutRunning) {
                return false;
            }

            checkoutRunning = true;

            setAllButtonsBusy(true);

            try {

                const response =
                    await fetch(
                        CONFIG.endpoint,
                        {
                            method: "POST",
                            credentials: "include",
                            cache: "no-store",

                            headers: {
                                Accept:
                                    "application/json",

                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({
                                    source,
                                    plan: "leverage"
                                })
                        }
                    );

                const data =
                    await response
                        .json()
                        .catch(
                            () => ({})
                        );

                if (!response.ok) {

                    throw new Error(
                        normalizeMessage(
                            data?.error,
                            `Checkout failed (${response.status}).`
                        )
                    );
                }

                const checkoutUrl =
                    typeof data?.url === "string"
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
                        "Invalid checkout URL returned."
                    );
                }

                window.location.assign(
                    checkoutUrl
                );

                return true;

            } catch (error) {

                const message =
                    normalizeMessage(
                        error,
                        "Checkout could not be opened."
                    );

                console.error(
                    "[NEYO Checkout] Request failed:",
                    error
                );

                notify(
                    message,
                    "error"
                );

                return false;

            } finally {

                checkoutRunning = false;

                setAllButtonsBusy(false);
            }
        };


    /* =====================================================
       CLICK INTERCEPTION

       Capture phase prevents legacy neo.js
       checkout listener from firing twice.
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            const modalButton =
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
                !modalButton &&
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

})();
