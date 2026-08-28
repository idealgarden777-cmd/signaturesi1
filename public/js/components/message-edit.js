/*
=========================================================
NEYO — MESSAGE EDIT COMPONENT
DIRECT WORKING RESTORE v2

FILE:
public/js/components/message-edit.js

OWNS
---------------------------------------------------------
- User message edit mode
- Edit textarea
- Existing attachment preview
- Cancel edit
- Save & Submit
- Edited conversation truncation
- Edited resend through canonical NeyoChat
- Edit keyboard behavior
- Public edit API

DOES NOT OWN
---------------------------------------------------------
- /api/chat implementation
- Normal message rendering
- Normal Send button
- History API
- Attachment uploading
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       VERSION
       ===================================================== */

    const VERSION =
        "neyo-message-edit-direct-v2";


    /* =====================================================
       STATE
       ===================================================== */

    let activeEdit =
        null;


    /* =====================================================
       EVENTS
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
       ICONS
       ===================================================== */

    const refreshIcons = () => {

        try {

            window.lucide
                ?.createIcons
                ?.();

        } catch {}

    };


    /* =====================================================
       TEXT
       ===================================================== */

    const clean = value => {

        return String(
            value ?? ""
        )
            .replace(
                /\u0000/g,
                ""
            )
            .replace(
                /\r\n?/g,
                "\n"
            )
            .trim();

    };


    /* =====================================================
       CHAT
       ===================================================== */

    const getChat = () => {

        const chat =
            window.NeyoChat;


        if (
            !chat ||
            chat.__controller !==
                true
        ) {

            return null;

        }


        return chat;

    };


    const getConversation = () => {

        try {

            const messages =
                getChat()
                    ?.getConversation
                    ?.();


            return Array.isArray(
                messages
            )
                ? messages
                : [];

        } catch {

            return [];

        }

    };


    /* =====================================================
       MESSAGE ID
       ===================================================== */

    const getDomMessageId =
        message => {

            if (
                !(message instanceof HTMLElement)
            ) {
                return "";
            }


            return clean(
                message.dataset
                    ?.neyoMessageId ||
                message.dataset
                    ?.messageId ||
                ""
            );

        };


    /* =====================================================
       INDEX RESOLUTION
       ===================================================== */

    const resolveMessageIndex = (
        message,
        suppliedIndex,
        originalText
    ) => {

        const conversation =
            getConversation();


        if (
            Number.isInteger(
                suppliedIndex
            ) &&
            suppliedIndex >= 0 &&
            suppliedIndex <
                conversation.length &&
            conversation[
                suppliedIndex
            ]?.role ===
                "user"
        ) {

            return suppliedIndex;

        }


        const id =
            getDomMessageId(
                message
            );


        if (id) {

            const byId =
                conversation.findIndex(
                    item =>
                        clean(
                            item?.id
                        ) === id
                );


            if (
                byId >= 0 &&
                conversation[
                    byId
                ]?.role ===
                    "user"
            ) {

                return byId;

            }

        }


        /*
         * Final compatibility fallback.
         * Prefer latest matching user message.
         */

        const text =
            clean(
                originalText
            );


        for (
            let i =
                conversation.length - 1;
            i >= 0;
            i--
        ) {

            const item =
                conversation[i];


            if (
                item?.role ===
                    "user" &&
                clean(
                    item.content
                ) === text
            ) {

                return i;

            }

        }


        return -1;

    };


    /* =====================================================
       ATTACHMENTS
       ===================================================== */

    const resolveAttachments = (
        suppliedAttachments,
        index
    ) => {

        if (
            Array.isArray(
                suppliedAttachments
            ) &&
            suppliedAttachments.length >
                0
        ) {

            return suppliedAttachments
                .map(
                    file => ({
                        ...file
                    })
                );

        }


        const conversation =
            getConversation();


        if (
            index >= 0 &&
            index <
                conversation.length &&
            Array.isArray(
                conversation[
                    index
                ]?.attachments
            )
        ) {

            return conversation[
                index
            ].attachments
                .map(
                    file => ({
                        ...file
                    })
                );

        }


        return [];

    };


    /* =====================================================
       FILE HELPERS
       ===================================================== */

    const getFileIcon =
        file => {

            const type =
                clean(
                    file?.mimeType ||
                    file?.mime ||
                    file?.type ||
                    ""
                )
                    .toLowerCase();


            const category =
                clean(
                    file?.category ||
                    ""
                )
                    .toLowerCase();


            if (
                category === "image" ||
                type.startsWith(
                    "image/"
                )
            ) {

                return "image";

            }


            if (
                category === "audio" ||
                type.startsWith(
                    "audio/"
                )
            ) {

                return "audio-lines";

            }


            if (
                category === "video" ||
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
                clean(
                    file?.mimeType ||
                    file?.mime ||
                    file?.type ||
                    ""
                )
                    .toLowerCase();


            return (
                file?.category ===
                    "image" ||
                type.startsWith(
                    "image/"
                )
            );

        };


    const getAttachmentPreviewUrl =
        file => {

            return clean(
                file?.previewUrl ||
                file?.signedUrl ||
                file?.url ||
                ""
            );

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
            ) ||
            attachments.length ===
                0
        ) {

            return;

        }


        attachments.forEach(
            file => {

                if (
                    !file ||
                    typeof file !==
                        "object"
                ) {

                    return;

                }


                if (
                    isImageAttachment(
                        file
                    )
                ) {

                    const previewUrl =
                        getAttachmentPreviewUrl(
                            file
                        );


                    if (previewUrl) {

                        const image =
                            document.createElement(
                                "img"
                            );


                        image.src =
                            previewUrl;


                        image.alt =
                            file.name ||
                            "Image";


                        wrapper.appendChild(
                            image
                        );


                        return;

                    }

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
       RESTORE ORIGINAL DOM
       ===================================================== */

    const restoreOriginalDom =
        editState => {

            if (
                !editState?.message ||
                !Array.isArray(
                    editState.originalNodes
                )
            ) {

                return false;

            }


            /*
             * Exact original message DOM nodes are restored.
             * Nothing is reconstructed or redesigned.
             */

            editState.message
                .replaceChildren(
                    ...editState
                        .originalNodes
                );


            refreshIcons();


            return true;

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


        restoreOriginalDom(
            state
        );


        emit(
            "neyo:message-edit-cancelled",
            {

                message:
                    state.message,

                index:
                    state.index,

                text:
                    state.originalText,

                attachments:
                    state.attachments

            }
        );


        return true;

    };


    /* =====================================================
       SAVE / RESEND
       ===================================================== */

    const saveEdit =
        async () => {

            if (!activeEdit) {

                return false;

            }


            const state =
                activeEdit;


            const updatedText =
                clean(
                    state.textarea
                        ?.value
                );


            if (!updatedText) {

                state.textarea
                    ?.focus();


                return false;

            }


            const chat =
                getChat();


            if (
                !chat ||
                typeof chat.send !==
                    "function" ||
                typeof chat.loadConversation !==
                    "function" ||
                typeof chat.getConversation !==
                    "function"
            ) {

                console.error(
                    "[NEYO Edit] Chat controller unavailable."
                );


                return false;

            }


            if (
                chat.isGenerating?.()
            ) {

                return false;

            }


            const conversation =
                chat.getConversation();


            const index =
                resolveMessageIndex(
                    state.message,
                    state.index,
                    state.originalText
                );


            if (
                index < 0 ||
                index >=
                    conversation.length
            ) {

                console.error(
                    "[NEYO Edit] Original user message not found."
                );


                return false;

            }


            const attachments =
                resolveAttachments(
                    state.attachments,
                    index
                );


            const conversationId =
                chat.getConversationId
                    ?.() ||
                null;


            /*
             * Keep everything BEFORE edited user message.
             *
             * NeyoChat.send() will append:
             * 1. edited user message
             * 2. fresh assistant response
             */

            const preservedMessages =
                conversation.slice(
                    0,
                    index
                );


            /*
             * Edit UI is no longer active once canonical
             * chat state takes over.
             */

            activeEdit =
                null;


            emit(
                "neyo:message-edit-submit",
                {

                    message:
                        state.message,

                    originalText:
                        state.originalText,

                    text:
                        updatedText,

                    index,

                    attachments

                }
            );


            emit(
                "neyo:message-edit-send-start",
                {

                    index,

                    text:
                        updatedText,

                    attachments

                }
            );


            try {

                /*
                 * Canonical state reset.
                 *
                 * loadConversation() also refreshes the
                 * visible DOM through the existing messages
                 * pipeline.
                 */

                chat.loadConversation({
                    conversationId,
                    messages:
                        preservedMessages
                });


                /*
                 * Canonical resend.
                 */

                const result =
                    await chat.send({

                        text:
                            updatedText,

                        attachments

                    });


                if (!result) {

                    /*
                     * If resend was rejected/cancelled,
                     * restore the exact previous conversation.
                     */

                    chat.loadConversation({
                        conversationId,
                        messages:
                            conversation
                    });


                    emit(
                        "neyo:message-edit-send-cancelled",
                        {
                            index
                        }
                    );


                    return false;

                }


                emit(
                    "neyo:message-edit-complete-request",
                    {
                        index
                    }
                );


                emit(
                    "neyo:message-edit-success",
                    {

                        index,

                        text:
                            updatedText,

                        result

                    }
                );


                return true;

            } catch (
                error
            ) {

                console.error(
                    "[NEYO Edit] Edited message send failed:",
                    error
                );


                /*
                 * Restore previous canonical state.
                 */

                try {

                    chat.loadConversation({
                        conversationId,
                        messages:
                            conversation
                    });

                } catch {}


                emit(
                    "neyo:message-edit-error",
                    {

                        index,

                        error

                    }
                );


                return false;

            }

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


        const chat =
            getChat();


        if (
            chat?.isGenerating?.()
        ) {

            return false;

        }


        /*
         * If another message is being edited,
         * restore it first.
         */

        if (
            activeEdit &&
            activeEdit.message !==
                message
        ) {

            cancelEdit();

        }


        if (
            activeEdit?.message ===
                message
        ) {

            return true;

        }


        const originalText =
            clean(
                text ||
                message
                    .querySelector(
                        ".message-content"
                    )
                    ?.innerText ||
                ""
            );


        const resolvedIndex =
            resolveMessageIndex(
                message,
                index,
                originalText
            );


        const existingAttachments =
            resolveAttachments(
                attachments,
                resolvedIndex
            );


        /*
         * IMPORTANT:
         *
         * Keep the exact current nodes.
         * Cancel will restore these same nodes,
         * not rebuild the message.
         */

        const originalNodes =
            Array.from(
                message.childNodes
            );


        message.replaceChildren();


        /* =================================================
           EDIT BOX
           ================================================= */

        const editBox =
            document.createElement(
                "div"
            );


        editBox.className =
            "edit-message-box";


        /* =================================================
           ATTACHMENTS
           ================================================= */

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


        if (
            mediaWrapper
                .childNodes
                .length >
            0
        ) {

            editBox.appendChild(
                mediaWrapper
            );

        }


        /* =================================================
           TEXTAREA
           ================================================= */

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


        /* =================================================
           ACTIONS
           ================================================= */

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


        /* =================================================
           STATE
           ================================================= */

        activeEdit = {

            message,

            editBox,

            textarea,

            originalNodes,

            originalText,

            index:
                resolvedIndex,

            attachments:
                existingAttachments

        };


        /* =================================================
           CANCEL CLICK
           ================================================= */

        cancelButton.addEventListener(
            "click",
            event => {

                event.preventDefault();

                event.stopPropagation();


                cancelEdit();

            }
        );


        /* =================================================
           SAVE CLICK
           ================================================= */

        saveButton.addEventListener(
            "click",
            event => {

                event.preventDefault();

                event.stopPropagation();


                void saveEdit();

            }
        );


        /* =================================================
           KEYBOARD
           ================================================= */

        textarea.addEventListener(
            "keydown",
            event => {

                if (
                    event.key ===
                    "Escape"
                ) {

                    event.preventDefault();

                    event.stopPropagation();


                    cancelEdit();


                    return;

                }


                if (
                    event.key ===
                        "Enter" &&
                    (
                        event.ctrlKey ||
                        event.metaKey
                    )
                ) {

                    event.preventDefault();

                    event.stopPropagation();


                    void saveEdit();

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

                index:
                    resolvedIndex,

                attachments:
                    existingAttachments

            }
        );


        return true;

    };


    /* =====================================================
       COMPLETE
       ===================================================== */

    const completeEdit = () => {

        activeEdit =
            null;


        emit(
            "neyo:message-edit-complete"
        );


        return true;

    };


    /* =====================================================
       EDIT REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:message-edit-request",
        event => {

            startEdit({

                message:
                    event.detail
                        ?.message,

                text:
                    event.detail
                        ?.text ||
                    "",

                index:
                    event.detail
                        ?.index,

                attachments:
                    event.detail
                        ?.attachments ||
                    []

            });

        }
    );


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:message-edit-cancel-request",
        () => {

            cancelEdit();

        }
    );


    window.addEventListener(
        "neyo:message-edit-complete-request",
        () => {

            completeEdit();

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
                            activeEdit
                                .message,

                        text:
                            activeEdit
                                .textarea
                                ?.value ||
                            "",

                        originalText:
                            activeEdit
                                .originalText,

                        index:
                            activeEdit
                                .index,

                        attachments:
                            activeEdit
                                .attachments
                                .map(
                                    file => ({
                                        ...file
                                    })
                                )

                    };

                }

        });


    Object.defineProperty(
        window,
        "NeyoMessageEdit",
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


    emit(
        "neyo:message-edit-ready",
        {

            version:
                VERSION

        }
    );


    console.log(
        "[NEYO Edit] Ready.",
        VERSION
    );

})();
