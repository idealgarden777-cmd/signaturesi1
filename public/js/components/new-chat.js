/*
=========================================================
NEYO — NEW CHAT COMPONENT

Owns:
- New chat button behavior
- Reset current chat state
- Clear visible messages
- Clear attachments
- Reset composer
- Clear active history selection
- New chat lifecycle events

Does NOT own:
- Chat API
- History fetching
- Message rendering internals
- Sidebar behavior
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const newChatBtn =
        document.getElementById(
            "newChatBtn"
        );


    /* =====================================================
       STATE
       ===================================================== */

    let resetting =
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
       RESET
       ===================================================== */

    const startNewChat = async () => {

        if (resetting) {
            return false;
        }


        resetting =
            true;


        emit(
            "neyo:new-chat-start"
        );


        try {

            /* -----------------------------------------
               STOP ACTIVE GENERATION
               ----------------------------------------- */

            window.NeyoChat
                ?.stop?.();


            /* -----------------------------------------
               RESET CHAT STATE
               ----------------------------------------- */

            window.NeyoChat
                ?.newConversation?.();


            /* -----------------------------------------
               CLEAR MESSAGE UI
               ----------------------------------------- */

            window.NeyoMessages
                ?.clear?.();


            /* -----------------------------------------
               CLEAR ATTACHMENTS
               ----------------------------------------- */

            window.NeyoAttachments
                ?.clear?.();


            /* -----------------------------------------
               RESET COMPOSER
               ----------------------------------------- */

            window.dispatchEvent(
                new CustomEvent(
                    "neyo:composer-reset"
                )
            );


            /* -----------------------------------------
               CLEAR ACTIVE HISTORY
               ----------------------------------------- */

            window.NeyoHistory
                ?.setActive?.(
                    null
                );


            /* -----------------------------------------
               RESET SEARCH IF ACTIVE
               ----------------------------------------- */

            window.NeyoSearch
                ?.clear?.();


            /* -----------------------------------------
               REFRESH SEND BUTTON
               ----------------------------------------- */

            window.NeyoSend
                ?.refresh?.();


            /* -----------------------------------------
               MOBILE SIDEBAR
               ----------------------------------------- */

            if (
                window.NeyoResponsive
                    ?.isMobile?.()
            ) {

                window.dispatchEvent(
                    new CustomEvent(
                        "neyo:sidebar-close-request"
                    )
                );

            }


            emit(
                "neyo:new-chat-success"
            );


            return true;

        }

        catch (error) {

            emit(
                "neyo:new-chat-error",
                {
                    error
                }
            );


            window.NeyoNotifications
                ?.error?.(
                    "Could not start a new chat."
                );


            return false;

        }

        finally {

            resetting =
                false;


            emit(
                "neyo:new-chat-end"
            );

        }

    };


    /* =====================================================
       BUTTON
       ===================================================== */

    newChatBtn?.addEventListener(
        "click",
        event => {

            event.preventDefault();


            startNewChat();

        }
    );


    /* =====================================================
       PUBLIC EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:new-chat-request",
        startNewChat
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoNewChat =
        Object.freeze({

            start:
                startNewChat,

            isResetting:
                () =>
                    resetting

        });

})();
