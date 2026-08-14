/*
=========================================================
NEYO — MODEL MENU COMPONENT
STABLE + UPGRADE MODAL RESTORE

Owns:
- Model dropdown open / close
- Model selection
- Active model UI
- Current model display
- Pro access state
- Upgrade modal trigger for Free users
- Legacy neo.js click-conflict protection
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

    const upgradeModal =
        document.getElementById(
            "upgradeModal"
        );

    const modalCloseBtn =
        document.getElementById(
            "modalCloseBtn"
        );

    const modalMaybeLaterBtn =
        document.getElementById(
            "modalMaybeLaterBtn"
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
       MODEL MENU
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
       UPGRADE MODAL
       ===================================================== */

    const openUpgradeModal =
        modelId => {

            if (!upgradeModal) {
                return;
            }


            closeMenu();


            upgradeModal
                .classList
                .add(
                    "show"
                );


            upgradeModal
                .setAttribute(
                    "aria-hidden",
                    "false"
                );


            document.body
                .classList
                .add(
                    "modal-open"
                );


            emit(
                "neyo:model-upgrade-required",
                {
                    model:
                        modelId,

                    modelInfo:
                        getModel(
                            modelId
                        )
                }
            );

        };


    const closeUpgradeModal =
        () => {

            if (!upgradeModal) {
                return;
            }


            upgradeModal
                .classList
                .remove(
                    "show"
                );


            upgradeModal
                .classList
                .remove(
                    "active"
                );


            upgradeModal
                .setAttribute(
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
                        option.dataset.model ===
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
            Restore original upgrade card.
            */

            if (
                !canUseModel(
                    modelId
                )
            ) {

                openUpgradeModal(
                    modelId
                );


                return false;

            }


            /*
            SUCCESSFUL MODEL SELECT
            */

            selectedModel =
                modelId;


            updateModelUI(
                selectedModel
            );


            closeMenu();


            try {

                sessionStorage.setItem(
                    "neyo_selected_model",
                    selectedModel
                );

            } catch {
                // Ignore storage failure.
            }


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
            If Pro expires while
            L1.2 is selected,
            safely fall back.
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
       MODAL CLOSE EVENTS
       ===================================================== */

    modalCloseBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();
                event.stopPropagation();


                closeUpgradeModal();

            },
            true
        );


    modalMaybeLaterBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();
                event.stopPropagation();


                closeUpgradeModal();

            },
            true
        );


    upgradeModal
        ?.addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    upgradeModal
                ) {

                    closeUpgradeModal();

                }

            },
            true
        );


    /* =====================================================
       OUTSIDE MODEL MENU CLICK
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
                event.key !==
                "Escape"
            ) {
                return;
            }


            if (
                upgradeModal &&
                upgradeModal.getAttribute(
                    "aria-hidden"
                ) === "false"
            ) {

                closeUpgradeModal();

                return;

            }


            if (
                isMenuOpen()
            ) {

                closeMenu();

                modelBadgeBtn.focus();

            }

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
            initialActive.dataset.model
        ]
    ) {

        selectedModel =
            initialActive.dataset.model;

    }


    updateModelUI(
        selectedModel
    );


    modelBadgeBtn
        .setAttribute(
            "aria-expanded",
            "false"
        );


    if (
        upgradeModal &&
        !upgradeModal.hasAttribute(
            "aria-hidden"
        )
    ) {

        upgradeModal
            .setAttribute(
                "aria-hidden",
                "true"
            );

    }


    /* =====================================================
       PROFILE PLAN FALLBACK
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
                updateAccessUI,

            openUpgrade:
                openUpgradeModal,

            closeUpgrade:
                closeUpgradeModal

        });

})();
