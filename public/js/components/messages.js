/*
=========================================================
NEO — MESSAGES CORE
Production v1

Owns:
- message DOM shells
- user attachment cards
- source pills
- thinking state
- message DOM updates
- message removal
- message clearing
- smart auto-scroll
- hero visibility
- history render compatibility

Does NOT own:
- /api/chat
- conversation state
- markdown parser
- Send / Stop
- attachment upload
- edit/regenerate/share business logic
- history persistence
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-messages-production-v1";

  if (
    window.NeyoMessages
      ?.__controller === true
  ) {
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
      "[NEO Messages] #chatMessages is missing."
    );

    return;
  }

  /* =====================================================
     STATE
     ===================================================== */

  let nearBottom =
    true;

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
        { detail }
      )
    );
  }

  function clean(
    value,
    max = 50_000
  ) {
    return String(
      value ?? ""
    )
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .slice(0, max);
  }

  function makeId() {
    return (
      globalThis.crypto
        ?.randomUUID
        ?.() ||
      `msg_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`
    );
  }

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  function safeSelectorId(
    id
  ) {
    try {
      return CSS.escape(
        String(id)
      );
    } catch {
      return String(id)
        .replace(
          /["\\]/g,
          "\\$&"
        );
    }
  }

  /* =====================================================
     MESSAGE LOOKUP
     ===================================================== */

  function findMessage(
    id
  ) {
    if (!id) {
      return null;
    }

    return (
      chatMessages.querySelector(
        `[data-neyo-message-id="${safeSelectorId(id)}"]`
      ) ||
      null
    );
  }

  /* =====================================================
     HERO
     ===================================================== */

  function updateHero() {
    if (!heroSection) {
      return;
    }

    const hasMessages =
      Boolean(
        chatMessages.querySelector(
          '[data-neyo-message-id]:not([data-neyo-message-id="neyo-thinking"])'
        )
      );

    /*
     * Preserve existing hero display behavior.
     * Do not redesign hero from messages.js.
     */

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

    emit(
      "neyo:hero-state-change",
      {
        visible:
          !hasMessages
      }
    );
  }

  /* =====================================================
     SCROLL
     ===================================================== */

  function atBottom() {
    if (!scrollArea) {
      return true;
    }

    return (
      scrollArea.scrollHeight -
      scrollArea.scrollTop -
      scrollArea.clientHeight
    ) <= 120;
  }

  function scrollToBottom(
    behavior = "auto",
    force = false
  ) {
    if (
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

  scrollArea?.addEventListener(
    "scroll",
    () => {
      nearBottom =
        atBottom();
    },
    {
      passive: true
    }
  );

  /* =====================================================
     ATTACHMENT HELPERS
     ===================================================== */

  function normalizeAttachments(
    files
  ) {
    if (!Array.isArray(files)) {
      return [];
    }

    return files
      .filter(
        file =>
          file &&
          typeof file === "object"
      )
      .slice(
        0,
        5
      )
      .map(file => ({
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
            ) || 0
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
      }));
  }

  function formatBytes(
    bytes
  ) {
    const value =
      Number(bytes) || 0;

    if (!value) {
      return "";
    }

    if (value < 1024) {
      return `${value} B`;
    }

    if (
      value <
      1024 ** 2
    ) {
      return (
        `${(
          value /
          1024
        ).toFixed(1)} KB`
      );
    }

    if (
      value <
      1024 ** 3
    ) {
      return (
        `${(
          value /
          1024 ** 2
        ).toFixed(1)} MB`
      );
    }

    return (
      `${(
        value /
        1024 ** 3
      ).toFixed(2)} GB`
    );
  }

  function fileTypeLabel(
    file
  ) {
    const extension =
      clean(
        file?.extension ||
        "",
        20
      )
        .replace(/^\./, "")
        .toUpperCase();

    if (extension) {
      return extension;
    }

    const category =
      clean(
        file?.category ||
        "",
        40
      );

    if (
      category &&
      category !== "unknown"
    ) {
      return (
        category.charAt(0)
          .toUpperCase() +
        category.slice(1)
      );
    }

    return "File";
  }

  function attachmentIcon(
    file
  ) {
    const mime =
      clean(
        file?.mimeType ||
        file?.mime ||
        file?.type ||
        "",
        180
      ).toLowerCase();

    const category =
      clean(
        file?.category ||
        "",
        40
      ).toLowerCase();

    if (
      category === "image" ||
      mime.startsWith("image/")
    ) {
      return "image";
    }

    if (
      category === "audio" ||
      mime.startsWith("audio/")
    ) {
      return "audio-lines";
    }

    if (
      category === "video" ||
      mime.startsWith("video/")
    ) {
      return "video";
    }

    if (
      category === "spreadsheet"
    ) {
      return "table-2";
    }

    if (
      category === "presentation"
    ) {
      return "presentation";
    }

    if (
      category === "archive"
    ) {
      return "archive";
    }

    if (
      category === "code"
    ) {
      return "file-code-2";
    }

    if (
      category === "data"
    ) {
      return "database";
    }

    return "file-text";
  }

  /* =====================================================
     SAFE PREVIEW

     Only URLs already supplied by the attachment layer
     may be displayed here.

     messages.js does NOT generate storage URLs.
     ===================================================== */

  function safePreview(
    value
  ) {
    const url =
      String(
        value || ""
      ).trim();

    if (!url) {
      return null;
    }

    if (
      url.startsWith(
        "blob:"
      ) ||
      url.startsWith(
        "data:image/"
      )
    ) {
      return url;
    }

    try {
      const parsed =
        new URL(
          url,
          window.location.href
        );

      if (
        parsed.protocol ===
          "https:" ||
        parsed.protocol ===
          "http:"
      ) {
        return parsed.href;
      }

    } catch {}

    return null;
  }

  /* =====================================================
     FILE CARD
     ===================================================== */

  function createFileCard(
    file
  ) {
    const card =
      document.createElement(
        "div"
      );

    /*
     * Preserve existing production CSS contracts.
     */

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

    const mime =
      clean(
        file?.mimeType ||
        file?.mime ||
        file?.type ||
        "",
        180
      ).toLowerCase();

    const category =
      clean(
        file?.category ||
        "",
        40
      ).toLowerCase();

    const isImage =
      category === "image" ||
      mime.startsWith(
        "image/"
      );

    const preview =
      safePreview(
        file?.previewUrl ||
        file?.signedUrl ||
        file?.url ||
        ""
      );

    /* -----------------------------------------------
       Visual
       ----------------------------------------------- */

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

      image.draggable =
        false;

      image.addEventListener(
        "error",
        () => {
          image.remove();

          const icon =
            document.createElement(
              "i"
            );

          icon.setAttribute(
            "data-lucide",
            "image"
          );

          icon.setAttribute(
            "aria-hidden",
            "true"
          );

          visual.appendChild(
            icon
          );

          refreshIcons();
        },
        {
          once: true
        }
      );

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

    /* -----------------------------------------------
       Body
       ----------------------------------------------- */

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

    const parts = [];

    const size =
      formatBytes(
        file?.size
      );

    if (size) {
      parts.push(size);
    }

    const type =
      fileTypeLabel(
        file
      );

    if (type) {
      parts.push(type);
    }

    meta.textContent =
      parts.join(
        " · "
      );

    body.append(
      nameElement,
      meta
    );

    card.append(
      visual,
      body
    );

    return card;
  }

  /* =====================================================
     ATTACHMENT GRID
     ===================================================== */

  function renderAttachments(
    wrapper,
    files
  ) {
    const attachments =
      normalizeAttachments(
        files
      );

    if (!attachments.length) {
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
      attachments.length === 1
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
     * Existing ChatGPT-style layout:
     * attachments ABOVE user text.
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
    if (
      !source ||
      typeof source !== "object"
    ) {
      return null;
    }

    const value =
      source.url ||
      source.uri ||
      source.link ||
      source.web?.uri ||
      "";

    try {
      const url =
        new URL(
          value
        );

      if (
        url.protocol !== "http:" &&
        url.protocol !== "https:"
      ) {
        return null;
      }

      return {
        url:
          url.href,

        label:
          clean(
            source.title ||
            source.name ||
            source.web?.title ||
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

  function removeSources(
    element
  ) {
    element
      ?.querySelector(
        ".neo-source-pills"
      )
      ?.remove();
  }

  function renderSources(
    element,
    sources
  ) {
    removeSources(
      element
    );

    if (
      !Array.isArray(
        sources
      )
    ) {
      return false;
    }

    const valid =
      sources
        .slice(0, 10)
        .map(
          normalizeSource
        )
        .filter(Boolean);

    if (!valid.length) {
      return false;
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

    const label =
      document.createElement(
        "span"
      );

    label.className =
      "neo-source-label";

    label.textContent =
      "Sources";

    root.appendChild(
      label
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

    element.appendChild(
      root
    );

    return true;
  }

  /* =====================================================
     DISPLAY CONTENT
     ===================================================== */

  function visibleUserText(
    message
  ) {
    if (
      typeof message?.displayContent ===
      "string"
    ) {
      return clean(
        message.displayContent
      );
    }

    const text =
      clean(
        message?.content
      );

    /*
     * Compatibility with older stored attachment-only
     * messages that did not have displayContent.
     */

    if (
      Array.isArray(
        message?.attachments
      ) &&
      message.attachments.length &&
      (
        text ===
          "Please analyze the attached file or files." ||
        text ===
          "Please analyze the attached file."
      )
    ) {
      return "";
    }

    return text;
  }

  /* =====================================================
     RENDER CONTENT
     ===================================================== */

  function renderContent(
    element,
    message,
    markdown = true
  ) {
    const content =
      element.querySelector(
        ".message-content"
      );

    if (!content) {
      return false;
    }

    /* -----------------------------------------------
       User = plain text
       ----------------------------------------------- */

    if (
      message.role === "user"
    ) {
      const text =
        visibleUserText(
          message
        );

      content.textContent =
        text;

      content.hidden =
        text.trim().length === 0;

      return true;
    }

    /* -----------------------------------------------
       Assistant
       ----------------------------------------------- */

    const text =
      clean(
        message.content
      );

    content.hidden =
      false;

    /*
     * Safe plain-text fallback first.
     */

    content.textContent =
      text;

    const renderer =
      window
        .NeyoMessageRenderer;

    try {
      if (
        typeof renderer
          ?.render ===
        "function"
      ) {
        renderer.render(
          element,
          text,
          {
            role:
              "assistant",

            markdown
          }
        );

      } else if (
        typeof renderer
          ?.renderInto ===
        "function"
      ) {
        renderer.renderInto(
          content,
          text,
          {
            role:
              "assistant",

            markdown
          }
        );

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

    } catch (error) {
      /*
       * Plain text already exists, so renderer failure
       * never produces a blank answer.
       */

      console.warn(
        "[NEO Messages] Renderer failed:",
        error
      );
    }

    return true;
  }

  /* =====================================================
     CREATE
     ===================================================== */

  function create(
    message,
    options = {}
  ) {
    if (
      !message ||
      (
        message.role !== "user" &&
        message.role !== "assistant"
      )
    ) {
      return null;
    }

    const id =
      clean(
        message.id,
        128
      ).trim() ||
      makeId();

    /*
     * Duplicate event protection.
     */

    const existing =
      findMessage(
        id
      );

    if (existing) {
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

    /*
     * Do not rename these classes.
     * Existing production CSS depends on them.
     */

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
      message.error === true
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

    /* -----------------------------------------------
       USER
       ----------------------------------------------- */

    if (
      message.role === "user"
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

      renderAttachments(
        wrapper,
        message.attachments
      );

      element.appendChild(
        wrapper
      );
    }

    /* -----------------------------------------------
       ASSISTANT
       ----------------------------------------------- */

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
      {
        ...message,
        id
      },
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
     UPDATE ATTACHMENTS
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

    if (!wrapper) {
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
     UPDATE
     ===================================================== */

  function update(
    id,
    content,
    options = {}
  ) {
    const element =
      findMessage(
        id
      );

    if (!element) {
      return false;
    }

    /*
     * New chat.js sends full canonical message inside
     * options.message.
     */

    const canonical =
      options.message &&
      typeof options.message ===
        "object"
        ? options.message
        : {};

    const role =
      canonical.role ||
      element.dataset.role ||
      "assistant";

    const message = {
      ...canonical,

      role,

      content:
        canonical.content ??
        content ??
        "",

      displayContent:
        canonical.displayContent
    };

    renderContent(
      element,
      message,
      options.markdown ??
        true
    );

    if (
      Array.isArray(
        canonical.attachments
      )
    ) {
      updateAttachments(
        element,
        canonical.attachments
      );

    } else if (
      Array.isArray(
        options.attachments
      )
    ) {
      updateAttachments(
        element,
        options.attachments
      );
    }

    if (
      role === "assistant"
    ) {
      const sources =
        Array.isArray(
          canonical.sources
        )
          ? canonical.sources
          : options.sources;

      if (
        Array.isArray(
          sources
        )
      ) {
        renderSources(
          element,
          sources
        );
      }
    }

    const error =
      canonical.error === true ||
      options.error === true;

    element.classList.toggle(
      "is-error",
      error
    );

    element.dataset.error =
      error
        ? "true"
        : "false";

    emit(
      "neyo:message-updated",
      {
        id,

        element,

        message
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
     REMOVE
     ===================================================== */

  function remove(
    id
  ) {
    const element =
      findMessage(
        id
      );

    if (!element) {
      return false;
    }

    if (
      element ===
      thinkingElement
    ) {
      thinkingElement =
        null;
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

  function showThinking(
    event
  ) {
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

    if (
      event?.detail
        ?.requestId
    ) {
      element.dataset
        .requestId =
        String(
          event.detail
            .requestId
        );
    }

    element.setAttribute(
      "aria-live",
      "polite"
    );

    element.setAttribute(
      "aria-label",
      "NEO is thinking"
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

    /*
     * Preserve existing visible text / CSS behavior.
     */

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
        element,

        requestId:
          event?.detail
            ?.requestId ||
          null
      }
    );

    return element;
  }

  function removeThinking() {
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

    if (!element) {
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
     REPLACE

     Compatibility only.
     chat.js normally loads history by clear + ordered
     neyo:chat-message-added events.
     ===================================================== */

  function replace(
    messages = [],
    options = {}
  ) {
    clear();

    if (!Array.isArray(messages)) {
      return false;
    }

    for (
      const message
      of messages
    ) {
      create(
        message,
        {
          historyLoad: true,
          forceScroll: false,
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
     CHAT EVENT OWNERSHIP
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

  window.addEventListener(
    "neyo:chat-message-removed",
    event => {
      const id =
        event.detail
          ?.message
          ?.id ||
        event.detail
          ?.id;

      if (id) {
        remove(id);
      }
    }
  );

  /*
   * Canonical message update from chat.js.
   */

  window.addEventListener(
    "neyo:chat-message-updated",
    event => {
      const message =
        event.detail
          ?.message;

      if (!message?.id) {
        return;
      }

      update(
        message.id,
        message.content,
        {
          message
        }
      );
    }
  );

  /* =====================================================
     GENERATION
     ===================================================== */

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

  window.addEventListener(
    "neyo:chat-limit-reached",
    removeThinking
  );

  /* =====================================================
     CLEAR
     ===================================================== */

  window.addEventListener(
    "neyo:messages-clear",
    clear
  );

  /* =====================================================
     LEGACY UPDATE COMPATIBILITY

     Keep temporarily because earlier modules may still
     emit this event.
     ===================================================== */

  window.addEventListener(
    "neyo:message-update-request",
    event => {
      update(
        event.detail?.id,

        event.detail
          ?.content,

        event.detail
          ?.options ||
        {}
      );
    }
  );

  /* =====================================================
     OPTIONAL REPLACE COMPATIBILITY
     ===================================================== */

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

  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({
      __controller: true,
      version: VERSION,
      active: true,

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

      getContainer() {
        return chatMessages;
      },

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          nearBottom,

          thinking:
            Boolean(
              thinkingElement
            ),

          messageCount:
            chatMessages
              .querySelectorAll(
                '[data-neyo-message-id]:not([data-neyo-message-id="neyo-thinking"])'
              )
              .length
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoMessages",
    {
      value: api,
      writable: false,
      configurable: true,
      enumerable: true
    }
  );

  /* =====================================================
     INIT
     ===================================================== */

  updateHero();

  emit(
    "neyo:messages-ready",
    {
      version:
        VERSION,

      active:
        true
    }
  );
})();
