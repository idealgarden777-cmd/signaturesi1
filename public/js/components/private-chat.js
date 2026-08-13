/*
=========================================================
NEYO — PRIVATE CHAT COMPONENT

Owns:
- Private Chat state
- Settings toggle UI sync
- Chat preference sync
- App-state sync
- Public events / API

Does NOT own:
- Chat API implementation
- History deletion
- Memory deletion
- Settings modal layout
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const privateChatToggle =
        document.getElementById(
            "settingsPrivateChatToggle"
        );


    /* =====================================================
       STATE
       ===================================================== */

    let enabled = false;


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

        if (!privateChatToggle) {
            return;
        }


        privateChatToggle.classList.toggle(
            "active",
            enabled
        );


        privateChatToggle.setAttribute(
            "aria-checked",
            String(enabled)
        );


        privateChatToggle.setAttribute(
            "aria-pressed",
            String(enabled)
        );

    };


    /* =====================================================
       CHAT / APP STATE SYNC
       ===================================================== */

    const syncState = () => {

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
       SET PRIVATE CHAT
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

        syncState();


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
       SETTINGS TOGGLE
       ===================================================== */

    privateChatToggle
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();


                togglePrivateChat();

            }
        );


    /* =====================================================
       SETTINGS OPEN SYNC
       ===================================================== */

    window.addEventListener(
        "neyo:settings-open",
        () => {

            updateUi();

        }
    );


    /* =====================================================
       EXTERNAL SET
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


    /* =====================================================
       EXTERNAL TOGGLE
       ===================================================== */

    window.addEventListener(
        "neyo:private-chat-toggle-request",
        togglePrivateChat
    );


    /* =====================================================
       CHAT PREFERENCE RESTORE
       ===================================================== */

    window.addEventListener(
        "neyo:chat-preferences-change",
        event => {

            const value =
                event.detail
                    ?.preferences
                    ?.privateChat;


            if (
                typeof value ===
                "boolean"
            ) {

                setPrivateChat(
                    value,
                    {
                        silent:
                            true
                    }
                );

            }

        }
    );


    /* =====================================================
       NEW CHAT
       ===================================================== */

    window.addEventListener(
        "neyo:new-chat-success",
        () => {

            syncState();

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    const initialState =
        privateChatToggle
            ?.getAttribute(
                "aria-checked"
            ) === "true";


    enabled =
        initialState;


    updateUi();

    syncState();


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
