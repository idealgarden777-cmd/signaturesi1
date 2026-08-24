/*
=========================================================
NEO — SEND COMPATIBILITY FACADE
Production v1

Purpose:
Keep the old window.NeyoSend API available without
creating a second send implementation.

Canonical ownership:
- send-state.js → Send / Stop UI + keyboard
- chat.js       → network + conversation
- attachments.js→ attachment lifecycle

This file owns NO DOM and NO network request.
=========================================================
*/

(() => {
  "use strict";

  const VERSION = "neo-send-production-v1";

  if (window.NeyoSend?.__controller === true) return;

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    lifecycleActive: false,
    sends: 0,
    stops: 0,
    failures: 0
  };

  /* =====================================================
     HELPERS
     ===================================================== */

  function emit(name, detail = {}) {
    window.dispatchEvent(
      new CustomEvent(name, { detail })
    );
  }

  function controller() {
    const value =
      window.NeyoSendState;

    return (
      value &&
      value.__controller === true
    )
      ? value
      : null;
  }

  function getControllerState() {
    try {
      return (
        controller()
          ?.getState
          ?.() ||
        null
      );
    } catch {
      return null;
    }
  }

  /* =====================================================
     SEND

     Never:
     - reads #chatInput
     - reads files
     - emits neyo:chat-send-request itself
     - calls NeyoChat.send()
     ===================================================== */

  function send() {
    const sendState =
      controller();

    if (!sendState) {
      state.failures += 1;

      emit(
        "neyo:send-unavailable",
        {
          reason:
            "send-state-unavailable"
        }
      );

      return false;
    }

    try {
      let result = false;

      if (
        typeof sendState.requestSend ===
        "function"
      ) {
        result =
          sendState.requestSend();

      } else if (
        typeof sendState.send ===
        "function"
      ) {
        result =
          sendState.send();
      }

      if (result) {
        state.sends += 1;
      }

      return result;

    } catch (error) {
      state.failures += 1;

      console.error(
        "[NEO Send] Send delegation failed:",
        error
      );

      emit(
        "neyo:send-error",
        {
          error,
          source:
            "send-facade"
        }
      );

      return false;
    }
  }

  /* =====================================================
     STOP
     ===================================================== */

  function stop(
    reason =
      "send-facade"
  ) {
    const sendState =
      controller();

    if (!sendState) {
      state.failures += 1;

      return false;
    }

    try {
      let result = false;

      if (
        typeof sendState.stop ===
        "function"
      ) {
        result =
          sendState.stop(reason);
      }

      if (result) {
        state.stops += 1;
      }

      return result;

    } catch (error) {
      state.failures += 1;

      console.error(
        "[NEO Send] Stop delegation failed:",
        error
      );

      return false;
    }
  }

  /* =====================================================
     REFRESH

     Compatibility for older modules that called:
     NeyoSend.refresh()
     ===================================================== */

  function refresh() {
    const sendState =
      controller();

    if (!sendState) {
      return false;
    }

    try {
      if (
        typeof sendState.refresh ===
        "function"
      ) {
        return sendState.refresh();
      }

      if (
        typeof sendState.update ===
        "function"
      ) {
        return sendState.update();
      }

    } catch (error) {
      console.warn(
        "[NEO Send] Refresh failed:",
        error
      );
    }

    return false;
  }

  /* =====================================================
     STATE HELPERS
     ===================================================== */

  function canSend() {
    try {
      return Boolean(
        controller()
          ?.canSend
          ?.()
      );
    } catch {
      return false;
    }
  }

  function isGenerating() {
    const current =
      getControllerState();

    return Boolean(
      current?.generating
    );
  }

  function isSending() {
    const current =
      getControllerState();

    return Boolean(
      current?.sending
    );
  }

  /* =====================================================
     LEGACY PROGRAMMATIC REQUESTS

     Old modules may still dispatch these.
     They now route through the canonical SendState owner.
     ===================================================== */

  window.addEventListener(
    "neyo:send-request",
    () => {
      send();
    }
  );

  window.addEventListener(
    "neyo:send-stop-request",
    event => {
      stop(
        event.detail?.reason ||
        "legacy-send-stop-request"
      );
    }
  );

  /* =====================================================
     LIFECYCLE COMPATIBILITY

     Preserve older observers without creating another
     transport pipeline.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    event => {
      if (state.lifecycleActive) {
        return;
      }

      state.lifecycleActive =
        true;

      emit(
        "neyo:send-start",
        {
          ...(event.detail || {}),
          compatibility: true
        }
      );
    }
  );

  window.addEventListener(
    "neyo:chat-response",
    event => {
      if (!state.lifecycleActive) {
        return;
      }

      emit(
        "neyo:send-success",
        {
          ...(event.detail || {}),
          compatibility: true
        }
      );
    }
  );

  window.addEventListener(
    "neyo:chat-error",
    event => {
      if (!state.lifecycleActive) {
        return;
      }

      emit(
        "neyo:send-error",
        {
          ...(event.detail || {}),
          compatibility: true
        }
      );
    }
  );

  /*
   * chat-send-end is the single lifecycle closer.
   *
   * We intentionally do not emit send-end separately for
   * response/error/abort because chat.js ultimately emits
   * its canonical send-end lifecycle.
   */

  window.addEventListener(
    "neyo:chat-send-end",
    event => {
      if (!state.lifecycleActive) {
        return;
      }

      state.lifecycleActive =
        false;

      emit(
        "neyo:send-end",
        {
          ...(event.detail || {}),
          compatibility: true
        }
      );
    }
  );

  /* =====================================================
     RESET
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      state.lifecycleActive =
        false;
    }
  );

  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({
      __controller: true,
      version: VERSION,

      /*
       * Compatibility façade marker.
       */

      facade: true,
      active: true,

      send,
      request: send,

      stop,

      refresh,
      update: refresh,

      canSend,
      isGenerating,
      isSending,

      getState() {
        return {
          version: VERSION,

          active: true,
          facade: true,

          canonicalOwner:
            controller()
              ? "NeyoSendState"
              : null,

          lifecycleActive:
            state.lifecycleActive,

          canSend:
            canSend(),

          generating:
            isGenerating(),

          sending:
            isSending(),

          controller:
            getControllerState(),

          metrics: {
            sends:
              state.sends,

            stops:
              state.stops,

            failures:
              state.failures
          }
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoSend",
    {
      value: api,
      writable: false,
      configurable: true,
      enumerable: true
    }
  );

  /* =====================================================
     READY
     ===================================================== */

  emit(
    "neyo:send-ready",
    {
      version: VERSION,

      facade: true,

      canonicalOwner:
        controller()
          ? "NeyoSendState"
          : null
    }
  );
})();
