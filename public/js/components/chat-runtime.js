/*
=========================================================
NEYO — CHAT RUNTIME
SINGLE SEND-OWNER INTEGRATION v4

FILE:
public/js/components/chat-runtime.js

PURPOSE
---------------------------------------------------------
Keep legacy neo.js loaded safely while routing actual
chat actions through the modular NEYO pipeline.

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

SEND BUTTON OWNERSHIP
---------------------------------------------------------
NeyoSendState ONLY owns:

- enabled / disabled state
- grey / active state
- arrow icon
- stop icon
- generating visual state
- send availability
- attachment-ready availability

chat-runtime.js DOES NOT directly mutate #sendBtn.

RUNTIME OWNS
---------------------------------------------------------
- Legacy chat event interception
- Send routing
- Stop routing
- Enter routing safety
- Starter prompt routing
- New chat routing
- Conversation/history synchronization
- Runtime activation
- Runtime health state

IMPORTANT
---------------------------------------------------------
neo.js may remain loaded.
The modular pipeline remains authoritative.
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / SINGLETON
     ===================================================== */

  const VERSION =
    "neyo-chat-runtime-single-send-owner-v4";


  if (
    window.NeyoChatRuntime
      ?.__controller === true
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
        50,

      duplicateSendWindowMs:
        220

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
     DOM
     ===================================================== */

  const chatInput =
    document.getElementById(
      "chatInput"
    );


  const sendBtn =
    document.getElementById(
      "sendBtn"
    );


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

    composing:
      false,

    generating:
      false,

    sending:
      false,

    reason:
      null,

    startedAt:
      Date.now(),

    activatedAt:
      null,

    routedSends:
      0,

    routedStops:
      0,

    lastSendAt:
      0

  };


  /* =====================================================
     LOGGING
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
     TEXT
     ===================================================== */

  function getRawText() {

    return String(
      chatInput?.value ||
      ""
    )
      .replace(
        /\r\n?/g,
        "\n"
      )
      .replace(
        /\u0000/g,
        ""
      );

  }


  function getText() {

    return getRawText()
      .trim();

  }


  function hasText() {

    return (
      getText().length >
      0
    );

  }


  function clearText() {

    if (
      !chatInput
    ) {
      return;
    }


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

  }


  /* =====================================================
     ATTACHMENTS
     ===================================================== */

  function getAllAttachments() {

    try {

      const value =
        window
          .NeyoAttachments
          ?.getAll
          ?.();


      return Array.isArray(
        value
      )
        ? value
        : [];

    } catch (
      error
    ) {

      console.warn(
        "[NEYO Runtime] Could not read attachments:",
        error
      );


      return [];

    }

  }


  function getReadyAttachments() {

    try {

      const value =
        window
          .NeyoAttachments
          ?.getReady
          ?.();


      return Array.isArray(
        value
      )
        ? value
        : [];

    } catch (
      error
    ) {

      console.warn(
        "[NEYO Runtime] Could not read ready attachments:",
        error
      );


      return [];

    }

  }


  function clearAttachments() {

    try {

      window
        .NeyoAttachments
        ?.clear
        ?.();

    } catch (
      error
    ) {

      console.warn(
        "[NEYO Runtime] Could not clear attachments:",
        error
      );

    }

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


    if (
      missing.length >
      0
    ) {

      return {

        valid:
          false,

        reason:
          `Missing modules: ${missing.join(", ")}`

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
      !window.NeyoMessages
    ) {

      return {

        valid:
          false,

        reason:
          "NeyoMessages is unavailable."

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

        valid:
          false,

        reason:
          "NeyoMessageRenderer API is unavailable."

      };

    }


    if (
      window
        .NeyoSendState
        ?.__controller !==
      true
    ) {

      return {

        valid:
          false,

        reason:
          "NeyoSendState controller is unavailable."

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
     WAIT FOR DEPENDENCIES
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
     ROOT RUNTIME ATTRIBUTE
     ===================================================== */

  function setRuntimeAttribute(
    active
  ) {

    const root =
      document.documentElement;


    if (
      active
    ) {

      root.setAttribute(
        "data-neyo-chat-runtime",
        "single-send-owner-v4"
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
     SEND BUTTON SYNC
     ===================================================== */

  function updateSendState() {

    /*
    -------------------------------------------------------
    CRITICAL SINGLE-OWNER RULE

    chat-runtime.js must NEVER directly set:

    sendBtn.disabled
    sendBtn.innerHTML
    .is-ready
    .is-disabled
    .is-generating

    NeyoSendState owns all of it.
    -------------------------------------------------------
    */

    const controller =
      window.NeyoSendState;


    if (
      controller
        ?.__controller ===
        true &&
      typeof controller.update ===
        "function"
    ) {

      try {

        controller.update();

        return true;

      } catch (
        error
      ) {

        console.warn(
          "[NEYO Runtime] Send-state sync failed:",
          error
        );

      }

    }


    return false;

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


    if (
      state.generating
    ) {

      return requestStop();

    }


    const sendController =
      window.NeyoSendState;


    /*
    -------------------------------------------------------
    Canonical route.

    Do NOT depend on legacy neo.js state.
    Do NOT directly send from runtime.
    -------------------------------------------------------
    */

    if (
      sendController
        ?.__controller ===
        true &&
      typeof sendController.send ===
        "function"
    ) {

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
          "[NEYO Runtime] Send routing failed:",
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


    console.error(
      "[NEYO Runtime] NeyoSendState.send() unavailable."
    );


    return false;

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


    const sendController =
      window.NeyoSendState;


    /*
    Prefer canonical stop method.
    */

    if (
      sendController
        ?.__controller ===
        true &&
      typeof sendController.stop ===
        "function"
    ) {

      try {

        const result =
          sendController.stop();


        if (
          result
        ) {

          state.routedStops +=
            1;

        }


        return Boolean(
          result
        );

      } catch (
        error
      ) {

        console.error(
          "[NEYO Runtime] Stop routing failed:",
          error
        );


        return false;

      }

    }


    /*
    Compatibility fallback only.
    */

    if (
      state.generating
    ) {

      state.routedStops +=
        1;


      emit(
        "neyo:chat-stop-request"
      );


      return true;

    }


    return false;

  }


  /* =====================================================
     LEGACY EVENT INTERCEPTION
     ===================================================== */

  function consumeLegacyEvent(
    event
  ) {

    event.preventDefault();


    event.stopPropagation();


    event.stopImmediatePropagation();

  }


  /* =====================================================
     CLICK ROUTING
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
         SEND / STOP
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


        if (
          state.generating
        ) {

          requestStop();

        } else {

          requestSend();

        }


        return;

      }


      /* =================================================
         NEW CHAT
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
         STARTER PROMPT
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
            promptButton
              .dataset
              ?.prompt ||
            ""
          )
            .trim();


        if (
          !prompt
        ) {
          return;
        }


        consumeLegacyEvent(
          event
        );


        if (
          chatInput
        ) {

          chatInput.value =
            prompt;


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


        requestSend();


        return;

      }

    },
    true
  );


  /* =====================================================
     IME STATE
     ===================================================== */

  if (
    chatInput
  ) {

    chatInput.addEventListener(
      "compositionstart",
      () => {

        state.composing =
          true;

      }
    );


    chatInput.addEventListener(
      "compositionend",
      () => {

        state.composing =
          false;

      }
    );

  }


  /* =====================================================
     KEYBOARD ROUTING
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
       * Shift + Enter = newline.
       */

      if (
        event.shiftKey
      ) {
        return;
      }


      /*
       * Modifier shortcuts remain untouched.
       */

      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }


      /*
       * IME protection.
       */

      if (
        event.isComposing ||
        state.composing ||
        event.keyCode ===
          229
      ) {
        return;
      }


      /*
       * During generation Enter must NOT become Stop.
       * Stop stays an explicit button action.
       */

      if (
        state.generating
      ) {

        consumeLegacyEvent(
          event
        );


        return;

      }


      const sendController =
        window.NeyoSendState;


      if (
        sendController
          ?.__controller !==
        true
      ) {
        return;
      }


      if (
        typeof sendController.canSend ===
          "function" &&
        !sendController.canSend()
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
     INPUT SYNC
     ===================================================== */

  chatInput
    ?.addEventListener(
      "input",
      () => {

        updateSendState();

      }
    );


  /* =====================================================
     ATTACHMENT SYNC
     ===================================================== */

  for (
    const eventName
    of [

      "neyo:attachments-change",

      "neyo:attachment-ready",

      "neyo:attachment-error",

      "neyo:attachment-removed"

    ]
  ) {

    window.addEventListener(
      eventName,
      () => {

        updateSendState();

      }
    );

  }


  /* =====================================================
     CHAT START
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    event => {

      if (
        !state.active
      ) {
        return;
      }


      state.generating =
        true;


      state.sending =
        false;


      /*
       * Send-state also receives this event and renders
       * the STOP icon.
       *
       * Runtime only asks it to sync.
       */

      updateSendState();


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

          conversationId:
            event.detail
              ?.conversationId ||
            null

        }
      );

    }
  );


  /* =====================================================
     CHAT FINISH
     ===================================================== */

  function generationFinished() {

    state.generating =
      false;


    state.sending =
      false;


    updateSendState();

  }


  for (
    const eventName
    of [

      "neyo:chat-send-end",

      "neyo:chat-response",

      "neyo:chat-error",

      "neyo:chat-aborted",

      "neyo:chat-limit-reached",

      "neyo:chat-state-loaded",

      "neyo:chat-new"

    ]
  ) {

    window.addEventListener(
      eventName,
      generationFinished
    );

  }


  /* =====================================================
     NEW CHAT CLEANUP
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


      clearAttachments();


      if (
        chatInput
      ) {

        clearText();

      }


      updateSendState();

    }
  );


  /* =====================================================
     HISTORY ACTIVE SYNC
     ===================================================== */

  function syncActiveConversation(
    event
  ) {

    if (
      !state.active
    ) {
      return;
    }


    const conversationId =
      event.detail
        ?.conversationId ||
      event.detail
        ?.id ||
      null;


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


  window.addEventListener(
    "neyo:conversation-loaded",
    syncActiveConversation
  );


  window.addEventListener(
    "neyo:chat-state-loaded",
    syncActiveConversation
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
     DEBUG EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:chat-response",
    event => {

      debug(
        "CHAT RESPONSE",
        {

          conversationId:
            event.detail
              ?.conversationId ||
            null,

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
          ?.error ||
        event.detail
      );

    }
  );


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
       * Ask canonical chat core for its current state.
       */

      emit(
        "neyo:chat-state-sync-request"
      );


      /*
       * Initial send-button synchronization.
       */

      updateSendState();


      emit(
        "neyo:runtime-ready",
        {

          version:
            VERSION,

          active:
            true,

          mode:
            "single-send-owner",

          buttonOwner:
            "NeyoSendState"

        }
      );


      debug(
        "ACTIVE",
        {

          version:
            VERSION,

          mode:
            "single-send-owner",

          sendState:
            window
              .NeyoSendState
              ?.getState
              ?.(),

          attachments:
            window
              .NeyoAttachments
              ?.getState
              ?.(),

          chat:
            window
              .NeyoChat
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


    state.generating =
      false;


    state.sending =
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

      update:
        updateSendState,

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

          composing:
            state.composing,

          generating:
            state.generating,

          sending:
            state.sending,

          reason:
            state.reason,

          missingModules:
            getMissingModules(),

          sendOwner:
            "NeyoSendState",

          sendStateActive:
            window
              .NeyoSendState
              ?.active ===
            true,

          textReady:
            hasText(),

          readyAttachments:
            getReadyAttachments()
              .length,

          allAttachments:
            getAllAttachments()
              .length,

          routedSends:
            state.routedSends,

          routedStops:
            state.routedStops,

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
