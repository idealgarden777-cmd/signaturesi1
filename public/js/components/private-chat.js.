/*
=========================================================
NEYO — PRIVATE CHAT COMPONENT

Owns:
- Private chat mode state
- Toggle UI
- Chat preference sync
- Private mode lifecycle events
- Public private-chat API

Does NOT own:
- Chat API implementation
- History persistence
- Message rendering
- Settings modal internals
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const privateChatToggle =
        document.getElementById(
            "privateChatToggle"
        );

    const privateChatBtn =
        document.getElementById(
            "privateChatBtn"
        );


    /* =====================================================
       STATE
       ===================================================== */

    let enabled =
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


    /* =====================================================
       UI SYNC
       ===================================================== */

    const updateUi = () => {

        privateChatToggle
            ?.classList
            .toggle(
                "active",
                enabled
            );


        privateChatBtn
            ?.classList
            .toggle(
                "active",
                enabled
            );


        privateChatToggle
            ?.setAttribute(
                "aria-pressed",
                String(enabled)
            );


        privateChatBtn
            ?.setAttribute(
                "aria-pressed",
                String(enabled)
            );


        document.body
            .classList
            .toggle(
                "private-chat-active",
                enabled
            );

    };


    /* =====================================================
       SYNC CHAT PREFERENCES
       ===================================================== */

    const syncChatPreferences = () => {

        window.NeyoChat
            ?.setPreferences?.({
                privateChat:
                    enabled
            });


        window.NeyoState
            ?.set?.(
                "chat.privateChat",
                enabled
            );

    };


    /* =====================================================
       SET
       ===================================================== */

    const setPrivateChat = (
        value,
        options = {}
    ) => {

        const next =
            Boolean(value);


        if (
            enabled === next &&
            options.force !== true
        ) {
            return enabled;
        }


        enabled =
            next;


        updateUi();

        syncChatPreferences();


        if (
            options.silent !== true
        ) {

            emit(
                "neyo:private-chat-change",
                {
                    enabled
                }
            );

        }


        return enabled;

    };


    /* =====================================================
       TOGGLE
       ===================================================== */

    const togglePrivateChat = () => {

        return setPrivateChat(
            !enabled
        );

    };


    /* =====================================================
       BUTTON EVENTS
       ===================================================== */

    privateChatToggle
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();


                togglePrivateChat();

            }
        );


    privateChatBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();


                togglePrivateChat();

            }
        );


    /* =====================================================
       NEW CHAT BEHAVIOR
       ===================================================== */

    window.addEventListener(
        "neyo:new-chat-success",
        () => {

            /*
            Keep current private-chat preference
            when starting a new chat.

            We only re-sync the chat state.
            */

            syncChatPreferences();

        }
    );


    /* =====================================================
       SETTINGS / EXTERNAL REQUESTS
       ===================================================== */

    window.addEventListener(
        "neyo:private-chat-set",
        event => {

            setPrivateChat(
                event.detail?.enabled,
                {
                    silent:
                        Boolean(
                            event.detail
                                ?.silent
                        )
                }
            );

        }
    );


    window.addEventListener(
        "neyo:private-chat-toggle-request",
        togglePrivateChat
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    updateUi();

    syncChatPreferences();


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoPrivateChat =
        Object.freeze({

            enable:
                () =>
                    setPrivateChat(
                        true
                    ),

            disable:
                () =>
                    setPrivateChat(
                        false
                    ),

            toggle:
                togglePrivateChat,

            set:
                setPrivateChat,

            isEnabled:
                () =>
                    enabled

        });

})();
