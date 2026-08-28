/*
=========================================================
NEYO — SEND / STOP CONTROLLER
FINAL SINGLE-OWNER VERSION

FILE:
public/js/components/send-state.js

OWNS
- #sendBtn
- Send / Stop visual state
- Enter to send
- Shift+Enter newline
- Ready attachment send eligibility
- Dispatch to chat.js

DOES NOT OWN
- /api/chat
- conversation state
- message rendering
- attachment uploads
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-send-state-final-v9";


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

    sending:
      false,

    composing:
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

      const controller =
        attachmentController();


      if (!controller) {
        return [];
      }


      const value =
        controller.getAll?.() ??
        controller.getFiles?.() ??
        [];


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

      const controller =
        attachmentController();


      if (!controller) {
        return [];
      }


      const direct =
        controller.getReady?.();


      if (
        Array.isArray(
          direct
        )
      ) {
        return direct;
      }


      return getAllAttachments()
        .filter(
          file => {

            const status =
              String(
                file?.status ||
                file?.state ||
                ""
              )
                .trim()
                .toLowerCase();


            return (
              status === "ready" ||
              status === "complete" ||
              status === "completed" ||
              status === "processed"
            );

          }
        );

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


  function classifyAttachments() {

    const all =
      getAllAttachments();


    let ready = 0;
    let pending = 0;
    let failed = 0;


    for (
      const file
      of all
    ) {

      const status =
        String(
          file?.status ||
          file?.state ||
          ""
        )
          .trim()
          .toLowerCase();


      if (
        status === "ready" ||
        status === "complete" ||
        status === "completed" ||
        status === "processed"
      ) {

        ready += 1;

        continue;

      }


      if (
        status === "error" ||
        status === "failed"
      ) {

        failed += 1;

        continue;

      }


      pending += 1;

    }


    state.readyAttachments =
      ready;


    state.pendingAttachments =
      pending;


    state.failedAttachments =
      failed;


    return {
      ready,
      pending,
      failed,
      total:
        all.length
    };

  }


  function removeSentAttachments(
    attachments
  ) {

    const controller =
      attachmentController();


    if (
      !controller ||
      typeof controller.remove !==
        "function" ||
      !Array.isArray(
        attachments
      )
    ) {
      return;
    }


    for (
      const file
      of attachments
    ) {

      const id =
        file?.id ||
        file?.uploadId ||
        null;


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
     SEND ELIGIBILITY
     ===================================================== */

  function canSend() {

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


    classifyAttachments();


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
     ICON HELPERS
     ===================================================== */

  function refreshIcons() {

    try {

      window.lucide
        ?.createIcons
        ?.();

    } catch {}

  }


  /* =====================================================
     SEND ICON
     ===================================================== */

  function renderSendIcon() {

    sendBtn.classList.remove(
      "is-generating"
    );


    sendBtn.removeAttribute(
      "aria-busy"
    );


    sendBtn.setAttribute(
      "aria-label",
      "Send message"
    );


    sendBtn.dataset.tooltip =
      "Send";


    sendBtn.removeAttribute(
      "title"
    );


    sendBtn.replaceChildren();


    const icon =
      document.createElement(
        "i"
      );


    icon.setAttribute(
      "data-lucide",
      "arrow-up"
    );


    icon.setAttribute(
      "size",
      "18"
    );


    icon.setAttribute(
      "aria-hidden",
      "true"
    );


    sendBtn.appendChild(
      icon
    );


    refreshIcons();

  }


  /* =====================================================
     STOP ICON
     ===================================================== */

  function renderStopIcon() {

    sendBtn.disabled =
      false;


    sendBtn.classList.add(
      "is-generating"
    );


    sendBtn.classList.remove(
      "is-disabled",
      "is-ready"
    );


    sendBtn.setAttribute(
      "aria-disabled",
      "false"
    );


    sendBtn.setAttribute(
      "aria-label",
      "Stop generating"
    );


    sendBtn.dataset.tooltip =
      "Stop";


    sendBtn.removeAttribute(
      "title"
    );


    sendBtn.removeAttribute(
      "aria-busy"
    );


    sendBtn.replaceChildren();


    /*
     * Old working solid STOP square.
     */

    const square =
      document.createElement(
        "span"
      );


    square.className =
      "send-stop-square";


    square.setAttribute(
      "aria-hidden",
      "true"
    );


    /*
     * Inline fallback guarantees visibility even if
     * old CSS selector is missing.
     */

    square.style.display =
      "block";

    square.style.width =
      "11px";

    square.style.height =
      "11px";

    square.style.minWidth =
      "11px";

    square.style.minHeight =
      "11px";

    square.style.borderRadius =
      "2.5px";

    square.style.background =
      "currentColor";

    square.style.pointerEvents =
      "none";


    sendBtn.appendChild(
      square
    );

  }


  /* =====================================================
     BUTTON UI
     ===================================================== */

  function renderButton() {

    classifyAttachments();


    if (
      state.generating
    ) {

      renderStopIcon();

      return true;

    }


    const enabled =
      canSend();


    sendBtn.disabled =
      !enabled;


    sendBtn.setAttribute(
      "aria-disabled",
      String(
        !enabled
      )
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


    renderSendIcon();


    return enabled;

  }


  /* =====================================================
     CLEAR COMPOSER
     ===================================================== */

  function clearComposer() {

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
     STOP REQUEST
     ===================================================== */

  function requestStop() {

    if (
      !state.generating
    ) {
      return false;
    }


    emit(
      "neyo:chat-stop-request",
      {
        reason:
          "user"
      }
    );


    return true;

  }


  /* =====================================================
     SEND REQUEST
     ===================================================== */

  function requestSend() {

    if (
      state.generating
    ) {

      return requestStop();

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


    if (
      !text &&
      readyAttachments.length ===
        0
    ) {

      renderButton();

      return false;

    }


    const now =
      Date.now();


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


    /*
     * Immediately enter STOP mode.
     *
     * This guarantees visual feedback before the
     * backend/network request begins.
     */

    state.generating =
      true;


    renderButton();


    emit(
      "neyo:chat-send-request",
      {

        text,

        attachments:
          readyAttachments

      }
    );


    clearComposer();


    removeSentAttachments(
      readyAttachments
    );


    state.sending =
      false;


    /*
     * Do NOT set generating=false here.
     *
     * It stays true until:
     * response
     * error
     * abort
     * send-end
     */


    renderButton();


    return true;

  }


  /* =====================================================
     CLICK
     ===================================================== */

  function handleSendClick(
    event
  ) {

    const target =
      event.target;


    if (
      !(
        target instanceof
        Element
      )
    ) {
      return;
    }


    if (
      !target.closest(
        "#sendBtn"
      )
    ) {
      return;
    }


    event.preventDefault();


    event.stopPropagation();


    event.stopImmediatePropagation();


    if (
      state.generating
    ) {

      requestStop();

    } else {

      requestSend();

    }

  }


  document.addEventListener(
    "click",
    handleSendClick,
    true
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


      renderButton();

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


      if (
        event.isComposing ||
        state.composing ||
        event.keyCode ===
          229
      ) {
        return;
      }


      if (
        event.shiftKey
      ) {
        return;
      }


      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }


      /*
       * Enter must NOT stop generation.
       */

      if (
        state.generating
      ) {

        event.preventDefault();

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


      requestSend();

    },
    true
  );


  /* =====================================================
     INPUT
     ===================================================== */

  chatInput.addEventListener(
    "input",
    renderButton
  );


  /* =====================================================
     ATTACHMENT EVENTS
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
      renderButton
    );

  }


  /* =====================================================
     GENERATION START
     ===================================================== */

  function generationStarted() {

    state.generating =
      true;


    state.sending =
      false;


    renderButton();

  }


  window.addEventListener(
    "neyo:chat-send-start",
    generationStarted
  );


  /* =====================================================
     GENERATION FINISH
     ===================================================== */

  function generationFinished() {

    state.generating =
      false;


    state.sending =
      false;


    renderButton();

  }


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


  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({

      __controller:
        true,

      version:
        VERSION,

      active:
        true,

      send:
        requestSend,

      stop:
        requestStop,

      update:
        renderButton,

      canSend,


      setGenerating(
        value
      ) {

        state.generating =
          Boolean(
            value
          );


        if (
          !state.generating
        ) {

          state.sending =
            false;

        }


        renderButton();


        return state.generating;

      },


      getState() {

        classifyAttachments();


        return {

          version:
            VERSION,

          active:
            true,

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
     INIT
     ===================================================== */

  renderButton();


  emit(
    "neyo:send-state-ready",
    {

      version:
        VERSION,

      active:
        true

    }
  );


  console.log(
    "[NEYO Send] Final controller ready.",
    {

      version:
        VERSION,

      buttonOwner:
        "NeyoSendState",

      stopVisual:
        "solid-square"

    }
  );

})();
