/*
=========================================================
NEO — MESSAGE ACTIONS
Production v1

Owns:
- user/assistant action bars
- copy message
- edit request routing
- regenerate request routing
- share request routing
- feedback request routing
- action enabled/disabled state

Does NOT own:
- inline edit UI
- regenerate implementation
- share implementation
- /api/chat
- conversation mutation
- message rendering
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-message-actions-production-v1";

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
      "[NEO Actions] #chatMessages is missing."
    );

    return;
  }

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    generating: false,

    feedback:
      new Map()
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
        { detail }
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
    if (!id) {
      return null;
    }

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

  function visibleText(
    message,
    element = null
  ) {
    if (message) {
      if (
        message.role ===
          "user" &&
        typeof message
          .displayContent ===
          "string"
      ) {
        return message
          .displayContent;
      }

      if (
        typeof message
          .content ===
          "string"
      ) {
        /*
         * Do not expose the internal attachment-only
         * fallback prompt to Copy.
         */

        if (
          message.role ===
            "user" &&
          Array.isArray(
            message.attachments
          ) &&
          message.attachments
            .length &&
          (
            message.content ===
              "Please analyze the attached file or files." ||
            message.content ===
              "Please analyze the attached file."
          )
        ) {
          return "";
        }

        return message.content;
      }
    }

    /*
     * DOM fallback only.
     *
     * Important:
     * read .message-content, not element.textContent,
     * otherwise action labels / code Copy controls can
     * enter copied text.
     */

    return (
      element
        ?.querySelector(
          ".message-content"
        )
        ?.innerText ||
      ""
    );
  }

  function isGenerating() {
    try {
      return Boolean(
        window.NeyoChat
          ?.isGenerating
          ?.()
      );

    } catch {
      return state.generating;
    }
  }

  /* =====================================================
     BUTTON
     ===================================================== */

  function button({
    className,
    action,
    title,
    icon,
    iconSize = 16
  }) {
    const element =
      document.createElement(
        "button"
      );

    element.type =
      "button";

    element.className =
      className;

    element.dataset.action =
      action;

    element.title =
      title;

    element.setAttribute(
      "aria-label",
      title
    );

    const iconElement =
      document.createElement(
        "i"
      );

    iconElement.setAttribute(
      "data-lucide",
      icon
    );

    iconElement.setAttribute(
      "size",
      String(
        iconSize
      )
    );

    iconElement.setAttribute(
      "aria-hidden",
      "true"
    );

    element.appendChild(
      iconElement
    );

    return element;
  }

  /* =====================================================
     COPY
     ===================================================== */

  async function writeClipboard(
    value
  ) {
    const content =
      String(
        value ?? ""
      );

    try {
      if (
        navigator.clipboard
          ?.writeText &&
        window.isSecureContext
      ) {
        await navigator
          .clipboard
          .writeText(
            content
          );

        return true;
      }

    } catch {}

    /*
     * Compatibility fallback.
     */

    const textarea =
      document.createElement(
        "textarea"
      );

    textarea.value =
      content;

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

    document.body.appendChild(
      textarea
    );

    textarea.select();

    let success =
      false;

    try {
      success =
        document.execCommand(
          "copy"
        );
    } catch {}

    textarea.remove();

    return success;
  }

  function setCopyFeedback(
    buttonElement,
    copied
  ) {
    if (!buttonElement) {
      return;
    }

    const oldTitle =
      buttonElement.title ||
      "Copy";

    const oldLabel =
      buttonElement.getAttribute(
        "aria-label"
      ) ||
      oldTitle;

    const icon =
      buttonElement.querySelector(
        "i"
      );

    if (copied) {
      buttonElement.title =
        "Copied";

      buttonElement.setAttribute(
        "aria-label",
        "Copied"
      );

      buttonElement.dataset.copied =
        "true";

      if (icon) {
        icon.setAttribute(
          "data-lucide",
          "check"
        );
      }

      refreshIcons();

      window.setTimeout(
        () => {
          if (
            !buttonElement
              .isConnected
          ) {
            return;
          }

          buttonElement.title =
            oldTitle;

          buttonElement.setAttribute(
            "aria-label",
            oldLabel
          );

          delete buttonElement
            .dataset
            .copied;

          if (icon) {
            icon.setAttribute(
              "data-lucide",
              "copy"
            );
          }

          refreshIcons();
        },
        1200
      );

      return;
    }

    buttonElement.dataset
      .copyError =
      "true";

    window.setTimeout(
      () => {
        delete buttonElement
          .dataset
          .copyError;
      },
      1200
    );
  }

  async function copyMessage(
    id,
    buttonElement = null
  ) {
    const element =
      window.NeyoMessages
        ?.getElement
        ?.(id) ||
      null;

    const message =
      getMessage(
        id
      );

    const content =
      visibleText(
        message,
        element
      );

    if (!content) {
      return false;
    }

    const copied =
      await writeClipboard(
        content
      );

    setCopyFeedback(
      buttonElement,
      copied
    );

    emit(
      copied
        ? "neyo:message-copied"
        : "neyo:message-copy-error",
      {
        id,
        role:
          message?.role ||
          element?.dataset
            ?.role ||
          null
      }
    );

    return copied;
  }

  /* =====================================================
     USER ACTION BAR

     Existing production CSS contracts:
     .user-msg-actions
     .user-action-btn
     .user-edit-btn
     .user-copy-btn
     ===================================================== */

  function createUserActions(
    message
  ) {
    const root =
      document.createElement(
        "div"
      );

    root.className =
      "user-msg-actions";

    root.dataset
      .messageActions =
      "user";

    const edit =
      button({
        className:
          "user-action-btn user-edit-btn",

        action:
          "edit",

        title:
          "Edit message",

        icon:
          "pencil",

        iconSize:
          14
      });

    const copy =
      button({
        className:
          "user-action-btn user-copy-btn",

        action:
          "copy",

        title:
          "Copy text",

        icon:
          "copy",

        iconSize:
          14
      });

    root.append(
      edit,
      copy
    );

    return root;
  }

  /* =====================================================
     ASSISTANT ACTION BAR

     Existing production CSS contracts:
     .message-actions
     .msg-action-btn
     .copy-msg-btn
     .share-msg-btn
     .regen-msg-btn
     ===================================================== */

  function createAssistantActions(
    message
  ) {
    const root =
      document.createElement(
        "div"
      );

    root.className =
      "message-actions";

    root.dataset
      .messageActions =
      "assistant";

    const copy =
      button({
        className:
          "msg-action-btn copy-msg-btn",

        action:
          "copy",

        title:
          "Copy",

        icon:
          "copy"
      });

    const share =
      button({
        className:
          "msg-action-btn share-msg-btn",

        action:
          "share",

        title:
          "Share",

        icon:
          "share-2"
      });

    const regenerate =
      button({
        className:
          "msg-action-btn regen-msg-btn",

        action:
          "regenerate",

        title:
          "Regenerate",

        icon:
          "rotate-cw"
      });

    /*
     * Feedback controls are additive.
     * Existing Copy / Share / Regenerate structure is
     * preserved exactly.
     */

    const positive =
      button({
        className:
          "msg-action-btn feedback-msg-btn feedback-up-btn",

        action:
          "feedback-up",

        title:
          "Good response",

        icon:
          "thumbs-up"
      });

    const negative =
      button({
        className:
          "msg-action-btn feedback-msg-btn feedback-down-btn",

        action:
          "feedback-down",

        title:
          "Bad response",

        icon:
          "thumbs-down"
      });

    root.append(
      copy,
      share,
      regenerate,
      positive,
      negative
    );

    return root;
  }

  /* =====================================================
     ATTACH ACTIONS
     ===================================================== */

  function attachActions(
    element,
    message = null
  ) {
    if (
      !(element instanceof HTMLElement)
    ) {
      return false;
    }

    const id =
      message?.id ||
      messageIdOf(
        element
      );

    const role =
      message?.role ||
      element.dataset.role;

    if (
      !id ||
      (
        role !== "user" &&
        role !== "assistant"
      )
    ) {
      return false;
    }

    /*
     * Never attach actions to Thinking shell.
     */

    if (
      id ===
      "neyo-thinking" ||
      element.classList
        .contains(
          "is-thinking"
        )
    ) {
      return false;
    }

    /*
     * Duplicate protection.
     */

    if (
      element.querySelector(
        "[data-message-actions]"
      )
    ) {
      updateActionsState(
        element
      );

      return true;
    }

    /*
     * During migration an old action bar may already
     * exist without our data marker.
     *
     * Reuse it rather than creating a second visible bar.
     */

    if (
      role ===
      "assistant"
    ) {
      const legacy =
        element.querySelector(
          ".message-actions"
        );

      if (legacy) {
        legacy.dataset
          .messageActions =
          "assistant";

        normalizeLegacyAssistantActions(
          legacy
        );

        updateActionsState(
          element
        );

        return true;
      }
    }

    if (
      role === "user"
    ) {
      const legacy =
        element.querySelector(
          ".user-msg-actions"
        );

      if (legacy) {
        legacy.dataset
          .messageActions =
          "user";

        normalizeLegacyUserActions(
          legacy
        );

        updateActionsState(
          element
        );

        return true;
      }
    }

    const actions =
      role === "user"
        ? createUserActions(
            message
          )
        : createAssistantActions(
            message
          );

    if (
      role === "user"
    ) {
      const wrapper =
        element.querySelector(
          ".message-wrapper"
        );

      /*
       * Preserve old user-message layout:
       * content + actions inside .message-wrapper.
       */

      if (!wrapper) {
        return false;
      }

      wrapper.appendChild(
        actions
      );

    } else {
      element.appendChild(
        actions
      );
    }

    updateActionsState(
      element
    );

    refreshIcons();

    emit(
      "neyo:message-actions-attached",
      {
        id,
        role,
        element
      }
    );

    return true;
  }

  /* =====================================================
     LEGACY ACTION NORMALIZATION

     Existing action elements receive canonical data-action
     attributes, allowing ONE delegated click handler.
     ===================================================== */

  function normalizeLegacyAssistantActions(
    root
  ) {
    root
      .querySelector(
        ".copy-msg-btn"
      )
      ?.setAttribute(
        "data-action",
        "copy"
      );

    root
      .querySelector(
        ".share-msg-btn"
      )
      ?.setAttribute(
        "data-action",
        "share"
      );

    root
      .querySelector(
        ".regen-msg-btn"
      )
      ?.setAttribute(
        "data-action",
        "regenerate"
      );
  }

  function normalizeLegacyUserActions(
    root
  ) {
    root
      .querySelector(
        ".user-edit-btn"
      )
      ?.setAttribute(
        "data-action",
        "edit"
      );

    root
      .querySelector(
        ".user-copy-btn"
      )
      ?.setAttribute(
        "data-action",
        "copy"
      );
  }

  /* =====================================================
     DISABLED STATE
     ===================================================== */

  function updateActionsState(
    element = null
  ) {
    const generating =
      isGenerating();

    state.generating =
      generating;

    const roots =
      element
        ? [element]
        : Array.from(
            chatMessages
              .querySelectorAll(
                '.message[data-neyo-message-id]:not([data-neyo-message-id="neyo-thinking"])'
              )
          );

    for (
      const messageElement
      of roots
    ) {
      /*
       * Copy remains available while generation runs.
       * Share also remains safe.
       *
       * Mutation actions are disabled.
       */

      const edit =
        messageElement.querySelector(
          '[data-action="edit"]'
        );

      const regenerate =
        messageElement.querySelector(
          '[data-action="regenerate"]'
        );

      if (edit) {
        edit.disabled =
          generating;

        edit.setAttribute(
          "aria-disabled",
          String(
            generating
          )
        );
      }

      if (regenerate) {
        regenerate.disabled =
          generating;

        regenerate.setAttribute(
          "aria-disabled",
          String(
            generating
          )
        );
      }
    }

    return true;
  }

  /* =====================================================
     EDIT REQUEST
     ===================================================== */

  function requestEdit(
    id
  ) {
    if (
      !id ||
      isGenerating()
    ) {
      return false;
    }

    const message =
      getMessage(
        id
      );

    if (
      !message ||
      message.role !==
        "user"
    ) {
      return false;
    }

    emit(
      "neyo:message-edit-request",
      {
        id,
        message
      }
    );

    return true;
  }

  /* =====================================================
     REGENERATE REQUEST
     ===================================================== */

  function requestRegenerate(
    id
  ) {
    if (
      !id ||
      isGenerating()
    ) {
      return false;
    }

    const message =
      getMessage(
        id
      );

    if (
      !message ||
      message.role !==
        "assistant"
    ) {
      return false;
    }

    emit(
      "neyo:message-regenerate-request",
      {
        id,
        message
      }
    );

    return true;
  }

  /* =====================================================
     SHARE REQUEST
     ===================================================== */

  function requestShare(
    id
  ) {
    if (!id) {
      return false;
    }

    const message =
      getMessage(
        id
      );

    if (
      !message ||
      message.role !==
        "assistant"
    ) {
      return false;
    }

    emit(
      "neyo:message-share-request",
      {
        id,
        message
      }
    );

    return true;
  }

  /* =====================================================
     FEEDBACK

     message-actions.js owns only the user selection and
     request event. Backend persistence belongs elsewhere.
     ===================================================== */

  function setFeedback(
    id,
    value
  ) {
    if (
      !id ||
      ![
        "positive",
        "negative"
      ].includes(
        value
      )
    ) {
      return false;
    }

    const message =
      getMessage(
        id
      );

    if (
      !message ||
      message.role !==
        "assistant"
    ) {
      return false;
    }

    const previous =
      state.feedback.get(
        id
      );

    /*
     * Clicking same feedback again clears it.
     */

    const next =
      previous === value
        ? null
        : value;

    if (next) {
      state.feedback.set(
        id,
        next
      );
    } else {
      state.feedback.delete(
        id
      );
    }

    renderFeedback(
      id
    );

    emit(
      "neyo:message-feedback-request",
      {
        id,
        message,
        value: next,
        previous
      }
    );

    return true;
  }

  function renderFeedback(
    id
  ) {
    const element =
      window.NeyoMessages
        ?.getElement
        ?.(id);

    if (!element) {
      return false;
    }

    const value =
      state.feedback.get(
        id
      ) ||
      null;

    const up =
      element.querySelector(
        '[data-action="feedback-up"]'
      );

    const down =
      element.querySelector(
        '[data-action="feedback-down"]'
      );

    up?.classList.toggle(
      "is-active",
      value === "positive"
    );

    down?.classList.toggle(
      "is-active",
      value === "negative"
    );

    up?.setAttribute(
      "aria-pressed",
      String(
        value === "positive"
      )
    );

    down?.setAttribute(
      "aria-pressed",
      String(
        value === "negative"
      )
    );

    return true;
  }

  /* =====================================================
     CLICK ROUTING

     Single delegated handler.
     No per-message business logic listeners.
     ===================================================== */

  chatMessages.addEventListener(
    "click",
    event => {
      const target =
        event.target instanceof
          Element
          ? event.target
          : null;

      if (!target) {
        return;
      }

      const buttonElement =
        target.closest(
          "[data-action]"
        );

      if (
        !buttonElement ||
        !chatMessages.contains(
          buttonElement
        )
      ) {
        return;
      }

      const messageElement =
        buttonElement.closest(
          "[data-neyo-message-id], [data-message-id]"
        );

      if (!messageElement) {
        return;
      }

      const id =
        messageIdOf(
          messageElement
        );

      if (!id) {
        return;
      }

      const action =
        buttonElement.dataset
          .action;

      /*
       * Stop old neo.js click handlers from executing
       * the same action a second time.
       */

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      switch (action) {
        case "copy":
          void copyMessage(
            id,
            buttonElement
          );
          break;

        case "edit":
          requestEdit(
            id
          );
          break;

        case "regenerate":
          requestRegenerate(
            id
          );
          break;

        case "share":
          requestShare(
            id
          );
          break;

        case "feedback-up":
          setFeedback(
            id,
            "positive"
          );
          break;

        case "feedback-down":
          setFeedback(
            id,
            "negative"
          );
          break;
      }
    },
    true
  );

  /* =====================================================
     MESSAGE CREATED
     ===================================================== */

  window.addEventListener(
    "neyo:message-shell-created",
    event => {
      const element =
        event.detail
          ?.element;

      const message =
        event.detail
          ?.message;

      attachActions(
        element,
        message
      );
    }
  );

  /* =====================================================
     MESSAGE UPDATE
     ===================================================== */

  window.addEventListener(
    "neyo:message-updated",
    event => {
      const element =
        event.detail
          ?.element;

      if (element) {
        attachActions(
          element,
          event.detail
            ?.message ||
          null
        );
      }
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

      updateActionsState();
    }
  );

  for (
    const eventName
    of [
      "neyo:chat-send-end",
      "neyo:chat-response",
      "neyo:chat-error",
      "neyo:chat-aborted",
      "neyo:chat-limit-reached",
      "neyo:chat-new",
      "neyo:chat-state-loaded"
    ]
  ) {
    window.addEventListener(
      eventName,
      () => {
        state.generating =
          false;

        updateActionsState();
      }
    );
  }

  /* =====================================================
     CLEAR FEEDBACK FOR REMOVED/NEW MESSAGES
     ===================================================== */

  window.addEventListener(
    "neyo:chat-message-removed",
    event => {
      const id =
        event.detail
          ?.id ||
        event.detail
          ?.message
          ?.id;

      if (id) {
        state.feedback.delete(
          String(id)
        );
      }
    }
  );

  window.addEventListener(
    "neyo:messages-cleared",
    () => {
      state.feedback.clear();
    }
  );

  /* =====================================================
     HYDRATE EXISTING SHELLS

     Useful if this component loads after messages.js.
     ===================================================== */

  function hydrate() {
    const elements =
      chatMessages.querySelectorAll(
        '.message[data-neyo-message-id]:not([data-neyo-message-id="neyo-thinking"])'
      );

    for (
      const element
      of elements
    ) {
      const id =
        messageIdOf(
          element
        );

      attachActions(
        element,
        getMessage(
          id
        )
      );
    }

    refreshIcons();

    return elements.length;
  }

  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({
      __controller: true,
      version: VERSION,
      active: true,

      attach:
        attachActions,

      hydrate,

      copy:
        copyMessage,

      edit:
        requestEdit,

      regenerate:
        requestRegenerate,

      share:
        requestShare,

      feedback:
        setFeedback,

      refresh:
        updateActionsState,

      getFeedback(
        id
      ) {
        return (
          state.feedback.get(
            String(id)
          ) ||
          null
        );
      },

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          generating:
            isGenerating(),

          feedbackCount:
            state.feedback.size,

          actionBars:
            chatMessages
              .querySelectorAll(
                "[data-message-actions]"
              )
              .length
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoMessageActions",
    {
      value: api,
      writable: false,
      configurable: true,
      enumerable: true
    }
  );

  /* =====================================================
     INIT
     ===================================================== */

  hydrate();

  emit(
    "neyo:message-actions-ready",
    {
      version:
        VERSION,

      active:
        true
    }
  );
})();
