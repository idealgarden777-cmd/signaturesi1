/*
=========================================================
NEYO — SEND ORCHESTRATOR

Owns:
- Send button click
- Enter-to-send
- Composer → upload → chat flow
- Send busy state
- Composer reset after success
- Attachment clear after success
- Stop generation button state bridge

Does NOT own:
- Chat API
- File upload implementation
- Attachment picker
- Message rendering
- Composer resize logic
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const chatInput =
        document.getElementById(
            "chatInput"
        );

    const sendBtn =
        document.getElementById(
            "sendBtn"
        );


    if (
        !chatInput ||
        !sendBtn
    ) {
        return;
    }


    /* =====================================================
       STATE
       ===================================================== */

    let sending =
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


    const getText = () => {

        return String(
            chatInput.value || ""
        ).trim();

    };


    const getAttachments = () => {

        return (
            window.NeyoAttachments
                ?.getFiles?.() ||
            []
        );

    };


    const hasContent = () => {

        return (
            getText().length > 0 ||
            getAttachments().length > 0
        );

    };


    /* =====================================================
       BUTTON STATE
       ===================================================== */

    const updateSendButton = () => {

        const generating =
            window.NeyoChat
                ?.isGenerating?.() ||
            false;


        const enabled =
            hasContent() &&
            !sending &&
            !generating;


        sendBtn.disabled =
            !enabled;


        sendBtn.classList.toggle(
            "is-ready",
            enabled
        );


        sendBtn.classList.toggle(
            "is-busy",
            sending ||
            generating
        );


        sendBtn.setAttribute(
            "aria-disabled",
            String(!enabled)
        );

    };


    /* =====================================================
       RESET COMPOSER
       ===================================================== */

    const resetComposer = () => {

        window.dispatchEvent(
            new CustomEvent(
                "neyo:composer-reset"
            )
        );


        window.NeyoAttachments
            ?.clear?.();


        updateSendButton();

    };


    /* =====================================================
       UPLOAD ATTACHMENTS
       ===================================================== */

    const prepareAttachments =
        async () => {

            const attachments =
                getAttachments();


            if (!attachments.length) {
                return [];
            }


            const uploaded =
                attachments.filter(
                    file =>
                        Boolean(
                            file?.path
                        )
                );


            const pending =
                attachments.filter(
                    file =>
                        !file?.path
                );


            if (!pending.length) {
                return uploaded;
            }


            if (
                !window.NeyoUpload
                    ?.uploadFiles
            ) {

                throw new Error(
                    "Upload service is not available."
                );

            }


            const newUploads =
                await window
                    .NeyoUpload
                    .uploadFiles(
                        pending
                    );


            return [
                ...uploaded,
                ...newUploads
            ];

        };


    /* =====================================================
       SEND
       ===================================================== */

    const sendMessage =
        async () => {

            if (sending) {
                return null;
            }


            if (
                window.NeyoChat
                    ?.isGenerating?.()
            ) {
                return null;
            }


            const text =
                getText();


            const attachments =
                getAttachments();


            if (
                !text &&
                attachments.length === 0
            ) {

                updateSendButton();

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


            sending =
                true;


            updateSendButton();


            emit(
                "neyo:send-start",
                {
                    text,

                    attachmentCount:
                        attachments.length
                }
            );


            try {

                const uploadedFiles =
                    await prepareAttachments();


                const result =
                    await window
                        .NeyoChat
                        .send({
                            text,
                            attachments:
                                uploadedFiles
                        });


                if (!result) {

                    updateSendButton();

                    return null;

                }


                resetComposer();


                emit(
                    "neyo:send-success",
                    {
                        result
                    }
                );


                return result;

            }

            catch (error) {

                emit(
                    "neyo:send-error",
                    {
                        error
                    }
                );


                window.NeyoNotifications
                    ?.error?.(
                        error?.message ||
                        "Message could not be sent."
                    );


                throw error;

            }

            finally {

                sending =
                    false;


                updateSendButton();


                emit(
                    "neyo:send-end"
                );

            }

        };


    /* =====================================================
       SEND BUTTON
       ===================================================== */

    sendBtn.addEventListener(
        "click",
        event => {

            event.preventDefault();


            sendMessage()
                .catch(
                    error => {

                        console.error(
                            "Send failed:",
                            error
                        );

                    }
                );

        }
    );


    /* =====================================================
       ENTER TO SEND
       ===================================================== */

    chatInput.addEventListener(
        "keydown",
        event => {

            if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.isComposing
            ) {
                return;
            }


            event.preventDefault();


            sendMessage()
                .catch(
                    error => {

                        console.error(
                            "Send failed:",
                            error
                        );

                    }
                );

        }
    );


    /* =====================================================
       INPUT STATE
       ===================================================== */

    chatInput.addEventListener(
        "input",
        updateSendButton
    );


    window.addEventListener(
        "neyo:attachments-change",
        updateSendButton
    );


    window.addEventListener(
        "neyo:chat-send-start",
        updateSendButton
    );


    window.addEventListener(
        "neyo:chat-send-end",
        updateSendButton
    );


    window.addEventListener(
        "neyo:composer-change",
        updateSendButton
    );


    /* =====================================================
       PUBLIC SEND REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:send-request",
        () => {

            sendMessage()
                .catch(
                    error => {

                        console.error(
                            "Send failed:",
                            error
                        );

                    }
                );

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    updateSendButton();


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoSend =
        Object.freeze({

            send:
                sendMessage,

            refresh:
                updateSendButton,

            canSend:
                () =>
                    hasContent() &&
                    !sending &&
                    !(
                        window.NeyoChat
                            ?.isGenerating?.()
                    ),

            isSending:
                () =>
                    sending

        });

})();
