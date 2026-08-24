/*
=========================================================
NEO — HISTORY MENU
Production v3 — Baseline Safe

Baseline:
- Existing #historyPopupMenu HTML
- Old Share / Pin / Rename / Delete behavior
- Current NeyoHistory controller
- Current NeyoShare conversation contract

Owns:
- History popup positioning
- Selected conversation menu state
- Share selected conversation
- Pin / Unpin routing
- Rename dialog UI
- Delete confirmation dialog UI
- Menu keyboard navigation
- Outside-click / Escape closing
- Busy state
- Focus restoration

Does NOT own:
- History persistence
- History list rendering
- Conversation opening
- Chat state
- Public share backend
- Sidebar
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-history-menu-production-v3";

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
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      viewportGap:
        8,

      anchorGap:
        6,

      maxTitleLength:
        100
    });

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    open: false,

    busy: false,

    conversationId: null,

    title: "",

    isPinned: false,

    anchorElement: null,

    restoreFocusElement: null,

    clientX: null,

    clientY: null,

    dialog: null
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
    max = 500
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

  function cleanId(value) {
    return clean(
      value,
      160
    );
  }

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  function historyController() {
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

  /* =====================================================
     MENU ITEMS

     Important:
     allMenuItems() ALWAYS returns every actual menu item.

     interactiveMenuItems() returns only currently enabled
     items for keyboard navigation.

     This separation fixes the old permanent-disabled bug:
     setBusy(true) disabled every item, then the old
     menuItems() selector could no longer find those items
     to re-enable them.
     ===================================================== */

  function allMenuItems() {
    return [
      shareButton,
      pinButton,
      renameButton,
      deleteButton
    ].filter(
      item =>
        item instanceof
        HTMLElement
    );
  }

  function interactiveMenuItems() {
    return allMenuItems()
      .filter(item => {
        if (
          item.hidden ||
          item.getAttribute(
            "aria-hidden"
          ) === "true"
        ) {
          return false;
        }

        if (
          item.getAttribute(
            "aria-disabled"
          ) === "true"
        ) {
          return false;
        }

        if (
          "disabled" in item &&
          item.disabled === true
        ) {
          return false;
        }

        return true;
      });
  }

  /* =====================================================
     ACCESSIBILITY HYDRATION

     Existing HTML currently uses div.history-popup-item.
     No HTML rewrite needed.
     ===================================================== */

  function hydrateMenuAccessibility() {
    menu.setAttribute(
      "role",
      "menu"
    );

    menu.setAttribute(
      "aria-hidden",
      "true"
    );

    for (
      const item
      of allMenuItems()
    ) {
      item.setAttribute(
        "role",
        "menuitem"
      );

      item.setAttribute(
        "tabindex",
        "-1"
      );

      /*
       * Prevent native browser title-style duplication.
       * Existing tooltip system uses data-tooltip.
       */

      if (
        item.hasAttribute(
          "title"
        )
      ) {
        item.removeAttribute(
          "title"
        );
      }
    }
  }

  /* =====================================================
     LABEL
     ===================================================== */

  function setItemLabel(
    item,
    iconName,
    label
  ) {
    if (!item) {
      return;
    }

    item.replaceChildren();

    const icon =
      document.createElement(
        "i"
      );

    icon.setAttribute(
      "data-lucide",
      iconName
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

    item.append(
      icon,
      text
    );

    refreshIcons();
  }

  function refreshLabels() {
    if (shareButton) {
      setItemLabel(
        shareButton,
        "share-2",
        "Share conversation"
      );

      shareButton.setAttribute(
        "aria-label",
        "Share conversation"
      );
    }

    if (pinButton) {
      const label =
        state.isPinned
          ? "Unpin"
          : "Pin";

      setItemLabel(
        pinButton,
        state.isPinned
          ? "pin-off"
          : "pin",
        label
      );

      pinButton.setAttribute(
        "aria-label",
        `${label} conversation`
      );

      pinButton.dataset.tooltip =
        `${label} conversation`;
    }

    if (renameButton) {
      setItemLabel(
        renameButton,
        "pencil",
        "Rename"
      );

      renameButton.setAttribute(
        "aria-label",
        "Rename conversation"
      );
    }

    if (deleteButton) {
      setItemLabel(
        deleteButton,
        "trash-2",
        "Delete"
      );

      deleteButton.setAttribute(
        "aria-label",
        "Delete conversation"
      );
    }
  }

  /* =====================================================
     BUSY

     Uses ALL items, not enabled-only items.
     ===================================================== */

  function setBusy(value) {
    state.busy =
      Boolean(value);

    menu.classList.toggle(
      "is-busy",
      state.busy
    );

    for (
      const item
      of allMenuItems()
    ) {
      item.setAttribute(
        "aria-disabled",
        String(
          state.busy
        )
      );

      item.classList.toggle(
        "is-disabled",
        state.busy
      );

      if (
        "disabled" in item
      ) {
        item.disabled =
          state.busy;
      }
    }

    return true;
  }

  /* =====================================================
     POSITION
     ===================================================== */

  function clamp(
    value,
    min,
    max
  ) {
    return Math.min(
      max,
      Math.max(
        min,
        value
      )
    );
  }

  function positionMenu() {
    if (!state.open) {
      return;
    }

    /*
     * Temporarily make measurable.
     */

    menu.style.visibility =
      "hidden";

    menu.style.display =
      "block";

    menu.classList.add(
      "show"
    );

    const rect =
      menu.getBoundingClientRect();

    const width =
      rect.width ||
      menu.offsetWidth ||
      190;

    const height =
      rect.height ||
      menu.offsetHeight ||
      160;

    const viewportWidth =
      window.innerWidth;

    const viewportHeight =
      window.innerHeight;

    let left = 0;
    let top = 0;

    /* -----------------------------------------------
       RIGHT CLICK POSITION
       ----------------------------------------------- */

    if (
      Number.isFinite(
        state.clientX
      ) &&
      Number.isFinite(
        state.clientY
      )
    ) {
      left =
        state.clientX;

      top =
        state.clientY;
    }

    /* -----------------------------------------------
       BUTTON ANCHOR
       ----------------------------------------------- */

    else if (
      state.anchorElement instanceof
        Element &&
      state.anchorElement.isConnected
    ) {
      const anchor =
        state.anchorElement
          .getBoundingClientRect();

      /*
       * Prefer opening below and right-aligned with the
       * three-dot button.
       */

      left =
        anchor.right -
        width;

      top =
        anchor.bottom +
        CONFIG.anchorGap;

      /*
       * Not enough room below → open above.
       */

      if (
        top +
          height +
          CONFIG.viewportGap >
        viewportHeight
      ) {
        top =
          anchor.top -
          height -
          CONFIG.anchorGap;
      }
    }

    left =
      clamp(
        left,
        CONFIG.viewportGap,
        Math.max(
          CONFIG.viewportGap,
          viewportWidth -
            width -
            CONFIG.viewportGap
        )
      );

    top =
      clamp(
        top,
        CONFIG.viewportGap,
        Math.max(
          CONFIG.viewportGap,
          viewportHeight -
            height -
            CONFIG.viewportGap
        )
      );

    menu.style.left =
      `${Math.round(left)}px`;

    menu.style.top =
      `${Math.round(top)}px`;

    menu.style.visibility =
      "";
  }

  /* =====================================================
     FOCUS
     ===================================================== */

  function focusFirstItem() {
    const item =
      interactiveMenuItems()[0];

    item?.focus?.();
  }

  function focusRelative(
    direction
  ) {
    const items =
      interactiveMenuItems();

    if (!items.length) {
      return;
    }

    const currentIndex =
      items.indexOf(
        document.activeElement
      );

    let nextIndex = 0;

    if (
      currentIndex >= 0
    ) {
      nextIndex =
        (
          currentIndex +
          direction +
          items.length
        ) %
        items.length;
    }

    items[
      nextIndex
    ]?.focus?.();
  }

  /* =====================================================
     OPEN
     ===================================================== */

  function open({
    conversationId,
    title = "",
    isPinned = false,
    anchorElement = null,
    clientX = null,
    clientY = null
  } = {}) {
    const id =
      cleanId(
        conversationId
      );

    if (!id) {
      return false;
    }

    /*
     * Close any dialog/menu state first without restoring
     * stale focus.
     */

    if (state.dialog) {
      closeDialog({
        restoreFocus:
          false
      });
    }

    state.open =
      true;

    state.busy =
      false;

    state.conversationId =
      id;

    state.title =
      clean(
        title,
        CONFIG.maxTitleLength
      ) ||
      "New conversation";

    state.isPinned =
      Boolean(
        isPinned
      );

    state.anchorElement =
      anchorElement instanceof
        Element
        ? anchorElement
        : null;

    state.restoreFocusElement =
      state.anchorElement;

    state.clientX =
      Number.isFinite(
        Number(clientX)
      )
        ? Number(clientX)
        : null;

    state.clientY =
      Number.isFinite(
        Number(clientY)
      )
        ? Number(clientY)
        : null;

    refreshLabels();

    setBusy(false);

    menu.classList.add(
      "show"
    );

    menu.classList.add(
      "open"
    );

    menu.style.display =
      "block";

    menu.setAttribute(
      "aria-hidden",
      "false"
    );

    positionMenu();

    requestAnimationFrame(
      focusFirstItem
    );

    emit(
      "neyo:history-menu-opened",
      {
        conversationId:
          state.conversationId
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

    const focusTarget =
      state.restoreFocusElement;

    const conversationId =
      state.conversationId;

    state.open =
      false;

    state.busy =
      false;

    state.conversationId =
      null;

    state.title =
      "";

    state.isPinned =
      false;

    state.anchorElement =
      null;

    state.restoreFocusElement =
      null;

    state.clientX =
      null;

    state.clientY =
      null;

    menu.classList.remove(
      "show",
      "open",
      "is-busy"
    );

    menu.style.display =
      "none";

    menu.style.visibility =
      "";

    menu.style.left =
      "";

    menu.style.top =
      "";

    menu.setAttribute(
      "aria-hidden",
      "true"
    );

    setBusy(false);

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
        conversationId
      }
    );

    return true;
  }

  /* =====================================================
     DIALOG BASE
     ===================================================== */

  function createDialog({
    title,
    description = ""
  }) {
    closeDialog({
      restoreFocus:
        false
    });

    const overlay =
      document.createElement(
        "div"
      );

    overlay.className =
      "history-dialog-overlay";

    const dialog =
      document.createElement(
        "div"
      );

    dialog.className =
      "history-dialog";

    dialog.setAttribute(
      "role",
      "dialog"
    );

    dialog.setAttribute(
      "aria-modal",
      "true"
    );

    const heading =
      document.createElement(
        "h3"
      );

    heading.className =
      "history-dialog-title";

    heading.textContent =
      title;

    dialog.appendChild(
      heading
    );

    if (description) {
      const text =
        document.createElement(
          "p"
        );

      text.className =
        "history-dialog-description";

      text.textContent =
        description;

      dialog.appendChild(
        text
      );
    }

    overlay.appendChild(
      dialog
    );

    document.body.appendChild(
      overlay
    );

    state.dialog = {
      overlay,
      dialog,
      previousFocus:
        document.activeElement
    };

    return {
      overlay,
      dialog
    };
  }

  /* =====================================================
     CLOSE DIALOG
     ===================================================== */

  function closeDialog({
    restoreFocus = true
  } = {}) {
    if (!state.dialog) {
      return false;
    }

    const {
      overlay,
      previousFocus
    } =
      state.dialog;

    state.dialog =
      null;

    overlay?.remove();

    if (
      restoreFocus &&
      previousFocus instanceof
        HTMLElement &&
      previousFocus.isConnected
    ) {
      requestAnimationFrame(
        () => {
          previousFocus.focus();
        }
      );
    }

    return true;
  }

  /* =====================================================
     DIALOG KEYBOARD
     ===================================================== */

  function trapDialogTab(
    event
  ) {
    if (
      event.key !== "Tab" ||
      !state.dialog
    ) {
      return;
    }

    const focusables =
      Array.from(
        state.dialog.dialog
          .querySelectorAll(
            [
              "button:not([disabled])",
              "input:not([disabled])",
              "textarea:not([disabled])",
              "[tabindex]:not([tabindex='-1'])"
            ].join(",")
          )
      );

    if (!focusables.length) {
      event.preventDefault();

      return;
    }

    const first =
      focusables[0];

    const last =
      focusables[
        focusables.length - 1
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

  /* =====================================================
     RENAME DIALOG
     ===================================================== */

  function openRenameDialog() {
    if (
      !state.conversationId ||
      state.busy
    ) {
      return false;
    }

    const conversationId =
      state.conversationId;

    const originalTitle =
      state.title;

    /*
     * Menu closes but dialog takes over focus.
     */

    close({
      restoreFocus:
        false
    });

    const {
      overlay,
      dialog
    } =
      createDialog({
        title:
          "Rename conversation"
      });

    const input =
      document.createElement(
        "input"
      );

    input.type =
      "text";

    input.className =
      "history-dialog-input";

    input.value =
      originalTitle;

    input.maxLength =
      CONFIG.maxTitleLength;

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
      "history-dialog-confirm";

    saveButton.textContent =
      "Save";

    actions.append(
      cancelButton,
      saveButton
    );

    dialog.append(
      input,
      actions
    );

    function updateSaveState() {
      const value =
        clean(
          input.value,
          CONFIG.maxTitleLength
        );

      saveButton.disabled =
        !value;

      saveButton.setAttribute(
        "aria-disabled",
        String(!value)
      );
    }

    async function submit() {
      const title =
        clean(
          input.value,
          CONFIG.maxTitleLength
        )
          .replace(
            /\s+/g,
            " "
          );

      if (!title) {
        return;
      }

      input.disabled =
        true;

      cancelButton.disabled =
        true;

      saveButton.disabled =
        true;

      saveButton.classList.add(
        "is-loading"
      );

      try {
        const history =
          historyController();

        if (
          history &&
          typeof history.rename ===
            "function"
        ) {
          await history.rename(
            conversationId,
            title
          );

        } else {
          emit(
            "neyo:history-rename-request",
            {
              conversationId,
              title
            }
          );
        }

        closeDialog({
          restoreFocus:
            false
        });

      } catch (error) {
        console.error(
          "[NEO History Menu] Rename failed:",
          error
        );

        input.disabled =
          false;

        cancelButton.disabled =
          false;

        saveButton.classList.remove(
          "is-loading"
        );

        updateSaveState();

        emit(
          "neyo:history-menu-error",
          {
            action:
              "rename",

            conversationId,

            error
          }
        );
      }
    }

    input.addEventListener(
      "input",
      updateSaveState
    );

    input.addEventListener(
      "keydown",
      event => {
        if (
          event.key ===
          "Enter"
        ) {
          event.preventDefault();

          void submit();
        }
      }
    );

    cancelButton.addEventListener(
      "click",
      () => {
        closeDialog();
      }
    );

    saveButton.addEventListener(
      "click",
      () => {
        void submit();
      }
    );

    overlay.addEventListener(
      "mousedown",
      event => {
        if (
          event.target ===
          overlay
        ) {
          closeDialog();
        }
      }
    );

    updateSaveState();

    requestAnimationFrame(
      () => {
        input.focus();

        input.select();
      }
    );

    return true;
  }

  /* =====================================================
     DELETE DIALOG
     ===================================================== */

  function openDeleteDialog() {
    if (
      !state.conversationId ||
      state.busy
    ) {
      return false;
    }

    const conversationId =
      state.conversationId;

    const conversationTitle =
      state.title;

    close({
      restoreFocus:
        false
    });

    const {
      overlay,
      dialog
    } =
      createDialog({
        title:
          "Delete conversation?",

        description:
          conversationTitle
            ? `"${conversationTitle}" will be permanently deleted.`
            : "This conversation will be permanently deleted."
      });

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
      "history-dialog-confirm danger";

    deleteConfirm.textContent =
      "Delete";

    actions.append(
      cancelButton,
      deleteConfirm
    );

    dialog.appendChild(
      actions
    );

    async function confirmDelete() {
      cancelButton.disabled =
        true;

      deleteConfirm.disabled =
        true;

      deleteConfirm.classList.add(
        "is-loading"
      );

      try {
        const history =
          historyController();

        if (
          history &&
          typeof history.delete ===
            "function"
        ) {
          await history.delete(
            conversationId
          );

        } else {
          emit(
            "neyo:history-delete-request",
            {
              conversationId
            }
          );
        }

        closeDialog({
          restoreFocus:
            false
        });

      } catch (error) {
        console.error(
          "[NEO History Menu] Delete failed:",
          error
        );

        cancelButton.disabled =
          false;

        deleteConfirm.disabled =
          false;

        deleteConfirm.classList.remove(
          "is-loading"
        );

        emit(
          "neyo:history-menu-error",
          {
            action:
              "delete",

            conversationId,

            error
          }
        );
      }
    }

    cancelButton.addEventListener(
      "click",
      () => {
        closeDialog();
      }
    );

    deleteConfirm.addEventListener(
      "click",
      () => {
        void confirmDelete();
      }
    );

    overlay.addEventListener(
      "mousedown",
      event => {
        if (
          event.target ===
          overlay
        ) {
          closeDialog();
        }
      }
    );

    requestAnimationFrame(
      () => {
        deleteConfirm.focus();
      }
    );

    return true;
  }

  /* =====================================================
     SHARE SELECTED CONVERSATION

     Important:
     A user can share a history row that is NOT currently
     open.

     Therefore do NOT blindly call shareConversation() on
     current NeyoChat state.

     Fetch selected conversation first.
     ===================================================== */

  async function shareSelectedConversation() {
    if (
      state.busy ||
      !state.conversationId
    ) {
      return false;
    }

    const conversationId =
      state.conversationId;

    const title =
      state.title;

    setBusy(true);

    try {
      const history =
        historyController();

      let messages = null;

      if (
        history &&
        typeof history.fetchConversation ===
          "function"
      ) {
        const result =
          await history.fetchConversation(
            conversationId
          );

        messages =
          Array.isArray(
            result?.messages
          )
            ? result.messages
            : [];
      }

      /*
       * Preferred direct share API.
       */

      if (
        window.NeyoShare &&
        typeof window.NeyoShare
          .shareConversation ===
          "function"
      ) {
        const result =
          await window.NeyoShare
            .shareConversation({
              messages:
                messages ||
                undefined,

              title
            });

        if (result) {
          close();

          return true;
        }

        /*
         * User may simply have cancelled native share.
         * Close menu without turning cancellation into error.
         */

        close();

        return false;
      }

      /*
       * Event fallback.
       */

      emit(
        "neyo:conversation-share-request",
        {
          conversationId,

          title,

          messages:
            messages ||
            undefined
        }
      );

      close();

      return true;

    } catch (error) {
      console.error(
        "[NEO History Menu] Share failed:",
        error
      );

      setBusy(false);

      emit(
        "neyo:history-menu-error",
        {
          action:
            "share",

          conversationId,

          error
        }
      );

      return false;
    }
  }

  /* =====================================================
     PIN / UNPIN
     ===================================================== */

  async function togglePinned() {
    if (
      state.busy ||
      !state.conversationId
    ) {
      return false;
    }

    const conversationId =
      state.conversationId;

    const nextPinned =
      !state.isPinned;

    setBusy(true);

    try {
      const history =
        historyController();

      if (
        history &&
        typeof history.setPinned ===
          "function"
      ) {
        await history.setPinned(
          conversationId,
          nextPinned
        );

      } else {
        emit(
          "neyo:history-pin-request",
          {
            conversationId,

            pinned:
              nextPinned
          }
        );
      }

      state.isPinned =
        nextPinned;

      close();

      return true;

    } catch (error) {
      console.error(
        "[NEO History Menu] Pin action failed:",
        error
      );

      setBusy(false);

      emit(
        "neyo:history-menu-error",
        {
          action:
            nextPinned
              ? "pin"
              : "unpin",

          conversationId,

          error
        }
      );

      return false;
    }
  }

  /* =====================================================
     ITEM ACTIVATION
     ===================================================== */

  function activateItem(
    item
  ) {
    if (
      !item ||
      state.busy ||
      item.getAttribute(
        "aria-disabled"
      ) === "true"
    ) {
      return false;
    }

    if (
      item ===
      shareButton
    ) {
      void shareSelectedConversation();

      return true;
    }

    if (
      item ===
      pinButton
    ) {
      void togglePinned();

      return true;
    }

    if (
      item ===
      renameButton
    ) {
      openRenameDialog();

      return true;
    }

    if (
      item ===
      deleteButton
    ) {
      openDeleteDialog();

      return true;
    }

    return false;
  }

  /* =====================================================
     CLICK
     ===================================================== */

  menu.addEventListener(
    "click",
    event => {
      const target =
        event.target;

      if (
        !(target instanceof
          Element)
      ) {
        return;
      }

      const item =
        target.closest(
          ".history-popup-item"
        );

      if (
        !item ||
        !menu.contains(item)
      ) {
        return;
      }

      event.preventDefault();

      event.stopPropagation();

      activateItem(
        item
      );
    }
  );

  /* =====================================================
     KEYBOARD
     ===================================================== */

  menu.addEventListener(
    "keydown",
    event => {
      if (!state.open) {
        return;
      }

      switch (
        event.key
      ) {
        case "ArrowDown":
          event.preventDefault();

          focusRelative(1);

          break;

        case "ArrowUp":
          event.preventDefault();

          focusRelative(-1);

          break;

        case "Home":
          event.preventDefault();

          interactiveMenuItems()[0]
            ?.focus?.();

          break;

        case "End": {
          event.preventDefault();

          const items =
            interactiveMenuItems();

          items[
            items.length - 1
          ]?.focus?.();

          break;
        }

        case "Enter":
        case " ":
          event.preventDefault();

          activateItem(
            document.activeElement
          );

          break;

        case "Escape":
          event.preventDefault();

          close();

          break;
      }
    }
  );

  /* =====================================================
     GLOBAL KEYBOARD
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {
      if (
        state.dialog
      ) {
        if (
          event.key ===
          "Escape"
        ) {
          event.preventDefault();

          closeDialog();

          return;
        }

        trapDialogTab(
          event
        );

        return;
      }

      if (
        state.open &&
        event.key ===
          "Escape"
      ) {
        event.preventDefault();

        close();
      }
    },
    true
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
        target instanceof
          Node &&
        menu.contains(
          target
        )
      ) {
        return;
      }

      if (
        state.anchorElement instanceof
          Node &&
        state.anchorElement
          .contains?.(
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
     VIEWPORT CHANGES
     ===================================================== */

  window.addEventListener(
    "resize",
    () => {
      if (state.open) {
        positionMenu();
      }
    }
  );

  window.addEventListener(
    "scroll",
    () => {
      if (state.open) {
        positionMenu();
      }
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
     HISTORY MUTATION COMPLETION

     If an external owner changes/deletes selected item,
     close stale popup.
     ===================================================== */

  window.addEventListener(
    "neyo:history-deleted",
    event => {
      if (
        state.conversationId &&
        event.detail
          ?.conversationId ===
          state.conversationId
      ) {
        close({
          restoreFocus:
            false
        });
      }
    }
  );

  window.addEventListener(
    "neyo:history-renamed",
    event => {
      if (
        event.detail
          ?.conversationId !==
        state.conversationId
      ) {
        return;
      }

      state.title =
        clean(
          event.detail?.title,
          CONFIG.maxTitleLength
        ) ||
        state.title;
    }
  );

  window.addEventListener(
    "neyo:history-pin-change",
    event => {
      if (
        event.detail
          ?.conversationId !==
        state.conversationId
      ) {
        return;
      }

      state.isPinned =
        Boolean(
          event.detail
            ?.pinned
        );

      refreshLabels();
    }
  );

  /* =====================================================
     NEW CHAT / HISTORY OPEN

     Popup should never survive navigation.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      close({
        restoreFocus:
          false
      });

      closeDialog({
        restoreFocus:
          false
      });
    }
  );

  window.addEventListener(
    "neyo:history-opened",
    () => {
      close({
        restoreFocus:
          false
      });
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

      open,

      close,

      position:
        positionMenu,

      setBusy,

      isOpen() {
        return state.open;
      },

      isBusy() {
        return state.busy;
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

          busy:
            state.busy,

          conversationId:
            state.conversationId,

          title:
            state.title,

          isPinned:
            state.isPinned,

          dialogOpen:
            Boolean(
              state.dialog
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

  hydrateMenuAccessibility();

  menu.classList.remove(
    "show",
    "open"
  );

  menu.style.display =
    "none";

  refreshLabels();

  setBusy(false);

  emit(
    "neyo:history-menu-ready",
    {
      version:
        VERSION,

      active:
        true,

      keyboard:
        true,

      busyStateSafe:
        true
    }
  );
})();
