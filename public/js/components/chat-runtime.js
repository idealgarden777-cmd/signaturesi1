/*
=========================================================
NEYO — CHAT RUNTIME BRIDGE
FINAL CLEAN v1

FILE:
public/js/components/chat-runtime.js

PURPOSE
---------------------------------------------------------
Compatibility bridge between untouched legacy neo.js
and the new modular chat runtime.

OWNS
---------------------------------------------------------
- V2 runtime activation
- Legacy Send click interception
- Legacy Enter interception
- Dependency validation
- Attachment cleanup after accepted send
- Runtime health state

DOES NOT OWN
---------------------------------------------------------
- /api/chat
- Conversation state
- Message rendering
- Markdown
- Attachment upload
- History API
- Send/Stop business logic

IMPORTANT
---------------------------------------------------------
neo.js remains untouched.

When V2 is healthy:

#sendBtn click
→ intercepted before legacy neo.js listener
→ NeyoSendState.send()

Enter
→ intercepted before legacy neo.js listener
→ NeyoSendState.send()

Actual flow remains:

send-state.js
→ chat.js
→ messages.js
→ message-renderer.js

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-chat-runtime-final-clean-v1";


  if (
    window.NeyoChatRuntime?.__controller ===
    true
  ) {
    console.warn(
      "[NEYO Runtime] Already initialized."
    );

    return;
  }


  /* =====================================================
     DOM
     ===================================================== */

  const sendBtn =
    document.getElementById(
      "sendBtn"
    );


  const chatInput =
    document.getElementById(
      "chatInput"
    );


  /* =====================================================
     STATE
     ===================================================== */

  const state =
    {
      active:
        false,

      ready:
        false,

      reason:
        null,

      composing:
        false
    };


  /* =====================================================
     REQUIRED MODULES
     ===================================================== */

  const REQUIRED_MODULES =
    [
      "NeyoChat",
      "NeyoMessages",
      "NeyoMessageRenderer",
      "NeyoSendState",
      "NeyoAttachments"
    ];


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
     DEPENDENCIES
     ===================================================== */

  function getMissingModules() {
    return REQUIRED_MODULES
      .filter(
        name =>
          !window[name]
      );
  }


  function dependenciesReady() {
    return (
      getMissingModules()
        .length ===
      0
    );
  }


  /* =====================================================
     HEALTH CHECK
     ===================================================== */

  function validateRuntime() {
    if (
      !sendBtn ||
      !chatInput
    ) {
      return {
        valid:
          false,

        reason:
          "Composer elements are missing."
      };
    }


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
        .NeyoAttachments
        ?.getReady !==
      "function"
    ) {
      return {
        valid:
          false,

        reason:
          "Attachment controller is unavailable."
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
     ACTIVATE
     ===================================================== */

  function activate() {
    if (
      state.active
    ) {
      return true;
    }


    const validation =
      validateRuntime();


    if (
      !validation.valid
    ) {
      state.active =
        false;


      state.ready =
        false;


      state.reason =
        validation.reason;


      console.warn(
        "[NEYO Runtime] V2 not activated:",
        validation.reason
      );


      emit(
        "neyo:runtime-error",
        {
          version:
            VERSION,

          reason:
            validation.reason
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


    document
      .documentElement
      .setAttribute(
        "data-neyo-chat-runtime",
        "v2"
      );


    emit(
      "neyo:runtime-ready",
      {
        version:
          VERSION,

        mode:
          "v2"
      }
    );


    /*
    -------------------------------------------------------
    Sync Send button with authoritative chat state.
    -------------------------------------------------------
    */

    emit(
      "neyo:chat-state-sync-request"
    );


    console.log(
      "[NEYO Runtime] V2 chat runtime active."
    );


    return true;
  }


  /* =====================================================
     DEACTIVATE
     ===================================================== */

  function deactivate(
    reason =
      "Runtime manually disabled."
  ) {
    state.active =
      false;


    state.ready =
      false;


    state.reason =
      reason;


    document
      .documentElement
      .removeAttribute(
        "data-neyo-chat-runtime"
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
     SEND THROUGH AUTHORITATIVE OWNER
     ===================================================== */

  function requestSend() {
    if (
      !state.active
    ) {
      return false;
    }


    const controller =
      window.NeyoSendState;


    if (
      typeof controller
        ?.send !==
      "function"
    ) {
      deactivate(
        "Send controller became unavailable."
      );


      return false;
    }


    try {
      return Boolean(
        controller.send()
      );

    } catch (
      error
    ) {
      console.error(
        "[NEYO Runtime] Send bridge failed:",
        error
      );


      emit(
        "neyo:runtime-error",
        {
          error
        }
      );


      return false;
    }
  }


  /* =====================================================
     LEGACY SEND BUTTON INTERCEPTION
     ===================================================== */

  function handleSendCapture(
    event
  ) {
    if (
      !state.active
    ) {
      return;
    }


    /*
    -------------------------------------------------------
    Capture phase runs before neo.js bubble listener.

    We intentionally stop the old listener here.

    The actual Send/Stop behavior still belongs to
    send-state.js.
    -------------------------------------------------------
    */

    event.preventDefault();


    event.stopPropagation();


    event.stopImmediatePropagation();


    requestSend();
  }


  sendBtn
    ?.addEventListener(
      "click",
      handleSendCapture,
      true
    );


  /* =====================================================
     IME
     ===================================================== */

  chatInput
    ?.addEventListener(
      "compositionstart",
      () => {
        state.composing =
          true;
      },
      true
    );


  chatInput
    ?.addEventListener(
      "compositionend",
      () => {
        state.composing =
          false;
      },
      true
    );


  /* =====================================================
     LEGACY ENTER INTERCEPTION
     ===================================================== */

  function handleKeydownCapture(
    event
  ) {
    if (
      !state.active
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
    -------------------------------------------------------
    Shift + Enter remains newline.
    -------------------------------------------------------
    */

    if (
      event.shiftKey
    ) {
      return;
    }


    /*
    -------------------------------------------------------
    Never send while IME composition is active.
    -------------------------------------------------------
    */

    if (
      state.composing ||
      event.isComposing ||
      event.keyCode ===
        229
    ) {
      return;
    }


    /*
    -------------------------------------------------------
    Prevent both:
    - legacy neo.js Enter listener
    - send-state.js bubble listener

    Runtime forwards exactly once to NeyoSendState.send().
    -------------------------------------------------------
    */

    event.preventDefault();


    event.stopPropagation();


    event.stopImmediatePropagation();


    requestSend();
  }


  chatInput
    ?.addEventListener(
      "keydown",
      handleKeydownCapture,
      true
    );


  /* =====================================================
     ATTACHMENT CLEAR AFTER ACCEPTED SEND
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {
      if (
        !state.active
      ) {
        return;
      }


      /*
      -------------------------------------------------------
      At this point chat.js has already copied attachment
      metadata into its canonical user message/payload.

      Composer attachments can now be cleared safely.

      This gives ChatGPT-style behavior:
      attached file leaves composer after Send.
      -------------------------------------------------------
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
          "[NEYO Runtime] Attachment cleanup failed:",
          error
        );
      }
    }
  );


  /* =====================================================
     ACTIVE CONVERSATION SYNC
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
        conversationId
      ) {
        emit(
          "neyo:history-active-set",
          {
            conversationId
          }
        );
      }
    }
  );


  /* =====================================================
     NEW CHAT SYNC
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
     ACTIVE CHAT DELETED
     ===================================================== */

  window.addEventListener(
    "neyo:active-conversation-deleted",
    () => {
      if (
        !state.active
      ) {
        return;
      }


      /*
      -------------------------------------------------------
      history.js never owns chat state.

      Runtime bridges active deletion → new chat.
      -------------------------------------------------------
      */

      emit(
        "neyo:chat-new-request"
      );
    }
  );


  /* =====================================================
     MODULE READY EVENTS
     ===================================================== */

  const MODULE_READY_EVENTS =
    [
      "neyo:chat-ready",
      "neyo:messages-ready",
      "neyo:message-renderer-ready",
      "neyo:send-state-ready",
      "neyo:attachments-ready"
    ];


  MODULE_READY_EVENTS.forEach(
    eventName => {
      window.addEventListener(
        eventName,
        () => {
          if (
            !state.active &&
            dependenciesReady()
          ) {
            activate();
          }
        }
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

      isActive:
        () =>
          state.active,

      check:
        validateRuntime,

      getState:
        () => ({

          version:
            VERSION,

          active:
            state.active,

          ready:
            state.ready,

          reason:
            state.reason,

          missingModules:
            getMissingModules()
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
     INIT
     ===================================================== */

  /*
  ---------------------------------------------------------
  Usually runtime is loaded after all V2 modules, so this
  activates immediately.

  Ready-event listeners above also handle alternate order.
  ---------------------------------------------------------
  */

  activate();

})();
