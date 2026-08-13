/*
=========================================================
NEYO — APP INITIALIZER

Owns:
- Application startup sequence
- Shared Supabase client wiring
- Auth restore
- Profile load
- History load
- Initial responsive/theme sync
- Cross-module startup coordination
- App ready lifecycle

Does NOT own:
- Chat logic
- Upload logic
- Auth implementation
- Profile implementation
- UI rendering internals
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       STATE
       ===================================================== */

    let initialized =
        false;

    let initializingPromise =
        null;


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


    const safeCall =
        async (
            label,
            callback
        ) => {

            if (
                typeof callback !==
                "function"
            ) {
                return null;
            }


            try {

                return await callback();

            }

            catch (error) {

                console.warn(
                    `[NEYO INIT] ${label} failed:`,
                    error
                );


                emit(
                    "neyo:init-module-error",
                    {
                        module:
                            label,

                        error
                    }
                );


                return null;

            }

        };


    /* =====================================================
       SUPABASE CLIENT DISCOVERY
       ===================================================== */

    const getSharedSupabaseClient =
        () => {

            /*
            We intentionally do NOT create
            another Supabase client here.

            app-init.js only discovers the client
            already created by the application.
            */

            const candidates = [

                window.supabaseClient,

                window.neyoSupabase,

                window.NeyoSupabase,

                window.appSupabase

            ];


            for (
                const client of candidates
            ) {

                if (
                    client?.storage &&
                    typeof client ===
                        "object"
                ) {

                    return client;

                }

            }


            return null;

        };


    /* =====================================================
       WIRE SHARED SERVICES
       ===================================================== */

    const wireSharedServices =
        () => {

            const client =
                getSharedSupabaseClient();


            if (!client) {

                /*
                Not fatal at startup.

                Upload/profile avatar modules will simply
                remain unavailable until a client is supplied.
                */

                emit(
                    "neyo:supabase-client-missing"
                );


                return null;

            }


            window.NeyoUpload
                ?.setSupabaseClient?.(
                    client
                );


            window.NeyoProfile
                ?.setSupabaseClient?.(
                    client
                );


            emit(
                "neyo:supabase-client-wired",
                {
                    client
                }
            );


            return client;

        };


    /* =====================================================
       INITIAL UI STATE
       ===================================================== */

    const initializeUiState =
        async () => {

            window.NeyoResponsive
                ?.refresh?.();


            const theme =
                window.NeyoTheme
                    ?.getResolved?.();


            const themeMode =
                window.NeyoTheme
                    ?.getMode?.();


            if (
                theme &&
                window.NeyoState
            ) {

                window.NeyoState.patch(
                    "ui",
                    {
                        theme,

                        themeMode:
                            themeMode ||
                            "system",

                        device:
                            window.NeyoResponsive
                                ?.getDevice?.() ||
                            "desktop"
                    }
                );

            }


            window.NeyoSend
                ?.refresh?.();

        };


    /* =====================================================
       AUTH INITIALIZATION
       ===================================================== */

    const initializeAuth =
        async () => {

            if (
                !window.NeyoAuth
                    ?.restore
            ) {

                emit(
                    "neyo:init-auth-missing"
                );


                return false;

            }


            const authenticated =
                await window.NeyoAuth
                    .restore({
                        redirect:
                            true
                    });


            if (!authenticated) {

                return false;

            }


            return true;

        };


    /* =====================================================
       USER DATA
       ===================================================== */

    const initializeUserData =
        async () => {

            await safeCall(
                "profile",
                () =>
                    window.NeyoProfile
                        ?.load?.()
            );


            await safeCall(
                "history",
                () =>
                    window.NeyoHistory
                        ?.load?.()
            );

        };


    /* =====================================================
       CROSS MODULE CONNECTIONS
       ===================================================== */

    const connectModules =
        () => {

            /* -----------------------------------------
               CHAT → MESSAGES
               ----------------------------------------- */

            window.addEventListener(
                "neyo:chat-message-added",
                event => {

                    const message =
                        event.detail
                            ?.message;


                    if (!message) {
                        return;
                    }


                    const element =
                        window.NeyoMessages
                            ?.create?.({
                                role:
                                    message.role,

                                content:
                                    "",

                                index:
                                    (
                                        event.detail
                                            ?.conversation
                                            ?.length ||
                                        1
                                    ) - 1
                            });


                    if (!element) {
                        return;
                    }


                    window.NeyoMessageRenderer
                        ?.render?.(
                            element,
                            message.content,
                            {
                                role:
                                    message.role,

                                markdown:
                                    message.role ===
                                    "assistant"
                            }
                        );

                }
            );


            /* -----------------------------------------
               HISTORY → MESSAGE UI
               ----------------------------------------- */

            window.addEventListener(
                "neyo:conversation-loaded",
                event => {

                    const messages =
                        event.detail
                            ?.messages;


                    if (
                        !Array.isArray(
                            messages
                        )
                    ) {
                        return;
                    }


                    window.NeyoMessages
                        ?.clear?.();


                    messages.forEach(
                        (
                            message,
                            index
                        ) => {

                            const element =
                                window.NeyoMessages
                                    ?.create?.({
                                        role:
                                            message.role,

                                        content:
                                            "",

                                        index
                                    });


                            if (!element) {
                                return;
                            }


                            window.NeyoMessageRenderer
                                ?.render?.(
                                    element,
                                    message.content ||
                                    "",
                                    {
                                        role:
                                            message.role,

                                        markdown:
                                            message.role ===
                                            "assistant"
                                    }
                                );

                        }
                    );

                }
            );


            /* -----------------------------------------
               CHAT ERROR → NOTIFICATION
               ----------------------------------------- */

            window.addEventListener(
                "neyo:chat-error",
                event => {

                    const message =
                        event.detail
                            ?.error
                            ?.message ||
                        "Something went wrong.";

                    window.NeyoNotifications
                        ?.error?.(
                            message
                        );

                }
            );


            /* -----------------------------------------
               RATE LIMIT
               ----------------------------------------- */

            window.addEventListener(
                "neyo:chat-limit-reached",
                event => {

                    const message =
                        event.detail
                            ?.data
                            ?.error ||
                        "You've reached your current message limit.";


                    window.NeyoNotifications
                        ?.warning?.(
                            message
                        );


                    emit(
                        "neyo:upgrade-required",
                        {
                            source:
                                "chat-limit",

                            data:
                                event.detail
                                    ?.data ||
                                {}
                        }
                    );

                }
            );


            /* -----------------------------------------
               MODEL LOCK
               ----------------------------------------- */

            window.addEventListener(
                "neyo:model-upgrade-required",
                event => {

                    emit(
                        "neyo:upgrade-required",
                        {
                            source:
                                "model",

                            model:
                                event.detail
                                    ?.model,

                            modelInfo:
                                event.detail
                                    ?.modelInfo
                        }
                    );

                }
            );


            /* -----------------------------------------
               UPLOAD ERRORS
               ----------------------------------------- */

            window.addEventListener(
                "neyo:upload-error",
                event => {

                    window.NeyoNotifications
                        ?.error?.(
                            event.detail
                                ?.error
                                ?.message ||
                            "File upload failed."
                        );

                }
            );


            /* -----------------------------------------
               AUTH → APP STATE
               ----------------------------------------- */

            window.addEventListener(
                "neyo:auth-restored",
                event => {

                    window.NeyoState
                        ?.patch?.(
                            "auth",
                            {
                                authenticated:
                                    true,

                                user:
                                    event.detail
                                        ?.user ||
                                    null,

                                plan:
                                    event.detail
                                        ?.plan ||
                                    "free"
                            }
                        );

                }
            );

        };


    /* =====================================================
       INITIALIZE
       ===================================================== */

    const performInitialization =
        async () => {

            emit(
                "neyo:init-start"
            );


            /* -----------------------------------------
               1. CONNECT EVENT BRIDGES
               ----------------------------------------- */

            connectModules();


            /* -----------------------------------------
               2. SHARED SERVICES
               ----------------------------------------- */

            wireSharedServices();


            /* -----------------------------------------
               3. UI STATE
               ----------------------------------------- */

            await initializeUiState();


            /* -----------------------------------------
               4. AUTH
               ----------------------------------------- */

            const authenticated =
                await initializeAuth();


            /*
            Login redirect may already be happening.
            Do not continue loading private data.
            */

            if (!authenticated) {

                emit(
                    "neyo:init-auth-required"
                );


                return false;

            }


            /* -----------------------------------------
               5. PROFILE + HISTORY
               ----------------------------------------- */

            await initializeUserData();


            /* -----------------------------------------
               6. READY
               ----------------------------------------- */

            initialized =
                true;


            window.NeyoState
                ?.markReady?.();


            emit(
                "neyo:init-complete",
                {
                    initialized:
                        true
                }
            );


            return true;

        };


    const initialize =
        async () => {

            if (initialized) {
                return true;
            }


            if (initializingPromise) {

                return initializingPromise;

            }


            initializingPromise =
                performInitialization();


            try {

                return await initializingPromise;

            }

            finally {

                initializingPromise =
                    null;

            }

        };


    /* =====================================================
       MANUAL SUPABASE CLIENT
       ===================================================== */

    const setSupabaseClient =
        client => {

            if (!client) {
                return false;
            }


            window.NeyoUpload
                ?.setSupabaseClient?.(
                    client
                );


            window.NeyoProfile
                ?.setSupabaseClient?.(
                    client
                );


            emit(
                "neyo:supabase-client-wired",
                {
                    client
                }
            );


            return true;

        };


    /* =====================================================
       PUBLIC INIT EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:initialize",
        initialize
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoApp =
        Object.freeze({

            init:
                initialize,

            setSupabaseClient,

            isInitialized:
                () =>
                    initialized,

            getSupabaseClient:
                getSharedSupabaseClient

        });

})();
