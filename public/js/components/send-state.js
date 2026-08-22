/*
=========================================================
NEYO — SEND STATE
FINAL CLEAN v1

FILE:
public/js/components/send-state.js

OWNS
---------------------------------------------------------
- #sendBtn
- Enter to send
- Shift+Enter newline
- IME composition protection
- Send / Stop visual state
- Composer send availability
- Ready attachment collection

DOES NOT OWN
---------------------------------------------------------
- /api/chat
- Conversation state
- Message rendering
- Markdown
- Attachment upload / retry / remove
- History
- Voice
- Sidebar

RULES
---------------------------------------------------------
Empty:
→ disabled

Text:
→ enabled

Ready attachment:
→ enabled

Text + pending/error attachment:
→ text sends normally

Only pending/error attachment:
→ disabled

Generating:
→ same button becomes Stop
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-send-state-final-clean-v1";


  if (
    window.NeyoSendState?.__controller ===
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
      "[NEYO Send] Required composer elements are missing."
    );

    return;
  }


  /* =====================================================
     STATE
     ===================================================== */

  const state =
    {
      generating:
        false,

      composing:
        false
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
     INPUT
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


  /* =====================================================
     ATTACHMENTS
     ===================================================== */

  function getReadyAttachments() {
    try {
      const controller =
        window.NeyoAttachments;


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
        "[NEYO Send] Could not read ready attachments:",
        error
      );


      return [];
    }
  }


  /* =====================================================
     AVAILABILITY
     ===================================================== */

  function canSend() {
    if (
      state.generating
    ) {
      return true;
    }


    return (
      hasText() ||
      getReadyAttachments()
        .length >
        0
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


  function renderSendButton() {
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


    sendBtn.setAttribute(
      "data-tooltip",
      "Send message"
    );


    refreshIcons();
  }


  function renderStopButton() {
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


    sendBtn.setAttribute(
      "data-tooltip",
      "Stop generating"
    );


    refreshIcons();
  }


  /* =====================================================
     BUTTON STATE
     ===================================================== */

  function update() {
    if (
      state.generating
    ) {
      sendBtn.disabled =
        false;


      sendBtn.classList.add(
        "is-generating"
      );


      sendBtn.classList.remove(
        "is-ready",
        "is-disabled"
      );


      renderStopButton();


      return;
    }


    const enabled =
      canSend();


    sendBtn.disabled =
      !enabled;


    sendBtn.classList.remove(
      "is-generating"
    );


    sendBtn.classList.toggle(
      "is-ready",
      enabled
    );


    sendBtn.classList.toggle(
      "is-disabled",
      !enabled
    );


    renderSendButton();
  }


  /* =====================================================
     SEND / STOP
     ===================================================== */

  function requestAction() {
    /*
    -------------------------------------------------------
    Generating → Stop
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


    const attachments =
      getReadyAttachments();


    /*
    -------------------------------------------------------
    Nothing usable.
    -------------------------------------------------------
    */

    if (
      !text &&
      attachments.length ===
        0
    ) {
      update();


      return false;
    }


    /*
    -------------------------------------------------------
    Only ready files are sent.

    Pending / failed files never block normal text.
    -------------------------------------------------------
    */

    emit(
      "neyo:chat-send-request",
      {
        text,

        attachments
      }
    );


    /*
    -------------------------------------------------------
    Clear composer only after valid dispatch.
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


    update();


    return true;
  }


  /* =====================================================
     BUTTON
     ===================================================== */

  sendBtn.addEventListener(
    "click",
    event => {
      event.preventDefault();


      requestAction();
    }
  );


  /* =====================================================
     IME
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


  /* =====================================================
     KEYBOARD
     ===================================================== */

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
      IME composition must never trigger send.
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


      if (
        canSend()
      ) {
        requestAction();
      }
    }
  );


  /* =====================================================
     INPUT STATE
     ===================================================== */

  chatInput.addEventListener(
    "input",
    update
  );


  /* =====================================================
     ATTACHMENT STATE
     ===================================================== */

  const attachmentEvents =
    [
      "neyo:attachments-change",
      "neyo:attachment-ready",
      "neyo:attachment-error",
      "neyo:attachment-removed"
    ];


  attachmentEvents.forEach(
    eventName => {
      window.addEventListener(
        eventName,
        update
      );
    }
  );


  /* =====================================================
     GENERATION STATE
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {
      state.generating =
        true;


      update();
    }
  );


  function generationEnded() {
    if (
      state.generating ===
      false
    ) {
      return;
    }


    state.generating =
      false;


    update();
  }


  /*
  ---------------------------------------------------------
  chat.js always emits send-end in finally.

  These extra events are only defensive fallbacks in case
  another compatible chat controller is used.
  ---------------------------------------------------------
  */

  [
    "neyo:chat-send-end",
    "neyo:chat-aborted",
    "neyo:chat-error",
    "neyo:chat-limit-reached",
    "neyo:chat-new"
  ]
    .forEach(
      eventName => {
        window.addEventListener(
          eventName,
          generationEnded
        );
      }
    );


  /* =====================================================
     STATE SYNC
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state",
    event => {
      const generating =
        event.detail
          ?.generating;


      if (
        typeof generating ===
        "boolean"
      ) {
        state.generating =
          generating;


        update();
      }
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

      send:
        requestAction,

      update,

      canSend,

      setGenerating(
        value
      ) {
        state.generating =
          Boolean(
            value
          );


        update();
      },

      getState:
        () => ({
          version:
            VERSION,

          generating:
            state.generating,

          composing:
            state.composing,

          hasText:
            hasText(),

          readyAttachments:
            getReadyAttachments()
              .length,

          canSend:
            canSend()
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
     INIT
     ===================================================== */

  update();


  /*
  ---------------------------------------------------------
  Ask chat.js for authoritative generation state if it is
  already active.
  ---------------------------------------------------------
  */

  emit(
    "neyo:chat-state-sync-request"
  );


  emit(
    "neyo:send-state-ready",
    {
      version:
        VERSION
    }
  );

})();
