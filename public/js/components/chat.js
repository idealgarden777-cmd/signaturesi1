/*
=========================================================
NEYO — CHAT CORE
CHATGPT-STANDARD v7

FILE:
public/js/components/chat.js

OWNS
---------------------------------------------------------
✅ Single conversation state
✅ /api/chat requests
✅ Current conversation ID
✅ Live user-message rendering
✅ Live assistant-message rendering
✅ Thinking indicator
✅ Stop / AbortController
✅ History state synchronization
✅ Attachment metadata
✅ Chat lifecycle events
✅ Error recovery
✅ Duplicate-send protection

DOES NOT OWN
---------------------------------------------------------
❌ Send button click
❌ Enter key
❌ Attachment upload
❌ Sidebar/history list UI
❌ File picker

ARCHITECTURE
---------------------------------------------------------
send-state.js
      ↓
neyo:chat-send-request
      ↓
chat.js
      ├── render user instantly
      ├── call /api/chat
      ├── render assistant instantly
      └── emit lifecycle events

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-chat-v7-chatgpt-standard";


  if (
    window.NeyoChat
      ?.__controller ===
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
        10,

      requestTimeoutMs:
        180_000,

      debug:
        true
    });


  /* =====================================================
     DOM
     ===================================================== */

  const chatMessages =
    document.getElementById(
      "chatMessages"
    );


  const heroSection =
    document.getElementById(
      "heroSection"
    );


  const scrollArea =
    document.getElementById(
      "scrollArea"
    );


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


  let requestSerial =
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
     IDS
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
     ESCAPE
     ===================================================== */

  function escapeHtml(
    value
  ) {
    return String(
      value ??
      ""
    )
      .replace(
        /&/g,
        "&amp;"
      )
      .replace(
        /</g,
        "&lt;"
      )
      .replace(
        />/g,
        "&gt;"
      )
      .replace(
        /"/g,
        "&quot;"
      )
      .replace(
        /'/g,
        "&#039;"
      );
  }


  /* =====================================================
     MARKDOWN
     ===================================================== */

  function renderMarkdown(
    text
  ) {
    const value =
      String(
        text ??
        ""
      );


    try {
      if (
        !window.marked
          ?.parse
      ) {
        return escapeHtml(
          value
        )
          .replace(
            /\n/g,
            "<br>"
          );
      }


      const rawHtml =
        window.marked.parse(
          value
        );


      /*
      -----------------------------------------------------
      Sanitize if DOMPurify exists.
      -----------------------------------------------------
      */

      if (
        window.DOMPurify
          ?.sanitize
      ) {
        return window
          .DOMPurify
          .sanitize(
            rawHtml
          );
      }


      /*
      -----------------------------------------------------
      Never trust unsanitized Markdown HTML.

      If DOMPurify isn't available, use plain safe text.
      -----------------------------------------------------
      */

      return escapeHtml(
        value
      )
        .replace(
          /\n/g,
          "<br>"
        );

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Chat] Markdown render failed:",
        error
      );


      return escapeHtml(
        value
      )
        .replace(
          /\n/g,
          "<br>"
        );
    }
  }


  /* =====================================================
     ICONS
     ===================================================== */

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();

    } catch {}
  }


  /* =====================================================
     SCROLL
     ===================================================== */

  function scrollToBottom() {
    window.requestAnimationFrame(
      () => {
        if (
          scrollArea
        ) {
          scrollArea.scrollTop =
            scrollArea.scrollHeight;

          return;
        }


        chatMessages
          ?.lastElementChild
          ?.scrollIntoView
          ?.({
            block:
              "end"
          });
      }
    );
  }


  /* =====================================================
     START CHAT
     ===================================================== */

  function ensureChatVisible() {
    if (
      heroSection
    ) {
      heroSection.style.display =
        "none";
    }
  }


  /* =====================================================
     MESSAGE DOM
     ===================================================== */

  function findRenderedMessage(
    id
  ) {
    if (
      !chatMessages ||
      !id
    ) {
      return null;
    }


    return chatMessages
      .querySelector(
        `[data-neyo-message-id="${CSS.escape(
          id
        )}"]`
      );
  }


  function createAttachmentSummary(
    attachments
  ) {
    if (
      !Array.isArray(
        attachments
      ) ||
      attachments.length ===
        0
    ) {
      return null;
    }


    const wrapper =
      document.createElement(
        "div"
      );


    wrapper.className =
      "message-attachments";


    attachments.forEach(
      file => {
        const chip =
          document.createElement(
            "div"
          );


        chip.className =
          "message-attachment-chip";


        const icon =
          document.createElement(
            "i"
          );


        icon.setAttribute(
          "data-lucide",
          file.category ===
            "image"
              ? "image"
              : file.category ===
                  "code"
                ? "file-code-2"
                : "file"
        );


        icon.setAttribute(
          "size",
          "14"
        );


        const label =
          document.createElement(
            "span"
          );


        label.textContent =
          file.name ||
          "Attachment";


        chip.append(
          icon,
          label
        );


        wrapper.appendChild(
          chip
        );
      }
    );


    return wrapper;
  }


  function renderMessageToUI(
    message,
    {
      thinking =
        false
    } = {}
  ) {
    if (
      !chatMessages ||
      !message
    ) {
      return null;
    }


    ensureChatVisible();


    const existing =
      findRenderedMessage(
        message.id
      );


    if (
      existing
    ) {
      return existing;
    }


    const article =
      document.createElement(
        "article"
      );


    article.className =
      `message ${message.role}`;


    article.dataset
      .neyoMessageId =
      message.id;


    article.dataset.role =
      message.role;


    const content =
      document.createElement(
        "div"
      );


    content.className =
      "message-content";


    if (
      thinking
    ) {
      article.id =
        "neyoThinkingIndicator";


      content.classList.add(
        "typing-indicator"
      );


      content.innerHTML = `
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      `;

    } else if (
      message.role ===
      "assistant"
    ) {
      content.innerHTML =
        renderMarkdown(
          message.content
        );

    } else {
      content.textContent =
        message.content;


      const attachmentSummary =
        createAttachmentSummary(
          message.attachments
        );


      if (
        attachmentSummary
      ) {
        content.appendChild(
          attachmentSummary
        );
      }
    }


    article.appendChild(
      content
    );


    /*
    -------------------------------------------------------
    Assistant actions.
    -------------------------------------------------------
    */

    if (
      !thinking &&
      message.role ===
        "assistant"
    ) {
      const actions =
        document.createElement(
          "div"
        );


      actions.className =
        "message-actions";


      const copyButton =
        document.createElement(
          "button"
        );


      copyButton.type =
        "button";


      copyButton.className =
        "action-btn";


      copyButton.setAttribute(
        "aria-label",
        "Copy response"
      );


      copyButton.innerHTML = `
        <i
          data-lucide="copy"
          size="14"
        ></i>
      `;


      copyButton.addEventListener(
        "click",
        async () => {
          try {
            await navigator
              .clipboard
              .writeText(
                message.content
              );


            emit(
              "neyo:message-copied",
              {
                message
              }
            );

          } catch (
            error
          ) {
            console.warn(
              "[NEYO Chat] Copy failed:",
              error
            );
          }
        }
      );


      actions.appendChild(
        copyButton
      );


      article.appendChild(
        actions
      );
    }


    chatMessages.appendChild(
      article
    );


    refreshIcons();


    scrollToBottom();


    return article;
  }


  /* =====================================================
     THINKING
     ===================================================== */

  function showThinking() {
    removeThinking();


    const message =
      {
        id:
          "neyo-thinking",

        role:
          "assistant",

        content:
          ""
      };


    return renderMessageToUI(
      message,
      {
        thinking:
          true
      }
    );
  }


  function removeThinking() {
    document
      .getElementById(
        "neyoThinkingIndicator"
      )
      ?.remove();


    document
      .querySelector(
        '[data-neyo-message-id="neyo-thinking"]'
      )
      ?.remove();
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
      .slice(
        0,
        CONFIG.maxAttachments
      )
      .map(
        file => {
          const mime =
            file?.mimeType ||
            file?.mime ||
            file?.type ||
            "application/octet-stream";


          return {
            provider:
              file?.provider ||
              "supabase",

            bucket:
              file?.bucket ||
              "neyo-attachments",

            path:
              file?.path ||
              "",

            name:
              file?.name ||
              "Attached file",

            mimeType:
              mime,

            type:
              mime,

            category:
              file?.category ||
              "unknown",

            size:
              Number(
                file?.size
              ) ||
              0
          };
        }
      )
      .filter(
        file =>
          Boolean(
            file.path
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


    const content =
      cleanText(
        message.content
      );


    const normalized =
      {
        id:
          message.id ||
          createId(),

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
        [
          ...message.sources
        ];
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
     ADD MESSAGE
     ===================================================== */

  function addMessage(
    role,
    content,
    options =
      {}
  ) {
    if (
      role !==
        "user" &&
      role !==
        "assistant"
    ) {
      return null;
    }


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
          options.sources
      });


    if (
      !message
    ) {
      return null;
    }


    conversation.push(
      message
    );


    if (
      conversation.length >
      CONFIG.maxHistoryMessages
    ) {
      conversation =
        conversation.slice(
          -CONFIG.maxHistoryMessages
        );
    }


    /*
    -------------------------------------------------------
    Render immediately.

    This fixes the bug where message only appeared after
    reloading history.
    -------------------------------------------------------
    */

    renderMessageToUI(
      message
    );


    emit(
      "neyo:chat-message-added",
      {
        message:
          {
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


  /* =====================================================
     REMOVE MESSAGE
     ===================================================== */

  function removeMessage(
    id
  ) {
    const index =
      conversation.findIndex(
        item =>
          item.id ===
          id
      );


    if (
      index <
      0
    ) {
      return false;
    }


    conversation.splice(
      index,
      1
    );


    findRenderedMessage(
      id
    )
      ?.remove();


    return true;
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

  function makeConversationTitle(
    text,
    attachments =
      []
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
     PAYLOAD
     ===================================================== */

  function buildPayload(
    apiContent,
    attachments
  ) {
    const privateChat =
      Boolean(
        preferences.privateChat
      );


    /*
    -------------------------------------------------------
    conversation already contains the latest user message.
    -------------------------------------------------------
    */

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
        makeConversationTitle(
          apiContent,
          attachments
        )
    };
  }


  /* =====================================================
     JSON
     ===================================================== */

  async function readJsonResponse(
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
      const error =
        new Error(
          data?.message ||
          data?.error ||
          raw ||
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


  /* =====================================================
     REPLY
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


    return typeof value ===
      "string"
        ? value.trim()
        : "";
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
    Prevent duplicate calls.
    -------------------------------------------------------
    */

    if (
      isGenerating
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


    const apiContent =
      clean ||
      "Please analyze the attached file.";


    const serial =
      ++requestSerial;


    /*
    -------------------------------------------------------
    Add + render user instantly.
    -------------------------------------------------------
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


    if (
      !userMessage
    ) {
      return null;
    }


    isGenerating =
      true;


    abortController =
      new AbortController();


    const thisController =
      abortController;


    emit(
      "neyo:chat-send-start",
      {
        requestId:
          serial,

        text:
          clean,

        attachments:
          readyAttachments,

        conversationId:
          currentConversationId
      }
    );


    showThinking();


    let timeoutId =
      null;


    try {
      timeoutId =
        window.setTimeout(
          () => {
            try {
              thisController.abort();
            } catch {}
          },
          CONFIG.requestTimeoutMs
        );


      const payload =
        buildPayload(
          apiContent,
          readyAttachments
        );


      debug(
        "SEND",
        {
          requestId:
            serial,

          conversationId:
            currentConversationId,

          messages:
            payload.messages.length,

          attachments:
            readyAttachments.length
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

            headers:
              {
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
              thisController.signal
          }
        );


      /*
      -------------------------------------------------------
      429 handling.
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


        removeThinking();


        /*
        Keep user message visible.
        ChatGPT does not make the user's text disappear just
        because the server limit failed.
        */


        emit(
          "neyo:chat-limit-reached",
          {
            data
          }
        );


        return null;
      }


      const data =
        await readJsonResponse(
          response
        );


      /*
      -------------------------------------------------------
      Ignore stale response if a newer request/reset occurred.
      -------------------------------------------------------
      */

      if (
        serial !==
        requestSerial
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
      Conversation ID.
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


      removeThinking();


      /*
      -------------------------------------------------------
      Render assistant instantly.
      -------------------------------------------------------
      */

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
          reply,

          sources,

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
            null,

          message:
            assistantMessage
        };


      emit(
        "neyo:chat-response",
        result
      );


      if (
        !preferences.privateChat
      ) {
        emit(
          "neyo:history-load-request"
        );
      }


      return result;

    } catch (
      error
    ) {
      removeThinking();


      if (
        error?.name ===
        "AbortError"
      ) {
        emit(
          "neyo:chat-aborted",
          {
            requestId:
              serial
          }
        );


        return null;
      }


      console.error(
        "[NEYO Chat] Send failed:",
        error
      );


      /*
      -------------------------------------------------------
      Show an inline assistant error so screen never appears
      frozen/blank.
      -------------------------------------------------------
      */

      const errorText =
        error?.status ===
          401
          ? "Your session has expired. Please sign in again."
          : error?.message ||
            "Something went wrong. Please try again.";


      const errorMessage =
        addMessage(
          "assistant",
          `⚠️ ${errorText}`,
          {
            id:
              createId()
          }
        );


      if (
        errorMessage
      ) {
        const element =
          findRenderedMessage(
            errorMessage.id
          );


        element
          ?.classList
          .add(
            "message-error"
          );
      }


      emit(
        "neyo:chat-error",
        {
          error,

          message:
            errorMessage
        }
      );


      return null;

    } finally {
      if (
        timeoutId
      ) {
        window.clearTimeout(
          timeoutId
        );
      }


      /*
      -------------------------------------------------------
      Only current request may release state.
      -------------------------------------------------------
      */

      if (
        serial ===
        requestSerial
      ) {
        isGenerating =
          false;


        abortController =
          null;


        removeThinking();


        emit(
          "neyo:chat-send-end",
          {
            requestId:
              serial,

            conversationId:
              currentConversationId
          }
        );
      }
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
      abortController.abort();

      return true;

    } catch {
      return false;
    }
  }


  /* =====================================================
     CLEAR UI
     ===================================================== */

  function clearMessagesUI() {
    if (
      chatMessages
    ) {
      chatMessages.innerHTML =
        "";
    }


    removeThinking();
  }


  /* =====================================================
     NEW CONVERSATION
     ===================================================== */

  function newConversation() {
    /*
    Invalidate any response already in flight.
    */

    requestSerial +=
      1;


    stop();


    isGenerating =
      false;


    abortController =
      null;


    conversation =
      [];


    currentConversationId =
      null;


    clearMessagesUI();


    if (
      heroSection
    ) {
      heroSection.style.display =
        "";
    }


    emit(
      "neyo:chat-new",
      {
        conversation:
          []
      }
    );


    return true;
  }


  /* =====================================================
     LOAD HISTORY INTO SAME STATE
     ===================================================== */

  function loadConversation({
    conversationId,
    messages =
      []
  } = {}) {
    /*
    Invalidate in-flight request.
    */

    requestSerial +=
      1;


    stop();


    isGenerating =
      false;


    abortController =
      null;


    currentConversationId =
      conversationId ||
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
    Render loaded history immediately as well.

    This keeps one source of truth.
    -------------------------------------------------------
    */

    clearMessagesUI();


    if (
      conversation.length >
      0
    ) {
      ensureChatVisible();


      conversation.forEach(
        message => {
          renderMessageToUI(
            message
          );
        }
      );

    } else if (
      heroSection
    ) {
      heroSection.style.display =
        "";
    }


    emit(
      "neyo:chat-state-loaded",
      {
        conversationId:
          currentConversationId,

        messages:
          conversation.map(
            message => ({
              ...message
            })
          )
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
      return;
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
     HISTORY LOAD EVENTS
     ===================================================== */

  function receiveConversationLoad(
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
    receiveConversationLoad
  );


  /*
  ---------------------------------------------------------
  Compatibility with other history implementations.
  ---------------------------------------------------------
  */

  window.addEventListener(
    "neyo:history-conversation-loaded",
    receiveConversationLoad
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
     EXTERNAL STATE SYNC
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
            conversation.map(
              message => ({
                ...message
              })
            ),

          generating:
            isGenerating
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

      setPreferences,

      getPreferences:
        () => ({
          ...preferences
        }),

      getConversation:
        () =>
          conversation.map(
            message => ({
              ...message
            })
          ),

      getConversationId:
        () =>
          currentConversationId,

      setConversationId(
        id
      ) {
        currentConversationId =
          id ||
          null;
      },

      isGenerating:
        () =>
          isGenerating,

      clearUI:
        clearMessagesUI,

      render:
        renderMessageToUI,

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
     INIT
     ===================================================== */

  debug(
    "READY",
    {
      version:
        VERSION,

      chatMessages:
        Boolean(
          chatMessages
        ),

      heroSection:
        Boolean(
          heroSection
        ),

      scrollArea:
        Boolean(
          scrollArea
        )
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
