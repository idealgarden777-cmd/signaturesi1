/*
=========================================================
NEYO — SHARE
FINAL PRODUCTION MIXER v6

FILE:
public/js/components/share.js

OWNS
---------------------------------------------------------
- Individual message sharing
- Current conversation sharing
- History conversation sharing
- Native Web Share API
- Clipboard fallback
- Share fallback modal
- Share preview text
- Attachment-name representation
- Copy feedback
- Share lifecycle events
- Keyboard / Escape / focus handling
- Public share API
- Duplicate share protection

DOES NOT OWN
---------------------------------------------------------
- Public share-link backend
- Conversation persistence
- History menu positioning
- Message action buttons
- Chat transport
- Message rendering
- Attachments storage
- Authentication
- neo.js internals

IMPORTANT
---------------------------------------------------------
This module DOES NOT invent public URLs.

Until a real server-side share-link endpoint exists,
conversation sharing is local:

1. Native device share sheet, when available.
2. Fallback share modal.
3. Clipboard copy.

No private bucket URL or internal storage path is exposed.

FLOW — MESSAGE
---------------------------------------------------------

message-actions.js
      ↓
neyo:message-share-request
      ↓
share.js
      ↓
native share OR modal/copy fallback

FLOW — CONVERSATION
---------------------------------------------------------

history-menu.js
      ↓
neyo:conversation-share-request
      ↓
share.js
      ↓
history.js fetch if needed
      ↓
native share OR modal/copy fallback

MIGRATION RULE
---------------------------------------------------------
Works while neo.js is still physically loaded.

message-actions.js already intercepts legacy message share
button clicks.

After neo.js removal this file continues unchanged.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-share-final-v6";

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
      maxMessageLength:
        100_000,

      maxConversationLength:
        180_000,

      maxMessages:
        100,

      maxAttachmentsPerMessage:
        5,

      duplicateWindowMs:
        500,

      copyFeedbackMs:
        1600,

      appName:
        "NEYO",

      modalId:
        "neyoShareModal",

      modalStyleId:
        "neyoShareModalStyle"
    });

  /* =====================================================
     LEGACY TELEMETRY
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

  /* =====================================================
     STATE
     ===================================================== */

  let modal =
    null;

  let modalPanel =
    null;

  let modalTitle =
    null;

  let modalPreview =
    null;

  let modalCopyButton =
    null;

  let modalNativeButton =
    null;

  let modalCloseButton =
    null;

  let previousFocus =
    null;

  let currentPayload =
    null;

  let shareInProgress =
    false;

  let lastShareKey =
    "";

  let lastShareAt =
    0;

  const metrics = {
    messageShares:
      0,

    conversationShares:
      0,

    nativeShares:
      0,

    clipboardShares:
      0,

    modalOpens:
      0,

    cancelled:
      0,

    duplicateBlocked:
      0,

    failures:
      0,

    lastSharedAt:
      null
  };

  /* =====================================================
     EVENT
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

  function cleanId(
    value
  ) {
    return String(
      value || ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .trim()
      .slice(
        0,
        256
      );
  }

  function cleanText(
    value,
    max =
      CONFIG.maxMessageLength
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

  function cloneValue(
    value
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return value;
    }

    if (
      typeof structuredClone ===
      "function"
    ) {
      try {
        return structuredClone(
          value
        );
      } catch {}
    }

    try {
      return JSON.parse(
        JSON.stringify(
          value
        )
      );

    } catch {
      return value;
    }
  }

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  /* =====================================================
     ATTACHMENT NAME
     ===================================================== */

  function attachmentName(
    attachment
  ) {
    return cleanText(
      attachment?.name ||
      "Attached file",
      255
    )
      .trim() ||
      "Attached file";
  }

  /* =====================================================
     ATTACHMENT LABEL
     ===================================================== */

  function attachmentLabel(
    attachment
  ) {
    const category =
      cleanText(
        attachment
          ?.category ||
        "",
        50
      )
        .trim()
        .toLowerCase();

    const name =
      attachmentName(
        attachment
      );

    return category &&
      category !==
        "unknown"
      ? `[${category}: ${name}]`
      : `[Attachment: ${name}]`;
  }

  /* =====================================================
     DISPLAY MESSAGE CONTENT

     Do not expose our internal attachment-only prompt.
     ===================================================== */

  function displayContent(
    message
  ) {
    const content =
      cleanText(
        message
          ?.displayContent ??
        message
          ?.content ??
        ""
      );

    const attachments =
      Array.isArray(
        message?.attachments
      )
        ? message.attachments
        : [];

    if (
      attachments.length &&
      [
        "Please analyze the attached file.",
        "Please analyze the attached file or files."
      ].includes(
        content.trim()
      )
    ) {
      return "";
    }

    return content.trim();
  }

  /* =====================================================
     FORMAT ONE MESSAGE
     ===================================================== */

  function formatMessage(
    message,
    {
      includeRole =
        true
    } = {}
  ) {
    if (
      !message ||
      ![
        "user",
        "assistant"
      ].includes(
        message.role
      )
    ) {
      return "";
    }

    const text =
      displayContent(
        message
      );

    const attachments =
      Array.isArray(
        message.attachments
      )
        ? message
            .attachments
            .slice(
              0,
              CONFIG
                .maxAttachmentsPerMessage
            )
        : [];

    const attachmentText =
      attachments
        .map(
          attachmentLabel
        )
        .join(
          "\n"
        );

    const body =
      [
        text,
        attachmentText
      ]
        .filter(Boolean)
        .join(
          text &&
          attachmentText
            ? "\n\n"
            : ""
        );

    if (!body) {
      return "";
    }

    if (
      !includeRole
    ) {
      return body;
    }

    const roleLabel =
      message.role ===
        "user"
        ? "You"
        : CONFIG.appName;

    return `${roleLabel}:\n${body}`;
  }

  /* =====================================================
     GET CHAT MESSAGE
     ===================================================== */

  function getChatMessage(
    id
  ) {
    const key =
      cleanId(
        id
      );

    if (!key) {
      return null;
    }

    try {
      const direct =
        window.NeyoChat
          ?.getMessage
          ?.(key);

      if (
        direct
      ) {
        return cloneValue(
          direct
        );
      }
    } catch {}

    try {
      const conversation =
        window.NeyoChat
          ?.getConversation
          ?.();

      if (
        Array.isArray(
          conversation
        )
      ) {
        const match =
          conversation.find(
            message =>
              cleanId(
                message?.id
              ) ===
              key
          );

        if (
          match
        ) {
          return cloneValue(
            match
          );
        }
      }
    } catch {}

    return null;
  }

  /* =====================================================
     NORMALIZE MESSAGE SHARE REQUEST
     ===================================================== */

  function normalizeMessageRequest(
    request = {}
  ) {
    const messageId =
      cleanId(
        request.messageId ||
        request.id ||
        request.message?.id
      );

    const canonical =
      getChatMessage(
        messageId
      ) ||
      (
        request.message &&
        typeof request.message ===
          "object"
          ? cloneValue(
              request.message
            )
          : null
      );

    let text =
      cleanText(
        request.text ||
        ""
      )
        .trim();

    if (
      !text &&
      canonical
    ) {
      text =
        formatMessage(
          canonical,
          {
            includeRole:
              false
          }
        );
    }

    if (
      !text
    ) {
      return null;
    }

    return {
      type:
        "message",

      messageId:
        messageId ||
        cleanId(
          canonical?.id
        ) ||
        null,

      title:
        canonical?.role ===
        "user"
          ? "Shared message"
          : "NEYO response",

      text:
        text.slice(
          0,
          CONFIG
            .maxMessageLength
        ),

      message:
        canonical
          ? cloneValue(
              canonical
            )
          : null
    };
  }

  /* =====================================================
     CHAT CONVERSATION
     ===================================================== */

  function getCurrentConversation() {
    try {
      const conversation =
        window.NeyoChat
          ?.getConversation
          ?.();

      return Array.isArray(
        conversation
      )
        ? cloneValue(
            conversation
          )
        : [];

    } catch {
      return [];
    }
  }

  /* =====================================================
     CURRENT CONVERSATION ID
     ===================================================== */

  function getCurrentConversationId() {
    try {
      return cleanId(
        window.NeyoChat
          ?.getConversationId
          ?.()
      );

    } catch {
      return "";
    }
  }

  /* =====================================================
     HISTORY TITLE
     ===================================================== */

  function getConversationTitle(
    conversationId
  ) {
    const id =
      cleanId(
        conversationId
      );

    try {
      const item =
        window.NeyoHistory
          ?.getById
          ?.(id);

      if (
        item?.title
      ) {
        return cleanText(
          item.title,
          100
        ).trim();
      }
    } catch {}

    return "NEYO conversation";
  }

  /* =====================================================
     FORMAT CONVERSATION
     ===================================================== */

  function formatConversation(
    messages,
    {
      title =
        "NEYO conversation"
    } = {}
  ) {
    if (
      !Array.isArray(
        messages
      )
    ) {
      return "";
    }

    const sections =
      [];

    for (
      const message
      of messages.slice(
        -CONFIG.maxMessages
      )
    ) {
      const formatted =
        formatMessage(
          message
        );

      if (
        formatted
      ) {
        sections.push(
          formatted
        );
      }
    }

    if (
      sections.length ===
      0
    ) {
      return "";
    }

    const body =
      sections.join(
        "\n\n"
      );

    return [
      cleanText(
        title,
        120
      ).trim(),
      body
    ]
      .filter(Boolean)
      .join(
        "\n\n"
      )
      .slice(
        0,
        CONFIG
          .maxConversationLength
      );
  }

  /* =====================================================
     FETCH HISTORY CONVERSATION

     Needed when sharing a conversation selected from
     history that is not currently open.
     ===================================================== */

  async function getHistoryConversation(
    conversationId
  ) {
    const id =
      cleanId(
        conversationId
      );

    if (!id) {
      return null;
    }

    if (
      id ===
      getCurrentConversationId()
    ) {
      return {
        conversationId:
          id,

        title:
          getConversationTitle(
            id
          ),

        messages:
          getCurrentConversation()
      };
    }

    try {
      const result =
        await window.NeyoHistory
          ?.fetchConversation
          ?.(id);

      if (
        result
      ) {
        return result;
      }
    } catch (
      error
    ) {
      console.warn(
        "[NEYO Share] Could not load history conversation:",
        error
      );
    }

    return null;
  }

  /* =====================================================
     COPY FALLBACK
     ===================================================== */

  function fallbackCopy(
    text
  ) {
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

    textarea.setAttribute(
      "aria-hidden",
      "true"
    );

    Object.assign(
      textarea.style,
      {
        position:
          "fixed",

        left:
          "-9999px",

        top:
          "0",

        opacity:
          "0",

        pointerEvents:
          "none"
      }
    );

    document.body.appendChild(
      textarea
    );

    textarea.select();

    textarea.setSelectionRange(
      0,
      textarea.value.length
    );

    let success =
      false;

    try {
      success =
        document.execCommand(
          "copy"
        );

    } catch {
      success =
        false;
    }

    textarea.remove();

    return success;
  }

  /* =====================================================
     COPY
     ===================================================== */

  async function copyText(
    text
  ) {
    const value =
      cleanText(
        text,
        CONFIG
          .maxConversationLength
      );

    if (
      !value.trim()
    ) {
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
            value
          );

        metrics
          .clipboardShares +=
          1;

        return true;
      }

    } catch {}

    const copied =
      fallbackCopy(
        value
      );

    if (
      copied
    ) {
      metrics
        .clipboardShares +=
        1;
    }

    return copied;
  }

  /* =====================================================
     CAN NATIVE SHARE
     ===================================================== */

  function canNativeShare(
    payload
  ) {
    if (
      typeof navigator.share !==
      "function"
    ) {
      return false;
    }

    if (
      !payload?.text
    ) {
      return false;
    }

    if (
      typeof navigator.canShare ===
      "function"
    ) {
      try {
        return navigator.canShare({
          title:
            payload.title,

          text:
            payload.text
        });

      } catch {}
    }

    return true;
  }

  /* =====================================================
     NATIVE SHARE
     ===================================================== */

  async function nativeShare(
    payload
  ) {
    if (
      !canNativeShare(
        payload
      )
    ) {
      return {
        success:
          false,

        unavailable:
          true
      };
    }

    try {
      await navigator.share({
        title:
          payload.title ||
          CONFIG.appName,

        text:
          payload.text
      });

      metrics.nativeShares +=
        1;

      metrics.lastSharedAt =
        Date.now();

      emit(
        "neyo:shared",
        {
          type:
            payload.type,

          method:
            "native",

          messageId:
            payload.messageId ||
            null,

          conversationId:
            payload.conversationId ||
            null
        }
      );

      return {
        success:
          true,

        method:
          "native"
      };

    } catch (
      error
    ) {
      if (
        error?.name ===
        "AbortError"
      ) {
        metrics.cancelled +=
          1;

        emit(
          "neyo:share-cancelled",
          {
            type:
              payload.type
          }
        );

        return {
          success:
            false,

          cancelled:
            true
        };
      }

      return {
        success:
          false,

        error
      };
    }
  }

  /* =====================================================
     MODAL STYLE

     Existing production HTML does not provide a dedicated
     share modal. Create a small self-contained fallback
     without requiring index.html changes.
     ===================================================== */

  function ensureModalStyle() {
    if (
      document.getElementById(
        CONFIG.modalStyleId
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      CONFIG.modalStyleId;

    style.textContent = `
      .neyo-share-modal {
        position: fixed;
        inset: 0;
        z-index: 10050;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(0, 0, 0, .35);
        backdrop-filter: blur(10px);
      }

      .neyo-share-modal.is-open {
        display: flex;
      }

      .neyo-share-dialog {
        width: min(520px, 100%);
        max-height: min(680px, calc(100dvh - 36px));
        overflow: hidden;
        border-radius: 24px;
        background: var(--surface, #fff);
        color: var(--text-primary, #111);
        border: 1px solid rgba(127, 127, 127, .18);
        box-shadow:
          0 30px 80px rgba(0, 0, 0, .20);
        display: flex;
        flex-direction: column;
      }

      .neyo-share-header {
        min-height: 62px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px 14px 20px;
        border-bottom: 1px solid rgba(127, 127, 127, .14);
      }

      .neyo-share-title {
        margin: 0;
        font-size: 16px;
        font-weight: 650;
      }

      .neyo-share-close {
        width: 36px;
        height: 36px;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
        display: grid;
        place-items: center;
      }

      .neyo-share-close:hover {
        background: rgba(127, 127, 127, .12);
      }

      .neyo-share-body {
        padding: 16px 20px;
        overflow: auto;
      }

      .neyo-share-preview {
        width: 100%;
        min-height: 150px;
        max-height: 340px;
        resize: none;
        overflow: auto;
        box-sizing: border-box;
        border-radius: 16px;
        border: 1px solid rgba(127, 127, 127, .18);
        background: rgba(127, 127, 127, .06);
        color: inherit;
        padding: 14px;
        font: inherit;
        line-height: 1.5;
        outline: none;
      }

      .neyo-share-footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 14px 20px 18px;
      }

      .neyo-share-action {
        min-height: 40px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        cursor: pointer;
        font: inherit;
        font-weight: 600;
      }

      .neyo-share-copy {
        background: rgba(127, 127, 127, .12);
        color: inherit;
      }

      .neyo-share-native {
        background: var(--accent, #111);
        color: var(--accent-contrast, #fff);
      }

      .neyo-share-action:disabled {
        opacity: .55;
        cursor: default;
      }

      @media (prefers-reduced-motion: no-preference) {
        .neyo-share-dialog {
          animation:
            neyoShareDialogIn 160ms ease-out;
        }

        @keyframes neyoShareDialogIn {
          from {
            opacity: 0;
            transform: translateY(6px) scale(.985);
          }

          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      }
    `;

    document.head
      .appendChild(
        style
      );
  }

  /* =====================================================
     CREATE MODAL
     ===================================================== */

  function ensureModal() {
    if (
      modal &&
      modal.isConnected
    ) {
      return modal;
    }

    ensureModalStyle();

    modal =
      document.createElement(
        "div"
      );

    modal.id =
      CONFIG.modalId;

    modal.className =
      "neyo-share-modal";

    modal.setAttribute(
      "aria-hidden",
      "true"
    );

    modal.innerHTML = `
      <div
        class="neyo-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="neyoShareTitle"
      >
        <div class="neyo-share-header">
          <h2
            class="neyo-share-title"
            id="neyoShareTitle"
          >
            Share
          </h2>

          <button
            class="neyo-share-close"
            type="button"
            aria-label="Close share dialog"
          >
            <i
              data-lucide="x"
              size="18"
              aria-hidden="true"
            ></i>
          </button>
        </div>

        <div class="neyo-share-body">
          <textarea
            class="neyo-share-preview"
            readonly
            aria-label="Content to share"
          ></textarea>
        </div>

        <div class="neyo-share-footer">
          <button
            class="neyo-share-action neyo-share-copy"
            type="button"
          >
            Copy
          </button>

          <button
            class="neyo-share-action neyo-share-native"
            type="button"
          >
            Share
          </button>
        </div>
      </div>
    `;

    document.body
      .appendChild(
        modal
      );

    modalPanel =
      modal.querySelector(
        ".neyo-share-dialog"
      );

    modalTitle =
      modal.querySelector(
        ".neyo-share-title"
      );

    modalPreview =
      modal.querySelector(
        ".neyo-share-preview"
      );

    modalCopyButton =
      modal.querySelector(
        ".neyo-share-copy"
      );

    modalNativeButton =
      modal.querySelector(
        ".neyo-share-native"
      );

    modalCloseButton =
      modal.querySelector(
        ".neyo-share-close"
      );

    /* =================================================
       CLOSE
       ================================================= */

    modalCloseButton
      ?.addEventListener(
        "click",
        event => {
          event.preventDefault();

          closeModal();
        }
      );

    /* =================================================
       BACKDROP
       ================================================= */

    modal.addEventListener(
      "pointerdown",
      event => {
        if (
          event.target ===
          modal
        ) {
          closeModal();
        }
      }
    );

    /* =================================================
       COPY
       ================================================= */

    modalCopyButton
      ?.addEventListener(
        "click",
        async event => {
          event.preventDefault();

          if (
            !currentPayload
          ) {
            return;
          }

          const copied =
            await copyText(
              currentPayload.text
            );

          if (
            copied
          ) {
            setCopyButtonFeedback(
              true
            );

            emit(
              "neyo:shared",
              {
                type:
                  currentPayload.type,

                method:
                  "clipboard",

                messageId:
                  currentPayload
                    .messageId ||
                  null,

                conversationId:
                  currentPayload
                    .conversationId ||
                  null
              }
            );

          } else {
            setCopyButtonFeedback(
              false
            );
          }
        }
      );

    /* =================================================
       NATIVE SHARE
       ================================================= */

    modalNativeButton
      ?.addEventListener(
        "click",
        async event => {
          event.preventDefault();

          if (
            !currentPayload
          ) {
            return;
          }

          const result =
            await nativeShare(
              currentPayload
            );

          if (
            result.success
          ) {
            closeModal();
          }
        }
      );

    refreshIcons();

    return modal;
  }

  /* =====================================================
     COPY BUTTON FEEDBACK
     ===================================================== */

  function setCopyButtonFeedback(
    success
  ) {
    if (
      !modalCopyButton
    ) {
      return;
    }

    const original =
      "Copy";

    modalCopyButton
      .textContent =
      success
        ? "Copied"
        : "Copy failed";

    modalCopyButton
      .classList
      .toggle(
        "is-success",
        success
      );

    modalCopyButton
      .classList
      .toggle(
        "is-error",
        !success
      );

    window.setTimeout(
      () => {
        if (
          !modalCopyButton
            ?.isConnected
        ) {
          return;
        }

        modalCopyButton
          .textContent =
          original;

        modalCopyButton
          .classList
          .remove(
            "is-success",
            "is-error"
          );
      },
      CONFIG.copyFeedbackMs
    );
  }

  /* =====================================================
     OPEN MODAL
     ===================================================== */

  function openModal(
    payload
  ) {
    ensureModal();

    if (
      !payload?.text
    ) {
      return false;
    }

    currentPayload =
      cloneValue(
        payload
      );

    previousFocus =
      document.activeElement
        instanceof
        HTMLElement
        ? document.activeElement
        : null;

    modalTitle.textContent =
      payload.type ===
        "conversation"
        ? "Share conversation"
        : "Share response";

    modalPreview.value =
      payload.text;

    const nativeAvailable =
      canNativeShare(
        payload
      );

    modalNativeButton.hidden =
      !nativeAvailable;

    modal.classList.add(
      "is-open"
    );

    modal.setAttribute(
      "aria-hidden",
      "false"
    );

    document.body
      .classList
      .add(
        "neyo-share-open"
      );

    metrics.modalOpens +=
      1;

    requestAnimationFrame(
      () => {
        try {
          (
            nativeAvailable
              ? modalNativeButton
              : modalCopyButton
          )
            ?.focus({
              preventScroll:
                true
            });

        } catch {}
      }
    );

    emit(
      "neyo:share-modal-opened",
      {
        type:
          payload.type
      }
    );

    return true;
  }

  /* =====================================================
     CLOSE MODAL
     ===================================================== */

  function closeModal({
    restoreFocus =
      true
  } = {}) {
    if (
      !modal
    ) {
      return false;
    }

    modal.classList.remove(
      "is-open"
    );

    modal.setAttribute(
      "aria-hidden",
      "true"
    );

    document.body
      .classList
      .remove(
        "neyo-share-open"
      );

    currentPayload =
      null;

    if (
      restoreFocus &&
      previousFocus
        ?.isConnected
    ) {
      requestAnimationFrame(
        () => {
          try {
            previousFocus.focus({
              preventScroll:
                true
            });

          } catch {}
        }
      );
    }

    previousFocus =
      null;

    emit(
      "neyo:share-modal-closed"
    );

    return true;
  }

  /* =====================================================
     MODAL OPEN
     ===================================================== */

  function isModalOpen() {
    return (
      modal
        ?.getAttribute(
          "aria-hidden"
        ) ===
      "false"
    );
  }

  /* =====================================================
     DUPLICATE GUARD

     Important because our current message-actions.js emits
     neyo:message-share-request and then may also call
     NeyoShare.shareMessage() directly.

     These two paths must still produce only ONE share.
     ===================================================== */

  function isDuplicate(
    payload
  ) {
    const now =
      performance.now();

    const key =
      [
        payload.type,
        payload.messageId ||
        payload.conversationId ||
        "",
        payload.text
          ?.slice(
            0,
            80
          )
      ].join(":");

    if (
      key ===
        lastShareKey &&
      now -
        lastShareAt <
        CONFIG
          .duplicateWindowMs
    ) {
      metrics
        .duplicateBlocked +=
        1;

      return true;
    }

    lastShareKey =
      key;

    lastShareAt =
      now;

    return false;
  }

  /* =====================================================
     PERFORM SHARE

     Native is preferred.

     If native unavailable, show fallback modal instead of
     silently copying immediately. User remains in control.
     ===================================================== */

  async function performShare(
    payload,
    {
      preferNative =
        true,
      allowModal =
        true
    } = {}
  ) {
    if (
      !payload?.text
    ) {
      return false;
    }

    if (
      isDuplicate(
        payload
      )
    ) {
      return false;
    }

    if (
      shareInProgress
    ) {
      return false;
    }

    shareInProgress =
      true;

    emit(
      "neyo:share-start",
      {
        type:
          payload.type,

        messageId:
          payload.messageId ||
          null,

        conversationId:
          payload.conversationId ||
          null
      }
    );

    try {
      if (
        preferNative &&
        canNativeShare(
          payload
        )
      ) {
        const result =
          await nativeShare(
            payload
          );

        if (
          result.success
        ) {
          return true;
        }

        if (
          result.cancelled
        ) {
          return false;
        }
      }

      if (
        allowModal
      ) {
        return openModal(
          payload
        );
      }

      const copied =
        await copyText(
          payload.text
        );

      if (
        copied
      ) {
        emit(
          "neyo:shared",
          {
            type:
              payload.type,

            method:
              "clipboard",

            messageId:
              payload.messageId ||
              null,

            conversationId:
              payload.conversationId ||
              null
          }
        );
      }

      return copied;

    } catch (
      error
    ) {
      metrics.failures +=
        1;

      console.warn(
        "[NEYO Share] Share failed:",
        error
      );

      emit(
        "neyo:share-error",
        {
          error,

          message:
            error?.message ||
            "Share failed."
        }
      );

      return false;

    } finally {
      shareInProgress =
        false;
    }
  }

  /* =====================================================
     SHARE MESSAGE
     ===================================================== */

  async function shareMessage(
    request = {}
  ) {
    const payload =
      normalizeMessageRequest(
        request
      );

    if (!payload) {
      return false;
    }

    metrics.messageShares +=
      1;

    return performShare(
      payload,
      {
        preferNative:
          request.preferNative !==
          false,

        allowModal:
          request.allowModal !==
          false
      }
    );
  }

  /* =====================================================
     SHARE CURRENT CONVERSATION
     ===================================================== */

  async function shareCurrentConversation(
    options = {}
  ) {
    const conversationId =
      getCurrentConversationId();

    const messages =
      getCurrentConversation();

    if (
      messages.length ===
      0
    ) {
      return false;
    }

    const title =
      options.title ||
      getConversationTitle(
        conversationId
      );

    const text =
      formatConversation(
        messages,
        {
          title
        }
      );

    if (!text) {
      return false;
    }

    const payload = {
      type:
        "conversation",

      conversationId:
        conversationId ||
        null,

      title,

      text,

      messages
    };

    metrics
      .conversationShares +=
      1;

    return performShare(
      payload,
      options
    );
  }

  /* =====================================================
     SHARE HISTORY CONVERSATION
     ===================================================== */

  async function shareConversation(
    request = {}
  ) {
    const conversationId =
      cleanId(
        request.conversationId ||
        request.id
      );

    /*
     * No supplied ID = current conversation.
     */

    if (
      !conversationId
    ) {
      return shareCurrentConversation(
        request
      );
    }

    const loaded =
      await getHistoryConversation(
        conversationId
      );

    if (
      !loaded ||
      !Array.isArray(
        loaded.messages
      ) ||
      loaded.messages.length ===
        0
    ) {
      emit(
        "neyo:share-error",
        {
          conversationId,

          message:
            "Conversation could not be loaded."
        }
      );

      return false;
    }

    const title =
      cleanText(
        request.title ||
        loaded.title ||
        getConversationTitle(
          conversationId
        ) ||
        "NEYO conversation",
        120
      ).trim();

    const text =
      formatConversation(
        loaded.messages,
        {
          title
        }
      );

    if (!text) {
      return false;
    }

    const payload = {
      type:
        "conversation",

      conversationId,

      title,

      text,

      messages:
        cloneValue(
          loaded.messages
        )
    };

    metrics
      .conversationShares +=
      1;

    return performShare(
      payload,
      {
        preferNative:
          request.preferNative !==
          false,

        allowModal:
          request.allowModal !==
          false
      }
    );
  }

  /* =====================================================
     MESSAGE SHARE EVENT

     Mark event detail handled synchronously for future
     callers that inspect it.

     Duplicate guard protects current message-actions.js
     which also calls the direct API.
     ===================================================== */

  window.addEventListener(
    "neyo:message-share-request",
    event => {
      const detail =
        event.detail ||
        {};

      detail.handled =
        true;

      void shareMessage(
        detail
      );
    }
  );

  /* =====================================================
     CONVERSATION SHARE EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:conversation-share-request",
    event => {
      const detail =
        event.detail ||
        {};

      detail.handled =
        true;

      void shareConversation(
        detail
      );
    }
  );

  /* =====================================================
     HISTORY SHARE COMPATIBILITY
     ===================================================== */

  window.addEventListener(
    "neyo:history-share-request",
    event => {
      const detail =
        event.detail ||
        {};

      detail.handled =
        true;

      void shareConversation(
        detail
      );
    }
  );

  /* =====================================================
     GENERIC SHARE EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:share-request",
    event => {
      const detail =
        event.detail ||
        {};

      if (
        detail.type ===
        "conversation"
      ) {
        void shareConversation(
          detail
        );

        return;
      }

      void shareMessage(
        detail
      );
    }
  );

  /* =====================================================
     KEYBOARD

     Escape closes modal.
     Tab stays within modal.
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {
      if (
        !isModalOpen()
      ) {
        return;
      }

      if (
        event.key ===
        "Escape"
      ) {
        event.preventDefault();

        closeModal();

        return;
      }

      if (
        event.key !==
        "Tab"
      ) {
        return;
      }

      const focusables =
        Array
          .from(
            modalPanel
              ?.querySelectorAll(
                [
                  "button:not([disabled]):not([hidden])",
                  "textarea:not([disabled])",
                  '[tabindex]:not([tabindex="-1"])'
                ].join(",")
              ) ||
            []
          )
          .filter(
            element =>
              element instanceof
                HTMLElement &&
              !element.hidden
          );

      if (
        focusables.length ===
        0
      ) {
        event.preventDefault();

        return;
      }

      const first =
        focusables[0];

      const last =
        focusables[
          focusables.length -
          1
        ];

      if (
        event.shiftKey &&
        document.activeElement ===
          first
      ) {
        event.preventDefault();

        last.focus();

        return;
      }

      if (
        !event.shiftKey &&
        document.activeElement ===
          last
      ) {
        event.preventDefault();

        first.focus();
      }
    }
  );

  /* =====================================================
     CONVERSATION SWITCH

     A share preview from previous conversation should not
     remain open after navigation.
     ===================================================== */

  for (
    const eventName
    of [
      "neyo:chat-new",
      "neyo:chat-state-loaded"
    ]
  ) {
    window.addEventListener(
      eventName,
      () => {
        if (
          isModalOpen()
        ) {
          closeModal({
            restoreFocus:
              false
          });
        }
      }
    );
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

      active:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      /*
       * Message
       */

      shareMessage,

      /*
       * Conversation
       */

      shareConversation,

      shareCurrentConversation,

      /*
       * Generic compatibility alias
       */

      open(
        request = {}
      ) {
        if (
          request.type ===
            "conversation" ||
          request.conversationId
        ) {
          return shareConversation(
            request
          );
        }

        return shareMessage(
          request
        );
      },

      /*
       * Modal
       */

      openModal,

      close:
        closeModal,

      closeModal,

      isOpen:
        isModalOpen,

      /*
       * Clipboard / native
       */

      copyText,

      nativeShare,

      canNativeShare,

      /*
       * Formatting
       */

      formatMessage,

      formatConversation,

      /*
       * State
       */

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          legacyScriptPresent,

          legacyOwnerActive:
            false,

          modalOpen:
            isModalOpen(),

          shareInProgress,

          currentType:
            currentPayload
              ?.type ||
            null,

          nativeShareAvailable:
            typeof navigator
              .share ===
            "function",

          metrics: {
            ...metrics
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

      nativeShare:
        typeof navigator
          .share ===
        "function",

      clipboard:
        Boolean(
          navigator.clipboard
        ),

      conversationShare:
        true,

      fallbackModal:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false
    }
  );
})();
