/*
=========================================================
NEO — SHARE
Production v3 — Baseline Safe

Baseline:
- Old working neo.js native Web Share behavior
- Current message-actions.js share routing
- Current NeyoChat canonical state

Owns:
- Message sharing
- Conversation sharing
- Native Web Share
- Clipboard fallback
- Share formatting
- Share lifecycle events

Does NOT own:
- Share button DOM
- Message action mounting
- Conversation state
- Public share-link backend
- History persistence
- Notifications UI
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-share-production-v3";

  if (
    window.NeyoShare
      ?.__controller === true
  ) {
    return;
  }

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
        {
          detail
        }
      )
    );
  }

  /* =====================================================
     HELPERS
     ===================================================== */

  function clean(
    value,
    max = 50_000
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

  function cleanId(value) {
    return clean(
      value,
      160
    );
  }

  function chatController() {
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

  /* =====================================================
     MESSAGE LOOKUP
     ===================================================== */

  function getMessage(
    messageId
  ) {
    const id =
      cleanId(messageId);

    if (!id) {
      return null;
    }

    try {
      return (
        chatController()
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
      const value =
        chatController()
          ?.getConversation
          ?.();

      return Array.isArray(
        value
      )
        ? value
        : [];

    } catch {
      return [];
    }
  }

  /* =====================================================
     ATTACHMENT LABELS

     Do not expose:
     - storage paths
     - signed URLs
     - bucket names
     - internal IDs
     ===================================================== */

  function formatAttachmentNames(
    attachments
  ) {
    if (
      !Array.isArray(
        attachments
      ) ||
      attachments.length === 0
    ) {
      return "";
    }

    const names =
      attachments
        .map(file =>
          clean(
            file?.name ||
            file?.fileName ||
            "",
            255
          )
        )
        .filter(Boolean);

    if (!names.length) {
      return "";
    }

    return names
      .map(name =>
        `[Attachment: ${name}]`
      )
      .join("\n");
  }

  /* =====================================================
     MESSAGE CONTENT
     ===================================================== */

  function getVisibleMessageContent(
    message
  ) {
    if (!message) {
      return "";
    }

    if (
      message.role === "user" &&
      typeof message.displayContent ===
        "string"
    ) {
      return clean(
        message.displayContent
      );
    }

    return clean(
      message.content || ""
    );
  }

  /* =====================================================
     FORMAT MESSAGE
     ===================================================== */

  function formatMessage(
    message,
    {
      includeRole = false
    } = {}
  ) {
    if (
      !message ||
      typeof message !==
        "object"
    ) {
      return "";
    }

    const text =
      getVisibleMessageContent(
        message
      );

    const attachments =
      formatAttachmentNames(
        message.attachments
      );

    const parts = [];

    if (includeRole) {
      if (
        message.role ===
        "assistant"
      ) {
        parts.push(
          "NEO:"
        );

      } else if (
        message.role ===
        "user"
      ) {
        parts.push(
          "You:"
        );
      }
    }

    if (text) {
      parts.push(text);
    }

    if (attachments) {
      parts.push(
        attachments
      );
    }

    return parts
      .join(
        includeRole
          ? "\n"
          : "\n\n"
      )
      .trim();
  }

  /* =====================================================
     FORMAT CONVERSATION
     ===================================================== */

  function formatConversation(
    messages
  ) {
    if (
      !Array.isArray(
        messages
      )
    ) {
      return "";
    }

    return messages
      .filter(message => {
        if (
          !message ||
          typeof message !==
            "object"
        ) {
          return false;
        }

        if (
          message.error ===
          true
        ) {
          return false;
        }

        if (
          message.streaming ===
          true &&
          !clean(
            message.content ||
            ""
          )
        ) {
          return false;
        }

        return (
          message.role ===
            "user" ||
          message.role ===
            "assistant"
        );
      })
      .map(message =>
        formatMessage(
          message,
          {
            includeRole: true
          }
        )
      )
      .filter(Boolean)
      .join(
        "\n\n"
      )
      .trim();
  }

  /* =====================================================
     TITLE
     ===================================================== */

  function deriveConversationTitle(
    messages
  ) {
    if (
      !Array.isArray(
        messages
      )
    ) {
      return "NEO Conversation";
    }

    const firstUser =
      messages.find(
        message =>
          message?.role ===
          "user"
      );

    const text =
      getVisibleMessageContent(
        firstUser
      );

    if (text) {
      return text
        .replace(
          /\s+/g,
          " "
        )
        .slice(
          0,
          80
        );
    }

    const attachmentName =
      firstUser
        ?.attachments?.[0]
        ?.name;

    if (attachmentName) {
      return clean(
        attachmentName,
        80
      );
    }

    return "NEO Conversation";
  }

  /* =====================================================
     CLIPBOARD
     ===================================================== */

  async function writeClipboard(
    value
  ) {
    const text =
      clean(
        value
      );

    if (!text) {
      return false;
    }

    try {
      if (
        navigator.clipboard &&
        window.isSecureContext
      ) {
        await navigator.clipboard
          .writeText(text);

        return true;
      }
    } catch {}

    const textarea =
      document.createElement(
        "textarea"
      );

    textarea.value =
      text;

    textarea.setAttribute(
      "readonly",
      ""
    );

    textarea.style.position =
      "fixed";

    textarea.style.opacity =
      "0";

    textarea.style.left =
      "-9999px";

    textarea.style.pointerEvents =
      "none";

    document.body.appendChild(
      textarea
    );

    textarea.select();

    let copied = false;

    try {
      copied =
        document.execCommand(
          "copy"
        );
    } catch {
      copied = false;
    }

    textarea.remove();

    return copied;
  }

  /* =====================================================
     NATIVE SHARE
     ===================================================== */

  function canNativeShare() {
    return (
      typeof navigator.share ===
      "function"
    );
  }

  function isShareCancel(
    error
  ) {
    return (
      error?.name ===
        "AbortError" ||
      error?.name ===
        "NotAllowedError"
    );
  }

  async function nativeShare({
    title,
    text
  }) {
    if (!canNativeShare()) {
      return {
        supported: false,

        shared: false,

        cancelled: false,

        error: null
      };
    }

    try {
      await navigator.share({
        title:
          clean(
            title,
            200
          ) ||
          undefined,

        text:
          clean(text)
      });

      return {
        supported: true,

        shared: true,

        cancelled: false,

        error: null
      };

    } catch (error) {
      if (
        isShareCancel(
          error
        )
      ) {
        return {
          supported: true,

          shared: false,

          cancelled: true,

          error
        };
      }

      return {
        supported: true,

        shared: false,

        cancelled: false,

        error
      };
    }
  }

  /* =====================================================
     SHARE CONTENT

     Old behavior:
     native navigator.share({ text })

     Improved behavior:
     native first, clipboard fallback only if native share
     is unavailable or genuinely fails.

     User cancelling native share NEVER triggers clipboard.
     ===================================================== */

  async function shareContent({
    type,
    title,
    text,
    messageId = null
  }) {
    const content =
      clean(text);

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
         NATIVE SUCCESS
         ----------------------------------------------- */

      if (native.shared) {
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
         USER CANCELLED

         Important:
         Do not copy anything automatically.
         ----------------------------------------------- */

      if (native.cancelled) {
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
         CLIPBOARD FALLBACK
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
     COPY MESSAGE
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
     ===================================================== */

  window.addEventListener(
    "neyo:message-share-request",
    event => {
      const id =
        event.detail
          ?.messageId ||
        event.detail?.id ||
        event.detail
          ?.message?.id;

      if (id) {
        void shareMessage(
          id
        );
      }
    }
  );

  /* =====================================================
     CONVERSATION SHARE EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:conversation-share-request",
    event => {
      void shareConversation(
        event.detail || {}
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
        event.detail?.id;

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
        event.detail || {}
      );
    }
  );

  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({
      __controller:
        true,

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
