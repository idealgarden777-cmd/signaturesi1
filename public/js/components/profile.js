/*
=========================================================
NEYO — PROFILE COMPONENT
STABLE REPAIR VERSION

Owns:
- Load current profile
- Update sidebar profile UI
- Free / Leverage badge
- Billing plan UI
- Avatar prepare/upload/save
- Avatar removal
- Profile state
- Public profile events / API

Does NOT own:
- Authentication/session creation
- Logout
- Checkout
- Webhooks
- Model menu UI
- Settings modal layout
- Supabase client creation
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const PROFILE_ENDPOINT =
        "/api/profile";

    const AVATAR_ENDPOINT =
        "/api/profile/avatar";

    const MAX_AVATAR_SIZE =
        5 * 1024 * 1024;

    const ALLOWED_AVATAR_TYPES =
        new Set([
            "image/jpeg",
            "image/png",
            "image/webp"
        ]);


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const userAvatar =
        document.getElementById(
            "userAvatar"
        );

    const userNameDisplay =
        document.getElementById(
            "userNameDisplay"
        );

    const userPlanBadge =
        document.getElementById(
            "userPlanBadge"
        );

    const billingPlanText =
        document.getElementById(
            "billingPlanText"
        );

    const settingsUpgradeBtn =
        document.getElementById(
            "settingsUpgradeBtn"
        );


    /* =====================================================
       STATE
       ===================================================== */

    let profileState = {
        user: null,
        profile: null
    };

    let supabaseClient =
        null;

    let loading =
        false;

    let avatarUploading =
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


    const readJson =
        async response => {

            const data =
                await response
                    .json()
                    .catch(
                        () => ({})
                    );


            if (!response.ok) {

                const error =
                    new Error(
                        data?.error ||
                        `Request failed (${response.status})`
                    );


                error.status =
                    response.status;

                error.data =
                    data;


                throw error;

            }


            return data;

        };


    const getInitial =
        value => {

            const text =
                String(
                    value || "U"
                )
                    .trim();


            return (
                text
                    .charAt(0)
                    .toUpperCase() ||
                "U"
            );

        };


    const normalizePlan =
        value => {

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


    /* =====================================================
       SUPABASE CLIENT
       ===================================================== */

    const setSupabaseClient =
        client => {

            if (
                !client ||
                typeof client !==
                    "object"
            ) {
                return false;
            }


            supabaseClient =
                client;


            emit(
                "neyo:profile-client-ready"
            );


            return true;

        };


    /* =====================================================
       AVATAR UI
       ===================================================== */

    const renderAvatar =
        (
            avatarUrl,
            fallbackName
        ) => {

            if (!userAvatar) {
                return;
            }


            userAvatar
                .replaceChildren();


            if (avatarUrl) {

                const image =
                    document.createElement(
                        "img"
                    );


                image.src =
                    avatarUrl;


                image.alt =
                    fallbackName
                        ? `${fallbackName} profile photo`
                        : "Profile photo";


                image.loading =
                    "lazy";


                image.decoding =
                    "async";


                image.addEventListener(
                    "error",
                    () => {

                        userAvatar
                            .replaceChildren();


                        userAvatar
                            .classList
                            .remove(
                                "has-avatar"
                            );


                        userAvatar.textContent =
                            getInitial(
                                fallbackName
                            );

                    },
                    {
                        once: true
                    }
                );


                userAvatar
                    .appendChild(
                        image
                    );


                userAvatar
                    .classList
                    .add(
                        "has-avatar"
                    );


                return;

            }


            userAvatar
                .classList
                .remove(
                    "has-avatar"
                );


            userAvatar.textContent =
                getInitial(
                    fallbackName
                );

        };


    /* =====================================================
       PLAN UI
       ===================================================== */

    const renderPlan =
        planValue => {

            const plan =
                normalizePlan(
                    planValue
                );


            if (userPlanBadge) {

                userPlanBadge.textContent =
                    plan === "pro"
                        ? "Leverage"
                        : "Free Plan";


                userPlanBadge.dataset.plan =
                    plan;

            }


            if (billingPlanText) {

                billingPlanText.textContent =
                    plan === "pro"
                        ? "NEYO Leverage"
                        : "Free Plan";

            }


            if (settingsUpgradeBtn) {

                if (
                    plan === "pro"
                ) {

                    settingsUpgradeBtn.textContent =
                        "Leverage Active";

                    settingsUpgradeBtn.disabled =
                        true;

                    settingsUpgradeBtn.setAttribute(
                        "aria-disabled",
                        "true"
                    );

                } else {

                    settingsUpgradeBtn.textContent =
                        "Upgrade";

                    settingsUpgradeBtn.disabled =
                        false;

                    settingsUpgradeBtn.removeAttribute(
                        "aria-disabled"
                    );

                }

            }


            document.documentElement
                .dataset.plan =
                plan;

        };


    /* =====================================================
       RENDER PROFILE
       ===================================================== */

    const renderProfile =
        () => {

            const user =
                profileState.user ||
                {};

            const profile =
                profileState.profile ||
                {};


            const displayName =
                profile.displayName ||
                user.displayName ||
                user.username ||
                "User";


            if (userNameDisplay) {

                userNameDisplay.textContent =
                    user.username
                        ? `@${user.username}`
                        : displayName;

            }


            renderPlan(
                user.planType
            );


            renderAvatar(
                profile.avatarUrl,
                displayName
            );


            emit(
                "neyo:profile-rendered",
                {
                    user:
                        profileState.user,

                    profile:
                        profileState.profile
                }
            );

        };


    /* =====================================================
       LOAD PROFILE
       ===================================================== */

    const loadProfile =
        async () => {

            if (loading) {
                return profileState;
            }


            loading =
                true;


            emit(
                "neyo:profile-load-start"
            );


            try {

                const response =
                    await fetch(
                        PROFILE_ENDPOINT,
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
                    await readJson(
                        response
                    );


                profileState = {

                    user:
                        data?.user ||
                        null,

                    profile:
                        data?.profile ||
                        null

                };


                renderProfile();


                /*
                Send real account plan to
                model/access components.
                */

                if (
                    profileState
                        .user
                        ?.planType
                ) {

                    emit(
                        "neyo:model-plan-set",
                        {
                            plan:
                                normalizePlan(
                                    profileState
                                        .user
                                        .planType
                                )
                        }
                    );

                }


                emit(
                    "neyo:profile-loaded",
                    {
                        user:
                            profileState.user,

                        profile:
                            profileState.profile
                    }
                );


                return {
                    ...profileState
                };

            } catch (error) {

                emit(
                    "neyo:profile-error",
                    {
                        error
                    }
                );


                console.error(
                    "[NEYO Profile] Load failed:",
                    error
                );


                return null;

            } finally {

                loading =
                    false;

            }

        };


    /* =====================================================
       VALIDATE AVATAR
       ===================================================== */

    const validateAvatar =
        file => {

            if (
                !(file instanceof File)
            ) {

                throw new Error(
                    "Invalid profile photo."
                );

            }


            if (
                !ALLOWED_AVATAR_TYPES
                    .has(
                        file.type
                    )
            ) {

                throw new Error(
                    "Only JPG, PNG or WebP images are allowed."
                );

            }


            if (
                file.size <= 0 ||
                file.size >
                    MAX_AVATAR_SIZE
            ) {

                throw new Error(
                    "Profile photo must be under 5 MB."
                );

            }


            return true;

        };


    /* =====================================================
       PREPARE AVATAR UPLOAD
       ===================================================== */

    const prepareAvatarUpload =
        async file => {

            validateAvatar(
                file
            );


            const response =
                await fetch(
                    AVATAR_ENDPOINT,
                    {
                        method:
                            "POST",

                        credentials:
                            "include",

                        cache:
                            "no-store",

                        headers: {
                            "Content-Type":
                                "application/json",

                            Accept:
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                action:
                                    "prepare",

                                filename:
                                    file.name,

                                mimeType:
                                    file.type,

                                size:
                                    file.size
                            })
                    }
                );


            const data =
                await readJson(
                    response
                );


            if (
                !data?.upload?.bucket ||
                !data?.upload?.path ||
                !data?.upload?.token
            ) {

                throw new Error(
                    "Avatar upload information was not returned."
                );

            }


            return data.upload;

        };


    /* =====================================================
       SAVE AVATAR
       ===================================================== */

    const saveAvatar =
        async path => {

            const response =
                await fetch(
                    AVATAR_ENDPOINT,
                    {
                        method:
                            "POST",

                        credentials:
                            "include",

                        cache:
                            "no-store",

                        headers: {
                            "Content-Type":
                                "application/json",

                            Accept:
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                action:
                                    "save",

                                path
                            })
                    }
                );


            return readJson(
                response
            );

        };


    /* =====================================================
       UPLOAD AVATAR
       ===================================================== */

    const uploadAvatar =
        async file => {

            if (avatarUploading) {
                return null;
            }


            validateAvatar(
                file
            );


            if (!supabaseClient) {

                throw new Error(
                    "Profile upload service is not ready."
                );

            }


            avatarUploading =
                true;


            emit(
                "neyo:avatar-upload-start",
                {
                    file
                }
            );


            try {

                const upload =
                    await prepareAvatarUpload(
                        file
                    );


                const {
                    error
                } =
                    await supabaseClient
                        .storage
                        .from(
                            upload.bucket
                        )
                        .uploadToSignedUrl(
                            upload.path,
                            upload.token,
                            file,
                            {
                                contentType:
                                    file.type
                            }
                        );


                if (error) {

                    throw new Error(
                        error.message ||
                        "Profile photo upload failed."
                    );

                }


                const saved =
                    await saveAvatar(
                        upload.path
                    );


                const avatarUrl =
                    saved?.avatarUrl ||
                    null;


                profileState = {
                    ...profileState,

                    profile: {
                        ...(
                            profileState
                                .profile ||
                            {}
                        ),

                        avatarUrl
                    }
                };


                renderProfile();


                emit(
                    "neyo:avatar-upload-success",
                    {
                        avatarUrl
                    }
                );


                return avatarUrl;

            } catch (error) {

                emit(
                    "neyo:avatar-upload-error",
                    {
                        error
                    }
                );


                window
                    .NeyoNotifications
                    ?.error?.(
                        error?.message ||
                        "Profile photo could not be updated."
                    );


                throw error;

            } finally {

                avatarUploading =
                    false;


                emit(
                    "neyo:avatar-upload-end"
                );

            }

        };


    /* =====================================================
       REMOVE AVATAR
       ===================================================== */

    const removeAvatar =
        async () => {

            const response =
                await fetch(
                    AVATAR_ENDPOINT,
                    {
                        method:
                            "DELETE",

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
                await readJson(
                    response
                );


            profileState = {
                ...profileState,

                profile: {
                    ...(
                        profileState
                            .profile ||
                        {}
                    ),

                    avatarUrl:
                        null
                }
            };


            renderProfile();


            emit(
                "neyo:avatar-removed"
            );


            return data;

        };


    /* =====================================================
       LOCAL PROFILE UPDATE
       ===================================================== */

    const setProfileState =
        data => {

            if (
                !data ||
                typeof data !==
                    "object"
            ) {
                return;
            }


            profileState = {

                user:
                    data.user ??
                    profileState.user,

                profile:
                    data.profile ??
                    profileState.profile

            };


            renderProfile();


            if (
                profileState
                    .user
                    ?.planType
            ) {

                emit(
                    "neyo:model-plan-set",
                    {
                        plan:
                            normalizePlan(
                                profileState
                                    .user
                                    .planType
                            )
                    }
                );

            }

        };


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:profile-client-set",
        event => {

            setSupabaseClient(
                event.detail?.client
            );

        }
    );


    window.addEventListener(
        "neyo:profile-load-request",
        () => {

            loadProfile();

        }
    );


    window.addEventListener(
        "neyo:profile-refresh",
        () => {

            loadProfile();

        }
    );


    window.addEventListener(
        "neyo:avatar-upload-request",
        event => {

            uploadAvatar(
                event.detail?.file
            )
                .catch(
                    error => {

                        console.error(
                            "Avatar upload failed:",
                            error
                        );

                    }
                );

        }
    );


    window.addEventListener(
        "neyo:avatar-remove-request",
        () => {

            removeAvatar()
                .catch(
                    error => {

                        window
                            .NeyoNotifications
                            ?.error?.(
                                error?.message ||
                                "Profile photo could not be removed."
                            );

                    }
                );

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

            render:
                renderProfile,

            uploadAvatar,

            removeAvatar,

            setSupabaseClient,

            setState:
                setProfileState,

            getUser:
                () => {

                    return profileState.user
                        ? {
                            ...profileState.user
                        }
                        : null;

                },

            getProfile:
                () => {

                    return profileState.profile
                        ? {
                            ...profileState.profile
                        }
                        : null;

                },

            getState:
                () => ({

                    user:
                        profileState.user
                            ? {
                                ...profileState.user
                            }
                            : null,

                    profile:
                        profileState.profile
                            ? {
                                ...profileState.profile
                            }
                            : null

                }),

            getPlan:
                () =>
                    normalizePlan(
                        profileState
                            ?.user
                            ?.planType
                    ),

            isLoading:
                () =>
                    loading,

            isAvatarUploading:
                () =>
                    avatarUploading

        });


    /* =====================================================
       INITIAL LOAD

       Original component did not reliably load itself.
       Now profile is fetched once when app boots.
       ===================================================== */

    const bootProfile =
        () => {

            loadProfile()
                .catch(
                    error => {

                        console.error(
                            "Initial profile load failed:",
                            error
                        );

                    }
                );

        };


    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            bootProfile,
            {
                once: true
            }
        );

    } else {

        bootProfile();

    }

})();
