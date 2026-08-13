/*
=========================================================
NEYO — REGENERATE COMPONENT

Owns:
- Assistant regenerate flow
- Edited user message resubmit flow
- Conversation trimming
- Regeneration busy state
- Regeneration lifecycle events

Does NOT own:
- Message DOM rendering
- Edit UI
- Chat API implementation
- Markdown rendering
- History UI
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       STATE
       ===================================================== */

    let regenerating =
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


    const notifyError =
        message => {

            window.NeyoNotifications
                ?.error?.(
                    message
                );

        };


    const getConversation = () => {

        return (
            window.NeyoChat
                ?.getConversation?.() ||
            []
        );

    };


    const getConversationId = () => {

        return (
            window.NeyoChat
                ?.getConversationId?.() ||
            null
        );

    };


    /* =====================================================
       LOAD TRIMMED CONVERSATION
       ===================================================== */

    const replaceConversationState =
        messages => {

            if (
                !window.NeyoChat
                    ?.loadConversation
            ) {

                throw new Error(
                    "Chat state service is not available."
                );

            }


            window.NeyoChat
                .loadConversation({
                    conversationId:
                        getConversationId(),

                    messages
                });

        };


    /* =====================================================
       REGENERATE ASSISTANT MESSAGE
       ===================================================== */

    const regenerate =
        async ({
            index = null
        } = {}) => {

            if (regenerating) {
                return null;
            }


            if (
                !window.NeyoChat
                    ?.send
            ) {

                throw new Error(
                    "Chat service is not available."
                );

            }


            const conversation =
                getConversation();


            if (
                !conversation.length
            ) {

                return null;

            }


            let assistantIndex =
                Number.isInteger(
                    index
                )
                    ? index
                    : conversation.length - 1;


            /*
            If supplied index is not an assistant
            message, walk backwards until one is found.
            */

            while (
                assistantIndex >= 0 &&
                conversation[
                    assistantIndex
                ]?.role !==
                    "assistant"
            ) {

                assistantIndex--;

            }


            if (
                assistantIndex < 0
            ) {

                return null;

            }


            /*
            The user message immediately before
            the assistant reply becomes the resend
            prompt.
            */

            let userIndex =
                assistantIndex - 1;


            while (
                userIndex >= 0 &&
                conversation[
                    userIndex
                ]?.role !==
                    "user"
            ) {

                userIndex--;

            }


            if (
                userIndex < 0
            ) {

                return null;

            }


            const userMessage =
                conversation[
                    userIndex
                ];


            const historyBeforeUser =
                conversation.slice(
                    0,
                    userIndex
                );


            regenerating =
                true;


            emit(
                "neyo:regenerate-start",
                {
                    assistantIndex,
                    userIndex
                }
            );


            try {

                /*
                Remove original user + assistant pair
                from local state first.

                NeyoChat.send() will append the user
                message again before requesting AI.
                */

                replaceConversationState(
                    historyBeforeUser
                );


                const result =
                    await window.NeyoChat
                        .send({
                            text:
                                userMessage
                                    ?.content ||
                                "",

                            attachments:
                                userMessage
                                    ?.attachments ||
                                []
                        });


                if (!result) {

                    /*
                    Restore original conversation when
                    request was aborted/rate-limited.
                    */

                    replaceConversationState(
                        conversation
                    );


                    return null;

                }


                emit(
                    "neyo:regenerate-success",
                    {
                        result,
                        assistantIndex,
                        userIndex
                    }
                );


                return result;

            }

            catch (error) {

                replaceConversationState(
                    conversation
                );


                emit(
                    "neyo:regenerate-error",
                    {
                        error
                    }
                );


                notifyError(
                    error?.message ||
                    "Response could not be regenerated."
                );


                throw error;

            }

            finally {

                regenerating =
                    false;


                emit(
                    "neyo:regenerate-end"
                );

            }

        };


    /* =====================================================
       EDITED MESSAGE RESUBMIT
       ===================================================== */

    const resubmitEditedMessage =
        async ({
            index,
            text,
            attachments = []
        } = {}) => {

            if (regenerating) {
                return null;
            }


            const updatedText =
                String(
                    text || ""
                ).trim();


            if (!updatedText) {
                return null;
            }


            if (
                !window.NeyoChat
                    ?.send
            ) {

                throw new Error(
                    "Chat service is not available."
                );

            }


            const conversation =
                getConversation();


            let userIndex =
                Number(index);


            if (
                !Number.isInteger(
                    userIndex
                ) ||
                userIndex < 0 ||
                conversation[
                    userIndex
                ]?.role !==
                    "user"
            ) {

                /*
                Fallback:
                find latest user message.
                */

                userIndex =
                    conversation.length - 1;


                while (
                    userIndex >= 0 &&
                    conversation[
                        userIndex
                    ]?.role !==
                        "user"
                ) {

                    userIndex--;

                }

            }


            if (
                userIndex < 0
            ) {

                return null;

            }


            const historyBeforeUser =
                conversation.slice(
                    0,
                    userIndex
                );


            const originalConversation =
                [...conversation];


            const originalMessage =
                conversation[
                    userIndex
                ];


            const finalAttachments =
                Array.isArray(
                    attachments
                ) &&
                attachments.length
                    ? attachments
                    : originalMessage
                        ?.attachments ||
                      [];


            regenerating =
                true;


            emit(
                "neyo:message-edit-resubmit-start",
                {
                    index:
                        userIndex,

                    text:
                        updatedText
                }
            );


            try {

                /*
                Remove edited message and everything
                after it.

                New edited user message and fresh AI
                response will replace that branch.
                */

                replaceConversationState(
                    historyBeforeUser
                );


                const result =
                    await window.NeyoChat
                        .send({
                            text:
                                updatedText,

                            attachments:
                                finalAttachments
                        });


                if (!result) {

                    replaceConversationState(
                        originalConversation
                    );


                    return null;

                }


                window.NeyoMessageEdit
                    ?.complete?.();


                emit(
                    "neyo:message-edit-resubmit-success",
                    {
                        result,
                        index:
                            userIndex,

                        text:
                            updatedText
                    }
                );


                return result;

            }

            catch (error) {

                replaceConversationState(
                    originalConversation
                );


                emit(
                    "neyo:message-edit-resubmit-error",
                    {
                        error,
                        index:
                            userIndex
                    }
                );


                notifyError(
                    error?.message ||
                    "Edited message could not be submitted."
                );


                throw error;

            }

            finally {

                regenerating =
                    false;


                emit(
                    "neyo:message-edit-resubmit-end"
                );

            }

        };


    /* =====================================================
       MESSAGE ACTION CONNECTION
       ===================================================== */

    window.addEventListener(
        "neyo:message-regenerate-request",
        event => {

            regenerate({
                index:
                    event.detail?.index
            })
                .catch(
                    error => {

                        console.error(
                            "Regenerate failed:",
                            error
                        );

                    }
                );

        }
    );


    /* =====================================================
       EDIT CONNECTION
       ===================================================== */

    window.addEventListener(
        "neyo:message-edit-submit",
        event => {

            resubmitEditedMessage({
                index:
                    event.detail?.index,

                text:
                    event.detail?.text,

                attachments:
                    event.detail
                        ?.attachments ||
                    []
            })
                .catch(
                    error => {

                        console.error(
                            "Edited message resend failed:",
                            error
                        );

                    }
                );

        }
    );


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:regenerate-request",
        event => {

            regenerate(
                event.detail ||
                {}
            )
                .catch(
                    error => {

                        console.error(
                            "Regenerate failed:",
                            error
                        );

                    }
                );

        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoRegenerate =
        Object.freeze({

            regenerate,

            resubmitEditedMessage,

            isRegenerating:
                () =>
                    regenerating

        });

})();
