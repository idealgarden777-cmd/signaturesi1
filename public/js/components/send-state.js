(() => {
  "use strict";

  const VERSION = "neyo-send-state-v2";
  if (window.NeyoSendState?.__controller === true) return;

  const sendBtn = document.getElementById("sendBtn");
  const chatInput = document.getElementById("chatInput");

  if (!sendBtn || !chatInput) {
    console.warn("[NEYO Send] Composer DOM missing.");
    return;
  }

  const legacyPresent = Array.from(document.scripts || []).some(script =>
    /(?:^|\/)neo\.js(?:\?|$)/.test(script.src || "")
  );

  const directOwner = !legacyPresent;

  const state = {
    generating: false,
    sending: false,
    composing: false,
    lastSendAt: 0
  };

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function text() {
    return String(chatInput.value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u0000/g, "")
      .trim();
  }

  function attachments() {
    try {
      const value = window.NeyoAttachments?.getAll?.();
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function readyAttachments() {
    try {
      const value = window.NeyoAttachments?.getReady?.();
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function attachmentState() {
    const all = attachments();

    let ready = 0;
    let pending = 0;
    let failed = 0;

    for (const item of all) {
      if (
        item?.ready === true &&
        item?.status === "ready" &&
        item?.path &&
        item?.bucket
      ) {
        ready++;
      } else if (item?.status === "error") {
        failed++;
      } else {
        pending++;
      }
    }

    return {
      total: all.length,
      ready,
      pending,
      failed
    };
  }

  function refreshIcons() {
    try {
      window.lucide?.createIcons?.();
    } catch {}
  }

  function renderSend() {
    sendBtn.innerHTML =
      '<i data-lucide="arrow-up" size="18" aria-hidden="true"></i>';

    sendBtn.classList.remove("is-generating");

    sendBtn.setAttribute("aria-label", "Send message");
    sendBtn.setAttribute("title", "Send message");
    sendBtn.dataset.tooltip = "Send message";

    refreshIcons();
  }

  function renderStop() {
    sendBtn.innerHTML =
      '<i data-lucide="square" size="15" aria-hidden="true"></i>';

    sendBtn.classList.add("is-generating");

    sendBtn.setAttribute("aria-label", "Stop generating");
    sendBtn.setAttribute("title", "Stop generating");
    sendBtn.dataset.tooltip = "Stop generating";

    refreshIcons();
  }

  function canSend() {
    if (state.generating) return true;
    if (state.sending) return false;

    return Boolean(
      text() ||
      readyAttachments().length
    );
  }

  function update() {
    if (state.generating) {
      sendBtn.disabled = false;
      sendBtn.classList.remove("is-disabled", "is-ready");
      sendBtn.setAttribute("aria-busy", "false");
      renderStop();
      return true;
    }

    const enabled = canSend();

    renderSend();

    sendBtn.disabled = !enabled;

    sendBtn.classList.toggle("is-ready", enabled);
    sendBtn.classList.toggle("is-disabled", !enabled);

    if (state.sending) {
      sendBtn.setAttribute("aria-busy", "true");
    } else {
      sendBtn.removeAttribute("aria-busy");
    }

    return enabled;
  }

  function clearText() {
    chatInput.value = "";

    chatInput.dispatchEvent(
      new Event("input", {
        bubbles: true
      })
    );

    try {
      window.NeyoComposer?.refresh?.();
    } catch {}

    try {
      window.NeyoComposerScrollbar?.refresh?.();
    } catch {}
  }

  function removeSent(files) {
    if (!Array.isArray(files)) return;

    const controller = window.NeyoAttachments;

    if (typeof controller?.removeMany === "function") {
      controller.removeMany(files);
      return;
    }

    if (typeof controller?.remove !== "function") return;

    for (const file of files) {
      if (!file?.id) continue;

      try {
        controller.remove(file.id);
      } catch {}
    }
  }

  function stop() {
    if (!state.generating) return false;

    emit("neyo:chat-stop-request");
    return true;
  }

  function send() {
    if (state.generating) {
      return stop();
    }

    if (state.sending) {
      return false;
    }

    const messageText = text();
    const files = readyAttachments();

    if (!messageText && files.length === 0) {
      update();
      return false;
    }

    const now = performance.now();

    if (now - state.lastSendAt < 250) {
      return false;
    }

    state.lastSendAt = now;
    state.sending = true;

    update();

    emit("neyo:chat-send-request", {
      text: messageText,
      attachments: files
    });

    clearText();
    removeSent(files);

    state.sending = false;

    update();

    emit("neyo:composer-message-dispatched", {
      text: messageText,
      attachments: files.map(file => ({ ...file })),
      attachmentCount: files.length
    });

    return true;
  }

  function onClick(event) {
    if (!directOwner) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (state.generating) {
      stop();
    } else {
      send();
    }
  }

  function onKeyDown(event) {
    if (!directOwner) return;
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (
      event.isComposing ||
      state.composing ||
      event.keyCode === 229
    ) {
      return;
    }

    if (state.generating) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    if (!canSend()) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    send();
  }

  function started() {
    state.generating = true;
    state.sending = false;
    update();
  }

  function finished() {
    state.generating = false;
    state.sending = false;
    update();
  }

  if (directOwner) {
    sendBtn.addEventListener("click", onClick, true);

    chatInput.addEventListener(
      "keydown",
      onKeyDown,
      true
    );
  }

  chatInput.addEventListener("compositionstart", () => {
    state.composing = true;
  });

  chatInput.addEventListener("compositionend", () => {
    state.composing = false;
  });

  chatInput.addEventListener("input", update);

  [
    "neyo:attachments-change",
    "neyo:attachment-ready",
    "neyo:attachment-error",
    "neyo:attachment-removed"
  ].forEach(name => {
    window.addEventListener(name, update);
  });

  window.addEventListener("neyo:chat-send-start", started);

  [
    "neyo:chat-send-end",
    "neyo:chat-response",
    "neyo:chat-error",
    "neyo:chat-aborted",
    "neyo:chat-limit-reached",
    "neyo:chat-new",
    "neyo:chat-state-loaded"
  ].forEach(name => {
    window.addEventListener(name, finished);
  });

  const api = Object.freeze({
    __controller: true,
    version: VERSION,
    active: true,
    directOwner,
    legacyOwnerActive: legacyPresent,
    send,
    stop,
    update,
    canSend,

    setGenerating(value) {
      state.generating = Boolean(value);

      if (!state.generating) {
        state.sending = false;
      }

      update();
      return state.generating;
    },

    getState() {
      const files = attachmentState();

      return {
        version: VERSION,
        active: true,
        directOwner,
        legacyOwnerActive: legacyPresent,
        generating: state.generating,
        sending: state.sending,
        composing: state.composing,
        hasText: Boolean(text()),
        attachments: files,
        canSend: canSend()
      };
    }
  });

  Object.defineProperty(
    window,
    "NeyoSendState",
    {
      value: api,
      writable: false,
      configurable: true,
      enumerable: true
    }
  );

  update();

  emit("neyo:send-state-ready", {
    version: VERSION,
    active: true,
    directOwner,
    legacyOwnerActive: legacyPresent
  });
})();
