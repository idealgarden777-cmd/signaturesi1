/*
=========================================================
NEYO — APP STATE COMPONENT

Owns:
- Lightweight global app state
- State updates
- State subscriptions
- Derived status
- Cross-component coordination

Does NOT own:
- API calls
- DOM rendering
- Auth logic
- Chat logic
- Upload logic
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       STATE
       ===================================================== */

    const state = {

        auth: {
            authenticated:
                false,

            user:
                null,

            plan:
                "free"
        },


        chat: {
            conversationId:
                null,

            generating:
                false,

            privateChat:
                false
        },


        upload: {
            active:
                0
        },


        ui: {
            theme:
                "light",

            themeMode:
                "system",

            device:
                "desktop",

            sidebarOpen:
                true,

            settingsOpen:
                false
        },


        app: {
            ready:
                false
        }

    };


    /* =====================================================
       SUBSCRIBERS
       ===================================================== */

    const subscribers =
        new Set();


    /* =====================================================
       HELPERS
       ===================================================== */

    const clone = value => {

        if (
            value === null ||
            typeof value !==
                "object"
        ) {
            return value;
        }


        try {

            return structuredClone(
                value
            );

        }

        catch {

            return JSON.parse(
                JSON.stringify(
                    value
                )
            );

        }

    };


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


    const getByPath = path => {

        if (!path) {
            return state;
        }


        return String(path)
            .split(".")
            .reduce(
                (
                    current,
                    key
                ) =>
                    current?.[key],
                state
            );

    };


    const setByPath = (
        path,
        value
    ) => {

        const keys =
            String(path)
                .split(".")
                .filter(Boolean);


        if (!keys.length) {
            return false;
        }


        let target =
            state;


        for (
            let index = 0;
            index <
            keys.length - 1;
            index++
        ) {

            const key =
                keys[index];


            if (
                !target[key] ||
                typeof target[key] !==
                    "object"
            ) {

                target[key] = {};

            }


            target =
                target[key];

        }


        const finalKey =
            keys[
                keys.length - 1
            ];


        const previous =
            target[finalKey];


        target[finalKey] =
            value;


        notify(
            path,
            value,
            previous
        );


        return true;

    };


    /* =====================================================
       NOTIFY
       ===================================================== */

    const notify = (
        path,
        value,
        previous
    ) => {

        const snapshot =
            getState();


        const detail = {

            path,

            value:
                clone(value),

            previous:
                clone(previous),

            state:
                snapshot

        };


        subscribers.forEach(
            callback => {

                try {

                    callback(
                        detail
                    );

                }

                catch (error) {

                    console.error(
                        "App state subscriber failed:",
                        error
                    );

                }

            }
        );


        emit(
            "neyo:state-change",
            detail
        );

    };


    /* =====================================================
       GET
       ===================================================== */

    const get = path => {

        return clone(
            getByPath(path)
        );

    };


    const getState = () => {

        return clone(
            state
        );

    };


    /* =====================================================
       SET
       ===================================================== */

    const set = (
        path,
        value
    ) => {

        return setByPath(
            path,
            value
        );

    };


    /* =====================================================
       PATCH
       ===================================================== */

    const patch = (
        section,
        values
    ) => {

        if (
            !section ||
            !values ||
            typeof values !==
                "object"
        ) {
            return false;
        }


        const current =
            getByPath(
                section
            );


        if (
            !current ||
            typeof current !==
                "object"
        ) {
            return false;
        }


        const next = {
            ...current,
            ...values
        };


        return setByPath(
            section,
            next
        );

    };


    /* =====================================================
       SUBSCRIBE
       ===================================================== */

    const subscribe =
        callback => {

            if (
                typeof callback !==
                "function"
            ) {

                return () => {};

            }


            subscribers.add(
                callback
            );


            return () => {

                subscribers.delete(
                    callback
                );

            };

        };


    /* =====================================================
       DERIVED STATE
       ===================================================== */

    const isBusy = () => {

        return (
            state.chat.generating ||
            state.upload.active > 0
        );

    };


    const isPro = () => {

        return (
            state.auth.plan ===
            "pro"
        );

    };


    /* =====================================================
       AUTH EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:auth-restored",
        event => {

            patch(
                "auth",
                {
                    authenticated:
                        true,

                    user:
                        event.detail?.user ||
                        null,

                    plan:
                        event.detail?.plan ||
                        "free"
                }
            );

        }
    );


    window.addEventListener(
        "neyo:auth-required",
        () => {

            patch(
                "auth",
                {
                    authenticated:
                        false,

                    user:
                        null,

                    plan:
                        "free"
                }
            );

        }
    );


    window.addEventListener(
        "neyo:logout-success",
        () => {

            patch(
                "auth",
                {
                    authenticated:
                        false,

                    user:
                        null,

                    plan:
                        "free"
                }
            );

        }
    );


    /* =====================================================
       CHAT EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:chat-send-start",
        () => {

            set(
                "chat.generating",
                true
            );

        }
    );


    window.addEventListener(
        "neyo:chat-send-end",
        event => {

            patch(
                "chat",
                {
                    generating:
                        false,

                    conversationId:
                        event.detail
                            ?.conversationId ||
                        state.chat
                            .conversationId
                }
            );

        }
    );


    window.addEventListener(
        "neyo:chat-new",
        () => {

            set(
                "chat.conversationId",
                null
            );

        }
    );


    window.addEventListener(
        "neyo:chat-state-loaded",
        event => {

            set(
                "chat.conversationId",
                event.detail
                    ?.conversationId ||
                null
            );

        }
    );


    window.addEventListener(
        "neyo:chat-preferences-change",
        event => {

            const privateChat =
                Boolean(
                    event.detail
                        ?.preferences
                        ?.privateChat
                );


            set(
                "chat.privateChat",
                privateChat
            );

        }
    );


    /* =====================================================
       UPLOAD EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:upload-start",
        event => {

            set(
                "upload.active",
                event.detail
                    ?.activeUploads ||
                (
                    state.upload
                        .active + 1
                )
            );

        }
    );


    window.addEventListener(
        "neyo:upload-end",
        event => {

            set(
                "upload.active",
                Math.max(
                    0,
                    event.detail
                        ?.activeUploads ||
                    0
                )
            );

        }
    );


    /* =====================================================
       THEME EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:theme-change",
        event => {

            patch(
                "ui",
                {
                    theme:
                        event.detail
                            ?.theme ||
                        state.ui.theme,

                    themeMode:
                        event.detail
                            ?.mode ||
                        state.ui
                            .themeMode
                }
            );

        }
    );


    /* =====================================================
       RESPONSIVE EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:responsive-change",
        event => {

            set(
                "ui.device",
                event.detail
                    ?.device ||
                state.ui.device
            );

        }
    );


    /* =====================================================
       SIDEBAR EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:sidebar-open",
        () => {

            set(
                "ui.sidebarOpen",
                true
            );

        }
    );


    window.addEventListener(
        "neyo:sidebar-close",
        () => {

            set(
                "ui.sidebarOpen",
                false
            );

        }
    );


    /* =====================================================
       SETTINGS EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:settings-open",
        () => {

            set(
                "ui.settingsOpen",
                true
            );

        }
    );


    window.addEventListener(
        "neyo:settings-close",
        () => {

            set(
                "ui.settingsOpen",
                false
            );

        }
    );


    /* =====================================================
       READY
       ===================================================== */

    const markReady = () => {

        set(
            "app.ready",
            true
        );


        emit(
            "neyo:app-ready",
            {
                state:
                    getState()
            }
        );

    };


    window.addEventListener(
        "neyo:app-ready-request",
        markReady
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoState =
        Object.freeze({

            get,

            getState,

            set,

            patch,

            subscribe,

            isBusy,

            isPro,

            markReady

        });

})();
