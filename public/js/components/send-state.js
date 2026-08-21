/*
=========================================================
NEYO — SEND / STOP STATE CONTROLLER
FINAL v4 — CONFLICT FREE

FILE:
public/js/components/send-state.js

OWNS
---------------------------------------------------------
✅ #sendBtn click
✅ Enter to send
✅ Shift+Enter newline
✅ Stop-generation button state
✅ Attachment pending/error gating
✅ Send button visual state
✅ Queue send while attachment is processing
✅ Dispatch neyo:chat-send-request
✅ Dispatch neyo:chat-stop-request

DOES NOT OWN
---------------------------------------------------------
❌ /api/chat fetch
❌ Attachment upload
❌ File picker
❌ Message rendering
❌ History
❌ Voice recording
❌ Mascot
❌ neo.js

IMPORTANT
---------------------------------------------------------
This module is the ONLY NEW MODULE that owns #sendBtn.
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / DUPLICATE GUARD
     ===================================================== */

  const VERSION =
    "neyo-send-state-final-v4";


  if (
    window.NeyoSendState
      ?.__controller ===
    true
  ) {
    console.warn(
      "[NEYO Send] Controller already initialized."
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
      "[NEYO Send] Required composer DOM not found.",
      {
        sendBtn:
          Boolean(
            sendBtn
          ),

        chatInput:
          Boolean(
            chatInput
          )
      }
    );

    return;
  }


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      queuedSendTimeoutMs:
        180_000,

      debug:
        true
    });


  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    generating:
      false,

    attachmentsPending:
      false,

    attachmentsHaveErrors:
      false,

    attachmentCount:
      0,

    readyAttachmentCount:
      0,

    queuedSend:
      false,

    queuedText:
      "",

    queuedAt:
      0,

    queueTimer:
      null,

    composing:
      false
  };


  /* =====================================================
     DEBUG
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
      "[NEYO Send]",
      ...args
    );
  }


  /* =====================================================
     EVENT
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
     TEXT
     ===================================================== */

  function getInputText() {
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


  /* =====================================================
     ATTACHMENTS
     ===================================================== */

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


  function getAllAttachments() {
    try {
      const controller =
        getAttachmentController();


      if (
        typeof controller
          ?.getAll !==
        "function"
      ) {
        return [];
      }


      const attachments =
        controller.getAll();


      return Array.isArray(
        attachments
      )
        ? attachments
        : [];

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Send] Unable to read attachments:",
        error
      );


      return [];
    }
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
        "[NEYO Send] Unable to read ready attachments:",
        error
      );


      return [];
    }
  }


  function hasPendingAttachments() {
    try {
      return Boolean(
        getAttachmentController()
          ?.hasPending
          ?.()
      );

    } catch {
      return false;
    }
  }


  function hasAttachmentErrors() {
    try {
      return Boolean(
        getAttachmentController()
          ?.hasErrors
          ?.()
      );

    } catch {
      return false;
    }
  }


  /* =====================================================
     SYNC ATTACHMENT STATE
     ===================================================== */

  function syncAttachmentState() {
    const all =
      getAllAttachments();


    const ready =
      getReadyAttachments();


    state.attachmentCount =
      all.length;


    state.readyAttachmentCount =
      ready.length;


    state.attachmentsPending =
      hasPendingAttachments();


    state.attachmentsHaveErrors =
      hasAttachmentErrors();


    updateButtonState();


    return {
      all,
      ready
    };
  }


  /* =====================================================
     BUTTON ICONS
     ===================================================== */

  function renderSendIcon() {
    sendBtn.innerHTML = `
      <i
        data-lucide="arrow-up"
        size="18"
        aria-hidden="true"
      ></i>
    `;


    sendBtn.setAttribute(
      "title",
      "Send Message"
    );


    sendBtn.setAttribute(
      "data-tooltip",
      "Send message"
    );


    sendBtn.setAttribute(
      "aria-label",
      "Send message"
    );


    try {
      window
        .lucide
        ?.createIcons
        ?.();
    } catch {}
  }


  function renderStopIcon() {
    sendBtn.innerHTML = `
      <i
        data-lucide="square"
        size="16"
        aria-hidden="true"
      ></i>
    `;


    sendBtn.setAttribute(
      "title",
      "Stop"
    );


    sendBtn.setAttribute(
      "data-tooltip",
      "Stop generation"
    );


    sendBtn.setAttribute(
      "aria-label",
      "Stop generation"
    );


    try {
      window
        .lucide
        ?.createIcons
        ?.();
    } catch {}
  }


  /* =====================================================
     CAN SEND
     ===================================================== */

  function canSendNow() {
    if (
      state.generating
    ) {
      return false;
    }


    if (
      state.attachmentsPending
    ) {
      return false;
    }


    if (
      state.attachmentsHaveErrors
    ) {
      return false;
    }


    const text =
      getInputText();


    if (
      text
    ) {
      return true;
    }


    return (
      state.readyAttachmentCount >
      0
    );
  }


  /* =====================================================
     BUTTON STATE
     ===================================================== */

  function updateButtonState() {
    if (
      state.generating
    ) {
      sendBtn.disabled =
        false;


      sendBtn.classList.add(
        "is-generating"
      );


      sendBtn.classList.remove(
        "is-waiting-attachments"
      );


      renderStopIcon();


      return;
    }


    renderSendIcon();


    sendBtn.classList.remove(
      "is-generating"
    );


    sendBtn.classList.toggle(
      "is-waiting-attachments",
      state.attachmentsPending
    );


    sendBtn.disabled =
      !canSendNow();


    if (
      state.attachmentsPending
    ) {
      sendBtn.setAttribute(
        "title",
        "Preparing attachment"
      );


      sendBtn.setAttribute(
        "data-tooltip",
        "Preparing attachment"
      );


      sendBtn.setAttribute(
        "aria-label",
        "Preparing attachment"
      );

    } else if (
      state.attachmentsHaveErrors
    ) {
      sendBtn.setAttribute(
        "title",
        "Fix attachment error"
      );


      sendBtn.setAttribute(
        "data-tooltip",
        "Retry or remove failed attachment"
      );


      sendBtn.setAttribute(
        "aria-label",
        "Retry or remove failed attachment"
      );
    }
  }


  /* =====================================================
     CLEAR QUEUED SEND
     ===================================================== */

  function clearQueuedSend() {
    state.queuedSend =
      false;


    state.queuedText =
      "";


    state.queuedAt =
      0;


    if (
      state.queueTimer
    ) {
      window.clearTimeout(
        state.queueTimer
      );


      state.queueTimer =
        null;
    }
  }


  /* =====================================================
     QUEUE SEND
     ===================================================== */

  function queueSend(
    text
  ) {
    state.queuedSend =
      true;


    state.queuedText =
      text;


    state.queuedAt =
      Date.now();


    if (
      state.queueTimer
    ) {
      window.clearTimeout(
        state.queueTimer
      );
    }


    state.queueTimer =
      window.setTimeout(
        () => {
          if (
            !state.queuedSend
          ) {
            return;
          }


          clearQueuedSend();


          emit(
            "neyo:send-queue-expired",
            {
              message:
                "Attachment preparation took too long."
            }
          );


          updateButtonState();
        },
        CONFIG
          .queuedSendTimeoutMs
      );


    emit(
      "neyo:send-queued",
      {
        text,

        attachmentCount:
          state.attachmentCount
      }
    );


    debug(
      "Send queued while attachments are processing."
    );
  }


  /* =====================================================
     DISPATCH SEND
     ===================================================== */

  function dispatchSend(
    text
  ) {
    const readyAttachments =
      getReadyAttachments();


    const cleanText =
      String(
        text ||
        ""
      ).trim();


    if (
      !cleanText &&
      readyAttachments.length ===
        0
    ) {
      return false;
    }


    /*
     * Important:
     * clear composer text only when the request
     * is actually being handed to chat.js.
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


    clearQueuedSend();


    emit(
      "neyo:chat-send-request",
      {
        text:
          cleanText,

        attachments:
          readyAttachments
      }
    );


    return true;
  }


  /* =====================================================
     REQUEST SEND
     ===================================================== */

  function requestSend() {
    syncAttachmentState();


    if (
      state.generating
    ) {
      emit(
        "neyo:chat-stop-request"
      );


      return true;
    }


    const text =
      getInputText();


    /*
     * If attachments are still processing,
     * remember intent to send instead of
     * making user press Send again.
     */

    if (
      state.attachmentsPending
    ) {
      if (
        text ||
        state.attachmentCount >
          0
      ) {
        queueSend(
          text
        );
      }


      updateButtonState();


      return false;
    }


    /*
     * Do not silently ignore failed files.
     */

    if (
      state.attachmentsHaveErrors
    ) {
      emit(
        "neyo:send-blocked",
        {
          reason:
            "attachment-error",

          message:
            "Retry or remove failed attachments before sending."
        }
      );


      updateButtonState();


      return false;
    }


    return dispatchSend(
      text
    );
  }


  /* =====================================================
     AUTO-FLUSH QUEUED SEND
     ===================================================== */

  function flushQueuedSendIfReady() {
    if (
      !state.queuedSend
    ) {
      return false;
    }


    syncAttachmentState();


    if (
      state.generating ||
      state.attachmentsPending
    ) {
      return false;
    }


    if (
      state.attachmentsHaveErrors
    ) {
      clearQueuedSend();


      emit(
        "neyo:send-blocked",
        {
          reason:
            "attachment-error",

          message:
            "An attachment failed. Retry or remove it before sending."
        }
      );


      return false;
    }


    const queuedText =
      state.queuedText;


    return dispatchSend(
      queuedText
    );
  }


  /* =====================================================
     SEND BUTTON

     Capture phase intentionally prevents legacy
     send handlers from also firing.

     This is the new single owner of #sendBtn.
     ===================================================== */

  sendBtn.addEventListener(
    "click",
    event => {
      event.preventDefault();

      event.stopPropagation();

      event
        .stopImmediatePropagation();


      requestSend();
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
       * IME:
       * Do not send while user is composing.
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
       * Shift + Enter = newline.
       */

      if (
        event.shiftKey
      ) {
        return;
      }


      /*
       * Ctrl/Cmd + Enter also sends naturally.
       * Plain Enter sends too.
       */

      event.preventDefault();

      event.stopPropagation();

      event
        .stopImmediatePropagation();


      requestSend();
    },
    true
  );


  /* =====================================================
     INPUT STATE
     ===================================================== */

  chatInput.addEventListener(
    "input",
    () => {
      updateButtonState();
    }
  );


  /* =====================================================
     ATTACHMENT CHANGE
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-change",
    event => {
      const detail =
        event.detail ||
        {};


      state.attachmentCount =
        Number(
          detail.count
        ) ||
        0;


      state.readyAttachmentCount =
        Number(
          detail.ready
        ) ||
        0;


      state.attachmentsPending =
        Boolean(
          detail.pending
        );


      state.attachmentsHaveErrors =
        Number(
          detail.errors
        ) >
        0;


      updateButtonState();


      if (
        state.queuedSend
      ) {
        flushQueuedSendIfReady();
      }
    }
  );


  /* =====================================================
     ATTACHMENT READY
     ===================================================== */

  window.addEventListener(
    "neyo:attachment-ready",
    () => {
      syncAttachmentState();


      if (
        state.queuedSend
      ) {
        flushQueuedSendIfReady();
      }
    }
  );


  /* =====================================================
     ATTACHMENT ERROR
     ===================================================== */

  window.addEventListener(
    "neyo:attachment-error",
    () => {
      syncAttachmentState();


      if (
        state.queuedSend
      ) {
        clearQueuedSend();
      }


      updateButtonState();
    }
  );


  /* =====================================================
     CHAT START
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {
      state.generating =
        true;


      updateButtonState();
    }
  );


  /* =====================================================
     CHAT END
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-end",
    () => {
      state.generating =
        false;


      syncAttachmentState();


      updateButtonState();
    }
  );


  /* =====================================================
     CHAT RESPONSE
     ===================================================== */

  window.addEventListener(
    "neyo:chat-response",
    () => {
      state.generating =
        false;


      updateButtonState();
    }
  );


  /* =====================================================
     CHAT ERROR
     ===================================================== */

  window.addEventListener(
    "neyo:chat-error",
    () => {
      state.generating =
        false;


      /*
       * chat.js keeps attachments on error,
       * so the user can retry.
       */

      syncAttachmentState();


      updateButtonState();
    }
  );


  /* =====================================================
     CHAT ABORT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-aborted",
    () => {
      state.generating =
        false;


      syncAttachmentState();


      updateButtonState();
    }
  );


  /* =====================================================
     CHAT LIMIT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-limit-reached",
    () => {
      state.generating =
        false;


      syncAttachmentState();


      updateButtonState();
    }
  );


  /* =====================================================
     NEW CONVERSATION
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      clearQueuedSend();


      state.generating =
        false;


      syncAttachmentState();


      updateButtonState();
    }
  );


  /* =====================================================
     PAGE CLEANUP
     ===================================================== */

  window.addEventListener(
    "pagehide",
    () => {
      clearQueuedSend();
    },
    {
      once:
        true
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

      requestSend,

      update:
        () => {
          syncAttachmentState();

          updateButtonState();
        },

      cancelQueuedSend:
        clearQueuedSend,

      getState:
        () => ({
          version:
            VERSION,

          generating:
            state.generating,

          attachmentsPending:
            state.attachmentsPending,

          attachmentsHaveErrors:
            state.attachmentsHaveErrors,

          attachmentCount:
            state.attachmentCount,

          readyAttachmentCount:
            state.readyAttachmentCount,

          queuedSend:
            state.queuedSend,

          canSend:
            canSendNow()
        })
    });


  Object.defineProperty(
    window,
    "NeyoSendState",
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
     INITIALIZE
     ===================================================== */

  syncAttachmentState();


  updateButtonState();


  debug(
    "FINAL v4 READY",
    {
      version:
        VERSION,

      sendButtonOwned:
        true,

      attachmentsController:
        Boolean(
          window
            .NeyoAttachments
        ),

      chatController:
        Boolean(
          window
            .NeyoChat
        )
    }
  );

})();
