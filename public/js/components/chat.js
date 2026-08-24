/*
=========================================================
NEO — CHAT CORE
Production v1

Owns:
- single conversation state
- current conversation ID
- /api/chat
- request lifecycle
- Abort / Stop
- message state
- edit user message
- regenerate assistant turn
- history conversation loading
- model + preferences payload
- attachment metadata
- error / limit lifecycle
- public chat events

Does NOT own:
- message DOM
- markdown rendering
- thinking DOM
- send button
- Enter key
- attachment uploads
- sidebar/history UI
- topbar/model-picker UI
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-chat-production-v1";

  if (
    window.NeyoChat
      ?.__controller === true
  ) {
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

    requestTimeoutMs: 180_000
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
    intelligence: "standard",
    language: "auto",
    personality: "neyo",

    privateChat: false,
    isDeepResearch: false
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
    max = CONFIG.maxMessageLength
  ) {
    return String(
      value ?? ""
    )
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .slice(0, max)
      .trim();
  }

  function cloneSource(
    source
  ) {
    if (
      !source ||
      typeof source !== "object"
    ) {
      return null;
    }

    return {
      ...source
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
          typeof item === "object"
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

          mimeType: mime,
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

    const content =
      clean(
        message.content
      );

    const normalized = {
      id:
        clean(
          message.id,
          128
        ) ||
        makeId(),

      role:
        message.role,

      content
    };

    /*
     * displayContent allows the UI to hide internal
     * attachment-only prompts while API content stays valid.
     */

    if (
      typeof message.displayContent ===
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
          .map(cloneSource)
          .filter(Boolean);

      if (sources.length) {
        normalized.sources =
          sources;
      }
    }

    if (message.error === true) {
      normalized.error =
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
      ? cloneMessage(message)
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
      typeof changes.displayContent ===
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
      const normalized =
        normalizeAttachments(
          changes.attachments
        );

      if (normalized.length) {
        next.attachments =
          normalized;
      } else {
        delete next.attachments;
      }
    }

    if (
      Array.isArray(
        changes.sources
      )
    ) {
      next.sources =
        changes.sources
          .map(cloneSource)
          .filter(Boolean);
    }

    if (
      typeof changes.error ===
      "boolean"
    ) {
      next.error =
        changes.error;
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
        message:
          publicMessage,

        id:
          next.id,

        conversation:
          getConversation()
      }
    );

    /*
     * Compatibility with existing messages.js versions.
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

     Used by Edit and Regenerate.
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

     UI itself is NOT changed here.
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

      /*
       * Current-turn compatibility field.
       * Existing backend already supports it.
       */

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

      title:
        createTitle(
          prompt,
          attachments
        )
    };
  }

  /* =====================================================
     RESPONSE
     ===================================================== */

  async function readResponse(
    response
  ) {
    const raw =
      await response.text();

    let data = {};

    if (raw) {
      try {
        data =
          JSON.parse(raw);
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
      ? value.trim()
      : "";
  }

  /* =====================================================
     STOP
     ===================================================== */

  function stop(
    reason =
      "user"
  ) {
    if (!activeController) {
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
      error?.status === 401
    ) {
      return (
        "Your session has expired. " +
        "Please sign in again."
      );
    }

    if (
      error?.status === 413
    ) {
      return (
        "This request is too large."
      );
    }

    if (
      error?.status === 429
    ) {
      return (
        "You've reached the current usage limit."
      );
    }

    if (
      Number(error?.status) >=
      500
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

     Expects the current user turn to ALREADY exist in
     conversation.

     Used by:
     - normal Send
     - Regenerate
     - Edit + regenerate
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

    let timeout = null;

    try {
      timeout =
        window.setTimeout(
          () => {
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
          prompt,
          attachments:
            readyAttachments
        });

      const response =
        await fetch(
          CONFIG.endpoint,
          {
            method: "POST",

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

      /* ===============================================
         RATE LIMIT
         =============================================== */

      if (
        response.status === 429
      ) {
        const data =
          await response
            .json()
            .catch(
              () => ({})
            );

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

      /*
       * New chat/history load may invalidate this request.
       */

      if (
        requestId !==
        activeRequestId
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

      /* ===============================================
         CONVERSATION ID
         =============================================== */

      if (
        !preferences.privateChat &&
        typeof data
          ?.conversationId ===
          "string" &&
        data.conversationId.trim()
      ) {
        currentConversationId =
          data.conversationId
            .trim();
      }

      /* ===============================================
         ASSISTANT
         =============================================== */

      const sources =
        Array.isArray(
          data?.sources
        )
          ? data.sources
              .map(cloneSource)
              .filter(Boolean)
          : [];

      const assistantMessage =
        addMessage(
          "assistant",
          reply,
          {
            id:
              data?.messageId ||
              data?.assistantMessageId ||
              undefined,

            sources
          }
        );

      const result = {
        requestId,

        reply,

        sources,

        message:
          assistantMessage
            ? cloneMessage(
                assistantMessage
              )
            : null,

        userMessageId,

        conversationId:
          currentConversationId,

        privateChat:
          Boolean(
            preferences.privateChat ||
            data?.privateChat
          ),

        usedUrlContext:
          Boolean(
            data?.usedUrlContext
          ),

        creditType:
          data?.creditType ||
          null,

        reason
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
      if (
        error?.name ===
        "AbortError"
      ) {
        emit(
          "neyo:chat-aborted",
          {
            requestId,

            conversationId:
              currentConversationId,

            reason
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

      const errorMessage =
        addMessage(
          "assistant",
          `⚠️ ${text}`,
          {
            error: true
          }
        );

      emit(
        "neyo:chat-error",
        {
          requestId,

          error,

          message:
            errorMessage
              ? cloneMessage(
                  errorMessage
                )
              : null,

          conversationId:
            currentConversationId,

          reason
        }
      );

      return null;

    } finally {
      if (timeout !== null) {
        window.clearTimeout(
          timeout
        );
      }

      /*
       * Only currently-valid request may close generation.
       */

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
      readyAttachments.length === 0
    ) {
      return null;
    }

    const apiContent =
      visibleText ||
      ATTACHMENT_ONLY_PROMPT;

    /*
     * User message enters canonical state before network.
     */

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

     Regenerate the clicked assistant turn, not blindly
     "the last message".

     Conversation becomes:
       ... preceding context
       target user message

     Then the canonical generator runs again.
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
          assistantIndex =
            index;

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
          ?.role ===
        "user"
      ) {
        userIndex =
          index;

        break;
      }
    }

    if (userIndex < 0) {
      return null;
    }

    const userMessage =
      conversation[userIndex];

    /*
     * Remove old assistant response and anything after
     * the target user turn.
     */

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

     Attachments are preserved unless explicitly supplied.

     This operation owns canonical conversation mutation.
     message-edit.js owns only the editor UI.
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
      nextAttachments.length === 0
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

    /*
     * Old responses after edited user turn are invalid.
     */

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
     * Invalidate request BEFORE abort.
     */

    activeRequestId += 1;

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
        conversation: []
      }
    );

    emit(
      "neyo:chat-state",
      {
        conversationId:
          null,

        messages: [],

        generating:
          false,

        preferences: {
          ...preferences
        }
      }
    );

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
    /*
     * Invalidate old generation.
     */

    activeRequestId += 1;

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

    /*
     * messages.js owns DOM.
     */

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

    emit(
      "neyo:chat-state",
      {
        conversationId:
          currentConversationId,

        messages:
          getConversation(),

        generating:
          false,

        preferences: {
          ...preferences
        }
      }
    );

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
      typeof values !== "object"
    ) {
      return false;
    }

    const next = {
      ...preferences
    };

    if (
      typeof values.intelligence ===
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
      typeof values.isDeepResearch ===
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

    return true;
  }

  /* =====================================================
     STATE EMISSION
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
        event.detail?.reason ||
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
     STATE SYNC REQUEST
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
      __controller: true,
      version: VERSION,

      active: true,

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
        return currentConversationId;
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

          active:
            true,

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
})();
