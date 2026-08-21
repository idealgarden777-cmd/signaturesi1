/*
=========================================================
NEYO — CHAT FRONTEND CONTROLLER
FINAL v1

FILE:
public/js/components/chat.js

RESPONSIBILITIES:
- Listen for neyo:chat-send-request
- Read READY attachments from window.NeyoAttachments
- POST message + attachments to /api/chat
- Render user message
- Render assistant thinking state
- Render assistant response
- Support attachment-only messages
- Support Stop / Abort
- Clear attachments ONLY after successful response
- Keep message history for API context
- Preserve existing NEYO UI classes
- Copy / Share / Regenerate assistant actions
- Dispatch state events for send-state.js
- Never directly owns #sendBtn
- Never modifies neo.js
- Never uploads files itself

IMPORTANT OWNERSHIP:

send-state.js
    ↓
neyo:chat-send-request
    ↓
THIS FILE
    ↓
/api/chat
    ↓
response
    ↓
UI

attachments.js
    ↓
window.NeyoAttachments.getReady()
    ↓
THIS FILE

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION
     ===================================================== */

  const VERSION =
    "neyo-chat-final-v1";


  /* =====================================================
     DUPLICATE INIT PROTECTION
     ===================================================== */

  if (
    window.NeyoChat &&
    window.NeyoChat.__controller === true
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

      maxMessageLength:
        50_000,

      requestTimeoutMs:
        120_000,

      debug:
        true
    });


  /* =====================================================
     DOM

     Existing NEYO UI IDs.
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


  const chatInput =
    document.getElementById(
      "chatInput"
    );


  /* =====================================================
     REQUIRED DOM
     ===================================================== */

  if (!chatMessages) {

    console.error(
      "[NEYO Chat] #chatMessages is missing."
    );

    return;
  }


  /* =====================================================
     STATE
     ===================================================== */

  const state = {

    messages:
      [],

    currentConversationId:
      null,

    generating:
      false,

    controller:
      null,

    currentThinkingElement:
      null,

    lastRequest:
      null
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
     ID
     ===================================================== */

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
      "msg_" +
      Date.now() +
      "_" +
      Math.random()
        .toString(36)
        .slice(2)
    );
  }


  /* =====================================================
     TEXT
     ===================================================== */

  function cleanText(
    value,
    maxLength =
      CONFIG.maxMessageLength
  ) {

    if (
      typeof value !==
      "string"
    ) {

      return "";
    }


    return value
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


  /* =====================================================
     HTML
     ===================================================== */

  function escapeHtml(
    value
  ) {

    return String(
      value ?? ""
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
     SAFE MARKDOWN
     ===================================================== */

  function renderMarkdown(
    text
  ) {

    const value =
      String(
        text ?? ""
      );


    /*
    Best path:
    marked + DOMPurify
    */

    if (
      window.marked &&
      window.DOMPurify
    ) {

      try {

        const html =
          window.marked.parse(
            value,
            {
              breaks:
                true,

              gfm:
                true
            }
          );


        return window
          .DOMPurify
          .sanitize(
            html,
            {
              USE_PROFILES: {
                html:
                  true
              }
            }
          );

      } catch (
        error
      ) {

        console.warn(
          "[NEYO Chat] Markdown render failed:",
          error?.message
        );
      }
    }


    /*
    Safe fallback:
    plain escaped text.
    */

    return escapeHtml(
      value
    ).replace(
      /\n/g,
      "<br>"
    );
  }


  /* =====================================================
     ICONS
     ===================================================== */

  function refreshIcons() {

    try {

      window
        .lucide
        ?.createIcons
        ?.();

    } catch {}
  }


  /* =====================================================
     SCROLL
     ===================================================== */

  function scrollToBottom() {

    requestAnimationFrame(
      () => {

        if (
          scrollArea
        ) {

          scrollArea.scrollTop =
            scrollArea.scrollHeight;
        }
      }
    );
  }


  /* =====================================================
     START CHAT UI
     ===================================================== */

  function startChatUI() {

    if (
      heroSection
    ) {

      heroSection.style.display =
        "none";
    }
  }


  /* =====================================================
     ATTACHMENT HELPERS
     ===================================================== */

  function getReadyAttachments() {

    try {

      const controller =
        window.NeyoAttachments;


      if (
        !controller ||
        typeof controller
          .getReady !==
          "function"
      ) {

        return [];
      }


      const attachments =
        controller.getReady();


      return Array.isArray(
        attachments
      )
        ? attachments
        : [];

    } catch (
      error
    ) {

      console.error(
        "[NEYO Chat] Could not read attachments:",
        error
      );


      return [];
    }
  }


  function hasPendingAttachments() {

    try {

      return Boolean(
        window
          .NeyoAttachments
          ?.hasPending
          ?.()
      );

    } catch {

      return false;
    }
  }


  /* =====================================================
     ATTACHMENT SERIALIZATION

     Only metadata required by api/chat.js.

     Browser chunks/document text are NOT sent.

     Server independently reads private Storage.
     ===================================================== */

  function serializeAttachments(
    attachments
  ) {

    return attachments.map(
      attachment => ({

        id:
          attachment.id ||
          null,

        uploadId:
          attachment.uploadId ||
          null,

        bucket:
          attachment.bucket ||
          "neyo-attachments",

        path:
          attachment.path ||
          "",

        name:
          attachment.name ||
          "attachment",

        mime:
          attachment.mime ||
          attachment.mimeType ||
          "application/octet-stream",

        mimeType:
          attachment.mime ||
          attachment.mimeType ||
          "application/octet-stream",

        extension:
          attachment.extension ||
          "",

        category:
          attachment.category ||
          "unknown",

        size:
          Number(
            attachment.size
          ) ||
          0
      })
    );
  }


  /* =====================================================
     FILE ICON
     ===================================================== */

  function attachmentIcon(
    category
  ) {

    const icons = {

      image:
        "image",

      audio:
        "audio-lines",

      video:
        "video",

      document:
        "file-text",

      spreadsheet:
        "table-2",

      presentation:
        "presentation",

      archive:
        "archive",

      data:
        "database",

      code:
        "file-code-2",

      text:
        "file-text",

      unknown:
        "file"
    };


    return (
      icons[
        category
      ] ||
      "file"
    );
  }


  /* =====================================================
     USER ATTACHMENT UI
     ===================================================== */

  function renderUserAttachments(
    wrapper,
    attachments
  ) {

    if (
      !attachments?.length
    ) {

      return;
    }


    const container =
      document.createElement(
        "div"
      );


    container.className =
      "message-attachments";


    for (
      const attachment
      of attachments
    ) {

      const file =
        document.createElement(
          "div"
        );


      file.className =
        "message-attachment";


      file.innerHTML = `
        <div class="message-attachment-icon">
          <i
            data-lucide="${attachmentIcon(
              attachment.category
            )}"
            size="16"
            aria-hidden="true"
          ></i>
        </div>

        <div class="message-attachment-info">

          <div class="message-attachment-name">
            ${escapeHtml(
              attachment.name
            )}
          </div>

          <div class="message-attachment-type">
            ${escapeHtml(
              attachment.category ||
              "file"
            )}
          </div>

        </div>
      `;


      container.appendChild(
        file
      );
    }


    wrapper.appendChild(
      container
    );
  }


  /* =====================================================
     USER MESSAGE
     ===================================================== */

  function renderUserMessage(
    text,
    attachments = []
  ) {

    startChatUI();


    const message =
      document.createElement(
        "div"
      );


    message.className =
      "message user";


    message.dataset
      .messageId =
      createId();


    const wrapper =
      document.createElement(
        "div"
      );


    wrapper.className =
      "message-wrapper";


    if (text) {

      const content =
        document.createElement(
          "div"
        );


      content.className =
        "message-content";


      /*
      User text is always textContent.
      Never innerHTML.
      */

      content.textContent =
        text;


      wrapper.appendChild(
        content
      );
    }


    renderUserAttachments(
      wrapper,
      attachments
    );


    message.appendChild(
      wrapper
    );


    /*
    Existing user message actions.
    */

    const actions =
      document.createElement(
        "div"
      );


    actions.className =
      "message-actions";


    actions.innerHTML = `
      <button
        type="button"
        class="msg-action-btn edit-msg-btn"
        aria-label="Edit message"
        data-tooltip="Edit"
      >
        <i
          data-lucide="pencil"
          size="16"
        ></i>
      </button>

      <button
        type="button"
        class="msg-action-btn copy-msg-btn"
        aria-label="Copy message"
        data-tooltip="Copy"
      >
        <i
          data-lucide="copy"
          size="16"
        ></i>
      </button>
    `;


    message.appendChild(
      actions
    );


    chatMessages.appendChild(
      message
    );


    refreshIcons();

    scrollToBottom();


    return message;
  }


  /* =====================================================
     THINKING MESSAGE
     ===================================================== */

  function renderThinkingMessage() {

    startChatUI();


    const message =
      document.createElement(
        "div"
      );


    message.className =
      "message assistant is-thinking";


    message.dataset
      .messageId =
      createId();


    const content =
      document.createElement(
        "div"
      );


    content.className =
      "message-content";


    const thinking =
      document.createElement(
        "span"
      );


    thinking.className =
      "thinking-shimmer";


    thinking.textContent =
      "Thinking...";


    content.appendChild(
      thinking
    );


    message.appendChild(
      content
    );


    chatMessages.appendChild(
      message
    );


    state.currentThinkingElement =
      message;


    scrollToBottom();


    return message;
  }


  /* =====================================================
     ASSISTANT ACTIONS
     ===================================================== */

  function createAssistantActions() {

    const actions =
      document.createElement(
        "div"
      );


    actions.className =
      "message-actions";


    actions.innerHTML = `
      <button
        class="msg-action-btn copy-msg-btn"
        data-action="copy"
        data-tooltip="Copy"
        aria-label="Copy response"
        type="button"
      >
        <i
          data-lucide="copy"
          size="16"
        ></i>
      </button>

      <button
        class="msg-action-btn share-msg-btn"
        data-action="share"
        data-tooltip="Share"
        aria-label="Share response"
        type="button"
      >
        <i
          data-lucide="share-2"
          size="16"
        ></i>
      </button>

      <button
        class="msg-action-btn regen-msg-btn"
        data-action="regenerate"
        data-tooltip="Regenerate"
        aria-label="Regenerate response"
        type="button"
      >
        <i
          data-lucide="rotate-cw"
          size="16"
        ></i>
      </button>
    `;


    return actions;
  }


  /* =====================================================
     COMPLETE THINKING MESSAGE
     ===================================================== */

  function completeAssistantMessage(
    element,
    reply
  ) {

    if (!element) {

      return null;
    }


    element.classList.remove(
      "is-thinking"
    );


    let content =
      element.querySelector(
        ".message-content"
      );


    if (!content) {

      content =
        document.createElement(
          "div"
        );


      content.className =
        "message-content";


      element.prepend(
        content
      );
    }


    content.innerHTML =
      renderMarkdown(
        reply
      );


    /*
    Math support if existing app exposes it.
    */

    try {

      window
        .renderNeoMath
        ?.(
          content
        );

    } catch {}


    /*
    Remove old actions if retry reused same node.
    */

    element
      .querySelector(
        ".message-actions"
      )
      ?.remove();


    element.appendChild(
      createAssistantActions()
    );


    element.dataset
      .rawContent =
      reply;


    refreshIcons();

    scrollToBottom();


    state.currentThinkingElement =
      null;


    return element;
  }


  /* =====================================================
     ERROR MESSAGE
     ===================================================== */

  function renderAssistantError(
    element,
    error
  ) {

    const message =
      cleanText(
        error?.message ||
        "A server error has occurred.",
        500
      );


    if (!element) {

      element =
        renderThinkingMessage();
    }


    element.classList.remove(
      "is-thinking"
    );


    element.classList.add(
      "is-error"
    );


    let content =
      element.querySelector(
        ".message-content"
      );


    if (!content) {

      content =
        document.createElement(
          "div"
        );


      content.className =
        "message-content";


      element.appendChild(
        content
      );
    }


    content.textContent =
      `Error: ${message}`;


    element.dataset
      .errorMessage =
      message;


    element.dataset
      .rawContent =
      "";


    element
      .querySelector(
        ".message-actions"
      )
      ?.remove();


    /*
    Error actions:
    copy not useful;
    retry is.
    */

    const actions =
      document.createElement(
        "div"
      );


    actions.className =
      "message-actions";


    actions.innerHTML = `
      <button
        class="msg-action-btn regen-msg-btn"
        data-action="regenerate"
        data-tooltip="Retry"
        aria-label="Retry"
        type="button"
      >
        <i
          data-lucide="rotate-cw"
          size="16"
        ></i>
      </button>
    `;


    element.appendChild(
      actions
    );


    refreshIcons();

    scrollToBottom();


    state.currentThinkingElement =
      null;


    return element;
  }


  /* =====================================================
     HISTORY
     ===================================================== */

  function pushMessage(
    role,
    content
  ) {

    state.messages.push({
      role,

      content:
        String(
          content ??
          ""
        )
    });


    if (
      state.messages.length >
      CONFIG.maxHistoryMessages
    ) {

      state.messages =
        state.messages.slice(
          -CONFIG.maxHistoryMessages
        );
    }
  }


  /* =====================================================
     API RESPONSE READER
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

      const message =
        data?.error ||
        data?.message ||
        (
          response.status >=
          500
            ? "A server error has occurred."
            : `Request failed (${response.status}).`
        );


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


    if (
      !data ||
      typeof data !==
      "object"
    ) {

      throw new Error(
        "The server returned an invalid response."
      );
    }


    return data;
  }


  /* =====================================================
     RESPONSE TEXT
     ===================================================== */

  function getReplyText(
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
     REQUEST BODY
     ===================================================== */

  function buildRequestBody({
    text,
    attachments
  }) {

    const messages =
      [
        ...state.messages,
        {
          role:
            "user",

          content:
            text ||
            (
              attachments.length
                ? "Please analyze the attached file or files."
                : ""
            )
        }
      ];


    return {

      messages,

      attachments:
        serializeAttachments(
          attachments
        ),

      conversationId:
        state
          .currentConversationId,

      /*
      Backend chooses the real model according
      to authenticated user's plan.

      No client model authority.
      */

      isDeepResearch:
        Boolean(
          window
            .NeyoDeepResearch
            ?.isEnabled
            ?.() ||
          document.body
            ?.dataset
            ?.deepResearch ===
            "true"
        )
    };
  }


  /* =====================================================
     SEND STATE EVENTS
     ===================================================== */

  function emitSendStart(
    detail = {}
  ) {

    state.generating =
      true;


    window.dispatchEvent(
      new CustomEvent(
        "neyo:chat-send-start",
        {
          detail
        }
      )
    );
  }


  function emitSendEnd(
    detail = {}
  ) {

    state.generating =
      false;


    window.dispatchEvent(
      new CustomEvent(
        "neyo:chat-send-end",
        {
          detail
        }
      )
    );
  }


  function emitError(
    error
  ) {

    window.dispatchEvent(
      new CustomEvent(
        "neyo:chat-error",
        {
          detail: {
            message:
              error?.message ||
              "The request failed.",

            status:
              error?.status ||
              null
          }
        }
      )
    );
  }


  /* =====================================================
     SEND
     ===================================================== */

  async function sendMessage(
    requestedText = ""
  ) {

    if (
      state.generating
    ) {

      return false;
    }


    const text =
      cleanText(
        requestedText ||
        chatInput?.value ||
        ""
      );


    /*
    Do not send partially uploaded files.
    */

    if (
      hasPendingAttachments()
    ) {

      window.dispatchEvent(
        new CustomEvent(
          "neyo:chat-attachments-pending"
        )
      );


      return false;
    }


    const attachments =
      getReadyAttachments();


    if (
      !text &&
      attachments.length ===
        0
    ) {

      return false;
    }


    /*
    Snapshot request for retry/regenerate.
    */

    state.lastRequest = {
      text,

      attachments:
        serializeAttachments(
          attachments
        )
    };


    const userDisplayText =
      text;


    renderUserMessage(
      userDisplayText,
      attachments
    );


    /*
    User's visible text is cleared immediately.

    attachments are NOT cleared until success.
    */

    if (
      chatInput
    ) {

      chatInput.value =
        "";


      chatInput.dispatchEvent(
        new Event(
          "input",
          {
            bubbles:
              true
          }
        )
      );
    }


    const thinking =
      renderThinkingMessage();


    emitSendStart({
      text,

      attachmentCount:
        attachments.length
    });


    const controller =
      new AbortController();


    state.controller =
      controller;


    const timeout =
      window.setTimeout(
        () => {

          controller.abort();

        },
        CONFIG.requestTimeoutMs
      );


    try {

      const requestBody =
        buildRequestBody({
          text,
          attachments
        });


      debug(
        "SEND",
        {
          messages:
            requestBody.messages.length,

          attachments:
            requestBody
              .attachments
              .map(
                item => ({
                  name:
                    item.name,

                  category:
                    item.category,

                  path:
                    item.path
                })
              ),

          conversationId:
            requestBody
              .conversationId
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

            signal:
              controller.signal,

            body:
              JSON.stringify(
                requestBody
              )
          }
        );


      const data =
        await readApiResponse(
          response
        );


      const reply =
        getReplyText(
          data
        );


      if (!reply) {

        throw new Error(
          "The AI response was empty."
        );
      }


      /*
      Server-generated conversation ID.
      */

      if (
        typeof data
          .conversationId ===
          "string" &&
        data
          .conversationId
          .trim()
      ) {

        state.currentConversationId =
          data
            .conversationId
            .trim();
      }


      /*
      Add successful turn to local API history.
      */

      pushMessage(
        "user",
        text ||
        (
          attachments.length
            ? `[Attached: ${attachments
                .map(
                  item =>
                    item.name
                )
                .join(
                  ", "
                )}]`
            : ""
        )
      );


      pushMessage(
        "assistant",
        reply
      );


      completeAssistantMessage(
        thinking,
        reply
      );


      /*
      ONLY NOW clear attachments.
      */

      if (
        attachments.length
      ) {

        window.dispatchEvent(
          new CustomEvent(
            "neyo:attachments-clear-request"
          )
        );
      }


      /*
      Notify other modules/history.
      */

      window.dispatchEvent(
        new CustomEvent(
          "neyo:chat-response",
          {
            detail: {
              conversationId:
                state
                  .currentConversationId,

              reply,

              data
            }
          }
        )
      );


      emitSendEnd({
        success:
          true,

        conversationId:
          state
            .currentConversationId
      });


      return true;


    } catch (
      error
    ) {

      /*
      STOP / ABORT
      */

      if (
        error?.name ===
        "AbortError"
      ) {

        thinking?.remove();


        window.dispatchEvent(
          new CustomEvent(
            "neyo:chat-aborted"
          )
        );


        emitSendEnd({
          success:
            false,

          aborted:
            true
        });


        return false;
      }


      console.error(
        "[NEYO Chat] Send failed:",
        error
      );


      renderAssistantError(
        thinking,
        error
      );


      /*
      Quota-specific event.
      */

      if (
        error?.status ===
        429
      ) {

        window.dispatchEvent(
          new CustomEvent(
            "neyo:chat-limit-reached",
            {
              detail: {
                message:
                  error.message,

                data:
                  error.data
              }
            }
          )
        );
      }


      emitError(
        error
      );


      emitSendEnd({
        success:
          false,

        error:
          error.message
      });


      return false;


    } finally {

      window.clearTimeout(
        timeout
      );


      if (
        state.controller ===
        controller
      ) {

        state.controller =
          null;
      }


      state.generating =
        false;
    }
  }


  /* =====================================================
     STOP
     ===================================================== */

  function stopGeneration() {

    if (
      !state.generating
    ) {

      return false;
    }


    try {

      state.controller
        ?.abort();

    } catch {}


    return true;
  }


  /* =====================================================
     REGENERATE

     Removes last assistant state locally,
     but does not duplicate the visible user bubble.
     ===================================================== */

  async function regenerate() {

    if (
      state.generating ||
      !state.lastRequest
    ) {

      return false;
    }


    /*
    Remove previous assistant from local history.
    */

    if (
      state.messages.at(-1)
        ?.role ===
      "assistant"
    ) {

      state.messages.pop();
    }


    if (
      state.messages.at(-1)
        ?.role ===
      "user"
    ) {

      state.messages.pop();
    }


    const thinking =
      renderThinkingMessage();


    emitSendStart({
      regenerate:
        true
    });


    const controller =
      new AbortController();


    state.controller =
      controller;


    const timeout =
      window.setTimeout(
        () =>
          controller.abort(),
        CONFIG.requestTimeoutMs
      );


    try {

      const attachments =
        state
          .lastRequest
          .attachments ||
        [];


      const text =
        state
          .lastRequest
          .text ||
        "";


      const body = {

        messages: [
          ...state.messages,

          {
            role:
              "user",

            content:
              text ||
              "Please analyze the attached file or files."
          }
        ],

        attachments,

        conversationId:
          state
            .currentConversationId,

        isDeepResearch:
          false
      };


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
                "application/json"
            },

            signal:
              controller.signal,

            body:
              JSON.stringify(
                body
              )
          }
        );


      const data =
        await readApiResponse(
          response
        );


      const reply =
        getReplyText(
          data
        );


      if (!reply) {

        throw new Error(
          "The AI response was empty."
        );
      }


      pushMessage(
        "user",
        text ||
        "[Attached file]"
      );


      pushMessage(
        "assistant",
        reply
      );


      completeAssistantMessage(
        thinking,
        reply
      );


      emitSendEnd({
        success:
          true,

        regenerated:
          true
      });


      return true;


    } catch (
      error
    ) {

      if (
        error?.name ===
        "AbortError"
      ) {

        thinking?.remove();


        window.dispatchEvent(
          new CustomEvent(
            "neyo:chat-aborted"
          )
        );

      } else {

        renderAssistantError(
          thinking,
          error
        );


        emitError(
          error
        );
      }


      emitSendEnd({
        success:
          false
      });


      return false;


    } finally {

      window.clearTimeout(
        timeout
      );


      if (
        state.controller ===
        controller
      ) {

        state.controller =
          null;
      }


      state.generating =
        false;
    }
  }


  /* =====================================================
     COPY
     ===================================================== */

  async function copyMessage(
    message
  ) {

    const content =
      message.querySelector(
        ".message-content"
      );


    const text =
      message.dataset
        .rawContent ||
      content?.innerText ||
      "";


    if (!text) {

      return;
    }


    try {

      await navigator
        .clipboard
        .writeText(
          text
        );


      window.dispatchEvent(
        new CustomEvent(
          "neyo:toast",
          {
            detail: {
              message:
                "Copied",

              type:
                "success"
            }
          }
        )
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


  /* =====================================================
     SHARE
     ===================================================== */

  async function shareMessage(
    message
  ) {

    const content =
      message.querySelector(
        ".message-content"
      );


    const text =
      message.dataset
        .rawContent ||
      content?.innerText ||
      "";


    if (!text) {

      return;
    }


    if (
      navigator.share
    ) {

      try {

        await navigator.share({
          text
        });


        return;

      } catch (
        error
      ) {

        if (
          error?.name ===
          "AbortError"
        ) {

          return;
        }
      }
    }


    await copyMessage(
      message
    );
  }


  /* =====================================================
     MESSAGE ACTION DELEGATION
     ===================================================== */

  chatMessages.addEventListener(
    "click",
    event => {

      const button =
        event.target
          ?.closest
          ?.(
            ".msg-action-btn"
          );


      if (!button) {

        return;
      }


      const message =
        button.closest(
          ".message"
        );


      if (!message) {

        return;
      }


      /*
      Avoid interfering with legacy edit behavior.
      */

      if (
        button.classList
          .contains(
            "edit-msg-btn"
          )
      ) {

        return;
      }


      event.preventDefault();

      event.stopPropagation();


      if (
        button.classList
          .contains(
            "copy-msg-btn"
          ) ||
        button.dataset
          .action ===
          "copy"
      ) {

        void copyMessage(
          message
        );


        return;
      }


      if (
        button.classList
          .contains(
            "share-msg-btn"
          ) ||
        button.dataset
          .action ===
          "share"
      ) {

        void shareMessage(
          message
        );


        return;
      }


      if (
        button.classList
          .contains(
            "regen-msg-btn"
          ) ||
        button.dataset
          .action ===
          "regenerate"
      ) {

        void regenerate();
      }
    }
  );


  /* =====================================================
     SEND REQUEST EVENT

     send-state.js dispatches this.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-request",
    event => {

      const text =
        cleanText(
          event?.detail
            ?.text ||
          chatInput?.value ||
          ""
        );


      void sendMessage(
        text
      );
    }
  );


  /* =====================================================
     STOP REQUEST EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-stop-request",
    () => {

      stopGeneration();
    }
  );


  /* =====================================================
     NEW CHAT

     Clear ONLY this module's state.
     Do not alter neo.js internals.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {

      stopGeneration();


      state.messages =
        [];


      state.currentConversationId =
        null;


      state.lastRequest =
        null;


      state.currentThinkingElement =
        null;


      debug(
        "New chat state created."
      );
    }
  );


  /* =====================================================
     EXTERNAL CONVERSATION SYNC

     History module can use this later without
     changing this file.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-load",
    event => {

      const detail =
        event?.detail ||
        {};


      state.currentConversationId =
        typeof detail
          .conversationId ===
          "string"
          ? detail
              .conversationId
              .trim() ||
            null
          : null;


      state.messages =
        Array.isArray(
          detail.messages
        )
          ? detail.messages
              .filter(
                message =>
                  message &&
                  [
                    "user",
                    "assistant",
                    "model"
                  ].includes(
                    message.role
                  )
              )
              .map(
                message => ({
                  role:
                    message.role ===
                    "model"
                      ? "assistant"
                      : message.role,

                  content:
                    cleanText(
                      message.content
                    )
                })
              )
              .slice(
                -CONFIG.maxHistoryMessages
              )
          : [];


      debug(
        "Conversation synced",
        {
          conversationId:
            state
              .currentConversationId,

          messages:
            state
              .messages
              .length
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


      send:
        sendMessage,


      stop:
        stopGeneration,


      regenerate,


      isGenerating:
        () =>
          state.generating,


      getConversationId:
        () =>
          state
            .currentConversationId,


      setConversationId:
        value => {

          state.currentConversationId =
            typeof value ===
            "string"
              ? value.trim() ||
                null
              : null;
        },


      getMessages:
        () =>
          state.messages.map(
            message => ({
              ...message
            })
          ),


      setMessages:
        messages => {

          state.messages =
            Array.isArray(
              messages
            )
              ? messages
                  .filter(
                    message =>
                      message &&
                      [
                        "user",
                        "assistant",
                        "model"
                      ].includes(
                        message.role
                      )
                  )
                  .map(
                    message => ({
                      role:
                        message.role ===
                        "model"
                          ? "assistant"
                          : message.role,

                      content:
                        cleanText(
                          message.content
                        )
                    })
                  )
                  .slice(
                    -CONFIG.maxHistoryMessages
                  )
              : [];
        },


      reset:
        () => {

          stopGeneration();


          state.messages =
            [];


          state.currentConversationId =
            null;


          state.lastRequest =
            null;
        },


      getState:
        () => ({

          version:
            VERSION,

          generating:
            state.generating,

          conversationId:
            state
              .currentConversationId,

          messageCount:
            state
              .messages
              .length,

          hasLastRequest:
            Boolean(
              state.lastRequest
            )
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
    "FINAL CONTROLLER READY",
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
        ),

      attachmentController:
        Boolean(
          window
            .NeyoAttachments
        )
    }
  );

})();
