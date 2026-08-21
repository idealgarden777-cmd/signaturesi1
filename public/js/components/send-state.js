/*
=========================================================
NEYO — SEND / STOP STATE v3
FINAL EVENT-DRIVEN CONTROLLER

Purpose:
- Send arrow -> Stop square
- Reliable send click
- Reliable Enter-to-send
- Attachment-aware send state
- Attachment-only messages
- Stop active generation
- Avoid legacy listener conflicts
- No fetch interception
- No duplicate AbortController
- No browser native title tooltip

Depends on:
- composer.js
- chat.js
- attachments.js

Owns:
- Send button UI
- Send button click
- Enter key send
- Send/stop visual state

Does NOT own:
- /api/chat fetch
- AbortController
- Attachment upload
- Attachment processing
- Composer text state
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

    console.warn(
      "[NEYO Send] sendBtn missing."
    );

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
     DEBUG
     ===================================================== */

  const DEBUG =
    false;


  function debug(
    ...args
  ) {

    if (!DEBUG) {
      return;
    }


    console.log(
      "[NEYO Send]",
      ...args
    );
  }


  /* =====================================================
     EVENT HELPER
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
     ICON REFRESH
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
     LIVE TEXT

     Important:
     Never depend only on stale event state.

     Read actual textarea/composer value
     whenever determining send eligibility.
     ===================================================== */

  function getLiveText() {

    try {

      const value =
        window
          .NeyoComposer
          ?.getTrimmedValue
          ?.();


      if (
        typeof value ===
        "string"
      ) {

        return value;
      }

    } catch {}


    return (
      textarea
        ?.value
        ?.trim() ||
      ""
    );
  }


  /* =====================================================
     READY ATTACHMENTS

     Also read live attachment controller state
     so missed events do not break send button.
     ===================================================== */

  function getLiveAttachmentState() {

    try {

      const controller =
        window
          .NeyoAttachments;


      if (!controller) {

        return {
          count:
            state.hasAttachments
              ? 1
              : 0,

          ready:
            state.readyAttachments,

          pending:
            state.attachmentsPending,

          errors:
            state.attachmentErrors
        };
      }


      const snapshot =
        controller
          .getState
          ?.();


      const items =
        Array.isArray(
          snapshot?.attachments
        )
          ? snapshot.attachments
          : [];


      const ready =
        items.filter(
          item =>
            item.status ===
            "ready"
        ).length;


      const pending =
        items.some(
          item =>
            [
              "queued",
              "authorizing",
              "uploading",
              "uploaded",
              "processing",
              "queued-processing"
            ].includes(
              item.status
            )
        );


      const errors =
        items.filter(
          item =>
            item.status ===
            "error"
        ).length;


      return {

        count:
          items.length,

        ready,

        pending,

        errors
      };


    } catch {

      return {

        count:
          state.hasAttachments
            ? 1
            : 0,

        ready:
          state.readyAttachments,

        pending:
          state.attachmentsPending,

        errors:
          state.attachmentErrors
      };
    }
  }


  /* =====================================================
     SYNC LIVE STATE
     ===================================================== */

  function syncLiveState() {

    const text =
      getLiveText();


    const attachments =
      getLiveAttachmentState();


    state.hasText =
      Boolean(
        text
      );


    state.hasAttachments =
      attachments.count >
      0;


    state.readyAttachments =
      attachments.ready;


    state.attachmentsPending =
      attachments.pending;


    state.attachmentErrors =
      attachments.errors;
  }


  /* =====================================================
     CAN SEND
     ===================================================== */

  function canSend() {

    syncLiveState();


    /*
    While generating, button remains usable
    because it becomes STOP.
    */

    if (
      state.generating
    ) {

      return true;
    }


    /*
    Never send partially uploaded / processing files.
    */

    if (
      state.attachmentsPending
    ) {

      return false;
    }


    /*
    Text-only send.
    */

    if (
      state.hasText
    ) {

      return true;
    }


    /*
    Attachment-only send.
    */

    if (
      state.readyAttachments >
      0
    ) {

      return true;
    }


    return false;
  }


  /* =====================================================
     BUTTON RENDER
     ===================================================== */

  function render() {

    syncLiveState();


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
      state.attachmentsPending &&
      !state.generating
    );


    sendBtn.classList.toggle(
      "has-attachment-errors",
      state.attachmentErrors >
      0
    );


    /*
    IMPORTANT:
    We use real disabled state only when
    not generating.

    During generation button must stay clickable
    for STOP.
    */

    sendBtn.disabled =
      !state.generating &&
      !enabled;


    sendBtn.setAttribute(
      "aria-disabled",
      String(
        !state.generating &&
        !enabled
      )
    );


    /*
    Never allow browser native tooltip.
    */

    sendBtn.removeAttribute(
      "title"
    );


    /* -------------------------------------------------
       STOP STATE
       ------------------------------------------------- */

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


    /* -------------------------------------------------
       PROCESSING STATE
       ------------------------------------------------- */

    if (
      state.attachmentsPending
    ) {

      sendBtn.setAttribute(
        "aria-label",
        "Attachment is processing"
      );


      sendBtn.dataset.tooltip =
        "Processing file";


      sendBtn.innerHTML = `
        <i
          data-lucide="loader-circle"
          size="18"
          class="send-loader-icon"
          aria-hidden="true"
        ></i>
      `;


      refreshIcons();


      return;
    }


    /* -------------------------------------------------
       NORMAL SEND STATE
       ------------------------------------------------- */

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
     REQUEST SEND
     ===================================================== */

  function requestSend() {

    syncLiveState();


    if (
      state.generating
    ) {

      return;
    }


    if (
      !canSend()
    ) {

      debug(
        "Send blocked",
        {
          hasText:
            state.hasText,

          readyAttachments:
            state.readyAttachments,

          attachmentsPending:
            state.attachmentsPending
        }
      );


      return;
    }


    const text =
      getLiveText();


    /*
    Attachments do NOT need to be manually added here.

    chat.js automatically reads:
    window.NeyoAttachments.getReady()
    */


    debug(
      "Dispatching send",
      {
        text,

        readyAttachments:
          state.readyAttachments
      }
    );


    emit(
      "neyo:chat-send-request",
      {
        text
      }
    );
  }


  /* =====================================================
     REQUEST STOP
     ===================================================== */

  function requestStop() {

    if (
      !state.generating
    ) {

      return;
    }


    debug(
      "Dispatching stop"
    );


    emit(
      "neyo:chat-stop-request"
    );
  }


  /* =====================================================
     BUTTON CLICK

     Capture phase prevents old/legacy
     sendBtn listeners from running first.
     ===================================================== */

  sendBtn.addEventListener(
    "click",
    event => {

      event.preventDefault();


      event.stopPropagation();


      event.stopImmediatePropagation();


      /*
      Do not trust CSS state.
      Re-check live state now.
      */

      syncLiveState();


      debug(
        "Button clicked",
        {
          generating:
            state.generating,

          hasText:
            state.hasText,

          readyAttachments:
            state.readyAttachments,

          attachmentsPending:
            state.attachmentsPending,

          canSend:
            canSend()
        }
      );


      if (
        state.generating
      ) {

        requestStop();

        return;
      }


      requestSend();

    },
    true
  );


  /* =====================================================
     ENTER TO SEND

     Enter → send
     Shift+Enter → newline

     Ctrl/Command/Alt combinations are preserved.
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


      /*
      IME composition safety.
      */

      if (
        event.isComposing ||
        event.keyCode ===
        229
      ) {

        return;
      }


      /*
      Shift+Enter = newline.
      */

      if (
        event.shiftKey
      ) {

        return;
      }


      /*
      Don't override browser/app shortcuts.
      */

      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {

        return;
      }


      syncLiveState();


      /*
      During generation, Enter should not stop.
      Only clicking stop button stops generation.
      */

      if (
        state.generating
      ) {

        event.preventDefault();

        return;
      }


      /*
      If file is processing, prevent accidental newline/send.
      */

      if (
        state.attachmentsPending
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
     DIRECT ATTACHMENT STATE

     Important fallback:
     send-state does not depend on chat.js forwarding
     attachment events.
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-change",
    () => {

      syncLiveState();

      render();
    }
  );


  /* =====================================================
     CHAT ATTACHMENT STATE
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
     GENERATION START
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {

      state.generating =
        true;


      render();
    }
  );


  /* =====================================================
     GENERATION FINISH
     ===================================================== */

  function finishGeneration() {

    state.generating =
      false;


    render();
  }


  window.addEventListener(
    "neyo:chat-send-end",
    finishGeneration
  );


  window.addEventListener(
    "neyo:chat-aborted",
    finishGeneration
  );


  window.addEventListener(
    "neyo:chat-error",
    finishGeneration
  );


  window.addEventListener(
    "neyo:chat-limit-reached",
    finishGeneration
  );


  /* =====================================================
     NEW CHAT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
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
     PUBLIC API
     ===================================================== */

  window.NeyoSendState =
    Object.freeze({

      refresh:
        render,


      canSend,


      send:
        requestSend,


      stop:
        requestStop,


      isGenerating:
        () =>
          state.generating,


      getState:
        () => {

          syncLiveState();


          return {

            generating:
              state.generating,

            hasText:
              state.hasText,

            hasAttachments:
              state.hasAttachments,

            readyAttachments:
              state.readyAttachments,

            attachmentsPending:
              state.attachmentsPending,

            attachmentErrors:
              state.attachmentErrors,

            canSend:
              canSend()
          };
        },


      version:
        "send-state-v3-final"
    });


  /* =====================================================
     INITIAL SYNC
     ===================================================== */

  syncLiveState();


  render();


  /*
  One extra sync after all synchronous component
  initialization has completed.

  This avoids script-load-order stale state.
  */

  queueMicrotask(
    () => {

      syncLiveState();

      render();
    }
  );


  window.addEventListener(
    "load",
    () => {

      syncLiveState();

      render();
    },
    {
      once:
        true
    }
  );


  console.log(
    "[NEYO Send] Final event-driven controller ready"
  );

})();
