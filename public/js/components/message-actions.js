/*
=========================================================
NEO — MESSAGE ACTIONS
Production v3 — Baseline Safe

Baseline:
- Old working neo.js message action UI
- Current NeyoMessages DOM structure
- Current NeyoChat canonical state
- Current message-edit.js
- Current regenerate.js
- Current share.js

Owns:
- Message action button DOM
- Assistant Copy button
- Assistant Share routing
- Assistant Regenerate routing
- User Edit routing
- User Copy button
- Copy visual feedback
- Delegated action click interception
- Busy/streaming action state

Does NOT own:
- Message rendering
- Edit UI
- Regeneration business logic
- Share business logic
- Conversation state
- /api/chat
- Feedback / thumbs UI
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-message-actions-production-v3";

  if (
    window.NeyoMessageActions
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     DOM
     ===================================================== */

  const chatMessages =
    document.getElementById(
      "chatMessages"
    );

  if (!chatMessages) {
    console.warn(
      "[NEO Message Actions] #chatMessages is missing."
    );

    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      copyFeedbackMs:
        2000,

      copyIconSize:
        16,

      userIconSize:
        14
    });

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    generating: false,

    activeAction: null,

    copiedButton: null,

    copyResetTimer: null
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

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  function cleanId(value) {
    return String(
      value ?? ""
    ).trim();
  }

  function chatController() {
    const controller =
      window.NeyoChat;

    return (
      controller &&
      controller.__controller ===
        true
    )
      ? controller
      : null;
  }

  /* =====================================================
     MESSAGE ID
     ===================================================== */

  function getMessageId(
    element
  ) {
    if (
      !(element instanceof
        HTMLElement)
    ) {
      return "";
    }

    return cleanId(
      element.dataset
        .messageId ||
      element.dataset
        .neyoMessageId ||
      ""
    );
  }

  /* =====================================================
     MESSAGE INDEX
     ===================================================== */

  function getMessageIndex(
    element
  ) {
    if (
      !(element instanceof
        HTMLElement)
    ) {
      return -1;
    }

    const raw =
      element.dataset
        .msgIndex;

    const index =
      Number(raw);

    return Number.isInteger(
      index
    )
      ? index
      : -1;
  }

  /* =====================================================
     RESOLVE CANONICAL MESSAGE
     ===================================================== */

  function getCanonicalMessage(
    element
  ) {
    const chat =
      chatController();

    if (!chat) {
      return null;
    }

    const id =
      getMessageId(
        element
      );

    if (
      id &&
      typeof chat.getMessage ===
        "function"
    ) {
      try {
        const message =
          chat.getMessage(id);

        if (message) {
          return message;
        }
      } catch {}
    }

    /*
     * Compatibility fallback for old DOM that only had
     * data-msg-index.
     */

    const index =
      getMessageIndex(
        element
      );

    if (
      index >= 0 &&
      typeof chat.getConversation ===
        "function"
    ) {
      try {
        const conversation =
          chat.getConversation();

        if (
          Array.isArray(
            conversation
          ) &&
          conversation[index]
        ) {
          return conversation[index];
        }
      } catch {}
    }

    return null;
  }

  /* =====================================================
     MESSAGE TEXT

     Prefer canonical content.
     DOM text is fallback for old pre-migration messages.
     ===================================================== */

  function getMessageText(
    element
  ) {
    const message =
      getCanonicalMessage(
        element
      );

    if (
      typeof message?.content ===
      "string"
    ) {
      return message.content;
    }

    return (
      element
        ?.querySelector(
          ".message-content"
        )
        ?.innerText ||
      ""
    );
  }

  /* =====================================================
     CLIPBOARD
     ===================================================== */

  async function writeClipboard(
    value
  ) {
    const text =
      String(value ?? "");

    if (!text) {
      return false;
    }

    try {
      if (
        navigator.clipboard &&
        window.isSecureContext
      ) {
        await navigator.clipboard
          .writeText(text);

        return true;
      }
    } catch {}

    const textarea =
      document.createElement(
        "textarea"
      );

    textarea.value =
      text;

    textarea.setAttribute(
      "readonly",
      ""
    );

    textarea.style.position =
      "fixed";

    textarea.style.opacity =
      "0";

    textarea.style.pointerEvents =
      "none";

    textarea.style.left =
      "-9999px";

    document.body.appendChild(
      textarea
    );

    textarea.select();

    let copied = false;

    try {
      copied =
        document.execCommand(
          "copy"
        );
    } catch {
      copied = false;
    }

    textarea.remove();

    return copied;
  }

  /* =====================================================
     BUTTON ICON
     ===================================================== */

  function setButtonIcon(
    button,
    iconName,
    size
  ) {
    if (
      !(button instanceof
        HTMLElement)
    ) {
      return;
    }

    button.replaceChildren();

    const icon =
      document.createElement(
        "i"
      );

    icon.setAttribute(
      "data-lucide",
      iconName
    );

    icon.setAttribute(
      "size",
      String(size)
    );

    icon.setAttribute(
      "aria-hidden",
      "true"
    );

    button.appendChild(
      icon
    );

    refreshIcons();
  }

  /* =====================================================
     COPY FEEDBACK

     Old working behavior:
     Copy → green check → Copy after 2 seconds.
     We preserve the icon timing without inline CSS.
     ===================================================== */

  function resetCopyFeedback() {
    if (
      state.copyResetTimer !==
      null
    ) {
      clearTimeout(
        state.copyResetTimer
      );

      state.copyResetTimer =
        null;
    }

    const button =
      state.copiedButton;

    if (
      !button ||
      !button.isConnected
    ) {
      state.copiedButton =
        null;

      return;
    }

    const isUser =
      button.classList
        .contains(
          "user-copy-btn"
        );

    button.classList.remove(
      "is-copied"
    );

    button.setAttribute(
      "aria-label",
      isUser
        ? "Copy text"
        : "Copy"
    );

    setButtonIcon(
      button,
      "copy",
      isUser
        ? CONFIG.userIconSize
        : CONFIG.copyIconSize
    );

    state.copiedButton =
      null;
  }

  function showCopyFeedback(
    button
  ) {
    resetCopyFeedback();

    const isUser =
      button.classList
        .contains(
          "user-copy-btn"
        );

    state.copiedButton =
      button;

    button.classList.add(
      "is-copied"
    );

    button.setAttribute(
      "aria-label",
      "Copied"
    );

    setButtonIcon(
      button,
      "check",
      isUser
        ? CONFIG.userIconSize
        : CONFIG.copyIconSize
    );

    state.copyResetTimer =
      window.setTimeout(
        resetCopyFeedback,
        CONFIG.copyFeedbackMs
      );
  }

  /* =====================================================
     COPY
     ===================================================== */

  async function copyMessage(
    messageElement,
    button
  ) {
    const text =
      getMessageText(
        messageElement
      );

    if (!text) {
      return false;
    }

    const copied =
      await writeClipboard(
        text
      );

    if (!copied) {
      emit(
        "neyo:message-copy-error",
        {
          messageId:
            getMessageId(
              messageElement
            )
        }
      );

      return false;
    }

    showCopyFeedback(
      button
    );

    emit(
      "neyo:message-copied",
      {
        id:
          getMessageId(
            messageElement
          ),

        message:
          getCanonicalMessage(
            messageElement
          )
      }
    );

    return true;
  }

  /* =====================================================
     BUTTON CREATION
     ===================================================== */

  function createActionButton({
    className,
    icon,
    size,
    label,
    title
  }) {
    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.className =
      className;

    button.setAttribute(
      "aria-label",
      label
    );

    /*
     * Preserve old visual/browser contract.
     */

    if (title) {
      button.title =
        title;
    }

    setButtonIcon(
      button,
      icon,
      size
    );

    return button;
  }

  /* =====================================================
     ASSISTANT ACTIONS
     ===================================================== */

  function createAssistantActions() {
    const actions =
      document.createElement(
        "div"
      );

    actions.className =
      "message-actions";

    const copyButton =
      createActionButton({
        className:
          "msg-action-btn copy-msg-btn",

        icon:
          "copy",

        size:
          CONFIG.copyIconSize,

        label:
          "Copy",

        title:
          "Copy"
      });

    const shareButton =
      createActionButton({
        className:
          "msg-action-btn share-msg-btn",

        icon:
          "share-2",

        size:
          CONFIG.copyIconSize,

        label:
          "Share",

        title:
          "Share"
      });

    const regenerateButton =
      createActionButton({
        className:
          "msg-action-btn regen-msg-btn",

        icon:
          "rotate-cw",

        size:
          CONFIG.copyIconSize,

        label:
          "Regenerate",

        title:
          "Regenerate"
      });

    actions.append(
      copyButton,
      shareButton,
      regenerateButton
    );

    return actions;
  }

  /* =====================================================
     USER ACTIONS
     ===================================================== */

  function createUserActions() {
    const actions =
      document.createElement(
        "div"
      );

    actions.className =
      "user-msg-actions";

    const editButton =
      createActionButton({
        className:
          "user-action-btn user-edit-btn",

        icon:
          "pencil",

        size:
          CONFIG.userIconSize,

        label:
          "Edit message",

        title:
          "Edit message"
      });

    const copyButton =
      createActionButton({
        className:
          "user-action-btn user-copy-btn",

        icon:
          "copy",

        size:
          CONFIG.userIconSize,

        label:
          "Copy text",

        title:
          "Copy text"
      });

    actions.append(
      editButton,
      copyButton
    );

    return actions;
  }

  /* =====================================================
     REMOVE ACTIONS
     ===================================================== */

  function removeActions(
    messageElement
  ) {
    if (
      !(messageElement instanceof
        HTMLElement)
    ) {
      return false;
    }

    messageElement
      .querySelector(
        ":scope > .message-actions"
      )
      ?.remove();

    messageElement
      .querySelector(
        ".message-wrapper > .user-msg-actions"
      )
      ?.remove();

    return true;
  }

  /* =====================================================
     STREAMING STATE
     ===================================================== */

  function isStreamingMessage(
    element,
    message
  ) {
    return Boolean(
      element.classList
        .contains(
          "is-streaming"
        ) ||
      message?.streaming ===
        true
    );
  }

  /* =====================================================
     ERROR MESSAGE
     ===================================================== */

  function isErrorMessage(
    element,
    message
  ) {
    return Boolean(
      element.classList
        .contains(
          "is-error"
        ) ||
      element.dataset.error ===
        "true" ||
      message?.error === true
    );
  }

  /* =====================================================
     MOUNT ACTIONS
     ===================================================== */

  function mountActions(
    messageElement,
    suppliedMessage = null
  ) {
    if (
      !(messageElement instanceof
        HTMLElement)
    ) {
      return false;
    }

    if (
      messageElement.classList
        .contains(
          "is-thinking"
        )
    ) {
      removeActions(
        messageElement
      );

      return false;
    }

    const message =
      suppliedMessage ||
      getCanonicalMessage(
        messageElement
      );

    const isUser =
      messageElement.classList
        .contains(
          "user"
        ) ||
      message?.role ===
        "user";

    const isAssistant =
      messageElement.classList
        .contains(
          "assistant"
        ) ||
      message?.role ===
        "assistant";

    if (
      !isUser &&
      !isAssistant
    ) {
      return false;
    }

    /* -----------------------------------------------
       USER
       ----------------------------------------------- */

    if (isUser) {
      const wrapper =
        messageElement
          .querySelector(
            ":scope > .message-wrapper"
          );

      if (!wrapper) {
        return false;
      }

      let actions =
        wrapper.querySelector(
          ":scope > .user-msg-actions"
        );

      if (!actions) {
        actions =
          createUserActions();

        wrapper.appendChild(
          actions
        );
      }

      setActionAvailability(
        messageElement
      );

      refreshIcons();

      return true;
    }

    /* -----------------------------------------------
       ASSISTANT

       ChatGPT-standard:
       don't expose Regenerate/Share/Copy while response is
       still streaming.
       ----------------------------------------------- */

    if (
      isStreamingMessage(
        messageElement,
        message
      )
    ) {
      messageElement
        .querySelector(
          ":scope > .message-actions"
        )
        ?.remove();

      return false;
    }

    /*
     * Local error rows should not expose normal actions.
     */

    if (
      isErrorMessage(
        messageElement,
        message
      )
    ) {
      messageElement
        .querySelector(
          ":scope > .message-actions"
        )
        ?.remove();

      return false;
    }

    let actions =
      messageElement
        .querySelector(
          ":scope > .message-actions"
        );

    if (!actions) {
      actions =
        createAssistantActions();

      messageElement.appendChild(
        actions
      );
    }

    setActionAvailability(
      messageElement
    );

    refreshIcons();

    return true;
  }

  /* =====================================================
     GENERATION AVAILABILITY
     ===================================================== */

  function setActionAvailability(
    messageElement
  ) {
    if (
      !(messageElement instanceof
        HTMLElement)
    ) {
      return;
    }

    const userEdit =
      messageElement.querySelector(
        ".user-edit-btn"
      );

    const regenerate =
      messageElement.querySelector(
        ".regen-msg-btn"
      );

    /*
     * Copy and Share remain available for completed
     * existing messages while another answer generates.
     *
     * Edit and Regenerate mutate conversation state and
     * therefore must wait until generation ends.
     */

    for (
      const button
      of [
        userEdit,
        regenerate
      ]
    ) {
      if (!button) {
        continue;
      }

      button.disabled =
        state.generating;

      button.setAttribute(
        "aria-disabled",
        String(
          state.generating
        )
      );

      button.classList.toggle(
        "is-disabled",
        state.generating
      );
    }
  }

  function refreshAllAvailability() {
    const messages =
      chatMessages.querySelectorAll(
        ".message"
      );

    for (
      const message
      of messages
    ) {
      setActionAvailability(
        message
      );
    }
  }

  /* =====================================================
     EDIT REQUEST
     ===================================================== */

  function requestEdit(
    messageElement
  ) {
    if (state.generating) {
      return false;
    }

    const message =
      getCanonicalMessage(
        messageElement
      );

    const id =
      getMessageId(
        messageElement
      ) ||
      cleanId(
        message?.id
      );

    if (!id) {
      return false;
    }

    emit(
      "neyo:message-edit-request",
      {
        id,

        messageId:
          id,

        message,

        element:
          messageElement
      }
    );

    return true;
  }

  /* =====================================================
     SHARE REQUEST
     ===================================================== */

  function requestShare(
    messageElement
  ) {
    const message =
      getCanonicalMessage(
        messageElement
      );

    const id =
      getMessageId(
        messageElement
      ) ||
      cleanId(
        message?.id
      );

    if (!id) {
      return false;
    }

    emit(
      "neyo:message-share-request",
      {
        id,

        messageId:
          id,

        message,

        element:
          messageElement
      }
    );

    return true;
  }

  /* =====================================================
     REGENERATE REQUEST
     ===================================================== */

  function requestRegenerate(
    messageElement
  ) {
    if (state.generating) {
      return false;
    }

    const message =
      getCanonicalMessage(
        messageElement
      );

    const id =
      getMessageId(
        messageElement
      ) ||
      cleanId(
        message?.id
      );

    if (!id) {
      return false;
    }

    emit(
      "neyo:message-regenerate-request",
      {
        id,

        messageId:
          id,

        message,

        element:
          messageElement
      }
    );

    return true;
  }

  /* =====================================================
     ACTION RESOLUTION
     ===================================================== */

  function getActionButton(
    target
  ) {
    if (
      !(target instanceof
        Element)
    ) {
      return null;
    }

    return target.closest(
      [
        ".copy-msg-btn",
        ".share-msg-btn",
        ".regen-msg-btn",
        ".user-edit-btn",
        ".user-copy-btn"
      ].join(",")
    );
  }

  /* =====================================================
     CLICK

     Capture phase is intentional.
     Old neo.js has delegated message action listeners.
     This prevents both old + modular actions firing.
     ===================================================== */

  chatMessages.addEventListener(
    "click",
    event => {
      const button =
        getActionButton(
          event.target
        );

      if (!button) {
        return;
      }

      const messageElement =
        button.closest(
          ".message"
        );

      if (!messageElement) {
        return;
      }

      event.preventDefault();

      event.stopPropagation();

      event.stopImmediatePropagation();

      if (
        button.disabled ||
        button.getAttribute(
          "aria-disabled"
        ) === "true"
      ) {
        return;
      }

      /* -----------------------------------------------
         COPY ASSISTANT
         ----------------------------------------------- */

      if (
        button.classList
          .contains(
            "copy-msg-btn"
          )
      ) {
        void copyMessage(
          messageElement,
          button
        );

        return;
      }

      /* -----------------------------------------------
         COPY USER
         ----------------------------------------------- */

      if (
        button.classList
          .contains(
            "user-copy-btn"
          )
      ) {
        void copyMessage(
          messageElement,
          button
        );

        return;
      }

      /* -----------------------------------------------
         EDIT
         ----------------------------------------------- */

      if (
        button.classList
          .contains(
            "user-edit-btn"
          )
      ) {
        requestEdit(
          messageElement
        );

        return;
      }

      /* -----------------------------------------------
         SHARE
         ----------------------------------------------- */

      if (
        button.classList
          .contains(
            "share-msg-btn"
          )
      ) {
        requestShare(
          messageElement
        );

        return;
      }

      /* -----------------------------------------------
         REGENERATE
         ----------------------------------------------- */

      if (
        button.classList
          .contains(
            "regen-msg-btn"
          )
      ) {
        requestRegenerate(
          messageElement
        );
      }
    },
    true
  );

  /* =====================================================
     MESSAGE MOUNTED
     ===================================================== */

  window.addEventListener(
    "neyo:message-mounted",
    event => {
      const element =
        event.detail?.element;

      const message =
        event.detail?.message ||
        null;

      mountActions(
        element,
        message
      );
    }
  );

  /* =====================================================
     MESSAGE UPDATED

     Streaming assistant becomes completed assistant here.
     ===================================================== */

  window.addEventListener(
    "neyo:message-updated",
    event => {
      const element =
        event.detail?.element;

      const message =
        event.detail?.message ||
        null;

      if (
        !(element instanceof
          HTMLElement)
      ) {
        return;
      }

      mountActions(
        element,
        message
      );
    }
  );

  /*
   * Canonical chat update fallback.
   */

  window.addEventListener(
    "neyo:chat-message-updated",
    event => {
      const message =
        event.detail?.message;

      if (!message?.id) {
        return;
      }

      const element =
        window.NeyoMessages
          ?.getElement
          ?.(message.id);

      if (!element) {
        return;
      }

      mountActions(
        element,
        message
      );
    }
  );

  /* =====================================================
     GENERATION STATE
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {
      state.generating =
        true;

      refreshAllAvailability();
    }
  );

  function generationFinished() {
    state.generating =
      false;

    refreshAllAvailability();
  }

  window.addEventListener(
    "neyo:chat-send-end",
    generationFinished
  );

  window.addEventListener(
    "neyo:chat-aborted",
    generationFinished
  );

  window.addEventListener(
    "neyo:chat-error",
    generationFinished
  );

  window.addEventListener(
    "neyo:chat-limit-reached",
    generationFinished
  );

  window.addEventListener(
    "neyo:chat-state",
    event => {
      const value =
        event.detail
          ?.generating;

      if (
        typeof value !==
        "boolean"
      ) {
        return;
      }

      state.generating =
        value;

      refreshAllAvailability();
    }
  );

  /* =====================================================
     CLEAR
     ===================================================== */

  window.addEventListener(
    "neyo:messages-cleared",
    () => {
      resetCopyFeedback();

      state.activeAction =
        null;
    }
  );

  /* =====================================================
     HYDRATE EXISTING DOM

     Important while old neo.js remains physically loaded.
     Do not duplicate old action containers.
     ===================================================== */

  function hydrateExistingMessages() {
    const messages =
      chatMessages.querySelectorAll(
        ".message:not(.is-thinking)"
      );

    for (
      const messageElement
      of messages
    ) {
      mountActions(
        messageElement
      );
    }

    refreshIcons();

    return messages.length;
  }

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

      mount:
        mountActions,

      hydrate:
        hydrateExistingMessages,

      copy(
        messageId
      ) {
        const element =
          window.NeyoMessages
            ?.getElement
            ?.(messageId);

        if (!element) {
          return Promise.resolve(
            false
          );
        }

        const button =
          element.querySelector(
            ".copy-msg-btn, .user-copy-btn"
          );

        if (!button) {
          return Promise.resolve(
            false
          );
        }

        return copyMessage(
          element,
          button
        );
      },

      edit(
        messageId
      ) {
        const element =
          window.NeyoMessages
            ?.getElement
            ?.(messageId);

        return element
          ? requestEdit(element)
          : false;
      },

      share(
        messageId
      ) {
        const element =
          window.NeyoMessages
            ?.getElement
            ?.(messageId);

        return element
          ? requestShare(element)
          : false;
      },

      regenerate(
        messageId
      ) {
        const element =
          window.NeyoMessages
            ?.getElement
            ?.(messageId);

        return element
          ? requestRegenerate(
              element
            )
          : false;
      },

      refresh() {
        hydrateExistingMessages();

        refreshAllAvailability();

        return true;
      },

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          generating:
            state.generating,

          copied:
            Boolean(
              state.copiedButton
            ),

          assistantActionGroups:
            chatMessages
              .querySelectorAll(
                ".message-actions"
              )
              .length,

          userActionGroups:
            chatMessages
              .querySelectorAll(
                ".user-msg-actions"
              )
              .length
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoMessageActions",
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
     INIT
     ===================================================== */

  try {
    state.generating =
      Boolean(
        window.NeyoChat
          ?.isGenerating
          ?.()
      );
  } catch {}

  hydrateExistingMessages();

  emit(
    "neyo:message-actions-ready",
    {
      version:
        VERSION,

      active:
        true,

      oldActionClasses:
        true,

      feedbackButtons:
        false
    }
  );
})();
