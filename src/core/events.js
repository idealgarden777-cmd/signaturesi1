/**
 * =========================================================
 * NEYO BETA — CORE EVENT BUS
 * =========================================================
 *
 * Owns:
 * - App-wide custom events
 * - Subscribe / unsubscribe
 * - One-time listeners
 * - Safe event dispatch
 * - Listener cleanup
 *
 * Does NOT own:
 * - DOM component logic
 * - Feature state
 * - API requests
 * - Business logic
 *
 * Rule:
 * Features communicate through named events instead of
 * directly controlling unrelated modules.
 * =========================================================
 */

import { APP_EVENT } from "@core/constants.js";
import { captureError } from "@core/errors.js";

/* =========================================================
   INTERNAL BUS
   ========================================================= */

const bus = new EventTarget();

/* =========================================================
   VALIDATION
   ========================================================= */

const validateEventName = (eventName) => {
  if (
    typeof eventName !== "string" ||
    !eventName.trim()
  ) {
    throw new TypeError(
      "[Neyo Events] Event name must be a non-empty string."
    );
  }

  return eventName.trim();
};

const validateHandler = (handler) => {
  if (typeof handler !== "function") {
    throw new TypeError(
      "[Neyo Events] Event handler must be a function."
    );
  }

  return handler;
};

/* =========================================================
   EMIT
   ========================================================= */

export const emit = (
  eventName,
  detail = null
) => {
  const name =
    validateEventName(eventName);

  try {
    const event = new CustomEvent(
      name,
      {
        detail
      }
    );

    return bus.dispatchEvent(event);
  } catch (error) {
    captureError(error, {
      source: "events",
      operation: "emit",
      eventName: name
    });

    return false;
  }
};

/* =========================================================
   SUBSCRIBE
   ========================================================= */

export const on = (
  eventName,
  handler,
  options = {}
) => {
  const name =
    validateEventName(eventName);

  validateHandler(handler);

  const {
    once = false,
    signal = null
  } = options;

  const wrappedHandler = (event) => {
    try {
      handler(
        event.detail,
        event
      );
    } catch (error) {
      captureError(error, {
        source: "events",
        operation: "handler",
        eventName: name
      });
    }
  };

  bus.addEventListener(
    name,
    wrappedHandler,
    {
      once,
      signal
    }
  );

  return () => {
    bus.removeEventListener(
      name,
      wrappedHandler
    );
  };
};

/* =========================================================
   ONCE
   ========================================================= */

export const once = (
  eventName,
  handler
) => {
  return on(
    eventName,
    handler,
    {
      once: true
    }
  );
};

/* =========================================================
   WAIT FOR EVENT
   ========================================================= */

export const waitFor = (
  eventName,
  {
    timeout = 0,
    signal = null
  } = {}
) => {
  const name =
    validateEventName(eventName);

  return new Promise(
    (resolve, reject) => {
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        bus.removeEventListener(
          name,
          handleEvent
        );

        signal?.removeEventListener(
          "abort",
          handleAbort
        );
      };

      const handleEvent = (event) => {
        cleanup();

        resolve(event.detail);
      };

      const handleAbort = () => {
        cleanup();

        reject(
          new DOMException(
            "Event wait aborted.",
            "AbortError"
          )
        );
      };

      bus.addEventListener(
        name,
        handleEvent,
        {
          once: true
        }
      );

      if (signal) {
        if (signal.aborted) {
          handleAbort();
          return;
        }

        signal.addEventListener(
          "abort",
          handleAbort,
          {
            once: true
          }
        );
      }

      if (
        Number.isFinite(timeout) &&
        timeout > 0
      ) {
        timeoutId = setTimeout(
          () => {
            cleanup();

            reject(
              new Error(
                `[Neyo Events] Timed out waiting for "${name}".`
              )
            );
          },
          timeout
        );
      }
    }
  );
};

/* =========================================================
   EVENT SCOPE
   ========================================================= */

export const createEventScope = () => {
  const controller =
    new AbortController();

  return Object.freeze({
    signal:
      controller.signal,

    on(
      eventName,
      handler,
      options = {}
    ) {
      return on(
        eventName,
        handler,
        {
          ...options,
          signal:
            controller.signal
        }
      );
    },

    once(
      eventName,
      handler
    ) {
      return on(
        eventName,
        handler,
        {
          once: true,
          signal:
            controller.signal
        }
      );
    },

    destroy() {
      controller.abort();
    }
  });
};

/* =========================================================
   KNOWN EVENT CHECK
   ========================================================= */

const knownEvents =
  new Set(
    Object.values(APP_EVENT)
  );

export const isKnownAppEvent = (
  eventName
) => {
  return knownEvents.has(
    eventName
  );
};

/* =========================================================
   SAFE APP EVENT EMIT
   ========================================================= */

export const emitAppEvent = (
  eventName,
  detail = null
) => {
  if (
    !isKnownAppEvent(eventName)
  ) {
    if (import.meta.env.DEV) {
      console.warn(
        `[Neyo Events] Unknown APP_EVENT: ${eventName}`
      );
    }
  }

  return emit(
    eventName,
    detail
  );
};

/* =========================================================
   DEBUG LISTENER
   ========================================================= */

export const enableEventDebug = () => {
  if (!import.meta.env.DEV) {
    return () => {};
  }

  const cleanups = [];

  for (
    const eventName of knownEvents
  ) {
    const cleanup = on(
      eventName,
      (detail) => {
        console.debug(
          `[Neyo Event] ${eventName}`,
          detail
        );
      }
    );

    cleanups.push(cleanup);
  }

  return () => {
    cleanups.forEach(
      (cleanup) => cleanup()
    );
  };
};

/* =========================================================
   PUBLIC EVENT API
   ========================================================= */

export const events = Object.freeze({
  emit,
  emitAppEvent,

  on,
  once,

  waitFor,

  createScope:
    createEventScope,

  isKnown:
    isKnownAppEvent,

  enableDebug:
    enableEventDebug
});

export default events;
