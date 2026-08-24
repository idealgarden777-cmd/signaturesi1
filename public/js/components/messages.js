/*
=========================================================
NEO — MESSAGES
Production v2 — ChatGPT-Standard DOM Layer

Baseline:
- Old working neo.js message behavior
- Old messages.js DOM/classes
- Current NeyoChat canonical message events

Owns:
- #chatMessages DOM
- User / assistant message shells
- Thinking... placeholder
- Message DOM updates/removal
- Attachment display inside sent messages
- Source pills
- Smart auto-scroll
- Hero visibility
- Message DOM lookup
- History DOM rebuild support

Does NOT own:
- /api/chat
- Conversation state
- Send / Stop
- Markdown parsing rules
- Edit logic
- Regenerate logic
- Copy / Share logic
- Attachment upload
- History persistence
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-messages-production-v2";

  if (
    window.NeyoMessages?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     DOM
     ===================================================== */

  const chatMessages =
    document.getElementById("chatMessages");

  const scrollArea =
    document.getElementById("scrollArea");

  const heroSection =
    document.getElementById("heroSection");

  if (!chatMessages) {
    console.warn(
      "[NEO Messages] #chatMessages is missing."
    );

    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG = Object.freeze({
    nearBottomThreshold: 140,

    thinkingText:
      "Thinking...",

    thinkingId:
      "neyoThinkingIndicator",

    scrollFrameDelay: 1
  });

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    followingOutput: true,

    userScrolledAway: false,

    programmaticScroll: false,

    scrollFrame: null,

    thinkingElement: null,

    lastMessageCount: 0
  };

  /* =====================================================
     EVENTS
     ===================================================== */

  function emit(
    name,
    detail = {}
  ) {
    window.dispatchEvent(
      new CustomEvent(name, {
        detail
      })
    );
  }

  /* =====================================================
     HELPERS
     ===================================================== */

  function cleanText(value) {
    return typeof value === "string"
      ? value
      : "";
  }

  function cleanId(value) {
    return String(
      value ?? ""
    ).trim();
  }

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  function renderer() {
    const controller =
      window.NeyoMessageRenderer;

    return (
      controller &&
      controller.__controller === true
    )
      ? controller
      : null;
  }

  /* =====================================================
     HERO
     ===================================================== */

  function updateHeroVisibility() {
    if (!heroSection) {
      return;
    }

    const hasMessages =
      Boolean(
        chatMessages.querySelector(
          ".message:not(.is-thinking)"
        )
      );

    heroSection.style.display =
      hasMessages
        ? "none"
        : "";
  }

  /* =====================================================
     SCROLL
     ===================================================== */

  function distanceFromBottom() {
    if (!scrollArea) {
      return 0;
    }

    return Math.max(
      0,
      scrollArea.scrollHeight -
        scrollArea.scrollTop -
        scrollArea.clientHeight
    );
  }

  function isNearBottom() {
    if (!scrollArea) {
      return true;
    }

    return (
      distanceFromBottom() <=
      CONFIG.nearBottomThreshold
    );
  }

  function cancelScheduledScroll() {
    if (
      state.scrollFrame !== null
    ) {
      cancelAnimationFrame(
        state.scrollFrame
      );

      state.scrollFrame =
        null;
    }
  }

  function scrollToBottom(
    behavior = "auto",
    {
      force = false
    } = {}
  ) {
    if (!scrollArea) {
      return false;
    }

    if (
      !force &&
      !state.followingOutput
    ) {
      return false;
    }

    cancelScheduledScroll();

    state.scrollFrame =
      requestAnimationFrame(() => {
        state.scrollFrame =
          null;

        state.programmaticScroll =
          true;

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

        requestAnimationFrame(() => {
          state.programmaticScroll =
            false;
        });
      });

    return true;
  }

  function followOutput() {
    state.followingOutput = true;

    state.userScrolledAway = false;

    return true;
  }

  function stopFollowingOutput() {
    state.followingOutput = false;

    state.userScrolledAway = true;

    return true;
  }

  if (scrollArea) {
    scrollArea.addEventListener(
      "scroll",
      () => {
        if (
          state.programmaticScroll
        ) {
          return;
        }

        if (isNearBottom()) {
          followOutput();
        } else {
          stopFollowingOutput();
        }
      },
      {
        passive: true
      }
    );
  }

  /* =====================================================
     MESSAGE LOOKUP
     ===================================================== */

  function getElement(messageId) {
    const id = cleanId(
      messageId
    );

    if (!id) {
      return null;
    }

    return Array.from(
      chatMessages.querySelectorAll(
        ".message[data-message-id]"
      )
    ).find(
      element =>
        element.dataset.messageId ===
        id
    ) || null;
  }

  function updateMessageIndexes() {
    const messages =
      chatMessages.querySelectorAll(
        ".message:not(.is-thinking)"
      );

    messages.forEach(
      (element, index) => {
        element.dataset.msgIndex =
          String(index);
      }
    );

    state.lastMessageCount =
      messages.length;
  }

  /* =====================================================
     ATTACHMENT HELPERS
     ===================================================== */

  function attachmentMime(file) {
    return String(
      file?.mimeType ||
      file?.type ||
      file?.mime ||
      ""
    ).toLowerCase();
  }

  function attachmentName(file) {
    return String(
      file?.name ||
      file?.fileName ||
      "Attached file"
    );
  }

  function isImageAttachment(file) {
    const mime =
      attachmentMime(file);

    const category =
      String(
        file?.category || ""
      ).toLowerCase();

    const name =
      attachmentName(file)
        .toLowerCase();

    return (
      mime.startsWith("image/") ||
      category === "image" ||
      /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(
        name
      )
    );
  }

  function getPreviewUrl(file) {
    const value =
      file?.previewUrl ||
      file?.preview_url ||
      file?.signedUrl ||
      file?.signed_url ||
      "";

    return typeof value === "string"
      ? value
      : "";
  }

  function getFileIcon(file) {
    const mime =
      attachmentMime(file);

    const name =
      attachmentName(file)
        .toLowerCase();

    if (isImageAttachment(file)) {
      return "image";
    }

    if (
      mime.startsWith("audio/")
    ) {
      return "audio-lines";
    }

    if (
      mime.startsWith("video/")
    ) {
      return "video";
    }

    if (
      mime.includes("pdf") ||
      name.endsWith(".pdf")
    ) {
      return "file-text";
    }

    if (
      mime.includes("zip") ||
      mime.includes("rar") ||
      name.endsWith(".zip") ||
      name.endsWith(".rar")
    ) {
      return "archive";
    }

    if (
      mime.includes("word") ||
      mime.includes("document") ||
      name.endsWith(".doc") ||
      name.endsWith(".docx")
    ) {
      return "file-text";
    }

    if (
      mime.includes("sheet") ||
      mime.includes("excel") ||
      name.endsWith(".xls") ||
      name.endsWith(".xlsx") ||
      name.endsWith(".csv")
    ) {
      return "table";
    }

    if (
      mime.includes(
        "presentation"
      ) ||
      name.endsWith(".ppt") ||
      name.endsWith(".pptx")
    ) {
      return "presentation";
    }

    if (
      mime.includes(
        "javascript"
      ) ||
      mime.includes("json") ||
      name.endsWith(".js") ||
      name.endsWith(".ts") ||
      name.endsWith(".tsx") ||
      name.endsWith(".jsx") ||
      name.endsWith(".py") ||
      name.endsWith(".java") ||
      name.endsWith(".cpp") ||
      name.endsWith(".c") ||
      name.endsWith(".html") ||
      name.endsWith(".css")
    ) {
      return "code";
    }

    return "file";
  }

  /* =====================================================
     ATTACHMENT UI
     ===================================================== */

  function createFilePill(file) {
    const pill =
      document.createElement(
        "div"
      );

    pill.className =
      "message-file-pill";

    const icon =
      document.createElement(
        "i"
      );

    icon.setAttribute(
      "data-lucide",
      getFileIcon(file)
    );

    icon.setAttribute(
      "size",
      "14"
    );

    icon.setAttribute(
      "aria-hidden",
      "true"
    );

    const name =
      document.createElement(
        "span"
      );

    name.textContent =
      attachmentName(file);

    pill.append(
      icon,
      name
    );

    return pill;
  }

  function createImagePreview(file) {
    const previewUrl =
      getPreviewUrl(file);

    if (!previewUrl) {
      return createFilePill(
        file
      );
    }

    const image =
      document.createElement(
        "img"
      );

    image.src =
      previewUrl;

    image.alt =
      attachmentName(file) ||
      "Uploaded image";

    image.loading =
      "lazy";

    image.decoding =
      "async";

    image.addEventListener(
      "error",
      () => {
        const fallback =
          createFilePill(file);

        image.replaceWith(
          fallback
        );

        refreshIcons();
      },
      {
        once: true
      }
    );

    return image;
  }

  function renderAttachments(
    wrapper,
    attachments = []
  ) {
    if (
      !wrapper ||
      !Array.isArray(
        attachments
      ) ||
      attachments.length === 0
    ) {
      return null;
    }

    const grid =
      document.createElement(
        "div"
      );

    grid.className =
      "message-media-grid";

    for (
      const file
      of attachments
    ) {
      if (
        !file ||
        typeof file !== "object"
      ) {
        continue;
      }

      grid.appendChild(
        isImageAttachment(file)
          ? createImagePreview(
              file
            )
          : createFilePill(
              file
            )
      );
    }

    if (!grid.children.length) {
      return null;
    }

    wrapper.appendChild(
      grid
    );

    return grid;
  }

  /* =====================================================
     SOURCES
     ===================================================== */

  function safeSourceUrl(value) {
    if (
      typeof value !== "string" ||
      !value.trim()
    ) {
      return "";
    }

    try {
      const url =
        new URL(
          value,
          window.location.href
        );

      if (
        url.protocol === "http:" ||
        url.protocol === "https:"
      ) {
        return url.href;
      }
    } catch {}

    return "";
  }

  function sourceTitle(source) {
    return String(
      source?.title ||
      source?.name ||
      source?.domain ||
      source?.url ||
      "Source"
    );
  }

  function removeSources(
    messageElement
  ) {
    messageElement
      ?.querySelector(
        ".neo-source-pills"
      )
      ?.remove();
  }

  function renderSources(
    messageElement,
    sources = []
  ) {
    if (!messageElement) {
      return;
    }

    removeSources(
      messageElement
    );

    if (
      !Array.isArray(sources) ||
      sources.length === 0
    ) {
      return;
    }

    const container =
      document.createElement(
        "div"
      );

    container.className =
      "neo-source-pills";

    const label =
      document.createElement(
        "span"
      );

    label.className =
      "neo-source-label";

    label.textContent =
      `Sources ${sources.length}`;

    container.appendChild(
      label
    );

    for (
      const source
      of sources
    ) {
      if (
        !source ||
        typeof source !== "object"
      ) {
        continue;
      }

      const url =
        safeSourceUrl(
          source.url ||
          source.href
        );

      const pill =
        url
          ? document.createElement(
              "a"
            )
          : document.createElement(
              "span"
            );

      pill.className =
        "neo-source-pill";

      pill.textContent =
        sourceTitle(source);

      if (
        pill instanceof
        HTMLAnchorElement
      ) {
        pill.href =
          url;

        pill.target =
          "_blank";

        pill.rel =
          "noopener noreferrer";
      }

      container.appendChild(
        pill
      );
    }

    if (
      container.children.length >
      1
    ) {
      const actions =
        messageElement.querySelector(
          ".message-actions"
        );

      if (actions) {
        messageElement.insertBefore(
          container,
          actions
        );
      } else {
        messageElement.appendChild(
          container
        );
      }
    }
  }

  /* =====================================================
     CONTENT RENDERING
     ===================================================== */

  function renderUserContent(
    element,
    content
  ) {
    element.textContent =
      cleanText(content);
  }

  function renderAssistantContent(
    element,
    content,
    message
  ) {
    const controller =
      renderer();

    if (
      controller &&
      typeof controller.renderInto ===
        "function"
    ) {
      try {
        controller.renderInto(
          element,
          cleanText(content),
          {
            role: "assistant",

            message,

            streaming:
              Boolean(
                message?.streaming
              )
          }
        );

        return;
      } catch (error) {
        console.warn(
          "[NEO Messages] Renderer failed:",
          error
        );
      }
    }

    /*
     * Safe fallback.
     * Never inject raw model HTML here.
     */

    element.textContent =
      cleanText(content);
  }

  /* =====================================================
     ACTION MOUNT SIGNAL

     message-actions.js owns buttons/actions.
     messages.js only announces that a DOM message exists.
     ===================================================== */

  function announceMounted(
    element,
    message
  ) {
    emit(
      "neyo:message-mounted",
      {
        element,
        message
      }
    );
  }

  /* =====================================================
     CREATE USER MESSAGE
     ===================================================== */

  function createUserMessage(
    message
  ) {
    const element =
      document.createElement(
        "div"
      );

    element.className =
      "message user";

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

    renderUserContent(
      content,
      message.displayContent ??
      message.content ??
      ""
    );

    wrapper.appendChild(
      content
    );

    renderAttachments(
      wrapper,
      message.attachments ||
      []
    );

    element.appendChild(
      wrapper
    );

    return element;
  }

  /* =====================================================
     CREATE ASSISTANT MESSAGE
     ===================================================== */

  function createAssistantMessage(
    message
  ) {
    const element =
      document.createElement(
        "div"
      );

    element.className =
      "message assistant";

    if (message.error === true) {
      element.classList.add(
        "is-error"
      );
    }

    if (
      message.streaming === true
    ) {
      element.classList.add(
        "is-streaming"
      );
    }

    const content =
      document.createElement(
        "div"
      );

    content.className =
      "message-content";

    renderAssistantContent(
      content,
      message.content || "",
      message
    );

    element.appendChild(
      content
    );

    if (
      Array.isArray(
        message.sources
      ) &&
      message.sources.length
    ) {
      renderSources(
        element,
        message.sources
      );
    }

    return element;
  }

  /* =====================================================
     THINKING
     ===================================================== */

  function createThinkingElement() {
    const message =
      document.createElement(
        "div"
      );

    message.id =
      CONFIG.thinkingId;

    message.className =
      "message assistant is-thinking";

    message.setAttribute(
      "aria-live",
      "polite"
    );

    message.setAttribute(
      "aria-label",
      CONFIG.thinkingText
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
      CONFIG.thinkingText;

    content.appendChild(
      shimmer
    );

    message.appendChild(
      content
    );

    return message;
  }

  function showThinking() {
    const existing =
      state.thinkingElement &&
      state.thinkingElement
        .isConnected
        ? state.thinkingElement
        : document.getElementById(
            CONFIG.thinkingId
          );

    if (existing) {
      state.thinkingElement =
        existing;

      return existing;
    }

    const element =
      createThinkingElement();

    state.thinkingElement =
      element;

    chatMessages.appendChild(
      element
    );

    updateHeroVisibility();

    scrollToBottom(
      "auto",
      {
        force: true
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
    const element =
      state.thinkingElement ||
      document.getElementById(
        CONFIG.thinkingId
      );

    if (!element) {
      state.thinkingElement =
        null;

      return false;
    }

    element.remove();

    state.thinkingElement =
      null;

    emit(
      "neyo:thinking-hidden"
    );

    return true;
  }

  /* =====================================================
     CREATE MESSAGE
     ===================================================== */

  function createMessage(
    input = {}
  ) {
    const message =
      input?.message &&
      typeof input.message ===
        "object"
        ? input.message
        : input;

    if (
      !message ||
      typeof message !== "object"
    ) {
      return null;
    }

    const role =
      message.role === "user"
        ? "user"
        : "assistant";

    const id =
      cleanId(
        message.id
      );

    /*
     * Canonical message IDs prevent duplicate DOM rows.
     */

    if (id) {
      const existing =
        getElement(id);

      if (existing) {
        updateMessage(
          existing,
          message
        );

        return existing;
      }
    }

    /*
     * JSON mode:
     * thinking placeholder existed before final assistant
     * message. Remove it before mounting final answer.
     *
     * Streaming mode:
     * same placeholder disappears when streaming assistant
     * shell arrives.
     */

    if (role === "assistant") {
      removeThinking();
    }

    const element =
      role === "user"
        ? createUserMessage(
            message
          )
        : createAssistantMessage(
            message
          );

    if (id) {
      element.dataset.messageId =
        id;
    }

    if (message.error === true) {
      element.dataset.error =
        "true";
    }

    chatMessages.appendChild(
      element
    );

    updateMessageIndexes();

    updateHeroVisibility();

    refreshIcons();

    /*
     * New submitted user turn should always be visible.
     * Assistant output only follows while user has not
     * intentionally scrolled away.
     */

    if (role === "user") {
      followOutput();

      scrollToBottom(
        "auto",
        {
          force: true
        }
      );
    } else {
      scrollToBottom();
    }

    announceMounted(
      element,
      message
    );

    emit(
      "neyo:message-created",
      {
        element,
        message
      }
    );

    return element;
  }

  /* =====================================================
     UPDATE USER MESSAGE
     ===================================================== */

  function updateUserMessage(
    element,
    message
  ) {
    let wrapper =
      element.querySelector(
        ".message-wrapper"
      );

    if (!wrapper) {
      wrapper =
        document.createElement(
          "div"
        );

      wrapper.className =
        "message-wrapper";

      element.replaceChildren(
        wrapper
      );
    }

    let content =
      wrapper.querySelector(
        ":scope > .message-content"
      );

    if (!content) {
      content =
        document.createElement(
          "div"
        );

      content.className =
        "message-content";

      wrapper.prepend(
        content
      );
    }

    renderUserContent(
      content,
      message.displayContent ??
      message.content ??
      ""
    );

    wrapper
      .querySelector(
        ":scope > .message-media-grid"
      )
      ?.remove();

    renderAttachments(
      wrapper,
      message.attachments ||
      []
    );

    /*
     * message-actions.js may already have mounted its
     * action container. Keep it untouched.
     */
  }

  /* =====================================================
     UPDATE ASSISTANT MESSAGE
     ===================================================== */

  function updateAssistantMessage(
    element,
    message
  ) {
    element.classList.toggle(
      "is-streaming",
      message.streaming === true
    );

    element.classList.toggle(
      "is-error",
      message.error === true
    );

    if (message.error === true) {
      element.dataset.error =
        "true";
    } else {
      delete element.dataset.error;
    }

    let content =
      element.querySelector(
        ":scope > .message-content"
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

    renderAssistantContent(
      content,
      message.content || "",
      message
    );

    renderSources(
      element,
      message.sources || []
    );
  }

  /* =====================================================
     UPDATE MESSAGE
     ===================================================== */

  function updateMessage(
    target,
    value = "",
    options = {}
  ) {
    let element = null;

    let message = null;

    /*
     * Modern form:
     * updateMessage(element, message)
     */

    if (
      target instanceof
      HTMLElement
    ) {
      element =
        target;

      if (
        value &&
        typeof value === "object"
      ) {
        message = value;
      } else {
        message = {
          id:
            element.dataset
              .messageId,

          role:
            element.classList
              .contains("user")
              ? "user"
              : "assistant",

          content:
            cleanText(value),

          ...options
        };
      }
    }

    /*
     * ID form:
     * updateMessage(id, message)
     */

    else {
      element =
        getElement(target);

      if (
        value &&
        typeof value === "object"
      ) {
        message = value;
      } else {
        message = {
          id:
            cleanId(target),

          role:
            element?.classList
              .contains("user")
              ? "user"
              : "assistant",

          content:
            cleanText(value),

          ...options
        };
      }
    }

    if (
      !element ||
      !message
    ) {
      return null;
    }

    element.classList.remove(
      "is-thinking"
    );

    const role =
      message.role === "user" ||
      element.classList.contains(
        "user"
      )
        ? "user"
        : "assistant";

    if (role === "user") {
      updateUserMessage(
        element,
        message
      );
    } else {
      updateAssistantMessage(
        element,
        message
      );
    }

    refreshIcons();

    scrollToBottom();

    emit(
      "neyo:message-updated",
      {
        element,
        message,
        content:
          message.content || ""
      }
    );

    return element;
  }

  /* =====================================================
     REMOVE
     ===================================================== */

  function removeMessage(target) {
    const element =
      target instanceof
      HTMLElement
        ? target
        : getElement(target);

    if (!element) {
      return false;
    }

    const id =
      element.dataset
        .messageId ||
      null;

    element.remove();

    updateMessageIndexes();

    updateHeroVisibility();

    emit(
      "neyo:message-removed",
      {
        id,
        element
      }
    );

    return true;
  }

  /* =====================================================
     CLEAR
     ===================================================== */

  function clearMessages() {
    cancelScheduledScroll();

    state.thinkingElement =
      null;

    chatMessages.replaceChildren();

    state.followingOutput =
      true;

    state.userScrolledAway =
      false;

    state.lastMessageCount =
      0;

    updateHeroVisibility();

    emit(
      "neyo:messages-cleared"
    );

    return true;
  }

  /* =====================================================
     REPLACE

     Useful for diagnostics/history compatibility.
     Canonical history flow normally emits messages one by
     one from chat.js.
     ===================================================== */

  function replaceMessages(
    messages = []
  ) {
    clearMessages();

    if (!Array.isArray(messages)) {
      return false;
    }

    for (
      const message
      of messages
    ) {
      createMessage(
        message
      );
    }

    followOutput();

    scrollToBottom(
      "auto",
      {
        force: true
      }
    );

    return true;
  }

  /* =====================================================
     CANONICAL CHAT EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:chat-message-added",
    event => {
      const message =
        event.detail?.message;

      if (!message) {
        return;
      }

      createMessage(
        message
      );

      /*
       * Old app opened historical conversation at bottom.
       */

      if (
        event.detail
          ?.historyLoad === true
      ) {
        followOutput();

        scrollToBottom(
          "auto",
          {
            force: true
          }
        );
      }
    }
  );

  window.addEventListener(
    "neyo:chat-message-updated",
    event => {
      const message =
        event.detail?.message;

      if (!message?.id) {
        return;
      }

      const element =
        getElement(
          message.id
        );

      if (!element) {
        /*
         * Defensive recovery:
         * if DOM row disappeared but canonical state still
         * has it, rebuild that row.
         */

        createMessage(
          message
        );

        return;
      }

      updateMessage(
        element,
        message
      );
    }
  );

  window.addEventListener(
    "neyo:chat-message-removed",
    event => {
      const id =
        event.detail?.id ||
        event.detail
          ?.message?.id;

      if (id) {
        removeMessage(id);
      }
    }
  );

  /* =====================================================
     GENERATION / THINKING EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {
      followOutput();

      showThinking();
    }
  );

  window.addEventListener(
    "neyo:chat-stream-start",
    () => {
      /*
       * Keep old Thinking... visible until actual assistant
       * message shell is added.
       */
      scrollToBottom();
    }
  );

  window.addEventListener(
    "neyo:chat-send-end",
    () => {
      /*
       * If no assistant message ever arrived
       * (429 / aborted before first token), remove stale
       * Thinking... placeholder.
       */

      removeThinking();
    }
  );

  window.addEventListener(
    "neyo:chat-error",
    () => {
      removeThinking();
    }
  );

  window.addEventListener(
    "neyo:chat-limit-reached",
    () => {
      removeThinking();
    }
  );

  window.addEventListener(
    "neyo:chat-aborted",
    () => {
      removeThinking();
    }
  );

  /* =====================================================
     CLEAR EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:messages-clear",
    () => {
      clearMessages();
    }
  );

  /* =====================================================
     LEGACY CREATE EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:message-create",
    event => {
      createMessage(
        event.detail || {}
      );
    }
  );

  /* =====================================================
     LEGACY UPDATE BRIDGE

     chat.js emits canonical chat-message-updated first and
     then this compatibility event. Avoid rendering twice
     when canonical message object is supplied.
     ===================================================== */

  window.addEventListener(
    "neyo:message-update-request",
    event => {
      const detail =
        event.detail || {};

      if (
        detail.options
          ?.message?.id
      ) {
        return;
      }

      const id =
        detail.id;

      if (!id) {
        return;
      }

      updateMessage(
        id,
        detail.content || "",
        detail.options || {}
      );
    }
  );

  /* =====================================================
     SCROLL REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:messages-scroll-bottom",
    event => {
      followOutput();

      scrollToBottom(
        event.detail
          ?.behavior ||
        "smooth",
        {
          force: true
        }
      );
    }
  );

  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({
      __controller: true,

      version:
        VERSION,

      active: true,

      create:
        createMessage,

      update:
        updateMessage,

      remove:
        removeMessage,

      clear:
        clearMessages,

      replace:
        replaceMessages,

      showThinking,

      removeThinking,

      scrollToBottom,

      followOutput,

      stopFollowingOutput,

      getElement,

      getContainer() {
        return chatMessages;
      },

      getScrollArea() {
        return scrollArea;
      },

      isNearBottom,

      getState() {
        return {
          version:
            VERSION,

          active: true,

          messageCount:
            chatMessages
              .querySelectorAll(
                ".message:not(.is-thinking)"
              )
              .length,

          thinking:
            Boolean(
              state.thinkingElement
                ?.isConnected ||
              document.getElementById(
                CONFIG.thinkingId
              )
            ),

          followingOutput:
            state.followingOutput,

          userScrolledAway:
            state.userScrolledAway,

          nearBottom:
            isNearBottom()
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

     Do not destroy pre-existing old DOM on load.
     We only index whatever is already present.
     ===================================================== */

  updateMessageIndexes();

  updateHeroVisibility();

  if (isNearBottom()) {
    followOutput();
  }

  emit(
    "neyo:messages-ready",
    {
      version:
        VERSION,

      active: true,

      smartScroll:
        true,

      streaming:
        true,

      oldDomCompatible:
        true
    }
  );
})();
