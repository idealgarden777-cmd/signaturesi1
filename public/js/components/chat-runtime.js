/*
=========================================================
NEYO — CHAT RUNTIME
FINAL INTEGRATION CONTROLLER v2

FILE:
public/js/components/chat-runtime.js

PURPOSE
---------------------------------------------------------
Safely make the modular V2 chat system authoritative
without editing legacy neo.js.

THIS MODULE OWNS
---------------------------------------------------------
- Runtime activation
- Legacy chat-event interception
- Send click routing
- Enter routing
- Starter prompt routing
- New-chat routing
- Attachment cleanup after accepted send
- Active conversation synchronization
- Runtime health checks

THIS MODULE DOES NOT OWN
---------------------------------------------------------
- /api/chat
- Conversation state
- Message DOM
- Markdown
- Attachment upload
- History requests
- Send/Stop business rules
- Voice processing
- Settings
- Sidebar UI

AUTHORITATIVE PIPELINE
---------------------------------------------------------

User action
    ↓
chat-runtime.js
    ↓
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

Attachments:
NeyoAttachments.getReady()
    ↓
NeyoSendState
    ↓
NeyoChat

IMPORTANT
---------------------------------------------------------
Legacy neo.js remains loaded and untouched.

Runtime capture listeners execute BEFORE legacy bubble
listeners and prevent legacy chat transport from running.

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / SINGLETON
     ===================================================== */

  const VERSION =
    "neyo-chat-runtime-final-v2";


  if (
    window.NeyoChatRuntime
      ?.__controller ===
    true
  ) {
    console.warn(
      "[NEYO Runtime] Already initialized."
    );

    return;
  }


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      debug:
        true,

      dependencyWaitMs:
        8000,

      dependencyPollMs:
        50
    });


  /* =====================================================
     REQUIRED MODULES
     ===================================================== */

  const REQUIRED =
    Object.freeze([
      "NeyoAttachments",
      "NeyoChat",
      "NeyoMessages",
      "NeyoMessageRenderer",
      "NeyoSendState"
    ]);


  /* =====================================================
     STATE
     ===================================================== */

  const state =
    {
      active:
        false,

      ready:
        false,

      activating:
        false,

      reason:
        null,

      startedAt:
        Date.now(),

      activatedAt:
        null,

      routedSends:
        0
    };


  /* =====================================================
     BASIC HELPERS
     ===================================================== */

  function debug(
    ...args
  ) {
    if (
      !CONFIG.debug
    ) {
      return;
    }


    console.log(
      "[NEYO Runtime]",
      ...args
    );
  }


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
      !isElement(
        target
      )
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


  /* =====================================================
     DEPENDENCY CHECK
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


    if (
      missing.length >
      0
    ) {
      return {
        valid:
          false,

        reason:
          `Missing modules: ${missing.join(
            ", "
          )}`
      };
    }


    if (
      typeof window
        .NeyoChat
        ?.send !==
      "function"
    ) {
      return {
        valid:
          false,

        reason:
          "NeyoChat.send() is unavailable."
      };
    }


    if (
      typeof window
        .NeyoChat
        ?.stop !==
      "function"
    ) {
      return {
        valid:
          false,

        reason:
          "NeyoChat.stop() is unavailable."
      };
    }


    if (
      typeof window
        .NeyoSendState
        ?.send !==
      "function"
    ) {
      return {
        valid:
          false,

        reason:
          "NeyoSendState.send() is unavailable."
      };
    }


    if (
      typeof window
        .NeyoAttachments
        ?.getReady !==
      "function"
    ) {
      return {
        valid:
          false,

        reason:
          "NeyoAttachments.getReady() is unavailable."
      };
    }


    if (
      typeof window
        .NeyoMessages
        ?.replace !==
      "function"
    ) {
      return {
        valid:
          false,

        reason:
          "NeyoMessages.replace() is unavailable."
      };
    }


    return {
      valid:
        true,

      reason:
        null
    };
  }


  /* =====================================================
     WAIT FOR MODULES
     ===================================================== */

  function waitForDependencies() {
    return new Promise(
      resolve => {
        const started =
          Date.now();


        const check =
          () => {
            const validation =
              validateModules();


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
              CONFIG.dependencyWaitMs
            ) {
              resolve(
                validation
              );

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
     MARK ACTIVE
     ===================================================== */

  function setRuntimeAttribute(
    active
  ) {
    if (
      active
    ) {
      document
        .documentElement
        .setAttribute(
          "data-neyo-chat-runtime",
          "v2"
        );


      document
        .documentElement
        .classList
        .add(
          "neyo-chat-v2"
        );

      return;
    }


    document
      .documentElement
      .removeAttribute(
        "data-neyo-chat-runtime"
      );


    document
      .documentElement
      .classList
      .remove(
        "neyo-chat-v2"
      );
  }


  /* =====================================================
     ACTIVATE
     ===================================================== */

  async function activate() {
    if (
      state.active
    ) {
      return true;
    }


    if (
      state.activating
    ) {
      return false;
    }


    state.activating =
      true;


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


        setRuntimeAttribute(
          false
        );


        console.error(
          "[NEYO Runtime] Activation failed:",
          validation.reason
        );


        emit(
          "neyo:runtime-error",
          {
            version:
              VERSION,

            reason:
              validation.reason,

            missingModules:
              getMissingModules()
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


      setRuntimeAttribute(
        true
      );


      /*
      -----------------------------------------------------
      Ask authoritative chat core for state.
      -----------------------------------------------------
      */

      emit(
        "neyo:chat-state-sync-request"
      );


      emit(
        "neyo:runtime-ready",
        {
          version:
            VERSION,

          active:
            true
        }
      );


      debug(
        "ACTIVE",
        {
          version:
            VERSION,

          attachments:
            window
              .NeyoAttachments
              ?.getState
              ?.(),

          chat:
            window
              .NeyoChat
              ?.getState
              ?.(),

          send:
            window
              .NeyoSendState
              ?.getState
              ?.()
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


      setRuntimeAttribute(
        false
      );


      console.error(
        "[NEYO Runtime] Activation exception:",
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


    setRuntimeAttribute(
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
     PREVENT LEGACY CHAT HANDLER
     ===================================================== */

  function consumeLegacyEvent(
    event
  ) {
    event.preventDefault();


    /*
    -------------------------------------------------------
    Critical:

    neo.js chat listeners are bubble listeners.

    Runtime listens on document CAPTURE.

    stopImmediatePropagation() here prevents the event from
    reaching the legacy chat listener.

    This is intentionally limited to actual chat actions.
    -------------------------------------------------------
    */

    event.stopPropagation();


    event.stopImmediatePropagation();
  }


  /* =====================================================
     SEND
     ===================================================== */

  function requestSend() {
    if (
      !state.active
    ) {
      return false;
    }


    const sendController =
      window.NeyoSendState;


    if (
      typeof sendController
        ?.send !==
      "function"
    ) {
      console.error(
        "[NEYO Runtime] Send controller unavailable."
      );


      return false;
    }


    try {
      const result =
        sendController.send();


      if (
        result
      ) {
        state.routedSends +=
          1;
      }


      return Boolean(
        result
      );

    } catch (
      error
    ) {
      console.error(
        "[NEYO Runtime] Send failed:",
        error
      );


      emit(
        "neyo:runtime-error",
        {
          version:
            VERSION,

          reason:
            "Send routing failed.",

          error
        }
      );


      return false;
    }
  }


  /* =====================================================
     STOP
     ===================================================== */

  function requestStop() {
    if (
      !state.active
    ) {
      return false;
    }


    emit(
      "neyo:chat-stop-request"
    );


    return true;
  }


  /* =====================================================
     DOCUMENT CLICK — CAPTURE PHASE
     ===================================================== */

  document.addEventListener(
    "click",
    event => {
      if (
        !state.active
      ) {
        return;
      }


      /* =================================================
         SEND BUTTON
         ================================================= */

      const sendButton =
        closest(
          event.target,
          "#sendBtn"
        );


      if (
        sendButton
      ) {
        consumeLegacyEvent(
          event
        );


        requestSend();


        return;
      }


      /* =================================================
         NEW CHAT

         Legacy neo.js owns this button too, but its action
         resets only legacy private state.

         V2 must reset canonical chat state.
         ================================================= */

      const newChatButton =
        closest(
          event.target,
          "#newChatBtn"
        );


      if (
        newChatButton
      ) {
        consumeLegacyEvent(
          event
        );


        emit(
          "neyo:chat-new-request"
        );


        return;
      }


      /* =================================================
         STARTER PROMPTS

         Legacy neo.js directly calls handleSend().
         Route them through V2 instead.
         ================================================= */

      const promptButton =
        closest(
          event.target,
          "[data-prompt]"
        );


      if (
        promptButton
      ) {
        const prompt =
          String(
            promptButton.dataset
              ?.prompt ||
            ""
          ).trim();


        if (
          !prompt
        ) {
          return;
        }


        consumeLegacyEvent(
          event
        );


        const input =
          document.getElementById(
            "chatInput"
          );


        if (
          input
        ) {
          input.value =
            prompt;


          input.dispatchEvent(
            new Event(
              "input",
              {
                bubbles:
                  true
              }
            )
          );
        }


        requestSend();


        return;
      }
    },
    true
  );


  /* =====================================================
     ENTER — DOCUMENT CAPTURE

     Delegated instead of binding directly to #chatInput.

     This remains valid if another component replaces or
     rebuilds the composer DOM.
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {
      if (
        !state.active
      ) {
        return;
      }


      const input =
        closest(
          event.target,
          "#chatInput"
        );


      if (
        !input
      ) {
        return;
      }


      if (
        event.key !==
        "Enter"
      ) {
        return;
      }


      /*
      -----------------------------------------------------
      Shift + Enter = newline.
      -----------------------------------------------------
      */

      if (
        event.shiftKey
      ) {
        return;
      }


      /*
      -----------------------------------------------------
      IME / composition safety.
      -----------------------------------------------------
      */

      if (
        event.isComposing ||
        event.keyCode ===
          229
      ) {
        return;
      }


      consumeLegacyEvent(
        event
      );


      requestSend();
    },
    true
  );


  /* =====================================================
     CHAT SEND START

     chat.js has already copied attachment metadata into
     canonical conversation before emitting this event.

     Therefore composer attachments can now be cleared.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    event => {
      if (
        !state.active
      ) {
        return;
      }


      const attachments =
        Array.isArray(
          event.detail
            ?.attachments
        )
          ? event.detail
              .attachments
          : [];


      debug(
        "CHAT START",
        {
          attachmentCount:
            attachments.length,

          attachments:
            attachments.map(
              item => ({
                name:
                  item.name,

                path:
                  item.path,

                status:
                  item.status
              })
            )
        }
      );


      /*
      -----------------------------------------------------
      Clear ONLY after chat.js accepted the request.
      -----------------------------------------------------
      */

      try {
        window
          .NeyoAttachments
          ?.clear
          ?.();

      } catch (
        error
      ) {
        console.warn(
          "[NEYO Runtime] Could not clear composer attachments:",
          error
        );
      }
    }
  );


  /* =====================================================
     CONVERSATION LOADED
     ===================================================== */

  window.addEventListener(
    "neyo:conversation-loaded",
    event => {
      if (
        !state.active
      ) {
        return;
      }


      const conversationId =
        event.detail
          ?.conversationId;


      if (
        !conversationId
      ) {
        return;
      }


      emit(
        "neyo:history-active-set",
        {
          conversationId
        }
      );
    }
  );


  /* =====================================================
     NEW CHAT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      if (
        !state.active
      ) {
        return;
      }


      emit(
        "neyo:history-active-set",
        {
          conversationId:
            null
        }
      );


      try {
        window
          .NeyoAttachments
          ?.clear
          ?.();

      } catch {}
    }
  );


  /* =====================================================
     ACTIVE CONVERSATION DELETED
     ===================================================== */

  window.addEventListener(
    "neyo:active-conversation-deleted",
    () => {
      if (
        !state.active
      ) {
        return;
      }


      emit(
        "neyo:chat-new-request"
      );
    }
  );


  /* =====================================================
     CHAT STATE DEBUG
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {
      debug(
        "STATE AFTER SEND START",
        {
          chat:
            window
              .NeyoChat
              ?.getState
              ?.(),

          send:
            window
              .NeyoSendState
              ?.getState
              ?.()
        }
      );
    }
  );


  window.addEventListener(
    "neyo:chat-response",
    event => {
      debug(
        "CHAT RESPONSE",
        {
          conversationId:
            event.detail
              ?.conversationId,

          replyLength:
            String(
              event.detail
                ?.reply ||
              ""
            ).length
        }
      );
    }
  );


  window.addEventListener(
    "neyo:chat-error",
    event => {
      console.error(
        "[NEYO Runtime] Chat error:",
        event.detail
          ?.error
      );
    }
  );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  const publicApi =
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

      check:
        validateModules,

      isActive:
        () =>
          state.active,

      getState:
        () => ({
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

          missingModules:
            getMissingModules(),

          routedSends:
            state.routedSends,

          uptimeMs:
            Date.now() -
            state.startedAt,

          activatedAt:
            state.activatedAt
        })
    });


  Object.defineProperty(
    window,
    "NeyoChatRuntime",
    {
      value:
        publicApi,

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
