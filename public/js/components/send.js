/*
=========================================================
NEYO — SEND COMPATIBILITY FACADE
FINAL STABLE v5

FILE:
public/js/components/send.js

PURPOSE
---------------------------------------------------------
Keep the old window.NeyoSend public contract without
creating a second Send owner.

CANONICAL OWNERS
---------------------------------------------------------
send-state.js
- #sendBtn click
- Enter / Shift+Enter
- Send ↔ Stop visual state
- attachment readiness/error gating
- neyo:chat-send-request / neyo:chat-stop-request

chat.js
- conversation state
- /api/chat
- request lifecycle / abort

attachments.js
- attachment selection/upload/process state

chat-runtime.js
- legacy action bridge while neo.js is still loaded

THIS FILE OWNS ONLY
---------------------------------------------------------
- window.NeyoSend compatibility API
- programmatic send/stop delegation
- legacy neyo:send-request bridge
- legacy neyo:send-* lifecycle aliases
- read-only diagnostics

THIS FILE MUST NOT
---------------------------------------------------------
- bind #sendBtn
- bind Enter
- upload files
- clear composer text
- clear attachments
- call /api/chat
- mutate conversation
- modify top bar/model picker/UI

WHY
---------------------------------------------------------
The old send.js duplicated send-state.js and could cause
multiple sends, multiple uploads, or multiple resets.
This version removes only that conflict and preserves the
public compatibility surface.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-send-facade-final-v5";

  if (
    window.NeyoSend
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     LEGACY TELEMETRY
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

  let delegating =
    false;

  let lifecycleOpen =
    false;

  let lastRequestAt =
    0;

  let lastResult =
    null;

  const metrics = {
    sendRequests:
      0,

    stopRequests:
      0,

    delegatedToSendState:
      0,

    unavailableRequests:
      0,

    duplicateRequestsBlocked:
      0,

    refreshes:
      0,

    lifecycleStarts:
      0,

    lifecycleSuccesses:
      0,

    lifecycleErrors:
      0,

    lifecycleEnds:
      0,

    lastRequestedAt:
      null
  };

  /* =====================================================
     EVENT
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
     CONTROLLERS
     ===================================================== */

  function getSendState() {
    const value =
      window.NeyoSendState;

    return (
      value &&
      typeof value ===
        "object"
    )
      ? value
      : null;
  }

  function getChat() {
    const value =
      window.NeyoChat;

    return (
      value &&
      typeof value ===
        "object"
    )
      ? value
      : null;
  }

  /* =====================================================
     SEND STATE SNAPSHOT
     ===================================================== */

  function getSendStateSnapshot() {
    try {
      const state =
        getSendState()
          ?.getState
          ?.();

      return (
        state &&
        typeof state ===
          "object"
      )
        ? state
        : null;

    } catch {
      return null;
    }
  }

  /* =====================================================
     CAN SEND
     ===================================================== */

  function canSend() {
    const controller =
      getSendState();

    if (
      !controller
    ) {
      return false;
    }

    try {
      if (
        typeof controller
          .canSend ===
        "function"
      ) {
        return Boolean(
          controller.canSend()
        );
      }

      const state =
        controller
          .getState
          ?.();

      if (
        typeof state
          ?.canSend ===
        "boolean"
      ) {
        return state.canSend;
      }

    } catch {}

    return false;
  }

  /* =====================================================
     GENERATING
     ===================================================== */

  function isGenerating() {
    const state =
      getSendStateSnapshot();

    if (
      typeof state
        ?.generating ===
      "boolean"
    ) {
      return state.generating;
    }

    try {
      return Boolean(
        getChat()
          ?.isGenerating
          ?.()
      );

    } catch {
      return false;
    }
  }

  /* =====================================================
     SEND

     IMPORTANT:
     No direct NeyoChat.send().
     No upload.
     No input clearing.
     No attachment clearing.

     Everything goes through NeyoSendState.
     ===================================================== */

  function send() {
    const now =
      performance.now();

    if (
      delegating &&
      now -
        lastRequestAt <
        160
    ) {
      metrics
        .duplicateRequestsBlocked +=
        1;

      return false;
    }

    lastRequestAt =
      now;

    delegating =
      true;

    metrics.sendRequests +=
      1;

    metrics.lastRequestedAt =
      Date.now();

    try {
      const controller =
        getSendState();

      if (
        !controller
      ) {
        metrics
          .unavailableRequests +=
          1;

        emit(
          "neyo:send-unavailable",
          {
            reason:
              "send-state-missing",

            message:
              "Send controller is not ready."
          }
        );

        return false;
      }

      let result;

      /*
       * Current final send-state API.
       */

      if (
        typeof controller
          .requestSend ===
        "function"
      ) {
        result =
          controller
            .requestSend();
      }

      /*
       * Compatibility with versions exposing .send().
       */

      else if (
        typeof controller
          .send ===
        "function"
      ) {
        result =
          controller.send();
      }

      else {
        metrics
          .unavailableRequests +=
          1;

        emit(
          "neyo:send-unavailable",
          {
            reason:
              "send-method-missing",

            message:
              "Send controller is not ready."
          }
        );

        return false;
      }

      metrics
        .delegatedToSendState +=
        1;

      lastResult =
        result ??
        null;

      emit(
        "neyo:send-delegated",
        {
          accepted:
            Boolean(
              result
            ),

          source:
            "NeyoSend"
        }
      );

      return result;

    } catch (
      error
    ) {
      console.error(
        "[NEYO Send] Delegation failed:",
        error
      );

      emit(
        "neyo:send-facade-error",
        {
          error,

          message:
            error?.message ||
            "Send delegation failed."
        }
      );

      return false;

    } finally {
      queueMicrotask(
        () => {
          delegating =
            false;
        }
      );
    }
  }

  /* =====================================================
     STOP
     ===================================================== */

  function stop(
    reason =
      "send-facade-stop"
  ) {
    metrics.stopRequests +=
      1;

    const controller =
      getSendState();

    try {
      if (
        typeof controller
          ?.stop ===
        "function"
      ) {
        return Boolean(
          controller.stop(
            reason
          )
        );
      }

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Send] Send-state stop failed:",
        error
      );
    }

    /*
     * Canonical stop fallback.
     *
     * chat.js already consumes this event.
     */

    emit(
      "neyo:chat-stop-request",
      {
        reason,

        source:
          "NeyoSend"
      }
    );

    return true;
  }

  /* =====================================================
     REFRESH

     app-init.js / older modules can keep calling
     NeyoSend.refresh().

     Actual button rendering remains send-state.js.
     ===================================================== */

  function refresh() {
    metrics.refreshes +=
      1;

    const controller =
      getSendState();

    try {
      if (
        typeof controller
          ?.update ===
        "function"
      ) {
        controller.update();

        return true;
      }

      if (
        typeof controller
          ?.refresh ===
        "function"
      ) {
        controller.refresh();

        return true;
      }

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Send] Refresh failed:",
        error
      );
    }

    return false;
  }

  /* =====================================================
     LEGACY PROGRAMMATIC REQUEST

     Preserve:
       window.dispatchEvent(
         new CustomEvent("neyo:send-request")
       )

     But route it through the canonical send owner.
     ===================================================== */

  window.addEventListener(
    "neyo:send-request",
    () => {
      send();
    }
  );

  /* =====================================================
     LEGACY STOP REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:send-stop-request",
    event => {
      stop(
        event.detail
          ?.reason ||
        "send-stop-request"
      );
    }
  );

  /* =====================================================
     LEGACY SEND LIFECYCLE ALIASES

     Old observers may expect:
     - neyo:send-start
     - neyo:send-success
     - neyo:send-error
     - neyo:send-end

     We preserve those events WITHOUT owning transport.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-start",
    event => {
      /*
       * Avoid duplicate lifecycle starts.
       */

      if (
        lifecycleOpen
      ) {
        return;
      }

      lifecycleOpen =
        true;

      metrics.lifecycleStarts +=
        1;

      emit(
        "neyo:send-start",
        {
          ...(
            event.detail ||
            {}
          ),

          compatibility:
            true
        }
      );
    }
  );

  /* =====================================================
     SUCCESS ALIAS
     ===================================================== */

  window.addEventListener(
    "neyo:chat-response",
    event => {
      if (
        !lifecycleOpen
      ) {
        return;
      }

      metrics.lifecycleSuccesses +=
        1;

      emit(
        "neyo:send-success",
        {
          ...(
            event.detail ||
            {}
          ),

          compatibility:
            true
        }
      );
    }
  );

  /* =====================================================
     ERROR ALIAS
     ===================================================== */

  window.addEventListener(
    "neyo:chat-error",
    event => {
      if (
        !lifecycleOpen
      ) {
        return;
      }

      metrics.lifecycleErrors +=
        1;

      emit(
        "neyo:send-error",
        {
          ...(
            event.detail ||
            {}
          ),

          compatibility:
            true
        }
      );
    }
  );

  /* =====================================================
     END ALIAS

     Only chat-send-end closes the compatibility cycle,
     avoiding duplicate send-end events from abort/error.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-end",
    event => {
      if (
        !lifecycleOpen
      ) {
        return;
      }

      lifecycleOpen =
        false;

      metrics.lifecycleEnds +=
        1;

      emit(
        "neyo:send-end",
        {
          ...(
            event.detail ||
            {}
          ),

          compatibility:
            true
        }
      );
    }
  );

  /* =====================================================
     NEW CHAT CLEANUP
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      lifecycleOpen =
        false;

      delegating =
        false;
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

      compatibilityFacade:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      /*
       * Compatibility methods
       */

      send,

      request:
        send,

      stop,

      refresh,

      canSend,

      isGenerating,

      isSending() {
        return delegating;
      },

      /*
       * Diagnostics
       */

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          compatibilityFacade:
            true,

          canonicalOwner:
            getSendState()
              ? "NeyoSendState"
              : null,

          delegating,

          lifecycleOpen,

          generating:
            isGenerating(),

          canSend:
            canSend(),

          lastResult,

          legacyScriptPresent,

          legacyOwnerActive:
            false,

          ownerState:
            getSendStateSnapshot(),

          metrics: {
            ...metrics
          }
        };
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
    "neyo:send-facade-ready",
    {
      version:
        VERSION,

      active:
        true,

      compatibilityFacade:
        true,

      canonicalOwner:
        getSendState()
          ? "NeyoSendState"
          : null,

      legacyScriptPresent,

      legacyOwnerActive:
        false
    }
  );
})();
