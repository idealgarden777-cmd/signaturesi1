/*
=========================================================
NEYO — REWARDED ADS COMPONENT

Owns:
- Rewarded ad trigger
- Watch Ad button interception
- Reward balance
- Reward consume
- Monetag SDK detection
- Public events / API

Does NOT own:
- neo.js
- Checkout
- Subscription activation
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG = Object.freeze({

        rewardMessages: 5,

        zoneId:
            "11455541",

        sdkFunction:
            "show_11455541",

        rewardStorageKey:
            "neyo_rewarded_messages",

        placement:
            "neyo_free_messages"

    });


    /* =====================================================
       STATE
       ===================================================== */

    let adRunning =
        false;


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

    const showToast = (
        message,
        type = "info"
    ) => {

        emit(
            "neyo:toast",
            {
                message,
                type
            }
        );


        /*
        Fallback if app toast listener
        is currently unavailable.
        */

        if (
            !window.NeyoToast &&
            type === "error"
        ) {

            console.warn(
                `[NEYO Ads] ${message}`
            );

        }

    };


    /* =====================================================
       REWARD BALANCE
       ===================================================== */

    const getRewardBalance = () => {

        const value =
            Number(
                localStorage.getItem(
                    CONFIG.rewardStorageKey
                )
            );


        if (
            !Number.isFinite(value) ||
            value < 0
        ) {

            return 0;

        }


        return Math.floor(
            value
        );

    };


    const saveRewardBalance =
        amount => {

            const next =
                Math.max(
                    0,
                    Math.floor(
                        Number(amount) || 0
                    )
                );


            localStorage.setItem(
                CONFIG.rewardStorageKey,
                String(next)
            );


            emit(
                "neyo:ad-reward-balance-change",
                {
                    remaining:
                        next
                }
            );


            return next;

        };


    const addReward = (
        amount =
            CONFIG.rewardMessages
    ) => {

        const current =
            getRewardBalance();


        return saveRewardBalance(
            current +
            Math.max(
                0,
                Number(amount) || 0
            )
        );

    };


    const consumeReward = () => {

        const current =
            getRewardBalance();


        if (current <= 0) {

            return false;

        }


        saveRewardBalance(
            current - 1
        );


        emit(
            "neyo:ad-reward-consumed",
            {
                remaining:
                    getRewardBalance()
            }
        );


        return true;

    };


    /* =====================================================
       USER TRACKING ID
       ===================================================== */

    const getTrackingId = () => {

        try {

            const user =
                JSON.parse(
                    localStorage.getItem(
                        "signaturesi_user"
                    ) ||
                    "{}"
                );


            if (user?.id) {

                return String(
                    user.id
                );

            }

        } catch {
            // Ignore invalid localStorage.
        }


        let sessionId =
            sessionStorage.getItem(
                "neyo_ad_session_id"
            );


        if (!sessionId) {

            sessionId =
                crypto.randomUUID
                    ? crypto.randomUUID()
                    : `neyo-${Date.now()}-${Math.random()
                        .toString(36)
                        .slice(2)}`;


            sessionStorage.setItem(
                "neyo_ad_session_id",
                sessionId
            );

        }


        return sessionId;

    };


    /* =====================================================
       MONETAG SDK
       ===================================================== */

    const getAdFunction = () => {

        const direct =
            window[
                CONFIG.sdkFunction
            ];


        if (
            typeof direct ===
            "function"
        ) {

            return direct;

        }


        const generated =
            window[
                `show_${CONFIG.zoneId}`
            ];


        if (
            typeof generated ===
            "function"
        ) {

            return generated;

        }


        return null;

    };


    const isSdkReady = () => {

        return Boolean(
            getAdFunction()
        );

    };


    /* =====================================================
       WATCH AD BUTTON
       ===================================================== */

    const getWatchButton = () => {

        return document.getElementById(
            "watchAdBtn"
        );

    };


    const updateWatchButton = () => {

        const button =
            getWatchButton();


        if (!button) {
            return;
        }


        button.textContent =
            adRunning
                ? "Loading ad..."
                : `Watch Ad for ${CONFIG.rewardMessages} messages`;


        button.disabled =
            adRunning;


        button.setAttribute(
            "aria-busy",
            String(adRunning)
        );


        button.dataset.tooltip =
            `Watch an ad for ${CONFIG.rewardMessages} bonus messages`;


        button.dataset.tooltipPosition =
            "top";


        button.setAttribute(
            "aria-label",
            `Watch ad for ${CONFIG.rewardMessages} bonus messages`
        );

    };


    /* =====================================================
       CLOSE UPGRADE MODAL
       ===================================================== */

    const closeUpgradeModal = () => {

        const modal =
            document.getElementById(
                "upgradeModal"
            );


        modal?.classList.remove(
            "show"
        );

    };


    /* =====================================================
       SHOW REWARDED AD
       ===================================================== */

    const showRewardedAd =
        async () => {

            if (adRunning) {

                return false;

            }


            const showAd =
                getAdFunction();


            if (!showAd) {

                console.warn(
                    "[NEYO Ads] Monetag ad SDK is not loaded yet.",
                    {
                        zoneId:
                            CONFIG.zoneId,

                        expectedFunction:
                            CONFIG.sdkFunction
                    }
                );


                showToast(
                    "Rewarded ads are not connected yet.",
                    "info"
                );


                emit(
                    "neyo:ad-sdk-missing",
                    {
                        zoneId:
                            CONFIG.zoneId
                    }
                );


                return false;

            }


            adRunning =
                true;


            updateWatchButton();


            const trackingId =
                getTrackingId();


            try {

                emit(
                    "neyo:ad-start",
                    {
                        zoneId:
                            CONFIG.zoneId,

                        placement:
                            CONFIG.placement,

                        trackingId
                    }
                );


                /*
                Monetag SDK call.

                Reward is added only if
                this Promise resolves.
                */

                await showAd({

                    ymid:
                        trackingId,

                    requestVar:
                        CONFIG.placement

                });


                const balance =
                    addReward(
                        CONFIG.rewardMessages
                    );


                closeUpgradeModal();


                emit(
                    "neyo:ad-reward-granted",
                    {
                        amount:
                            CONFIG.rewardMessages,

                        remaining:
                            balance,

                        trackingId
                    }
                );


                showToast(
                    `${CONFIG.rewardMessages} bonus messages unlocked.`,
                    "success"
                );


                return true;

            } catch (error) {

                console.warn(
                    "[NEYO Ads] Ad failed or was not completed.",
                    error
                );


                emit(
                    "neyo:ad-failed",
                    {
                        error
                    }
                );


                showToast(
                    "Ad unavailable or not completed.",
                    "info"
                );


                return false;

            } finally {

                adRunning =
                    false;


                updateWatchButton();

            }

        };


    /* =====================================================
       INTERCEPT LEGACY NEO.JS BUTTON
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            const button =
                event.target
                    ?.closest?.(
                        "#watchAdBtn"
                    );


            if (!button) {
                return;
            }


            /*
            Capture phase stops the old
            neo.js placeholder click.
            */

            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation();


            showRewardedAd();

        },
        true
    );


    /* =====================================================
       DYNAMIC BUTTON OBSERVER
       ===================================================== */

    const observer =
        new MutationObserver(
            mutations => {

                let shouldRefresh =
                    false;


                mutations.forEach(
                    mutation => {

                        mutation.addedNodes
                            .forEach(
                                node => {

                                    if (
                                        node.nodeType !==
                                        Node.ELEMENT_NODE
                                    ) {
                                        return;
                                    }


                                    if (
                                        node.id ===
                                            "watchAdBtn" ||
                                        node.querySelector?.(
                                            "#watchAdBtn"
                                        )
                                    ) {

                                        shouldRefresh =
                                            true;

                                    }

                                }
                            );

                    }
                );


                if (shouldRefresh) {

                    updateWatchButton();

                }

            }
        );


    observer.observe(
        document.body,
        {
            childList:
                true,

            subtree:
                true
        }
    );


    /* =====================================================
       EXTERNAL EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:ad-show-request",
        () => {

            showRewardedAd();

        }
    );


    window.addEventListener(
        "neyo:ad-reward-consume-request",
        () => {

            const consumed =
                consumeReward();


            emit(
                "neyo:ad-reward-consume-result",
                {
                    consumed,

                    remaining:
                        getRewardBalance()
                }
            );

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    updateWatchButton();


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoAds =
        Object.freeze({

            show:
                showRewardedAd,

            isSdkReady,

            isRunning:
                () =>
                    adRunning,

            getRewardBalance,

            addReward,

            consumeReward,

            getZoneId:
                () =>
                    CONFIG.zoneId

        });

})();
