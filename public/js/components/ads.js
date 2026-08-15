/*
=========================================================
NEYO — ADS COMPONENT
FINAL DUAL-ZONE FREE / PRO VERSION

FREE:
- Monetag Vignette
  Zone: 11573086
- Monetag Onclick / Popunder
  Zone: 11583334

PRO:
- No ad scripts
- Ad-free experience

IMPORTANT:
- Waits for real profile plan
- Does not assume Free on boot
- Does not grant fake rewarded credits
- Does not modify neo.js
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

        vignette: Object.freeze({
            zoneId:
                "11573086",

            src:
                "https://n6wxm.com/vignette.min.js",

            host:
                "n6wxm.com"
        }),

        onclick: Object.freeze({
            zoneId:
                "11583334",

            src:
                "https://zovidree.com/tag.min.js",

            host:
                "zovidree.com"
        }),

        buttonText:
            "Continue with Ads",

        loadingText:
            "Loading Ads...",

        proButtonText:
            "Pro — Ad Free"

    });


    /* =====================================================
       STATE
       ===================================================== */

    let initialized =
        false;

    let userPlan =
        "unknown";

    let profileResolved =
        false;

    let vignetteReady =
        false;

    let onclickReady =
        false;

    let vignetteLoading =
        false;

    let onclickLoading =
        false;


    /* =====================================================
       EVENTS
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
       PLAN
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


    function isFreeUser() {

        return (
            userPlan === "free"
        );

    }


    function isProUser() {

        return (
            userPlan === "pro"
        );

    }


    /* =====================================================
       SCRIPT FINDERS
       ===================================================== */

    function findVignetteScript() {

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
                                CONFIG.vignette.host
                            ) &&
                            zone ===
                                CONFIG.vignette.zoneId
                        );

                    }
                ) ||
            null
        );

    }


    function findOnclickScript() {

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
                                CONFIG.onclick.host
                            ) &&
                            zone ===
                                CONFIG.onclick.zoneId
                        );

                    }
                ) ||
            null
        );

    }


    /* =====================================================
       BUTTON
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
        PLAN UNKNOWN
        */

        if (
            !profileResolved ||
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


            button.dataset.tooltip =
                "Checking your plan";


            return true;

        }


        /*
        PRO
        */

        if (
            isProUser()
        ) {

            button.disabled =
                true;


            button.textContent =
                CONFIG.proButtonText;


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
        FREE
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
            (
                vignetteLoading ||
                onclickLoading
            )
                ? CONFIG.loadingText
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
       SCRIPT CREATION
       ===================================================== */

    function createAdScript({
        src,
        zoneId,
        type
    }) {

        const script =
            document.createElement(
                "script"
            );


        script.async =
            true;


        script.src =
            src;


        script.dataset.zone =
            zoneId;


        script.dataset.neyoAdsOwned =
            "true";


        script.dataset.neyoAdsType =
            type;


        return script;

    }


    /* =====================================================
       VIGNETTE
       ===================================================== */

    function loadVignette() {

        if (
            !profileResolved ||
            !isFreeUser()
        ) {

            return null;

        }


        const existing =
            findVignetteScript();


        if (existing) {

            vignetteReady =
                true;

            vignetteLoading =
                false;


            return existing;

        }


        if (
            vignetteLoading
        ) {

            return null;

        }


        vignetteLoading =
            true;


        configureAdsButton();


        const script =
            createAdScript({
                src:
                    CONFIG.vignette.src,

                zoneId:
                    CONFIG.vignette.zoneId,

                type:
                    "vignette"
            });


        script.addEventListener(
            "load",
            () => {

                vignetteLoading =
                    false;

                vignetteReady =
                    true;


                configureAdsButton();


                emit(
                    "neyo:ads-vignette-ready",
                    {
                        zoneId:
                            CONFIG.vignette.zoneId
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

                vignetteLoading =
                    false;

                vignetteReady =
                    false;


                configureAdsButton();


                console.warn(
                    "[NEYO Ads] Vignette failed to load."
                );


                emit(
                    "neyo:ads-vignette-error",
                    {
                        zoneId:
                            CONFIG.vignette.zoneId
                    }
                );

            },
            {
                once:
                    true
            }
        );


        (
            document.head ||
            document.documentElement
        )
            .appendChild(
                script
            );


        return script;

    }


    /* =====================================================
       ONCLICK / POPUNDER
       ===================================================== */

    function loadOnclick() {

        if (
            !profileResolved ||
            !isFreeUser()
        ) {

            return null;

        }


        const existing =
            findOnclickScript();


        if (existing) {

            onclickReady =
                true;

            onclickLoading =
                false;


            return existing;

        }


        if (
            onclickLoading
        ) {

            return null;

        }


        onclickLoading =
            true;


        configureAdsButton();


        const script =
            createAdScript({
                src:
                    CONFIG.onclick.src,

                zoneId:
                    CONFIG.onclick.zoneId,

                type:
                    "onclick"
            });


        script.addEventListener(
            "load",
            () => {

                onclickLoading =
                    false;

                onclickReady =
                    true;


                configureAdsButton();


                emit(
                    "neyo:ads-onclick-ready",
                    {
                        zoneId:
                            CONFIG.onclick.zoneId
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

                onclickLoading =
                    false;

                onclickReady =
                    false;


                configureAdsButton();


                console.warn(
                    "[NEYO Ads] Onclick failed to load."
                );


                emit(
                    "neyo:ads-onclick-error",
                    {
                        zoneId:
                            CONFIG.onclick.zoneId
                    }
                );

            },
            {
                once:
                    true
            }
        );


        (
            document.head ||
            document.documentElement
        )
            .appendChild(
                script
            );


        return script;

    }


    /* =====================================================
       LOAD ALL FREE ADS
       ===================================================== */

    function loadFreeAds() {

        if (
            !profileResolved ||
            !isFreeUser()
        ) {

            return false;

        }


        loadVignette();

        loadOnclick();


        document.documentElement
            .setAttribute(
                "data-neyo-ads",
                "enabled"
            );


        emit(
            "neyo:ads-enabled",
            {
                plan:
                    "free",

                vignetteZone:
                    CONFIG.vignette.zoneId,

                onclickZone:
                    CONFIG.onclick.zoneId
            }
        );


        return true;

    }


    /* =====================================================
       DISABLE ADS
       ===================================================== */

    function disableAds() {

        const scripts =
            Array.from(
                document.querySelectorAll(
                    'script[data-neyo-ads-owned="true"]'
                )
            );


        scripts.forEach(
            script => {

                script.remove();

            }
        );


        vignetteReady =
            false;

        onclickReady =
            false;

        vignetteLoading =
            false;

        onclickLoading =
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
            isProUser()
        ) {

            disableAds();

        } else {

            loadFreeAds();

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
       PROFILE RESOLUTION
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
                "[NEYO Ads] Unable to resolve plan.",
                error
            );


            return false;

        }

    }


    /* =====================================================
       UPGRADE MODAL
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
       WATCH ADS BUTTON
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
            Block old neo.js placeholder.
            */

            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation();


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
            PRO
            */

            if (
                isProUser()
            ) {

                closeUpgradeModal();

                return;

            }


            /*
            FREE

            Onclick format is already armed
            globally after script loads.

            This button does not guarantee
            an ad impression by itself.
            */

            loadFreeAds();


            closeUpgradeModal();


            emit(
                "neyo:ads-continue",
                {
                    provider:
                        CONFIG.provider,

                    plan:
                        "free",

                    vignetteReady,

                    onclickReady,

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

            plan:
                userPlan,

            profileResolved,

            adsAllowed:
                isFreeUser(),

            vignette: {
                zoneId:
                    CONFIG.vignette.zoneId,

                scriptPresent:
                    Boolean(
                        findVignetteScript()
                    ),

                ready:
                    vignetteReady,

                loading:
                    vignetteLoading
            },

            onclick: {
                zoneId:
                    CONFIG.onclick.zoneId,

                scriptPresent:
                    Boolean(
                        findOnclickScript()
                    ),

                ready:
                    onclickReady,

                loading:
                    onclickLoading
            },

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

            loadFreeAds();

        } else if (
            isProUser()
        ) {

            disableAds();

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
        Do not assume FREE.

        Wait for profile first.
        */

        configureAdsButton();


        const found =
            resolvePlanFromProfile();


        if (
            !found
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

            loadFreeAds,

            loadVignette,

            loadOnclick,

            disable:
                disableAds,

            isVignetteReady:
                () =>
                    Boolean(
                        vignetteReady &&
                        findVignetteScript()
                    ),

            isOnclickReady:
                () =>
                    Boolean(
                        onclickReady &&
                        findOnclickScript()
                    ),

            getVignetteZone:
                () =>
                    CONFIG.vignette.zoneId,

            getOnclickZone:
                () =>
                    CONFIG.onclick.zoneId

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
