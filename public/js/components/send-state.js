/*
=========================================================
NEYO — SEND / STOP STATE v2
EVENT-DRIVEN + ATTACHMENT AWARE

Purpose:
- Send arrow ↔ Stop square
- Disable send while attachments process
- Allow attachment-only sending
- Stop active chat generation
- No fetch monkey-patching
- No duplicate AbortController ownership

Depends on:
- composer.js
- chat.js
- attachments.js

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     DOM
     ===================================================== */

  const sendBtn =
    document.getElementById(
      "sendBtn"
    );

  const textarea =
    document.getElementById(
      "chatInput"
    );


  if (!sendBtn) {
    return;
  }


  /* =====================================================
     STATE
     ===================================================== */

  const state = {

    generating:
      false,

    hasText:
      false,

    hasAttachments:
      false,

    readyAttachments:
      0,

    attachmentsPending:
      false,

    attachmentErrors:
      0
  };


  /* =====================================================
     ICONS
     ===================================================== */

  function refreshIcons() {

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

  function canSend() {

    if (
      state.generating
    ) {

      return true;
    }


    if (
      state.attachmentsPending
    ) {

      return false;
    }


    if (
      state.hasText
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
     RENDER
     ===================================================== */

  function render() {

    const enabled =
      canSend();


    sendBtn.classList.toggle(
      "is-generating",
      state.generating
    );


    sendBtn.classList.toggle(
      "is-disabled",
      !enabled
    );


    sendBtn.classList.toggle(
      "attachments-pending",
      state.attachmentsPending
    );


    sendBtn.disabled =
      !enabled;


    sendBtn.removeAttribute(
      "title"
    );


    sendBtn.setAttribute(
      "aria-disabled",
      String(
        !enabled
      )
    );


    if (
      state.generating
    ) {

      sendBtn.setAttribute(
        "aria-label",
        "Stop generating"
      );


      sendBtn.dataset.tooltip =
        "Stop";


      sendBtn.innerHTML = `
        <span
          class="send-stop-square"
          aria-hidden="true"
        ></span>
      `;


      return;
    }


    if (
      state.attachmentsPending
    ) {

      sendBtn.setAttribute(
        "aria-label",
        "Attachments are processing"
      );


      sendBtn.dataset.tooltip =
        "Processing files";


      sendBtn.innerHTML = `
        <i
          data-lucide="loader-circle"
          size="18"
          aria-hidden="true"
          class="send-loader-icon"
        ></i>
      `;


      refreshIcons();

      return;
    }


    sendBtn.setAttribute(
      "aria-label",
      "Send message"
    );


    sendBtn.dataset.tooltip =
      "Send";


    sendBtn.innerHTML = `
      <i
        data-lucide="arrow-up"
        size="18"
        aria-hidden="true"
      ></i>
    `;


    refreshIcons();
  }


  /* =====================================================
     SEND
     ===================================================== */

  function requestSend() {

    if (
      !canSend() ||
      state.generating
    ) {

      return;
    }


    const text =
      window
        .NeyoComposer
        ?.getTrimmedValue
        ?.() ||
      textarea
        ?.value
        ?.trim() ||
      "";


    /*
    No need to manually attach files here.

    chat.js automatically reads:
    NeyoAttachments.getReady()
    */

    window.dispatchEvent(
      new CustomEvent(
        "neyo:chat-send-request",
        {
          detail: {
            text
          }
        }
      )
    );
  }


  /* =====================================================
     STOP
     ===================================================== */

  function requestStop() {

    if (
      !state.generating
    ) {

      return;
    }


    /*
    chat.js owns its AbortController.
    */

    window.dispatchEvent(
      new CustomEvent(
        "neyo:chat-stop-request"
      )
    );
  }


  /* =====================================================
     BUTTON
     ===================================================== */

  sendBtn.addEventListener(
    "click",
    event => {

      event.preventDefault();

      event.stopPropagation();


      if (
        state.generating
      ) {

        requestStop();

        return;
      }


      requestSend();
    }
  );


  /* =====================================================
     ENTER TO SEND

     Enter        → send
     Shift+Enter  → newline
     ===================================================== */

  textarea?.addEventListener(
    "keydown",
    event => {

      if (
        event.key !==
        "Enter"
      ) {

        return;
      }


      if (
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {

        return;
      }


      if (
        event.isComposing
      ) {

        return;
      }


      event.preventDefault();


      if (
        state.generating
      ) {

        return;
      }


      requestSend();
    }
  );


  /* =====================================================
     COMPOSER STATE
     ===================================================== */

  window.addEventListener(
    "neyo:composer-change",
    event => {

      const detail =
        event.detail ||
        {};


      state.hasText =
        Boolean(
          detail.hasText
        );


      state.hasAttachments =
        Boolean(
          detail.hasAttachments
        );


      state.readyAttachments =
        Number(
          detail.readyAttachments
        ) ||
        0;


      state.attachmentsPending =
        Boolean(
          detail.attachmentsPending
        );


      state.attachmentErrors =
        Number(
          detail.attachmentErrors
        ) ||
        0;


      if (
        typeof detail.generating ===
        "boolean"
      ) {

        state.generating =
          detail.generating;
      }


      render();
    }
  );


  /* =====================================================
     ATTACHMENT FALLBACK STATE
     ===================================================== */

  window.addEventListener(
    "neyo:chat-attachments-state",
    event => {

      const detail =
        event.detail ||
        {};


      state.hasAttachments =
        Number(
          detail.count
        ) >
        0;


      state.readyAttachments =
        Number(
          detail.ready
        ) ||
        0;


      state.attachmentsPending =
        Boolean(
          detail.pending
        );


      state.attachmentErrors =
        Number(
          detail.errors
        ) ||
        0;


      render();
    }
  );


  /* =====================================================
     GENERATION EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {

      state.generating =
        true;

      render();
    }
  );


  window.addEventListener(
    "neyo:chat-send-end",
    () => {

      state.generating =
        false;

      render();
    }
  );


  window.addEventListener(
    "neyo:chat-aborted",
    () => {

      state.generating =
        false;

      render();
    }
  );


  window.addEventListener(
    "neyo:chat-error",
    () => {

      state.generating =
        false;

      render();
    }
  );


  /* =====================================================
     LIMIT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-limit-reached",
    () => {

      state.generating =
        false;

      render();
    }
  );


  /* =====================================================
     TITLE PROTECTION
     ===================================================== */

  const titleObserver =
    new MutationObserver(
      () => {

        if (
          sendBtn.hasAttribute(
            "title"
          )
        ) {

          sendBtn.removeAttribute(
            "title"
          );
        }
      }
    );


  titleObserver.observe(
    sendBtn,
    {
      attributes:
        true,

      attributeFilter: [
        "title"
      ]
    }
  );


  /* =====================================================
     INITIAL STATE
     ===================================================== */

  try {

    const composerState =
      window
        .NeyoComposer
        ?.getState
        ?.();


    if (
      composerState
    ) {

      state.hasText =
        Boolean(
          composerState.hasText
        );


      state.hasAttachments =
        Boolean(
          composerState.hasAttachments
        );


      state.readyAttachments =
        Number(
          composerState.readyAttachments
        ) ||
        0;


      state.attachmentsPending =
        Boolean(
          composerState.attachmentsPending
        );


      state.generating =
        Boolean(
          composerState.generating
        );
    }

  } catch {}


  render();


  console.log(
    "[NEYO Send State] Attachment-aware controller ready"
  );

})();
