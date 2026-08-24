/*
=========================================================
NEO — MESSAGE EDIT
Production v3 — Baseline Safe

Baseline:
- Old working neo.js inline message editor
- Old attachment-aware edit UI
- Current NeyoChat.editUserMessage()
- Current NeyoMessages DOM ownership
- Current NeyoMessageActions routing

Owns:
- Inline user-message edit UI
- Edit textarea
- Existing attachment preview display
- Cancel
- Save & Submit
- Editor autosize
- Edit keyboard behavior
- Edit busy state
- Focus restoration

Does NOT own:
- Conversation state
- /api/chat
- Regeneration transport
- Attachment uploading
- Attachment deletion
- Message action buttons
- User message rendering outside edit mode
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-message-edit-production-v3";

  if (
    window.NeyoMessageEdit
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      maxLength:
        50_000,

      minRows:
        2,

      maxTextareaHeight:
        360
    });

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    active: false,

    saving: false,

    messageId: null,

    messageElement: null,

    originalMessage: null,

    editBox: null,

    textarea: null,

    cancelButton: null,

    saveButton: null,

    openedAt: null
  };

  /* =====================================================
     EVENTS
     ===================================================== */

  function emit(
    name,
    detail = {}
  ) {
    window.dispatchEvent(
      new CustomEvent(
        name,
        {
          detail
        }
      )
    );
  }

  /* =====================================================
     HELPERS
     ===================================================== */

  function cleanId(value) {
    return String(
      value ?? ""
    ).trim();
  }

  function cleanText(value) {
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
      .slice(
        0,
        CONFIG.maxLength
      );
  }

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  /* =====================================================
     OWNERS
     ===================================================== */

  function chatController() {
    const controller =
      window.NeyoChat;

    return (
      controller &&
      controller.__controller === true
    )
      ? controller
      : null;
  }

  function messagesController() {
    const controller =
      window.NeyoMessages;

    return (
      controller &&
      controller.__controller === true
    )
      ? controller
      : null;
  }

  /* =====================================================
     GENERATION STATE
     ===================================================== */

  function isGenerating() {
    try {
      return Boolean(
        chatController()
          ?.isGenerating
          ?.()
      );
    } catch {
      return false;
    }
  }

  /* =====================================================
     MESSAGE LOOKUP
     ===================================================== */

  function getMessage(
    messageId
  ) {
    const id =
      cleanId(messageId);

    if (!id) {
      return null;
    }

    try {
      const message =
        chatController()
          ?.getMessage
          ?.(id);

      if (
        message &&
        message.role === "user"
      ) {
        return message;
      }
    } catch {}

    return null;
  }

  function getMessageElement(
    messageId,
    suppliedElement = null
  ) {
    if (
      suppliedElement instanceof
        HTMLElement &&
      suppliedElement.classList
        .contains("message")
    ) {
      return suppliedElement;
    }

    try {
      const element =
        messagesController()
          ?.getElement
          ?.(messageId);

      return (
        element instanceof
          HTMLElement
      )
        ? element
        : null;

    } catch {
      return null;
    }
  }

  /* =====================================================
     VISIBLE USER TEXT

     Attachment-only messages use internal API prompt but
     editor must remain visually blank.
     ===================================================== */

  function getEditableText(
    message
  ) {
    if (!message) {
      return "";
    }

    if (
      typeof message
        .displayContent ===
        "string"
    ) {
      return cleanText(
        message.displayContent
      );
    }

    return cleanText(
      message.content || ""
    );
  }

  /* =====================================================
     ATTACHMENTS
     ===================================================== */

  function cloneAttachments(
    attachments
  ) {
    if (
      !Array.isArray(
        attachments
      )
    ) {
      return [];
    }

    return attachments
      .filter(
        file =>
          file &&
          typeof file === "object"
      )
      .map(file => ({
        ...file,

        document:
          file.document &&
          typeof file.document ===
            "object"
            ? {
                ...file.document
              }
            : file.document,

        stats:
          file.stats &&
          typeof file.stats ===
            "object"
            ? {
                ...file.stats
              }
            : file.stats,

        chunks:
          Array.isArray(
            file.chunks
          )
            ? file.chunks.map(
                chunk =>
                  chunk &&
                  typeof chunk ===
                    "object"
                    ? {
                        ...chunk
                      }
                    : chunk
              )
            : file.chunks
      }));
  }

  function attachmentName(
    file
  ) {
    return String(
      file?.name ||
      file?.fileName ||
      "Attached file"
    );
  }

  function attachmentMime(
    file
  ) {
    return String(
      file?.mimeType ||
      file?.type ||
      file?.mime ||
      ""
    ).toLowerCase();
  }

  function isImageAttachment(
    file
  ) {
    const mime =
      attachmentMime(file);

    const category =
      String(
        file?.category ||
        ""
      ).toLowerCase();

    const name =
      attachmentName(file)
        .toLowerCase();

    return (
      mime.startsWith(
        "image/"
      ) ||
      category === "image" ||
      /\.(png|jpe?g|gif|webp|avif|bmp)$/i
        .test(name)
    );
  }

  /* =====================================================
     PREVIEW URL

     Prefer already-hydrated safe UI URLs.

     Historical/current DOM fallback is important because
     canonical attachment metadata may intentionally avoid
     keeping temporary signed URLs.
     ===================================================== */

  function getAttachmentPreviewUrl(
    file,
    messageElement,
    index
  ) {
    const direct =
      file?.previewUrl ||
      file?.preview_url ||
      file?.signedUrl ||
      file?.signed_url ||
      "";

    if (
      typeof direct === "string" &&
      direct
    ) {
      return direct;
    }

    /*
     * Preserve currently rendered image preview from old
     * or modular message DOM.
     */

    if (
      messageElement instanceof
        HTMLElement
    ) {
      const images =
        messageElement
          .querySelectorAll(
            ".message-media-grid img"
          );

      const image =
        images[index];

      if (
        image instanceof
          HTMLImageElement &&
        image.src
      ) {
        return image.src;
      }
    }

    return "";
  }

  /* =====================================================
     FILE ICON
     ===================================================== */

  function getFileIcon(file) {
    const mime =
      attachmentMime(file);

    const name =
      attachmentName(file)
        .toLowerCase();

    if (
      mime.startsWith(
        "audio/"
      )
    ) {
      return "audio-lines";
    }

    if (
      mime.startsWith(
        "video/"
      )
    ) {
      return "video";
    }

    if (
      mime.includes("pdf") ||
      name.endsWith(".pdf")
    ) {
      return "file-text";
    }

    if (
      mime.includes("zip") ||
      mime.includes("rar") ||
      name.endsWith(".zip") ||
      name.endsWith(".rar") ||
      name.endsWith(".7z")
    ) {
      return "archive";
    }

    if (
      mime.includes("word") ||
      name.endsWith(".doc") ||
      name.endsWith(".docx")
    ) {
      return "file-text";
    }

    if (
      mime.includes("excel") ||
      mime.includes("sheet") ||
      name.endsWith(".xls") ||
      name.endsWith(".xlsx") ||
      name.endsWith(".csv")
    ) {
      return "table";
    }

    if (
      mime.includes(
        "presentation"
      ) ||
      name.endsWith(".ppt") ||
      name.endsWith(".pptx")
    ) {
      return "presentation";
    }

    if (
      mime.includes("json") ||
      mime.includes(
        "javascript"
      ) ||
      name.endsWith(".js") ||
      name.endsWith(".ts") ||
      name.endsWith(".tsx") ||
      name.endsWith(".jsx") ||
      name.endsWith(".py") ||
      name.endsWith(".html") ||
      name.endsWith(".css") ||
      name.endsWith(".java") ||
      name.endsWith(".cpp") ||
      name.endsWith(".c")
    ) {
      return "code";
    }

    return "file";
  }

  /* =====================================================
     IMAGE PREVIEW
     ===================================================== */

  function createImagePreview(
    file,
    previewUrl
  ) {
    if (!previewUrl) {
      return createFilePill(
        file
      );
    }

    const image =
      document.createElement(
        "img"
      );

    image.src =
      previewUrl;

    image.alt =
      attachmentName(file) ||
      "Image";

    image.loading =
      "lazy";

    image.decoding =
      "async";

    image.addEventListener(
      "error",
      () => {
        if (!image.isConnected) {
          return;
        }

        image.replaceWith(
          createFilePill(
            file
          )
        );

        refreshIcons();
      },
      {
        once: true
      }
    );

    return image;
  }

  /* =====================================================
     FILE PILL
     ===================================================== */

  function createFilePill(
    file
  ) {
    const pill =
      document.createElement(
        "div"
      );

    /*
     * Preserve old class exactly.
     */

    pill.className =
      "message-file-pill";

    const icon =
      document.createElement(
        "i"
      );

    icon.setAttribute(
      "data-lucide",
      getFileIcon(file)
    );

    icon.setAttribute(
      "size",
      "14"
    );

    icon.setAttribute(
      "aria-hidden",
      "true"
    );

    const name =
      document.createElement(
        "span"
      );

    name.textContent =
      attachmentName(file);

    pill.append(
      icon,
      name
    );

    return pill;
  }

  /* =====================================================
     EDIT MEDIA
     ===================================================== */

  function createMediaWrapper(
    attachments,
    messageElement
  ) {
    if (
      !Array.isArray(
        attachments
      ) ||
      attachments.length === 0
    ) {
      return null;
    }

    const wrapper =
      document.createElement(
        "div"
      );

    /*
     * Old working attachment-aware editor class.
     */

    wrapper.className =
      "edit-message-media";

    let imageIndex = 0;

    for (
      const file
      of attachments
    ) {
      if (
        isImageAttachment(
          file
        )
      ) {
        const preview =
          getAttachmentPreviewUrl(
            file,
            messageElement,
            imageIndex
          );

        wrapper.appendChild(
          createImagePreview(
            file,
            preview
          )
        );

        imageIndex += 1;

        continue;
      }

      wrapper.appendChild(
        createFilePill(
          file
        )
      );
    }

    return wrapper;
  }

  /* =====================================================
     TEXTAREA SIZE
     ===================================================== */

  function autosize(
    textarea
  ) {
    if (
      !(textarea instanceof
        HTMLTextAreaElement)
    ) {
      return;
    }

    textarea.style.height =
      "auto";

    const height =
      Math.min(
        textarea.scrollHeight,
        CONFIG.maxTextareaHeight
      );

    textarea.style.height =
      `${height}px`;

    textarea.style.overflowY =
      textarea.scrollHeight >
      CONFIG.maxTextareaHeight
        ? "auto"
        : "hidden";
  }

  /* =====================================================
     SAVE ELIGIBILITY

     Attachment-only message is valid.
     ===================================================== */

  function canSave() {
    if (
      !state.active ||
      state.saving
    ) {
      return false;
    }

    const text =
      cleanText(
        state.textarea
          ?.value ||
        ""
      ).trim();

    const attachments =
      state.originalMessage
        ?.attachments ||
      [];

    return Boolean(
      text ||
      attachments.length
    );
  }

  function updateSaveButton() {
    if (!state.saveButton) {
      return;
    }

    const enabled =
      canSave();

    state.saveButton.disabled =
      !enabled;

    state.saveButton.setAttribute(
      "aria-disabled",
      String(!enabled)
    );

    state.saveButton.classList.toggle(
      "is-disabled",
      !enabled
    );
  }

  /* =====================================================
     RESET STATE
     ===================================================== */

  function clearState() {
    state.active =
      false;

    state.saving =
      false;

    state.messageId =
      null;

    state.messageElement =
      null;

    state.originalMessage =
      null;

    state.editBox =
      null;

    state.textarea =
      null;

    state.cancelButton =
      null;

    state.saveButton =
      null;

    state.openedAt =
      null;
  }

  /* =====================================================
     RESTORE ORIGINAL MESSAGE

     NeyoMessages remains DOM owner.
     ===================================================== */

  function restoreOriginal() {
    const element =
      state.messageElement;

    const message =
      state.originalMessage;

    if (
      !element ||
      !message
    ) {
      return false;
    }

    const messages =
      messagesController();

    if (
      !messages ||
      typeof messages.update !==
        "function"
    ) {
      return false;
    }

    try {
      messages.update(
        element,
        message
      );

      return true;

    } catch (error) {
      console.error(
        "[NEO Message Edit] Restore failed:",
        error
      );

      return false;
    }
  }

  /* =====================================================
     CANCEL
     ===================================================== */

  function cancel({
    focus = true,
    reason = "cancel"
  } = {}) {
    if (!state.active) {
      return false;
    }

    if (state.saving) {
      return false;
    }

    const messageId =
      state.messageId;

    const element =
      state.messageElement;

    restoreOriginal();

    clearState();

    if (
      focus &&
      element instanceof
        HTMLElement &&
      element.isConnected
    ) {
      requestAnimationFrame(
        () => {
          element
            .querySelector(
              ".user-edit-btn"
            )
            ?.focus?.();
        }
      );
    }

    emit(
      "neyo:message-edit-cancelled",
      {
        messageId,
        reason
      }
    );

    return true;
  }

  /* =====================================================
     SAVING UI
     ===================================================== */

  function setSaving(
    value
  ) {
    state.saving =
      Boolean(value);

    if (
      state.textarea
    ) {
      state.textarea.disabled =
        state.saving;
    }

    if (
      state.cancelButton
    ) {
      state.cancelButton.disabled =
        state.saving;

      state.cancelButton.setAttribute(
        "aria-disabled",
        String(
          state.saving
        )
      );
    }

    if (
      state.saveButton
    ) {
      state.saveButton.disabled =
        state.saving ||
        !canSave();

      state.saveButton.setAttribute(
        "aria-disabled",
        String(
          state.saveButton
            .disabled
        )
      );

      state.saveButton.classList.toggle(
        "is-loading",
        state.saving
      );
    }
  }

  /* =====================================================
     SAVE
     ===================================================== */

  async function save() {
    if (
      !state.active ||
      state.saving ||
      isGenerating()
    ) {
      return false;
    }

    const chat =
      chatController();

    if (
      !chat ||
      typeof chat
        .editUserMessage !==
        "function"
    ) {
      emit(
        "neyo:message-edit-error",
        {
          messageId:
            state.messageId,

          reason:
            "chat-controller-unavailable"
        }
      );

      return false;
    }

    const text =
      cleanText(
        state.textarea
          ?.value ||
        ""
      ).trim();

    const attachments =
      cloneAttachments(
        state.originalMessage
          ?.attachments ||
        []
      );

    /*
     * Empty text is valid only when preserved attachments
     * exist.
     */

    if (
      !text &&
      attachments.length === 0
    ) {
      updateSaveButton();

      return false;
    }

    const messageId =
      state.messageId;

    setSaving(true);

    emit(
      "neyo:message-edit-submit",
      {
        messageId,

        text,

        attachments
      }
    );

    try {
      /*
       * chat.js immediately commits edited user turn,
       * truncates later turns and starts generation.
       */

      const result =
        await chat.editUserMessage(
          messageId,
          text,
          {
            attachments,

            regenerateResponse:
              true
          }
        );

      /*
       * If generation failed later, edited user message is
       * still canonical and should remain edited.
       *
       * Therefore do NOT restore original here just because
       * generate() ultimately returned null.
       */

      clearState();

      emit(
        "neyo:message-edit-complete",
        {
          messageId,

          result
        }
      );

      return true;

    } catch (error) {
      console.error(
        "[NEO Message Edit] Save failed:",
        error
      );

      /*
       * Canonical state was not safely confirmed.
       * Restore original editor appearance.
       */

      setSaving(false);

      emit(
        "neyo:message-edit-error",
        {
          messageId,

          error
        }
      );

      return false;
    }
  }

  /* =====================================================
     CREATE EDITOR
     ===================================================== */

  function createEditor(
    messageElement,
    message
  ) {
    const editBox =
      document.createElement(
        "div"
      );

    editBox.className =
      "edit-message-box";

    const attachments =
      cloneAttachments(
        message.attachments ||
        []
      );

    const media =
      createMediaWrapper(
        attachments,
        messageElement
      );

    if (media) {
      editBox.appendChild(
        media
      );
    }

    const textarea =
      document.createElement(
        "textarea"
      );

    textarea.className =
      "edit-textarea";

    textarea.rows =
      CONFIG.minRows;

    textarea.maxLength =
      CONFIG.maxLength;

    textarea.value =
      getEditableText(
        message
      );

    textarea.setAttribute(
      "aria-label",
      "Edit message"
    );

    textarea.autocomplete =
      "off";

    textarea.spellcheck =
      true;

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

    cancelButton.className =
      "edit-btn-cancel";

    cancelButton.type =
      "button";

    cancelButton.textContent =
      "Cancel";

    const saveButton =
      document.createElement(
        "button"
      );

    saveButton.className =
      "edit-btn-save";

    saveButton.type =
      "button";

    /*
     * Preserve old working label.
     */

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

    return {
      editBox,
      textarea,
      cancelButton,
      saveButton
    };
  }

  /* =====================================================
     OPEN EDITOR
     ===================================================== */

  function open({
    messageId,
    element = null,
    message = null
  } = {}) {
    if (
      isGenerating()
    ) {
      return false;
    }

    const id =
      cleanId(
        messageId ||
        message?.id
      );

    if (!id) {
      return false;
    }

    const canonical =
      getMessage(id) ||
      (
        message?.role ===
          "user"
          ? message
          : null
      );

    if (!canonical) {
      return false;
    }

    const messageElement =
      getMessageElement(
        id,
        element
      );

    if (!messageElement) {
      return false;
    }

    /*
     * Opening another editor closes the previous one first.
     */

    if (state.active) {
      if (
        state.messageId === id
      ) {
        state.textarea
          ?.focus();

        return true;
      }

      cancel({
        focus: false,

        reason:
          "switch-message"
      });
    }

    const editor =
      createEditor(
        messageElement,
        canonical
      );

    /*
     * Editor temporarily replaces user bubble contents.
     * Canonical message itself remains untouched until Save.
     */

    messageElement.replaceChildren(
      editor.editBox
    );

    messageElement.classList.add(
      "is-editing"
    );

    state.active =
      true;

    state.saving =
      false;

    state.messageId =
      id;

    state.messageElement =
      messageElement;

    state.originalMessage = {
      ...canonical,

      attachments:
        cloneAttachments(
          canonical.attachments ||
          []
        )
    };

    state.editBox =
      editor.editBox;

    state.textarea =
      editor.textarea;

    state.cancelButton =
      editor.cancelButton;

    state.saveButton =
      editor.saveButton;

    state.openedAt =
      Date.now();

    /* -----------------------------------------------
       INPUT
       ----------------------------------------------- */

    editor.textarea
      .addEventListener(
        "input",
        () => {
          autosize(
            editor.textarea
          );

          updateSaveButton();
        }
      );

    /* -----------------------------------------------
       KEYBOARD
       ----------------------------------------------- */

    editor.textarea
      .addEventListener(
        "keydown",
        event => {
          if (
            event.key ===
            "Escape"
          ) {
            event.preventDefault();

            event.stopPropagation();

            cancel();

            return;
          }

          /*
           * Enter itself remains a newline.
           *
           * Ctrl/Cmd + Enter = Save & Submit.
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

            event.stopPropagation();

            if (canSave()) {
              void save();
            }
          }
        }
      );

    /* -----------------------------------------------
       CANCEL
       ----------------------------------------------- */

    editor.cancelButton
      .addEventListener(
        "click",
        event => {
          event.preventDefault();

          event.stopPropagation();

          cancel();
        }
      );

    /* -----------------------------------------------
       SAVE
       ----------------------------------------------- */

    editor.saveButton
      .addEventListener(
        "click",
        event => {
          event.preventDefault();

          event.stopPropagation();

          if (canSave()) {
            void save();
          }
        }
      );

    autosize(
      editor.textarea
    );

    updateSaveButton();

    refreshIcons();

    requestAnimationFrame(
      () => {
        if (
          !state.active ||
          state.messageId !== id
        ) {
          return;
        }

        editor.textarea.focus();

        const end =
          editor.textarea
            .value.length;

        try {
          editor.textarea
            .setSelectionRange(
              end,
              end
            );
        } catch {}
      }
    );

    emit(
      "neyo:message-edit-opened",
      {
        messageId:
          id,

        message:
          state.originalMessage,

        attachmentCount:
          state.originalMessage
            .attachments
            ?.length ||
          0
      }
    );

    return true;
  }

  /* =====================================================
     MESSAGE-ACTIONS ROUTING
     ===================================================== */

  window.addEventListener(
    "neyo:message-edit-request",
    event => {
      const detail =
        event.detail ||
        {};

      open({
        messageId:
          detail.messageId ||
          detail.id,

        element:
          detail.element,

        message:
          detail.message
      });
    }
  );

  /* =====================================================
     LEGACY COMPATIBILITY EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:edit-message-request",
    event => {
      const detail =
        event.detail ||
        {};

      open({
        messageId:
          detail.messageId ||
          detail.id,

        element:
          detail.element,

        message:
          detail.message
      });
    }
  );

  /* =====================================================
     NAVIGATION SAFETY

     Never leave detached/stale editor state after New Chat
     or history conversation switch.
     ===================================================== */

  function discardEditorState() {
    if (!state.active) {
      return;
    }

    clearState();
  }

  window.addEventListener(
    "neyo:chat-new",
    discardEditorState
  );

  window.addEventListener(
    "neyo:chat-state-loaded",
    discardEditorState
  );

  window.addEventListener(
    "neyo:messages-cleared",
    discardEditorState
  );

  /* =====================================================
     GENERATION SAFETY

     External generation should close an unsaved editor.
     The editor's own Save triggers generation only after
     canonical edit has already replaced the DOM.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    event => {
      if (!state.active) {
        return;
      }

      /*
       * Edit save is already in progress — don't restore
       * original message and fight chat.js update.
       */

      if (state.saving) {
        return;
      }

      cancel({
        focus: false,

        reason:
          "generation-started"
      });
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

      active:
        true,

      open,

      edit:
        open,

      save,

      cancel,

      isEditing() {
        return state.active;
      },

      getMessageId() {
        return (
          state.messageId ||
          null
        );
      },

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          editing:
            state.active,

          saving:
            state.saving,

          messageId:
            state.messageId,

          attachmentCount:
            state.originalMessage
              ?.attachments
              ?.length ||
            0,

          openedAt:
            state.openedAt
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

  /* =====================================================
     READY
     ===================================================== */

  emit(
    "neyo:message-edit-ready",
    {
      version:
        VERSION,

      active:
        true,

      attachmentPreview:
        true,

      attachmentPreservation:
        true,

      keyboardSave:
        true
    }
  );
})();
