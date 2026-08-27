/*
=========================================================
NEYO — MESSAGE ACTIONS COMPONENT

Owns:
- Copy assistant message
- Share assistant message
- Regenerate request
- Copy user message
- Edit user message request
- Action button feedback
- Delegated message action handling

Does NOT own:
- Message rendering
- Chat API
- Edit form UI
- Regenerate implementation
- Share modal UI
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const chatMessages =
        document.getElementById(
            "chatMessages"
        );


    if (!chatMessages) {
        return;
    }


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


    const getMessageElement =
        element => {

            return element
                ?.closest?.(
                    ".message"
                ) || null;

        };


    const getMessageText =
        message => {

            if (!message) {
                return "";
            }


            return (
                message
                    .querySelector(
                        ".message-content"
                    )
                    ?.innerText ||
                ""
            ).trim();

        };


    const getMessageIndex =
        message => {

            if (!message) {
                return null;
            }


            const value =
                message.dataset
                    .msgIndex;


            if (
                value === undefined
            ) {
                return null;
            }


            const parsed =
                Number(value);


            return Number.isFinite(
                parsed
            )
                ? parsed
                : null;

        };


    /* =====================================================
       BUTTON FEEDBACK
       ===================================================== */

    const showCopiedState = (
        button,
        size = 16
    ) => {

        if (!button) {
            return;
        }


        const originalHtml =
            button.innerHTML;


        button.innerHTML = `
            <i
                data-lucide="check"
                width="${size}"
                height="${size}"
                aria-hidden="true"
            ></i>
        `;


        refreshIcons();


        window.setTimeout(
            () => {

                if (
                    document.body.contains(
                        button
                    )
                ) {

                    button.innerHTML =
                        originalHtml;


                    refreshIcons();

                }

            },
            1600
        );

    };


    /* =====================================================
       COPY
       ===================================================== */

    const copyText = async (
        text,
        button = null
    ) => {

        const value =
            String(
                text || ""
            ).trim();


        if (!value) {
            return false;
        }


        try {

            if (
                navigator.clipboard
                    ?.writeText
            ) {

                await navigator
                    .clipboard
                    .writeText(
                        value
                    );

            }

            else {

                const textarea =
                    document.createElement(
                        "textarea"
                    );


                textarea.value =
                    value;


                textarea.style.position =
                    "fixed";


                textarea.style.opacity =
                    "0";


                document.body.appendChild(
                    textarea
                );


                textarea.select();


                document.execCommand(
                    "copy"
                );


                textarea.remove();

            }


            showCopiedState(
                button
            );


            emit(
                "neyo:message-copied",
                {
                    text:
                        value
                }
            );


            return true;

        }

        catch (error) {

            emit(
                "neyo:message-action-error",
                {
                    action:
                        "copy",

                    error
                }
            );


            window.NeyoNotifications
                ?.error?.(
                    "Could not copy message."
                );


            return false;

        }

    };


    /* =====================================================
       SHARE
       ===================================================== */

    const shareText = async (
        text,
        message = null
    ) => {

        const value =
            String(
                text || ""
            ).trim();


        if (!value) {
            return false;
        }


        try {

            if (
                typeof navigator.share ===
                "function"
            ) {

                await navigator.share({
                    text:
                        value
                });


                emit(
                    "neyo:message-shared",
                    {
                        text:
                            value,

                        method:
                            "native"
                    }
                );


                return true;

            }


            emit(
                "neyo:message-share-request",
                {
                    text:
                        value,

                    message
                }
            );


            return true;

        }

        catch (error) {

            if (
                error?.name ===
                "AbortError"
            ) {
                return false;
            }


            emit(
                "neyo:message-action-error",
                {
                    action:
                        "share",

                    error
                }
            );


            return false;

        }

    };


    /* =====================================================
       REGENERATE
       ===================================================== */

    const requestRegenerate =
        message => {

            const index =
                getMessageIndex(
                    message
                );


            emit(
                "neyo:message-regenerate-request",
                {
                    message,
                    index
                }
            );

        };


    /* =====================================================
       EDIT USER MESSAGE
       ===================================================== */

    const requestEdit =
        message => {

            const text =
                getMessageText(
                    message
                );


            const index =
                getMessageIndex(
                    message
                );


            emit(
                "neyo:message-edit-request",
                {
                    message,
                    text,
                    index
                }
            );

        };


    /* =====================================================
       ASSISTANT ACTIONS
       ===================================================== */

    const handleAssistantAction =
        (
            button,
            message
        ) => {

            const text =
                getMessageText(
                    message
                );


            if (
                button.classList
                    .contains(
                        "copy-msg-btn"
                    )
            ) {

                copyText(
                    text,
                    button
                );

                return true;

            }


            if (
                button.classList
                    .contains(
                        "share-msg-btn"
                    )
            ) {

                shareText(
                    text,
                    message
                );

                return true;

            }


            if (
                button.classList
                    .contains(
                        "regen-msg-btn"
                    )
            ) {

                requestRegenerate(
                    message
                );

                return true;

            }


            return false;

        };


    /* =====================================================
       USER ACTIONS
       ===================================================== */

    const handleUserAction =
        (
            button,
            message
        ) => {

            const text =
                getMessageText(
                    message
                );


            if (
                button.classList
                    .contains(
                        "user-copy-btn"
                    )
            ) {

                copyText(
                    text,
                    button
                );

                return true;

            }


            if (
                button.classList
                    .contains(
                        "user-edit-btn"
                    )
            ) {

                requestEdit(
                    message
                );

                return true;

            }


            return false;

        };


    /* =====================================================
       DELEGATED CLICK
       ===================================================== */

    chatMessages.addEventListener(
        "click",
        event => {

            const button =
                event.target.closest(
                    [
                        ".copy-msg-btn",
                        ".share-msg-btn",
                        ".regen-msg-btn",
                        ".user-copy-btn",
                        ".user-edit-btn"
                    ].join(",")
                );


            if (!button) {
                return;
            }


            const message =
                getMessageElement(
                    button
                );


            if (!message) {
                return;
            }


            event.preventDefault();
            event.stopPropagation();


            if (
                handleAssistantAction(
                    button,
                    message
                )
            ) {
                return;
            }


            handleUserAction(
                button,
                message
            );

        }
    );


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:message-copy-request",
        event => {

            copyText(
                event.detail?.text,
                event.detail?.button
            );

        }
    );


    window.addEventListener(
        "neyo:message-share-direct-request",
        event => {

            shareText(
                event.detail?.text,
                event.detail?.message
            );

        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoMessageActions =
        Object.freeze({

            copy:
                copyText,

            share:
                shareText,

            requestEdit,

            requestRegenerate,

            getText:
                getMessageText,

            getIndex:
                getMessageIndex

        });

})();
