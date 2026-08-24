/*
=========================================================
NEO — HISTORY
Production v1

Owns:
- /api/history communication
- conversation list state
- history list rendering
- open conversation
- active conversation row
- rename persistence
- delete persistence
- pin / unpin persistence
- loading / empty / error state
- history data API

Does NOT own:
- history popup positioning
- rename dialog UI
- delete confirmation UI
- share implementation
- chat message DOM
- /api/chat
- New Chat button
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-history-production-v1";

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

      maxTitleLength:
        80
    });

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
     STATE
     ===================================================== */

  let conversations =
    [];

  let activeConversationId =
    null;

  let loadingPromise =
    null;

  let loadController =
    null;

  let openController =
    null;

  let openSerial =
    0;

  let mutationCount =
    0;

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
    return {
      ...item
    };
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
      clean(
        item.id ||
        item.conversationId ||
        item.conversation_id,
        128
      );

    if (!id) {
      return null;
    }

    return {
      ...item,

      id,

      title:
        clean(
          item.title ||
          "New conversation",
          CONFIG.maxTitleLength
        ) ||
        "New conversation",

      is_pinned:
        Boolean(
          item.is_pinned ??
          item.isPinned ??
          item.pinned
        ),

      model:
        item.model ||
        item.model_used ||
        null,

      createdAt:
        item.createdAt ||
        item.created_at ||
        null,

      updatedAt:
        item.updatedAt ||
        item.updated_at ||
        item.createdAt ||
        item.created_at ||
        null
    };
  }

  /* =====================================================
     NORMALIZE MESSAGE

     Preserve future backend fields.
     ===================================================== */

  function normalizeMessage(
    message
  ) {
    if (
      !message ||
      typeof message !==
        "object"
    ) {
      return null;
    }

    if (
      message.role !== "user" &&
      message.role !== "assistant"
    ) {
      return null;
    }

    return {
      ...message,

      id:
        clean(
          message.id,
          128
        ) ||
        undefined,

      role:
        message.role,

      content:
        typeof message.content ===
          "string"
          ? message.content
          : "",

      displayContent:
        typeof message.displayContent ===
          "string"
          ? message.displayContent
          : undefined,

      attachments:
        Array.isArray(
          message.attachments
        )
          ? message.attachments.map(
              item => ({
                ...item
              })
            )
          : [],

      sources:
        Array.isArray(
          message.sources
        )
          ? message.sources.map(
              item => ({
                ...item
              })
            )
          : undefined,

      createdAt:
        message.createdAt ||
        message.created_at ||
        null
    };
  }

  /* =====================================================
     RESPONSE
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
          JSON.parse(
            raw
          );
      } catch {}
    }

    if (!response.ok) {
      const error =
        new Error(
          clean(
            data?.error ||
            data?.message ||
            raw,
            1500
          ) ||
          `History request failed (${response.status}).`
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

     Existing CSS contracts preserved:
     .history-loading
     .history-skeleton-row
     .history-skeleton-line
     ===================================================== */

  function renderLoading() {
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

      root.appendChild(
        row
      );
    }

    historyList.replaceChildren(
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
    historyList.replaceChildren();

    historyList.removeAttribute(
      "aria-busy"
    );

    return true;
  }

  /* =====================================================
     ERROR UI

     Keep it minimal.
     No browser alert().
     ===================================================== */

  function renderError() {
    historyList.replaceChildren();

    const root =
      document.createElement(
        "div"
      );

    root.className =
      "history-error-state";

    const text =
      document.createElement(
        "span"
      );

    text.className =
      "history-error-text";

    text.textContent =
      "Couldn’t load conversations.";

    const retry =
      document.createElement(
        "button"
      );

    retry.type =
      "button";

    retry.className =
      "history-retry-btn";

    retry.textContent =
      "Retry";

    retry.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        void loadHistory({
          force: true
        });
      }
    );

    root.append(
      text,
      retry
    );

    historyList.appendChild(
      root
    );

    historyList.removeAttribute(
      "aria-busy"
    );
  }

  /* =====================================================
     HISTORY ROW

     Existing CSS contracts preserved:
     .history-item-wrapper
     .history-item
     .history-item-title
     .history-pin-icon
     .history-three-dot
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

    button.setAttribute(
      "aria-current",
      item.id ===
        activeConversationId
        ? "true"
        : "false"
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

    /* -----------------------------------------------
       PIN ICON
       ----------------------------------------------- */

    if (item.is_pinned) {
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
      event => {
        /*
         * Prevent an old delegated neo.js history
         * handler from opening this conversation again.
         */

        event.preventDefault();
        event.stopPropagation();

        void openConversation(
          item.id
        );
      }
    );

    /* -----------------------------------------------
       MENU BUTTON
       ----------------------------------------------- */

    const menuButton =
      document.createElement(
        "button"
      );

    menuButton.type =
      "button";

    menuButton.className =
      "history-three-dot";

    menuButton.dataset
      .conversationId =
      item.id;

    menuButton.setAttribute(
      "aria-label",
      "Conversation options"
    );

    menuButton.setAttribute(
      "aria-haspopup",
      "menu"
    );

    const menuIcon =
      document.createElement(
        "i"
      );

    menuIcon.setAttribute(
      "data-lucide",
      "more-vertical"
    );

    menuIcon.setAttribute(
      "width",
      "16"
    );

    menuIcon.setAttribute(
      "height",
      "16"
    );

    menuIcon.setAttribute(
      "aria-hidden",
      "true"
    );

    menuButton.appendChild(
      menuIcon
    );

    menuButton.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        emit(
          "neyo:history-menu-request",
          {
            conversationId:
              item.id,

            title:
              item.title,

            isPinned:
              item.is_pinned,

            anchorElement:
              menuButton
          }
        );
      },
      true
    );

    /* -----------------------------------------------
       RIGHT CLICK / CONTEXT MENU
       ----------------------------------------------- */

    row.addEventListener(
      "contextmenu",
      event => {
        event.preventDefault();
        event.stopPropagation();

        emit(
          "neyo:history-menu-request",
          {
            conversationId:
              item.id,

            title:
              item.title,

            isPinned:
              item.is_pinned,

            clientX:
              event.clientX,

            clientY:
              event.clientY
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
    historyList.replaceChildren();

    historyList.removeAttribute(
      "aria-busy"
    );

    if (
      conversations.length === 0
    ) {
      emit(
        "neyo:history-rendered",
        {
          conversations: [],
          count: 0,
          activeConversationId
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
          conversations.map(
            cloneConversation
          ),

        count:
          conversations.length,

        activeConversationId
      }
    );

    return true;
  }

  /* =====================================================
     LIST REQUEST
     ===================================================== */

  async function performLoadHistory(
    signal
  ) {
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
              "application/json",

            "X-Neyo-History-Client":
              VERSION
          },

          signal
        }
      );

    const data =
      await readJson(
        response
      );

    conversations =
      Array.isArray(
        data?.conversations
      )
        ? data.conversations
            .map(
              normalizeConversation
            )
            .filter(Boolean)
        : [];

    renderHistory();

    const result =
      conversations.map(
        cloneConversation
      );

    emit(
      "neyo:history-loaded",
      {
        conversations:
          result,

        count:
          result.length,

        activeConversationId
      }
    );

    return result;
  }

  /* =====================================================
     LOAD HISTORY

     Simultaneous normal load calls share one promise.

     force:true aborts the stale list request.
     ===================================================== */

  async function loadHistory({
    force = false,
    showLoading = true
  } = {}) {
    if (
      loadingPromise &&
      !force
    ) {
      return loadingPromise;
    }

    if (
      force &&
      loadController
    ) {
      try {
        loadController.abort();
      } catch {}
    }

    const controller =
      new AbortController();

    loadController =
      controller;

    if (showLoading) {
      renderLoading();
    }

    const promise =
      performLoadHistory(
        controller.signal
      );

    loadingPromise =
      promise;

    try {
      return await promise;

    } catch (error) {
      if (
        error?.name ===
        "AbortError"
      ) {
        return conversations.map(
          cloneConversation
        );
      }

      renderError();

      emit(
        "neyo:history-error",
        {
          error,
          operation:
            "load"
        }
      );

      throw error;

    } finally {
      if (
        loadingPromise ===
        promise
      ) {
        loadingPromise =
          null;
      }

      if (
        loadController ===
        controller
      ) {
        loadController =
          null;
      }
    }
  }

  /* =====================================================
     FETCH CONVERSATION
     ===================================================== */

  async function fetchConversation(
    conversationId,
    {
      signal
    } = {}
  ) {
    const id =
      clean(
        conversationId,
        128
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

          signal
        }
      );

    const data =
      await readJson(
        response
      );

    const messages =
      Array.isArray(
        data?.messages
      )
        ? data.messages
            .map(
              normalizeMessage
            )
            .filter(Boolean)
        : [];

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

      messages
    };
  }

  /* =====================================================
     OPEN CONVERSATION

     Important:
     A clicked, then B clicked quickly:
     slow A response can NEVER replace B.
     ===================================================== */

  async function openConversation(
    conversationId
  ) {
    const id =
      clean(
        conversationId,
        128
      );

    if (!id) {
      return null;
    }

    /*
     * Clicking currently active conversation should not
     * issue a second network request while chat state
     * already owns it.
     */

    if (
      id ===
        activeConversationId &&
      window.NeyoChat
        ?.getConversationId
        ?.() === id
    ) {
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

    try {
      openController
        ?.abort();
    } catch {}

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
       * chat.js is canonical conversation owner.
       * It receives the data and then messages.js renders.
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
            id
        }
      );

      return result;

    } catch (error) {
      if (
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

            conversationId:
              id,

            operation:
              "open"
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
      clean(
        conversationId,
        128
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
     LOCAL UPDATE HELPERS
     ===================================================== */

  function findLocalIndex(
    conversationId
  ) {
    const id =
      clean(
        conversationId,
        128
      );

    return conversations
      .findIndex(
        item =>
          item.id === id
      );
  }

  /* =====================================================
     RENAME

     Optimistic local update after server success.
     Avoid an unnecessary second GET.
     ===================================================== */

  async function renameConversation(
    conversationId,
    title
  ) {
    const id =
      clean(
        conversationId,
        128
      );

    const nextTitle =
      clean(
        title,
        CONFIG.maxTitleLength
      );

    if (
      !id ||
      !nextTitle
    ) {
      return false;
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
      findLocalIndex(
        id
      );

    if (index >= 0) {
      conversations[index] = {
        ...conversations[index],

        title:
          nextTitle,

        updatedAt:
          new Date()
            .toISOString()
      };

      renderHistory();
    }

    mutationCount +=
      1;

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
      clean(
        conversationId,
        128
      );

    if (!id) {
      return false;
    }

    await performAction(
      "delete",
      id
    );

    conversations =
      conversations.filter(
        item =>
          item.id !== id
      );

    const deletedActive =
      activeConversationId ===
        id;

    if (deletedActive) {
      activeConversationId =
        null;

      /*
       * Invalidate any open still in flight.
       */

      openSerial +=
        1;

      try {
        openController
          ?.abort();
      } catch {}

      emit(
        "neyo:active-conversation-deleted",
        {
          conversationId:
            id
        }
      );
    }

    renderHistory();

    mutationCount +=
      1;

    emit(
      "neyo:history-deleted",
      {
        conversationId:
          id,

        wasActive:
          deletedActive
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
      clean(
        conversationId,
        128
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
      findLocalIndex(
        id
      );

    if (index >= 0) {
      conversations[index] = {
        ...conversations[index],

        is_pinned:
          value
      };

      /*
       * Pinned conversations stay above normal history
       * without waiting for another server fetch.
       */

      conversations.sort(
        (a, b) => {
          if (
            a.is_pinned !==
            b.is_pinned
          ) {
            return a.is_pinned
              ? -1
              : 1;
          }

          const aTime =
            Date.parse(
              a.updatedAt ||
              a.updated_at ||
              a.createdAt ||
              a.created_at ||
              0
            ) || 0;

          const bTime =
            Date.parse(
              b.updatedAt ||
              b.updated_at ||
              b.createdAt ||
              b.created_at ||
              0
            ) || 0;

          return (
            bTime -
            aTime
          );
        }
      );

      renderHistory();
    }

    mutationCount +=
      1;

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
    const id =
      clean(
        conversationId,
        128
      ) ||
      null;

    if (
      activeConversationId ===
      id
    ) {
      return true;
    }

    activeConversationId =
      id;

    renderHistory();

    emit(
      "neyo:history-active-change",
      {
        conversationId:
          id
      }
    );

    return true;
  }

  /* =====================================================
     ERROR BRIDGE
     ===================================================== */

  function handleError(
    error,
    detail = {}
  ) {
    console.error(
      "[NEO History]",
      error
    );

    emit(
      "neyo:history-error",
      {
        error,
        ...detail
      }
    );
  }

  /* =====================================================
     HISTORY MENU REQUESTS

     history-menu.js owns the dialogs/UI.
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
        error =>
          handleError(
            error,
            {
              operation:
                "rename"
            }
          )
      );
    }
  );

  window.addEventListener(
    "neyo:history-delete-request",
    event => {
      void deleteConversation(
        event.detail
          ?.conversationId
      ).catch(
        error =>
          handleError(
            error,
            {
              operation:
                "delete"
            }
          )
      );
    }
  );

  window.addEventListener(
    "neyo:history-pin-request",
    event => {
      void setPinned(
        event.detail
          ?.conversationId,

        event.detail
          ?.pinned
      ).catch(
        error =>
          handleError(
            error,
            {
              operation:
                "pin"
            }
          )
      );
    }
  );

  /* =====================================================
     LOAD REQUEST

     chat.js emits this after successful non-private chat.
     ===================================================== */

  window.addEventListener(
    "neyo:history-load-request",
    event => {
      const conversationId =
        clean(
          event.detail
            ?.conversationId,
          128
        );

      if (conversationId) {
        activeConversationId =
          conversationId;
      }

      /*
       * No loading skeleton for background refresh after
       * a normal chat response.
       */

      void loadHistory({
        force:
          true,

        showLoading:
          false
      }).catch(
        error => {
          console.warn(
            "[NEO History] Background refresh failed:",
            error
          );
        }
      );
    }
  );

  /* =====================================================
     EXTERNAL OPEN REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:conversation-open-request",
    event => {
      void openConversation(
        event.detail
          ?.conversationId
      ).catch(
        error =>
          handleError(
            error,
            {
              operation:
                "open"
            }
          )
      );
    }
  );

  /* =====================================================
     ACTIVE STATE REQUEST
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
     CHAT → HISTORY ACTIVE SYNC

     chat.js owns conversation identity.
     history.js mirrors it visually.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state-loaded",
    event => {
      setActiveConversation(
        event.detail
          ?.conversationId
      );
    }
  );

  window.addEventListener(
    "neyo:chat-state",
    event => {
      const id =
        event.detail
          ?.conversationId;

      if (
        id !== undefined
      ) {
        setActiveConversation(
          id
        );
      }
    }
  );

  window.addEventListener(
    "neyo:chat-new",
    () => {
      setActiveConversation(
        null
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

      render:
        renderHistory,

      open:
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
          activeConversationId ||
          null
        );
      },

      getConversations() {
        return conversations.map(
          cloneConversation
        );
      },

      getById(
        id
      ) {
        const key =
          clean(
            id,
            128
          );

        const item =
          conversations.find(
            conversation =>
              conversation.id ===
              key
          );

        return item
          ? cloneConversation(
              item
            )
          : null;
      },

      isLoading() {
        return Boolean(
          loadingPromise
        );
      },

      refresh() {
        return loadHistory({
          force:
            true,

          showLoading:
            false
        });
      },

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          activeConversationId,

          count:
            conversations.length,

          loading:
            Boolean(
              loadingPromise
            ),

          opening:
            Boolean(
              openController
            ),

          openSerial,

          mutations:
            mutationCount
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
     READY

     Do not automatically fetch here.
     app-init / existing bootstrap may issue the first
     history-load-request.

     This avoids duplicate first-load network calls.
     ===================================================== */

  renderEmpty();

  emit(
    "neyo:history-ready",
    {
      version:
        VERSION,

      active:
        true
    }
  );
})();
