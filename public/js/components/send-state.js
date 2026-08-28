/*
=========================================================
NEYO — SEND / STOP CONTROLLER
FULL MODULAR RUNTIME v8.1

FILE:
public/js/components/send-state.js

OWNS
- #sendBtn
- Enter to send
- Shift+Enter newline
- Send / Stop visual state
- Dispatch to chat.js
- Sent-ready attachment cleanup

DOES NOT OWN
- /api/chat
- conversation state
- message DOM
- attachment uploads
- composer autosize

IMPORTANT
- Modular NeyoChat is authoritative.
- neo.js may remain loaded for legacy UI/features.
- neo.js must NOT disable this controller.
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-send-state-modular-v8.1-single-owner";


  if (
    window.NeyoSendState
      ?.__controller === true
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
      "[NEYO Send] Required composer DOM missing."
    );

    return;
  }


  /* =====================================================
     OWNERSHIP
     ===================================================== */

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


  /*
   * Correct ownership rule:
   *
   * NeyoChat.__controller means the modular chat core
   * exists and is ready to receive send events.
   *
   * neo.js may still be loaded, but that must NOT
   * disable the modular send controller.
   */

  const modularChatReady =
    window.NeyoChat
      ?.__controller === true;


  const active =
    modularChatReady;


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

  const emit =
    (
      name,
      detail = {}
    ) => {

      window.dispatchEvent(
        new CustomEvent(
          name,
          {
            detail
          }
        )
      );

    };


  /* =====================================================
     TEXT
     ===================================================== */

  const getRawText =
    () =>
      String(
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


  const getText =
    () =>
      getRawText()
        .trim();


  const hasText =
    () =>
      getText()
        .length >
      0;


  /* =====================================================
     ATTACHMENTS
     ===================================================== */

  const attachmentController =
    () => {

      const controller =
        window.NeyoAttachments;


      return (
        controller &&
        typeof controller ===
          "object"
      )
        ? controller
        : null;

    };


  const getAllAttachments =
    () => {

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

    };


  const getReadyAttachments =
    () => {

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

    };


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

      } else if (
        item?.status ===
          "error"
      ) {

        state.failedAttachments +=
          1;

      } else {

        state.pendingAttachments +=
          1;

      }

    }

  }


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

      if (
        !item?.id
      ) {
        continue;
      }


      try {

        controller.remove(
          item.id
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

  const refreshIcons =
    () => {

      try {

        window.lucide
          ?.createIcons
          ?.();

      } catch {}

    };


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

    if (
      !active
    ) {
      return false;
    }


    /*
     * During generation the button becomes STOP,
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


    return (
      state.readyAttachments >
      0
    );

  }


  /* =====================================================
     BUTTON UI
     ===================================================== */

  function updateButton() {

    syncAttachments();


    /*
     * If modular chat isn't ready yet, don't incorrectly
     * enable the send transport.
     */

    if (
      !active
    ) {

      sendBtn.disabled =
        true;


      sendBtn.classList.remove(
        "is-generating",
        "is-ready"
      );


      sendBtn.classList.add(
        "is-disabled"
      );


      return false;

    }


    /* -----------------------------------------------------
       GENERATING → STOP
       ----------------------------------------------------- */

    if (
      state.generating
    ) {

      sendBtn.disabled =
        false;


      sendBtn.classList.add(
        "is-generating"
      );


      sendBtn.classList.remove(
        "is-disabled",
        "is-ready"
      );


      sendBtn.removeAttribute(
        "aria-busy"
      );


      renderStopIcon();


      return true;

    }


    /* -----------------------------------------------------
       NORMAL SEND STATE
       ----------------------------------------------------- */

    renderSendIcon();


    const enabled =
      canSend();


    sendBtn.disabled =
      !enabled;


    sendBtn.classList.remove(
      "is-generating"
    );


    sendBtn.classList.toggle(
      "is-disabled",
      !enabled
    );


    sendBtn.classList.toggle(
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
     CLEAR TEXT
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


    return true;

  }


  /* =====================================================
     SEND
     ===================================================== */

  function sendMessage() {

    if (
      !active
    ) {
      return false;
    }


    syncAttachments();


    /* -----------------------------------------------------
       GENERATING → STOP
       ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       NOTHING TO SEND
       ----------------------------------------------------- */

    if (
      !text &&
      readyAttachments.length ===
        0
    ) {

      updateButton();


      return false;

    }


    /* -----------------------------------------------------
       DUPLICATE SEND PROTECTION
       ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       CANONICAL SEND EVENT
       ----------------------------------------------------- */

    emit(
      "neyo:chat-send-request",
      {

        text,

        attachments:
          readyAttachments

      }
    );


    /* -----------------------------------------------------
       CLEAR COMPOSER
       ----------------------------------------------------- */

    clearText();


    /*
     * Remove only the READY attachments that were sent.
     * Upload controller remains owner of upload lifecycle.
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
     CLICK
     ===================================================== */

  function handleSendClick(
    event
  ) {

    if (
      !active
    ) {
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
     * Shift + Enter = newline.
     */

    if (
      event.shiftKey
    ) {
      return;
    }


    /*
     * Do not hijack modified Enter combinations.
     */

    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }


    /*
     * Enter must never accidentally behave as STOP.
     * STOP is explicit through send button while generating.
     */

    if (
      state.generating ||
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
     GENERATION STATE
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
     LISTENERS
     ===================================================== */

  if (
    active
  ) {

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
        updateButton
      );

    }


    window.addEventListener(
      "neyo:chat-send-start",
      generationStarted
    );


    for (
      const eventName
      of [
        "neyo:chat-send-end",
        "neyo:chat-response",
        "neyo:chat-error",
        "neyo:chat-aborted",
        "neyo:chat-limit-reached",
        "neyo:chat-new",
        "neyo:chat-state-loaded"
      ]
    ) {

      window.addEventListener(
        eventName,
        generationFinished
      );

    }


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

      modularChatReady,

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

          modularChatReady,

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


  /* =====================================================
     READY
     ===================================================== */

  emit(
    "neyo:send-state-ready",
    {

      version:
        VERSION,

      active,

      legacyOwnerActive:
        legacyScriptPresent,

      modularChatReady

    }
  );


  console.log(
    "[NEYO Send] Ready",
    {

      version:
        VERSION,

      active,

      legacyScriptPresent,

      modularChatReady,

      buttonOwner:
        "NeyoSendState"

    }
  );

})();
