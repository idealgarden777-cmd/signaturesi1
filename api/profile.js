/*
=========================================================
NEYO — PROFILE COMPONENT

Owns:
- Load current user profile from /api/profile
- Update username
- Update display name
- Update avatar
- Update Free / Pro plan badge
- Refresh after checkout/webhook related events

Does NOT own:
- Authentication
- Checkout creation
- Webhooks
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG = Object.freeze({
        endpoint: "/api/profile"
    });


    /* =====================================================
       STATE
       ===================================================== */

    let loading = false;
    let currentProfile = null;


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const getUserNameDisplay = () =>
        document.getElementById(
            "userNameDisplay"
        );


    const getUserPlanBadge = () =>
        document.getElementById(
            "userPlanBadge"
        );


    const getUserAvatar = () =>
        document.getElementById(
            "userAvatar"
        );


    const getSettingsAvatarPreview = () =>
        document.getElementById(
            "settingsAvatarPreview"
        );


    const getSettingsDisplayNameInput = () =>
        document.getElementById(
            "settingsDisplayNameInput"
        );


    const getSettingsUsernameInput = () =>
        document.getElementById(
            "settingsUsernameInput"
        );


    const getBillingPlanText = () =>
        document.getElementById(
            "billingPlanText"
        );


    const getSettingsUpgradeButton = () =>
        document.getElementById(
            "settingsUpgradeBtn"
        );


    /* =====================================================
       HELPERS
       ===================================================== */

    const normalizePlan = value => {

        const plan =
            String(
                value || "free"
            )
                .trim()
                .toLowerCase();


        return plan === "pro"
            ? "pro"
            : "free";

    };


    const normalizeUsername = value => {

        const username =
            String(
                value || ""
            ).trim();


        if (!username) {
            return "@user";
        }


        return username.startsWith("@")
            ? username
            : `@${username}`;

    };


    const getInitial = value => {

        const text =
            String(
                value || "U"
            ).trim();


        return (
            text.charAt(0) || "U"
        ).toUpperCase();

    };


    /* =====================================================
       AVATAR
       ===================================================== */

    const renderAvatar = (
        element,
        {
            avatarUrl,
            fallbackText
        }
    ) => {

        if (!element) {
            return;
        }


        element.innerHTML = "";


        if (avatarUrl) {

            const image =
                document.createElement(
                    "img"
                );


            image.src =
                avatarUrl;


            image.alt =
                "Profile";


            image.loading =
                "lazy";


            image.decoding =
                "async";


            image.style.width =
                "100%";


            image.style.height =
                "100%";


            image.style.objectFit =
                "cover";


            image.style.borderRadius =
                "inherit";


            image.addEventListener(
                "error",
                () => {

                    element.innerHTML = "";

                    element.textContent =
                        getInitial(
                            fallbackText
                        );

                },
                {
                    once: true
                }
            );


            element.appendChild(
                image
            );


            return;

        }


        element.textContent =
            getInitial(
                fallbackText
            );

    };


    /* =====================================================
       PLAN UI
       ===================================================== */

    const renderPlan = planValue => {

        const plan =
            normalizePlan(
                planValue
            );


        const badge =
            getUserPlanBadge();


        const billingText =
            getBillingPlanText();


        const upgradeButton =
            getSettingsUpgradeButton();


        if (badge) {

            badge.textContent =
                plan === "pro"
                    ? "Pro Plan"
                    : "Free Plan";


            badge.dataset.plan =
                plan;


            badge.classList.toggle(
                "is-pro",
                plan === "pro"
            );

        }


        if (billingText) {

            billingText.textContent =
                plan === "pro"
                    ? "NEYO Pro"
                    : "Free Plan";

        }


        if (upgradeButton) {

            if (
                plan === "pro"
            ) {

                upgradeButton.textContent =
                    "Pro Active";


                upgradeButton.disabled =
                    true;


                upgradeButton.setAttribute(
                    "aria-disabled",
                    "true"
                );

            } else {

                upgradeButton.textContent =
                    "Upgrade";


                upgradeButton.disabled =
                    false;


                upgradeButton.removeAttribute(
                    "aria-disabled"
                );

            }

        }


        document.documentElement
            .dataset.plan =
            plan;


        window.dispatchEvent(
            new CustomEvent(
                "neyo:plan-change",
                {
                    detail: {
                        plan
                    }
                }
            )
        );

    };


    /* =====================================================
       PROFILE UI
       ===================================================== */

    const renderProfile = data => {

        const user =
            data?.user || {};


        const profile =
            data?.profile || {};


        const username =
            normalizeUsername(
                user.username
            );


        const displayName =
            String(
                profile.displayName ||
                user.displayName ||
                user.username ||
                "User"
            ).trim();


        const avatarUrl =
            profile.avatarUrl ||
            null;


        const planType =
            normalizePlan(
                user.planType
            );


        const userNameDisplay =
            getUserNameDisplay();


        if (userNameDisplay) {

            userNameDisplay.textContent =
                username;

        }


        renderAvatar(
            getUserAvatar(),
            {
                avatarUrl,
                fallbackText:
                    displayName ||
                    username
            }
        );


        renderAvatar(
            getSettingsAvatarPreview(),
            {
                avatarUrl,
                fallbackText:
                    displayName ||
                    username
            }
        );


        const displayNameInput =
            getSettingsDisplayNameInput();


        if (displayNameInput) {

            displayNameInput.value =
                displayName;

        }


        const usernameInput =
            getSettingsUsernameInput();


        if (usernameInput) {

            usernameInput.value =
                username;

        }


        renderPlan(
            planType
        );


        currentProfile = {
            user: {
                ...user,
                planType
            },

            profile: {
                ...profile,
                displayName,
                avatarUrl
            }
        };


        window.dispatchEvent(
            new CustomEvent(
                "neyo:profile-loaded",
                {
                    detail:
                        currentProfile
                }
            )
        );

    };


    /* =====================================================
       LOAD PROFILE
       ===================================================== */

    const loadProfile =
        async () => {

            if (loading) {
                return currentProfile;
            }


            loading = true;


            try {

                const response =
                    await fetch(
                        CONFIG.endpoint,
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


                const data =
                    await response
                        .json()
                        .catch(
                            () => ({})
                        );


                if (
                    response.status ===
                    401
                ) {

                    console.warn(
                        "[NEYO Profile] User is not authenticated."
                    );


                    return null;

                }


                if (!response.ok) {

                    throw new Error(
                        data?.error ||
                        "Unable to load profile."
                    );

                }


                renderProfile(
                    data
                );


                return currentProfile;

            } catch (error) {

                console.error(
                    "[NEYO Profile] Load failed:",
                    error
                );


                return null;

            } finally {

                loading = false;

            }

        };


    /* =====================================================
       REFRESH EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:profile-refresh",
        () => {

            loadProfile();

        }
    );


    window.addEventListener(
        "neyo:checkout-return-success",
        () => {

            /*
            Webhook may need a moment to
            update the database.
            */

            setTimeout(
                loadProfile,
                1200
            );


            setTimeout(
                loadProfile,
                3000
            );

        }
    );


    window.addEventListener(
        "focus",
        () => {

            /*
            Useful when user returns
            from Lemon Squeezy tab/page.
            */

            loadProfile();

        }
    );


    document.addEventListener(
        "visibilitychange",
        () => {

            if (
                document.visibilityState ===
                "visible"
            ) {

                loadProfile();

            }

        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoProfile =
        Object.freeze({

            load:
                loadProfile,

            refresh:
                loadProfile,

            getCurrent:
                () =>
                    currentProfile,

            getPlan:
                () =>
                    normalizePlan(
                        currentProfile
                            ?.user
                            ?.planType
                    )

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
            loadProfile,
            {
                once: true
            }
        );

    } else {

        loadProfile();

    }

})();
