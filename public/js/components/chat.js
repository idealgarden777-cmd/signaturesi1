/*
=========================================================
NEYO — CHAT CORE
CHATGPT-STANDARD v8

FILE:
public/js/components/chat.js

OWNS
---------------------------------------------------------
✅ Single conversation state
✅ /api/chat request
✅ Conversation ID
✅ Request lifecycle
✅ Abort / Stop
✅ Duplicate-send prevention
✅ History state sync
✅ Attachment metadata
✅ Preferences
✅ Error / limit handling
✅ Public chat events

DOES NOT OWN
---------------------------------------------------------
❌ Message DOM
❌ Markdown rendering
❌ Thinking UI
❌ Send button
❌ Enter key
❌ Attachment upload
❌ Sidebar/history rendering

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

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / DUPLICATE GUARD
     ===================================================== */

  const VERSION =
    "neyo-chat-v8-single-owner";


  if (
    window.NeyoChat
      ?.__controller === true
  ) {
    console.warn(
      "[NEYO Chat] Already initialized."
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
        5,

      requestTimeoutMs:
        180_000,

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


  let generating =
    false;


  let activeController =
    null;


  let activeRequestId =
    0;


  let preferences =
    {
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
     ID
     ===================================================== */

  function createId() {
    if (
      globalThis.crypto
        ?.randomUUID
    ) {
      return globalThis.crypto
        .randomUUID();
    }


    return (
      `msg_${Date.now()}_` +
      Math.random()
        .toString(36)
        .slice(2)
    );
  }


  /* =====================================================
     TEXT
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


  /* =====================================================
     ATTACHMENTS
     ===================================================== */

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


    return attachments
      .filter(
        attachment =>
          attachment &&
          typeof attachment ===
            "object"
      )
      .slice(
        0,
        CONFIG.maxAttachments
      )
      .map(
        attachment => {
          const mime =
            cleanText(
              attachment.mimeType ||
              attachment.mime ||
              attachment.type ||
              "application/octet-stream"
            ) ||
            "application/octet-stream";


          return {
            provider:
              cleanText(
                attachment.provider
              ) ||
              "supabase",

            bucket:
              cleanText(
                attachment.bucket
              ) ||
              "neyo-attachments",

            path:
              cleanText(
                attachment.path
              ),

            name:
              cleanText(
                attachment.name
              ) ||
              "Attached file",

            mimeType:
              mime,

            type:
              mime,

            category:
              cleanText(
                attachment.category
              ) ||
              "unknown",

            size:
              Math.max(
                0,
                Number(
                  attachment.size
                ) || 0
              )
          };
        }
      )
      .filter(
        attachment =>
          Boolean(
            attachment.path
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
      message.role !==
        "user" &&
      message.role !==
        "assistant"
    ) {
      return null;
    }


    const normalized =
      {
        id:
          cleanText(
            message.id
          ) ||
          createId(),

        role:
          message.role,

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
        [
          ...message.sources
        ];
    }


    if (
      message.error === true
    ) {
      normalized.error =
        true;
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
      message.attachments.length >
        0
    ) {
      result.attachments =
        normalizeAttachments(
          message.attachments
        );
    }


    return result;
  }


  /* =====================================================
     BOUND STATE
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
          options.error
      });


    if (
      !message
    ) {
      return null;
    }


    conversation.push(
      message
    );


    boundConversation();


    /*
    -------------------------------------------------------
    IMPORTANT:

    chat.js does NOT render DOM.

    messages.js receives this event and creates the shell.
    message-renderer.js upgrades assistant content.
    -------------------------------------------------------
    */

    emit(
      "neyo:chat-message-added",
      {
        message:
          {
            ...message
          },

        conversation:
          getConversation()
      }
    );


    return message;
  }


  /* =====================================================
     REMOVE MESSAGE
     ===================================================== */

  function removeMessage(
    id
  ) {
    const index =
      conversation.findIndex(
        message =>
          message.id ===
          id
      );


    if (
      index ===
      -1
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
        message:
          removed,

        conversation:
          getConversation()
      }
    );


    return true;
  }


  /* =====================================================
     GET CONVERSATION
     ===================================================== */

  function getConversation() {
    return conversation.map(
      message => ({
        ...message,

        attachments:
          Array.isArray(
            message.attachments
          )
            ? message.attachments.map(
                attachment => ({
                  ...attachment
                })
              )
            : undefined,

        sources:
          Array.isArray(
            message.sources
          )
            ? [
                ...message.sources
              ]
            : undefined
      })
    );
  }


  /* =====================================================
     MODEL
     ===================================================== */

  function getSelectedModel() {
    try {
      return (
        window
          .NeyoModelMenu
          ?.getSelected
          ?.() ||
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


    if (
      clean
    ) {
      return clean
        .replace(
          /\s+/g,
          " "
        )
        .slice(
          0,
          80
        );
    }


    if (
      Array.isArray(
        attachments
      ) &&
      attachments.length >
        0
    ) {
      return String(
        attachments[0]
          ?.name ||
        "New conversation"
      )
        .slice(
          0,
          80
        );
    }


    return "New conversation";
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
          preferences
            .isDeepResearch
        ),

      title:
        createTitle(
          prompt,
          attachments
        )
    };
  }


  /* =====================================================
     RESPONSE JSON
     ===================================================== */

  async function readResponse(
    response
  ) {
    const raw =
      await response
        .text();


    let data =
      {};


    if (
      raw
    ) {
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


    if (
      typeof value !==
      "string"
    ) {
      return "";
    }


    return value.trim();
  }


  /* =====================================================
     STOP
     ===================================================== */

  function stop() {
    if (
      !activeController
    ) {
      return false;
    }


    try {
      activeController.abort();


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
    attachments = []
  } = {}) {
    /*
    -------------------------------------------------------
    Never allow two parallel generations from one chat.
    -------------------------------------------------------
    */

    if (
      generating
    ) {
      emit(
        "neyo:chat-busy"
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


    /*
    -------------------------------------------------------
    Text shown to API when user sends only attachment.

    User-visible text stays clean via displayContent.
    -------------------------------------------------------
    */

    const apiContent =
      clean ||
      "Please analyze the attached file or files.";


    const displayContent =
      clean ||
      "Please analyze the attached file or files.";


    const requestId =
      ++activeRequestId;


    /*
    -------------------------------------------------------
    Add user message first.

    messages.js renders it immediately.
    -------------------------------------------------------
    */

    const userMessage =
      addMessage(
        "user",
        displayContent,
        {
          attachments:
            readyAttachments
        }
      );


    if (
      !userMessage
    ) {
      return null;
    }


    /*
    -------------------------------------------------------
    API needs actual prompt content.

    For attachment-only request these are the same.
    -------------------------------------------------------
    */

    userMessage.content =
      apiContent;


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

        text:
          clean,

        attachments:
          readyAttachments,

        conversationId:
          currentConversationId
      }
    );


    let timeout =
      null;


    try {
      timeout =
        window.setTimeout(
          () => {
            try {
              controller.abort();

            } catch {}
          },
          CONFIG.requestTimeoutMs
        );


      const payload =
        buildPayload({
          prompt:
            apiContent,

          attachments:
            readyAttachments
        });


      debug(
        "REQUEST",
        {
          requestId,

          conversationId:
            currentConversationId,

          messages:
            payload.messages.length,

          attachments:
            payload.attachments.length
        }
      );


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
      -------------------------------------------------------
      Ignore response from request invalidated by history/new
      chat.
      -------------------------------------------------------
      */

      if (
        requestId !==
        activeRequestId
      ) {
        debug(
          "STALE_RESPONSE_IGNORED",
          requestId
        );


        return null;
      }


      const reply =
        extractReply(
          data
        );


      if (
        !reply
      ) {
        throw new Error(
          "The AI response was empty."
        );
      }


      /* =================================================
         CONVERSATION ID
         ================================================= */

      if (
        !preferences.privateChat &&
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
        Array.isArray(
          data?.sources
        )
          ? data.sources
          : [];


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

          reply,

          sources,

          message:
            assistantMessage,

          conversationId:
            currentConversationId,

          privateChat:
            Boolean(
              data?.privateChat
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


      emit(
        "neyo:chat-response",
        result
      );


      /*
      -------------------------------------------------------
      History module may refresh sidebar.
      -------------------------------------------------------
      */

      if (
        !preferences.privateChat
      ) {
        emit(
          "neyo:history-load-request",
          {
            conversationId:
              currentConversationId
          }
        );
      }


      return result;

    } catch (
      error
    ) {
      /*
      -------------------------------------------------------
      STOP
      -------------------------------------------------------
      */

      if (
        error?.name ===
        "AbortError"
      ) {
        emit(
          "neyo:chat-aborted",
          {
            requestId,

            conversationId:
              currentConversationId
          }
        );


        return null;
      }


      console.error(
        "[NEYO Chat] Request failed:",
        error
      );


      /*
      -------------------------------------------------------
      Render a visible error message through messages.js.

      Prevents "nothing happened" experience.
      -------------------------------------------------------
      */

      let userFacingError =
        "Something went wrong. Please try again.";


      if (
        error?.status ===
        401
      ) {
        userFacingError =
          "Your session has expired. Please sign in again.";

      } else if (
        error?.status ===
        413
      ) {
        userFacingError =
          "This request is too large.";

      } else if (
        error?.status >=
        500
      ) {
        userFacingError =
          "NEYO is temporarily unavailable. Please try again.";

      } else if (
        error?.message
      ) {
        userFacingError =
          error.message;
      }


      const errorMessage =
        addMessage(
          "assistant",
          `⚠️ ${userFacingError}`,
          {
            error:
              true
          }
        );


      emit(
        "neyo:chat-error",
        {
          requestId,

          error,

          message:
            errorMessage
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


      /*
      -------------------------------------------------------
      Only the active request may reset generation state.
      -------------------------------------------------------
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
              currentConversationId
          }
        );
      }
    }
  }


  /* =====================================================
     NEW CONVERSATION
     ===================================================== */

  function newConversation() {
    /*
    Invalidate existing request before aborting.
    */

    activeRequestId +=
      1;


    stop();


    activeController =
      null;


    generating =
      false;


    conversation =
      [];


    currentConversationId =
      null;


    /*
    messages.js owns clearing DOM.
    */

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


  /* =====================================================
     LOAD CONVERSATION
     ===================================================== */

  function loadConversation({
    conversationId,
    messages = []
  } = {}) {
    /*
    -------------------------------------------------------
    Cancel any old generation.
    -------------------------------------------------------
    */

    activeRequestId +=
      1;


    stop();


    activeController =
      null;


    generating =
      false;


    currentConversationId =
      cleanText(
        conversationId
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
              -CONFIG.maxHistoryMessages
            )
        : [];


    /*
    -------------------------------------------------------
    Renderer pipeline owns DOM.

    Clear then emit every message in correct order.
    -------------------------------------------------------
    */

    emit(
      "neyo:messages-clear"
    );


    conversation.forEach(
      message => {
        emit(
          "neyo:chat-message-added",
          {
            message:
              {
                ...message
              },

            conversation:
              getConversation(),

            historyLoad:
              true
          }
        );
      }
    );


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
      "neyo:chat-send-end",
      {
        conversationId:
          currentConversationId
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


    preferences =
      {
        ...preferences,
        ...values
      };


    emit(
      "neyo:chat-preferences-change",
      {
        preferences:
          {
            ...preferences
          }
      }
    );


    return true;
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
    () => {
      newConversation();
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
        []
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
     STATE REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state-sync-request",
    () => {
      emit(
        "neyo:chat-state",
        {
          conversationId:
            currentConversationId,

          messages:
            getConversation(),

          generating,

          preferences:
            {
              ...preferences
            }
        }
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

      removeMessage,

      setPreferences,

      getConversation,

      getConversationId:
        () =>
          currentConversationId,

      setConversationId(
        id
      ) {
        currentConversationId =
          cleanText(
            id
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

          generating,

          conversationId:
            currentConversationId,

          messageCount:
            conversation.length,

          requestId:
            activeRequestId,

          preferences:
            {
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
     READY
     ===================================================== */

  debug(
    "READY",
    {
      version:
        VERSION,

      domRendering:
        false,

      singleConversationState:
        true,

      duplicateSendProtection:
        true,

      neoJsTouched:
        false
    }
  );


  emit(
    "neyo:chat-ready",
    {
      version:
        VERSION
    }
  );

})();
