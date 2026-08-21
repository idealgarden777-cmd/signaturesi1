/*
=========================================================
NEYO — SEND / STOP STATE
RESTORED STABLE VERSION

Purpose:
- Original send arrow
- Stop square while generating
- Reliable click
- Reliable Enter-to-send
- Chat.js owns actual request + abort
- No fetch monkey patch

Fixes applied:
- getText() reads textarea directly (no NeyoComposer dependency)
- canSend() uses live textarea value
- Input event listener triggers re-render
- Attachment ready state is checked via NeyoAttachments.getReady()
=========================================================
*/

(() => {
  "use strict";

  const sendBtn =
    document.getElementById("sendBtn");

  const textarea =
    document.getElementById("chatInput");

  if (!sendBtn) {
    return;
  }

  let isGenerating =
    false;


  /* =====================================================
     ICONS
     ===================================================== */

  function refreshIcons() {
    try {
      window.lucide?.createIcons?.();
    } catch {}
  }


  /* =====================================================
     TEXT — direct read from textarea
     ===================================================== */

  function getText() {
    return (
      textarea?.value?.trim() ||
      ""
    );
  }


  /* =====================================================
     ATTACHMENT READY
     ===================================================== */

  function hasReadyAttachment() {
    try {
      const ready =
        window.NeyoAttachments
          ?.getReady
          ?.();

      return (
        Array.isArray(ready) &&
        ready.length > 0
      );
    } catch {
      return false;
    }
  }


  /* =====================================================
     CAN SEND
     ===================================================== */

  function canSend() {
    if (isGenerating) {
      return true; // stop button always enabled
    }

    const text = getText();
    if (text.length > 0) {
      return true;
    }

    return hasReadyAttachment();
  }


  /* =====================================================
     RENDER
     ===================================================== */

  function render() {
    sendBtn.removeAttribute("title");

    sendBtn.classList.toggle(
      "is-generating",
      isGenerating
    );

    if (isGenerating) {
      sendBtn.disabled = false;

      sendBtn.classList.remove(
        "is-disabled"
      );

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

    const enabled =
      canSend();

    sendBtn.disabled =
      !enabled;

    sendBtn.classList.toggle(
      "is-disabled",
      !enabled
    );

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

  function sendMessage() {
    if (
      isGenerating ||
      !canSend()
    ) {
      return;
    }

    const text = getText();

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

  function stopGeneration() {
    if (!isGenerating) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent(
        "neyo:chat-stop-request"
      )
    );
  }


  /* =====================================================
     BUTTON CLICK
     ===================================================== */

  sendBtn.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopPropagation();

      if (isGenerating) {
        stopGeneration();
        return;
      }

      sendMessage();
    }
  );


  /* =====================================================
     ENTER
     ===================================================== */

  textarea?.addEventListener(
    "keydown",
    event => {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing
      ) {
        return;
      }

      if (isGenerating) {
        return;
      }

      if (!canSend()) {
        return;
      }

      event.preventDefault();

      sendMessage();
    }
  );


  /* =====================================================
     COMPOSER CHANGE — kept for compatibility
     ===================================================== */

  window.addEventListener(
    "neyo:composer-change",
    render
  );


  /* =====================================================
     ATTACHMENTS CHANGE
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-change",
    render
  );


  /* =====================================================
     DIRECT INPUT EVENT — fixes immediate text update
     ===================================================== */

  textarea?.addEventListener(
    "input",
    render
  );


  /* =====================================================
     GENERATION STATE EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {
      isGenerating = true;
      render();
    }
  );

  const finish =
    () => {
      isGenerating = false;
      render();
    };

  window.addEventListener(
    "neyo:chat-send-end",
    finish
  );

  window.addEventListener(
    "neyo:chat-aborted",
    finish
  );

  window.addEventListener(
    "neyo:chat-error",
    finish
  );

  window.addEventListener(
    "neyo:chat-limit-reached",
    finish
  );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  window.NeyoSendState =
    Object.freeze({
      refresh:
        render,

      canSend,

      isGenerating:
        () => isGenerating
    });


  /* =====================================================
     INIT
     ===================================================== */

  render();

  console.log(
    "[NEYO Send] Restored stable send button ready"
  );
})();
