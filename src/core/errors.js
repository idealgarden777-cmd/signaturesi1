/**
 * =========================================================
 * NEYO BETA — CORE ERROR SYSTEM
 * =========================================================
 *
 * Owns:
 * - Standard application errors
 * - Error normalization
 * - Safe user-facing messages
 * - HTTP error mapping
 * - Abort / timeout detection
 *
 * Does NOT own:
 * - Toast rendering
 * - Logging transport
 * - API request execution
 * - Feature-specific recovery logic
 * =========================================================
 */

import {
  ERROR_CODE,
  HTTP_STATUS
} from "@core/constants.js";

/* =========================================================
   DEFAULT USER MESSAGES
   ========================================================= */

const DEFAULT_MESSAGES = Object.freeze({
  [ERROR_CODE.UNKNOWN]:
    "Something went wrong. Please try again.",

  [ERROR_CODE.NETWORK]:
    "Network connection failed. Check your internet and try again.",

  [ERROR_CODE.TIMEOUT]:
    "The request took too long. Please try again.",

  [ERROR_CODE.ABORTED]:
    "The request was stopped.",

  [ERROR_CODE.UNAUTHORIZED]:
    "Your session has expired. Please sign in again.",

  [ERROR_CODE.FORBIDDEN]:
    "You do not have permission to perform this action.",

  [ERROR_CODE.NOT_FOUND]:
    "The requested resource could not be found.",

  [ERROR_CODE.RATE_LIMITED]:
    "Too many requests. Please try again shortly.",

  [ERROR_CODE.INVALID_INPUT]:
    "Some information is invalid. Please check and try again.",

  [ERROR_CODE.FILE_TOO_LARGE]:
    "This file is larger than the allowed limit.",

  [ERROR_CODE.FILE_TYPE_UNSUPPORTED]:
    "This file type is not supported.",

  [ERROR_CODE.TOO_MANY_ATTACHMENTS]:
    "You have reached the attachment limit.",

  [ERROR_CODE.CHAT_FAILED]:
    "Neyo could not complete this response. Please try again.",

  [ERROR_CODE.STREAM_FAILED]:
    "The response was interrupted. Please try again.",

  [ERROR_CODE.AUTH_FAILED]:
    "Authentication failed. Please try again.",

  [ERROR_CODE.CONFIG_INVALID]:
    "The application is not configured correctly."
});

/* =========================================================
   NEYO ERROR
   ========================================================= */

export class NeyoError extends Error {
  constructor(
    message,
    {
      code = ERROR_CODE.UNKNOWN,
      status = null,
      cause = null,
      details = null,
      userMessage = null,
      retryable = false
    } = {}
  ) {
    super(message || "Unknown Neyo error", {
      cause
    });

    this.name = "NeyoError";

    this.code = code;
    this.status = status;
    this.details = details;
    this.retryable = Boolean(retryable);

    this.userMessage =
      userMessage ||
      DEFAULT_MESSAGES[code] ||
      DEFAULT_MESSAGES[ERROR_CODE.UNKNOWN];

    if (Error.captureStackTrace) {
      Error.captureStackTrace(
        this,
        NeyoError
      );
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      details: this.details,
      retryable: this.retryable
    };
  }
}

/* =========================================================
   ERROR TYPE HELPERS
   ========================================================= */

export const isNeyoError = (error) => {
  return error instanceof NeyoError;
};

export const isAbortError = (error) => {
  if (!error) return false;

  return (
    error.name === "AbortError" ||
    error.code === ERROR_CODE.ABORTED
  );
};

export const isTimeoutError = (error) => {
  if (!error) return false;

  return (
    error.name === "TimeoutError" ||
    error.code === ERROR_CODE.TIMEOUT ||
    error.code === "ETIMEDOUT"
  );
};

export const isNetworkError = (error) => {
  if (!error) return false;

  if (error.code === ERROR_CODE.NETWORK) {
    return true;
  }

  return (
    error instanceof TypeError &&
    /fetch|network|failed/i.test(
      error.message || ""
    )
  );
};

/* =========================================================
   HTTP STATUS MAPPING
   ========================================================= */

export const mapHttpStatusToCode = (status) => {
  switch (status) {
    case HTTP_STATUS.BAD_REQUEST:
      return ERROR_CODE.INVALID_INPUT;

    case HTTP_STATUS.UNAUTHORIZED:
      return ERROR_CODE.UNAUTHORIZED;

    case HTTP_STATUS.FORBIDDEN:
      return ERROR_CODE.FORBIDDEN;

    case HTTP_STATUS.NOT_FOUND:
      return ERROR_CODE.NOT_FOUND;

    case HTTP_STATUS.PAYLOAD_TOO_LARGE:
      return ERROR_CODE.FILE_TOO_LARGE;

    case HTTP_STATUS.TOO_MANY_REQUESTS:
      return ERROR_CODE.RATE_LIMITED;

    case HTTP_STATUS.GATEWAY_TIMEOUT:
      return ERROR_CODE.TIMEOUT;

    default:
      return ERROR_CODE.UNKNOWN;
  }
};

/* =========================================================
   RETRY POLICY
   ========================================================= */

export const isRetryableStatus = (status) => {
  return [
    HTTP_STATUS.TOO_MANY_REQUESTS,
    HTTP_STATUS.BAD_GATEWAY,
    HTTP_STATUS.SERVICE_UNAVAILABLE,
    HTTP_STATUS.GATEWAY_TIMEOUT
  ].includes(status);
};

/* =========================================================
   NORMALIZE ERROR
   ========================================================= */

export const normalizeError = (
  error,
  fallback = {}
) => {
  if (isNeyoError(error)) {
    return error;
  }

  if (isAbortError(error)) {
    return new NeyoError(
      error?.message || "Request aborted",
      {
        code: ERROR_CODE.ABORTED,
        cause: error,
        retryable: false,
        ...fallback
      }
    );
  }

  if (isTimeoutError(error)) {
    return new NeyoError(
      error?.message || "Request timed out",
      {
        code: ERROR_CODE.TIMEOUT,
        cause: error,
        retryable: true,
        ...fallback
      }
    );
  }

  if (isNetworkError(error)) {
    return new NeyoError(
      error?.message || "Network request failed",
      {
        code: ERROR_CODE.NETWORK,
        cause: error,
        retryable: true,
        ...fallback
      }
    );
  }

  return new NeyoError(
    error?.message ||
      fallback.message ||
      "Unknown error",
    {
      cause: error,
      ...fallback
    }
  );
};

/* =========================================================
   CREATE HTTP ERROR
   ========================================================= */

export const createHttpError = ({
  status,
  message,
  details = null,
  cause = null
}) => {
  const code =
    mapHttpStatusToCode(status);

  return new NeyoError(
    message ||
      `Request failed with status ${status}`,
    {
      code,
      status,
      details,
      cause,
      retryable:
        isRetryableStatus(status)
    }
  );
};

/* =========================================================
   API RESPONSE ERROR
   ========================================================= */

export const errorFromResponse = async (
  response
) => {
  let payload = null;

  try {
    payload = await response
      .clone()
      .json();
  } catch {
    // Response may not contain JSON.
  }

  const message =
    payload?.error?.message ||
    payload?.message ||
    response.statusText ||
    `HTTP ${response.status}`;

  const details =
    payload?.error?.details ??
    payload?.details ??
    payload ??
    null;

  return createHttpError({
    status: response.status,
    message,
    details
  });
};

/* =========================================================
   USER-SAFE MESSAGE
   ========================================================= */

export const getUserErrorMessage = (
  error
) => {
  const normalized =
    normalizeError(error);

  return normalized.userMessage;
};

/* =========================================================
   PUBLIC ERROR SHAPE
   ========================================================= */

export const serializeError = (
  error
) => {
  const normalized =
    normalizeError(error);

  return {
    code: normalized.code,
    message: normalized.message,
    status: normalized.status,
    details: normalized.details,
    retryable: normalized.retryable
  };
};

/* =========================================================
   ASSERTION
   ========================================================= */

export const invariant = (
  condition,
  message,
  options = {}
) => {
  if (condition) {
    return;
  }

  throw new NeyoError(
    message || "Invariant failed",
    {
      code:
        options.code ||
        ERROR_CODE.INVALID_INPUT,

      details:
        options.details || null,

      userMessage:
        options.userMessage || null,

      retryable: false
    }
  );
};

/* =========================================================
   SAFE ERROR HANDLER
   ========================================================= */

export const captureError = (
  error,
  context = null
) => {
  const normalized =
    normalizeError(error);

  if (import.meta.env.DEV) {
    console.error(
      "[Neyo Error]",
      {
        error: normalized,
        context
      }
    );
  }

  return normalized;
};

/* =========================================================
   DEFAULT EXPORT
   ========================================================= */

export default {
  NeyoError,

  isNeyoError,
  isAbortError,
  isTimeoutError,
  isNetworkError,

  normalizeError,

  createHttpError,
  errorFromResponse,

  mapHttpStatusToCode,
  isRetryableStatus,

  getUserErrorMessage,
  serializeError,

  invariant,
  captureError
};
