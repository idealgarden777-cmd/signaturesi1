/*
=========================================================
NEO — NEW CHAT
Production v3 — Canonical UI Coordinator

Baseline:
- Old working neo.js New Chat behavior
- Current NeyoChat.newConversation()
- Current NeyoChatRuntime migration bridge
- Current NeyoAttachments
- Current NeyoHistory
- Current NeyoSendState

Flow:
#newChatBtn
    ↓
NeyoChatRuntime (preferred while legacy neo.js exists)
    ↓
neyo:chat-new-request
    ↓
NeyoChat.newConversation()
    ↓
neyo:chat-new
    ↓
NeyoNewChat UI cleanup

Fallback:
If ChatRuntime is unavailable, this file safely owns
#newChatBtn and emits the same canonical request.

Owns:
- New Chat UI coordination
- Fallback #newChatBtn routing
- Composer draft cleanup after canonical reset
- Attachment draft cleanup after canonical reset
- History active-row reset
- Transient composer/menu close requests
- Composer focus restoration
- New-chat lifecycle diagnostics

Does NOT own:
- Conversation state
- AbortController
- Message DOM
- History persistence
- Attachment upload
- Send / Stop
- Hero rendering
- Sidebar implementation
- Search/research/private-chat state
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-new-chat-production-v3";

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

  const attachPopupMenu =
    document.getElementById(
      "attachPopupMenu"
    );

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    requesting: false,

    cleaning: false,

    lastRequestedAt: 0,

    lastCompletedAt: 0,

    requestCount: 0,

    completionCount: 0
  };

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      duplicateWindowMs:
        180
    });

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
     OWNERS
     ===================================================== */

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

  function runtimeController() {
    const controller =
      window.NeyoChatRuntime;

    return (
      controller &&
      controller.__controller ===
        true
    )
      ? controller
      : null;
  }

  function attachmentsController() {
    const controller =
      window.NeyoAttachments;

    return (
      controller &&
      controller.__controller ===
        true
    )
      ? controller
      : null;
  }

  function sendStateController() {
    const controller =
      window.NeyoSendState;

    return (
      controller &&
      controller.__controller ===
        true
    )
      ? controller
      : null;
  }

  /* =====================================================
     RUNTIME BUTTON OWNERSHIP

     Current chat-runtime.js owns #newChatBtn while active.
     Never become a second capture-phase owner.
     ===================================================== */

  function runtimeOwnsButton() {
    const runtime =
      runtimeController();

    if (!runtime) {
      return false;
    }

    try {
      if (
        typeof runtime.isActive ===
          "function"
      ) {
        return Boolean(
          runtime.isActive()
        );
      }

      return Boolean(
        runtime.active
      );

    } catch {
      return false;
    }
  }

  /* =====================================================
     CLEAR COMPOSER TEXT
     ===================================================== */

  function clearComposerText() {
    if (!chatInput) {
      return false;
    }

    /*
     * Avoid unnecessary input event if already empty.
     */

    if (
      chatInput.value !==
      ""
    ) {
      chatInput.value = "";

      chatInput.dispatchEvent(
        new Event(
          "input",
          {
            bubbles: true
          }
        )
      );
    }

    /*
     * Composer components may need to recalculate height,
     * scrollbar and layout.
     */

    try {
      window.NeyoComposer
        ?.refresh
        ?.();
    } catch {}

    try {
      window
        .NeyoComposerScrollbar
        ?.refresh
        ?.();
    } catch {}

    return true;
  }

  /* =====================================================
     CLEAR ATTACHMENTS

     New Chat is different from accepted Send.

     Accepted Send:
     send-state.js removes only attachments actually sent.

     New Chat:
     entire composer attachment draft must disappear.
     ===================================================== */

  function clearAttachments() {
    const controller =
      attachmentsController();

    if (!controller) {
      return false;
    }

    try {
      if (
        typeof controller.clear ===
        "function"
      ) {
        controller.clear();

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
     CLOSE ATTACHMENT POPUP

     Temporary compatibility until popup ownership is moved
     to its final dedicated UI component.
     ===================================================== */

  function closeAttachmentPopup() {
    if (!attachPopupMenu) {
      return false;
    }

    attachPopupMenu.classList.remove(
      "active",
      "open",
      "show"
    );

    attachPopupMenu.setAttribute(
      "aria-hidden",
      "true"
    );

    document
      .getElementById(
        "attachBtn"
      )
      ?.setAttribute(
        "aria-expanded",
        "false"
      );

    return true;
  }

  /* =====================================================
     CLOSE TRANSIENT UI

     We emit requests instead of reaching into unrelated
     components' private state.
     ===================================================== */

  function closeTransientUI() {
    closeAttachmentPopup();

    emit(
      "neyo:history-menu-close-request",
      {
        reason:
          "new-chat"
      }
    );

    emit(
      "neyo:composer-menu-close-request",
      {
        reason:
          "new-chat"
      }
    );

    emit(
      "neyo:transient-ui-close-request",
      {
        reason:
          "new-chat"
      }
    );
  }

  /* =====================================================
     RESET HISTORY ACTIVE STATE
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
     CLEAR DRAFT STORAGE THROUGH OWNER EVENT

     Do not directly guess settings.js/localStorage keys.
     Later composer/settings owner can listen to this event.
     ===================================================== */

  function clearDraftState() {
    emit(
      "neyo:draft-clear-request",
      {
        conversationId:
          null,

        reason:
          "new-chat"
      }
    );
  }

  /* =====================================================
     RESET OPTIONAL MODE-SPECIFIC DRAFT UI

     Important:
     We DO NOT turn off persistent user preferences here.

     These events mean:
     "discard temporary state belonging to the old turn",
     not "change the user's settings".
     ===================================================== */

  function resetTransientDraftState() {
    emit(
      "neyo:suggestions-reset-request",
      {
        reason:
          "new-chat"
      }
    );

    emit(
      "neyo:composer-reset-request",
      {
        reason:
          "new-chat"
      }
    );
  }

  /* =====================================================
     SEND STATE REFRESH
     ===================================================== */

  function refreshSendState() {
    const controller =
      sendStateController();

    try {
      controller
        ?.refresh
        ?.();
    } catch {}
  }

  /* =====================================================
     FOCUS
     ===================================================== */

  function focusComposer() {
    if (!chatInput) {
      return false;
    }

    /*
     * Avoid fighting mobile keyboard/navigation if the
     * document is no longer active.
     */

    if (
      document.visibilityState ===
      "hidden"
    ) {
      return false;
    }

    requestAnimationFrame(
      () => {
        if (
          !chatInput.isConnected
        ) {
          return;
        }

        try {
          chatInput.focus({
            preventScroll: true
          });

        } catch {
          chatInput.focus();
        }
      }
    );

    return true;
  }

  /* =====================================================
     CANONICAL REQUEST

     Never mutate chat state directly here.
     NeyoChat owns the reset.
     ===================================================== */

  function requestNewChat(
    reason = "user"
  ) {
    const now =
      Date.now();

    if (
      state.requesting &&
      now -
        state.lastRequestedAt <
        CONFIG.duplicateWindowMs
    ) {
      return false;
    }

    /*
     * Additional double-click protection.
     */

    if (
      now -
        state.lastRequestedAt <
      CONFIG.duplicateWindowMs
    ) {
      return false;
    }

    state.requesting =
      true;

    state.lastRequestedAt =
      now;

    state.requestCount +=
      1;

    emit(
      "neyo:new-chat-requested",
      {
        reason,

        requestCount:
          state.requestCount
      }
    );

    /*
     * CustomEvent is synchronous.
     * chat.js listens to this and immediately calls its
     * canonical newConversation().
     */

    emit(
      "neyo:chat-new-request",
      {
        reason
      }
    );

    /*
     * If no chat controller exists, don't pretend New Chat
     * succeeded.
     */

    if (!chatController()) {
      state.requesting =
        false;

      emit(
        "neyo:new-chat-error",
        {
          reason:
            "chat-controller-unavailable"
        }
      );

      return false;
    }

    return true;
  }

  /* =====================================================
     CANONICAL CLEANUP

     This runs ONLY after NeyoChat emitted neyo:chat-new.

     At this point:
     - generation has been invalidated/stopped
     - canonical conversation is empty
     - canonical conversationId is null
     - message clear event has been emitted

     Now UI draft state may safely reset.
     ===================================================== */

  function completeNewChat(
    eventDetail = {}
  ) {
    if (state.cleaning) {
      return false;
    }

    state.cleaning =
      true;

    try {
      clearComposerText();

      clearAttachments();

      resetHistoryActive();

      clearDraftState();

      resetTransientDraftState();

      closeTransientUI();

      refreshSendState();

      state.requesting =
        false;

      state.lastCompletedAt =
        Date.now();

      state.completionCount +=
        1;

      emit(
        "neyo:new-chat-complete",
        {
          reason:
            eventDetail.reason ||
            "canonical-reset",

          completionCount:
            state.completionCount
        }
      );

      focusComposer();

      return true;

    } finally {
      state.cleaning =
        false;
    }
  }

  /* =====================================================
     FALLBACK BUTTON OWNER

     chat-runtime.js currently captures #newChatBtn while
     active because legacy neo.js is still present.

     We register a fallback listener, but immediately ignore
     the event whenever runtime owns the button.
     ===================================================== */

  if (newChatBtn) {
    newChatBtn.addEventListener(
      "click",
      event => {
        if (
          runtimeOwnsButton()
        ) {
          return;
        }

        event.preventDefault();

        event.stopPropagation();

        event.stopImmediatePropagation();

        requestNewChat(
          "new-chat-button"
        );
      },
      true
    );
  }

  /* =====================================================
     CANONICAL CHAT NEW
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    event => {
      completeNewChat(
        event.detail || {}
      );
    }
  );

  /* =====================================================
     EXTERNAL NEW CHAT REQUEST

     Other future UI may request a fresh chat without
     needing direct access to NeyoChat.
     ===================================================== */

  window.addEventListener(
    "neyo:new-chat-request",
    event => {
      requestNewChat(
        event.detail?.reason ||
        "external"
      );
    }
  );

  /* =====================================================
     ACTIVE CONVERSATION DELETED — FALLBACK ONLY

     chat-runtime.js already owns recovery while active.
     Avoid duplicate neyo:chat-new-request events.
     ===================================================== */

  function recoverDeletedConversation(
    event
  ) {
    if (
      runtimeOwnsButton()
    ) {
      return;
    }

    const deletedId =
      String(
        event.detail
          ?.conversationId ||
        event.detail?.id ||
        ""
      ).trim();

    let currentId = "";

    try {
      currentId =
        String(
          chatController()
            ?.getConversationId
            ?.() ||
          ""
        ).trim();

    } catch {}

    /*
     * If both IDs exist and are different, deletion was for
     * another history row.
     */

    if (
      deletedId &&
      currentId &&
      deletedId !==
        currentId
    ) {
      return;
    }

    /*
     * If current canonical chat already has no conversation,
     * another owner already recovered it.
     */

    if (!currentId) {
      return;
    }

    requestNewChat(
      "active-conversation-deleted"
    );
  }

  window.addEventListener(
    "neyo:active-conversation-deleted",
    recoverDeletedConversation
  );

  window.addEventListener(
    "neyo:history-active-conversation-deleted",
    recoverDeletedConversation
  );

  /* =====================================================
     HISTORY OPEN

     A history conversation becoming active is NOT a new
     chat. We only ensure stale request flag cannot remain.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state-loaded",
    () => {
      state.requesting =
        false;
    }
  );

  /* =====================================================
     FAILURE SAFETY

     If something reports an error before canonical
     neyo:chat-new happened, release local request lock.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-runtime-error",
    event => {
      if (
        state.requesting &&
        event.detail?.action ===
          "new-chat"
      ) {
        state.requesting =
          false;
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

      request:
        requestNewChat,

      newChat:
        requestNewChat,

      reset:
        requestNewChat,

      complete:
        completeNewChat,

      focus:
        focusComposer,

      runtimeOwnsButton,

      isRequesting() {
        return state.requesting;
      },

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          requesting:
            state.requesting,

          cleaning:
            state.cleaning,

          runtimeOwnsButton:
            runtimeOwnsButton(),

          requestCount:
            state.requestCount,

          completionCount:
            state.completionCount,

          lastRequestedAt:
            state.lastRequestedAt,

          lastCompletedAt:
            state.lastCompletedAt
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
        runtimeOwnsButton(),

      canonicalOwner:
        "NeyoChat"
    }
  );
})();
