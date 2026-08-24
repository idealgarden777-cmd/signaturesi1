/*
=========================================================
NEO — HISTORY
Production v2 — Old Working Baseline

BASELINE:
- Old working neo.js Recent Chats UI
- Current /api/history backend
- Current NeyoChat modular controller

Owns:
- Recent chat loading
- History list rendering
- Conversation opening
- Active history row
- History refresh
- Three-dot menu request

Does NOT own:
- Rename
- Delete
- Pin / Unpin
- Share
- Popup menu UI
- Message DOM
- Sidebar
=========================================================
*/

(() => {
    "use strict";

    const VERSION =
        "neo-history-production-v2";

    if (
        window.NeyoHistory
            ?.__controller === true
    ) {
        return;
    }

    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG = Object.freeze({
        endpoint:
            "/api/history",

        bootstrapDelay:
            350,

        authRetryDelays: [
            500,
            900,
            1500,
            2400,
            3500
        ]
    });

    /* =====================================================
       DOM
       ===================================================== */

    const historyList =
        document.getElementById(
            "historyList"
        );

    if (!historyList) {
        console.warn(
            "[NEO History] #historyList missing."
        );

        return;
    }

    /* =====================================================
       STATE
       ===================================================== */

    const state = {
        conversations: [],

        activeConversationId:
            null,

        loading:
            false,

        loaded:
            false,

        opening:
            false,

        loadPromise:
            null,

        loadSerial:
            0,

        openSerial:
            0,

        openController:
            null,

        bootstrapRetry:
            0
    };

    /* =====================================================
       EVENTS
       ===================================================== */

    function emit(
        name,
        detail = {}
    ) {
        window.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail
                }
            )
        );
    }

    /* =====================================================
       HELPERS
       ===================================================== */

    function clean(
        value,
        max = 500
    ) {
        return String(
            value ?? ""
        )
            .replace(
                /\u0000/g,
                ""
            )
            .trim()
            .slice(
                0,
                max
            );
    }

    function cleanId(value) {
        return clean(
            value,
            160
        );
    }

    function refreshIcons() {
        try {
            window.lucide
                ?.createIcons
                ?.();
        } catch {}
    }

    function chatController() {
        const controller =
            window.NeyoChat;

        return (
            controller &&
            controller
                .__controller === true
        )
            ? controller
            : null;
    }

    /* =====================================================
       READ JSON
       ===================================================== */

    async function readJsonResponse(
        response
    ) {
        const raw =
            await response.text();

        let data = {};

        if (raw) {
            try {
                data =
                    JSON.parse(raw);
            } catch {
                data = {};
            }
        }

        if (!response.ok) {
            const error =
                new Error(
                    data?.error ||
                    data?.message ||
                    raw ||
                    `Request failed (${response.status})`
                );

            error.status =
                response.status;

            error.data =
                data;

            throw error;
        }

        return data;
    }

    /* =====================================================
       NORMALIZE CONVERSATION
       ===================================================== */

    function normalizeConversation(
        item
    ) {
        if (
            !item ||
            typeof item !== "object"
        ) {
            return null;
        }

        const id =
            cleanId(
                item.id ||
                item.conversationId ||
                item.conversation_id
            );

        if (!id) {
            return null;
        }

        return {
            ...item,

            id,

            title:
                clean(
                    item.title,
                    100
                ) ||
                "New conversation",

            is_pinned:
                Boolean(
                    item.is_pinned ??
                    item.isPinned ??
                    item.pinned
                )
        };
    }

    /* =====================================================
       CLONE ATTACHMENTS / MESSAGES
       ===================================================== */

    function cloneAttachment(
        attachment
    ) {
        if (
            !attachment ||
            typeof attachment !==
                "object"
        ) {
            return attachment;
        }

        return {
            ...attachment
        };
    }

    function cloneMessage(
        message
    ) {
        if (
            !message ||
            typeof message !== "object"
        ) {
            return null;
        }

        return {
            ...message,

            attachments:
                Array.isArray(
                    message.attachments
                )
                    ? message
                        .attachments
                        .map(
                            cloneAttachment
                        )
                    : [],

            sources:
                Array.isArray(
                    message.sources
                )
                    ? message.sources
                        .map(
                            source => ({
                                ...source
                            })
                        )
                    : message.sources
        };
    }

    /* =====================================================
       LOADING SHIMMER

       Exact old visual structure.
       ===================================================== */

    function renderLoading() {
        historyList.innerHTML = `
            <div class="history-loading" aria-hidden="true">
                <div class="history-skeleton-row">
                    <div class="history-skeleton-line"></div>
                </div>

                <div class="history-skeleton-row">
                    <div class="history-skeleton-line"></div>
                </div>

                <div class="history-skeleton-row">
                    <div class="history-skeleton-line"></div>
                </div>
            </div>
        `;
    }

    /* =====================================================
       ACTIVE ROW
       ===================================================== */

    function syncActiveRows() {
        const rows =
            historyList
                .querySelectorAll(
                    ".history-item-wrapper"
                );

        for (
            const row
            of rows
        ) {
            const id =
                row.dataset.id ||
                row.dataset
                    .conversationId ||
                "";

            const active =
                Boolean(
                    id &&
                    id ===
                    state
                        .activeConversationId
                );

            row.classList.toggle(
                "active",
                active
            );

            row
                .querySelector(
                    ".history-item"
                )
                ?.classList
                .toggle(
                    "active",
                    active
                );
        }
    }

    /* =====================================================
       HISTORY ROW

       This intentionally mirrors old working neo.js DOM
       and dimensions.
       ===================================================== */

    function createHistoryRow(
        item
    ) {
        const row =
            document.createElement(
                "div"
            );

        row.className =
            "history-item-wrapper";

        row.dataset.id =
            item.id;

        row.dataset
            .conversationId =
            item.id;

        /*
         * Preserve old baseline geometry.
         */

        row.style.position =
            "relative";

        row.style.display =
            "flex";

        row.style.alignItems =
            "center";

        row.style.gap =
            "4px";

        row.style.padding =
            "2px 4px";

        row.style.borderRadius =
            "10px";

        row.style.transition =
            "background 0.15s ease";

        /* -----------------------------------------------
           CHAT BUTTON
           ----------------------------------------------- */

        const button =
            document.createElement(
                "button"
            );

        button.type =
            "button";

        button.className =
            "history-item";

        button.dataset
            .conversationId =
            item.id;

        button.style.flex =
            "1";

        button.style.minHeight =
            "36px";

        button.style.height =
            "36px";

        button.style.padding =
            "8px 10px";

        button.style.background =
            "transparent";

        button.style.border =
            "none";

        button.style.color =
            "var(--text-primary)";

        button.style.textAlign =
            "left";

        button.style.cursor =
            "pointer";

        button.style.overflow =
            "hidden";

        button.style.whiteSpace =
            "nowrap";

        button.style.textOverflow =
            "ellipsis";

        button.style.borderRadius =
            "8px";

        button.style.fontSize =
            "14px";

        button.style.lineHeight =
            "20px";

        /* -----------------------------------------------
           TITLE
           ----------------------------------------------- */

        const title =
            document.createElement(
                "span"
            );

        title.className =
            "history-item-title";

        title.textContent =
            item.title;

        button.appendChild(
            title
        );

        /* -----------------------------------------------
           PIN ICON
           ----------------------------------------------- */

        if (
            item.is_pinned
        ) {
            const pinIcon =
                document.createElement(
                    "span"
                );

            pinIcon.className =
                "history-pin-icon";

            pinIcon.style.marginLeft =
                "6px";

            pinIcon.style.color =
                "var(--text-muted)";

            pinIcon.innerHTML =
                '<i data-lucide="pin" size="12"></i>';

            button.appendChild(
                pinIcon
            );
        }

        /* -----------------------------------------------
           THREE DOT
           ----------------------------------------------- */

        const dotBtn =
            document.createElement(
                "button"
            );

        dotBtn.type =
            "button";

        dotBtn.className =
            "history-three-dot";

        dotBtn.dataset
            .conversationId =
            item.id;

        dotBtn.setAttribute(
            "aria-label",
            "Conversation options"
        );

        dotBtn.innerHTML =
            '<i data-lucide="more-vertical" size="16"></i>';

        /*
         * Exact old baseline feel.
         */

        dotBtn.style.background =
            "transparent";

        dotBtn.style.border =
            "none";

        dotBtn.style.color =
            "var(--text-muted)";

        dotBtn.style.cursor =
            "pointer";

        dotBtn.style.padding =
            "4px 6px";

        dotBtn.style.borderRadius =
            "6px";

        dotBtn.style.display =
            "flex";

        dotBtn.style.alignItems =
            "center";

        dotBtn.style.justifyContent =
            "center";

        dotBtn.style.transition =
            "background 0.12s ease, color 0.12s ease";

        dotBtn.style.flexShrink =
            "0";

        /* -----------------------------------------------
           OPEN
           ----------------------------------------------- */

        button.addEventListener(
            "click",
            event => {
                event.preventDefault();

                event.stopPropagation();

                void openConversation(
                    item.id
                );
            }
        );

        /* -----------------------------------------------
           MENU
           ----------------------------------------------- */

        dotBtn.addEventListener(
            "click",
            event => {
                event.preventDefault();

                event.stopPropagation();

                event
                    .stopImmediatePropagation();

                emit(
                    "neyo:history-menu-request",
                    {
                        conversationId:
                            item.id,

                        title:
                            item.title,

                        isPinned:
                            item.is_pinned,

                        anchorElement:
                            dotBtn
                    }
                );
            },
            true
        );

        /* -----------------------------------------------
           RIGHT CLICK
           ----------------------------------------------- */

        row.addEventListener(
            "contextmenu",
            event => {
                event.preventDefault();

                event.stopPropagation();

                emit(
                    "neyo:history-menu-request",
                    {
                        conversationId:
                            item.id,

                        title:
                            item.title,

                        isPinned:
                            item.is_pinned,

                        clientX:
                            event.clientX,

                        clientY:
                            event.clientY
                    }
                );
            }
        );

        row.append(
            button,
            dotBtn
        );

        return row;
    }

    /* =====================================================
       RENDER
       ===================================================== */

    function renderHistory() {
        historyList
            .replaceChildren();

        if (
            state.conversations
                .length === 0
        ) {
            /*
             * Old working baseline left the Recent Chats
             * area clean when there were no conversations.
             */

            emit(
                "neyo:history-rendered",
                {
                    count: 0,

                    conversations: []
                }
            );

            return true;
        }

        const fragment =
            document
                .createDocumentFragment();

        for (
            const item
            of state.conversations
        ) {
            fragment.appendChild(
                createHistoryRow(
                    item
                )
            );
        }

        historyList.appendChild(
            fragment
        );

        syncActiveRows();

        refreshIcons();

        emit(
            "neyo:history-rendered",
            {
                count:
                    state
                        .conversations
                        .length,

                conversations:
                    state
                        .conversations
                        .map(
                            item => ({
                                ...item
                            })
                        ),

                activeConversationId:
                    state
                        .activeConversationId
            }
        );

        return true;
    }

    /* =====================================================
       PERFORM LOAD

       Actual old working ZIP uses:
       GET /api/history
       ===================================================== */

    async function performLoad({
        silent = false
    } = {}) {
        const serial =
            ++state.loadSerial;

        state.loading =
            true;

        if (
            !silent &&
            !state.loaded
        ) {
            renderLoading();
        }

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
                await readJsonResponse(
                    response
                );

            if (
                serial !==
                state.loadSerial
            ) {
                return false;
            }

            const raw =
                Array.isArray(
                    data.conversations
                )
                    ? data.conversations
                    : [];

            state.conversations =
                raw
                    .map(
                        normalizeConversation
                    )
                    .filter(Boolean);

            state.loaded =
                true;

            state.bootstrapRetry =
                0;

            renderHistory();

            emit(
                "neyo:history-loaded",
                {
                    count:
                        state
                            .conversations
                            .length,

                    conversations:
                        state
                            .conversations
                            .map(
                                item => ({
                                    ...item
                                })
                            )
                }
            );

            return true;

        } catch (error) {
            if (
                serial !==
                state.loadSerial
            ) {
                return false;
            }

            /*
             * Important migration protection:
             *
             * modular history.js may initialize slightly
             * before old neo.js finishes auth restore.
             *
             * Never replace a working history list with an
             * empty state because of a temporary 401.
             */

            if (
                error.status === 401 ||
                error.status === 403
            ) {
                scheduleAuthRetry();

                return false;
            }

            console.warn(
                "[NEO History] Load failed:",
                error
            );

            /*
             * If we already have working rows, keep them.
             */

            if (
                !state.loaded &&
                state.conversations
                    .length === 0
            ) {
                historyList
                    .replaceChildren();
            }

            emit(
                "neyo:history-error",
                {
                    action:
                        "load",

                    error
                }
            );

            return false;

        } finally {
            if (
                serial ===
                state.loadSerial
            ) {
                state.loading =
                    false;
            }
        }
    }

    /* =====================================================
       LOAD — DEDUPE

       Old neo.js also deduped history requests with
       historyLoadPromise.
       ===================================================== */

    function loadHistory(
        options = {}
    ) {
        if (
            state.loadPromise &&
            !options.force
        ) {
            return (
                state.loadPromise
            );
        }

        const promise =
            performLoad(
                options
            );

        state.loadPromise =
            promise;

        return promise.finally(
            () => {
                if (
                    state.loadPromise ===
                    promise
                ) {
                    state.loadPromise =
                        null;
                }
            }
        );
    }

    /* =====================================================
       AUTH RETRY

       Prevents the blank "Recent Chats" regression during
       modular + neo.js coexistence.
       ===================================================== */

    function scheduleAuthRetry() {
        const index =
            state.bootstrapRetry;

        if (
            index >=
            CONFIG
                .authRetryDelays
                .length
        ) {
            return;
        }

        state.bootstrapRetry +=
            1;

        const delay =
            CONFIG
                .authRetryDelays[
                index
            ];

        window.setTimeout(
            () => {
                if (
                    state.loaded
                ) {
                    return;
                }

                void loadHistory({
                    silent: true,

                    force: true
                });
            },
            delay
        );
    }

    /* =====================================================
       FETCH CONVERSATION
       ===================================================== */

    async function fetchConversation(
        conversationId,
        signal
    ) {
        const id =
            cleanId(
                conversationId
            );

        if (!id) {
            return null;
        }

        const response =
            await fetch(
                CONFIG.endpoint,
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
                                "get",

                            conversationId:
                                id
                        }),

                    signal
                }
            );

        const data =
            await readJsonResponse(
                response
            );

        const messages =
            Array.isArray(
                data.messages
            )
                ? data.messages
                    .map(
                        cloneMessage
                    )
                    .filter(Boolean)
                : [];

        return {
            conversationId:
                id,

            conversation:
                data.conversation ||
                null,

            messages
        };
    }

    /* =====================================================
       OPEN CONVERSATION
       ===================================================== */

    async function openConversation(
        conversationId
    ) {
        const id =
            cleanId(
                conversationId
            );

        if (!id) {
            return false;
        }

        const serial =
            ++state.openSerial;

        try {
            state.openController
                ?.abort?.();
        } catch {}

        const controller =
            new AbortController();

        state.openController =
            controller;

        state.opening =
            true;

        emit(
            "neyo:history-opening",
            {
                conversationId:
                    id
            }
        );

        try {
            const result =
                await fetchConversation(
                    id,
                    controller.signal
                );

            if (
                !result ||
                controller.signal
                    .aborted ||
                serial !==
                    state.openSerial
            ) {
                return false;
            }

            state
                .activeConversationId =
                id;

            syncActiveRows();

            /* -----------------------------------------------
               CURRENT MODULAR CHAT CONTRACT

               IMPORTANT:
               chat.js expects ONE object argument.
               ----------------------------------------------- */

            const chat =
                chatController();

            if (
                chat &&
                typeof chat
                    .loadConversation ===
                    "function"
            ) {
                chat.loadConversation({
                    conversationId:
                        id,

                    messages:
                        result.messages
                });

            } else {
                /*
                 * Temporary bridge only.
                 */

                emit(
                    "neyo:conversation-loaded",
                    {
                        conversationId:
                            id,

                        conversation:
                            result
                                .conversation,

                        messages:
                            result.messages
                    }
                );
            }

            emit(
                "neyo:history-opened",
                {
                    conversationId:
                        id,

                    conversation:
                        result
                            .conversation,

                    messages:
                        result.messages,

                    messageCount:
                        result
                            .messages
                            .length
                }
            );

            /*
             * Sidebar module decides whether this matters
             * on desktop/mobile.
             */

            emit(
                "neyo:sidebar-close-request",
                {
                    reason:
                        "history-opened"
                }
            );

            return true;

        } catch (error) {
            if (
                controller.signal
                    .aborted ||
                error?.name ===
                    "AbortError"
            ) {
                return false;
            }

            console.warn(
                "[NEO History] Conversation load failed:",
                error
            );

            emit(
                "neyo:history-error",
                {
                    action:
                        "open",

                    conversationId:
                        id,

                    error
                }
            );

            return false;

        } finally {
            if (
                state.openController ===
                controller
            ) {
                state.openController =
                    null;
            }

            if (
                serial ===
                state.openSerial
            ) {
                state.opening =
                    false;
            }
        }
    }

    /* =====================================================
       ACTIVE CONVERSATION SYNC
       ===================================================== */

    window.addEventListener(
        "neyo:chat-state",
        event => {
            const detail =
                event.detail ||
                {};

            if (
                !(
                    "conversationId"
                    in detail
                )
            ) {
                return;
            }

            state
                .activeConversationId =
                cleanId(
                    detail
                        .conversationId
                ) ||
                null;

            syncActiveRows();
        }
    );

    /* =====================================================
       CHAT STATE LOADED
       ===================================================== */

    window.addEventListener(
        "neyo:chat-state-loaded",
        event => {
            const id =
                cleanId(
                    event.detail
                        ?.conversationId
                );

            if (id) {
                state
                    .activeConversationId =
                    id;

                syncActiveRows();
            }
        }
    );

    /* =====================================================
       NEW CHAT
       ===================================================== */

    window.addEventListener(
        "neyo:chat-new",
        () => {
            state
                .activeConversationId =
                null;

            syncActiveRows();
        }
    );

    /* =====================================================
       HISTORY REFRESH REQUEST

       chat.js emits this after a successful reply.
       ===================================================== */

    window.addEventListener(
        "neyo:history-load-request",
        () => {
            void loadHistory({
                silent: true,

                force: true
            });
        }
    );

    /* =====================================================
       EXTERNAL OPEN
       ===================================================== */

    window.addEventListener(
        "neyo:conversation-open-request",
        event => {
            void openConversation(
                event.detail
                    ?.conversationId
            );
        }
    );

    /* =====================================================
       HISTORY MUTATION REFRESH

       history-menu.js owns persistence actions.
       ===================================================== */

    window.addEventListener(
        "neyo:history-deleted",
        () => {
            void loadHistory({
                silent: true,

                force: true
            });
        }
    );

    window.addEventListener(
        "neyo:history-renamed",
        () => {
            void loadHistory({
                silent: true,

                force: true
            });
        }
    );

    window.addEventListener(
        "neyo:history-pin-change",
        () => {
            void loadHistory({
                silent: true,

                force: true
            });
        }
    );

    /* =====================================================
       PUBLIC API
       ===================================================== */

    const api =
        Object.freeze({
            __controller:
                true,

            version:
                VERSION,

            active:
                true,

            load:
                loadHistory,

            loadHistory,

            render:
                renderHistory,

            open:
                openConversation,

            openConversation,

            fetchConversation(
                conversationId
            ) {
                return fetchConversation(
                    conversationId
                );
            },

            setActive(
                conversationId
            ) {
                state
                    .activeConversationId =
                    cleanId(
                        conversationId
                    ) ||
                    null;

                syncActiveRows();

                return true;
            },

            getActive() {
                return (
                    state
                        .activeConversationId
                );
            },

            getConversations() {
                return state
                    .conversations
                    .map(
                        item => ({
                            ...item
                        })
                    );
            },

            getById(
                conversationId
            ) {
                const id =
                    cleanId(
                        conversationId
                    );

                const item =
                    state
                        .conversations
                        .find(
                            conversation =>
                                conversation
                                    .id ===
                                id
                        );

                return item
                    ? {
                        ...item
                    }
                    : null;
            },

            isLoading() {
                return (
                    state.loading
                );
            },

            isOpening() {
                return (
                    state.opening
                );
            },

            getState() {
                return {
                    version:
                        VERSION,

                    active:
                        true,

                    loaded:
                        state.loaded,

                    loading:
                        state.loading,

                    opening:
                        state.opening,

                    count:
                        state
                            .conversations
                            .length,

                    activeConversationId:
                        state
                            .activeConversationId
                };
            }
        });

    Object.defineProperty(
        window,
        "NeyoHistory",
        {
            value:
                api,

            writable:
                false,

            configurable:
                true,

            enumerable:
                true
        }
    );

    /* =====================================================
       BOOTSTRAP

       Don't race authentication immediately.

       This specifically fixes the blank Recent Chats issue
       seen during modular migration.
       ===================================================== */

    function bootstrap() {
        window.setTimeout(
            () => {
                void loadHistory({
                    force: true
                });
            },
            CONFIG.bootstrapDelay
        );
    }

    if (
        document.readyState ===
        "loading"
    ) {
        window.addEventListener(
            "DOMContentLoaded",
            bootstrap,
            {
                once: true
            }
        );

    } else {
        bootstrap();
    }

    /* =====================================================
       READY
       ===================================================== */

    emit(
        "neyo:history-ready",
        {
            version:
                VERSION,

            active:
                true,

            baseline:
                "old-neo.js"
        }
    );
})();
