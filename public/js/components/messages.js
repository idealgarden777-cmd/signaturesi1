/*
=========================================================
NEYO — MESSAGES CORE
CHATGPT-STANDARD v7

FILE:
public/js/components/messages.js

OWNS
---------------------------------------------------------
✅ Message DOM access
✅ User / assistant message shells
✅ Thinking state
✅ Message updates
✅ Message deduplication
✅ Auto-scroll
✅ Clear messages
✅ Live chat events
✅ Safe text rendering
✅ Optional sanitized HTML
✅ Compatibility with chat.js
✅ Compatibility with untouched neo.js

DOES NOT OWN
---------------------------------------------------------
❌ /api/chat
❌ Send button
❌ Enter key
❌ Attachment upload
❌ History API
❌ Regenerate API
❌ Message edit logic
❌ Share logic

IMPORTANT
---------------------------------------------------------
This module NEVER sends chat requests.

chat.js owns conversation/API state.

messages.js only owns message presentation.

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / DUPLICATE GUARD
     ===================================================== */

  const VERSION =
    "neyo-messages-v7-chatgpt-standard";


  if (
    window.NeyoMessages
      ?.__controller === true
  ) {
    console.warn(
      "[NEYO Messages] Already initialized."
    );

    return;
  }


  /* =====================================================
     DOM
     ===================================================== */

  const chatMessages =
    document.getElementById(
      "chatMessages"
    );


  const scrollArea =
    document.getElementById(
      "scrollArea"
    );


  const heroSection =
    document.getElementById(
      "heroSection"
    );


  if (!chatMessages) {
    console.warn(
      "[NEYO Messages] #chatMessages not found."
    );

    return;
  }


  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    thinkingElement:
      null,

    thinkingId:
      null,

    autoScroll:
      true
  };


  /* =====================================================
     HELPERS
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
      `message_${Date.now()}_` +
      Math.random()
        .toString(36)
        .slice(2)
    );
  }


  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();

    } catch {}
  }


  function hideHero() {
    if (
      heroSection
    ) {
      heroSection.style.display =
        "none";
    }
  }


  function showHero() {
    if (
      !heroSection
    ) {
      return;
    }


    if (
      chatMessages.children.length === 0
    ) {
      heroSection.style.display =
        "";
    }
  }


  /* =====================================================
     SAFE SELECTOR
     ===================================================== */

  function escapeSelector(
    value
  ) {
    const string =
      String(
        value ?? ""
      );


    if (
      globalThis.CSS
        ?.escape
    ) {
      return CSS.escape(
        string
      );
    }


    return string.replace(
      /["\\]/g,
      "\\$&"
    );
  }


  /* =====================================================
     SCROLL
     ===================================================== */

  function scrollToBottom(
    behavior = "auto"
  ) {
    if (
      !state.autoScroll
    ) {
      return;
    }


    window.requestAnimationFrame(
      () => {
        if (
          scrollArea
        ) {
          try {
            scrollArea.scrollTo({
              top:
                scrollArea.scrollHeight,

              behavior
            });

          } catch {
            scrollArea.scrollTop =
              scrollArea.scrollHeight;
          }


          return;
        }


        chatMessages
          .lastElementChild
          ?.scrollIntoView
          ?.({
            block:
              "end",

            behavior
          });
      }
    );
  }


  /* =====================================================
     MESSAGE LOOKUP
     ===================================================== */

  function getMessageById(
    id
  ) {
    if (!id) {
      return null;
    }


    const safeId =
      escapeSelector(
        id
      );


    /*
    -------------------------------------------------------
    First check our own attribute.
    -------------------------------------------------------
    */

    const own =
      chatMessages
        .querySelector(
          `[data-neyo-message-id="${safeId}"]`
        );


    if (own) {
      return own;
    }


    /*
    -------------------------------------------------------
    Compatibility with chat.js v7.
    -------------------------------------------------------
    */

    return chatMessages
      .querySelector(
        `[data-message-id="${safeId}"]`
      );
  }


  /* =====================================================
     NORMALIZE MESSAGE
     ===================================================== */

  function normalizeMessage(
    input =
      {}
  ) {
    const role =
      input.role ===
        "user"
        ? "user"
        : "assistant";


    return {
      id:
        input.id ||
        createId(),

      role,

      content:
        typeof input.content ===
          "string"
          ? input.content
          : "",

      attachments:
        Array.isArray(
          input.attachments
        )
          ? input.attachments
          : [],

      sources:
        Array.isArray(
          input.sources
        )
          ? input.sources
          : [],

      thinking:
        Boolean(
          input.thinking
        ),

      error:
        Boolean(
          input.error
        ),

      index:
        Number.isInteger(
          input.index
        )
          ? input.index
          : null
    };
  }


  /* =====================================================
     ATTACHMENT ICON
     ===================================================== */

  function getAttachmentIcon(
    attachment
  ) {
    switch (
      attachment
        ?.category
    ) {
      case "image":
        return "image";

      case "audio":
        return "audio-lines";

      case "video":
        return "video";

      case "code":
        return "file-code-2";

      case "spreadsheet":
        return "table-2";

      case "presentation":
        return "presentation";

      case "archive":
        return "archive";

      case "data":
        return "database";

      default:
        return "file";
    }
  }


  /* =====================================================
     ATTACHMENT LIST
     ===================================================== */

  function createAttachments(
    attachments
  ) {
    if (
      !Array.isArray(
        attachments
      ) ||
      attachments.length === 0
    ) {
      return null;
    }


    const container =
      document.createElement(
        "div"
      );


    container.className =
      "message-attachments";


    attachments.forEach(
      attachment => {
        const chip =
          document.createElement(
            "div"
          );


        chip.className =
          "message-attachment";


        const icon =
          document.createElement(
            "i"
          );


        icon.setAttribute(
          "data-lucide",
          getAttachmentIcon(
            attachment
          )
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
          attachment?.name ||
          "Attachment";


        chip.append(
          icon,
          label
        );


        container.appendChild(
          chip
        );
      }
    );


    return container;
  }


  /* =====================================================
     THINKING CONTENT
     ===================================================== */

  function createThinkingContent() {
    const wrapper =
      document.createElement(
        "div"
      );


    wrapper.className =
      "neyo-thinking";


    wrapper.setAttribute(
      "aria-label",
      "NEYO is thinking"
    );


    const dot1 =
      document.createElement(
        "span"
      );

    const dot2 =
      document.createElement(
        "span"
      );

    const dot3 =
      document.createElement(
        "span"
      );


    dot1.className =
      "thinking-dot";

    dot2.className =
      "thinking-dot";

    dot3.className =
      "thinking-dot";


    wrapper.append(
      dot1,
      dot2,
      dot3
    );


    return wrapper;
  }


  /* =====================================================
     CREATE MESSAGE
     ===================================================== */

  function createMessage(
    input =
      {}
  ) {
    const message =
      normalizeMessage(
        input
      );


    /*
    -------------------------------------------------------
    DEDUPLICATION

    Critical because chat.js may already render a message.

    If same ID exists, do not create another bubble.
    -------------------------------------------------------
    */

    const existing =
      getMessageById(
        message.id
      );


    if (
      existing
    ) {
      return existing;
    }


    hideHero();


    const article =
      document.createElement(
        "article"
      );


    article.className =
      [
        "message",
        message.role,

        message.thinking
          ? "is-thinking"
          : "",

        message.error
          ? "message-error"
          : ""
      ]
        .filter(
          Boolean
        )
        .join(
          " "
        );


    article.dataset
      .neyoMessageId =
      message.id;


    article.dataset.role =
      message.role;


    if (
      message.index !==
      null
    ) {
      article.dataset
        .msgIndex =
        String(
          message.index
        );
    }


    /* ===================================================
       CONTENT
       =================================================== */

    const content =
      document.createElement(
        "div"
      );


    content.className =
      "message-content";


    if (
      message.thinking
    ) {
      content.appendChild(
        createThinkingContent()
      );

    } else {
      /*
      -----------------------------------------------------
      Safe default.

      Markdown belongs to message-renderer.js/chat.js.

      Never put unsanitized server HTML here.
      -----------------------------------------------------
      */

      content.textContent =
        message.content;
    }


    /* ===================================================
       USER
       =================================================== */

    if (
      message.role ===
      "user"
    ) {
      const wrapper =
        document.createElement(
          "div"
        );


      wrapper.className =
        "message-wrapper";


      const attachments =
        createAttachments(
          message.attachments
        );


      if (
        attachments
      ) {
        wrapper.appendChild(
          attachments
        );
      }


      wrapper.appendChild(
        content
      );


      article.appendChild(
        wrapper
      );

    } else {
      /* =================================================
         ASSISTANT
         ================================================= */

      article.appendChild(
        content
      );
    }


    chatMessages.appendChild(
      article
    );


    if (
      message.thinking
    ) {
      state.thinkingElement =
        article;


      state.thinkingId =
        message.id;
    }


    refreshIcons();


    scrollToBottom();


    window.dispatchEvent(
      new CustomEvent(
        "neyo:message-created",
        {
          detail: {
            message:
              article,

            data:
              message
          }
        }
      )
    );


    return article;
  }


  /* =====================================================
     UPDATE MESSAGE
     ===================================================== */

  function updateMessage(
    target,
    content =
      "",
    options =
      {}
  ) {
    let message =
      target;


    if (
      typeof target ===
      "string"
    ) {
      message =
        getMessageById(
          target
        );
    }


    if (
      !(message instanceof
        HTMLElement)
    ) {
      return false;
    }


    const contentElement =
      message.querySelector(
        ".message-content"
      );


    if (
      !contentElement
    ) {
      return false;
    }


    message.classList.remove(
      "is-thinking"
    );


    if (
      options.error ===
      true
    ) {
      message.classList.add(
        "message-error"
      );

    } else {
      message.classList.remove(
        "message-error"
      );
    }


    /*
    -------------------------------------------------------
    HTML is allowed ONLY when explicitly marked sanitized.

    options:
    {
      html: true,
      sanitized: true
    }
    -------------------------------------------------------
    */

    if (
      options.html ===
        true &&
      options.sanitized ===
        true
    ) {
      contentElement.innerHTML =
        String(
          content ?? ""
        );

    } else {
      contentElement.textContent =
        String(
          content ?? ""
        );
    }


    if (
      state.thinkingElement ===
      message
    ) {
      state.thinkingElement =
        null;


      state.thinkingId =
        null;
    }


    scrollToBottom();


    window.dispatchEvent(
      new CustomEvent(
        "neyo:message-updated",
        {
          detail: {
            message,

            content
          }
        }
      )
    );


    return true;
  }


  /* =====================================================
     REMOVE
     ===================================================== */

  function removeMessage(
    target
  ) {
    let message =
      target;


    if (
      typeof target ===
      "string"
    ) {
      message =
        getMessageById(
          target
        );
    }


    if (
      !(message instanceof
        HTMLElement)
    ) {
      return false;
    }


    if (
      state.thinkingElement ===
      message
    ) {
      state.thinkingElement =
        null;


      state.thinkingId =
        null;
    }


    message.remove();


    showHero();


    window.dispatchEvent(
      new CustomEvent(
        "neyo:message-removed"
      )
    );


    return true;
  }


  /* =====================================================
     THINKING
     ===================================================== */

  function showThinking() {
    /*
    -------------------------------------------------------
    Never create two thinking states.
    -------------------------------------------------------
    */

    if (
      state.thinkingElement
        ?.isConnected
    ) {
      return state
        .thinkingElement;
    }


    /*
    -------------------------------------------------------
    Compatibility check if chat.js already created one.
    -------------------------------------------------------
    */

    const existing =
      document
        .getElementById(
          "neyoThinkingIndicator"
        ) ||
      chatMessages
        .querySelector(
          ".message.is-thinking"
        );


    if (
      existing
    ) {
      state.thinkingElement =
        existing;


      state.thinkingId =
        existing.dataset
          ?.neyoMessageId ||
        existing.dataset
          ?.messageId ||
        null;


      return existing;
    }


    const id =
      `thinking_${createId()}`;


    return createMessage({
      id,

      role:
        "assistant",

      content:
        "",

      thinking:
        true
    });
  }


  function hideThinking() {
    /*
    -------------------------------------------------------
    Remove our tracked thinking element.
    -------------------------------------------------------
    */

    if (
      state.thinkingElement
        ?.isConnected
    ) {
      state.thinkingElement
        .remove();
    }


    state.thinkingElement =
      null;


    state.thinkingId =
      null;


    /*
    -------------------------------------------------------
    Compatibility cleanup.

    chat.js may create its own thinking indicator.
    -------------------------------------------------------
    */

    document
      .getElementById(
        "neyoThinkingIndicator"
      )
      ?.remove();


    chatMessages
      .querySelectorAll(
        ".message.is-thinking"
      )
      .forEach(
        element => {
          element.remove();
        }
      );
  }


  /* =====================================================
     CLEAR
     ===================================================== */

  function clearMessages() {
    hideThinking();


    chatMessages.replaceChildren();


    showHero();


    window.dispatchEvent(
      new CustomEvent(
        "neyo:messages-cleared"
      )
    );


    return true;
  }


  /* =====================================================
     CHAT.JS MESSAGE EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-message-added",
    event => {
      const message =
        event.detail
          ?.message;


      if (!message) {
        return;
      }


      /*
      -----------------------------------------------------
      If chat.js has already rendered the message,
      createMessage() simply returns the existing element.

      No duplicate bubble.
      -----------------------------------------------------
      */

      createMessage({
        id:
          message.id,

        role:
          message.role,

        content:
          message.content,

        attachments:
          message.attachments,

        sources:
          message.sources
      });
    }
  );


  /* =====================================================
     CHAT START
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {
      showThinking();
    }
  );


  /* =====================================================
     RESPONSE
     ===================================================== */

  window.addEventListener(
    "neyo:chat-response",
    () => {
      hideThinking();
    }
  );


  /* =====================================================
     ERROR
     ===================================================== */

  window.addEventListener(
    "neyo:chat-error",
    () => {
      hideThinking();
    }
  );


  /* =====================================================
     ABORT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-aborted",
    () => {
      hideThinking();
    }
  );


  /* =====================================================
     SEND END
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-end",
    () => {
      hideThinking();
    }
  );


  /* =====================================================
     NEW CHAT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      clearMessages();
    }
  );


  /* =====================================================
     STATE LOADED
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state-loaded",
    event => {
      const messages =
        event.detail
          ?.messages;


      if (
        !Array.isArray(
          messages
        )
      ) {
        return;
      }


      /*
      -----------------------------------------------------
      chat.js v7 may already render loaded history.

      Therefore DO NOT automatically clear/re-render here.

      Only ensure hero / scroll state.
      -----------------------------------------------------
      */

      if (
        messages.length >
        0
      ) {
        hideHero();


        scrollToBottom();

      } else {
        showHero();
      }
    }
  );


  /* =====================================================
     OLD PUBLIC EVENT API
     ===================================================== */

  window.addEventListener(
    "neyo:message-create",
    event => {
      createMessage(
        event.detail ||
        {}
      );
    }
  );


  window.addEventListener(
    "neyo:messages-clear",
    () => {
      clearMessages();
    }
  );


  window.addEventListener(
    "neyo:messages-scroll-bottom",
    () => {
      scrollToBottom(
        "smooth"
      );
    }
  );


  /* =====================================================
     AUTO-SCROLL CONTROL
     ===================================================== */

  function setAutoScroll(
    enabled
  ) {
    state.autoScroll =
      Boolean(
        enabled
      );
  }


  /* =====================================================
     PUBLIC API
     ===================================================== */

  const publicApi =
    Object.freeze({
      __controller:
        true,

      version:
        VERSION,

      create:
        createMessage,

      update:
        updateMessage,

      remove:
        removeMessage,

      clear:
        clearMessages,

      showThinking,

      hideThinking,

      scrollToBottom,

      setAutoScroll,

      getById:
        getMessageById,

      getContainer:
        () =>
          chatMessages,

      getState:
        () => ({
          version:
            VERSION,

          count:
            chatMessages
              .children
              .length,

          thinking:
            Boolean(
              state
                .thinkingElement
                ?.isConnected
            ),

          autoScroll:
            state.autoScroll
        })
    });


  Object.defineProperty(
    window,
    "NeyoMessages",
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

  console.log(
    "[NEYO Messages] ChatGPT-standard v7 ready.",
    {
      chatMessages:
        Boolean(
          chatMessages
        ),

      scrollArea:
        Boolean(
          scrollArea
        ),

      hero:
        Boolean(
          heroSection
        ),

      duplicateProtection:
        true,

      neoJsTouched:
        false
    }
  );


  window.dispatchEvent(
    new CustomEvent(
      "neyo:messages-ready",
      {
        detail: {
          version:
            VERSION
        }
      }
    )
  );

})();
