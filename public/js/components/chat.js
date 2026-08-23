(() => {
  "use strict";

  const VERSION = "neyo-chat-v2";
  if (window.NeyoChat?.__controller === true) return;

  const CONFIG = Object.freeze({
    endpoint: "/api/chat",
    maxHistory: 50,
    maxAttachments: 5,
    timeoutMs: 180000
  });

  let conversation = [];
  let conversationId = null;
  let generating = false;
  let controller = null;
  let requestId = 0;

  let preferences = {
    intelligence: "standard",
    language: "auto",
    personality: "neyo",
    privateChat: false,
    isDeepResearch: false
  };

  function emit(name, detail = {}) {
    window.dispatchEvent(
      new CustomEvent(name, { detail })
    );
  }

  function clean(value, max = 50000) {
    return String(value ?? "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .trim()
      .slice(0, max);
  }

  function createId() {
    return (
      globalThis.crypto?.randomUUID?.() ||
      `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
  }

  function normalizeAttachments(value) {
    if (!Array.isArray(value)) return [];

    const seen = new Set();

    return value
      .filter(item => item && typeof item === "object")
      .slice(0, CONFIG.maxAttachments)
      .map(item => {
        const mime =
          clean(
            item.mime ||
              item.mimeType ||
              item.type ||
              "application/octet-stream",
            180
          ).toLowerCase() ||
          "application/octet-stream";

        return {
          id: clean(item.id, 128) || null,
          uploadId: clean(item.uploadId, 128) || null,
          provider: clean(item.provider, 40) || "supabase",
          bucket: clean(item.bucket, 100) || "neyo-attachments",
          path: clean(item.path, 1024),
          name: clean(item.name, 220) || "Attached file",
          mime,
          mimeType: mime,
          type: mime,
          extension: clean(item.extension, 24)
            .replace(/^\./, "")
            .toLowerCase(),
          category:
            clean(item.category, 32).toLowerCase() || "unknown",
          size: Math.max(0, Number(item.size) || 0)
        };
      })
      .filter(item => {
        if (
          !item.path ||
          item.path.includes("..") ||
          item.path.includes("\\")
        ) {
          return false;
        }

        const key = `${item.bucket}:${item.path}`;

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
      });
  }

  function cloneAttachments(value) {
    return Array.isArray(value)
      ? value.map(item => ({ ...item }))
      : undefined;
  }

  function normalizeMessage(message) {
    if (!message || typeof message !== "object") return null;

    if (
      message.role !== "user" &&
      message.role !== "assistant"
    ) {
      return null;
    }

    const normalized = {
      id: clean(message.id, 128) || createId(),
      role: message.role,
      content: clean(message.content)
    };

    const attachments = normalizeAttachments(
      message.attachments
    );

    if (attachments.length) {
      normalized.attachments = attachments;
    }

    if (Array.isArray(message.sources) && message.sources.length) {
      normalized.sources = message.sources.map(source => ({
        ...source
      }));
    }

    if (message.error === true) {
      normalized.error = true;
    }

    return normalized;
  }

  function toApiMessage(message) {
    const result = {
      role: message.role,
      content: clean(message.content)
    };

    const attachments = normalizeAttachments(
      message.attachments
    );

    if (attachments.length) {
      result.attachments = attachments;
    }

    return result;
  }

  function getConversation() {
    return conversation.map(message => ({
      ...message,
      attachments: cloneAttachments(message.attachments),
      sources: Array.isArray(message.sources)
        ? message.sources.map(source => ({ ...source }))
        : undefined
    }));
  }

  function boundConversation() {
    if (conversation.length > CONFIG.maxHistory) {
      conversation = conversation.slice(-CONFIG.maxHistory);
    }
  }

  function addMessage(role, content, options = {}) {
    const message = normalizeMessage({
      id: options.id || createId(),
      role,
      content,
      attachments: options.attachments,
      sources: options.sources,
      error: options.error
    });

    if (!message) return null;

    conversation.push(message);
    boundConversation();

    emit("neyo:chat-message-added", {
      message: {
        ...message,
        attachments: cloneAttachments(message.attachments)
      },
      conversation: getConversation(),
      historyLoad: Boolean(options.historyLoad)
    });

    return message;
  }

  function removeMessage(id) {
    const index = conversation.findIndex(
      message => message.id === id
    );

    if (index === -1) return false;

    const [message] = conversation.splice(index, 1);

    emit("neyo:chat-message-removed", {
      message,
      conversation: getConversation()
    });

    return true;
  }

  function selectedModel() {
    try {
      return (
        window.NeyoModelMenu?.getSelected?.() ||
        window.NeyoModelMenu?.getValue?.() ||
        "l1.0"
      );
    } catch {
      return "l1.0";
    }
  }

  function createTitle(text, attachments) {
    const value = clean(text, 1000)
      .replace(/\s+/g, " ")
      .trim();

    if (value) {
      return value.slice(0, 80);
    }

    return (
      clean(
        attachments?.[0]?.name || "New conversation",
        80
      ) || "New conversation"
    );
  }

  function buildPayload(prompt, attachments) {
    const privateChat = Boolean(
      preferences.privateChat
    );

    return {
      messages: conversation
        .filter(message => message.error !== true)
        .slice(-CONFIG.maxHistory)
        .map(toApiMessage),

      attachments: normalizeAttachments(attachments),

      conversationId: privateChat
        ? null
        : conversationId,

      model: selectedModel(),

      intelligence:
        clean(preferences.intelligence, 80) ||
        "standard",

      language:
        clean(preferences.language, 80) ||
        "auto",

      personality:
        clean(preferences.personality, 80) ||
        "neyo",

      privateChat,

      isDeepResearch: Boolean(
        preferences.isDeepResearch
      ),

      title: createTitle(
        prompt,
        attachments
      )
    };
  }

  async function readResponse(response) {
    const raw = await response.text();

    let data = {};

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {}
    }

    if (!response.ok) {
      const error = new Error(
        clean(
          data?.error ||
            data?.message ||
            raw,
          2000
        ) ||
          `Request failed (${response.status}).`
      );

      error.status = response.status;
      error.data = data;

      throw error;
    }

    return data;
  }

  function getReply(data) {
    const value =
      data?.reply ??
      data?.choices?.[0]?.message?.content ??
      data?.message?.content ??
      data?.content ??
      data?.text;

    return typeof value === "string"
      ? value.trim()
      : "";
  }

  function stop() {
    if (!controller) return false;

    try {
      controller.abort();
      return true;
    } catch {
      return false;
    }
  }

  function invalidateRequest() {
    requestId += 1;

    if (controller) {
      stop();
    }

    controller = null;
    generating = false;
  }

  async function send({
    text = "",
    attachments = []
  } = {}) {
    if (generating) {
      emit("neyo:chat-busy");
      return null;
    }

    const prompt = clean(text);
    const readyAttachments =
      normalizeAttachments(attachments);

    if (!prompt && !readyAttachments.length) {
      return null;
    }

    const apiContent =
      prompt ||
      "Please analyze the attached file or files.";

    const localRequestId = ++requestId;

    const userMessage = addMessage(
      "user",
      apiContent,
      {
        attachments: readyAttachments
      }
    );

    if (!userMessage) return null;

    generating = true;

    const localController =
      new AbortController();

    controller = localController;

    emit("neyo:chat-send-start", {
      requestId: localRequestId,
      text: prompt,
      attachments: readyAttachments,
      conversationId
    });

    const timeout = window.setTimeout(
      () => localController.abort(),
      CONFIG.timeoutMs
    );

    try {
      const response = await fetch(
        CONFIG.endpoint,
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Neyo-Chat-Client": VERSION
          },
          body: JSON.stringify(
            buildPayload(
              apiContent,
              readyAttachments
            )
          ),
          signal: localController.signal
        }
      );

      if (response.status === 429) {
        const data = await response
          .json()
          .catch(() => ({}));

        emit("neyo:chat-limit-reached", {
          requestId: localRequestId,
          data
        });

        return null;
      }

      const data = await readResponse(
        response
      );

      if (localRequestId !== requestId) {
        return null;
      }

      const reply = getReply(data);

      if (!reply) {
        throw new Error(
          "The AI response was empty."
        );
      }

      if (
        !preferences.privateChat &&
        typeof data?.conversationId === "string" &&
        data.conversationId.trim()
      ) {
        conversationId =
          data.conversationId.trim();
      }

      const sources = Array.isArray(
        data?.sources
      )
        ? data.sources
        : [];

      const assistantMessage =
        addMessage(
          "assistant",
          reply,
          { sources }
        );

      const result = {
        requestId: localRequestId,
        reply,
        sources,
        message: assistantMessage,
        conversationId,
        privateChat: Boolean(
          data?.privateChat
        ),
        usedUrlContext: Boolean(
          data?.usedUrlContext
        ),
        creditType:
          data?.creditType || null,
        model:
          data?.model || null
      };

      emit(
        "neyo:chat-response",
        result
      );

      if (!preferences.privateChat) {
        emit(
          "neyo:history-refresh-request",
          {
            conversationId
          }
        );
      }

      return result;

    } catch (error) {
      if (
        error?.name === "AbortError"
      ) {
        emit(
          "neyo:chat-aborted",
          {
            requestId:
              localRequestId,

            conversationId
          }
        );

        return null;
      }

      let message =
        "Something went wrong. Please try again.";

      if (error?.status === 401) {
        message =
          "Your session has expired. Please sign in again.";

      } else if (
        error?.status === 413
      ) {
        message =
          "This request is too large.";

      } else if (
        error?.status >= 500
      ) {
        message =
          "NEYO is temporarily unavailable. Please try again.";

      } else if (
        error?.message
      ) {
        message =
          error.message;
      }

      const errorMessage =
        addMessage(
          "assistant",
          `⚠️ ${message}`,
          {
            error: true
          }
        );

      emit(
        "neyo:chat-error",
        {
          requestId:
            localRequestId,

          error,

          message:
            errorMessage
        }
      );

      return null;

    } finally {
      window.clearTimeout(
        timeout
      );

      if (
        localRequestId ===
        requestId
      ) {
        generating = false;

        if (
          controller ===
          localController
        ) {
          controller = null;
        }

        emit(
          "neyo:chat-send-end",
          {
            requestId:
              localRequestId,

            conversationId
          }
        );
      }
    }
  }

  function newConversation() {
    invalidateRequest();

    conversation = [];
    conversationId = null;

    emit(
      "neyo:messages-clear"
    );

    emit(
      "neyo:chat-new",
      {
        conversation: []
      }
    );

    return true;
  }

  function loadConversation({
    conversationId: id,
    messages = []
  } = {}) {
    invalidateRequest();

    conversationId =
      clean(id, 128) ||
      null;

    conversation = Array.isArray(
      messages
    )
      ? messages
          .map(normalizeMessage)
          .filter(Boolean)
          .slice(-CONFIG.maxHistory)
      : [];

    emit(
      "neyo:messages-clear"
    );

    for (const message of conversation) {
      emit(
        "neyo:chat-message-added",
        {
          message: {
            ...message,
            attachments:
              cloneAttachments(
                message.attachments
              )
          },

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
        conversationId,
        messages:
          getConversation()
      }
    );

    return true;
  }

  function setPreferences(values) {
    if (
      !values ||
      typeof values !== "object"
    ) {
      return false;
    }

    preferences = {
      intelligence:
        "intelligence" in values
          ? clean(
              values.intelligence,
              80
            ) ||
            preferences.intelligence
          : preferences.intelligence,

      language:
        "language" in values
          ? clean(
              values.language,
              80
            ) ||
            preferences.language
          : preferences.language,

      personality:
        "personality" in values
          ? clean(
              values.personality,
              80
            ) ||
            preferences.personality
          : preferences.personality,

      privateChat:
        "privateChat" in values
          ? Boolean(
              values.privateChat
            )
          : preferences.privateChat,

      isDeepResearch:
        "isDeepResearch" in values
          ? Boolean(
              values.isDeepResearch
            )
          : preferences.isDeepResearch
    };

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

  function handleConversationLoad(
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
    "neyo:chat-send-request",
    event => {
      const detail =
        event.detail || {};

      void send({
        text:
          detail.text || "",

        attachments:
          Array.isArray(
            detail.attachments
          )
            ? detail.attachments
            : []
      });
    }
  );

  window.addEventListener(
    "neyo:chat-stop-request",
    stop
  );

  window.addEventListener(
    "neyo:chat-new-request",
    newConversation
  );

  window.addEventListener(
    "neyo:conversation-loaded",
    handleConversationLoad
  );

  window.addEventListener(
    "neyo:history-conversation-loaded",
    handleConversationLoad
  );

  window.addEventListener(
    "neyo:chat-preferences-set",
    event => {
      setPreferences(
        event.detail || {}
      );
    }
  );

  window.addEventListener(
    "neyo:chat-state-sync-request",
    () => {
      emit(
        "neyo:chat-state",
        {
          conversationId,

          messages:
            getConversation(),

          generating,

          preferences: {
            ...preferences
          }
        }
      );
    }
  );

  const api = Object.freeze({
    __controller: true,
    version: VERSION,
    active: true,
    legacyOwnerActive: false,

    send,
    stop,
    newConversation,
    loadConversation,
    addMessage,
    removeMessage,
    setPreferences,
    getConversation,

    getConversationId() {
      return conversationId;
    },

    setConversationId(id) {
      conversationId =
        clean(id, 128) ||
        null;

      return true;
    },

    getPreferences() {
      return {
        ...preferences
      };
    },

    isGenerating() {
      return generating;
    },

    getState() {
      return {
        version: VERSION,
        active: true,
        generating,
        conversationId,
        messageCount:
          conversation.length,
        requestId,
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

  emit(
    "neyo:chat-ready",
    {
      version: VERSION,
      active: true,
      legacyOwnerActive: false
    }
  );
})();
