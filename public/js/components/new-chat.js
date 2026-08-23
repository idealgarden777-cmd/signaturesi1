/*
=========================================================
NEYO — NEW CHAT
FINAL PRODUCTION MIXER v3

FILE:
public/js/components/new-chat.js

PURPOSE
---------------------------------------------------------
Preserve the existing production New Chat behavior and
only repair ownership/routing conflicts introduced during
modularization.

OWNS
---------------------------------------------------------
- New Chat request helper
- Fallback #newChatBtn routing when chat-runtime is absent
- Composer text reset after canonical new chat
- Focus restoration to composer
- Closing transient composer/history UI after new chat
- New-chat lifecycle events
- Public New Chat API

DOES NOT OWN
---------------------------------------------------------
- Conversation state
- Message DOM clearing
- Hero visibility
- Attachment storage/upload state
- History persistence
- Send/Stop
- Chat API
- Sidebar rendering

CANONICAL FLOW
---------------------------------------------------------
#newChatBtn
      ↓
chat-runtime.js (preferred owner while active)
      ↓
neyo:chat-new-request
      ↓
chat.js → newConversation()
      ↓
neyo:messages-clear
neyo:chat-new
      ↓
messages.js / history / attachments / this module

IMPORTANT
---------------------------------------------------------
This file does NOT redesign New Chat.
It does NOT duplicate chat.js state reset.
It does NOT directly clear #chatMessages.
It does NOT manually show/hide heroSection.

Those working responsibilities remain with their existing
owners. This module only fixes the modular New Chat bridge
and small UI cleanup.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-new-chat-final-v3";

  if (
    window.NeyoNewChat
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     DOM
     ===================================================== */

  const newChatBtn =
    document.getElementById(
      "newChatBtn"
    );

  const chatInput =
    document.getElementById(
      "chatInput"
    );

  const scrollArea =
    document.getElementById(
      "scrollArea"
    );

  /* =====================================================
     LEGACY TELEMETRY ONLY
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

  let requesting =
    false;

  let lastRequestAt =
    0;

  const metrics = {
    requests:
      0,

    completions:
      0,

    fallbackButtonRoutes:
      0,

    runtimeButtonRoutes:
      0,

    legacyClicksBlocked:
      0,

    lastRequestedAt:
      null,

    lastCompletedAt:
      null
  };

  /* =====================================================
     EVENT
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
     OWNERSHIP CHECK

     chat-runtime.js already owns #newChatBtn in capture
     phase in the modular runtime. Do not compete with it.
     ===================================================== */

  function runtimeOwnsButton() {
    try {
      const runtime =
        window.NeyoChatRuntime;

      if (
        !runtime ||
        typeof runtime !==
          "object"
      ) {
        return false;
      }

      if (
        typeof runtime.isActive ===
        "function"
      ) {
        return Boolean(
          runtime.isActive()
        );
      }

      return Boolean(
        runtime.getState
          ?.().active
      );

    } catch {
      return false;
    }
  }

  /* =====================================================
     CANONICAL REQUEST
     ===================================================== */

  function requestNewChat({
    source =
      "new-chat"
  } = {}) {
    if (
      requesting
    ) {
      return false;
    }

    const now =
      performance.now();

    /*
     * Small re-entry guard only.
     * This is not a UX behavior change; it prevents an
     * accidental double event from legacy + modular code.
     */

    if (
      now -
        lastRequestAt <
      180
    ) {
      return false;
    }

    lastRequestAt =
      now;

    requesting =
      true;

    metrics.requests +=
      1;

    metrics.lastRequestedAt =
      Date.now();

    emit(
      "neyo:chat-new-request",
      {
        source
      }
    );

    /*
     * chat.js handles the request synchronously at the
     * state-transition boundary, then emits neyo:chat-new.
     * Keep a fallback release in case the engine is not
     * ready so the button never becomes permanently stuck.
     */

    window.setTimeout(
      () => {
        requesting =
          false;
      },
      500
    );

    return true;
  }

  /* =====================================================
     COMPOSER RESET

     Preserve the normal New Chat feel without taking over
     composer geometry or send state.
     ===================================================== */

  function resetComposerText() {
    if (
      !chatInput
    ) {
      return false;
    }

    if (
      chatInput.value !==
      ""
    ) {
      chatInput.value =
        "";

      chatInput.dispatchEvent(
        new Event(
          "input",
          {
            bubbles:
              true
          }
        )
      );
    }

    try {
      window
        .NeyoComposerScrollbar
        ?.refresh
        ?.();
    } catch {}

    try {
      window.NeyoComposer
        ?.refresh
        ?.();
    } catch {}

    return true;
  }

  /* =====================================================
     CLOSE TRANSIENT UI

     These calls are deliberately optional and idempotent.
     No persistent state is changed here.
     ===================================================== */

  function closeTransientUi() {
    try {
      window.NeyoAttachments
        ?.closeMenu
        ?.();
    } catch {}

    try {
      window.NeyoHistoryMenu
        ?.close
        ?.({
          restoreFocus:
            false,

          reason:
            "new-chat"
        });
    } catch {}

    try {
      window.NeyoShare
        ?.close
        ?.({
          restoreFocus:
            false
        });
    } catch {}

    try {
      window.NeyoMessageEdit
        ?.cancel
        ?.({
          restoreFocus:
            false,

          reason:
            "new-chat"
        });
    } catch {}
  }

  /* =====================================================
     FOCUS COMPOSER
     ===================================================== */

  function focusComposer() {
    if (
      !chatInput ||
      !chatInput.isConnected
    ) {
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
          try {
            chatInput.focus();
          } catch {}
        }
      }
    );

    return true;
  }

  /* =====================================================
     SCROLL RESET

     New empty conversation should begin at its normal top
     position. This changes only scroll position, not DOM.
     ===================================================== */

  function resetScroll() {
    if (
      !scrollArea
    ) {
      return false;
    }

    try {
      scrollArea.scrollTo({
        top:
          0,

        behavior:
          "auto"
      });

    } catch {
      scrollArea.scrollTop =
        0;
    }

    return true;
  }

  /* =====================================================
     CANONICAL NEW CHAT COMPLETED
     ===================================================== */

  function handleNewChat(
    event
  ) {
    requesting =
      false;

    resetComposerText();

    closeTransientUi();

    resetScroll();

    /*
     * Attachments are already cleared by the final
     * chat-runtime on neyo:chat-new. Keep only a guarded
     * fallback for runtime-less operation.
     */

    if (
      !runtimeOwnsButton()
    ) {
      try {
        window.NeyoAttachments
          ?.clear
          ?.();
      } catch {}
    }

    /*
     * History active state is also synchronized by the
     * final runtime. Do not emit a duplicate when runtime
     * owns that bridge.
     */

    if (
      !runtimeOwnsButton()
    ) {
      emit(
        "neyo:history-active-set",
        {
          conversationId:
            null
        }
      );
    }

    focusComposer();

    metrics.completions +=
      1;

    metrics.lastCompletedAt =
      Date.now();

    emit(
      "neyo:new-chat-ready",
      {
        source:
          event?.detail
            ?.source ||
          null
      }
    );
  }

  /* =====================================================
     BUTTON FALLBACK ROUTER

     IMPORTANT:
     - If chat-runtime is active, it remains button owner.
     - If runtime is absent/not active, this file safely
       routes #newChatBtn itself.
     - Capture phase prevents old neo.js click behavior in
       that fallback mode only.
     ===================================================== */

  document.addEventListener(
    "click",
    event => {
      const target =
        event.target;

      if (
        !(target instanceof
          Element)
      ) {
        return;
      }

      const button =
        target.closest(
          "#newChatBtn"
        );

      if (!button) {
        return;
      }

      if (
        runtimeOwnsButton()
      ) {
        metrics.runtimeButtonRoutes +=
          1;

        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (
        legacyScriptPresent
      ) {
        metrics.legacyClicksBlocked +=
          1;
      }

      metrics.fallbackButtonRoutes +=
        1;

      requestNewChat({
        source:
          "new-chat-button"
      });
    },
    true
  );

  /* =====================================================
     CANONICAL COMPLETION EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    handleNewChat
  );

  /* =====================================================
     ACTIVE CONVERSATION DELETED

     Existing runtime already routes this to New Chat.
     Only provide the old fallback when runtime is absent.
     ===================================================== */

  window.addEventListener(
    "neyo:active-conversation-deleted",
    () => {
      if (
        runtimeOwnsButton()
      ) {
        return;
      }

      requestNewChat({
        source:
          "active-conversation-deleted"
      });
    }
  );

  /* =====================================================
     PUBLIC REQUEST EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:new-chat-request",
    event => {
      requestNewChat({
        source:
          event.detail
            ?.source ||
          "public-event"
      });
    }
  );

  /* =====================================================
     BUTTON ACCESSIBILITY
     ===================================================== */

  if (
    newChatBtn
  ) {
    if (
      !newChatBtn.hasAttribute(
        "aria-label"
      )
    ) {
      newChatBtn.setAttribute(
        "aria-label",
        "New chat"
      );
    }
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

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      request:
        requestNewChat,

      newChat:
        requestNewChat,

      resetComposerText,

      focusComposer,

      closeTransientUi,

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          requesting,

          runtimeOwnsButton:
            runtimeOwnsButton(),

          legacyScriptPresent,

          legacyOwnerActive:
            false,

          hasButton:
            Boolean(
              newChatBtn
            ),

          hasInput:
            Boolean(
              chatInput
            ),

          metrics: {
            ...metrics
          }
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
    "neyo:new-chat-controller-ready",
    {
      version:
        VERSION,

      active:
        true,

      runtimeOwnsButton:
        runtimeOwnsButton(),

      legacyScriptPresent,

      legacyOwnerActive:
        false
    }
  );
})();
