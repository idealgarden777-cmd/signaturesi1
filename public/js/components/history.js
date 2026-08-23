/*
=========================================================
NEYO — HISTORY
FINAL PRODUCTION MIXER v7

FILE:
public/js/components/history.js

OWNS
---------------------------------------------------------
- /api/history communication
- History list loading
- History list rendering
- Conversation opening
- Active conversation highlight
- Stale-open protection
- Rename persistence
- Delete persistence
- Pin / unpin persistence
- Local history cache
- Loading / empty / error states
- History lifecycle events
- Public history API

DOES NOT OWN
---------------------------------------------------------
- Chat messages DOM
- Conversation message state
- /api/chat
- Send / Enter
- Rename modal UI
- Delete confirmation UI
- Popup positioning
- Share business logic
- Sidebar open / close
- neo.js internals

ARCHITECTURE
---------------------------------------------------------

history row click
      ↓
history.js
      ↓
POST /api/history { action: "get" }
      ↓
neyo:conversation-loaded
      ↓
chat.js
      ↓
messages.js

Chat response
      ↓
neyo:history-refresh-request
      ↓
history.js
      ↓
GET /api/history

MIGRATION RULE
---------------------------------------------------------
This controller is authoritative even while neo.js is
physically loaded.

After neo.js removal this file continues unchanged.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-history-final-v7";

  if (
    window.NeyoHistory
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      endpoint:
        "/api/history",

      requestTimeoutMs:
        60_000,

      maxTitleLength:
        100,

      maxIdLength:
        256,

      skeletonRows:
        3,

      /*
       * Prevent accidental duplicate row opens
       * caused by legacy/delegated listeners.
       */

      duplicateOpenWindowMs:
        180
    });

  /* =====================================================
     DOM
     ===================================================== */

  const historyList =
    document.getElementById(
      "historyList"
    );

  const active =
    Boolean(
      historyList
    );

  /* =====================================================
     LEGACY TELEMETRY

     Informational ONLY.
     neo.js never disables this controller.
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

  let conversations =
    [];

  let activeConversationId =
    null;

  let loadingPromise =
    null;

  let openSerial =
    0;

  let activeOpenController =
    null;

  let lastOpenAt =
    0;

  let lastOpenId =
    null;

  const state = {
    loaded:
      false,

    loading:
      false,

    opening:
      false,

    lastLoadedAt:
      null,

    lastOpenedAt:
      null,

    lastMutationAt:
      null,

    loadCount:
      0,

    openCount:
      0,

    renameCount:
      0,

    deleteCount:
      0,

    pinCount:
      0,

    lastError:
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
     BASIC HELPERS
     ===================================================== */

  function clean(
    value,
    max =
      CONFIG.maxTitleLength
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
      CONFIG.maxIdLength
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

    const title =
      clean(
        item.title ||
        "New conversation"
      ) ||
      "New conversation";

    return {
      ...item,

      id,

      conversationId:
        id,

      title,

      is_pinned:
        Boolean(
          item.is_pinned ??
          item.isPinned ??
          item.pinned
        ),

      isPinned:
        Boolean(
          item.is_pinned ??
          item.isPinned ??
          item.pinned
        )
    };
  }

  /* =====================================================
     NORMALIZE LIST

     Backend ordering is preserved.

     We do NOT silently reorder history because backend
     may already have its own pinned / updated ordering.
     ===================================================== */

  function normalizeConversationList(
    values
  ) {
    if (
      !Array.isArray(
        values
      )
    ) {
      return [];
    }

    const result =
      [];

    const seen =
      new Set();

    for (
      const raw
      of values
    ) {
      const item =
        normalizeConversation(
          raw
        );

      if (
        !item ||
        seen.has(
          item.id
        )
      ) {
        continue;
      }

      seen.add(
        item.id
      );

      result.push(
        item
      );
    }

    return result;
  }

  /* =====================================================
     RESPONSE
     ===================================================== */

  async function readJson(
    response
  ) {
    const raw =
      await response.text();

    let data =
      {};

    if (raw) {
      try {
        data =
          JSON.parse(
            raw
          );

      } catch {
        data =
          {};
      }
    }

    if (
      !response.ok
    ) {
      const message =
        clean(
          data?.error ||
          data?.message ||
          raw,
          1500
        ) ||
        `Request failed (${response.status}).`;

      const error =
        new Error(
          message
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
     FETCH WITH TIMEOUT
     ===================================================== */

  async function fetchWithTimeout(
    url,
    options = {},
    {
      timeoutMs =
        CONFIG.requestTimeoutMs,

      controller:
        externalController =
        null
    } = {}
  ) {
    const controller =
      externalController ||
      new AbortController();

    const timeout =
      window.setTimeout(
        () => {
          try {
            controller.abort(
              "timeout"
            );

          } catch {
            try {
              controller.abort();
            } catch {}
          }
        },
        timeoutMs
      );

    try {
      return await fetch(
        url,
        {
          ...options,

          signal:
            controller.signal
        }
      );

    } finally {
      window.clearTimeout(
        timeout
      );
    }
  }

  /* =====================================================
     ERROR
     ===================================================== */

  function handleError(
    error,
    detail = {}
  ) {
    state.lastError =
      error?.message ||
      "History request failed.";

    emit(
      "neyo:history-error",
      {
        error,

        message:
          state.lastError,

        ...detail
      }
    );

    return error;
  }

  /* =====================================================
     LOADING UI
     ===================================================== */

  function renderLoading() {
    if (
      !active
    ) {
      return false;
    }

    const root =
      document.createElement(
        "div"
      );

    root.className =
      "history-loading";

    root.setAttribute(
      "aria-hidden",
      "true"
    );

    root.setAttribute(
      "aria-busy",
      "true"
    );

    for (
      let index = 0;
      index <
        CONFIG.skeletonRows;
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

      root.appendChild(
        row
      );
    }

    historyList
      .replaceChildren(
        root
      );

    historyList.setAttribute(
      "aria-busy",
      "true"
    );

    return true;
  }

  /* =====================================================
     EMPTY
     ===================================================== */

  function renderEmpty() {
    if (
      !active
    ) {
      return false;
    }

    historyList
      .replaceChildren();

    historyList.removeAttribute(
      "aria-busy"
    );

    emit(
      "neyo:history-empty"
    );

    return true;
  }

  /* =====================================================
     ACTIVE UI
     ===================================================== */

  function applyActiveState(
    button,
    item
  ) {
    const isActive =
      Boolean(
        activeConversationId &&
        item.id ===
          activeConversationId
      );

    button.classList.toggle(
      "active",
      isActive
    );

    button.classList.toggle(
      "is-active",
      isActive
    );

    if (
      isActive
    ) {
      button.setAttribute(
        "aria-current",
        "page"
      );

    } else {
      button.removeAttribute(
        "aria-current"
      );
    }
  }

  /* =====================================================
     OPEN BUTTON CLICK

     stopImmediatePropagation protects against legacy
     delegated click handlers while neo.js still exists.
     ===================================================== */

  function handleOpenButtonClick(
    event,
    item
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    void openConversation(
      item.id,
      {
        source:
          "history-row"
      }
    );
  }

  /* =====================================================
     HISTORY MENU REQUEST
     ===================================================== */

  function requestMenu(
    item,
    detail = {}
  ) {
    emit(
      "neyo:history-menu-request",
      {
        conversationId:
          item.id,

        id:
          item.id,

        title:
          item.title,

        isPinned:
          item.is_pinned,

        pinned:
          item.is_pinned,

        ...detail
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

    row.dataset.pinned =
      String(
        item.is_pinned
      );

    /* =================================================
       MAIN OPEN BUTTON
       ================================================= */

    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.className =
      "history-item";

    button.dataset
      .conversationId =
      item.id;

    button.title =
      item.title;

    button.setAttribute(
      "aria-label",
      `Open conversation: ${item.title}`
    );

    applyActiveState(
      button,
      item
    );

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

    /* =================================================
       PIN INDICATOR
       ================================================= */

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

      pin.title =
        "Pinned";

      pin.innerHTML = `
        <i
          data-lucide="pin"
          width="12"
          height="12"
          aria-hidden="true"
        ></i>
      `;

      button.appendChild(
        pin
      );
    }

    button.addEventListener(
      "click",
      event =>
        handleOpenButtonClick(
          event,
          item
        )
    );

    /* =================================================
       THREE-DOT MENU BUTTON

       Multiple compatibility classes intentionally kept.
       ================================================= */

    const menuButton =
      document.createElement(
        "button"
      );

    menuButton.type =
      "button";

    menuButton.className =
      [
        "history-three-dot",
        "history-action-btn"
      ].join(" ");

    menuButton.dataset
      .conversationId =
      item.id;

    menuButton.dataset
      .historyAction =
      "menu";

    menuButton.setAttribute(
      "aria-label",
      `Conversation options for ${item.title}`
    );

    menuButton.setAttribute(
      "aria-haspopup",
      "menu"
    );

    menuButton.setAttribute(
      "aria-expanded",
      "false"
    );

    menuButton.title =
      "Conversation options";

    menuButton.innerHTML = `
      <i
        data-lucide="more-vertical"
        width="16"
        height="16"
        aria-hidden="true"
      ></i>
    `;

    menuButton.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        requestMenu(
          item,
          {
            anchorElement:
              menuButton,

            source:
              "button"
          }
        );
      }
    );

    /* =================================================
       CONTEXT MENU
       ================================================= */

    row.addEventListener(
      "contextmenu",
      event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        requestMenu(
          item,
          {
            clientX:
              event.clientX,

            clientY:
              event.clientY,

            source:
              "contextmenu"
          }
        );
      }
    );

    row.append(
      button,
      menuButton
    );

    return row;
  }

  /* =====================================================
     RENDER HISTORY
     ===================================================== */

  function renderHistory() {
    if (
      !active
    ) {
      return false;
    }

    historyList
      .replaceChildren();

    historyList.removeAttribute(
      "aria-busy"
    );

    if (
      conversations.length ===
      0
    ) {
      emit(
        "neyo:history-rendered",
        {
          conversations:
            [],

          count:
            0,

          activeConversationId
        }
      );

      return true;
    }

    const fragment =
      document
        .createDocumentFragment();

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
          getConversations(),

        count:
          conversations.length,

        activeConversationId
      }
    );

    return true;
  }

  /* =====================================================
     UPDATE ONE LOCAL ITEM
     ===================================================== */

  function updateLocalConversation(
    id,
    values
  ) {
    const index =
      conversations.findIndex(
        item =>
          item.id === id
      );

    if (
      index < 0
    ) {
      return false;
    }

    conversations[index] =
      normalizeConversation({
        ...conversations[index],
        ...values,
        id
      }) ||
      conversations[index];

    return true;
  }

  /* =====================================================
     REMOVE LOCAL ITEM
     ===================================================== */

  function removeLocalConversation(
    id
  ) {
    const before =
      conversations.length;

    conversations =
      conversations.filter(
        item =>
          item.id !== id
      );

    return (
      conversations.length !==
      before
    );
  }

  /* =====================================================
     LOAD HISTORY
     ===================================================== */

  async function performLoadHistory({
    showLoading =
      true
  } = {}) {
    if (
      !active
    ) {
      return [];
    }

    state.loading =
      true;

    state.lastError =
      null;

    if (
      showLoading &&
      !state.loaded
    ) {
      renderLoading();
    }

    emit(
      "neyo:history-loading",
      {
        showLoading
      }
    );

    try {
      const response =
        await fetchWithTimeout(
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
                "application/json",

              "X-Neyo-History-Client":
                VERSION
            }
          }
        );

      const data =
        await readJson(
          response
        );

      conversations =
        normalizeConversationList(
          data?.conversations
        );

      state.loaded =
        true;

      state.loading =
        false;

      state.lastLoadedAt =
        Date.now();

      state.loadCount +=
        1;

      renderHistory();

      emit(
        "neyo:history-loaded",
        {
          conversations:
            getConversations(),

          count:
            conversations.length,

          activeConversationId
        }
      );

      return getConversations();

    } catch (
      error
    ) {
      state.loading =
        false;

      handleError(
        error,
        {
          operation:
            "load"
        }
      );

      /*
       * First load failed:
       * remove the permanent skeleton.

       * Later refresh failed:
       * retain currently usable history DOM/cache.
       */

      if (
        !state.loaded
      ) {
        renderEmpty();
      }

      throw error;
    }
  }

  async function loadHistory(
    options = {}
  ) {
    if (
      !active
    ) {
      return [];
    }

    /*
     * Deduplicate simultaneous refresh events.
     *
     * chat.js currently emits both modern
     * neyo:history-refresh-request and compatibility
     * neyo:history-load-request. They resolve to one GET.
     */

    if (
      loadingPromise
    ) {
      return loadingPromise;
    }

    loadingPromise =
      performLoadHistory(
        options
      );

    try {
      return await loadingPromise;

    } finally {
      loadingPromise =
        null;
    }
  }

  /* =====================================================
     FETCH ONE CONVERSATION
     ===================================================== */

  async function fetchConversation(
    conversationId,
    {
      signal =
        null
    } = {}
  ) {
    if (
      !active
    ) {
      return null;
    }

    const id =
      cleanId(
        conversationId
      );

    if (!id) {
      return null;
    }

    const controller =
      signal
        ? null
        : new AbortController();

    const response =
      await fetchWithTimeout(
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
              "application/json",

            "X-Neyo-History-Client":
              VERSION
          },

          body:
            JSON.stringify({
              action:
                "get",

              conversationId:
                id
            }),

          ...(signal
            ? {
                signal
              }
            : {})
        },
        {
          controller:
            controller ||
            undefined
        }
      );

    const data =
      await readJson(
        response
      );

    /*
     * CRITICAL:
     *
     * Do not strip attachment/source/future message
     * metadata. chat.js performs canonical normalization.
     */

    return {
      id,

      conversationId:
        id,

      title:
        clean(
          data?.title ||
          getById(id)?.title ||
          "New conversation"
        ) ||
        "New conversation",

      messages:
        Array.isArray(
          data?.messages
        )
          ? cloneValue(
              data.messages
            )
          : []
    };
  }

  /* =====================================================
     CANCEL CURRENT OPEN
     ===================================================== */

  function cancelPendingOpen(
    reason =
      "superseded"
  ) {
    openSerial +=
      1;

    const controller =
      activeOpenController;

    activeOpenController =
      null;

    state.opening =
      false;

    if (
      controller
    ) {
      try {
        controller.abort(
          reason
        );

      } catch {
        try {
          controller.abort();
        } catch {}
      }
    }

    return true;
  }

  /* =====================================================
     OPEN CONVERSATION
     ===================================================== */

  async function openConversation(
    conversationId,
    {
      source =
        "history"
    } = {}
  ) {
    if (
      !active
    ) {
      return null;
    }

    const id =
      cleanId(
        conversationId
      );

    if (!id) {
      return null;
    }

    const now =
      performance.now();

    if (
      lastOpenId === id &&
      now -
        lastOpenAt <
      CONFIG
        .duplicateOpenWindowMs
    ) {
      return null;
    }

    lastOpenId =
      id;

    lastOpenAt =
      now;

    /*
     * Cancel actual previous fetch in addition to
     * serial stale-result protection.
     */

    if (
      activeOpenController
    ) {
      try {
        activeOpenController
          .abort(
            "superseded"
          );

      } catch {
        try {
          activeOpenController
            .abort();
        } catch {}
      }
    }

    const controller =
      new AbortController();

    activeOpenController =
      controller;

    const serial =
      ++openSerial;

    state.opening =
      true;

    state.lastError =
      null;

    emit(
      "neyo:history-opening",
      {
        conversationId:
          id,

        source
      }
    );

    try {
      const conversation =
        await fetchConversation(
          id,
          {
            signal:
              controller.signal
          }
        );

      /*
       * User clicked A then B:
       * late A must never replace B.
       */

      if (
        serial !==
          openSerial ||
        controller.signal
          .aborted ||
        !conversation
      ) {
        return null;
      }

      activeConversationId =
        id;

      state.opening =
        false;

      state.lastOpenedAt =
        Date.now();

      state.openCount +=
        1;

      renderHistory();

      /*
       * chat.js owns canonical conversation state.
       * messages.js owns actual message DOM.
       */

      emit(
        "neyo:conversation-loaded",
        {
          conversationId:
            id,

          messages:
            conversation.messages,

          source
        }
      );

      emit(
        "neyo:history-opened",
        {
          conversationId:
            id,

          conversation:
            cloneValue(
              conversation
            ),

          source
        }
      );

      return conversation;

    } catch (
      error
    ) {
      /*
       * Superseded/aborted history opens are expected
       * and should not surface as user-facing errors.
       */

      if (
        error?.name ===
          "AbortError" ||
        controller.signal
          .aborted ||
        serial !==
          openSerial
      ) {
        return null;
      }

      state.opening =
        false;

      handleError(
        error,
        {
          operation:
            "open",

          conversationId:
            id
        }
      );

      throw error;

    } finally {
      if (
        activeOpenController ===
        controller
      ) {
        activeOpenController =
          null;

        state.opening =
          false;
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
    if (
      !active
    ) {
      return null;
    }

    const id =
      cleanId(
        conversationId
      );

    if (!id) {
      return null;
    }

    const response =
      await fetchWithTimeout(
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
              "application/json",

            "X-Neyo-History-Client":
              VERSION
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
     ===================================================== */

  async function renameConversation(
    conversationId,
    title
  ) {
    if (
      !active
    ) {
      return false;
    }

    const id =
      cleanId(
        conversationId
      );

    const cleanTitle =
      clean(
        title
      );

    if (
      !id ||
      !cleanTitle
    ) {
      return false;
    }

    const existing =
      getById(
        id
      );

    if (
      existing?.title ===
      cleanTitle
    ) {
      return true;
    }

    await performAction(
      "rename",
      id,
      {
        title:
          cleanTitle
      }
    );

    /*
     * Update immediately after server success.
     * No visual flicker while background refresh runs.
     */

    updateLocalConversation(
      id,
      {
        title:
          cleanTitle
      }
    );

    state.renameCount +=
      1;

    state.lastMutationAt =
      Date.now();

    renderHistory();

    emit(
      "neyo:history-renamed",
      {
        conversationId:
          id,

        title:
          cleanTitle
      }
    );

    /*
     * Server remains authoritative.
     * Refresh quietly.
     */

    void loadHistory({
      showLoading:
        false
    }).catch(
      error => {
        console.warn(
          "[NEYO History] Post-rename refresh failed:",
          error
        );
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
    if (
      !active
    ) {
      return false;
    }

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

    const wasActive =
      activeConversationId ===
      id;

    removeLocalConversation(
      id
    );

    state.deleteCount +=
      1;

    state.lastMutationAt =
      Date.now();

    if (
      wasActive
    ) {
      activeConversationId =
        null;

      /*
       * Any history fetch still trying to open this
       * conversation is now stale.
       */

      cancelPendingOpen(
        "conversation-deleted"
      );

      /*
       * Existing runtime listens to this and routes
       * canonical neyo:chat-new-request.
       */

      emit(
        "neyo:active-conversation-deleted",
        {
          conversationId:
            id
        }
      );
    }

    renderHistory();

    emit(
      "neyo:history-deleted",
      {
        conversationId:
          id,

        wasActive
      }
    );

    void loadHistory({
      showLoading:
        false
    }).catch(
      error => {
        console.warn(
          "[NEYO History] Post-delete refresh failed:",
          error
        );
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
    if (
      !active
    ) {
      return false;
    }

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

    const existing =
      getById(
        id
      );

    if (
      existing &&
      Boolean(
        existing.is_pinned
      ) ===
      value
    ) {
      return true;
    }

    await performAction(
      value
        ? "pin"
        : "unpin",
      id
    );

    updateLocalConversation(
      id,
      {
        is_pinned:
          value,

        isPinned:
          value,

        pinned:
          value
      }
    );

    state.pinCount +=
      1;

    state.lastMutationAt =
      Date.now();

    renderHistory();

    emit(
      "neyo:history-pin-change",
      {
        conversationId:
          id,

        pinned:
          value,

        isPinned:
          value
      }
    );

    /*
     * Backend may reorder pinned items.
     * Quiet refresh gets canonical ordering.
     */

    void loadHistory({
      showLoading:
        false
    }).catch(
      error => {
        console.warn(
          "[NEYO History] Post-pin refresh failed:",
          error
        );
      }
    );

    return true;
  }

  /* =====================================================
     TOGGLE PIN
     ===================================================== */

  async function togglePinned(
    conversationId
  ) {
    const item =
      getById(
        conversationId
      );

    if (!item) {
      return false;
    }

    return setPinned(
      item.id,
      !item.is_pinned
    );
  }

  /* =====================================================
     SET ACTIVE
     ===================================================== */

  function setActiveConversation(
    conversationId,
    {
      render =
        true
    } = {}
  ) {
    if (
      !active
    ) {
      return false;
    }

    const id =
      cleanId(
        conversationId
      ) ||
      null;

    const changed =
      activeConversationId !==
      id;

    activeConversationId =
      id;

    if (
      render
    ) {
      renderHistory();
    }

    if (
      changed
    ) {
      emit(
        "neyo:history-active-change",
        {
          conversationId:
            activeConversationId
        }
      );
    }

    return true;
  }

  /* =====================================================
     GETTERS
     ===================================================== */

  function getConversations() {
    return conversations.map(
      item =>
        cloneValue(
          item
        )
    );
  }

  function getById(
    id
  ) {
    const value =
      cleanId(
        id
      );

    if (!value) {
      return null;
    }

    const item =
      conversations.find(
        conversation =>
          conversation.id ===
          value
      );

    return item
      ? cloneValue(
          item
        )
      : null;
  }

  /* =====================================================
     CHAT STATE SYNC

     chat.js owns actual conversation state.
     History mirrors only active sidebar selection.
     ===================================================== */

  function syncFromChatState(
    detail = {}
  ) {
    const privateChat =
      Boolean(
        detail.preferences
          ?.privateChat
      );

    if (
      privateChat
    ) {
      setActiveConversation(
        null
      );

      return;
    }

    const id =
      cleanId(
        detail.conversationId
      ) ||
      null;

    setActiveConversation(
      id
    );
  }

  /* =====================================================
     MENU ACTION EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:history-rename-request",
    event => {
      const detail =
        event.detail ||
        {};

      void renameConversation(
        detail.conversationId ||
        detail.id,

        detail.title
      ).catch(
        error =>
          handleError(
            error,
            {
              operation:
                "rename",

              conversationId:
                detail.conversationId ||
                detail.id
            }
          )
      );
    }
  );

  window.addEventListener(
    "neyo:history-delete-request",
    event => {
      const detail =
        event.detail ||
        {};

      void deleteConversation(
        detail.conversationId ||
        detail.id
      ).catch(
        error =>
          handleError(
            error,
            {
              operation:
                "delete",

              conversationId:
                detail.conversationId ||
                detail.id
            }
          )
      );
    }
  );

  window.addEventListener(
    "neyo:history-pin-request",
    event => {
      const detail =
        event.detail ||
        {};

      const id =
        detail.conversationId ||
        detail.id;

      if (
        !id
      ) {
        return;
      }

      /*
       * If menu specifies pinned, use it.
       * Otherwise toggle current state.
       */

      if (
        typeof detail.pinned ===
          "boolean"
      ) {
        void setPinned(
          id,
          detail.pinned
        ).catch(
          error =>
            handleError(
              error,
              {
                operation:
                  "pin",

                conversationId:
                  id
              }
            )
        );

        return;
      }

      void togglePinned(
        id
      ).catch(
        error =>
          handleError(
            error,
            {
              operation:
                "pin",

              conversationId:
                id
            }
          )
      );
    }
  );

  /* =====================================================
     LOAD / REFRESH EVENTS

     Both are supported for old + new chat contracts.
     loadingPromise dedupes simultaneous requests.
     ===================================================== */

  window.addEventListener(
    "neyo:history-load-request",
    () => {
      void loadHistory({
        showLoading:
          !state.loaded
      }).catch(
        error => {
          console.warn(
            "[NEYO History] Load failed:",
            error
          );
        }
      );
    }
  );

  window.addEventListener(
    "neyo:history-refresh-request",
    () => {
      void loadHistory({
        showLoading:
          false
      }).catch(
        error => {
          console.warn(
            "[NEYO History] Refresh failed:",
            error
          );
        }
      );
    }
  );

  /* =====================================================
     OPEN REQUEST EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:conversation-open-request",
    event => {
      const id =
        event.detail
          ?.conversationId ||
        event.detail
          ?.id;

      void openConversation(
        id,
        {
          source:
            event.detail
              ?.source ||
            "event"
        }
      ).catch(
        error =>
          handleError(
            error,
            {
              operation:
                "open",

              conversationId:
                id
            }
          )
      );
    }
  );

  /* =====================================================
     EXPLICIT ACTIVE SET
     ===================================================== */

  window.addEventListener(
    "neyo:history-active-set",
    event => {
      setActiveConversation(
        event.detail
          ?.conversationId ||
        event.detail
          ?.id ||
        null
      );
    }
  );

  /* =====================================================
     CHAT LOADED CONVERSATION
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state-loaded",
    event => {
      setActiveConversation(
        event.detail
          ?.conversationId ||
        null
      );
    }
  );

  /* =====================================================
     GENERAL CHAT STATE
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state",
    event => {
      syncFromChatState(
        event.detail ||
        {}
      );
    }
  );

  /* =====================================================
     NEW CHAT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      cancelPendingOpen(
        "new-chat"
      );

      setActiveConversation(
        null
      );
    }
  );

  /* =====================================================
     SUCCESSFUL CHAT RESPONSE

     New conversations receive conversationId only after
     backend responds. This makes the new sidebar row active.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-response",
    event => {
      const id =
        cleanId(
          event.detail
            ?.conversationId
        );

      if (
        id &&
        !event.detail
          ?.privateChat
      ) {
        setActiveConversation(
          id,
          {
            render:
              true
          }
        );
      }
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

      active,

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      /*
       * Load / render
       */

      load:
        loadHistory,

      loadHistory,

      refresh(
        options = {}
      ) {
        return loadHistory({
          showLoading:
            false,

          ...options
        });
      },

      render:
        renderHistory,

      renderHistory,

      /*
       * Conversation open
       */

      open:
        openConversation,

      openConversation,

      fetchConversation,

      cancelPendingOpen,

      /*
       * Actions
       */

      rename:
        renameConversation,

      renameConversation,

      delete:
        deleteConversation,

      deleteConversation,

      setPinned,

      togglePinned,

      /*
       * Active state
       */

      setActive:
        setActiveConversation,

      setActiveConversation,

      getActive() {
        return activeConversationId;
      },

      /*
       * Cache
       */

      getConversations,

      getById,

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

          activeConversationId,

          count:
            conversations.length,

          loaded:
            state.loaded,

          loading:
            Boolean(
              loadingPromise ||
              state.loading
            ),

          opening:
            state.opening,

          lastLoadedAt:
            state.lastLoadedAt,

          lastOpenedAt:
            state.lastOpenedAt,

          lastMutationAt:
            state.lastMutationAt,

          loadCount:
            state.loadCount,

          openCount:
            state.openCount,

          renameCount:
            state.renameCount,

          deleteCount:
            state.deleteCount,

          pinCount:
            state.pinCount,

          lastError:
            state.lastError
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
     INIT
     ===================================================== */

  if (
    active
  ) {
    /*
     * Read active chat if chat.js loaded first.
     */

    try {
      const chatState =
        window.NeyoChat
          ?.getState
          ?.();

      if (
        chatState
      ) {
        syncFromChatState(
          chatState
        );
      }
    } catch {}

    /*
     * Production behavior:
     * history is available immediately on app load.
     */

    void loadHistory({
      showLoading:
        true
    }).catch(
      error => {
        console.warn(
          "[NEYO History] Initial load failed:",
          error
        );
      }
    );
  }

  emit(
    "neyo:history-ready",
    {
      version:
        VERSION,

      active,

      legacyScriptPresent,

      legacyOwnerActive:
        false
    }
  );
})();
