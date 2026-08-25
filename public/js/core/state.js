/*
=========================================================
NEYO — CORE STATE
Production v1

Purpose:
- Single lightweight global state store
- Compatible with existing window.NeyoState contract
- Safe bridge from legacy app-state.js to modular rewrite
- No DOM ownership
- No API ownership
- No auth implementation
- No chat implementation
- No upload implementation

Preserved public API:
NeyoState.get(path)
NeyoState.getState()
NeyoState.set(path, value)
NeyoState.patch(section, values)
NeyoState.subscribe(callback)
NeyoState.isBusy()
NeyoState.isPro()
NeyoState.markReady()

Added:
NeyoState.subscribePath(path, callback)
NeyoState.update(path, updater)
NeyoState.reset(path?)
NeyoState.replace(nextState)
NeyoState.batch(callback)
NeyoState.has(path)
NeyoState.getInitialState()
NeyoState.getStateVersion()

Events:
neyo:state-change
neyo:app-ready

=========================================================
*/

(() => {
    "use strict";

    const VERSION =
        "neyo-core-state-production-v1";

    /* =====================================================
       SINGLETON GUARD

       If the new production store is already installed,
       do nothing.

       Important:
       Existing legacy NeyoState without __controller can
       be replaced by this compatible implementation.
       ===================================================== */

    if (
        window.NeyoState
            ?.__controller === true
    ) {
        return;
    }

    /* =====================================================
       INITIAL STATE

       Proven old/current app-state.js contract preserved.
       Additional fields are additive only.
       ===================================================== */

    const INITIAL_STATE =
        Object.freeze({
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
        });

    /* =====================================================
       CLONE
       ===================================================== */

    function clone(value) {
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
        } catch {}

        try {
            return JSON.parse(
                JSON.stringify(
                    value
                )
            );
        } catch {
            return value;
        }
    }

    /* =====================================================
       MUTABLE STORE
       ===================================================== */

    let state =
        clone(
            INITIAL_STATE
        );

    let stateVersion =
        0;

    /* =====================================================
       SUBSCRIBERS
       ===================================================== */

    const subscribers =
        new Set();

    const pathSubscribers =
        new Map();

    /* =====================================================
       BATCHING
       ===================================================== */

    let batchDepth =
        0;

    const pendingChanges =
        [];

    /* =====================================================
       EVENT SYSTEM
       ===================================================== */

    function emit(
        name,
        detail = {}
    ) {
        const events =
            window.NeyoEvents;

        if (
            events
                ?.__controller === true &&
            typeof events.emit ===
                "function"
        ) {
            events.emit(
                name,
                detail
            );

            return;
        }

        window.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail
                }
            )
        );
    }

    function on(
        name,
        callback
    ) {
        const events =
            window.NeyoEvents;

        if (
            events
                ?.__controller === true &&
            typeof events.on ===
                "function"
        ) {
            return events.on(
                name,
                callback
            );
        }

        window.addEventListener(
            name,
            callback
        );

        return () => {
            window.removeEventListener(
                name,
                callback
            );
        };
    }

    /* =====================================================
       PATH HELPERS
       ===================================================== */

    function normalizePath(path) {
        if (
            path === null ||
            path === undefined
        ) {
            return "";
        }

        return String(path)
            .trim()
            .split(".")
            .map(
                key =>
                    key.trim()
            )
            .filter(Boolean)
            .join(".");
    }

    function pathParts(path) {
        const normalized =
            normalizePath(
                path
            );

        return normalized
            ? normalized.split(".")
            : [];
    }

    function getByPath(
        path,
        source = state
    ) {
        const parts =
            pathParts(
                path
            );

        if (
            parts.length === 0
        ) {
            return source;
        }

        let current =
            source;

        for (
            const key
            of parts
        ) {
            if (
                current === null ||
                current === undefined ||
                typeof current !==
                    "object"
            ) {
                return undefined;
            }

            current =
                current[key];
        }

        return current;
    }

    function hasByPath(
        path,
        source = state
    ) {
        const parts =
            pathParts(
                path
            );

        if (
            parts.length === 0
        ) {
            return true;
        }

        let current =
            source;

        for (
            const key
            of parts
        ) {
            if (
                current === null ||
                current === undefined ||
                typeof current !==
                    "object" ||
                !Object.prototype
                    .hasOwnProperty
                    .call(
                        current,
                        key
                    )
            ) {
                return false;
            }

            current =
                current[key];
        }

        return true;
    }

    /* =====================================================
       EQUALITY

       Primitive/object identity is enough for normal state
       mutations.

       We intentionally do not deep-compare large objects.
       ===================================================== */

    function isEqual(
        first,
        second
    ) {
        return Object.is(
            first,
            second
        );
    }

    /* =====================================================
       PATH RELATION

       Used by subscribePath("chat") so updates to
       chat.generating also notify the chat subscriber.
       ===================================================== */

    function pathsRelated(
        subscribedPath,
        changedPath
    ) {
        if (
            !subscribedPath ||
            !changedPath
        ) {
            return true;
        }

        return (
            subscribedPath ===
                changedPath ||

            changedPath.startsWith(
                `${subscribedPath}.`
            ) ||

            subscribedPath.startsWith(
                `${changedPath}.`
            )
        );
    }

    /* =====================================================
       NOTIFICATION DETAIL
       ===================================================== */

    function createChangeDetail(
        path,
        value,
        previous,
        meta = {}
    ) {
        return {
            path,

            value:
                clone(
                    value
                ),

            previous:
                clone(
                    previous
                ),

            state:
                getState(),

            version:
                stateVersion,

            source:
                meta.source ||
                null,

            silent:
                Boolean(
                    meta.silent
                )
        };
    }

    /* =====================================================
       NOTIFY SUBSCRIBERS
       ===================================================== */

    function notifySubscribers(
        detail
    ) {
        for (
            const callback
            of subscribers
        ) {
            try {
                callback(
                    detail
                );
            } catch (error) {
                console.error(
                    "[NEYO State] Subscriber failed:",
                    error
                );
            }
        }

        for (
            const [
                subscribedPath,
                callbacks
            ]
            of pathSubscribers
        ) {
            if (
                !pathsRelated(
                    subscribedPath,
                    detail.path
                )
            ) {
                continue;
            }

            const currentValue =
                get(
                    subscribedPath
                );

            for (
                const callback
                of callbacks
            ) {
                try {
                    callback(
                        currentValue,
                        detail
                    );
                } catch (error) {
                    console.error(
                        "[NEYO State] Path subscriber failed:",
                        error
                    );
                }
            }
        }
    }

    /* =====================================================
       FLUSH CHANGE
       ===================================================== */

    function flushChange(
        detail
    ) {
        notifySubscribers(
            detail
        );

        if (
            !detail.silent
        ) {
            emit(
                "neyo:state-change",
                detail
            );
        }
    }

    /* =====================================================
       QUEUE CHANGE
       ===================================================== */

    function queueChange(
        detail
    ) {
        if (
            batchDepth > 0
        ) {
            pendingChanges.push(
                detail
            );

            return;
        }

        flushChange(
            detail
        );
    }

    /* =====================================================
       FLUSH BATCH
       ===================================================== */

    function flushBatch() {
        if (
            pendingChanges.length ===
            0
        ) {
            return;
        }

        const changes =
            pendingChanges.splice(
                0,
                pendingChanges.length
            );

        /*
         * Individual subscribers still receive each change
         * so existing behavior remains predictable.
         */

        for (
            const detail
            of changes
        ) {
            flushChange(
                detail
            );
        }

        emit(
            "neyo:state-batch",
            {
                changes:
                    changes.map(
                        change => ({
                            path:
                                change.path,

                            value:
                                clone(
                                    change.value
                                ),

                            previous:
                                clone(
                                    change.previous
                                )
                        })
                    ),

                state:
                    getState(),

                version:
                    stateVersion
            }
        );
    }

    /* =====================================================
       SET BY PATH
       ===================================================== */

    function setByPath(
        path,
        value,
        meta = {}
    ) {
        const normalized =
            normalizePath(
                path
            );

        if (!normalized) {
            return false;
        }

        const keys =
            normalized.split(".");

        let target =
            state;

        for (
            let index = 0;
            index <
            keys.length - 1;
            index += 1
        ) {
            const key =
                keys[index];

            const current =
                target[key];

            if (
                current === null ||
                current === undefined ||
                typeof current !==
                    "object" ||
                Array.isArray(
                    current
                )
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
            target[
                finalKey
            ];

        const nextValue =
            clone(
                value
            );

        if (
            isEqual(
                previous,
                nextValue
            )
        ) {
            return false;
        }

        target[
            finalKey
        ] =
            nextValue;

        stateVersion +=
            1;

        const detail =
            createChangeDetail(
                normalized,
                nextValue,
                previous,
                meta
            );

        queueChange(
            detail
        );

        return true;
    }

    /* =====================================================
       GET
       ===================================================== */

    function get(path = "") {
        return clone(
            getByPath(
                path
            )
        );
    }

    function getState() {
        return clone(
            state
        );
    }

    function getInitialState() {
        return clone(
            INITIAL_STATE
        );
    }

    /* =====================================================
       HAS
       ===================================================== */

    function has(path) {
        return hasByPath(
            path
        );
    }

    /* =====================================================
       SET
       ===================================================== */

    function set(
        path,
        value,
        options = {}
    ) {
        return setByPath(
            path,
            value,
            options
        );
    }

    /* =====================================================
       UPDATE
       ===================================================== */

    function update(
        path,
        updater,
        options = {}
    ) {
        if (
            typeof updater !==
            "function"
        ) {
            throw new TypeError(
                "[NEYO State] updater must be a function."
            );
        }

        const current =
            get(
                path
            );

        const next =
            updater(
                current
            );

        return set(
            path,
            next,
            options
        );
    }

    /* =====================================================
       PATCH

       Proven existing API preserved.

       patch("auth", {
           authenticated: true
       })
       ===================================================== */

    function patch(
        section,
        values,
        options = {}
    ) {
        const normalized =
            normalizePath(
                section
            );

        if (
            !normalized ||
            !values ||
            typeof values !==
                "object" ||
            Array.isArray(
                values
            )
        ) {
            return false;
        }

        const current =
            getByPath(
                normalized
            );

        if (
            current !==
                undefined &&
            (
                current ===
                    null ||
                typeof current !==
                    "object" ||
                Array.isArray(
                    current
                )
            )
        ) {
            return false;
        }

        const next = {
            ...(
                current &&
                typeof current ===
                    "object"
                    ? current
                    : {}
            ),

            ...clone(
                values
            )
        };

        return setByPath(
            normalized,
            next,
            options
        );
    }

    /* =====================================================
       REPLACE WHOLE STATE

       Intended for controlled hydration/tests only.
       ===================================================== */

    function replace(
        nextState,
        options = {}
    ) {
        if (
            !nextState ||
            typeof nextState !==
                "object" ||
            Array.isArray(
                nextState
            )
        ) {
            return false;
        }

        const previous =
            state;

        state =
            clone(
                nextState
            );

        stateVersion +=
            1;

        queueChange(
            createChangeDetail(
                "",
                state,
                previous,
                options
            )
        );

        return true;
    }

    /* =====================================================
       RESET

       reset()
       → entire store

       reset("chat")
       → only chat section

       reset("chat.generating")
       → one property
       ===================================================== */

    function reset(
        path = "",
        options = {}
    ) {
        const normalized =
            normalizePath(
                path
            );

        if (!normalized) {
            const previous =
                state;

            state =
                clone(
                    INITIAL_STATE
                );

            stateVersion +=
                1;

            queueChange(
                createChangeDetail(
                    "",
                    state,
                    previous,
                    {
                        ...options,

                        source:
                            options.source ||
                            "reset"
                    }
                )
            );

            return true;
        }

        const initialValue =
            getByPath(
                normalized,
                INITIAL_STATE
            );

        if (
            initialValue ===
                undefined
        ) {
            return false;
        }

        return setByPath(
            normalized,
            initialValue,
            {
                ...options,

                source:
                    options.source ||
                    "reset"
            }
        );
    }

    /* =====================================================
       BATCH

       NeyoState.batch(() => {
           set(...);
           set(...);
       });
       ===================================================== */

    function batch(callback) {
        if (
            typeof callback !==
                "function"
        ) {
            throw new TypeError(
                "[NEYO State] batch callback must be a function."
            );
        }

        batchDepth +=
            1;

        try {
            return callback();
        } finally {
            batchDepth =
                Math.max(
                    0,
                    batchDepth - 1
                );

            if (
                batchDepth === 0
            ) {
                flushBatch();
            }
        }
    }

    /* =====================================================
       GLOBAL SUBSCRIBE

       Existing API preserved.

       callback receives:
       {
           path,
           value,
           previous,
           state,
           version
       }
       ===================================================== */

    function subscribe(
        callback
    ) {
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
    }

    /* =====================================================
       PATH SUBSCRIBE

       Example:

       NeyoState.subscribePath(
           "chat.generating",
           value => {}
       );
       ===================================================== */

    function subscribePath(
        path,
        callback,
        options = {}
    ) {
        const normalized =
            normalizePath(
                path
            );

        if (
            !normalized ||
            typeof callback !==
                "function"
        ) {
            return () => {};
        }

        let callbacks =
            pathSubscribers.get(
                normalized
            );

        if (!callbacks) {
            callbacks =
                new Set();

            pathSubscribers.set(
                normalized,
                callbacks
            );
        }

        callbacks.add(
            callback
        );

        if (
            options.immediate ===
                true
        ) {
            try {
                callback(
                    get(
                        normalized
                    ),
                    {
                        path:
                            normalized,

                        value:
                            get(
                                normalized
                            ),

                        previous:
                            undefined,

                        state:
                            getState(),

                        version:
                            stateVersion,

                        source:
                            "subscribe-immediate"
                    }
                );
            } catch (error) {
                console.error(
                    "[NEYO State] Immediate subscriber failed:",
                    error
                );
            }
        }

        return () => {
            callbacks.delete(
                callback
            );

            if (
                callbacks.size ===
                    0
            ) {
                pathSubscribers.delete(
                    normalized
                );
            }
        };
    }

    /* =====================================================
       DERIVED STATE
       ===================================================== */

    function isBusy() {
        return Boolean(
            state.chat
                ?.generating ||
            Number(
                state.upload
                    ?.active ||
                0
            ) > 0
        );
    }

    function isPro() {
        const plan =
            String(
                state.auth
                    ?.plan ||
                ""
            )
                .trim()
                .toLowerCase();

        return (
            plan === "pro" ||
            plan === "team" ||
            plan === "enterprise"
        );
    }

    /* =====================================================
       READY
       ===================================================== */

    function markReady() {
        const changed =
            set(
                "app.ready",
                true,
                {
                    source:
                        "app-ready"
                }
            );

        /*
         * Existing app-state.js emitted app-ready every time
         * markReady() was requested.

         * Preserve that observable contract.
         */

        emit(
            "neyo:app-ready",
            {
                state:
                    getState(),

                version:
                    stateVersion
            }
        );

        return (
            changed ||
            state.app.ready ===
                true
        );
    }

    /* =====================================================
       AUTH EVENT BRIDGES

       These mirror the proven old/current app-state.js.
       ===================================================== */

    on(
        "neyo:auth-restored",
        event => {
            patch(
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
                        event.detail
                            ?.user
                            ?.plan ||
                        "free"
                },
                {
                    source:
                        "auth-restored"
                }
            );
        }
    );

    on(
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
                },
                {
                    source:
                        "auth-required"
                }
            );
        }
    );

    on(
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
                },
                {
                    source:
                        "logout"
                }
            );
        }
    );

    /* =====================================================
       CHAT EVENT BRIDGES
       ===================================================== */

    on(
        "neyo:chat-send-start",
        event => {
            patch(
                "chat",
                {
                    generating:
                        true,

                    conversationId:
                        event.detail
                            ?.conversationId ||
                        state.chat
                            .conversationId
                },
                {
                    source:
                        "chat-send-start"
                }
            );
        }
    );

    on(
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
                },
                {
                    source:
                        "chat-send-end"
                }
            );
        }
    );

    on(
        "neyo:chat-aborted",
        () => {
            set(
                "chat.generating",
                false,
                {
                    source:
                        "chat-aborted"
                }
            );
        }
    );

    on(
        "neyo:chat-error",
        () => {
            set(
                "chat.generating",
                false,
                {
                    source:
                        "chat-error"
                }
            );
        }
    );

    on(
        "neyo:chat-new",
        () => {
            batch(
                () => {
                    set(
                        "chat.conversationId",
                        null,
                        {
                            source:
                                "chat-new"
                        }
                    );

                    set(
                        "chat.generating",
                        false,
                        {
                            source:
                                "chat-new"
                        }
                    );
                }
            );
        }
    );

    on(
        "neyo:chat-state-loaded",
        event => {
            set(
                "chat.conversationId",
                event.detail
                    ?.conversationId ||
                null,
                {
                    source:
                        "chat-state-loaded"
                }
            );
        }
    );

    on(
        "neyo:chat-state",
        event => {
            const detail =
                event.detail ||
                {};

            const updates = {};

            if (
                Object.prototype
                    .hasOwnProperty
                    .call(
                        detail,
                        "conversationId"
                    )
            ) {
                updates
                    .conversationId =
                    detail
                        .conversationId ||
                    null;
            }

            if (
                Object.prototype
                    .hasOwnProperty
                    .call(
                        detail,
                        "generating"
                    )
            ) {
                updates
                    .generating =
                    Boolean(
                        detail
                            .generating
                    );
            }

            if (
                Object.keys(
                    updates
                ).length > 0
            ) {
                patch(
                    "chat",
                    updates,
                    {
                        source:
                            "chat-state"
                    }
                );
            }
        }
    );

    on(
        "neyo:chat-preferences-change",
        event => {
            const preferences =
                event.detail
                    ?.preferences ||
                {};

            if (
                Object.prototype
                    .hasOwnProperty
                    .call(
                        preferences,
                        "privateChat"
                    )
            ) {
                set(
                    "chat.privateChat",
                    Boolean(
                        preferences
                            .privateChat
                    ),
                    {
                        source:
                            "chat-preferences"
                    }
                );
            }
        }
    );

    on(
        "neyo:private-chat-set",
        event => {
            const detail =
                event.detail ||
                {};

            const value =
                Object.prototype
                    .hasOwnProperty
                    .call(
                        detail,
                        "enabled"
                    )
                    ? detail.enabled
                    : detail.value;

            if (
                value ===
                    undefined
            ) {
                return;
            }

            set(
                "chat.privateChat",
                Boolean(
                    value
                ),
                {
                    source:
                        "private-chat"
                }
            );
        }
    );

    /* =====================================================
       UPLOAD EVENT BRIDGES
       ===================================================== */

    on(
        "neyo:upload-start",
        event => {
            const active =
                Number(
                    event.detail
                        ?.activeUploads
                );

            if (
                Number.isFinite(
                    active
                )
            ) {
                set(
                    "upload.active",
                    Math.max(
                        0,
                        active
                    ),
                    {
                        source:
                            "upload-start"
                    }
                );

                return;
            }

            update(
                "upload.active",
                current =>
                    Math.max(
                        0,
                        Number(
                            current ||
                            0
                        ) + 1
                    ),
                {
                    source:
                        "upload-start"
                }
            );
        }
    );

    on(
        "neyo:upload-end",
        event => {
            const active =
                Number(
                    event.detail
                        ?.activeUploads
                );

            if (
                Number.isFinite(
                    active
                )
            ) {
                set(
                    "upload.active",
                    Math.max(
                        0,
                        active
                    ),
                    {
                        source:
                            "upload-end"
                    }
                );

                return;
            }

            update(
                "upload.active",
                current =>
                    Math.max(
                        0,
                        Number(
                            current ||
                            0
                        ) - 1
                    ),
                {
                    source:
                        "upload-end"
                }
            );
        }
    );

    on(
        "neyo:upload-error",
        event => {
            const active =
                Number(
                    event.detail
                        ?.activeUploads
                );

            if (
                Number.isFinite(
                    active
                )
            ) {
                set(
                    "upload.active",
                    Math.max(
                        0,
                        active
                    ),
                    {
                        source:
                            "upload-error"
                    }
                );
            }
        }
    );

    /* =====================================================
       THEME EVENT BRIDGE
       ===================================================== */

    on(
        "neyo:theme-change",
        event => {
            const detail =
                event.detail ||
                {};

            patch(
                "ui",
                {
                    theme:
                        detail.theme ||
                        state.ui
                            .theme,

                    themeMode:
                        detail.mode ||
                        detail.themeMode ||
                        state.ui
                            .themeMode
                },
                {
                    source:
                        "theme-change"
                }
            );
        }
    );

    /* =====================================================
       RESPONSIVE EVENT BRIDGE
       ===================================================== */

    on(
        "neyo:responsive-change",
        event => {
            const device =
                event.detail
                    ?.device;

            if (!device) {
                return;
            }

            set(
                "ui.device",
                device,
                {
                    source:
                        "responsive-change"
                }
            );
        }
    );

    /* =====================================================
       SIDEBAR EVENT BRIDGES
       ===================================================== */

    on(
        "neyo:sidebar-open",
        () => {
            set(
                "ui.sidebarOpen",
                true,
                {
                    source:
                        "sidebar-open"
                }
            );
        }
    );

    on(
        "neyo:sidebar-close",
        () => {
            set(
                "ui.sidebarOpen",
                false,
                {
                    source:
                        "sidebar-close"
                }
            );
        }
    );

    /* =====================================================
       SETTINGS EVENT BRIDGES
       ===================================================== */

    on(
        "neyo:settings-open",
        () => {
            set(
                "ui.settingsOpen",
                true,
                {
                    source:
                        "settings-open"
                }
            );
        }
    );

    on(
        "neyo:settings-close",
        () => {
            set(
                "ui.settingsOpen",
                false,
                {
                    source:
                        "settings-close"
                }
            );
        }
    );

    /* =====================================================
       APP READY REQUEST
       ===================================================== */

    on(
        "neyo:app-ready-request",
        () => {
            markReady();
        }
    );

    /* =====================================================
       STATE REQUEST

       Allows modules to request a snapshot without importing
       the state store directly.
       ===================================================== */

    on(
        "neyo:state-request",
        event => {
            emit(
                "neyo:state-response",
                {
                    requestId:
                        event.detail
                            ?.requestId ||
                        null,

                    path:
                        event.detail
                            ?.path ||
                        "",

                    value:
                        get(
                            event.detail
                                ?.path ||
                            ""
                        ),

                    state:
                        getState(),

                    version:
                        stateVersion
                }
            );
        }
    );

    /* =====================================================
       IMPORT EXISTING LEGACY STATE

       If old app-state.js executed before this new core file,
       preserve useful current values where possible.

       This makes migration safer during development.

       We only read it before replacing window.NeyoState.
       ===================================================== */

    const legacyStateApi =
        window.NeyoState;

    if (
        legacyStateApi &&
        legacyStateApi
            .__controller !== true &&
        typeof legacyStateApi
            .getState ===
            "function"
    ) {
        try {
            const legacy =
                legacyStateApi
                    .getState();

            if (
                legacy &&
                typeof legacy ===
                    "object"
            ) {
                state = {
                    ...state,

                    ...clone(
                        legacy
                    ),

                    auth: {
                        ...state.auth,
                        ...clone(
                            legacy.auth ||
                            {}
                        )
                    },

                    chat: {
                        ...state.chat,
                        ...clone(
                            legacy.chat ||
                            {}
                        )
                    },

                    upload: {
                        ...state.upload,
                        ...clone(
                            legacy.upload ||
                            {}
                        )
                    },

                    ui: {
                        ...state.ui,
                        ...clone(
                            legacy.ui ||
                            {}
                        )
                    },

                    app: {
                        ...state.app,
                        ...clone(
                            legacy.app ||
                            {}
                        )
                    }
                };
            }
        } catch (error) {
            console.warn(
                "[NEYO State] Legacy state import failed:",
                error
            );
        }
    }

    /* =====================================================
       PUBLIC API
       ===================================================== */

    const api =
        Object.freeze({
            __controller:
                true,

            version:
                VERSION,

            get,

            getState,

            getInitialState,

            getStateVersion() {
                return (
                    stateVersion
                );
            },

            has,

            set,

            update,

            patch,

            replace,

            reset,

            batch,

            subscribe,

            subscribePath,

            isBusy,

            isPro,

            markReady,

            getSubscriberCount() {
                let pathCount =
                    0;

                for (
                    const callbacks
                    of pathSubscribers
                        .values()
                ) {
                    pathCount +=
                        callbacks.size;
                }

                return {
                    global:
                        subscribers.size,

                    path:
                        pathCount,

                    total:
                        subscribers.size +
                        pathCount
                };
            }
        });

    /* =====================================================
       GLOBAL

       Configurable true helps controlled migration/testing,
       while writable false prevents accidental reassignment.
       ===================================================== */

    try {
        Object.defineProperty(
            window,
            "NeyoState",
            {
                value:
                    api,

                writable:
                    false,

                enumerable:
                    true,

                configurable:
                    true
            }
        );
    } catch {
        window.NeyoState =
            api;
    }

    /* =====================================================
       READY EVENT
       ===================================================== */

    emit(
        "neyo:state-ready",
        {
            version:
                VERSION,

            state:
                getState()
        }
    );

})();
