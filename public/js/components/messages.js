(() => {
  "use strict";

  const VERSION = "neyo-messages-v3";
  if (window.NeyoMessages?.__controller === true) return;

  const chatMessages = document.getElementById("chatMessages");
  const scrollArea = document.getElementById("scrollArea");
  const heroSection = document.getElementById("heroSection");

  if (!chatMessages) {
    console.warn("[NEYO Messages] #chatMessages missing.");
    return;
  }

  let nearBottom = true;
  let thinkingElement = null;

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function clean(value, max = 50000) {
    return String(value ?? "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .slice(0, max);
  }

  function createId() {
    return (
      globalThis.crypto?.randomUUID?.() ||
      `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
  }

  function refreshIcons() {
    try {
      window.lucide?.createIcons?.();
    } catch {}
  }

  function formatBytes(bytes) {
    let value = Math.max(0, Number(bytes) || 0);

    if (value < 1024) return `${value} B`;

    const units = ["KB", "MB", "GB"];
    value /= 1024;

    let index = 0;

    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index++;
    }

    return `${
      value >= 10 ? value.toFixed(0) : value.toFixed(1)
    } ${units[index]}`;
  }

  function extensionOf(name) {
    return (
      String(name || "")
        .toLowerCase()
        .match(/\.([a-z0-9]+)$/)?.[1] || ""
    );
  }

  function normalizeAttachments(files) {
    if (!Array.isArray(files)) return [];

    return files
      .filter(file => file && typeof file === "object")
      .slice(0, 5)
      .map(file => ({
        ...file,
        name: clean(file.name || "Attached file", 220),
        size: Math.max(0, Number(file.size) || 0),
        mimeType: clean(
          file.mimeType ||
            file.mime ||
            file.type ||
            "application/octet-stream",
          180
        ).toLowerCase(),
        category: clean(
          file.category || "unknown",
          40
        ).toLowerCase()
      }));
  }

  function fileLabel(file) {
    const extension = extensionOf(file?.name);

    if (extension) return extension.toUpperCase();

    const category = clean(file?.category || "", 30).trim();

    if (!category || category === "unknown") return "File";

    return (
      category.charAt(0).toUpperCase() +
      category.slice(1)
    );
  }

  function fileIcon(file) {
    const category = String(file?.category || "").toLowerCase();
    const mime = String(
      file?.mimeType ||
        file?.mime ||
        file?.type ||
        ""
    ).toLowerCase();

    const extension = extensionOf(file?.name);

    if (category === "image" || mime.startsWith("image/")) {
      return "image";
    }

    if (
      category === "spreadsheet" ||
      ["xls", "xlsx", "xlsm", "xlsb", "csv", "tsv", "ods"].includes(
        extension
      )
    ) {
      return "sheet";
    }

    if (
      category === "presentation" ||
      ["ppt", "pptx", "odp"].includes(extension)
    ) {
      return "presentation";
    }

    if (category === "code") return "file-code-2";
    if (category === "archive") return "archive";
    if (category === "data") return "database";

    if (category === "audio" || mime.startsWith("audio/")) {
      return "audio-lines";
    }

    if (category === "video" || mime.startsWith("video/")) {
      return "video";
    }

    return "file-text";
  }

  function safePreview(value) {
    const raw = clean(value, 5000).trim();

    if (!raw) return "";

    if (/^(blob:|data:image\/)/i.test(raw)) {
      return raw;
    }

    try {
      const url = new URL(raw, location.origin);

      return ["http:", "https:"].includes(url.protocol)
        ? url.href
        : "";
    } catch {
      return "";
    }
  }

  function findMessage(id) {
    if (!id) return null;

    return Array.from(
      chatMessages.querySelectorAll("[data-neyo-message-id]")
    ).find(
      element =>
        element.dataset.neyoMessageId === String(id)
    ) || null;
  }

  function updateHero() {
    if (!heroSection) return;

    const hasMessages = Boolean(
      chatMessages.querySelector(
        '[data-neyo-message-id]:not([data-neyo-message-id="neyo-thinking"])'
      )
    );

    heroSection.style.display = hasMessages ? "none" : "";
    heroSection.setAttribute(
      "aria-hidden",
      String(hasMessages)
    );
  }

  function isNearBottom() {
    if (!scrollArea) return true;

    return (
      scrollArea.scrollHeight -
        scrollArea.scrollTop -
        scrollArea.clientHeight <=
      120
    );
  }

  function scrollToBottom(behavior = "auto", force = false) {
    if (!scrollArea || (!force && !nearBottom)) {
      return false;
    }

    try {
      scrollArea.scrollTo({
        top: scrollArea.scrollHeight,
        behavior
      });
    } catch {
      scrollArea.scrollTop = scrollArea.scrollHeight;
    }

    nearBottom = true;
    return true;
  }

  function createFileCard(file) {
    const card = document.createElement("div");
    const visual = document.createElement("div");
    const body = document.createElement("div");
    const name = document.createElement("div");
    const meta = document.createElement("div");

    card.className =
      "message-file-pill neyo-message-file-card";

    visual.className =
      "neyo-message-file-visual";

    body.className =
      "neyo-message-file-body";

    name.className =
      "neyo-message-file-name";

    meta.className =
      "neyo-message-file-meta";

    const filename = clean(
      file?.name || "Attached file",
      220
    );

    const mime = String(
      file?.mimeType ||
        file?.mime ||
        file?.type ||
        ""
    ).toLowerCase();

    const category = String(
      file?.category || ""
    ).toLowerCase();

    const preview = safePreview(
      file?.previewUrl ||
        file?.url ||
        ""
    );

    const isImage =
      category === "image" ||
      mime.startsWith("image/");

    if (isImage && preview) {
      const image = document.createElement("img");

      image.src = preview;
      image.alt = filename;
      image.loading = "lazy";
      image.decoding = "async";

      visual.appendChild(image);
    } else {
      const icon = document.createElement("i");

      icon.setAttribute(
        "data-lucide",
        fileIcon(file)
      );

      icon.setAttribute(
        "aria-hidden",
        "true"
      );

      visual.appendChild(icon);
    }

    name.textContent = filename;
    card.title = filename;

    const metadata = [];

    if (Number(file?.size) > 0) {
      metadata.push(formatBytes(file.size));
    }

    metadata.push(fileLabel(file));

    meta.textContent = metadata.join(" · ");

    body.append(name, meta);
    card.append(visual, body);

    return card;
  }

  function renderAttachments(wrapper, files) {
    const attachments = normalizeAttachments(files);

    if (!attachments.length) return null;

    const root = document.createElement("div");

    root.className =
      "message-media-grid neyo-message-attachments";

    root.setAttribute(
      "aria-label",
      attachments.length === 1
        ? "1 attached file"
        : `${attachments.length} attached files`
    );

    for (const file of attachments) {
      root.appendChild(
        createFileCard(file)
      );
    }

    wrapper.prepend(root);

    return root;
  }

  function normalizeSource(source) {
    const value =
      source?.url ||
      source?.uri ||
      source?.link ||
      source?.web?.uri ||
      "";

    try {
      const url = new URL(value);

      if (!["http:", "https:"].includes(url.protocol)) {
        return null;
      }

      return {
        url: url.href,
        label: clean(
          source?.title ||
            source?.name ||
            source?.web?.title ||
            url.hostname.replace(/^www\./, ""),
          160
        )
      };
    } catch {
      return null;
    }
  }

  function renderSources(element, sources) {
    element
      .querySelector(".neo-source-pills")
      ?.remove();

    if (!Array.isArray(sources)) return;

    const valid = sources
      .slice(0, 10)
      .map(normalizeSource)
      .filter(Boolean);

    if (!valid.length) return;

    const root = document.createElement("div");
    const label = document.createElement("span");

    root.className = "neo-source-pills";
    root.setAttribute("aria-label", "Sources");

    label.className = "neo-source-label";
    label.textContent = "Sources";

    root.appendChild(label);

    for (const source of valid) {
      const link = document.createElement("a");

      link.className = "neo-source-pill";
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source.label || "Source";
      link.title = link.textContent;

      root.appendChild(link);
    }

    element.appendChild(root);
  }

  function renderContent(
    element,
    message,
    markdown = true
  ) {
    const content = element.querySelector(
      ".message-content"
    );

    if (!content) return false;

    const text = clean(message?.content);

    if (message?.role === "user") {
      const attachmentOnly =
        Array.isArray(message.attachments) &&
        message.attachments.length > 0 &&
        [
          "Please analyze the attached file.",
          "Please analyze the attached file or files."
        ].includes(text);

      content.textContent =
        attachmentOnly ? "" : text;

      content.hidden =
        content.textContent.trim().length === 0;

      return true;
    }

    content.hidden = false;
    content.textContent = text;

    const renderer = window.NeyoMessageRenderer;

    try {
      if (typeof renderer?.render === "function") {
        renderer.render(
          element,
          text,
          {
            role: "assistant",
            markdown
          }
        );

        return true;
      }

      if (typeof renderer?.renderInto === "function") {
        renderer.renderInto(
          content,
          text,
          {
            role: "assistant",
            markdown
          }
        );

        return true;
      }
    } catch (error) {
      console.warn(
        "[NEYO Messages] Renderer failed:",
        error
      );
    }

    emit(
      "neyo:message-render-request",
      {
        message: element,
        content: text,
        options: {
          role: "assistant",
          markdown
        }
      }
    );

    return true;
  }

  function create(message, options = {}) {
    if (
      !message ||
      !["user", "assistant"].includes(message.role)
    ) {
      return null;
    }

    const id =
      clean(message.id, 128).trim() ||
      createId();

    const existing = findMessage(id);

    if (existing) return existing;

    if (message.role === "assistant") {
      removeThinking();
    }

    const element = document.createElement("div");

    element.className =
      `message ${message.role}`;

    element.dataset.neyoMessageId = id;
    element.dataset.messageId = id;
    element.dataset.role = message.role;

    if (message.error === true) {
      element.classList.add("is-error");
      element.dataset.error = "true";
    }

    if (options.historyLoad) {
      element.dataset.historyLoad = "true";
    }

    if (message.role === "user") {
      const wrapper = document.createElement("div");
      const content = document.createElement("div");

      wrapper.className = "message-wrapper";
      content.className = "message-content";

      wrapper.appendChild(content);

      renderAttachments(
        wrapper,
        message.attachments
      );

      element.appendChild(wrapper);
    } else {
      const content = document.createElement("div");
      content.className = "message-content";
      element.appendChild(content);
    }

    chatMessages.appendChild(element);

    renderContent(
      element,
      message,
      true
    );

    if (message.role === "assistant") {
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

    requestAnimationFrame(() => {
      scrollToBottom(
        "auto",
        message.role === "user" ||
          Boolean(options.forceScroll)
      );
    });

    return element;
  }

  function update(
    id,
    content,
    options = {}
  ) {
    const element = findMessage(id);

    if (!element) return false;

    const role =
      element.dataset.role ||
      "assistant";

    const message = {
      role,
      content,
      attachments:
        options.attachments
    };

    renderContent(
      element,
      message,
      options.markdown ?? true
    );

    if (
      role === "user" &&
      Array.isArray(options.attachments)
    ) {
      const wrapper = element.querySelector(
        ".message-wrapper"
      );

      if (wrapper) {
        wrapper
          .querySelector(".neyo-message-attachments")
          ?.remove();

        renderAttachments(
          wrapper,
          options.attachments
        );
      }
    }

    if (
      role === "assistant" &&
      Array.isArray(options.sources)
    ) {
      renderSources(
        element,
        options.sources
      );
    }

    element.classList.toggle(
      "is-error",
      options.error === true
    );

    element.dataset.error =
      options.error === true
        ? "true"
        : "false";

    refreshIcons();

    emit(
      "neyo:message-updated",
      {
        id,
        element,
        content: clean(content)
      }
    );

    requestAnimationFrame(() => {
      scrollToBottom("auto");
    });

    return true;
  }

  function remove(id) {
    const element = findMessage(id);

    if (!element) return false;

    element.remove();
    updateHero();

    emit(
      "neyo:message-removed",
      { id }
    );

    return true;
  }

  function showThinking() {
    removeThinking();

    const element = document.createElement("div");
    const content = document.createElement("div");
    const shimmer = document.createElement("span");

    element.id = "neyoThinkingIndicator";
    element.className =
      "message assistant is-thinking";

    element.dataset.neyoMessageId =
      "neyo-thinking";

    element.dataset.messageId =
      "neyo-thinking";

    element.dataset.role =
      "assistant";

    element.setAttribute(
      "aria-live",
      "polite"
    );

    content.className =
      "message-content";

    shimmer.className =
      "thinking-shimmer";

    shimmer.textContent =
      "Thinking.";

    content.appendChild(shimmer);
    element.appendChild(content);
    chatMessages.appendChild(element);

    thinkingElement = element;

    updateHero();

    requestAnimationFrame(() => {
      scrollToBottom(
        "auto",
        true
      );
    });

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

    thinkingElement = null;

    if (!element) return false;

    element.remove();
    updateHero();

    return true;
  }

  function clear() {
    thinkingElement = null;
    chatMessages.replaceChildren();
    nearBottom = true;

    updateHero();

    emit(
      "neyo:messages-cleared"
    );

    return true;
  }

  function replace(messages = []) {
    if (!Array.isArray(messages)) {
      return false;
    }

    clear();

    for (const message of messages) {
      create(
        message,
        {
          historyLoad: true,
          forceScroll: false
        }
      );
    }

    requestAnimationFrame(() => {
      scrollToBottom(
        "auto",
        true
      );
    });

    return true;
  }

  scrollArea?.addEventListener(
    "scroll",
    () => {
      nearBottom =
        isNearBottom();
    },
    {
      passive: true
    }
  );

  window.addEventListener(
    "neyo:chat-message-added",
    event => {
      const message =
        event.detail?.message;

      if (!message) return;

      create(
        message,
        {
          historyLoad:
            Boolean(
              event.detail?.historyLoad
            )
        }
      );
    }
  );

  window.addEventListener(
    "neyo:chat-message-removed",
    event => {
      const id =
        event.detail?.message?.id ||
        event.detail?.id;

      if (id) remove(id);
    }
  );

  window.addEventListener(
    "neyo:chat-send-start",
    showThinking
  );

  [
    "neyo:chat-response",
    "neyo:chat-send-end",
    "neyo:chat-aborted",
    "neyo:chat-error"
  ].forEach(name => {
    window.addEventListener(
      name,
      removeThinking
    );
  });

  window.addEventListener(
    "neyo:messages-clear",
    clear
  );

  window.addEventListener(
    "neyo:message-update-request",
    event => {
      update(
        event.detail?.id,
        event.detail?.content,
        event.detail?.options || {}
      );
    }
  );

  window.addEventListener(
    "neyo:messages-replace",
    event => {
      replace(
        event.detail?.messages ||
        event.detail?.conversation ||
        []
      );
    }
  );

  const api = Object.freeze({
    __controller: true,
    version: VERSION,
    active: true,
    legacyOwnerActive: false,
    create,
    update,
    remove,
    clear,
    replace,
    showThinking,
    removeThinking,
    scrollToBottom,
    getElement: findMessage,
    getContainer() {
      return chatMessages;
    },
    getState() {
      return {
        version: VERSION,
        active: true,
        nearBottom,
        thinking:
          Boolean(thinkingElement),
        messageCount:
          chatMessages.querySelectorAll(
            '[data-neyo-message-id]:not([data-neyo-message-id="neyo-thinking"])'
          ).length
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

  updateHero();

  emit(
    "neyo:messages-ready",
    {
      version: VERSION,
      active: true
    }
  );
})();
