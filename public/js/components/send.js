/*
=========================================================
NEO — SEND COMPATIBILITY FACADE
Production v2 — Thin Bridge

Purpose:
- Preserve window.NeyoSend compatibility
- Delegate Send / Stop to NeyoSendState
- Provide a stable compatibility surface while old code
  and newer modular code coexist

Owns:
- Compatibility API only

Does NOT own:
- #sendBtn
- #chatInput
- Enter / Shift+Enter
- Send / Stop visual state
- /api/chat
- AbortController
- Conversation state
- Attachment upload
- Attachment cleanup
- Composer clearing
- Message rendering
- Topbar / model selector
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-send-facade-production-v2";

  if (
    window.NeyoSend
      ?.__controller === true
  ) {
    return;
  }

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
     CONTROLLER
     ===================================================== */

  function controller() {
    const value =
      window.NeyoSendState;

    if (
      value &&
      typeof value === "object" &&
      value.__controller === true
    ) {
      return value;
    }

    return null;
  }

  /* =====================================================
     SEND
     ===================================================== */

  function send() {
    const owner =
      controller();

    if (!owner) {
      emit(
        "neyo:send-facade-error",
        {
          action:
            "send",

          reason:
            "send-state-unavailable"
        }
      );

      return false;
    }

    try {
      if (
        typeof owner.send ===
        "function"
      ) {
        return (
          owner.send() !==
          false
        );
      }

      if (
        typeof owner.requestSend ===
        "function"
      ) {
        return (
          owner.requestSend() !==
          false
        );
      }

    } catch (error) {
      console.error(
        "[NEO Send] Send delegation failed:",
        error
      );

      emit(
        "neyo:send-facade-error",
        {
          action:
            "send",

          reason:
            "delegation-failed",

          error
        }
      );

      return false;
    }

    return false;
  }

  /* =====================================================
     STOP
     ===================================================== */

  function stop() {
    const owner =
      controller();

    if (!owner) {
      emit(
        "neyo:send-facade-error",
        {
          action:
            "stop",

          reason:
            "send-state-unavailable"
        }
      );

      return false;
    }

    try {
      if (
        typeof owner.stop ===
        "function"
      ) {
        return (
          owner.stop() !==
          false
        );
      }

      if (
        typeof owner.requestStop ===
        "function"
      ) {
        return (
          owner.requestStop() !==
          false
        );
      }

    } catch (error) {
      console.error(
        "[NEO Send] Stop delegation failed:",
        error
      );

      emit(
        "neyo:send-facade-error",
        {
          action:
            "stop",

          reason:
            "delegation-failed",

          error
        }
      );

      return false;
    }

    return false;
  }

  /* =====================================================
     REQUEST SEND
     ===================================================== */

  function requestSend() {
    const owner =
      controller();

    if (!owner) {
      return false;
    }

    try {
      if (
        typeof owner.requestSend ===
        "function"
      ) {
        return (
          owner.requestSend() !==
          false
        );
      }

      return send();

    } catch (error) {
      console.error(
        "[NEO Send] requestSend failed:",
        error
      );

      return false;
    }
  }

  /* =====================================================
     REQUEST STOP
     ===================================================== */

  function requestStop() {
    const owner =
      controller();

    if (!owner) {
      return false;
    }

    try {
      if (
        typeof owner.requestStop ===
        "function"
      ) {
        return (
          owner.requestStop() !==
          false
        );
      }

      return stop();

    } catch (error) {
      console.error(
        "[NEO Send] requestStop failed:",
        error
      );

      return false;
    }
  }

  /* =====================================================
     CAN SEND
     ===================================================== */

  function canSend() {
    const owner =
      controller();

    if (!owner) {
      return false;
    }

    try {
      if (
        typeof owner.canSend ===
        "function"
      ) {
        return Boolean(
          owner.canSend()
        );
      }

      return false;

    } catch {
      return false;
    }
  }

  /* =====================================================
     REFRESH
     ===================================================== */

  function refresh() {
    const owner =
      controller();

    if (!owner) {
      return false;
    }

    try {
      if (
        typeof owner.refresh ===
        "function"
      ) {
        return (
          owner.refresh() !==
          false
        );
      }

      if (
        typeof owner.update ===
        "function"
      ) {
        return (
          owner.update() !==
          false
        );
      }

    } catch (error) {
      console.error(
        "[NEO Send] Refresh delegation failed:",
        error
      );

      return false;
    }

    return false;
  }

  /* =====================================================
     GENERATION STATE
     ===================================================== */

  function isGenerating() {
    const owner =
      controller();

    if (!owner) {
      return false;
    }

    try {
      if (
        typeof owner.isGenerating ===
        "function"
      ) {
        return Boolean(
          owner.isGenerating()
        );
      }

      const state =
        owner.getState?.();

      return Boolean(
        state?.generating
      );

    } catch {
      return false;
    }
  }

  /* =====================================================
     STATE
     ===================================================== */

  function getState() {
    const owner =
      controller();

    let ownerState = null;

    try {
      ownerState =
        owner?.getState?.() ||
        null;
    } catch {}

    return {
      version:
        VERSION,

      active:
        Boolean(owner),

      delegated:
        true,

      owner:
        owner
          ? "NeyoSendState"
          : null,

      canSend:
        canSend(),

      generating:
        isGenerating(),

      ownerState
    };
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

      /*
       * Main compatibility names
       */

      send,

      sendMessage:
        send,

      submit:
        send,

      requestSend,

      /*
       * Stop compatibility
       */

      stop,

      stopGeneration:
        stop,

      requestStop,

      /*
       * State
       */

      canSend,

      isGenerating,

      refresh,

      update:
        refresh,

      getState,

      getOwner() {
        return controller();
      }
    });

  Object.defineProperty(
    window,
    "NeyoSend",
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
     ===================================================== */

  emit(
    "neyo:send-ready",
    {
      version:
        VERSION,

      active:
        true,

      facade:
        true,

      owner:
        controller()
          ? "NeyoSendState"
          : null
    }
  );
})();
