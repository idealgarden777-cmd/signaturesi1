/*
=========================================================
NEO — MESSAGE EDIT
Production v1

Owns:
- inline user-message editor
- textarea autosize
- Cancel
- Save & Submit
- edit keyboard UX
- one active editor at a time

Does NOT own:
- conversation mutation
- /api/chat
- regeneration logic
- message rendering
- attachments
- Send button
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-message-edit-production-v1";

  if (
    window.NeyoMessageEdit
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     STATE
     ===================================================== */

  let active = null;

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
        { detail }
      )
    );
  }

  /* =====================================================
     HELPERS
     ===================================================== */

  function clean(
    value
  ) {
    return String(
      value ?? ""
    )
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n");
  }

  function messageIdOf(
    element
  ) {
    return String(
      element?.dataset
        ?.neyoMessageId ||
      element?.dataset
        ?.messageId ||
      ""
    ).trim();
  }

  function getMessage(
    id
  ) {
    try {
      return (
        window.NeyoChat
          ?.getMessage
          ?.(id) ||
        null
      );

    } catch {
      return null;
    }
  }

  function getMessageElement(
    id
  ) {
    try {
      return (
        window.NeyoMessages
          ?.getElement
          ?.(id) ||
        null
      );

    } catch {
      return null;
    }
  }

  function isGenerating() {
    try {
      return Boolean(
        window.NeyoChat
          ?.isGenerating
          ?.()
      );

    } catch {
      return false;
    }
  }

  function visibleText(
    message
  ) {
    if (
      typeof message
        ?.displayContent ===
      "string"
    ) {
      return message
        .displayContent;
    }

    const content =
      clean(
        message?.content
      );

    /*
     * Do not expose the internal attachment-only prompt.
     */

    if (
      Array.isArray(
        message?.attachments
      ) &&
      message.attachments.length &&
      (
        content ===
          "Please analyze the attached file or files." ||
        content ===
          "Please analyze the attached file."
      )
    ) {
      return "";
    }

    return content;
  }

  /* =====================================================
     AUTOSIZE
     ===================================================== */

  function resize(
    textarea
  ) {
    if (
      !(
        textarea instanceof
        HTMLTextAreaElement
      )
    ) {
      return;
    }

    textarea.style.height =
      "auto";

    textarea.style.height =
      `${Math.min(
        textarea.scrollHeight,
        180
      )}px`;
  }

  /* =====================================================
     RESTORE ORIGINAL MESSAGE UI
     ===================================================== */

  function restore(
    editor
  ) {
    if (!editor) {
      return;
    }

    editor.contentElement
      ?.removeAttribute(
        "hidden"
      );

    editor.actionsElement
      ?.removeAttribute(
        "hidden"
      );

    editor.messageElement
      ?.classList
      .remove(
        "is-editing"
      );

    editor.editBox
      ?.remove();

    try {
      window.NeyoMessageActions
        ?.refresh
        ?.();
    } catch {}
  }

  /* =====================================================
     CANCEL
     ===================================================== */

  function cancel(
    reason =
      "cancel"
  ) {
    if (!active) {
      return false;
    }

    const editor =
      active;

    active =
      null;

    restore(
      editor
    );

    emit(
      "neyo:message-edit-cancelled",
      {
        id:
          editor.id,

        reason
      }
    );

    return true;
  }

  /* =====================================================
     BUTTON STATE
     ===================================================== */

  function updateSaveState(
    editor
  ) {
    if (!editor) {
      return;
    }

    const text =
      clean(
        editor.textarea.value
      ).trim();

    const hasAttachments =
      Array.isArray(
        editor.message.attachments
      ) &&
      editor.message
        .attachments.length > 0;

    const valid =
      Boolean(
        text ||
        hasAttachments
      );

    editor.saveButton.disabled =
      !valid ||
      isGenerating();

    editor.saveButton.setAttribute(
      "aria-disabled",
      String(
        editor.saveButton
          .disabled
      )
    );
  }

  /* =====================================================
     CREATE EDITOR
     ===================================================== */

  function createEditor(
    id,
    message,
    messageElement
  ) {
    const wrapper =
      messageElement.querySelector(
        ".message-wrapper"
      );

    const contentElement =
      wrapper?.querySelector(
        ":scope > .message-content"
      );

    const actionsElement =
      wrapper?.querySelector(
        ":scope > .user-msg-actions"
      );

    if (
      !wrapper ||
      !contentElement
    ) {
      return null;
    }

    const editBox =
      document.createElement(
        "div"
      );

    editBox.className =
      "edit-message-box";

    editBox.dataset
      .messageEdit =
      id;

    const textarea =
      document.createElement(
        "textarea"
      );

    textarea.className =
      "edit-textarea";

    textarea.rows =
      2;

    textarea.value =
      visibleText(
        message
      );

    textarea.setAttribute(
      "aria-label",
      "Edit message"
    );

    textarea.setAttribute(
      "autocomplete",
      "off"
    );

    textarea.setAttribute(
      "spellcheck",
      "true"
    );

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

    /*
     * Keep existing attachment cards in place.
     *
     * Only original text/actions are hidden.
     */

    contentElement.hidden =
      true;

    if (actionsElement) {
      actionsElement.hidden =
        true;
    }

    wrapper.appendChild(
      editBox
    );

    messageElement.classList.add(
      "is-editing"
    );

    const editor = {
      id,

      message,

      messageElement,

      wrapper,

      contentElement,

      actionsElement,

      editBox,

      textarea,

      cancelButton,

      saveButton,

      submitting:
        false
    };

    /* -----------------------------------------------
       Events
       ----------------------------------------------- */

    textarea.addEventListener(
      "input",
      () => {
        resize(
          textarea
        );

        updateSaveState(
          editor
        );
      }
    );

    textarea.addEventListener(
      "keydown",
      event => {
        /*
         * Escape = cancel.
         */

        if (
          event.key ===
          "Escape"
        ) {
          event.preventDefault();
          event.stopPropagation();

          cancel(
            "escape"
          );

          return;
        }

        /*
         * Cmd/Ctrl + Enter = Save & Submit.
         *
         * Plain Enter remains newline.
         */

        if (
          event.key ===
            "Enter" &&
          (
            event.metaKey ||
            event.ctrlKey
          )
        ) {
          event.preventDefault();
          event.stopPropagation();

          void submit(
            editor
          );
        }
      }
    );

    cancelButton.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        cancel(
          "button"
        );
      }
    );

    saveButton.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        void submit(
          editor
        );
      }
    );

    requestAnimationFrame(
      () => {
        resize(
          textarea
        );

        updateSaveState(
          editor
        );

        textarea.focus();

        /*
         * Cursor at end, matching normal edit behavior.
         */

        const length =
          textarea.value.length;

        try {
          textarea.setSelectionRange(
            length,
            length
          );
        } catch {}
      }
    );

    return editor;
  }

  /* =====================================================
     OPEN
     ===================================================== */

  function open(
    id
  ) {
    const key =
      String(
        id || ""
      ).trim();

    if (
      !key ||
      isGenerating()
    ) {
      return false;
    }

    const message =
      getMessage(
        key
      );

    if (
      !message ||
      message.role !==
        "user"
    ) {
      return false;
    }

    const element =
      getMessageElement(
        key
      );

    if (!element) {
      return false;
    }

    /*
     * Same editor already open.
     */

    if (
      active?.id ===
      key
    ) {
      active.textarea
        ?.focus();

      return true;
    }

    /*
     * Only one inline editor at a time.
     */

    if (active) {
      cancel(
        "another-message"
      );
    }

    const editor =
      createEditor(
        key,
        message,
        element
      );

    if (!editor) {
      return false;
    }

    active =
      editor;

    emit(
      "neyo:message-edit-opened",
      {
        id:
          key,

        message
      }
    );

    return true;
  }

  /* =====================================================
     SUBMIT
     ===================================================== */

  async function submit(
    editor =
      active
  ) {
    if (
      !editor ||
      editor !== active ||
      editor.submitting ||
      isGenerating()
    ) {
      return false;
    }

    const chat =
      window.NeyoChat;

    if (
      typeof chat
        ?.editUserMessage !==
      "function"
    ) {
      emit(
        "neyo:message-edit-error",
        {
          id:
            editor.id,

          reason:
            "chat-edit-api-unavailable"
        }
      );

      return false;
    }

    const text =
      clean(
        editor.textarea.value
      ).trim();

    const attachments =
      Array.isArray(
        editor.message
          .attachments
      )
        ? editor.message
            .attachments
            .map(
              item => ({
                ...item
              })
            )
        : [];

    /*
     * Attachment-only user messages remain valid.
     */

    if (
      !text &&
      attachments.length === 0
    ) {
      updateSaveState(
        editor
      );

      return false;
    }

    const original =
      visibleText(
        editor.message
      ).trim();

    /*
     * No actual edit = close without generating a
     * duplicate response.
     */

    if (
      text === original
    ) {
      cancel(
        "unchanged"
      );

      return true;
    }

    editor.submitting =
      true;

    editor.textarea.disabled =
      true;

    editor.cancelButton.disabled =
      true;

    editor.saveButton.disabled =
      true;

    editor.editBox.classList.add(
      "is-submitting"
    );

    /*
     * Restore normal message shell BEFORE chat.js
     * emits its synchronous update event.
     *
     * chat.js remains the only owner of canonical
     * conversation mutation.
     */

    active =
      null;

    restore(
      editor
    );

    emit(
      "neyo:message-edit-submit",
      {
        id:
          editor.id,

        text,

        attachments
      }
    );

    try {
      const result =
        await chat.editUserMessage(
          editor.id,
          text,
          {
            attachments,

            regenerateResponse:
              true
          }
        );

      emit(
        "neyo:message-edit-complete",
        {
          id:
            editor.id,

          result
        }
      );

      return result !== null;

    } catch (error) {
      console.error(
        "[NEO Message Edit] Submit failed:",
        error
      );

      emit(
        "neyo:message-edit-error",
        {
          id:
            editor.id,

          error
        }
      );

      return false;
    }
  }

  /* =====================================================
     REQUEST EVENT

     message-actions.js emits this.
     ===================================================== */

  window.addEventListener(
    "neyo:message-edit-request",
    event => {
      const id =
        event.detail?.id ||
        event.detail
          ?.message
          ?.id;

      if (id) {
        open(
          id
        );
      }
    }
  );

  /* =====================================================
     MESSAGE REMOVED
     ===================================================== */

  window.addEventListener(
    "neyo:chat-message-removed",
    event => {
      if (!active) {
        return;
      }

      const id =
        event.detail?.id ||
        event.detail
          ?.message
          ?.id;

      if (
        String(
          id || ""
        ) ===
        active.id
      ) {
        active =
          null;
      }
    }
  );

  /* =====================================================
     CHAT STATE CHANGES

     An open editor should never survive navigation or
     another generation.
     ===================================================== */

  for (
    const eventName
    of [
      "neyo:chat-new",
      "neyo:chat-state-loaded",
      "neyo:messages-cleared"
    ]
  ) {
    window.addEventListener(
      eventName,
      () => {
        if (active) {
          cancel(
            eventName
          );
        }
      }
    );
  }

  window.addEventListener(
    "neyo:chat-send-start",
    () => {
      if (active) {
        cancel(
          "generation-started"
        );
      }
    }
  );

  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({
      __controller: true,

      version:
        VERSION,

      active:
        true,

      open,

      cancel,

      save() {
        return submit(
          active
        );
      },

      isEditing() {
        return Boolean(
          active
        );
      },

      getEditingId() {
        return (
          active?.id ||
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
            Boolean(
              active
            ),

          messageId:
            active?.id ||
            null,

          submitting:
            Boolean(
              active
                ?.submitting
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

  /* =====================================================
     READY
     ===================================================== */

  emit(
    "neyo:message-edit-ready",
    {
      version:
        VERSION,

      active:
        true
    }
  );
})();
