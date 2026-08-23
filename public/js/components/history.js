(() => {
  "use strict";

  const VERSION = "neyo-history-v2";
  if (window.NeyoHistory?.__controller === true) return;

  const ENDPOINT = "/api/history";
  const historyList = document.getElementById("historyList");

  if (!historyList) {
    console.warn("[NEYO History] #historyList missing.");
    return;
  }

  let conversations = [];
  let activeConversationId = null;
  let loadingPromise = null;
  let openSerial = 0;

  function emit(name, detail = {}) {
    window.dispatchEvent(
      new CustomEvent(name, { detail })
    );
  }

  function clean(value, max = 220) {
    return String(value ?? "")
      .replace(/\u0000/g, "")
      .trim()
      .slice(0, max);
  }

  function cloneConversation(item) {
    return item
      ? { ...item }
      : null;
  }

  function cloneConversations() {
    return conversations.map(item => ({
      ...item
    }));
  }

  function normalizeConversation(item) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const id = clean(
      item.id ||
        item.conversationId ||
        item.conversation_id,
      128
    );

    if (!id) return null;

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
      is_pinned: Boolean(
        item.is_pinned ??
          item.isPinned ??
          item.pinned
      )
    };
  }

  function refreshIcons() {
    try {
      window.lucide?.createIcons?.();
    } catch {}
  }

  async function readJson(response) {
    const raw = await response.text();

    let data = {};

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {}
    }

    if (!response.ok) {
      const error = new Error(
        clean(
          data?.error ||
            data?.message ||
            raw,
          1500
        ) ||
          `Request failed (${response.status}).`
      );

      error.status = response.status;
      error.data = data;

      throw error;
    }

    return data;
  }

  async function request(
    body = null
  ) {
    const response = await fetch(
      ENDPOINT,
      {
        method: body
          ? "POST"
          : "GET",

        credentials: "include",
        cache: "no-store",

        headers: body
          ? {
              "Content-Type":
                "application/json",
              Accept:
                "application/json"
            }
          : {
              Accept:
                "application/json"
            },

        body: body
          ? JSON.stringify(body)
          : undefined
      }
    );

    return readJson(response);
  }

  function renderLoading() {
    const root =
      document.createElement("div");

    root.className =
      "history-loading";

    root.setAttribute(
      "aria-hidden",
      "true"
    );

    for (let i = 0; i < 3; i++) {
      const row =
        document.createElement("div");

      const line =
        document.createElement("div");

      row.className =
        "history-skeleton-row";

      line.className =
        "history-skeleton-line";

      row.appendChild(line);
      root.appendChild(row);
    }

    historyList.replaceChildren(root);
  }

  function createHistoryRow(item) {
    const wrapper =
      document.createElement("div");

    const openButton =
      document.createElement("button");

    const title =
      document.createElement("span");

    const menuButton =
      document.createElement("button");

    wrapper.className =
      "history-item-wrapper";

    wrapper.dataset.id =
      item.id;

    openButton.type =
      "button";

    openButton.className =
      "history-item";

    openButton.dataset.conversationId =
      item.id;

    openButton.title =
      item.title;

    openButton.classList.toggle(
      "active",
      item.id ===
        activeConversationId
    );

    if (
      item.id ===
      activeConversationId
    ) {
      openButton.setAttribute(
        "aria-current",
        "true"
      );
    }

    title.className =
      "history-item-title";

    title.textContent =
      item.title;

    openButton.appendChild(title);

    if (item.is_pinned) {
      const pin =
        document.createElement("span");

      pin.className =
        "history-pin-icon";

      pin.setAttribute(
        "aria-label",
        "Pinned"
      );

      pin.innerHTML =
        '<i data-lucide="pin" width="12" height="12" aria-hidden="true"></i>';

      openButton.appendChild(pin);
    }

    openButton.addEventListener(
      "click",
      () => {
        void openConversation(
          item.id
        ).catch(handleError);
      }
    );

    menuButton.type =
      "button";

    menuButton.className =
      "history-three-dot";

    menuButton.setAttribute(
      "aria-label",
      "Conversation options"
    );

    menuButton.innerHTML =
      '<i data-lucide="more-vertical" width="16" height="16" aria-hidden="true"></i>';

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

    wrapper.addEventListener(
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

    wrapper.append(
      openButton,
      menuButton
    );

    return wrapper;
  }

  function render() {
    historyList.replaceChildren();

    if (!conversations.length) {
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

    for (const item of conversations) {
      fragment.appendChild(
        createHistoryRow(item)
      );
    }

    historyList.appendChild(fragment);

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

    return true;
  }

  async function performLoad() {
    renderLoading();

    try {
      const data =
        await request();

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

      render();

      emit(
        "neyo:history-loaded",
        {
          conversations:
            cloneConversations()
        }
      );

      return cloneConversations();

    } catch (error) {
      conversations = [];

      render();

      emit(
        "neyo:history-error",
        { error }
      );

      throw error;
    }
  }

  async function load() {
    if (loadingPromise) {
      return loadingPromise;
    }

    loadingPromise =
      performLoad();

    try {
      return await loadingPromise;
    } finally {
      loadingPromise = null;
    }
  }

  async function fetchConversation(
    conversationId
  ) {
    const id =
      clean(
        conversationId,
        128
      );

    if (!id) return null;

    const data =
      await request({
        action: "get",
        conversationId: id
      });

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

  async function openConversation(
    conversationId
  ) {
    const id =
      clean(
        conversationId,
        128
      );

    if (!id) return null;

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
        await fetchConversation(id);

      if (
        serial !== openSerial ||
        !conversation
      ) {
        return null;
      }

      activeConversationId =
        id;

      render();

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

    } catch (error) {
      if (serial === openSerial) {
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

  async function action(
    actionName,
    conversationId,
    payload = {}
  ) {
    const id =
      clean(
        conversationId,
        128
      );

    if (!id) return null;

    return request({
      action:
        actionName,

      conversationId:
        id,

      ...payload
    });
  }

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
        100
      );

    if (
      !id ||
      !nextTitle
    ) {
      return false;
    }

    await action(
      "rename",
      id,
      {
        title:
          nextTitle
      }
    );

    const item =
      conversations.find(
        conversation =>
          conversation.id === id
      );

    if (item) {
      item.title =
        nextTitle;

      render();
    } else {
      await load();
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

  async function deleteConversation(
    conversationId
  ) {
    const id =
      clean(
        conversationId,
        128
      );

    if (!id) return false;

    await action(
      "delete",
      id
    );

    const wasActive =
      activeConversationId ===
      id;

    conversations =
      conversations.filter(
        item =>
          item.id !== id
      );

    if (wasActive) {
      activeConversationId =
        null;

      openSerial++;

      emit(
        "neyo:chat-new-request"
      );
    }

    render();

    emit(
      "neyo:history-deleted",
      {
        conversationId:
          id
      }
    );

    return true;
  }

  async function setPinned(
    conversationId,
    pinned
  ) {
    const id =
      clean(
        conversationId,
        128
      );

    if (!id) return false;

    const value =
      Boolean(pinned);

    await action(
      value
        ? "pin"
        : "unpin",
      id
    );

    const item =
      conversations.find(
        conversation =>
          conversation.id === id
      );

    if (item) {
      item.is_pinned =
        value;

      render();
    } else {
      await load();
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

  function setActive(
    conversationId
  ) {
    activeConversationId =
      clean(
        conversationId,
        128
      ) ||
      null;

    render();

    return true;
  }

  function handleError(
    error,
    detail = {}
  ) {
    console.warn(
      "[NEYO History]",
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

  window.addEventListener(
    "neyo:history-load-request",
    () => {
      void load().catch(
        handleError
      );
    }
  );

  window.addEventListener(
    "neyo:history-refresh-request",
    () => {
      void load().catch(
        handleError
      );
    }
  );

  window.addEventListener(
    "neyo:conversation-open-request",
    event => {
      void openConversation(
        event.detail
          ?.conversationId
      ).catch(handleError);
    }
  );

  window.addEventListener(
    "neyo:history-rename-request",
    event => {
      void renameConversation(
        event.detail
          ?.conversationId,

        event.detail
          ?.title
      ).catch(handleError);
    }
  );

  window.addEventListener(
    "neyo:history-delete-request",
    event => {
      void deleteConversation(
        event.detail
          ?.conversationId
      ).catch(handleError);
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
      ).catch(handleError);
    }
  );

  window.addEventListener(
    "neyo:history-active-set",
    event => {
      setActive(
        event.detail
          ?.conversationId
      );
    }
  );

  window.addEventListener(
    "neyo:chat-state-loaded",
    event => {
      setActive(
        event.detail
          ?.conversationId
      );
    }
  );

  window.addEventListener(
    "neyo:chat-new",
    () => {
      activeConversationId =
        null;

      openSerial++;

      render();
    }
  );

  const api = Object.freeze({
    __controller: true,
    version: VERSION,
    active: true,

    load,
    render,
    open: openConversation,
    fetchConversation,

    rename:
      renameConversation,

    delete:
      deleteConversation,

    setPinned,
    setActive,

    getActive() {
      return activeConversationId;
    },

    getConversations() {
      return cloneConversations();
    },

    getById(id) {
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

      return cloneConversation(item);
    },

    getState() {
      return {
        version: VERSION,
        active: true,
        activeConversationId,
        count:
          conversations.length,
        loading:
          Boolean(
            loadingPromise
          ),
        opening:
          openSerial
      };
    }
  });

  Object.defineProperty(
    window,
    "NeyoHistory",
    {
      value: api,
      writable: false,
      configurable: true,
      enumerable: true
    }
  );

  emit(
    "neyo:history-ready",
    {
      version: VERSION,
      active: true
    }
  );

  void load().catch(
    error => {
      console.warn(
        "[NEYO History] Initial load failed:",
        error
      );
    }
  );
})();
