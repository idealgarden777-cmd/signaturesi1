/*
=========================================================
NEYO — CHAT RUNTIME
SAFE HYBRID INTEGRATION CONTROLLER v3

FILE:
public/js/components/chat-runtime.js

PURPOSE
---------------------------------------------------------
Keep legacy neo.js loaded and untouched while routing
actual chat actions into the modular V2 chat pipeline.

FIXES IN v3
---------------------------------------------------------
✅ Removed invalid NeyoMessages.replace() requirement
✅ Works with current NeyoMessages event-driven API
✅ Works when NeyoSendState is active
✅ Compatibility send routing when NeyoSendState is passive
✅ Prevents legacy duplicate chat transport
✅ Enter / Shift+Enter / IME safe
✅ Stop generation supported
✅ Starter prompts supported
✅ New chat supported
✅ Ready attachments supported
✅ Pending/failed attachments do not block text
✅ Sent attachment cleanup
✅ Runtime health reporting
✅ neo.js untouched

AUTHORITATIVE CHAT PIPELINE
---------------------------------------------------------

User action
    ↓
chat-runtime.js
    ↓
NeyoSendState
    OR
hybrid compatibility sender
    ↓
neyo:chat-send-request
    ↓
NeyoChat
    ↓
/api/chat
    ↓
neyo:chat-message-added
    ↓
NeyoMessages
    ↓
NeyoMessageRenderer

IMPORTANT
---------------------------------------------------------
neo.js remains loaded.

This module intercepts ONLY chat-related user actions
during capture phase so legacy chat transport does not
also execute.

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / SINGLETON
     ===================================================== */

  const VERSION =
    "neyo-chat-runtime-safe-hybrid-v3";


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

  const state =
    {
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
      window.NeyoComposerScrollbar
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


  function removeSentAttachments(
    attachments
  ) {
    if (
      !Array.isArray(
        attachments
      )
    ) {
      return;
    }

    const controller =
      window.NeyoAttachments;

    if (
      typeof controller
        ?.remove !==
      "function"
    ) {
      return;
    }

    for (
      const attachment
      of attachments
    ) {
      if (
        !attachment?.id
      ) {
        continue;
      }

      try {
        controller.remove(
          attachment.id
        );

      } catch (
        error
      ) {
        console.warn(
          "[NEYO Runtime] Could not remove sent attachment:",
          error
        );
      }
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


    /*
    -------------------------------------------------------
    IMPORTANT FIX:

    messages.js is EVENT DRIVEN.

    It does NOT need NeyoMessages.replace().

    chat.js emits:
      neyo:chat-message-added

    messages.js receives it and owns the DOM shell.

    Therefore merely having NeyoMessages available is
    enough for runtime activation.
    -------------------------------------------------------
    */

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
     RUNTIME ATTRIBUTE
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
        "safe-hybrid-v3"
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
     SEND BUTTON VISUAL SYNC
     ===================================================== */

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }


  function renderSendIcon() {
    if (
      !sendBtn
    ) {
      return;
    }

    sendBtn.innerHTML = `
      <i
        data-lucide="arrow-up"
        size="18"
        aria-hidden="true"
      ></i>
    `;

    sendBtn.classList.remove(
      "is-generating"
    );

    sendBtn.setAttribute(
      "aria-label",
      "Send message"
    );

    sendBtn.setAttribute(
      "title",
      "Send message"
    );

    refreshIcons();
  }


  function renderStopIcon() {
    if (
      !sendBtn
    ) {
      return;
    }

    sendBtn.innerHTML = `
      <i
        data-lucide="square"
        size="15"
        aria-hidden="true"
      ></i>
    `;

    sendBtn.classList.add(
      "is-generating"
    );

    sendBtn.disabled =
      false;

    sendBtn.setAttribute(
      "aria-label",
      "Stop generating"
    );

    sendBtn.setAttribute(
      "title",
      "Stop generating"
    );

    refreshIcons();
  }


  function updateCompatibilityButton() {
    /*
    -------------------------------------------------------
    If NeyoSendState is active, it owns visuals.

    In safe-hybrid mode NeyoSendState may intentionally be
    passive because neo.js exists. In that case runtime
    maintains the button state itself.
    -------------------------------------------------------
    */

    const sendState =
      window.NeyoSendState;


    if (
      sendState?.active ===
      true
    ) {
      try {
        sendState.update?.();
      } catch {}

      return;
    }


    if (
      !sendBtn
    ) {
      return;
    }


    if (
      state.generating
    ) {
      renderStopIcon();

      return;
    }


    renderSendIcon();


    const canSend =
      hasText() ||
      getReadyAttachments()
        .length >
        0;


    sendBtn.disabled =
      !canSend ||
      state.sending;


    sendBtn.classList.toggle(
      "is-ready",
      canSend &&
      !state.sending
    );


    sendBtn.classList.toggle(
      "is-disabled",
      !canSend ||
      state.sending
    );


    if (
      state.sending
    ) {
      sendBtn.setAttribute(
        "aria-busy",
        "true"
      );

    } else {
      sendBtn.removeAttribute(
        "aria-busy"
      );
    }
  }


  /* =====================================================
     HYBRID SEND
     ===================================================== */

  function compatibilitySend() {
    if (
      !state.active ||
      state.sending
    ) {
      return false;
    }


    if (
      state.generating
    ) {
      return requestStop();
    }


    const text =
      getText();


    const attachments =
      getReadyAttachments();


    if (
      !text &&
      attachments.length ===
      0
    ) {
      updateCompatibilityButton();

      return false;
    }


    const now =
      performance.now();


    if (
      now -
        state.lastSendAt <
      CONFIG.duplicateSendWindowMs
    ) {
      return false;
    }


    state.lastSendAt =
      now;


    state.sending =
      true;


    updateCompatibilityButton();


    /*
    -------------------------------------------------------
    Send directly into canonical chat event contract.

    This is only used when NeyoSendState itself is passive.
    -------------------------------------------------------
    */

    emit(
      "neyo:chat-send-request",
      {
        text,

        attachments
      }
    );


    clearText();


    removeSentAttachments(
      attachments
    );


    state.sending =
      false;


    state.routedSends +=
      1;


    updateCompatibilityButton();


    emit(
      "neyo:composer-message-dispatched",
      {
        text,

        attachmentCount:
          attachments.length,

        source:
          "chat-runtime-safe-hybrid"
      }
    );


    return true;
  }


  /* =====================================================
     REQUEST SEND
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
    Preferred path:
    active send-state owns send business rules.
    -------------------------------------------------------
    */

    if (
      sendController?.active ===
        true &&
      typeof sendController
        .send ===
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
          "[NEYO Runtime] Send-state routing failed:",
          error
        );
      }
    }


    /*
    -------------------------------------------------------
    Safe-hybrid fallback.

    send-state is present but passive because neo.js is
    still loaded.

    Runtime performs the small compatibility bridge.
    -------------------------------------------------------
    */

    return compatibilitySend();
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


    if (
      !state.generating
    ) {
      return false;
    }


    state.routedStops +=
      1;


    emit(
      "neyo:chat-stop-request"
    );


    return true;
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
     KEYBOARD / IME
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
      Shift + Enter = newline.
      */

      if (
        event.shiftKey
      ) {
        return;
      }


      /*
      Modifier shortcuts should not send.
      */

      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }


      /*
      IME safety.
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
      Enter never stops generation.

      User must click Stop.
      */

      if (
        state.generating
      ) {
        consumeLegacyEvent(
          event
        );

        return;
      }


      if (
        !hasText() &&
        getReadyAttachments()
          .length ===
        0
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
     INPUT STATE
     ===================================================== */

  chatInput
    ?.addEventListener(
      "input",
      () => {
        updateCompatibilityButton();
      }
    );


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
        updateCompatibilityButton();
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


      updateCompatibilityButton();


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


    updateCompatibilityButton();
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
      Ask canonical chat for current state.
      */

      emit(
        "neyo:chat-state-sync-request"
      );


      updateCompatibilityButton();


      emit(
        "neyo:runtime-ready",
        {
          version:
            VERSION,

          active:
            true,

          mode:
            "safe-hybrid",

          sendStateActive:
            window
              .NeyoSendState
              ?.active ===
            true
        }
      );


      debug(
        "ACTIVE",
        {
          version:
            VERSION,

          mode:
            "safe-hybrid",

          sendStateActive:
            window
              .NeyoSendState
              ?.active ===
            true,

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
        updateCompatibilityButton,

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
