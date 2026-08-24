/*
=========================================================
NEO — CHAT RUNTIME
Production v1

Purpose:
Temporary compatibility bridge while legacy neo.js is
still loaded.

Owns:
- modular chat runtime activation
- dependency health check
- legacy New Chat interception
- legacy starter-prompt interception
- active-conversation-delete → new chat bridge
- runtime diagnostics

Does NOT own:
- #sendBtn
- Enter / Shift+Enter
- Send / Stop visual state
- /api/chat
- conversation state
- attachment upload
- message DOM
- markdown rendering
- history persistence

Canonical flow:
send-state.js
    ↓
neyo:chat-send-request
    ↓
chat.js
    ↓
messages.js
    ↓
message-renderer.js
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-chat-runtime-production-v1";

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
      dependencyWaitMs: 6000,
      dependencyPollMs: 50
    });

  const REQUIRED = [
    "NeyoAttachments",
    "NeyoChat",
    "NeyoMessages",
    "NeyoMessageRenderer",
    "NeyoSendState"
  ];

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

    reason: null,

    startedAt:
      Date.now(),

    activatedAt:
      null,

    routedNewChats:
      0,

    routedPrompts:
      0,

    routedDeletes:
      0,

    blockedLegacyActions:
      0
  };

  const legacyScriptPresent =
    Array.from(
      document.scripts || []
    ).some(
      script =>
        /(?:^|\/)neo\.js(?:\?|$)/
          .test(
            script.src || ""
          )
    );

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
        { detail }
      )
    );
  }

  /* =====================================================
     MODULE VALIDATION
     ===================================================== */

  function getMissingModules() {
    return REQUIRED.filter(
      name =>
        !window[name]
    );
  }

  function validateModules() {
    const missing =
      getMissingModules();

    if (missing.length) {
      return {
        valid: false,

        reason:
          `Missing modules: ${missing.join(", ")}`,

        missing
      };
    }

    if (
      typeof window.NeyoChat
        ?.send !==
      "function"
    ) {
      return {
        valid: false,
        reason:
          "NeyoChat.send() is unavailable.",
        missing: []
      };
    }

    if (
      typeof window.NeyoChat
        ?.stop !==
      "function"
    ) {
      return {
        valid: false,
        reason:
          "NeyoChat.stop() is unavailable.",
        missing: []
      };
    }

    if (
      typeof window.NeyoSendState
        ?.requestSend !==
        "function" &&
      typeof window.NeyoSendState
        ?.send !==
        "function"
    ) {
      return {
        valid: false,
        reason:
          "NeyoSendState send API is unavailable.",
        missing: []
      };
    }

    if (
      typeof window.NeyoAttachments
        ?.getReady !==
      "function"
    ) {
      return {
        valid: false,
        reason:
          "NeyoAttachments.getReady() is unavailable.",
        missing: []
      };
    }

    /*
     * NeyoMessages is event-driven.
     * Do NOT require a fake replace() API.
     */

    if (!window.NeyoMessages) {
      return {
        valid: false,
        reason:
          "NeyoMessages is unavailable.",
        missing: []
      };
    }

    if (
      typeof window
        .NeyoMessageRenderer
        ?.render !==
        "function" &&
      typeof window
        .NeyoMessageRenderer
        ?.renderInto !==
        "function"
    ) {
      return {
        valid: false,
        reason:
          "NeyoMessageRenderer API is unavailable.",
        missing: []
      };
    }

    return {
      valid: true,
      reason: null,
      missing: []
    };
  }

  /* =====================================================
     WAIT FOR LOAD ORDER
     ===================================================== */

  function waitForDependencies() {
    return new Promise(
      resolve => {
        const started =
          Date.now();

        const check =
          () => {
            const result =
              validateModules();

            if (
              result.valid ||
              Date.now() -
                started >=
                CONFIG.dependencyWaitMs
            ) {
              resolve(result);
              return;
            }

            window.setTimeout(
              check,
              CONFIG.dependencyPollMs
            );
          };

        check();
      }
    );
  }

  /* =====================================================
     ROOT RUNTIME MARKER
     ===================================================== */

  function setRuntimeMarker(
    value
  ) {
    const root =
      document.documentElement;

    if (value) {
      root.setAttribute(
        "data-neyo-chat-runtime",
        "production-v1"
      );

      root.classList.add(
        "neyo-chat-v2"
      );

      return;
    }

    root.removeAttribute(
      "data-neyo-chat-runtime"
    );

    root.classList.remove(
      "neyo-chat-v2"
    );
  }

  /* =====================================================
     ACTIVATE
     ===================================================== */

  async function activate() {
    if (state.active) {
      return true;
    }

    if (state.activating) {
      return false;
    }

    state.activating =
      true;

    try {
      const result =
        await waitForDependencies();

      if (!result.valid) {
        state.active =
          false;

        state.ready =
          false;

        state.reason =
          result.reason;

        setRuntimeMarker(
          false
        );

        emit(
          "neyo:runtime-error",
          {
            version:
              VERSION,

            reason:
              result.reason,

            missingModules:
              result.missing
          }
        );

        console.error(
          "[NEO Runtime]",
          result.reason
        );

        return false;
      }

      state.active =
        true;

      state.ready =
        true;

      state.reason =
        null;

      state.activatedAt =
        Date.now();

      setRuntimeMarker(
        true
      );

      /*
       * Ask chat.js for authoritative state.
       */

      emit(
        "neyo:chat-state-sync-request"
      );

      /*
       * Ask send-state to sync button state.
       */

      try {
        window.NeyoSendState
          ?.update
          ?.();
      } catch {}

      emit(
        "neyo:runtime-ready",
        {
          version:
            VERSION,

          active:
            true,

          mode:
            legacyScriptPresent
              ? "hybrid"
              : "modular",

          legacyScriptPresent
        }
      );

      return true;

    } catch (error) {
      state.active =
        false;

      state.ready =
        false;

      state.reason =
        error?.message ||
        "Runtime activation failed.";

      setRuntimeMarker(
        false
      );

      emit(
        "neyo:runtime-error",
        {
          version:
            VERSION,

          reason:
            state.reason,

          error
        }
      );

      console.error(
        "[NEO Runtime] Activation failed:",
        error
      );

      return false;

    } finally {
      state.activating =
        false;
    }
  }

  /* =====================================================
     DEACTIVATE
     ===================================================== */

  function deactivate(
    reason =
      "Runtime disabled."
  ) {
    state.active =
      false;

    state.ready =
      false;

    state.reason =
      reason;

    setRuntimeMarker(
      false
    );

    emit(
      "neyo:runtime-disabled",
      {
        version:
          VERSION,

        reason
      }
    );

    return true;
  }

  /* =====================================================
     SEND DELEGATION

     Public compatibility only.

     Runtime itself does NOT read composer/files.
     ===================================================== */

  function requestSend() {
    if (!state.active) {
      return false;
    }

    try {
      const sendState =
        window.NeyoSendState;

      if (
        typeof sendState
          ?.requestSend ===
        "function"
      ) {
        return Boolean(
          sendState.requestSend()
        );
      }

      if (
        typeof sendState
          ?.send ===
        "function"
      ) {
        return Boolean(
          sendState.send()
        );
      }

    } catch (error) {
      emit(
        "neyo:runtime-error",
        {
          reason:
            "Send routing failed.",

          error
        }
      );
    }

    return false;
  }

  /* =====================================================
     STOP DELEGATION
     ===================================================== */

  function requestStop(
    reason =
      "chat-runtime"
  ) {
    if (!state.active) {
      return false;
    }

    try {
      return Boolean(
        window.NeyoSendState
          ?.stop
          ?.(reason)
      );

    } catch (error) {
      emit(
        "neyo:runtime-error",
        {
          reason:
            "Stop routing failed.",

          error
        }
      );

      return false;
    }
  }

  /* =====================================================
     LEGACY EVENT BLOCKER

     Used ONLY for actions that this runtime still bridges.

     Send button and Enter are NOT intercepted here because
     send-state.js already owns them in capture phase.
     ===================================================== */

  function consumeLegacyEvent(
    event
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    state.blockedLegacyActions +=
      1;
  }

  /* =====================================================
     NEW CHAT
     ===================================================== */

  function requestNewChat(
    source =
      "chat-runtime"
  ) {
    if (!state.active) {
      return false;
    }

    emit(
      "neyo:chat-new-request",
      {
        source
      }
    );

    state.routedNewChats +=
      1;

    return true;
  }

  /* =====================================================
     STARTER PROMPT

     Preserve the working production behavior:
     click suggestion → place prompt in composer → send
     through the SAME SendState pipeline.
     ===================================================== */

  function runStarterPrompt(
    button
  ) {
    if (
      !state.active ||
      !chatInput ||
      !(button instanceof Element)
    ) {
      return false;
    }

    const prompt =
      String(
        button.dataset
          ?.prompt ||
        ""
      ).trim();

    if (!prompt) {
      return false;
    }

    chatInput.value =
      prompt;

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

    const sent =
      requestSend();

    if (sent) {
      state.routedPrompts +=
        1;
    }

    return sent;
  }

  /* =====================================================
     LEGACY CLICK BRIDGE

     IMPORTANT:
     #sendBtn is deliberately NOT here.
     ===================================================== */

  document.addEventListener(
    "click",
    event => {
      if (!state.active) {
        return;
      }

      const target =
        event.target instanceof Element
          ? event.target
          : null;

      if (!target) {
        return;
      }

      /* -----------------------------------------------
         NEW CHAT
         ----------------------------------------------- */

      const newChatBtn =
        target.closest(
          "#newChatBtn"
        );

      if (newChatBtn) {
        consumeLegacyEvent(
          event
        );

        requestNewChat(
          "new-chat-button"
        );

        return;
      }

      /* -----------------------------------------------
         STARTER / HERO PROMPT
         ----------------------------------------------- */

      const promptButton =
        target.closest(
          "[data-prompt]"
        );

      if (promptButton) {
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

        runStarterPrompt(
          promptButton
        );
      }
    },
    true
  );

  /* =====================================================
     ACTIVE CONVERSATION DELETED

     history.js may emit this when the currently-open chat
     is deleted.

     Runtime converts that state into a normal New Chat
     request rather than directly mutating chat.js.
     ===================================================== */

  window.addEventListener(
    "neyo:active-conversation-deleted",
    () => {
      if (!state.active) {
        return;
      }

      state.routedDeletes +=
        1;

      requestNewChat(
        "active-conversation-deleted"
      );
    }
  );

  /* =====================================================
     NEW CHAT COMPLETION CLEANUP

     chat.js owns conversation reset.

     Runtime only cleans composer attachments that belong
     to the previous draft/chat.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      try {
        window.NeyoAttachments
          ?.clear
          ?.();
      } catch {}

      try {
        window.NeyoSendState
          ?.setGenerating
          ?.(false);
      } catch {}
    }
  );

  /* =====================================================
     HISTORY LOAD

     Ensure stale draft attachments are not carried into
     a different existing conversation.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state-loaded",
    () => {
      try {
        window.NeyoAttachments
          ?.clear
          ?.();
      } catch {}

      try {
        window.NeyoSendState
          ?.setGenerating
          ?.(false);
      } catch {}
    }
  );

  /* =====================================================
     CHAT LIFECYCLE SYNC

     Runtime observes only.
     It does not mutate chat generation itself.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {
      /*
       * send-state already handles its own generation UI.
       * Runtime keeps no duplicate generation state.
       */
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

      activate,

      deactivate,

      send:
        requestSend,

      stop:
        requestStop,

      newChat:
        requestNewChat,

      check:
        validateModules,

      isActive() {
        return state.active;
      },

      isReady() {
        return state.ready;
      },

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

          reason:
            state.reason,

          mode:
            legacyScriptPresent
              ? "hybrid"
              : "modular",

          legacyScriptPresent,

          missingModules:
            getMissingModules(),

          sendStateActive:
            window.NeyoSendState
              ?.active ===
            true,

          chatReady:
            window.NeyoChat
              ?.__controller ===
            true,

          attachmentCount:
            window.NeyoAttachments
              ?.getCount
              ?.() || 0,

          routedNewChats:
            state.routedNewChats,

          routedPrompts:
            state.routedPrompts,

          routedDeletes:
            state.routedDeletes,

          blockedLegacyActions:
            state.blockedLegacyActions,

          startedAt:
            state.startedAt,

          activatedAt:
            state.activatedAt,

          uptimeMs:
            Date.now() -
            state.startedAt
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
     BOOT
     ===================================================== */

  void activate();
})();
