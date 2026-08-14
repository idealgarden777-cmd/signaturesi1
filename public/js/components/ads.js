/*
=========================================================
NEYO — ADS COMPONENT
Vignette Web Ads Integration

Owns:
- Monetag Vignette detection
- Ad integration health state
- Legacy rewarded-ad button cleanup
- Public ad status events / API

Does NOT own:
- neo.js
- Checkout
- Subscription logic
- Rewarded message credits

Current Monetag Vignette Zone:
11573086
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
            "vignette.min.js"

    });


    /* =====================================================
       STATE
       ===================================================== */

    let sdkDetected =
        false;

    let initialized =
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
       LEGACY WATCH-AD BUTTON CLEANUP
       ===================================================== */

    const removeLegacyRewardButton = () => {

        const button =
            document.getElementById(
                "watchAdBtn"
            );


        if (!button) {
            return false;
        }


        /*
        Current Monetag integration is Vignette,
        not Rewarded Interstitial.

        Therefore "Watch Ad for 5 messages"
        must not be exposed to users.
        */

        button.remove();


        emit(
            "neyo:legacy-reward-ad-removed"
        );


        return true;

    };


    /* =====================================================
       DETECT VIGNETTE
       ===================================================== */

    const detectVignette = () => {

        const script =
            getVignetteScript();


        if (!script) {

            sdkDetected =
                false;


            return false;

        }


        if (!sdkDetected) {

            sdkDetected =
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

        }


        return true;

    };


    /* =====================================================
       SCRIPT LOAD MONITOR
       ===================================================== */

    const monitorScript = () => {

        const script =
            getVignetteScript();


        if (!script) {
            return;
        }


        /*
        Avoid attaching duplicate listeners.
        */

        if (
            script.dataset
                .neyoAdsObserved ===
            "true"
        ) {

            return;

        }


        script.dataset
            .neyoAdsObserved =
            "true";


        script.addEventListener(
            "load",
            () => {

                sdkDetected =
                    true;


                emit(
                    "neyo:ads-script-loaded",
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

                sdkDetected =
                    false;


                console.warn(
                    "[NEYO Ads] Monetag Vignette script failed to load."
                );


                emit(
                    "neyo:ads-script-error",
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

    };


    /* =====================================================
       DOM OBSERVER

       neo.js dynamically creates watchAdBtn,
       so remove it whenever it appears.
       Also detect dynamically injected Monetag script.
       ===================================================== */

    const observer =
        new MutationObserver(
            mutations => {

                let shouldCheckAds =
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

                            removeLegacyRewardButton();

                        }


                        if (
                            node.tagName ===
                                "SCRIPT" ||
                            node.querySelector?.(
                                "script"
                            )
                        ) {

                            shouldCheckAds =
                                true;

                        }

                    }

                }


                if (shouldCheckAds) {

                    detectVignette();

                    monitorScript();

                }

            }
        );


    /* =====================================================
       STATUS
       ===================================================== */

    const getStatus = () => {

        const script =
            getVignetteScript();


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
                    sdkDetected
                ),

            rewardedAds:
                false

        };

    };


    /* =====================================================
       REFRESH
       ===================================================== */

    const refresh = () => {

        removeLegacyRewardButton();

        detectVignette();

        monitorScript();


        return getStatus();

    };


    /* =====================================================
       INITIALIZE
       ===================================================== */

    const init = () => {

        if (initialized) {
            return;
        }


        initialized =
            true;


        removeLegacyRewardButton();

        detectVignette();

        monitorScript();


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
                    sdkDetected,

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
