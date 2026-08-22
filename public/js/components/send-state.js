/*
=========================================================
NEYO — SEND / STOP STATE CONTROLLER
FINAL v5 — CHAT-FIRST + ATTACHMENT-SAFE

FILE:
public/js/components/send-state.js

OWNS
---------------------------------------------------------
✅ #sendBtn click
✅ Enter to send
✅ Shift+Enter newline
✅ Stop-generation button state
✅ Attachment-aware send state
✅ Text chat continues even if attachment fails
✅ Ready attachments only are sent
✅ Pending/error attachments never block normal text
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

KEY BEHAVIOR
---------------------------------------------------------
TEXT + failed attachment:
→ send text only

TEXT + pending attachment:
→ send text only immediately

NO TEXT + ready attachment:
→ send attachment

NO TEXT + pending attachment:
→ wait / disable

NO TEXT + failed attachment:
→ disable until retry/remove

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / DUPLICATE GUARD
     ===================================================== */

  const VERSION =
    "neyo-send-state-final-v5";


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


  function hasText() {
    return Boolean(
      getInputText()
    );
  }


  /* =====================================================
     ATTACHMENT CONTROLLER
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
     ICONS
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
      "Send message"
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


    const text =
      getInputText();


    /*
    -------------------------------------------------------
    Chat-first rule:
    if user typed text, attachment state never blocks send.
    -------------------------------------------------------
    */

    if (
      text
    ) {
      return true;
    }


    /*
    -------------------------------------------------------
    No text:
    only ready attachments can be sent.
    -------------------------------------------------------
    */

    if (
      state.readyAttachmentCount >
      0
    ) {
      return true;
    }


    return false;
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


    const text =
      getInputText();


    /*
    -------------------------------------------------------
    Waiting visual only when:
    - there is no text
    - attachments are pending
    -------------------------------------------------------
    */

    const waitingForAttachment =
      !text &&
      state.attachmentsPending;


    sendBtn.classList.toggle(
      "is-waiting-attachments",
      waitingForAttachment
    );


    sendBtn.disabled =
      !canSendNow();


    /*
    -------------------------------------------------------
    Tooltip behavior
    -------------------------------------------------------
    */

    if (
      text
    ) {
      sendBtn.setAttribute(
        "title",
        "Send message"
      );


      sendBtn.setAttribute(
        "data-tooltip",
        "Send message"
      );


      sendBtn.setAttribute(
        "aria-label",
        "Send message"
      );


      return;
    }


    if (
      state.readyAttachmentCount >
      0
    ) {
      sendBtn.setAttribute(
        "title",
        "Send attachment"
      );


      sendBtn.setAttribute(
        "data-tooltip",
        "Send attachment"
      );


      sendBtn.setAttribute(
        "aria-label",
        "Send attachment"
      );


      return;
    }


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


      return;
    }


    if (
      state.attachmentsHaveErrors
    ) {
      sendBtn.setAttribute(
        "title",
        "Attachment failed"
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
     DISPATCH SEND
     ===================================================== */

  function dispatchSend(
    text
  ) {
    const cleanText =
      String(
        text ||
        ""
      ).trim();


    const readyAttachments =
      getReadyAttachments();


    /*
    -------------------------------------------------------
    Never send pending/error attachments.

    getReadyAttachments() guarantees only usable attachments
    are handed to chat.js.
    -------------------------------------------------------
    */

    if (
      !cleanText &&
      readyAttachments.length ===
        0
    ) {
      return false;
    }


    const allAttachments =
      getAllAttachments();


    const ignoredAttachments =
      allAttachments.filter(
        attachment =>
          attachment?.ready !==
            true ||
          attachment?.status !==
            "ready"
      );


    if (
      ignoredAttachments.length >
      0 &&
      cleanText
    ) {
      debug(
        "Sending text while non-ready attachments are ignored.",
        {
          ignored:
            ignoredAttachments.map(
              item => ({
                name:
                  item.name,

                status:
                  item.status,

                error:
                  item.error ||
                  null
              })
            )
        }
      );


      emit(
        "neyo:attachments-ignored-for-send",
        {
          count:
            ignoredAttachments.length,

          attachments:
            ignoredAttachments
        }
      );
    }


    /*
    -------------------------------------------------------
    Clear composer only after valid send is ready.
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


    emit(
      "neyo:chat-send-request",
      {
        text:
          cleanText,

        attachments:
          readyAttachments
      }
    );


    debug(
      "SEND_REQUEST",
      {
        textLength:
          cleanText.length,

        readyAttachments:
          readyAttachments.length,

        totalAttachments:
          allAttachments.length
      }
    );


    return true;
  }


  /* =====================================================
     REQUEST SEND
     ===================================================== */

  function requestSend() {
    syncAttachmentState();


    /*
    -------------------------------------------------------
    Stop generation
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
      getInputText();


    /*
    -------------------------------------------------------
    CRITICAL FIX:
    Text messages always send immediately.

    Pending or failed attachments do NOT block normal chat.
    -------------------------------------------------------
    */

    if (
      text
    ) {
      return dispatchSend(
        text
      );
    }


    /*
    -------------------------------------------------------
    No text.

    If a ready attachment exists, send it.
    -------------------------------------------------------
    */

    if (
      state.readyAttachmentCount >
      0
    ) {
      return dispatchSend(
        ""
      );
    }


    /*
    -------------------------------------------------------
    No text + pending attachments:
    wait for them to finish.
    -------------------------------------------------------
    */

    if (
      state.attachmentsPending
    ) {
      emit(
        "neyo:send-blocked",
        {
          reason:
            "attachment-pending",

          message:
            "Attachment is still preparing."
        }
      );


      updateButtonState();


      return false;
    }


    /*
    -------------------------------------------------------
    No text + failed attachments:
    user must retry/remove because there is nothing else
    to send.
    -------------------------------------------------------
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
            "Retry or remove the failed attachment."
        }
      );


      updateButtonState();


      return false;
    }


    return false;
  }


  /* =====================================================
     SEND BUTTON
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
       * Do not send while IME composition is active.
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
    }
  );


  /* =====================================================
     ATTACHMENT READY
     ===================================================== */

  window.addEventListener(
    "neyo:attachment-ready",
    () => {
      syncAttachmentState();

      updateButtonState();
    }
  );


  /* =====================================================
     ATTACHMENT ERROR
     ===================================================== */

  window.addEventListener(
    "neyo:attachment-error",
    event => {
      syncAttachmentState();


      debug(
        "Attachment failed but normal text chat remains available.",
        event.detail ||
        {}
      );


      updateButtonState();
    }
  );


  /* =====================================================
     ATTACHMENT REMOVED
     ===================================================== */

  window.addEventListener(
    "neyo:attachment-removed",
    () => {
      syncAttachmentState();

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
      state.generating =
        false;


      syncAttachmentState();

      updateButtonState();
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
    "FINAL v5 READY",
    {
      version:
        VERSION,

      sendButtonOwned:
        true,

      chatFirst:
        true,

      failedAttachmentsBlockText:
        false,

      pendingAttachmentsBlockText:
        false,

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
