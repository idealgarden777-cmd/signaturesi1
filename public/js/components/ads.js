/*
=========================================================
NEYO — ADS COMPONENT
PLAN-AWARE STABLE VERSION

Provider:
- Monetag

Format:
- Vignette Web Ads

Current Zone:
- 11573086

Owns:
- Free / Pro ad eligibility
- Monetag script injection
- Monetag script detection
- Ads button UI
- Legacy Watch Ad click interception
- Ads status
- Public ads API

Does NOT own:
- Checkout
- Subscription billing
- Usage limits
- Rewarded credits
- neo.js
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG =
        Object.freeze({

            provider:
                "monetag",

            format:
                "vignette",

            zoneId:
                "11573086",

            scriptHost:
                "n6wxm.com",

            scriptUrl:
                "https://n6wxm.com/vignette.min.js",

            buttonText:
                "Continue with Ads",

            proButtonText:
                "Pro — Ad Free",

            loadingText:
                "Loading Ads..."

        });


    /* =====================================================
       STATE
       ===================================================== */

    let initialized =
        false;

    let scriptReady =
        false;

    let scriptLoading =
        false;

    let userPlan =
        "free";


    /* =====================================================
       HELPERS
       ===================================================== */

    const emit =
        (
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


    const normalizePlan =
        value => {

            return String(
                value || "free"
            )
                .trim()
                .toLowerCase() ===
                "pro"
                ? "pro"
                : "free";

        };


    const isProUser =
        () =>
            userPlan === "pro";


    const isFreeUser =
        () =>
            !isProUser();


    /* =====================================================
       ADS BUTTON
       ===================================================== */

    const getAdsButton =
        () => {

            return document.getElementById(
                "watchAdBtn"
            );

        };


    const configureAdsButton =
        () => {

            const button =
                getAdsButton();


            if (!button) {
                return false;
            }


            /*
            PRO USER
            */

            if (
                isProUser()
            ) {

                button.textContent =
                    CONFIG.proButtonText;


                button.disabled =
                    true;


                button.setAttribute(
                    "aria-disabled",
                    "true"
                );


                button.removeAttribute(
                    "aria-busy"
                );


                button.dataset.tooltip =
                    "Your Pro plan is ad-free";


                button.dataset.tooltipPosition =
                    "top";


                button.dataset.neyoAdsConfigured =
                    "true";


                button.dataset.neyoAdsPlan =
                    "pro";


                return true;

            }


            /*
            FREE USER
            */

            button.textContent =
                scriptLoading
                    ? CONFIG.loadingText
                    : CONFIG.buttonText;


            button.disabled =
                false;


            button.removeAttribute(
                "aria-disabled"
            );


            button.removeAttribute(
                "aria-busy"
            );


            button.dataset.tooltip =
                "Continue using NEYO with ads";


            button.dataset.tooltipPosition =
                "top";


            button.setAttribute(
                "aria-label",
                "Continue with ads"
            );


            button.dataset.neyoAdsConfigured =
                "true";


            button.dataset.neyoAdsPlan =
                "free";


            return true;

        };


    /* =====================================================
       FIND MONETAG SCRIPT
       ===================================================== */

    const getVignetteScript =
        () => {

            return (
                Array.from(
                    document.scripts
                )
                    .find(
                        script => {

                            const src =
                                String(
                                    script.src || ""
                                );


                            const zone =
                                String(
                                    script.dataset?.zone ||
                                    ""
                                );


                            return (
                                src.includes(
                                    CONFIG.scriptHost
                                ) &&
                                zone ===
                                    CONFIG.zoneId
                            );

                        }
                    ) ||
                null
            );

        };


    /* =====================================================
       SCRIPT REMOVAL
       ===================================================== */

    const removeVignetteScript =
        () => {

            const script =
                getVignetteScript();


            if (script) {

                script.remove();

            }


            scriptReady =
                false;

            scriptLoading =
                false;


            document.documentElement
                .removeAttribute(
                    "data-neyo-ads"
                );


            emit(
                "neyo:ads-disabled",
                {
                    plan:
                        userPlan,

                    provider:
                        CONFIG.provider
                }
            );

        };


    /* =====================================================
       SCRIPT LOAD
       ===================================================== */

    const loadVignetteScript =
        () => {

            /*
            Pro users must never
            initialize ads.
            */

            if (
                isProUser()
            ) {

                removeVignetteScript();

                return null;

            }


            const existing =
                getVignetteScript();


            if (existing) {

                scriptReady =
                    true;


                return existing;

            }


            if (
                scriptLoading
            ) {

                return null;

            }


            scriptLoading =
                true;


            configureAdsButton();


            const script =
                document.createElement(
                    "script"
                );


            script.async =
                true;


            script.src =
                CONFIG.scriptUrl;


            script.dataset.zone =
                CONFIG.zoneId;


            script.dataset.neyoAdsOwned =
                "true";


            script.addEventListener(
                "load",
                () => {

                    scriptLoading =
                        false;

                    scriptReady =
                        true;


                    document
                        .documentElement
                        .setAttribute(
                            "data-neyo-ads",
                            "enabled"
                        );


                    configureAdsButton();


                    emit(
                        "neyo:ads-ready",
                        {
                            provider:
                                CONFIG.provider,

                            format:
                                CONFIG.format,

                            zoneId:
                                CONFIG.zoneId,

                            plan:
                                userPlan
                        }
                    );

                },
                {
                    once:
                        true
                }
            );


            script.addEventListener(
                "error",
                () => {

                    scriptLoading =
                        false;

                    scriptReady =
                        false;


                    configureAdsButton();


                    console.warn(
                        "[NEYO Ads] Monetag script failed to load."
                    );


                    emit(
                        "neyo:ads-error",
                        {
                            provider:
                                CONFIG.provider,

                            zoneId:
                                CONFIG.zoneId
                        }
                    );

                },
                {
                    once:
                        true
                }
            );


            document.body
                .appendChild(
                    script
                );


            return script;

        };


    /* =====================================================
       CLOSE UPGRADE MODAL
       ===================================================== */

    const closeUpgradeModal =
        () => {

            const modal =
                document.getElementById(
                    "upgradeModal"
                );


            if (!modal) {
                return;
            }


            modal.classList.remove(
                "show"
            );


            modal.classList.remove(
                "open"
            );


            modal.classList.remove(
                "active"
            );


            modal.setAttribute(
                "aria-hidden",
                "true"
            );


            document.body
                .classList
                .remove(
                    "modal-open"
                );

        };


    /* =====================================================
       PLAN
       ===================================================== */

    const applyPlan =
        plan => {

            userPlan =
                normalizePlan(
                    plan
                );


            if (
                isProUser()
            ) {

                removeVignetteScript();

                configureAdsButton();


                document.documentElement
                    .setAttribute(
                        "data-neyo-ads-plan",
                        "pro"
                    );


                return;

            }


            document.documentElement
                .setAttribute(
                    "data-neyo-ads-plan",
                    "free"
                );


            configureAdsButton();


            loadVignetteScript();

        };


    /* =====================================================
       WATCH AD BUTTON CLICK
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
            Prevent old neo.js placeholder handler.
            */

            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation();


            /*
            PRO USER
            */

            if (
                isProUser()
            ) {

                closeUpgradeModal();


                emit(
                    "neyo:ads-pro-blocked",
                    {
                        plan:
                            "pro"
                    }
                );


                return;

            }


            /*
            FREE USER
            */

            const script =
                getVignetteScript();


            if (!script) {

                loadVignetteScript();


                emit(
                    "neyo:ads-unavailable",
                    {
                        zoneId:
                            CONFIG.zoneId
                    }
                );


                return;

            }


            closeUpgradeModal();


            /*
            IMPORTANT:
            Monetag Vignette controls when
            and whether the actual ad appears.

            This event means:
            "continue using ad-supported NEYO"

            It DOES NOT mean:
            "reward completed".
            */

            emit(
                "neyo:ads-continue",
                {
                    provider:
                        CONFIG.provider,

                    format:
                        CONFIG.format,

                    zoneId:
                        CONFIG.zoneId,

                    plan:
                        userPlan,

                    rewarded:
                        false
                }
            );

        },
        true
    );


    /* =====================================================
       DOM OBSERVER
       ===================================================== */

    const observer =
        new MutationObserver(
            mutations => {

                let shouldRefresh =
                    false;


                for (
                    const mutation
                    of mutations
                ) {

                    for (
                        const node
                        of mutation.addedNodes
                    ) {

                        if (
                            node.nodeType !==
                            Node.ELEMENT_NODE
                        ) {

                            continue;

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

                }


                if (
                    shouldRefresh
                ) {

                    configureAdsButton();

                }

            }
        );


    /* =====================================================
       PROFILE EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:model-plan-set",
        event => {

            applyPlan(
                event.detail?.plan
            );

        }
    );


    window.addEventListener(
        "neyo:profile-loaded",
        event => {

            const plan =
                event
                    .detail
                    ?.user
                    ?.planType;


            if (plan) {

                applyPlan(
                    plan
                );

            }

        }
    );


    window.addEventListener(
        "neyo:plan-change",
        event => {

            applyPlan(
                event.detail?.plan
            );

        }
    );


    /* =====================================================
       PROFILE FALLBACK
       ===================================================== */

    const syncExistingPlan =
        () => {

            const profileUser =
                window.NeyoProfile
                    ?.getUser?.();


            if (
                profileUser
                    ?.planType
            ) {

                applyPlan(
                    profileUser.planType
                );


                return true;

            }


            return false;

        };


    /* =====================================================
       STATUS
       ===================================================== */

    const getStatus =
        () => {

            const script =
                getVignetteScript();


            const button =
                getAdsButton();


            return {

                provider:
                    CONFIG.provider,

                format:
                    CONFIG.format,

                zoneId:
                    CONFIG.zoneId,

                plan:
                    userPlan,

                adsAllowed:
                    isFreeUser(),

                scriptPresent:
                    Boolean(
                        script
                    ),

                scriptReady:
                    Boolean(
                        script &&
                        scriptReady
                    ),

                scriptLoading,

                adsButtonPresent:
                    Boolean(
                        button
                    ),

                rewardedCredits:
                    false

            };

        };


    /* =====================================================
       REFRESH
       ===================================================== */

    const refresh =
        () => {

            syncExistingPlan();


            if (
                isFreeUser()
            ) {

                loadVignetteScript();

            }


            configureAdsButton();


            return getStatus();

        };


    /* =====================================================
       INIT
       ===================================================== */

    const init =
        () => {

            if (
                initialized
            ) {
                return;
            }


            initialized =
                true;


            observer.observe(
                document.documentElement,
                {
                    childList:
                        true,

                    subtree:
                        true
                }
            );


            /*
            At startup we do NOT immediately
            trust default "free".

            First try reading profile plan.
            */

            const planFound =
                syncExistingPlan();


            /*
            profile.js loads asynchronously.
            Retry briefly.
            */

            if (
                !planFound
            ) {

                window.setTimeout(
                    syncExistingPlan,
                    150
                );


                window.setTimeout(
                    syncExistingPlan,
                    500
                );


                window.setTimeout(
                    syncExistingPlan,
                    1200
                );

            }


            configureAdsButton();


            emit(
                "neyo:ads-init",
                getStatus()
            );

        };


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoAds =
        Object.freeze({

            init,

            refresh,

            getStatus,

            setPlan:
                applyPlan,

            getPlan:
                () =>
                    userPlan,

            isAllowed:
                () =>
                    isFreeUser(),

            isReady:
                () =>
                    Boolean(
                        getVignetteScript() &&
                        scriptReady &&
                        isFreeUser()
                    ),

            getZoneId:
                () =>
                    CONFIG.zoneId,

            getFormat:
                () =>
                    CONFIG.format,

            load:
                loadVignetteScript,

            disable:
                removeVignetteScript

        });


    /* =====================================================
       BOOT
       ===================================================== */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            init,
            {
                once:
                    true
            }
        );

    } else {

        init();

    }

})();
