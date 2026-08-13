/*
=========================================================
NEYO — MODEL MENU COMPONENT

Owns:
- Model dropdown open / close
- Model selection
- Active model UI
- Current model display
- Pro model lock detection
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
        document.getElementById("modelBadgeBtn");

    const modelDropdownMenu =
        document.getElementById("modelDropdownMenu");

    const currentModelDisplay =
        document.getElementById("currentModelDisplay");

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

    const MODELS = Object.freeze({

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

    let selectedModel = "l1.0";

    let userPlan = "free";


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


    const getModel =
        modelId =>
            MODELS[modelId] ||
            null;


    const isProUser = () =>
        userPlan === "pro";


    const canUseModel =
        modelId => {

            const model =
                getModel(modelId);


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

    const openMenu = () => {

        modelDropdownMenu
            .classList
            .add("show");

        modelBadgeBtn.setAttribute(
            "aria-expanded",
            "true"
        );


        emit(
            "neyo:model-menu-open"
        );
    };


    const closeMenu = () => {

        modelDropdownMenu
            .classList
            .remove("show");

        modelBadgeBtn.setAttribute(
            "aria-expanded",
            "false"
        );


        emit(
            "neyo:model-menu-close"
        );
    };


    const toggleMenu = () => {

        if (
            modelDropdownMenu
                .classList
                .contains("show")
        ) {

            closeMenu();

        } else {

            openMenu();

        }
    };


    /* =====================================================
       UI UPDATE
       ===================================================== */

    const updateModelUI =
        modelId => {

            const model =
                getModel(modelId);


            if (!model) {
                return;
            }


            if (currentModelDisplay) {

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
                getModel(modelId);


            if (!model) {
                return false;
            }


            /* -----------------------------------------
               LOCKED PRO MODEL
               ----------------------------------------- */

            if (
                !canUseModel(modelId)
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


            /* -----------------------------------------
               SELECT
               ----------------------------------------- */

            selectedModel =
                modelId;


            updateModelUI(
                selectedModel
            );


            closeMenu();


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
       USER PLAN
       ===================================================== */

    const setUserPlan =
        plan => {

            userPlan =
                plan === "pro"
                    ? "pro"
                    : "free";


            emit(
                "neyo:model-plan-change",
                {
                    plan:
                        userPlan
                }
            );

        };


    /* =====================================================
       BUTTON
       ===================================================== */

    modelBadgeBtn.addEventListener(
        "click",
        event => {

            event.stopPropagation();

            toggleMenu();

        }
    );


    /* =====================================================
       MODEL OPTIONS
       ===================================================== */

    modelOptions.forEach(
        option => {

            option.addEventListener(
                "click",
                event => {

                    event.stopPropagation();


                    const modelId =
                        option.dataset.model;


                    if (!modelId) {
                        return;
                    }


                    selectModel(
                        modelId
                    );

                }
            );

        }
    );


    /* =====================================================
       CLICK OUTSIDE
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

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
                event.key === "Escape" &&
                modelDropdownMenu
                    .classList
                    .contains("show")
            ) {

                closeMenu();

                modelBadgeBtn.focus();

            }

        }
    );


    /* =====================================================
       PUBLIC EVENTS
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
        "neyo:model-plan-set",
        event => {

            setUserPlan(
                event.detail?.plan
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
       INITIAL STATE
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


    modelBadgeBtn.setAttribute(
        "aria-expanded",
        "false"
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
                    getModel(modelId),

            setUserPlan,

            getUserPlan:
                () =>
                    userPlan,

            canUse:
                canUseModel

        });

})();
