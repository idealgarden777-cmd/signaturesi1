/*
=========================================================
NEO — RECENT HISTORY
Production v1 — Old neo.js Baseline + Safe Improvements

Baseline preserved:
- POST /api/history
- action: "list"
- limit: 100
- action: "get"
- #historyList
- #historySearchInput
- #clearHistorySearchBtn
- .history-item
- .history-item-title
- .history-item-actions
- .history-action-btn
- active history row
- "No recent chats"
- "Unable to load recent chats"
- mobile sidebar closes after opening a chat

Safe improvements:
- One list fetch; search filters locally
- Full message metadata preserved
- Stale A→B conversation protection
- Active-row sync with NeyoChat
- No direct message DOM ownership
- No direct sidebar DOM ownership

Owns:
- Recent history list
- History search
- Conversation fetch/open request
- Active history row

Does NOT own:
- History popup menu actions
- Rename / delete / pin / share
- Message rendering
- Chat conversation state
- Sidebar
=========================================================
*/

(() => {
    "use strict";

    const VERSION =
        "neo-history-production-v1";

    if (
        window.NeyoHistory?.__controller === true
    ) {
        return;
    }

    /* =====================================================
       DOM
       ===================================================== */

    const historyList =
        document.getElementById(
            "historyList"
        );

    const historySearchInput =
        document.getElementById(
            "historySearchInput"
        );

    const clearHistorySearchBtn =
        document.getElementById(
            "clearHistorySearchBtn"
        );

    if (!historyList) {
        console.warn(
            "[NEO History] #historyList missing."
        );

        return;
    }

    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG =
        Object.freeze({
            endpoint:
                "/api/history",

            limit:
                100
        });

    /* =====================================================
       STATE
       ===================================================== */

    const state = {
        conversations: [],

        query: "",

        activeConversationId:
            null,

        loading:
            false,

        opening:
            false,

        loadSerial:
            0,

        openSerial:
            0,

        openController:
            null
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

    /* =====================================================
       JSON
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
            throw new Error(
                data?.error ||
                data?.message ||
                raw ||
                `Request failed (${response.status})`
            );
        }

        return data;
    }

    /* =====================================================
       NORMALIZE HISTORY ITEM
       ===================================================== */

    function normalizeConversation(
        item
    ) {
        if (
            !item ||
            typeof item !==
                "object"
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
                "New Chat"
        };
    }

    /* =====================================================
       FILTER

       Old app re-fetched history on every search keystroke.

       Same visible result, but now filtering local state is
       instant and avoids unnecessary network requests.
       ===================================================== */

    function getVisibleConversations() {
        if (!state.query) {
            return (
                state.conversations
            );
        }

        return state
            .conversations
            .filter(chat =>
                String(
                    chat.title ||
                    ""
                )
                    .toLowerCase()
                    .includes(
                        state.query
                    )
            );
    }

    /* =====================================================
       SIMPLE STATUS ROW
       ===================================================== */

    function createStatusRow(
        text,
        className
    ) {
        const element =
            document.createElement(
                "div"
            );

        element.className =
            className;

        element.textContent =
            text;

        /*
         * Preserve old visual fallback without requiring a
         * CSS rewrite right now.
         */

        element.style.padding =
            "10px";

        element.style.color =
            "var(--text-muted)";

        element.style.fontSize =
            "12px";

        return element;
    }

    /* =====================================================
       ACTIVE ROW
       ===================================================== */

    function syncActiveRows() {
        for (
            const element
            of historyList
                .querySelectorAll(
                    ".history-item"
                )
        ) {
            const active =
                element.dataset
                    .conversationId ===
                state
                    .activeConversationId;

            element.classList.toggle(
                "active",
                active
            );

            element.setAttribute(
                "aria-current",
                active
                    ? "true"
                    : "false"
            );
        }
    }

    /* =====================================================
       CREATE ROW

       Exact old DOM hierarchy preserved:
       .history-item
           .history-item-title
           .history-item-actions
               .history-action-btn
       ===================================================== */

    function createHistoryItem(
        chat
    ) {
        const item =
            document.createElement(
                "div"
            );

        item.className =
            "history-item";

        item.dataset
            .conversationId =
            chat.id;

        item.classList.toggle(
            "active",
            state
                .activeConversationId ===
                chat.id
        );

        item.setAttribute(
            "role",
            "button"
        );

        item.setAttribute(
            "tabindex",
            "0"
        );

        item.setAttribute(
            "aria-label",
            `Open ${chat.title}`
        );

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
            chat.title ||
            "New Chat";

        /* -----------------------------------------------
           ACTIONS
           ----------------------------------------------- */

        const actions =
            document.createElement(
                "div"
            );

        actions.className =
            "history-item-actions";

        const actionButton =
            document.createElement(
                "button"
            );

        actionButton.className =
            "history-action-btn";

        actionButton.type =
            "button";

        actionButton.dataset
            .conversationId =
            chat.id;

        actionButton.setAttribute(
            "aria-label",
            "Conversation options"
        );

        const icon =
            document.createElement(
                "i"
            );

        icon.setAttribute(
            "data-lucide",
            "more-horizontal"
        );

        icon.setAttribute(
            "size",
            "14"
        );

        icon.setAttribute(
            "aria-hidden",
            "true"
        );

        actionButton.appendChild(
            icon
        );

        actions.appendChild(
            actionButton
        );

        item.append(
            title,
            actions
        );

        /* -----------------------------------------------
           OPEN CHAT
           ----------------------------------------------- */

        const open = () => {
            void openConversation(
                chat.id
            );
        };

        item.addEventListener(
            "click",
            event => {
                if (
                    event.target
                        instanceof
                        Element &&
                    event.target.closest(
                        ".history-action-btn"
                    )
                ) {
                    return;
                }

                open();
            }
        );

        item.addEventListener(
            "keydown",
            event => {
                if (
                    event.key !==
                        "Enter" &&
                    event.key !==
                        " "
                ) {
                    return;
                }

                if (
                    event.target !==
                    item
                ) {
                    return;
                }

                event.preventDefault();

                open();
            }
        );

        /* -----------------------------------------------
           MENU REQUEST

           history-menu.js will become the owner next.

           This button does NOT perform rename/delete/pin.
           ----------------------------------------------- */

        actionButton.addEventListener(
            "click",
            event => {
                event.preventDefault();

                event.stopPropagation();

                emit(
                    "neyo:history-menu-request",
                    {
                        conversationId:
                            chat.id,

                        title:
                            chat.title,

                        isPinned:
                            Boolean(
                                chat.is_pinned ??
                                chat.isPinned ??
                                chat.pinned
                            ),

                        anchorElement:
                            actionButton
                    }
                );
            }
        );

        return item;
    }

    /* =====================================================
       RENDER
       ===================================================== */

    function renderHistory() {
        historyList
            .replaceChildren();

        const visible =
            getVisibleConversations();

        /* -----------------------------------------------
           DATABASE EMPTY
           ----------------------------------------------- */

        if (
            state.conversations
                .length === 0
        ) {
            historyList.appendChild(
                createStatusRow(
                    "No recent chats",
                    "history-empty"
                )
            );

            return true;
        }

        /* -----------------------------------------------
           SEARCH EMPTY

           Better than old blank sidebar.
           ----------------------------------------------- */

        if (
            visible.length ===
            0
        ) {
            historyList.appendChild(
                createStatusRow(
                    "No matching chats",
                    "history-empty"
                )
            );

            return true;
        }

        const fragment =
            document
                .createDocumentFragment();

        for (
            const chat
            of visible
        ) {
            fragment.appendChild(
                createHistoryItem(
                    chat
                )
            );
        }

        historyList.appendChild(
            fragment
        );

        refreshIcons();

        syncActiveRows();

        emit(
            "neyo:history-rendered",
            {
                count:
                    visible.length,

                total:
                    state
                        .conversations
                        .length,

                query:
                    state.query
            }
        );

        return true;
    }

    /* =====================================================
       LOADING
       ===================================================== */

    function renderLoading() {
        historyList
            .replaceChildren(
                createStatusRow(
                    "Loading chats...",
                    "history-loading"
                )
            );
    }

    /* =====================================================
       LOAD LIST

       Exact old backend contract:
       POST /api/history
       {
           action: "list",
           limit: 100
       }
       ===================================================== */

    async function loadHistory({
        silent = false
    } = {}) {
        const serial =
            ++state.loadSerial;

        state.loading =
            true;

        if (!silent) {
            renderLoading();
        }

        try {
            const response =
                await fetch(
                    CONFIG.endpoint,
                    {
                        method:
                            "POST",

                        credentials:
                            "include",

                        headers: {
                            "Content-Type":
                                "application/json",

                            Accept:
                                "application/json"
                        },

                        cache:
                            "no-store",

                        body:
                            JSON.stringify({
                                action:
                                    "list",

                                limit:
                                    CONFIG.limit
                            })
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
                    : Array.isArray(
                        data.history
                    )
                        ? data.history
                        : [];

            state.conversations =
                raw
                    .map(
                        normalizeConversation
                    )
                    .filter(Boolean);

            renderHistory();

            emit(
                "neyo:history-loaded",
                {
                    conversations:
                        state
                            .conversations
                            .map(
                                item => ({
                                    ...item
                                })
                            ),

                    count:
                        state
                            .conversations
                            .length
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

            console.error(
                "[NEO History] Loading failed:",
                error
            );

            historyList
                .replaceChildren(
                    createStatusRow(
                        "Unable to load recent chats",
                        "history-error-state"
                    )
                );

            emit(
                "neyo:history-error",
                {
                    action:
                        "list",

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
       CLONE MESSAGE

       Old neo.js reduced history messages to only:
       role + content.

       That breaks:
       - attachments
       - sources
       - IDs
       - metadata

       Preserve full backend message object instead.
       ===================================================== */

    function cloneMessage(
        message
    ) {
        if (
            !message ||
            typeof message !==
                "object"
        ) {
            return message;
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
                            attachment => ({
                                ...attachment
                            })
                        )
                    : message
                        .attachments,

            sources:
                Array.isArray(
                    message.sources
                )
                    ? message
                        .sources
                        .map(
                            source => ({
                                ...source
                            })
                        )
                    : message.sources
        };
    }

    /* =====================================================
       OPEN CONVERSATION

       Exact old backend:
       action: "get"

       Safe improvement:
       Abort previous A request when B clicked.
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
            const response =
                await fetch(
                    CONFIG.endpoint,
                    {
                        method:
                            "POST",

                        credentials:
                            "include",

                        headers: {
                            "Content-Type":
                                "application/json",

                            Accept:
                                "application/json"
                        },

                        cache:
                            "no-store",

                        body:
                            JSON.stringify({
                                action:
                                    "get",

                                conversationId:
                                    id
                            }),

                        signal:
                            controller.signal
                    }
                );

            const data =
                await readJsonResponse(
                    response
                );

            if (
                controller.signal
                    .aborted ||
                serial !==
                    state.openSerial
            ) {
                return false;
            }

            const messages =
                Array.isArray(
                    data.messages
                )
                    ? data.messages
                        .map(
                            cloneMessage
                        )
                    : [];

            state
                .activeConversationId =
                id;

            syncActiveRows();

            /*
             * CHAT OWNERSHIP BOUNDARY
             *
             * history.js fetches conversation.
             * NeyoChat becomes canonical owner.
             */

            const chat =
                window.NeyoChat;

            let delegated =
                false;

            if (
                chat?.__controller ===
                    true &&
                typeof chat
                    .loadConversation ===
                    "function"
            ) {
                try {
                    chat.loadConversation(
                        id,
                        messages,
                        data.conversation ||
                            null
                    );

                    delegated =
                        true;

                } catch (error) {
                    console.warn(
                        "[NEO History] Direct chat load delegation failed:",
                        error
                    );
                }
            }

            /*
             * Event bridge remains available while modules
             * are still migrating.
             */

            if (!delegated) {
                emit(
                    "neyo:conversation-loaded",
                    {
                        conversationId:
                            id,

                        conversation:
                            data.conversation ||
                            null,

                        messages
                    }
                );
            }

            emit(
                "neyo:history-opened",
                {
                    conversationId:
                        id,

                    conversation:
                        data.conversation ||
                        null,

                    messages,

                    messageCount:
                        messages.length
                }
            );

            /*
             * sidebar.js owns mobile closing.
             */

            emit(
                "neyo:sidebar-close-request",
                {
                    reason:
                        "history-opened"
                }
            );

            /*
             * Refresh titles/order without flashing loader.
             */

            void loadHistory({
                silent: true
            });

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

            console.error(
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
       SEARCH

       Capture phase prevents old neo.js search listener
       from making another network request.
       ===================================================== */

    historySearchInput
        ?.addEventListener(
            "input",
            event => {
                event.stopImmediatePropagation();

                state.query =
                    String(
                        event.target
                            ?.value ||
                        ""
                    )
                        .trim()
                        .toLowerCase();

                if (
                    clearHistorySearchBtn
                ) {
                    clearHistorySearchBtn
                        .hidden =
                        !state.query;
                }

                renderHistory();
            },
            true
        );

    /* =====================================================
       CLEAR SEARCH
       ===================================================== */

    clearHistorySearchBtn
        ?.addEventListener(
            "click",
            event => {
                event.preventDefault();

                event.stopPropagation();

                event
                    .stopImmediatePropagation();

                if (
                    historySearchInput
                ) {
                    historySearchInput
                        .value =
                        "";
                }

                state.query =
                    "";

                clearHistorySearchBtn
                    .hidden =
                    true;

                renderHistory();

                historySearchInput
                    ?.focus();
            },
            true
        );

    /* =====================================================
       ACTIVE CHAT SYNC
       ===================================================== */

    window.addEventListener(
        "neyo:chat-state",
        event => {
            if (
                !(
                    "conversationId"
                    in (
                        event.detail ||
                        {}
                    )
                )
            ) {
                return;
            }

            state
                .activeConversationId =
                cleanId(
                    event.detail
                        ?.conversationId
                ) ||
                null;

            syncActiveRows();
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
       REFRESH REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:history-load-request",
        () => {
            void loadHistory({
                silent:
                    state
                        .conversations
                        .length > 0
            });
        }
    );

    /* =====================================================
       EXTERNAL OPEN REQUEST
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
       ACTIVE SET
       ===================================================== */

    window.addEventListener(
        "neyo:history-active-set",
        event => {
            state
                .activeConversationId =
                cleanId(
                    event.detail
                        ?.conversationId
                ) ||
                null;

            syncActiveRows();
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

            setSearch(
                value
            ) {
                state.query =
                    String(
                        value ?? ""
                    )
                        .trim()
                        .toLowerCase();

                if (
                    historySearchInput
                ) {
                    historySearchInput
                        .value =
                        value ?? "";
                }

                if (
                    clearHistorySearchBtn
                ) {
                    clearHistorySearchBtn
                        .hidden =
                        !state.query;
                }

                renderHistory();

                return true;
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

            getActive() {
                return (
                    state
                        .activeConversationId
                );
            },

            getState() {
                return {
                    version:
                        VERSION,

                    active:
                        true,

                    loading:
                        state.loading,

                    opening:
                        state.opening,

                    query:
                        state.query,

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
       INIT

       Old neo.js automatically loaded recent chats after
       initialization/authentication.

       Modular history also attempts initial load itself.
       ===================================================== */

    if (
        clearHistorySearchBtn
    ) {
        clearHistorySearchBtn
            .hidden =
            true;
    }

    queueMicrotask(
        () => {
            void loadHistory();
        }
    );

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
