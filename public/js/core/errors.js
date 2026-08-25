/*
=========================================================
NEYO — CORE ERRORS
Production v1

Purpose:
- Normalize unknown errors into one NEYO error format
- Classify HTTP / network / timeout / abort / validation errors
- Preserve useful backend error details
- Convert raw thrown values into predictable Error objects
- Provide safe user-facing messages
- Integrate with NeyoAPIError when available
- Emit error events without owning UI

Does NOT own:
- Toast UI
- Modal UI
- Retry behavior
- Feature recovery
- Logging backend
- Chat/history/upload business logic

Public:
window.NeyoErrors

Examples:

const error =
    NeyoErrors.normalize(caughtError);

if (
    NeyoErrors.isUnauthorized(error)
) {
    ...
}

const message =
    NeyoErrors.message(error);

=========================================================
*/

(() => {
    "use strict";

    const VERSION =
        "neyo-core-errors-production-v1";

    /* =====================================================
       SINGLETON GUARD
       ===================================================== */

    if (
        window.NeyoErrors
            ?.__controller === true
    ) {
        return;
    }

    /* =====================================================
       ERROR CODES
       ===================================================== */

    const CODES =
        Object.freeze({
            UNKNOWN:
                "UNKNOWN",

            NETWORK:
                "NETWORK_ERROR",

            TIMEOUT:
                "TIMEOUT",

            ABORTED:
                "ABORTED",

            UNAUTHORIZED:
                "UNAUTHORIZED",

            FORBIDDEN:
                "FORBIDDEN",

            NOT_FOUND:
                "NOT_FOUND",

            CONFLICT:
                "CONFLICT",

            VALIDATION:
                "VALIDATION_ERROR",

            RATE_LIMITED:
                "RATE_LIMITED",

            PAYLOAD_TOO_LARGE:
                "PAYLOAD_TOO_LARGE",

            UNSUPPORTED_MEDIA:
                "UNSUPPORTED_MEDIA",

            SERVER:
                "SERVER_ERROR",

            SERVICE_UNAVAILABLE:
                "SERVICE_UNAVAILABLE",

            BAD_RESPONSE:
                "BAD_RESPONSE",

            AUTH_REQUIRED:
                "AUTH_REQUIRED",

            PLAN_REQUIRED:
                "PLAN_REQUIRED",

            FILE_TOO_LARGE:
                "FILE_TOO_LARGE",

            FILE_TYPE_UNSUPPORTED:
                "FILE_TYPE_UNSUPPORTED",

            UPLOAD_FAILED:
                "UPLOAD_FAILED",

            PROCESSING_FAILED:
                "PROCESSING_FAILED",

            CHAT_FAILED:
                "CHAT_FAILED",

            HISTORY_FAILED:
                "HISTORY_FAILED",

            PROFILE_FAILED:
                "PROFILE_FAILED",

            VOICE_FAILED:
                "VOICE_FAILED"
        });

    /* =====================================================
       DEFAULT USER MESSAGES
       ===================================================== */

    const DEFAULT_MESSAGES =
        Object.freeze({
            [CODES.UNKNOWN]:
                "Something went wrong.",

            [CODES.NETWORK]:
                "Unable to connect. Check your internet connection and try again.",

            [CODES.TIMEOUT]:
                "The request took too long. Please try again.",

            [CODES.ABORTED]:
                "The request was cancelled.",

            [CODES.UNAUTHORIZED]:
                "Your session has expired. Please sign in again.",

            [CODES.FORBIDDEN]:
                "You do not have permission to do that.",

            [CODES.NOT_FOUND]:
                "The requested item could not be found.",

            [CODES.CONFLICT]:
                "That action could not be completed because the data changed.",

            [CODES.VALIDATION]:
                "Please check the information and try again.",

            [CODES.RATE_LIMITED]:
                "Too many requests. Please wait a moment and try again.",

            [CODES.PAYLOAD_TOO_LARGE]:
                "The request is too large.",

            [CODES.UNSUPPORTED_MEDIA]:
                "This file or media type is not supported.",

            [CODES.SERVER]:
                "NEYO is having trouble right now. Please try again.",

            [CODES.SERVICE_UNAVAILABLE]:
                "The service is temporarily unavailable. Please try again shortly.",

            [CODES.BAD_RESPONSE]:
                "NEYO received an invalid response. Please try again.",

            [CODES.AUTH_REQUIRED]:
                "Please sign in to continue.",

            [CODES.PLAN_REQUIRED]:
                "This feature requires an upgraded plan.",

            [CODES.FILE_TOO_LARGE]:
                "This file is too large.",

            [CODES.FILE_TYPE_UNSUPPORTED]:
                "This file type is not supported.",

            [CODES.UPLOAD_FAILED]:
                "The file could not be uploaded.",

            [CODES.PROCESSING_FAILED]:
                "The file could not be processed.",

            [CODES.CHAT_FAILED]:
                "NEYO could not complete this response.",

            [CODES.HISTORY_FAILED]:
                "Your recent chats could not be loaded.",

            [CODES.PROFILE_FAILED]:
                "Your profile could not be updated.",

            [CODES.VOICE_FAILED]:
                "Voice mode encountered a problem."
        });

    /* =====================================================
       EVENT BRIDGE
       ===================================================== */

    function emit(
        name,
        detail = {}
    ) {
        const events =
            window.NeyoEvents;

        if (
            events
                ?.__controller === true &&
            typeof events.emit ===
                "function"
        ) {
            events.emit(
                name,
                detail
            );

            return;
        }

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
       CLEAN STRING
       ===================================================== */

    function clean(
        value,
        max = 2000
    ) {
        return String(
            value ?? ""
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
    }

    /* =====================================================
       SAFE CLONE
       ===================================================== */

    function clone(
        value
    ) {
        if (
            value === null ||
            typeof value !==
                "object"
        ) {
            return value;
        }

        try {
            return structuredClone(
                value
            );
        } catch {}

        try {
            return JSON.parse(
                JSON.stringify(
                    value
                )
            );
        } catch {
            return null;
        }
    }

    /* =====================================================
       NEYO ERROR CLASS
       ===================================================== */

    class NeyoError extends Error {
        constructor(
            message,
            options = {}
        ) {
            super(
                clean(
                    message ||
                    DEFAULT_MESSAGES[
                        CODES.UNKNOWN
                    ]
                )
            );

            this.name =
                "NeyoError";

            this.code =
                clean(
                    options.code ||
                    CODES.UNKNOWN,
                    120
                );

            this.status =
                Number.isFinite(
                    Number(
                        options.status
                    )
                )
                    ? Number(
                        options.status
                    )
                    : 0;

            this.statusText =
                clean(
                    options.statusText,
                    300
                );

            this.method =
                clean(
                    options.method,
                    20
                )
                    .toUpperCase();

            this.url =
                clean(
                    options.url,
                    4096
                );

            this.requestId =
                clean(
                    options.requestId,
                    200
                ) ||
                null;

            this.feature =
                clean(
                    options.feature,
                    120
                ) ||
                null;

            this.action =
                clean(
                    options.action,
                    120
                ) ||
                null;

            this.data =
                clone(
                    options.data
                );

            this.details =
                clone(
                    options.details
                );

            this.cause =
                options.cause ||
                undefined;

            this.userMessage =
                clean(
                    options.userMessage ||
                    "",
                    2000
                ) ||
                null;

            this.retryable =
                Boolean(
                    options.retryable
                );

            this.isNetworkError =
                Boolean(
                    options.isNetworkError
                );

            this.isTimeout =
                Boolean(
                    options.isTimeout
                );

            this.isAbort =
                Boolean(
                    options.isAbort
                );

            this.isValidation =
                Boolean(
                    options.isValidation
                );

            this.isAuth =
                Boolean(
                    options.isAuth
                );

            this.isRateLimit =
                Boolean(
                    options.isRateLimit
                );

            this.timestamp =
                Number.isFinite(
                    Number(
                        options.timestamp
                    )
                )
                    ? Number(
                        options.timestamp
                    )
                    : Date.now();

            if (
                options.stack
            ) {
                try {
                    this.stack =
                        options.stack;
                } catch {}
            }
        }
    }

    /* =====================================================
       STATUS → CODE
       ===================================================== */

    function codeFromStatus(
        status
    ) {
        const value =
            Number(
                status
            );

        switch (value) {
            case 400:
            case 422:
                return CODES
                    .VALIDATION;

            case 401:
                return CODES
                    .UNAUTHORIZED;

            case 403:
                return CODES
                    .FORBIDDEN;

            case 404:
                return CODES
                    .NOT_FOUND;

            case 409:
                return CODES
                    .CONFLICT;

            case 413:
                return CODES
                    .PAYLOAD_TOO_LARGE;

            case 415:
                return CODES
                    .UNSUPPORTED_MEDIA;

            case 429:
                return CODES
                    .RATE_LIMITED;

            case 502:
            case 503:
            case 504:
                return CODES
                    .SERVICE_UNAVAILABLE;

            default:
                if (
                    value >= 500
                ) {
                    return CODES
                        .SERVER;
                }

                return CODES
                    .UNKNOWN;
        }
    }

    /* =====================================================
       RETRYABILITY
       ===================================================== */

    function retryableFromStatus(
        status
    ) {
        const value =
            Number(
                status
            );

        return (
            value === 408 ||
            value === 425 ||
            value === 429 ||
            value === 500 ||
            value === 502 ||
            value === 503 ||
            value === 504
        );
    }

    /* =====================================================
       EXTRACT BACKEND MESSAGE
       ===================================================== */

    function backendMessage(
        source
    ) {
        if (
            !source ||
            typeof source !==
                "object"
        ) {
            return "";
        }

        const candidates = [
            source.message,
            source.error,
            source.detail,
            source.error_description,
            source.description,
            source.reason
        ];

        for (
            const candidate
            of candidates
        ) {
            if (
                typeof candidate ===
                    "string" &&
                candidate.trim()
            ) {
                return clean(
                    candidate,
                    2000
                );
            }
        }

        if (
            source.error &&
            typeof source.error ===
                "object"
        ) {
            return backendMessage(
                source.error
            );
        }

        return "";
    }

    /* =====================================================
       DETECT ABORT
       ===================================================== */

    function looksLikeAbort(
        error
    ) {
        return Boolean(
            error?.name ===
                "AbortError" ||
            error?.code ===
                CODES.ABORTED ||
            error?.isAbort ===
                true
        );
    }

    /* =====================================================
       DETECT TIMEOUT
       ===================================================== */

    function looksLikeTimeout(
        error
    ) {
        const message =
            clean(
                error?.message,
                1000
            )
                .toLowerCase();

        return Boolean(
            error?.code ===
                CODES.TIMEOUT ||
            error?.isTimeout ===
                true ||
            message.includes(
                "timed out"
            ) ||
            message.includes(
                "timeout"
            )
        );
    }

    /* =====================================================
       DETECT NETWORK
       ===================================================== */

    function looksLikeNetwork(
        error
    ) {
        const message =
            clean(
                error?.message,
                1000
            )
                .toLowerCase();

        return Boolean(
            error?.isNetworkError ===
                true ||
            error?.code ===
                CODES.NETWORK ||
            error instanceof
                TypeError &&
            (
                message.includes(
                    "fetch"
                ) ||
                message.includes(
                    "network"
                ) ||
                message.includes(
                    "failed"
                )
            )
        );
    }

    /* =====================================================
       NORMALIZE RAW VALUE
       ===================================================== */

    function normalize(
        input,
        context = {}
    ) {
        /*
         * Already normalized.
         */

        if (
            input instanceof
                NeyoError
        ) {
            if (
                !context ||
                Object.keys(
                    context
                ).length === 0
            ) {
                return input;
            }

            return new NeyoError(
                input.message,
                {
                    ...input,

                    feature:
                        context.feature ??
                        input.feature,

                    action:
                        context.action ??
                        input.action,

                    userMessage:
                        context.userMessage ??
                        input.userMessage,

                    cause:
                        input.cause ||
                        input
                }
            );
        }

        /*
         * NeyoAPIError compatibility.
         */

        const apiError =
            window.NeyoAPI
                ?.Error;

        if (
            typeof apiError ===
                "function" &&
            input instanceof
                apiError
        ) {
            let code =
                clean(
                    input.code,
                    120
                ) ||
                codeFromStatus(
                    input.status
                );

            if (
                input.isTimeout
            ) {
                code =
                    CODES.TIMEOUT;

            } else if (
                input.isAbort
            ) {
                code =
                    CODES.ABORTED;

            } else if (
                input.isNetworkError
            ) {
                code =
                    CODES.NETWORK;
            }

            return new NeyoError(
                input.message,
                {
                    code,

                    status:
                        input.status,

                    statusText:
                        input.statusText,

                    method:
                        input.method,

                    url:
                        input.url,

                    requestId:
                        input.requestId,

                    data:
                        input.data,

                    cause:
                        input,

                    feature:
                        context.feature,

                    action:
                        context.action,

                    userMessage:
                        context.userMessage,

                    retryable:
                        input.isNetworkError ||
                        input.isTimeout ||
                        retryableFromStatus(
                            input.status
                        ),

                    isNetworkError:
                        input.isNetworkError,

                    isTimeout:
                        input.isTimeout,

                    isAbort:
                        input.isAbort,

                    isAuth:
                        (
                            input.status ===
                                401 ||
                            input.status ===
                                403
                        ),

                    isRateLimit:
                        input.status ===
                            429
                }
            );
        }

        /*
         * DOMException / native AbortError.
         */

        if (
            looksLikeAbort(
                input
            )
        ) {
            return new NeyoError(
                clean(
                    input?.message
                ) ||
                "Request was cancelled.",
                {
                    code:
                        CODES.ABORTED,

                    cause:
                        input,

                    feature:
                        context.feature,

                    action:
                        context.action,

                    userMessage:
                        context.userMessage,

                    isAbort:
                        true,

                    retryable:
                        false
                }
            );
        }

        /*
         * Timeout.
         */

        if (
            looksLikeTimeout(
                input
            )
        ) {
            return new NeyoError(
                clean(
                    input?.message
                ) ||
                DEFAULT_MESSAGES[
                    CODES.TIMEOUT
                ],
                {
                    code:
                        CODES.TIMEOUT,

                    cause:
                        input,

                    feature:
                        context.feature,

                    action:
                        context.action,

                    userMessage:
                        context.userMessage,

                    isTimeout:
                        true,

                    retryable:
                        true
                }
            );
        }

        /*
         * Network.
         */

        if (
            looksLikeNetwork(
                input
            )
        ) {
            return new NeyoError(
                clean(
                    input?.message
                ) ||
                DEFAULT_MESSAGES[
                    CODES.NETWORK
                ],
                {
                    code:
                        CODES.NETWORK,

                    cause:
                        input,

                    feature:
                        context.feature,

                    action:
                        context.action,

                    userMessage:
                        context.userMessage,

                    isNetworkError:
                        true,

                    retryable:
                        true
                }
            );
        }

        /*
         * Standard Error.
         */

        if (
            input instanceof
                Error
        ) {
            const status =
                Number(
                    input.status ||
                    input.statusCode ||
                    0
                );

            let code =
                clean(
                    input.code,
                    120
                );

            if (!code) {
                code =
                    status
                        ? codeFromStatus(
                            status
                        )
                        : CODES.UNKNOWN;
            }

            return new NeyoError(
                clean(
                    input.message
                ) ||
                DEFAULT_MESSAGES[
                    code
                ] ||
                DEFAULT_MESSAGES[
                    CODES.UNKNOWN
                ],
                {
                    code,

                    status,

                    statusText:
                        input.statusText,

                    method:
                        input.method,

                    url:
                        input.url,

                    requestId:
                        input.requestId,

                    data:
                        input.data,

                    details:
                        input.details,

                    cause:
                        input,

                    stack:
                        input.stack,

                    feature:
                        context.feature,

                    action:
                        context.action,

                    userMessage:
                        context.userMessage,

                    retryable:
                        retryableFromStatus(
                            status
                        ),

                    isValidation:
                        code ===
                            CODES.VALIDATION,

                    isAuth:
                        (
                            status === 401 ||
                            status === 403
                        ),

                    isRateLimit:
                        status === 429
                }
            );
        }

        /*
         * Backend JSON / plain object.
         */

        if (
            input &&
            typeof input ===
                "object"
        ) {
            const status =
                Number(
                    input.status ||
                    input.statusCode ||
                    0
                );

            let code =
                clean(
                    input.code,
                    120
                );

            if (!code) {
                code =
                    status
                        ? codeFromStatus(
                            status
                        )
                        : CODES.UNKNOWN;
            }

            const extracted =
                backendMessage(
                    input
                );

            return new NeyoError(
                extracted ||
                DEFAULT_MESSAGES[
                    code
                ] ||
                DEFAULT_MESSAGES[
                    CODES.UNKNOWN
                ],
                {
                    code,

                    status,

                    statusText:
                        input.statusText,

                    method:
                        input.method,

                    url:
                        input.url,

                    requestId:
                        input.requestId,

                    data:
                        input.data ??
                        input,

                    feature:
                        context.feature,

                    action:
                        context.action,

                    userMessage:
                        context.userMessage,

                    retryable:
                        retryableFromStatus(
                            status
                        ),

                    isValidation:
                        code ===
                            CODES.VALIDATION,

                    isAuth:
                        (
                            status === 401 ||
                            status === 403
                        ),

                    isRateLimit:
                        status === 429
                }
            );
        }

        /*
         * String / number / unknown primitive.
         */

        const raw =
            clean(
                input,
                2000
            );

        return new NeyoError(
            raw ||
            DEFAULT_MESSAGES[
                CODES.UNKNOWN
            ],
            {
                code:
                    CODES.UNKNOWN,

                feature:
                    context.feature,

                action:
                    context.action,

                userMessage:
                    context.userMessage
            }
        );
    }

    /* =====================================================
       SAFE USER MESSAGE

       Backend internal details should not automatically leak
       into user-facing UI.

       Explicit `userMessage` always wins.
       ===================================================== */

    function message(
        input,
        fallback = ""
    ) {
        const error =
            normalize(
                input
            );

        if (
            error.userMessage
        ) {
            return error
                .userMessage;
        }

        const mapped =
            DEFAULT_MESSAGES[
                error.code
            ];

        if (mapped) {
            return mapped;
        }

        if (
            fallback
        ) {
            return clean(
                fallback,
                2000
            );
        }

        return DEFAULT_MESSAGES[
            CODES.UNKNOWN
        ];
    }

    /* =====================================================
       DEVELOPER MESSAGE

       Keeps original technical message for logs/debugging.
       ===================================================== */

    function technicalMessage(
        input
    ) {
        const error =
            normalize(
                input
            );

        return (
            clean(
                error.message,
                4000
            ) ||
            DEFAULT_MESSAGES[
                CODES.UNKNOWN
            ]
        );
    }

    /* =====================================================
       CLASSIFIERS
       ===================================================== */

    function isAbort(
        input
    ) {
        const error =
            normalize(
                input
            );

        return Boolean(
            error.isAbort ||
            error.code ===
                CODES.ABORTED
        );
    }

    function isTimeout(
        input
    ) {
        const error =
            normalize(
                input
            );

        return Boolean(
            error.isTimeout ||
            error.code ===
                CODES.TIMEOUT
        );
    }

    function isNetwork(
        input
    ) {
        const error =
            normalize(
                input
            );

        return Boolean(
            error.isNetworkError ||
            error.code ===
                CODES.NETWORK
        );
    }

    function isUnauthorized(
        input
    ) {
        const error =
            normalize(
                input
            );

        return (
            error.status ===
                401 ||
            error.code ===
                CODES.UNAUTHORIZED ||
            error.code ===
                CODES.AUTH_REQUIRED
        );
    }

    function isForbidden(
        input
    ) {
        const error =
            normalize(
                input
            );

        return (
            error.status ===
                403 ||
            error.code ===
                CODES.FORBIDDEN
        );
    }

    function isAuth(
        input
    ) {
        return (
            isUnauthorized(
                input
            ) ||
            isForbidden(
                input
            )
        );
    }

    function isRateLimited(
        input
    ) {
        const error =
            normalize(
                input
            );

        return Boolean(
            error.isRateLimit ||
            error.status ===
                429 ||
            error.code ===
                CODES.RATE_LIMITED
        );
    }

    function isValidation(
        input
    ) {
        const error =
            normalize(
                input
            );

        return Boolean(
            error.isValidation ||
            error.code ===
                CODES.VALIDATION ||
            error.status ===
                400 ||
            error.status ===
                422
        );
    }

    function isNotFound(
        input
    ) {
        const error =
            normalize(
                input
            );

        return (
            error.status ===
                404 ||
            error.code ===
                CODES.NOT_FOUND
        );
    }

    function isServer(
        input
    ) {
        const error =
            normalize(
                input
            );

        return (
            error.status >=
                500 ||
            error.code ===
                CODES.SERVER ||
            error.code ===
                CODES.SERVICE_UNAVAILABLE
        );
    }

    function isRetryable(
        input
    ) {
        const error =
            normalize(
                input
            );

        if (
            error.isAbort
        ) {
            return false;
        }

        return Boolean(
            error.retryable ||
            error.isNetworkError ||
            error.isTimeout ||
            error.isRateLimit ||
            retryableFromStatus(
                error.status
            )
        );
    }

    /* =====================================================
       FEATURE WRAPPER

       Lets a feature add context without changing the
       original thrown error.

       Example:
       throw NeyoErrors.withContext(
           error,
           {
               feature: "history",
               action: "load"
           }
       );
       ===================================================== */

    function withContext(
        input,
        context = {}
    ) {
        return normalize(
            input,
            context
        );
    }

    /* =====================================================
       CREATE CUSTOM ERROR
       ===================================================== */

    function create(
        code,
        options = {}
    ) {
        const normalizedCode =
            clean(
                code,
                120
            ) ||
            CODES.UNKNOWN;

        return new NeyoError(
            options.message ||
            DEFAULT_MESSAGES[
                normalizedCode
            ] ||
            DEFAULT_MESSAGES[
                CODES.UNKNOWN
            ],
            {
                ...options,

                code:
                    normalizedCode
            }
        );
    }

    /* =====================================================
       SERIALIZE

       Safe object for events/logging.
       Excludes giant Response objects and circular causes.
       ===================================================== */

    function serialize(
        input
    ) {
        const error =
            normalize(
                input
            );

        return {
            name:
                error.name,

            message:
                technicalMessage(
                    error
                ),

            userMessage:
                message(
                    error
                ),

            code:
                error.code,

            status:
                error.status,

            statusText:
                error.statusText,

            method:
                error.method,

            url:
                error.url,

            requestId:
                error.requestId,

            feature:
                error.feature,

            action:
                error.action,

            retryable:
                error.retryable,

            isNetworkError:
                error
                    .isNetworkError,

            isTimeout:
                error.isTimeout,

            isAbort:
                error.isAbort,

            isValidation:
                error
                    .isValidation,

            isAuth:
                error.isAuth,

            isRateLimit:
                error
                    .isRateLimit,

            timestamp:
                error.timestamp,

            data:
                clone(
                    error.data
                ),

            details:
                clone(
                    error.details
                )
        };
    }

    /* =====================================================
       REPORT

       Emits a structured error event.

       It does NOT show a toast.

       UI notification owner can subscribe to:
       neyo:error
       ===================================================== */

    function report(
        input,
        context = {}
    ) {
        const error =
            normalize(
                input,
                context
            );

        const serialized =
            serialize(
                error
            );

        emit(
            "neyo:error",
            {
                error,
                serialized
            }
        );

        return error;
    }

    /* =====================================================
       REPORT FEATURE ERROR

       Emits both generic and feature-specific event.

       Example:
       reportFeature(
           "history",
           error,
           { action: "load" }
       );

       Events:
       neyo:error
       neyo:history-error
       ===================================================== */

    function reportFeature(
        feature,
        input,
        context = {}
    ) {
        const featureName =
            clean(
                feature,
                120
            )
                .toLowerCase();

        const error =
            report(
                input,
                {
                    ...context,

                    feature:
                        featureName ||
                        context.feature
                }
            );

        if (
            featureName
        ) {
            emit(
                `neyo:${featureName}-error`,
                {
                    error,

                    serialized:
                        serialize(
                            error
                        ),

                    action:
                        context.action ||
                        error.action ||
                        null
                }
            );
        }

        return error;
    }

    /* =====================================================
       CONSOLE LOGGING

       Centralized format, but explicit only.
       We don't automatically console.error every normalized
       error because some errors (AbortError) are expected.
       ===================================================== */

    function log(
        input,
        context = {}
    ) {
        const error =
            normalize(
                input,
                context
            );

        if (
            error.isAbort
        ) {
            console.debug(
                "[NEYO]",
                error
            );

        } else if (
            error.isValidation
        ) {
            console.warn(
                "[NEYO]",
                error
            );

        } else {
            console.error(
                "[NEYO]",
                error
            );
        }

        return error;
    }

    /* =====================================================
       GUARD

       Converts synchronous thrown values into NeyoError.

       Does NOT swallow errors unless caller asks.

       Example:
       const result = NeyoErrors.guard(
           () => JSON.parse(value)
       );
       ===================================================== */

    function guard(
        callback,
        options = {}
    ) {
        if (
            typeof callback !==
                "function"
        ) {
            throw new TypeError(
                "[NEYO Errors] guard callback must be a function."
            );
        }

        try {
            return callback();

        } catch (input) {
            const error =
                normalize(
                    input,
                    options
                );

            if (
                options.report ===
                    true
            ) {
                report(
                    error
                );
            }

            if (
                options.fallback !==
                    undefined
            ) {
                return options
                    .fallback;
            }

            throw error;
        }
    }

    /* =====================================================
       ASYNC GUARD
       ===================================================== */

    async function guardAsync(
        callback,
        options = {}
    ) {
        if (
            typeof callback !==
                "function"
        ) {
            throw new TypeError(
                "[NEYO Errors] guardAsync callback must be a function."
            );
        }

        try {
            return await callback();

        } catch (input) {
            const error =
                normalize(
                    input,
                    options
                );

            if (
                options.report ===
                    true
            ) {
                report(
                    error
                );
            }

            if (
                options.fallback !==
                    undefined
            ) {
                return options
                    .fallback;
            }

            throw error;
        }
    }

    /* =====================================================
       ASSERT

       Intended for internal module contracts.

       Example:
       NeyoErrors.assert(
           conversationId,
           "Conversation ID is required."
       );
       ===================================================== */

    function assert(
        condition,
        messageText,
        options = {}
    ) {
        if (
            condition
        ) {
            return true;
        }

        throw create(
            options.code ||
            CODES.VALIDATION,
            {
                ...options,

                message:
                    messageText ||
                    DEFAULT_MESSAGES[
                        CODES.VALIDATION
                    ],

                isValidation:
                    true
            }
        );
    }

    /* =====================================================
       FILE ERROR HELPERS
       ===================================================== */

    function fileTooLarge(
        options = {}
    ) {
        return create(
            CODES.FILE_TOO_LARGE,
            {
                ...options,

                isValidation:
                    true
            }
        );
    }

    function unsupportedFile(
        options = {}
    ) {
        return create(
            CODES
                .FILE_TYPE_UNSUPPORTED,
            {
                ...options,

                isValidation:
                    true
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

            Error:
                NeyoError,

            codes:
                CODES,

            defaultMessages:
                DEFAULT_MESSAGES,

            normalize,

            create,

            withContext,

            message,

            technicalMessage,

            serialize,

            report,

            reportFeature,

            log,

            guard,

            guardAsync,

            assert,

            fileTooLarge,

            unsupportedFile,

            isAbort,

            isTimeout,

            isNetwork,

            isUnauthorized,

            isForbidden,

            isAuth,

            isRateLimited,

            isValidation,

            isNotFound,

            isServer,

            isRetryable,

            codeFromStatus,

            getState() {
                return {
                    version:
                        VERSION,

                    codes:
                        Object.keys(
                            CODES
                        ).length
                };
            }
        });

    /* =====================================================
       GLOBAL
       ===================================================== */

    try {
        Object.defineProperty(
            window,
            "NeyoErrors",
            {
                value:
                    api,

                writable:
                    false,

                enumerable:
                    true,

                configurable:
                    true
            }
        );

    } catch {
        window.NeyoErrors =
            api;
    }

    /* =====================================================
       READY
       ===================================================== */

    emit(
        "neyo:errors-ready",
        {
            version:
                VERSION
        }
    );

})();
