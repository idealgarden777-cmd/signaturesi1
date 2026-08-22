(() => {
  "use strict";

  const VERSION =
    "neyo-history-recovery-v1";

  if (
    window.NeyoHistory
      ?.__controller
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


  /* =====================================================
     RUNTIME OWNERSHIP

     neo.js present:
     legacy history remains sole owner.

     neo.js removed:
     this controller becomes active.
     ===================================================== */

  const legacy =
    Array.from(
      document.scripts ||
      []
    )
      .some(
        script =>
          /(?:^|\/)neo\.js(?:\?|$)/
            .test(
              script.src ||
              ""
            )
      );


  const active =
    Boolean(
      historyList
    ) &&
    !legacy;


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


  /* =====================================================
     HELPERS
     ===================================================== */

  const emit =
    (
      name,
      detail = {}
    ) => {

      window.dispatchEvent(
        new CustomEvent(
          name,
          {
            detail
          }
        )
      );
    };


  const clean =
    (
      value,
      max = 220
    ) =>

      String(
        value ??
        ""
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


  const refreshIcons =
    () => {

      try {

        window.lucide
          ?.createIcons
          ?.();

      } catch {}
    };


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
          100
        ) ||
        "New conversation",

      is_pinned:
        Boolean(
          item.is_pinned ??
          item.isPinned ??
          item.pinned
        )
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


    let data =
      {};


    if (raw) {

      try {

        data =
          JSON.parse(
            raw
          );

      } catch {}
    }


    if (
      !response.ok
    ) {

      const error =
        new Error(
          clean(
            data?.error ||
            data?.message ||
            raw,
            1500
          ) ||

          `Request failed (${response.status}).`
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
     LOADING
     ===================================================== */

  function renderLoading() {

    if (!active) {
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


    for (
      let i = 0;
      i < 3;
      i += 1
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


    return true;
  }


  /* =====================================================
     EMPTY
     ===================================================== */

  function renderEmpty() {

    if (!active) {
      return false;
    }


    historyList
      .replaceChildren();


    return true;
  }


  /* =====================================================
     HISTORY ROW
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


    /* -------------------------------------------------
       OPEN BUTTON
       ------------------------------------------------- */

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


    button.classList
      .toggle(
        "active",
        item.id ===
        activeConversationId
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


    /* -------------------------------------------------
       PIN ICON
       ------------------------------------------------- */

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
      () => {

        void openConversation(
          item.id
        );
      }
    );


    /* -------------------------------------------------
       THREE-DOT MENU
       ------------------------------------------------- */

    const menuButton =
      document.createElement(
        "button"
      );


    menuButton.type =
      "button";

    menuButton.className =
      "history-three-dot";


    menuButton.setAttribute(
      "aria-label",
      "Conversation options"
    );


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
      }
    );


    /* -------------------------------------------------
       RIGHT CLICK
       ------------------------------------------------- */

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

    if (!active) {
      return false;
    }


    historyList
      .replaceChildren();


    if (
      !conversations.length
    ) {

      emit(
        "neyo:history-rendered",
        {
          conversations:
            [],

          count:
            0
        }
      );


      return true;
    }


    const fragment =
      document.createDocumentFragment();


    conversations.forEach(
      item => {

        fragment.appendChild(
          createHistoryRow(
            item
          )
        );
      }
    );


    historyList.appendChild(
      fragment
    );


    refreshIcons();


    emit(
      "neyo:history-rendered",
      {
        conversations:
          conversations.map(
            item => ({
              ...item
            })
          ),

        count:
          conversations.length
      }
    );


    return true;
  }


  /* =====================================================
     LOAD HISTORY
     ===================================================== */

  async function performLoadHistory() {

    renderLoading();


    try {

      const response =
        await fetch(
          "/api/history",
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


      conversations =
        Array.isArray(
          data?.conversations
        )
          ? data.conversations
              .map(
                normalizeConversation
              )
              .filter(
                Boolean
              )
          : [];


      renderHistory();


      emit(
        "neyo:history-loaded",
        {
          conversations:
            conversations.map(
              item => ({
                ...item
              })
            )
        }
      );


      return conversations.map(
        item => ({
          ...item
        })
      );

    } catch (
      error
    ) {

      renderEmpty();


      emit(
        "neyo:history-error",
        {
          error
        }
      );


      throw error;
    }
  }


  async function loadHistory() {

    if (!active) {
      return [];
    }


    /*
     * Prevent duplicate simultaneous
     * GET /api/history requests.
     */

    if (
      loadingPromise
    ) {
      return loadingPromise;
    }


    loadingPromise =
      performLoadHistory();


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
    conversationId
  ) {

    if (!active) {
      return null;
    }


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
        "/api/history",
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
            })
        }
      );


    const data =
      await readJson(
        response
      );


    return {
      id,

      /*
       * IMPORTANT:
       * Do not strip attachments,
       * sources or future message fields.
       */

      messages:
        Array.isArray(
          data?.messages
        )
          ? data.messages
          : []
    };
  }


  /* =====================================================
     OPEN CONVERSATION
     ===================================================== */

  async function openConversation(
    conversationId
  ) {

    if (!active) {
      return null;
    }


    const id =
      clean(
        conversationId,
        128
      );


    if (!id) {
      return null;
    }


    /*
     * Prevent stale history click:
     *
     * A clicked
     * then B clicked quickly
     * → slow A response cannot replace B.
     */

    const serial =
      ++openSerial;


    emit(
      "neyo:history-opening",
      {
        conversationId:
          id
      }
    );


    try {

      const conversation =
        await fetchConversation(
          id
        );


      if (
        serial !==
          openSerial ||
        !conversation
      ) {
        return null;
      }


      activeConversationId =
        id;


      renderHistory();


      /*
       * chat.js receives this event.
       * messages.js remains the DOM owner.
       */

      emit(
        "neyo:conversation-loaded",
        {
          conversationId:
            id,

          messages:
            conversation.messages
        }
      );


      return conversation;

    } catch (
      error
    ) {

      if (
        serial ===
        openSerial
      ) {

        emit(
          "neyo:history-error",
          {
            error,

            conversationId:
              id
          }
        );
      }


      throw error;
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

    if (!active) {
      return null;
    }


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
        "/api/history",
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
     ===================================================== */

  async function renameConversation(
    conversationId,
    title
  ) {

    if (!active) {
      return false;
    }


    const id =
      clean(
        conversationId,
        128
      );


    const cleanTitle =
      clean(
        title,
        100
      );


    if (
      !id ||
      !cleanTitle
    ) {
      return false;
    }


    await performAction(
      "rename",
      id,
      {
        title:
          cleanTitle
      }
    );


    await loadHistory();


    emit(
      "neyo:history-renamed",
      {
        conversationId:
          id,

        title:
          cleanTitle
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

    if (!active) {
      return false;
    }


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


    if (
      activeConversationId ===
      id
    ) {

      activeConversationId =
        null;


      /*
       * Invalidate any conversation
       * currently being opened.
       */

      openSerial +=
        1;


      emit(
        "neyo:active-conversation-deleted",
        {
          conversationId:
            id
        }
      );
    }


    await loadHistory();


    emit(
      "neyo:history-deleted",
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

    if (!active) {
      return false;
    }


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


    await loadHistory();


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

    if (!active) {
      return false;
    }


    activeConversationId =
      clean(
        conversationId,
        128
      ) ||
      null;


    renderHistory();


    return true;
  }


  /* =====================================================
     ERROR BRIDGE
     ===================================================== */

  function handleError(
    error,
    detail = {}
  ) {

    emit(
      "neyo:history-error",
      {
        error,
        ...detail
      }
    );
  }


  /* =====================================================
     EVENTS

     Critical:
     No history listeners are registered
     while neo.js is the active owner.
     ===================================================== */

  if (active) {

    window.addEventListener(
      "neyo:history-rename-request",
      event => {

        void renameConversation(
          event.detail
            ?.conversationId,

          event.detail
            ?.title
        )
          .catch(
            error =>
              handleError(
                error
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
        )
          .catch(
            error =>
              handleError(
                error
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
        )
          .catch(
            error =>
              handleError(
                error
              )
          );
      }
    );


    window.addEventListener(
      "neyo:history-load-request",
      () => {

        void loadHistory()
          .catch(
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
      "neyo:conversation-open-request",
      event => {

        void openConversation(
          event.detail
            ?.conversationId
        )
          .catch(
            error =>
              handleError(
                error
              )
          );
      }
    );


    window.addEventListener(
      "neyo:history-active-set",
      event => {

        setActiveConversation(
          event.detail
            ?.conversationId
        );
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

      active,

      legacyOwnerActive:
        legacy,

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

      getActive:
        () =>
          activeConversationId,

      getConversations:
        () =>
          conversations.map(
            item => ({
              ...item
            })
          ),

      getById(
        id
      ) {

        const value =
          clean(
            id,
            128
          );


        const item =
          conversations.find(
            conversation =>
              conversation.id ===
              value
          );


        return item
          ? {
              ...item
            }
          : null;
      },

      getState:
        () => ({

          version:
            VERSION,

          active,

          legacyOwnerActive:
            legacy,

          activeConversationId,

          count:
            conversations.length,

          loading:
            Boolean(
              loadingPromise
            )
        })
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


  emit(
    "neyo:history-ready",
    {
      version:
        VERSION,

      active,

      legacyOwnerActive:
        legacy
    }
  );

})();
