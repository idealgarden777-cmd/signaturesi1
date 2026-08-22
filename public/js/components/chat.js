(() => {
  "use strict";

  const VERSION = "neyo-chat-recovery-v1";
  if (window.NeyoChat?.__controller) return;

  const CFG = Object.freeze({
    endpoint: "/api/chat",
    maxHistory: 50,
    maxAttachments: 5,
    timeoutMs: 180_000
  });

  /* neo.js present = legacy chat remains sole owner. */
  const neoScript = Array.from(document.scripts || []).some(script =>
    /(?:^|\/)neo\.js(?:\?|$)/.test(script.src || "")
  );

  const active = !neoScript;

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

  /* =====================================================
     HELPERS
     ===================================================== */

  const emit = (name, detail = {}) =>
    window.dispatchEvent(
      new CustomEvent(name, { detail })
    );

  const clean = (value, max = 50_000) =>
    String(value ?? "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .trim()
      .slice(0, max);

  const makeId = () =>
    globalThis.crypto?.randomUUID?.() ||
    `msg_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;

  /* =====================================================
     ATTACHMENTS
     ===================================================== */

  function normalizeAttachments(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    const seen = new Set();

    return value
      .filter(
        item =>
          item &&
          typeof item === "object"
      )
      .slice(
        0,
        CFG.maxAttachments
      )
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
          id:
            clean(
              item.id,
              128
            ) ||
            null,

          uploadId:
            clean(
              item.uploadId,
              128
            ) ||
            null,

          provider:
            clean(
              item.provider,
              40
            ) ||
            "supabase",

          bucket:
            clean(
              item.bucket,
              100
            ) ||
            "neyo-attachments",

          path:
            clean(
              item.path,
              1024
            ),

          name:
            clean(
              item.name,
              220
            ) ||
            "Attached file",

          mime,
          mimeType:
            mime,
          type:
            mime,

          extension:
            clean(
              item.extension,
              24
            )
              .replace(
                /^\./,
                ""
              )
              .toLowerCase(),

          category:
            clean(
              item.category,
              32
            )
              .toLowerCase() ||
            "unknown",

          size:
            Math.max(
              0,
              Number(
                item.size
              ) ||
              0
            )
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

        const key =
          `${item.bucket}:${item.path}`;

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);

        return true;
      });
  }

  /* =====================================================
     MESSAGES
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
      ) &&
      message.sources.length
    ) {
      normalized.sources =
        message.sources.map(
          source => ({
            ...source
          })
        );
    }

    if (
      message.error === true
    ) {
      normalized.error =
        true;
    }

    return normalized;
  }

  function toApiMessage(message) {
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

  function getConversation() {
    return conversation.map(
      message => ({
        ...message,

        attachments:
          Array.isArray(
            message.attachments
          )
            ? message.attachments.map(
                item => ({
                  ...item
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
      })
    );
  }

  function bound() {
    if (
      conversation.length >
      CFG.maxHistory
    ) {
      conversation =
        conversation.slice(
          -CFG.maxHistory
        );
    }
  }

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

        attachments:
          options.attachments,

        sources:
          options.sources,

        error:
          options.error
      });

    if (!message) {
      return null;
    }

    conversation.push(
      message
    );

    bound();

    emit(
      "neyo:chat-message-added",
      {
        message: {
          ...message
        },

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

  function removeMessage(id) {
    const index =
      conversation.findIndex(
        item =>
          item.id === id
      );

    if (
      index < 0
    ) {
      return false;
    }

    const [
      message
    ] =
      conversation.splice(
        index,
        1
      );

    emit(
      "neyo:chat-message-removed",
      {
        message,

        conversation:
          getConversation()
      }
    );

    return true;
  }

  /* =====================================================
     MODEL / ATTACHMENTS
     ===================================================== */

  function selectedModel() {
    try {
      return (
        window.NeyoModelMenu
          ?.getSelected
          ?.() ||

        window.NeyoModelMenu
          ?.getValue
          ?.() ||

        "l1.0"
      );

    } catch {
      return "l1.0";
    }
  }

  function readyAttachments(
    explicit
  ) {
    if (
      Array.isArray(
        explicit
      )
    ) {
      return normalizeAttachments(
        explicit
      );
    }

    try {
      return normalizeAttachments(
        window.NeyoAttachments
          ?.getReady
          ?.() ||
        []
      );

    } catch {
      return [];
    }
  }

  function titleFor(
    text,
    attachments
  ) {
    const value =
      clean(
        text,
        1000
      )
        .replace(
          /\s+/g,
          " "
        );

    if (value) {
      return value.slice(
        0,
        80
      );
    }

    return (
      clean(
        attachments?.[0]?.name ||
        "New conversation",
        80
      ) ||
      "New conversation"
    );
  }

  /* =====================================================
     PAYLOAD
     ===================================================== */

  function payloadFor(
    prompt,
    attachments
  ) {
    const privateChat =
      Boolean(
        preferences.privateChat
      );

    return {
      messages:
        conversation
          .filter(
            message =>
              message.error !==
              true
          )
          .slice(
            -CFG.maxHistory
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
          : conversationId,

      model:
        selectedModel(),

      intelligence:
        clean(
          preferences.intelligence,
          80
        ) ||
        "standard",

      language:
        clean(
          preferences.language,
          80
        ) ||
        "auto",

      personality:
        clean(
          preferences.personality,
          80
        ) ||
        "neyo",

      privateChat,

      isDeepResearch:
        Boolean(
          preferences
            .isDeepResearch
        ),

      title:
        titleFor(
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

    let data =
      {};

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
            data?.error ||
            data?.message ||
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

  function replyFrom(data) {
    const value =
      data?.reply ??

      data
        ?.choices
        ?.[0]
        ?.message
        ?.content ??

      data
        ?.message
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

  function stop() {
    if (
      !active ||
      !controller
    ) {
      return false;
    }

    try {
      controller.abort();

      return true;

    } catch {
      return false;
    }
  }

  /* =====================================================
     SEND
     ===================================================== */

  async function send({
    text = "",
    attachments
  } = {}) {

    /*
     * neo.js remains sole owner while loaded.
     */

    if (!active) {
      emit(
        "neyo:chat-passive",
        {
          reason:
            "neo.js owns chat runtime"
        }
      );

      return null;
    }

    /*
     * No duplicate generation.
     */

    if (generating) {
      emit(
        "neyo:chat-busy"
      );

      return null;
    }

    const prompt =
      clean(
        text
      );

    const ready =
      readyAttachments(
        attachments
      );

    if (
      !prompt &&
      !ready.length
    ) {
      return null;
    }

    const content =
      prompt ||
      "Please analyze the attached file or files.";

    const localRequestId =
      ++requestId;

    const userMessage =
      addMessage(
        "user",
        content,
        {
          attachments:
            ready
        }
      );

    if (!userMessage) {
      return null;
    }

    generating =
      true;

    const localController =
      new AbortController();

    controller =
      localController;

    emit(
      "neyo:chat-send-start",
      {
        requestId:
          localRequestId,

        text:
          prompt,

        attachments:
          ready,

        conversationId
      }
    );

    const timer =
      window.setTimeout(
        () =>
          localController.abort(),
        CFG.timeoutMs
      );

    try {
      const response =
        await fetch(
          CFG.endpoint,
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
                payloadFor(
                  content,
                  ready
                )
              ),

            signal:
              localController.signal
          }
        );

      /*
       * Real account/message limit only.
       */

      if (
        response.status ===
        429
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
            requestId:
              localRequestId,

            data
          }
        );

        return null;
      }

      const data =
        await readResponse(
          response
        );

      /*
       * Ignore stale response after
       * new-chat/history navigation.
       */

      if (
        localRequestId !==
        requestId
      ) {
        return null;
      }

      const reply =
        replyFrom(
          data
        );

      if (!reply) {
        throw new Error(
          "The AI response was empty."
        );
      }

      if (
        !preferences.privateChat &&
        typeof data?.conversationId ===
          "string" &&
        data.conversationId.trim()
      ) {
        conversationId =
          data.conversationId
            .trim();
      }

      const sources =
        Array.isArray(
          data?.sources
        )
          ? data.sources
          : [];

      const assistantMessage =
        addMessage(
          "assistant",
          reply,
          {
            sources
          }
        );

      const result = {
        requestId:
          localRequestId,

        reply,

        sources,

        message:
          assistantMessage,

        conversationId,

        privateChat:
          Boolean(
            data?.privateChat
          ),

        usedUrlContext:
          Boolean(
            data?.usedUrlContext
          ),

        creditType:
          data?.creditType ||
          null,

        model:
          data?.model ||
          null
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
            conversationId
          }
        );
      }

      return result;

    } catch (
      error
    ) {

      /*
       * User pressed Stop.
       */

      if (
        error?.name ===
        "AbortError"
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

      if (
        error?.status ===
        401
      ) {
        message =
          "Your session has expired. Please sign in again.";

      } else if (
        error?.status ===
        413
      ) {
        message =
          "This request is too large.";

      } else if (
        error?.status >=
        500
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
            error:
              true
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
        timer
      );

      if (
        localRequestId ===
        requestId
      ) {
        generating =
          false;

        if (
          controller ===
          localController
        ) {
          controller =
            null;
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

  /* =====================================================
     CONVERSATION LIFECYCLE
     ===================================================== */

  function invalidateGeneration() {
    requestId +=
      1;

    if (active) {
      stop();
    }

    controller =
      null;

    generating =
      false;
  }

  function newConversation() {
    if (!active) {
      return false;
    }

    invalidateGeneration();

    conversation =
      [];

    conversationId =
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

    emit(
      "neyo:chat-send-end",
      {
        conversationId:
          null
      }
    );

    return true;
  }

  function loadConversation({
    conversationId: id,
    messages = []
  } = {}) {

    if (!active) {
      return false;
    }

    invalidateGeneration();

    conversationId =
      clean(
        id,
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
            .filter(
              Boolean
            )
            .slice(
              -CFG.maxHistory
            )
        : [];

    emit(
      "neyo:messages-clear"
    );

    conversation.forEach(
      message =>
        emit(
          "neyo:chat-message-added",
          {
            message: {
              ...message
            },

            conversation:
              getConversation(),

            historyLoad:
              true
          }
        )
    );

    emit(
      "neyo:chat-state-loaded",
      {
        conversationId,

        messages:
          getConversation()
      }
    );

    emit(
      "neyo:chat-send-end",
      {
        conversationId
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
      "intelligence" in
      values
    ) {
      next.intelligence =
        clean(
          values.intelligence,
          80
        ) ||
        next.intelligence;
    }

    if (
      "language" in
      values
    ) {
      next.language =
        clean(
          values.language,
          80
        ) ||
        next.language;
    }

    if (
      "personality" in
      values
    ) {
      next.personality =
        clean(
          values.personality,
          80
        ) ||
        next.personality;
    }

    if (
      "privateChat" in
      values
    ) {
      next.privateChat =
        Boolean(
          values.privateChat
        );
    }

    if (
      "isDeepResearch" in
      values
    ) {
      next.isDeepResearch =
        Boolean(
          values.isDeepResearch
        );
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
     EVENTS

     Only active after neo.js is removed.
     ===================================================== */

  if (active) {

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
            Array.isArray(
              detail.attachments
            )
              ? detail.attachments
              : undefined
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

    const historyLoad =
      event => {
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
      };

    window.addEventListener(
      "neyo:conversation-loaded",
      historyLoad
    );

    window.addEventListener(
      "neyo:history-conversation-loaded",
      historyLoad
    );

    window.addEventListener(
      "neyo:chat-preferences-set",
      event =>
        setPreferences(
          event.detail ||
          {}
        )
    );

    window.addEventListener(
      "neyo:chat-state-sync-request",
      () =>
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
        )
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

      active,

      legacyOwnerActive:
        !active,

      send,
      stop,
      newConversation,
      loadConversation,
      addMessage,
      removeMessage,
      setPreferences,
      getConversation,

      getConversationId:
        () =>
          conversationId,

      setConversationId(id) {
        if (!active) {
          return false;
        }

        conversationId =
          clean(
            id,
            128
          ) ||
          null;

        return true;
      },

      getPreferences:
        () => ({
          ...preferences
        }),

      isGenerating:
        () =>
          generating,

      getState:
        () => ({
          version:
            VERSION,

          active,

          legacyOwnerActive:
            !active,

          generating,

          conversationId,

          messageCount:
            conversation.length,

          requestId,

          preferences: {
            ...preferences
          }
        })
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

  emit(
    "neyo:chat-ready",
    {
      version:
        VERSION,

      active,

      legacyOwnerActive:
        !active
    }
  );
})();
