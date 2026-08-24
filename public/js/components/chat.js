/*
=========================================================
NEO — CHAT CORE
Production v2 — Streaming Core

Owns:
- canonical conversation state
- current conversation ID
- /api/chat transport
- streaming response lifecycle
- JSON fallback
- Abort / Stop
- request timeout
- user + assistant message state
- edit user message
- regenerate exact assistant turn
- history conversation loading
- preferences + model payload
- attachment metadata
- rate-limit / error lifecycle

Does NOT own:
- message DOM
- markdown rendering
- Send button / Enter key
- attachment upload
- history sidebar UI
- topbar / model picker UI
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-chat-production-v2-streaming";

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

      requestTimeoutMs:
        180_000
    });

  const ATTACHMENT_ONLY_PROMPT =
    "Please analyze the attached file or files.";

  /* =====================================================
     STATE
     ===================================================== */

  let conversation = [];

  let currentConversationId =
    null;

  let generating =
    false;

  let activeController =
    null;

  let activeRequestId =
    0;

  let preferences = {
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
        { detail }
      )
    );
  }

  /* =====================================================
     BASIC HELPERS
     ===================================================== */

  function makeId() {
    return (
      globalThis.crypto
        ?.randomUUID
        ?.() ||
      `msg_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`
    );
  }

  function clean(
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

  function cloneObject(
    value
  ) {
    if (
      !value ||
      typeof value !==
        "object"
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

  function normalizeAttachments(
    value
  ) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter(
        item =>
          item &&
          typeof item ===
            "object"
      )
      .slice(
        0,
        CONFIG.maxAttachments
      )
      .map(item => {
        const mime =
          clean(
            item.mimeType ||
            item.mime ||
            item.type ||
            "application/octet-stream",
            255
          ) ||
          "application/octet-stream";

        return {
          id:
            clean(
              item.id,
              128
            ) ||
            undefined,

          uploadId:
            clean(
              item.uploadId,
              128
            ) ||
            undefined,

          processId:
            clean(
              item.processId,
              128
            ) ||
            undefined,

          documentId:
            clean(
              item.documentId,
              128
            ) ||
            undefined,

          provider:
            clean(
              item.provider,
              50
            ) ||
            "supabase",

          bucket:
            clean(
              item.bucket,
              255
            ),

          path:
            clean(
              item.path,
              1000
            ),

          name:
            clean(
              item.name,
              255
            ) ||
            "Attached file",

          mimeType:
            mime,

          mime,

          extension:
            clean(
              item.extension,
              30
            ),

          category:
            clean(
              item.category,
              50
            ) ||
            "unknown",

          size:
            Math.max(
              0,
              Number(
                item.size
              ) || 0
            ),

          document:
            item.document &&
            typeof item.document ===
              "object"
              ? {
                  ...item.document
                }
              : undefined,

          chunks:
            Array.isArray(
              item.chunks
            )
              ? item.chunks.map(
                  chunk =>
                    typeof chunk ===
                      "object"
                      ? {
                          ...chunk
                        }
                      : chunk
                )
              : undefined,

          stats:
            item.stats &&
            typeof item.stats ===
              "object"
              ? {
                  ...item.stats
                }
              : undefined
        };
      })
      .filter(
        item =>
          Boolean(
            item.path ||
            item.documentId ||
            item.uploadId
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

    if (
      message.role !== "user" &&
      message.role !== "assistant"
    ) {
      return null;
    }

    const normalized = {
      id:
        clean(
          message.id,
          128
        ) ||
        makeId(),

      role:
        message.role,

      content:
        clean(
          message.content
        )
    };

    if (
      typeof message
        .displayContent ===
      "string"
    ) {
      normalized.displayContent =
        clean(
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

    if (
      Array.isArray(
        message.sources
      )
    ) {
      const sources =
        message.sources
          .map(
            cloneObject
          )
          .filter(Boolean);

      if (sources.length) {
        normalized.sources =
          sources;
      }
    }

    if (
      message.error === true
    ) {
      normalized.error =
        true;
    }

    if (
      message.streaming === true
    ) {
      normalized.streaming =
        true;
    }

    if (message.createdAt) {
      normalized.createdAt =
        message.createdAt;
    }

    return normalized;
  }

  /* =====================================================
     CLONE MESSAGE
     ===================================================== */

  function cloneMessage(
    message
  ) {
    return {
      ...message,

      attachments:
        Array.isArray(
          message.attachments
        )
          ? message.attachments.map(
              item => ({
                ...item,

                document:
                  item.document &&
                  typeof item.document ===
                    "object"
                    ? {
                        ...item.document
                      }
                    : item.document,

                chunks:
                  Array.isArray(
                    item.chunks
                  )
                    ? item.chunks.map(
                        chunk =>
                          typeof chunk ===
                            "object"
                            ? {
                                ...chunk
                              }
                            : chunk
                      )
                    : item.chunks
              })
            )
          : undefined,

      sources:
        Array.isArray(
          message.sources
        )
          ? message.sources.map(
              source => ({
                ...source
              })
            )
          : undefined
    };
  }

  /* =====================================================
     CONVERSATION
     ===================================================== */

  function getConversation() {
    return conversation.map(
      cloneMessage
    );
  }

  function getMessage(
    id
  ) {
    const key =
      clean(
        id,
        128
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
      ? cloneMessage(
          message
        )
      : null;
  }

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

    conversation.push(
      message
    );

    boundConversation();

    emit(
      "neyo:chat-message-added",
      {
        message:
          cloneMessage(
            message
          ),

        conversation:
          getConversation(),

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
    id,
    changes = {}
  ) {
    const key =
      clean(
        id,
        128
      );

    const index =
      conversation.findIndex(
        message =>
          message.id === key
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
        clean(
          changes.content
        );
    }

    if (
      typeof changes
        .displayContent ===
      "string"
    ) {
      next.displayContent =
        clean(
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
        changes.sources
          .map(
            cloneObject
          )
          .filter(Boolean);

      if (sources.length) {
        next.sources =
          sources;
      } else {
        delete next.sources;
      }
    }

    if (
      typeof changes.error ===
      "boolean"
    ) {
      next.error =
        changes.error;
    }

    if (
      typeof changes.streaming ===
      "boolean"
    ) {
      next.streaming =
        changes.streaming;
    }

    conversation[index] =
      next;

    const publicMessage =
      cloneMessage(
        next
      );

    emit(
      "neyo:chat-message-updated",
      {
        id:
          next.id,

        message:
          publicMessage,

        conversation:
          getConversation()
      }
    );

    /*
     * Temporary migration compatibility.
     */

    emit(
      "neyo:message-update-request",
      {
        id:
          next.id,

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
    id
  ) {
    const key =
      clean(
        id,
        128
      );

    const index =
      conversation.findIndex(
        message =>
          message.id === key
      );

    if (index < 0) {
      return false;
    }

    const [removed] =
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
          cloneMessage(
            removed
          ),

        conversation:
          getConversation()
      }
    );

    return true;
  }

  /* =====================================================
     TRUNCATE
     ===================================================== */

  function truncateAfterIndex(
    index
  ) {
    if (
      index < -1 ||
      index >=
        conversation.length
    ) {
      return false;
    }

    const removed =
      conversation.splice(
        index + 1
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
            cloneMessage(
              message
            ),

          conversation:
            getConversation()
        }
      );
    }

    return true;
  }

  /* =====================================================
     API MESSAGE
     ===================================================== */

  function toApiMessage(
    message
  ) {
    const result = {
      role:
        message.role,

      content:
        clean(
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
     MODEL
     ===================================================== */

  function getSelectedModel() {
    try {
      const selected =
        window.NeyoModelMenu
          ?.getSelected
          ?.();

      if (
        typeof selected ===
          "string" &&
        selected.trim()
      ) {
        return selected.trim();
      }

      if (
        selected &&
        typeof selected ===
          "object"
      ) {
        return (
          clean(
            selected.id ||
            selected.value ||
            selected.model,
            100
          ) ||
          "l1.0"
        );
      }

    } catch {}

    return "l1.0";
  }

  /* =====================================================
     TITLE
     ===================================================== */

  function createTitle(
    text,
    attachments = []
  ) {
    const value =
      clean(
        text,
        80
      );

    if (
      value &&
      value !==
        ATTACHMENT_ONLY_PROMPT
    ) {
      return value;
    }

    const first =
      attachments[0];

    if (first?.name) {
      return clean(
        first.name,
        80
      );
    }

    return "New conversation";
  }

  /* =====================================================
     PAYLOAD
     ===================================================== */

  function buildPayload({
    prompt,
    attachments = []
  } = {}) {
    const privateChat =
      Boolean(
        preferences.privateChat
      );

    return {
      messages:
        conversation
          .slice(
            -CONFIG.maxHistoryMessages
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
        preferences.intelligence,

      language:
        preferences.language,

      personality:
        preferences.personality,

      privateChat,

      isDeepResearch:
        Boolean(
          preferences.isDeepResearch
        ),

      /*
       * Backend may ignore this safely.
       */

      stream:
        true,

      title:
        createTitle(
          prompt,
          attachments
        )
    };
  }

  /* =====================================================
     RESPONSE HELPERS
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
          JSON.parse(
            raw
          );
      } catch {}
    }

    if (!response.ok) {
      const error =
        new Error(
          clean(
            data?.message ||
            data?.error ||
            raw,
            2000
          ) ||
          `Request failed (${response.status}).`
        );

      error.status =
        response.status;

      error.data =
        data;

      throw error;
    }

    return data;
  }

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

    return typeof value ===
      "string"
      ? value
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

  function extractSources(
    data
  ) {
    const value =
      data?.sources ??
      data?.citations ??
      data?.groundingSources ??
      [];

    return Array.isArray(
      value
    )
      ? value
          .map(
            cloneObject
          )
          .filter(Boolean)
      : [];
  }

  function extractMessageId(
    data
  ) {
    return clean(
      data?.messageId ||
      data?.assistantMessageId ||
      data?.message_id ||
      "",
      128
    );
  }

  /* =====================================================
     STREAM DELTA EXTRACTION
     ===================================================== */

  function extractDelta(
    data
  ) {
    if (
      typeof data ===
      "string"
    ) {
      return data;
    }

    if (
      !data ||
      typeof data !==
        "object"
    ) {
      return "";
    }

    const direct =
      data.delta ??
      data.token ??
      data?.message?.delta ??
      data?.choices?.[0]
        ?.delta
        ?.content;

    if (
      typeof direct ===
      "string"
    ) {
      return direct;
    }

    const type =
      String(
        data.type ||
        data.event ||
        ""
      ).toLowerCase();

    if (
      [
        "delta",
        "token",
        "content",
        "message_delta",
        "text_delta"
      ].includes(
        type
      ) &&
      typeof data.content ===
        "string"
    ) {
      return data.content;
    }

    /*
     * Some SSE backends send one final object containing
     * the complete reply.
     */

    const full =
      extractReply(
        data
      );

    return typeof full ===
      "string"
      ? full
      : "";
  }

  /* =====================================================
     STREAM WRITER

     Canonical state updates are batched through RAF so
     token streaming does not re-render Markdown hundreds
     of times per second.
     ===================================================== */

  function createStreamWriter({
    requestId,
    reason,
    userMessageId
  }) {
    let assistantMessage =
      null;

    let content =
      "";

    let renderedContent =
      "";

    let frame =
      null;

    let sources = [];

    let started =
      false;

    function ensureMessage(
      preferredId = null
    ) {
      if (assistantMessage) {
        return assistantMessage;
      }

      assistantMessage =
        addMessage(
          "assistant",
          "",
          {
            id:
              preferredId ||
              makeId(),

            streaming:
              true
          }
        );

      return assistantMessage;
    }

    function flush() {
      if (frame !== null) {
        cancelAnimationFrame(
          frame
        );

        frame =
          null;
      }

      if (
        !assistantMessage ||
        renderedContent ===
          content
      ) {
        return;
      }

      renderedContent =
        content;

      updateMessage(
        assistantMessage.id,
        {
          content,
          streaming:
            true
        }
      );
    }

    function scheduleFlush() {
      if (frame !== null) {
        return;
      }

      frame =
        requestAnimationFrame(
          () => {
            frame =
              null;

            flush();
          }
        );
    }

    function start(
      metadata = {}
    ) {
      if (started) {
        return;
      }

      started =
        true;

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
        String(
          delta ?? ""
        );

      if (!value) {
        return;
      }

      start();

      const message =
        ensureMessage(
          extractMessageId(
            metadata
          ) ||
          null
        );

      content +=
        value;

      scheduleFlush();

      emit(
        "neyo:chat-stream-delta",
        {
          requestId,

          messageId:
            message.id,

          delta:
            value,

          content,

          reason,

          userMessageId
        }
      );
    }

    function setSources(
      value
    ) {
      if (!Array.isArray(value)) {
        return;
      }

      sources =
        value
          .map(
            cloneObject
          )
          .filter(Boolean);
    }

    function complete() {
      flush();

      if (
        assistantMessage
      ) {
        updateMessage(
          assistantMessage.id,
          {
            content,

            sources,

            streaming:
              false,

            error:
              false
          }
        );
      }

      emit(
        "neyo:chat-stream-end",
        {
          requestId,

          messageId:
            assistantMessage
              ?.id ||
            null,

          content,

          sources,

          reason,

          userMessageId
        }
      );

      return {
        message:
          assistantMessage
            ? getMessage(
                assistantMessage.id
              )
            : null,

        content,

        sources,

        started
      };
    }

    function fail(
      message
    ) {
      flush();

      if (
        assistantMessage
      ) {
        updateMessage(
          assistantMessage.id,
          {
            content:
              message,

            streaming:
              false,

            error:
              true
          }
        );

        return getMessage(
          assistantMessage.id
        );
      }

      const created =
        addMessage(
          "assistant",
          message,
          {
            error:
              true
          }
        );

      return created
        ? cloneMessage(
            created
          )
        : null;
    }

    function getState() {
      return {
        messageId:
          assistantMessage
            ?.id ||
          null,

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
      fail,
      getState
    };
  }

  /* =====================================================
     STREAM METADATA
     ===================================================== */

  function applyStreamMetadata(
    data,
    writer
  ) {
    if (
      !data ||
      typeof data !==
        "object"
    ) {
      return;
    }

    const id =
      extractConversationId(
        data
      );

    if (
      id &&
      !preferences.privateChat
    ) {
      currentConversationId =
        id;
    }

    const sources =
      extractSources(
        data
      );

    if (sources.length) {
      writer.setSources(
        sources
      );
    }
  }

  /* =====================================================
     STREAM OBJECT
     ===================================================== */

  function consumeStreamObject(
    data,
    writer
  ) {
    if (
      data === null ||
      data === undefined
    ) {
      return;
    }

    applyStreamMetadata(
      data,
      writer
    );

    const type =
      String(
        data?.type ||
        data?.event ||
        ""
      ).toLowerCase();

    if (
      [
        "done",
        "complete",
        "completed",
        "end",
        "message_end"
      ].includes(
        type
      )
    ) {
      return;
    }

    const delta =
      extractDelta(
        data
      );

    if (delta) {
      /*
       * Protect against a backend sending the accumulated
       * full reply repeatedly rather than true deltas.
       */

      const current =
        writer.getState()
          .content;

      if (
        current &&
        delta.startsWith(
          current
        )
      ) {
        const newPart =
          delta.slice(
            current.length
          );

        if (newPart) {
          writer.append(
            newPart,
            data
          );
        }

        return;
      }

      writer.append(
        delta,
        data
      );
    }
  }

  /* =====================================================
     SSE PARSER
     ===================================================== */

  async function consumeSSE(
    response,
    writer
  ) {
    if (!response.body) {
      return;
    }

    writer.start({
      transport:
        "sse"
    });

    const reader =
      response.body
        .getReader();

    const decoder =
      new TextDecoder();

    let buffer =
      "";

    let dataLines = [];

    function processEvent() {
      if (!dataLines.length) {
        return;
      }

      const payload =
        dataLines.join(
          "\n"
        );

      dataLines = [];

      if (
        payload.trim() ===
        "[DONE]"
      ) {
        return;
      }

      try {
        consumeStreamObject(
          JSON.parse(
            payload
          ),
          writer
        );

      } catch {
        writer.append(
          payload
        );
      }
    }

    while (true) {
      const {
        done,
        value
      } =
        await reader.read();

      if (done) {
        break;
      }

      buffer +=
        decoder.decode(
          value,
          {
            stream:
              true
          }
        );

      const lines =
        buffer.split(
          /\r?\n/
        );

      buffer =
        lines.pop() ||
        "";

      for (
        const line
        of lines
      ) {
        if (line === "") {
          processEvent();
          continue;
        }

        if (
          line.startsWith(
            ":"
          )
        ) {
          continue;
        }

        if (
          line.startsWith(
            "data:"
          )
        ) {
          dataLines.push(
            line
              .slice(5)
              .trimStart()
          );
        }
      }
    }

    buffer +=
      decoder.decode();

    if (buffer) {
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
        dataLines.push(
          buffer
        );
      }
    }

    processEvent();
  }

  /* =====================================================
     NDJSON PARSER
     ===================================================== */

  async function consumeNDJSON(
    response,
    writer
  ) {
    if (!response.body) {
      return;
    }

    writer.start({
      transport:
        "ndjson"
    });

    const reader =
      response.body
        .getReader();

    const decoder =
      new TextDecoder();

    let buffer =
      "";

    while (true) {
      const {
        done,
        value
      } =
        await reader.read();

      if (done) {
        break;
      }

      buffer +=
        decoder.decode(
          value,
          {
            stream:
              true
          }
        );

      const lines =
        buffer.split(
          /\r?\n/
        );

      buffer =
        lines.pop() ||
        "";

      for (
        const line
        of lines
      ) {
        const value =
          line.trim();

        if (
          !value ||
          value ===
            "[DONE]"
        ) {
          continue;
        }

        try {
          consumeStreamObject(
            JSON.parse(
              value
            ),
            writer
          );

        } catch {
          writer.append(
            value
          );
        }
      }
    }

    buffer +=
      decoder.decode();

    const finalLine =
      buffer.trim();

    if (
      finalLine &&
      finalLine !==
        "[DONE]"
    ) {
      try {
        consumeStreamObject(
          JSON.parse(
            finalLine
          ),
          writer
        );

      } catch {
        writer.append(
          finalLine
        );
      }
    }
  }

  /* =====================================================
     TEXT STREAM
     ===================================================== */

  async function consumeTextStream(
    response,
    writer
  ) {
    if (!response.body) {
      return;
    }

    writer.start({
      transport:
        "text"
    });

    const reader =
      response.body
        .getReader();

    const decoder =
      new TextDecoder();

    while (true) {
      const {
        done,
        value
      } =
        await reader.read();

      if (done) {
        break;
      }

      const delta =
        decoder.decode(
          value,
          {
            stream:
              true
          }
        );

      if (delta) {
        writer.append(
          delta
        );
      }
    }

    const tail =
      decoder.decode();

    if (tail) {
      writer.append(
        tail
      );
    }
  }

  /* =====================================================
     TRANSPORT DETECTION
     ===================================================== */

  function responseType(
    response
  ) {
    const type =
      String(
        response.headers
          .get(
            "content-type"
          ) ||
        ""
      ).toLowerCase();

    if (
      type.includes(
        "text/event-stream"
      )
    ) {
      return "sse";
    }

    if (
      type.includes(
        "application/x-ndjson"
      ) ||
      type.includes(
        "application/ndjson"
      ) ||
      type.includes(
        "jsonlines"
      )
    ) {
      return "ndjson";
    }

    if (
      type.includes(
        "application/json"
      )
    ) {
      return "json";
    }

    if (
      type.includes(
        "text/plain"
      ) &&
      response.body
    ) {
      return "text";
    }

    return response.body
      ? "text"
      : "json";
  }

  /* =====================================================
     STOP
     ===================================================== */

  function stop(
    reason =
      "user"
  ) {
    if (
      !activeController ||
      activeController
        .signal
        .aborted
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
     USER-FACING ERROR
     ===================================================== */

  function userFacingError(
    error
  ) {
    if (
      error?.status ===
      401
    ) {
      return (
        "Your session has expired. Please sign in again."
      );
    }

    if (
      error?.status ===
      413
    ) {
      return (
        "This request is too large."
      );
    }

    if (
      error?.status ===
      429
    ) {
      return (
        "You've reached the current usage limit."
      );
    }

    if (
      Number(
        error?.status
      ) >= 500
    ) {
      return (
        "NEO is temporarily unavailable. Please try again."
      );
    }

    return (
      clean(
        error?.message,
        500
      ) ||
      "Something went wrong. Please try again."
    );
  }

  /* =====================================================
     GENERATION CORE
     ===================================================== */

  async function generate({
    prompt,
    attachments = [],
    reason = "send",
    userMessageId = null
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

    generating =
      true;

    const controller =
      new AbortController();

    activeController =
      controller;

    const readyAttachments =
      normalizeAttachments(
        attachments
      );

    const writer =
      createStreamWriter({
        requestId,
        reason,
        userMessageId
      });

    emit(
      "neyo:chat-send-start",
      {
        requestId,

        text:
          clean(
            prompt
          ) ===
          ATTACHMENT_ONLY_PROMPT
            ? ""
            : clean(
                prompt
              ),

        attachments:
          readyAttachments,

        conversationId:
          currentConversationId,

        userMessageId,

        reason
      }
    );

    let timeout =
      null;

    try {
      timeout =
        window.setTimeout(
          () => {
            if (
              !controller
                .signal
                .aborted
            ) {
              try {
                controller.abort(
                  "timeout"
                );
              } catch {
                controller.abort();
              }
            }
          },
          CONFIG.requestTimeoutMs
        );

      const payload =
        buildPayload({
          prompt,
          attachments:
            readyAttachments
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
                "text/event-stream, application/x-ndjson, application/json, text/plain",

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

      /* ===============================================
         RATE LIMIT
         =============================================== */

      if (
        response.status ===
        429
      ) {
        let data = {};

        try {
          data =
            await response
              .json();
        } catch {}

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

      /* ===============================================
         OTHER HTTP ERRORS
         =============================================== */

      if (!response.ok) {
        await readJsonResponse(
          response
        );

        return null;
      }

      const transport =
        responseType(
          response
        );

      let reply =
        "";

      let sources = [];

      let assistantMessage =
        null;

      /* ===============================================
         NORMAL JSON FALLBACK
         =============================================== */

      if (
        transport ===
        "json"
      ) {
        const data =
          await readJsonResponse(
            response
          );

        if (
          requestId !==
          activeRequestId
        ) {
          return null;
        }

        const id =
          extractConversationId(
            data
          );

        if (
          id &&
          !preferences.privateChat
        ) {
          currentConversationId =
            id;
        }

        reply =
          extractReply(
            data
          );

        sources =
          extractSources(
            data
          );

        if (!reply.trim()) {
          throw new Error(
            "The AI response was empty."
          );
        }

        const created =
          addMessage(
            "assistant",
            reply,
            {
              id:
                extractMessageId(
                  data
                ) ||
                undefined,

              sources,

              streaming:
                false
            }
          );

        assistantMessage =
          created
            ? cloneMessage(
                created
              )
            : null;
      }

      /* ===============================================
         SSE
         =============================================== */

      else if (
        transport ===
        "sse"
      ) {
        await consumeSSE(
          response,
          writer
        );

        const completed =
          writer.complete();

        reply =
          completed.content;

        sources =
          completed.sources;

        assistantMessage =
          completed.message;
      }

      /* ===============================================
         NDJSON
         =============================================== */

      else if (
        transport ===
        "ndjson"
      ) {
        await consumeNDJSON(
          response,
          writer
        );

        const completed =
          writer.complete();

        reply =
          completed.content;

        sources =
          completed.sources;

        assistantMessage =
          completed.message;
      }

      /* ===============================================
         PLAIN TEXT STREAM
         =============================================== */

      else {
        await consumeTextStream(
          response,
          writer
        );

        const completed =
          writer.complete();

        reply =
          completed.content;

        sources =
          completed.sources;

        assistantMessage =
          completed.message;
      }

      /* ===============================================
         STALE REQUEST CHECK
         =============================================== */

      if (
        requestId !==
        activeRequestId
      ) {
        return null;
      }

      if (!reply.trim()) {
        throw new Error(
          "The AI response was empty."
        );
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

        reason,

        streamed:
          transport !==
          "json",

        transport
      };

      emit(
        "neyo:chat-response",
        result
      );

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
       * Robust abort detection.
       *
       * Custom AbortController reasons are not guaranteed
       * to surface as DOMException("AbortError").
       */

      if (
        controller.signal.aborted ||
        error?.name ===
          "AbortError"
      ) {
        const partial =
          writer.getState();

        /*
         * Keep partial response when user presses Stop.
         */

        if (
          partial.messageId
        ) {
          updateMessage(
            partial.messageId,
            {
              content:
                partial.content,

              sources:
                partial.sources,

              streaming:
                false
            }
          );
        }

        emit(
          "neyo:chat-aborted",
          {
            requestId,

            conversationId:
              currentConversationId,

            reason:
              controller.signal
                .reason ||
              reason,

            partial:
              partial.content,

            messageId:
              partial.messageId
          }
        );

        return null;
      }

      console.error(
        "[NEO Chat] Request failed:",
        error
      );

      const text =
        userFacingError(
          error
        );

      const errorText =
        `⚠️ ${text}`;

      const errorMessage =
        writer.fail(
          errorText
        );

      emit(
        "neyo:chat-error",
        {
          requestId,

          error,

          message:
            errorMessage,

          conversationId:
            currentConversationId,

          reason
        }
      );

      return null;

    } finally {
      if (
        timeout !==
        null
      ) {
        window.clearTimeout(
          timeout
        );
      }

      if (
        requestId ===
        activeRequestId
      ) {
        generating =
          false;

        activeController =
          null;

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
     NORMAL SEND
     ===================================================== */

  async function send({
    text = "",
    attachments = []
  } = {}) {
    if (generating) {
      emit(
        "neyo:chat-busy"
      );

      return null;
    }

    const visibleText =
      clean(
        text
      );

    const readyAttachments =
      normalizeAttachments(
        attachments
      );

    if (
      !visibleText &&
      readyAttachments.length ===
        0
    ) {
      return null;
    }

    const apiContent =
      visibleText ||
      ATTACHMENT_ONLY_PROMPT;

    const userMessage =
      addMessage(
        "user",
        apiContent,
        {
          displayContent:
            visibleText,

          attachments:
            readyAttachments
        }
      );

    if (!userMessage) {
      return null;
    }

    return generate({
      prompt:
        apiContent,

      attachments:
        readyAttachments,

      reason:
        "send",

      userMessageId:
        userMessage.id
    });
  }

  /* =====================================================
     REGENERATE
     ===================================================== */

  async function regenerate({
    messageId
  } = {}) {
    if (generating) {
      return null;
    }

    const assistantId =
      clean(
        messageId,
        128
      );

    let assistantIndex =
      assistantId
        ? conversation.findIndex(
            message =>
              message.id ===
                assistantId &&
              message.role ===
                "assistant"
          )
        : -1;

    /*
     * Compatibility fallback.
     */

    if (
      assistantIndex < 0
    ) {
      for (
        let index =
          conversation.length -
          1;
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
      cloneMessage(
        conversation[
          userIndex
        ]
      );

    truncateAfterIndex(
      userIndex
    );

    emit(
      "neyo:chat-regenerate-start",
      {
        messageId:
          assistantId ||
          null,

        userMessageId:
          userMessage.id
      }
    );

    const result =
      await generate({
        prompt:
          userMessage.content,

        attachments:
          userMessage
            .attachments ||
          [],

        reason:
          "regenerate",

        userMessageId:
          userMessage.id
      });

    emit(
      "neyo:chat-regenerate-end",
      {
        userMessageId:
          userMessage.id,

        result
      }
    );

    return result;
  }

  /* =====================================================
     EDIT USER MESSAGE
     ===================================================== */

  async function editUserMessage(
    messageId,
    text,
    {
      attachments,
      regenerateResponse =
        true
    } = {}
  ) {
    if (generating) {
      return null;
    }

    const id =
      clean(
        messageId,
        128
      );

    const index =
      conversation.findIndex(
        message =>
          message.id === id &&
          message.role ===
            "user"
      );

    if (index < 0) {
      return null;
    }

    const current =
      conversation[index];

    const nextAttachments =
      Array.isArray(
        attachments
      )
        ? normalizeAttachments(
            attachments
          )
        : normalizeAttachments(
            current.attachments ||
            []
          );

    const visibleText =
      clean(
        text
      );

    if (
      !visibleText &&
      nextAttachments.length ===
        0
    ) {
      return null;
    }

    const apiContent =
      visibleText ||
      ATTACHMENT_ONLY_PROMPT;

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

          error:
            false
        }
      );

    if (!updated) {
      return null;
    }

    truncateAfterIndex(
      index
    );

    emit(
      "neyo:chat-edit-committed",
      {
        message:
          getMessage(
            id
          ),

        regenerateResponse
      }
    );

    if (!regenerateResponse) {
      return {
        message:
          getMessage(
            id
          ),

        conversation:
          getConversation()
      };
    }

    return generate({
      prompt:
        apiContent,

      attachments:
        nextAttachments,

      reason:
        "edit",

      userMessageId:
        id
    });
  }

  /* =====================================================
     NEW CONVERSATION
     ===================================================== */

  function newConversation() {
    /*
     * Invalidate response BEFORE abort.
     */

    activeRequestId +=
      1;

    stop(
      "new-chat"
    );

    activeController =
      null;

    generating =
      false;

    conversation =
      [];

    currentConversationId =
      null;

    emit(
      "neyo:messages-clear"
    );

    emit(
      "neyo:chat-new",
      {
        conversation:
          []
      }
    );

    emitState();

    emit(
      "neyo:chat-send-end",
      {
        conversationId:
          null,

        reason:
          "new-chat"
      }
    );

    return true;
  }

  /* =====================================================
     LOAD HISTORY CONVERSATION
     ===================================================== */

  function loadConversation({
    conversationId,
    messages = []
  } = {}) {
    activeRequestId +=
      1;

    stop(
      "history-load"
    );

    activeController =
      null;

    generating =
      false;

    currentConversationId =
      clean(
        conversationId,
        128
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
      "neyo:messages-clear"
    );

    for (
      const message
      of conversation
    ) {
      emit(
        "neyo:chat-message-added",
        {
          message:
            cloneMessage(
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
          getConversation()
      }
    );

    emitState();

    emit(
      "neyo:chat-send-end",
      {
        conversationId:
          currentConversationId,

        reason:
          "history-load"
      }
    );

    return true;
  }

  /* =====================================================
     PREFERENCES
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

    const next = {
      ...preferences
    };

    if (
      typeof values
        .intelligence ===
      "string"
    ) {
      next.intelligence =
        values.intelligence;
    }

    if (
      typeof values.language ===
      "string"
    ) {
      next.language =
        values.language;
    }

    if (
      typeof values.personality ===
      "string"
    ) {
      next.personality =
        values.personality;
    }

    if (
      typeof values.privateChat ===
      "boolean"
    ) {
      next.privateChat =
        values.privateChat;
    }

    if (
      typeof values
        .isDeepResearch ===
      "boolean"
    ) {
      next.isDeepResearch =
        values.isDeepResearch;
    }

    preferences =
      next;

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
     STATE
     ===================================================== */

  function emitState() {
    emit(
      "neyo:chat-state",
      {
        conversationId:
          currentConversationId,

        messages:
          getConversation(),

        generating,

        preferences: {
          ...preferences
        }
      }
    );
  }

  /* =====================================================
     EVENT ROUTING
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

  window.addEventListener(
    "neyo:chat-stop-request",
    event => {
      stop(
        event.detail
          ?.reason ||
        "event"
      );
    }
  );

  window.addEventListener(
    "neyo:chat-new-request",
    () => {
      newConversation();
    }
  );

  /* =====================================================
     HISTORY ROUTING
     ===================================================== */

  function handleHistoryLoad(
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
        []
    });
  }

  window.addEventListener(
    "neyo:conversation-loaded",
    handleHistoryLoad
  );

  window.addEventListener(
    "neyo:history-conversation-loaded",
    handleHistoryLoad
  );

  /* =====================================================
     PREFERENCES ROUTING
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
     STATE SYNC
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

      /*
       * Generation
       */

      send,
      stop,

      regenerate,

      editUserMessage,

      /*
       * Conversation
       */

      newConversation,

      loadConversation,

      /*
       * Messages
       */

      addMessage,

      updateMessage,

      removeMessage,

      getMessage,

      getConversation,

      /*
       * Conversation ID
       */

      getConversationId() {
        return (
          currentConversationId
        );
      },

      setConversationId(
        id
      ) {
        currentConversationId =
          clean(
            id,
            128
          ) ||
          null;

        emitState();

        return true;
      },

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
       * Generation
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

          active:
            true,

          generating,

          streaming:
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

      streaming:
        true,

      streamingProtocols: [
        "text/event-stream",
        "application/x-ndjson",
        "text/plain"
      ],

      jsonFallback:
        true,

      singleConversationOwner:
        true,

      domRendering:
        false,

      edit:
        true,

      regenerate:
        true
    }
  );

  emitState();
})();
