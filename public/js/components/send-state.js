/*
=========================================================
NEO — SEND / STOP STATE
Production v1

Owns:
- #sendBtn
- Enter to send
- Shift+Enter newline
- Send / Stop visual state
- composer → chat dispatch
- cleanup of successfully accepted composer payload

Does NOT own:
- /api/chat
- conversation state
- message DOM
- attachment upload
- textarea autosize
- model picker
- topbar
=========================================================
*/

(() => {
  "use strict";

  const VERSION = "neo-send-state-production-v1";

  if (window.NeyoSendState?.__controller === true) return;

  /* =====================================================
     DOM
     ===================================================== */

  const sendBtn =
    document.getElementById("sendBtn");

  const chatInput =
    document.getElementById("chatInput");

  if (!sendBtn || !chatInput) {
    console.warn(
      "[NEO Send] Required composer DOM is missing."
    );

    return;
  }

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

    /*
     * Payload waiting for chat.js acceptance.
     *
     * Composer text/files are cleared only after
     * neyo:chat-send-start confirms the request.
     */
    pendingDispatch: null
  };

  const legacyScriptPresent =
    Array.from(
      document.scripts || []
    ).some(
      script =>
        /(?:^|\/)neo\.js(?:\?|$)/
          .test(script.src || "")
    );

  /* =====================================================
     HELPERS
     ===================================================== */

  function emit(
    name,
    detail = {}
  ) {
    window.dispatchEvent(
      new CustomEvent(
        name,
        { detail }
      )
    );
  }

  function getRawText() {
    return String(
      chatInput.value || ""
    )
      .replace(/\r\n?/g, "\n")
      .replace(/\u0000/g, "");
  }

  function getText() {
    return getRawText().trim();
  }

  function hasText() {
    return getText().length > 0;
  }

  function attachments() {
    const controller =
      window.NeyoAttachments;

    return (
      controller &&
      typeof controller === "object"
    )
      ? controller
      : null;
  }

  function getAllAttachments() {
    try {
      const value =
        attachments()?.getAll?.();

      return Array.isArray(value)
        ? value
        : [];

    } catch (error) {
      console.warn(
        "[NEO Send] Could not read attachments:",
        error
      );

      return [];
    }
  }

  function getReadyAttachments() {
    try {
      const value =
        attachments()?.getReady?.();

      return Array.isArray(value)
        ? value
        : [];

    } catch (error) {
      console.warn(
        "[NEO Send] Could not read ready attachments:",
        error
      );

      return [];
    }
  }

  function syncAttachments() {
    const all =
      getAllAttachments();

    let ready = 0;
    let pending = 0;
    let failed = 0;

    for (const item of all) {
      if (
        item?.ready === true &&
        item?.status === "ready"
      ) {
        ready += 1;
        continue;
      }

      if (
        item?.status === "error"
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
     SEND AVAILABILITY

     ChatGPT-standard behavior:

     Text                         → send
     Ready attachment             → send
     Text + pending attachment    → send text
     Text + failed attachment     → send text
     Only pending attachment      → disabled
     Only failed attachment       → disabled
     Generating                   → button = Stop
     ===================================================== */

  function canSend() {
    syncAttachments();

    if (state.generating) {
      return true;
    }

    if (state.sending) {
      return false;
    }

    return (
      hasText() ||
      state.readyAttachments > 0
    );
  }

  /* =====================================================
     BUTTON
     ===================================================== */

  function updateButton() {
    syncAttachments();

    if (state.generating) {
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

    if (state.sending) {
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
     COMPOSER CLEANUP
     ===================================================== */

  function clearText() {
    chatInput.value = "";

    chatInput.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );

    try {
      window.NeyoComposer
        ?.refresh
        ?.();
    } catch {}

    try {
      window.NeyoComposerScrollbar
        ?.refresh
        ?.();
    } catch {}
  }

  function removeAttachments(
    list
  ) {
    const controller =
      attachments();

    if (
      !controller ||
      typeof controller.remove !==
        "function" ||
      !Array.isArray(list)
    ) {
      return;
    }

    for (const item of list) {
      if (!item?.id) continue;

      try {
        controller.remove(
          item.id
        );
      } catch (error) {
        console.warn(
          "[NEO Send] Could not remove sent attachment:",
          error
        );
      }
    }
  }

  /* =====================================================
     DISPATCH MATCH

     Confirms that chat-send-start belongs to the exact
     composer request we just dispatched.
     ===================================================== */

  function dispatchMatches(
    detail,
    pending
  ) {
    if (!pending) {
      return false;
    }

    const acceptedText =
      String(
        detail?.text || ""
      ).trim();

    if (
      acceptedText !==
      pending.text
    ) {
      return false;
    }

    const acceptedAttachments =
      Array.isArray(
        detail?.attachments
      )
        ? detail.attachments
        : [];

    const acceptedIds =
      acceptedAttachments
        .map(item =>
          String(item?.id || "")
        )
        .filter(Boolean)
        .sort();

    const pendingIds =
      pending.attachments
        .map(item =>
          String(item?.id || "")
        )
        .filter(Boolean)
        .sort();

    if (
      acceptedIds.length !==
      pendingIds.length
    ) {
      return false;
    }

    return acceptedIds.every(
      (id, index) =>
        id === pendingIds[index]
    );
  }

  /* =====================================================
     COMMIT ACCEPTED SEND

     Composer cleanup occurs only after chat.js confirms
     generation has actually started.
     ===================================================== */

  function commitPendingDispatch(
    detail
  ) {
    const pending =
      state.pendingDispatch;

    if (
      !dispatchMatches(
        detail,
        pending
      )
    ) {
      return false;
    }

    state.pendingDispatch =
      null;

    clearText();

    removeAttachments(
      pending.attachments
    );

    emit(
      "neyo:composer-message-dispatched",
      {
        text:
          pending.text,

        attachments:
          pending.attachments,

        attachmentCount:
          pending.attachments.length,

        requestId:
          detail?.requestId ||
          null
      }
    );

    return true;
  }

  /* =====================================================
     STOP
     ===================================================== */

  function stopGeneration(
    reason =
      "send-button"
  ) {
    if (
      !state.generating
    ) {
      return false;
    }

    emit(
      "neyo:chat-stop-request",
      {
        reason,
        source:
          "send-state"
      }
    );

    return true;
  }

  /* =====================================================
     SEND
     ===================================================== */

  function requestSend() {
    syncAttachments();

    /*
     * Same physical button changes to Stop.
     */

    if (state.generating) {
      return stopGeneration();
    }

    if (state.sending) {
      return false;
    }

    const text =
      getText();

    const readyAttachments =
      getReadyAttachments();

    if (
      !text &&
      readyAttachments.length === 0
    ) {
      updateButton();

      return false;
    }

    /*
     * Protect against duplicate legacy/modular click
     * handlers firing during migration.
     */

    const now =
      performance.now();

    if (
      now - state.lastSendAt <
      180
    ) {
      return false;
    }

    state.lastSendAt =
      now;

    state.sending =
      true;

    state.pendingDispatch = {
      text,

      attachments:
        readyAttachments.map(
          item => ({ ...item })
        ),

      createdAt:
        Date.now()
    };

    updateButton();

    /*
     * chat.js is the only consumer that owns transport.
     */

    emit(
      "neyo:chat-send-request",
      {
        text,

        attachments:
          readyAttachments,

        source:
          "send-state"
      }
    );

    /*
     * chat.js emits neyo:chat-send-start synchronously
     * when it accepts the request.
     *
     * If no start event arrived, restore Send state and
     * KEEP the user's composer content/files untouched.
     */

    queueMicrotask(
      () => {
        if (
          !state.pendingDispatch
        ) {
          return;
        }

        state.pendingDispatch =
          null;

        state.sending =
          false;

        updateButton();

        emit(
          "neyo:composer-send-not-accepted",
          {
            text,
            attachmentCount:
              readyAttachments.length
          }
        );
      }
    );

    return true;
  }

  /* =====================================================
     BUTTON CLICK

     Capture phase is intentional.
     It prevents old neo.js listeners from sending the same
     composer payload a second time.
     ===================================================== */

  function handleClick(
    event
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    requestSend();
  }

  /* =====================================================
     KEYBOARD
     ===================================================== */

  function handleKeyDown(
    event
  ) {
    if (
      event.key !== "Enter"
    ) {
      return;
    }

    /*
     * IME / composition input.
     */

    if (
      event.isComposing ||
      state.composing ||
      event.keyCode === 229
    ) {
      return;
    }

    /*
     * Shift+Enter always creates a newline.
     */

    if (
      event.shiftKey
    ) {
      return;
    }

    /*
     * Preserve OS/browser modifier shortcuts.
     */

    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    /*
     * Enter does NOT stop generation.
     * Stop remains an explicit button action.
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

    requestSend();
  }

  /* =====================================================
     CHAT LIFECYCLE
     ===================================================== */

  function generationStarted(
    event
  ) {
    /*
     * Commit composer cleanup only for our own pending
     * request.
     */

    commitPendingDispatch(
      event.detail || {}
    );

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

    state.pendingDispatch =
      null;

    updateButton();
  }

  /* =====================================================
     CHAT STATE SYNC

     Useful when send-state loads after chat.js or a history
     conversation is restored.
     ===================================================== */

  function syncChatState(
    detail = null
  ) {
    if (
      detail &&
      typeof detail.generating ===
        "boolean"
    ) {
      state.generating =
        detail.generating;

      updateButton();

      return;
    }

    try {
      state.generating =
        Boolean(
          window.NeyoChat
            ?.isGenerating
            ?.()
        );
    } catch {
      state.generating =
        false;
    }

    updateButton();
  }

  /* =====================================================
     EVENTS
     ===================================================== */

  sendBtn.addEventListener(
    "click",
    handleClick,
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

      updateButton();
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
      "neyo:attachment-removed",
      "neyo:attachments-cleared"
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

  window.addEventListener(
    "neyo:chat-state",
    event => {
      syncChatState(
        event.detail || {}
      );
    }
  );

  window.addEventListener(
    "neyo:send-state-refresh",
    updateButton
  );

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

      /*
       * Main operations
       */

      send:
        requestSend,

      requestSend,

      stop:
        stopGeneration,

      update:
        updateButton,

      refresh:
        updateButton,

      canSend,

      /*
       * Compatibility / state sync
       */

      setGenerating(
        value
      ) {
        state.generating =
          Boolean(value);

        if (
          !state.generating
        ) {
          state.sending =
            false;

          state.pendingDispatch =
            null;
        }

        updateButton();

        return state.generating;
      },

      /*
       * Diagnostics
       */

      getState() {
        syncAttachments();

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

          pendingDispatch:
            Boolean(
              state.pendingDispatch
            ),

          canSend:
            canSend(),

          legacyScriptPresent
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

  syncChatState();

  emit(
    "neyo:send-state-ready",
    {
      version:
        VERSION,

      active:
        true,

      authoritativeOwner:
        true,

      legacyScriptPresent
    }
  );
})();
