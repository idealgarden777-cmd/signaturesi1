/*
=========================================================
NEYO — SEND / STOP STATE CONTROLLER
FINAL v1

FILE:
public/js/components/send-state.js

RESPONSIBILITIES:
- Own #sendBtn visual state
- Enable Send for text
- Enable Send for ready attachments
- Keep Send usable while attachments are processing
- Queue one Send intent while files finish
- Dispatch neyo:chat-send-request
- Switch Send → Stop while AI is generating
- Dispatch neyo:chat-stop-request
- Support Enter to send
- Preserve Shift+Enter newline
- Never call /api/chat directly
- Never upload files
- Never modify neo.js
- Never modify attachment button
- Never own chat rendering

EVENT CONTRACT:

send-state.js
    ↓
neyo:chat-send-request
    ↓
chat.js

chat.js
    ↓
neyo:chat-send-start
neyo:chat-send-end
neyo:chat-error
neyo:chat-aborted
neyo:chat-limit-reached
    ↓
send-state.js

attachments.js
    ↓
neyo:attachments-change
    ↓
send-state.js

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION
     ===================================================== */

  const VERSION =
    "neyo-send-state-final-v1";


  /* =====================================================
     DUPLICATE INIT GUARD
     ===================================================== */

  if (
    window.NeyoSendState &&
    window.NeyoSendState.__controller === true
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


  if (!sendBtn) {

    console.error(
      "[NEYO Send] #sendBtn is missing."
    );

    return;
  }


  /* =====================================================
     STATE
     ===================================================== */

  const state = {

    generating:
      false,

    queuedSend:
      false,

    queuedText:
      "",

    attachmentSnapshot: {
      count:
        0,

      ready:
        0,

      pending:
        false,

      errors:
        0
    }
  };


  /* =====================================================
     DEBUG
     ===================================================== */

  function debug(
    ...args
  ) {

    console.log(
      "[NEYO Send]",
      ...args
    );
  }


  /* =====================================================
     INPUT TEXT
     ===================================================== */

  function getText() {

    return String(
      chatInput?.value ||
      ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .trim();
  }


  /* =====================================================
     ATTACHMENT STATE
     ===================================================== */

  function readAttachmentState() {

    try {

      const controller =
        window.NeyoAttachments;


      if (!controller) {

        return {
          count:
            0,

          ready:
            0,

          pending:
            false,

          errors:
            0
        };
      }


      const snapshot =
        controller.getState?.() ||
        {};


      const attachments =
        Array.isArray(
          snapshot.attachments
        )
          ? snapshot.attachments
          : (
              Array.isArray(
                controller.getAll?.()
              )
                ? controller.getAll()
                : []
            );


      return {

        count:
          attachments.length,

        ready:
          attachments.filter(
            item =>
              item?.status ===
                "ready" &&
              item?.ready ===
                true
          ).length,

        pending:
          attachments.some(
            item =>
              [
                "queued",
                "authorizing",
                "uploading",
                "uploaded",
                "processing",
                "queued-processing"
              ].includes(
                item?.status
              )
          ),

        errors:
          attachments.filter(
            item =>
              item?.status ===
                "error"
          ).length
      };

    } catch (
      error
    ) {

      console.warn(
        "[NEYO Send] Attachment state read failed:",
        error
      );


      return {
        count:
          0,

        ready:
          0,

        pending:
          false,

        errors:
          0
      };
    }
  }


  function refreshAttachmentState() {

    state.attachmentSnapshot =
      readAttachmentState();


    return state
      .attachmentSnapshot;
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


    const text =
      getText();


    const attachments =
      refreshAttachmentState();


    if (text) {

      return true;
    }


    if (
      attachments.ready >
      0
    ) {

      return true;
    }


    /*
    Keep Send button available while attachment
    is still processing.

    Clicking it queues exactly one send intent.
    */

    if (
      attachments.pending &&
      attachments.count >
        0
    ) {

      return true;
    }


    return false;
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
     NORMAL SEND ICON
     ===================================================== */

  function renderSendIcon() {

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
     STOP ICON
     ===================================================== */

  function renderStopIcon() {

    /*
    Existing UI can style .send-stop-square.
    No spinner/loader replaces the button.
    */

    sendBtn.innerHTML = `
      <span
        class="send-stop-square"
        aria-hidden="true"
      ></span>
    `;
  }


  /* =====================================================
     RENDER
     ===================================================== */

  function render() {

    sendBtn.removeAttribute(
      "title"
    );


    sendBtn.classList.toggle(
      "is-generating",
      state.generating
    );


    /* -------------------------------------------------
       GENERATING → STOP
       ------------------------------------------------- */

    if (
      state.generating
    ) {

      sendBtn.disabled =
        false;


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


      sendBtn.classList.remove(
        "is-disabled"
      );


      sendBtn.classList.remove(
        "attachments-pending"
      );


      renderStopIcon();


      return;
    }


    /* -------------------------------------------------
       NORMAL SEND
       ------------------------------------------------- */

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


    sendBtn.setAttribute(
      "aria-label",
      "Send message"
    );


    sendBtn.classList.toggle(
      "is-disabled",
      !enabled
    );


    /*
    We deliberately do not visually turn the Send
    arrow into an upload spinner.

    This keeps UX stable.
    */

    sendBtn.classList.remove(
      "attachments-pending"
    );


    if (
      state.queuedSend &&
      state
        .attachmentSnapshot
        .pending
    ) {

      sendBtn.dataset.tooltip =
        "Waiting for file";

    } else {

      sendBtn.dataset.tooltip =
        "Send";
    }


    renderSendIcon();
  }


  /* =====================================================
     DISPATCH SEND
     ===================================================== */

  function dispatchSend(
    text
  ) {

    window.dispatchEvent(
      new CustomEvent(
        "neyo:chat-send-request",
        {
          detail: {
            text:
              text ||
              ""
          }
        }
      )
    );
  }


  /* =====================================================
     QUEUE / SEND
     ===================================================== */

  function requestSend() {

    if (
      state.generating
    ) {

      return false;
    }


    const text =
      getText();


    const attachments =
      refreshAttachmentState();


    /*
    Nothing to send.
    */

    if (
      !text &&
      attachments.count ===
        0
    ) {

      render();

      return false;
    }


    /*
    Attachment still uploading/processing.

    Remember exactly one send intent.
    */

    if (
      attachments.pending
    ) {

      state.queuedSend =
        true;


      state.queuedText =
        text;


      render();


      window.dispatchEvent(
        new CustomEvent(
          "neyo:send-waiting-for-attachments",
          {
            detail: {
              text,

              attachmentCount:
                attachments.count
            }
          }
        )
      );


      return true;
    }


    /*
    Attachment errors with no text and no ready file:
    don't send an empty request.
    */

    if (
      !text &&
      attachments.ready ===
        0 &&
      attachments.errors >
        0
    ) {

      window.dispatchEvent(
        new CustomEvent(
          "neyo:toast",
          {
            detail: {
              message:
                "Remove or retry the failed attachment.",

              type:
                "error"
            }
          }
        )
      );


      return false;
    }


    state.queuedSend =
      false;


    state.queuedText =
      "";


    dispatchSend(
      text
    );


    return true;
  }


  /* =====================================================
     PROCESS QUEUED SEND
     ===================================================== */

  function tryQueuedSend() {

    if (
      !state.queuedSend ||
      state.generating
    ) {

      return;
    }


    const attachments =
      refreshAttachmentState();


    /*
    Still working.
    */

    if (
      attachments.pending
    ) {

      render();

      return;
    }


    const text =
      state.queuedText;


    /*
    If processing ended in errors and no valid
    attachment remains, only send if user has text.
    */

    const shouldSend =
      Boolean(
        text
      ) ||
      attachments.ready >
        0;


    state.queuedSend =
      false;


    state.queuedText =
      "";


    render();


    if (
      shouldSend
    ) {

      dispatchSend(
        text
      );

    } else if (
      attachments.errors >
      0
    ) {

      window.dispatchEvent(
        new CustomEvent(
          "neyo:toast",
          {
            detail: {
              message:
                "The attachment could not be processed.",

              type:
                "error"
            }
          }
        )
      );
    }
  }


  /* =====================================================
     STOP
     ===================================================== */

  function requestStop() {

    if (
      !state.generating
    ) {

      return false;
    }


    window.dispatchEvent(
      new CustomEvent(
        "neyo:chat-stop-request"
      )
    );


    return true;
  }


  /* =====================================================
     BUTTON CLICK

     Capture phase is intentional.

     This Send controller becomes the owner of #sendBtn,
     preventing older duplicate send handlers from firing.
     ===================================================== */

  sendBtn.addEventListener(
    "click",
    event => {

      event.preventDefault();


      event.stopPropagation();


      event
        .stopImmediatePropagation();


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
     TEXT INPUT
     ===================================================== */

  chatInput?.addEventListener(
    "input",
    () => {

      /*
      If user edits their text while Send is queued,
      keep the queued content synchronized.
      */

      if (
        state.queuedSend
      ) {

        state.queuedText =
          getText();
      }


      render();
    }
  );


  /* =====================================================
     ENTER TO SEND

     Enter       → Send
     Shift+Enter → newline

     Ctrl/Meta/Alt+Enter are not hijacked.
     IME composition is respected.
     ===================================================== */

  chatInput?.addEventListener(
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
        event.altKey ||
        event.isComposing ||
        event.keyCode ===
          229
      ) {

        return;
      }


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


      requestSend();
    }
  );


  /* =====================================================
     ATTACHMENT STATE CHANGES
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-change",
    () => {

      refreshAttachmentState();


      render();


      tryQueuedSend();
    }
  );


  /* =====================================================
     ATTACHMENT READY

     Extra event makes queued sends react immediately
     even if another module changes event ordering.
     ===================================================== */

  window.addEventListener(
    "neyo:attachment-ready",
    () => {

      refreshAttachmentState();


      render();


      tryQueuedSend();
    }
  );


  /* =====================================================
     ATTACHMENT ERROR
     ===================================================== */

  window.addEventListener(
    "neyo:attachment-error",
    () => {

      refreshAttachmentState();


      render();


      tryQueuedSend();
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


      state.queuedSend =
        false;


      state.queuedText =
        "";


      render();
    }
  );


  /* =====================================================
     CHAT END
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


      state.queuedSend =
        false;


      state.queuedText =
        "";


      refreshAttachmentState();


      render();
    }
  );


  /* =====================================================
     COMPOSER CHANGE COMPATIBILITY

     Existing composer modules can ask for a refresh
     without owning send-button logic.
     ===================================================== */

  window.addEventListener(
    "neyo:composer-change",
    render
  );


  /* =====================================================
     TITLE ATTRIBUTE PROTECTION

     Existing tooltip system uses data-tooltip.

     Prevent browser native title tooltip duplication.
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

  const publicApi =
    Object.freeze({

      __controller:
        true,

      version:
        VERSION,


      refresh:
        render,


      send:
        requestSend,


      stop:
        requestStop,


      canSend,


      isGenerating:
        () =>
          state.generating,


      hasQueuedSend:
        () =>
          state.queuedSend,


      cancelQueuedSend:
        () => {

          state.queuedSend =
            false;


          state.queuedText =
            "";


          render();
        },


      getState:
        () => ({

          version:
            VERSION,

          generating:
            state.generating,

          queuedSend:
            state.queuedSend,

          queuedText:
            state.queuedText,

          text:
            getText(),

          attachments: {
            ...refreshAttachmentState()
          },

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
     INITIAL STATE
     ===================================================== */

  refreshAttachmentState();


  render();


  queueMicrotask(
    render
  );


  window.addEventListener(
    "load",
    render,
    {
      once:
        true
    }
  );


  debug(
    "FINAL CONTROLLER READY",
    {
      version:
        VERSION,

      sendBtn:
        Boolean(
          sendBtn
        ),

      chatInput:
        Boolean(
          chatInput
        ),

      attachmentController:
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
