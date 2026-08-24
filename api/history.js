/*
=========================================================
NEO — HISTORY
Production v3 — Baseline Safe

Baseline:
- Old working neo.js history behavior
- Current /api/history backend contract
- Current NeyoChat canonical conversation state
- Current history-menu.js UI ownership

Owns:
- Initial history load
- History list state
- History list DOM
- Conversation opening
- Active history row
- Rename persistence
- Delete persistence
- Pin / unpin persistence
- Stale-open protection
- History loading / empty / error states
- History menu request events

Does NOT own:
- History popup/menu UI
- Rename modal
- Delete confirmation modal
- Message DOM rendering
- Chat conversation state
- Sidebar implementation
- New Chat UI
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-history-production-v3";

  if (
    window.NeyoHistory
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     DOM
     ===================================================== */

  const historyList =
    document.getElementById(
      "historyList"
    );

  if (!historyList) {
    console.warn(
      "[NEO History] #historyList is missing."
    );

    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      endpoint:
        "/api/history",

      maxTitleLength:
        100,

      maxConversationIdLength:
        160,

      defaultTitle:
        "New conversation"
    });

  /* =====================================================
     STATE
     ===================================================== */

  let conversations = [];

  let activeConversationId =
    null;

  let loadingPromise =
    null;

  let loadingSerial =
    0;

  let openSerial =
    0;

  let openController =
    null;

  let initialized =
    false;

  let lastLoadError =
    null;

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
      CONFIG
        .maxConversationIdLength
    );
  }

  function cleanTitle(value) {
    return (
      clean(
        value,
        CONFIG.maxTitleLength
      )
        .replace(
          /\s+/g,
          " "
        ) ||
      CONFIG.defaultTitle
    );
  }

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  function cloneConversation(
    item
  ) {
    return item
      ? {
          ...item
        }
      : null;
  }

  function cloneConversations() {
    return conversations.map(
      cloneConversation
    );
  }

  /* =====================================================
     NORMALIZE CONVERSATION
     ===================================================== */

  function normalizeConversation(
    item
  ) {
    if (
      !item ||
      typeof item !==
        "object"
    ) {
      return null;
    }

    const id =
      cleanId(
        item.id ||
        item.conversationId ||
        item.conversation_id
      );

    if (!id) {
      return null;
    }

    return {
      ...item,

      id,

      title:
        cleanTitle(
          item.title
        ),

      is_pinned:
        Boolean(
          item.is_pinned ??
          item.isPinned ??
          item.pinned
        )
    };
  }

  /* =====================================================
     JSON RESPONSE
     ===================================================== */

  async function readJson(
    response
  ) {
    const raw =
      await response.text();

    let data = {};

    if (raw) {
      try {
        data =
          JSON.parse(raw);
      } catch {
        data = {};
      }
    }

    if (!response.ok) {
      const message =
        clean(
          data?.error ||
          data?.message ||
          raw ||
          `Request failed (${response.status})`,
          1000
        );

      const error =
        new Error(
          message ||
          `Request failed (${response.status})`
        );

      error.status =
        response.status;

      error.data =
        data;

      throw error;
    }

    return data;
  }

  /* =====================================================
     LOADING UI
     ===================================================== */

  function renderLoading() {
    historyList
      .replaceChildren();

    const loading =
      document.createElement(
        "div"
      );

    loading.className =
      "history-loading";

    loading.setAttribute(
      "aria-hidden",
      "true"
    );

    for (
      let index = 0;
      index < 3;
      index += 1
    ) {
      const row =
        document.createElement(
          "div"
        );

      row.className =
        "history-skeleton-row";

      const line =
        document.createElement(
          "div"
        );

      line.className =
        "history-skeleton-line";

      row.appendChild(
        line
      );

      loading.appendChild(
        row
      );
    }

    historyList.appendChild(
      loading
    );
  }

  /* =====================================================
     EMPTY UI
     ===================================================== */

  function renderEmpty() {
    historyList
      .replaceChildren();

    const empty =
      document.createElement(
        "div"
      );

    empty.className =
      "history-empty";

    empty.textContent =
      "No recent chats";

    historyList.appendChild(
      empty
    );
  }

  /* =====================================================
     ERROR UI
     ===================================================== */

  function renderError() {
    historyList
      .replaceChildren();

    const error =
      document.createElement(
        "div"
      );

    error.className =
      "history-error-state";

    error.setAttribute(
      "role",
      "status"
    );

    error.textContent =
      "Unable to load recent chats";

    historyList.appendChild(
      error
    );
  }

  /* =====================================================
     MENU EVENT
     ===================================================== */

  function requestMenu(
    item,
    options = {}
  ) {
    emit(
      "neyo:history-menu-request",
      {
        conversationId:
          item.id,

        title:
          item.title,

        isPinned:
          Boolean(
            item.is_pinned
          ),

        ...options
      }
    );
  }

  /* =====================================================
     CREATE HISTORY ROW
     ===================================================== */

  function createHistoryRow(
    item
  ) {
    const row =
      document.createElement(
        "div"
      );

    row.className =
      "history-item-wrapper";

    row.dataset.id =
      item.id;

    row.dataset
      .conversationId =
      item.id;

    /* -----------------------------------------------
       OPEN BUTTON
       ----------------------------------------------- */

    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    /*
     * Preserve main old class.
     */

    button.className =
      "history-item";

    button.dataset
      .conversationId =
      item.id;

    button.title =
      item.title;

    button.setAttribute(
      "aria-label",
      `Open ${item.title}`
    );

    button.classList.toggle(
      "active",
      item.id ===
        activeConversationId
    );

    /* -----------------------------------------------
       TITLE
       ----------------------------------------------- */

    const title =
      document.createElement(
        "span"
      );

    title.className =
      "history-item-title";

    title.textContent =
      item.title;

    button.appendChild(
      title
    );

    /* -----------------------------------------------
       PIN
       ----------------------------------------------- */

    if (
      item.is_pinned
    ) {
      const pin =
        document.createElement(
          "span"
        );

      pin.className =
        "history-pin-icon";

      pin.setAttribute(
        "aria-label",
        "Pinned"
      );

      const icon =
        document.createElement(
          "i"
        );

      icon.setAttribute(
        "data-lucide",
        "pin"
      );

      icon.setAttribute(
        "width",
        "12"
      );

      icon.setAttribute(
        "height",
        "12"
      );

      icon.setAttribute(
        "aria-hidden",
        "true"
      );

      pin.appendChild(
        icon
      );

      button.appendChild(
        pin
      );
    }

    button.addEventListener(
      "click",
      () => {
        void openConversation(
          item.id
        );
      }
    );

    /* -----------------------------------------------
       MENU BUTTON

       Preserve old history-action-btn and new
       history-three-dot class together.
       ----------------------------------------------- */

    const actions =
      document.createElement(
        "div"
      );

    actions.className =
      "history-item-actions";

    const menuButton =
      document.createElement(
        "button"
      );

    menuButton.type =
      "button";

    menuButton.className =
      "history-action-btn history-three-dot";

    menuButton.setAttribute(
      "aria-label",
      "Conversation options"
    );

    const moreIcon =
      document.createElement(
        "i"
      );

    moreIcon.setAttribute(
      "data-lucide",
      "more-horizontal"
    );

    moreIcon.setAttribute(
      "size",
      "14"
    );

    moreIcon.setAttribute(
      "aria-hidden",
      "true"
    );

    menuButton.appendChild(
      moreIcon
    );

    menuButton.addEventListener(
      "click",
      event => {
        event.preventDefault();

        event.stopPropagation();

        requestMenu(
          item,
          {
            anchorElement:
              menuButton
          }
        );
      }
    );

    actions.appendChild(
      menuButton
    );

    row.append(
      button,
      actions
    );

    /* -----------------------------------------------
       RIGHT CLICK
       ----------------------------------------------- */

    row.addEventListener(
      "contextmenu",
      event => {
        event.preventDefault();

        event.stopPropagation();

        requestMenu(
          item,
          {
            clientX:
              event.clientX,

            clientY:
              event.clientY
          }
        );
      }
    );

    return row;
  }

  /* =====================================================
     RENDER
     ===================================================== */

  function renderHistory() {
    historyList
      .replaceChildren();

    if (
      conversations.length ===
      0
    ) {
      renderEmpty();

      emit(
        "neyo:history-rendered",
        {
          conversations: [],
          count: 0
        }
      );

      return true;
    }

    const fragment =
      document.createDocumentFragment();

    for (
      const item
      of conversations
    ) {
      fragment.appendChild(
        createHistoryRow(
          item
        )
      );
    }

    historyList.appendChild(
      fragment
    );

    refreshIcons();

    emit(
      "neyo:history-rendered",
      {
        conversations:
          cloneConversations(),

        count:
          conversations.length,

        activeConversationId
      }
    );

    return true;
  }

  /* =====================================================
     LIST HISTORY
     ===================================================== */

  async function performLoadHistory({
    silent = false
  } = {}) {
    const serial =
      ++loadingSerial;

    if (!silent) {
      renderLoading();
    }

    try {
      /*
       * Current backend explicitly supports:
       * GET /api/history = list.
       */

      const response =
        await fetch(
          CONFIG.endpoint,
          {
            method:
              "GET",

            credentials:
              "include",

            cache:
              "no-store",

            headers: {
              Accept:
                "application/json"
            }
          }
        );

      const data =
        await readJson(
          response
        );

      /*
       * A newer forced load won.
       */

      if (
        serial !==
        loadingSerial
      ) {
        return cloneConversations();
      }

      const raw =
        Array.isArray(
          data?.conversations
        )
          ? data.conversations
          : Array.isArray(
              data?.history
            )
            ? data.history
            : [];

      conversations =
        raw
          .map(
            normalizeConversation
          )
          .filter(Boolean);

      lastLoadError =
        null;

      renderHistory();

      emit(
        "neyo:history-loaded",
        {
          conversations:
            cloneConversations(),

          count:
            conversations.length
        }
      );

      return cloneConversations();

    } catch (error) {
      if (
        serial !==
        loadingSerial
      ) {
        return cloneConversations();
      }

      lastLoadError =
        error;

      /*
       * Silent refresh should not destroy an already useful
       * history list just because background refresh failed.
       */

      if (
        !silent ||
        conversations.length === 0
      ) {
        renderError();
      }

      emit(
        "neyo:history-error",
        {
          error,
          action:
            "list"
        }
      );

      throw error;
    }
  }

  /* =====================================================
     LOAD HISTORY

     Coalesce simultaneous requests.
     ===================================================== */

  function loadHistory(
    options = {}
  ) {
    const force =
      Boolean(
        options.force
      );

    if (
      loadingPromise &&
      !force
    ) {
      return loadingPromise;
    }

    if (force) {
      loadingSerial += 1;
    }

    const promise =
      performLoadHistory(
        options
      );

    loadingPromise =
      promise;

    return promise.finally(
      () => {
        if (
          loadingPromise ===
          promise
        ) {
          loadingPromise =
            null;
        }
      }
    );
  }

  /* =====================================================
     FETCH ONE CONVERSATION
     ===================================================== */

  async function fetchConversation(
    conversationId,
    {
      signal
    } = {}
  ) {
    const id =
      cleanId(
        conversationId
      );

    if (!id) {
      return null;
    }

    const response =
      await fetch(
        CONFIG.endpoint,
        {
          method:
            "POST",

          credentials:
            "include",

          cache:
            "no-store",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          },

          body:
            JSON.stringify({
              action:
                "get",

              conversationId:
                id
            }),

          signal
        }
      );

    const data =
      await readJson(
        response
      );

    return {
      id,

      conversation:
        data?.conversation &&
        typeof data.conversation ===
          "object"
          ? {
              ...data.conversation
            }
          : null,

      /*
       * Critical:
       * do not map to only role/content.
       *
       * Preserve:
       * - attachment metadata
       * - sources
       * - IDs
       * - timestamps
       * - future fields
       */

      messages:
        Array.isArray(
          data?.messages
        )
          ? data.messages.map(
              message =>
                message &&
                typeof message ===
                  "object"
                  ? {
                      ...message,

                      attachments:
                        Array.isArray(
                          message.attachments
                        )
                          ? message.attachments.map(
                              attachment => ({
                                ...attachment
                              })
                            )
                          : message.attachments,

                      sources:
                        Array.isArray(
                          message.sources
                        )
                          ? message.sources.map(
                              source => ({
                                ...source
                              })
                            )
                          : message.sources
                    }
                  : message
            )
          : []
    };
  }

  /* =====================================================
     MOBILE SIDEBAR CLOSE REQUEST

     sidebar.js remains the actual sidebar owner.
     ===================================================== */

  function requestMobileSidebarClose() {
    if (
      window.innerWidth >=
      768
    ) {
      return;
    }

    emit(
      "neyo:sidebar-close-request",
      {
        reason:
          "conversation-open"
      }
    );

    /*
     * Compatibility aliases while sidebar migration is
     * still incomplete.
     */

    emit(
      "neyo:sidebar-collapse-request",
      {
        reason:
          "conversation-open"
      }
    );
  }

  /* =====================================================
     OPEN CONVERSATION

     Abort + serial guard prevents:
     Click A → click B → slow A overwriting B.
     ===================================================== */

  async function openConversation(
    conversationId
  ) {
    const id =
      cleanId(
        conversationId
      );

    if (!id) {
      return null;
    }

    /*
     * Re-clicking currently active conversation should not
     * issue another network request.
     */

    if (
      id ===
        activeConversationId &&
      window.NeyoChat
        ?.getConversationId
        ?.() === id
    ) {
      requestMobileSidebarClose();

      return {
        id,

        messages:
          window.NeyoChat
            ?.getConversation
            ?.() ||
          []
      };
    }

    const serial =
      ++openSerial;

    /*
     * Stop previous history fetch immediately.
     */

    try {
      openController
        ?.abort(
          "conversation-switch"
        );
    } catch {
      try {
        openController
          ?.abort();
      } catch {}
    }

    const controller =
      new AbortController();

    openController =
      controller;

    emit(
      "neyo:history-opening",
      {
        conversationId:
          id
      }
    );

    try {
      const result =
        await fetchConversation(
          id,
          {
            signal:
              controller.signal
          }
        );

      if (
        controller.signal
          .aborted ||
        serial !==
          openSerial ||
        !result
      ) {
        return null;
      }

      activeConversationId =
        id;

      renderHistory();

      /*
       * Canonical ownership boundary:
       *
       * history.js fetches.
       * chat.js receives and owns conversation.
       * messages.js renders.
       */

      emit(
        "neyo:conversation-loaded",
        {
          conversationId:
            id,

          messages:
            result.messages,

          conversation:
            result.conversation
        }
      );

      emit(
        "neyo:history-opened",
        {
          conversationId:
            id,

          conversation:
            result.conversation,

          messageCount:
            result.messages.length
        }
      );

      requestMobileSidebarClose();

      return result;

    } catch (error) {
      if (
        controller.signal
          .aborted ||
        error?.name ===
          "AbortError"
      ) {
        return null;
      }

      if (
        serial ===
        openSerial
      ) {
        emit(
          "neyo:history-error",
          {
            error,

            action:
              "open",

            conversationId:
              id
          }
        );
      }

      throw error;

    } finally {
      if (
        openController ===
        controller
      ) {
        openController =
          null;
      }
    }
  }

  /* =====================================================
     ACTION REQUEST
     ===================================================== */

  async function performAction(
    action,
    conversationId,
    payload = {}
  ) {
    const id =
      cleanId(
        conversationId
      );

    if (!id) {
      return null;
    }

    const response =
      await fetch(
        CONFIG.endpoint,
        {
          method:
            "POST",

          credentials:
            "include",

          cache:
            "no-store",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          },

          body:
            JSON.stringify({
              action,

              conversationId:
                id,

              ...payload
            })
        }
      );

    return readJson(
      response
    );
  }

  /* =====================================================
     RENAME

     Server first → local update.
     No destructive skeleton reload/flicker.
     ===================================================== */

  async function renameConversation(
    conversationId,
    title
  ) {
    const id =
      cleanId(
        conversationId
      );

    const nextTitle =
      clean(
        title,
        CONFIG.maxTitleLength
      )
        .replace(
          /\s+/g,
          " "
        );

    if (
      !id ||
      !nextTitle
    ) {
      return false;
    }

    const existing =
      conversations.find(
        item =>
          item.id === id
      );

    if (
      existing &&
      existing.title ===
        nextTitle
    ) {
      return true;
    }

    await performAction(
      "rename",
      id,
      {
        title:
          nextTitle
      }
    );

    const index =
      conversations.findIndex(
        item =>
          item.id === id
      );

    if (index >= 0) {
      conversations[index] = {
        ...conversations[index],

        title:
          nextTitle
      };

      renderHistory();
    }

    emit(
      "neyo:history-renamed",
      {
        conversationId:
          id,

        title:
          nextTitle
      }
    );

    return true;
  }

  /* =====================================================
     DELETE
     ===================================================== */

  async function deleteConversation(
    conversationId
  ) {
    const id =
      cleanId(
        conversationId
      );

    if (!id) {
      return false;
    }

    await performAction(
      "delete",
      id
    );

    /*
     * Invalidate an in-flight open for this conversation.
     */

    if (
      activeConversationId ===
      id
    ) {
      openSerial += 1;

      try {
        openController
          ?.abort(
            "conversation-deleted"
          );
      } catch {
        try {
          openController
            ?.abort();
        } catch {}
      }

      activeConversationId =
        null;
    }

    conversations =
      conversations.filter(
        item =>
          item.id !== id
      );

    renderHistory();

    /*
     * Runtime/new-chat coordinator listens and returns to
     * clean chat only when deleted conversation is active.
     */

    emit(
      "neyo:history-deleted",
      {
        conversationId:
          id
      }
    );

    emit(
      "neyo:active-conversation-deleted",
      {
        conversationId:
          id
      }
    );

    return true;
  }

  /* =====================================================
     PIN / UNPIN
     ===================================================== */

  async function setPinned(
    conversationId,
    pinned
  ) {
    const id =
      cleanId(
        conversationId
      );

    if (!id) {
      return false;
    }

    const value =
      Boolean(
        pinned
      );

    await performAction(
      value
        ? "pin"
        : "unpin",
      id
    );

    const index =
      conversations.findIndex(
        item =>
          item.id === id
      );

    if (index >= 0) {
      conversations[index] = {
        ...conversations[index],

        is_pinned:
          value
      };

      /*
       * Keep backend order unless server specifically
       * returns a refreshed ordering later.
       */

      renderHistory();
    }

    emit(
      "neyo:history-pin-change",
      {
        conversationId:
          id,

        pinned:
          value
      }
    );

    return true;
  }

  /* =====================================================
     ACTIVE CONVERSATION
     ===================================================== */

  function setActiveConversation(
    conversationId
  ) {
    activeConversationId =
      cleanId(
        conversationId
      ) ||
      null;

    renderHistory();

    emit(
      "neyo:history-active-change",
      {
        conversationId:
          activeConversationId
      }
    );

    return true;
  }

  /* =====================================================
     CHAT STATE SYNC

     Canonical chat owner can update active ID after:
     - server creates new conversation
     - history load
     - new chat
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state",
    event => {
      const detail =
        event.detail ||
        {};

      if (
        !(
          "conversationId"
          in detail
        )
      ) {
        return;
      }

      const nextId =
        cleanId(
          detail.conversationId
        ) ||
        null;

      if (
        nextId ===
        activeConversationId
      ) {
        return;
      }

      activeConversationId =
        nextId;

      renderHistory();
    }
  );

  /* =====================================================
     NEW CHAT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      activeConversationId =
        null;

      /*
       * Cancel stale history conversation fetch.
       */

      openSerial += 1;

      try {
        openController
          ?.abort(
            "new-chat"
          );
      } catch {
        try {
          openController
            ?.abort();
        } catch {}
      }

      openController =
        null;

      renderHistory();
    }
  );

  /* =====================================================
     LOAD REQUEST

     chat.js requests refresh after successful normal reply.
     Use silent mode to avoid sidebar skeleton flashing after
     every response.
     ===================================================== */

  window.addEventListener(
    "neyo:history-load-request",
    event => {
      void loadHistory({
        silent:
          initialized,

        force:
          Boolean(
            event.detail
              ?.force
          )
      }).catch(
        error => {
          console.warn(
            "[NEO History] Load failed:",
            error
          );
        }
      );
    }
  );

  /* =====================================================
     OPEN REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:conversation-open-request",
    event => {
      void openConversation(
        event.detail
          ?.conversationId
      ).catch(
        error => {
          console.warn(
            "[NEO History] Conversation open failed:",
            error
          );
        }
      );
    }
  );

  /* =====================================================
     ACTIVE SET
     ===================================================== */

  window.addEventListener(
    "neyo:history-active-set",
    event => {
      setActiveConversation(
        event.detail
          ?.conversationId
      );
    }
  );

  /* =====================================================
     RENAME REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:history-rename-request",
    event => {
      void renameConversation(
        event.detail
          ?.conversationId,

        event.detail
          ?.title
      ).catch(
        error => {
          emit(
            "neyo:history-error",
            {
              error,

              action:
                "rename",

              conversationId:
                event.detail
                  ?.conversationId
            }
          );
        }
      );
    }
  );

  /* =====================================================
     DELETE REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:history-delete-request",
    event => {
      void deleteConversation(
        event.detail
          ?.conversationId
      ).catch(
        error => {
          emit(
            "neyo:history-error",
            {
              error,

              action:
                "delete",

              conversationId:
                event.detail
                  ?.conversationId
            }
          );
        }
      );
    }
  );

  /* =====================================================
     PIN REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:history-pin-request",
    event => {
      void setPinned(
        event.detail
          ?.conversationId,

        event.detail
          ?.pinned
      ).catch(
        error => {
          emit(
            "neyo:history-error",
            {
              error,

              action:
                "pin",

              conversationId:
                event.detail
                  ?.conversationId
            }
          );
        }
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

      load:
        loadHistory,

      loadHistory,

      render:
        renderHistory,

      open:
        openConversation,

      openConversation,

      fetchConversation,

      rename:
        renameConversation,

      delete:
        deleteConversation,

      setPinned,

      setActive:
        setActiveConversation,

      getActive() {
        return (
          activeConversationId
        );
      },

      getConversations() {
        return cloneConversations();
      },

      getById(id) {
        const target =
          cleanId(id);

        const item =
          conversations.find(
            conversation =>
              conversation.id ===
              target
          );

        return cloneConversation(
          item
        );
      },

      isLoading() {
        return Boolean(
          loadingPromise
        );
      },

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          initialized,

          loading:
            Boolean(
              loadingPromise
            ),

          opening:
            Boolean(
              openController
            ),

          activeConversationId,

          count:
            conversations.length,

          hasError:
            Boolean(
              lastLoadError
            )
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoHistory",
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
     INITIAL LOAD

     Important regression fix:
     old working NEO loaded history automatically.
     Do not wait for a future app-init event.
     ===================================================== */

  queueMicrotask(
    () => {
      void loadHistory()
        .catch(
          error => {
            console.warn(
              "[NEO History] Initial history load failed:",
              error
            );
          }
        )
        .finally(
          () => {
            initialized =
              true;

            emit(
              "neyo:history-ready",
              {
                version:
                  VERSION,

                active:
                  true,

                initialLoadAttempted:
                  true
              }
            );
          }
        );
    }
  );
})();
