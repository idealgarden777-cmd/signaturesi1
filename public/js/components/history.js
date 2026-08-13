/*
=========================================================
NEYO — HISTORY COMPONENT

Owns:
- Load conversation history
- Render history list
- Open conversation data
- Rename conversation
- Delete conversation
- Pin / unpin conversation
- History loading state
- Public history API

Does NOT own:
- History popup positioning
- Rename modal UI
- Delete confirmation UI
- Message rendering
- Chat sending
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const historyList =
        document.getElementById(
            "historyList"
        );


    if (!historyList) {
        return;
    }


    /* =====================================================
       STATE
       ===================================================== */

    let conversations = [];

    let activeConversationId =
        null;

    let loadingPromise =
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


    const refreshIcons = () => {

        if (
            window.lucide
                ?.createIcons
        ) {

            window.lucide
                .createIcons();

        }

    };


    const readJson = async response => {

        const data =
            await response
                .json()
                .catch(
                    () => ({})
                );


        if (!response.ok) {

            throw new Error(
                data?.error ||
                `Request failed (${response.status})`
            );

        }


        return data;

    };


    /* =====================================================
       LOADING UI
       ===================================================== */

    const renderLoading = () => {

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

    };


    /* =====================================================
       EMPTY UI
       ===================================================== */

    const renderEmpty = () => {

        historyList.replaceChildren();

    };


    /* =====================================================
       CREATE HISTORY ROW
       ===================================================== */

    const createHistoryRow =
        item => {

            const row =
                document.createElement(
                    "div"
                );


            row.className =
                "history-item-wrapper";


            row.dataset.id =
                item.id;


            /* -----------------------------------------
               MAIN BUTTON
               ----------------------------------------- */

            const button =
                document.createElement(
                    "button"
                );


            button.type =
                "button";


            button.className =
                "history-item";


            button.dataset.conversationId =
                item.id;


            button.title =
                item.title ||
                "New conversation";


            /* -----------------------------------------
               TITLE
               ----------------------------------------- */

            const title =
                document.createElement(
                    "span"
                );


            title.className =
                "history-item-title";


            title.textContent =
                item.title ||
                "New conversation";


            button.appendChild(
                title
            );


            /* -----------------------------------------
               PIN ICON
               ----------------------------------------- */

            if (item.is_pinned) {

                const pin =
                    document.createElement(
                        "span"
                    );


                pin.className =
                    "history-pin-icon";


                pin.innerHTML = `
                    <i
                        data-lucide="pin"
                        width="12"
                        height="12"
                        aria-hidden="true"
                    ></i>
                `;


                button.appendChild(
                    pin
                );

            }


            /* -----------------------------------------
               ACTIVE STATE
               ----------------------------------------- */

            button.classList.toggle(
                "active",
                item.id ===
                    activeConversationId
            );


            /* -----------------------------------------
               OPEN
               ----------------------------------------- */

            button.addEventListener(
                "click",
                () => {

                    openConversation(
                        item.id
                    );

                }
            );


            /* -----------------------------------------
               MENU BUTTON
               ----------------------------------------- */

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


            menuButton.innerHTML = `
                <i
                    data-lucide="more-vertical"
                    width="16"
                    height="16"
                    aria-hidden="true"
                ></i>
            `;


            menuButton.addEventListener(
                "click",
                event => {

                    event.preventDefault();
                    event.stopPropagation();


                    emit(
                        "neyo:history-menu-request",
                        {
                            conversationId:
                                item.id,

                            title:
                                item.title ||
                                "New conversation",

                            isPinned:
                                Boolean(
                                    item.is_pinned
                                ),

                            anchorElement:
                                menuButton
                        }
                    );

                }
            );


            /* -----------------------------------------
               CONTEXT MENU
               ----------------------------------------- */

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
                                item.title ||
                                "New conversation",

                            isPinned:
                                Boolean(
                                    item.is_pinned
                                ),

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

        };


    /* =====================================================
       RENDER HISTORY
       ===================================================== */

    const renderHistory = () => {

        historyList
            .replaceChildren();


        if (
            conversations.length ===
            0
        ) {

            renderEmpty();

            emit(
                "neyo:history-rendered",
                {
                    conversations: [],
                    count: 0
                }
            );

            return;

        }


        const fragment =
            document.createDocumentFragment();


        conversations.forEach(
            item => {

                fragment.appendChild(
                    createHistoryRow(
                        item
                    )
                );

            }
        );


        historyList.appendChild(
            fragment
        );


        refreshIcons();


        emit(
            "neyo:history-rendered",
            {
                conversations:
                    [...conversations],

                count:
                    conversations.length
            }
        );

    };


    /* =====================================================
       LOAD HISTORY
       ===================================================== */

    const performLoadHistory =
        async () => {

            renderLoading();


            try {

                const response =
                    await fetch(
                        "/api/history",
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


                conversations =
                    Array.isArray(
                        data.conversations
                    )
                        ? data.conversations
                        : [];


                renderHistory();


                emit(
                    "neyo:history-loaded",
                    {
                        conversations:
                            [...conversations]
                    }
                );


                return [
                    ...conversations
                ];

            }

            catch (error) {

                renderEmpty();


                emit(
                    "neyo:history-error",
                    {
                        error
                    }
                );


                throw error;

            }

        };


    const loadHistory =
        async () => {

            if (loadingPromise) {
                return loadingPromise;
            }


            loadingPromise =
                performLoadHistory();


            try {

                return await loadingPromise;

            }

            finally {

                loadingPromise =
                    null;

            }

        };


    /* =====================================================
       LOAD CONVERSATION MESSAGES
       ===================================================== */

    const fetchConversation =
        async conversationId => {

            if (!conversationId) {
                return null;
            }


            const response =
                await fetch(
                    "/api/history",
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

                        body:
                            JSON.stringify({
                                action:
                                    "get",

                                conversationId
                            })
                    }
                );


            const data =
                await readJson(
                    response
                );


            return {
                id:
                    conversationId,

                messages:
                    Array.isArray(
                        data.messages
                    )
                        ? data.messages
                        : []
            };

        };


    /* =====================================================
       OPEN CONVERSATION
       ===================================================== */

    const openConversation =
        async conversationId => {

            if (!conversationId) {
                return null;
            }


            emit(
                "neyo:history-opening",
                {
                    conversationId
                }
            );


            try {

                const conversation =
                    await fetchConversation(
                        conversationId
                    );


                activeConversationId =
                    conversationId;


                renderHistory();


                emit(
                    "neyo:conversation-loaded",
                    {
                        conversationId,

                        messages:
                            conversation.messages
                    }
                );


                return conversation;

            }

            catch (error) {

                emit(
                    "neyo:history-error",
                    {
                        error,
                        conversationId
                    }
                );


                throw error;

            }

        };


    /* =====================================================
       ACTION REQUEST
       ===================================================== */

    const performAction =
        async (
            action,
            conversationId,
            payload = {}
        ) => {

            const response =
                await fetch(
                    "/api/history",
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

                        body:
                            JSON.stringify({
                                action,
                                conversationId,
                                ...payload
                            })
                    }
                );


            return readJson(
                response
            );

        };


    /* =====================================================
       RENAME
       ===================================================== */

    const renameConversation =
        async (
            conversationId,
            title
        ) => {

            const cleanTitle =
                String(
                    title || ""
                )
                    .trim()
                    .slice(
                        0,
                        100
                    );


            if (
                !conversationId ||
                !cleanTitle
            ) {
                return false;
            }


            await performAction(
                "rename",
                conversationId,
                {
                    title:
                        cleanTitle
                }
            );


            await loadHistory();


            emit(
                "neyo:history-renamed",
                {
                    conversationId,
                    title:
                        cleanTitle
                }
            );


            return true;

        };


    /* =====================================================
       DELETE
       ===================================================== */

    const deleteConversation =
        async conversationId => {

            if (!conversationId) {
                return false;
            }


            await performAction(
                "delete",
                conversationId
            );


            if (
                activeConversationId ===
                conversationId
            ) {

                activeConversationId =
                    null;


                emit(
                    "neyo:active-conversation-deleted",
                    {
                        conversationId
                    }
                );

            }


            await loadHistory();


            emit(
                "neyo:history-deleted",
                {
                    conversationId
                }
            );


            return true;

        };


    /* =====================================================
       PIN / UNPIN
       ===================================================== */

    const setPinned =
        async (
            conversationId,
            pinned
        ) => {

            if (!conversationId) {
                return false;
            }


            await performAction(
                pinned
                    ? "pin"
                    : "unpin",
                conversationId
            );


            await loadHistory();


            emit(
                "neyo:history-pin-change",
                {
                    conversationId,
                    pinned:
                        Boolean(pinned)
                }
            );


            return true;

        };


    /* =====================================================
       LOCAL ACTIVE STATE
       ===================================================== */

    const setActiveConversation =
        conversationId => {

            activeConversationId =
                conversationId ||
                null;


            renderHistory();

        };


    /* =====================================================
       EXTERNAL HISTORY MENU EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:history-rename-request",
        event => {

            renameConversation(
                event.detail?.conversationId,
                event.detail?.title
            ).catch(
                error => {

                    emit(
                        "neyo:history-error",
                        {
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

            deleteConversation(
                event.detail?.conversationId
            ).catch(
                error => {

                    emit(
                        "neyo:history-error",
                        {
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

            setPinned(
                event.detail?.conversationId,
                event.detail?.pinned
            ).catch(
                error => {

                    emit(
                        "neyo:history-error",
                        {
                            error
                        }
                    );

                }
            );

        }
    );


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:history-load-request",
        () => {

            loadHistory().catch(
                error => {

                    console.warn(
                        "History load failed:",
                        error
                    );

                }
            );

        }
    );


    window.addEventListener(
        "neyo:conversation-open-request",
        event => {

            openConversation(
                event.detail?.conversationId
            );

        }
    );


    window.addEventListener(
        "neyo:history-active-set",
        event => {

            setActiveConversation(
                event.detail?.conversationId
            );

        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoHistory =
        Object.freeze({

            load:
                loadHistory,

            render:
                renderHistory,

            open:
                openConversation,

            fetchConversation,

            rename:
                renameConversation,

            delete:
                deleteConversation,

            setPinned,

            setActive:
                setActiveConversation,

            getActive:
                () =>
                    activeConversationId,

            getConversations:
                () =>
                    [...conversations],

            getById:
                id =>
                    conversations.find(
                        item =>
                            item.id === id
                    ) || null

        });

})();
