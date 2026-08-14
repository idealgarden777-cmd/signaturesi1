/*
=========================================================
NEYO — MODEL MENU COMPONENT
Legacy-safe version

Owns:
- Model dropdown open / close
- Model selection
- Active model UI
- Current model display
- Free / Pro access
- Legacy neo.js click isolation
- Public model events / API

Does NOT own:
- Checkout
- Subscription fetching
- Chat API
- neo.js
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

    let menuOpen =
        false;


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
                .toLowerCase() ===
                "pro"
                ? "pro"
                : "free";

        };


    const getModel =
        modelId =>
            MODELS[
                modelId
            ] ||
            null;


    const isProUser =
        () =>
            userPlan ===
            "pro";


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


    /*
    IMPORTANT:
    Blocks old neo.js model click handlers
    without modifying neo.js.
    */

    const isolateLegacyClick =
        event => {

            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation();

        };


    /* =====================================================
       MENU STATE
       ===================================================== */

    const openMenu =
        () => {

            menuOpen =
                true;


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

            menuOpen =
                false;


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

            if (menuOpen) {

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
                        option.dataset.model;


                    const model =
                        getModel(
                            modelId
                        );


                    if (!model) {
                        return;
                    }


                    const isProModel =
                        model.plan ===
                        "pro";


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


                    option.dataset.locked =
                        isProModel &&
                        !unlocked
                            ? "true"
                            : "false";


                    if (isProModel) {

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
                        option.dataset.model ===
                        modelId;


                    option.classList.toggle(
                        "active",
                        active
                    );


                    option.setAttribute(
                        "aria-selected",
                        String(active)
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


            /* ---------------------------------------------
               PRO LOCK
               --------------------------------------------- */

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


            /* ---------------------------------------------
               SELECT
               --------------------------------------------- */

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
            If plan becomes Free while Pro
            model is currently selected,
            safely return to L1.0.
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
       MAIN MODEL BUTTON
       CAPTURE PHASE — BLOCKS NEO.JS
       ===================================================== */

    modelBadgeBtn.addEventListener(
        "click",
        event => {

            isolateLegacyClick(
                event
            );


            toggleMenu();

        },
        true
    );


    /* =====================================================
       MODEL OPTIONS
       CAPTURE PHASE — BLOCKS NEO.JS
       ===================================================== */

    modelOptions.forEach(
        option => {

            option.addEventListener(
                "click",
                event => {

                    isolateLegacyClick(
                        event
                    );


                    const modelId =
                        option.dataset.model;


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

            if (!menuOpen) {
                return;
            }


            const clickedButton =
                modelBadgeBtn.contains(
                    event.target
                );


            const clickedMenu =
                modelDropdownMenu.contains(
                    event.target
                );


            if (
                !clickedButton &&
                !clickedMenu
            ) {

                closeMenu();

            }

        }
    );


    /* =====================================================
       ESCAPE
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                    "Escape" &&
                menuOpen
            ) {

                closeMenu();


                modelBadgeBtn.focus();

            }

        }
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


    /*
    Extra safety:
    profile.js also emits plan-change.
    If model-plan-set is ever missed,
    this keeps model access synchronized.
    */

    window.addEventListener(
        "neyo:plan-change",
        event => {

            setUserPlan(
                event.detail?.plan
            );

        }
    );


    /* =====================================================
       PUBLIC MODEL EVENTS
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
                option.classList.contains(
                    "active"
                )
        );


    if (
        initialActive?.dataset.model &&
        MODELS[
            initialActive.dataset.model
        ]
    ) {

        selectedModel =
            initialActive.dataset.model;

    }


    updateModelUI(
        selectedModel
    );


    setUserPlan(
        userPlan
    );


    closeMenu();


    /* =====================================================
       PROFILE ALREADY LOADED FALLBACK
       ===================================================== */

    const syncExistingProfile =
        () => {

            const existingPlan =
                window.NeyoProfile
                    ?.getPlan?.();


            if (existingPlan) {

                setUserPlan(
                    existingPlan
                );

            }

        };


    /*
    profile.js normally loads after this file,
    but this fallback makes the component
    resilient to script-order changes.
    */

    queueMicrotask(
        syncExistingProfile
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

            setUserPlan,

            refreshAccess:
                updateAccessUI,

            getSelected:
                () =>
                    selectedModel,

            getUserPlan:
                () =>
                    userPlan,

            getModel:
                modelId =>
                    getModel(
                        modelId
                    ),

            canUse:
                modelId =>
                    canUseModel(
                        modelId
                    ),

            isOpen:
                () =>
                    menuOpen

        });

})();
