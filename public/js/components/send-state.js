/*
=========================================================
NEYO — SEND / STOP STATE
Modular request control

Purpose:
- Keep legacy neo.js untouched
- Detect /api/chat requests
- Convert Send arrow -> Stop square
- Stop active generation
- Restore Send arrow after finish/error/abort
- Avoid browser native title tooltip
=========================================================
*/

(() => {
  "use strict";

  const sendBtn =
    document.getElementById("sendBtn");

  if (!sendBtn) {
    return;
  }

  const originalFetch =
    window.fetch.bind(window);

  let activeController = null;
  let isGenerating = false;
  let stopRequested = false;


  /* =====================================================
     ICON REFRESH
     ===================================================== */

  function refreshIcons() {
    if (
      window.lucide &&
      typeof window.lucide.createIcons === "function"
    ) {
      try {
        window.lucide.createIcons();
      } catch {
        // Safe no-op.
      }
    }
  }


  /* =====================================================
     SEND BUTTON UI
     ===================================================== */

  function renderSendButton() {
    sendBtn.classList.toggle(
      "is-generating",
      isGenerating
    );

    /*
    Permanently avoid browser-native tooltip.
    NEYO custom tooltip can use data-tooltip.
    */

    sendBtn.removeAttribute("title");

    if (isGenerating) {
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
     GENERATION STATE
     ===================================================== */

  function startGenerating(
    controller
  ) {
    activeController =
      controller;

    stopRequested = false;
    isGenerating = true;

    renderSendButton();
  }


  function finishGenerating(
    controller
  ) {
    /*
    Ignore stale request completion.
    */

    if (
      controller &&
      activeController &&
      controller !== activeController
    ) {
      return;
    }

    activeController = null;
    stopRequested = false;
    isGenerating = false;

    renderSendButton();
  }


  /* =====================================================
     ABORT ERROR CLEANUP

     Legacy neo.js may render an AbortError
     as an assistant error message.

     This cleanup removes only obvious
     abort-generated error bubbles.
     ===================================================== */

  function cleanupAbortMessage() {
    const chatMessages =
      document.getElementById(
        "chatMessages"
      );

    if (!chatMessages) {
      return;
    }

    const candidates =
      Array.from(
        chatMessages.querySelectorAll(
          ".message, .message-wrapper, .assistant-message"
        )
      );

    for (
      let index =
        candidates.length - 1;
      index >= 0;
      index -= 1
    ) {
      const node =
        candidates[index];

      const content =
        node.querySelector(
          ".message-content"
        );

      if (!content) {
        continue;
      }

      const text =
        content.textContent
          ?.trim()
          .toLowerCase() || "";

      const looksLikeAbort =
        text.includes("abort") ||
        text.includes("aborted") ||
        text.includes("signal is aborted") ||
        text.includes(
          "operation was aborted"
        );

      if (looksLikeAbort) {
        node.remove();
        break;
      }
    }
  }


  function scheduleAbortCleanup() {
    /*
    Legacy request catch may render
    slightly after fetch rejects.
    */

    [0, 50, 150, 350].forEach(
      delay => {
        window.setTimeout(
          cleanupAbortMessage,
          delay
        );
      }
    );
  }


  /* =====================================================
     STOP
     ===================================================== */

  function stopGeneration() {
    if (
      !isGenerating ||
      !activeController
    ) {
      return;
    }

    stopRequested = true;

    try {
      activeController.abort();
    } catch {
      // Safe no-op.
    }

    scheduleAbortCleanup();

    /*
    Restore button immediately.
    Fetch.finally will also safely sync it.
    */

    isGenerating = false;
    renderSendButton();
  }


  /* =====================================================
     SEND BUTTON CAPTURE

     Capture phase is important:
     while generating, stop the click
     before legacy neo.js receives it.
     ===================================================== */

  sendBtn.addEventListener(
    "click",
    event => {
      if (!isGenerating) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      stopGeneration();
    },
    true
  );


  /* =====================================================
     FETCH INTERCEPTOR

     Only touches /api/chat.
     All other fetch calls remain unchanged.
     ===================================================== */

  window.fetch =
    function neyoFetch(
      input,
      init = {}
    ) {
      let url = "";

      if (
        typeof input === "string"
      ) {
        url = input;
      } else if (
        input instanceof Request
      ) {
        url = input.url;
      } else if (
        input &&
        typeof input.url === "string"
      ) {
        url = input.url;
      }


      const isChatRequest =
        url === "/api/chat" ||
        url.endsWith("/api/chat") ||
        url.includes("/api/chat?");


      if (!isChatRequest) {
        return originalFetch(
          input,
          init
        );
      }


      const controller =
        new AbortController();

      /*
      Preserve an existing request signal
      if another future module provides one.
      */

      const existingSignal =
        init?.signal;

      let combinedSignal =
        controller.signal;


      if (
        existingSignal &&
        typeof AbortSignal.any ===
          "function"
      ) {
        combinedSignal =
          AbortSignal.any([
            existingSignal,
            controller.signal
          ]);
      } else if (
        existingSignal
      ) {
        if (
          existingSignal.aborted
        ) {
          controller.abort();
        } else {
          existingSignal.addEventListener(
            "abort",
            () => {
              controller.abort();
            },
            {
              once: true
            }
          );
        }
      }


      const nextInit = {
        ...init,
        signal:
          combinedSignal
      };


      startGenerating(
        controller
      );


      return originalFetch(
        input,
        nextInit
      )
        .catch(error => {
          if (
            controller.signal.aborted ||
            stopRequested
          ) {
            scheduleAbortCleanup();
          }

          throw error;
        })
        .finally(() => {
          finishGenerating(
            controller
          );
        });
    };


  /* =====================================================
     NATIVE TITLE PROTECTION
     For send button only.
     ===================================================== */

  const titleObserver =
    new MutationObserver(() => {
      if (
        sendBtn.hasAttribute(
          "title"
        )
      ) {
        sendBtn.removeAttribute(
          "title"
        );
      }
    });


  titleObserver.observe(
    sendBtn,
    {
      attributes: true,
      attributeFilter: [
        "title"
      ]
    }
  );


  /* =====================================================
     INITIAL STATE
     ===================================================== */

  renderSendButton();
})();
