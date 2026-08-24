/*
=========================================================
NEO — SHARE
Production v1

Owns:
- single-message sharing
- conversation sharing
- native Web Share API
- clipboard fallback
- safe share formatting
- compatibility share events

Does NOT own:
- public share links
- backend share storage
- conversation mutation
- history persistence
- message action buttons
- message rendering
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-share-production-v1";

  if (
    window.NeyoShare
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      defaultTitle:
        "NEO",

      conversationTitle:
        "NEO Conversation",

      maxShareCharacters:
        100_000
    });

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    active: false,

    lastType: null,

    lastMessageId: null,

    nativeShares: 0,

    clipboardFallbacks: 0,

    cancelled: 0,

    failures: 0
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
        { detail }
      )
    );
  }

  /* =====================================================
     HELPERS
     ===================================================== */

  function clean(
    value,
    max =
      CONFIG.maxShareCharacters
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
      )
      .trim();
  }

  function cleanId(
    value
  ) {
    return clean(
      value,
      128
    );
  }

  function chat() {
    const controller =
      window.NeyoChat;

    return (
      controller &&
      controller.__controller ===
        true
    )
      ? controller
      : null;
  }

  function getMessage(
    id
  ) {
    try {
      return (
        chat()
          ?.getMessage
          ?.(id) ||
        null
      );

    } catch {
      return null;
    }
  }

  function getConversation() {
    try {
      const messages =
        chat()
          ?.getConversation
          ?.();

      return Array.isArray(
        messages
      )
        ? messages
        : [];

    } catch {
      return [];
    }
  }

  /* =====================================================
     VISIBLE MESSAGE TEXT

     Never expose attachment-only internal API prompt.
     ===================================================== */

  function messageText(
    message
  ) {
    if (
      !message ||
      typeof message !==
        "object"
    ) {
      return "";
    }

    if (
      message.role ===
        "user" &&
      typeof message
        .displayContent ===
        "string"
    ) {
      return clean(
        message.displayContent
      );
    }

    const content =
      clean(
        message.content
      );

    if (
      message.role ===
        "user" &&
      Array.isArray(
        message.attachments
      ) &&
      message.attachments.length &&
      (
        content ===
          "Please analyze the attached file or files." ||
        content ===
          "Please analyze the attached file."
      )
    ) {
      return "";
    }

    return content;
  }

  /* =====================================================
     ATTACHMENT NAMES

     Share readable filenames only.
     Never expose:
     - storage bucket
     - storage path
     - signed URL
     - upload token
     - process internals
     ===================================================== */

  function attachmentNames(
    message
  ) {
    if (
      !Array.isArray(
        message?.attachments
      )
    ) {
      return [];
    }

    return message
      .attachments
      .map(
        item =>
          clean(
            item?.name,
            255
          )
      )
      .filter(Boolean)
      .slice(
        0,
        10
      );
  }

  /* =====================================================
     SOURCE FORMAT

     Only public HTTP(S) source URLs are included.
     ===================================================== */

  function sourceLines(
    message
  ) {
    if (
      !Array.isArray(
        message?.sources
      )
    ) {
      return [];
    }

    const lines = [];

    for (
      const source
      of message.sources
        .slice(
          0,
          10
        )
    ) {
      const raw =
        source?.url ||
        source?.uri ||
        source?.link ||
        source?.web?.uri ||
        "";

      if (!raw) {
        continue;
      }

      try {
        const url =
          new URL(
            raw
          );

        if (
          url.protocol !==
            "https:" &&
          url.protocol !==
            "http:"
        ) {
          continue;
        }

        const title =
          clean(
            source?.title ||
            source?.name ||
            source?.web?.title ||
            url.hostname,
            160
          );

        lines.push(
          title
            ? `${title}: ${url.href}`
            : url.href
        );

      } catch {}
    }

    return lines;
  }

  /* =====================================================
     MESSAGE FORMAT
     ===================================================== */

  function formatMessage(
    message
  ) {
    if (
      !message ||
      typeof message !==
        "object"
    ) {
      return "";
    }

    const body =
      messageText(
        message
      );

    const files =
      attachmentNames(
        message
      );

    const sources =
      sourceLines(
        message
      );

    const parts = [];

    if (body) {
      parts.push(
        body
      );
    }

    if (files.length) {
      parts.push(
        [
          files.length === 1
            ? "Attachment:"
            : "Attachments:",

          ...files.map(
            name =>
              `• ${name}`
          )
        ].join(
          "\n"
        )
      );
    }

    if (sources.length) {
      parts.push(
        [
          "Sources:",

          ...sources.map(
            source =>
              `• ${source}`
          )
        ].join(
          "\n"
        )
      );
    }

    return clean(
      parts.join(
        "\n\n"
      )
    );
  }

  /* =====================================================
     CONVERSATION TITLE
     ===================================================== */

  function deriveConversationTitle(
    messages
  ) {
    const firstUser =
      messages.find(
        message =>
          message?.role ===
            "user"
      );

    const firstText =
      messageText(
        firstUser
      );

    if (firstText) {
      const oneLine =
        firstText
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      if (oneLine.length) {
        return (
          oneLine.length >
          60
            ? `${oneLine.slice(
                0,
                57
              )}…`
            : oneLine
        );
      }
    }

    const firstFile =
      attachmentNames(
        firstUser
      )[0];

    return (
      firstFile ||
      CONFIG
        .conversationTitle
    );
  }

  /* =====================================================
     CONVERSATION FORMAT
     ===================================================== */

  function formatConversation(
    messages =
      getConversation()
  ) {
    if (
      !Array.isArray(
        messages
      ) ||
      !messages.length
    ) {
      return "";
    }

    const blocks = [];

    for (
      const message
      of messages
    ) {
      if (
        !message ||
        (
          message.role !==
            "user" &&
          message.role !==
            "assistant"
        )
      ) {
        continue;
      }

      const content =
        formatMessage(
          message
        );

      if (!content) {
        continue;
      }

      const label =
        message.role ===
          "user"
          ? "You"
          : "NEO";

      blocks.push(
        `${label}\n${content}`
      );
    }

    return clean(
      blocks.join(
        "\n\n──────────\n\n"
      )
    );
  }

  /* =====================================================
     CLIPBOARD
     ===================================================== */

  async function writeClipboard(
    value
  ) {
    const content =
      clean(
        value
      );

    if (!content) {
      return false;
    }

    try {
      if (
        navigator.clipboard
          ?.writeText &&
        window.isSecureContext
      ) {
        await navigator
          .clipboard
          .writeText(
            content
          );

        return true;
      }

    } catch {}

    /*
     * Browser compatibility fallback.
     */

    const textarea =
      document.createElement(
        "textarea"
      );

    textarea.value =
      content;

    textarea.setAttribute(
      "readonly",
      ""
    );

    textarea.setAttribute(
      "aria-hidden",
      "true"
    );

    textarea.style.position =
      "fixed";

    textarea.style.left =
      "-9999px";

    textarea.style.top =
      "0";

    textarea.style.opacity =
      "0";

    textarea.style.pointerEvents =
      "none";

    document.body.appendChild(
      textarea
    );

    textarea.focus();
    textarea.select();

    let copied =
      false;

    try {
      copied =
        document.execCommand(
          "copy"
        );

    } catch {
      copied =
        false;
    }

    textarea.remove();

    return copied;
  }

  /* =====================================================
     NATIVE SHARE
     ===================================================== */

  function canNativeShare() {
    return (
      typeof navigator
        .share ===
      "function"
    );
  }

  async function nativeShare({
    title,
    text
  }) {
    if (
      !canNativeShare()
    ) {
      return {
        supported:
          false,

        shared:
          false,

        cancelled:
          false
      };
    }

    try {
      await navigator.share({
        title:
          clean(
            title,
            200
          ) ||
          CONFIG.defaultTitle,

        text:
          clean(
            text
          )
      });

      return {
        supported:
          true,

        shared:
          true,

        cancelled:
          false
      };

    } catch (error) {
      /*
       * AbortError means the user simply dismissed
       * the system share sheet.
       */

      if (
        error?.name ===
        "AbortError"
      ) {
        return {
          supported:
            true,

          shared:
            false,

          cancelled:
            true
        };
      }

      return {
        supported:
          true,

        shared:
          false,

        cancelled:
          false,

        error
      };
    }
  }

  /* =====================================================
     SHARE CONTENT

     Native first.
     Clipboard only when native sharing is unavailable
     or native sharing fails technically.

     User-cancelled native share does NOT auto-copy.
     ===================================================== */

  async function shareContent({
    type,
    title,
    text,
    messageId = null
  }) {
    const content =
      clean(
        text
      );

    if (
      !content ||
      state.active
    ) {
      return false;
    }

    state.active =
      true;

    state.lastType =
      type;

    state.lastMessageId =
      messageId;

    emit(
      "neyo:share-start",
      {
        type,
        title,
        messageId
      }
    );

    try {
      const native =
        await nativeShare({
          title,
          text:
            content
        });

      /* -----------------------------------------------
         Native success
         ----------------------------------------------- */

      if (
        native.shared
      ) {
        state.nativeShares +=
          1;

        emit(
          "neyo:share-success",
          {
            type,

            method:
              "native",

            messageId
          }
        );

        return true;
      }

      /* -----------------------------------------------
         User cancelled share sheet
         ----------------------------------------------- */

      if (
        native.cancelled
      ) {
        state.cancelled +=
          1;

        emit(
          "neyo:share-cancelled",
          {
            type,

            method:
              "native",

            messageId
          }
        );

        return false;
      }

      /* -----------------------------------------------
         Clipboard fallback
         ----------------------------------------------- */

      const copied =
        await writeClipboard(
          content
        );

      if (copied) {
        state
          .clipboardFallbacks +=
          1;

        emit(
          "neyo:share-success",
          {
            type,

            method:
              "clipboard",

            messageId
          }
        );

        emit(
          "neyo:notification-request",
          {
            type:
              "success",

            message:
              "Copied to clipboard"
          }
        );

        return true;
      }

      /* -----------------------------------------------
         Failure
         ----------------------------------------------- */

      state.failures +=
        1;

      emit(
        "neyo:share-error",
        {
          type,

          messageId,

          error:
            native.error ||
            null
        }
      );

      emit(
        "neyo:notification-request",
        {
          type:
            "error",

          message:
            "Couldn't share this content."
        }
      );

      return false;

    } catch (error) {
      state.failures +=
        1;

      console.error(
        "[NEO Share] Failed:",
        error
      );

      emit(
        "neyo:share-error",
        {
          type,
          messageId,
          error
        }
      );

      return false;

    } finally {
      state.active =
        false;
    }
  }

  /* =====================================================
     SHARE MESSAGE
     ===================================================== */

  async function shareMessage(
    messageId
  ) {
    const id =
      cleanId(
        messageId
      );

    if (!id) {
      return false;
    }

    const message =
      getMessage(
        id
      );

    if (!message) {
      emit(
        "neyo:share-error",
        {
          type:
            "message",

          messageId:
            id,

          reason:
            "message-not-found"
        }
      );

      return false;
    }

    const content =
      formatMessage(
        message
      );

    if (!content) {
      return false;
    }

    return shareContent({
      type:
        "message",

      title:
        message.role ===
          "assistant"
          ? "NEO Response"
          : "NEO Message",

      text:
        content,

      messageId:
        id
    });
  }

  /* =====================================================
     COPY MESSAGE SHARE TEXT
     ===================================================== */

  async function copyMessage(
    messageId
  ) {
    const id =
      cleanId(
        messageId
      );

    const message =
      getMessage(
        id
      );

    if (!message) {
      return false;
    }

    const content =
      formatMessage(
        message
      );

    const copied =
      await writeClipboard(
        content
      );

    if (copied) {
      emit(
        "neyo:share-copied",
        {
          type:
            "message",

          messageId:
            id
        }
      );
    }

    return copied;
  }

  /* =====================================================
     SHARE CONVERSATION

     This shares readable text only.
     It does NOT create a public URL.
     ===================================================== */

  async function shareConversation(
    options = {}
  ) {
    const messages =
      Array.isArray(
        options.messages
      )
        ? options.messages
        : getConversation();

    if (!messages.length) {
      return false;
    }

    const content =
      formatConversation(
        messages
      );

    if (!content) {
      return false;
    }

    const title =
      clean(
        options.title,
        200
      ) ||
      deriveConversationTitle(
        messages
      );

    return shareContent({
      type:
        "conversation",

      title,

      text:
        content
    });
  }

  /* =====================================================
     COPY CONVERSATION
     ===================================================== */

  async function copyConversation(
    options = {}
  ) {
    const messages =
      Array.isArray(
        options.messages
      )
        ? options.messages
        : getConversation();

    const content =
      formatConversation(
        messages
      );

    if (!content) {
      return false;
    }

    const copied =
      await writeClipboard(
        content
      );

    if (copied) {
      emit(
        "neyo:share-copied",
        {
          type:
            "conversation"
        }
      );
    }

    return copied;
  }

  /* =====================================================
     MESSAGE ACTION EVENT

     message-actions.js emits this.
     ===================================================== */

  window.addEventListener(
    "neyo:message-share-request",
    event => {
      const id =
        event.detail?.id ||
        event.detail
          ?.message
          ?.id;

      if (id) {
        void shareMessage(
          id
        );
      }
    }
  );

  /* =====================================================
     CONVERSATION SHARE EVENT

     history-menu.js may use this later.
     ===================================================== */

  window.addEventListener(
    "neyo:conversation-share-request",
    event => {
      void shareConversation(
        event.detail ||
        {}
      );
    }
  );

  /* =====================================================
     LEGACY COMPATIBILITY
     ===================================================== */

  window.addEventListener(
    "neyo:share-message-request",
    event => {
      const id =
        event.detail
          ?.messageId ||
        event.detail
          ?.id;

      if (id) {
        void shareMessage(
          id
        );
      }
    }
  );

  window.addEventListener(
    "neyo:share-conversation-request",
    event => {
      void shareConversation(
        event.detail ||
        {}
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

      active:
        true,

      shareMessage,

      shareConversation,

      copyMessage,

      copyConversation,

      formatMessage,

      formatConversation,

      canNativeShare,

      isSharing() {
        return state.active;
      },

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          sharing:
            state.active,

          nativeShareSupported:
            canNativeShare(),

          lastType:
            state.lastType,

          lastMessageId:
            state.lastMessageId,

          metrics: {
            nativeShares:
              state.nativeShares,

            clipboardFallbacks:
              state
                .clipboardFallbacks,

            cancelled:
              state.cancelled,

            failures:
              state.failures
          }
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoShare",
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
    "neyo:share-ready",
    {
      version:
        VERSION,

      active:
        true,

      nativeShareSupported:
        canNativeShare(),

      publicLinkSharing:
        false
    }
  );
})();
