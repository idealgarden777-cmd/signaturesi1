/*
=========================================================
NEYO — MESSAGES CORE
SAFE HYBRID PRODUCTION v2

FILE:
public/js/components/messages.js

OWNS
---------------------------------------------------------
✅ Modular message DOM shells
✅ User attachment cards
✅ Image attachment previews
✅ File name / type / size
✅ Source pills
✅ Thinking state
✅ Message updates
✅ Message removal
✅ History-loaded messages
✅ Clear messages
✅ Auto-scroll
✅ Hero visibility
✅ Compatibility replace()

DOES NOT OWN
---------------------------------------------------------
❌ /api/chat
❌ Conversation state
❌ Attachment upload
❌ Markdown parser
❌ Send button
❌ Enter key
❌ History persistence
❌ Copy/edit/regenerate/share business logic
❌ neo.js internals

IMPORTANT
---------------------------------------------------------
neo.js remains loaded and untouched.

Modular chat-runtime intercepts chat actions.
Therefore this module may safely render modular chat
events even while neo.js is physically present.

PIPELINE
---------------------------------------------------------
NeyoChat
   ↓
neyo:chat-message-added
   ↓
NeyoMessages
   ↓
NeyoMessageRenderer

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / DUPLICATE GUARD
     ===================================================== */

  const VERSION =
    "neyo-messages-safe-hybrid-v2";


  if (
    window.NeyoMessages
      ?.__controller ===
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


  /* =====================================================
     RUNTIME MODE
     ===================================================== */

  const legacyPresent =
    Array
      .from(
        document.scripts ||
        []
      )
      .some(
        script =>
          /(?:^|\/)neo\.js(?:\?|$)/
            .test(
              script.src ||
              ""
            )
      );


  /*
  -------------------------------------------------------
  CRITICAL FIX

  OLD:
      active = chatMessages && !legacyPresent

  That disabled modular message rendering whenever
  neo.js was physically loaded.

  NEW:
      neo.js may remain loaded, but modular chat-runtime
      is authoritative for chat actions.

  Therefore messages.js renders modular chat events.
  -------------------------------------------------------
  */

  const active =
    Boolean(
      chatMessages
    );


  /* =====================================================
     STATE
     ===================================================== */

  let nearBottom =
    true;


  let thinkingElement =
    null;


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
        {
          detail
        }
      )
    );
  }


  /* =====================================================
     CLEAN TEXT
     ===================================================== */

  function clean(
    value,
    max =
      50_000
  ) {
    return String(
      value ??
      ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .replace(
        /\r\n?/g,
        "\n"
      )
      .slice(
        0,
        max
      );
  }


  /* =====================================================
     ID
     ===================================================== */

  function makeId() {
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
     FORMAT BYTES
     ===================================================== */

  function formatBytes(
    bytes
  ) {
    let value =
      Math.max(
        0,
        Number(
          bytes
        ) ||
        0
      );


    if (
      value <
      1024
    ) {
      return `${value} B`;
    }


    const units =
      [
        "KB",
        "MB",
        "GB"
      ];


    value /=
      1024;


    let index =
      0;


    while (
      value >=
        1024 &&
      index <
        units.length -
          1
    ) {
      value /=
        1024;

      index +=
        1;
    }


    return `${
      value >= 10
        ? value.toFixed(0)
        : value.toFixed(1)
    } ${units[index]}`;
  }


  /* =====================================================
     EXTENSION
     ===================================================== */

  function extensionOf(
    name
  ) {
    return String(
      name ||
      ""
    )
      .toLowerCase()
      .match(
        /\.([a-z0-9]+)$/
      )
      ?.[1] ||
      "";
  }


  /* =====================================================
     FILE LABEL
     ===================================================== */

  function fileTypeLabel(
    file
  ) {
    const extension =
      extensionOf(
        file?.name
      );


    if (
      extension
    ) {
      return extension
        .toUpperCase();
    }


    const category =
      clean(
        file?.category ||
        "",
        30
      )
        .trim();


    if (
      category &&
      category !==
        "unknown"
    ) {
      return (
        category
          .charAt(0)
          .toUpperCase() +
        category.slice(1)
      );
    }


    return "File";
  }


  /* =====================================================
     FILE ICON
     ===================================================== */

  function attachmentIcon(
    file
  ) {
    const category =
      clean(
        file?.category ||
        "",
        40
      )
        .toLowerCase();


    const mime =
      clean(
        file?.mimeType ||
        file?.mime ||
        file?.type ||
        "",
        180
      )
        .toLowerCase();


    const extension =
      extensionOf(
        file?.name
      );


    if (
      category ===
        "image" ||
      mime.startsWith(
        "image/"
      )
    ) {
      return "image";
    }


    if (
      category ===
        "spreadsheet" ||
      [
        "xls",
        "xlsx",
        "xlsm",
        "xlsb",
        "csv",
        "tsv",
        "ods"
      ].includes(
        extension
      )
    ) {
      return "sheet";
    }


    if (
      category ===
        "presentation" ||
      [
        "ppt",
        "pptx",
        "odp"
      ].includes(
        extension
      )
    ) {
      return "presentation";
    }


    if (
      category ===
        "code"
    ) {
      return "file-code-2";
    }


    if (
      category ===
        "archive"
    ) {
      return "archive";
    }


    if (
      category ===
        "audio" ||
      mime.startsWith(
        "audio/"
      )
    ) {
      return "audio-lines";
    }


    if (
      category ===
        "video" ||
      mime.startsWith(
        "video/"
      )
    ) {
      return "video";
    }


    if (
      category ===
        "data"
    ) {
      return "database";
    }


    return "file-text";
  }


  /* =====================================================
     SAFE PREVIEW
     ===================================================== */

  function safePreview(
    value
  ) {
    const raw =
      clean(
        value,
        5000
      )
        .trim();


    if (
      !raw
    ) {
      return "";
    }


    if (
      /^(blob:|data:image\/)/i
        .test(
          raw
        )
    ) {
      return raw;
    }


    try {
      const url =
        new URL(
          raw,
          location.origin
        );


      if (
        ![
          "http:",
          "https:"
        ].includes(
          url.protocol
        )
      ) {
        return "";
      }


      return url.href;

    } catch {
      return "";
    }
  }


  /* =====================================================
     MESSAGE LOOKUP
     ===================================================== */

  function findMessage(
    id
  ) {
    if (
      !chatMessages ||
      !id
    ) {
      return null;
    }


    return Array
      .from(
        chatMessages
          .querySelectorAll(
            "[data-neyo-message-id]"
          )
      )
      .find(
        node =>
          node.dataset
            .neyoMessageId ===
          String(
            id
          )
      ) ||
      null;
  }


  /* =====================================================
     HERO
     ===================================================== */

  function updateHero() {
    if (
      !active ||
      !heroSection
    ) {
      return;
    }


    const hasMessages =
      Boolean(
        chatMessages
          .querySelector(
            '[data-neyo-message-id]:not([data-neyo-message-id="neyo-thinking"])'
          )
      );


    heroSection.style.display =
      hasMessages
        ? "none"
        : "";


    heroSection.setAttribute(
      "aria-hidden",
      String(
        hasMessages
      )
    );
  }


  /* =====================================================
     SCROLL STATE
     ===================================================== */

  function atBottom() {
    if (
      !scrollArea
    ) {
      return true;
    }


    return (
      scrollArea.scrollHeight -
      scrollArea.scrollTop -
      scrollArea.clientHeight
    ) <=
      120;
  }


  function scrollToBottom(
    behavior =
      "auto",
    force =
      false
  ) {
    if (
      !active ||
      !scrollArea ||
      (
        !force &&
        !nearBottom
      )
    ) {
      return false;
    }


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


    nearBottom =
      true;


    return true;
  }


  /* =====================================================
     NORMALIZE ATTACHMENTS
     ===================================================== */

  function normalizeAttachments(
    files
  ) {
    if (
      !Array.isArray(
        files
      )
    ) {
      return [];
    }


    return files
      .filter(
        file =>
          file &&
          typeof file ===
            "object"
      )
      .slice(
        0,
        5
      )
      .map(
        file => ({
          ...file,

          name:
            clean(
              file.name ||
              "Attached file",
              220
            ),

          size:
            Math.max(
              0,
              Number(
                file.size
              ) ||
              0
            ),

          mimeType:
            clean(
              file.mimeType ||
              file.mime ||
              file.type ||
              "application/octet-stream",
              180
            ),

          category:
            clean(
              file.category ||
              "unknown",
              40
            )
        })
      );
  }


  /* =====================================================
     RENDER SINGLE FILE CARD
     ===================================================== */

  function createFileCard(
    file
  ) {
    const card =
      document.createElement(
        "div"
      );


    card.className =
      "message-file-pill neyo-message-file-card";


    card.setAttribute(
      "role",
      "group"
    );


    const name =
      clean(
        file?.name ||
        "Attached file",
        220
      );


    card.title =
      name;


    const preview =
      safePreview(
        file?.previewUrl ||
        file?.url ||
        ""
      );


    const mime =
      clean(
        file?.mimeType ||
        file?.mime ||
        file?.type ||
        "",
        180
      )
        .toLowerCase();


    const category =
      clean(
        file?.category ||
        "",
        40
      )
        .toLowerCase();


    const isImage =
      category ===
        "image" ||
      mime.startsWith(
        "image/"
      );


    /* ===============================================
       VISUAL
       =============================================== */

    const visual =
      document.createElement(
        "div"
      );


    visual.className =
      "neyo-message-file-visual";


    if (
      isImage &&
      preview
    ) {
      const image =
        document.createElement(
          "img"
        );


      image.src =
        preview;


      image.alt =
        name;


      image.loading =
        "lazy";


      image.decoding =
        "async";


      visual.appendChild(
        image
      );

    } else {
      const icon =
        document.createElement(
          "i"
        );


      icon.setAttribute(
        "data-lucide",
        attachmentIcon(
          file
        )
      );


      icon.setAttribute(
        "aria-hidden",
        "true"
      );


      visual.appendChild(
        icon
      );
    }


    /* ===============================================
       BODY
       =============================================== */

    const body =
      document.createElement(
        "div"
      );


    body.className =
      "neyo-message-file-body";


    const nameElement =
      document.createElement(
        "div"
      );


    nameElement.className =
      "neyo-message-file-name";


    nameElement.textContent =
      name;


    const meta =
      document.createElement(
        "div"
      );


    meta.className =
      "neyo-message-file-meta";


    const parts =
      [];


    if (
      Number(
        file?.size
      ) >
      0
    ) {
      parts.push(
        formatBytes(
          file.size
        )
      );
    }


    const typeLabel =
      fileTypeLabel(
        file
      );


    if (
      typeLabel
    ) {
      parts.push(
        typeLabel
      );
    }


    meta.textContent =
      parts.join(
        " · "
      );


    body.appendChild(
      nameElement
    );


    body.appendChild(
      meta
    );


    card.appendChild(
      visual
    );


    card.appendChild(
      body
    );


    return card;
  }


  /* =====================================================
     RENDER ATTACHMENTS
     ===================================================== */

  function renderAttachments(
    wrapper,
    files
  ) {
    const attachments =
      normalizeAttachments(
        files
      );


    if (
      attachments.length ===
      0
    ) {
      return null;
    }


    const root =
      document.createElement(
        "div"
      );


    root.className =
      "message-media-grid neyo-message-attachments";


    root.setAttribute(
      "aria-label",
      attachments.length ===
        1
        ? "1 attached file"
        : `${attachments.length} attached files`
    );


    for (
      const file
      of attachments
    ) {
      root.appendChild(
        createFileCard(
          file
        )
      );
    }


    /*
    -------------------------------------------------------
    ChatGPT-style:
    attachments are displayed ABOVE user text.
    -------------------------------------------------------
    */

    wrapper.prepend(
      root
    );


    return root;
  }


  /* =====================================================
     SOURCES
     ===================================================== */

  function normalizeSource(
    source
  ) {
    const value =
      source?.url ||
      source?.uri ||
      source?.link ||
      source?.web?.uri ||
      "";


    try {
      const url =
        new URL(
          value
        );


      if (
        ![
          "http:",
          "https:"
        ].includes(
          url.protocol
        )
      ) {
        return null;
      }


      return {
        url:
          url.href,

        label:
          clean(
            source?.title ||
            source?.name ||
            source?.web?.title ||
            url.hostname.replace(
              /^www\./,
              ""
            ),
            160
          )
      };

    } catch {
      return null;
    }
  }


  function renderSources(
    messageElement,
    sources
  ) {
    if (
      !Array.isArray(
        sources
      ) ||
      sources.length ===
        0
    ) {
      return;
    }


    const valid =
      sources
        .slice(
          0,
          10
        )
        .map(
          normalizeSource
        )
        .filter(
          Boolean
        );


    if (
      valid.length ===
      0
    ) {
      return;
    }


    const root =
      document.createElement(
        "div"
      );


    root.className =
      "neo-source-pills";


    root.setAttribute(
      "aria-label",
      "Sources"
    );


    const title =
      document.createElement(
        "span"
      );


    title.className =
      "neo-source-label";


    title.textContent =
      "Sources";


    root.appendChild(
      title
    );


    for (
      const source
      of valid
    ) {
      const link =
        document.createElement(
          "a"
        );


      link.className =
        "neo-source-pill";


      link.href =
        source.url;


      link.target =
        "_blank";


      link.rel =
        "noopener noreferrer";


      link.textContent =
        source.label ||
        "Source";


      link.title =
        link.textContent;


      root.appendChild(
        link
      );
    }


    messageElement.appendChild(
      root
    );
  }


  /* =====================================================
     CONTENT
     ===================================================== */

  function renderContent(
    element,
    message,
    markdown =
      true
  ) {
    const content =
      element.querySelector(
        ".message-content"
      );


    if (
      !content
    ) {
      return false;
    }


    const text =
      clean(
        message?.content
      );


    /* ===============================================
       USER = PLAIN TEXT
       =============================================== */

    if (
      message.role !==
      "assistant"
    ) {
      content.textContent =
        text;


      /*
      Attachment-only messages should not display the
      internal fallback API prompt if it matches our
      canonical attachment-only text.
      */

      if (
        Array.isArray(
          message.attachments
        ) &&
        message.attachments.length >
          0 &&
        (
          text ===
            "Please analyze the attached file or files." ||
          text ===
            "Please analyze the attached file."
        )
      ) {
        content.textContent =
          "";
      }


      content.hidden =
        content.textContent
          .trim()
          .length ===
        0;


      return true;
    }


    /* ===============================================
       ASSISTANT FALLBACK
       =============================================== */

    content.hidden =
      false;


    content.textContent =
      text;


    if (
      typeof window
        .NeyoMessageRenderer
        ?.render ===
      "function"
    ) {
      try {
        window
          .NeyoMessageRenderer
          .render(
            element,
            text,
            {
              role:
                "assistant",

              markdown
            }
          );

      } catch (
        error
      ) {
        console.warn(
          "[NEYO Messages] Renderer failed:",
          error
        );
      }

    } else {
      emit(
        "neyo:message-render-request",
        {
          message:
            element,

          content:
            text,

          options: {
            role:
              "assistant",

            markdown
          }
        }
      );
    }


    return true;
  }


  /* =====================================================
     CREATE MESSAGE
     ===================================================== */

  function create(
    message,
    options = {}
  ) {
    if (
      !active ||
      !message ||
      ![
        "user",
        "assistant"
      ].includes(
        message.role
      )
    ) {
      return null;
    }


    const id =
      clean(
        message.id,
        128
      )
        .trim() ||
      makeId();


    /*
    Duplicate-event protection.
    */

    const existing =
      findMessage(
        id
      );


    if (
      existing
    ) {
      return existing;
    }


    if (
      message.role ===
      "assistant"
    ) {
      removeThinking();
    }


    const element =
      document.createElement(
        "div"
      );


    element.className =
      `message ${message.role}`;


    element.dataset
      .neyoMessageId =
      id;


    element.dataset
      .messageId =
      id;


    element.dataset.role =
      message.role;


    if (
      message.error ===
      true
    ) {
      element.classList.add(
        "is-error"
      );


      element.dataset.error =
        "true";
    }


    if (
      options.historyLoad
    ) {
      element.dataset
        .historyLoad =
        "true";
    }


    /* =================================================
       USER
       ================================================= */

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


      const content =
        document.createElement(
          "div"
        );


      content.className =
        "message-content";


      wrapper.appendChild(
        content
      );


      /*
      Attachments appear above content.
      */

      renderAttachments(
        wrapper,
        message.attachments
      );


      element.appendChild(
        wrapper
      );
    }


    /* =================================================
       ASSISTANT
       ================================================= */

    else {
      const content =
        document.createElement(
          "div"
        );


      content.className =
        "message-content";


      element.appendChild(
        content
      );
    }


    chatMessages.appendChild(
      element
    );


    renderContent(
      element,
      message,
      true
    );


    if (
      message.role ===
      "assistant"
    ) {
      renderSources(
        element,
        message.sources
      );
    }


    updateHero();

    refreshIcons();


    emit(
      "neyo:message-shell-created",
      {
        id,

        element,

        message: {
          ...message,

          id
        }
      }
    );


    requestAnimationFrame(
      () => {
        scrollToBottom(
          "auto",
          message.role ===
            "user" ||
          Boolean(
            options.forceScroll
          )
        );
      }
    );


    return element;
  }


  /* =====================================================
     UPDATE ATTACHMENTS ON EXISTING MESSAGE
     ===================================================== */

  function updateAttachments(
    element,
    attachments
  ) {
    if (
      !element ||
      element.dataset.role !==
        "user"
    ) {
      return false;
    }


    const wrapper =
      element.querySelector(
        ".message-wrapper"
      );


    if (
      !wrapper
    ) {
      return false;
    }


    wrapper
      .querySelector(
        ".neyo-message-attachments"
      )
      ?.remove();


    renderAttachments(
      wrapper,
      attachments
    );


    refreshIcons();


    return true;
  }


  /* =====================================================
     UPDATE MESSAGE
     ===================================================== */

  function update(
    id,
    content,
    options = {}
  ) {
    if (
      !active
    ) {
      return false;
    }


    const element =
      findMessage(
        id
      );


    if (
      !element
    ) {
      return false;
    }


    const role =
      element.dataset.role ||
      "assistant";


    renderContent(
      element,
      {
        role,

        content,

        attachments:
          options.attachments
      },
      options.markdown ??
        true
    );


    if (
      Array.isArray(
        options.attachments
      )
    ) {
      updateAttachments(
        element,
        options.attachments
      );
    }


    element.classList.toggle(
      "is-error",
      options.error ===
        true
    );


    element.dataset.error =
      options.error ===
        true
        ? "true"
        : "false";


    emit(
      "neyo:message-updated",
      {
        id,

        element,

        content:
          clean(
            content
          )
      }
    );


    requestAnimationFrame(
      () => {
        scrollToBottom(
          "auto",
          false
        );
      }
    );


    return true;
  }


  /* =====================================================
     REMOVE MESSAGE
     ===================================================== */

  function remove(
    id
  ) {
    if (
      !active
    ) {
      return false;
    }


    const element =
      findMessage(
        id
      );


    if (
      !element
    ) {
      return false;
    }


    element.remove();


    updateHero();


    emit(
      "neyo:message-removed",
      {
        id
      }
    );


    return true;
  }


  /* =====================================================
     THINKING
     ===================================================== */

  function showThinking() {
    if (
      !active
    ) {
      return null;
    }


    removeThinking();


    const element =
      document.createElement(
        "div"
      );


    element.id =
      "neyoThinkingIndicator";


    element.className =
      "message assistant is-thinking";


    element.dataset
      .neyoMessageId =
      "neyo-thinking";


    element.dataset
      .messageId =
      "neyo-thinking";


    element.dataset.role =
      "assistant";


    element.setAttribute(
      "aria-live",
      "polite"
    );


    const content =
      document.createElement(
        "div"
      );


    content.className =
      "message-content";


    const shimmer =
      document.createElement(
        "span"
      );


    shimmer.className =
      "thinking-shimmer";


    shimmer.textContent =
      "Thinking.";


    content.appendChild(
      shimmer
    );


    element.appendChild(
      content
    );


    chatMessages.appendChild(
      element
    );


    thinkingElement =
      element;


    updateHero();


    requestAnimationFrame(
      () => {
        scrollToBottom(
          "auto",
          true
        );
      }
    );


    emit(
      "neyo:thinking-shown",
      {
        element
      }
    );


    return element;
  }


  function removeThinking() {
    if (
      !active
    ) {
      return false;
    }


    const element =
      thinkingElement ||
      document.getElementById(
        "neyoThinkingIndicator"
      ) ||
      findMessage(
        "neyo-thinking"
      );


    thinkingElement =
      null;


    if (
      !element
    ) {
      return false;
    }


    element.remove();


    updateHero();


    emit(
      "neyo:thinking-hidden"
    );


    return true;
  }


  /* =====================================================
     CLEAR
     ===================================================== */

  function clear() {
    if (
      !active ||
      !chatMessages
    ) {
      return false;
    }


    thinkingElement =
      null;


    chatMessages
      .replaceChildren();


    nearBottom =
      true;


    updateHero();


    emit(
      "neyo:messages-cleared"
    );


    return true;
  }


  /* =====================================================
     REPLACE / HISTORY COMPATIBILITY
     ===================================================== */

  function replace(
    messages = [],
    options = {}
  ) {
    if (
      !active
    ) {
      return false;
    }


    clear();


    if (
      !Array.isArray(
        messages
      )
    ) {
      return false;
    }


    for (
      const message
      of messages
    ) {
      create(
        message,
        {
          historyLoad:
            true,

          forceScroll:
            false,

          ...options
        }
      );
    }


    updateHero();


    requestAnimationFrame(
      () => {
        scrollToBottom(
          "auto",
          true
        );
      }
    );


    return true;
  }


  /* =====================================================
     EVENT OWNERSHIP
     ===================================================== */

  if (
    active
  ) {
    scrollArea
      ?.addEventListener(
        "scroll",
        () => {
          nearBottom =
            atBottom();
        },
        {
          passive:
            true
        }
      );


    /* =================================================
       CHAT MESSAGE ADDED
       ================================================= */

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


        create(
          message,
          {
            historyLoad:
              Boolean(
                event.detail
                  ?.historyLoad
              )
          }
        );
      }
    );


    /* =================================================
       CHAT MESSAGE REMOVED
       ================================================= */

    window.addEventListener(
      "neyo:chat-message-removed",
      event => {
        const id =
          event.detail
            ?.message
            ?.id ||
          event.detail
            ?.id;


        if (
          id
        ) {
          remove(
            id
          );
        }
      }
    );


    /* =================================================
       GENERATION
       ================================================= */

    window.addEventListener(
      "neyo:chat-send-start",
      showThinking
    );


    window.addEventListener(
      "neyo:chat-response",
      removeThinking
    );


    window.addEventListener(
      "neyo:chat-send-end",
      removeThinking
    );


    window.addEventListener(
      "neyo:chat-aborted",
      removeThinking
    );


    window.addEventListener(
      "neyo:chat-error",
      removeThinking
    );


    /* =================================================
       CLEAR
       ================================================= */

    window.addEventListener(
      "neyo:messages-clear",
      clear
    );


    /* =================================================
       UPDATE
       ================================================= */

    window.addEventListener(
      "neyo:message-update-request",
      event => {
        update(
          event.detail
            ?.id,

          event.detail
            ?.content,

          event.detail
            ?.options ||
          {}
        );
      }
    );


    /* =================================================
       OPTIONAL REPLACE BRIDGE
       ================================================= */

    window.addEventListener(
      "neyo:messages-replace",
      event => {
        replace(
          event.detail
            ?.messages ||
          event.detail
            ?.conversation ||
          []
        );
      }
    );


    updateHero();
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
        legacyPresent,

      create,

      update,

      remove,

      clear,

      replace,

      showThinking,

      removeThinking,

      scrollToBottom,

      getElement:
        findMessage,

      getContainer:
        () =>
          chatMessages,

      getState:
        () => ({
          version:
            VERSION,

          active,

          legacyOwnerActive:
            legacyPresent,

          nearBottom,

          thinking:
            Boolean(
              thinkingElement
            ),

          messageCount:
            active
              ? chatMessages
                  .querySelectorAll(
                    '[data-neyo-message-id]:not([data-neyo-message-id="neyo-thinking"])'
                  )
                  .length
              : 0
        })
    });


  Object.defineProperty(
    window,
    "NeyoMessages",
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


  /* =====================================================
     READY
     ===================================================== */

  emit(
    "neyo:messages-ready",
    {
      version:
        VERSION,

      active,

      legacyOwnerActive:
        legacyPresent,

      safeHybrid:
        true
    }
  );


  console.log(
    "[NEYO Messages] SAFE HYBRID v2 READY",
    {
      active,

      neoPresent:
        legacyPresent,

      attachmentRendering:
        true,

      replaceCompatibility:
        true
    }
  );

})();
