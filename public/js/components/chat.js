/*
=========================================================
NEYO — CHAT CORE
FINAL v4 — ATTACHMENT SAFE / CONFLICT FREE

FILE:
public/js/components/chat.js

OWNS
---------------------------------------------------------
✅ Conversation state
✅ /api/chat transport
✅ Conversation ID
✅ Attachment metadata transport
✅ Abort / stop generation
✅ API response parsing
✅ Usage / limit lifecycle events
✅ History synchronization events
✅ Preferences used by chat API

DOES NOT OWN
---------------------------------------------------------
❌ #sendBtn
❌ #chatInput key handling
❌ Attachment upload
❌ File picker
❌ Attachment chip UI
❌ Voice
❌ Mascot
❌ Character picker
❌ neo.js
❌ History DOM
❌ Composer DOM

INTEGRATION
---------------------------------------------------------
attachments.js
    ↓
window.NeyoAttachments

send-state.js
    ↓
neyo:chat-send-request

chat.js
    ↓
POST /api/chat
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / DUPLICATE GUARD
     ===================================================== */

  const VERSION =
    "neyo-chat-final-v4";


  if (
    window.NeyoChat?.__controller ===
    true
  ) {
    console.warn(
      "[NEYO Chat] Controller already initialized."
    );

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
        10,

      attachmentBucket:
        "neyo-attachments",

      requestTimeoutMs:
        95_000,

      fallbackAttachmentPrompt:
        "Please analyze the attached file or files.",

      maxTitleCharacters:
        80,

      debug:
        true
    });


  /* =====================================================
     STATE
     ===================================================== */

  let conversation =
    [];


  let currentConversationId =
    null;


  let isGenerating =
    false;


  let abortController =
    null;


  let requestTimeout =
    null;


  let activeRequestId =
    null;


  /* =====================================================
     PREFERENCES
     ===================================================== */

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
     DEBUG
     ===================================================== */

  function debug(
    ...args
  ) {
    if (
      !CONFIG.debug
    ) {
      return;
    }


    console.log(
      "[NEYO Chat]",
      ...args
    );
  }


  /* =====================================================
     EVENTS
     ===================================================== */

  function emit(
    name,
    detail =
      {}
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
     GENERAL HELPERS
     ===================================================== */

  function cleanText(
    value
  ) {
    if (
      typeof value !==
      "string"
    ) {
      return "";
    }


    return value
      .replace(
        /\r\n?/g,
        "\n"
      )
      .replace(
        /\u0000/g,
        ""
      )
      .trim();
  }


  function cleanString(
    value,
    maxLength =
      512
  ) {
    return String(
      value ??
      ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .trim()
      .slice(
        0,
        maxLength
      );
  }


  function createId() {
    if (
      globalThis.crypto
        ?.randomUUID
    ) {
      return globalThis
        .crypto
        .randomUUID();
    }


    return (
      `chat_${Date.now()}_` +
      Math.random()
        .toString(36)
        .slice(2)
    );
  }


  /* =====================================================
     ERROR NORMALIZATION
     ===================================================== */

  function createApiError(
    response,
    data,
    raw
  ) {
    const message =
      cleanString(
        data?.error ||
        data?.message ||
        raw ||
        `Request failed (${response.status}).`,
        2000
      );


    const error =
      new Error(
        message ||
        "Chat request failed."
      );


    error.status =
      response.status;


    error.code =
      data?.code ||
      null;


    error.details =
      data?.details ||
      null;


    error.hint =
      data?.hint ||
      null;


    error.data =
      data ||
      null;


    return error;
  }


  /* =====================================================
     RESPONSE READER
     ===================================================== */

  async function readApiResponse(
    response
  ) {
    const raw =
      await response.text();


    let data =
      null;


    if (raw) {
      try {
        data =
          JSON.parse(
            raw
          );
      } catch {}
    }


    if (
      !response.ok
    ) {
      throw createApiError(
        response,
        data,
        raw
      );
    }


    if (
      !data ||
      typeof data !==
        "object"
    ) {
      throw new Error(
        "Chat API returned an invalid response."
      );
    }


    return data;
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
        selected
      ) {
        return selected;
      }
    } catch {}


    /*
     * Backend still decides the actual provider model
     * according to the user's plan.
     */

    return "l1.0";
  }


  /* =====================================================
     TITLE
     ===================================================== */

  function makeConversationTitle(
    text,
    attachments =
      []
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
          CONFIG
            .maxTitleCharacters
        );
    }


    if (
      Array.isArray(
        attachments
      ) &&
      attachments.length >
        0
    ) {
      return cleanString(
        attachments[0]
          ?.name ||
        "New conversation",
        CONFIG
          .maxTitleCharacters
      );
    }


    return (
      "New conversation"
    );
  }


  /* =====================================================
     ATTACHMENT NORMALIZATION

     IMPORTANT:
     Never send:
     - raw File
     - document.text
     - chunks
     - preview blobs

     api/chat.js receives secure storage metadata only.
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


    const uploadId =
      cleanString(
        attachment.uploadId,
        128
      );


    const path =
      cleanString(
        attachment.path,
        1024
      );


    const name =
      cleanString(
        attachment.name ||
        "Attached file",
        220
      );


    const bucket =
      cleanString(
        attachment.bucket ||
        CONFIG
          .attachmentBucket,
        128
      );


    const mime =
      cleanString(
        attachment.mime ||
        attachment.mimeType ||
        attachment.type ||
        "application/octet-stream",
        180
      );


    const extension =
      cleanString(
        attachment.extension,
        32
      )
        .replace(
          /^\./,
          ""
        )
        .toLowerCase();


    const category =
      cleanString(
        attachment.category ||
        "unknown",
        40
      )
        .toLowerCase();


    const size =
      Number(
        attachment.size
      ) ||
      0;


    /*
     * Ready attachments must have
     * an upload ID + private storage path.
     */

    if (
      !uploadId ||
      !path
    ) {
      return null;
    }


    return {
      id:
        cleanString(
          attachment.id,
          128
        ) ||
        null,

      uploadId,

      bucket,

      path,

      name,

      mime,

      mimeType:
        mime,

      extension,

      category,

      size
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


    const output =
      [];


    const seen =
      new Set();


    for (
      const attachment
      of attachments
    ) {
      if (
        output.length >=
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
        `${normalized.uploadId}:${normalized.path}`;


      if (
        seen.has(
          key
        )
      ) {
        continue;
      }


      seen.add(
        key
      );


      output.push(
        normalized
      );
    }


    return output;
  }


  /* =====================================================
     ATTACHMENT CONTROLLER ACCESS
     ===================================================== */

  function getAttachmentController() {
    const controller =
      window.NeyoAttachments;


    if (
      controller &&
      typeof controller ===
        "object"
    ) {
      return controller;
    }


    return null;
  }


  function getReadyAttachments() {
    const controller =
      getAttachmentController();


    if (
      !controller
        ?.getReady
    ) {
      return [];
    }


    try {
      return normalizeAttachments(
        controller.getReady()
      );
    } catch (
      error
    ) {
      console.warn(
        "[NEYO Chat] Could not read attachment state:",
        error
      );


      return [];
    }
  }


  function attachmentsPending() {
    const controller =
      getAttachmentController();


    try {
      return Boolean(
        controller
          ?.hasPending
          ?.()
      );
    } catch {
      return false;
    }
  }


  function attachmentsHaveErrors() {
    const controller =
      getAttachmentController();


    try {
      return Boolean(
        controller
          ?.hasErrors
          ?.()
      );
    } catch {
      return false;
    }
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
      message.role !==
        "user" &&
      message.role !==
        "assistant"
    ) {
      return null;
    }


    const content =
      cleanText(
        message.content
      );


    if (!content) {
      return null;
    }


    const normalized = {
      role:
        message.role,

      content
    };


    const attachments =
      normalizeAttachments(
        message.attachments
      );


    if (
      attachments.length >
      0
    ) {
      normalized.attachments =
        attachments;
    }


    if (
      Array.isArray(
        message.sources
      ) &&
      message.sources.length >
        0
    ) {
      normalized.sources =
        message.sources;
    }


    return normalized;
  }


  /* =====================================================
     CONVERSATION STATE
     ===================================================== */

  function trimConversation() {
    if (
      conversation.length >
      CONFIG
        .maxHistoryMessages
    ) {
      conversation =
        conversation.slice(
          -CONFIG
            .maxHistoryMessages
        );
    }
  }


  function addMessage(
    role,
    content,
    options =
      {}
  ) {
    const message =
      normalizeMessage({
        role,

        content,

        attachments:
          options.attachments,

        sources:
          options.sources
      });


    if (!message) {
      return null;
    }


    conversation.push(
      message
    );


    trimConversation();


    emit(
      "neyo:chat-message-added",
      {
        message: {
          ...message
        },

        conversation:
          conversation.map(
            item => ({
              ...item
            })
          )
      }
    );


    return message;
  }


  function removeLastUserMessage() {
    const last =
      conversation[
        conversation.length -
        1
      ];


    if (
      last?.role !==
      "user"
    ) {
      return null;
    }


    const removed =
      conversation.pop();


    emit(
      "neyo:chat-message-rolled-back",
      {
        message:
          removed || null
      }
    );


    return removed;
  }


  /* =====================================================
     BUILD REQUEST PAYLOAD
     ===================================================== */

  function buildPayload(
    userText,
    attachments
  ) {
    const privateChat =
      Boolean(
        preferences.privateChat
      );


    return {
      messages:
        conversation.map(
          message => ({
            ...message
          })
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

      privateChat,

      language:
        preferences
          .language,

      personality:
        preferences
          .personality,

      isDeepResearch:
        Boolean(
          preferences
            .isDeepResearch
        ),

      title:
        makeConversationTitle(
          userText,
          attachments
        )
    };
  }


  /* =====================================================
     ATTACHMENT RESOLUTION FOR SEND
     ===================================================== */

  function resolveSendAttachments(
    suppliedAttachments
  ) {
    /*
     * send-state.js normally supplies attachments.
     *
     * Defensive fallback:
     * if it does not, read ready attachments directly
     * from NeyoAttachments.
     */

    const supplied =
      normalizeAttachments(
        suppliedAttachments
      );


    if (
      supplied.length >
      0
    ) {
      return supplied;
    }


    return getReadyAttachments();
  }


  /* =====================================================
     REQUEST TIMER
     ===================================================== */

  function clearRequestTimer() {
    if (
      requestTimeout
    ) {
      window.clearTimeout(
        requestTimeout
      );


      requestTimeout =
        null;
    }
  }


  /* =====================================================
     SEND
     ===================================================== */

  async function send({
    text =
      "",

    attachments =
      []
  } = {}) {

    /* -------------------------------------------------
       BUSY
       ------------------------------------------------- */

    if (
      isGenerating
    ) {
      emit(
        "neyo:chat-busy",
        {
          conversationId:
            currentConversationId
        }
      );


      return null;
    }


    /* -------------------------------------------------
       DO NOT SEND WHILE FILE IS UPLOADING
       ------------------------------------------------- */

    if (
      attachmentsPending()
    ) {
      emit(
        "neyo:chat-attachments-pending",
        {
          message:
            "Please wait for attachments to finish processing."
        }
      );


      return null;
    }


    /*
     * Failed attachment should be retried or removed.
     * Prevent silently ignoring it.
     */

    if (
      attachmentsHaveErrors()
    ) {
      emit(
        "neyo:chat-attachments-error",
        {
          message:
            "Retry or remove failed attachments before sending."
        }
      );


      return null;
    }


    /* -------------------------------------------------
       INPUT
       ------------------------------------------------- */

    const clean =
      cleanText(
        text
      );


    const normalizedAttachments =
      resolveSendAttachments(
        attachments
      );


    if (
      !clean &&
      normalizedAttachments.length ===
        0
    ) {
      return null;
    }


    const apiContent =
      clean ||
      CONFIG
        .fallbackAttachmentPrompt;


    /* -------------------------------------------------
       LOCAL USER MESSAGE
       ------------------------------------------------- */

    const addedUserMessage =
      addMessage(
        "user",
        apiContent,
        {
          attachments:
            normalizedAttachments
        }
      );


    if (
      !addedUserMessage
    ) {
      return null;
    }


    /* -------------------------------------------------
       REQUEST STATE
       ------------------------------------------------- */

    isGenerating =
      true;


    activeRequestId =
      createId();


    abortController =
      new AbortController();


    const requestId =
      activeRequestId;


    emit(
      "neyo:chat-send-start",
      {
        requestId,

        text:
          clean,

        content:
          apiContent,

        attachments:
          normalizedAttachments,

        conversationId:
          currentConversationId
      }
    );


    /* -------------------------------------------------
       TIMEOUT
       ------------------------------------------------- */

    clearRequestTimer();


    requestTimeout =
      window.setTimeout(
        () => {
          try {
            abortController
              ?.abort(
                new DOMException(
                  "Chat request timed out.",
                  "TimeoutError"
                )
              );
          } catch {
            abortController
              ?.abort();
          }
        },
        CONFIG
          .requestTimeoutMs
      );


    try {
      /* -------------------------------------------------
         PAYLOAD
         ------------------------------------------------- */

      const payload =
        buildPayload(
          apiContent,
          normalizedAttachments
        );


      debug(
        "request",
        {
          requestId,

          messages:
            payload
              .messages
              .length,

          attachments:
            payload
              .attachments
              .length,

          conversationId:
            payload
              .conversationId,

          privateChat:
            payload
              .privateChat,

          deepResearch:
            payload
              .isDeepResearch
        }
      );


      /* -------------------------------------------------
         FETCH
         ------------------------------------------------- */

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
              abortController
                .signal
          }
        );


      /* -------------------------------------------------
         LIMIT
         ------------------------------------------------- */

      if (
        response.status ===
        429
      ) {
        const raw =
          await response.text();


        let data =
          {};


        try {
          data =
            raw
              ? JSON.parse(
                  raw
                )
              : {};
        } catch {}


        removeLastUserMessage();


        emit(
          "neyo:chat-limit-reached",
          {
            requestId,

            data,

            status:
              429,

            message:
              data?.error ||
              data?.message ||
              "Usage limit reached."
          }
        );


        return null;
      }


      /* -------------------------------------------------
         RESPONSE
         ------------------------------------------------- */

      const data =
        await readApiResponse(
          response
        );


      /* -------------------------------------------------
         REPLY EXTRACTION
         ------------------------------------------------- */

      const replyValue =
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


      const reply =
        typeof replyValue ===
          "string"
            ? replyValue
                .trim()
            : "";


      if (!reply) {
        throw new Error(
          "The AI response was empty."
        );
      }


      /* -------------------------------------------------
         CONVERSATION ID
         ------------------------------------------------- */

      if (
        !preferences
          .privateChat &&
        typeof data
          ?.conversationId ===
          "string" &&
        data
          .conversationId
          .trim()
      ) {
        currentConversationId =
          data
            .conversationId
            .trim();
      }


      /* -------------------------------------------------
         SOURCES
         ------------------------------------------------- */

      const sources =
        Array.isArray(
          data?.sources
        )
          ? data.sources
          : [];


      /* -------------------------------------------------
         ASSISTANT MESSAGE
         ------------------------------------------------- */

      addMessage(
        "assistant",
        reply,
        {
          sources
        }
      );


      /* -------------------------------------------------
         RESULT
         ------------------------------------------------- */

      const result = {
        requestId,

        reply,

        sources,

        conversationId:
          currentConversationId,

        plan:
          data?.plan ||
          null,

        usage:
          data?.usage ||
          null,

        attachments:
          data?.attachments ||
          {
            count:
              normalizedAttachments
                .length
          },

        privateChat:
          Boolean(
            data?.privateChat ||
            preferences
              .privateChat
          ),

        research:
          data?.research ||
          null,

        grounded:
          Boolean(
            data
              ?.research
              ?.grounded
          ),

        usedUrlContext:
          Boolean(
            data
              ?.usedUrlContext
          ),

        creditType:
          data?.creditType ||
          null
      };


      /* -------------------------------------------------
         SUCCESS EVENT
         ------------------------------------------------- */

      emit(
        "neyo:chat-response",
        result
      );


      /*
       * Clear attachment chips ONLY AFTER
       * successful AI response.
       *
       * attachments.js listens for this event.
       */

      if (
        normalizedAttachments.length >
        0
      ) {
        emit(
          "neyo:attachments-clear-request",
          {
            reason:
              "chat-success",

            requestId
          }
        );
      }


      /*
       * Ask existing history controller to refresh.
       */

      if (
        !preferences
          .privateChat
      ) {
        emit(
          "neyo:history-load-request",
          {
            conversationId:
              currentConversationId
          }
        );
      }


      debug(
        "response",
        {
          requestId,

          conversationId:
            currentConversationId,

          attachmentCount:
            normalizedAttachments
              .length,

          replyCharacters:
            reply.length
        }
      );


      return result;


    } catch (
      error
    ) {
      /* -------------------------------------------------
         ABORT / STOP
         ------------------------------------------------- */

      if (
        error?.name ===
          "AbortError" ||
        error?.name ===
          "TimeoutError"
      ) {
        removeLastUserMessage();


        emit(
          "neyo:chat-aborted",
          {
            requestId,

            timeout:
              error?.name ===
              "TimeoutError"
          }
        );


        return null;
      }


      /* -------------------------------------------------
         NORMAL ERROR

         Roll back the unsatisfied user turn from local
         API context so retry does not duplicate it.
         ------------------------------------------------- */

      removeLastUserMessage();


      console.error(
        "[NEYO Chat] Request failed:",
        {
          message:
            error?.message,

          status:
            error?.status,

          code:
            error?.code,

          details:
            error?.details,

          hint:
            error?.hint
        }
      );


      emit(
        "neyo:chat-error",
        {
          requestId,

          error,

          message:
            error?.message ||
            "Unable to generate a response.",

          status:
            error?.status ||
            null,

          code:
            error?.code ||
            null,

          data:
            error?.data ||
            null
        }
      );


      throw error;


    } finally {
      clearRequestTimer();


      /*
       * Don't let an older request reset a newer one.
       */

      if (
        activeRequestId ===
        requestId
      ) {
        isGenerating =
          false;


        abortController =
          null;


        activeRequestId =
          null;
      }


      emit(
        "neyo:chat-send-end",
        {
          requestId,

          conversationId:
            currentConversationId
        }
      );
    }
  }


  /* =====================================================
     STOP
     ===================================================== */

  function stop() {
    if (
      !abortController
    ) {
      return false;
    }


    try {
      abortController
        .abort();
    } catch {
      return false;
    }


    return true;
  }


  /* =====================================================
     NEW CONVERSATION
     ===================================================== */

  function newConversation() {
    stop();


    conversation =
      [];


    currentConversationId =
      null;


    /*
     * New conversation should not retain
     * attachments from previous draft.
     */

    emit(
      "neyo:attachments-clear-request",
      {
        reason:
          "new-conversation"
      }
    );


    emit(
      "neyo:chat-new",
      {
        conversation:
          [],

        conversationId:
          null
      }
    );


    return true;
  }


  /* =====================================================
     LOAD EXISTING CONVERSATION
     ===================================================== */

  function loadConversation({
    conversationId,
    messages =
      []
  } = {}) {
    /*
     * Don't allow an in-flight request from
     * old conversation to mutate the new one.
     */

    stop();


    currentConversationId =
      cleanString(
        conversationId,
        128
      ) ||
      null;


    const normalized =
      [];


    if (
      Array.isArray(
        messages
      )
    ) {
      for (
        const message
        of messages
      ) {
        const item =
          normalizeMessage(
            message
          );


        if (item) {
          normalized.push(
            item
          );
        }
      }
    }


    conversation =
      normalized.slice(
        -CONFIG
          .maxHistoryMessages
      );


    emit(
      "neyo:chat-state-loaded",
      {
        conversationId:
          currentConversationId,

        messages:
          conversation.map(
            item => ({
              ...item
            })
          )
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
        values
          .intelligence;
    }


    if (
      typeof values
        .language ===
      "string"
    ) {
      next.language =
        values
          .language;
    }


    if (
      typeof values
        .personality ===
      "string"
    ) {
      next.personality =
        values
          .personality;
    }


    if (
      typeof values
        .privateChat ===
      "boolean"
    ) {
      next.privateChat =
        values
          .privateChat;
    }


    if (
      typeof values
        .isDeepResearch ===
      "boolean"
    ) {
      next.isDeepResearch =
        values
          .isDeepResearch;
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
     DEEP RESEARCH SYNC

     Existing UI may emit either event form.
     ===================================================== */

  window.addEventListener(
    "neyo:deep-research-change",
    event => {
      const enabled =
        event.detail
          ?.enabled;


      if (
        typeof enabled ===
        "boolean"
      ) {
        setPreferences({
          isDeepResearch:
            enabled
        });
      }
    }
  );


  window.addEventListener(
    "neyo:deep-research-toggle",
    event => {
      const enabled =
        event.detail
          ?.enabled;


      if (
        typeof enabled ===
        "boolean"
      ) {
        setPreferences({
          isDeepResearch:
            enabled
        });
      }
    }
  );


  /* =====================================================
     HISTORY CONNECTION

     Supports both possible event names so existing
     history behavior isn't broken.
     ===================================================== */

  function handleConversationLoaded(
    event
  ) {
    loadConversation({
      conversationId:
        event.detail
          ?.conversationId ||
        event.detail
          ?.id,

      messages:
        event.detail
          ?.messages ||
        []
    });
  }


  window.addEventListener(
    "neyo:conversation-loaded",
    handleConversationLoaded
  );


  window.addEventListener(
    "neyo:chat-load",
    handleConversationLoaded
  );


  /* =====================================================
     PUBLIC SEND EVENT

     IMPORTANT:
     chat.js does NOT listen directly to #sendBtn.
     send-state.js dispatches this event.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-request",
    event => {
      const detail =
        event.detail ||
        {};


      send({
        text:
          detail.text ||
          detail.content ||
          "",

        attachments:
          detail.attachments ||
          []
      })
        .catch(
          error => {
            /*
             * Lifecycle event already emitted.
             * Keep this catch to prevent
             * unhandled Promise rejection.
             */

            debug(
              "Send rejected:",
              error?.message
            );
          }
        );
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

     This event is intentionally specific.
     We don't bind #newChatBtn here because neo.js/history
     may already own that UI control.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new-request",
    () => {
      newConversation();
    }
  );


  /* =====================================================
     PREFERENCES EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-preferences-set",
    event => {
      setPreferences(
        event.detail
      );
    }
  );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  const publicApi =
    Object.freeze({
      __controller:
        true,

      version:
        VERSION,

      send,

      stop,

      newConversation,

      loadConversation,

      addMessage,

      setPreferences,

      getPreferences:
        () => ({
          ...preferences
        }),

      getConversation:
        () =>
          conversation.map(
            message => ({
              ...message,

              attachments:
                Array.isArray(
                  message.attachments
                )
                  ? message
                      .attachments
                      .map(
                        attachment => ({
                          ...attachment
                        })
                      )
                  : undefined
            })
          ),

      getConversationId:
        () =>
          currentConversationId,

      setConversationId:
        id => {
          currentConversationId =
            cleanString(
              id,
              128
            ) ||
            null;


          return (
            currentConversationId
          );
        },

      isGenerating:
        () =>
          isGenerating,

      getState:
        () => ({
          version:
            VERSION,

          conversationId:
            currentConversationId,

          messageCount:
            conversation.length,

          generating:
            isGenerating,

          requestId:
            activeRequestId,

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
        publicApi,

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

  emit(
    "neyo:chat-ready",
    {
      version:
        VERSION
    }
  );


  debug(
    "FINAL v4 READY",
    {
      version:
        VERSION,

      endpoint:
        CONFIG.endpoint,

      attachmentBucket:
        CONFIG
          .attachmentBucket,

      maxAttachments:
        CONFIG
          .maxAttachments,

      attachmentsController:
        Boolean(
          window
            .NeyoAttachments
        )
    }
  );

})();
