/*
=========================================================
NEYO — HISTORY COMPONENT
v5 — COMPLETE SELF-CONTAINED HISTORY MENU

OWNS
---------------------------------------------------------
- Load conversation history
- Render history list
- Open conversation
- Rename conversation
- Delete conversation
- Conversation options popup
- Popup positioning
- Share action bridge
- History state
- Public history API

DOES NOT OWN
---------------------------------------------------------
- Chat sending
- Message rendering
- Authentication
- Theme
- Sidebar
- Model menu
- neo.js

NOTES
---------------------------------------------------------
Backend currently supports:
- list
- get
- rename
- delete

Pin is kept visible in the existing UI, but is disabled here
because current /api/history backend has no pin/unpin action.
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       SINGLETON GUARD
       ===================================================== */

    if (window.NeyoHistory?.__controller === true) {
        return;
    }


    /* =====================================================
       DOM
       ===================================================== */

    const historyList =
        document.getElementById(
            "historyList"
        );


    const historyPopupMenu =
        document.getElementById(
            "historyPopupMenu"
        );


    const hpShareBtn =
        document.getElementById(
            "hpShareBtn"
        );


    const hpPinBtn =
        document.getElementById(
            "hpPinBtn"
        );


    const hpRenameBtn =
        document.getElementById(
            "hpRenameBtn"
        );


    const hpDeleteBtn =
        document.getElementById(
            "hpDeleteBtn"
        );


    if (!historyList) {
        return;
    }


    /* =====================================================
       STATE
       ===================================================== */

    let conversations =
        [];


    let activeConversationId =
        null;


    let loadingPromise =
        null;


    let popupConversationId =
        null;


    let popupConversationTitle =
        "";


    let popupConversationPinned =
        false;


    let popupAnchorElement =
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


    const refreshIcons =
        () => {

            try {

                window.lucide
                    ?.createIcons
                    ?.();

            } catch {}

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

                throw new Error(
                    data?.error ||
                    `Request failed (${response.status})`
                );

            }


            return data;

        };


    const getConversationById =
        conversationId => {

            return (
                conversations.find(
                    item =>
                        item.id ===
                        conversationId
                ) ||
                null
            );

        };


    /* =====================================================
       LOADING UI
       ===================================================== */

    const renderLoading =
        () => {

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

    const renderEmpty =
        () => {

            historyList
                .replaceChildren();

        };


    /* =====================================================
       POPUP — CLOSE
       ===================================================== */

    const closeHistoryPopup =
        () => {

            if (
                !historyPopupMenu
            ) {
                return;
            }


            historyPopupMenu
                .classList
                .remove(
                    "show"
                );


            historyPopupMenu.style.display =
                "none";


            historyPopupMenu.style.left =
                "";


            historyPopupMenu.style.top =
                "";


            historyPopupMenu
                .setAttribute(
                    "aria-hidden",
                    "true"
                );


            popupConversationId =
                null;


            popupConversationTitle =
                "";


            popupConversationPinned =
                false;


            popupAnchorElement =
                null;

        };


    /* =====================================================
       POPUP — POSITION
       ===================================================== */

    const positionHistoryPopup =
        ({
            anchorElement = null,
            clientX = null,
            clientY = null
        } = {}) => {

            if (
                !historyPopupMenu
            ) {
                return;
            }


            const viewportPadding =
                12;


            const gap =
                6;


            const menuWidth =
                historyPopupMenu
                    .offsetWidth ||
                208;


            const menuHeight =
                historyPopupMenu
                    .offsetHeight ||
                188;


            let left =
                Number(
                    clientX
                );


            let top =
                Number(
                    clientY
                );


            if (
                anchorElement &&
                typeof anchorElement
                    .getBoundingClientRect ===
                    "function"
            ) {

                const rect =
                    anchorElement
                        .getBoundingClientRect();


                left =
                    rect.right -
                    menuWidth;


                top =
                    rect.bottom +
                    gap;

            }


            if (
                !Number.isFinite(
                    left
                )
            ) {

                left =
                    viewportPadding;

            }


            if (
                !Number.isFinite(
                    top
                )
            ) {

                top =
                    viewportPadding;

            }


            left =
                Math.max(
                    viewportPadding,
                    Math.min(
                        left,
                        window.innerWidth -
                            menuWidth -
                            viewportPadding
                    )
                );


            top =
                Math.max(
                    viewportPadding,
                    Math.min(
                        top,
                        window.innerHeight -
                            menuHeight -
                            viewportPadding
                    )
                );


            historyPopupMenu
                .style
                .left =
                    `${Math.round(left)}px`;


            historyPopupMenu
                .style
                .top =
                    `${Math.round(top)}px`;

        };


    /* =====================================================
       POPUP — OPEN
       ===================================================== */

    const openHistoryPopup =
        ({
            conversationId,
            title,
            isPinned = false,
            anchorElement = null,
            clientX = null,
            clientY = null
        } = {}) => {

            if (
                !historyPopupMenu ||
                !conversationId
            ) {
                return;
            }


            /*
             * Toggle same popup off
             */

            if (
                popupConversationId ===
                    conversationId &&
                historyPopupMenu
                    .classList
                    .contains(
                        "show"
                    )
            ) {

                closeHistoryPopup();

                return;

            }


            popupConversationId =
                conversationId;


            popupConversationTitle =
                String(
                    title ||
                    "New conversation"
                );


            popupConversationPinned =
                Boolean(
                    isPinned
                );


            popupAnchorElement =
                anchorElement ||
                null;


            /*
             * Current backend has no pin support.
             */

            if (hpPinBtn) {

                hpPinBtn.innerHTML = `
                    <i
                        data-lucide="pin"
                        size="16"
                    ></i>
                    Pin
                `;


                hpPinBtn
                    .setAttribute(
                        "aria-disabled",
                        "true"
                    );


                hpPinBtn
                    .setAttribute(
                        "title",
                        "Pin support is not available yet"
                    );


                hpPinBtn.style.opacity =
                    "0.45";


                hpPinBtn.style.cursor =
                    "not-allowed";

            }


            historyPopupMenu
                .style
                .display =
                    "block";


            historyPopupMenu
                .classList
                .add(
                    "show"
                );


            historyPopupMenu
                .setAttribute(
                    "aria-hidden",
                    "false"
                );


            positionHistoryPopup({
                anchorElement,
                clientX,
                clientY
            });


            refreshIcons();

        };


    /* =====================================================
       RENAME DIALOG
       ===================================================== */

    const requestText =
        ({
            title,
            value = "",
            placeholder = "",
            confirmText = "Save"
        }) => {

            return new Promise(
                resolve => {

                    const overlay =
                        document.createElement(
                            "div"
                        );


                    overlay.className =
                        "neo-dialog-overlay";


                    const card =
                        document.createElement(
                            "div"
                        );


                    card.className =
                        "neo-dialog-card";


                    const heading =
                        document.createElement(
                            "h3"
                        );


                    heading.textContent =
                        title;


                    const input =
                        document.createElement(
                            "input"
                        );


                    input.type =
                        "text";


                    input.className =
                        "neo-dialog-input";


                    input.value =
                        value;


                    input.placeholder =
                        placeholder;


                    input.maxLength =
                        80;


                    const actions =
                        document.createElement(
                            "div"
                        );


                    actions.className =
                        "neo-dialog-actions";


                    const cancel =
                        document.createElement(
                            "button"
                        );


                    cancel.type =
                        "button";


                    cancel.className =
                        "neo-dialog-cancel";


                    cancel.textContent =
                        "Cancel";


                    const confirm =
                        document.createElement(
                            "button"
                        );


                    confirm.type =
                        "button";


                    confirm.className =
                        "neo-dialog-confirm";


                    confirm.textContent =
                        confirmText;


                    let closed =
                        false;


                    const close =
                        result => {

                            if (
                                closed
                            ) {
                                return;
                            }


                            closed =
                                true;


                            overlay.remove();


                            resolve(
                                result
                            );

                        };


                    cancel
                        .addEventListener(
                            "click",
                            () => {

                                close(
                                    null
                                );

                            }
                        );


                    confirm
                        .addEventListener(
                            "click",
                            () => {

                                const result =
                                    input.value
                                        .trim();


                                close(
                                    result ||
                                    null
                                );

                            }
                        );


                    input
                        .addEventListener(
                            "keydown",
                            event => {

                                if (
                                    event.key ===
                                    "Enter"
                                ) {

                                    event
                                        .preventDefault();


                                    confirm.click();

                                }


                                if (
                                    event.key ===
                                    "Escape"
                                ) {

                                    event
                                        .preventDefault();


                                    cancel.click();

                                }

                            }
                        );


                    overlay
                        .addEventListener(
                            "click",
                            event => {

                                if (
                                    event.target ===
                                    overlay
                                ) {

                                    cancel.click();

                                }

                            }
                        );


                    actions.append(
                        cancel,
                        confirm
                    );


                    card.append(
                        heading,
                        input,
                        actions
                    );


                    overlay.appendChild(
                        card
                    );


                    document.body
                        .appendChild(
                            overlay
                        );


                    requestAnimationFrame(
                        () => {

                            overlay
                                .classList
                                .add(
                                    "show"
                                );


                            input.focus();


                            input.select();

                        }
                    );

                }
            );

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
               ACTIVE STATE
               ----------------------------------------- */

            button
                .classList
                .toggle(
                    "active",
                    item.id ===
                        activeConversationId
                );


            /* -----------------------------------------
               OPEN
               ----------------------------------------- */

            button
                .addEventListener(
                    "click",
                    () => {

                        closeHistoryPopup();


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


            menuButton
                .setAttribute(
                    "aria-label",
                    "Conversation options"
                );


            menuButton
                .setAttribute(
                    "aria-haspopup",
                    "menu"
                );


            menuButton.innerHTML = `
                <i
                    data-lucide="more-vertical"
                    width="16"
                    height="16"
                    aria-hidden="true"
                ></i>
            `;


            menuButton
                .addEventListener(
                    "click",
                    event => {

                        event
                            .preventDefault();


                        event
                            .stopPropagation();


                        openHistoryPopup({
                            conversationId:
                                item.id,

                            title:
                                item.title ||
                                "New conversation",

                            isPinned:
                                false,

                            anchorElement:
                                menuButton
                        });

                    }
                );


            /* -----------------------------------------
               CONTEXT MENU
               ----------------------------------------- */

            row
                .addEventListener(
                    "contextmenu",
                    event => {

                        event
                            .preventDefault();


                        event
                            .stopPropagation();


                        openHistoryPopup({
                            conversationId:
                                item.id,

                            title:
                                item.title ||
                                "New conversation",

                            isPinned:
                                false,

                            clientX:
                                event.clientX,

                            clientY:
                                event.clientY
                        });

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

    const renderHistory =
        () => {

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
                        conversations:
                            [],

                        count:
                            0
                    }
                );


                return;

            }


            const fragment =
                document
                    .createDocumentFragment();


            conversations
                .forEach(
                    item => {

                        fragment
                            .appendChild(
                                createHistoryRow(
                                    item
                                )
                            );

                    }
                );


            historyList
                .appendChild(
                    fragment
                );


            refreshIcons();


            emit(
                "neyo:history-rendered",
                {
                    conversations:
                        [
                            ...conversations
                        ],

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
                            [
                                ...conversations
                            ]
                    }
                );


                return [
                    ...conversations
                ];

            }

            catch (
                error
            ) {

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

            if (
                loadingPromise
            ) {

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
       FETCH CONVERSATION
       ===================================================== */

    const fetchConversation =
        async conversationId => {

            if (
                !conversationId
            ) {
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

            if (
                !conversationId
            ) {
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

            catch (
                error
            ) {

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
       API ACTION
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
                    title ||
                    ""
                )
                    .trim()
                    .slice(
                        0,
                        80
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

            if (
                !conversationId
            ) {

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
       SHARE
       ===================================================== */

    const shareConversation =
        conversationId => {

            if (
                !conversationId
            ) {

                return false;

            }


            const conversation =
                getConversationById(
                    conversationId
                );


            const title =
                conversation?.title ||
                popupConversationTitle ||
                "NEYO conversation";


            emit(
                "neyo:history-share-request",
                {
                    conversationId,
                    title
                }
            );


            emit(
                "neyo:conversation-share-request",
                {
                    conversationId,
                    title
                }
            );


            return true;

        };


    /* =====================================================
       POPUP ACTION — SHARE
       ===================================================== */

    hpShareBtn
        ?.addEventListener(
            "click",
            event => {

                event
                    .preventDefault();


                event
                    .stopPropagation();


                const conversationId =
                    popupConversationId;


                closeHistoryPopup();


                if (
                    !conversationId
                ) {
                    return;
                }


                shareConversation(
                    conversationId
                );

            }
        );


    /* =====================================================
       POPUP ACTION — PIN
       ===================================================== */

    hpPinBtn
        ?.addEventListener(
            "click",
            event => {

                event
                    .preventDefault();


                event
                    .stopPropagation();

                /*
                 * Backend pin support does not exist yet.
                 * Intentionally do nothing.
                 */

            }
        );


    /* =====================================================
       POPUP ACTION — RENAME
       ===================================================== */

    hpRenameBtn
        ?.addEventListener(
            "click",
            async event => {

                event
                    .preventDefault();


                event
                    .stopPropagation();


                const conversationId =
                    popupConversationId;


                const oldTitle =
                    popupConversationTitle;


                closeHistoryPopup();


                if (
                    !conversationId
                ) {
                    return;
                }


                const newTitle =
                    await requestText({
                        title:
                            "Rename conversation",

                        value:
                            oldTitle,

                        placeholder:
                            "Conversation name",

                        confirmText:
                            "Save"
                    });


                if (
                    !newTitle
                ) {
                    return;
                }


                try {

                    await renameConversation(
                        conversationId,
                        newTitle
                    );

                }

                catch (
                    error
                ) {

                    console.warn(
                        "History rename failed:",
                        error
                    );


                    emit(
                        "neyo:history-error",
                        {
                            error
                        }
                    );

                }

            }
        );


    /* =====================================================
       POPUP ACTION — DELETE
       ===================================================== */

    hpDeleteBtn
        ?.addEventListener(
            "click",
            async event => {

                event
                    .preventDefault();


                event
                    .stopPropagation();


                const conversationId =
                    popupConversationId;


                closeHistoryPopup();


                if (
                    !conversationId
                ) {
                    return;
                }


                const confirmed =
                    window.confirm(
                        "Delete this conversation?"
                    );


                if (
                    !confirmed
                ) {
                    return;
                }


                try {

                    await deleteConversation(
                        conversationId
                    );

                }

                catch (
                    error
                ) {

                    console.warn(
                        "History delete failed:",
                        error
                    );


                    emit(
                        "neyo:history-error",
                        {
                            error
                        }
                    );

                }

            }
        );


    /* =====================================================
       CLOSE POPUP — OUTSIDE CLICK
       ===================================================== */

    document
        .addEventListener(
            "click",
            event => {

                if (
                    !historyPopupMenu
                        ?.classList
                        .contains(
                            "show"
                        )
                ) {
                    return;
                }


                if (
                    historyPopupMenu
                        .contains(
                            event.target
                        )
                ) {
                    return;
                }


                if (
                    event.target
                        ?.closest
                        ?.(
                            ".history-three-dot"
                        )
                ) {
                    return;
                }


                closeHistoryPopup();

            }
        );


    /* =====================================================
       ESCAPE
       ===================================================== */

    document
        .addEventListener(
            "keydown",
            event => {

                if (
                    event.key !==
                    "Escape"
                ) {
                    return;
                }


                if (
                    !historyPopupMenu
                        ?.classList
                        .contains(
                            "show"
                        )
                ) {
                    return;
                }


                const anchor =
                    popupAnchorElement;


                closeHistoryPopup();


                anchor
                    ?.focus
                    ?.();

            }
        );


    /* =====================================================
       RESIZE
       ===================================================== */

    window
        .addEventListener(
            "resize",
            () => {

                if (
                    !historyPopupMenu
                        ?.classList
                        .contains(
                            "show"
                        )
                ) {
                    return;
                }


                if (
                    popupAnchorElement
                ) {

                    positionHistoryPopup({
                        anchorElement:
                            popupAnchorElement
                    });

                } else {

                    closeHistoryPopup();

                }

            },
            {
                passive:
                    true
            }
        );


    /* =====================================================
       ACTIVE CONVERSATION
       ===================================================== */

    const setActiveConversation =
        conversationId => {

            activeConversationId =
                conversationId ||
                null;


            renderHistory();

        };


    /* =====================================================
       EXTERNAL RENAME EVENT
       ===================================================== */

    window
        .addEventListener(
            "neyo:history-rename-request",
            event => {

                renameConversation(
                    event.detail
                        ?.conversationId,

                    event.detail
                        ?.title
                )
                    .catch(
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
       EXTERNAL DELETE EVENT
       ===================================================== */

    window
        .addEventListener(
            "neyo:history-delete-request",
            event => {

                deleteConversation(
                    event.detail
                        ?.conversationId
                )
                    .catch(
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
       LOAD REQUEST
       ===================================================== */

    window
        .addEventListener(
            "neyo:history-load-request",
            () => {

                loadHistory()
                    .catch(
                        error => {

                            console.warn(
                                "History load failed:",
                                error
                            );

                        }
                    );

            }
        );


    /* =====================================================
       OPEN REQUEST
       ===================================================== */

    window
        .addEventListener(
            "neyo:conversation-open-request",
            event => {

                openConversation(
                    event.detail
                        ?.conversationId
                );

            }
        );


    /* =====================================================
       ACTIVE SET
       ===================================================== */

    window
        .addEventListener(
            "neyo:history-active-set",
            event => {

                setActiveConversation(
                    event.detail
                        ?.conversationId
                );

            }
        );


    /* =====================================================
       OLD MENU REQUEST COMPATIBILITY
       ===================================================== */

    window
        .addEventListener(
            "neyo:history-menu-request",
            event => {

                openHistoryPopup({
                    conversationId:
                        event.detail
                            ?.conversationId,

                    title:
                        event.detail
                            ?.title,

                    isPinned:
                        false,

                    anchorElement:
                        event.detail
                            ?.anchorElement,

                    clientX:
                        event.detail
                            ?.clientX,

                    clientY:
                        event.detail
                            ?.clientY
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
                "history-v5",

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

            setActive:
                setActiveConversation,

            getActive:
                () =>
                    activeConversationId,

            getConversations:
                () => [
                    ...conversations
                ],

            getById:
                id =>
                    getConversationById(
                        id
                    ),

            openMenu:
                openHistoryPopup,

            closeMenu:
                closeHistoryPopup,

            share:
                shareConversation
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
       INITIAL STATE
       ===================================================== */

    closeHistoryPopup();


    console.log(
        "[NEYO History] Ready. history-v5"
    );

})();
