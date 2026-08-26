/*
=========================================================
NEO — SEND / STOP STATE
Production v3 — Baseline Safe

Baseline:
- Old working neo.js Send / Enter behavior
- Old send-state.js Send → Stop square behavior
- Current NeyoChat lifecycle
- Current NeyoAttachments controller

Owns:
- #sendBtn
- Send / Stop button visual state
- Click routing
- Enter to send
- Shift+Enter newline
- IME-safe keyboard behavior
- Send eligibility
- Ready-attachment selection
- Accepted-send composer clearing
- Accepted ready-attachment cleanup
- Chat generation state synchronization

Does NOT own:
- /api/chat
- AbortController
- Conversation state
- Message DOM
- Attachment upload / processing
- Composer autosize
- Draft persistence
- Voice
- Model selector
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-send-state-production-v3";

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
      "[NEO Send] Required composer DOM is missing."
    );

    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      duplicateSendWindowMs:
        180,

      maxMessageLength:
        50_000
    });

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    generating: false,

    sending: false,

    composing: false,

    readyAttachments: 0,

    pendingAttachments: 0,

    failedAttachments: 0,

    lastSendAt: 0,

    pendingDispatch: null,

    acceptedDispatchId: null
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
      chatInput.value || ""
    )
      .replace(
        /\r\n?/g,
        "\n"
      )
      .replace(
        /\u0000/g,
        ""
      )
      .slice(
        0,
        CONFIG.maxMessageLength
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
     ATTACHMENT CONTROLLER
     ===================================================== */

  function attachmentController() {
    const controller =
      window.NeyoAttachments;

    if (
      !controller ||
      typeof controller !==
        "object"
    ) {
      return null;
    }

    return controller;
  }

  /* =====================================================
     ATTACHMENT STATE
     ===================================================== */

  function getAllAttachments() {
    const controller =
      attachmentController();

    if (!controller) {
      return [];
    }

    try {
      const value =
        controller.getAll?.() ??
        controller.getFiles?.() ??
        [];

      return Array.isArray(value)
        ? value
        : [];

    } catch {
      return [];
    }
  }

  function getReadyAttachments() {
    const controller =
      attachmentController();

    if (!controller) {
      return [];
    }

    try {
      const direct =
        controller.getReady?.();

      if (Array.isArray(direct)) {
        return direct;
      }
    } catch {}

    return getAllAttachments()
      .filter(file => {
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
      });
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

      /*
       * Anything else is conservatively pending.
       */

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

  /* =====================================================
     SEND ELIGIBILITY

     ChatGPT-standard rule:

     Text may send even if another attachment is still
     pending or has failed.

     Attachment-only send requires at least one READY file.
     ===================================================== */

  function canSend() {
    if (
      state.generating ||
      state.sending
    ) {
      return false;
    }

    classifyAttachments();

    if (hasText()) {
      return true;
    }

    return (
      state.readyAttachments >
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

  /* =====================================================
     SEND BUTTON VISUAL

     Preserve old working behavior:
     normal = arrow-up
     generating = square Stop icon
     ===================================================== */

  function renderButton() {
    const isStop =
      state.generating;

    sendBtn.classList.toggle(
      "is-generating",
      isStop
    );

    /*
     * Browser-native tooltip caused duplicate tooltip UI
     * in old app. Keep it removed.
     */

    sendBtn.removeAttribute(
      "title"
    );

    if (isStop) {
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

      sendBtn.replaceChildren();

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

      sendBtn.appendChild(
        square
      );

      return;
    }

    const enabled =
      canSend();

    sendBtn.disabled =
      !enabled;

    sendBtn.setAttribute(
      "aria-disabled",
      String(!enabled)
    );

    sendBtn.setAttribute(
      "aria-label",
      "Send message"
    );

    sendBtn.dataset.tooltip =
      "Send";

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
     INPUT EVENT
     ===================================================== */

  function notifyInputChanged() {
    chatInput.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );
  }

  /* =====================================================
     ATTACHMENT MATCHING
     ===================================================== */

  function attachmentIdentity(
    file
  ) {
    if (
      !file ||
      typeof file !==
        "object"
    ) {
      return "";
    }

    return String(
      file.id ||
      file.uploadId ||
      file.documentId ||
      file.path ||
      ""
    );
  }

  function sameAttachment(
    first,
    second
  ) {
    if (
      !first ||
      !second
    ) {
      return false;
    }

    const firstId =
      attachmentIdentity(first);

    const secondId =
      attachmentIdentity(second);

    if (
      firstId &&
      secondId
    ) {
      return (
        firstId ===
        secondId
      );
    }

    /*
     * Compatibility fallback only.
     */

    return (
      String(
        first.name || ""
      ) ===
        String(
          second.name || ""
        ) &&
      Number(
        first.size || 0
      ) ===
        Number(
          second.size || 0
        )
    );
  }

  /* =====================================================
     REMOVE ONE SENT ATTACHMENT
     ===================================================== */

  function removeSentAttachment(
    file
  ) {
    const controller =
      attachmentController();

    if (!controller) {
      return false;
    }

    const id =
      attachmentIdentity(file);

    /*
     * Preferred production API.
     */

    if (
      id &&
      typeof controller.remove ===
        "function"
    ) {
      try {
        const result =
          controller.remove(id);

        if (
          result !== false
        ) {
          return true;
        }
      } catch {}
    }

    /*
     * Compatibility APIs.
     */

    if (
      id &&
      typeof controller
        .removeFile ===
        "function"
    ) {
      try {
        const result =
          controller.removeFile(
            id
          );

        if (
          result !== false
        ) {
          return true;
        }
      } catch {}
    }

    /*
     * Some implementations accept the whole object.
     */

    if (
      typeof controller.remove ===
      "function"
    ) {
      try {
        const result =
          controller.remove(file);

        if (
          result !== false
        ) {
          return true;
        }
      } catch {}
    }

    return false;
  }

  /* =====================================================
     CLEAN ONLY ATTACHMENTS ACTUALLY SENT

     Pending / failed files remain in composer.
     ===================================================== */

  function removeAcceptedAttachments(
    sentAttachments
  ) {
    if (
      !Array.isArray(
        sentAttachments
      ) ||
      sentAttachments.length ===
        0
    ) {
      return true;
    }

    const controller =
      attachmentController();

    if (!controller) {
      return false;
    }

    /*
     * Remove individually.
     * Never call clear() here because pending/error files
     * may exist and must remain visible.
     */

    for (
      const sentFile
      of sentAttachments
    ) {
      const currentFiles =
        getAllAttachments();

      const matching =
        currentFiles.find(
          current =>
            sameAttachment(
              current,
              sentFile
            )
        );

      if (!matching) {
        continue;
      }

      removeSentAttachment(
        matching
      );
    }

    classifyAttachments();

    return true;
  }

  /* =====================================================
     DISPATCH ID
     ===================================================== */

  function createDispatchId() {
    try {
      return (
        globalThis.crypto
          ?.randomUUID
          ?.() ||
        `send_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 9)}`
      );
    } catch {
      return (
        `send_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 9)}`
      );
    }
  }

  /* =====================================================
     ACCEPTED SEND CLEANUP

     IMPORTANT:
     Composer is NOT cleared merely because an event was
     dispatched.

     chat.js must synchronously emit neyo:chat-send-start.
     Only then is the request considered accepted.
     ===================================================== */

  function acceptPendingDispatch(
    eventDetail = {}
  ) {
    const pending =
      state.pendingDispatch;

    if (!pending) {
      return false;
    }

    if (
      state.acceptedDispatchId ===
      pending.id
    ) {
      return false;
    }

    // Guard against mismatched dispatchId (e.g., regenerate/edit)
    const acceptedDispatchId =
      String(
        eventDetail.dispatchId || ""
      );

    if (
      acceptedDispatchId &&
      acceptedDispatchId !== pending.id
    ) {
      return false;
    }

    state.acceptedDispatchId =
      pending.id;

    state.sending = false;

    state.generating = true;

    /*
     * Clear text only if composer still contains exactly
     * the submitted draft.
     *
     * This prevents destroying text a user somehow typed
     * between dispatch and acceptance.
     */

    if (
      getRawText() ===
      pending.rawText
    ) {
      chatInput.value = "";

      notifyInputChanged();
    }

    /*
     * Use actual attachments acknowledged by chat.js.
     */

    const acceptedAttachments =
      Array.isArray(
        eventDetail.attachments
      )
        ? eventDetail.attachments
        : pending.attachments;

    removeAcceptedAttachments(
      acceptedAttachments
    );

    emit(
      "neyo:send-accepted",
      {
        dispatchId:
          pending.id,

        requestId:
          eventDetail.requestId ??
          null,

        text:
          pending.text,

        attachmentCount:
          acceptedAttachments.length
      }
    );

    state.pendingDispatch =
      null;

    renderButton();

    return true;
  }

  /* =====================================================
     REQUEST SEND
     ===================================================== */

  function requestSend() {
    if (
      state.generating ||
      state.sending
    ) {
      return false;
    }

    classifyAttachments();

    const text =
      getText();

    const rawText =
      getRawText();

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
      CONFIG.duplicateSendWindowMs
    ) {
      return false;
    }

    state.lastSendAt =
      now;

    const dispatchId =
      createDispatchId();

    state.sending =
      true;

    state.pendingDispatch = {
      id:
        dispatchId,

      text,

      rawText,

      attachments:
        readyAttachments.slice(),

      createdAt:
        now
    };

    renderButton();

    /*
     * CustomEvent dispatch is synchronous.
     *
     * NeyoChat receives this event and emits
     * neyo:chat-send-start before its first network await.
     */

    emit(
      "neyo:chat-send-request",
      {
        dispatchId,

        text,

        attachments:
          readyAttachments
      }
    );

    /*
     * If no canonical chat owner accepted synchronously,
     * DO NOT destroy the draft or attachments.
     */

    if (
      state.pendingDispatch?.id ===
        dispatchId
    ) {
      state.sending =
        false;

      state.pendingDispatch =
        null;

      renderButton();

      emit(
        "neyo:send-not-accepted",
        {
          dispatchId
        }
      );

      return false;
    }

    return true;
  }

  /* =====================================================
     STOP
     ===================================================== */

  function requestStop() {
    if (!state.generating) {
      return false;
    }

    /*
     * chat.js owns AbortController.
     */

    emit(
      "neyo:chat-stop-request",
      {
        reason:
          "user"
      }
    );

    emit(
      "neyo:send-stop-requested"
    );

    return true;
  }

  /* =====================================================
     PUBLIC SEND

     Same button:
     Send when idle
     Stop when generating
     ===================================================== */

  function send() {
    if (state.generating) {
      return requestStop();
    }

    return requestSend();
  }

  /* =====================================================
     CLICK

     Capture phase preserves old working integration while
     neo.js is still physically loaded.
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

    if (state.generating) {
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

     Enter        = send
     Shift+Enter  = newline
     Ctrl/Meta/
     Alt+Enter    = untouched
     Enter during generation never means Stop
     ===================================================== */

  function handleKeyDown(
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

    const input =
      target.closest(
        "#chatInput"
      );

    if (!input) {
      return;
    }

    if (
      event.key !==
      "Enter"
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

    if (
      event.isComposing ||
      state.composing ||
      event.keyCode === 229
    ) {
      return;
    }

    /*
     * During generation Enter must not trigger legacy
     * neo.js handleSend() either.
     */

    if (state.generating) {
      event.preventDefault();

      event.stopPropagation();

      event.stopImmediatePropagation();

      return;
    }

    if (!canSend()) {
      /*
       * Prevent legacy neo.js from attempting a send with
       * pending/failed-only attachments.
       */

      if (
        !hasText() &&
        getAllAttachments()
          .length > 0
      ) {
        event.preventDefault();

        event.stopPropagation();

        event.stopImmediatePropagation();
      }

      return;
    }

    event.preventDefault();

    event.stopPropagation();

    event.stopImmediatePropagation();

    requestSend();
  }

  document.addEventListener(
    "keydown",
    handleKeyDown,
    true
  );

  /* =====================================================
     INPUT
     ===================================================== */

  chatInput.addEventListener(
    "input",
    () => {
      renderButton();
    }
  );

  /* =====================================================
     ATTACHMENT EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-change",
    () => {
      classifyAttachments();

      renderButton();
    }
  );

  /* =====================================================
     CHAT ACCEPTANCE

     This is the exact point at which chat.js confirms it
     accepted the send.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    event => {
      acceptPendingDispatch(
        event.detail || {}
      );

      /*
       * Regenerate/edit can start generation without a
       * composer pendingDispatch.
       */

      if (
        !state.pendingDispatch
      ) {
        state.generating =
          true;

        state.sending =
          false;

        renderButton();
      }
    }
  );

  /* =====================================================
     GENERATION FINISH
     ===================================================== */

  function finishGeneration() {
    state.generating =
      false;

    state.sending =
      false;

    state.pendingDispatch =
      null;

    state.acceptedDispatchId =
      null;

    classifyAttachments();

    renderButton();
  }

  window.addEventListener(
    "neyo:chat-send-end",
    finishGeneration
  );

  /*
   * Compatibility lifecycle events.
   *
   * send-end is canonical, but these protect UI if an older
   * chat implementation does not emit it.
   */

  window.addEventListener(
    "neyo:chat-error",
    finishGeneration
  );

  window.addEventListener(
    "neyo:chat-aborted",
    finishGeneration
  );

  window.addEventListener(
    "neyo:chat-limit-reached",
    finishGeneration
  );

  /* =====================================================
     NEW CHAT / HISTORY LOAD

     Ensure no stale Stop button survives navigation.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      finishGeneration();
    }
  );

  window.addEventListener(
    "neyo:chat-state-loaded",
    () => {
      finishGeneration();
    }
  );

  /* =====================================================
     CHAT STATE SYNC
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state",
    event => {
      const generating =
        event.detail
          ?.generating;

      if (
        typeof generating !==
        "boolean"
      ) {
        return;
      }

      state.generating =
        generating;

      if (!generating) {
        state.sending =
          false;
      }

      renderButton();
    }
  );

  /* =====================================================
     TITLE PROTECTION

     Preserve old send-state behavior:
     prevent browser-native title tooltip.
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
      attributes: true,

      attributeFilter: [
        "title"
      ]
    }
  );

  /* =====================================================
     REFRESH (canonical)
     ===================================================== */

  function refresh() {
    classifyAttachments();

    renderButton();

    return true;
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

      send,

      requestSend,

      stop:
        requestStop,

      requestStop,

      canSend,

      refresh,

      // Compatibility alias
      update: refresh,

      setGenerating(value) {
        state.generating =
          Boolean(value);

        if (
          !state.generating
        ) {
          state.sending =
            false;

          state.pendingDispatch =
            null;

          state.acceptedDispatchId =
            null;
        }

        renderButton();

        return true;
      },

      isGenerating() {
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

          canSend:
            canSend(),

          hasText:
            hasText(),

          readyAttachments:
            state.readyAttachments,

          pendingAttachments:
            state.pendingAttachments,

          failedAttachments:
            state.failedAttachments,

          pendingDispatch:
            state.pendingDispatch
              ? {
                  id:
                    state.pendingDispatch.id,

                  text:
                    state.pendingDispatch.text,

                  attachmentCount:
                    state.pendingDispatch
                      .attachments
                      .length
                }
              : null
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

  classifyAttachments();

  /*
   * If chat.js loaded first and is already generating,
   * synchronize immediately.
   */

  try {
    state.generating =
      Boolean(
        window.NeyoChat
          ?.isGenerating
          ?.()
      );
  } catch {}

  renderButton();

  emit(
    "neyo:send-state-ready",
    {
      version:
        VERSION,

      active:
        true,

      generating:
        state.generating,

      canSend:
        canSend()
    }
  );
})();
