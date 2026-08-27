/*
=========================================================
NEYO — REGENERATE COMPONENT

Owns:
- Regenerate assistant response
- Resolve target assistant message
- Find previous user message
- Trim conversation to regeneration point
- Re-send previous user message
- Regenerate lifecycle state
- Public regenerate API

Does NOT own:
- Chat API implementation
- Message DOM rendering
- Message action buttons
- History persistence
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


    const getConversation = () => {

        return (
            window.NeyoChat
                ?.getConversation?.() ||
            []
        );

    };


    const getMessageIndex = (
        message,
        suppliedIndex = null
    ) => {

        if (
            Number.isInteger(
                suppliedIndex
            )
        ) {
            return suppliedIndex;
        }


        if (
            !(message instanceof HTMLElement)
        ) {
            return null;
        }


        const value =
            Number(
                message.dataset
                    .msgIndex
            );


        return Number.isInteger(
            value
        )
            ? value
            : null;

    };


    /* =====================================================
       FIND REGENERATION POINT
       ===================================================== */

    const resolveRegeneration =
        (
            message,
            suppliedIndex = null
        ) => {

            const conversation =
                getConversation();


            if (!conversation.length) {
                return null;
            }


            let assistantIndex =
                getMessageIndex(
                    message,
                    suppliedIndex
                );


            /*
            If DOM index is unavailable,
            regenerate the latest assistant.
            */

            if (
                assistantIndex === null ||
                assistantIndex < 0 ||
                assistantIndex >=
                    conversation.length
            ) {

                assistantIndex =
                    -1;


                for (
                    let i =
                        conversation.length - 1;
                    i >= 0;
                    i--
                ) {

                    if (
                        conversation[i]
                            ?.role ===
                        "assistant"
                    ) {

                        assistantIndex =
                            i;

                        break;

                    }

                }

            }


            if (
                assistantIndex < 0
            ) {
                return null;
            }


            /*
            Find the user message that produced
            this assistant response.
            */

            let userIndex =
                -1;


            for (
                let i =
                    assistantIndex - 1;
                i >= 0;
                i--
            ) {

                if (
                    conversation[i]
                        ?.role ===
                    "user"
                ) {

                    userIndex =
                        i;

                    break;

                }

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


            return {
                conversation,
                assistantIndex,
                userIndex,
                userMessage
            };

        };


    /* =====================================================
       REGENERATE
       ===================================================== */

    const regenerate =
        async ({
            message = null,
            index = null
        } = {}) => {

            if (regenerating) {
                return null;
            }


            if (
                window.NeyoChat
                    ?.isGenerating?.()
            ) {
                return null;
            }


            if (
                !window.NeyoChat
                    ?.send ||
                !window.NeyoChat
                    ?.loadConversation
            ) {

                throw new Error(
                    "Chat service is not available."
                );

            }


            const target =
                resolveRegeneration(
                    message,
                    index
                );


            if (!target) {

                emit(
                    "neyo:regenerate-error",
                    {
                        reason:
                            "target-not-found"
                    }
                );


                return null;

            }


            const {
                conversation,
                userIndex,
                userMessage
            } = target;


            const conversationId =
                window.NeyoChat
                    ?.getConversationId?.() ||
                null;


            /*
            Keep everything BEFORE the user
            message being regenerated.

            NeyoChat.send() will add the user
            message again, then the new assistant
            response.
            */

            const preservedMessages =
                conversation.slice(
                    0,
                    userIndex
                );


            const text =
                String(
                    userMessage
                        ?.content ||
                    ""
                );


            const attachments =
                Array.isArray(
                    userMessage
                        ?.attachments
                )
                    ? userMessage
                        .attachments
                    : [];


            regenerating =
                true;


            emit(
                "neyo:regenerate-start",
                {
                    message,
                    index:
                        target
                            .assistantIndex,

                    userIndex,

                    text,
                    attachments
                }
            );


            try {

                /*
                Restore chat state to the point
                immediately before the original
                user request.
                */

                window.NeyoChat
                    .loadConversation({
                        conversationId,
                        messages:
                            preservedMessages
                    });


                /*
                Tell renderer/history UI that
                messages after this point should
                be removed before the replacement
                response appears.
                */

                emit(
                    "neyo:messages-truncate-request",
                    {
                        fromIndex:
                            userIndex
                    }
                );


                const result =
                    await window
                        .NeyoChat
                        .send({
                            text,
                            attachments
                        });


                if (!result) {

                    /*
                    Restore original state if
                    regeneration did not complete.
                    */

                    window.NeyoChat
                        .loadConversation({
                            conversationId,
                            messages:
                                conversation
                        });


                    emit(
                        "neyo:regenerate-cancelled",
                        {
                            message,
                            index:
                                target
                                    .assistantIndex
                        }
                    );


                    return null;

                }


                emit(
                    "neyo:regenerate-success",
                    {
                        result,

                        message,

                        index:
                            target
                                .assistantIndex,

                        userIndex
                    }
                );


                return result;

            }

            catch (error) {

                /*
                Restore previous conversation state
                on failure.
                */

                window.NeyoChat
                    .loadConversation({
                        conversationId,
                        messages:
                            conversation
                    });


                emit(
                    "neyo:regenerate-error",
                    {
                        error,
                        message,
                        index:
                            target
                                .assistantIndex
                    }
                );


                window.NeyoNotifications
                    ?.error?.(
                        error?.message ||
                        "Could not regenerate response."
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
       MESSAGE ACTION EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:message-regenerate-request",
        event => {

            regenerate({
                message:
                    event.detail
                        ?.message ||
                    null,

                index:
                    event.detail
                        ?.index ??
                    null
            }).catch(
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
       DIRECT REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:regenerate-request",
        event => {

            regenerate(
                event.detail ||
                {}
            ).catch(
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

            isRegenerating:
                () =>
                    regenerating

        });

})();
