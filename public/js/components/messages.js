/*
=========================================================
NEYO — MESSAGES CORE
FINAL CLEAN v1

FILE:
public/js/components/messages.js

OWNS
---------------------------------------------------------
- Message DOM
- User / assistant message shells
- Thinking indicator
- Message updates
- Message removal
- Clear / replace conversation UI
- Auto-scroll
- Chat event rendering bridge

DOES NOT OWN
---------------------------------------------------------
- /api/chat
- Conversation state
- Markdown parsing
- Send button
- Enter key
- Attachment upload
- History API
- Copy / regenerate / share actions

EVENTS LISTENED
---------------------------------------------------------
- neyo:chat-message-added
- neyo:chat-send-start
- neyo:chat-response
- neyo:chat-error
- neyo:chat-aborted
- neyo:chat-send-end
- neyo:chat-state-loaded
- neyo:chat-new

PUBLIC API
---------------------------------------------------------
window.NeyoMessages.create(...)
window.NeyoMessages.update(...)
window.NeyoMessages.remove(...)
window.NeyoMessages.clear()
window.NeyoMessages.replace(...)
window.NeyoMessages.showThinking()
window.NeyoMessages.hideThinking()
window.NeyoMessages.getById(...)
window.NeyoMessages.scrollToBottom()
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-messages-final-clean-v1";


  if (
    window.NeyoMessages?.__controller ===
    true
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


  if (
    !chatMessages
  ) {
    console.warn(
      "[NEYO Messages] #chatMessages not found."
    );

    return;
  }


  /* =====================================================
     STATE
     ===================================================== */

  let thinkingElement =
    null;


  /* =====================================================
     HELPERS
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
      );
  }


  function safeSelector(
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


    return string
      .replace(
        /["\\]/g,
        "\\$&"
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
      heroSection.hidden =
        true;

      heroSection.style.display =
        "none";
    }
  }


  function showHeroIfEmpty() {
    if (
      !heroSection
    ) {
      return;
    }


    if (
      chatMessages
        .children
        .length ===
      0
    ) {
      heroSection.hidden =
        false;

      heroSection.style.display =
        "";
    }
  }


  /* =====================================================
     SCROLL
     ===================================================== */

  function scrollToBottom(
    behavior =
      "auto"
  ) {
    window.requestAnimationFrame(
      () => {
        if (
          scrollArea
        ) {
          try {
            scrollArea.scrollTo({
              top:
                scrollArea
                  .scrollHeight,

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
     LOOKUP
     ===================================================== */

  function getById(
    id
  ) {
    if (
      !id
    ) {
      return null;
    }


    return chatMessages
      .querySelector(
        `[data-message-id="${safeSelector(
          id
        )}"]`
      );
  }


  /* =====================================================
     ATTACHMENT PRESENTATION
     ===================================================== */

  function getAttachmentIcon(
    category
  ) {
    switch (
      category
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


  function createAttachmentList(
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
            attachment?.category
          )
        );


        icon.setAttribute(
          "size",
          "14"
        );


        const name =
          document.createElement(
            "span"
          );


        name.className =
          "message-attachment-name";


        name.textContent =
          attachment?.name ||
          "Attachment";


        chip.append(
          icon,
          name
        );


        wrapper.appendChild(
          chip
        );
      }
    );


    return wrapper;
  }


  /* =====================================================
     NORMALIZE INPUT
     ===================================================== */

  function normalizeMessage(
    input = {}
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
        cleanText(
          input.content
        ),

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

      error:
        Boolean(
          input.error
        )
    };
  }


  /* =====================================================
     CREATE MESSAGE
     ===================================================== */

  function create(
    input = {}
  ) {
    const data =
      normalizeMessage(
        input
      );


    const existing =
      getById(
        data.id
      );


    if (
      existing
    ) {
      return existing;
    }


    hideHero();


    const message =
      document.createElement(
        "article"
      );


    message.className =
      `message ${data.role}`;


    message.dataset
      .messageId =
      data.id;


    message.dataset.role =
      data.role;


    if (
      data.error
    ) {
      message.classList.add(
        "message-error"
      );
    }


    const content =
      document.createElement(
        "div"
      );


    content.className =
      "message-content";


    /*
    -------------------------------------------------------
    Important:
    Plain text only.

    message-renderer.js will later upgrade assistant content
    to Markdown safely.
    -------------------------------------------------------
    */

    content.textContent =
      data.content;


    if (
      data.role ===
      "user"
    ) {
      const wrapper =
        document.createElement(
          "div"
        );


      wrapper.className =
        "message-wrapper";


      const attachmentList =
        createAttachmentList(
          data.attachments
        );


      if (
        attachmentList
      ) {
        wrapper.appendChild(
          attachmentList
        );
      }


      wrapper.appendChild(
        content
      );


      message.appendChild(
        wrapper
      );

    } else {
      message.appendChild(
        content
      );
    }


    chatMessages.appendChild(
      message
    );


    refreshIcons();


    scrollToBottom();


    emit(
      "neyo:message-created",
      {
        element:
          message,

        message:
          data
      }
    );


    return message;
  }


  /* =====================================================
     UPDATE MESSAGE
     ===================================================== */

  function update(
    target,
    content = "",
    options = {}
  ) {
    const message =
      typeof target ===
        "string"
        ? getById(
            target
          )
        : target;


    if (
      !(
        message instanceof
        HTMLElement
      )
    ) {
      return false;
    }


    const contentElement =
      message
        .querySelector(
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

    } else if (
      options.error ===
      false
    ) {
      message.classList.remove(
        "message-error"
      );
    }


    /*
    -------------------------------------------------------
    messages.js stays safe by default.

    HTML is accepted only when another trusted renderer
    explicitly marks it sanitized.
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


    scrollToBottom();


    emit(
      "neyo:message-updated",
      {
        element:
          message,

        content
      }
    );


    return true;
  }


  /* =====================================================
     REMOVE MESSAGE
     ===================================================== */

  function remove(
    target
  ) {
    const message =
      typeof target ===
        "string"
        ? getById(
            target
          )
        : target;


    if (
      !(
        message instanceof
        HTMLElement
      )
    ) {
      return false;
    }


    if (
      message ===
      thinkingElement
    ) {
      thinkingElement =
        null;
    }


    message.remove();


    showHeroIfEmpty();


    emit(
      "neyo:message-removed"
    );


    return true;
  }


  /* =====================================================
     THINKING
     ===================================================== */

  function showThinking() {
    if (
      thinkingElement
        ?.isConnected
    ) {
      return thinkingElement;
    }


    hideHero();


    const message =
      document.createElement(
        "article"
      );


    message.className =
      "message assistant is-thinking";


    message.dataset
      .messageId =
      "neyo-thinking";


    const content =
      document.createElement(
        "div"
      );


    content.className =
      "message-content";


    const thinking =
      document.createElement(
        "div"
      );


    thinking.className =
      "message-thinking";


    thinking.setAttribute(
      "role",
      "status"
    );


    thinking.setAttribute(
      "aria-live",
      "polite"
    );


    thinking.setAttribute(
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
      "message-thinking-dot";


    dot2.className =
      "message-thinking-dot";


    dot3.className =
      "message-thinking-dot";


    thinking.append(
      dot1,
      dot2,
      dot3
    );


    content.appendChild(
      thinking
    );


    message.appendChild(
      content
    );


    chatMessages.appendChild(
      message
    );


    thinkingElement =
      message;


    scrollToBottom();


    emit(
      "neyo:message-thinking-start"
    );


    return message;
  }


  function hideThinking() {
    if (
      thinkingElement
        ?.isConnected
    ) {
      thinkingElement.remove();
    }


    thinkingElement =
      null;


    const stale =
      chatMessages
        .querySelector(
          '[data-message-id="neyo-thinking"]'
        );


    if (
      stale
    ) {
      stale.remove();
    }


    emit(
      "neyo:message-thinking-end"
    );
  }


  /* =====================================================
     CLEAR
     ===================================================== */

  function clear() {
    thinkingElement =
      null;


    chatMessages.replaceChildren();


    showHeroIfEmpty();


    emit(
      "neyo:messages-cleared"
    );


    return true;
  }


  /* =====================================================
     REPLACE CONVERSATION
     ===================================================== */

  function replace(
    messages = []
  ) {
    clear();


    if (
      !Array.isArray(
        messages
      ) ||
      messages.length ===
        0
    ) {
      return true;
    }


    hideHero();


    /*
    -------------------------------------------------------
    Use document fragment so history loading does not cause
    repeated layout/reflow for every message.
    -------------------------------------------------------
    */

    const fragment =
      document.createDocumentFragment();


    messages.forEach(
      input => {
        const data =
          normalizeMessage(
            input
          );


        const message =
          document.createElement(
            "article"
          );


        message.className =
          `message ${data.role}`;


        message.dataset
          .messageId =
          data.id;


        message.dataset.role =
          data.role;


        const content =
          document.createElement(
            "div"
          );


        content.className =
          "message-content";


        content.textContent =
          data.content;


        if (
          data.role ===
          "user"
        ) {
          const wrapper =
            document.createElement(
              "div"
            );


          wrapper.className =
            "message-wrapper";


          const attachmentList =
            createAttachmentList(
              data.attachments
            );


          if (
            attachmentList
          ) {
            wrapper.appendChild(
              attachmentList
            );
          }


          wrapper.appendChild(
            content
          );


          message.appendChild(
            wrapper
          );

        } else {
          message.appendChild(
            content
          );
        }


        fragment.appendChild(
          message
        );
      }
    );


    chatMessages.appendChild(
      fragment
    );


    refreshIcons();


    /*
    -------------------------------------------------------
    Tell renderer that a full conversation was replaced.

    message-renderer.js may upgrade assistant text afterwards.
    -------------------------------------------------------
    */

    emit(
      "neyo:messages-replaced",
      {
        messages
      }
    );


    scrollToBottom();


    return true;
  }


  /* =====================================================
     CHAT MESSAGE EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-message-added",
    event => {
      const message =
        event.detail
          ?.message;


      if (
        !message
      ) {
        return;
      }


      /*
      -------------------------------------------------------
      Assistant response replaces thinking indicator.
      -------------------------------------------------------
      */

      if (
        message.role ===
        "assistant"
      ) {
        hideThinking();
      }


      create(
        message
      );
    }
  );


  /* =====================================================
     GENERATION START
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
     ABORT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-aborted",
    () => {
      hideThinking();
    }
  );


  /* =====================================================
     LIMIT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-limit-reached",
    () => {
      hideThinking();
    }
  );


  /* =====================================================
     ERROR
     ===================================================== */

  window.addEventListener(
    "neyo:chat-error",
    event => {
      hideThinking();


      const error =
        event.detail
          ?.error;


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
        Number(
          error?.status
        ) >=
        500
      ) {
        message =
          "NEYO is temporarily unavailable. Please try again.";

      } else if (
        typeof error?.message ===
          "string" &&
        error.message.trim()
      ) {
        message =
          error.message.trim();
      }


      create({
        role:
          "assistant",

        content:
          `⚠️ ${message}`,

        error:
          true
      });
    }
  );


  /* =====================================================
     SEND END
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-end",
    () => {
      /*
       * Safety cleanup.
       *
       * Normally thinking is already removed by response/error/
       * abort, but send-end guarantees no stale indicator.
       */

      hideThinking();
    }
  );


  /* =====================================================
     STATE LOAD
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state-loaded",
    event => {
      const messages =
        event.detail
          ?.messages;


      replace(
        Array.isArray(
          messages
        )
          ? messages
          : []
      );
    }
  );


  /* =====================================================
     NEW CHAT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      clear();
    }
  );


  /* =====================================================
     OPTIONAL LEGACY EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:message-create",
    event => {
      create(
        event.detail ||
        {}
      );
    }
  );


  window.addEventListener(
    "neyo:messages-clear",
    () => {
      clear();
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
     PUBLIC API
     ===================================================== */

  const publicApi =
    Object.freeze({

      __controller:
        true,

      version:
        VERSION,

      create,

      update,

      remove,

      clear,

      replace,

      showThinking,

      hideThinking,

      getById,

      scrollToBottom,

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
              thinkingElement
                ?.isConnected
            )
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
     READY
     ===================================================== */

  emit(
    "neyo:messages-ready",
    {
      version:
        VERSION
    }
  );

})();
