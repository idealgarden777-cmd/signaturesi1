/*
=========================================================
NEYO — CHAT RUNTIME
FINAL PRODUCTION MIXER v5

FILE:
public/js/components/chat-runtime.js

PURPOSE
---------------------------------------------------------
Application-level routing and migration safety layer.

This file keeps modular NEYO authoritative while legacy
neo.js is still physically loaded, and continues working
unchanged after neo.js is removed.

OWNS
---------------------------------------------------------
- Runtime activation / health
- Core dependency readiness
- New-chat UI routing
- Starter-prompt UI routing
- Composer form-submit routing
- Legacy event interception for the UI actions above
- Runtime diagnostics / state sync request
- Compatibility bridges only

DOES NOT OWN
---------------------------------------------------------
- Send / Stop business rules
- Send button visual state
- Enter / Shift+Enter behavior
- Composer text cleanup
- Sent attachment cleanup
- Attachment upload / processing
- /api/chat
- Conversation state
- Message DOM
- Markdown
- History persistence / rendering
- Voice
- Settings

AUTHORITATIVE PIPELINE
---------------------------------------------------------

User send
   ↓
send-state.js
   ↓
neyo:chat-send-request
   ↓
chat.js
   ↓
neyo:chat-message-added
   ↓
messages.js
   ↓
message-renderer.js

Attachments
   ↓
attachments.js
   ↓
send-state.js
   ↓
chat.js

New chat
   ↓
chat-runtime.js
   ↓
neyo:chat-new-request
   ↓
chat.js

Starter prompt
   ↓
chat-runtime.js
   ↓
composer input
   ↓
NeyoSendState.send()
   ↓
canonical chat pipeline

MIGRATION RULE
---------------------------------------------------------
neo.js presence is informational only.

Runtime capture listeners block only legacy actions this
module explicitly owns. It never disables modular code
because neo.js exists.

After neo.js is removed this file requires no migration
rewrite.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-chat-runtime-final-v5";

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
        10_000,

      dependencyPollMs:
        50,

      duplicateActionWindowMs:
        220,

      starterPromptMaxLength:
        50_000
    });

  /* =====================================================
     LEGACY TELEMETRY

     neo.js does NOT affect activation.
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
     DEPENDENCIES

     Only modules actually required for routing are
     CRITICAL.

     Supporting modules are reported in health checks but
     do not stop runtime activation.
     ===================================================== */

  const CRITICAL_MODULES =
    Object.freeze([
      "NeyoChat",
      "NeyoSendState"
    ]);

  const SUPPORTING_MODULES =
    Object.freeze([
      "NeyoAttachments",
      "NeyoMessages",
      "NeyoMessageRenderer",
      "NeyoHistory"
    ]);

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    active:
      false,

    ready:
      false,

    activating:
      false,

    destroyed:
      false,

    reason:
      null,

    startedAt:
      Date.now(),

    activatedAt:
      null,

    lastHealthAt:
      null,

    lastActionAt:
      0,

    lastActionKey:
      "",

    lastNewChatAt:
      0,

    lastPromptAt:
      0,

    routedNewChats:
      0,

    routedPrompts:
      0,

    routedFormSubmits:
      0,

    blockedLegacyActions:
      0
  };

  let activationPromise =
    null;

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
     BASIC HELPERS
     ===================================================== */

  function isElement(
    value
  ) {
    return (
      value instanceof
      Element
    );
  }

  function closest(
    target,
    selector
  ) {
    if (
      !isElement(target)
    ) {
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

  function normalizeText(
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
      .trim()
      .slice(
        0,
        CONFIG
          .starterPromptMaxLength
      );
  }

  function now() {
    return (
      typeof performance !==
        "undefined" &&
      typeof performance.now ===
        "function"

        ? performance.now()

        : Date.now()
    );
  }

  /* =====================================================
     DOM
     ===================================================== */

  function getChatInput() {
    return document
      .getElementById(
        "chatInput"
      );
  }

  function getSendButton() {
    return document
      .getElementById(
        "sendBtn"
      );
  }

  function getNewChatButton() {
    return (
      document
        .getElementById(
          "newChatBtn"
        ) ||
      document.querySelector(
        '[data-neyo-action="new-chat"]'
      )
    );
  }

  /* =====================================================
     MODULE LOOKUP
     ===================================================== */

  function getModule(
    name
  ) {
    try {
      return window[name] ||
        null;

    } catch {
      return null;
    }
  }

  function missingModules(
    names
  ) {
    return names.filter(
      name =>
        !getModule(name)
    );
  }

  /* =====================================================
     HEALTH VALIDATION
     ===================================================== */

  function validateCriticalModules() {
    const missing =
      missingModules(
        CRITICAL_MODULES
      );

    if (
      missing.length
    ) {
      return {
        valid:
          false,

        reason:
          `Missing critical modules: ${missing.join(", ")}`,

        missing
      };
    }

    const chat =
      getModule(
        "NeyoChat"
      );

    const sendState =
      getModule(
        "NeyoSendState"
      );

    if (
      typeof chat?.send !==
      "function"
    ) {
      return {
        valid:
          false,

        reason:
          "NeyoChat.send() is unavailable.",

        missing:
          []
      };
    }

    if (
      typeof chat?.stop !==
      "function"
    ) {
      return {
        valid:
          false,

        reason:
          "NeyoChat.stop() is unavailable.",

        missing:
          []
      };
    }

    if (
      typeof sendState?.send !==
      "function"
    ) {
      return {
        valid:
          false,

        reason:
          "NeyoSendState.send() is unavailable.",

        missing:
          []
      };
    }

    if (
      typeof sendState?.stop !==
      "function"
    ) {
      return {
        valid:
          false,

        reason:
          "NeyoSendState.stop() is unavailable.",

        missing:
          []
      };
    }

    return {
      valid:
        true,

      reason:
        null,

      missing:
        []
    };
  }

  /* =====================================================
     SUPPORTING HEALTH
     ===================================================== */

  function getSupportingHealth() {
    const missing =
      missingModules(
        SUPPORTING_MODULES
      );

    return {
      healthy:
        missing.length ===
        0,

      missing
    };
  }

  /* =====================================================
     FULL HEALTH
     ===================================================== */

  function checkHealth() {
    const critical =
      validateCriticalModules();

    const supporting =
      getSupportingHealth();

    state.lastHealthAt =
      Date.now();

    return {
      version:
        VERSION,

      active:
        state.active,

      ready:
        state.ready,

      legacyScriptPresent,

      critical,

      supporting,

      dom: {
        chatInput:
          Boolean(
            getChatInput()
          ),

        sendBtn:
          Boolean(
            getSendButton()
          ),

        newChatBtn:
          Boolean(
            getNewChatButton()
          )
      }
    };
  }

  /* =====================================================
     WAIT FOR CRITICAL MODULES
     ===================================================== */

  function waitForDependencies() {
    return new Promise(
      resolve => {
        const started =
          Date.now();

        const check =
          () => {
            if (
              state.destroyed
            ) {
              resolve({
                valid:
                  false,

                reason:
                  "Runtime destroyed.",

                missing:
                  []
              });

              return;
            }

            const validation =
              validateCriticalModules();

            if (
              validation.valid
            ) {
              resolve(
                validation
              );

              return;
            }

            if (
              Date.now() -
                started >=
              CONFIG
                .dependencyWaitMs
            ) {
              resolve(
                validation
              );

              return;
            }

            window.setTimeout(
              check,
              CONFIG
                .dependencyPollMs
            );
          };

        check();
      }
    );
  }

  /* =====================================================
     ROOT RUNTIME MARKERS
     ===================================================== */

  function syncRuntimeMarker() {
    const root =
      document.documentElement;

    if (!root) {
      return;
    }

    if (
      state.active
    ) {
      root.setAttribute(
        "data-neyo-chat-runtime",
        "modular"
      );

      root.setAttribute(
        "data-neyo-chat-runtime-version",
        VERSION
      );

      root.classList.add(
        "neyo-chat-runtime-active"
      );

      return;
    }

    root.removeAttribute(
      "data-neyo-chat-runtime"
    );

    root.removeAttribute(
      "data-neyo-chat-runtime-version"
    );

    root.classList.remove(
      "neyo-chat-runtime-active"
    );
  }

  /* =====================================================
     DUPLICATE ACTION GUARD
     ===================================================== */

  function claimAction(
    key
  ) {
    const timestamp =
      now();

    if (
      state.lastActionKey ===
        key &&
      timestamp -
        state.lastActionAt <
      CONFIG
        .duplicateActionWindowMs
    ) {
      return false;
    }

    state.lastActionKey =
      key;

    state.lastActionAt =
      timestamp;

    return true;
  }

  /* =====================================================
     EVENT CONSUMPTION

     Used only for UI actions this runtime owns.

     sendBtn and Enter are intentionally NOT intercepted
     here because send-state.js owns them.
     ===================================================== */

  function consumeLegacyEvent(
    event
  ) {
    try {
      event.preventDefault();
    } catch {}

    try {
      event.stopPropagation();
    } catch {}

    try {
      event
        .stopImmediatePropagation();
    } catch {}

    state.blockedLegacyActions +=
      1;
  }

  /* =====================================================
     CHAT GENERATING
     ===================================================== */

  function chatIsGenerating() {
    try {
      if (
        window.NeyoChat
          ?.isGenerating
          ?.() === true
      ) {
        return true;
      }
    } catch {}

    try {
      if (
        window.NeyoChat
          ?.getState
          ?.()
          ?.generating ===
        true
      ) {
        return true;
      }
    } catch {}

    try {
      return Boolean(
        window.NeyoSendState
          ?.getState
          ?.()
          ?.generating
      );

    } catch {
      return false;
    }
  }

  /* =====================================================
     NEW CHAT ROUTING
     ===================================================== */

  function requestNewChat({
    source =
      "runtime"
  } = {}) {
    if (
      !state.active
    ) {
      return false;
    }

    if (
      !claimAction(
        "new-chat"
      )
    ) {
      return false;
    }

    state.lastNewChatAt =
      Date.now();

    state.routedNewChats +=
      1;

    /*
     * chat.js owns:
     * - invalidating active request
     * - conversation reset
     * - messages clear event
     * - conversation ID reset
     */

    emit(
      "neyo:chat-new-request",
      {
        source
      }
    );

    emit(
      "neyo:runtime-new-chat-routed",
      {
        source
      }
    );

    return true;
  }

  /* =====================================================
     STARTER PROMPT INPUT
     ===================================================== */

  function setComposerPrompt(
    prompt
  ) {
    const input =
      getChatInput();

    if (!input) {
      return false;
    }

    const value =
      normalizeText(
        prompt
      );

    if (!value) {
      return false;
    }

    input.value =
      value;

    input.dispatchEvent(
      new Event(
        "input",
        {
          bubbles:
            true
        }
      )
    );

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
     STARTER PROMPT ROUTING
     ===================================================== */

  function routeStarterPrompt(
    prompt,
    {
      source =
        "starter-prompt"
    } = {}
  ) {
    if (
      !state.active
    ) {
      return false;
    }

    const clean =
      normalizeText(
        prompt
      );

    if (!clean) {
      return false;
    }

    /*
     * Prompt click must never turn into Stop.
     *
     * Existing generation remains untouched.
     */

    if (
      chatIsGenerating()
    ) {
      emit(
        "neyo:chat-busy",
        {
          source,
          attemptedPrompt:
            clean
        }
      );

      return false;
    }

    if (
      !claimAction(
        `prompt:${clean}`
      )
    ) {
      return false;
    }

    if (
      !setComposerPrompt(
        clean
      )
    ) {
      emit(
        "neyo:runtime-error",
        {
          version:
            VERSION,

          reason:
            "Composer input is unavailable.",

          source
        }
      );

      return false;
    }

    const sendState =
      window.NeyoSendState;

    if (
      typeof sendState?.send !==
      "function"
    ) {
      emit(
        "neyo:runtime-error",
        {
          version:
            VERSION,

          reason:
            "NeyoSendState.send() is unavailable.",

          source
        }
      );

      return false;
    }

    const sent =
      Boolean(
        sendState.send({
          source,

          cleanupText:
            true,

          cleanupAttachments:
            true
        })
      );

    if (
      sent
    ) {
      state.lastPromptAt =
        Date.now();

      state.routedPrompts +=
        1;
    }

    emit(
      "neyo:runtime-prompt-routed",
      {
        prompt:
          clean,

        sent,

        source
      }
    );

    return sent;
  }

  /* =====================================================
     FORM SUBMIT ROUTING

     Defensive fallback if composer is ever wrapped in
     a <form>. Business rules remain in send-state.js.
     ===================================================== */

  function routeComposerSubmit(
    event
  ) {
    const target =
      event.target;

    if (
      !(target instanceof
        HTMLFormElement)
    ) {
      return;
    }

    const input =
      target.querySelector(
        "#chatInput"
      );

    if (!input) {
      return;
    }

    consumeLegacyEvent(
      event
    );

    /*
     * Explicit form submit during generation
     * must not become Stop.
     */

    if (
      chatIsGenerating()
    ) {
      return;
    }

    if (
      !claimAction(
        "composer-submit"
      )
    ) {
      return;
    }

    const result =
      window.NeyoSendState
        ?.send
        ?.({
          source:
            "composer-form",

          cleanupText:
            true,

          cleanupAttachments:
            true
        });

    if (
      result
    ) {
      state
        .routedFormSubmits +=
        1;
    }
  }

  /* =====================================================
     CLICK ROUTING — CAPTURE PHASE

     IMPORTANT:
     #sendBtn is NOT handled here.

     send-state.js already captures it before legacy
     target/bubble listeners.
     ===================================================== */

  function handleDocumentClick(
    event
  ) {
    if (
      !state.active
    ) {
      return;
    }

    /* =================================================
       NEW CHAT
       ================================================= */

    const newChatButton =
      closest(
        event.target,
        [
          "#newChatBtn",
          '[data-neyo-action="new-chat"]',
          '[data-action="new-chat"]'
        ].join(",")
      );

    if (
      newChatButton
    ) {
      consumeLegacyEvent(
        event
      );

      requestNewChat({
        source:
          "new-chat-button"
      });

      return;
    }

    /* =================================================
       STARTER PROMPT

       Supports the original [data-prompt] contract and
       a future explicit data-starter-prompt contract.
       ================================================= */

    const promptButton =
      closest(
        event.target,
        [
          "[data-prompt]",
          "[data-starter-prompt]"
        ].join(",")
      );

    if (
      !promptButton
    ) {
      return;
    }

    const prompt =
      normalizeText(
        promptButton
          .dataset
          ?.starterPrompt ||
        promptButton
          .dataset
          ?.prompt ||
        ""
      );

    if (!prompt) {
      return;
    }

    consumeLegacyEvent(
      event
    );

    routeStarterPrompt(
      prompt,
      {
        source:
          "starter-prompt-button"
      }
    );
  }

  /* =====================================================
     ACTIVE CONVERSATION DELETED
     Compatibility bridge only.

     Modern history.js may already emit
     neyo:chat-new-request directly.
     Duplicate action guard prevents double resets.
     ===================================================== */

  function handleActiveConversationDeleted() {
    if (
      !state.active
    ) {
      return;
    }

    requestNewChat({
      source:
        "active-conversation-deleted"
    });
  }

  /* =====================================================
     CHAT STATE SYNC
     ===================================================== */

  function requestStateSync() {
    emit(
      "neyo:chat-state-sync-request",
      {
        source:
          "chat-runtime"
      }
    );

    return true;
  }

  /* =====================================================
     MODULE READY EVENTS

     Runtime may load before chat/send modules.
     These events allow an early failed activation to retry.
     ===================================================== */

  function retryActivation() {
    if (
      state.destroyed ||
      state.active ||
      state.activating
    ) {
      return;
    }

    void activate();
  }

  /* =====================================================
     ACTIVATE
     ===================================================== */

  async function activate() {
    if (
      state.destroyed
    ) {
      return false;
    }

    if (
      state.active
    ) {
      return true;
    }

    if (
      activationPromise
    ) {
      return activationPromise;
    }

    activationPromise =
      (async () => {
        state.activating =
          true;

        state.reason =
          null;

        try {
          const validation =
            await waitForDependencies();

          if (
            !validation.valid
          ) {
            state.active =
              false;

            state.ready =
              false;

            state.reason =
              validation.reason;

            syncRuntimeMarker();

            emit(
              "neyo:runtime-error",
              {
                version:
                  VERSION,

                reason:
                  validation.reason,

                missingModules:
                  validation
                    .missing ||
                  [],

                legacyScriptPresent
              }
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

          syncRuntimeMarker();

          requestStateSync();

          const health =
            checkHealth();

          emit(
            "neyo:runtime-ready",
            {
              version:
                VERSION,

              active:
                true,

              mode:
                legacyScriptPresent
                  ? "modular-with-legacy-loaded"
                  : "fully-modular",

              legacyScriptPresent,

              health
            }
          );

          return true;

        } catch (
          error
        ) {
          state.active =
            false;

          state.ready =
            false;

          state.reason =
            error?.message ||
            "Runtime activation failed.";

          syncRuntimeMarker();

          emit(
            "neyo:runtime-error",
            {
              version:
                VERSION,

              reason:
                state.reason,

              error,

              legacyScriptPresent
            }
          );

          return false;

        } finally {
          state.activating =
            false;

          activationPromise =
            null;
        }
      })();

    return activationPromise;
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
      String(
        reason ||
        "Runtime disabled."
      );

    syncRuntimeMarker();

    emit(
      "neyo:runtime-disabled",
      {
        version:
          VERSION,

        reason:
          state.reason
      }
    );

    return true;
  }

  /* =====================================================
     DESTROY

     Event listeners are delegated globally for the app
     lifetime, therefore destroy marks them inert rather
     than attempting unsafe anonymous-listener removal.
     ===================================================== */

  function destroy() {
    if (
      state.destroyed
    ) {
      return true;
    }

    state.destroyed =
      true;

    deactivate(
      "Runtime destroyed."
    );

    emit(
      "neyo:runtime-destroyed",
      {
        version:
          VERSION
      }
    );

    return true;
  }

  /* =====================================================
     GLOBAL EVENT BINDINGS
     ===================================================== */

  document.addEventListener(
    "click",
    handleDocumentClick,
    true
  );

  document.addEventListener(
    "submit",
    routeComposerSubmit,
    true
  );

  window.addEventListener(
    "neyo:active-conversation-deleted",
    handleActiveConversationDeleted
  );

  window.addEventListener(
    "neyo:chat-state-sync-request-runtime",
    requestStateSync
  );

  /*
   * Retry activation when critical modules announce
   * themselves after runtime initialization.
   */

  window.addEventListener(
    "neyo:chat-ready",
    retryActivation
  );

  window.addEventListener(
    "neyo:send-state-ready",
    retryActivation
  );

  window.addEventListener(
    "neyo:attachments-ready",
    () => {
      if (
        state.active
      ) {
        checkHealth();
      }
    }
  );

  window.addEventListener(
    "neyo:messages-ready",
    () => {
      if (
        state.active
      ) {
        checkHealth();
      }
    }
  );

  window.addEventListener(
    "neyo:message-renderer-ready",
    () => {
      if (
        state.active
      ) {
        checkHealth();
      }
    }
  );

  /* =====================================================
     OPTIONAL COMPATIBILITY REQUEST EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:runtime-new-chat-request",
    event => {
      requestNewChat({
        source:
          event.detail
            ?.source ||
          "runtime-event"
      });
    }
  );

  window.addEventListener(
    "neyo:runtime-prompt-request",
    event => {
      routeStarterPrompt(
        event.detail
          ?.prompt ||
        event.detail
          ?.text ||
        "",
        {
          source:
            event.detail
              ?.source ||
            "runtime-event"
        }
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

      legacyCompatible:
        true,

      legacyScriptPresent,

      /*
       * Activation
       */

      activate,

      deactivate,

      destroy,

      /*
       * Runtime routing
       */

      newChat:
        requestNewChat,

      requestNewChat,

      sendPrompt:
        routeStarterPrompt,

      routeStarterPrompt,

      setComposerPrompt,

      /*
       * Canonical send convenience.

       Runtime does NOT implement send rules.
       This delegates directly to send-state.js.
       */

      send(
        options
      ) {
        if (
          !state.active
        ) {
          return false;
        }

        return Boolean(
          window.NeyoSendState
            ?.send
            ?.(options)
        );
      },

      stop(
        source =
          "runtime-api"
      ) {
        if (
          !state.active
        ) {
          return false;
        }

        return Boolean(
          window.NeyoSendState
            ?.stop
            ?.(source)
        );
      },

      /*
       * Health
       */

      check:
        checkHealth,

      checkHealth,

      requestStateSync,

      isActive() {
        return (
          state.active &&
          !state.destroyed
        );
      },

      isReady() {
        return (
          state.ready &&
          state.active &&
          !state.destroyed
        );
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

          destroyed:
            state.destroyed,

          reason:
            state.reason,

          legacyScriptPresent,

          /*
           * Runtime is modular authority.
           * neo.js may exist physically but is not owner
           * of actions intercepted by modular modules.
           */

          legacyOwnerActive:
            false,

          startedAt:
            state.startedAt,

          activatedAt:
            state.activatedAt,

          lastHealthAt:
            state.lastHealthAt,

          lastNewChatAt:
            state.lastNewChatAt,

          lastPromptAt:
            state.lastPromptAt,

          routedNewChats:
            state.routedNewChats,

          routedPrompts:
            state.routedPrompts,

          routedFormSubmits:
            state
              .routedFormSubmits,

          blockedLegacyActions:
            state
              .blockedLegacyActions,

          health:
            checkHealth()
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

  emit(
    "neyo:runtime-initializing",
    {
      version:
        VERSION,

      legacyScriptPresent
    }
  );

  void activate();
})();
