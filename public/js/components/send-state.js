/*
=========================================================
NEYO — SEND / STOP STATE
FINAL PRODUCTION MIXER v7

FILE:
public/js/components/send-state.js

OWNS
---------------------------------------------------------
- Send button interaction
- Stop button interaction
- Enter to send
- Shift+Enter newline
- IME-safe keyboard handling
- Send / Stop visual state
- Canonical chat-send dispatch
- Sent attachment cleanup
- Composer text cleanup after accepted dispatch
- Composer reset on new chat

DOES NOT OWN
---------------------------------------------------------
- /api/chat
- Conversation state
- Message DOM
- Attachment upload / processing
- Markdown
- History persistence
- Composer autosize implementation
- Voice

MIGRATION RULE
---------------------------------------------------------
This controller is authoritative even while legacy neo.js
is physically loaded. Capture-phase interception prevents
legacy send handlers from also executing.

After neo.js is removed this file continues unchanged.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-send-state-final-v7";

  if (
    window.NeyoSendState
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      duplicateSendWindowMs:
        220,

      maxTextLength:
        50_000
    });

  /* =====================================================
     LEGACY TELEMETRY

     IMPORTANT:
     neo.js presence is informational ONLY.

     It does NOT disable this controller.
     ===================================================== */

  const legacyScriptPresent =
    Array
      .from(
        document.scripts || []
      )
      .some(
        script =>
          /(?:^|\/)neo\.js(?:\?|$)/
            .test(
              script.src || ""
            )
      );

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    active:
      true,

    generating:
      false,

    sending:
      false,

    stopRequested:
      false,

    composing:
      false,

    readyAttachments:
      0,

    pendingAttachments:
      0,

    failedAttachments:
      0,

    activeRequestId:
      null,

    lastSendAt:
      0,

    lastDispatchId:
      null,

    lastSource:
      null,

    routedSends:
      0,

    routedStops:
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
     DOM — DYNAMIC LOOKUP

     Dynamic lookup means composer DOM may be rebuilt
     without breaking this controller.
     ===================================================== */

  function getSendBtn() {
    return document
      .getElementById(
        "sendBtn"
      );
  }

  function getChatInput() {
    return document
      .getElementById(
        "chatInput"
      );
  }

  function isElement(
    value
  ) {
    return (
      value instanceof
      Element
    );
  }

  function closest(
    target,
    selector
  ) {
    if (
      !isElement(target)
    ) {
      return null;
    }

    try {
      return target.closest(
        selector
      );
    } catch {
      return null;
    }
  }

  /* =====================================================
     ID
     ===================================================== */

  function createId() {
    return (
      globalThis.crypto
        ?.randomUUID
        ?.() ||
      (
        `send_${Date.now()}_` +
        Math.random()
          .toString(36)
          .slice(2)
      )
    );
  }

  /* =====================================================
     TEXT
     ===================================================== */

  function normalizeRawText(
    value
  ) {
    return String(
      value ??
      ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .replace(
        /\r\n?/g,
        "\n"
      )
      .slice(
        0,
        CONFIG.maxTextLength
      );
  }

  function getRawText() {
    const input =
      getChatInput();

    return normalizeRawText(
      input?.value ||
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
     ATTACHMENT CONTROLLER
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
  }

  function getReadyAttachments() {
    try {
      const value =
        attachmentController()
          ?.getReady
          ?.();

      if (
        !Array.isArray(
          value
        )
      ) {
        return [];
      }

      /*
       * Defense-in-depth:
       * getReady() should already enforce this,
       * but Send validates again.
       */

      return value.filter(
        item =>
          Boolean(
            item &&
            item.ready === true &&
            item.status ===
              "ready" &&
            item.bucket &&
            item.path
          )
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
        item?.ready ===
          true &&
        item?.status ===
          "ready" &&
        item?.bucket &&
        item?.path
      ) {
        state.readyAttachments +=
          1;

        continue;
      }

      if (
        item?.status ===
        "error"
      ) {
        state.failedAttachments +=
          1;

        continue;
      }

      state.pendingAttachments +=
        1;
    }

    return {
      all,

      ready:
        state.readyAttachments,

      pending:
        state.pendingAttachments,

      failed:
        state.failedAttachments
    };
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
     COMPOSER REFRESH
     ===================================================== */

  function refreshComposer() {
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

    emit(
      "neyo:composer-layout-request",
      {
        source:
          "send-state"
      }
    );
  }

  /* =====================================================
     SEND ICON
     ===================================================== */

  function renderSendIcon(
    button
  ) {
    if (!button) {
      return;
    }

    button.innerHTML = `
      <i
        data-lucide="arrow-up"
        width="18"
        height="18"
        aria-hidden="true"
      ></i>
    `;

    button.dataset.mode =
      "send";

    button.dataset.tooltip =
      "Send message";

    button.setAttribute(
      "aria-label",
      "Send message"
    );

    button.setAttribute(
      "title",
      "Send message"
    );

    refreshIcons();
  }

  /* =====================================================
     STOP ICON
     ===================================================== */

  function renderStopIcon(
    button
  ) {
    if (!button) {
      return;
    }

    button.innerHTML = `
      <i
        data-lucide="square"
        width="15"
        height="15"
        aria-hidden="true"
      ></i>
    `;

    button.dataset.mode =
      "stop";

    button.dataset.tooltip =
      state.stopRequested
        ? "Stopping…"
        : "Stop generating";

    button.setAttribute(
      "aria-label",
      state.stopRequested
        ? "Stopping generation"
        : "Stop generating"
    );

    button.setAttribute(
      "title",
      state.stopRequested
        ? "Stopping…"
        : "Stop generating"
    );

    refreshIcons();
  }

  /* =====================================================
     CAN SEND

     ChatGPT-standard:
     -----------------------------------------------------
     text                       → yes
     ready attachment           → yes
     text + pending attachment  → yes
     text + failed attachment   → yes
     pending only               → no
     failed only                → no
     generating                 → button becomes Stop
     ===================================================== */

  function canSend() {
    syncAttachments();

    if (
      !state.active
    ) {
      return false;
    }

    /*
     * Generating means same button
     * is currently STOP.
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

    return (
      hasText() ||
      state.readyAttachments >
        0
    );
  }

  /* =====================================================
     BUTTON UI
     ===================================================== */

  function updateButton() {
    const sendBtn =
      getSendBtn();

    syncAttachments();

    if (!sendBtn) {
      return false;
    }

    sendBtn.type =
      "button";

    /* -------------------------------------------------
       GENERATING / STOP MODE
       ------------------------------------------------- */

    if (
      state.generating
    ) {
      sendBtn.disabled =
        false;

      sendBtn.classList.add(
        "is-generating"
      );

      sendBtn.classList.toggle(
        "is-stopping",
        state.stopRequested
      );

      sendBtn.classList.remove(
        "is-disabled",
        "is-ready"
      );

      if (
        state.stopRequested
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

      renderStopIcon(
        sendBtn
      );

      return true;
    }

    /* -------------------------------------------------
       SEND MODE
       ------------------------------------------------- */

    renderSendIcon(
      sendBtn
    );

    sendBtn.classList.remove(
      "is-generating",
      "is-stopping"
    );

    const enabled =
      canSend();

    sendBtn.disabled =
      !enabled;

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
     CLEAR COMPOSER TEXT
     ===================================================== */

  function clearText({
    focus = false
  } = {}) {
    const input =
      getChatInput();

    if (!input) {
      return false;
    }

    input.value =
      "";

    /*
     * Existing autosize / suggestions /
     * send-state consumers still receive
     * normal input lifecycle.
     */

    input.dispatchEvent(
      new Event(
        "input",
        {
          bubbles:
            true
        }
      )
    );

    refreshComposer();

    if (focus) {
      try {
        input.focus({
          preventScroll:
            true
        });

      } catch {
        try {
          input.focus();
        } catch {}
      }
    }

    return true;
  }

  /* =====================================================
     REMOVE ONLY ATTACHMENTS INCLUDED IN SEND

     Pending and failed files remain in composer.
     ===================================================== */

  function removeSentAttachments(
    sent
  ) {
    const controller =
      attachmentController();

    if (
      !controller ||
      !Array.isArray(sent) ||
      sent.length === 0
    ) {
      return 0;
    }

    const ids =
      sent
        .map(
          item =>
            item?.id
        )
        .filter(Boolean);

    if (
      ids.length ===
      0
    ) {
      return 0;
    }

    /*
     * Preferred v7 attachment API.
     */

    try {
      if (
        typeof controller
          .removeMany ===
        "function"
      ) {
        return (
          Number(
            controller.removeMany(
              ids
            )
          ) ||
          0
        );
      }

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Send] removeMany() failed:",
        error
      );
    }

    /*
     * Backward-compatible fallback.
     */

    let removed =
      0;

    for (
      const id
      of ids
    ) {
      try {
        if (
          controller
            .remove
            ?.(id)
        ) {
          removed +=
            1;
        }

      } catch (
        error
      ) {
        console.warn(
          "[NEYO Send] Could not remove sent attachment:",
          error
        );
      }
    }

    return removed;
  }

  /* =====================================================
     CLEAR ALL ATTACHMENTS
     Used when a genuinely new chat is created.
     ===================================================== */

  function clearAllAttachments() {
    const controller =
      attachmentController();

    try {
      if (
        typeof controller
          ?.clear ===
        "function"
      ) {
        return Boolean(
          controller.clear()
        );
      }

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Send] Could not clear attachments:",
        error
      );
    }

    emit(
      "neyo:attachments-clear-request",
      {
        source:
          "send-state"
      }
    );

    return true;
  }

  /* =====================================================
     CHAT GENERATING STATE

     Local lifecycle state is authoritative for UI,
     NeyoChat is a defensive fallback.
     ===================================================== */

  function chatIsGenerating() {
    if (
      state.generating
    ) {
      return true;
    }

    try {
      if (
        window.NeyoChat
          ?.isGenerating
          ?.() === true
      ) {
        return true;
      }
    } catch {}

    try {
      return Boolean(
        window.NeyoChat
          ?.getState
          ?.()
          ?.generating
      );

    } catch {
      return false;
    }
  }

  /* =====================================================
     STOP
     ===================================================== */

  function stopGeneration(
    source = "button"
  ) {
    if (
      !state.active ||
      !chatIsGenerating()
    ) {
      return false;
    }

    /*
     * Ignore repeated stop clicks while
     * chat.js is processing AbortController.
     */

    if (
      state.stopRequested
    ) {
      return true;
    }

    state.stopRequested =
      true;

    state.routedStops +=
      1;

    state.lastSource =
      source;

    updateButton();

    emit(
      "neyo:chat-stop-request",
      {
        requestId:
          state.activeRequestId,

        source
      }
    );

    emit(
      "neyo:composer-stop-requested",
      {
        requestId:
          state.activeRequestId,

        source
      }
    );

    /*
     * Do NOT set generating=false here.
     *
     * chat.js owns the real AbortController
     * and will emit aborted/send-end.
     */

    return true;
  }

  /* =====================================================
     PROGRAMMATIC SEND OPTIONS
     ===================================================== */

  function normalizeSendOptions(
    value
  ) {
    /*
     * NeyoSendState.send("hello")
     */

    if (
      typeof value ===
      "string"
    ) {
      return {
        text:
          normalizeRawText(
            value
          )
            .trim(),

        attachments:
          null,

        source:
          "api",

        cleanupText:
          false,

        cleanupAttachments:
          false,

        focusAfterSend:
          false
      };
    }

    /*
     * NeyoSendState.send({...})
     */

    if (
      value &&
      typeof value ===
        "object"
    ) {
      return {
        text:
          Object.prototype
            .hasOwnProperty
            .call(
              value,
              "text"
            )

            ? normalizeRawText(
                value.text
              )
                .trim()

            : null,

        attachments:
          Array.isArray(
            value.attachments
          )
            ? value.attachments
            : null,

        source:
          String(
            value.source ||
            "api"
          ),

        cleanupText:
          value.cleanupText !==
          false,

        cleanupAttachments:
          value
            .cleanupAttachments !==
          false,

        focusAfterSend:
          value.focusAfterSend ===
          true
      };
    }

    /*
     * Default composer send.
     */

    return {
      text:
        null,

      attachments:
        null,

      source:
        "composer",

      cleanupText:
        true,

      cleanupAttachments:
        true,

      focusAfterSend:
        false
    };
  }

  /* =====================================================
     DISPATCH ACCEPTANCE

     chat.js emits neyo:chat-send-start synchronously
     before its first network await.

     Therefore after CustomEvent dispatch returns,
     generating=true means canonical chat accepted
     the message.

     If chat.js did NOT accept it, composer is NOT cleared.
     ===================================================== */

  function dispatchWasAccepted() {
    return chatIsGenerating();
  }

  /* =====================================================
     SEND
     ===================================================== */

  function sendMessage(
    options = null
  ) {
    if (
      !state.active
    ) {
      return false;
    }

    /*
     * Same visible button:
     * while generating it becomes Stop.
     */

    if (
      chatIsGenerating()
    ) {
      return stopGeneration(
        options?.source ||
        "button"
      );
    }

    /*
     * Guard duplicate synchronous sends.
     */

    if (
      state.sending
    ) {
      return false;
    }

    syncAttachments();

    const normalized =
      normalizeSendOptions(
        options
      );

    const composerText =
      getText();

    const text =
      normalized.text !==
        null

        ? normalized.text

        : composerText;

    const readyAttachments =
      normalized.attachments !==
        null

        ? normalized
            .attachments
            .filter(
              item =>
                Boolean(
                  item &&
                  item.ready ===
                    true &&
                  item.status ===
                    "ready" &&
                  item.bucket &&
                  item.path
                )
            )

        : getReadyAttachments();

    /* -------------------------------------------------
       NOTHING USABLE
       ------------------------------------------------- */

    if (
      !text &&
      readyAttachments.length ===
        0
    ) {
      updateButton();

      return false;
    }

    /* -------------------------------------------------
       DOUBLE CLICK / DOUBLE ENTER PROTECTION
       ------------------------------------------------- */

    const now =
      performance.now();

    if (
      now -
        state.lastSendAt <
      CONFIG
        .duplicateSendWindowMs
    ) {
      return false;
    }

    const dispatchId =
      createId();

    state.lastSendAt =
      now;

    state.lastDispatchId =
      dispatchId;

    state.lastSource =
      normalized.source;

    state.sending =
      true;

    state.stopRequested =
      false;

    updateButton();

    /* -------------------------------------------------
       CANONICAL CHAT CONTRACT

       Only READY attachments go to chat.js.

       Pending/error files stay in the composer and
       never block normal text.
       ------------------------------------------------- */

    emit(
      "neyo:chat-send-request",
      {
        dispatchId,

        text,

        attachments:
          readyAttachments,

        source:
          normalized.source
      }
    );

    /* -------------------------------------------------
       ACCEPTANCE CHECK

       If chat.js is absent/busy/rejected the event,
       preserve composer content instead of losing it.
       ------------------------------------------------- */

    const accepted =
      dispatchWasAccepted();

    if (
      !accepted
    ) {
      state.sending =
        false;

      updateButton();

      emit(
        "neyo:composer-message-rejected",
        {
          dispatchId,

          text,

          attachmentCount:
            readyAttachments
              .length,

          source:
            normalized.source,

          reason:
            "chat-did-not-start"
        }
      );

      return false;
    }

    /* -------------------------------------------------
       CLEAR COMPOSER TEXT

       Only clear native composer text when the send
       actually originated from the composer.
       ------------------------------------------------- */

    if (
      normalized.cleanupText &&
      normalized.text ===
        null
    ) {
      clearText({
        focus:
          normalized
            .focusAfterSend
      });
    }

    /* -------------------------------------------------
       REMOVE ONLY SENT ATTACHMENTS

       Pending/error attachments remain.
       ------------------------------------------------- */

    if (
      normalized
        .cleanupAttachments &&
      normalized.attachments ===
        null
    ) {
      removeSentAttachments(
        readyAttachments
      );
    }

    state.sending =
      false;

    state.routedSends +=
      1;

    updateButton();

    emit(
      "neyo:composer-message-dispatched",
      {
        dispatchId,

        requestId:
          state.activeRequestId,

        text,

        attachmentCount:
          readyAttachments
            .length,

        source:
          normalized.source
      }
    );

    return true;
  }

  /* =====================================================
     EVENT CONSUMPTION

     This is what prevents neo.js from executing its
     own send handlers while it still exists.
     ===================================================== */

  function consume(
    event
  ) {
    event.preventDefault();

    event.stopPropagation();

    event
      .stopImmediatePropagation();
  }

  /* =====================================================
     SEND BUTTON — CAPTURE PHASE
     ===================================================== */

  function handleSendClick(
    event
  ) {
    const button =
      closest(
        event.target,
        "#sendBtn"
      );

    if (!button) {
      return;
    }

    /*
     * We own this control.
     * Legacy handler must never run.
     */

    consume(
      event
    );

    if (
      chatIsGenerating()
    ) {
      stopGeneration(
        "button"
      );

      return;
    }

    sendMessage({
      source:
        "button",

      cleanupText:
        true,

      cleanupAttachments:
        true
    });
  }

  /* =====================================================
     KEYBOARD — ENTER
     ===================================================== */

  function handleKeyDown(
    event
  ) {
    const input =
      closest(
        event.target,
        "#chatInput"
      );

    if (
      !input ||
      event.key !==
        "Enter"
    ) {
      return;
    }

    /* -------------------------------------------------
       IME / EAST-ASIAN COMPOSITION
       ------------------------------------------------- */

    if (
      event.isComposing ||
      state.composing ||
      event.keyCode ===
        229
    ) {
      return;
    }

    /* -------------------------------------------------
       SHIFT + ENTER = NEW LINE
       ------------------------------------------------- */

    if (
      event.shiftKey
    ) {
      return;
    }

    /* -------------------------------------------------
       CTRL / CMD / ALT + ENTER
       Leave untouched for application/browser shortcuts.
       ------------------------------------------------- */

    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    /* -------------------------------------------------
       ENTER NEVER ACTS AS STOP

       User must explicitly click Stop.
       Prevent accidental newline while generating.
       ------------------------------------------------- */

    if (
      chatIsGenerating()
    ) {
      consume(
        event
      );

      return;
    }

    if (
      !canSend()
    ) {
      return;
    }

    consume(
      event
    );

    sendMessage({
      source:
        "keyboard",

      cleanupText:
        true,

      cleanupAttachments:
        true
    });
  }

  /* =====================================================
     CHAT LIFECYCLE
     ===================================================== */

  function generationStarted(
    event
  ) {
    const requestId =
      event?.detail
        ?.requestId ??
      null;

    state.generating =
      true;

    state.sending =
      false;

    state.stopRequested =
      false;

    state.activeRequestId =
      requestId;

    updateButton();
  }

  function lifecycleMatches(
    event
  ) {
    const eventId =
      event?.detail
        ?.requestId;

    /*
     * Legacy / compatibility events may have no ID.
     */

    if (
      eventId == null ||
      state.activeRequestId == null
    ) {
      return true;
    }

    return (
      String(eventId) ===
      String(
        state.activeRequestId
      )
    );
  }

  function generationFinished(
    event
  ) {
    /*
     * Ignore stale lifecycle event from
     * a superseded request.
     */

    if (
      !lifecycleMatches(
        event
      )
    ) {
      return;
    }

    state.generating =
      false;

    state.sending =
      false;

    state.stopRequested =
      false;

    state.activeRequestId =
      null;

    updateButton();
  }

  /* =====================================================
     NEW CHAT COMPOSER RESET
     ===================================================== */

  function resetComposerForNewChat() {
    state.generating =
      false;

    state.sending =
      false;

    state.stopRequested =
      false;

    state.activeRequestId =
      null;

    clearText();

    clearAllAttachments();

    updateButton();

    return true;
  }

  /* =====================================================
     SET GENERATING
     Compatibility API
     ===================================================== */

  function setGenerating(
    value,
    options = {}
  ) {
    state.generating =
      Boolean(value);

    if (
      !state.generating
    ) {
      state.stopRequested =
        false;

      state.activeRequestId =
        null;

    } else if (
      options.requestId !==
      undefined
    ) {
      state.activeRequestId =
        options.requestId;
    }

    updateButton();

    return state.generating;
  }

  /* =====================================================
     DOCUMENT EVENT OWNERSHIP

     Delegated listeners survive composer DOM replacement.
     ===================================================== */

  document.addEventListener(
    "click",
    handleSendClick,
    true
  );

  document.addEventListener(
    "keydown",
    handleKeyDown,
    true
  );

  document.addEventListener(
    "compositionstart",
    event => {
      if (
        closest(
          event.target,
          "#chatInput"
        )
      ) {
        state.composing =
          true;
      }
    },
    true
  );

  document.addEventListener(
    "compositionend",
    event => {
      if (
        closest(
          event.target,
          "#chatInput"
        )
      ) {
        state.composing =
          false;

        updateButton();
      }
    },
    true
  );

  document.addEventListener(
    "input",
    event => {
      if (
        closest(
          event.target,
          "#chatInput"
        )
      ) {
        updateButton();
      }
    },
    true
  );

  /* =====================================================
     ATTACHMENT EVENTS
     ===================================================== */

  for (
    const eventName
    of [
      "neyo:attachments-change",
      "neyo:attachment-added",
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

  /* =====================================================
     CHAT START
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    generationStarted
  );

  /* =====================================================
     CHAT FINISH
     ===================================================== */

  for (
    const eventName
    of [
      "neyo:chat-send-end",
      "neyo:chat-response",
      "neyo:chat-error",
      "neyo:chat-aborted",
      "neyo:chat-limit-reached"
    ]
  ) {
    window.addEventListener(
      eventName,
      generationFinished
    );
  }

  /* =====================================================
     CHAT BUSY SYNC
     ===================================================== */

  window.addEventListener(
    "neyo:chat-busy",
    () => {
      try {
        state.generating =
          Boolean(
            window.NeyoChat
              ?.isGenerating
              ?.() ||
            window.NeyoChat
              ?.getState
              ?.()
              ?.generating
          );

      } catch {}

      state.sending =
        false;

      updateButton();
    }
  );

  /* =====================================================
     NEW CHAT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    resetComposerForNewChat
  );

  /* =====================================================
     EXPLICIT UPDATE / RESET EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:send-state-update-request",
    updateButton
  );

  window.addEventListener(
    "neyo:send-state-reset-request",
    () => {
      state.generating =
        false;

      state.sending =
        false;

      state.stopRequested =
        false;

      state.activeRequestId =
        null;

      updateButton();
    }
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

      /*
       * Always authoritative.
       */

      active:
        true,

      directOwner:
        true,

      /*
       * Telemetry only.
       */

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      send:
        sendMessage,

      stop:
        stopGeneration,

      update:
        updateButton,

      canSend,

      clearText,

      resetComposer:
        resetComposerForNewChat,

      setGenerating,

      getText,

      getReadyAttachments,

      getState() {
        syncAttachments();

        return {
          version:
            VERSION,

          active:
            true,

          directOwner:
            true,

          legacyScriptPresent,

          legacyOwnerActive:
            false,

          generating:
            state.generating,

          sending:
            state.sending,

          stopping:
            state.stopRequested,

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
            canSend(),

          activeRequestId:
            state.activeRequestId,

          lastDispatchId:
            state.lastDispatchId,

          lastSource:
            state.lastSource,

          routedSends:
            state.routedSends,

          routedStops:
            state.routedStops
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

  updateButton();

  emit(
    "neyo:send-state-ready",
    {
      version:
        VERSION,

      active:
        true,

      directOwner:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false
    }
  );
})();
