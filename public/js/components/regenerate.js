/*
=========================================================
NEYO — REGENERATE
FINAL PRODUCTION MIXER v6

FILE:
public/js/components/regenerate.js

OWNS
---------------------------------------------------------
- Regenerate request coordination
- Assistant → preceding user-turn resolution checks
- Duplicate regenerate protection
- Generation guard
- Regenerate button busy state
- Regenerate lifecycle UI
- Regenerate lifecycle events
- Compatibility event routing
- Public regenerate API

DOES NOT OWN
---------------------------------------------------------
- Conversation mutation
- Conversation truncation
- /api/chat
- Assistant message rendering
- Thinking indicator
- Attachment rendering
- History persistence
- Send / Stop
- Edit UI
- Share UI

FINAL FLOW
---------------------------------------------------------

message-actions.js
      ↓
neyo:message-regenerate-request
      ↓
regenerate.js
      ↓
NeyoChat.regenerate({
  messageId: assistantMessageId
})
      ↓
chat.js
      ↓
resolve preceding user message
      ↓
truncate future conversation
      ↓
preserve user attachments
      ↓
/api/chat
      ↓
new assistant message

IMPORTANT
---------------------------------------------------------
regenerate.js NEVER splices NeyoChat conversation itself.

chat.js is the sole conversation-state owner.

This prevents the old double-state problem where:
- neo.js mutated conversation
- regenerate.js mutated conversation
- DOM was also manually removed

MIGRATION RULE
---------------------------------------------------------
Works while neo.js is physically loaded.

message-actions.js capture-phase handler already prevents
legacy .regen-msg-btn click handling.

After neo.js removal this file continues unchanged.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-regenerate-final-v6";

  if (
    window.NeyoRegenerate
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      duplicateWindowMs:
        300,

      busyLabel:
        "Regenerating",

      idleLabel:
        "Regenerate"
    });

  /* =====================================================
     DOM
     ===================================================== */

  const chatMessages =
    document.getElementById(
      "chatMessages"
    );

  const active =
    Boolean(
      chatMessages
    );

  if (
    !active
  ) {
    console.warn(
      "[NEYO Regenerate] #chatMessages missing."
    );

    return;
  }

  /* =====================================================
     LEGACY TELEMETRY
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

  let regenerating =
    false;

  let activeAssistantMessageId =
    null;

  let activeUserMessageId =
    null;

  let requestSerial =
    0;

  let lastRequestKey =
    "";

  let lastRequestAt =
    0;

  let lastResult =
    null;

  const metrics = {
    requests:
      0,

    completed:
      0,

    failed:
      0,

    blockedGenerating:
      0,

    blockedDuplicate:
      0,

    invalidRequests:
      0,

    lastStartedAt:
      null,

    lastCompletedAt:
      null
  };

  /* =====================================================
     EVENT
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
     HELPERS
     ===================================================== */

  function cleanId(
    value
  ) {
    return String(
      value || ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .trim()
      .slice(
        0,
        256
      );
  }

  function cloneValue(
    value
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return value;
    }

    if (
      typeof structuredClone ===
      "function"
    ) {
      try {
        return structuredClone(
          value
        );
      } catch {}
    }

    try {
      return JSON.parse(
        JSON.stringify(
          value
        )
      );

    } catch {
      return value;
    }
  }

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  /* =====================================================
     CHAT
     ===================================================== */

  function getChat() {
    const chat =
      window.NeyoChat;

    return (
      chat &&
      typeof chat ===
        "object"
    )
      ? chat
      : null;
  }

  /* =====================================================
     GENERATING
     ===================================================== */

  function chatIsGenerating() {
    try {
      return (
        getChat()
          ?.isGenerating
          ?.() ===
        true
      );

    } catch {
      return false;
    }
  }

  /* =====================================================
     CONVERSATION
     ===================================================== */

  function getConversation() {
    try {
      const value =
        getChat()
          ?.getConversation
          ?.();

      return Array.isArray(
        value
      )
        ? value
        : [];

    } catch {
      return [];
    }
  }

  /* =====================================================
     MESSAGE ELEMENT
     ===================================================== */

  function getMessageElement(
    messageId
  ) {
    const id =
      cleanId(
        messageId
      );

    if (!id) {
      return null;
    }

    try {
      const element =
        window.NeyoMessages
          ?.getElement
          ?.(id);

      if (
        element instanceof
        HTMLElement
      ) {
        return element;
      }
    } catch {}

    return Array
      .from(
        chatMessages
          .querySelectorAll(
            ".message"
          )
      )
      .find(
        element =>
          cleanId(
            element.dataset
              ?.neyoMessageId ||
            element.dataset
              ?.messageId
          ) ===
          id
      ) ||
      null;
  }

  /* =====================================================
     RESOLVE MESSAGE ID
     ===================================================== */

  function resolveAssistantMessageId(
    request = {}
  ) {
    const direct =
      cleanId(
        request.messageId ||
        request.id ||
        request.message?.id
      );

    if (direct) {
      return direct;
    }

    const element =
      request.element;

    if (
      element instanceof
      HTMLElement
    ) {
      return cleanId(
        element.dataset
          ?.neyoMessageId ||
        element.dataset
          ?.messageId
      );
    }

    return "";
  }

  /* =====================================================
     MESSAGE LOOKUP
     ===================================================== */

  function findMessageIndex(
    messageId,
    conversation =
      getConversation()
  ) {
    const id =
      cleanId(
        messageId
      );

    if (!id) {
      return -1;
    }

    return conversation
      .findIndex(
        message =>
          cleanId(
            message?.id
          ) ===
          id
      );
  }

  /* =====================================================
     PRECEDING USER TURN

     Regenerate is anchored to the assistant response the
     user clicked, NOT blindly to the final user message.
     ===================================================== */

  function resolveTurn(
    assistantMessageId
  ) {
    const conversation =
      getConversation();

    if (
      conversation.length ===
      0
    ) {
      return null;
    }

    let assistantIndex =
      findMessageIndex(
        assistantMessageId,
        conversation
      );

    /*
     * Compatibility:
     * if stable assistant ID is absent in old DOM/state,
     * only allow fallback when the request corresponds to
     * the current final assistant response.
     */

    if (
      assistantIndex < 0
    ) {
      for (
        let index =
          conversation.length - 1;
        index >= 0;
        index -= 1
      ) {
        if (
          conversation[index]
            ?.role ===
          "assistant"
        ) {
          assistantIndex =
            index;

          break;
        }
      }
    }

    if (
      assistantIndex < 0
    ) {
      return null;
    }

    const assistantMessage =
      conversation[
        assistantIndex
      ];

    if (
      assistantMessage
        ?.role !==
      "assistant"
    ) {
      return null;
    }

    let userIndex =
      -1;

    for (
      let index =
        assistantIndex - 1;
      index >= 0;
      index -= 1
    ) {
      if (
        conversation[index]
          ?.role ===
        "user"
      ) {
        userIndex =
          index;

        break;
      }
    }

    if (
      userIndex < 0
    ) {
      return null;
    }

    const userMessage =
      conversation[
        userIndex
      ];

    return {
      conversation,

      assistantIndex,

      assistantMessage:
        cloneValue(
          assistantMessage
        ),

      userIndex,

      userMessage:
        cloneValue(
          userMessage
        )
    };
  }

  /* =====================================================
     BUTTON
     ===================================================== */

  function getRegenerateButton(
    messageId
  ) {
    const element =
      getMessageElement(
        messageId
      );

    return (
      element
        ?.querySelector(
          ".regen-msg-btn"
        ) ||
      null
    );
  }

  /* =====================================================
     BUTTON BUSY
     ===================================================== */

  function setButtonBusy(
    messageId,
    busy
  ) {
    const button =
      getRegenerateButton(
        messageId
      );

    if (!button) {
      return false;
    }

    if (
      busy
    ) {
      if (
        !button
          .dataset
          .neyoOriginalHtml
      ) {
        button.dataset
          .neyoOriginalHtml =
          button.innerHTML;
      }

      button.disabled =
        true;

      button.setAttribute(
        "aria-disabled",
        "true"
      );

      button.setAttribute(
        "aria-busy",
        "true"
      );

      button.setAttribute(
        "aria-label",
        CONFIG.busyLabel
      );

      button.title =
        CONFIG.busyLabel;

      button.classList.add(
        "is-regenerating"
      );

      button.innerHTML = `
        <i
          data-lucide="loader-circle"
          size="16"
          aria-hidden="true"
        ></i>
      `;

      refreshIcons();

      return true;
    }

    button.disabled =
      false;

    button.setAttribute(
      "aria-disabled",
      "false"
    );

    button.removeAttribute(
      "aria-busy"
    );

    button.setAttribute(
      "aria-label",
      "Regenerate response"
    );

    button.title =
      CONFIG.idleLabel;

    button.classList.remove(
      "is-regenerating"
    );

    button.innerHTML =
      button.dataset
        .neyoOriginalHtml ||
      `
        <i
          data-lucide="rotate-cw"
          size="16"
          aria-hidden="true"
        ></i>
      `;

    delete button.dataset
      .neyoOriginalHtml;

    refreshIcons();

    return true;
  }

  /* =====================================================
     ALL REGENERATE BUTTONS STATE
     ===================================================== */

  function syncButtons() {
    const buttons =
      chatMessages
        .querySelectorAll(
          ".regen-msg-btn"
        );

    for (
      const button
      of buttons
    ) {
      const element =
        button.closest(
          ".message"
        );

      const id =
        cleanId(
          element
            ?.dataset
            ?.neyoMessageId ||
          element
            ?.dataset
            ?.messageId
        );

      const isActive =
        regenerating &&
        id ===
          activeAssistantMessageId;

      if (
        isActive
      ) {
        setButtonBusy(
          id,
          true
        );

      } else {
        button.disabled =
          regenerating ||
          chatIsGenerating();

        button.setAttribute(
          "aria-disabled",
          String(
            button.disabled
          )
        );
      }
    }
  }

  /* =====================================================
     DUPLICATE GUARD

     message-actions.js emits both:
     - neyo:message-regenerate-request
     - neyo:regenerate-request

     They must result in ONE regeneration only.
     ===================================================== */

  function isDuplicateRequest(
    assistantMessageId
  ) {
    const now =
      performance.now();

    const key =
      cleanId(
        assistantMessageId
      ) ||
      "latest";

    if (
      lastRequestKey ===
        key &&
      now -
        lastRequestAt <
        CONFIG
          .duplicateWindowMs
    ) {
      metrics
        .blockedDuplicate +=
        1;

      return true;
    }

    lastRequestKey =
      key;

    lastRequestAt =
      now;

    return false;
  }

  /* =====================================================
     VALIDATE REQUEST
     ===================================================== */

  function validateRequest(
    request = {}
  ) {
    const chat =
      getChat();

    if (
      typeof chat
        ?.regenerate !==
      "function"
    ) {
      return {
        valid:
          false,

        reason:
          "Chat regenerate engine is unavailable."
      };
    }

    if (
      regenerating ||
      chatIsGenerating()
    ) {
      metrics
        .blockedGenerating +=
        1;

      return {
        valid:
          false,

        reason:
          "A response is already being generated."
      };
    }

    const assistantMessageId =
      resolveAssistantMessageId(
        request
      );

    if (
      !assistantMessageId
    ) {
      return {
        valid:
          false,

        reason:
          "Assistant message could not be identified."
      };
    }

    const turn =
      resolveTurn(
        assistantMessageId
      );

    if (!turn) {
      return {
        valid:
          false,

        reason:
          "The user turn for this response could not be found.",

        assistantMessageId
      };
    }

    if (
      turn.assistantMessage
        ?.error ===
      true
    ) {
      /*
       * Error messages can still be regenerated as long
       * as a preceding user turn exists.
       */
    }

    return {
      valid:
        true,

      assistantMessageId,

      userMessageId:
        cleanId(
          turn.userMessage?.id
        ),

      turn
    };
  }

  /* =====================================================
     REGENERATE
     ===================================================== */

  async function regenerate(
    request = {}
  ) {
    const validation =
      validateRequest(
        request
      );

    if (
      !validation.valid
    ) {
      metrics
        .invalidRequests +=
        1;

      emit(
        "neyo:regenerate-blocked",
        {
          reason:
            validation.reason,

          assistantMessageId:
            validation
              .assistantMessageId ||
            null
        }
      );

      return null;
    }

    const {
      assistantMessageId,
      userMessageId,
      turn
    } =
      validation;

    if (
      isDuplicateRequest(
        assistantMessageId
      )
    ) {
      return null;
    }

    const serial =
      ++requestSerial;

    regenerating =
      true;

    activeAssistantMessageId =
      assistantMessageId;

    activeUserMessageId =
      userMessageId ||
      null;

    metrics.requests +=
      1;

    metrics.lastStartedAt =
      Date.now();

    lastResult =
      null;

    setButtonBusy(
      assistantMessageId,
      true
    );

    syncButtons();

    emit(
      "neyo:regenerate-start",
      {
        requestSerial:
          serial,

        assistantMessageId,

        userMessageId:
          activeUserMessageId,

        assistantIndex:
          turn.assistantIndex,

        userIndex:
          turn.userIndex,

        userMessage:
          cloneValue(
            turn.userMessage
          ),

        assistantMessage:
          cloneValue(
            turn.assistantMessage
          )
      }
    );

    try {
      /*
       * SINGLE CANONICAL OPERATION.
       *
       * chat.js:
       * - resolves assistant → preceding user
       * - truncates after user
       * - preserves user attachments
       * - performs new /api/chat request
       * - creates new assistant message
       */

      const result =
        await getChat()
          .regenerate({
            messageId:
              assistantMessageId
          });

      /*
       * A newer regeneration should never be overwritten
       * by completion bookkeeping from an older request.
       */

      if (
        serial !==
        requestSerial
      ) {
        return null;
      }

      lastResult =
        cloneValue(
          result
        );

      if (
        result
      ) {
        metrics.completed +=
          1;

        metrics.lastCompletedAt =
          Date.now();

        emit(
          "neyo:regenerate-complete",
          {
            requestSerial:
              serial,

            assistantMessageId,

            userMessageId:
              activeUserMessageId,

            result:
              cloneValue(
                result
              )
          }
        );

        return result;
      }

      /*
       * chat.js returns null for:
       * - abort
       * - limit reached
       * - failed request handled by chat.js
       * - stale request
       *
       * Do not invent a second error message.
       */

      emit(
        "neyo:regenerate-finished",
        {
          requestSerial:
            serial,

          assistantMessageId,

          userMessageId:
            activeUserMessageId,

          result:
            null
        }
      );

      return null;

    } catch (
      error
    ) {
      if (
        serial !==
        requestSerial
      ) {
        return null;
      }

      metrics.failed +=
        1;

      console.error(
        "[NEYO Regenerate] Failed:",
        error
      );

      emit(
        "neyo:regenerate-error",
        {
          requestSerial:
            serial,

          assistantMessageId,

          userMessageId:
            activeUserMessageId,

          error,

          message:
            error?.message ||
            "Response could not be regenerated."
        }
      );

      return null;

    } finally {
      if (
        serial ===
        requestSerial
      ) {
        const oldAssistantId =
          activeAssistantMessageId;

        regenerating =
          false;

        activeAssistantMessageId =
          null;

        activeUserMessageId =
          null;

        /*
         * Old assistant element may already have been
         * removed by chat.js truncation. Safe either way.
         */

        setButtonBusy(
          oldAssistantId,
          false
        );

        syncButtons();

        emit(
          "neyo:regenerate-end",
          {
            requestSerial:
              serial,

            assistantMessageId:
              oldAssistantId
          }
        );
      }
    }
  }

  /* =====================================================
     CANCEL / STOP

     Regenerate does not own request controller.
     It delegates to chat.js.
     ===================================================== */

  function stop(
    reason =
      "regenerate-stop"
  ) {
    if (
      !regenerating
    ) {
      return false;
    }

    try {
      return Boolean(
        getChat()
          ?.stop
          ?.(reason)
      );

    } catch {
      return false;
    }
  }

  /* =====================================================
     CAN REGENERATE
     ===================================================== */

  function canRegenerate(
    messageId
  ) {
    if (
      regenerating ||
      chatIsGenerating()
    ) {
      return false;
    }

    const id =
      cleanId(
        messageId
      );

    if (!id) {
      return false;
    }

    return Boolean(
      resolveTurn(
        id
      )
    );
  }

  /* =====================================================
     CANONICAL REQUEST EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:message-regenerate-request",
    event => {
      void regenerate(
        event.detail ||
        {}
      );
    }
  );

  /* =====================================================
     COMPATIBILITY REQUEST EVENT

     message-actions currently emits both events.
     Duplicate guard ensures one actual request.
     ===================================================== */

  window.addEventListener(
    "neyo:regenerate-request",
    event => {
      void regenerate(
        event.detail ||
        {}
      );
    }
  );

  /* =====================================================
     CHAT GENERATION STATE

     Keep button availability synchronized even when
     generation started from Send/Edit rather than regen.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    syncButtons
  );

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
      () => {
        requestAnimationFrame(
          syncButtons
        );
      }
    );
  }

  /* =====================================================
     NEW MESSAGE ACTIONS
     ===================================================== */

  window.addEventListener(
    "neyo:message-actions-hydrated",
    () => {
      syncButtons();
    }
  );

  /* =====================================================
     NEW CHAT / HISTORY SWITCH

     A different conversation makes old local regenerate
     bookkeeping irrelevant.

     chat.js itself owns request invalidation.
     ===================================================== */

  for (
    const eventName
    of [
      "neyo:chat-new",
      "neyo:chat-state-loaded"
    ]
  ) {
    window.addEventListener(
      eventName,
      () => {
        requestSerial +=
          1;

        regenerating =
          false;

        activeAssistantMessageId =
          null;

        activeUserMessageId =
          null;

        lastResult =
          null;

        requestAnimationFrame(
          syncButtons
        );
      }
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

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      /*
       * Main operation
       */

      regenerate,

      run:
        regenerate,

      request:
        regenerate,

      /*
       * Stop
       */

      stop,

      /*
       * Resolution / diagnostics
       */

      resolveTurn,

      canRegenerate,

      /*
       * State
       */

      isRegenerating() {
        return regenerating;
      },

      getActiveAssistantMessageId() {
        return activeAssistantMessageId;
      },

      getActiveUserMessageId() {
        return activeUserMessageId;
      },

      getLastResult() {
        return cloneValue(
          lastResult
        );
      },

      syncButtons,

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          legacyScriptPresent,

          legacyOwnerActive:
            false,

          regenerating,

          chatGenerating:
            chatIsGenerating(),

          activeAssistantMessageId,

          activeUserMessageId,

          requestSerial,

          lastResult:
            cloneValue(
              lastResult
            ),

          metrics: {
            ...metrics
          }
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoRegenerate",
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

  syncButtons();

  emit(
    "neyo:regenerate-ready",
    {
      version:
        VERSION,

      active:
        true,

      canonicalChatOwner:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false
    }
  );
})();
