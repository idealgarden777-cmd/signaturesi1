/*
=========================================================
NEYO — MESSAGE EDIT
FINAL PRODUCTION MIXER v7

FILE:
public/js/components/message-edit.js

OWNS
---------------------------------------------------------
- User inline edit UI
- Edit textarea
- Existing attachment preview while editing
- Original message DOM preservation
- Cancel / restore
- Save & Submit UI
- Enter to submit
- Shift+Enter newline
- Escape to cancel
- IME-safe keyboard handling
- Textarea auto-resize
- Edit busy state
- Focus handling
- Edit lifecycle events
- Public edit API

DOES NOT OWN
---------------------------------------------------------
- Conversation state
- Conversation truncation
- /api/chat
- Regenerate transport
- Attachment upload
- Message rendering architecture
- Assistant actions
- Copy / share
- History persistence

FINAL FLOW
---------------------------------------------------------

message-actions.js
      ↓
neyo:message-edit-request
      ↓
message-edit.js
      ↓
inline editor
      ↓
Save & Submit
      ↓
NeyoChat.editUserMessage()
      ↓
chat.js:
  - updates canonical user message
  - preserves attachments
  - truncates future conversation
  - emits DOM events
  - regenerates assistant response

IMPORTANT
---------------------------------------------------------
The original user-message DOM is preserved before edit.

Before submit, normal message DOM is restored FIRST.
Then chat.js emits its canonical update/truncate events.

This prevents messages.js from receiving an update while
the message element still contains only an edit textarea.

MIGRATION RULE
---------------------------------------------------------
No dependency on neo.js business logic.

Old production CSS classes are intentionally preserved.

After neo.js removal this file continues unchanged.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-message-edit-final-v7";

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
        320,

      submitLabel:
        "Save & Submit",

      submittingLabel:
        "Submitting…"
    });

  /* =====================================================
     DOM
     ===================================================== */

  const chatMessages =
    document.getElementById(
      "chatMessages"
    );

  const active =
    Boolean(
      chatMessages
    );

  if (!active) {
    console.warn(
      "[NEYO Message Edit] #chatMessages missing."
    );

    return;
  }

  /* =====================================================
     LEGACY TELEMETRY
     ===================================================== */

  const legacyScriptPresent =
    Array
      .from(
        document.scripts || []
      )
      .some(
        script =>
          /(?:^|\/)neo\.js(?:\?|$)/
            .test(
              script.src || ""
            )
      );

  /* =====================================================
     STATE
     ===================================================== */

  let session =
    null;

  let composing =
    false;

  let submitting =
    false;

  let generationActive =
    false;

  const metrics = {
    opened:
      0,

    cancelled:
      0,

    submitted:
      0,

    failed:
      0,

    blocked:
      0,

    attachmentEdits:
      0,

    lastOpenedAt:
      null,

    lastSubmittedAt:
      null
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

  function cleanId(
    value
  ) {
    return String(
      value || ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .trim()
      .slice(
        0,
        256
      );
  }

  function cleanText(
    value
  ) {
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

  function cloneValue(
    value
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return value;
    }

    if (
      typeof structuredClone ===
      "function"
    ) {
      try {
        return structuredClone(
          value
        );
      } catch {}
    }

    try {
      return JSON.parse(
        JSON.stringify(
          value
        )
      );

    } catch {
      return value;
    }
  }

  /* =====================================================
     GENERATING
     ===================================================== */

  function isGenerating() {
    try {
      if (
        window.NeyoChat
          ?.isGenerating
          ?.() ===
        true
      ) {
        return true;
      }
    } catch {}

    return generationActive;
  }

  /* =====================================================
     MESSAGE LOOKUP
     ===================================================== */

  function getMessageElement(
    value
  ) {
    if (
      value instanceof
      HTMLElement
    ) {
      return value.closest(
        ".message"
      );
    }

    const id =
      cleanId(
        value
      );

    if (!id) {
      return null;
    }

    try {
      const direct =
        window.NeyoMessages
          ?.getElement
          ?.(id);

      if (
        direct instanceof
        HTMLElement
      ) {
        return direct;
      }
    } catch {}

    return Array
      .from(
        chatMessages.querySelectorAll(
          ".message"
        )
      )
      .find(
        element =>
          cleanId(
            element.dataset
              ?.neyoMessageId ||
            element.dataset
              ?.messageId
          ) ===
          id
      ) ||
      null;
  }

  /* =====================================================
     MESSAGE ID
     ===================================================== */

  function getMessageId(
    element
  ) {
    return cleanId(
      element
        ?.dataset
        ?.neyoMessageId ||
      element
        ?.dataset
        ?.messageId ||
      ""
    );
  }

  /* =====================================================
     CANONICAL MESSAGE
     ===================================================== */

  function getCanonicalMessage(
    id,
    fallback =
      null
  ) {
    const key =
      cleanId(
        id
      );

    try {
      const direct =
        window.NeyoChat
          ?.getMessage
          ?.(key);

      if (
        direct &&
        direct.role ===
          "user"
      ) {
        return cloneValue(
          direct
        );
      }
    } catch {}

    try {
      const conversation =
        window.NeyoChat
          ?.getConversation
          ?.();

      if (
        Array.isArray(
          conversation
        )
      ) {
        const match =
          conversation.find(
            message =>
              cleanId(
                message?.id
              ) ===
              key
          );

        if (
          match?.role ===
          "user"
        ) {
          return cloneValue(
            match
          );
        }
      }
    } catch {}

    if (
      fallback &&
      fallback.role ===
        "user"
    ) {
      return cloneValue(
        fallback
      );
    }

    return null;
  }

  /* =====================================================
     DISPLAY CONTENT

     Internal attachment-only prompt should not suddenly
     appear when user presses Edit.
     ===================================================== */

  function getEditableText(
    message
  ) {
    const value =
      cleanText(
        message
          ?.displayContent ??
        message
          ?.content ??
        ""
      );

    if (
      Array.isArray(
        message
          ?.attachments
      ) &&
      message.attachments.length >
        0 &&
      [
        "Please analyze the attached file.",
        "Please analyze the attached file or files."
      ].includes(
        value.trim()
      )
    ) {
      return "";
    }

    return value;
  }

  /* =====================================================
     ATTACHMENTS
     ===================================================== */

  function getAttachments(
    message
  ) {
    if (
      !Array.isArray(
        message?.attachments
      )
    ) {
      return [];
    }

    return message
      .attachments
      .slice(
        0,
        5
      )
      .map(
        attachment => ({
          ...cloneValue(
            attachment
          )
        })
      );
  }

  /* =====================================================
     CAPTURE CURRENT ATTACHMENT DOM

     Important for private/signed/blob image previews.

     The canonical attachment object may have bucket/path
     but history/private-storage rendering may already have
     a working signed preview in the current DOM.

     Preserve that rendered visual instead of trying to
     invent storage URLs here.
     ===================================================== */

  function captureAttachmentDom(
    messageElement
  ) {
    const source =
      messageElement
        ?.querySelector(
          ".neyo-message-attachments, .message-media-grid"
        );

    if (!source) {
      return null;
    }

    const clone =
      source.cloneNode(
        true
      );

    clone
      .querySelectorAll(
        "button"
      )
      .forEach(
        button => {
          button.disabled =
            true;

          button.tabIndex =
            -1;
        }
      );

    return clone;
  }

  /* =====================================================
     FILE ICON
     ===================================================== */

  function attachmentIcon(
    attachment
  ) {
    const category =
      String(
        attachment
          ?.category ||
        ""
      )
        .toLowerCase();

    const mime =
      String(
        attachment
          ?.mimeType ||
        attachment
          ?.mime ||
        attachment
          ?.type ||
        ""
      )
        .toLowerCase();

    const name =
      String(
        attachment
          ?.name ||
        ""
      )
        .toLowerCase();

    if (
      category ===
        "image" ||
      mime.startsWith(
        "image/"
      )
    ) {
      return "image";
    }

    if (
      category ===
        "spreadsheet" ||
      /\.(xlsx?|xlsm|csv|tsv|ods)$/
        .test(
          name
        )
    ) {
      return "sheet";
    }

    if (
      category ===
        "presentation" ||
      /\.(pptx?|odp|key)$/
        .test(
          name
        )
    ) {
      return "presentation";
    }

    if (
      category ===
      "archive"
    ) {
      return "archive";
    }

    if (
      category ===
        "audio" ||
      mime.startsWith(
        "audio/"
      )
    ) {
      return "audio-lines";
    }

    if (
      category ===
        "video" ||
      mime.startsWith(
        "video/"
      )
    ) {
      return "video";
    }

    if (
      category ===
      "code"
    ) {
      return "file-code-2";
    }

    return "file-text";
  }

  /* =====================================================
     SAFE PREVIEW
     ===================================================== */

  function safePreview(
    value
  ) {
    const raw =
      String(
        value || ""
      )
        .trim();

    if (!raw) {
      return "";
    }

    if (
      /^(blob:|data:image\/)/i
        .test(
          raw
        )
    ) {
      return raw;
    }

    try {
      const url =
        new URL(
          raw,
          location.origin
        );

      return [
        "http:",
        "https:"
      ].includes(
        url.protocol
      )
        ? url.href
        : "";

    } catch {
      return "";
    }
  }

  /* =====================================================
     IMAGE TEST
     ===================================================== */

  function isImage(
    attachment
  ) {
    const category =
      String(
        attachment
          ?.category ||
        ""
      )
        .toLowerCase();

    const mime =
      String(
        attachment
          ?.mimeType ||
        attachment
          ?.mime ||
        attachment
          ?.type ||
        ""
      )
        .toLowerCase();

    return (
      category ===
        "image" ||
      mime.startsWith(
        "image/"
      )
    );
  }

  /* =====================================================
     FALLBACK ATTACHMENT PREVIEW

     Used only when we don't have a rendered attachment
     DOM snapshot to clone.
     ===================================================== */

  function createAttachmentPreview(
    attachment
  ) {
    const name =
      cleanText(
        attachment?.name ||
        "Attached file"
      )
        .trim() ||
      "Attached file";

    const preview =
      safePreview(
        attachment
          ?.previewUrl ||
        attachment
          ?.signedUrl ||
        attachment
          ?.url ||
        ""
      );

    if (
      isImage(
        attachment
      ) &&
      preview
    ) {
      const card =
        document.createElement(
          "div"
        );

      card.className =
        "edit-message-image";

      const image =
        document.createElement(
          "img"
        );

      image.src =
        preview;

      image.alt =
        name;

      image.loading =
        "lazy";

      image.decoding =
        "async";

      card.appendChild(
        image
      );

      return card;
    }

    const pill =
      document.createElement(
        "div"
      );

    /*
     * Preserve old CSS hook.
     */

    pill.className =
      "message-file-pill";

    const icon =
      document.createElement(
        "i"
      );

    icon.setAttribute(
      "data-lucide",
      attachmentIcon(
        attachment
      )
    );

    icon.setAttribute(
      "aria-hidden",
      "true"
    );

    const nameSpan =
      document.createElement(
        "span"
      );

    nameSpan.textContent =
      name;

    pill.append(
      icon,
      nameSpan
    );

    return pill;
  }

  /* =====================================================
     EDIT ATTACHMENT AREA
     ===================================================== */

  function createEditMedia(
    originalAttachmentDom,
    attachments
  ) {
    const root =
      document.createElement(
        "div"
      );

    /*
     * Exact old production class.
     */

    root.className =
      "edit-message-media";

    if (
      originalAttachmentDom
    ) {
      root.appendChild(
        originalAttachmentDom
      );

      return root;
    }

    for (
      const attachment
      of attachments
    ) {
      root.appendChild(
        createAttachmentPreview(
          attachment
        )
      );
    }

    return root;
  }

  /* =====================================================
     TEXTAREA AUTO RESIZE
     ===================================================== */

  function resizeTextarea(
    textarea
  ) {
    if (
      !(
        textarea instanceof
        HTMLTextAreaElement
      )
    ) {
      return false;
    }

    textarea.style.height =
      "auto";

    const next =
      Math.min(
        CONFIG
          .maxTextareaHeight,
        Math.max(
          textarea.scrollHeight,
          44
        )
      );

    textarea.style.height =
      `${next}px`;

    textarea.style.overflowY =
      textarea.scrollHeight >
        CONFIG
          .maxTextareaHeight
        ? "auto"
        : "hidden";

    return true;
  }

  /* =====================================================
     ORIGINAL DOM SNAPSHOT
     ===================================================== */

  function snapshotChildren(
    element
  ) {
    return Array
      .from(
        element.childNodes
      )
      .map(
        child =>
          child.cloneNode(
            true
          )
      );
  }

  /* =====================================================
     RESTORE ORIGINAL DOM
     ===================================================== */

  function restoreOriginalDom(
    currentSession =
      session
  ) {
    if (
      !currentSession
        ?.element
    ) {
      return false;
    }

    const {
      element,
      originalChildren
    } =
      currentSession;

    if (
      !element.isConnected
    ) {
      return false;
    }

    const clones =
      originalChildren.map(
        child =>
          child.cloneNode(
            true
          )
      );

    element.replaceChildren(
      ...clones
    );

    element.classList.remove(
      "is-editing",
      "is-edit-submitting"
    );

    delete element.dataset
      .editActive;

    /*
     * Restored cloned action buttons have no listeners,
     * which is fine because message-actions.js uses
     * delegated capture handling.

     * Hydrate is still requested to dedupe/rebuild final
     * action controls if necessary.
     */

    try {
      window
        .NeyoMessageActions
        ?.hydrateMessage
        ?.(element);

    } catch {}

    refreshIcons();

    return true;
  }

  /* =====================================================
     CLOSE SESSION INTERNAL
     ===================================================== */

  function clearSession() {
    composing =
      false;

    submitting =
      false;

    session =
      null;
  }

  /* =====================================================
     CANCEL
     ===================================================== */

  function cancel({
    restoreFocus =
      true,
    reason =
      "user"
  } = {}) {
    if (!session) {
      return false;
    }

    if (
      submitting
    ) {
      return false;
    }

    const current =
      session;

    restoreOriginalDom(
      current
    );

    metrics.cancelled +=
      1;

    emit(
      "neyo:message-edit-cancelled",
      {
        messageId:
          current.messageId,

        reason
      }
    );

    const focusTarget =
      current.editButton ||
      current.element
        ?.querySelector(
          ".user-edit-btn"
        );

    clearSession();

    if (
      restoreFocus &&
      focusTarget
        ?.isConnected
    ) {
      requestAnimationFrame(
        () => {
          try {
            focusTarget.focus({
              preventScroll:
                true
            });

          } catch {
            try {
              focusTarget.focus();
            } catch {}
          }
        }
      );
    }

    return true;
  }

  /* =====================================================
     CREATE EDIT UI
     ===================================================== */

  function createEditor(
    currentSession
  ) {
    const {
      element,
      originalText,
      attachments,
      attachmentDom
    } =
      currentSession;

    const editBox =
      document.createElement(
        "div"
      );

    /*
     * Exact old production CSS hook.
     */

    editBox.className =
      "edit-message-box";

    editBox.setAttribute(
      "role",
      "group"
    );

    editBox.setAttribute(
      "aria-label",
      "Edit message"
    );

    /* =================================================
       ATTACHMENTS
       ================================================= */

    if (
      attachments.length >
        0 ||
      attachmentDom
    ) {
      editBox.appendChild(
        createEditMedia(
          attachmentDom,
          attachments
        )
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
      CONFIG.minRows;

    textarea.maxLength =
      CONFIG.maxLength;

    textarea.value =
      originalText;

    textarea.setAttribute(
      "aria-label",
      "Edit message text"
    );

    textarea.setAttribute(
      "autocomplete",
      "off"
    );

    textarea.setAttribute(
      "spellcheck",
      "true"
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

    cancelButton.setAttribute(
      "aria-label",
      "Cancel editing"
    );

    const saveButton =
      document.createElement(
        "button"
      );

    saveButton.type =
      "button";

    saveButton.className =
      "edit-btn-save";

    saveButton.textContent =
      CONFIG.submitLabel;

    saveButton.setAttribute(
      "aria-label",
      "Save and submit edited message"
    );

    actions.append(
      cancelButton,
      saveButton
    );

    editBox.append(
      textarea,
      actions
    );

    element.replaceChildren(
      editBox
    );

    element.classList.add(
      "is-editing"
    );

    element.dataset
      .editActive =
      "true";

    currentSession.editBox =
      editBox;

    currentSession.textarea =
      textarea;

    currentSession.cancelButton =
      cancelButton;

    currentSession.saveButton =
      saveButton;

    /* =================================================
       INPUT
       ================================================= */

    textarea.addEventListener(
      "input",
      () => {
        resizeTextarea(
          textarea
        );

        syncSaveState();
      }
    );

    textarea.addEventListener(
      "compositionstart",
      () => {
        composing =
          true;
      }
    );

    textarea.addEventListener(
      "compositionend",
      () => {
        composing =
          false;

        syncSaveState();
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

          cancel({
            reason:
              "escape"
          });

          return;
        }

        if (
          event.key !==
          "Enter"
        ) {
          return;
        }

        /*
         * Shift+Enter = newline.
         */

        if (
          event.shiftKey
        ) {
          return;
        }

        /*
         * Modifier combos remain browser/editor behavior.
         */

        if (
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        ) {
          return;
        }

        if (
          event.isComposing ||
          composing
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        void submit();
      }
    );

    /* =================================================
       BUTTONS
       ================================================= */

    cancelButton.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        cancel();
      }
    );

    saveButton.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        void submit();
      }
    );

    requestAnimationFrame(
      () => {
        resizeTextarea(
          textarea
        );

        syncSaveState();

        try {
          textarea.focus({
            preventScroll:
              true
          });

        } catch {
          textarea.focus();
        }

        /*
         * Cursor at end matches normal message-edit UX.
         */

        try {
          textarea.setSelectionRange(
            textarea.value.length,
            textarea.value.length
          );
        } catch {}
      }
    );

    refreshIcons();

    return editBox;
  }

  /* =====================================================
     SAVE STATE
     ===================================================== */

  function syncSaveState() {
    if (
      !session
        ?.saveButton ||
      !session
        ?.textarea
    ) {
      return false;
    }

    const text =
      cleanText(
        session
          .textarea
          .value
      )
        .trim();

    const hasAttachments =
      session
        .attachments
        .length >
      0;

    const valid =
      (
        Boolean(
          text
        ) ||
        hasAttachments
      ) &&
      !submitting &&
      !isGenerating();

    session
      .saveButton
      .disabled =
      !valid;

    session
      .saveButton
      .setAttribute(
        "aria-disabled",
        String(
          !valid
        )
      );

    return valid;
  }

  /* =====================================================
     BEGIN EDIT
     ===================================================== */

  function beginEdit(
    request = {}
  ) {
    if (
      submitting ||
      isGenerating()
    ) {
      metrics.blocked +=
        1;

      emit(
        "neyo:message-edit-blocked",
        {
          reason:
            "generating"
        }
      );

      return false;
    }

    const suppliedElement =
      request.element instanceof
        HTMLElement
        ? request.element
        : null;

    const requestedId =
      cleanId(
        request.messageId ||
        request.id ||
        request.message?.id ||
        getMessageId(
          suppliedElement
        )
      );

    const element =
      suppliedElement ||
      getMessageElement(
        requestedId
      );

    if (
      !element
    ) {
      return false;
    }

    const messageId =
      requestedId ||
      getMessageId(
        element
      );

    const message =
      getCanonicalMessage(
        messageId,
        request.message
      );

    if (
      !message ||
      message.role !==
        "user"
    ) {
      return false;
    }

    /*
     * Only one editor at once.

     * Clicking Edit on another message safely restores the
     * previous message before opening the new editor.
     */

    if (
      session
    ) {
      if (
        session.messageId ===
        messageId
      ) {
        session.textarea
          ?.focus();

        return true;
      }

      cancel({
        restoreFocus:
          false,

        reason:
          "switch-message"
      });
    }

    const originalText =
      getEditableText(
        message
      );

    const attachments =
      getAttachments(
        message
      );

    const attachmentDom =
      captureAttachmentDom(
        element
      );

    const editButton =
      element.querySelector(
        ".user-edit-btn"
      );

    session = {
      messageId,

      element,

      message:
        cloneValue(
          message
        ),

      originalText,

      attachments,

      attachmentDom,

      originalChildren:
        snapshotChildren(
          element
        ),

      editButton,

      openedAt:
        Date.now(),

      editBox:
        null,

      textarea:
        null,

      cancelButton:
        null,

      saveButton:
        null
    };

    if (
      attachments.length >
      0
    ) {
      metrics.attachmentEdits +=
        1;
    }

    createEditor(
      session
    );

    metrics.opened +=
      1;

    metrics.lastOpenedAt =
      Date.now();

    emit(
      "neyo:message-edit-opened",
      {
        messageId,

        message:
          cloneValue(
            message
          ),

        attachmentCount:
          attachments.length,

        element
      }
    );

    return true;
  }

  /* =====================================================
     SUBMIT UI STATE
     ===================================================== */

  function setSubmittingUi(
    value
  ) {
    if (!session) {
      return;
    }

    submitting =
      Boolean(
        value
      );

    const {
      element,
      textarea,
      saveButton,
      cancelButton
    } =
      session;

    element.classList.toggle(
      "is-edit-submitting",
      submitting
    );

    if (
      textarea
    ) {
      textarea.disabled =
        submitting;
    }

    if (
      cancelButton
    ) {
      cancelButton.disabled =
        submitting;
    }

    if (
      saveButton
    ) {
      saveButton.disabled =
        submitting;

      saveButton.setAttribute(
        "aria-busy",
        String(
          submitting
        )
      );

      saveButton.textContent =
        submitting
          ? CONFIG
              .submittingLabel
          : CONFIG
              .submitLabel;
    }
  }

  /* =====================================================
     SUBMIT

     IMPORTANT ORDER
     -----------------------------------------------------
     1. Validate.
     2. Save session data locally.
     3. Restore normal message DOM.
     4. Call NeyoChat.editUserMessage().
     5. chat.js updates canonical message + truncates future.
     6. messages.js receives normal DOM lifecycle events.

     This avoids trying to update a DOM shell that currently
     contains only .edit-message-box.
     ===================================================== */

  async function submit() {
    if (
      !session ||
      submitting ||
      isGenerating()
    ) {
      return false;
    }

    const current =
      session;

    const textarea =
      current.textarea;

    if (!textarea) {
      return false;
    }

    const enteredText =
      cleanText(
        textarea.value
      );

    const trimmed =
      enteredText.trim();

    const hasAttachments =
      current.attachments
        .length >
      0;

    if (
      !trimmed &&
      !hasAttachments
    ) {
      syncSaveState();

      textarea.focus();

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
          messageId:
            current.messageId,

          message:
            "Chat edit engine is unavailable."
        }
      );

      return false;
    }

    /*
     * Attachment-only edit may legitimately contain
     * blank display text.

     * chat.js knows how to convert that into its internal
     * attachment prompt while retaining attachments.
     */

    const submitText =
      trimmed;

    setSubmittingUi(
      true
    );

    /*
     * Capture everything BEFORE restoring/clearing session.
     */

    const messageId =
      current.messageId;

    const originalMessage =
      cloneValue(
        current.message
      );

    const originalText =
      current.originalText;

    /*
     * Restore a valid normal message structure first.
     */

    restoreOriginalDom(
      current
    );

    emit(
      "neyo:message-edit-submitting",
      {
        messageId,

        content:
          submitText,

        attachments:
          cloneValue(
            current.attachments
          )
      }
    );

    try {
      /*
       * This is the SINGLE canonical mutation.
       *
       * No local conversation splice.
       * No local assistant removal.
       * No direct /api/chat.
       */

      const result =
        await chat
          .editUserMessage(
            messageId,
            submitText,
            {
              regenerateResponse:
                true
            }
          );

      if (
        !result
      ) {
        /*
         * A null result can happen if chat rejected the
         * edit before mutation. Restore original state UI.
         */

        try {
          window.NeyoMessages
            ?.updateFromMessage
            ?.(
              messageId,
              originalMessage,
              {
                markdown:
                  false
              }
            );
        } catch {}

        metrics.failed +=
          1;

        emit(
          "neyo:message-edit-error",
          {
            messageId,

            message:
              "Edited message could not be submitted."
          }
        );

        clearSession();

        return false;
      }

      metrics.submitted +=
        1;

      metrics.lastSubmittedAt =
        Date.now();

      emit(
        "neyo:message-edit-submitted",
        {
          messageId,

          originalText,

          content:
            submitText,

          attachments:
            cloneValue(
              current.attachments
            ),

          result:
            cloneValue(
              result
            )
        }
      );

      clearSession();

      return true;

    } catch (
      error
    ) {
      console.error(
        "[NEYO Message Edit] Submit failed:",
        error
      );

      metrics.failed +=
        1;

      /*
       * chat.js normally absorbs request-level errors after
       * canonical edit has occurred. This catch is for
       * unexpected JavaScript/module failures.

       * If canonical message still exists, ask messages.js
       * to render whatever chat.js currently owns.
       */

      try {
        const canonical =
          chat.getMessage
            ?.(messageId);

        if (
          canonical
        ) {
          window.NeyoMessages
            ?.updateFromMessage
            ?.(
              messageId,
              canonical,
              {
                markdown:
                  false
              }
            );

        } else {
          window.NeyoMessages
            ?.updateFromMessage
            ?.(
              messageId,
              originalMessage,
              {
                markdown:
                  false
              }
            );
        }
      } catch {}

      emit(
        "neyo:message-edit-error",
        {
          messageId,

          error,

          message:
            error?.message ||
            "Edited message could not be submitted."
        }
      );

      clearSession();

      return false;
    }
  }

  /* =====================================================
     ACTION EVENT

     Final message-actions.js emits:
     neyo:message-edit-request
     ===================================================== */

  window.addEventListener(
    "neyo:message-edit-request",
    event => {
      beginEdit(
        event.detail ||
        {}
      );
    }
  );

  /* =====================================================
     COMPATIBILITY EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:user-message-edit-request",
    event => {
      const detail =
        event.detail ||
        {};

      /*
       * message-actions.js intentionally emits both modern
       * and compatibility aliases.

       * If modern event already opened same message,
       * beginEdit() simply focuses the existing textarea.
       */

      beginEdit(
        detail
      );
    }
  );

  /* =====================================================
     GENERATION STATE
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {
      generationActive =
        true;

      syncSaveState();
    }
  );

  for (
    const eventName
    of [
      "neyo:chat-send-end",
      "neyo:chat-response",
      "neyo:chat-error",
      "neyo:chat-aborted",
      "neyo:chat-limit-reached"
    ]
  ) {
    window.addEventListener(
      eventName,
      () => {
        generationActive =
          false;

        syncSaveState();
      }
    );
  }

  /* =====================================================
     NEW CHAT / HISTORY LOAD

     Never leave an editor attached to a conversation that
     is no longer active.
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
        if (
          session &&
          !submitting
        ) {
          /*
           * Do not restore stale DOM when entire
           * conversation has already been replaced.
           */

          composing =
            false;

          submitting =
            false;

          session =
            null;
        }
      }
    );
  }

  /* =====================================================
     MESSAGE REMOVED

     If another operation removes the message being edited,
     terminate editor state without restoring stale DOM.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-message-removed",
    event => {
      if (!session) {
        return;
      }

      const id =
        cleanId(
          event.detail
            ?.message
            ?.id ||
          event.detail
            ?.id
        );

      if (
        id &&
        id ===
          session.messageId
      ) {
        clearSession();
      }
    }
  );

  /* =====================================================
     EXPLICIT CANCEL REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:message-edit-cancel-request",
    () => {
      cancel();
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

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      /*
       * Lifecycle
       */

      open:
        beginEdit,

      beginEdit,

      cancel,

      submit,

      /*
       * State
       */

      isEditing() {
        return Boolean(
          session
        );
      },

      isSubmitting() {
        return submitting;
      },

      getMessageId() {
        return (
          session
            ?.messageId ||
          null
        );
      },

      getDraft() {
        return session
          ?.textarea
          ? cleanText(
              session
                .textarea
                .value
            )
          : null;
      },

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          legacyScriptPresent,

          legacyOwnerActive:
            false,

          editing:
            Boolean(
              session
            ),

          submitting,

          composing,

          generationActive,

          messageId:
            session
              ?.messageId ||
            null,

          attachmentCount:
            session
              ?.attachments
              ?.length ||
            0,

          openedAt:
            session
              ?.openedAt ||
            null,

          metrics: {
            ...metrics
          }
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

      attachmentPreservation:
        true,

      keyboard:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false
    }
  );
})();
