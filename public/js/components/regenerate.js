/*
=========================================================
NEO — REGENERATE
Production v1

Owns:
- regenerate request coordination
- target assistant validation
- duplicate request protection
- temporary busy state
- compatibility request events

Does NOT own:
- conversation mutation
- message removal
- /api/chat
- response rendering
- thinking UI
- Send / Stop
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-regenerate-production-v1";

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

    startedAt: null,

    attempts: 0,

    completed: 0,

    failed: 0
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

  function cleanId(
    value
  ) {
    return String(
      value || ""
    ).trim();
  }

  function chat() {
    const controller =
      window.NeyoChat;

    return (
      controller &&
      controller.__controller === true
    )
      ? controller
      : null;
  }

  function getMessage(
    id
  ) {
    try {
      return (
        chat()
          ?.getMessage
          ?.(id) ||
        null
      );

    } catch {
      return null;
    }
  }

  function getElement(
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
        chat()
          ?.isGenerating
          ?.()
      );

    } catch {
      return false;
    }
  }

  /* =====================================================
     TARGET

     Regeneration must target a real assistant message.
     It must never blindly regenerate "whatever is last".
     ===================================================== */

  function resolveTarget(
    id
  ) {
    const key =
      cleanId(
        id
      );

    if (!key) {
      return null;
    }

    const message =
      getMessage(
        key
      );

    if (
      !message ||
      message.role !==
        "assistant" ||
      message.error ===
        true
    ) {
      return null;
    }

    return {
      id:
        key,

      message,

      element:
        getElement(
          key
        )
    };
  }

  /* =====================================================
     UI BUSY STATE

     No new visual design.
     Existing action button gets temporary state only.
     ===================================================== */

  function setTargetBusy(
    target,
    busy
  ) {
    const element =
      target?.element;

    if (!element) {
      return;
    }

    element.classList.toggle(
      "is-regenerating",
      Boolean(
        busy
      )
    );

    const button =
      element.querySelector(
        '[data-action="regenerate"], .regen-msg-btn'
      );

    if (!button) {
      return;
    }

    button.disabled =
      Boolean(
        busy
      );

    button.setAttribute(
      "aria-disabled",
      String(
        Boolean(
          busy
        )
      )
    );

    button.setAttribute(
      "aria-busy",
      String(
        Boolean(
          busy
        )
      )
    );
  }

  /* =====================================================
     RESET
     ===================================================== */

  function reset() {
    const id =
      state.messageId;

    if (id) {
      setTargetBusy(
        {
          element:
            getElement(
              id
            )
        },
        false
      );
    }

    state.active =
      false;

    state.messageId =
      null;

    state.startedAt =
      null;
  }

  /* =====================================================
     REGENERATE
     ===================================================== */

  async function regenerate(
    messageId
  ) {
    const controller =
      chat();

    if (
      !controller ||
      typeof controller.regenerate !==
        "function"
    ) {
      state.failed += 1;

      emit(
        "neyo:regenerate-error",
        {
          messageId:
            cleanId(
              messageId
            ),

          reason:
            "chat-regenerate-api-unavailable"
        }
      );

      return false;
    }

    /*
     * One generation at a time.
     */

    if (
      state.active ||
      isGenerating()
    ) {
      return false;
    }

    const target =
      resolveTarget(
        messageId
      );

    if (!target) {
      state.failed += 1;

      emit(
        "neyo:regenerate-error",
        {
          messageId:
            cleanId(
              messageId
            ),

          reason:
            "invalid-assistant-message"
        }
      );

      return false;
    }

    state.active =
      true;

    state.messageId =
      target.id;

    state.startedAt =
      Date.now();

    state.attempts +=
      1;

    setTargetBusy(
      target,
      true
    );

    emit(
      "neyo:regenerate-start",
      {
        messageId:
          target.id,

        message:
          target.message
      }
    );

    try {
      /*
       * chat.js owns:
       *
       * - locating preceding user turn
       * - truncating stale assistant messages
       * - preserving attachments
       * - /api/chat
       * - lifecycle events
       */

      const result =
        await controller.regenerate({
          messageId:
            target.id
        });

      /*
       * null normally means aborted, unavailable,
       * rate-limited, or no generation result.
       *
       * chat.js already emits the precise lifecycle event.
       */

      if (result === null) {
        emit(
          "neyo:regenerate-end",
          {
            messageId:
              target.id,

            success:
              false,

            result:
              null
          }
        );

        return false;
      }

      state.completed +=
        1;

      emit(
        "neyo:regenerate-success",
        {
          messageId:
            target.id,

          result
        }
      );

      emit(
        "neyo:regenerate-end",
        {
          messageId:
            target.id,

          success:
            true,

          result
        }
      );

      return true;

    } catch (error) {
      state.failed +=
        1;

      console.error(
        "[NEO Regenerate] Failed:",
        error
      );

      emit(
        "neyo:regenerate-error",
        {
          messageId:
            target.id,

          error
        }
      );

      emit(
        "neyo:regenerate-end",
        {
          messageId:
            target.id,

          success:
            false,

          error
        }
      );

      return false;

    } finally {
      reset();
    }
  }

  /* =====================================================
     MESSAGE ACTION REQUEST

     message-actions.js emits this canonical request.
     ===================================================== */

  window.addEventListener(
    "neyo:message-regenerate-request",
    event => {
      const id =
        event.detail?.id ||
        event.detail
          ?.message
          ?.id;

      if (id) {
        void regenerate(
          id
        );
      }
    }
  );

  /* =====================================================
     LEGACY / COMPATIBILITY REQUESTS

     Old/new experimental modules may use these names.
     They all converge into ONE implementation.
     ===================================================== */

  window.addEventListener(
    "neyo:regenerate-request",
    event => {
      const id =
        event.detail
          ?.messageId ||
        event.detail?.id;

      if (id) {
        void regenerate(
          id
        );
      }
    }
  );

  /* =====================================================
     CHAT RESET

     Navigation/new conversation invalidates coordinator
     state. chat.js itself owns the real request abort.
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
      reset
    );
  }

  /* =====================================================
     MESSAGE REMOVAL

     During a valid regeneration, chat.js removes the old
     assistant target as part of canonical truncation.
     We DO NOT interpret that as failure.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-message-removed",
    event => {
      if (!state.active) {
        return;
      }

      const id =
        cleanId(
          event.detail?.id ||
          event.detail
            ?.message
            ?.id
        );

      if (
        id !==
        state.messageId
      ) {
        return;
      }

      /*
       * Old target no longer exists, which is normal.
       * Keep coordinator active until chat.regenerate()
       * resolves.
       */
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

      regenerate,

      request:
        regenerate,

      isRunning() {
        return state.active;
      },

      getTargetId() {
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

          running:
            state.active,

          messageId:
            state.messageId,

          startedAt:
            state.startedAt,

          chatGenerating:
            isGenerating(),

          metrics: {
            attempts:
              state.attempts,

            completed:
              state.completed,

            failed:
              state.failed
          }
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

      canonicalOwner:
        "NeyoChat.regenerate"
    }
  );
})();
