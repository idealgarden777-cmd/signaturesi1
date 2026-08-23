(() => {
  "use strict";

  const VERSION = "neyo-chat-runtime-v4";

  if (window.NeyoChatRuntime?.__controller === true) return;

  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const newChatBtn = document.getElementById("newChatBtn");

  const REQUIRED = [
    "NeyoChat",
    "NeyoMessages",
    "NeyoMessageRenderer",
    "NeyoAttachments",
    "NeyoSendState"
  ];

  const state = {
    active: false,
    ready: false,
    activating: false,
    reason: null,
    activatedAt: null,
    routedSends: 0,
    routedStops: 0,
    routedNewChats: 0
  };

  function emit(name, detail = {}) {
    window.dispatchEvent(
      new CustomEvent(name, {
        detail
      })
    );
  }

  function getMissingModules() {
    return REQUIRED.filter(name => !window[name]);
  }

  function validate() {
    const missing = getMissingModules();

    if (missing.length) {
      return {
        valid: false,
        reason: `Missing modules: ${missing.join(", ")}`
      };
    }

    if (typeof window.NeyoChat?.send !== "function") {
      return {
        valid: false,
        reason: "NeyoChat.send() unavailable."
      };
    }

    if (typeof window.NeyoChat?.stop !== "function") {
      return {
        valid: false,
        reason: "NeyoChat.stop() unavailable."
      };
    }

    if (typeof window.NeyoSendState?.send !== "function") {
      return {
        valid: false,
        reason: "NeyoSendState.send() unavailable."
      };
    }

    if (typeof window.NeyoSendState?.stop !== "function") {
      return {
        valid: false,
        reason: "NeyoSendState.stop() unavailable."
      };
    }

    if (typeof window.NeyoAttachments?.getReady !== "function") {
      return {
        valid: false,
        reason: "NeyoAttachments.getReady() unavailable."
      };
    }

    if (!window.NeyoMessages) {
      return {
        valid: false,
        reason: "NeyoMessages unavailable."
      };
    }

    if (
      typeof window.NeyoMessageRenderer?.render !== "function" &&
      typeof window.NeyoMessageRenderer?.renderInto !== "function"
    ) {
      return {
        valid: false,
        reason: "NeyoMessageRenderer unavailable."
      };
    }

    return {
      valid: true,
      reason: null
    };
  }

  async function waitForDependencies(timeout = 8000) {
    const started = Date.now();

    while (Date.now() - started < timeout) {
      const result = validate();

      if (result.valid) return result;

      await new Promise(resolve =>
        window.setTimeout(resolve, 50)
      );
    }

    return validate();
  }

  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function isSendButton(target) {
    return (
      target instanceof Element &&
      Boolean(target.closest("#sendBtn"))
    );
  }

  function isNewChatButton(target) {
    return (
      target instanceof Element &&
      Boolean(target.closest("#newChatBtn"))
    );
  }

  function getPromptButton(target) {
    if (!(target instanceof Element)) return null;
    return target.closest("[data-prompt]");
  }

  function routeSend() {
    if (!state.active) return false;

    const sendState = window.NeyoSendState;

    if (!sendState) return false;

    let generating = false;

    try {
      generating =
        Boolean(
          sendState
            .getState?.()
            ?.generating
        );
    } catch {}

    if (generating) {
      const stopped =
        Boolean(
          sendState.stop()
        );

      if (stopped) {
        state.routedStops++;
      }

      return stopped;
    }

    const sent =
      Boolean(
        sendState.send()
      );

    if (sent) {
      state.routedSends++;
    }

    return sent;
  }

  function routeNewChat() {
    if (!state.active) return false;

    emit("neyo:chat-new-request");

    state.routedNewChats++;

    return true;
  }

  function routePrompt(prompt) {
    if (
      !state.active ||
      !chatInput
    ) {
      return false;
    }

    const text =
      String(prompt || "")
        .trim();

    if (!text) return false;

    chatInput.value = text;

    chatInput.dispatchEvent(
      new Event("input", {
        bubbles: true
      })
    );

    return routeSend();
  }

  function handleClick(event) {
    if (!state.active) return;

    if (isSendButton(event.target)) {
      consume(event);
      routeSend();
      return;
    }

    if (isNewChatButton(event.target)) {
      consume(event);
      routeNewChat();
      return;
    }

    const promptButton =
      getPromptButton(
        event.target
      );

    if (promptButton) {
      const prompt =
        promptButton
          .dataset
          ?.prompt;

      if (!prompt) return;

      consume(event);
      routePrompt(prompt);
    }
  }

  function handleKeyDown(event) {
    if (!state.active) return;

    if (
      event.target !== chatInput ||
      event.key !== "Enter"
    ) {
      return;
    }

    if (
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    if (
      event.isComposing ||
      event.keyCode === 229
    ) {
      return;
    }

    let generating = false;

    try {
      generating =
        Boolean(
          window.NeyoSendState
            ?.getState?.()
            ?.generating
        );
    } catch {}

    consume(event);

    if (generating) {
      return;
    }

    routeSend();
  }

  function bind() {
    document.addEventListener(
      "click",
      handleClick,
      true
    );

    document.addEventListener(
      "keydown",
      handleKeyDown,
      true
    );
  }

  function unbind() {
    document.removeEventListener(
      "click",
      handleClick,
      true
    );

    document.removeEventListener(
      "keydown",
      handleKeyDown,
      true
    );
  }

  function setRuntimeMarker(active) {
    if (active) {
      document.documentElement.setAttribute(
        "data-neyo-chat-runtime",
        "v4"
      );

      document.documentElement.classList.add(
        "neyo-chat-v2"
      );

      return;
    }

    document.documentElement.removeAttribute(
      "data-neyo-chat-runtime"
    );

    document.documentElement.classList.remove(
      "neyo-chat-v2"
    );
  }

  async function activate() {
    if (state.active) return true;
    if (state.activating) return false;

    state.activating = true;

    try {
      const result =
        await waitForDependencies();

      if (!result.valid) {
        state.reason =
          result.reason;

        state.ready = false;
        state.active = false;

        setRuntimeMarker(false);

        emit(
          "neyo:runtime-error",
          {
            version: VERSION,
            reason: result.reason,
            missingModules:
              getMissingModules()
          }
        );

        console.error(
          "[NEYO Runtime]",
          result.reason
        );

        return false;
      }

      bind();

      state.active = true;
      state.ready = true;
      state.reason = null;
      state.activatedAt =
        Date.now();

      setRuntimeMarker(true);

      emit(
        "neyo:chat-state-sync-request"
      );

      emit(
        "neyo:runtime-ready",
        {
          version: VERSION,
          active: true,
          mode: "safe-hybrid"
        }
      );

      console.log(
        "[NEYO Runtime] READY",
        VERSION
      );

      return true;

    } catch (error) {
      state.active = false;
      state.ready = false;
      state.reason =
        error?.message ||
        "Runtime activation failed.";

      setRuntimeMarker(false);

      console.error(
        "[NEYO Runtime]",
        error
      );

      return false;

    } finally {
      state.activating = false;
    }
  }

  function deactivate(
    reason = "Runtime disabled."
  ) {
    unbind();

    state.active = false;
    state.ready = false;
    state.reason = reason;

    setRuntimeMarker(false);

    emit(
      "neyo:runtime-disabled",
      {
        version: VERSION,
        reason
      }
    );

    return true;
  }

  const api = Object.freeze({
    __controller: true,
    version: VERSION,

    activate,
    deactivate,

    send: routeSend,
    newChat: routeNewChat,

    check: validate,

    isActive() {
      return state.active;
    },

    getState() {
      return {
        version: VERSION,
        active: state.active,
        ready: state.ready,
        activating: state.activating,
        reason: state.reason,
        missingModules:
          getMissingModules(),
        routedSends:
          state.routedSends,
        routedStops:
          state.routedStops,
        routedNewChats:
          state.routedNewChats,
        activatedAt:
          state.activatedAt
      };
    }
  });

  Object.defineProperty(
    window,
    "NeyoChatRuntime",
    {
      value: api,
      writable: false,
      configurable: true,
      enumerable: true
    }
  );

  void activate();
})();
