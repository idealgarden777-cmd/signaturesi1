/*
=========================================================
NEYO — MESSAGES CORE
FINAL PRODUCTION MIXER v6

FILE:
public/js/components/messages.js

OWNS
---------------------------------------------------------
- Message DOM shells
- User message wrapper
- Assistant message shell
- User attachment cards
- Image attachment previews
- File name / type / size
- Source pills
- Thinking indicator
- Message DOM updates
- Message DOM removal
- History-loaded message rendering
- Clear / replace
- Auto-scroll
- Near-bottom tracking
- Hero visibility
- Message shell lifecycle events
- DOM compatibility for future message-actions.js

DOES NOT OWN
---------------------------------------------------------
- /api/chat
- Conversation state
- Attachment upload / processing
- Markdown parser
- Send / Stop button
- Enter behavior
- History persistence
- Copy business logic
- Edit business logic
- Regenerate business logic
- Share business logic
- neo.js internals

PIPELINE
---------------------------------------------------------

chat.js
   ↓
neyo:chat-message-added
   ↓
messages.js
   ↓
message-renderer.js

MESSAGE ACTIONS
---------------------------------------------------------
messages.js creates stable message DOM hooks only.

Future:
message-actions.js
   ↓
uses data-message-id / data-role
   ↓
calls NeyoChat edit/regenerate APIs

MIGRATION RULE
---------------------------------------------------------
This module remains authoritative even while neo.js is
physically loaded.

After neo.js removal this file continues unchanged.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-messages-final-v6";

  if (
    window.NeyoMessages
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      maxTextLength:
        50_000,

      maxAttachments:
        5,

      maxSources:
        10,

      bottomThreshold:
        140,

      thinkingId:
        "neyoThinkingIndicator",

      thinkingMessageId:
        "neyo-thinking",

      attachmentOnlyPrompts:
        new Set([
          "Please analyze the attached file.",
          "Please analyze the attached file or files."
        ])
    });

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
     LEGACY TELEMETRY

     neo.js presence does not disable this module.
     ===================================================== */

  const legacyScriptPresent =
    Array
      .from(
        document.scripts || []
      )
      .some(
        script =>
          /(?:^|\/)neo\.js(?:\?|$)/
            .test(
              script.src || ""
            )
      );

  const active =
    Boolean(
      chatMessages
    );

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    nearBottom:
      true,

    thinkingElement:
      null,

    mutationDepth:
      0,

    created:
      0,

    updated:
      0,

    removed:
      0,

    cleared:
      0,

    historyLoads:
      0,

    lastMessageId:
      null,

    lastMutationAt:
      null
  };

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
     CLEAN
     ===================================================== */

  function clean(
    value,
    max =
      CONFIG.maxTextLength
  ) {
    return String(
      value ?? ""
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

  function cleanId(
    value
  ) {
    return clean(
      value,
      256
    )
      .trim();
  }

  /* =====================================================
     ID
     ===================================================== */

  function makeId() {
    return (
      globalThis.crypto
        ?.randomUUID
        ?.() ||
      (
        `msg_${Date.now()}_` +
        Math.random()
          .toString(36)
          .slice(2)
      )
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
        Number(bytes) ||
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
        "GB",
        "TB"
      ];

    value /=
      1024;

    let index =
      0;

    while (
      value >=
        1024 &&
      index <
        units.length - 1
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
    return (
      String(
        name || ""
      )
        .toLowerCase()
        .match(
          /\.([a-z0-9]+)$/
        )
        ?.[1] ||
      ""
    );
  }

  /* =====================================================
     FILE TYPE LABEL
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
        40
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
        .trim()
        .toLowerCase();

    const mime =
      clean(
        file?.mimeType ||
        file?.mime ||
        file?.type ||
        "",
        180
      )
        .trim()
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
        "ods",
        "numbers"
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
        "odp",
        "key"
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

    if (
      extension ===
      "pdf"
    ) {
      return "file-text";
    }

    return "file-text";
  }

  /* =====================================================
     IMAGE TEST
     ===================================================== */

  function isImageAttachment(
    file
  ) {
    const category =
      clean(
        file?.category,
        40
      )
        .trim()
        .toLowerCase();

    const mime =
      clean(
        file?.mimeType ||
        file?.mime ||
        file?.type,
        180
      )
        .trim()
        .toLowerCase();

    return (
      category ===
        "image" ||
      mime.startsWith(
        "image/"
      )
    );
  }

  /* =====================================================
     SAFE PREVIEW URL

     Private storage paths are NOT converted into guessed
     public URLs.
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

    if (!raw) {
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

     No CSS.escape dependency.
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

    const key =
      String(id);

    return (
      Array
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
            key
        ) ||
      null
    );
  }

  /* =====================================================
     REAL MESSAGE ELEMENTS
     ===================================================== */

  function getMessageElements() {
    if (
      !chatMessages
    ) {
      return [];
    }

    return Array
      .from(
        chatMessages
          .querySelectorAll(
            "[data-neyo-message-id]"
          )
      )
      .filter(
        element =>
          element.dataset
            .neyoMessageId !==
          CONFIG
            .thinkingMessageId
      );
  }

  /* =====================================================
     HERO
     ===================================================== */

  function updateHero() {
    if (
      !active ||
      !heroSection
    ) {
      return false;
    }

    const hasMessages =
      getMessageElements()
        .length >
      0;

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

    heroSection.classList.toggle(
      "is-hidden",
      hasMessages
    );

    return !hasMessages;
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
      CONFIG
        .bottomThreshold;
  }

  function scrollToBottom(
    behavior = "auto",
    force = false
  ) {
    if (
      !active
    ) {
      return false;
    }

    if (
      !force &&
      !state.nearBottom
    ) {
      return false;
    }

    requestAnimationFrame(
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
              scrollArea
                .scrollHeight;
          }

          state.nearBottom =
            true;

          return;
        }

        try {
          chatMessages
            ?.lastElementChild
            ?.scrollIntoView
            ?.({
              block:
                "end",

              behavior
            });
        } catch {}
      }
    );

    return true;
  }

  /* =====================================================
     MUTATION TRACKING
     ===================================================== */

  function beginMutation() {
    state.mutationDepth +=
      1;

    state.lastMutationAt =
      Date.now();
  }

  function endMutation() {
    state.mutationDepth =
      Math.max(
        0,
        state.mutationDepth - 1
      );

    state.lastMutationAt =
      Date.now();
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
        CONFIG.maxAttachments
      )
      .map(
        file => {
          const mime =
            clean(
              file.mimeType ||
              file.mime ||
              file.type ||
              "application/octet-stream",
              180
            )
              .trim() ||
            "application/octet-stream";

          return {
            ...file,

            id:
              cleanId(
                file.id
              ) ||
              undefined,

            uploadId:
              cleanId(
                file.uploadId
              ) ||
              undefined,

            name:
              clean(
                file.name ||
                "Attached file",
                220
              )
                .trim() ||
              "Attached file",

            size:
              Math.max(
                0,
                Number(
                  file.size
                ) ||
                0
              ),

            mime,

            mimeType:
              mime,

            type:
              mime,

            category:
              clean(
                file.category ||
                "unknown",
                40
              )
                .trim()
                .toLowerCase() ||
              "unknown",

            previewUrl:
              safePreview(
                file.previewUrl ||
                file.url ||
                ""
              )
          };
        }
      );
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
     * Keep current production CSS contracts.
     */

    card.className =
      [
        "message-file-pill",
        "neyo-message-file-card"
      ].join(" ");

    card.setAttribute(
      "role",
      "group"
    );

    const name =
      clean(
        file?.name ||
        "Attached file",
        220
      )
        .trim() ||
      "Attached file";

    card.title =
      name;

    if (
      file?.id
    ) {
      card.dataset
        .attachmentId =
        String(
          file.id
        );
    }

    const preview =
      safePreview(
        file?.previewUrl ||
        file?.url ||
        ""
      );

    /* =================================================
       VISUAL
       ================================================= */

    const visual =
      document.createElement(
        "div"
      );

    visual.className =
      "neyo-message-file-visual";

    if (
      isImageAttachment(
        file
      ) &&
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

      image.addEventListener(
        "error",
        () => {
          visual
            .classList
            .add(
              "is-preview-error"
            );

          image.remove();

          if (
            !visual.querySelector(
              "[data-lucide]"
            )
          ) {
            const icon =
              document
                .createElement(
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
          }
        },
        {
          once:
            true
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

    /* =================================================
       BODY
       ================================================= */

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

    const type =
      fileTypeLabel(
        file
      );

    if (type) {
      parts.push(
        type
      );
    }

    meta.textContent =
      parts.join(
        " · "
      );

    body.appendChild(
      nameElement
    );

    if (
      meta.textContent
    ) {
      body.appendChild(
        meta
      );
    }

    card.append(
      visual,
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
    if (!wrapper) {
      return null;
    }

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

    /*
     * Keep current production CSS contracts.
     */

    root.className =
      [
        "message-media-grid",
        "neyo-message-attachments"
      ].join(" ");

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
     * Attachments above user text.
     */

    wrapper.prepend(
      root
    );

    return root;
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
     SOURCE NORMALIZATION
     ===================================================== */

  function normalizeSource(
    source
  ) {
    if (
      !source ||
      typeof source !==
        "object"
    ) {
      return null;
    }

    const value =
      source.url ||
      source.uri ||
      source.link ||
      source.web?.uri ||
      "";

    if (
      !value
    ) {
      return null;
    }

    try {
      const url =
        new URL(
          value,
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
            url.hostname
              .replace(
                /^www\./,
                ""
              ),
            160
          )
            .trim() ||
          "Source"
      };

    } catch {
      return null;
    }
  }

  /* =====================================================
     RENDER SOURCES
     ===================================================== */

  function renderSources(
    messageElement,
    sources
  ) {
    if (
      !messageElement
    ) {
      return null;
    }

    messageElement
      .querySelector(
        ".neo-source-pills"
      )
      ?.remove();

    if (
      !Array.isArray(
        sources
      ) ||
      sources.length ===
        0
    ) {
      return null;
    }

    const valid =
      sources
        .slice(
          0,
          CONFIG.maxSources
        )
        .map(
          normalizeSource
        )
        .filter(Boolean);

    if (
      valid.length ===
      0
    ) {
      return null;
    }

    const root =
      document.createElement(
        "div"
      );

    /*
     * Preserve old production source styles.
     */

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

      link.referrerPolicy =
        "no-referrer-when-downgrade";

      link.textContent =
        source.label;

      link.title =
        source.label;

      root.appendChild(
        link
      );
    }

    messageElement.appendChild(
      root
    );

    return root;
  }

  /* =====================================================
     ATTACHMENT-ONLY DISPLAY
     ===================================================== */

  function shouldHideUserText(
    message,
    text
  ) {
    return Boolean(
      Array.isArray(
        message?.attachments
      ) &&
      message.attachments.length >
        0 &&
      CONFIG
        .attachmentOnlyPrompts
        .has(
          text.trim()
        )
    );
  }

  /* =====================================================
     RENDER CONTENT
     ===================================================== */

  function renderContent(
    element,
    message,
    markdown = true
  ) {
    if (
      !element ||
      !message
    ) {
      return false;
    }

    const content =
      element.querySelector(
        ".message-content"
      );

    if (!content) {
      return false;
    }

    const text =
      clean(
        message.content
      );

    /* =================================================
       USER = ALWAYS PLAIN TEXT
       ================================================= */

    if (
      message.role !==
      "assistant"
    ) {
      if (
        shouldHideUserText(
          message,
          text
        )
      ) {
        content.textContent =
          "";

        content.hidden =
          true;

      } else {
        content.textContent =
          text;

        content.hidden =
          text.trim()
            .length ===
          0;
      }

      return true;
    }

    /* =================================================
       ASSISTANT FALLBACK FIRST
       ================================================= */

    content.hidden =
      false;

    content.textContent =
      text;

    /*
     * Preferred renderer API.
     */

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

        return true;

      } catch (
        error
      ) {
        console.warn(
          "[NEYO Messages] Message renderer failed:",
          error
        );
      }
    }

    /*
     * Compatibility API.
     */

    if (
      typeof window
        .NeyoMessageRenderer
        ?.renderInto ===
      "function"
    ) {
      try {
        window
          .NeyoMessageRenderer
          .renderInto(
            content,
            text,
            {
              role:
                "assistant",

              markdown
            }
          );

        return true;

      } catch (
        error
      ) {
        console.warn(
          "[NEYO Messages] renderInto failed:",
          error
        );
      }
    }

    /*
     * Late renderer bridge.
     */

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

    return true;
  }

  /* =====================================================
     APPLY MESSAGE METADATA
     ===================================================== */

  function applyMessageMetadata(
    element,
    message,
    id
  ) {
    element.dataset
      .neyoMessageId =
      id;

    /*
     * Legacy/future action compatibility.
     */

    element.dataset
      .messageId =
      id;

    element.dataset.role =
      message.role;

    element.setAttribute(
      "data-role",
      message.role
    );

    if (
      message.error ===
      true
    ) {
      element.classList.add(
        "is-error"
      );

      element.dataset.error =
        "true";

    } else {
      element.classList.remove(
        "is-error"
      );

      element.dataset.error =
        "false";
    }
  }

  /* =====================================================
     CREATE USER SHELL
     ===================================================== */

  function createUserShell() {
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

    return wrapper;
  }

  /* =====================================================
     CREATE ASSISTANT SHELL
     ===================================================== */

  function createAssistantShell() {
    const content =
      document.createElement(
        "div"
      );

    content.className =
      "message-content";

    return content;
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
      cleanId(
        message.id
      ) ||
      makeId();

    /*
     * Duplicate-event protection.
     */

    const existing =
      findMessage(
        id
      );

    if (
      existing
    ) {
      /*
       * When duplicate event contains newer data,
       * update existing shell instead of creating a
       * second message.
       */

      updateFromMessage(
        id,
        {
          ...message,
          id
        },
        {
          markdown:
            true,

          emitEvent:
            false
        }
      );

      return existing;
    }

    if (
      message.role ===
      "assistant"
    ) {
      removeThinking();
    }

    beginMutation();

    try {
      const element =
        document.createElement(
          "div"
        );

      /*
       * Keep exact old production base classes.
       */

      element.className =
        `message ${message.role}`;

      applyMessageMetadata(
        element,
        message,
        id
      );

      if (
        options.historyLoad
      ) {
        element.dataset
          .historyLoad =
          "true";

        state.historyLoads +=
          1;
      }

      /* =================================================
         USER
         ================================================= */

      if (
        message.role ===
        "user"
      ) {
        const wrapper =
          createUserShell();

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
        element.appendChild(
          createAssistantShell()
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
        options.markdown ??
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

      state.created +=
        1;

      state.lastMessageId =
        id;

      state.lastMutationAt =
        Date.now();

      /*
       * message-actions.js will attach its own action UI
       * from this event later.
       */

      emit(
        "neyo:message-shell-created",
        {
          id,

          element,

          message: {
            ...message,
            id
          },

          historyLoad:
            Boolean(
              options.historyLoad
            )
        }
      );

      emit(
        "neyo:message-created",
        {
          id,

          element,

          role:
            message.role
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

    } finally {
      endMutation();
    }
  }

  /* =====================================================
     UPDATE FROM MESSAGE OBJECT
     ===================================================== */

  function updateFromMessage(
    id,
    message,
    options = {}
  ) {
    const element =
      findMessage(
        id
      );

    if (
      !element ||
      !message
    ) {
      return false;
    }

    beginMutation();

    try {
      const role =
        message.role ||
        element.dataset.role ||
        "assistant";

      const normalized =
        {
          ...message,

          id,

          role,

          content:
            clean(
              message.content
            )
        };

      applyMessageMetadata(
        element,
        normalized,
        id
      );

      /*
       * User attachment refresh.
       */

      if (
        role ===
          "user" &&
        Array.isArray(
          message.attachments
        )
      ) {
        updateAttachments(
          element,
          message.attachments
        );
      }

      renderContent(
        element,
        normalized,
        options.markdown ??
          true
      );

      /*
       * Assistant source refresh.
       */

      if (
        role ===
        "assistant"
      ) {
        if (
          Object.prototype
            .hasOwnProperty
            .call(
              message,
              "sources"
            )
        ) {
          renderSources(
            element,
            message.sources
          );
        }
      }

      state.updated +=
        1;

      state.lastMessageId =
        id;

      state.lastMutationAt =
        Date.now();

      if (
        options.emitEvent !==
        false
      ) {
        emit(
          "neyo:message-updated",
          {
            id,

            element,

            message:
              normalized
          }
        );
      }

      requestAnimationFrame(
        () => {
          scrollToBottom(
            "auto",
            false
          );
        }
      );

      return true;

    } finally {
      endMutation();
    }
  }

  /* =====================================================
     LEGACY UPDATE SIGNATURE

     update(id, content, options)
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

    const role =
      element.dataset.role ||
      "assistant";

    return updateFromMessage(
      id,
      {
        id,

        role,

        content,

        attachments:
          options.attachments,

        sources:
          options.sources,

        error:
          options.error ===
          true
      },
      {
        markdown:
          options.markdown ??
          true
      }
    );
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

    if (!element) {
      return false;
    }

    beginMutation();

    try {
      element.remove();

      if (
        String(id) ===
        CONFIG
          .thinkingMessageId
      ) {
        state.thinkingElement =
          null;
      }

      state.removed +=
        1;

      state.lastMutationAt =
        Date.now();

      updateHero();

      emit(
        "neyo:message-removed",
        {
          id
        }
      );

      return true;

    } finally {
      endMutation();
    }
  }

  /* =====================================================
     REMOVE MESSAGES AFTER TARGET

     Useful compatibility primitive for edit/regenerate UI.
     Conversation mutation still belongs to chat.js.
     ===================================================== */

  function removeAfter(
    id
  ) {
    const element =
      findMessage(
        id
      );

    if (
      !element
    ) {
      return 0;
    }

    let next =
      element.nextElementSibling;

    let count =
      0;

    beginMutation();

    try {
      while (
        next
      ) {
        const candidate =
          next;

        next =
          next.nextElementSibling;

        if (
          candidate.dataset
            ?.neyoMessageId ===
          CONFIG
            .thinkingMessageId
        ) {
          state.thinkingElement =
            null;
        }

        candidate.remove();

        count +=
          1;
      }

      state.removed +=
        count;

      updateHero();

      emit(
        "neyo:messages-truncated",
        {
          afterId:
            id,

          removed:
            count
        }
      );

      return count;

    } finally {
      endMutation();
    }
  }

  /* =====================================================
     THINKING — CREATE
     ===================================================== */

  function showThinking(
    event = null
  ) {
    if (
      !active
    ) {
      return null;
    }

    /*
     * Only one thinking element.
     */

    removeThinking();

    const element =
      document.createElement(
        "div"
      );

    element.id =
      CONFIG
        .thinkingId;

    element.className =
      [
        "message",
        "assistant",
        "is-thinking"
      ].join(" ");

    element.dataset
      .neyoMessageId =
      CONFIG
        .thinkingMessageId;

    element.dataset
      .messageId =
      CONFIG
        .thinkingMessageId;

    element.dataset.role =
      "assistant";

    if (
      event?.detail
        ?.requestId != null
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
      "NEYO is thinking"
    );

    const content =
      document.createElement(
        "div"
      );

    /*
     * Keep typing-indicator compatibility AND current
     * thinking state styling.
     */

    content.className =
      "message-content typing-indicator";

    const shimmer =
      document.createElement(
        "span"
      );

    shimmer.className =
      "thinking-shimmer";

    shimmer.textContent =
      "Thinking.";

    /*
     * Old production typing dots remain in DOM as
     * compatibility hooks. CSS can decide visual style.
     */

    const dots =
      document.createElement(
        "span"
      );

    dots.className =
      "neyo-thinking-dots";

    dots.setAttribute(
      "aria-hidden",
      "true"
    );

    for (
      let index = 0;
      index < 3;
      index += 1
    ) {
      const dot =
        document.createElement(
          "span"
        );

      dot.className =
        "typing-dot";

      dots.appendChild(
        dot
      );
    }

    content.append(
      shimmer,
      dots
    );

    element.appendChild(
      content
    );

    chatMessages.appendChild(
      element
    );

    state.thinkingElement =
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
            ?.requestId ??
          null
      }
    );

    return element;
  }

  /* =====================================================
     THINKING — REMOVE
     ===================================================== */

  function removeThinking() {
    if (
      !active
    ) {
      return false;
    }

    const element =
      state.thinkingElement ||
      document.getElementById(
        CONFIG
          .thinkingId
      ) ||
      findMessage(
        CONFIG
          .thinkingMessageId
      );

    state.thinkingElement =
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
    if (
      !active ||
      !chatMessages
    ) {
      return false;
    }

    beginMutation();

    try {
      state.thinkingElement =
        null;

      chatMessages
        .replaceChildren();

      state.nearBottom =
        true;

      state.cleared +=
        1;

      state.lastMessageId =
        null;

      state.lastMutationAt =
        Date.now();

      updateHero();

      emit(
        "neyo:messages-cleared"
      );

      return true;

    } finally {
      endMutation();
    }
  }

  /* =====================================================
     REPLACE / HISTORY COMPATIBILITY
     ===================================================== */

  function replace(
    messages = [],
    options = {}
  ) {
    if (
      !active ||
      !Array.isArray(
        messages
      )
    ) {
      return false;
    }

    clear();

    for (
      const message
      of messages
    ) {
      create(
        message,
        {
          historyLoad:
            options.historyLoad !==
            false,

          forceScroll:
            false,

          markdown:
            options.markdown ??
            true
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

    emit(
      "neyo:messages-replaced",
      {
        count:
          messages.length
      }
    );

    return true;
  }

  /* =====================================================
     RERENDER

     Re-runs renderer against existing assistant messages.
     Useful if message-renderer.js loads slightly later.
     ===================================================== */

  function rerender() {
    if (
      !active
    ) {
      return 0;
    }

    let count =
      0;

    /*
     * Prefer canonical chat state so the raw markdown
     * content is not lost after DOM rendering.
     */

    const conversation =
      window.NeyoChat
        ?.getConversation
        ?.();

    if (
      Array.isArray(
        conversation
      )
    ) {
      for (
        const message
        of conversation
      ) {
        const element =
          findMessage(
            message.id
          );

        if (!element) {
          continue;
        }

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

        count +=
          1;
      }

      refreshIcons();

      return count;
    }

    return 0;
  }

  /* =====================================================
     SCROLL EVENT
     ===================================================== */

  if (
    active
  ) {
    scrollArea
      ?.addEventListener(
        "scroll",
        () => {
          state.nearBottom =
            atBottom();
        },
        {
          passive:
            true
        }
      );
  }

  /* =====================================================
     CHAT MESSAGE ADDED
     ===================================================== */

  window.addEventListener(
    "neyo:chat-message-added",
    event => {
      if (
        !active
      ) {
        return;
      }

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
            ),

          forceScroll:
            message.role ===
            "user"
        }
      );
    }
  );

  /* =====================================================
     CHAT MESSAGE UPDATED

     New chat.js final mixer emits this canonical event.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-message-updated",
    event => {
      if (
        !active
      ) {
        return;
      }

      const message =
        event.detail
          ?.message;

      const id =
        message?.id ||
        event.detail
          ?.id;

      if (
        !id ||
        !message
      ) {
        return;
      }

      updateFromMessage(
        id,
        message,
        {
          markdown:
            true
        }
      );
    }
  );

  /* =====================================================
     CHAT MESSAGE REMOVED
     ===================================================== */

  window.addEventListener(
    "neyo:chat-message-removed",
    event => {
      if (
        !active
      ) {
        return;
      }

      const id =
        event.detail
          ?.message
          ?.id ||
        event.detail
          ?.id;

      if (id) {
        remove(
          id
        );
      }
    }
  );

  /* =====================================================
     GENERATION START
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    event => {
      if (
        !active
      ) {
        return;
      }

      showThinking(
        event
      );
    }
  );

  /* =====================================================
     THINKING END

     Assistant message creation normally removes thinking
     before these fire. These are defensive cleanup.
     ===================================================== */

  for (
    const eventName
    of [
      "neyo:chat-response",
      "neyo:chat-send-end",
      "neyo:chat-aborted",
      "neyo:chat-error",
      "neyo:chat-limit-reached",
      "neyo:chat-new",
      "neyo:chat-state-loaded"
    ]
  ) {
    window.addEventListener(
      eventName,
      removeThinking
    );
  }

  /* =====================================================
     CLEAR
     ===================================================== */

  window.addEventListener(
    "neyo:messages-clear",
    clear
  );

  /* =====================================================
     LEGACY / DIRECT UPDATE REQUEST

     Supports both:
     {
       id,
       content,
       options
     }

     and newer:
     {
       id,
       message
     }
     ===================================================== */

  window.addEventListener(
    "neyo:message-update-request",
    event => {
      if (
        !active
      ) {
        return;
      }

      const detail =
        event.detail ||
        {};

      if (
        detail.message &&
        typeof detail.message ===
          "object"
      ) {
        const id =
          detail.message.id ||
          detail.id;

        if (id) {
          updateFromMessage(
            id,
            detail.message,
            detail.options ||
            {}
          );
        }

        return;
      }

      update(
        detail.id,
        detail.content,
        detail.options ||
        {}
      );
    }
  );

  /* =====================================================
     OPTIONAL REPLACE BRIDGE
     ===================================================== */

  window.addEventListener(
    "neyo:messages-replace",
    event => {
      replace(
        event.detail
          ?.messages ||
        event.detail
          ?.conversation ||
        [],
        event.detail
          ?.options ||
        {}
      );
    }
  );

  /* =====================================================
     RENDERER READY

     Handles loader-order timing without rewriting chat.
     ===================================================== */

  window.addEventListener(
    "neyo:message-renderer-ready",
    () => {
      rerender();
    }
  );

  /* =====================================================
     EXPLICIT SCROLL REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:messages-scroll-bottom-request",
    event => {
      scrollToBottom(
        event.detail
          ?.behavior ||
        "auto",

        event.detail
          ?.force ===
        true
      );
    }
  );

  /* =====================================================
     EXPLICIT TRUNCATE REQUEST

     DOM only.
     chat.js remains conversation-state owner.
     ===================================================== */

  window.addEventListener(
    "neyo:messages-remove-after-request",
    event => {
      const id =
        event.detail
          ?.id ||
        event.detail
          ?.messageId;

      if (id) {
        removeAfter(
          id
        );
      }
    }
  );

  /* =====================================================
     INITIAL HERO
     ===================================================== */

  if (
    active
  ) {
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

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      /*
       * Message DOM
       */

      create,

      update,

      updateFromMessage,

      remove,

      removeAfter,

      clear,

      replace,

      rerender,

      /*
       * Thinking
       */

      showThinking,

      removeThinking,

      /*
       * Scroll / hero
       */

      scrollToBottom,

      atBottom,

      updateHero,

      /*
       * Lookup
       */

      getElement:
        findMessage,

      getMessageElement:
        findMessage,

      getElements:
        getMessageElements,

      getContainer() {
        return chatMessages;
      },

      /*
       * Attachment rendering helpers
       */

      renderAttachments,

      createFileCard,

      /*
       * Source rendering
       */

      renderSources,

      /*
       * State
       */

      getState() {
        return {
          version:
            VERSION,

          active,

          legacyScriptPresent,

          legacyOwnerActive:
            false,

          nearBottom:
            state.nearBottom,

          thinking:
            Boolean(
              state.thinkingElement ||
              document.getElementById(
                CONFIG
                  .thinkingId
              )
            ),

          mutationDepth:
            state.mutationDepth,

          messageCount:
            active
              ? getMessageElements()
                  .length
              : 0,

          created:
            state.created,

          updated:
            state.updated,

          removed:
            state.removed,

          cleared:
            state.cleared,

          historyLoads:
            state.historyLoads,

          lastMessageId:
            state.lastMessageId,

          lastMutationAt:
            state.lastMutationAt
        };
      }
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

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      attachmentRendering:
        true,

      sourceRendering:
        true,

      thinking:
        true,

      replaceCompatibility:
        true
    }
  );
})();
