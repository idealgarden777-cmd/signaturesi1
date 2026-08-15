/*
=========================================================
NEYO — ADS COMPONENT
STABLE FREE / PRO VERSION

Provider:
- Monetag

Format:
- Vignette Web Ads

Zone:
- 11573086

Behavior:
- FREE  → Monetag ads enabled
- PRO   → Ads disabled
- Waits for real account plan before loading ads
- Does NOT grant fake rewarded messages
- Does NOT modify neo.js
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG = Object.freeze({

        provider:
            "monetag",

        format:
            "vignette",

        zoneId:
            "11573086",

        scriptUrl:
            "https://n6wxm.com/vignette.min.js",

        scriptHost:
            "n6wxm.com",

        buttonText:
            "Continue with Ads",

        buttonLoadingText:
            "Loading Ads..."

    });


    /* =====================================================
       STATE
       ===================================================== */

    let initialized =
        false;

    let userPlan =
        "unknown";

    let scriptReady =
        false;

    let scriptLoading =
        false;

    let profileResolved =
        false;


    /* =====================================================
       EVENT HELPER
       ===================================================== */

    function emit(
        name,
        detail = {}
    ) {

        window.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail
                }
            )
        );

    }


    /* =====================================================
       PLAN HELPERS
       ===================================================== */

    function normalizePlan(
        value
    ) {

        const plan =
            String(
                value || ""
            )
                .trim()
                .toLowerCase();


        if (
            plan === "pro"
        ) {

            return "pro";

        }


        if (
            plan === "free"
        ) {

            return "free";

        }


        return "unknown";

    }


    function isProUser() {

        return (
            userPlan === "pro"
        );

    }


    function isFreeUser() {

        return (
            userPlan === "free"
        );

    }


    /* =====================================================
       FIND MONETAG SCRIPT
       ===================================================== */

    function getAdsScript() {

        const scripts =
            Array.from(
                document.scripts
            );


        return (
            scripts.find(
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

    }


    /* =====================================================
       WATCH ADS BUTTON
       ===================================================== */

    function getAdsButton() {

        return document.getElementById(
            "watchAdBtn"
        );

    }


    function configureAdsButton() {

        const button =
            getAdsButton();


        if (!button) {

            return false;

        }


        /*
        PLAN NOT KNOWN YET
        */

        if (
            userPlan === "unknown"
        ) {

            button.disabled =
                true;


            button.textContent =
                "Checking plan...";


            button.setAttribute(
                "aria-busy",
                "true"
            );


            return true;

        }


        /*
        PRO USER
        */

        if (
            isProUser()
        ) {

            button.disabled =
                true;


            button.textContent =
                "Pro — Ad Free";


            button.setAttribute(
                "aria-disabled",
                "true"
            );


            button.removeAttribute(
                "aria-busy"
            );


            button.dataset.tooltip =
                "NEYO Pro is ad-free";


            button.dataset.neyoAdsPlan =
                "pro";


            return true;

        }


        /*
        FREE USER
        */

        button.disabled =
            false;


        button.removeAttribute(
            "aria-disabled"
        );


        button.removeAttribute(
            "aria-busy"
        );


        button.textContent =
            scriptLoading
                ? CONFIG.buttonLoadingText
                : CONFIG.buttonText;


        button.dataset.tooltip =
            "Continue with ad-supported NEYO";


        button.dataset.tooltipPosition =
            "top";


        button.dataset.neyoAdsPlan =
            "free";


        button.setAttribute(
            "aria-label",
            "Continue with ads"
        );


        return true;

    }


    /* =====================================================
       REMOVE ADS SCRIPT
       ===================================================== */

    function disableAds() {

        const script =
            getAdsScript();


        /*
        Remove only NEYO-owned dynamically
        injected Monetag script.
        */

        if (
            script &&
            script.dataset
                ?.neyoAdsOwned ===
                "true"
        ) {

            script.remove();

        }


        scriptReady =
            false;

        scriptLoading =
            false;


        document.documentElement
            .setAttribute(
                "data-neyo-ads",
                "disabled"
            );


        configureAdsButton();


        emit(
            "neyo:ads-disabled",
            {
                plan:
                    userPlan
            }
        );

    }


    /* =====================================================
       LOAD MONETAG
       ===================================================== */

    function loadAds() {

        /*
        Never load ads until account plan
        has been positively identified
        as FREE.
        */

        if (
            !profileResolved ||
            !isFreeUser()
        ) {

            return null;

        }


        const existing =
            getAdsScript();


        if (existing) {

            scriptReady =
                true;

            scriptLoading =
                false;


            document.documentElement
                .setAttribute(
                    "data-neyo-ads",
                    "enabled"
                );


            configureAdsButton();


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


        /*
        Lets us safely identify
        scripts created by this module.
        */

        script.dataset.neyoAdsOwned =
            "true";


        script.addEventListener(
            "load",
            () => {

                scriptLoading =
                    false;

                scriptReady =
                    true;


                document.documentElement
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


                document.documentElement
                    .setAttribute(
                        "data-neyo-ads",
                        "error"
                    );


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


        /*
        Head is safer because body may
        not yet exist during early boot.
        */

        (
            document.head ||
            document.documentElement
        ).appendChild(
            script
        );


        return script;

    }


    /* =====================================================
       CLOSE UPGRADE MODAL
       ===================================================== */

    function closeUpgradeModal() {

        const modal =
            document.getElementById(
                "upgradeModal"
            );


        if (!modal) {

            return;

        }


        modal.classList.remove(
            "show",
            "open",
            "active"
        );


        modal.setAttribute(
            "aria-hidden",
            "true"
        );


        document.body
            ?.classList
            .remove(
                "modal-open"
            );

    }


    /* =====================================================
       APPLY PLAN
       ===================================================== */

    function applyPlan(
        value
    ) {

        const plan =
            normalizePlan(
                value
            );


        if (
            plan === "unknown"
        ) {

            return false;

        }


        userPlan =
            plan;

        profileResolved =
            true;


        document.documentElement
            .setAttribute(
                "data-neyo-ads-plan",
                plan
            );


        if (
            plan === "pro"
        ) {

            disableAds();

        } else {

            loadAds();

        }


        configureAdsButton();


        emit(
            "neyo:ads-plan-change",
            {
                plan:
                    userPlan,

                adsAllowed:
                    isFreeUser()
            }
        );


        return true;

    }


    /* =====================================================
       DIRECT PROFILE CHECK
       ===================================================== */

    async function resolvePlanFromApi() {

        try {

            const response =
                await fetch(
                    "/api/profile",
                    {
                        method:
                            "GET",

                        credentials:
                            "include",

                        cache:
                            "no-store",

                        headers: {
                            Accept:
                                "application/json"
                        }
                    }
                );


            if (
                !response.ok
            ) {

                return false;

            }


            const data =
                await response
                    .json()
                    .catch(
                        () => null
                    );


            const plan =
                data
                    ?.user
                    ?.planType;


            if (!plan) {

                return false;

            }


            return applyPlan(
                plan
            );

        } catch (error) {

            console.warn(
                "[NEYO Ads] Unable to resolve account plan.",
                error
            );


            return false;

        }

    }


    /* =====================================================
       EXISTING PROFILE CHECK
       ===================================================== */

    function resolvePlanFromProfile() {

        try {

            const plan =
                window
                    .NeyoProfile
                    ?.getUser?.()
                    ?.planType;


            if (!plan) {

                return false;

            }


            return applyPlan(
                plan
            );

        } catch {

            return false;

        }

    }


    /* =====================================================
       BUTTON CLICK
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
            Prevent legacy neo.js
            placeholder click handler.
            */

            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation();


            /*
            PRO
            */

            if (
                isProUser()
            ) {

                closeUpgradeModal();


                return;

            }


            /*
            PLAN UNKNOWN
            */

            if (
                !profileResolved
            ) {

                resolvePlanFromApi();


                return;

            }


            /*
            FREE
            */

            if (
                !getAdsScript()
            ) {

                loadAds();


                return;

            }


            /*
            IMPORTANT:
            Vignette itself decides ad delivery.

            This click only means:
            user accepts continuing in
            ad-supported mode.

            It does NOT grant credits.
            */

            closeUpgradeModal();


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
       PROFILE EVENTS
       ===================================================== */

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
        "neyo:model-plan-set",
        event => {

            const plan =
                event
                    .detail
                    ?.plan;


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

            const plan =
                event
                    .detail
                    ?.plan;


            if (plan) {

                applyPlan(
                    plan
                );

            }

        }
    );


    /* =====================================================
       DYNAMIC BUTTON OBSERVER
       ===================================================== */

    const observer =
        new MutationObserver(
            mutations => {

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

                            configureAdsButton();

                        }

                    }

                }

            }
        );


    /* =====================================================
       STATUS
       ===================================================== */

    function getStatus() {

        return {

            provider:
                CONFIG.provider,

            format:
                CONFIG.format,

            zoneId:
                CONFIG.zoneId,

            plan:
                userPlan,

            profileResolved,

            adsAllowed:
                isFreeUser(),

            scriptPresent:
                Boolean(
                    getAdsScript()
                ),

            scriptReady,

            scriptLoading,

            buttonPresent:
                Boolean(
                    getAdsButton()
                ),

            rewardedCredits:
                false

        };

    }


    /* =====================================================
       REFRESH
       ===================================================== */

    async function refresh() {

        const profileFound =
            resolvePlanFromProfile();


        if (
            !profileFound
        ) {

            await resolvePlanFromApi();

        }


        if (
            isFreeUser()
        ) {

            loadAds();

        }


        configureAdsButton();


        return getStatus();

    }


    /* =====================================================
       INIT
       ===================================================== */

    async function init() {

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
        Do not assume FREE at startup.
        This prevents Pro users from
        receiving an ad before their
        account plan is loaded.
        */

        configureAdsButton();


        const foundFromProfile =
            resolvePlanFromProfile();


        if (
            !foundFromProfile
        ) {

            await resolvePlanFromApi();

        }


        configureAdsButton();


        emit(
            "neyo:ads-init",
            getStatus()
        );

    }


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
                        isFreeUser() &&
                        scriptReady &&
                        getAdsScript()
                    ),

            load:
                loadAds,

            disable:
                disableAds,

            getZoneId:
                () =>
                    CONFIG.zoneId,

            getFormat:
                () =>
                    CONFIG.format

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
            () => {
                init();
            },
            {
                once:
                    true
            }
        );

    } else {

        init();

    }

})();
