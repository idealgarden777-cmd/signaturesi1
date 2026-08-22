/*
=========================================================
NEYO — SEND / STOP CONTROLLER
FULL MODULAR RUNTIME

OWNS:
- #sendBtn
- Enter to send
- Shift+Enter newline
- IME-safe keyboard handling
- Send / Stop visual state
- Dispatch to chat.js
- Sent attachment cleanup

DOES NOT OWN:
- /api/chat
- conversation state
- message DOM
- attachment uploading
- composer autosize
- voice
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-send-state-modular-v1";

  if (
    window.NeyoSendState
      ?.__controller === true
  ) {
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
      "[NEYO Send] Required composer DOM missing."
    );

    return;
  }


  /* =====================================================
     RUNTIME OWNERSHIP

     While neo.js still exists and modular chat is passive,
     DO NOT create a second Send owner.

     After neo.js is removed:
     NeyoChat.active === true
     → this file becomes the real owner.
     ===================================================== */

  const legacyScriptPresent =
    Array
      .from(
        document.scripts ||
        []
      )
      .some(
        script =>
          /(?:^|\/)neo\.js(?:\?|$)/
            .test(
              script.src ||
              ""
            )
      );


  const modularChatActive =
    window.NeyoChat
      ?.active === true;


  const active =
    modularChatActive &&
    !legacyScriptPresent;


  /* =====================================================
     STATE
     ===================================================== */

  const state = {

    generating:
      false,

    composing:
      false,

    sending:
      false,

    readyAttachments:
      0,

    pendingAttachments:
      0,

    failedAttachments:
      0,

    lastSendAt:
      0
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
     TEXT
     ===================================================== */

  function getRawText() {

    return String(
      chatInput.value ||
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


  /* =====================================================
     ATTACHMENTS
     ===================================================== */

  function attachmentController() {

    const controller =
      window.NeyoAttachments;


    return (
      controller &&
      typeof controller ===
        "object"
    )
      ? controller
      : null;
  }


  function getAllAttachments() {

    try {

      const value =
        attachmentController()
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
        "[NEYO Send] Could not read attachments:",
        error
      );


      return [];
    }
  }


  function getReadyAttachments() {

    try {

      const value =
        attachmentController()
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
        "[NEYO Send] Could not read ready attachments:",
        error
      );


      return [];
    }
  }


  function syncAttachments() {

    const all =
      getAllAttachments();


    state.readyAttachments =
      0;


    state.pendingAttachments =
      0;


    state.failedAttachments =
      0;


    for (
      const item
      of all
    ) {

      if (
        item?.ready === true &&
        item?.status ===
          "ready"
      ) {

        state.readyAttachments +=
          1;


        continue;
      }


      if (
        item?.status ===
          "error"
      ) {

        state.failedAttachments +=
          1;


        continue;
      }


      state.pendingAttachments +=
        1;
    }
  }


  /* =====================================================
     CLEAN UP ONLY FILES THAT WERE SENT

     Pending/error files remain in composer.
     ===================================================== */

  function removeSentAttachments(
    sent
  ) {

    const controller =
      attachmentController();


    if (
      !controller ||
      typeof controller.remove !==
        "function" ||
      !Array.isArray(
        sent
      )
    ) {
      return;
    }


    for (
      const item
      of sent
    ) {

      const id =
        item?.id;


      if (!id) {
        continue;
      }


      try {

        controller.remove(
          id
        );

      } catch (
        error
      ) {

        console.warn(
          "[NEYO Send] Could not remove sent attachment:",
          error
        );
      }
    }
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


  function renderSendIcon() {

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


    sendBtn.dataset.tooltip =
      "Send message";


    refreshIcons();
  }


  function renderStopIcon() {

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


    sendBtn.dataset.tooltip =
      "Stop generating";


    refreshIcons();
  }


  /* =====================================================
     CAN SEND
     ===================================================== */

  function canSend() {

    if (!active) {
      return false;
    }


    /*
     * Generating means button is STOP,
     * therefore it must remain clickable.
     */

    if (
      state.generating
    ) {
      return true;
    }


    if (
      state.sending
    ) {
      return false;
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


    /*
     * Pending-only or failed-only attachments
     * are NOT a valid message by themselves.
     */

    return false;
  }


  /* =====================================================
     BUTTON UI
     ===================================================== */

  function updateButton() {

    syncAttachments();


    /*
     * Passive until modular runtime
     * becomes the actual owner.
     */

    if (!active) {

      return false;
    }


    if (
      state.generating
    ) {

      sendBtn.disabled =
        false;


      sendBtn.classList
        .add(
          "is-generating"
        );


      sendBtn.classList
        .remove(
          "is-disabled",
          "is-ready"
        );


      sendBtn.setAttribute(
        "aria-busy",
        "false"
      );


      renderStopIcon();


      return true;
    }


    renderSendIcon();


    sendBtn.classList
      .remove(
        "is-generating"
      );


    const enabled =
      canSend();


    sendBtn.disabled =
      !enabled;


    sendBtn.classList
      .toggle(
        "is-disabled",
        !enabled
      );


    sendBtn.classList
      .toggle(
        "is-ready",
        enabled
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


    return enabled;
  }


  /* =====================================================
     CLEAR COMPOSER TEXT
     ===================================================== */

  function clearText() {

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
     STOP
     ===================================================== */

  function stopGeneration() {

    if (
      !active ||
      !state.generating
    ) {
      return false;
    }


    emit(
      "neyo:chat-stop-request"
    );


    /*
     * Do NOT immediately flip generating=false.
     *
     * chat.js owns actual AbortController state
     * and will emit neyo:chat-aborted/send-end.
     */

    return true;
  }


  /* =====================================================
     SEND
     ===================================================== */

  function sendMessage() {

    if (!active) {
      return false;
    }


    syncAttachments();


    /*
     * SAME BUTTON = STOP
     */

    if (
      state.generating
    ) {

      return stopGeneration();
    }


    if (
      state.sending
    ) {
      return false;
    }


    const text =
      getText();


    const readyAttachments =
      getReadyAttachments();


    /*
     * Nothing usable.
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
     * Very small double-click protection.
     *
     * chat.js has its own duplicate-generation
     * protection as the second safety layer.
     */

    const now =
      performance.now();


    if (
      now -
      state.lastSendAt <
      180
    ) {

      return false;
    }


    state.lastSendAt =
      now;


    state.sending =
      true;


    updateButton();


    /*
     * Synchronous event dispatch.
     *
     * chat.js receives a copy before
     * composer text/files are cleared.
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
     * ChatGPT-style:
     * composer becomes ready for next input
     * immediately after dispatch.
     */

    clearText();


    /*
     * Remove ONLY files included in this send.
     *
     * Pending/error attachments remain visible.
     */

    removeSentAttachments(
      readyAttachments
    );


    state.sending =
      false;


    updateButton();


    emit(
      "neyo:composer-message-dispatched",
      {
        text,

        attachmentCount:
          readyAttachments.length
      }
    );


    return true;
  }


  /* =====================================================
     BUTTON CLICK
     ===================================================== */

  function handleSendClick(
    event
  ) {

    if (!active) {
      return;
    }


    event.preventDefault();

    event.stopPropagation();

    event.stopImmediatePropagation();


    sendMessage();
  }


  /* =====================================================
     KEYBOARD
     ===================================================== */

  function handleKeyDown(
    event
  ) {

    if (
      !active ||
      event.key !==
        "Enter"
    ) {
      return;
    }


    /*
     * IME / East Asian input protection.
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
     * Shift+Enter:
     * newline.
     */

    if (
      event.shiftKey
    ) {
      return;
    }


    /*
     * Alt/Ctrl/Meta + Enter:
     * leave untouched for browser/app shortcuts.
     */

    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }


    /*
     * During generation Enter should NOT stop.
     * Stop is explicit button interaction only.
     */

    if (
      state.generating
    ) {
      return;
    }


    if (
      !canSend()
    ) {
      return;
    }


    event.preventDefault();

    event.stopPropagation();

    event.stopImmediatePropagation();


    sendMessage();
  }


  /* =====================================================
     GENERATION LIFECYCLE
     ===================================================== */

  function generationStarted() {

    state.generating =
      true;


    state.sending =
      false;


    updateButton();
  }


  function generationFinished() {

    state.generating =
      false;


    state.sending =
      false;


    updateButton();
  }


  /* =====================================================
     ACTIVE EVENT BINDINGS
     ===================================================== */

  if (active) {

    sendBtn.addEventListener(
      "click",
      handleSendClick,
      true
    );


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
      handleKeyDown,
      true
    );


    chatInput.addEventListener(
      "input",
      updateButton
    );


    /* -------------------------------------------------
       ATTACHMENT STATE
       ------------------------------------------------- */

    window.addEventListener(
      "neyo:attachments-change",
      updateButton
    );


    window.addEventListener(
      "neyo:attachment-ready",
      updateButton
    );


    window.addEventListener(
      "neyo:attachment-error",
      updateButton
    );


    window.addEventListener(
      "neyo:attachment-removed",
      updateButton
    );


    /* -------------------------------------------------
       CHAT LIFECYCLE
       ------------------------------------------------- */

    window.addEventListener(
      "neyo:chat-send-start",
      generationStarted
    );


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


    window.addEventListener(
      "neyo:chat-state-loaded",
      generationFinished
    );


    updateButton();
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


      active,


      legacyOwnerActive:
        legacyScriptPresent,


      send:
        sendMessage,


      stop:
        stopGeneration,


      update:
        updateButton,


      canSend,


      setGenerating(
        value
      ) {

        state.generating =
          Boolean(
            value
          );


        updateButton();


        return state.generating;
      },


      getState() {

        syncAttachments();


        return {

          version:
            VERSION,


          active,


          legacyOwnerActive:
            legacyScriptPresent,


          generating:
            state.generating,


          sending:
            state.sending,


          composing:
            state.composing,


          hasText:
            hasText(),


          readyAttachments:
            state.readyAttachments,


          pendingAttachments:
            state.pendingAttachments,


          failedAttachments:
            state.failedAttachments,


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


  emit(
    "neyo:send-state-ready",
    {
      version:
        VERSION,

      active,

      legacyOwnerActive:
        legacyScriptPresent
    }
  );

})();
