/*
=========================================================
NEO — NEW CHAT
Production v1

Purpose:
Thin New Chat UI coordinator.

Owns:
- fallback #newChatBtn routing when chat-runtime is absent
- programmatic New Chat request API
- light composer cleanup after canonical chat reset
- focus restoration
- history active reset compatibility

Does NOT own:
- conversation state
- /api/chat
- message DOM
- generation abort
- history persistence
- attachment upload
- Send / Stop
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-new-chat-production-v1";

  if (
    window.NeyoNewChat
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     DOM
     ===================================================== */

  const newChatButton =
    document.getElementById(
      "newChatBtn"
    );

  const chatInput =
    document.getElementById(
      "chatInput"
    );

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    requests: 0,

    completed: 0,

    fallbackClicks: 0,

    cleanupRuns: 0
  };

  /* =====================================================
     HELPERS
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

  function runtimeOwnsButton() {
    try {
      return Boolean(
        window.NeyoChatRuntime
          ?.__controller === true &&
        window.NeyoChatRuntime
          ?.isActive
          ?.()
      );

    } catch {
      return false;
    }
  }

  function chatAvailable() {
    return Boolean(
      window.NeyoChat
        ?.__controller === true
    );
  }

  /* =====================================================
     REQUEST NEW CHAT
     ===================================================== */

  function request(
    source =
      "new-chat"
  ) {
    if (!chatAvailable()) {
      emit(
        "neyo:new-chat-error",
        {
          reason:
            "chat-controller-unavailable",

          source
        }
      );

      return false;
    }

    state.requests +=
      1;

    emit(
      "neyo:chat-new-request",
      {
        source
      }
    );

    emit(
      "neyo:new-chat-requested",
      {
        source
      }
    );

    return true;
  }

  /* =====================================================
     FALLBACK BUTTON OWNER

     chat-runtime.js owns #newChatBtn while active.

     This fallback exists only when runtime is absent or
     inactive.
     ===================================================== */

  function handleButtonClick(
    event
  ) {
    if (
      runtimeOwnsButton()
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    state.fallbackClicks +=
      1;

    request(
      "new-chat-button-fallback"
    );
  }

  if (newChatButton) {
    newChatButton.addEventListener(
      "click",
      handleButtonClick,
      true
    );
  }

  /* =====================================================
     TEXTAREA CLEANUP

     Canonical conversation reset happens FIRST in chat.js.

     We only reset visible draft state after
     neyo:chat-new confirms success.
     ===================================================== */

  function clearComposerText() {
    if (!chatInput) {
      return false;
    }

    chatInput.value =
      "";

    /*
     * Let composer/autosize modules update themselves
     * through their normal input pipeline.
     */

    chatInput.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );

    try {
      window.NeyoComposer
        ?.refresh
        ?.();
    } catch {}

    try {
      window.NeyoComposerScrollbar
        ?.refresh
        ?.();
    } catch {}

    return true;
  }

  /* =====================================================
     ATTACHMENT CLEANUP

     attachments.js remains the attachment owner.
     ===================================================== */

  function clearAttachments() {
    try {
      if (
        typeof window
          .NeyoAttachments
          ?.clear ===
        "function"
      ) {
        window.NeyoAttachments
          .clear();

        return true;
      }

    } catch (error) {
      console.warn(
        "[NEO New Chat] Attachment cleanup failed:",
        error
      );
    }

    return false;
  }

  /* =====================================================
     CLOSE TEMPORARY MESSAGE UI
     ===================================================== */

  function closeTransientUi() {
    try {
      window.NeyoMessageEdit
        ?.cancel
        ?.(
          "new-chat"
        );
    } catch {}

    try {
      window.NeyoHistoryMenu
        ?.close
        ?.({
          restoreFocus:
            false
        });
    } catch {}

    return true;
  }

  /* =====================================================
     HISTORY ACTIVE RESET

     history.js already listens to neyo:chat-new in the
     production architecture.

     Event is still emitted for compatibility with older
     history modules.
     ===================================================== */

  function resetHistoryActive() {
    emit(
      "neyo:history-active-set",
      {
        conversationId:
          null
      }
    );
  }

  /* =====================================================
     FOCUS
     ===================================================== */

  function focusComposer() {
    if (!chatInput) {
      return false;
    }

    requestAnimationFrame(
      () => {
        try {
          chatInput.focus({
            preventScroll:
              true
          });
        } catch {
          chatInput.focus();
        }
      }
    );

    return true;
  }

  /* =====================================================
     CANONICAL COMPLETION

     chat.js emits neyo:chat-new only AFTER it has:
     - invalidated old request
     - stopped generation
     - cleared canonical conversation
     - nulled conversation ID
     - requested message DOM clear

     Therefore cleanup belongs here, after confirmation.
     ===================================================== */

  function handleCanonicalNewChat(
    event
  ) {
    state.completed +=
      1;

    closeTransientUi();

    clearComposerText();

    clearAttachments();

    resetHistoryActive();

    focusComposer();

    state.cleanupRuns +=
      1;

    emit(
      "neyo:new-chat-complete",
      {
        source:
          event.detail
            ?.source ||
          null,

        conversationId:
          null
      }
    );
  }

  window.addEventListener(
    "neyo:chat-new",
    handleCanonicalNewChat
  );

  /* =====================================================
     LEGACY / PROGRAMMATIC REQUESTS
     ===================================================== */

  window.addEventListener(
    "neyo:new-chat-request",
    event => {
      request(
        event.detail
          ?.source ||
        "legacy-event"
      );
    }
  );

  /* =====================================================
     ACTIVE CONVERSATION DELETED

     Normally chat-runtime handles this.

     Fallback only when runtime is unavailable.
     ===================================================== */

  window.addEventListener(
    "neyo:active-conversation-deleted",
    () => {
      if (
        runtimeOwnsButton()
      ) {
        return;
      }

      request(
        "active-conversation-deleted-fallback"
      );
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

      request,

      newChat:
        request,

      clearDraft() {
        clearComposerText();
        clearAttachments();

        return true;
      },

      focus:
        focusComposer,

      runtimeOwnsButton,

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          buttonPresent:
            Boolean(
              newChatButton
            ),

          runtimeOwnsButton:
            runtimeOwnsButton(),

          chatAvailable:
            chatAvailable(),

          requests:
            state.requests,

          completed:
            state.completed,

          fallbackClicks:
            state.fallbackClicks,

          cleanupRuns:
            state.cleanupRuns
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoNewChat",
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
    "neyo:new-chat-ready",
    {
      version:
        VERSION,

      active:
        true,

      runtimeOwnsButton:
        runtimeOwnsButton()
    }
  );
})();
