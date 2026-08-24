/*
=========================================================
NEYO — HISTORY
Production v1 — Stable Hybrid

GOAL:
Old working Recent Chats feel
+
New production features
+
Clean modular ownership

Old preserved:
- History list visual structure
- Loading skeleton
- Active conversation state
- Pinned indicator
- Three-dot menu
- Right-click menu
- Mobile conversation-open behavior

New preserved / improved:
- Full message metadata
- Attachments + sources
- Rename
- Delete
- Pin / unpin
- Stale-request protection
- AbortController
- Silent refresh
- Race-safe loading
- Better errors
- Single NeyoChat conversation owner

Owns:
- History list data
- History list DOM
- History loading
- Conversation fetching
- Conversation opening
- Active history state
- Rename persistence
- Delete persistence
- Pin / unpin persistence

Does NOT own:
- History popup positioning/UI
- Share UI
- Rename modal
- Delete modal
- Message DOM
- Chat networking
- Sidebar DOM
=========================================================
*/

(() => {
    "use strict";

    const VERSION =
        "neyo-history-production-v1";

    if (
        window.NeyoHistory
            ?.__controller === true
    ) {
        return;
    }

    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG =
        Object.freeze({
            endpoint:
                "/api/history",

            maxTitleLength:
                100,

            maxConversationIdLength:
                160,

            defaultTitle:
                "New conversation"
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
            "[NEYO History] #historyList missing."
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

        loadingPromise:
            null,

        loadSerial:
            0,

        openSerial:
            0,

        openController:
            null,

        lastError:
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
            CONFIG
                .maxConversationIdLength
        );
    }

    function cleanTitle(value) {
        const title =
            clean(
                value,
                CONFIG.maxTitleLength
            )
                .replace(
                    /\s+/g,
                    " "
                );

        return (
            title ||
            CONFIG.defaultTitle
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
       CONTROLLERS
       ===================================================== */

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

    async function readJson(
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
                cleanTitle(
                    item.title
                ),

            is_pinned:
                Boolean(
                    item.is_pinned ??
                    item.isPinned ??
                    item.pinned
                )
        };
    }

    /* =====================================================
       NORMALIZE MESSAGE

       Important:
       Never reduce history message to role/content only.

       Preserve:
       - id
       - attachments
       - sources
       - citations
       - timestamps
       - tool metadata
       - future backend fields
       ===================================================== */

    function normalizeMessage(
        message
    ) {
        if (
            !message ||
            typeof message !==
                "object"
        ) {
            return null;
        }

        return {
            ...message,

            role:
                clean(
                    message.role,
                    32
                ),

            content:
                typeof message.content ===
                    "string"
                    ? message.content
                    : "",

            attachments:
                Array.isArray(
                    message.attachments
                )
                    ? message
                        .attachments
                        .map(
                            attachment =>
                                attachment &&
                                typeof attachment ===
                                    "object"
                                    ? {
                                        ...attachment
                                    }
                                    : attachment
                        )
                    : [],

            sources:
                Array.isArray(
                    message.sources
                )
                    ? message
                        .sources
                        .map(
                            source =>
                                source &&
                                typeof source ===
                                    "object"
                                    ? {
                                        ...source
                                    }
                                    : source
                        )
                    : []
        };
    }

    /* =====================================================
       CLONES
       ===================================================== */

    function cloneConversation(
        item
    ) {
        return item
            ? {
                ...item
            }
            : null;
    }

    function cloneConversations() {
        return state
            .conversations
            .map(
                cloneConversation
            );
    }

    /* =====================================================
       LOADING UI

       Old working visual structure preserved.
       ===================================================== */

    function renderLoading() {
        historyList.innerHTML = `
            <div
                class="history-loading"
                aria-hidden="true"
            >
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
       EMPTY

       Keep old clean sidebar feel.
       ===================================================== */

    function renderEmpty() {
        historyList
            .replaceChildren();
    }

    /* =====================================================
       ERROR

       Don't destroy working history during silent refresh.
       ===================================================== */

    function renderError() {
        historyList
            .replaceChildren();

        const root =
            document.createElement(
                "div"
            );

        root.className =
            "history-error-state";

        const text =
            document.createElement(
                "div"
            );

        text.className =
            "history-error-text";

        text.textContent =
            "Unable to load chats";

        const retry =
            document.createElement(
                "button"
            );

        retry.type =
            "button";

        retry.className =
            "history-retry-btn";

        retry.textContent =
            "Retry";

        retry.addEventListener(
            "click",
            () => {
                void loadHistory({
                    force: true
                });
            }
        );

        root.append(
            text,
            retry
        );

        historyList.appendChild(
            root
        );
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
                cleanId(
                    row.dataset.id ||
                    row.dataset
                        .conversationId
                );

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

            const button =
                row.querySelector(
                    ".history-item"
                );

            button?.classList
                .toggle(
                    "active",
                    active
                );

            if (button) {
                button.setAttribute(
                    "aria-current",
                    active
                        ? "page"
                        : "false"
                );
            }
        }
    }

    /* =====================================================
       MENU REQUEST
       ===================================================== */

    function requestMenu(
        item,
        extra = {}
    ) {
        emit(
            "neyo:history-menu-request",
            {
                conversationId:
                    item.id,

                title:
                    item.title,

                isPinned:
                    Boolean(
                        item.is_pinned
                    ),

                ...extra
            }
        );
    }

    /* =====================================================
       CREATE HISTORY ROW

       Visual DOM follows old working structure.

       .history-item-wrapper
          .history-item
          .history-three-dot
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

        /* -----------------------------------------------
           MAIN CHAT BUTTON
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

        button.title =
            item.title;

        button.setAttribute(
            "aria-label",
            `Open ${item.title}`
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
            item.title;

        button.appendChild(
            title
        );

        /* -----------------------------------------------
           PIN INDICATOR
           ----------------------------------------------- */

        if (
            item.is_pinned
        ) {
            const pin =
                document.createElement(
                    "span"
                );

            pin.className =
                "history-pin-icon";

            pin.setAttribute(
                "aria-label",
                "Pinned"
            );

            const icon =
                document.createElement(
                    "i"
                );

            icon.setAttribute(
                "data-lucide",
                "pin"
            );

            icon.setAttribute(
                "width",
                "12"
            );

            icon.setAttribute(
                "height",
                "12"
            );

            icon.setAttribute(
                "aria-hidden",
                "true"
            );

            pin.appendChild(
                icon
            );

            button.appendChild(
                pin
            );
        }

        /* -----------------------------------------------
           OPEN CHAT
           ----------------------------------------------- */

        button.addEventListener(
            "click",
            event => {
                event.preventDefault();

                void openConversation(
                    item.id
                );
            }
        );

        /* -----------------------------------------------
           THREE DOT

           Old visual:
           vertical dots.

           history-menu.js owns actual menu UI.
           ----------------------------------------------- */

        const menuButton =
            document.createElement(
                "button"
            );

        menuButton.type =
            "button";

        menuButton.className =
            "history-three-dot";

        menuButton.setAttribute(
            "aria-label",
            "Conversation options"
        );

        menuButton.setAttribute(
            "aria-haspopup",
            "menu"
        );

        const menuIcon =
            document.createElement(
                "i"
            );

        menuIcon.setAttribute(
            "data-lucide",
            "more-vertical"
        );

        menuIcon.setAttribute(
            "width",
            "16"
        );

        menuIcon.setAttribute(
            "height",
            "16"
        );

        menuIcon.setAttribute(
            "aria-hidden",
            "true"
        );

        menuButton.appendChild(
            menuIcon
        );

        menuButton.addEventListener(
            "click",
            event => {
                event.preventDefault();

                event.stopPropagation();

                requestMenu(
                    item,
                    {
                        anchorElement:
                            menuButton
                    }
                );
            }
        );

        /* -----------------------------------------------
           RIGHT CLICK
           ----------------------------------------------- */

        row.addEventListener(
            "contextmenu",
            event => {
                event.preventDefault();

                event.stopPropagation();

                requestMenu(
                    item,
                    {
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
            menuButton
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
            renderEmpty();

            emit(
                "neyo:history-rendered",
                {
                    conversations:
                        [],

                    count:
                        0,

                    activeConversationId:
                        state
                            .activeConversationId
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
                conversations:
                    cloneConversations(),

                count:
                    state
                        .conversations
                        .length,

                activeConversationId:
                    state
                        .activeConversationId
            }
        );

        return true;
    }

    /* =====================================================
       LOAD HISTORY

       New backend supports:
       GET /api/history
       ===================================================== */

    async function performLoadHistory({
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
                await readJson(
                    response
                );

            /*
             * Another newer request won.
             */

            if (
                serial !==
                state.loadSerial
            ) {
                return (
                    cloneConversations()
                );
            }

            const raw =
                Array.isArray(
                    data?.conversations
                )
                    ? data.conversations
                    : Array.isArray(
                        data?.history
                    )
                        ? data.history
                        : [];

            state.conversations =
                raw
                    .map(
                        normalizeConversation
                    )
                    .filter(Boolean);

            state.loaded =
                true;

            state.lastError =
                null;

            renderHistory();

            emit(
                "neyo:history-loaded",
                {
                    conversations:
                        cloneConversations(),

                    count:
                        state
                            .conversations
                            .length
                }
            );

            return (
                cloneConversations()
            );

        } catch (error) {
            if (
                serial !==
                state.loadSerial
            ) {
                return (
                    cloneConversations()
                );
            }

            state.lastError =
                error;

            console.error(
                "[NEYO History] Load failed:",
                error
            );

            /*
             * Background refresh failure must NOT wipe
             * already-visible working chats.
             */

            if (
                !silent &&
                state.conversations
                    .length === 0
            ) {
                renderError();
            }

            emit(
                "neyo:history-error",
                {
                    action:
                        "list",

                    error
                }
            );

            return (
                cloneConversations()
            );

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
       LOAD DEDUPE
       ===================================================== */

    function loadHistory(
        options = {}
    ) {
        const force =
            Boolean(
                options.force
            );

        if (
            state.loadingPromise &&
            !force
        ) {
            return (
                state.loadingPromise
            );
        }

        if (force) {
            state.loadSerial += 1;
        }

        const promise =
            performLoadHistory(
                options
            );

        state.loadingPromise =
            promise;

        return promise.finally(
            () => {
                if (
                    state.loadingPromise ===
                    promise
                ) {
                    state.loadingPromise =
                        null;
                }
            }
        );
    }

    /* =====================================================
       FETCH CONVERSATION

       History backend:
       POST /api/history
       action: "get"
       ===================================================== */

    async function fetchConversation(
        conversationId,
        {
            signal
        } = {}
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
            await readJson(
                response
            );

        return {
            conversationId:
                id,

            conversation:
                data?.conversation &&
                typeof data
                    .conversation ===
                    "object"
                    ? {
                        ...data
                            .conversation
                    }
                    : null,

            messages:
                Array.isArray(
                    data?.messages
                )
                    ? data.messages
                        .map(
                            normalizeMessage
                        )
                        .filter(Boolean)
                    : []
        };
    }

    /* =====================================================
       OPEN CONVERSATION

       Production improvement:
       A → B rapid clicks cannot allow slow A response
       to overwrite newer B.
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

        /*
         * Current chat already open.
         */

        try {
            if (
                id ===
                    state
                        .activeConversationId &&
                chatController()
                    ?.getConversationId
                    ?.() === id
            ) {
                emit(
                    "neyo:sidebar-close-request",
                    {
                        reason:
                            "history-opened"
                    }
                );

                return true;
            }
        } catch {}

        const serial =
            ++state.openSerial;

        try {
            state.openController
                ?.abort?.(
                    "conversation-switch"
                );
        } catch {
            try {
                state.openController
                    ?.abort?.();
            } catch {}
        }

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
                    {
                        signal:
                            controller.signal
                    }
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

            /*
             * SINGLE OWNER:
             * NeyoChat owns canonical conversation.
             */

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
                 * Migration compatibility.
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
             * Sidebar decides desktop/mobile behavior.
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

            console.error(
                "[NEYO History] Conversation open failed:",
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
       GENERIC ACTION
       ===================================================== */

    async function performAction(
        action,
        conversationId,
        payload = {}
    ) {
        const id =
            cleanId(
                conversationId
            );

        if (!id) {
            throw new Error(
                "Conversation ID is required."
            );
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
                            action,

                            conversationId:
                                id,

                            ...payload
                        })
                }
            );

        return readJson(
            response
        );
    }

    /* =====================================================
       RENAME

       New feature preserved.
       ===================================================== */

    async function renameConversation(
        conversationId,
        title
    ) {
        const id =
            cleanId(
                conversationId
            );

        const nextTitle =
            clean(
                title,
                CONFIG.maxTitleLength
            )
                .replace(
                    /\s+/g,
                    " "
                );

        if (
            !id ||
            !nextTitle
        ) {
            return false;
        }

        const index =
            state
                .conversations
                .findIndex(
                    item =>
                        item.id === id
                );

        if (
            index >= 0 &&
            state
                .conversations[
                index
            ].title ===
                nextTitle
        ) {
            return true;
        }

        await performAction(
            "rename",
            id,
            {
                title:
                    nextTitle
            }
        );

        if (index >= 0) {
            state.conversations[
                index
            ] = {
                ...state
                    .conversations[
                    index
                ],

                title:
                    nextTitle
            };

            renderHistory();
        }

        emit(
            "neyo:history-renamed",
            {
                conversationId:
                    id,

                title:
                    nextTitle
            }
        );

        return true;
    }

    /* =====================================================
       DELETE

       New feature preserved.

       history.js owns persistence/state.
       new-chat.js owns clean UI after active delete.
       ===================================================== */

    async function deleteConversation(
        conversationId
    ) {
        const id =
            cleanId(
                conversationId
            );

        if (!id) {
            return false;
        }

        await performAction(
            "delete",
            id
        );

        const deletedActive =
            state
                .activeConversationId ===
                id;

        state.conversations =
            state.conversations
                .filter(
                    item =>
                        item.id !== id
                );

        if (deletedActive) {
            state
                .activeConversationId =
                null;

            /*
             * Stop stale conversation request.
             */

            state.openSerial +=
                1;

            try {
                state
                    .openController
                    ?.abort?.(
                        "conversation-deleted"
                    );
            } catch {}

            emit(
                "neyo:active-conversation-deleted",
                {
                    conversationId:
                        id
                }
            );
        }

        renderHistory();

        emit(
            "neyo:history-deleted",
            {
                conversationId:
                    id,

                active:
                    deletedActive
            }
        );

        return true;
    }

    /* =====================================================
       PIN / UNPIN

       New feature preserved.
       ===================================================== */

    async function setPinned(
        conversationId,
        pinned
    ) {
        const id =
            cleanId(
                conversationId
            );

        if (!id) {
            return false;
        }

        const value =
            Boolean(
                pinned
            );

        await performAction(
            value
                ? "pin"
                : "unpin",
            id
        );

        const index =
            state
                .conversations
                .findIndex(
                    item =>
                        item.id === id
                );

        if (index >= 0) {
            state.conversations[
                index
            ] = {
                ...state
                    .conversations[
                    index
                ],

                is_pinned:
                    value
            };

            /*
             * Pinned conversations first.
             * Keep backend order within same group.
             */

            state.conversations =
                state.conversations
                    .map(
                        (
                            item,
                            position
                        ) => ({
                            item,
                            position
                        })
                    )
                    .sort(
                        (a, b) => {
                            if (
                                a.item
                                    .is_pinned !==
                                b.item
                                    .is_pinned
                            ) {
                                return a
                                    .item
                                    .is_pinned
                                    ? -1
                                    : 1;
                            }

                            return (
                                a.position -
                                b.position
                            );
                        }
                    )
                    .map(
                        entry =>
                            entry.item
                    );

            renderHistory();
        }

        emit(
            "neyo:history-pin-change",
            {
                conversationId:
                    id,

                pinned:
                    value
            }
        );

        return true;
    }

    /* =====================================================
       ACTIVE SET
       ===================================================== */

    function setActiveConversation(
        conversationId
    ) {
        const id =
            cleanId(
                conversationId
            ) ||
            null;

        if (
            state
                .activeConversationId ===
            id
        ) {
            return true;
        }

        state.activeConversationId =
            id;

        syncActiveRows();

        emit(
            "neyo:history-active-change",
            {
                conversationId:
                    id
            }
        );

        return true;
    }

    /* =====================================================
       HISTORY MENU REQUESTS
       ===================================================== */

    window.addEventListener(
        "neyo:history-rename-request",
        event => {
            void renameConversation(
                event.detail
                    ?.conversationId,

                event.detail
                    ?.title
            ).catch(
                error => {
                    emit(
                        "neyo:history-error",
                        {
                            action:
                                "rename",

                            conversationId:
                                event.detail
                                    ?.conversationId,

                            error
                        }
                    );
                }
            );
        }
    );

    window.addEventListener(
        "neyo:history-delete-request",
        event => {
            void deleteConversation(
                event.detail
                    ?.conversationId
            ).catch(
                error => {
                    emit(
                        "neyo:history-error",
                        {
                            action:
                                "delete",

                            conversationId:
                                event.detail
                                    ?.conversationId,

                            error
                        }
                    );
                }
            );
        }
    );

    window.addEventListener(
        "neyo:history-pin-request",
        event => {
            void setPinned(
                event.detail
                    ?.conversationId,

                event.detail
                    ?.pinned
            ).catch(
                error => {
                    emit(
                        "neyo:history-error",
                        {
                            action:
                                "pin",

                            conversationId:
                                event.detail
                                    ?.conversationId,

                            error
                        }
                    );
                }
            );
        }
    );

    /* =====================================================
       LOAD REQUEST

       Chat can request silent sidebar refresh after send.
       ===================================================== */

    window.addEventListener(
        "neyo:history-load-request",
        event => {
            void loadHistory({
                silent:
                    state.loaded,

                force:
                    Boolean(
                        event.detail
                            ?.force
                    )
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
       ACTIVE SET EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:history-active-set",
        event => {
            setActiveConversation(
                event.detail
                    ?.conversationId
            );
        }
    );

    /* =====================================================
       CHAT STATE LOADED
       ===================================================== */

    window.addEventListener(
        "neyo:chat-state-loaded",
        event => {
            setActiveConversation(
                event.detail
                    ?.conversationId
            );
        }
    );

    /* =====================================================
       CHAT STATE SYNC

       Important when new conversation ID is created by
       backend after first message.
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

            setActiveConversation(
                event.detail
                    ?.conversationId
            );
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

            state.openSerial +=
                1;

            try {
                state
                    .openController
                    ?.abort?.(
                        "new-chat"
                    );
            } catch {}

            state.openController =
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

            fetchConversation,

            rename:
                renameConversation,

            delete:
                deleteConversation,

            setPinned,

            setActive:
                setActiveConversation,

            getActive() {
                return (
                    state
                        .activeConversationId
                );
            },

            getConversations() {
                return (
                    cloneConversations()
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
                                    .id === id
                        );

                return (
                    cloneConversation(
                        item
                    )
                );
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
                            .activeConversationId,

                    hasError:
                        Boolean(
                            state.lastError
                        )
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

       Keep initial load simple.
       No arbitrary auth retry machinery here.

       Auth/session owner should establish session;
       history handles history.
       ===================================================== */

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

            oldUI:
                true,

            rename:
                true,

            delete:
                true,

            pin:
                true,

            attachments:
                true,

            sources:
                true,

            staleRequestProtection:
                true
        }
    );
})();
