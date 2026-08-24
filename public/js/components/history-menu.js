/*
=========================================================
NEO — HISTORY MENU
Production v1

Owns:
- history three-dot popup UI
- right-click popup positioning
- keyboard navigation
- Share action routing
- Pin / Unpin routing
- Rename dialog UI
- Delete confirmation dialog UI
- focus restoration
- outside-click / Escape close

Does NOT own:
- /api/history
- rename persistence
- delete persistence
- pin persistence
- conversation list state
- public share-link backend
- chat rendering
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-history-menu-production-v1";

  if (
    window.NeyoHistoryMenu
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     DOM
     ===================================================== */

  const menu =
    document.getElementById(
      "historyPopupMenu"
    );

  const shareButton =
    document.getElementById(
      "hpShareBtn"
    );

  const pinButton =
    document.getElementById(
      "hpPinBtn"
    );

  const renameButton =
    document.getElementById(
      "hpRenameBtn"
    );

  const deleteButton =
    document.getElementById(
      "hpDeleteBtn"
    );

  if (!menu) {
    console.warn(
      "[NEO History Menu] #historyPopupMenu is missing."
    );

    return;
  }

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    open: false,

    conversationId: null,
    title: "",
    pinned: false,

    anchorElement: null,

    renameDialog: null,
    deleteDialog: null,

    lastFocusedElement: null,

    busyAction: null
  };

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
    max = 220
  ) {
    return String(
      value ?? ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .trim()
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
      128
    );
  }

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  function history() {
    const controller =
      window.NeyoHistory;

    return (
      controller &&
      controller.__controller ===
        true
    )
      ? controller
      : null;
  }

  function share() {
    const controller =
      window.NeyoShare;

    return (
      controller &&
      controller.__controller ===
        true
    )
      ? controller
      : null;
  }

  /* =====================================================
     NORMALIZE EXISTING MENU ITEMS

     Existing HTML uses divs.
     Make them keyboard-accessible without redesign.
     ===================================================== */

  function prepareMenuItem(
    element
  ) {
    if (!element) {
      return;
    }

    element.setAttribute(
      "role",
      "menuitem"
    );

    element.setAttribute(
      "tabindex",
      "-1"
    );
  }

  menu.setAttribute(
    "role",
    "menu"
  );

  menu.setAttribute(
    "aria-hidden",
    "true"
  );

  prepareMenuItem(
    shareButton
  );

  prepareMenuItem(
    pinButton
  );

  prepareMenuItem(
    renameButton
  );

  prepareMenuItem(
    deleteButton
  );

  /* =====================================================
     MENU ITEMS
     ===================================================== */

  function menuItems() {
    return [
      shareButton,
      pinButton,
      renameButton,
      deleteButton
    ].filter(
      element =>
        element &&
        !element.hidden &&
        element.getAttribute(
          "aria-disabled"
        ) !== "true"
    );
  }

  /* =====================================================
     PIN UI
     ===================================================== */

  function renderPinState() {
    if (!pinButton) {
      return;
    }

    const label =
      state.pinned
        ? "Unpin"
        : "Pin";

    pinButton.setAttribute(
      "aria-label",
      `${label} conversation`
    );

    pinButton.setAttribute(
      "data-tooltip",
      `${label} conversation`
    );

    /*
     * Preserve existing icon + text structure.
     */

    pinButton.replaceChildren();

    const icon =
      document.createElement(
        "i"
      );

    icon.setAttribute(
      "data-lucide",
      state.pinned
        ? "pin-off"
        : "pin"
    );

    icon.setAttribute(
      "size",
      "16"
    );

    icon.setAttribute(
      "aria-hidden",
      "true"
    );

    const text =
      document.createTextNode(
        label
      );

    pinButton.append(
      icon,
      text
    );

    refreshIcons();
  }

  /* =====================================================
     POSITION
     ===================================================== */

  function menuSize() {
    /*
     * Popup may currently be display:none.
     * Temporarily reveal invisibly for measurement.
     */

    const wasOpen =
      menu.classList.contains(
        "show"
      );

    if (!wasOpen) {
      menu.style.visibility =
        "hidden";

      menu.classList.add(
        "show"
      );
    }

    const rect =
      menu.getBoundingClientRect();

    if (!wasOpen) {
      menu.classList.remove(
        "show"
      );

      menu.style.visibility =
        "";
    }

    return {
      width:
        rect.width || 204,

      height:
        rect.height || 180
    };
  }

  function clamp(
    value,
    min,
    max
  ) {
    return Math.min(
      Math.max(
        value,
        min
      ),
      Math.max(
        min,
        max
      )
    );
  }

  function positionMenu({
    anchorElement = null,
    clientX = null,
    clientY = null
  } = {}) {
    const viewportWidth =
      window.innerWidth;

    const viewportHeight =
      window.innerHeight;

    const margin =
      8;

    const gap =
      6;

    const size =
      menuSize();

    let left =
      margin;

    let top =
      margin;

    /* -----------------------------------------------
       Right-click coordinates
       ----------------------------------------------- */

    if (
      Number.isFinite(
        Number(clientX)
      ) &&
      Number.isFinite(
        Number(clientY)
      )
    ) {
      left =
        Number(clientX);

      top =
        Number(clientY);
    }

    /* -----------------------------------------------
       Three-dot anchor
       ----------------------------------------------- */

    else if (
      anchorElement instanceof
        Element
    ) {
      const rect =
        anchorElement
          .getBoundingClientRect();

      /*
       * Prefer opening to the right/below the button,
       * then clamp inside viewport.
       */

      left =
        rect.right -
        size.width;

      top =
        rect.bottom +
        gap;

      /*
       * If bottom space is insufficient,
       * open above.
       */

      if (
        top +
        size.height +
        margin >
        viewportHeight
      ) {
        top =
          rect.top -
          size.height -
          gap;
      }
    }

    left =
      clamp(
        left,
        margin,
        viewportWidth -
          size.width -
          margin
      );

    top =
      clamp(
        top,
        margin,
        viewportHeight -
          size.height -
          margin
      );

    menu.style.left =
      `${Math.round(left)}px`;

    menu.style.top =
      `${Math.round(top)}px`;
  }

  /* =====================================================
     OPEN
     ===================================================== */

  function open(
    detail = {}
  ) {
    const id =
      cleanId(
        detail.conversationId ||
        detail.id
      );

    if (!id) {
      return false;
    }

    const stored =
      history()
        ?.getById
        ?.(id);

    state.conversationId =
      id;

    state.title =
      clean(
        detail.title ||
        stored?.title ||
        "New conversation",
        80
      ) ||
      "New conversation";

    state.pinned =
      Boolean(
        detail.isPinned ??
        detail.pinned ??
        stored?.is_pinned
      );

    state.anchorElement =
      detail.anchorElement instanceof
        Element
        ? detail.anchorElement
        : null;

    state.lastFocusedElement =
      document.activeElement instanceof
        HTMLElement
        ? document.activeElement
        : null;

    renderPinState();

    positionMenu({
      anchorElement:
        state.anchorElement,

      clientX:
        detail.clientX,

      clientY:
        detail.clientY
    });

    menu.classList.add(
      "show"
    );

    menu.style.display =
      "";

    menu.setAttribute(
      "aria-hidden",
      "false"
    );

    state.open =
      true;

    if (
      state.anchorElement
    ) {
      state.anchorElement
        .setAttribute(
          "aria-expanded",
          "true"
        );
    }

    requestAnimationFrame(
      () => {
        menuItems()[0]
          ?.focus();
      }
    );

    emit(
      "neyo:history-menu-opened",
      {
        conversationId:
          id,

        title:
          state.title,

        pinned:
          state.pinned
      }
    );

    return true;
  }

  /* =====================================================
     CLOSE
     ===================================================== */

  function close({
    restoreFocus = true
  } = {}) {
    if (!state.open) {
      return false;
    }

    menu.classList.remove(
      "show"
    );

    menu.style.display =
      "none";

    menu.style.left =
      "";

    menu.style.top =
      "";

    menu.setAttribute(
      "aria-hidden",
      "true"
    );

    if (
      state.anchorElement
    ) {
      state.anchorElement
        .setAttribute(
          "aria-expanded",
          "false"
        );
    }

    const focusTarget =
      state.anchorElement ||
      state.lastFocusedElement;

    state.open =
      false;

    state.anchorElement =
      null;

    if (
      restoreFocus &&
      focusTarget instanceof
        HTMLElement &&
      focusTarget.isConnected
    ) {
      requestAnimationFrame(
        () => {
          focusTarget.focus();
        }
      );
    }

    emit(
      "neyo:history-menu-closed",
      {
        conversationId:
          state.conversationId
      }
    );

    return true;
  }

  /* =====================================================
     BUSY
     ===================================================== */

  function setBusy(
    action,
    busy
  ) {
    state.busyAction =
      busy
        ? action
        : null;

    const elements =
      menuItems();

    for (
      const element
      of elements
    ) {
      const disabled =
        Boolean(busy);

      element.setAttribute(
        "aria-disabled",
        String(
          disabled
        )
      );

      element.classList.toggle(
        "is-disabled",
        disabled
      );
    }

    menu.classList.toggle(
      "is-busy",
      Boolean(busy)
    );
  }

  /* =====================================================
     SHARE

     share.js owns actual share behavior.
     history.js provides conversation data.
     ===================================================== */

  async function shareConversation() {
    const id =
      state.conversationId;

    if (
      !id ||
      state.busyAction
    ) {
      return false;
    }

    const shareController =
      share();

    if (
      !shareController ||
      typeof shareController
        .shareConversation !==
        "function"
    ) {
      emit(
        "neyo:history-menu-error",
        {
          conversationId:
            id,

          action:
            "share",

          reason:
            "share-controller-unavailable"
        }
      );

      return false;
    }

    setBusy(
      "share",
      true
    );

    try {
      let messages = [];

      /*
       * Active conversation can use current chat state
       * without another server request.
       */

      if (
        history()
          ?.getActive
          ?.() === id &&
        window.NeyoChat
          ?.getConversationId
          ?.() === id
      ) {
        messages =
          window.NeyoChat
            ?.getConversation
            ?.() ||
          [];
      }

      /*
       * Sharing another conversation from sidebar:
       * fetch it without opening/mutating current chat.
       */

      if (!messages.length) {
        const result =
          await history()
            ?.fetchConversation
            ?.(id);

        messages =
          Array.isArray(
            result?.messages
          )
            ? result.messages
            : [];
      }

      if (!messages.length) {
        return false;
      }

      return await shareController
        .shareConversation({
          messages,

          title:
            state.title
        });

    } catch (error) {
      console.error(
        "[NEO History Menu] Share failed:",
        error
      );

      emit(
        "neyo:history-menu-error",
        {
          conversationId:
            id,

          action:
            "share",

          error
        }
      );

      return false;

    } finally {
      setBusy(
        "share",
        false
      );

      close({
        restoreFocus:
          true
      });
    }
  }

  /* =====================================================
     PIN / UNPIN

     Persistence belongs to history.js.
     ===================================================== */

  function togglePinned() {
    const id =
      state.conversationId;

    if (
      !id ||
      state.busyAction
    ) {
      return false;
    }

    const next =
      !state.pinned;

    close({
      restoreFocus:
        true
    });

    emit(
      "neyo:history-pin-request",
      {
        conversationId:
          id,

        pinned:
          next
      }
    );

    return true;
  }

  /* =====================================================
     DIALOG HELPERS
     ===================================================== */

  function createDialogShell({
    className,
    ariaLabel
  }) {
    const dialog =
      document.createElement(
        "dialog"
      );

    dialog.className =
      className;

    dialog.setAttribute(
      "aria-label",
      ariaLabel
    );

    /*
     * Prevent default Escape closing from bypassing
     * our cleanup.
     */

    dialog.addEventListener(
      "cancel",
      event => {
        event.preventDefault();

        closeDialog(
          dialog
        );
      }
    );

    dialog.addEventListener(
      "click",
      event => {
        /*
         * Native dialog backdrop click:
         * click target === dialog.
         */

        if (
          event.target ===
          dialog
        ) {
          closeDialog(
            dialog
          );
        }
      }
    );

    document.body.appendChild(
      dialog
    );

    return dialog;
  }

  function showDialog(
    dialog
  ) {
    if (!dialog) {
      return false;
    }

    try {
      if (
        typeof dialog.showModal ===
        "function"
      ) {
        dialog.showModal();

      } else {
        dialog.setAttribute(
          "open",
          ""
        );
      }

      return true;

    } catch {
      dialog.setAttribute(
        "open",
        ""
      );

      return true;
    }
  }

  function closeDialog(
    dialog
  ) {
    if (!dialog) {
      return false;
    }

    try {
      if (
        typeof dialog.close ===
        "function" &&
        dialog.open
      ) {
        dialog.close();
      }

    } catch {}

    dialog.remove();

    if (
      state.renameDialog ===
      dialog
    ) {
      state.renameDialog =
        null;
    }

    if (
      state.deleteDialog ===
      dialog
    ) {
      state.deleteDialog =
        null;
    }

    return true;
  }

  /* =====================================================
     RENAME DIALOG

     No prompt().
     ===================================================== */

  function openRenameDialog() {
    const id =
      state.conversationId;

    if (
      !id ||
      state.busyAction
    ) {
      return false;
    }

    const currentTitle =
      state.title;

    close({
      restoreFocus:
        false
    });

    state.renameDialog
      ?.remove();

    const dialog =
      createDialogShell({
        className:
          "history-action-dialog history-rename-dialog",

        ariaLabel:
          "Rename conversation"
      });

    state.renameDialog =
      dialog;

    const card =
      document.createElement(
        "div"
      );

    card.className =
      "history-dialog-card";

    const title =
      document.createElement(
        "h3"
      );

    title.className =
      "history-dialog-title";

    title.textContent =
      "Rename conversation";

    const input =
      document.createElement(
        "input"
      );

    input.type =
      "text";

    input.className =
      "history-dialog-input";

    input.value =
      currentTitle;

    input.maxLength =
      80;

    input.autocomplete =
      "off";

    input.setAttribute(
      "aria-label",
      "Conversation name"
    );

    const actions =
      document.createElement(
        "div"
      );

    actions.className =
      "history-dialog-actions";

    const cancelButton =
      document.createElement(
        "button"
      );

    cancelButton.type =
      "button";

    cancelButton.className =
      "history-dialog-cancel";

    cancelButton.textContent =
      "Cancel";

    const saveButton =
      document.createElement(
        "button"
      );

    saveButton.type =
      "button";

    saveButton.className =
      "history-dialog-primary";

    saveButton.textContent =
      "Save";

    actions.append(
      cancelButton,
      saveButton
    );

    card.append(
      title,
      input,
      actions
    );

    dialog.appendChild(
      card
    );

    function updateSave() {
      saveButton.disabled =
        clean(
          input.value,
          80
        ).length === 0;
    }

    function cancelRename() {
      closeDialog(
        dialog
      );

      state.lastFocusedElement
        ?.focus?.();
    }

    function submitRename() {
      const nextTitle =
        clean(
          input.value,
          80
        );

      if (!nextTitle) {
        return;
      }

      closeDialog(
        dialog
      );

      emit(
        "neyo:history-rename-request",
        {
          conversationId:
            id,

          title:
            nextTitle
        }
      );
    }

    input.addEventListener(
      "input",
      updateSave
    );

    input.addEventListener(
      "keydown",
      event => {
        if (
          event.key ===
          "Enter"
        ) {
          event.preventDefault();

          if (
            !saveButton.disabled
          ) {
            submitRename();
          }

          return;
        }

        if (
          event.key ===
          "Escape"
        ) {
          event.preventDefault();

          cancelRename();
        }
      }
    );

    cancelButton.addEventListener(
      "click",
      event => {
        event.preventDefault();

        cancelRename();
      }
    );

    saveButton.addEventListener(
      "click",
      event => {
        event.preventDefault();

        submitRename();
      }
    );

    updateSave();

    showDialog(
      dialog
    );

    requestAnimationFrame(
      () => {
        input.focus();
        input.select();
      }
    );

    emit(
      "neyo:history-rename-dialog-opened",
      {
        conversationId:
          id
      }
    );

    return true;
  }

  /* =====================================================
     DELETE DIALOG

     No confirm().
     ===================================================== */

  function openDeleteDialog() {
    const id =
      state.conversationId;

    if (
      !id ||
      state.busyAction
    ) {
      return false;
    }

    const conversationTitle =
      state.title;

    close({
      restoreFocus:
        false
    });

    state.deleteDialog
      ?.remove();

    const dialog =
      createDialogShell({
        className:
          "history-action-dialog history-delete-dialog",

        ariaLabel:
          "Delete conversation"
      });

    state.deleteDialog =
      dialog;

    const card =
      document.createElement(
        "div"
      );

    card.className =
      "history-dialog-card";

    const heading =
      document.createElement(
        "h3"
      );

    heading.className =
      "history-dialog-title";

    heading.textContent =
      "Delete conversation?";

    const description =
      document.createElement(
        "p"
      );

    description.className =
      "history-dialog-description";

    description.textContent =
      conversationTitle
        ? `“${conversationTitle}” will be permanently deleted.`
        : "This conversation will be permanently deleted.";

    const actions =
      document.createElement(
        "div"
      );

    actions.className =
      "history-dialog-actions";

    const cancelButton =
      document.createElement(
        "button"
      );

    cancelButton.type =
      "button";

    cancelButton.className =
      "history-dialog-cancel";

    cancelButton.textContent =
      "Cancel";

    const deleteConfirm =
      document.createElement(
        "button"
      );

    deleteConfirm.type =
      "button";

    deleteConfirm.className =
      "history-dialog-danger";

    deleteConfirm.textContent =
      "Delete";

    actions.append(
      cancelButton,
      deleteConfirm
    );

    card.append(
      heading,
      description,
      actions
    );

    dialog.appendChild(
      card
    );

    function cancelDelete() {
      closeDialog(
        dialog
      );

      state.lastFocusedElement
        ?.focus?.();
    }

    function submitDelete() {
      closeDialog(
        dialog
      );

      emit(
        "neyo:history-delete-request",
        {
          conversationId:
            id
        }
      );
    }

    cancelButton.addEventListener(
      "click",
      event => {
        event.preventDefault();

        cancelDelete();
      }
    );

    deleteConfirm.addEventListener(
      "click",
      event => {
        event.preventDefault();

        submitDelete();
      }
    );

    dialog.addEventListener(
      "keydown",
      event => {
        if (
          event.key ===
          "Escape"
        ) {
          event.preventDefault();

          cancelDelete();
        }
      }
    );

    showDialog(
      dialog
    );

    requestAnimationFrame(
      () => {
        cancelButton.focus();
      }
    );

    emit(
      "neyo:history-delete-dialog-opened",
      {
        conversationId:
          id
      }
    );

    return true;
  }

  /* =====================================================
     MENU ACTION HANDLER
     ===================================================== */

  function activateMenuItem(
    element
  ) {
    if (
      !element ||
      element.getAttribute(
        "aria-disabled"
      ) === "true"
    ) {
      return false;
    }

    if (
      element ===
      shareButton
    ) {
      void shareConversation();

      return true;
    }

    if (
      element ===
      pinButton
    ) {
      return togglePinned();
    }

    if (
      element ===
      renameButton
    ) {
      return openRenameDialog();
    }

    if (
      element ===
      deleteButton
    ) {
      return openDeleteDialog();
    }

    return false;
  }

  /* =====================================================
     CLICK EVENTS
     ===================================================== */

  for (
    const element
    of menuItems()
  ) {
    element.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        activateMenuItem(
          element
        );
      },
      true
    );
  }

  /* =====================================================
     KEYBOARD NAVIGATION
     ===================================================== */

  menu.addEventListener(
    "keydown",
    event => {
      if (!state.open) {
        return;
      }

      const items =
        menuItems();

      if (!items.length) {
        return;
      }

      const currentIndex =
        items.indexOf(
          document.activeElement
        );

      if (
        event.key ===
        "ArrowDown"
      ) {
        event.preventDefault();

        const next =
          currentIndex < 0
            ? 0
            : (
                currentIndex +
                1
              ) %
              items.length;

        items[next].focus();

        return;
      }

      if (
        event.key ===
        "ArrowUp"
      ) {
        event.preventDefault();

        const next =
          currentIndex < 0
            ? items.length - 1
            : (
                currentIndex -
                1 +
                items.length
              ) %
              items.length;

        items[next].focus();

        return;
      }

      if (
        event.key ===
        "Home"
      ) {
        event.preventDefault();

        items[0].focus();

        return;
      }

      if (
        event.key ===
        "End"
      ) {
        event.preventDefault();

        items[
          items.length - 1
        ].focus();

        return;
      }

      if (
        event.key ===
          "Enter" ||
        event.key ===
          " "
      ) {
        const active =
          document.activeElement;

        if (
          items.includes(
            active
          )
        ) {
          event.preventDefault();

          activateMenuItem(
            active
          );
        }

        return;
      }

      if (
        event.key ===
        "Escape"
      ) {
        event.preventDefault();

        close();
      }
    }
  );

  /* =====================================================
     HISTORY REQUEST EVENT

     history.js emits this from three-dot and right-click.
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
      if (!state.open) {
        return;
      }

      const target =
        event.target;

      if (
        target instanceof Node &&
        menu.contains(
          target
        )
      ) {
        return;
      }

      if (
        state.anchorElement &&
        target instanceof Node &&
        state.anchorElement
          .contains(
            target
          )
      ) {
        return;
      }

      close({
        restoreFocus:
          false
      });
    },
    true
  );

  /* =====================================================
     GLOBAL ESCAPE
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
          "Escape" &&
        state.open
      ) {
        event.preventDefault();

        close();
      }
    },
    true
  );

  /* =====================================================
     RESIZE / SCROLL

     Fixed-position menu should not become detached from
     its source row.
     ===================================================== */

  window.addEventListener(
    "resize",
    () => {
      if (state.open) {
        close({
          restoreFocus:
            false
        });
      }
    },
    {
      passive: true
    }
  );

  document.addEventListener(
    "scroll",
    () => {
      if (state.open) {
        close({
          restoreFocus:
            false
        });
      }
    },
    {
      passive: true,
      capture: true
    }
  );

  /* =====================================================
     HISTORY MUTATION SYNC
     ===================================================== */

  window.addEventListener(
    "neyo:history-pin-change",
    event => {
      if (
        cleanId(
          event.detail
            ?.conversationId
        ) !==
        state.conversationId
      ) {
        return;
      }

      state.pinned =
        Boolean(
          event.detail
            ?.pinned
        );

      renderPinState();
    }
  );

  window.addEventListener(
    "neyo:history-renamed",
    event => {
      if (
        cleanId(
          event.detail
            ?.conversationId
        ) !==
        state.conversationId
      ) {
        return;
      }

      state.title =
        clean(
          event.detail
            ?.title,
          80
        ) ||
        state.title;
    }
  );

  window.addEventListener(
    "neyo:history-deleted",
    event => {
      if (
        cleanId(
          event.detail
            ?.conversationId
        ) !==
        state.conversationId
      ) {
        return;
      }

      close({
        restoreFocus:
          false
      });

      state.conversationId =
        null;

      state.title =
        "";

      state.pinned =
        false;
    }
  );

  /* =====================================================
     CHAT NAVIGATION

     Any conversation navigation closes stale menu.
     ===================================================== */

  for (
    const eventName
    of [
      "neyo:chat-new",
      "neyo:chat-state-loaded",
      "neyo:history-opening",
      "neyo:messages-cleared"
    ]
  ) {
    window.addEventListener(
      eventName,
      () => {
        if (state.open) {
          close({
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

      open,

      close,

      share:
        shareConversation,

      togglePinned,

      rename:
        openRenameDialog,

      delete:
        openDeleteDialog,

      isOpen() {
        return state.open;
      },

      getConversationId() {
        return (
          state.conversationId ||
          null
        );
      },

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          open:
            state.open,

          conversationId:
            state.conversationId,

          title:
            state.title,

          pinned:
            state.pinned,

          busyAction:
            state.busyAction,

          renameDialogOpen:
            Boolean(
              state.renameDialog
            ),

          deleteDialogOpen:
            Boolean(
              state.deleteDialog
            )
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
     INIT
     ===================================================== */

  menu.classList.remove(
    "show"
  );

  menu.style.display =
    "none";

  renderPinState();

  emit(
    "neyo:history-menu-ready",
    {
      version:
        VERSION,

      active:
        true
    }
  );
})();
