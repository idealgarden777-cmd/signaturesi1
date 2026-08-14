/*
=========================================================
NEYO — ADS COMPONENT
Monetag Vignette Web Ads

Current Zone:
11573086

Owns:
- Monetag Vignette detection
- Ads button UI
- Legacy Watch Ad click interception
- Ads health/status
- Public API

Does NOT own:
- neo.js
- Checkout
- Pro subscription
- Fake rewarded credits
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

        scriptHost:
            "n6wxm.com",

        scriptName:
            "vignette.min.js",

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

    let scriptReady =
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
       FIND MONETAG SCRIPT
       ===================================================== */

    const getVignetteScript = () => {

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
                            script.dataset?.zone || ""
                        );


                    return (
                        src.includes(
                            CONFIG.scriptHost
                        ) &&
                        src.includes(
                            CONFIG.scriptName
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
       ADS BUTTON
       ===================================================== */

    const getAdsButton = () => {

        return document.getElementById(
            "watchAdBtn"
        );

    };


    const configureAdsButton = () => {

        const button =
            getAdsButton();


        if (!button) {

            return false;

        }


        /*
        IMPORTANT:

        Current integration is Vignette,
        not Rewarded Interstitial.

        Therefore we do NOT claim that
        watching this ad gives 5 messages.
        */


        button.textContent =
            CONFIG.buttonText;


        button.disabled =
            false;


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


        button.dataset
            .neyoAdsConfigured =
            "true";


        return true;

    };


    /* =====================================================
       CLOSE UPGRADE MODAL
       ===================================================== */

    const closeUpgradeModal = () => {

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

    };


    /* =====================================================
       SCRIPT DETECTION
       ===================================================== */

    const detectVignette = () => {

        const script =
            getVignetteScript();


        if (!script) {

            scriptReady =
                false;


            return false;

        }


        /*
        The script element exists.
        Monetag Vignette controls actual
        ad delivery automatically.
        */

        scriptReady =
            true;


        return true;

    };


    /* =====================================================
       MONITOR SCRIPT
       ===================================================== */

    const monitorVignetteScript = () => {

        const script =
            getVignetteScript();


        if (!script) {

            return false;

        }


        if (
            script.dataset
                .neyoAdsObserved ===
            "true"
        ) {

            return true;

        }


        script.dataset
            .neyoAdsObserved =
            "true";


        script.addEventListener(
            "load",
            () => {

                scriptReady =
                    true;


                emit(
                    "neyo:ads-ready",
                    {
                        provider:
                            CONFIG.provider,

                        format:
                            CONFIG.format,

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


        script.addEventListener(
            "error",
            () => {

                scriptReady =
                    false;


                console.warn(
                    "[NEYO Ads] Monetag Vignette failed to load."
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


        return true;

    };


    /* =====================================================
       ADS BUTTON CLICK

       Capture phase prevents neo.js old
       placeholder handler from showing:
       "Ad integration will be available soon."
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


            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation();


            configureAdsButton();


            const available =
                detectVignette();


            if (!available) {

                console.warn(
                    "[NEYO Ads] Vignette script is not available.",
                    {
                        zoneId:
                            CONFIG.zoneId
                    }
                );


                emit(
                    "neyo:ads-unavailable",
                    {
                        zoneId:
                            CONFIG.zoneId
                    }
                );


                return;

            }


            /*
            Vignette ads are delivered by
            Monetag automatically.

            There is no show_ZONE() method
            for this web format.
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
                        CONFIG.zoneId
                }
            );

        },
        true
    );


    /* =====================================================
       DOM OBSERVER

       neo.js creates watchAdBtn dynamically.
       Whenever it appears, convert it into
       the current ads button.
       ===================================================== */

    const observer =
        new MutationObserver(
            mutations => {

                let buttonFound =
                    false;

                let scriptFound =
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

                            buttonFound =
                                true;

                        }


                        if (
                            node.tagName ===
                                "SCRIPT" ||
                            node.querySelector?.(
                                "script"
                            )
                        ) {

                            scriptFound =
                                true;

                        }

                    }

                }


                if (buttonFound) {

                    configureAdsButton();

                }


                if (scriptFound) {

                    detectVignette();

                    monitorVignetteScript();

                }

            }
        );


    /* =====================================================
       STATUS
       ===================================================== */

    const getStatus = () => {

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

            scriptPresent:
                Boolean(script),

            ready:
                Boolean(
                    script &&
                    scriptReady
                ),

            adsButtonPresent:
                Boolean(button),

            rewardedCredits:
                false

        };

    };


    /* =====================================================
       REFRESH
       ===================================================== */

    const refresh = () => {

        detectVignette();

        monitorVignetteScript();

        configureAdsButton();


        return getStatus();

    };


    /* =====================================================
       INIT
       ===================================================== */

    const init = () => {

        if (initialized) {

            return;

        }


        initialized =
            true;


        detectVignette();

        monitorVignetteScript();

        configureAdsButton();


        observer.observe(
            document.documentElement,
            {
                childList:
                    true,

                subtree:
                    true
            }
        );


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

            isReady:
                () =>
                    Boolean(
                        getVignetteScript() &&
                        scriptReady
                    ),

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
