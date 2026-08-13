/*
=========================================================
NEYO — AUTH COMPONENT

Owns:
- Secure session restore
- Current user auth state
- Plan normalization
- Logout
- Login redirect
- Auth lifecycle events
- Public auth API

Does NOT own:
- Profile rendering
- Supabase client creation
- Settings UI
- Account menu UI
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const ACCOUNTS_ORIGIN =
        "https://accounts.signaturesi.com";

    const LOGIN_URL =
        `${ACCOUNTS_ORIGIN}/?mode=login`;

    const SESSION_ENDPOINT =
        `${ACCOUNTS_ORIGIN}/api/auth/session`;

    const LOGOUT_ENDPOINT =
        `${ACCOUNTS_ORIGIN}/api/auth/logout`;


    /* =====================================================
       STATE
       ===================================================== */

    let authenticated =
        false;

    let currentUser =
        null;

    let userPlan =
        "free";

    let restoringSession =
        null;

    let loggingOut =
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
        plan => {

            const value =
                String(
                    plan || "free"
                )
                    .trim()
                    .toLowerCase();


            const proPlans =
                new Set([
                    "pro",
                    "neo_pro",
                    "neo-pro",
                    "neyo_pro",
                    "neyo-pro",
                    "premium",
                    "business",
                    "suite"
                ]);


            return proPlans.has(
                value
            )
                ? "pro"
                : "free";

        };


    const clearLegacyUserStorage =
        () => {

            /*
            Only remove old auth/user cache values.

            Do NOT clear all localStorage because
            theme/preferences may live there.
            */

            const keys = [
                "neo_user",
                "neyo_user",
                "neo_session",
                "neyo_session",
                "neo_auth",
                "neyo_auth"
            ];


            keys.forEach(
                key => {

                    try {

                        localStorage
                            .removeItem(
                                key
                            );

                    }

                    catch {
                        // Storage unavailable.
                    }

                }
            );


            try {

                sessionStorage
                    .removeItem(
                        "neo_user"
                    );

                sessionStorage
                    .removeItem(
                        "neyo_user"
                    );

            }

            catch {
                // Storage unavailable.
            }

        };


    const redirectToLogin =
        () => {

            window.location.replace(
                LOGIN_URL
            );

        };


    /* =====================================================
       SET AUTH STATE
       ===================================================== */

    const setAuthenticatedUser =
        user => {

            if (
                !user ||
                typeof user !==
                    "object"
            ) {

                authenticated =
                    false;

                currentUser =
                    null;

                userPlan =
                    "free";


                return false;

            }


            userPlan =
                normalizePlan(
                    user.planType
                );


            currentUser = {

                id:
                    user.id ||
                    null,

                username:
                    user.username ||
                    "user",

                displayName:
                    user.displayName ||
                    user.username ||
                    "user",

                beanId:
                    user.beanId ||
                    null,

                email:
                    user.email ||
                    null,

                planType:
                    user.planType ||
                    "free",

                plan:
                    userPlan

            };


            authenticated =
                Boolean(
                    currentUser.id
                );


            return authenticated;

        };


    /* =====================================================
       SESSION REQUEST
       ===================================================== */

    const performSessionRestore =
        async (
            options = {}
        ) => {

            emit(
                "neyo:auth-check-start"
            );


            try {

                const response =
                    await fetch(
                        SESSION_ENDPOINT,
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
                    !response.ok ||
                    !data.authenticated ||
                    !data.user
                ) {

                    authenticated =
                        false;

                    currentUser =
                        null;

                    userPlan =
                        "free";


                    clearLegacyUserStorage();


                    emit(
                        "neyo:auth-required"
                    );


                    if (
                        options.redirect !==
                        false
                    ) {

                        redirectToLogin();

                    }


                    return false;

                }


                if (
                    !setAuthenticatedUser(
                        data.user
                    )
                ) {

                    if (
                        options.redirect !==
                        false
                    ) {

                        redirectToLogin();

                    }


                    return false;

                }


                /* -----------------------------------------
                   SHARE PLAN WITH OTHER MODULES
                   ----------------------------------------- */

                window.dispatchEvent(
                    new CustomEvent(
                        "neyo:model-plan-set",
                        {
                            detail: {
                                plan:
                                    userPlan
                            }
                        }
                    )
                );


                /* -----------------------------------------
                   PROFILE MODULE CAN REUSE USER
                   ----------------------------------------- */

                window.NeyoProfile
                    ?.setState?.({
                        user:
                            currentUser
                    });


                emit(
                    "neyo:auth-restored",
                    {
                        user: {
                            ...currentUser
                        },

                        plan:
                            userPlan
                    }
                );


                return true;

            }

            catch (error) {

                authenticated =
                    false;


                emit(
                    "neyo:auth-error",
                    {
                        error
                    }
                );


                /*
                Current legacy behavior redirects
                if secure session cannot be restored.
                */

                if (
                    options.redirect !==
                    false
                ) {

                    clearLegacyUserStorage();

                    redirectToLogin();

                }


                return false;

            }

            finally {

                emit(
                    "neyo:auth-check-end",
                    {
                        authenticated
                    }
                );

            }

        };


    /* =====================================================
       RESTORE SESSION
       ===================================================== */

    const restoreSession =
        async (
            options = {}
        ) => {

            /*
            Prevent multiple components from making
            duplicate session requests simultaneously.
            */

            if (restoringSession) {

                return restoringSession;

            }


            restoringSession =
                performSessionRestore(
                    options
                );


            try {

                return await restoringSession;

            }

            finally {

                restoringSession =
                    null;

            }

        };


    /* =====================================================
       LOGOUT
       ===================================================== */

    const logout =
        async () => {

            if (loggingOut) {
                return false;
            }


            loggingOut =
                true;


            emit(
                "neyo:logout-start"
            );


            try {

                /*
                Current legacy behavior does not block
                logout if server request fails.
                */

                await fetch(
                    LOGOUT_ENDPOINT,
                    {
                        method:
                            "POST",

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

            }

            catch (error) {

                console.warn(
                    "Server logout failed:",
                    error
                );


                emit(
                    "neyo:logout-server-error",
                    {
                        error
                    }
                );

            }

            finally {

                authenticated =
                    false;

                currentUser =
                    null;

                userPlan =
                    "free";


                clearLegacyUserStorage();


                /*
                This matches the current neo.js behavior.
                */

                try {

                    localStorage
                        .removeItem(
                            "neo_user_memories"
                        );

                }

                catch {
                    // Storage unavailable.
                }


                emit(
                    "neyo:logout-success"
                );


                loggingOut =
                    false;


                redirectToLogin();

            }


            return true;

        };


    /* =====================================================
       ACCOUNT MENU CONNECTION
       ===================================================== */

    window.addEventListener(
        "neyo:logout-request",
        () => {

            logout();

        }
    );


    /* =====================================================
       SESSION RESTORE REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:auth-restore-request",
        event => {

            restoreSession(
                event.detail ||
                {}
            );

        }
    );


    /* =====================================================
       LOGIN REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:login-request",
        redirectToLogin
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoAuth =
        Object.freeze({

            restore:
                restoreSession,

            logout,

            redirectToLogin,

            isAuthenticated:
                () =>
                    authenticated,

            isRestoring:
                () =>
                    Boolean(
                        restoringSession
                    ),

            isLoggingOut:
                () =>
                    loggingOut,

            getUser:
                () =>
                    currentUser
                        ? {
                            ...currentUser
                        }
                        : null,

            getPlan:
                () =>
                    userPlan,

            isPro:
                () =>
                    userPlan ===
                    "pro",

            getAccountsOrigin:
                () =>
                    ACCOUNTS_ORIGIN,

            getLoginUrl:
                () =>
                    LOGIN_URL

        });

})();
