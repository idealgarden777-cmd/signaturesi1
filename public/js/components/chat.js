/*
=========================================================
NEYO — CHAT CORE
FINAL CLEAN v1

FILE:
public/js/components/chat.js

OWNS
---------------------------------------------------------
- Conversation state
- Current conversation ID
- /api/chat requests
- Abort / stop
- Duplicate-send protection
- Request lifecycle
- Preferences
- Ready attachment metadata
- History state loading
- Public chat events

DOES NOT OWN
---------------------------------------------------------
- DOM
- Message rendering
- Markdown
- Thinking UI
- Send button
- Enter key
- Attachment upload
- Sidebar/history UI

EVENT CONTRACT
---------------------------------------------------------
LISTENS:
- neyo:chat-send-request
- neyo:chat-stop-request
- neyo:chat-new-request
- neyo:conversation-loaded
- neyo:history-conversation-loaded
- neyo:chat-preferences-set
- neyo:chat-state-sync-request

EMITS:
- neyo:chat-ready
- neyo:chat-send-start
- neyo:chat-message-added
- neyo:chat-response
- neyo:chat-error
- neyo:chat-aborted
- neyo:chat-limit-reached
- neyo:chat-send-end
- neyo:chat-state-loaded
- neyo:chat-state
- neyo:chat-busy
- neyo:chat-new
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-chat-final-clean-v1";


  if (
    window.NeyoChat?.__controller ===
    true
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
     HELPERS
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
        item =>
          item &&
          typeof item ===
            "object"
      )
      .slice(
        0,
        CONFIG.maxAttachments
      )
      .map(
        item => {

          const mimeType =
            cleanText(
              item.mimeType ||
              item.mime ||
              item.type ||
              "application/octet-stream"
            ) ||
            "application/octet-stream";


          return {

            id:
              cleanText(
                item.id ||
                item.uploadId
              ) ||
              null,

            provider:
              cleanText(
                item.provider
              ) ||
              "supabase",

            bucket:
              cleanText(
                item.bucket
              ) ||
              "neyo-attachments",

            path:
              cleanText(
                item.path
              ),

            name:
              cleanText(
                item.name
              ) ||
              "Attached file",

            mimeType,

            type:
              mimeType,

            category:
              cleanText(
                item.category
              ) ||
              "unknown",

            size:
              Math.max(
                0,
                Number(
                  item.size
                ) || 0
              )
          };
        }
      )
      .filter(
        item =>
          Boolean(
            item.path
          )
      );
  }


  /* =====================================================
     MESSAGE NORMALIZATION
     ===================================================== */

  function normalizeMessage(
    value
  ) {
    if (
      !value ||
      typeof value !==
        "object"
    ) {
      return null;
    }


    if (
      value.role !==
        "user" &&
      value.role !==
        "assistant"
    ) {
      return null;
    }


    const message =
      {

        id:
          cleanText(
            value.id
          ) ||
          createId(),

        role:
          value.role,

        content:
          cleanText(
            value.content
          )
      };


    const attachments =
      normalizeAttachments(
        value.attachments
      );


    if (
      attachments.length >
      0
    ) {
      message.attachments =
        attachments;
    }


    if (
      Array.isArray(
        value.sources
      ) &&
      value.sources.length >
        0
    ) {
      message.sources =
        [
          ...value.sources
        ];
    }


    return message;
  }


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
     CONVERSATION STATE
     ===================================================== */

  function trimConversation() {
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


  function cloneConversation() {
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
            ? [
                ...message.sources
              ]
            : undefined
      })
    );
  }


  function addMessage(
    role,
    content,
    {
      id =
        null,

      attachments =
        [],

      sources =
        []
    } = {}
  ) {
    const message =
      normalizeMessage({

        id:
          id ||
          createId(),

        role,

        content,

        attachments,

        sources
      });


    if (
      !message
    ) {
      return null;
    }


    conversation.push(
      message
    );


    trimConversation();


    emit(
      "neyo:chat-message-added",
      {

        message:
          {
            ...message
          },

        conversation:
          cloneConversation()
      }
    );


    return message;
  }


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


    conversation.splice(
      index,
      1
    );


    return true;
  }


  /* =====================================================
     MODEL / TITLE
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
      return cleanText(
        attachments[0]?.name
      )
        .slice(
          0,
          80
        ) ||
        "New conversation";
    }


    return "New conversation";
  }


  /* =====================================================
     PAYLOAD
     ===================================================== */

  function buildPayload(
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
     HTTP RESPONSE
     ===================================================== */

  async function readJson(
    response
  ) {
    const raw =
      await response.text();


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
      const error =
        new Error(
          cleanText(
            data?.message ||
            data?.error ||
            raw
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
    text =
      "",

    attachments =
      []
  } = {}) {
    /*
    -------------------------------------------------------
    One generation at a time.
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
    Attachment-only request gets a neutral internal prompt.
    -------------------------------------------------------
    */

    const prompt =
      clean ||
      "Please analyze the attached file or files.";


    const requestId =
      ++activeRequestId;


    /*
    -------------------------------------------------------
    User message enters canonical conversation immediately.
    -------------------------------------------------------
    */

    const userMessage =
      addMessage(
        "user",
        prompt,
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


    let timeoutId =
      null;


    try {
      timeoutId =
        window.setTimeout(
          () => {

            try {
              controller.abort();

            } catch {}
          },
          CONFIG.requestTimeoutMs
        );


      const payload =
        buildPayload(
          prompt,
          readyAttachments
        );


      debug(
        "SEND",
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


      /*
      -------------------------------------------------------
      Quota / plan limit.
      -------------------------------------------------------
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

            requestId,

            data
          }
        );


        return null;
      }


      const data =
        await readJson(
          response
        );


      /*
      -------------------------------------------------------
      Ignore stale responses.
      -------------------------------------------------------
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


      if (
        !reply
      ) {
        throw new Error(
          "The AI response was empty."
        );
      }


      /*
      -------------------------------------------------------
      Update conversation ID only for normal saved chats.
      -------------------------------------------------------
      */

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
              data?.usedUrlContext
            ),

          creditType:
            data?.creditType ||
            null
        };


      emit(
        "neyo:chat-response",
        result
      );


      return result;

    } catch (
      error
    ) {
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
      Important:
      Chat core does NOT create UI error messages.
      messages.js decides how errors are displayed.
      -------------------------------------------------------
      */

      emit(
        "neyo:chat-error",
        {

          requestId,

          error: {

            name:
              error?.name ||
              "Error",

            message:
              error?.message ||
              "Something went wrong.",

            status:
              Number(
                error?.status
              ) ||
              null
          },

          conversationId:
            currentConversationId
        }
      );


      return null;

    } finally {
      if (
        timeoutId !==
        null
      ) {
        window.clearTimeout(
          timeoutId
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
    -------------------------------------------------------
    Invalidate any active request first.
    -------------------------------------------------------
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


    emit(
      "neyo:chat-new",
      {

        conversationId:
          null,

        messages:
          []
      }
    );


    emit(
      "neyo:chat-state-loaded",
      {

        conversationId:
          null,

        messages:
          []
      }
    );


    return true;
  }


  /* =====================================================
     LOAD CONVERSATION
     ===================================================== */

  function loadConversation({
    conversationId =
      null,

    messages =
      []
  } = {}) {
    /*
    -------------------------------------------------------
    History selection invalidates current generation.
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
    Single event.

    messages.js owns clearing + rendering history.
    -------------------------------------------------------
    */

    emit(
      "neyo:chat-state-loaded",
      {

        conversationId:
          currentConversationId,

        messages:
          cloneConversation()
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


    return true;
  }


  /* =====================================================
     PUBLIC EVENT INPUTS
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
    () => {

      stop();
    }
  );


  window.addEventListener(
    "neyo:chat-new-request",
    () => {

      newConversation();
    }
  );


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


  window.addEventListener(
    "neyo:chat-preferences-set",
    event => {

      setPreferences(
        event.detail ||
        {}
      );
    }
  );


  window.addEventListener(
    "neyo:chat-state-sync-request",
    () => {

      emit(
        "neyo:chat-state",
        {

          conversationId:
            currentConversationId,

          messages:
            cloneConversation(),

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

      getConversation:
        cloneConversation,

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

  emit(
    "neyo:chat-ready",
    {

      version:
        VERSION
    }
  );

})();
