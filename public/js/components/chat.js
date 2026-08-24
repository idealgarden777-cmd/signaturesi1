/*
=========================================================
NEO — CHAT CORE
Production v3 — Baseline Safe

Baseline:
- Old working neo.js chat behavior
- Old modular chat.js API contract
- Current /api/chat JSON backend

Owns:
- Canonical conversation state
- Current conversation ID
- /api/chat requests
- Send / generation lifecycle
- Abort / Stop
- Stale request protection
- Chat message state
- Exact-turn regenerate
- User-message edit flow
- History conversation hydration
- Preferences sent to backend
- Attachment metadata in messages
- JSON response compatibility
- Optional future streaming transport support
- 429 rollback behavior

Does NOT own:
- Send button
- Enter / Shift+Enter
- Composer clearing
- File upload
- Attachment picker
- Message DOM
- Markdown / math rendering
- History sidebar DOM
- Topbar / model picker UI
=========================================================
*/

(() => {
  "use strict";

  const VERSION = "neo-chat-production-v3";

  if (window.NeyoChat?.__controller === true) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG = Object.freeze({
    endpoint: "/api/chat",

    maxHistoryMessages: 50,
    maxAttachments: 5,
    maxMessageLength: 50_000,

    requestTimeoutMs: 180_000,

    attachmentOnlyPrompt:
      "Please analyze the attached file."
  });

  /* =====================================================
     STATE
     ===================================================== */

  let conversation = [];

  let currentConversationId = null;

  let generating = false;

  let activeController = null;

  let activeRequestId = 0;

  let preferences = {
    intelligence: "standard",
    language: "auto",
    personality: "neyo",
    privateChat: false,
    isDeepResearch: false
  };

  /* =====================================================
     EVENTS
     ===================================================== */

  function emit(name, detail = {}) {
    window.dispatchEvent(
      new CustomEvent(name, {
        detail
      })
    );
  }

  /* =====================================================
     SMALL HELPERS
     ===================================================== */

  function makeId(prefix = "msg") {
    try {
      if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
      }
    } catch {}

    return `${prefix}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  function cleanText(
    value,
    max = CONFIG.maxMessageLength
  ) {
    if (typeof value !== "string") {
      return "";
    }

    return value
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .slice(0, max)
      .trim();
  }

  function cleanId(value) {
    return cleanText(
      String(value ?? ""),
      160
    );
  }

  function clonePlainObject(value) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return null;
    }

    return {
      ...value
    };
  }

  /* =====================================================
     ATTACHMENTS
     ===================================================== */

  function normalizeAttachments(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter(
        file =>
          file &&
          typeof file === "object"
      )
      .slice(0, CONFIG.maxAttachments)
      .map(file => {
        const mimeType =
          cleanText(
            file.mimeType ||
              file.type ||
              file.mime ||
              "application/octet-stream",
            160
          ) || "application/octet-stream";

        const normalized = {
          provider:
            cleanText(
              file.provider || "supabase",
              60
            ) || "supabase",

          bucket:
            cleanText(
              file.bucket || "neo-uploads",
              255
            ) || "neo-uploads",

          path: cleanText(
            file.path || "",
            1500
          ),

          name:
            cleanText(
              file.name ||
                file.fileName ||
                "Attached file",
              255
            ) || "Attached file",

          mimeType,

          type: mimeType,

          category:
            cleanText(
              file.category || "text",
              60
            ) || "text",

          size: Math.max(
            0,
            Number(file.size) || 0
          )
        };

        /*
         * New attachment pipeline metadata.
         *
         * Preserved when available but old backend does not
         * need these fields to function.
         */

        const optionalStringFields = [
          "id",
          "uploadId",
          "processId",
          "documentId",
          "extension",
          "status"
        ];

        for (const key of optionalStringFields) {
          const value = cleanText(
            file[key] || "",
            255
          );

          if (value) {
            normalized[key] = value;
          }
        }

        if (
          file.document &&
          typeof file.document === "object"
        ) {
          normalized.document = {
            ...file.document
          };
        }

        if (Array.isArray(file.chunks)) {
          normalized.chunks =
            file.chunks.map(chunk =>
              chunk &&
              typeof chunk === "object"
                ? { ...chunk }
                : chunk
            );
        }

        if (
          file.stats &&
          typeof file.stats === "object"
        ) {
          normalized.stats = {
            ...file.stats
          };
        }

        /*
         * Never require previewUrl for API validity.
         * It may be temporary / signed / local blob UI data.
         */

        return normalized;
      })
      .filter(file =>
        Boolean(
          file.path ||
            file.documentId ||
            file.uploadId
        )
      );
  }

  function cloneAttachments(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map(file => ({
      ...file,

      document:
        file.document &&
        typeof file.document === "object"
          ? { ...file.document }
          : file.document,

      stats:
        file.stats &&
        typeof file.stats === "object"
          ? { ...file.stats }
          : file.stats,

      chunks: Array.isArray(file.chunks)
        ? file.chunks.map(chunk =>
            chunk &&
            typeof chunk === "object"
              ? { ...chunk }
              : chunk
          )
        : file.chunks
    }));
  }

  /* =====================================================
     SOURCES
     ===================================================== */

  function normalizeSources(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map(source => {
        if (
          !source ||
          typeof source !== "object"
        ) {
          return null;
        }

        return {
          ...source
        };
      })
      .filter(Boolean);
  }

  /* =====================================================
     MESSAGE NORMALIZATION
     ===================================================== */

  function normalizeMessage(message) {
    if (
      !message ||
      typeof message !== "object"
    ) {
      return null;
    }

    if (
      message.role !== "user" &&
      message.role !== "assistant"
    ) {
      return null;
    }

    const normalized = {
      id:
        cleanId(message.id) ||
        makeId(),

      role: message.role,

      content: cleanText(
        message.content || ""
      )
    };

    /*
     * displayContent exists so attachment-only internal
     * prompt never needs to appear in the UI.
     */

    if (
      typeof message.displayContent ===
      "string"
    ) {
      normalized.displayContent =
        cleanText(
          message.displayContent
        );
    }

    const attachments =
      normalizeAttachments(
        message.attachments
      );

    if (attachments.length) {
      normalized.attachments =
        attachments;
    }

    const sources = normalizeSources(
      message.sources
    );

    if (sources.length) {
      normalized.sources = sources;
    }

    if (message.error === true) {
      normalized.error = true;
    }

    if (message.streaming === true) {
      normalized.streaming = true;
    }

    if (message.createdAt) {
      normalized.createdAt =
        message.createdAt;
    }

    return normalized;
  }

  function cloneMessage(message) {
    if (!message) {
      return null;
    }

    return {
      ...message,

      attachments:
        Array.isArray(
          message.attachments
        )
          ? cloneAttachments(
              message.attachments
            )
          : undefined,

      sources: Array.isArray(
        message.sources
      )
        ? message.sources.map(source => ({
            ...source
          }))
        : undefined
    };
  }

  function cloneConversation() {
    return conversation.map(
      cloneMessage
    );
  }

  /* =====================================================
     CONVERSATION BOUND
     ===================================================== */

  function boundConversation() {
    if (
      conversation.length <=
      CONFIG.maxHistoryMessages
    ) {
      return;
    }

    conversation =
      conversation.slice(
        -CONFIG.maxHistoryMessages
      );
  }

  /* =====================================================
     GET MESSAGE
     ===================================================== */

  function getMessage(messageId) {
    const id = cleanId(messageId);

    if (!id) {
      return null;
    }

    const message =
      conversation.find(
        item => item.id === id
      );

    return cloneMessage(message);
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
          makeId(),

        role,

        content,

        displayContent:
          options.displayContent,

        attachments:
          options.attachments,

        sources:
          options.sources,

        error:
          options.error,

        streaming:
          options.streaming,

        createdAt:
          options.createdAt ||
          Date.now()
      });

    if (!message) {
      return null;
    }

    conversation.push(message);

    boundConversation();

    emit(
      "neyo:chat-message-added",
      {
        message:
          cloneMessage(message),

        conversation:
          cloneConversation(),

        historyLoad:
          Boolean(
            options.historyLoad
          )
      }
    );

    return message;
  }

  /* =====================================================
     UPDATE MESSAGE
     ===================================================== */

  function updateMessage(
    messageId,
    changes = {}
  ) {
    const id = cleanId(messageId);

    const index =
      conversation.findIndex(
        message =>
          message.id === id
      );

    if (index < 0) {
      return null;
    }

    const current =
      conversation[index];

    const next = {
      ...current
    };

    if (
      typeof changes.content ===
      "string"
    ) {
      next.content =
        cleanText(
          changes.content
        );
    }

    if (
      typeof changes.displayContent ===
      "string"
    ) {
      next.displayContent =
        cleanText(
          changes.displayContent
        );
    }

    if (
      Array.isArray(
        changes.attachments
      )
    ) {
      const attachments =
        normalizeAttachments(
          changes.attachments
        );

      if (attachments.length) {
        next.attachments =
          attachments;
      } else {
        delete next.attachments;
      }
    }

    if (
      Array.isArray(
        changes.sources
      )
    ) {
      const sources =
        normalizeSources(
          changes.sources
        );

      if (sources.length) {
        next.sources = sources;
      } else {
        delete next.sources;
      }
    }

    if (
      typeof changes.error ===
      "boolean"
    ) {
      if (changes.error) {
        next.error = true;
      } else {
        delete next.error;
      }
    }

    if (
      typeof changes.streaming ===
      "boolean"
    ) {
      if (changes.streaming) {
        next.streaming = true;
      } else {
        delete next.streaming;
      }
    }

    conversation[index] = next;

    const publicMessage =
      cloneMessage(next);

    emit(
      "neyo:chat-message-updated",
      {
        id: next.id,
        message: publicMessage,
        conversation:
          cloneConversation()
      }
    );

    /*
     * Compatibility bridge for older message renderer.
     */

    emit(
      "neyo:message-update-request",
      {
        id: next.id,

        content:
          next.displayContent ??
          next.content,

        options: {
          message:
            publicMessage
        }
      }
    );

    return publicMessage;
  }

  /* =====================================================
     REMOVE MESSAGE
     ===================================================== */

  function removeMessage(
    messageId,
    {
      silent = false
    } = {}
  ) {
    const id = cleanId(messageId);

    const index =
      conversation.findIndex(
        message =>
          message.id === id
      );

    if (index < 0) {
      return false;
    }

    const [removed] =
      conversation.splice(
        index,
        1
      );

    if (!silent) {
      emit(
        "neyo:chat-message-removed",
        {
          id: removed.id,

          message:
            cloneMessage(removed),

          conversation:
            cloneConversation()
        }
      );
    }

    return true;
  }

  /* =====================================================
     REMOVE LAST USER TURN

     Old working NEO removed the just-submitted user bubble
     when the backend returned 429. Preserve that behavior.
     ===================================================== */

  function removeLastUserMessage() {
    for (
      let index =
        conversation.length - 1;
      index >= 0;
      index -= 1
    ) {
      if (
        conversation[index]
          ?.role !== "user"
      ) {
        continue;
      }

      const message =
        conversation[index];

      conversation.splice(
        index,
        1
      );

      emit(
        "neyo:chat-message-removed",
        {
          id: message.id,

          message:
            cloneMessage(message),

          conversation:
            cloneConversation(),

          reason:
            "request-rollback"
        }
      );

      return cloneMessage(message);
    }

    return null;
  }

  /* =====================================================
     TRUNCATE AFTER MESSAGE INDEX
     ===================================================== */

  function truncateAfterIndex(index) {
    if (
      index < -1 ||
      index >= conversation.length
    ) {
      return [];
    }

    const removed =
      conversation.splice(
        index + 1
      );

    for (const message of removed) {
      emit(
        "neyo:chat-message-removed",
        {
          id: message.id,

          message:
            cloneMessage(message),

          conversation:
            cloneConversation(),

          reason:
            "truncate"
        }
      );
    }

    return removed.map(
      cloneMessage
    );
  }

  /* =====================================================
     MODEL
     ===================================================== */

  function getSelectedModel() {
    try {
      const selected =
        window.NeyoModelMenu
          ?.getSelected?.();

      /*
       * Preserve old contract:
       * getSelected() normally returned a string.
       */

      if (
        typeof selected ===
          "string" &&
        selected.trim()
      ) {
        return selected.trim();
      }

      /*
       * Safe compatibility if model-menu later returns
       * an object.
       */

      if (
        selected &&
        typeof selected ===
          "object"
      ) {
        return (
          cleanText(
            selected.id ||
              selected.value ||
              selected.model ||
              "",
            100
          ) || "l1.0"
        );
      }
    } catch {}

    return "l1.0";
  }

  /* =====================================================
     TITLE
     ===================================================== */

  function makeConversationTitle(
    text,
    attachments = []
  ) {
    const visibleText =
      cleanText(text, 80);

    if (
      visibleText &&
      visibleText !==
        CONFIG.attachmentOnlyPrompt
    ) {
      return visibleText
        .replace(/\s+/g, " ")
        .slice(0, 80);
    }

    const files =
      normalizeAttachments(
        attachments
      );

    if (files[0]?.name) {
      return files[0].name.slice(
        0,
        80
      );
    }

    return "New conversation";
  }

  /* =====================================================
     API MESSAGE

     Local UI-only error messages must NEVER be sent back
     to the model as assistant context.
     ===================================================== */

  function toApiMessage(message) {
    const result = {
      role: message.role,

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

  function getApiConversation() {
    return conversation
      .filter(message => {
        if (!message) {
          return false;
        }

        /*
         * Don't send local error UI to the model.
         */

        if (message.error === true) {
          return false;
        }

        /*
         * Don't send an unfinished assistant shell.
         */

        if (
          message.role ===
            "assistant" &&
          message.streaming ===
            true &&
          !cleanText(
            message.content
          )
        ) {
          return false;
        }

        return true;
      })
      .slice(
        -CONFIG.maxHistoryMessages
      )
      .map(toApiMessage);
  }

  /* =====================================================
     PAYLOAD

     Matches current api/chat.js contract.
     ===================================================== */

  function buildPayload({
    text,
    attachments = []
  } = {}) {
    const privateChat =
      Boolean(
        preferences.privateChat
      );

    const normalizedAttachments =
      normalizeAttachments(
        attachments
      );

    return {
      messages:
        getApiConversation(),

      /*
       * Current backend supports top-level attachments
       * and falls back to lastMsg.attachments.
       */

      attachments:
        normalizedAttachments,

      conversationId:
        privateChat
          ? null
          : currentConversationId,

      model:
        getSelectedModel(),

      intelligence:
        preferences.intelligence,

      privateChat,

      language:
        preferences.language,

      personality:
        preferences.personality,

      isDeepResearch:
        Boolean(
          preferences.isDeepResearch
        ),

      title:
        makeConversationTitle(
          text,
          normalizedAttachments
        )
    };
  }

  /* =====================================================
     JSON RESPONSE
     ===================================================== */

  async function readJsonResponse(
    response
  ) {
    const raw =
      await response.text();

    let data = {};

    if (raw) {
      try {
        data =
          JSON.parse(raw);
      } catch {
        data = {};
      }
    }

    if (!response.ok) {
      const message =
        cleanText(
          data?.error ||
            data?.message ||
            raw ||
            `Request failed (${response.status})`,
          1500
        ) ||
        `Request failed (${response.status})`;

      const error =
        new Error(message);

      error.status =
        response.status;

      error.data = data;

      throw error;
    }

    return data;
  }

  function extractReply(data) {
    const value =
      data?.reply ??
      data?.choices?.[0]
        ?.message?.content ??
      data?.message?.content ??
      data?.content ??
      data?.text;

    return typeof value ===
      "string"
      ? value.trim()
      : "";
  }

  function extractConversationId(
    data
  ) {
    const value =
      data?.conversationId ??
      data?.conversation_id ??
      data?.conversation?.id;

    return typeof value ===
      "string"
      ? value.trim()
      : "";
  }

  function extractSources(data) {
    return normalizeSources(
      data?.sources ??
        data?.citations ??
        data?.groundingSources ??
        []
    );
  }

  function extractAssistantMessageId(
    data
  ) {
    return cleanId(
      data?.messageId ||
        data?.assistantMessageId ||
        data?.message_id ||
        ""
    );
  }

  /* =====================================================
     ERROR TEXT
     ===================================================== */

  function getUserFacingError(error) {
    const status =
      Number(error?.status) || 0;

    if (status === 401) {
      return (
        "Your session has expired. Please sign in again."
      );
    }

    if (status === 413) {
      return (
        "This request is too large."
      );
    }

    if (status === 429) {
      return (
        "You've reached the current usage limit."
      );
    }

    if (status >= 500) {
      return (
        "NEO is temporarily unavailable. Please try again."
      );
    }

    return (
      cleanText(
        error?.message || "",
        500
      ) ||
      "Something went wrong. Please try again."
    );
  }

  /* =====================================================
     RESPONSE TRANSPORT

     Current production backend returns JSON.

     SSE / NDJSON support is intentionally passive:
     nothing changes unless backend actually sends one of
     those content-types.
     ===================================================== */

  function detectTransport(response) {
    const contentType =
      String(
        response.headers.get(
          "content-type"
        ) || ""
      ).toLowerCase();

    if (
      contentType.includes(
        "text/event-stream"
      )
    ) {
      return "sse";
    }

    if (
      contentType.includes(
        "application/x-ndjson"
      ) ||
      contentType.includes(
        "application/ndjson"
      )
    ) {
      return "ndjson";
    }

    return "json";
  }

  /* =====================================================
     STREAM STATE
     ===================================================== */

  function createStreamSession({
    requestId,
    reason,
    userMessageId
  }) {
    let assistantId = null;

    let content = "";

    let sources = [];

    let frameId = null;

    let renderedContent = "";

    let started = false;

    function ensureAssistant(
      preferredId = ""
    ) {
      if (assistantId) {
        return assistantId;
      }

      const message =
        addMessage(
          "assistant",
          "",
          {
            id:
              preferredId ||
              makeId(),

            streaming: true
          }
        );

      assistantId =
        message?.id || null;

      return assistantId;
    }

    function flush() {
      if (frameId !== null) {
        cancelAnimationFrame(
          frameId
        );

        frameId = null;
      }

      if (
        !assistantId ||
        renderedContent ===
          content
      ) {
        return;
      }

      renderedContent = content;

      updateMessage(
        assistantId,
        {
          content,
          streaming: true
        }
      );
    }

    function scheduleFlush() {
      if (frameId !== null) {
        return;
      }

      frameId =
        requestAnimationFrame(
          () => {
            frameId = null;

            flush();
          }
        );
    }

    function start(metadata = {}) {
      if (started) {
        return;
      }

      started = true;

      emit(
        "neyo:chat-stream-start",
        {
          requestId,
          reason,
          userMessageId,
          conversationId:
            currentConversationId,
          ...metadata
        }
      );
    }

    function append(
      delta,
      metadata = {}
    ) {
      const value =
        typeof delta === "string"
          ? delta
          : "";

      if (!value) {
        return;
      }

      start();

      ensureAssistant(
        extractAssistantMessageId(
          metadata
        )
      );

      content += value;

      scheduleFlush();

      emit(
        "neyo:chat-stream-delta",
        {
          requestId,

          messageId:
            assistantId,

          delta: value,

          content,

          reason,

          userMessageId
        }
      );
    }

    function setSources(value) {
      sources =
        normalizeSources(value);
    }

    function complete() {
      flush();

      if (assistantId) {
        updateMessage(
          assistantId,
          {
            content,
            sources,
            streaming: false,
            error: false
          }
        );
      }

      emit(
        "neyo:chat-stream-end",
        {
          requestId,

          messageId:
            assistantId,

          content,

          sources,

          reason,

          userMessageId
        }
      );

      return {
        message:
          assistantId
            ? getMessage(
                assistantId
              )
            : null,

        content,
        sources,
        started
      };
    }

    function finalizeStopped() {
      flush();

      if (assistantId) {
        updateMessage(
          assistantId,
          {
            content,
            sources,
            streaming: false
          }
        );
      }

      return {
        messageId:
          assistantId,
        content,
        sources
      };
    }

    function fail(text) {
      flush();

      if (assistantId) {
        updateMessage(
          assistantId,
          {
            content: text,
            streaming: false,
            error: true
          }
        );

        return getMessage(
          assistantId
        );
      }

      const created =
        addMessage(
          "assistant",
          text,
          {
            error: true
          }
        );

      return cloneMessage(created);
    }

    function snapshot() {
      return {
        messageId:
          assistantId,

        content,

        sources,

        started
      };
    }

    return {
      start,
      append,
      setSources,
      complete,
      finalizeStopped,
      fail,
      snapshot
    };
  }

  /* =====================================================
     STREAM OBJECT HELPERS
     ===================================================== */

  function applyStreamMetadata(
    value,
    session
  ) {
    if (
      !value ||
      typeof value !== "object"
    ) {
      return;
    }

    const conversationId =
      extractConversationId(
        value
      );

    if (
      conversationId &&
      !preferences.privateChat
    ) {
      currentConversationId =
        conversationId;
    }

    const nextSources =
      extractSources(value);

    if (nextSources.length) {
      session.setSources(
        nextSources
      );
    }
  }

  function getStreamDelta(value) {
    if (
      typeof value === "string"
    ) {
      return value;
    }

    if (
      !value ||
      typeof value !== "object"
    ) {
      return "";
    }

    const direct =
      value.delta ??
      value.token ??
      value?.message?.delta ??
      value?.choices?.[0]
        ?.delta?.content;

    if (
      typeof direct === "string"
    ) {
      return direct;
    }

    const type =
      String(
        value.type ||
          value.event ||
          ""
      ).toLowerCase();

    if (
      [
        "delta",
        "token",
        "text_delta",
        "content_delta",
        "message_delta"
      ].includes(type) &&
      typeof value.content ===
        "string"
    ) {
      return value.content;
    }

    return "";
  }

  function consumeStreamObject(
    value,
    session
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return;
    }

    applyStreamMetadata(
      value,
      session
    );

    const type =
      String(
        value?.type ||
          value?.event ||
          ""
      ).toLowerCase();

    if (
      [
        "done",
        "complete",
        "completed",
        "end",
        "message_end"
      ].includes(type)
    ) {
      return;
    }

    const delta =
      getStreamDelta(value);

    if (delta) {
      session.append(
        delta,
        value
      );
    }
  }

  /* =====================================================
     SSE
     ===================================================== */

  async function consumeSSE(
    response,
    session
  ) {
    if (!response.body) {
      throw new Error(
        "Streaming response body is unavailable."
      );
    }

    session.start({
      transport: "sse"
    });

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    let buffer = "";

    let dataLines = [];

    function dispatchEvent() {
      if (!dataLines.length) {
        return;
      }

      const payload =
        dataLines.join("\n");

      dataLines = [];

      if (
        payload.trim() ===
        "[DONE]"
      ) {
        return;
      }

      try {
        consumeStreamObject(
          JSON.parse(payload),
          session
        );
      } catch {
        session.append(payload);
      }
    }

    while (true) {
      const {
        done,
        value
      } = await reader.read();

      if (done) {
        break;
      }

      buffer +=
        decoder.decode(
          value,
          {
            stream: true
          }
        );

      const lines =
        buffer.split(/\r?\n/);

      buffer =
        lines.pop() || "";

      for (const line of lines) {
        if (line === "") {
          dispatchEvent();
          continue;
        }

        if (
          line.startsWith(":")
        ) {
          continue;
        }

        if (
          line.startsWith("data:")
        ) {
          dataLines.push(
            line
              .slice(5)
              .trimStart()
          );
        }
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      if (
        buffer.startsWith(
          "data:"
        )
      ) {
        dataLines.push(
          buffer
            .slice(5)
            .trimStart()
        );
      } else {
        dataLines.push(buffer);
      }
    }

    dispatchEvent();
  }

  /* =====================================================
     NDJSON
     ===================================================== */

  async function consumeNDJSON(
    response,
    session
  ) {
    if (!response.body) {
      throw new Error(
        "Streaming response body is unavailable."
      );
    }

    session.start({
      transport: "ndjson"
    });

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    let buffer = "";

    while (true) {
      const {
        done,
        value
      } = await reader.read();

      if (done) {
        break;
      }

      buffer +=
        decoder.decode(
          value,
          {
            stream: true
          }
        );

      const lines =
        buffer.split(/\r?\n/);

      buffer =
        lines.pop() || "";

      for (const line of lines) {
        const trimmed =
          line.trim();

        if (
          !trimmed ||
          trimmed === "[DONE]"
        ) {
          continue;
        }

        try {
          consumeStreamObject(
            JSON.parse(trimmed),
            session
          );
        } catch {
          session.append(trimmed);
        }
      }
    }

    buffer += decoder.decode();

    const tail =
      buffer.trim();

    if (
      tail &&
      tail !== "[DONE]"
    ) {
      try {
        consumeStreamObject(
          JSON.parse(tail),
          session
        );
      } catch {
        session.append(tail);
      }
    }
  }

  /* =====================================================
     STOP
     ===================================================== */

  function stop(
    reason = "user"
  ) {
    const controller =
      activeController;

    if (
      !controller ||
      controller.signal.aborted
    ) {
      return false;
    }

    try {
      /*
       * Keep reason locally/event-side.
       * Some browsers surface custom abort reasons directly
       * instead of an AbortError DOMException.
       */

      controller.abort(reason);
    } catch {
      try {
        controller.abort();
      } catch {
        return false;
      }
    }

    return true;
  }

  /* =====================================================
     GENERATION CORE
     ===================================================== */

  async function generate({
    text,
    attachments = [],
    reason = "send",
    userMessageId = null,
    rollbackUserOnLimit = false
  } = {}) {
    if (generating) {
      emit(
        "neyo:chat-busy",
        {
          reason
        }
      );

      return null;
    }

    const requestId =
      ++activeRequestId;

    generating = true;

    const controller =
      new AbortController();

    activeController =
      controller;

    const normalizedAttachments =
      normalizeAttachments(
        attachments
      );

    const streamSession =
      createStreamSession({
        requestId,
        reason,
        userMessageId
      });

    /*
     * Synchronous event.
     * send-state.js uses this as acceptance confirmation
     * before it clears composer / sent attachment chips.
     */

    emit(
      "neyo:chat-send-start",
      {
        requestId,

        text:
          text ===
          CONFIG.attachmentOnlyPrompt
            ? ""
            : cleanText(text),

        attachments:
          normalizedAttachments,

        conversationId:
          currentConversationId,

        userMessageId,

        reason
      }
    );

    emitState();

    let timeoutId = null;

    try {
      timeoutId =
        window.setTimeout(
          () => {
            if (
              controller.signal.aborted
            ) {
              return;
            }

            try {
              controller.abort(
                "timeout"
              );
            } catch {
              controller.abort();
            }
          },
          CONFIG.requestTimeoutMs
        );

      const payload =
        buildPayload({
          text,
          attachments:
            normalizedAttachments
        });

      const response =
        await fetch(
          CONFIG.endpoint,
          {
            method: "POST",

            credentials:
              "include",

            cache: "no-store",

            headers: {
              "Content-Type":
                "application/json",

              /*
               * JSON remains first-class because current
               * production api/chat.js returns JSON.
               */

              Accept:
                "application/json, text/event-stream, application/x-ndjson"
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
         CREDIT / USAGE LIMIT

         Preserve old working behavior:
         rejected just-submitted user turn is removed.
         ================================================= */

      if (response.status === 429) {
        let data = {};

        try {
          data =
            await response.json();
        } catch {}

        if (rollbackUserOnLimit) {
          removeLastUserMessage();
        }

        emit(
          "neyo:chat-limit-reached",
          {
            requestId,

            data,

            userMessageId,

            conversationId:
              currentConversationId
          }
        );

        return null;
      }

      /*
       * For other non-OK responses, parse normal error.
       */

      if (!response.ok) {
        await readJsonResponse(
          response
        );

        return null;
      }

      const transport =
        detectTransport(
          response
        );

      let reply = "";

      let sources = [];

      let assistantMessage =
        null;

      let responseData = null;

      /* =================================================
         CURRENT PRODUCTION JSON
         ================================================= */

      if (transport === "json") {
        const data =
          await readJsonResponse(
            response
          );

        responseData = data;

        /*
         * New chat/history switch may have invalidated this
         * request while network response was in flight.
         */

        if (
          requestId !==
          activeRequestId
        ) {
          return null;
        }

        reply =
          extractReply(data);

        if (!reply) {
          throw new Error(
            "The AI response was empty."
          );
        }

        const serverConversationId =
          extractConversationId(
            data
          );

        if (
          serverConversationId &&
          !preferences.privateChat
        ) {
          currentConversationId =
            serverConversationId;
        }

        sources =
          extractSources(data);

        const created =
          addMessage(
            "assistant",
            reply,
            {
              id:
                extractAssistantMessageId(
                  data
                ) ||
                undefined,

              sources
            }
          );

        assistantMessage =
          cloneMessage(created);
      }

      /* =================================================
         OPTIONAL FUTURE SSE
         ================================================= */

      else if (transport === "sse") {
        await consumeSSE(
          response,
          streamSession
        );

        if (
          requestId !==
          activeRequestId
        ) {
          return null;
        }

        const completed =
          streamSession.complete();

        reply =
          completed.content.trim();

        sources =
          completed.sources;

        assistantMessage =
          completed.message;

        if (!reply) {
          throw new Error(
            "The AI response was empty."
          );
        }
      }

      /* =================================================
         OPTIONAL FUTURE NDJSON
         ================================================= */

      else if (
        transport === "ndjson"
      ) {
        await consumeNDJSON(
          response,
          streamSession
        );

        if (
          requestId !==
          activeRequestId
        ) {
          return null;
        }

        const completed =
          streamSession.complete();

        reply =
          completed.content.trim();

        sources =
          completed.sources;

        assistantMessage =
          completed.message;

        if (!reply) {
          throw new Error(
            "The AI response was empty."
          );
        }
      }

      if (
        requestId !==
        activeRequestId
      ) {
        return null;
      }

      const result = {
        requestId,

        reply,

        sources,

        message:
          assistantMessage,

        userMessageId,

        conversationId:
          currentConversationId,

        privateChat:
          Boolean(
            preferences.privateChat
          ),

        usedUrlContext:
          Boolean(
            responseData
              ?.usedUrlContext
          ),

        creditType:
          responseData
            ?.creditType ||
          null,

        reason,

        transport,

        streamed:
          transport !== "json"
      };

      emit(
        "neyo:chat-response",
        result
      );

      /*
       * Preserve old behavior:
       * normal chats request history refresh after success.
       * Private chats do not.
       */

      if (
        !preferences.privateChat
      ) {
        emit(
          "neyo:history-load-request",
          {
            conversationId:
              currentConversationId,

            reason:
              "chat-response"
          }
        );
      }

      return result;
    } catch (error) {
      /*
       * Critical:
       * signal.aborted is authoritative.
       *
       * This works even when browser returns a custom abort
       * reason instead of error.name === "AbortError".
       */

      if (
        controller.signal.aborted ||
        error?.name ===
          "AbortError"
      ) {
        const partial =
          streamSession
            .finalizeStopped();

        emit(
          "neyo:chat-aborted",
          {
            requestId,

            reason:
              controller.signal
                .reason ||
              "user",

            conversationId:
              currentConversationId,

            userMessageId,

            messageId:
              partial.messageId,

            partial:
              partial.content
          }
        );

        return null;
      }

      console.error(
        "[NEO Chat] Request failed:",
        error
      );

      /*
       * For normal JSON failure there is no assistant
       * message yet.
       *
       * Store local error message only for UI state.
       * getApiConversation() filters error messages so model
       * never receives them as conversation context.
       */

      const errorText =
        getUserFacingError(
          error
        );

      const errorMessage =
        streamSession.fail(
          errorText
        );

      emit(
        "neyo:chat-error",
        {
          requestId,

          error,

          message:
            errorMessage,

          userMessageId,

          conversationId:
            currentConversationId,

          reason
        }
      );

      return null;
    } finally {
      if (timeoutId !== null) {
        clearTimeout(
          timeoutId
        );
      }

      /*
       * A newer request/new-chat/history load may already
       * have replaced this lifecycle.
       */

      if (
        requestId ===
        activeRequestId
      ) {
        generating = false;

        activeController = null;

        emit(
          "neyo:chat-send-end",
          {
            requestId,

            conversationId:
              currentConversationId,

            reason
          }
        );

        emitState();
      }
    }
  }

  /* =====================================================
     SEND
     ===================================================== */

  async function send({
    text = "",
    attachments = []
  } = {}) {
    if (generating) {
      emit(
        "neyo:chat-busy",
        {
          reason: "send"
        }
      );

      return null;
    }

    const visibleText =
      cleanText(text);

    const normalizedAttachments =
      normalizeAttachments(
        attachments
      );

    if (
      !visibleText &&
      normalizedAttachments.length ===
        0
    ) {
      return null;
    }

    const apiContent =
      visibleText ||
      CONFIG.attachmentOnlyPrompt;

    /*
     * Old NEO showed blank text + attachment cards for
     * attachment-only messages while sending an internal
     * textual prompt to the model.
     */

    const userMessage =
      addMessage(
        "user",
        apiContent,
        {
          displayContent:
            visibleText,

          attachments:
            normalizedAttachments
        }
      );

    if (!userMessage) {
      return null;
    }

    return generate({
      text:
        apiContent,

      attachments:
        normalizedAttachments,

      reason:
        "send",

      userMessageId:
        userMessage.id,

      rollbackUserOnLimit:
        true
    });
  }

  /* =====================================================
     REGENERATE

     Better than old neo.js:
     clicked assistant turn determines exact preceding user
     turn instead of blindly using latest user message.
     ===================================================== */

  async function regenerate({
    messageId
  } = {}) {
    if (generating) {
      return null;
    }

    const assistantId =
      cleanId(messageId);

    let assistantIndex = -1;

    if (assistantId) {
      assistantIndex =
        conversation.findIndex(
          message =>
            message.id ===
              assistantId &&
            message.role ===
              "assistant"
        );
    }

    /*
     * Compatibility:
     * if caller omitted messageId, regenerate latest
     * assistant response.
     */

    if (assistantIndex < 0) {
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
          assistantIndex = index;
          break;
        }
      }
    }

    if (assistantIndex < 0) {
      return null;
    }

    let userIndex = -1;

    for (
      let index =
        assistantIndex - 1;
      index >= 0;
      index -= 1
    ) {
      if (
        conversation[index]
          ?.role === "user"
      ) {
        userIndex = index;
        break;
      }
    }

    if (userIndex < 0) {
      return null;
    }

    const userMessage =
      cloneMessage(
        conversation[userIndex]
      );

    /*
     * Remove target assistant and every later turn.
     * User turn remains exactly where it was.
     */

    truncateAfterIndex(
      userIndex
    );

    emit(
      "neyo:chat-regenerate-start",
      {
        messageId:
          assistantId || null,

        userMessageId:
          userMessage.id
      }
    );

    const result =
      await generate({
        text:
          userMessage.content,

        attachments:
          userMessage.attachments ||
          [],

        reason:
          "regenerate",

        userMessageId:
          userMessage.id,

        rollbackUserOnLimit:
          false
      });

    emit(
      "neyo:chat-regenerate-end",
      {
        messageId:
          assistantId || null,

        userMessageId:
          userMessage.id,

        result
      }
    );

    return result;
  }

  /* =====================================================
     EDIT USER MESSAGE

     Attachment metadata is preserved unless caller
     explicitly supplies a replacement list.
     ===================================================== */

  async function editUserMessage(
    messageId,
    text,
    {
      attachments,
      regenerateResponse = true
    } = {}
  ) {
    if (generating) {
      return null;
    }

    const id =
      cleanId(messageId);

    const index =
      conversation.findIndex(
        message =>
          message.id === id &&
          message.role === "user"
      );

    if (index < 0) {
      return null;
    }

    const existing =
      conversation[index];

    const nextAttachments =
      Array.isArray(attachments)
        ? normalizeAttachments(
            attachments
          )
        : normalizeAttachments(
            existing.attachments ||
              []
          );

    const visibleText =
      cleanText(text);

    if (
      !visibleText &&
      nextAttachments.length === 0
    ) {
      return null;
    }

    const apiContent =
      visibleText ||
      CONFIG.attachmentOnlyPrompt;

    const updated =
      updateMessage(
        id,
        {
          content:
            apiContent,

          displayContent:
            visibleText,

          attachments:
            nextAttachments,

          error: false
        }
      );

    if (!updated) {
      return null;
    }

    /*
     * Old ChatGPT-style edit semantics:
     * everything after edited user turn is replaced.
     */

    truncateAfterIndex(index);

    emit(
      "neyo:chat-edit-committed",
      {
        message:
          getMessage(id),

        regenerateResponse
      }
    );

    if (!regenerateResponse) {
      return {
        message:
          getMessage(id),

        conversation:
          cloneConversation()
      };
    }

    return generate({
      text:
        apiContent,

      attachments:
        nextAttachments,

      reason:
        "edit",

      userMessageId: id,

      rollbackUserOnLimit:
        false
    });
  }

  /* =====================================================
     NEW CONVERSATION

     Draft / attachment chips / composer / hero cleanup are
     intentionally NOT owned here.
     new-chat.js coordinates those UI owners.
     ===================================================== */

  function newConversation() {
    /*
     * Invalidate first so aborted old request can never
     * mutate fresh chat state.
     */

    activeRequestId += 1;

    stop("new-chat");

    activeController = null;

    generating = false;

    conversation = [];

    currentConversationId = null;

    emit(
      "neyo:messages-clear",
      {
        reason: "new-chat"
      }
    );

    emit(
      "neyo:chat-new",
      {
        conversation: []
      }
    );

    emit(
      "neyo:chat-send-end",
      {
        requestId:
          activeRequestId,

        conversationId: null,

        reason: "new-chat"
      }
    );

    emitState();

    return true;
  }

  /* =====================================================
     LOAD CONVERSATION

     Stops current generation and invalidates old network
     response before replacing state.
     ===================================================== */

  function loadConversation({
    conversationId,
    messages = []
  } = {}) {
    activeRequestId += 1;

    stop("history-load");

    activeController = null;

    generating = false;

    currentConversationId =
      cleanId(conversationId) ||
      null;

    conversation =
      Array.isArray(messages)
        ? messages
            .map(
              normalizeMessage
            )
            .filter(Boolean)
            .slice(
              -CONFIG.maxHistoryMessages
            )
        : [];

    emit(
      "neyo:messages-clear",
      {
        reason:
          "history-load"
      }
    );

    /*
     * Re-emit in canonical order so DOM-only messages.js
     * can rebuild without owning conversation state.
     */

    for (const message of conversation) {
      emit(
        "neyo:chat-message-added",
        {
          message:
            cloneMessage(message),

          conversation:
            cloneConversation(),

          historyLoad: true
        }
      );
    }

    emit(
      "neyo:chat-state-loaded",
      {
        conversationId:
          currentConversationId,

        messages:
          cloneConversation()
      }
    );

    emit(
      "neyo:chat-send-end",
      {
        requestId:
          activeRequestId,

        conversationId:
          currentConversationId,

        reason:
          "history-load"
      }
    );

    emitState();

    return true;
  }

  /* =====================================================
     PREFERENCES
     ===================================================== */

  function setPreferences(values) {
    if (
      !values ||
      typeof values !== "object"
    ) {
      return false;
    }

    const next = {
      ...preferences
    };

    if (
      typeof values.intelligence ===
        "string" &&
      values.intelligence
    ) {
      next.intelligence =
        values.intelligence;
    }

    if (
      typeof values.language ===
        "string" &&
      values.language
    ) {
      next.language =
        values.language;
    }

    /*
     * Support both old defaultPersonality naming and new
     * canonical personality naming.
     */

    if (
      typeof values.personality ===
        "string" &&
      values.personality
    ) {
      next.personality =
        values.personality;
    }

    if (
      typeof values.defaultPersonality ===
        "string" &&
      values.defaultPersonality
    ) {
      next.personality =
        values.defaultPersonality;
    }

    if (
      typeof values.privateChat ===
        "boolean"
    ) {
      next.privateChat =
        values.privateChat;
    }

    if (
      typeof values.isDeepResearch ===
        "boolean"
    ) {
      next.isDeepResearch =
        values.isDeepResearch;
    }

    preferences = next;

    emit(
      "neyo:chat-preferences-change",
      {
        preferences: {
          ...preferences
        }
      }
    );

    emitState();

    return true;
  }

  /* =====================================================
     STATE EVENT
     ===================================================== */

  function emitState() {
    emit(
      "neyo:chat-state",
      {
        version:
          VERSION,

        conversationId:
          currentConversationId,

        messages:
          cloneConversation(),

        generating,

        model:
          getSelectedModel(),

        preferences: {
          ...preferences
        }
      }
    );
  }

  /* =====================================================
     SEND EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-request",
    event => {
      const detail =
        event.detail || {};

      void send({
        text:
          detail.text || "",

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
    event => {
      stop(
        event.detail?.reason ||
        "user"
      );
    }
  );

  /* =====================================================
     NEW CHAT EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new-request",
    () => {
      newConversation();
    }
  );

  /* =====================================================
     HISTORY EVENTS

     Support old + new event name during migration.
     ===================================================== */

  function handleConversationLoaded(
    event
  ) {
    const detail =
      event.detail || {};

    loadConversation({
      conversationId:
        detail.conversationId ||
        detail.id ||
        null,

      messages:
        detail.messages ||
        detail.conversation ||
        []
    });
  }

  window.addEventListener(
    "neyo:conversation-loaded",
    handleConversationLoaded
  );

  window.addEventListener(
    "neyo:history-conversation-loaded",
    handleConversationLoaded
  );

  /* =====================================================
     PREFERENCE EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-preferences-set",
    event => {
      setPreferences(
        event.detail || {}
      );
    }
  );

  /* =====================================================
     STATE SYNC
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state-sync-request",
    () => {
      emitState();
    }
  );

  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({
      __controller: true,

      version: VERSION,

      active: true,

      /*
       * Main lifecycle
       */

      send,

      stop,

      newConversation,

      loadConversation,

      /*
       * Message state
       */

      addMessage,

      updateMessage,

      removeMessage,

      getMessage,

      getConversation() {
        return cloneConversation();
      },

      /*
       * ChatGPT-style actions
       */

      editUserMessage,

      regenerate,

      /*
       * Preferences
       */

      setPreferences,

      getPreferences() {
        return {
          ...preferences
        };
      },

      /*
       * Conversation ID
       */

      getConversationId() {
        return (
          currentConversationId
        );
      },

      setConversationId(id) {
        currentConversationId =
          cleanId(id) ||
          null;

        emitState();

        return true;
      },

      /*
       * Generation state
       */

      isGenerating() {
        return generating;
      },

      /*
       * Diagnostics
       */

      getState() {
        return {
          version:
            VERSION,

          active: true,

          generating,

          conversationId:
            currentConversationId,

          messageCount:
            conversation.length,

          requestId:
            activeRequestId,

          model:
            getSelectedModel(),

          preferences: {
            ...preferences
          }
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoChat",
    {
      value: api,

      writable: false,

      configurable: true,

      enumerable: true
    }
  );

  /* =====================================================
     READY
     ===================================================== */

  emit(
    "neyo:chat-ready",
    {
      version: VERSION,

      active: true,

      jsonBackendCompatible:
        true,

      streamingReady:
        true,

      singleConversationOwner:
        true,

      domRendering:
        false,

      edit: true,

      regenerate: true,

      stop: true
    }
  );

  emitState();
})();
