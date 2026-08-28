/*
=========================================================
NEYO — SEND STATE CONTROLLER
CHATGPT-STANDARD v6

FILE:
public/js/components/send-state.js

BEHAVIOR
---------------------------------------------------------
Empty composer:
→ send disabled

Text typed:
→ send enabled

Ready attachment:
→ send enabled

Text + pending attachment:
→ text sends immediately

Text + failed attachment:
→ text sends immediately

Only pending attachment:
→ disabled

Only failed attachment:
→ disabled

Generating:
→ same button becomes STOP

IMPORTANT
---------------------------------------------------------
✅ send-state owns only send/stop UI
✅ attachments.js owns attachment lifecycle
✅ chat.js owns API/message generation
✅ no attachment error can block normal text chat
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-send-state-v6-chatgpt-standard";


  if (
    window.NeyoSendState
      ?.__controller ===
    true
  ) {
    console.warn(
      "[NEYO Send] Already initialized."
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


  if (
    !sendBtn ||
    !chatInput
  ) {
    console.warn(
      "[NEYO Send] Composer DOM missing."
    );

    return;
  }


  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    generating:
      false,

    composing:
      false,

    readyAttachments:
      0
  };


  /* =====================================================
     HELPERS
     ===================================================== */

  function getText() {
    return String(
      chatInput.value ||
      ""
    )
      .replace(
        /\r\n?/g,
        "\n"
      )
      .trim();
  }


  function hasText() {
    return (
      getText().length >
      0
    );
  }


  function getAttachmentController() {
    const controller =
      window.NeyoAttachments;


    if (
      controller &&
      typeof controller ===
      "object"
    ) {
      return controller;
    }


    return null;
  }


  function getReadyAttachments() {
    try {
      const controller =
        getAttachmentController();


      if (
        typeof controller
          ?.getReady !==
        "function"
      ) {
        return [];
      }


      const attachments =
        controller.getReady();


      return Array.isArray(
        attachments
      )
        ? attachments
        : [];

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Send] Could not read attachments:",
        error
      );


      return [];
    }
  }


  function syncAttachments() {
    state.readyAttachments =
      getReadyAttachments()
        .length;
  }


  /* =====================================================
     EVENTS
     ===================================================== */

  function emit(
    name,
    detail =
      {}
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
     ICONS
     ===================================================== */

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();

    } catch {}
  }


  function showSendIcon() {
    sendBtn.innerHTML = `
      <i
        data-lucide="arrow-up"
        size="18"
        aria-hidden="true"
      ></i>
    `;


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


  function showStopIcon() {
    sendBtn.innerHTML = `
      <i
        data-lucide="square"
        size="15"
        aria-hidden="true"
      ></i>
    `;


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


  /* =====================================================
     SEND AVAILABILITY
     ===================================================== */

  function canSend() {
    if (
      state.generating
    ) {
      return true;
    }


    if (
      hasText()
    ) {
      return true;
    }


    if (
      state.readyAttachments >
      0
    ) {
      return true;
    }


    return false;
  }


  /* =====================================================
     BUTTON UI
     ===================================================== */

  function updateButton() {
    syncAttachments();


    if (
      state.generating
    ) {
      sendBtn.disabled =
        false;


      sendBtn.classList.add(
        "is-generating"
      );


      sendBtn.classList.remove(
        "is-disabled"
      );


      showStopIcon();


      return;
    }


    showSendIcon();


    sendBtn.classList.remove(
      "is-generating"
    );


    const enabled =
      canSend();


    sendBtn.disabled =
      !enabled;


    sendBtn.classList.toggle(
      "is-disabled",
      !enabled
    );


    sendBtn.classList.toggle(
      "is-ready",
      enabled
    );
  }


  /* =====================================================
     SEND
     ===================================================== */

  function sendMessage() {
    syncAttachments();


    /*
    -------------------------------------------------------
    GENERATING → STOP
    -------------------------------------------------------
    */

    if (
      state.generating
    ) {
      emit(
        "neyo:chat-stop-request"
      );


      return true;
    }


    const text =
      getText();


    const readyAttachments =
      getReadyAttachments();


    /*
    -------------------------------------------------------
    Nothing usable to send.
    -------------------------------------------------------
    */

    if (
      !text &&
      readyAttachments.length ===
      0
    ) {
      updateButton();


      return false;
    }


    /*
    -------------------------------------------------------
    CHATGPT-STANDARD RULE

    Only READY attachments are included.

    Pending/error attachments are ignored and never block
    normal text sending.
    -------------------------------------------------------
    */

    emit(
      "neyo:chat-send-request",
      {
        text,

        attachments:
          readyAttachments
      }
    );


    /*
    -------------------------------------------------------
    Clear text after dispatch.
    -------------------------------------------------------
    */

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


    updateButton();


    return true;
  }


  /* =====================================================
     BUTTON CLICK
     ===================================================== */

  sendBtn.addEventListener(
    "click",
    event => {
      event.preventDefault();


      event.stopPropagation();


      event.stopImmediatePropagation();


      sendMessage();
    },
    true
  );


  /* =====================================================
     KEYBOARD
     ===================================================== */

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


  chatInput.addEventListener(
    "keydown",
    event => {
      if (
        event.key !==
        "Enter"
      ) {
        return;
      }


      /*
      -----------------------------------------------------
      IME input protection
      -----------------------------------------------------
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
      -----------------------------------------------------
      Shift + Enter = newline
      -----------------------------------------------------
      */

      if (
        event.shiftKey
      ) {
        return;
      }


      event.preventDefault();


      event.stopPropagation();


      event.stopImmediatePropagation();


      if (
        canSend()
      ) {
        sendMessage();
      }
    },
    true
  );


  /* =====================================================
     INPUT
     ===================================================== */

  chatInput.addEventListener(
    "input",
    () => {
      updateButton();
    }
  );


  /* =====================================================
     ATTACHMENTS
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-change",
    () => {
      updateButton();
    }
  );


  window.addEventListener(
    "neyo:attachment-ready",
    () => {
      updateButton();
    }
  );


  window.addEventListener(
    "neyo:attachment-error",
    () => {
      /*
       * Error attachment must NOT block text.
       */
      updateButton();
    }
  );


  window.addEventListener(
    "neyo:attachment-removed",
    () => {
      updateButton();
    }
  );


  /* =====================================================
     CHAT GENERATION START
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {
      state.generating =
        true;


      updateButton();
    }
  );


  /* =====================================================
     CHAT FINISHED
     ===================================================== */

  function generationFinished() {
    state.generating =
      false;


    updateButton();
  }


  window.addEventListener(
    "neyo:chat-send-end",
    generationFinished
  );


  window.addEventListener(
    "neyo:chat-response",
    generationFinished
  );


  window.addEventListener(
    "neyo:chat-error",
    generationFinished
  );


  window.addEventListener(
    "neyo:chat-aborted",
    generationFinished
  );


  window.addEventListener(
    "neyo:chat-limit-reached",
    generationFinished
  );


  window.addEventListener(
    "neyo:chat-new",
    generationFinished
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

      send:
        sendMessage,

      update:
        updateButton,

      setGenerating(
        value
      ) {
        state.generating =
          Boolean(
            value
          );


        updateButton();
      },

      getState() {
        syncAttachments();


        return {
          version:
            VERSION,

          generating:
            state.generating,

          hasText:
            hasText(),

          readyAttachments:
            state.readyAttachments,

          canSend:
            canSend()
        };
      }
    });


  Object.defineProperty(
    window,
    "NeyoSendState",
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

  updateButton();


  console.log(
    "[NEYO Send] ChatGPT-standard v6 ready.",
    {
      textChatBlockedByAttachmentError:
        false,

      textChatBlockedByPendingAttachment:
        false,

      buttonOwns:
        "send-stop-only"
    }
  );

})();
