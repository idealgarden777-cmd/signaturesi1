/*
=========================================================
NEO — HISTORY MENU
Production v1 — Old neo.js Exact Baseline

Baseline preserved:
- #historyPopupMenu
- #hpDeleteBtn
- .history-action-btn
- .show
- Popup opens from three-dot history action
- Popup positioned beside clicked action button
- Outside click closes popup
- Escape closes popup
- Delete uses POST /api/history
- action: "delete"
- Active deleted chat → New Chat
- Other deleted chat → refresh history

Owns:
- History popup open / close
- Selected history conversation
- Popup positioning
- Delete action
- Outside-click close
- Escape close

Does NOT own:
- History list rendering
- Conversation loading
- New Chat state
- Sidebar
- Rename
- Pin
- Share
=========================================================
*/

(() => {
    "use strict";

    const VERSION =
        "neo-history-menu-production-v1";

    if (
        window.NeyoHistoryMenu
            ?.__controller === true
    ) {
        return;
    }

    /* =====================================================
       DOM
       ===================================================== */

    const historyPopupMenu =
        document.getElementById(
            "historyPopupMenu"
        );

    const hpDeleteBtn =
        document.getElementById(
            "hpDeleteBtn"
        );

    if (!historyPopupMenu) {
        console.warn(
            "[NEO History Menu] #historyPopupMenu missing."
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

            viewportGap:
                8,

            anchorGap:
                2
        });

    /* =====================================================
       STATE
       ===================================================== */

    const state = {
        open:
            false,

        busy:
            false,

        conversationId:
            null,

        title:
            "",

        anchorElement:
            null,

        restoreFocusElement:
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

    function clamp(
        value,
        min,
        max
    ) {
        return Math.min(
            max,
            Math.max(
                min,
                value
            )
        );
    }

    /* =====================================================
       OWNERS
       ===================================================== */

    function historyController() {
        const controller =
            window.NeyoHistory;

        return (
            controller &&
            controller
                .__controller === true
        )
            ? controller
            : null;
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

    function newChatController() {
        const controller =
            window.NeyoNewChat;

        return (
            controller &&
            controller
                .__controller === true
        )
            ? controller
            : null;
    }

    /* =====================================================
       CURRENT CHAT
       ===================================================== */

    function getCurrentConversationId() {
        try {
            return cleanId(
                chatController()
                    ?.getConversationId
                    ?.() ||
                historyController()
                    ?.getActive
                    ?.() ||
                ""
            );
        } catch {
            return "";
        }
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
       BUSY
       ===================================================== */

    function setBusy(
        value
    ) {
        state.busy =
            Boolean(value);

        historyPopupMenu
            .classList
            .toggle(
                "is-busy",
                state.busy
            );

        if (hpDeleteBtn) {
            hpDeleteBtn.disabled =
                state.busy;

            hpDeleteBtn.setAttribute(
                "aria-disabled",
                String(
                    state.busy
                )
            );
        }

        return true;
    }

    /* =====================================================
       POSITION

       Old neo.js baseline:
       top  = rect.bottom
       left = rect.left

       Improvement:
       same preferred position, but keep menu inside viewport.
       ===================================================== */

    function positionMenu() {
        if (
            !state.open ||
            !state.anchorElement ||
            !state.anchorElement
                .isConnected
        ) {
            return false;
        }

        const anchorRect =
            state
                .anchorElement
                .getBoundingClientRect();

        /*
         * Make menu measurable.
         */

        historyPopupMenu
            .classList
            .add(
                "show"
            );

        const menuRect =
            historyPopupMenu
                .getBoundingClientRect();

        const width =
            menuRect.width ||
            historyPopupMenu
                .offsetWidth ||
            160;

        const height =
            menuRect.height ||
            historyPopupMenu
                .offsetHeight ||
            48;

        /*
         * Exact old preferred position.
         */

        let left =
            anchorRect.left;

        let top =
            anchorRect.bottom +
            CONFIG.anchorGap;

        /*
         * If menu overflows right edge, align its right side
         * to the button instead.
         */

        if (
            left +
            width +
            CONFIG.viewportGap >
            window.innerWidth
        ) {
            left =
                anchorRect.right -
                width;
        }

        /*
         * If menu cannot fit below, open above.
         */

        if (
            top +
            height +
            CONFIG.viewportGap >
            window.innerHeight
        ) {
            top =
                anchorRect.top -
                height -
                CONFIG.anchorGap;
        }

        left =
            clamp(
                left,
                CONFIG.viewportGap,
                Math.max(
                    CONFIG.viewportGap,
                    window.innerWidth -
                    width -
                    CONFIG.viewportGap
                )
            );

        top =
            clamp(
                top,
                CONFIG.viewportGap,
                Math.max(
                    CONFIG.viewportGap,
                    window.innerHeight -
                    height -
                    CONFIG.viewportGap
                )
            );

        historyPopupMenu
            .style.top =
            `${Math.round(top)}px`;

        historyPopupMenu
            .style.left =
            `${Math.round(left)}px`;

        return true;
    }

    /* =====================================================
       OPEN
       ===================================================== */

    function open({
        conversationId,
        title = "",
        anchorElement = null
    } = {}) {
        const id =
            cleanId(
                conversationId
            );

        if (!id) {
            return false;
        }

        state.open =
            true;

        state.busy =
            false;

        state.conversationId =
            id;

        state.title =
            clean(
                title,
                100
            );

        state.anchorElement =
            anchorElement instanceof
                Element
                ? anchorElement
                : null;

        state.restoreFocusElement =
            state.anchorElement;

        setBusy(false);

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

        positionMenu();

        emit(
            "neyo:history-menu-opened",
            {
                conversationId:
                    id
            }
        );

        return true;
    }

    /* =====================================================
       CLOSE
       ===================================================== */

    function close({
        restoreFocus = false
    } = {}) {
        if (
            !state.open &&
            !historyPopupMenu
                .classList
                .contains(
                    "show"
                )
        ) {
            return false;
        }

        const previousId =
            state.conversationId;

        const focusTarget =
            state
                .restoreFocusElement;

        state.open =
            false;

        state.busy =
            false;

        state.conversationId =
            null;

        state.title =
            "";

        state.anchorElement =
            null;

        state.restoreFocusElement =
            null;

        historyPopupMenu
            .classList
            .remove(
                "show"
            );

        historyPopupMenu
            .style.removeProperty(
                "top"
            );

        historyPopupMenu
            .style.removeProperty(
                "left"
            );

        historyPopupMenu
            .setAttribute(
                "aria-hidden",
                "true"
            );

        setBusy(false);

        if (
            restoreFocus &&
            focusTarget instanceof
                HTMLElement &&
            focusTarget.isConnected
        ) {
            requestAnimationFrame(
                () => {
                    focusTarget.focus();
                }
            );
        }

        emit(
            "neyo:history-menu-closed",
            {
                conversationId:
                    previousId
            }
        );

        return true;
    }

    /* =====================================================
       DELETE REQUEST

       Exact old backend contract:
       POST /api/history
       {
           action: "delete",
           conversationId
       }
       ===================================================== */

    async function deleteConversation(
        conversationId =
            state.conversationId
    ) {
        const id =
            cleanId(
                conversationId
            );

        if (
            !id ||
            state.busy
        ) {
            return false;
        }

        setBusy(true);

        emit(
            "neyo:history-delete-start",
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
                                    "delete",

                                conversationId:
                                    id
                            })
                    }
                );

            await readJsonResponse(
                response
            );

            const currentId =
                getCurrentConversationId();

            /*
             * Old neo.js behavior:
             *
             * Deleted current chat:
             * startNewConversation()
             *
             * Deleted other chat:
             * refresh history
             */

            if (
                currentId &&
                currentId === id
            ) {
                const newChat =
                    newChatController();

                if (
                    newChat &&
                    typeof newChat
                        .request ===
                        "function"
                ) {
                    newChat.request(
                        "history-delete"
                    );

                } else {
                    emit(
                        "neyo:chat-new-request",
                        {
                            reason:
                                "history-delete"
                        }
                    );
                }

            } else {
                const history =
                    historyController();

                if (
                    history &&
                    typeof history
                        .load ===
                        "function"
                ) {
                    await history.load({
                        silent:
                            true
                    });

                } else {
                    emit(
                        "neyo:history-load-request",
                        {
                            force:
                                true
                        }
                    );
                }
            }

            /*
             * Let history.js remove/update its state if it
             * wants to do so without owning persistence.
             */

            emit(
                "neyo:history-deleted",
                {
                    conversationId:
                        id
                }
            );

            emit(
                "neyo:history-delete-complete",
                {
                    conversationId:
                        id
                }
            );

            close({
                restoreFocus:
                    false
            });

            return true;

        } catch (error) {
            console.error(
                "[NEO History Menu] Delete failed:",
                error
            );

            setBusy(false);

            emit(
                "neyo:history-menu-error",
                {
                    action:
                        "delete",

                    conversationId:
                        id,

                    error
                }
            );

            emit(
                "neyo:notification-request",
                {
                    type:
                        "error",

                    message:
                        error?.message ||
                        "Unable to delete conversation"
                }
            );

            return false;
        }
    }

    /* =====================================================
       HISTORY.JS MENU REQUEST

       history.js owns three-dot row button.
       This module owns popup.
       ===================================================== */

    window.addEventListener(
        "neyo:history-menu-request",
        event => {
            const detail =
                event.detail ||
                {};

            open({
                conversationId:
                    detail
                        .conversationId,

                title:
                    detail.title,

                anchorElement:
                    detail
                        .anchorElement
            });
        }
    );

    /* =====================================================
       DELETE BUTTON

       Capture phase blocks old neo.js hpDeleteBtn handler
       while neo.js remains physically loaded.
       ===================================================== */

    hpDeleteBtn?.addEventListener(
        "click",
        event => {
            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation();

            void deleteConversation();
        },
        true
    );

    /* =====================================================
       OUTSIDE CLICK

       Exact old concept:
       if click is outside popup and outside history action
       button → close menu.
       ===================================================== */

    document.addEventListener(
        "click",
        event => {
            if (!state.open) {
                return;
            }

            const target =
                event.target;

            if (
                target instanceof
                    Node &&
                historyPopupMenu
                    .contains(
                        target
                    )
            ) {
                return;
            }

            if (
                target instanceof
                    Element &&
                target.closest(
                    ".history-action-btn"
                )
            ) {
                return;
            }

            close({
                restoreFocus:
                    false
            });
        }
    );

    /* =====================================================
       ESCAPE
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {
            if (
                !state.open ||
                event.key !==
                    "Escape"
            ) {
                return;
            }

            event.preventDefault();

            event.stopPropagation();

            close({
                restoreFocus:
                    true
            });
        },
        true
    );

    /* =====================================================
       VIEWPORT

       Keep popup attached to its history row when viewport
       changes.
       ===================================================== */

    window.addEventListener(
        "resize",
        () => {
            if (
                state.open
            ) {
                positionMenu();
            }
        },
        {
            passive:
                true
        }
    );

    /* =====================================================
       SIDEBAR CLOSE

       Popup should never float after drawer closes.
       ===================================================== */

    window.addEventListener(
        "neyo:sidebar-close",
        () => {
            close({
                restoreFocus:
                    false
            });
        }
    );

    window.addEventListener(
        "neyo:sidebar-state",
        event => {
            if (
                event.detail
                    ?.collapsed
            ) {
                close({
                    restoreFocus:
                        false
                });
            }
        }
    );

    /* =====================================================
       HISTORY OPEN
       ===================================================== */

    window.addEventListener(
        "neyo:history-opened",
        () => {
            close({
                restoreFocus:
                    false
            });
        }
    );

    /* =====================================================
       NEW CHAT
       ===================================================== */

    window.addEventListener(
        "neyo:chat-new",
        () => {
            close({
                restoreFocus:
                    false
            });
        }
    );

    /* =====================================================
       EXTERNAL CLOSE
       ===================================================== */

    window.addEventListener(
        "neyo:history-menu-close-request",
        () => {
            close({
                restoreFocus:
                    false
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

            open,

            close,

            position:
                positionMenu,

            delete:
                deleteConversation,

            isOpen() {
                return (
                    state.open
                );
            },

            isBusy() {
                return (
                    state.busy
                );
            },

            getConversationId() {
                return (
                    state
                        .conversationId ||
                    null
                );
            },

            getState() {
                return {
                    version:
                        VERSION,

                    active:
                        true,

                    open:
                        state.open,

                    busy:
                        state.busy,

                    conversationId:
                        state
                            .conversationId,

                    title:
                        state.title
                };
            }
        });

    Object.defineProperty(
        window,
        "NeyoHistoryMenu",
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
       ===================================================== */

    historyPopupMenu
        .classList
        .remove(
            "show"
        );

    historyPopupMenu
        .setAttribute(
            "aria-hidden",
            "true"
        );

    setBusy(false);

    emit(
        "neyo:history-menu-ready",
        {
            version:
                VERSION,

            active:
                true,

            baseline:
                "old-neo.js",

            delete:
                Boolean(
                    hpDeleteBtn
                )
        }
    );
})();
