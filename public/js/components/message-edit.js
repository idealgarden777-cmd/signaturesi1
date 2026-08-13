/*
=========================================================
NEYO — MESSAGE EDIT COMPONENT

Owns:
- User message edit mode
- Edit textarea
- Existing attachment preview
- Cancel edit
- Save & submit request
- Edit keyboard behavior
- Public edit API

Does NOT own:
- Chat API
- Message resend implementation
- Attachment upload
- History persistence
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       STATE
       ===================================================== */

    let activeEdit = null;


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


    const getFileIcon =
        file => {

            const type =
                String(
                    file?.mimeType ||
                    file?.type ||
                    ""
                ).toLowerCase();


            if (
                type.startsWith(
                    "image/"
                )
            ) {
                return "image";
            }


            if (
                type.startsWith(
                    "audio/"
                )
            ) {
                return "music";
            }


            if (
                type.startsWith(
                    "video/"
                )
            ) {
                return "video";
            }


            if (
                type.includes(
                    "pdf"
                )
            ) {
                return "file-text";
            }


            return "file";

        };


    const isImageAttachment =
        file => {

            const type =
                String(
                    file?.mimeType ||
                    file?.type ||
                    ""
                ).toLowerCase();


            if (
                type.startsWith(
                    "image/"
                )
            ) {
                return true;
            }


            return (
                file?.category ===
                "image"
            );

        };


    const getAttachmentPreviewUrl =
        file => {

            return (
                file?.previewUrl ||
                file?.signedUrl ||
                file?.url ||
                ""
            );

        };


    /* =====================================================
       RESTORE MESSAGE
       ===================================================== */

    const restoreMessage =
        editState => {

            if (
                !editState?.message
            ) {
                return;
            }


            /*
            message-edit.js does not rebuild the normal
            user message shell itself.

            messages.js / future message-view module
            receives the restoration request.
            */

            emit(
                "neyo:user-message-restore-request",
                {
                    message:
                        editState.message,

                    text:
                        editState.originalText,

                    index:
                        editState.index,

                    attachments:
                        editState.attachments
                }
            );

        };


    /* =====================================================
       CANCEL
       ===================================================== */

    const cancelEdit = () => {

        if (!activeEdit) {
            return false;
        }


        const state =
            activeEdit;


        activeEdit =
            null;


        restoreMessage(
            state
        );


        emit(
            "neyo:message-edit-cancelled",
            {
                message:
                    state.message,

                index:
                    state.index
            }
        );


        return true;

    };


    /* =====================================================
       SAVE
       ===================================================== */

    const saveEdit = () => {

        if (!activeEdit) {
            return false;
        }


        const textarea =
            activeEdit.textarea;


        const updatedText =
            String(
                textarea?.value ||
                ""
            ).trim();


        if (!updatedText) {

            textarea?.focus();

            return false;

        }


        const state =
            activeEdit;


        /*
        Do not clear active state yet.

        The future resend/edit orchestrator can decide
        whether submission succeeded or failed.
        */

        emit(
            "neyo:message-edit-submit",
            {
                message:
                    state.message,

                originalText:
                    state.originalText,

                text:
                    updatedText,

                index:
                    state.index,

                attachments:
                    state.attachments
            }
        );


        return true;

    };


    /* =====================================================
       ATTACHMENT PREVIEW
       ===================================================== */

    const renderAttachments = (
        wrapper,
        attachments
    ) => {

        if (
            !wrapper ||
            !Array.isArray(
                attachments
            )
        ) {
            return;
        }


        attachments.forEach(
            file => {

                if (
                    isImageAttachment(
                        file
                    )
                ) {

                    const previewUrl =
                        getAttachmentPreviewUrl(
                            file
                        );


                    if (!previewUrl) {
                        return;
                    }


                    const image =
                        document.createElement(
                            "img"
                        );


                    image.src =
                        previewUrl;


                    image.alt =
                        file?.name ||
                        "Image";


                    wrapper.appendChild(
                        image
                    );


                    return;

                }


                const pill =
                    document.createElement(
                        "div"
                    );


                pill.className =
                    "message-file-pill";


                const icon =
                    document.createElement(
                        "i"
                    );


                icon.setAttribute(
                    "data-lucide",
                    getFileIcon(
                        file
                    )
                );


                icon.setAttribute(
                    "width",
                    "14"
                );


                icon.setAttribute(
                    "height",
                    "14"
                );


                const name =
                    document.createElement(
                        "span"
                    );


                name.textContent =
                    file?.name ||
                    "File";


                pill.append(
                    icon,
                    name
                );


                wrapper.appendChild(
                    pill
                );

            }
        );

    };


    /* =====================================================
       START EDIT
       ===================================================== */

    const startEdit = ({
        message,
        text = "",
        index = null,
        attachments = []
    } = {}) => {

        if (
            !(message instanceof HTMLElement)
        ) {
            return false;
        }


        /*
        Only one edit session at a time.
        */

        if (
            activeEdit &&
            activeEdit.message !==
                message
        ) {

            cancelEdit();

        }


        const originalText =
            String(
                text || ""
            );


        const existingAttachments =
            Array.isArray(
                attachments
            )
                ? [...attachments]
                : [];


        /* -----------------------------------------
           CLEAR CURRENT USER MESSAGE CONTENT
           ----------------------------------------- */

        message.replaceChildren();


        /* -----------------------------------------
           EDIT BOX
           ----------------------------------------- */

        const editBox =
            document.createElement(
                "div"
            );


        editBox.className =
            "edit-message-box";


        /* -----------------------------------------
           MEDIA
           ----------------------------------------- */

        const mediaWrapper =
            document.createElement(
                "div"
            );


        mediaWrapper.className =
            "edit-message-media";


        renderAttachments(
            mediaWrapper,
            existingAttachments
        );


        editBox.appendChild(
            mediaWrapper
        );


        /* -----------------------------------------
           TEXTAREA
           ----------------------------------------- */

        const textarea =
            document.createElement(
                "textarea"
            );


        textarea.className =
            "edit-textarea";


        textarea.rows =
            2;


        textarea.value =
            originalText;


        textarea.setAttribute(
            "aria-label",
            "Edit message"
        );


        /* -----------------------------------------
           ACTIONS
           ----------------------------------------- */

        const actions =
            document.createElement(
                "div"
            );


        actions.className =
            "edit-actions";


        const cancelButton =
            document.createElement(
                "button"
            );


        cancelButton.type =
            "button";


        cancelButton.className =
            "edit-btn-cancel";


        cancelButton.textContent =
            "Cancel";


        const saveButton =
            document.createElement(
                "button"
            );


        saveButton.type =
            "button";


        saveButton.className =
            "edit-btn-save";


        saveButton.textContent =
            "Save & Submit";


        actions.append(
            cancelButton,
            saveButton
        );


        editBox.append(
            textarea,
            actions
        );


        message.appendChild(
            editBox
        );


        /* -----------------------------------------
           STATE
           ----------------------------------------- */

        activeEdit = {

            message,

            editBox,

            textarea,

            originalText,

            index,

            attachments:
                existingAttachments

        };


        /* -----------------------------------------
           EVENTS
           ----------------------------------------- */

        cancelButton.addEventListener(
            "click",
            cancelEdit
        );


        saveButton.addEventListener(
            "click",
            saveEdit
        );


        textarea.addEventListener(
            "keydown",
            event => {

                if (
                    event.key ===
                    "Escape"
                ) {

                    event.preventDefault();

                    cancelEdit();

                    return;

                }


                /*
                Ctrl/Cmd + Enter =
                Save & Submit
                */

                if (
                    event.key ===
                        "Enter" &&
                    (
                        event.ctrlKey ||
                        event.metaKey
                    )
                ) {

                    event.preventDefault();

                    saveEdit();

                }

            }
        );


        refreshIcons();


        requestAnimationFrame(
            () => {

                textarea.focus();


                textarea.setSelectionRange(
                    textarea.value.length,
                    textarea.value.length
                );

            }
        );


        emit(
            "neyo:message-edit-started",
            {
                message,

                text:
                    originalText,

                index,

                attachments:
                    existingAttachments
            }
        );


        return true;

    };


    /* =====================================================
       SUBMISSION RESULT
       ===================================================== */

    const completeEdit = () => {

        if (!activeEdit) {
            return;
        }


        activeEdit =
            null;


        emit(
            "neyo:message-edit-complete"
        );

    };


    /* =====================================================
       LISTEN TO MESSAGE ACTIONS
       ===================================================== */

    window.addEventListener(
        "neyo:message-edit-request",
        event => {

            startEdit({
                message:
                    event.detail?.message,

                text:
                    event.detail?.text ||
                    "",

                index:
                    event.detail?.index,

                attachments:
                    event.detail?.attachments ||
                    []
            });

        }
    );


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:message-edit-cancel-request",
        cancelEdit
    );


    window.addEventListener(
        "neyo:message-edit-complete-request",
        completeEdit
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoMessageEdit =
        Object.freeze({

            start:
                startEdit,

            cancel:
                cancelEdit,

            save:
                saveEdit,

            complete:
                completeEdit,

            isEditing:
                () =>
                    Boolean(
                        activeEdit
                    ),

            getState:
                () => {

                    if (!activeEdit) {
                        return null;
                    }


                    return {
                        message:
                            activeEdit.message,

                        text:
                            activeEdit.textarea
                                ?.value ||
                            "",

                        originalText:
                            activeEdit.originalText,

                        index:
                            activeEdit.index,

                        attachments:
                            [
                                ...activeEdit
                                    .attachments
                            ]
                    };

                }

        });

})();
