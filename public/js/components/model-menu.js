/*
=========================================================
NEYO — MODEL MENU COMPONENT
v6 — NEYO + LEVERAGE

Owns:
- Model dropdown open / close
- Model selection
- Active model UI
- Current model display
- Plan access state
- Leverage intro trigger for Free users
- Existing upgrade modal compatibility
- Legacy neo.js click-conflict protection
- Public model events / API

Does NOT own:
- Leverage intro cards UI
- Checkout
- Subscription fetching
- Chat API
- Backend model routing
- Usage limits

IMPORTANT:
- Internal model IDs stay unchanged:
  l1.0 = NEYO
  l1.2 = Leverage

- Internal plan values stay unchanged:
  free
  pro

This preserves existing project compatibility.
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
                id:
                    "l1.0",

                label:
                    "NEYO",

                plan:
                    "free"
            },


            "l1.2": {
                id:
                    "l1.2",

                label:
                    "Leverage",

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

            const normalized =
                String(
                    value ||
                    "free"
                )
                    .trim()
                    .toLowerCase();


            /*
             * Keep old backend/account compatibility.
             *
             * Existing paid plan values still resolve to "pro".
             */

            if (
                [
                    "pro",
                    "neo_pro",
                    "neo-pro",
                    "premium",
                    "business",
                    "suite",
                    "leverage"
                ].includes(
                    normalized
                )
            ) {
                return "pro";
            }


            return "free";

        };


    const getModel =
        modelId => {

            return (
                MODELS[
                    modelId
                ] ||
                null
            );

        };


    const isProUser =
        () =>
            userPlan ===
            "pro";


    const isLeverageUser =
        () =>
            isProUser();


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
                model.plan ===
                    "pro" &&
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
       LEVERAGE INTRO
       ===================================================== */

    const requestLeverageIntro =
        modelId => {

            const model =
                getModel(
                    modelId
                );


            if (!model) {
                return false;
            }


            closeMenu();


            /*
             * Important:
             *
             * Free user clicking Leverage does NOT
             * directly open the old upgrade modal.
             *
             * leverage-intro.js will listen to this event
             * and show the introduction cards.
             */

            emit(
                "neyo:leverage-intro-request",
                {
                    model:
                        modelId,

                    modelInfo:
                        model,

                    plan:
                        userPlan
                }
            );


            return true;

        };


    /* =====================================================
       EXISTING UPGRADE MODAL
       ===================================================== */

    const openUpgradeModal =
        modelId => {

            if (!upgradeModal) {
                return false;
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


            /*
             * Preserve existing upgrade event.
             *
             * This will later be called from the final
             * Leverage introduction card.
             */

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


            return true;

        };


    const closeUpgradeModal =
        () => {

            if (!upgradeModal) {
                return false;
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


            return true;

        };


    /* =====================================================
       ACCESS UI
       ===================================================== */

    const updateAccessUI =
        () => {

            modelOptions
                .forEach(
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


                        const isPaidModel =
                            model.plan ===
                            "pro";


                        const unlocked =
                            canUseModel(
                                modelId
                            );


                        /*
                         * Keep old CSS classes.
                         * Do not rename these yet.
                         */

                        option
                            .classList
                            .toggle(
                                "locked",
                                isPaidModel &&
                                !unlocked
                            );


                        option
                            .classList
                            .toggle(
                                "is-unlocked",
                                isPaidModel &&
                                unlocked
                            );


                        /*
                         * Leverage remains clickable for Free users
                         * because clicking it opens the intro cards.
                         *
                         * aria-disabled is therefore NOT used to
                         * block interaction.
                         */

                        if (
                            isPaidModel &&
                            !unlocked
                        ) {

                            option
                                .setAttribute(
                                    "aria-label",
                                    "Learn about Leverage"
                                );

                        } else {

                            option
                                .removeAttribute(
                                    "aria-label"
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
                return false;
            }


            if (
                currentModelDisplay
            ) {

                currentModelDisplay
                    .textContent =
                        model.label;

            }


            modelOptions
                .forEach(
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


            return true;

        };


    /* =====================================================
       SAVE SELECTED MODEL
       ===================================================== */

    const saveSelectedModel =
        modelId => {

            try {

                sessionStorage
                    .setItem(
                        "neyo_selected_model",
                        modelId
                    );


                return true;

            } catch {

                return false;

            }

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


            /* -------------------------------------------------
               FREE USER → LEVERAGE
               ------------------------------------------------- */

            if (
                !canUseModel(
                    modelId
                )
            ) {

                /*
                 * Default new behavior:
                 * show Leverage introduction.
                 */

                if (
                    options.skipIntro !==
                    true
                ) {

                    requestLeverageIntro(
                        modelId
                    );


                    return false;

                }


                /*
                 * Compatibility escape hatch.
                 *
                 * Allows leverage-intro.js final action
                 * to explicitly open existing upgrade flow.
                 */

                openUpgradeModal(
                    modelId
                );


                return false;

            }


            /* -------------------------------------------------
               SUCCESSFUL MODEL SELECT
               ------------------------------------------------- */

            selectedModel =
                modelId;


            updateModelUI(
                selectedModel
            );


            closeMenu();


            saveSelectedModel(
                selectedModel
            );


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
             * If paid access disappears while
             * Leverage is selected,
             * fall back safely to NEYO.
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


                saveSelectedModel(
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
                        userPlan,

                    leverage:
                        isLeverageUser()
                }
            );


            return userPlan;

        };


    /* =====================================================
       LEGACY NEO.JS CONFLICT PROTECTION
       ===================================================== */

    modelBadgeBtn
        .addEventListener(
            "click",
            event => {

                event.preventDefault();

                event.stopPropagation();

                event.stopImmediatePropagation();


                toggleMenu();

            },
            true
        );


    modelOptions
        .forEach(
            option => {

                option
                    .addEventListener(
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

    document
        .addEventListener(
            "click",
            event => {

                if (
                    modelBadgeBtn
                        .contains(
                            event.target
                        )
                ) {
                    return;
                }


                if (
                    modelDropdownMenu
                        .contains(
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

    document
        .addEventListener(
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
                    upgradeModal
                        .getAttribute(
                            "aria-hidden"
                        ) ===
                        "false"
                ) {

                    closeUpgradeModal();

                    return;

                }


                if (
                    isMenuOpen()
                ) {

                    closeMenu();

                    modelBadgeBtn
                        .focus();

                }

            },
            true
        );


    /* =====================================================
       PROFILE / PLAN EVENTS
       ===================================================== */

    window
        .addEventListener(
            "neyo:model-plan-set",
            event => {

                setUserPlan(
                    event.detail
                        ?.plan
                );

            }
        );


    window
        .addEventListener(
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

    window
        .addEventListener(
            "neyo:model-select-request",
            event => {

                selectModel(
                    event.detail
                        ?.model,
                    event.detail
                        ?.options ||
                    {}
                );

            }
        );


    /* =====================================================
       EXTERNAL MENU EVENTS
       ===================================================== */

    window
        .addEventListener(
            "neyo:model-menu-open-request",
            openMenu
        );


    window
        .addEventListener(
            "neyo:model-menu-close-request",
            closeMenu
        );


    /* =====================================================
       LEVERAGE INTRO → UPGRADE
       ===================================================== */

    /*
     * leverage-intro.js can emit this when the
     * final intro card's upgrade button is clicked.
     */

    window
        .addEventListener(
            "neyo:leverage-upgrade-request",
            () => {

                openUpgradeModal(
                    "l1.2"
                );

            }
        );


    /* =====================================================
       INITIAL MODEL
       ===================================================== */

    const initialActive =
        modelOptions
            .find(
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


    /*
     * Restore session selection only when valid.
     *
     * Access will be checked again after profile loads.
     */

    try {

        const storedModel =
            sessionStorage
                .getItem(
                    "neyo_selected_model"
                );


        if (
            storedModel &&
            MODELS[
                storedModel
            ]
        ) {

            selectedModel =
                storedModel;

        }

    } catch {
        // Ignore storage failure.
    }


    /*
     * Before profile plan is known,
     * never allow an old paid selection
     * to visually activate for a Free session.
     */

    if (
        !canUseModel(
            selectedModel
        )
    ) {

        selectedModel =
            "l1.0";

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
        !upgradeModal
            .hasAttribute(
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
                    ?.getUser
                    ?.();


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


            isLeverageUser,


            canUse:
                canUseModel,


            refreshAccess:
                updateAccessUI,


            requestLeverageIntro,


            openUpgrade:
                openUpgradeModal,


            closeUpgrade:
                closeUpgradeModal

        });


    /* =====================================================
       READY EVENT
       ===================================================== */

    emit(
        "neyo:model-menu-ready",
        {
            model:
                selectedModel,

            modelInfo:
                getModel(
                    selectedModel
                ),

            plan:
                userPlan
        }
    );

})();
