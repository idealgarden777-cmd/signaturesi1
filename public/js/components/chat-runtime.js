/*
=========================================================
NEO — CHAT RUNTIME
Production v4 — Thin Migration Bridge

Purpose:
Keep old neo.js physically loaded during migration while
the modular chat stack becomes authoritative.

Canonical pipeline:
NeyoSendState
    ↓
neyo:chat-send-request
    ↓
NeyoChat
    ↓
/api/chat
    ↓
NeyoMessages
    ↓
NeyoMessageRenderer

Owns:
- Modular chat runtime activation
- Dependency readiness
- Legacy New Chat interception
- Starter-prompt routing
- Compatibility send / stop facade
- Active-conversation-deleted recovery
- Runtime health state

Does NOT own:
- #sendBtn
- Enter / Shift+Enter
- Send / Stop visual state
- /api/chat
- Conversation state
- Message DOM
- Markdown
- Attachment upload
- Attachment cleanup after send
- Composer clearing
- History persistence
- Topbar / model picker

Important:
NeyoSendState is the ONLY Send / Stop UI owner.
NeyoChat is the ONLY conversation / network owner.
New-chat draft cleanup belongs to new-chat.js.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-chat-runtime-production-v4";

  if (
    window.NeyoChatRuntime
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      dependencyWaitMs:
        8000,

      dependencyPollMs:
        50,

      duplicatePromptWindowMs:
        180
    });

  const REQUIRED =
    Object.freeze([
      "NeyoAttachments",
      "NeyoChat",
      "NeyoMessages",
      "NeyoMessageRenderer",
      "NeyoSendState"
    ]);

  /* =====================================================
     DOM
     ===================================================== */

  const chatInput =
    document.getElementById(
      "chatInput"
    );

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    active: false,

    ready: false,

    activating: false,

    failed: false,

    reason: null,

    startedAt:
      Date.now(),

    activatedAt: null,

    routedNewChats: 0,

    routedPrompts: 0,

    compatibilitySends: 0,

    compatibilityStops: 0,

    lastPromptAt: 0,

    lastPromptText: ""
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
     ELEMENT HELPERS
     ===================================================== */

  function isElement(value) {
    return (
      value instanceof
      Element
    );
  }

  function closest(
    target,
    selector
  ) {
    if (!isElement(target)) {
      return null;
    }

    try {
      return target.closest(
        selector
      );
    } catch {
      return null;
    }
  }

  function consumeLegacyEvent(
    event
  ) {
    event.preventDefault();

    event.stopPropagation();

    event.stopImmediatePropagation();
  }

  /* =====================================================
     DEPENDENCY CHECK
     ===================================================== */

  function getMissingModules() {
    return REQUIRED.filter(
      name => {
        const controller =
          window[name];

        return !(
          controller &&
          typeof controller ===
            "object" &&
          controller.__controller ===
            true
        );
      }
    );
  }

  function dependenciesReady() {
    return (
      getMissingModules()
        .length === 0
    );
  }

  /* =====================================================
     OWNER HELPERS
     ===================================================== */

  function sendOwner() {
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

  function chatOwner() {
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
     SEND COMPATIBILITY

     Runtime does NOT inspect composer files or text.
     NeyoSendState remains authoritative.
     ===================================================== */

  function requestSend() {
    if (!state.active) {
      return false;
    }

    const owner =
      sendOwner();

    if (!owner) {
      return false;
    }

    let result = false;

    try {
      if (
        typeof owner.requestSend ===
        "function"
      ) {
        result =
          owner.requestSend();

      } else if (
        typeof owner.send ===
        "function"
      ) {
        result =
          owner.send();
      }
    } catch (error) {
      console.error(
        "[NEO Runtime] Send delegation failed:",
        error
      );

      emit(
        "neyo:chat-runtime-error",
        {
          action:
            "send",

          error
        }
      );

      return false;
    }

    if (result !== false) {
      state.compatibilitySends +=
        1;

      return true;
    }

    return false;
  }

  /* =====================================================
     STOP COMPATIBILITY
     ===================================================== */

  function requestStop() {
    if (!state.active) {
      return false;
    }

    const owner =
      sendOwner();

    if (!owner) {
      return false;
    }

    let result = false;

    try {
      if (
        typeof owner.requestStop ===
        "function"
      ) {
        result =
          owner.requestStop();

      } else if (
        typeof owner.stop ===
        "function"
      ) {
        result =
          owner.stop();
      }
    } catch (error) {
      console.error(
        "[NEO Runtime] Stop delegation failed:",
        error
      );

      emit(
        "neyo:chat-runtime-error",
        {
          action:
            "stop",

          error
        }
      );

      return false;
    }

    if (result !== false) {
      state.compatibilityStops +=
        1;

      return true;
    }

    return false;
  }

  /* =====================================================
     NEW CHAT

     Runtime only intercepts legacy button ownership.

     Actual state reset:
     NeyoChat

     Draft/attachments/hero/focus cleanup:
     new-chat.js after canonical neyo:chat-new.
     ===================================================== */

  function requestNewChat(
    reason =
      "runtime"
  ) {
    if (!state.active) {
      return false;
    }

    emit(
      "neyo:chat-new-request",
      {
        reason
      }
    );

    state.routedNewChats +=
      1;

    return true;
  }

  /* =====================================================
     STARTER PROMPT
     ===================================================== */

  function requestStarterPrompt(
    prompt
  ) {
    if (!state.active) {
      return false;
    }

    const value =
      String(
        prompt || ""
      )
        .replace(
          /\u0000/g,
          ""
        )
        .trim();

    if (!value) {
      return false;
    }

    const now =
      Date.now();

    /*
     * Prevent duplicate prompt dispatch where nested prompt
     * elements or old handlers trigger nearly together.
     */

    if (
      value ===
        state.lastPromptText &&
      now -
        state.lastPromptAt <
        CONFIG
          .duplicatePromptWindowMs
    ) {
      return false;
    }

    state.lastPromptText =
      value;

    state.lastPromptAt =
      now;

    if (!chatInput) {
      emit(
        "neyo:chat-runtime-error",
        {
          action:
            "starter-prompt",

          reason:
            "composer-input-missing"
        }
      );

      return false;
    }

    /*
     * Preserve old starter-card behavior:
     * prompt appears in composer first, so composer sizing,
     * hero state and any input listeners stay synchronized.
     */

    chatInput.value =
      value;

    chatInput.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );

    const sent =
      requestSend();

    if (sent) {
      state.routedPrompts +=
        1;
    }

    return sent;
  }

  /* =====================================================
     DOCUMENT CLICK — CAPTURE

     IMPORTANT:
     Send button is NOT intercepted here anymore.
     NeyoSendState already owns #sendBtn in capture phase.

     We intercept only legacy actions still owned by neo.js:
     - New Chat
     - Starter prompt cards
     ===================================================== */

  document.addEventListener(
    "click",
    event => {
      if (!state.active) {
        return;
      }

      /* -----------------------------------------------
         NEW CHAT
         ----------------------------------------------- */

      const newChatButton =
        closest(
          event.target,
          "#newChatBtn"
        );

      if (newChatButton) {
        consumeLegacyEvent(
          event
        );

        requestNewChat(
          "new-chat-button"
        );

        return;
      }

      /* -----------------------------------------------
         STARTER PROMPT
         ----------------------------------------------- */

      const promptButton =
        closest(
          event.target,
          "[data-prompt]"
        );

      if (!promptButton) {
        return;
      }

      const prompt =
        String(
          promptButton.dataset
            ?.prompt ||
          ""
        ).trim();

      if (!prompt) {
        return;
      }

      consumeLegacyEvent(
        event
      );

      requestStarterPrompt(
        prompt
      );
    },
    true
  );

  /* =====================================================
     ACTIVE CONVERSATION DELETED

     Old working NEO returned to a clean conversation if the
     currently open history item was deleted.

     History owns deletion.
     Runtime only requests canonical New Chat recovery.
     ===================================================== */

  window.addEventListener(
    "neyo:history-deleted",
    event => {
      if (!state.active) {
        return;
      }

      const deletedId =
        String(
          event.detail
            ?.conversationId ||
          ""
        ).trim();

      if (!deletedId) {
        return;
      }

      const currentId =
        String(
          chatOwner()
            ?.getConversationId
            ?.() ||
          ""
        ).trim();

      if (
        !currentId ||
        currentId !==
          deletedId
      ) {
        return;
      }

      requestNewChat(
        "active-conversation-deleted"
      );
    }
  );

  /*
   * Compatibility alias during migration.
   */

  window.addEventListener(
    "neyo:history-active-conversation-deleted",
    event => {
      if (!state.active) {
        return;
      }

      const deletedId =
        String(
          event.detail
            ?.conversationId ||
          event.detail?.id ||
          ""
        ).trim();

      const currentId =
        String(
          chatOwner()
            ?.getConversationId
            ?.() ||
          ""
        ).trim();

      if (
        deletedId &&
        currentId &&
        deletedId !==
          currentId
      ) {
        return;
      }

      requestNewChat(
        "active-conversation-deleted"
      );
    }
  );

  /* =====================================================
     RUNTIME STATE REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:chat-runtime-state-request",
    () => {
      emitRuntimeState();
    }
  );

  /* =====================================================
     HEALTH
     ===================================================== */

  function getHealth() {
    const missing =
      getMissingModules();

    return {
      healthy:
        state.active &&
        missing.length === 0,

      active:
        state.active,

      ready:
        state.ready,

      failed:
        state.failed,

      missing,

      sendOwner:
        Boolean(
          sendOwner()
        ),

      chatOwner:
        Boolean(
          chatOwner()
        )
    };
  }

  function emitRuntimeState() {
    emit(
      "neyo:chat-runtime-state",
      {
        version:
          VERSION,

        ...getHealth(),

        reason:
          state.reason,

        startedAt:
          state.startedAt,

        activatedAt:
          state.activatedAt,

        routedNewChats:
          state.routedNewChats,

        routedPrompts:
          state.routedPrompts,

        compatibilitySends:
          state.compatibilitySends,

        compatibilityStops:
          state.compatibilityStops
      }
    );
  }

  /* =====================================================
     ACTIVATE
     ===================================================== */

  function activate() {
    if (state.active) {
      return true;
    }

    if (!dependenciesReady()) {
      return false;
    }

    state.active = true;

    state.ready = true;

    state.failed = false;

    state.activating =
      false;

    state.reason =
      "dependencies-ready";

    state.activatedAt =
      Date.now();

    emit(
      "neyo:chat-runtime-ready",
      {
        version:
          VERSION,

        active: true,

        dependencies:
          REQUIRED.slice(),

        sendOwner:
          "NeyoSendState",

        chatOwner:
          "NeyoChat"
      }
    );

    emitRuntimeState();

    return true;
  }

  /* =====================================================
     WAIT FOR DEPENDENCIES

     HTML remains unchanged until final app stage, so runtime
     must tolerate current script ordering.
     ===================================================== */

  function waitForDependencies() {
    if (
      state.active ||
      state.activating
    ) {
      return;
    }

    state.activating =
      true;

    const started =
      Date.now();

    function check() {
      if (activate()) {
        return;
      }

      const elapsed =
        Date.now() -
        started;

      if (
        elapsed >=
        CONFIG.dependencyWaitMs
      ) {
        state.activating =
          false;

        state.failed =
          true;

        state.ready =
          false;

        state.reason =
          "dependency-timeout";

        const missing =
          getMissingModules();

        console.warn(
          "[NEO Runtime] Dependencies unavailable:",
          missing
        );

        emit(
          "neyo:chat-runtime-error",
          {
            version:
              VERSION,

            reason:
              "dependency-timeout",

            missing
          }
        );

        emitRuntimeState();

        return;
      }

      window.setTimeout(
        check,
        CONFIG.dependencyPollMs
      );
    }

    check();
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

      get active() {
        return state.active;
      },

      get ready() {
        return state.ready;
      },

      activate,

      send:
        requestSend,

      requestSend,

      stop:
        requestStop,

      requestStop,

      newChat:
        requestNewChat,

      requestNewChat,

      starterPrompt:
        requestStarterPrompt,

      requestStarterPrompt,

      isActive() {
        return state.active;
      },

      isReady() {
        return state.ready;
      },

      getHealth,

      getMissingModules,

      getState() {
        return {
          version:
            VERSION,

          active:
            state.active,

          ready:
            state.ready,

          activating:
            state.activating,

          failed:
            state.failed,

          reason:
            state.reason,

          startedAt:
            state.startedAt,

          activatedAt:
            state.activatedAt,

          routedNewChats:
            state.routedNewChats,

          routedPrompts:
            state.routedPrompts,

          compatibilitySends:
            state.compatibilitySends,

          compatibilityStops:
            state.compatibilityStops,

          missing:
            getMissingModules()
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoChatRuntime",
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

  waitForDependencies();
})();
