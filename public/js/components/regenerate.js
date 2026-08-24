/*
=========================================================
NEO — REGENERATE
Production v3 — Exact Turn Coordinator

Baseline:
- Old working Regenerate button behavior
- Current message-actions.js routing
- Current NeyoChat.regenerate()

Owns:
- Regenerate request coordination
- Exact assistant target validation
- Duplicate regenerate protection
- Temporary target busy state
- Regenerate lifecycle events

Does NOT own:
- /api/chat
- Conversation mutation
- Message deletion
- Message rendering
- Thinking UI
- Send / Stop
- Assistant action button creation
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-regenerate-production-v3";

  if (
    window.NeyoRegenerate
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    active: false,

    messageId: null,

    element: null,

    startedAt: null,

    lastResult: null
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
      return (
        chatController()
          ?.getMessage
          ?.(id) ||
        null
      );
    } catch {
      return null;
    }
  }

  function getElement(
    messageId,
    suppliedElement = null
  ) {
    if (
      suppliedElement instanceof
        HTMLElement
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
     BUSY TARGET UI

     message-actions.js owns actual buttons.
     We only temporarily mark the clicked target.
     ===================================================== */

  function setTargetBusy(
    element,
    busy
  ) {
    if (
      !(element instanceof
        HTMLElement)
    ) {
      return;
    }

    element.classList.toggle(
      "is-regenerating",
      Boolean(busy)
    );

    const button =
      element.querySelector(
        ".regen-msg-btn"
      );

    if (!button) {
      return;
    }

    button.disabled =
      Boolean(busy);

    button.setAttribute(
      "aria-disabled",
      String(
        Boolean(busy)
      )
    );

    button.classList.toggle(
      "is-loading",
      Boolean(busy)
    );
  }

  /* =====================================================
     RESET
     ===================================================== */

  function reset() {
    if (state.element) {
      setTargetBusy(
        state.element,
        false
      );
    }

    state.active =
      false;

    state.messageId =
      null;

    state.element =
      null;

    state.startedAt =
      null;
  }

  /* =====================================================
     VALIDATE TARGET
     ===================================================== */

  function validateTarget(
    messageId
  ) {
    const id =
      cleanId(messageId);

    if (!id) {
      return {
        valid: false,
        reason:
          "missing-message-id"
      };
    }

    const message =
      getMessage(id);

    if (!message) {
      return {
        valid: false,
        reason:
          "message-not-found"
      };
    }

    if (
      message.role !==
      "assistant"
    ) {
      return {
        valid: false,
        reason:
          "target-not-assistant"
      };
    }

    if (
      message.error === true
    ) {
      return {
        valid: false,
        reason:
          "target-is-error"
      };
    }

    if (
      message.streaming === true
    ) {
      return {
        valid: false,
        reason:
          "target-still-streaming"
      };
    }

    return {
      valid: true,
      message
    };
  }

  /* =====================================================
     REGENERATE
     ===================================================== */

  async function regenerate({
    messageId,
    element = null
  } = {}) {
    const id =
      cleanId(messageId);

    if (state.active) {
      emit(
        "neyo:regenerate-blocked",
        {
          messageId: id,

          reason:
            "regenerate-already-active"
        }
      );

      return false;
    }

    if (isGenerating()) {
      emit(
        "neyo:regenerate-blocked",
        {
          messageId: id,

          reason:
            "chat-generating"
        }
      );

      return false;
    }

    const validation =
      validateTarget(id);

    if (!validation.valid) {
      emit(
        "neyo:regenerate-error",
        {
          messageId: id,

          reason:
            validation.reason
        }
      );

      return false;
    }

    const chat =
      chatController();

    if (
      !chat ||
      typeof chat.regenerate !==
        "function"
    ) {
      emit(
        "neyo:regenerate-error",
        {
          messageId: id,

          reason:
            "chat-controller-unavailable"
        }
      );

      return false;
    }

    const targetElement =
      getElement(
        id,
        element
      );

    state.active =
      true;

    state.messageId =
      id;

    state.element =
      targetElement;

    state.startedAt =
      Date.now();

    state.lastResult =
      null;

    setTargetBusy(
      targetElement,
      true
    );

    emit(
      "neyo:regenerate-start",
      {
        messageId: id,

        message:
          validation.message
      }
    );

    try {
      /*
       * NeyoChat owns:
       * - exact preceding user turn resolution
       * - truncation
       * - request
       * - assistant replacement
       */

      const result =
        await chat.regenerate({
          messageId: id
        });

      state.lastResult =
        result;

      emit(
        "neyo:regenerate-complete",
        {
          messageId: id,

          result
        }
      );

      return (
        result !== null &&
        result !== false
      );

    } catch (error) {
      console.error(
        "[NEO Regenerate] Failed:",
        error
      );

      emit(
        "neyo:regenerate-error",
        {
          messageId: id,

          error
        }
      );

      return false;

    } finally {
      reset();
    }
  }

  /* =====================================================
     MESSAGE ACTION EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:message-regenerate-request",
    event => {
      const detail =
        event.detail || {};

      void regenerate({
        messageId:
          detail.messageId ||
          detail.id,

        element:
          detail.element ||
          null
      });
    }
  );

  /* =====================================================
     LEGACY COMPATIBILITY
     ===================================================== */

  window.addEventListener(
    "neyo:regenerate-request",
    event => {
      const detail =
        event.detail || {};

      void regenerate({
        messageId:
          detail.messageId ||
          detail.id,

        element:
          detail.element ||
          null
      });
    }
  );

  /* =====================================================
     NAVIGATION SAFETY
     ===================================================== */

  function cancelLocalState() {
    if (!state.active) {
      return;
    }

    reset();
  }

  window.addEventListener(
    "neyo:chat-new",
    cancelLocalState
  );

  window.addEventListener(
    "neyo:chat-state-loaded",
    cancelLocalState
  );

  window.addEventListener(
    "neyo:messages-cleared",
    cancelLocalState
  );

  /* =====================================================
     CHAT LIFECYCLE SAFETY
     ===================================================== */

  window.addEventListener(
    "neyo:chat-aborted",
    () => {
      if (state.active) {
        reset();
      }
    }
  );

  window.addEventListener(
    "neyo:chat-error",
    () => {
      if (state.active) {
        reset();
      }
    }
  );

  window.addEventListener(
    "neyo:chat-limit-reached",
    () => {
      if (state.active) {
        reset();
      }
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

      regenerate,

      request(
        messageId,
        options = {}
      ) {
        return regenerate({
          messageId,

          element:
            options.element ||
            null
        });
      },

      isActive() {
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

          regenerating:
            state.active,

          messageId:
            state.messageId,

          startedAt:
            state.startedAt,

          hasResult:
            Boolean(
              state.lastResult
            )
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoRegenerate",
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
    "neyo:regenerate-ready",
    {
      version:
        VERSION,

      active:
        true,

      exactTurn:
        true,

      conversationOwner:
        "NeyoChat"
    }
  );
})();
