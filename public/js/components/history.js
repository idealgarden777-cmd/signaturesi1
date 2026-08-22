/*
=========================================================
NEYO — HISTORY
FINAL CLEAN v1

FILE:
public/js/components/history.js

OWNS
---------------------------------------------------------
- Load conversation list
- Render history list
- Fetch conversation messages
- Open conversation
- Rename conversation
- Delete conversation
- Pin / unpin conversation
- Active history-row state
- History loading/error events

DOES NOT OWN
---------------------------------------------------------
- Chat API
- Conversation message state
- Message rendering
- New-chat implementation
- Rename modal UI
- Delete confirmation UI
- History menu positioning
- Share UI

FLOW
---------------------------------------------------------
GET /api/history
→ render conversation list

Open conversation
→ POST /api/history { action: "get" }
→ emit neyo:conversation-loaded
→ chat.js loads canonical state

Rename / Delete / Pin
→ POST /api/history
→ refresh history list
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-history-final-clean-v1";


  if (
    window.NeyoHistory?.__controller ===
    true
  ) {
    console.warn(
      "[NEYO History] Already initialized."
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

      titleMaxLength:
        100,

      requestTimeoutMs:
        30_000,

      debug:
        false
    });


  /* =====================================================
     DOM
     ===================================================== */

  const historyList =
    document.getElementById(
      "historyList"
    );


  if (
    !historyList
  ) {
    console.warn(
      "[NEYO History] #historyList not found."
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


  let openRequestId =
    0;


  let activeOpenController =
    null;


  /* =====================================================
     HELPERS
     ===================================================== */

  function debug(
    ...args
  ) {
    if (
      CONFIG.debug
    ) {
      console.log(
        "[NEYO History]",
        ...args
      );
    }
  }


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


  function cleanString(
    value
  ) {
    return String(
      value ??
      ""
    ).trim();
  }


  function cloneConversation(
    conversation
  ) {
    if (
      !conversation ||
      typeof conversation !==
        "object"
    ) {
      return null;
    }


    return {
      ...conversation
    };
  }


  function cloneConversations() {
    return conversations.map(
      cloneConversation
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
     TIMEOUT
     ===================================================== */

  function createTimedController(
    timeoutMs =
      CONFIG.requestTimeoutMs
  ) {
    const controller =
      new AbortController();


    const timeoutId =
      window.setTimeout(
        () => {
          try {
            controller.abort();

          } catch {}
        },
        timeoutMs
      );


    return {
      controller,

      clear() {
        window.clearTimeout(
          timeoutId
        );
      }
    };
  }


  /* =====================================================
     RESPONSE
     ===================================================== */

  async function readResponse(
    response
  ) {
    const raw =
      await response.text();


    let data =
      {};


    if (
      raw
    ) {
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
      const error =
        new Error(
          cleanString(
            data?.message ||
            data?.error ||
            raw
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
     NORMALIZE HISTORY ITEM
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
      cleanString(
        item.id ||
        item.conversation_id
      );


    if (
      !id
    ) {
      return null;
    }


    return {
      ...item,

      id,

      title:
        cleanString(
          item.title
        ) ||
        "New conversation",

      is_pinned:
        Boolean(
          item.is_pinned ??
          item.pinned
        )
    };
  }


  /* =====================================================
     LOADING UI
     ===================================================== */

  function renderLoading() {
    historyList
      .replaceChildren();


    const wrapper =
      document.createElement(
        "div"
      );


    wrapper.className =
      "history-loading";


    wrapper.setAttribute(
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


      wrapper.appendChild(
        row
      );
    }


    historyList.appendChild(
      wrapper
    );
  }


  /* =====================================================
     EMPTY UI
     ===================================================== */

  function renderEmpty() {
    historyList
      .replaceChildren();
  }


  /* =====================================================
     ICON
     ===================================================== */

  function createIcon(
    name,
    size = 16
  ) {
    const icon =
      document.createElement(
        "i"
      );


    icon.setAttribute(
      "data-lucide",
      name
    );


    icon.setAttribute(
      "width",
      String(
        size
      )
    );


    icon.setAttribute(
      "height",
      String(
        size
      )
    );


    icon.setAttribute(
      "aria-hidden",
      "true"
    );


    return icon;
  }


  /* =====================================================
     MENU REQUEST
     ===================================================== */

  function requestMenu(
    item,
    source = {}
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

        ...source
      }
    );
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


    /* ===================================================
       MAIN BUTTON
       =================================================== */

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


    button.classList.toggle(
      "active",
      item.id ===
        activeConversationId
    );


    if (
      item.id ===
      activeConversationId
    ) {
      button.setAttribute(
        "aria-current",
        "true"
      );
    }


    /* ===================================================
       TITLE
       =================================================== */

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


    /* ===================================================
       PIN
       =================================================== */

    if (
      item.is_pinned
    ) {
      const pin =
        document.createElement(
          "span"
        );


      pin.className =
        "history-pin-icon";


      pin.appendChild(
        createIcon(
          "pin",
          12
        )
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


    /* ===================================================
       THREE-DOT MENU
       =================================================== */

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


    menuButton.appendChild(
      createIcon(
        "more-vertical",
        16
      )
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


    /* ===================================================
       CONTEXT MENU
       =================================================== */

    row.addEventListener(
      "contextmenu",
      event => {
        event.preventDefault();


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
          conversations:
            [],

          count:
            0
        }
      );


      return;
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
          cloneConversations(),

        count:
          conversations.length
      }
    );
  }


  /* =====================================================
     LOAD HISTORY
     ===================================================== */

  async function performLoadHistory() {
    renderLoading();


    const timed =
      createTimedController();


    try {
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

            headers:
              {
                Accept:
                  "application/json"
              },

            signal:
              timed.controller.signal
          }
        );


      const data =
        await readResponse(
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
            cloneConversations()
        }
      );


      return cloneConversations();

    } catch (
      error
    ) {
      renderEmpty();


      const normalizedError =
        error?.name ===
          "AbortError"
          ? new Error(
              "History request timed out."
            )
          : error;


      emit(
        "neyo:history-error",
        {
          error:
            normalizedError
        }
      );


      throw normalizedError;

    } finally {
      timed.clear();
    }
  }


  async function loadHistory() {
    /*
    -------------------------------------------------------
    Deduplicate simultaneous history refreshes.
    -------------------------------------------------------
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
     FETCH CONVERSATION
     ===================================================== */

  async function fetchConversation(
    conversationId,
    signal =
      undefined
  ) {
    const id =
      cleanString(
        conversationId
      );


    if (
      !id
    ) {
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

          headers:
            {
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
      await readResponse(
        response
      );


    return {
      id,

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
    const id =
      cleanString(
        conversationId
      );


    if (
      !id
    ) {
      return null;
    }


    /*
    -------------------------------------------------------
    Every open request gets an ID.

    If A is slow and user opens B, A can no longer replace B.
    -------------------------------------------------------
    */

    const requestId =
      ++openRequestId;


    try {
      activeOpenController
        ?.abort();

    } catch {}


    const timed =
      createTimedController();


    activeOpenController =
      timed.controller;


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
          id,
          timed.controller.signal
        );


      /*
      -------------------------------------------------------
      Stale response protection.
      -------------------------------------------------------
      */

      if (
        requestId !==
        openRequestId
      ) {
        return null;
      }


      activeConversationId =
        id;


      renderHistory();


      emit(
        "neyo:conversation-loaded",
        {
          conversationId:
            id,

          messages:
            conversation.messages
        }
      );


      emit(
        "neyo:history-opened",
        {
          conversationId:
            id
        }
      );


      return conversation;

    } catch (
      error
    ) {
      /*
      -------------------------------------------------------
      Abort caused by opening a newer conversation is normal.
      -------------------------------------------------------
      */

      if (
        error?.name ===
          "AbortError" &&
        requestId !==
          openRequestId
      ) {
        return null;
      }


      const normalizedError =
        error?.name ===
          "AbortError"
          ? new Error(
              "Conversation request timed out."
            )
          : error;


      emit(
        "neyo:history-error",
        {
          error:
            normalizedError,

          conversationId:
            id
        }
      );


      throw normalizedError;

    } finally {
      timed.clear();


      if (
        activeOpenController ===
        timed.controller
      ) {
        activeOpenController =
          null;
      }
    }
  }


  /* =====================================================
     GENERIC ACTION
     ===================================================== */

  async function performAction(
    action,
    conversationId,
    payload = {}
  ) {
    const id =
      cleanString(
        conversationId
      );


    if (
      !id
    ) {
      throw new Error(
        "Conversation ID is required."
      );
    }


    const timed =
      createTimedController();


    try {
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

            headers:
              {
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
              }),

            signal:
              timed.controller.signal
          }
        );


      return await readResponse(
        response
      );

    } catch (
      error
    ) {
      if (
        error?.name ===
          "AbortError"
      ) {
        throw new Error(
          "History action timed out."
        );
      }


      throw error;

    } finally {
      timed.clear();
    }
  }


  /* =====================================================
     RENAME
     ===================================================== */

  async function renameConversation(
    conversationId,
    title
  ) {
    const id =
      cleanString(
        conversationId
      );


    const cleanTitle =
      cleanString(
        title
      )
        .slice(
          0,
          CONFIG.titleMaxLength
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


    /*
    -------------------------------------------------------
    Update local row immediately.

    No need to wait for an entire GET request just to change
    one title.
    -------------------------------------------------------
    */

    const item =
      conversations.find(
        conversation =>
          conversation.id ===
          id
      );


    if (
      item
    ) {
      item.title =
        cleanTitle;


      renderHistory();
    }


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
    const id =
      cleanString(
        conversationId
      );


    if (
      !id
    ) {
      return false;
    }


    await performAction(
      "delete",
      id
    );


    conversations =
      conversations.filter(
        conversation =>
          conversation.id !==
          id
      );


    const wasActive =
      activeConversationId ===
      id;


    if (
      wasActive
    ) {
      activeConversationId =
        null;
    }


    renderHistory();


    if (
      wasActive
    ) {
      /*
      -------------------------------------------------------
      History does NOT directly manipulate chat.js.

      Another integration layer may decide whether deletion
      opens New Chat.
      -------------------------------------------------------
      */

      emit(
        "neyo:active-conversation-deleted",
        {
          conversationId:
            id
        }
      );
    }


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
    const id =
      cleanString(
        conversationId
      );


    if (
      !id
    ) {
      return false;
    }


    const nextPinned =
      Boolean(
        pinned
      );


    await performAction(
      nextPinned
        ? "pin"
        : "unpin",
      id
    );


    const item =
      conversations.find(
        conversation =>
          conversation.id ===
          id
      );


    if (
      item
    ) {
      item.is_pinned =
        nextPinned;


      /*
      -------------------------------------------------------
      Preserve server list order for now.

      We do NOT invent a client-side pin ordering rule that
      may differ from backend behavior.
      -------------------------------------------------------
      */

      renderHistory();
    }


    emit(
      "neyo:history-pin-change",
      {
        conversationId:
          id,

        pinned:
          nextPinned
      }
    );


    /*
    -------------------------------------------------------
    Refresh afterward because backend may reorder pinned
    conversations.
    -------------------------------------------------------
    */

    void loadHistory()
      .catch(
        error => {
          debug(
            "Background pin refresh failed:",
            error
          );
        }
      );


    return true;
  }


  /* =====================================================
     ACTIVE STATE
     ===================================================== */

  function setActiveConversation(
    conversationId
  ) {
    activeConversationId =
      cleanString(
        conversationId
      ) ||
      null;


    renderHistory();


    return true;
  }


  /* =====================================================
     REQUEST WRAPPER
     ===================================================== */

  function handleAsyncAction(
    task,
    context = {}
  ) {
    Promise.resolve(
      task
    )
      .catch(
        error => {
          emit(
            "neyo:history-error",
            {
              error,
              ...context
            }
          );
        }
      );
  }


  /* =====================================================
     RENAME EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:history-rename-request",
    event => {
      const conversationId =
        event.detail
          ?.conversationId;


      handleAsyncAction(
        renameConversation(
          conversationId,
          event.detail
            ?.title
        ),
        {
          conversationId
        }
      );
    }
  );


  /* =====================================================
     DELETE EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:history-delete-request",
    event => {
      const conversationId =
        event.detail
          ?.conversationId;


      handleAsyncAction(
        deleteConversation(
          conversationId
        ),
        {
          conversationId
        }
      );
    }
  );


  /* =====================================================
     PIN EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:history-pin-request",
    event => {
      const conversationId =
        event.detail
          ?.conversationId;


      handleAsyncAction(
        setPinned(
          conversationId,
          event.detail
            ?.pinned
        ),
        {
          conversationId
        }
      );
    }
  );


  /* =====================================================
     HISTORY LOAD EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:history-load-request",
    () => {
      handleAsyncAction(
        loadHistory()
      );
    }
  );


  /* =====================================================
     OPEN EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:conversation-open-request",
    event => {
      const conversationId =
        event.detail
          ?.conversationId;


      handleAsyncAction(
        openConversation(
          conversationId
        ),
        {
          conversationId
        }
      );
    }
  );


  /* =====================================================
     ACTIVE EVENT
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
     CHAT NEW SYNC
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      if (
        activeConversationId ===
        null
      ) {
        return;
      }


      activeConversationId =
        null;


      renderHistory();
    }
  );


  /* =====================================================
     CHAT RESPONSE SYNC
     ===================================================== */

  window.addEventListener(
    "neyo:chat-response",
    event => {
      const conversationId =
        cleanString(
          event.detail
            ?.conversationId
        );


      if (
        conversationId
      ) {
        activeConversationId =
          conversationId;
      }


      /*
      -------------------------------------------------------
      New conversation/title may now exist on backend.
      Refresh sidebar after successful response.
      -------------------------------------------------------
      */

      void loadHistory()
        .catch(
          error => {
            debug(
              "Post-chat history refresh failed:",
              error
            );
          }
        );
    }
  );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  const publicApi =
    Object.freeze({
      __controller:
        true,

      version:
        VERSION,

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
        cloneConversations,

      getById(
        id
      ) {
        const conversation =
          conversations.find(
            item =>
              item.id ===
              id
          );


        return conversation
          ? cloneConversation(
              conversation
            )
          : null;
      },

      getState:
        () => ({
          version:
            VERSION,

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
        publicApi,

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
    "neyo:history-ready",
    {
      version:
        VERSION
    }
  );

})();
