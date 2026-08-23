/*
=========================================================
NEYO — MESSAGE ACTIONS
FINAL PRODUCTION MIXER v6

FILE:
public/js/components/message-actions.js

OWNS
---------------------------------------------------------
- Assistant action-bar DOM
- User action-bar DOM
- Copy message
- Copy feedback animation
- Share request routing
- Regenerate request routing
- User edit request routing
- Assistant feedback UI
- Delegated message-action handling
- Action availability while generating
- Existing/history message action hydration
- Legacy action class compatibility
- Public message-actions API

DOES NOT OWN
---------------------------------------------------------
- Edit textarea / edit mode
- Edit submit logic
- Conversation truncation
- Regenerate API call
- Share modal
- Chat API
- Message rendering
- Markdown
- Attachments rendering
- History persistence

MODULE FLOW
---------------------------------------------------------

messages.js
    ↓
neyo:message-shell-created
    ↓
message-actions.js
    ↓
UI buttons

USER EDIT
---------------------------------------------------------
message-actions.js
    ↓
neyo:message-edit-request
    ↓
message-edit.js

REGENERATE
---------------------------------------------------------
message-actions.js
    ↓
neyo:message-regenerate-request
    ↓
regenerate.js

SHARE
---------------------------------------------------------
message-actions.js
    ↓
neyo:message-share-request
    ↓
share.js

COPY
---------------------------------------------------------
message-actions.js
    ↓
Clipboard API

MIGRATION RULE
---------------------------------------------------------
Uses old production CSS class names intentionally.

Capture/delegated action handling prevents legacy neo.js
from executing the same button action twice.

After neo.js removal this file continues unchanged.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-message-actions-final-v6";

  if (
    window.NeyoMessageActions
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      copyFeedbackMs:
        1800,

      actionDebounceMs:
        220,

      maxCopyLength:
        500_000,

      feedbackValues:
        new Set([
          "up",
          "down"
        ])
    });

  /* =====================================================
     DOM
     ===================================================== */

  const chatMessages =
    document.getElementById(
      "chatMessages"
    );

  const active =
    Boolean(
      chatMessages
    );

  if (
    !active
  ) {
    console.warn(
      "[NEYO Message Actions] #chatMessages missing."
    );

    return;
  }

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

  let generating =
    false;

  let lastActionKey =
    "";

  let lastActionAt =
    0;

  const feedbackByMessage =
    new Map();

  const metrics = {
    hydrated:
      0,

    copies:
      0,

    copyFailures:
      0,

    edits:
      0,

    regenerates:
      0,

    shares:
      0,

    feedback:
      0,

    blockedWhileGenerating:
      0,

    duplicateActionsBlocked:
      0,

    legacyActionsIntercepted:
      0,

    lastActionAt:
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
      CONFIG.maxCopyLength
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

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  /* =====================================================
     MESSAGE ELEMENT
     ===================================================== */

  function getMessageElement(
    target
  ) {
    if (
      target instanceof
      Element
    ) {
      return target.closest(
        ".message[data-neyo-message-id], .message[data-message-id], .message"
      );
    }

    return null;
  }

  /* =====================================================
     MESSAGE ID
     ===================================================== */

  function getMessageId(
    element
  ) {
    if (
      !element
    ) {
      return "";
    }

    return cleanId(
      element.dataset
        ?.neyoMessageId ||
      element.dataset
        ?.messageId ||
      ""
    );
  }

  /* =====================================================
     ROLE
     ===================================================== */

  function getRole(
    element
  ) {
    if (
      !element
    ) {
      return "";
    }

    const role =
      element.dataset
        ?.role;

    if (
      role ===
        "user" ||
      role ===
        "assistant"
    ) {
      return role;
    }

    if (
      element.classList
        .contains(
          "user"
        )
    ) {
      return "user";
    }

    if (
      element.classList
        .contains(
          "assistant"
        )
    ) {
      return "assistant";
    }

    return "";
  }

  /* =====================================================
     CANONICAL CONVERSATION
     ===================================================== */

  function getConversation() {
    try {
      const conversation =
        window.NeyoChat
          ?.getConversation
          ?.();

      return Array.isArray(
        conversation
      )
        ? conversation
        : [];

    } catch {
      return [];
    }
  }

  /* =====================================================
     CANONICAL MESSAGE LOOKUP
     ===================================================== */

  function getCanonicalMessage(
    elementOrId
  ) {
    const element =
      elementOrId
        instanceof
        Element
        ? elementOrId
        : null;

    const id =
      element
        ? getMessageId(
            element
          )
        : cleanId(
            elementOrId
          );

    const role =
      element
        ? getRole(
            element
          )
        : "";

    const conversation =
      getConversation();

    /* -------------------------------------------------
       Strongest lookup = stable message ID
       ------------------------------------------------- */

    if (
      id
    ) {
      const match =
        conversation.find(
          message =>
            cleanId(
              message?.id
            ) ===
            id
        );

      if (
        match
      ) {
        return {
          ...match
        };
      }
    }

    /*
     * Compatibility fallback for older neo.js DOM
     * where messages were indexed rather than ID'd.
     */

    if (
      element
    ) {
      const legacyIndex =
        Number(
          element
            .dataset
            ?.msgIndex
        );

      if (
        Number.isInteger(
          legacyIndex
        ) &&
        legacyIndex >=
          0 &&
        legacyIndex <
          conversation.length
      ) {
        return {
          ...conversation[
            legacyIndex
          ]
        };
      }
    }

    /*
     * Last fallback:
     * construct a DOM-backed read-only representation.
     *
     * This supports Copy on legacy messages but should
     * never be preferred for edit/regenerate.
     */

    if (
      element
    ) {
      const content =
        element.querySelector(
          ".message-content"
        );

      return {
        id:
          id ||
          null,

        role,

        content:
          cleanText(
            content
              ?.innerText ||
            content
              ?.textContent ||
            ""
          ),

        attachments:
          []
      };
    }

    return null;
  }

  /* =====================================================
     MESSAGE INDEX
     ===================================================== */

  function getCanonicalIndex(
    message
  ) {
    if (
      !message
    ) {
      return -1;
    }

    const conversation =
      getConversation();

    const id =
      cleanId(
        message.id
      );

    if (
      id
    ) {
      return conversation.findIndex(
        item =>
          cleanId(
            item?.id
          ) ===
          id
      );
    }

    return -1;
  }

  /* =====================================================
     COPY TEXT

     Prefer canonical raw assistant Markdown/text rather
     than rendered DOM text.
     ===================================================== */

  function getCopyText(
    element
  ) {
    const message =
      getCanonicalMessage(
        element
      );

    if (
      message
    ) {
      const content =
        cleanText(
          message.displayContent ??
          message.content ??
          ""
        );

      if (
        content.trim()
      ) {
        return content;
      }
    }

    return cleanText(
      element
        ?.querySelector(
          ".message-content"
        )
        ?.innerText ||
      ""
    );
  }

  /* =====================================================
     FALLBACK COPY
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

    document.body
      .appendChild(
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
     COPY FEEDBACK ICON
     ===================================================== */

  function setCopyFeedback(
    button,
    success,
    {
      size =
        16
    } = {}
  ) {
    if (
      !(
        button instanceof
        HTMLElement
      )
    ) {
      return;
    }

    /*
     * Clear an older reset timer on rapidly repeated copy.
     */

    if (
      button
        .__neyoCopyTimer
    ) {
      window.clearTimeout(
        button
          .__neyoCopyTimer
      );
    }

    const originalTitle =
      button.getAttribute(
        "title"
      ) ||
      "Copy";

    button.classList.toggle(
      "is-success",
      success
    );

    button.classList.toggle(
      "is-error",
      !success
    );

    button.setAttribute(
      "aria-label",
      success
        ? "Copied"
        : "Copy failed"
    );

    button.title =
      success
        ? "Copied"
        : "Copy failed";

    /*
     * Preserve production Lucide visual behavior.
     */

    button.innerHTML =
      success
        ? `<i data-lucide="check" size="${size}" aria-hidden="true"></i>`
        : `<i data-lucide="x" size="${size}" aria-hidden="true"></i>`;

    refreshIcons();

    button
      .__neyoCopyTimer =
      window.setTimeout(
        () => {
          if (
            !button.isConnected
          ) {
            return;
          }

          button.classList.remove(
            "is-success",
            "is-error"
          );

          button.setAttribute(
            "aria-label",
            "Copy"
          );

          button.title =
            originalTitle;

          button.innerHTML =
            `<i data-lucide="copy" size="${size}" aria-hidden="true"></i>`;

          refreshIcons();

          button
            .__neyoCopyTimer =
            0;
        },
        CONFIG.copyFeedbackMs
      );
  }

  /* =====================================================
     COPY
     ===================================================== */

  async function copyMessage(
    element,
    button = null
  ) {
    if (
      !element
    ) {
      return false;
    }

    const text =
      getCopyText(
        element
      );

    if (
      !text.trim()
    ) {
      setCopyFeedback(
        button,
        false,
        {
          size:
            button
              ?.classList
              .contains(
                "user-action-btn"
              )
              ? 14
              : 16
        }
      );

      return false;
    }

    let success =
      false;

    try {
      if (
        navigator.clipboard
          ?.writeText &&
        window.isSecureContext
      ) {
        await navigator
          .clipboard
          .writeText(
            text
          );

        success =
          true;

      } else {
        success =
          fallbackCopy(
            text
          );
      }

    } catch {
      success =
        fallbackCopy(
          text
        );
    }

    if (
      success
    ) {
      metrics.copies +=
        1;

    } else {
      metrics.copyFailures +=
        1;
    }

    setCopyFeedback(
      button,
      success,
      {
        size:
          button
            ?.classList
            .contains(
              "user-action-btn"
            )
            ? 14
            : 16
      }
    );

    emit(
      "neyo:message-copy",
      {
        success,

        messageId:
          getMessageId(
            element
          ),

        role:
          getRole(
            element
          )
      }
    );

    return success;
  }

  /* =====================================================
     BUTTON FACTORY
     ===================================================== */

  function createButton({
    className,
    title,
    label,
    icon,
    size =
      16,
    action,
    pressed =
      null
  }) {
    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.className =
      className;

    button.title =
      title;

    button.setAttribute(
      "aria-label",
      label ||
      title
    );

    button.dataset
      .messageAction =
      action;

    if (
      pressed !==
      null
    ) {
      button.setAttribute(
        "aria-pressed",
        String(
          Boolean(
            pressed
          )
        )
      );
    }

    button.innerHTML =
      `<i data-lucide="${icon}" size="${size}" aria-hidden="true"></i>`;

    return button;
  }

  /* =====================================================
     ASSISTANT ACTION BAR
     ===================================================== */

  function createAssistantActions(
    messageElement
  ) {
    const root =
      document.createElement(
        "div"
      );

    /*
     * Old production class is preserved.
     */

    root.className =
      "message-actions";

    root.dataset
      .neyoActions =
      "assistant";

    root.setAttribute(
      "role",
      "group"
    );

    root.setAttribute(
      "aria-label",
      "Message actions"
    );

    const copy =
      createButton({
        className:
          "msg-action-btn copy-msg-btn",

        title:
          "Copy",

        label:
          "Copy response",

        icon:
          "copy",

        action:
          "copy"
      });

    const share =
      createButton({
        className:
          "msg-action-btn share-msg-btn",

        title:
          "Share",

        label:
          "Share response",

        icon:
          "share-2",

        action:
          "share"
      });

    const regenerate =
      createButton({
        className:
          "msg-action-btn regen-msg-btn",

        title:
          "Regenerate",

        label:
          "Regenerate response",

        icon:
          "rotate-cw",

        action:
          "regenerate"
      });

    const feedback =
      document.createElement(
        "div"
      );

    feedback.className =
      "message-feedback-actions";

    feedback.setAttribute(
      "role",
      "group"
    );

    feedback.setAttribute(
      "aria-label",
      "Response feedback"
    );

    const messageId =
      getMessageId(
        messageElement
      );

    const currentFeedback =
      feedbackByMessage.get(
        messageId
      ) ||
      null;

    const up =
      createButton({
        className:
          "msg-action-btn feedback-msg-btn feedback-up-btn",

        title:
          "Good response",

        label:
          "Good response",

        icon:
          "thumbs-up",

        size:
          15,

        action:
          "feedback-up",

        pressed:
          currentFeedback ===
          "up"
      });

    const down =
      createButton({
        className:
          "msg-action-btn feedback-msg-btn feedback-down-btn",

        title:
          "Bad response",

        label:
          "Bad response",

        icon:
          "thumbs-down",

        size:
          15,

        action:
          "feedback-down",

        pressed:
          currentFeedback ===
          "down"
      });

    feedback.append(
      up,
      down
    );

    root.append(
      copy,
      share,
      regenerate,
      feedback
    );

    return root;
  }

  /* =====================================================
     USER ACTION BAR
     ===================================================== */

  function createUserActions() {
    const root =
      document.createElement(
        "div"
      );

    /*
     * Exact old production class.
     */

    root.className =
      "user-msg-actions";

    root.dataset
      .neyoActions =
      "user";

    root.setAttribute(
      "role",
      "group"
    );

    root.setAttribute(
      "aria-label",
      "Message actions"
    );

    const edit =
      createButton({
        className:
          "user-action-btn user-edit-btn",

        title:
          "Edit message",

        label:
          "Edit message",

        icon:
          "pencil",

        size:
          14,

        action:
          "edit"
      });

    const copy =
      createButton({
        className:
          "user-action-btn user-copy-btn",

        title:
          "Copy text",

        label:
          "Copy message",

        icon:
          "copy",

        size:
          14,

        action:
          "copy"
      });

    root.append(
      edit,
      copy
    );

    return root;
  }

  /* =====================================================
     REMOVE DUPLICATE LEGACY ACTION BARS

     We only collapse duplicate action containers.
     Message content/attachments are untouched.
     ===================================================== */

  function dedupeActionBars(
    element,
    role
  ) {
    if (
      !element
    ) {
      return;
    }

    const selector =
      role ===
        "user"
        ? ".user-msg-actions"
        : ".message-actions";

    const bars =
      Array.from(
        element.querySelectorAll(
          selector
        )
      );

    if (
      bars.length <=
      1
    ) {
      return;
    }

    /*
     * Prefer our final action bar.
     */

    const preferred =
      bars.find(
        bar =>
          bar.dataset
            .neyoActions
      ) ||
      bars[
        bars.length -
        1
      ];

    for (
      const bar
      of bars
    ) {
      if (
        bar !==
        preferred
      ) {
        bar.remove();
      }
    }
  }

  /* =====================================================
     HYDRATE ONE MESSAGE
     ===================================================== */

  function hydrateMessage(
    element
  ) {
    if (
      !(
        element instanceof
        HTMLElement
      )
    ) {
      return false;
    }

    if (
      element.dataset
        .neyoMessageId ===
        "neyo-thinking" ||
      element.classList
        .contains(
          "is-thinking"
        )
    ) {
      return false;
    }

    const role =
      getRole(
        element
      );

    if (
      ![
        "user",
        "assistant"
      ].includes(
        role
      )
    ) {
      return false;
    }

    /* =================================================
       USER
       ================================================= */

    if (
      role ===
      "user"
    ) {
      const wrapper =
        element.querySelector(
          ".message-wrapper"
        );

      if (
        !wrapper
      ) {
        return false;
      }

      /*
       * Reuse existing final bar if present.
       */

      let actions =
        wrapper.querySelector(
          ".user-msg-actions[data-neyo-actions='user']"
        );

      if (
        !actions
      ) {
        /*
         * Remove old action bar first so we retain
         * exactly one stable owner.
         */

        wrapper
          .querySelectorAll(
            ".user-msg-actions"
          )
          .forEach(
            node =>
              node.remove()
          );

        actions =
          createUserActions();

        wrapper.appendChild(
          actions
        );
      }

      dedupeActionBars(
        element,
        role
      );
    }

    /* =================================================
       ASSISTANT
       ================================================= */

    else {
      let actions =
        element.querySelector(
          ".message-actions[data-neyo-actions='assistant']"
        );

      if (
        !actions
      ) {
        element
          .querySelectorAll(
            ".message-actions"
          )
          .forEach(
            node =>
              node.remove()
          );

        actions =
          createAssistantActions(
            element
          );

        /*
         * Keep actions before Sources when sources exist.
         * This preserves familiar response → actions →
         * sources reading order.
         */

        const sources =
          element.querySelector(
            ".neo-source-pills"
          );

        if (
          sources
        ) {
          element.insertBefore(
            actions,
            sources
          );

        } else {
          element.appendChild(
            actions
          );
        }
      }

      dedupeActionBars(
        element,
        role
      );
    }

    element.dataset
      .actionsReady =
      "true";

    metrics.hydrated +=
      1;

    syncGeneratingState();

    refreshIcons();

    emit(
      "neyo:message-actions-hydrated",
      {
        id:
          getMessageId(
            element
          ),

        role,

        element
      }
    );

    return true;
  }

  /* =====================================================
     HYDRATE ALL
     ===================================================== */

  function hydrateAll() {
    const messages =
      Array.from(
        chatMessages.querySelectorAll(
          ".message"
        )
      );

    let count =
      0;

    for (
      const element
      of messages
    ) {
      if (
        hydrateMessage(
          element
        )
      ) {
        count +=
          1;
      }
    }

    return count;
  }

  /* =====================================================
     GENERATING STATE
     ===================================================== */

  function syncGeneratingState() {
    const buttons =
      chatMessages.querySelectorAll(
        [
          ".user-edit-btn",
          ".regen-msg-btn"
        ].join(",")
      );

    for (
      const button
      of buttons
    ) {
      button.disabled =
        generating;

      button.setAttribute(
        "aria-disabled",
        String(
          generating
        )
      );
    }

    chatMessages.classList.toggle(
      "is-generating",
      generating
    );

    return generating;
  }

  function setGenerating(
    value
  ) {
    generating =
      Boolean(
        value
      );

    syncGeneratingState();

    return generating;
  }

  /* =====================================================
     DUPLICATE ACTION GUARD
     ===================================================== */

  function duplicateAction(
    action,
    messageId
  ) {
    const now =
      performance.now();

    const key =
      `${action}:${messageId}`;

    if (
      key ===
        lastActionKey &&
      now -
        lastActionAt <
        CONFIG
          .actionDebounceMs
    ) {
      metrics
        .duplicateActionsBlocked +=
        1;

      return true;
    }

    lastActionKey =
      key;

    lastActionAt =
      now;

    metrics.lastActionAt =
      Date.now();

    return false;
  }

  /* =====================================================
     EDIT REQUEST
     ===================================================== */

  function requestEdit(
    element
  ) {
    if (
      generating
    ) {
      metrics
        .blockedWhileGenerating +=
        1;

      return false;
    }

    const message =
      getCanonicalMessage(
        element
      );

    if (
      !message ||
      message.role !==
        "user"
    ) {
      return false;
    }

    const index =
      getCanonicalIndex(
        message
      );

    metrics.edits +=
      1;

    const detail = {
      id:
        message.id ||
        getMessageId(
          element
        ),

      messageId:
        message.id ||
        getMessageId(
          element
        ),

      index,

      message: {
        ...message,

        attachments:
          Array.isArray(
            message.attachments
          )
            ? message
                .attachments
                .map(
                  attachment => ({
                    ...attachment
                  })
                )
            : []
      },

      element,

      source:
        "message-actions"
    };

    /*
     * Canonical event.
     */

    emit(
      "neyo:message-edit-request",
      detail
    );

    /*
     * Compatibility alias used by some older modular
     * message-edit experiments.
     */

    emit(
      "neyo:user-message-edit-request",
      detail
    );

    return true;
  }

  /* =====================================================
     REGENERATE REQUEST
     ===================================================== */

  function requestRegenerate(
    element
  ) {
    if (
      generating
    ) {
      metrics
        .blockedWhileGenerating +=
        1;

      return false;
    }

    const message =
      getCanonicalMessage(
        element
      );

    if (
      !message ||
      message.role !==
        "assistant"
    ) {
      return false;
    }

    const index =
      getCanonicalIndex(
        message
      );

    metrics.regenerates +=
      1;

    const detail = {
      id:
        message.id ||
        getMessageId(
          element
        ),

      messageId:
        message.id ||
        getMessageId(
          element
        ),

      index,

      message: {
        ...message
      },

      element,

      conversation:
        getConversation(),

      source:
        "message-actions"
    };

    emit(
      "neyo:message-regenerate-request",
      detail
    );

    /*
     * Compatibility alias.
     */

    emit(
      "neyo:regenerate-request",
      detail
    );

    return true;
  }

  /* =====================================================
     SHARE REQUEST
     ===================================================== */

  async function requestShare(
    element
  ) {
    const message =
      getCanonicalMessage(
        element
      );

    if (
      !message
    ) {
      return false;
    }

    const text =
      getCopyText(
        element
      );

    if (
      !text.trim()
    ) {
      return false;
    }

    metrics.shares +=
      1;

    const detail = {
      id:
        message.id ||
        getMessageId(
          element
        ),

      messageId:
        message.id ||
        getMessageId(
          element
        ),

      message: {
        ...message
      },

      text,

      element,

      source:
        "message-actions",

      /*
       * Share module may set this to true synchronously
       * when it accepts ownership.
       */

      handled:
        false
    };

    emit(
      "neyo:message-share-request",
      detail
    );

    /*
     * Existing share.js may expose a direct API instead.
     */

    try {
      if (
        typeof window.NeyoShare
          ?.shareMessage ===
        "function"
      ) {
        await window
          .NeyoShare
          .shareMessage(
            detail
          );

        return true;
      }

      if (
        typeof window.NeyoShare
          ?.open ===
        "function"
      ) {
        window.NeyoShare
          .open(
            detail
          );

        return true;
      }
    } catch (
      error
    ) {
      console.warn(
        "[NEYO Message Actions] Share module failed:",
        error
      );
    }

    /*
     * Preserve old production native share behavior
     * as a graceful fallback.
     */

    if (
      navigator.share
    ) {
      try {
        await navigator.share({
          text
        });

        emit(
          "neyo:message-shared",
          {
            messageId:
              detail.messageId,

            method:
              "native"
          }
        );

        return true;

      } catch (
        error
      ) {
        /*
         * User cancelling share sheet is not an error.
         */

        if (
          error?.name ===
          "AbortError"
        ) {
          return false;
        }
      }
    }

    /*
     * Final graceful fallback:
     * copy response so Share never becomes a dead button.
     */

    const copied =
      await copyMessage(
        element
      );

    if (
      copied
    ) {
      emit(
        "neyo:message-shared",
        {
          messageId:
            detail.messageId,

          method:
            "clipboard"
        }
      );
    }

    return copied;
  }

  /* =====================================================
     FEEDBACK
     ===================================================== */

  function setFeedback(
    element,
    value
  ) {
    if (
      !CONFIG
        .feedbackValues
        .has(
          value
        )
    ) {
      return false;
    }

    const message =
      getCanonicalMessage(
        element
      );

    if (
      !message ||
      message.role !==
        "assistant"
    ) {
      return false;
    }

    const id =
      cleanId(
        message.id ||
        getMessageId(
          element
        )
      );

    if (!id) {
      return false;
    }

    const current =
      feedbackByMessage.get(
        id
      );

    /*
     * Clicking same feedback toggles it off.
     */

    const next =
      current ===
        value
        ? null
        : value;

    if (
      next
    ) {
      feedbackByMessage.set(
        id,
        next
      );

    } else {
      feedbackByMessage.delete(
        id
      );
    }

    const up =
      element.querySelector(
        ".feedback-up-btn"
      );

    const down =
      element.querySelector(
        ".feedback-down-btn"
      );

    const upSelected =
      next ===
      "up";

    const downSelected =
      next ===
      "down";

    up
      ?.setAttribute(
        "aria-pressed",
        String(
          upSelected
        )
      );

    down
      ?.setAttribute(
        "aria-pressed",
        String(
          downSelected
        )
      );

    up
      ?.classList
      .toggle(
        "is-selected",
        upSelected
      );

    down
      ?.classList
      .toggle(
        "is-selected",
        downSelected
      );

    metrics.feedback +=
      1;

    emit(
      "neyo:message-feedback",
      {
        messageId:
          id,

        value:
          next,

        previous:
          current ||
          null,

        message: {
          ...message
        }
      }
    );

    return true;
  }

  /* =====================================================
     ACTION RESOLUTION
     ===================================================== */

  function resolveAction(
    button
  ) {
    const explicit =
      button.dataset
        ?.messageAction;

    if (
      explicit
    ) {
      return explicit;
    }

    /*
     * Legacy class fallback.
     */

    if (
      button.classList
        .contains(
          "copy-msg-btn"
        ) ||
      button.classList
        .contains(
          "user-copy-btn"
        )
    ) {
      return "copy";
    }

    if (
      button.classList
        .contains(
          "share-msg-btn"
        )
    ) {
      return "share";
    }

    if (
      button.classList
        .contains(
          "regen-msg-btn"
        )
    ) {
      return "regenerate";
    }

    if (
      button.classList
        .contains(
          "user-edit-btn"
        )
    ) {
      return "edit";
    }

    if (
      button.classList
        .contains(
          "feedback-up-btn"
        )
    ) {
      return "feedback-up";
    }

    if (
      button.classList
        .contains(
          "feedback-down-btn"
        )
    ) {
      return "feedback-down";
    }

    return "";
  }

  /* =====================================================
     HANDLE ACTION
     ===================================================== */

  async function handleAction(
    button,
    messageElement
  ) {
    const action =
      resolveAction(
        button
      );

    if (!action) {
      return false;
    }

    const messageId =
      getMessageId(
        messageElement
      );

    if (
      duplicateAction(
        action,
        messageId
      )
    ) {
      return false;
    }

    switch (
      action
    ) {
      case "copy":
        return copyMessage(
          messageElement,
          button
        );

      case "edit":
        return requestEdit(
          messageElement
        );

      case "regenerate":
        return requestRegenerate(
          messageElement
        );

      case "share":
        return requestShare(
          messageElement
        );

      case "feedback-up":
        return setFeedback(
          messageElement,
          "up"
        );

      case "feedback-down":
        return setFeedback(
          messageElement,
          "down"
        );

      default:
        return false;
    }
  }

  /* =====================================================
     AUTHORITATIVE CLICK DELEGATION

     Capture phase is deliberate.

     neo.js historically delegated .msg-action-btn clicks
     from #chatMessages. We consume recognized message
     actions before that legacy handler can also execute.
     ===================================================== */

  chatMessages.addEventListener(
    "click",
    event => {
      const target =
        event.target;

      if (
        !(
          target instanceof
          Element
        )
      ) {
        return;
      }

      const button =
        target.closest(
          [
            "[data-message-action]",
            ".msg-action-btn",
            ".user-action-btn"
          ].join(",")
        );

      if (
        !button ||
        !chatMessages.contains(
          button
        )
      ) {
        return;
      }

      const action =
        resolveAction(
          button
        );

      if (
        !action
      ) {
        return;
      }

      const messageElement =
        getMessageElement(
          button
        );

      if (
        !messageElement
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (
        legacyScriptPresent
      ) {
        metrics
          .legacyActionsIntercepted +=
          1;
      }

      void handleAction(
        button,
        messageElement
      );
    },
    true
  );

  /* =====================================================
     MESSAGE SHELL CREATED
     ===================================================== */

  window.addEventListener(
    "neyo:message-shell-created",
    event => {
      const element =
        event.detail
          ?.element;

      if (
        element
      ) {
        hydrateMessage(
          element
        );
      }
    }
  );

  /* =====================================================
     MESSAGE CREATED COMPATIBILITY
     ===================================================== */

  window.addEventListener(
    "neyo:message-created",
    event => {
      const element =
        event.detail
          ?.element;

      if (
        element
      ) {
        hydrateMessage(
          element
        );
      }
    }
  );

  /* =====================================================
     MESSAGE UPDATED

     Edit/regenerate may rebuild parts of a message.
     Re-hydrate action bar safely.
     ===================================================== */

  window.addEventListener(
    "neyo:message-updated",
    event => {
      const element =
        event.detail
          ?.element;

      if (
        element
      ) {
        hydrateMessage(
          element
        );
      }
    }
  );

  /* =====================================================
     MESSAGES REPLACED / HISTORY LOAD
     ===================================================== */

  window.addEventListener(
    "neyo:messages-replaced",
    () => {
      requestAnimationFrame(
        hydrateAll
      );
    }
  );

  window.addEventListener(
    "neyo:chat-state-loaded",
    () => {
      requestAnimationFrame(
        hydrateAll
      );
    }
  );

  /* =====================================================
     GENERATING EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    () => {
      setGenerating(
        true
      );
    }
  );

  for (
    const eventName
    of [
      "neyo:chat-send-end",
      "neyo:chat-response",
      "neyo:chat-error",
      "neyo:chat-aborted",
      "neyo:chat-limit-reached",
      "neyo:chat-new"
    ]
  ) {
    window.addEventListener(
      eventName,
      () => {
        setGenerating(
          false
        );
      }
    );
  }

  /* =====================================================
     EXPLICIT REHYDRATE REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:message-actions-refresh",
    () => {
      hydrateAll();
    }
  );

  /* =====================================================
     MESSAGE REMOVED
     ===================================================== */

  window.addEventListener(
    "neyo:message-removed",
    event => {
      const id =
        cleanId(
          event.detail
            ?.id
        );

      if (
        id
      ) {
        feedbackByMessage.delete(
          id
        );
      }
    }
  );

  /* =====================================================
     CLEAR
     ===================================================== */

  window.addEventListener(
    "neyo:messages-cleared",
    () => {
      feedbackByMessage.clear();
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

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      /*
       * Hydration
       */

      hydrate:
        hydrateMessage,

      hydrateMessage,

      hydrateAll,

      /*
       * Copy
       */

      copy:
        copyMessage,

      copyMessage,

      getCopyText,

      /*
       * Requests
       */

      requestEdit,

      requestRegenerate,

      requestShare,

      /*
       * Feedback
       */

      setFeedback,

      getFeedback(
        messageId
      ) {
        return (
          feedbackByMessage.get(
            cleanId(
              messageId
            )
          ) ||
          null
        );
      },

      /*
       * State
       */

      setGenerating,

      isGenerating() {
        return generating;
      },

      getCanonicalMessage,

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          generating,

          legacyScriptPresent,

          legacyOwnerActive:
            false,

          feedbackCount:
            feedbackByMessage
              .size,

          hydratedMessages:
            chatMessages
              .querySelectorAll(
                "[data-actions-ready='true']"
              )
              .length,

          metrics: {
            ...metrics
          }
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoMessageActions",
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
     INITIAL HYDRATION

     Important while neo.js is still loaded because some
     legacy messages may already exist before this module.
     ===================================================== */

  hydrateAll();

  /* =====================================================
     READY
     ===================================================== */

  emit(
    "neyo:message-actions-ready",
    {
      version:
        VERSION,

      active:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      copy:
        true,

      editRouting:
        true,

      regenerateRouting:
        true,

      shareRouting:
        true,

      feedback:
        true
    }
  );
})();
