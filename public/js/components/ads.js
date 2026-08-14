/*
=========================================================
NEYO — REWARDED ADS COMPONENT

Purpose:
- Handle rewarded ads outside neo.js
- Intercept legacy Watch Ad button
- Reward successful ad completion
- Keep free-user bonus state
- Support Monetag SDK
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG = Object.freeze({

        rewardMessages: 5,

        // Replace after Monetag zone is connected.
        zoneId: "",

        sdkFunction: "",

        rewardStorageKey:
            "neyo_rewarded_messages",

        placement:
            "free_message_reward"

    });


    /* =====================================================
       STATE
       ===================================================== */

    let adRunning = false;


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


    const toast = (
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

    };


    const getRewardBalance = () => {

        const raw =
            Number(
                localStorage.getItem(
                    CONFIG.rewardStorageKey
                )
            );


        return Number.isFinite(raw)
            ? Math.max(
                0,
                Math.floor(raw)
            )
            : 0;

    };


    const saveRewardBalance =
        amount => {

            const safeAmount =
                Math.max(
                    0,
                    Math.floor(
                        Number(amount) || 0
                    )
                );


            localStorage.setItem(
                CONFIG.rewardStorageKey,
                String(safeAmount)
            );


            emit(
                "neyo:ad-reward-balance-change",
                {
                    remaining:
                        safeAmount
                }
            );


            return safeAmount;

        };


    const addReward = (
        amount =
            CONFIG.rewardMessages
    ) => {

        const current =
            getRewardBalance();


        return saveRewardBalance(
            current + amount
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


        return true;

    };


    /* =====================================================
       SDK RESOLUTION
       ===================================================== */

    const getSdkFunction = () => {

        /*
        Example after Monetag gives you:

        Zone ID:
        123456

        SDK function:
        show_123456

        CONFIG becomes:

        zoneId: "123456",
        sdkFunction: "show_123456"
        */


        if (
            CONFIG.sdkFunction &&
            typeof window[
                CONFIG.sdkFunction
            ] === "function"
        ) {

            return window[
                CONFIG.sdkFunction
            ];

        }


        if (CONFIG.zoneId) {

            const generatedName =
                `show_${CONFIG.zoneId}`;


            if (
                typeof window[
                    generatedName
                ] === "function"
            ) {

                return window[
                    generatedName
                ];

            }

        }


        return null;

    };


    /* =====================================================
       USER TRACKING ID
       ===================================================== */

    const getTrackingId = () => {

        try {

            const storedUser =
                JSON.parse(
                    localStorage.getItem(
                        "signaturesi_user"
                    ) ||
                    "{}"
                );


            if (storedUser?.id) {

                return String(
                    storedUser.id
                );

            }

        } catch {
            // Ignore malformed storage.
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
       BUTTON UI
       ===================================================== */

    const getWatchButton = () =>
        document.getElementById(
            "watchAdBtn"
        );


    const setButtonLoading =
        loading => {

            const button =
                getWatchButton();


            if (!button) {
                return;
            }


            button.disabled =
                loading;


            button.setAttribute(
                "aria-busy",
                String(loading)
            );


            button.textContent =
                loading
                    ? "Loading ad..."
                    : `Watch Ad for ${CONFIG.rewardMessages} messages`;

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
                getSdkFunction();


            if (!showAd) {

                toast(
                    "Rewarded ads are not connected yet.",
                    "info"
                );


                console.warn(
                    "[NEYO Ads] Monetag SDK function not found."
                );


                emit(
                    "neyo:ad-sdk-missing"
                );


                return false;

            }


            adRunning =
                true;


            setButtonLoading(
                true
            );


            const trackingId =
                getTrackingId();


            try {

                emit(
                    "neyo:ad-start",
                    {
                        placement:
                            CONFIG.placement,

                        trackingId
                    }
                );


                /*
                Monetag Rewarded Interstitial.

                Promise resolves only when
                the rewarded event completes.
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


                toast(
                    `${CONFIG.rewardMessages} bonus messages unlocked.`,
                    "success"
                );


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


                return true;

            } catch (error) {

                console.warn(
                    "[NEYO Ads] Rewarded ad failed:",
                    error
                );


                toast(
                    "Ad was unavailable or not completed.",
                    "info"
                );


                emit(
                    "neyo:ad-failed",
                    {
                        error
                    }
                );


                return false;

            } finally {

                adRunning =
                    false;


                setButtonLoading(
                    false
                );

            }

        };


    /* =====================================================
       INTERCEPT LEGACY NEO.JS WATCH BUTTON

       document capture phase runs before the
       legacy target click handler in neo.js.
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            const button =
                event.target.closest?.(
                    "#watchAdBtn"
                );


            if (!button) {
                return;
            }


            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation();


            showRewardedAd();

        },
        true
    );


    /* =====================================================
       WATCH FOR DYNAMIC BUTTON
       ===================================================== */

    const observer =
        new MutationObserver(
            () => {

                const button =
                    getWatchButton();


                if (!button) {
                    return;
                }


                button.dataset.tooltip =
                    `Watch an ad for ${CONFIG.rewardMessages} bonus messages`;


                button.dataset
                    .tooltipPosition =
                    "top";


                button.setAttribute(
                    "aria-label",
                    `Watch ad for ${CONFIG.rewardMessages} bonus messages`
                );

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
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:ad-show-request",
        showRewardedAd
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
       PUBLIC API
       ===================================================== */

    window.NeyoAds =
        Object.freeze({

            show:
                showRewardedAd,

            getRewardBalance,

            consumeReward,

            addReward,

            isRunning:
                () =>
                    adRunning

        });

})();
