/*
=========================================================
NEYO — HISTORY MENU
FINAL PRODUCTION MIXER v5

FILE:
public/js/components/history-menu.js

OWNS
---------------------------------------------------------
- History three-dot popup UI
- Right-click context menu positioning
- Same-trigger toggle behavior
- Viewport-safe menu positioning
- Active conversation-menu target state
- Share / Pin / Rename / Delete routing
- Rename dialog UI
- Delete confirmation dialog UI
- Busy/disabled menu action state
- Escape / outside-click / resize / scroll close
- Focus restoration
- Legacy popup DOM compatibility
- Public history-menu API

DOES NOT OWN
---------------------------------------------------------
- History persistence
- /api/history action implementation
- Conversation loading/rendering
- Share implementation
- Sidebar rendering
- Chat state

FINAL FLOW
---------------------------------------------------------
history.js
   ↓
neyo:history-menu-request
   ↓
history-menu.js
   ├─ Share  → NeyoShare.shareConversation()
   ├─ Pin    → NeyoHistory.setPinned()
   ├─ Rename → NeyoHistory.rename()
   └─ Delete → NeyoHistory.delete()

MIGRATION RULE
---------------------------------------------------------
The existing #historyPopupMenu DOM and old CSS classes are
preserved intentionally.

This module is authoritative even while neo.js is loaded.
Capture-phase handlers consume popup-action clicks before
legacy handlers can perform the same operation twice.

After neo.js removal this file continues unchanged.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-history-menu-final-v5";

  if (
    window.NeyoHistoryMenu
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      viewportGap:
        10,

      triggerGap:
        6,

      defaultMenuWidth:
        204,

      defaultMenuHeight:
        176,

      maxTitleLength:
        100,

      dialogStyleId:
        "neyoHistoryMenuDialogStyle",

      renameDialogId:
        "neyoHistoryRenameDialog",

      deleteDialogId:
        "neyoHistoryDeleteDialog"
    });

  /* =====================================================
     DOM
     ===================================================== */

  const menu =
    document.getElementById(
      "historyPopupMenu"
    );

  const shareBtn =
    document.getElementById(
      "hpShareBtn"
    );

  const pinBtn =
    document.getElementById(
      "hpPinBtn"
    );

  const renameBtn =
    document.getElementById(
      "hpRenameBtn"
    );

  const deleteBtn =
    document.getElementById(
      "hpDeleteBtn"
    );

  const active =
    Boolean(
      menu &&
      shareBtn &&
      pinBtn &&
      renameBtn &&
      deleteBtn
    );

  if (!active) {
    console.warn(
      "[NEYO History Menu] Required popup DOM is missing."
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

  let opened =
    false;

  let target =
    null;

  let anchorElement =
    null;

  let previousFocus =
    null;

  let busyAction =
    null;

  let renameDialog =
    null;

  let deleteDialog =
    null;

  let dialogPreviousFocus =
    null;

  const metrics = {
    opens:
      0,

    closes:
      0,

    shares:
      0,

    pins:
      0,

    renames:
      0,

    deletes:
      0,

    actionFailures:
      0,

    legacyActionsBlocked:
      0,

    lastOpenedAt:
      null,

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

  function cleanTitle(
    value
  ) {
    return String(
      value ?? ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim()
      .slice(
        0,
        CONFIG.maxTitleLength
      );
  }

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  function getHistory() {
    return (
      window.NeyoHistory ||
      null
    );
  }

  function getShare() {
    return (
      window.NeyoShare ||
      null
    );
  }

  /* =====================================================
     NORMALIZE TARGET
     ===================================================== */

  function normalizeTarget(
    detail = {}
  ) {
    const conversationId =
      cleanId(
        detail.conversationId ||
        detail.id
      );

    if (!conversationId) {
      return null;
    }

    let historyItem =
      null;

    try {
      historyItem =
        getHistory()
          ?.getById
          ?.(conversationId) ||
        null;
    } catch {}

    return {
      conversationId,

      title:
        cleanTitle(
          detail.title ||
          historyItem?.title ||
          "New conversation"
        ) ||
        "New conversation",

      isPinned:
        Boolean(
          detail.isPinned ??
          detail.is_pinned ??
          historyItem?.is_pinned ??
          historyItem?.isPinned ??
          false
        ),

      anchorElement:
        detail.anchorElement instanceof
          HTMLElement
          ? detail.anchorElement
          : null,

      clientX:
        Number.isFinite(
          Number(
            detail.clientX
          )
        )
          ? Number(
              detail.clientX
            )
          : null,

      clientY:
        Number.isFinite(
          Number(
            detail.clientY
          )
        )
          ? Number(
              detail.clientY
            )
          : null
    };
  }

  /* =====================================================
     VISIBILITY
     ===================================================== */

  function isOpen() {
    return (
      opened &&
      menu.classList.contains(
        "show"
      ) &&
      menu.style.display !==
        "none"
    );
  }

  /* =====================================================
     PIN PRESENTATION
     ===================================================== */

  function updatePinPresentation() {
    if (!target) {
      return false;
    }

    const label =
      target.isPinned
        ? "Unpin"
        : "Pin";

    const icon =
      target.isPinned
        ? "pin-off"
        : "pin";

    pinBtn.innerHTML = `
      <i
        data-lucide="${icon}"
        size="16"
        aria-hidden="true"
      ></i>${label}
    `;

    pinBtn.setAttribute(
      "aria-label",
      `${label} conversation`
    );

    pinBtn.dataset.tooltip =
      `${label} conversation`;

    refreshIcons();

    return true;
  }

  /* =====================================================
     BUSY
     ===================================================== */

  function setBusy(
    action,
    value
  ) {
    busyAction =
      value
        ? action
        : null;

    const buttons = [
      shareBtn,
      pinBtn,
      renameBtn,
      deleteBtn
    ];

    for (
      const button
      of buttons
    ) {
      const disabled =
        Boolean(
          busyAction
        );

      button.setAttribute(
        "aria-disabled",
        String(
          disabled
        )
      );

      button.classList.toggle(
        "is-disabled",
        disabled
      );
    }

    menu.classList.toggle(
      "is-busy",
      Boolean(
        busyAction
      )
    );
  }

  /* =====================================================
     POSITION — ANCHOR
     ===================================================== */

  function positionByAnchor(
    anchor
  ) {
    if (
      !(anchor instanceof
        HTMLElement)
    ) {
      return false;
    }

    /*
     * Critical legacy compatibility:
     * neo.js may have left inline display:none.
     */

    menu.style.display =
      "block";

    menu.style.visibility =
      "hidden";

    menu.classList.add(
      "show"
    );

    const triggerRect =
      anchor.getBoundingClientRect();

    const menuRect =
      menu.getBoundingClientRect();

    const width =
      menuRect.width ||
      CONFIG.defaultMenuWidth;

    const height =
      menuRect.height ||
      CONFIG.defaultMenuHeight;

    /*
     * Preferred:
     * menu right edge aligns with trigger right edge.
     */

    let left =
      triggerRect.right -
      width;

    let top =
      triggerRect.bottom +
      CONFIG.triggerGap;

    /* -------------------------------------------------
       HORIZONTAL VIEWPORT PROTECTION
       ------------------------------------------------- */

    const maxLeft =
      window.innerWidth -
      width -
      CONFIG.viewportGap;

    left =
      Math.max(
        CONFIG.viewportGap,
        Math.min(
          left,
          maxLeft
        )
      );

    /* -------------------------------------------------
       OPEN ABOVE IF NEEDED
       ------------------------------------------------- */

    if (
      top +
        height +
        CONFIG.viewportGap >
      window.innerHeight
    ) {
      top =
        triggerRect.top -
        height -
        CONFIG.triggerGap;
    }

    /* -------------------------------------------------
       VERTICAL VIEWPORT PROTECTION
       ------------------------------------------------- */

    const maxTop =
      window.innerHeight -
      height -
      CONFIG.viewportGap;

    top =
      Math.max(
        CONFIG.viewportGap,
        Math.min(
          top,
          Math.max(
            CONFIG.viewportGap,
            maxTop
          )
        )
      );

    menu.style.left =
      `${Math.round(left)}px`;

    menu.style.top =
      `${Math.round(top)}px`;

    menu.style.right =
      "auto";

    menu.style.visibility =
      "visible";

    return true;
  }

  /* =====================================================
     POSITION — POINTER / RIGHT CLICK
     ===================================================== */

  function positionByPointer(
    x,
    y
  ) {
    menu.style.display =
      "block";

    menu.style.visibility =
      "hidden";

    menu.classList.add(
      "show"
    );

    const rect =
      menu.getBoundingClientRect();

    const width =
      rect.width ||
      CONFIG.defaultMenuWidth;

    const height =
      rect.height ||
      CONFIG.defaultMenuHeight;

    const maxLeft =
      Math.max(
        CONFIG.viewportGap,
        window.innerWidth -
        width -
        CONFIG.viewportGap
      );

    const maxTop =
      Math.max(
        CONFIG.viewportGap,
        window.innerHeight -
        height -
        CONFIG.viewportGap
      );

    const left =
      Math.max(
        CONFIG.viewportGap,
        Math.min(
          Number(x) ||
          CONFIG.viewportGap,
          maxLeft
        )
      );

    const top =
      Math.max(
        CONFIG.viewportGap,
        Math.min(
          Number(y) ||
          CONFIG.viewportGap,
          maxTop
        )
      );

    menu.style.left =
      `${Math.round(left)}px`;

    menu.style.top =
      `${Math.round(top)}px`;

    menu.style.right =
      "auto";

    menu.style.visibility =
      "visible";

    return true;
  }

  /* =====================================================
     CLOSE MENU
     ===================================================== */

  function close({
    restoreFocus =
      true,

    reason =
      "close"
  } = {}) {
    if (
      !isOpen() &&
      !opened
    ) {
      return true;
    }

    menu.classList.remove(
      "show",
      "is-busy"
    );

    menu.style.display =
      "none";

    menu.style.left =
      "";

    menu.style.top =
      "";

    menu.style.right =
      "";

    menu.style.visibility =
      "";

    menu.setAttribute(
      "aria-hidden",
      "true"
    );

    if (
      anchorElement
        ?.isConnected
    ) {
      anchorElement.setAttribute(
        "aria-expanded",
        "false"
      );
    }

    const focusTarget =
      anchorElement ||
      previousFocus;

    opened =
      false;

    target =
      null;

    anchorElement =
      null;

    previousFocus =
      null;

    setBusy(
      null,
      false
    );

    metrics.closes +=
      1;

    if (
      restoreFocus &&
      focusTarget
        ?.isConnected
    ) {
      requestAnimationFrame(
        () => {
          try {
            focusTarget.focus({
              preventScroll:
                true
            });
          } catch {}
        }
      );
    }

    emit(
      "neyo:history-menu-closed",
      {
        reason
      }
    );

    return true;
  }

  /* =====================================================
     OPEN MENU
     ===================================================== */

  function open(
    detail = {}
  ) {
    const nextTarget =
      normalizeTarget(
        detail
      );

    if (!nextTarget) {
      return false;
    }

    /*
     * Same trigger pressed again = close.
     */

    const sameTarget =
      isOpen() &&
      target
        ?.conversationId ===
        nextTarget
          .conversationId &&
      nextTarget
        .anchorElement &&
      anchorElement ===
        nextTarget
          .anchorElement;

    if (sameTarget) {
      close({
        reason:
          "toggle"
      });

      return false;
    }

    if (isOpen()) {
      close({
        restoreFocus:
          false,

        reason:
          "switch-target"
      });
    }

    target =
      nextTarget;

    anchorElement =
      nextTarget
        .anchorElement;

    previousFocus =
      document.activeElement
        instanceof HTMLElement
        ? document.activeElement
        : null;

    opened =
      true;

    menu.setAttribute(
      "aria-hidden",
      "false"
    );

    menu.setAttribute(
      "role",
      "menu"
    );

    if (anchorElement) {
      anchorElement.setAttribute(
        "aria-haspopup",
        "menu"
      );

      anchorElement.setAttribute(
        "aria-expanded",
        "true"
      );
    }

    updatePinPresentation();

    if (
      anchorElement
    ) {
      positionByAnchor(
        anchorElement
      );

    } else {
      positionByPointer(
        nextTarget.clientX,
        nextTarget.clientY
      );
    }

    metrics.opens +=
      1;

    metrics.lastOpenedAt =
      Date.now();

    emit(
      "neyo:history-menu-opened",
      {
        conversationId:
          target.conversationId,

        title:
          target.title,

        isPinned:
          target.isPinned
      }
    );

    return true;
  }

  /* =====================================================
     DIALOG STYLES
     ===================================================== */

  function ensureDialogStyles() {
    if (
      document.getElementById(
        CONFIG.dialogStyleId
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      CONFIG.dialogStyleId;

    style.textContent = `
      .neyo-history-dialog-overlay {
        position: fixed;
        inset: 0;
        z-index: 10060;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(0,0,0,.34);
        backdrop-filter: blur(8px);
      }

      .neyo-history-dialog-overlay.is-open {
        display: flex;
      }

      .neyo-history-dialog {
        width: min(420px,100%);
        border-radius: 22px;
        border: 1px solid rgba(127,127,127,.18);
        background: var(--surface,#fff);
        color: var(--text-primary,#111);
        box-shadow: 0 28px 80px rgba(0,0,0,.22);
        overflow: hidden;
      }

      .neyo-history-dialog-body {
        padding: 22px 22px 14px;
      }

      .neyo-history-dialog-title {
        margin: 0 0 8px;
        font-size: 17px;
        font-weight: 680;
      }

      .neyo-history-dialog-copy {
        margin: 0;
        color: var(--text-muted,#666);
        font-size: 14px;
        line-height: 1.5;
      }

      .neyo-history-dialog-input {
        width: 100%;
        box-sizing: border-box;
        margin-top: 14px;
        min-height: 44px;
        border-radius: 13px;
        border: 1px solid rgba(127,127,127,.22);
        background:
          var(
            --bg-secondary,
            rgba(127,127,127,.06)
          );
        color: inherit;
        padding: 0 13px;
        font: inherit;
        outline: none;
      }

      .neyo-history-dialog-input:focus {
        border-color:
          rgba(127,127,127,.42);
      }

      .neyo-history-dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 9px;
        padding: 14px 22px 20px;
      }

      .neyo-history-dialog-btn {
        min-height: 39px;
        padding: 0 15px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-weight: 620;
        cursor: pointer;
      }

      .neyo-history-dialog-cancel {
        background:
          rgba(127,127,127,.12);
        color: inherit;
      }

      .neyo-history-dialog-primary {
        background:
          var(--accent,#111);
        color:
          var(
            --accent-contrast,
            #fff
          );
      }

      .neyo-history-dialog-danger {
        background: #d92d20;
        color: #fff;
      }

      .neyo-history-dialog-btn:disabled {
        opacity: .55;
        cursor: default;
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =====================================================
     RENAME DIALOG
     ===================================================== */

  function ensureRenameDialog() {
    if (
      renameDialog
        ?.isConnected
    ) {
      return renameDialog;
    }

    ensureDialogStyles();

    renameDialog =
      document.createElement(
        "div"
      );

    renameDialog.id =
      CONFIG.renameDialogId;

    renameDialog.className =
      "neyo-history-dialog-overlay";

    renameDialog.setAttribute(
      "aria-hidden",
      "true"
    );

    renameDialog.innerHTML = `
      <div
        class="neyo-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="neyoHistoryRenameTitle"
      >
        <div
          class="neyo-history-dialog-body"
        >
          <h2
            class="neyo-history-dialog-title"
            id="neyoHistoryRenameTitle"
          >
            Rename conversation
          </h2>

          <p
            class="neyo-history-dialog-copy"
          >
            Choose a short title for this conversation.
          </p>

          <input
            class="neyo-history-dialog-input"
            type="text"
            maxlength="100"
            autocomplete="off"
            aria-label="Conversation title"
          />
        </div>

        <div
          class="neyo-history-dialog-actions"
        >
          <button
            class="neyo-history-dialog-btn neyo-history-dialog-cancel"
            type="button"
          >
            Cancel
          </button>

          <button
            class="neyo-history-dialog-btn neyo-history-dialog-primary"
            type="button"
          >
            Save
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(
      renameDialog
    );

    return renameDialog;
  }

  /* =====================================================
     DELETE DIALOG
     ===================================================== */

  function ensureDeleteDialog() {
    if (
      deleteDialog
        ?.isConnected
    ) {
      return deleteDialog;
    }

    ensureDialogStyles();

    deleteDialog =
      document.createElement(
        "div"
      );

    deleteDialog.id =
      CONFIG.deleteDialogId;

    deleteDialog.className =
      "neyo-history-dialog-overlay";

    deleteDialog.setAttribute(
      "aria-hidden",
      "true"
    );

    deleteDialog.innerHTML = `
      <div
        class="neyo-history-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="neyoHistoryDeleteTitle"
      >
        <div
          class="neyo-history-dialog-body"
        >
          <h2
            class="neyo-history-dialog-title"
            id="neyoHistoryDeleteTitle"
          >
            Delete conversation?
          </h2>

          <p
            class="neyo-history-dialog-copy"
          >
            This conversation will be removed from your history.
          </p>
        </div>

        <div
          class="neyo-history-dialog-actions"
        >
          <button
            class="neyo-history-dialog-btn neyo-history-dialog-cancel"
            type="button"
          >
            Cancel
          </button>

          <button
            class="neyo-history-dialog-btn neyo-history-dialog-danger"
            type="button"
          >
            Delete
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(
      deleteDialog
    );

    return deleteDialog;
  }

  /* =====================================================
     CLOSE DIALOG
     ===================================================== */

  function closeDialog(
    dialog,
    {
      restoreFocus =
        true
    } = {}
  ) {
    if (!dialog) {
      return false;
    }

    dialog.classList.remove(
      "is-open"
    );

    dialog.setAttribute(
      "aria-hidden",
      "true"
    );

    if (
      restoreFocus &&
      dialogPreviousFocus
        ?.isConnected
    ) {
      const focusTarget =
        dialogPreviousFocus;

      requestAnimationFrame(
        () => {
          try {
            focusTarget.focus({
              preventScroll:
                true
            });
          } catch {}
        }
      );
    }

    dialogPreviousFocus =
      null;

    return true;
  }

  /* =====================================================
     OPEN RENAME
     ===================================================== */

  function openRenameDialog(
    conversation
  ) {
    const dialog =
      ensureRenameDialog();

    const input =
      dialog.querySelector(
        ".neyo-history-dialog-input"
      );

    const cancelButton =
      dialog.querySelector(
        ".neyo-history-dialog-cancel"
      );

    const saveButton =
      dialog.querySelector(
        ".neyo-history-dialog-primary"
      );

    dialogPreviousFocus =
      document.activeElement
        instanceof HTMLElement
        ? document.activeElement
        : null;

    input.value =
      conversation.title ||
      "";

    dialog.classList.add(
      "is-open"
    );

    dialog.setAttribute(
      "aria-hidden",
      "false"
    );

    let submitting =
      false;

    const cleanup =
      () => {
        cancelButton.onclick =
          null;

        saveButton.onclick =
          null;

        input.onkeydown =
          null;

        dialog.onpointerdown =
          null;
      };

    const cancel =
      () => {
        if (submitting) {
          return;
        }

        cleanup();

        closeDialog(
          dialog
        );
      };

    const submit =
      async () => {
        if (submitting) {
          return;
        }

        const title =
          cleanTitle(
            input.value
          );

        if (!title) {
          input.focus();

          return;
        }

        if (
          title ===
          conversation.title
        ) {
          cancel();

          return;
        }

        const history =
          getHistory();

        if (
          typeof history?.rename !==
          "function"
        ) {
          emit(
            "neyo:history-menu-error",
            {
              action:
                "rename",

              message:
                "History rename engine is unavailable."
            }
          );

          return;
        }

        submitting =
          true;

        input.disabled =
          true;

        saveButton.disabled =
          true;

        cancelButton.disabled =
          true;

        try {
          await history.rename(
            conversation
              .conversationId,
            title
          );

          metrics.renames +=
            1;

          metrics.lastActionAt =
            Date.now();

          emit(
            "neyo:history-menu-action",
            {
              action:
                "rename",

              conversationId:
                conversation
                  .conversationId,

              title
            }
          );

          cleanup();

          closeDialog(
            dialog,
            {
              restoreFocus:
                false
            }
          );

        } catch (
          error
        ) {
          metrics.actionFailures +=
            1;

          emit(
            "neyo:history-menu-error",
            {
              action:
                "rename",

              conversationId:
                conversation
                  .conversationId,

              error,

              message:
                error?.message ||
                "Rename failed."
            }
          );

        } finally {
          submitting =
            false;

          input.disabled =
            false;

          saveButton.disabled =
            false;

          cancelButton.disabled =
            false;
        }
      };

    cancelButton.onclick =
      cancel;

    saveButton.onclick =
      () => {
        void submit();
      };

    input.onkeydown =
      event => {
        if (
          event.key ===
          "Escape"
        ) {
          event.preventDefault();

          cancel();

          return;
        }

        if (
          event.key ===
            "Enter" &&
          !event.isComposing
        ) {
          event.preventDefault();

          void submit();
        }
      };

    dialog.onpointerdown =
      event => {
        if (
          event.target ===
          dialog
        ) {
          cancel();
        }
      };

    requestAnimationFrame(
      () => {
        input.focus();
        input.select();
      }
    );

    return true;
  }

  /* =====================================================
     OPEN DELETE
     ===================================================== */

  function openDeleteDialog(
    conversation
  ) {
    const dialog =
      ensureDeleteDialog();

    const copy =
      dialog.querySelector(
        ".neyo-history-dialog-copy"
      );

    const cancelButton =
      dialog.querySelector(
        ".neyo-history-dialog-cancel"
      );

    const deleteButton =
      dialog.querySelector(
        ".neyo-history-dialog-danger"
      );

    copy.textContent =
      `“${conversation.title}” will be removed from your history.`;

    dialogPreviousFocus =
      document.activeElement
        instanceof HTMLElement
        ? document.activeElement
        : null;

    dialog.classList.add(
      "is-open"
    );

    dialog.setAttribute(
      "aria-hidden",
      "false"
    );

    let submitting =
      false;

    const cleanup =
      () => {
        cancelButton.onclick =
          null;

        deleteButton.onclick =
          null;

        dialog.onkeydown =
          null;

        dialog.onpointerdown =
          null;
      };

    const cancel =
      () => {
        if (submitting) {
          return;
        }

        cleanup();

        closeDialog(
          dialog
        );
      };

    const submit =
      async () => {
        if (submitting) {
          return;
        }

        const history =
          getHistory();

        if (
          typeof history?.delete !==
          "function"
        ) {
          emit(
            "neyo:history-menu-error",
            {
              action:
                "delete",

              message:
                "History delete engine is unavailable."
            }
          );

          return;
        }

        submitting =
          true;

        deleteButton.disabled =
          true;

        cancelButton.disabled =
          true;

        try {
          await history.delete(
            conversation
              .conversationId
          );

          metrics.deletes +=
            1;

          metrics.lastActionAt =
            Date.now();

          emit(
            "neyo:history-menu-action",
            {
              action:
                "delete",

              conversationId:
                conversation
                  .conversationId
            }
          );

          cleanup();

          closeDialog(
            dialog,
            {
              restoreFocus:
                false
            }
          );

        } catch (
          error
        ) {
          metrics.actionFailures +=
            1;

          emit(
            "neyo:history-menu-error",
            {
              action:
                "delete",

              conversationId:
                conversation
                  .conversationId,

              error,

              message:
                error?.message ||
                "Delete failed."
            }
          );

        } finally {
          submitting =
            false;

          deleteButton.disabled =
            false;

          cancelButton.disabled =
            false;
        }
      };

    cancelButton.onclick =
      cancel;

    deleteButton.onclick =
      () => {
        void submit();
      };

    dialog.onkeydown =
      event => {
        if (
          event.key ===
          "Escape"
        ) {
          event.preventDefault();

          cancel();
        }
      };

    dialog.onpointerdown =
      event => {
        if (
          event.target ===
          dialog
        ) {
          cancel();
        }
      };

    requestAnimationFrame(
      () => {
        deleteButton.focus();
      }
    );

    return true;
  }

  /* =====================================================
     SHARE
     ===================================================== */

  async function shareConversation() {
    if (
      !target ||
      busyAction
    ) {
      return false;
    }

    const current = {
      ...target
    };

    setBusy(
      "share",
      true
    );

    try {
      const share =
        getShare();

      if (
        typeof share
          ?.shareConversation ===
        "function"
      ) {
        await share.shareConversation({
          conversationId:
            current
              .conversationId,

          title:
            current.title
        });

      } else {
        emit(
          "neyo:conversation-share-request",
          {
            conversationId:
              current
                .conversationId,

            title:
              current.title
          }
        );
      }

      metrics.shares +=
        1;

      metrics.lastActionAt =
        Date.now();

      emit(
        "neyo:history-menu-action",
        {
          action:
            "share",

          conversationId:
            current
              .conversationId
        }
      );

      close({
        restoreFocus:
          false,

        reason:
          "share"
      });

      return true;

    } catch (
      error
    ) {
      metrics.actionFailures +=
        1;

      emit(
        "neyo:history-menu-error",
        {
          action:
            "share",

          conversationId:
            current
              .conversationId,

          error,

          message:
            error?.message ||
            "Share failed."
        }
      );

      return false;

    } finally {
      setBusy(
        null,
        false
      );
    }
  }

  /* =====================================================
     PIN / UNPIN
     ===================================================== */

  async function togglePin() {
    if (
      !target ||
      busyAction
    ) {
      return false;
    }

    const current = {
      ...target
    };

    const nextPinned =
      !current.isPinned;

    const history =
      getHistory();

    if (
      typeof history
        ?.setPinned !==
      "function"
    ) {
      emit(
        "neyo:history-menu-error",
        {
          action:
            "pin",

          message:
            "History pin engine is unavailable."
        }
      );

      return false;
    }

    setBusy(
      "pin",
      true
    );

    try {
      await history.setPinned(
        current.conversationId,
        nextPinned
      );

      metrics.pins +=
        1;

      metrics.lastActionAt =
        Date.now();

      emit(
        "neyo:history-menu-action",
        {
          action:
            nextPinned
              ? "pin"
              : "unpin",

          conversationId:
            current
              .conversationId,

          pinned:
            nextPinned
        }
      );

      close({
        restoreFocus:
          false,

        reason:
          "pin"
      });

      return true;

    } catch (
      error
    ) {
      metrics.actionFailures +=
        1;

      emit(
        "neyo:history-menu-error",
        {
          action:
            "pin",

          conversationId:
            current
              .conversationId,

          error,

          message:
            error?.message ||
            "Pin update failed."
        }
      );

      return false;

    } finally {
      setBusy(
        null,
        false
      );
    }
  }

  /* =====================================================
     RENAME ACTION
     ===================================================== */

  function renameConversation() {
    if (
      !target ||
      busyAction
    ) {
      return false;
    }

    const current = {
      ...target
    };

    close({
      restoreFocus:
        false,

      reason:
        "rename-dialog"
    });

    return openRenameDialog(
      current
    );
  }

  /* =====================================================
     DELETE ACTION
     ===================================================== */

  function deleteConversation() {
    if (
      !target ||
      busyAction
    ) {
      return false;
    }

    const current = {
      ...target
    };

    close({
      restoreFocus:
        false,

      reason:
        "delete-dialog"
    });

    return openDeleteDialog(
      current
    );
  }

  /* =====================================================
     ACTION RESOLUTION
     ===================================================== */

  function resolveAction(
    element
  ) {
    if (
      element ===
      shareBtn
    ) {
      return "share";
    }

    if (
      element ===
      pinBtn
    ) {
      return "pin";
    }

    if (
      element ===
      renameBtn
    ) {
      return "rename";
    }

    if (
      element ===
      deleteBtn
    ) {
      return "delete";
    }

    return "";
  }

  /* =====================================================
     AUTHORITATIVE ACTION CLICK

     Capture phase blocks neo.js popup handlers.
     ===================================================== */

  menu.addEventListener(
    "click",
    event => {
      const element =
        event.target instanceof
          Element
          ? event.target.closest(
              [
                "#hpShareBtn",
                "#hpPinBtn",
                "#hpRenameBtn",
                "#hpDeleteBtn"
              ].join(",")
            )
          : null;

      if (!element) {
        return;
      }

      const action =
        resolveAction(
          element
        );

      if (!action) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (
        legacyScriptPresent
      ) {
        metrics
          .legacyActionsBlocked +=
          1;
      }

      if (busyAction) {
        return;
      }

      if (
        action ===
        "share"
      ) {
        void shareConversation();

        return;
      }

      if (
        action ===
        "pin"
      ) {
        void togglePin();

        return;
      }

      if (
        action ===
        "rename"
      ) {
        renameConversation();

        return;
      }

      deleteConversation();
    },
    true
  );

  /* =====================================================
     HISTORY MENU REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:history-menu-request",
    event => {
      open(
        event.detail ||
        {}
      );
    }
  );

  /* =====================================================
     OUTSIDE CLICK
     ===================================================== */

  document.addEventListener(
    "pointerdown",
    event => {
      if (!isOpen()) {
        return;
      }

      const targetElement =
        event.target;

      if (
        targetElement instanceof
          Node &&
        menu.contains(
          targetElement
        )
      ) {
        return;
      }

      if (
        anchorElement &&
        targetElement instanceof
          Node &&
        anchorElement.contains(
          targetElement
        )
      ) {
        return;
      }

      close({
        restoreFocus:
          false,

        reason:
          "outside"
      });
    },
    true
  );

  /* =====================================================
     ESCAPE
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {
      const renameOpen =
        renameDialog
          ?.getAttribute(
            "aria-hidden"
          ) ===
        "false";

      const deleteOpen =
        deleteDialog
          ?.getAttribute(
            "aria-hidden"
          ) ===
        "false";

      /*
       * Dialog itself owns Escape while open.
       */

      if (
        renameOpen ||
        deleteOpen
      ) {
        return;
      }

      if (
        event.key !==
          "Escape" ||
        !isOpen()
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      close({
        reason:
          "escape"
      });
    },
    true
  );

  /* =====================================================
     VIEWPORT CHANGES
     ===================================================== */

  window.addEventListener(
    "resize",
    () => {
      if (isOpen()) {
        close({
          restoreFocus:
            false,

          reason:
            "resize"
        });
      }
    },
    {
      passive:
        true
    }
  );

  document.addEventListener(
    "scroll",
    event => {
      if (!isOpen()) {
        return;
      }

      if (
        event.target instanceof
          Node &&
        menu.contains(
          event.target
        )
      ) {
        return;
      }

      close({
        restoreFocus:
          false,

        reason:
          "scroll"
      });
    },
    true
  );

  /* =====================================================
     HISTORY RE-RENDER
     ===================================================== */

  window.addEventListener(
    "neyo:history-rendered",
    () => {
      if (
        isOpen() &&
        anchorElement &&
        !anchorElement.isConnected
      ) {
        close({
          restoreFocus:
            false,

          reason:
            "history-rendered"
        });
      }
    }
  );

  /* =====================================================
     NAVIGATION CLEANUP
     ===================================================== */

  for (
    const eventName
    of [
      "neyo:chat-new",
      "neyo:chat-state-loaded",
      "neyo:conversation-opened",
      "neyo:sidebar-closed"
    ]
  ) {
    window.addEventListener(
      eventName,
      () => {
        if (isOpen()) {
          close({
            restoreFocus:
              false,

            reason:
              eventName
          });
        }
      }
    );
  }

  /* =====================================================
     INITIAL POPUP CONTRACT
     ===================================================== */

  menu.setAttribute(
    "aria-hidden",
    "true"
  );

  menu.setAttribute(
    "role",
    "menu"
  );

  for (
    const button
    of [
      shareBtn,
      pinBtn,
      renameBtn,
      deleteBtn
    ]
  ) {
    button.setAttribute(
      "role",
      "menuitem"
    );

    if (
      !button.hasAttribute(
        "tabindex"
      )
    ) {
      button.tabIndex =
        0;
    }
  }

  menu.classList.remove(
    "show"
  );

  menu.style.display =
    "none";

  refreshIcons();

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

      open,

      close,

      isOpen,

      share:
        shareConversation,

      togglePin,

      rename:
        renameConversation,

      delete:
        deleteConversation,

      positionByAnchor,

      positionByPointer,

      getTarget() {
        return target
          ? {
              conversationId:
                target
                  .conversationId,

              title:
                target.title,

              isPinned:
                target.isPinned
            }
          : null;
      },

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          open:
            isOpen(),

          busyAction,

          target:
            target
              ? {
                  conversationId:
                    target
                      .conversationId,

                  title:
                    target.title,

                  isPinned:
                    target.isPinned
                }
              : null,

          legacyScriptPresent,

          legacyOwnerActive:
            false,

          metrics: {
            ...metrics
          }
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoHistoryMenu",
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
    "neyo:history-menu-ready",
    {
      version:
        VERSION,

      active:
        true,

      share:
        true,

      pin:
        true,

      rename:
        true,

      delete:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false
    }
  );
})();
