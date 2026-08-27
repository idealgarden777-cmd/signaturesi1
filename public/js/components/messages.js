/*
=========================================================
NEYO — MESSAGES CORE COMPONENT

Owns:
- Message container access
- User / assistant message shell
- Thinking state
- Message content updates
- Auto scroll
- Clear messages
- Public message events

Does NOT own:
- Chat API
- Message editing
- Regenerate
- Attachments
- History
- Copy / Share actions
=========================================================
*/

(() => {
    "use strict";

    /* =====================================================
       ELEMENTS
       ===================================================== */

    const chatMessages =
        document.getElementById("chatMessages");

    const scrollArea =
        document.getElementById("scrollArea");

    if (!chatMessages) return;


    /* =====================================================
       HELPERS
       ===================================================== */

    const refreshIcons = () => {
        if (window.lucide?.createIcons) {
            window.lucide.createIcons();
        }
    };


    const scrollToBottom = (behavior = "auto") => {
        if (!scrollArea) return;

        scrollArea.scrollTo({
            top: scrollArea.scrollHeight,
            behavior
        });
    };


    /* =====================================================
       CREATE MESSAGE
       ===================================================== */

    const createMessage = ({
        role = "assistant",
        content = "",
        index = null,
        thinking = false
    } = {}) => {

        const message =
            document.createElement("div");

        message.className = [
            "message",
            role,
            thinking ? "is-thinking" : ""
        ]
            .filter(Boolean)
            .join(" ");

        if (index !== null) {
            message.dataset.msgIndex =
                String(index);
        }


        /* ---------------------------------------------
           CONTENT
           --------------------------------------------- */

        const contentElement =
            document.createElement("div");

        contentElement.className =
            "message-content";


        if (thinking) {
            const shimmer =
                document.createElement("span");

            shimmer.className =
                "thinking-shimmer";

            shimmer.textContent =
                "Thinking...";

            contentElement.appendChild(
                shimmer
            );
        } else {
            /*
            Core module intentionally uses textContent.

            Markdown rendering will later belong to its
            own renderer module so messages.js stays small.
            */
            contentElement.textContent =
                content;
        }


        /* ---------------------------------------------
           USER WRAPPER
           --------------------------------------------- */

        if (role === "user") {
            const wrapper =
                document.createElement("div");

            wrapper.className =
                "message-wrapper";

            wrapper.appendChild(
                contentElement
            );

            message.appendChild(
                wrapper
            );
        }

        /* ---------------------------------------------
           ASSISTANT
           --------------------------------------------- */

        else {
            message.appendChild(
                contentElement
            );
        }


        chatMessages.appendChild(
            message
        );

        refreshIcons();
        scrollToBottom();

        return message;
    };


    /* =====================================================
       UPDATE MESSAGE
       ===================================================== */

    const updateMessage = (
        message,
        content = "",
        options = {}
    ) => {

        if (!(message instanceof HTMLElement)) {
            return;
        }

        const contentElement =
            message.querySelector(
                ".message-content"
            );

        if (!contentElement) return;


        message.classList.remove(
            "is-thinking"
        );


        if (options.html === true) {
            /*
            Only use this with sanitized HTML.
            Markdown renderer will own sanitization later.
            */
            contentElement.innerHTML =
                content;
        } else {
            contentElement.textContent =
                content;
        }


        scrollToBottom();

        window.dispatchEvent(
            new CustomEvent(
                "neyo:message-updated",
                {
                    detail: {
                        message,
                        content
                    }
                }
            )
        );
    };


    /* =====================================================
       REMOVE MESSAGE
       ===================================================== */

    const removeMessage = (message) => {
        if (!(message instanceof HTMLElement)) {
            return;
        }

        message.remove();

        window.dispatchEvent(
            new CustomEvent(
                "neyo:message-removed"
            )
        );
    };


    /* =====================================================
       CLEAR
       ===================================================== */

    const clearMessages = () => {
        chatMessages.replaceChildren();

        window.dispatchEvent(
            new CustomEvent(
                "neyo:messages-cleared"
            )
        );
    };


    /* =====================================================
       PUBLIC EVENT API
       ===================================================== */

    window.addEventListener(
        "neyo:message-create",
        event => {
            createMessage(
                event.detail || {}
            );
        }
    );


    window.addEventListener(
        "neyo:messages-clear",
        clearMessages
    );


    window.addEventListener(
        "neyo:messages-scroll-bottom",
        () => {
            scrollToBottom("smooth");
        }
    );


    /* =====================================================
       PUBLIC MODULE API

       Future modules can use:
       window.NeyoMessages.create(...)
       ===================================================== */

    window.NeyoMessages = Object.freeze({
        create: createMessage,
        update: updateMessage,
        remove: removeMessage,
        clear: clearMessages,
        scrollToBottom
    });

})();
