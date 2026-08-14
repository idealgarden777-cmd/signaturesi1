/*
=========================================================
NEYO — MODEL MENU COMPONENT
STABLE REPAIR VERSION

Owns:
- Model dropdown open / close
- Model selection
- Active model UI
- Current model display
- Pro access state
- Legacy neo.js conflict protection
- Public model events / API

Does NOT own:
- Checkout
- Subscription fetching
- Chat API
- Usage limits
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
       MODEL CONFIG
       ===================================================== */

    const MODELS =
        Object.freeze({

            "l1.0": {
                id:
                    "l1.0",

                label:
                    "NEYO L1.0",

                plan:
                    "free"
            },

            "l1.2": {
                id:
                    "l1.2",

                label:
                    "NEYO L1.2 Pro",

                plan:
                    "pro"
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
       MENU
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
       ACCESS UI
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


                    option.classList.toggle(
                        "locked",
                        isProModel &&
                        !unlocked
                    );


                    option.classList.toggle(
                        "is-unlocked",
                        isProModel &&
                        unlocked
                    );


                    if (
                        isProModel
                    ) {

                        option.setAttribute(
                            "aria-disabled",
                            String(
                                !unlocked
                            )
                        );

                    } else {

                        option.removeAttribute(
                            "aria-disabled"
                        );

                    }

                }
            );

        };


    /* =====================================================
       MODEL UI
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


                    option.classList.toggle(
                        "active",
                        active
                    );


                    option.setAttribute(
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
       MODEL SELECT
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
            FREE USER ATTEMPTS PRO MODEL
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
            SUCCESSFUL SELECT
            */

            selectedModel =
                modelId;


            updateModelUI(
                selectedModel
            );


            closeMenu();


            /*
            Persist selected model for
            components that load later.
            */

            try {

                sessionStorage.setItem(
                    "neyo_selected_model",
                    selectedModel
                );

            } catch {
                // Ignore storage failures.
            }


            if (
                options.silent !== true
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
       PLAN
       ===================================================== */

    const setUserPlan =
        plan => {

            userPlan =
                normalizePlan(
                    plan
                );


            updateAccessUI();


            /*
            If user becomes Free while
            Pro model is selected,
            fall back safely.
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


                try {

                    sessionStorage.setItem(
                        "neyo_selected_model",
                        selectedModel
                    );

                } catch {
                    // Ignore.
                }


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
       LEGACY NEO.JS CONFLICT PROTECTION
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


    modelOptions.forEach(
        option => {

            option.addEventListener(
                "click",
                event => {

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

            if (
                modelBadgeBtn.contains(
                    event.target
                )
            ) {
                return;
            }


            if (
                modelDropdownMenu.contains(
                    event.target
                )
            ) {
                return;
            }


            closeMenu();

        },
        true
    );


    /* =====================================================
       ESCAPE
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key !== "Escape" ||
                !isMenuOpen()
            ) {
                return;
            }


            closeMenu();


            modelBadgeBtn.focus();

        },
        true
    );


    /* =====================================================
       PROFILE / PLAN EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:model-plan-set",
        event => {

            setUserPlan(
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

                setUserPlan(
                    plan
                );

            }

        }
    );


    /* =====================================================
       EXTERNAL EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:model-select-request",
        event => {

            selectModel(
                event.detail?.model
            );

        }
    );


    window.addEventListener(
        "neyo:model-menu-open-request",
        openMenu
    );


    window.addEventListener(
        "neyo:model-menu-close-request",
        closeMenu
    );


    /* =====================================================
       INITIAL MODEL
       ===================================================== */

    const initialActive =
        modelOptions.find(
            option =>
                option.classList.contains(
                    "active"
                )
        );


    if (
        initialActive
            ?.dataset
            ?.model &&
        MODELS[
            initialActive.dataset.model
        ]
    ) {

        selectedModel =
            initialActive.dataset.model;

    }


    /*
    Restore previous session model.
    Only restore if access is allowed
    after plan sync.
    */

    let storedModel =
        null;


    try {

        storedModel =
            sessionStorage.getItem(
                "neyo_selected_model"
            );

    } catch {
        storedModel = null;
    }


    if (
        storedModel &&
        MODELS[storedModel]
    ) {

        selectedModel =
            storedModel;

    }


    updateModelUI(
        selectedModel
    );


    modelBadgeBtn.setAttribute(
        "aria-expanded",
        "false"
    );


    /* =====================================================
       PROFILE FALLBACK
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
                    profileUser.planType
                );

            }

        };


    /*
    profile.js loads immediately after
    model-menu.js, so check now and
    again after boot.
    */

    syncExistingProfilePlan();


    setTimeout(
        syncExistingProfilePlan,
        100
    );


    setTimeout(
        syncExistingProfilePlan,
        500
    );


    /* =====================================================
       FINAL ACCESS CHECK AFTER PLAN LOAD
       ===================================================== */

    window.addEventListener(
        "neyo:model-plan-change",
        () => {

            /*
            Restore stored Pro model only
            after Pro entitlement is known.
            */

            let stored =
                null;


            try {

                stored =
                    sessionStorage.getItem(
                        "neyo_selected_model"
                    );

            } catch {
                stored = null;
            }


            if (
                stored &&
                MODELS[stored] &&
                canUseModel(stored) &&
                selectedModel !== stored
            ) {

                selectModel(
                    stored,
                    {
                        silent:
                            true
                    }
                );

            }

        }
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
