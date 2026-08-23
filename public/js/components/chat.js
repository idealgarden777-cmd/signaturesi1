/*
=========================================================
NEYO — CHAT CORE
FINAL PRODUCTION MIXER v10

FILE:
public/js/components/chat.js

OWNS
---------------------------------------------------------
- Single authoritative conversation state
- /api/chat requests
- Conversation ID
- Request lifecycle
- Abort / Stop
- Stale request protection
- Duplicate generation protection
- User / assistant message state
- Attachment metadata in conversation
- Sources metadata
- Preferences
- Private Chat
- Deep Research
- Model selection
- History synchronization events
- Conversation loading
- Message mutation primitives
- Edit / truncate primitives
- Regeneration primitives
- Error / limit lifecycle
- Public chat state events

DOES NOT OWN
---------------------------------------------------------
- Send button
- Enter key
- Composer text cleanup
- Attachment upload / processing
- Message DOM
- Markdown
- Thinking DOM
- Sidebar/history rendering
- Copy/share UI
- Edit UI
- Regenerate button UI
- Voice

PIPELINE
---------------------------------------------------------

send-state.js
     ↓
neyo:chat-send-request
     ↓
chat.js
     ↓
neyo:chat-message-added
     ↓
messages.js
     ↓
message-renderer.js

MIGRATION RULE
---------------------------------------------------------
This module is authoritative regardless of whether neo.js
is still physically loaded.

After neo.js is removed, no chat transport migration should
be required.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-chat-final-v10";

  if (
    window.NeyoChat
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      endpoint:
        "/api/chat",

      maxHistoryMessages:
        50,

      maxAttachments:
        5,

      maxMessageLength:
        50_000,

      maxTitleLength:
        80,

      requestTimeoutMs:
        180_000,

      attachmentOnlyPrompt:
        "Please analyze the attached file or files."
    });

  /* =====================================================
     LEGACY TELEMETRY

     neo.js presence is informational only.
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
     DEFAULT PREFERENCES
     ===================================================== */

  const DEFAULT_PREFERENCES =
    Object.freeze({
      intelligence:
        "standard",

      language:
        "auto",

      personality:
        "neyo",

      privateChat:
        false,

      isDeepResearch:
        false
    });

  /* =====================================================
     STATE
     ===================================================== */

  let conversation =
    [];

  let currentConversationId =
    null;

  let generating =
    false;

  let activeController =
    null;

  let requestSerial =
    0;

  let activeRequestId =
    null;

  let activeRequestStartedAt =
    null;

  let lastCompletedRequestId =
    null;

  let lastResult =
    null;

  let preferences =
    {
      ...DEFAULT_PREFERENCES
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
     ID
     ===================================================== */

  function createId(
    prefix = "msg"
  ) {
    return (
      globalThis.crypto
        ?.randomUUID
        ?.() ||
      (
        `${prefix}_${Date.now()}_` +
        Math.random()
          .toString(36)
          .slice(2)
      )
    );
  }

  /* =====================================================
     TEXT
     ===================================================== */

  function cleanText(
    value,
    max =
      CONFIG.maxMessageLength
  ) {
    return String(
      value ?? ""
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
        max
      )
      .trim();
  }

  function cleanIdentifier(
    value,
    max = 256
  ) {
    return String(
      value ?? ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .trim()
      .slice(
        0,
        max
      );
  }

  /* =====================================================
     SAFE CLONE
     ===================================================== */

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
        JSON.stringify(value)
      );
    } catch {
      return value;
    }
  }

  /* =====================================================
     ATTACHMENT NORMALIZATION
     ===================================================== */

  function normalizeAttachment(
    attachment
  ) {
    if (
      !attachment ||
      typeof attachment !==
        "object"
    ) {
      return null;
    }

    const mime =
      cleanIdentifier(
        attachment.mimeType ||
        attachment.mime ||
        attachment.type ||
        "application/octet-stream",
        200
      ) ||
      "application/octet-stream";

    const bucket =
      cleanIdentifier(
        attachment.bucket,
        256
      );

    const path =
      cleanIdentifier(
        attachment.path,
        2000
      );

    /*
     * Chat transport only accepts files
     * that have real storage identity.
     */

    if (
      !bucket ||
      !path
    ) {
      return null;
    }

    return {
      id:
        cleanIdentifier(
          attachment.id,
          256
        ) ||
        undefined,

      uploadId:
        cleanIdentifier(
          attachment.uploadId,
          256
        ) ||
        undefined,

      processId:
        cleanIdentifier(
          attachment.processId,
          256
        ) ||
        undefined,

      documentId:
        cleanIdentifier(
          attachment.documentId,
          256
        ) ||
        undefined,

      provider:
        cleanIdentifier(
          attachment.provider,
          100
        ) ||
        "supabase",

      bucket,

      path,

      name:
        cleanText(
          attachment.name,
          255
        ) ||
        "Attached file",

      mime,

      mimeType:
        mime,

      type:
        mime,

      extension:
        cleanIdentifier(
          attachment.extension ||
          attachment.ext,
          30
        ) ||
        undefined,

      ext:
        cleanIdentifier(
          attachment.extension ||
          attachment.ext,
          30
        ) ||
        undefined,

      category:
        cleanIdentifier(
          attachment.category,
          100
        ) ||
        "unknown",

      size:
        Math.max(
          0,
          Number(
            attachment.size
          ) ||
          0
        ),

      uploadedSize:
        Math.max(
          0,
          Number(
            attachment.uploadedSize
          ) ||
          Number(
            attachment.size
          ) ||
          0
        ),

      status:
        attachment.status ||
        "ready",

      ready:
        true,

      document:
        attachment.document ??
        undefined,

      chunks:
        Array.isArray(
          attachment.chunks
        )
          ? cloneValue(
              attachment.chunks
            )
          : undefined,

      stats:
        attachment.stats ??
        undefined,

      extraction:
        attachment.extraction ??
        undefined,

      warnings:
        Array.isArray(
          attachment.warnings
        )
          ? [
              ...attachment.warnings
            ]
          : undefined,

      /*
       * previewUrl is useful for current-session
       * UI only. Backend can safely ignore it.
       */

      previewUrl:
        typeof attachment.previewUrl ===
          "string"
          ? attachment.previewUrl
          : undefined
    };
  }

  function normalizeAttachments(
    attachments
  ) {
    if (
      !Array.isArray(
        attachments
      )
    ) {
      return [];
    }

    const result =
      [];

    const seen =
      new Set();

    for (
      const attachment
      of attachments
    ) {
      if (
        result.length >=
        CONFIG.maxAttachments
      ) {
        break;
      }

      const normalized =
        normalizeAttachment(
          attachment
        );

      if (!normalized) {
        continue;
      }

      const key =
        `${normalized.bucket}:${normalized.path}`;

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);

      result.push(
        normalized
      );
    }

    return result;
  }

  /* =====================================================
     SOURCE NORMALIZATION

     Preserve backend source data while cloning it
     away from external mutable objects.
     ===================================================== */

  function normalizeSources(
    sources
  ) {
    if (
      !Array.isArray(
        sources
      )
    ) {
      return [];
    }

    return sources
      .filter(
        source =>
          source &&
          typeof source ===
            "object"
      )
      .slice(
        0,
        50
      )
      .map(
        source =>
          cloneValue(
            source
          )
      );
  }

  /* =====================================================
     MESSAGE NORMALIZATION
     ===================================================== */

  function normalizeMessage(
    message
  ) {
    if (
      !message ||
      typeof message !==
        "object"
    ) {
      return null;
    }

    const role =
      message.role;

    if (
      role !== "user" &&
      role !== "assistant"
    ) {
      return null;
    }

    const normalized =
      {
        id:
          cleanIdentifier(
            message.id,
            256
          ) ||
          createId(),

        role,

        content:
          cleanText(
            message.content
          )
      };

    const attachments =
      normalizeAttachments(
        message.attachments
      );

    if (
      attachments.length
    ) {
      normalized.attachments =
        attachments;
    }

    const sources =
      normalizeSources(
        message.sources
      );

    if (
      sources.length
    ) {
      normalized.sources =
        sources;
    }

    if (
      message.error ===
      true
    ) {
      normalized.error =
        true;
    }

    /*
     * Preserve useful metadata used by future
     * message-actions / analytics without allowing
     * it to alter transport behavior.
     */

    if (
      message.createdAt
    ) {
      normalized.createdAt =
        message.createdAt;
    }

    if (
      message.updatedAt
    ) {
      normalized.updatedAt =
        message.updatedAt;
    }

    return normalized;
  }

  /* =====================================================
     API MESSAGE
     ===================================================== */

  function toApiMessage(
    message
  ) {
    const result =
      {
        role:
          message.role,

        content:
          cleanText(
            message.content
          )
      };

    if (
      Array.isArray(
        message.attachments
      ) &&
      message.attachments.length
    ) {
      result.attachments =
        normalizeAttachments(
          message.attachments
        );
    }

    return result;
  }

  /* =====================================================
     CONVERSATION BOUNDS
     ===================================================== */

  function boundConversation() {
    if (
      conversation.length <=
      CONFIG.maxHistoryMessages
    ) {
      return false;
    }

    conversation =
      conversation.slice(
        -CONFIG.maxHistoryMessages
      );

    return true;
  }

  /* =====================================================
     GET CONVERSATION
     ===================================================== */

  function getConversation() {
    return conversation.map(
      message =>
        cloneValue(
          message
        )
    );
  }

  /* =====================================================
     GET MESSAGE
     ===================================================== */

  function getMessage(
    id
  ) {
    const key =
      cleanIdentifier(
        id
      );

    if (!key) {
      return null;
    }

    const message =
      conversation.find(
        item =>
          item.id === key
      );

    return message
      ? cloneValue(
          message
        )
      : null;
  }

  /* =====================================================
     MESSAGE INDEX
     ===================================================== */

  function getMessageIndex(
    id
  ) {
    const key =
      cleanIdentifier(
        id
      );

    if (!key) {
      return -1;
    }

    return conversation
      .findIndex(
        message =>
          message.id === key
      );
  }

  /* =====================================================
     ADD MESSAGE
     ===================================================== */

  function addMessage(
    role,
    content,
    options = {}
  ) {
    const message =
      normalizeMessage({
        id:
          options.id ||
          createId(),

        role,

        content,

        attachments:
          options.attachments,

        sources:
          options.sources,

        error:
          options.error,

        createdAt:
          options.createdAt ||
          Date.now(),

        updatedAt:
          options.updatedAt
      });

    if (!message) {
      return null;
    }

    conversation.push(
      message
    );

    boundConversation();

    emit(
      "neyo:chat-message-added",
      {
        message:
          cloneValue(
            message
          ),

        conversation:
          getConversation(),

        historyLoad:
          options.historyLoad ===
          true
      }
    );

    return cloneValue(
      message
    );
  }

  /* =====================================================
     UPDATE MESSAGE
     ===================================================== */

  function updateMessage(
    id,
    values = {},
    options = {}
  ) {
    const index =
      getMessageIndex(
        id
      );

    if (
      index < 0 ||
      !values ||
      typeof values !==
        "object"
    ) {
      return null;
    }

    const current =
      conversation[index];

    const next =
      {
        ...current
      };

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          values,
          "content"
        )
    ) {
      const content =
        cleanText(
          values.content
        );

      /*
       * User messages cannot become empty
       * unless they still own an attachment.
       */

      if (
        current.role === "user" &&
        !content &&
        !(
          Array.isArray(
            current.attachments
          ) &&
          current.attachments.length
        )
      ) {
        return null;
      }

      next.content =
        content;
    }

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          values,
          "attachments"
        )
    ) {
      const attachments =
        normalizeAttachments(
          values.attachments
        );

      if (
        attachments.length
      ) {
        next.attachments =
          attachments;
      } else {
        delete next.attachments;
      }
    }

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          values,
          "sources"
        )
    ) {
      const sources =
        normalizeSources(
          values.sources
        );

      if (
        sources.length
      ) {
        next.sources =
          sources;
      } else {
        delete next.sources;
      }
    }

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          values,
          "error"
        )
    ) {
      if (
        values.error === true
      ) {
        next.error =
          true;
      } else {
        delete next.error;
      }
    }

    next.updatedAt =
      Date.now();

    conversation[index] =
      next;

    emit(
      "neyo:chat-message-updated",
      {
        message:
          cloneValue(
            next
          ),

        index,

        conversation:
          getConversation()
      }
    );

    /*
     * Existing messages.js contract.
     */

    emit(
      "neyo:message-update-request",
      {
        id:
          next.id,

        message:
          cloneValue(
            next
          ),

        content:
          next.content,

        options: {
          markdown:
            next.role ===
            "assistant"
        }
      }
    );

    if (
      options.emitState !==
      false
    ) {
      emitState();
    }

    return cloneValue(
      next
    );
  }

  /* =====================================================
     REMOVE MESSAGE
     ===================================================== */

  function removeMessage(
    id,
    options = {}
  ) {
    const index =
      getMessageIndex(
        id
      );

    if (
      index < 0
    ) {
      return false;
    }

    const [
      removed
    ] =
      conversation.splice(
        index,
        1
      );

    emit(
      "neyo:chat-message-removed",
      {
        id:
          removed.id,

        message:
          cloneValue(
            removed
          ),

        index,

        conversation:
          getConversation()
      }
    );

    if (
      options.emitState !==
      false
    ) {
      emitState();
    }

    return true;
  }

  /* =====================================================
     REMOVE MESSAGES AFTER INDEX
     ===================================================== */

  function truncateAfterIndex(
    index,
    {
      includeIndex =
        false
    } = {}
  ) {
    if (
      !Number.isInteger(
        index
      ) ||
      index < 0 ||
      index >=
        conversation.length
    ) {
      return [];
    }

    const start =
      includeIndex
        ? index
        : index + 1;

    const removed =
      conversation.splice(
        start
      );

    for (
      const message
      of removed
    ) {
      emit(
        "neyo:chat-message-removed",
        {
          id:
            message.id,

          message:
            cloneValue(
              message
            ),

          conversation:
            getConversation()
        }
      );
    }

    emitState();

    return removed.map(
      cloneValue
    );
  }

  /* =====================================================
     TRUNCATE AFTER MESSAGE
     ===================================================== */

  function truncateAfter(
    id,
    options = {}
  ) {
    const index =
      getMessageIndex(
        id
      );

    if (
      index < 0
    ) {
      return [];
    }

    return truncateAfterIndex(
      index,
      options
    );
  }

  /* =====================================================
     MODEL
     ===================================================== */

  function getSelectedModel() {
    try {
      const menu =
        window.NeyoModelMenu;

      const value =
        menu?.getSelected?.() ??
        menu?.getValue?.() ??
        menu?.value;

      const clean =
        cleanIdentifier(
          value,
          100
        );

      return (
        clean ||
        "l1.0"
      );

    } catch {
      return "l1.0";
    }
  }

  /* =====================================================
     TITLE
     ===================================================== */

  function createTitle(
    text,
    attachments
  ) {
    const clean =
      cleanText(
        text
      );

    if (clean) {
      return clean
        .replace(
          /\s+/g,
          " "
        )
        .slice(
          0,
          CONFIG.maxTitleLength
        );
    }

    if (
      Array.isArray(
        attachments
      ) &&
      attachments.length
    ) {
      return cleanText(
        attachments[0]
          ?.name ||
        "New conversation",
        CONFIG.maxTitleLength
      );
    }

    return "New conversation";
  }

  /* =====================================================
     PREFERENCE NORMALIZATION
     ===================================================== */

  function normalizePreferences(
    values = {}
  ) {
    const next =
      {
        ...preferences
      };

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          values,
          "intelligence"
        )
    ) {
      next.intelligence =
        cleanIdentifier(
          values.intelligence,
          100
        ) ||
        DEFAULT_PREFERENCES
          .intelligence;
    }

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          values,
          "language"
        )
    ) {
      next.language =
        cleanIdentifier(
          values.language,
          100
        ) ||
        DEFAULT_PREFERENCES
          .language;
    }

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          values,
          "personality"
        )
    ) {
      next.personality =
        cleanIdentifier(
          values.personality,
          100
        ) ||
        DEFAULT_PREFERENCES
          .personality;
    }

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          values,
          "privateChat"
        )
    ) {
      next.privateChat =
        Boolean(
          values.privateChat
        );
    }

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          values,
          "isDeepResearch"
        )
    ) {
      next.isDeepResearch =
        Boolean(
          values
            .isDeepResearch
        );
    }

    /*
     * Compatibility alias.
     */

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          values,
          "deepResearch"
        )
    ) {
      next.isDeepResearch =
        Boolean(
          values.deepResearch
        );
    }

    return next;
  }

  /* =====================================================
     SET PREFERENCES
     ===================================================== */

  function setPreferences(
    values
  ) {
    if (
      !values ||
      typeof values !==
        "object"
    ) {
      return false;
    }

    const previousPrivate =
      preferences
        .privateChat;

    preferences =
      normalizePreferences(
        values
      );

    /*
     * Entering Private Chat disconnects the current
     * persisted conversation ID so the private turn
     * cannot accidentally continue a stored thread.
     */

    if (
      !previousPrivate &&
      preferences.privateChat
    ) {
      currentConversationId =
        null;
    }

    emit(
      "neyo:chat-preferences-change",
      {
        preferences:
          {
            ...preferences
          }
      }
    );

    emitState();

    return true;
  }

  /* =====================================================
     BUILD PAYLOAD
     ===================================================== */

  function buildPayload({
    prompt,
    attachments
  }) {
    const privateChat =
      Boolean(
        preferences.privateChat
      );

    const deepResearch =
      Boolean(
        preferences
          .isDeepResearch
      );

    return {
      messages:
        conversation
          .slice(
            -CONFIG
              .maxHistoryMessages
          )
          .map(
            toApiMessage
          ),

      attachments:
        normalizeAttachments(
          attachments
        ),

      conversationId:
        privateChat
          ? null
          : currentConversationId,

      model:
        getSelectedModel(),

      intelligence:
        preferences
          .intelligence,

      language:
        preferences
          .language,

      personality:
        preferences
          .personality,

      privateChat,

      /*
       * Current backend contract.
       */

      isDeepResearch:
        deepResearch,

      /*
       * Compatibility alias for backend versions
       * that used deepResearch directly.
       */

      deepResearch,

      title:
        createTitle(
          prompt,
          attachments
        )
    };
  }

  /* =====================================================
     RESPONSE READER
     ===================================================== */

  async function readResponse(
    response
  ) {
    const raw =
      await response.text();

    let data =
      {};

    if (raw) {
      try {
        data =
          JSON.parse(
            raw
          );

      } catch {
        data =
          {};
      }
    }

    if (
      !response.ok
    ) {
      const message =
        cleanText(
          data?.message ||
          data?.error ||
          raw
        ) ||
        `Request failed (${response.status}).`;

      const error =
        new Error(
          message
        );

      error.status =
        response.status;

      error.data =
        data;

      throw error;
    }

    return data;
  }

  /* =====================================================
     REPLY EXTRACTION
     ===================================================== */

  function extractReply(
    data
  ) {
    const value =
      data?.reply ??
      data?.choices?.[0]
        ?.message
        ?.content ??
      data?.message
        ?.content ??
      data?.content ??
      data?.text;

    return (
      typeof value ===
      "string"
    )
      ? cleanText(
          value
        )
      : "";
  }

  /* =====================================================
     ERROR MESSAGE
     ===================================================== */

  function userFacingError(
    error
  ) {
    if (
      error?.status ===
      400
    ) {
      return (
        cleanText(
          error.message
        ) ||
        "This request could not be processed."
      );
    }

    if (
      error?.status ===
      401
    ) {
      return "Your session has expired. Please sign in again.";
    }

    if (
      error?.status ===
      403
    ) {
      return "You do not have access to this request.";
    }

    if (
      error?.status ===
      413
    ) {
      return "This request is too large.";
    }

    if (
      error?.status ===
      429
    ) {
      return (
        cleanText(
          error?.data
            ?.message ||
          error?.message
        ) ||
        "You have reached your current message limit."
      );
    }

    if (
      Number(
        error?.status
      ) >= 500
    ) {
      return "NEYO is temporarily unavailable. Please try again.";
    }

    if (
      error?.message
    ) {
      return cleanText(
        error.message
      );
    }

    return "Something went wrong. Please try again.";
  }

  /* =====================================================
     STOP
     ===================================================== */

  function stop(
    reason =
      "user"
  ) {
    if (
      !activeController
    ) {
      return false;
    }

    try {
      activeController.abort(
        reason
      );

      return true;

    } catch {
      try {
        activeController.abort();

        return true;

      } catch {
        return false;
      }
    }
  }

  /* =====================================================
     REQUEST CONTEXT
     ===================================================== */

  function beginRequest({
    text,
    attachments,
    mode = "send"
  }) {
    const requestId =
      ++requestSerial;

    activeRequestId =
      requestId;

    activeRequestStartedAt =
      Date.now();

    generating =
      true;

    const controller =
      new AbortController();

    activeController =
      controller;

    emit(
      "neyo:chat-send-start",
      {
        requestId,

        mode,

        text:
          cleanText(text),

        attachments:
          normalizeAttachments(
            attachments
          ),

        conversationId:
          currentConversationId,

        privateChat:
          Boolean(
            preferences.privateChat
          )
      }
    );

    return {
      requestId,
      controller
    };
  }

  /* =====================================================
     REQUEST IS CURRENT
     ===================================================== */

  function requestIsCurrent(
    requestId
  ) {
    return (
      requestId ===
      activeRequestId
    );
  }

  /* =====================================================
     HISTORY REFRESH
     ===================================================== */

  function requestHistoryRefresh() {
    if (
      preferences.privateChat
    ) {
      return;
    }

    const detail =
      {
        conversationId:
          currentConversationId
      };

    /*
     * Canonical event.
     */

    emit(
      "neyo:history-refresh-request",
      detail
    );

    /*
     * Compatibility event used by older history.js.
     */

    emit(
      "neyo:history-load-request",
      detail
    );
  }

  /* =====================================================
     EXECUTE AI REQUEST

     Conversation must already end in a user message.
     ===================================================== */

  async function executeRequest({
    prompt,
    attachments = [],
    mode = "send"
  }) {
    if (
      generating
    ) {
      emit(
        "neyo:chat-busy",
        {
          requestId:
            activeRequestId,

          mode
        }
      );

      return null;
    }

    const normalizedAttachments =
      normalizeAttachments(
        attachments
      );

    const {
      requestId,
      controller
    } =
      beginRequest({
        text:
          prompt,

        attachments:
          normalizedAttachments,

        mode
      });

    let timeout =
      null;

    try {
      timeout =
        window.setTimeout(
          () => {
            if (
              requestIsCurrent(
                requestId
              )
            ) {
              try {
                controller.abort(
                  "timeout"
                );
              } catch {
                try {
                  controller.abort();
                } catch {}
              }
            }
          },
          CONFIG.requestTimeoutMs
        );

      const payload =
        buildPayload({
          prompt,

          attachments:
            normalizedAttachments
        });

      const response =
        await fetch(
          CONFIG.endpoint,
          {
            method:
              "POST",

            credentials:
              "include",

            cache:
              "no-store",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json",

              "X-Neyo-Chat-Client":
                VERSION
            },

            body:
              JSON.stringify(
                payload
              ),

            signal:
              controller.signal
          }
        );

      /* =================================================
         RATE LIMIT
         ================================================= */

      if (
        response.status ===
        429
      ) {
        let data =
          {};

        try {
          data =
            await response
              .json();

        } catch {}

        if (
          !requestIsCurrent(
            requestId
          )
        ) {
          return null;
        }

        emit(
          "neyo:chat-limit-reached",
          {
            requestId,

            data,

            conversationId:
              currentConversationId
          }
        );

        return null;
      }

      const data =
        await readResponse(
          response
        );

      /* =================================================
         STALE REQUEST
         ================================================= */

      if (
        !requestIsCurrent(
          requestId
        )
      ) {
        return null;
      }

      const reply =
        extractReply(
          data
        );

      if (!reply) {
        throw new Error(
          "The AI response was empty."
        );
      }

      /* =================================================
         CONVERSATION ID
         ================================================= */

      if (
        !preferences
          .privateChat &&
        typeof data
          ?.conversationId ===
          "string" &&
        data.conversationId
          .trim()
      ) {
        currentConversationId =
          data.conversationId
            .trim();
      }

      /* =================================================
         SOURCES
         ================================================= */

      const sources =
        normalizeSources(
          data?.sources
        );

      /* =================================================
         ASSISTANT MESSAGE
         ================================================= */

      const assistantMessage =
        addMessage(
          "assistant",
          reply,
          {
            sources
          }
        );

      const result =
        {
          requestId,

          mode,

          reply,

          sources,

          message:
            assistantMessage,

          conversationId:
            currentConversationId,

          privateChat:
            Boolean(
              data?.privateChat ??
              preferences.privateChat
            ),

          usedUrlContext:
            Boolean(
              data
                ?.usedUrlContext
            ),

          creditType:
            data?.creditType ||
            null,

          usage:
            data?.usage ??
            null
        };

      lastResult =
        cloneValue(
          result
        );

      lastCompletedRequestId =
        requestId;

      emit(
        "neyo:chat-response",
        cloneValue(
          result
        )
      );

      requestHistoryRefresh();

      return result;

    } catch (
      error
    ) {
      if (
        !requestIsCurrent(
          requestId
        )
      ) {
        return null;
      }

      if (
        error?.name ===
        "AbortError"
      ) {
        emit(
          "neyo:chat-aborted",
          {
            requestId,

            mode,

            conversationId:
              currentConversationId,

            reason:
              error?.message ||
              "aborted"
          }
        );

        return null;
      }

      const readable =
        userFacingError(
          error
        );

      const errorMessage =
        addMessage(
          "assistant",
          `⚠️ ${readable}`,
          {
            error:
              true
          }
        );

      emit(
        "neyo:chat-error",
        {
          requestId,

          mode,

          error,

          message:
            errorMessage,

          conversationId:
            currentConversationId
        }
      );

      return null;

    } finally {
      if (
        timeout !== null
      ) {
        window.clearTimeout(
          timeout
        );
      }

      /*
       * Only current request may unlock state.
       */

      if (
        requestIsCurrent(
          requestId
        )
      ) {
        generating =
          false;

        activeController =
          null;

        activeRequestId =
          null;

        activeRequestStartedAt =
          null;

        emit(
          "neyo:chat-send-end",
          {
            requestId,

            mode,

            conversationId:
              currentConversationId
          }
        );
      }
    }
  }

  /* =====================================================
     NORMAL SEND
     ===================================================== */

  async function send({
    text = "",
    attachments = []
  } = {}) {
    if (
      generating
    ) {
      emit(
        "neyo:chat-busy",
        {
          requestId:
            activeRequestId,

          mode:
            "send"
        }
      );

      return null;
    }

    const clean =
      cleanText(
        text
      );

    const readyAttachments =
      normalizeAttachments(
        attachments
      );

    if (
      !clean &&
      readyAttachments.length ===
        0
    ) {
      return null;
    }

    const apiContent =
      clean ||
      CONFIG
        .attachmentOnlyPrompt;

    /*
     * User state is added synchronously before the
     * first network await. This also allows send-state
     * to detect that chat accepted the dispatch.
     */

    const userMessage =
      addMessage(
        "user",
        apiContent,
        {
          attachments:
            readyAttachments
        }
      );

    if (!userMessage) {
      return null;
    }

    return executeRequest({
      prompt:
        apiContent,

      attachments:
        readyAttachments,

      mode:
        "send"
    });
  }

  /* =====================================================
     FIND LAST USER MESSAGE
     ===================================================== */

  function findLastUserIndex() {
    for (
      let index =
        conversation.length - 1;
      index >= 0;
      index -= 1
    ) {
      if (
        conversation[index]
          ?.role ===
        "user"
      ) {
        return index;
      }
    }

    return -1;
  }

  /* =====================================================
     REGENERATE

     Removes messages after the chosen user message,
     then asks backend again WITHOUT duplicating user input.

     This replaces the old neo.js regenerate behavior.
     ===================================================== */

  async function regenerate({
    messageId = null
  } = {}) {
    if (
      generating
    ) {
      return null;
    }

    let userIndex =
      -1;

    if (messageId) {
      const index =
        getMessageIndex(
          messageId
        );

      if (
        index >= 0
      ) {
        if (
          conversation[index]
            .role ===
          "user"
        ) {
          userIndex =
            index;

        } else {
          for (
            let cursor =
              index - 1;
            cursor >= 0;
            cursor -= 1
          ) {
            if (
              conversation[cursor]
                ?.role ===
              "user"
            ) {
              userIndex =
                cursor;

              break;
            }
          }
        }
      }
    }

    if (
      userIndex < 0
    ) {
      userIndex =
        findLastUserIndex();
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

    truncateAfterIndex(
      userIndex
    );

    emit(
      "neyo:chat-regenerate-start",
      {
        messageId:
          userMessage.id,

        index:
          userIndex
      }
    );

    const result =
      await executeRequest({
        prompt:
          userMessage.content,

        attachments:
          userMessage.attachments ||
          [],

        mode:
          "regenerate"
      });

    emit(
      "neyo:chat-regenerate-end",
      {
        messageId:
          userMessage.id,

        result:
          cloneValue(
            result
          )
      }
    );

    return result;
  }

  /* =====================================================
     EDIT USER MESSAGE + REGENERATE

     Core business operation only.
     UI belongs to message-actions/message-edit.
     ===================================================== */

  async function editUserMessage(
    id,
    newContent,
    {
      regenerateResponse =
        true
    } = {}
  ) {
    if (
      generating
    ) {
      return null;
    }

    const index =
      getMessageIndex(
        id
      );

    if (
      index < 0
    ) {
      return null;
    }

    const current =
      conversation[index];

    if (
      current.role !==
      "user"
    ) {
      return null;
    }

    const content =
      cleanText(
        newContent
      );

    if (
      !content &&
      !(
        Array.isArray(
          current.attachments
        ) &&
        current.attachments.length
      )
    ) {
      return null;
    }

    const updated =
      updateMessage(
        id,
        {
          content:
            content ||
            CONFIG
              .attachmentOnlyPrompt
        }
      );

    if (!updated) {
      return null;
    }

    truncateAfterIndex(
      index
    );

    emit(
      "neyo:chat-user-edited",
      {
        message:
          cloneValue(
            updated
          ),

        index
      }
    );

    if (
      !regenerateResponse
    ) {
      return {
        message:
          updated,

        result:
          null
      };
    }

    const result =
      await executeRequest({
        prompt:
          updated.content,

        attachments:
          updated.attachments ||
          [],

        mode:
          "edit-regenerate"
      });

    return {
      message:
        updated,

      result
    };
  }

  /* =====================================================
     INVALIDATE REQUEST
     ===================================================== */

  function invalidateRequest(
    reason =
      "state-change"
  ) {
    const controller =
      activeController;

    /*
     * Invalidate first so any late response is stale.
     */

    requestSerial +=
      1;

    activeRequestId =
      null;

    activeRequestStartedAt =
      null;

    generating =
      false;

    activeController =
      null;

    if (
      controller
    ) {
      try {
        controller.abort(
          reason
        );
      } catch {
        try {
          controller.abort();
        } catch {}
      }
    }

    return true;
  }

  /* =====================================================
     NEW CONVERSATION
     ===================================================== */

  function newConversation({
    source =
      "chat"
  } = {}) {
    invalidateRequest(
      "new-conversation"
    );

    conversation =
      [];

    currentConversationId =
      null;

    lastResult =
      null;

    emit(
      "neyo:messages-clear",
      {
        source
      }
    );

    emit(
      "neyo:chat-new",
      {
        conversation:
          [],

        conversationId:
          null,

        source
      }
    );

    emitState();

    return true;
  }

  /* =====================================================
     LOAD CONVERSATION
     ===================================================== */

  function loadConversation({
    conversationId,
    messages = [],
    source =
      "history"
  } = {}) {
    invalidateRequest(
      "conversation-load"
    );

    currentConversationId =
      cleanIdentifier(
        conversationId,
        256
      ) ||
      null;

    conversation =
      Array.isArray(
        messages
      )
        ? messages
            .map(
              normalizeMessage
            )
            .filter(Boolean)
            .slice(
              -CONFIG
                .maxHistoryMessages
            )
        : [];

    emit(
      "neyo:messages-clear",
      {
        source:
          "history-load"
      }
    );

    for (
      const message
      of conversation
    ) {
      emit(
        "neyo:chat-message-added",
        {
          message:
            cloneValue(
              message
            ),

          conversation:
            getConversation(),

          historyLoad:
            true
        }
      );
    }

    emit(
      "neyo:chat-state-loaded",
      {
        conversationId:
          currentConversationId,

        messages:
          getConversation(),

        source
      }
    );

    emitState();

    return true;
  }

  /* =====================================================
     SET CONVERSATION ID
     ===================================================== */

  function setConversationId(
    id
  ) {
    const next =
      cleanIdentifier(
        id,
        256
      ) ||
      null;

    if (
      preferences.privateChat
    ) {
      currentConversationId =
        null;

      return false;
    }

    currentConversationId =
      next;

    emitState();

    return true;
  }

  /* =====================================================
     STATE EVENT
     ===================================================== */

  function getState() {
    return {
      version:
        VERSION,

      active:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      generating,

      conversationId:
        currentConversationId,

      messageCount:
        conversation.length,

      requestId:
        activeRequestId,

      requestSerial,

      activeRequestStartedAt,

      lastCompletedRequestId,

      preferences:
        {
          ...preferences
        }
    };
  }

  function emitState() {
    const snapshot =
      {
        conversationId:
          currentConversationId,

        messages:
          getConversation(),

        generating,

        requestId:
          activeRequestId,

        preferences:
          {
            ...preferences
          }
      };

    emit(
      "neyo:chat-state",
      snapshot
    );

    return snapshot;
  }

  /* =====================================================
     SEND EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-request",
    event => {
      const detail =
        event.detail ||
        {};

      void send({
        text:
          detail.text ||
          "",

        attachments:
          detail.attachments ||
          []
      });
    }
  );

  /* =====================================================
     STOP EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-stop-request",
    () => {
      stop();
    }
  );

  /* =====================================================
     NEW CHAT EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new-request",
    event => {
      newConversation({
        source:
          event.detail
            ?.source ||
          "request"
      });
    }
  );

  /* =====================================================
     HISTORY LOAD
     ===================================================== */

  function handleConversationLoad(
    event
  ) {
    const detail =
      event.detail ||
      {};

    loadConversation({
      conversationId:
        detail.conversationId ||
        detail.id ||
        null,

      messages:
        detail.messages ||
        detail.conversation ||
        [],

      source:
        detail.source ||
        "history"
    });
  }

  window.addEventListener(
    "neyo:conversation-loaded",
    handleConversationLoad
  );

  window.addEventListener(
    "neyo:history-conversation-loaded",
    handleConversationLoad
  );

  /* =====================================================
     PREFERENCES EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-preferences-set",
    event => {
      setPreferences(
        event.detail ||
        {}
      );
    }
  );

  /* =====================================================
     REGENERATE EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-regenerate-request",
    event => {
      void regenerate({
        messageId:
          event.detail
            ?.messageId ||
          event.detail
            ?.id ||
          null
      });
    }
  );

  /* =====================================================
     EDIT EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-edit-request",
    event => {
      const detail =
        event.detail ||
        {};

      void editUserMessage(
        detail.messageId ||
        detail.id,

        detail.content ??
        detail.text ??
        "",

        {
          regenerateResponse:
            detail
              .regenerateResponse !==
            false
        }
      );
    }
  );

  /* =====================================================
     REMOVE EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-message-remove-request",
    event => {
      removeMessage(
        event.detail
          ?.messageId ||
        event.detail
          ?.id
      );
    }
  );

  /* =====================================================
     STATE REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state-sync-request",
    emitState
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

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      /* -----------------------------------------------
         Transport
         ----------------------------------------------- */

      send,

      stop,

      regenerate,

      editUserMessage,

      /* -----------------------------------------------
         Conversation
         ----------------------------------------------- */

      newConversation,

      loadConversation,

      getConversation,

      getConversationId() {
        return currentConversationId;
      },

      setConversationId,

      /* -----------------------------------------------
         Messages
         ----------------------------------------------- */

      addMessage,

      updateMessage,

      removeMessage,

      getMessage,

      getMessageIndex,

      truncateAfter,

      /* -----------------------------------------------
         Preferences
         ----------------------------------------------- */

      setPreferences,

      getPreferences() {
        return {
          ...preferences
        };
      },

      /* -----------------------------------------------
         Request state
         ----------------------------------------------- */

      isGenerating() {
        return generating;
      },

      getActiveRequestId() {
        return activeRequestId;
      },

      getLastResult() {
        return cloneValue(
          lastResult
        );
      },

      /* -----------------------------------------------
         State
         ----------------------------------------------- */

      emitState,

      getState
    });

  Object.defineProperty(
    window,
    "NeyoChat",
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
     READY
     ===================================================== */

  emit(
    "neyo:chat-ready",
    {
      version:
        VERSION,

      active:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false
    }
  );

  emitState();
})();
