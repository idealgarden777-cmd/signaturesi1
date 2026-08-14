/*
=========================================================
NEYO — MODEL MENU COMPONENT
LEGACY-CONFLICT-SAFE VERSION

Owns:
- Model dropdown open / close
- Model selection
- Active model UI
- Current model display
- Pro model access
- Pro unlock state
- Legacy neo.js click interception
- Public model events / API

Does NOT own:
- Checkout
- Upgrade modal UI
- Subscription fetching
- Chat API
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const modelBadgeBtn =
        document.getElementById(
            "modelBadgeBtn"
        );

    const modelDropdownMenu =
        document.getElementById(
            "modelDropdownMenu"
        );

    const currentModelDisplay =
        document.getElementById(
            "currentModelDisplay"
        );

    const modelOptions =
        Array.from(
            document.querySelectorAll(
                ".model-option[data-model]"
            )
        );


    if (
        !modelBadgeBtn ||
        !modelDropdownMenu
    ) {
        return;
    }


    /* =====================================================
       MODELS
       ===================================================== */

    const MODELS =
        Object.freeze({

            "l1.0": {
                id: "l1.0",
                label: "NEYO L1.0",
                plan: "free"
            },

            "l1.2": {
                id: "l1.2",
                label: "NEYO L1.2 Pro",
                plan: "pro"
            }

        });


    /* =====================================================
       STATE
       ===================================================== */

    let selectedModel =
        "l1.0";

    let userPlan =
        "free";


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


    const normalizePlan =
        value => {

            return String(
                value || "free"
            )
                .trim()
                .toLowerCase() === "pro"
                ? "pro"
                : "free";

        };


    const getModel =
        modelId => {

            return (
                MODELS[modelId] ||
                null
            );

        };


    const isProUser =
        () =>
            userPlan === "pro";


    const canUseModel =
        modelId => {

            const model =
                getModel(
                    modelId
                );


            if (!model) {
                return false;
            }


            if (
                model.plan === "pro" &&
                !isProUser()
            ) {
                return false;
            }


            return true;

        };


    /* =====================================================
       MENU STATE
       ===================================================== */

    const isMenuOpen =
        () =>
            modelDropdownMenu
                .classList
                .contains(
                    "show"
                );


    const openMenu =
        () => {

            modelDropdownMenu
                .classList
                .add(
                    "show"
                );


            modelBadgeBtn
                .setAttribute(
                    "aria-expanded",
                    "true"
                );


            emit(
                "neyo:model-menu-open"
            );

        };


    const closeMenu =
        () => {

            modelDropdownMenu
                .classList
                .remove(
                    "show"
                );


            modelBadgeBtn
                .setAttribute(
                    "aria-expanded",
                    "false"
                );


            emit(
                "neyo:model-menu-close"
            );

        };


    const toggleMenu =
        () => {

            if (
                isMenuOpen()
            ) {

                closeMenu();

            } else {

                openMenu();

            }

        };


    /* =====================================================
       PRO ACCESS UI
       ===================================================== */

    const updateAccessUI =
        () => {

            modelOptions.forEach(
                option => {

                    const modelId =
                        option
                            .dataset
                            .model;


                    const model =
                        getModel(
                            modelId
                        );


                    if (!model) {
                        return;
                    }


                    const isProModel =
                        model.plan === "pro";


                    const unlocked =
                        canUseModel(
                            modelId
                        );


                    option
                        .classList
                        .toggle(
                            "locked",
                            isProModel &&
                            !unlocked
                        );


                    option
                        .classList
                        .toggle(
                            "is-unlocked",
                            isProModel &&
                            unlocked
                        );


                    if (
                        isProModel
                    ) {

                        option
                            .setAttribute(
                                "aria-disabled",
                                String(
                                    !unlocked
                                )
                            );

                    } else {

                        option
                            .removeAttribute(
                                "aria-disabled"
                            );

                    }

                }
            );

        };


    /* =====================================================
       ACTIVE MODEL UI
       ===================================================== */

    const updateModelUI =
        modelId => {

            const model =
                getModel(
                    modelId
                );


            if (!model) {
                return;
            }


            if (
                currentModelDisplay
            ) {

                currentModelDisplay
                    .textContent =
                    model.label;

            }


            modelOptions.forEach(
                option => {

                    const active =
                        option
                            .dataset
                            .model ===
                        modelId;


                    option
                        .classList
                        .toggle(
                            "active",
                            active
                        );


                    option
                        .setAttribute(
                            "aria-selected",
                            String(
                                active
                            )
                        );

                }
            );


            updateAccessUI();

        };


    /* =====================================================
       SELECT MODEL
       ===================================================== */

    const selectModel =
        (
            modelId,
            options = {}
        ) => {

            const model =
                getModel(
                    modelId
                );


            if (!model) {
                return false;
            }


            /*
            FREE USER → PRO MODEL
            */

            if (
                !canUseModel(
                    modelId
                )
            ) {

                closeMenu();


                emit(
                    "neyo:model-upgrade-required",
                    {
                        model:
                            modelId,

                        modelInfo:
                            model
                    }
                );


                return false;

            }


            /*
            SELECT
            */

            selectedModel =
                modelId;


            updateModelUI(
                selectedModel
            );


            closeMenu();


            if (
                options.silent !==
                true
            ) {

                emit(
                    "neyo:model-change",
                    {
                        model:
                            selectedModel,

                        modelInfo:
                            model
                    }
                );

            }


            return true;

        };


    /* =====================================================
       USER PLAN
       ===================================================== */

    const setUserPlan =
        plan => {

            userPlan =
                normalizePlan(
                    plan
                );


            updateAccessUI();


            /*
            If plan drops from Pro → Free
            while L1.2 is selected,
            safely switch back to L1.0.
            */

            if (
                !canUseModel(
                    selectedModel
                )
            ) {

                selectedModel =
                    "l1.0";


                updateModelUI(
                    selectedModel
                );


                emit(
                    "neyo:model-change",
                    {
                        model:
                            selectedModel,

                        modelInfo:
                            getModel(
                                selectedModel
                            ),

                        reason:
                            "plan-access-changed"
                    }
                );

            }


            emit(
                "neyo:model-plan-change",
                {
                    plan:
                        userPlan
                }
            );

        };


    /* =====================================================
       LEGACY NEO.JS CONFLICT BLOCKER

       IMPORTANT:
       Capture phase executes before old bubble listeners.
       stopImmediatePropagation prevents neo.js from
       toggling the same menu again.
       ===================================================== */

    modelBadgeBtn.addEventListener(
        "click",
        event => {

            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation();


            toggleMenu();

        },
        true
    );


    /* =====================================================
       MODEL OPTION CLICKS
       ===================================================== */

    modelOptions.forEach(
        option => {

            option.addEventListener(
                "click",
                event => {

                    /*
                    Prevent legacy neo.js
                    option listeners.
                    */

                    event.preventDefault();

                    event.stopPropagation();

                    event.stopImmediatePropagation();


                    const modelId =
                        option
                            .dataset
                            .model;


                    if (!modelId) {
                        return;
                    }


                    selectModel(
                        modelId
                    );

                },
                true
            );

        }
    );


    /* =====================================================
       OUTSIDE CLICK
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            const clickedButton =
                modelBadgeBtn
                    .contains(
                        event.target
                    );


            const clickedMenu =
                modelDropdownMenu
                    .contains(
                        event.target
                    );


            if (
                !clickedButton &&
                !clickedMenu
            ) {

                closeMenu();

            }

        },
        true
    );


    /* =====================================================
       ESCAPE KEY
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key !==
                    "Escape" ||
                !isMenuOpen()
            ) {
                return;
            }


            event.stopPropagation();


            closeMenu();


            modelBadgeBtn
                .focus();

        },
        true
    );


    /* =====================================================
       PLAN EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:model-plan-set",
        event => {

            setUserPlan(
                event
                    .detail
                    ?.plan
            );

        }
    );


    /*
    Extra fallback:
    profile.js also emits profile-loaded.
    This protects against event-order/race issues.
    */

    window.addEventListener(
        "neyo:profile-loaded",
        event => {

            const plan =
                event
                    .detail
                    ?.user
                    ?.planType;


            if (plan) {

                setUserPlan(
                    plan
                );

            }

        }
    );


    /* =====================================================
       EXTERNAL MODEL SELECT
       ===================================================== */

    window.addEventListener(
        "neyo:model-select-request",
        event => {

            selectModel(
                event
                    .detail
                    ?.model
            );

        }
    );


    window.addEventListener(
        "neyo:model-menu-open-request",
        () => {

            openMenu();

        }
    );


    window.addEventListener(
        "neyo:model-menu-close-request",
        () => {

            closeMenu();

        }
    );


    /* =====================================================
       INITIAL MODEL
       ===================================================== */

    const initialActive =
        modelOptions.find(
            option =>
                option
                    .classList
                    .contains(
                        "active"
                    )
        );


    if (
        initialActive
            ?.dataset
            ?.model &&
        MODELS[
            initialActive
                .dataset
                .model
        ]
    ) {

        selectedModel =
            initialActive
                .dataset
                .model;

    }


    updateModelUI(
        selectedModel
    );


    modelBadgeBtn
        .setAttribute(
            "aria-expanded",
            "false"
        );


    /* =====================================================
       PROFILE FALLBACK

       If profile.js happened to load before this component,
       read its current plan directly.
       ===================================================== */

    const syncExistingProfilePlan =
        () => {

            const profileUser =
                window.NeyoProfile
                    ?.getUser?.();


            if (
                profileUser
                    ?.planType
            ) {

                setUserPlan(
                    profileUser
                        .planType
                );

            }

        };


    /*
    Run immediately and once shortly after boot.
    */

    syncExistingProfilePlan();


    setTimeout(
        syncExistingProfilePlan,
        250
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoModelMenu =
        Object.freeze({

            open:
                openMenu,

            close:
                closeMenu,

            toggle:
                toggleMenu,

            select:
                selectModel,

            getSelected:
                () =>
                    selectedModel,

            getModel:
                modelId =>
                    getModel(
                        modelId
                    ),

            setUserPlan,

            getUserPlan:
                () =>
                    userPlan,

            canUse:
                canUseModel,

            refreshAccess:
                updateAccessUI

        });

})();
