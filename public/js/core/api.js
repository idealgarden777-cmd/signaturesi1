/*
=========================================================
NEYO — CORE API
Production v1

Purpose:
- One safe HTTP transport layer for NEYO
- Preserve current backend contracts
- Consistent JSON parsing
- Consistent errors
- Request timeouts
- AbortController support
- Credentials handling
- Request IDs
- Safe same-origin defaults
- No automatic POST retries
- No feature/business ownership

Does NOT own:
- Authentication state
- Chat state
- History state
- Attachments state
- Upload state
- Profile state
- Checkout UI
- Voice state
- Error toasts / UI

Public:
window.NeyoAPI

=========================================================
*/

(() => {
    "use strict";

    const VERSION =
        "neyo-core-api-production-v1";

    /* =====================================================
       SINGLETON
       ===================================================== */

    if (
        window.NeyoAPI
            ?.__controller === true
    ) {
        return;
    }

    /* =====================================================
       ENDPOINTS

       Current NEYO backend contracts preserved.
       ===================================================== */

    const ENDPOINTS =
        Object.freeze({
            auth:
                "/api/auth",

            chat:
                "/api/chat",

            history:
                "/api/history",

            upload:
                "/api/upload",

            attachmentUpload:
                "/api/attachments/upload",

            attachmentProcess:
                "/api/attachments/process",

            profile:
                "/api/profile",

            profileAvatar:
                "/api/profile/avatar",

            checkout:
                "/api/checkout",

            voiceToken:
                "/api/voice-token",

            transcribe:
                "/api/transcribe"
        });

    /* =====================================================
       DEFAULTS
       ===================================================== */

    const DEFAULTS =
        Object.freeze({
            timeout:
                30_000,

            longTimeout:
                120_000,

            credentials:
                "include",

            cache:
                "no-store",

            redirect:
                "follow",

            accept:
                "application/json"
        });

    /* =====================================================
       API ERROR
       ===================================================== */

    class NeyoAPIError extends Error {
        constructor(
            message,
            options = {}
        ) {
            super(
                String(
                    message ||
                    "Request failed."
                )
            );

            this.name =
                "NeyoAPIError";

            this.status =
                Number(
                    options.status ||
                    0
                );

            this.statusText =
                String(
                    options.statusText ||
                    ""
                );

            this.url =
                String(
                    options.url ||
                    ""
                );

            this.method =
                String(
                    options.method ||
                    ""
                ).toUpperCase();

            this.data =
                options.data ??
                null;

            this.raw =
                options.raw ??
                "";

            this.requestId =
                options.requestId ??
                null;

            this.code =
                options.code ??
                null;

            this.response =
                options.response ??
                null;

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
        }
    }

    /* =====================================================
       EVENTS
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
       CLEAN
       ===================================================== */

    function clean(
        value,
        max = 1000
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
       REQUEST ID
       ===================================================== */

    function createRequestId() {
        try {
            if (
                globalThis.crypto &&
                typeof crypto
                    .randomUUID ===
                    "function"
            ) {
                return crypto
                    .randomUUID();
            }
        } catch {}

        return [
            Date.now()
                .toString(36),

            Math.random()
                .toString(36)
                .slice(2)
        ].join("-");
    }

    /* =====================================================
       URL
       ===================================================== */

    function normalizeURL(
        input
    ) {
        if (
            input instanceof
            URL
        ) {
            return input;
        }

        const value =
            clean(
                input,
                4096
            );

        if (!value) {
            throw new TypeError(
                "[NEYO API] URL is required."
            );
        }

        try {
            return new URL(
                value,
                window.location.origin
            );
        } catch {
            throw new TypeError(
                `[NEYO API] Invalid URL: ${value}`
            );
        }
    }

    function isSameOrigin(
        url
    ) {
        try {
            const parsed =
                normalizeURL(
                    url
                );

            return (
                parsed.origin ===
                window.location.origin
            );
        } catch {
            return false;
        }
    }

    /* =====================================================
       HEADERS
       ===================================================== */

    function normalizeHeaders(
        input
    ) {
        try {
            return new Headers(
                input ||
                undefined
            );
        } catch {
            return new Headers();
        }
    }

    function buildHeaders({
        url,
        headers,
        body,
        accept
    }) {
        const output =
            normalizeHeaders(
                headers
            );

        if (
            accept &&
            !output.has(
                "Accept"
            )
        ) {
            output.set(
                "Accept",
                accept
            );
        }

        /*
         * Do NOT manually set multipart Content-Type.
         * Browser must generate its boundary.
         */

        const isForm =
            typeof FormData !==
                "undefined" &&
            body instanceof
                FormData;

        const isBlob =
            typeof Blob !==
                "undefined" &&
            body instanceof
                Blob;

        const isBuffer =
            body instanceof
                ArrayBuffer ||
            ArrayBuffer
                .isView(
                    body
                );

        const isString =
            typeof body ===
                "string";

        if (
            body !==
                undefined &&
            body !==
                null &&
            !isForm &&
            !isBlob &&
            !isBuffer &&
            !isString &&
            !output.has(
                "Content-Type"
            )
        ) {
            output.set(
                "Content-Type",
                "application/json"
            );
        }

        /*
         * Only attach internal client metadata to our own
         * origin. Never leak it to signed Supabase/storage
         * URLs or another external endpoint.
         */

        if (
            isSameOrigin(
                url
            )
        ) {
            if (
                !output.has(
                    "X-Neyo-Client"
                )
            ) {
                output.set(
                    "X-Neyo-Client",
                    VERSION
                );
            }
        }

        return output;
    }

    /* =====================================================
       BODY
       ===================================================== */

    function serializeBody(
        body,
        headers
    ) {
        if (
            body === null ||
            body === undefined
        ) {
            return undefined;
        }

        if (
            typeof FormData !==
                "undefined" &&
            body instanceof
                FormData
        ) {
            return body;
        }

        if (
            typeof URLSearchParams !==
                "undefined" &&
            body instanceof
                URLSearchParams
        ) {
            return body;
        }

        if (
            typeof Blob !==
                "undefined" &&
            body instanceof
                Blob
        ) {
            return body;
        }

        if (
            body instanceof
                ArrayBuffer ||
            ArrayBuffer
                .isView(
                    body
                )
        ) {
            return body;
        }

        if (
            typeof body ===
                "string"
        ) {
            return body;
        }

        const contentType =
            headers
                .get(
                    "Content-Type"
                ) ||
            "";

        if (
            contentType
                .toLowerCase()
                .includes(
                    "application/json"
                )
        ) {
            return JSON.stringify(
                body
            );
        }

        return body;
    }

    /* =====================================================
       ABORT / TIMEOUT
       ===================================================== */

    function abortError(
        reason =
            "The operation was aborted."
    ) {
        try {
            return new DOMException(
                String(reason),
                "AbortError"
            );
        } catch {
            const error =
                new Error(
                    String(reason)
                );

            error.name =
                "AbortError";

            return error;
        }
    }

    function combineSignals(
        signals = []
    ) {
        const valid =
            signals.filter(
                signal =>
                    signal &&
                    typeof signal
                        .addEventListener ===
                        "function"
            );

        if (
            valid.length ===
            0
        ) {
            return {
                signal:
                    undefined,

                cleanup() {}
            };
        }

        if (
            valid.length ===
            1
        ) {
            return {
                signal:
                    valid[0],

                cleanup() {}
            };
        }

        /*
         * Use native AbortSignal.any when available.
         */

        try {
            if (
                typeof AbortSignal
                    .any ===
                    "function"
            ) {
                return {
                    signal:
                        AbortSignal.any(
                            valid
                        ),

                    cleanup() {}
                };
            }
        } catch {}

        const controller =
            new AbortController();

        const listeners =
            [];

        const abortFrom =
            signal => {
                if (
                    controller
                        .signal
                        .aborted
                ) {
                    return;
                }

                try {
                    controller.abort(
                        signal.reason
                    );
                } catch {
                    controller.abort();
                }
            };

        for (
            const signal
            of valid
        ) {
            if (
                signal.aborted
            ) {
                abortFrom(
                    signal
                );

                break;
            }

            const listener =
                () => {
                    abortFrom(
                        signal
                    );
                };

            signal.addEventListener(
                "abort",
                listener,
                {
                    once:
                        true
                }
            );

            listeners.push([
                signal,
                listener
            ]);
        }

        return {
            signal:
                controller.signal,

            cleanup() {
                for (
                    const [
                        signal,
                        listener
                    ]
                    of listeners
                ) {
                    try {
                        signal
                            .removeEventListener(
                                "abort",
                                listener
                            );
                    } catch {}
                }
            }
        };
    }

    function createTimeoutController(
        timeout
    ) {
        const controller =
            new AbortController();

        const duration =
            Number.isFinite(
                Number(
                    timeout
                )
            )
                ? Math.max(
                    0,
                    Number(
                        timeout
                    )
                )
                : DEFAULTS.timeout;

        let timer =
            null;

        let timedOut =
            false;

        if (
            duration > 0
        ) {
            timer =
                window.setTimeout(
                    () => {
                        timedOut =
                            true;

                        try {
                            controller.abort(
                                abortError(
                                    "Request timed out."
                                )
                            );
                        } catch {
                            controller.abort();
                        }
                    },
                    duration
                );
        }

        return {
            controller,

            signal:
                controller.signal,

            get timedOut() {
                return timedOut;
            },

            cleanup() {
                if (
                    timer !==
                    null
                ) {
                    window.clearTimeout(
                        timer
                    );

                    timer =
                        null;
                }
            }
        };
    }

    /* =====================================================
       CONTENT TYPE
       ===================================================== */

    function contentTypeOf(
        response
    ) {
        return String(
            response
                ?.headers
                ?.get(
                    "content-type"
                ) ||
            ""
        )
            .toLowerCase();
    }

    /* =====================================================
       RESPONSE PARSING
       ===================================================== */

    async function parseResponse(
        response,
        responseType =
            "auto"
    ) {
        if (
            responseType ===
                "response"
        ) {
            return {
                data:
                    response,

                raw:
                    null
            };
        }

        if (
            responseType ===
                "blob"
        ) {
            return {
                data:
                    await response.blob(),

                raw:
                    null
            };
        }

        if (
            responseType ===
                "arrayBuffer"
        ) {
            return {
                data:
                    await response
                        .arrayBuffer(),

                raw:
                    null
            };
        }

        if (
            responseType ===
                "text"
        ) {
            const raw =
                await response.text();

            return {
                data:
                    raw,

                raw
            };
        }

        /*
         * Explicit JSON.
         */

        if (
            responseType ===
                "json"
        ) {
            const raw =
                await response.text();

            if (!raw) {
                return {
                    data:
                        {},

                    raw:
                        ""
                };
            }

            try {
                return {
                    data:
                        JSON.parse(
                            raw
                        ),

                    raw
                };
            } catch {
                return {
                    data:
                        {},

                    raw
                };
            }
        }

        /*
         * Auto.
         */

        const type =
            contentTypeOf(
                response
            );

        if (
            type.includes(
                "application/json"
            ) ||
            type.includes(
                "+json"
            )
        ) {
            const raw =
                await response.text();

            if (!raw) {
                return {
                    data:
                        {},

                    raw:
                        ""
                };
            }

            try {
                return {
                    data:
                        JSON.parse(
                            raw
                        ),

                    raw
                };
            } catch {
                return {
                    data:
                        {},

                    raw
                };
            }
        }

        if (
            type.startsWith(
                "text/"
            ) ||
            type.includes(
                "event-stream"
            ) ||
            type.includes(
                "ndjson"
            )
        ) {
            /*
             * Streaming callers should request
             * responseType: "response".

             * For normal requests, text is safe.
             */

            const raw =
                await response.text();

            return {
                data:
                    raw,

                raw
            };
        }

        /*
         * Current NEYO APIs often return JSON even if an
         * intermediary strips Content-Type. Try JSON before
         * falling back to text.
         */

        const raw =
            await response.text();

        if (!raw) {
            return {
                data:
                    {},

                raw:
                    ""
            };
        }

        try {
            return {
                data:
                    JSON.parse(
                        raw
                    ),

                raw
            };
        } catch {
            return {
                data:
                    raw,

                raw
            };
        }
    }

    /* =====================================================
       ERROR MESSAGE
       ===================================================== */

    function getErrorMessage(
        data,
        raw,
        response
    ) {
        if (
            data &&
            typeof data ===
                "object"
        ) {
            const possible = [
                data.error,
                data.message,
                data.detail,
                data.error_description
            ];

            for (
                const value
                of possible
            ) {
                if (
                    typeof value ===
                        "string" &&
                    value.trim()
                ) {
                    return value
                        .trim();
                }
            }
        }

        if (
            typeof raw ===
                "string" &&
            raw.trim() &&
            raw.length <
                1000
        ) {
            return raw.trim();
        }

        return (
            `Request failed (${response.status}).`
        );
    }

    /* =====================================================
       NETWORK ERROR NORMALIZATION
       ===================================================== */

    function normalizeFetchError(
        error,
        context
    ) {
        if (
            error instanceof
                NeyoAPIError
        ) {
            return error;
        }

        const aborted =
            context.signal
                ?.aborted ||
            error?.name ===
                "AbortError";

        if (aborted) {
            return new NeyoAPIError(
                context.timedOut
                    ? "Request timed out."
                    : (
                        error?.message ||
                        "Request was aborted."
                    ),
                {
                    method:
                        context.method,

                    url:
                        context.url,

                    requestId:
                        context.requestId,

                    isAbort:
                        true,

                    isTimeout:
                        context.timedOut,

                    code:
                        context.timedOut
                            ? "TIMEOUT"
                            : "ABORTED"
                }
            );
        }

        return new NeyoAPIError(
            error?.message ||
            "Network request failed.",
            {
                method:
                    context.method,

                url:
                    context.url,

                requestId:
                    context.requestId,

                isNetworkError:
                    true,

                code:
                    "NETWORK_ERROR"
            }
        );
    }

    /* =====================================================
       REQUEST

       NO automatic POST retry.

       A request should happen exactly once unless the
       feature owner explicitly asks for another attempt.
       ===================================================== */

    async function request(
        input,
        options = {}
    ) {
        const url =
            normalizeURL(
                input
            );

        const method =
            clean(
                options.method ||
                "GET",
                16
            )
                .toUpperCase();

        const requestId =
            clean(
                options.requestId ||
                createRequestId(),
                160
            );

        const timeout =
            options.timeout ??
            DEFAULTS.timeout;

        const timeoutController =
            createTimeoutController(
                timeout
            );

        const combined =
            combineSignals([
                options.signal,
                timeoutController
                    .signal
            ]);

        const bodyInput =
            options.body;

        const headers =
            buildHeaders({
                url,
                headers:
                    options.headers,

                body:
                    bodyInput,

                accept:
                    options.accept ??
                    DEFAULTS.accept
            });

        if (
            isSameOrigin(
                url
            ) &&
            !headers.has(
                "X-Neyo-Request-Id"
            )
        ) {
            headers.set(
                "X-Neyo-Request-Id",
                requestId
            );
        }

        const body =
            serializeBody(
                bodyInput,
                headers
            );

        const sameOrigin =
            isSameOrigin(
                url
            );

        /*
         * External signed upload URLs must not receive our
         * cookies by default.

         * Same-origin API calls preserve current behavior:
         * credentials: include.
         */

        const credentials =
            options.credentials ??
            (
                sameOrigin
                    ? DEFAULTS.credentials
                    : "omit"
            );

        const fetchOptions = {
            method,

            headers,

            credentials,

            cache:
                options.cache ??
                DEFAULTS.cache,

            redirect:
                options.redirect ??
                DEFAULTS.redirect,

            signal:
                combined.signal
        };

        if (
            method !== "GET" &&
            method !== "HEAD" &&
            body !== undefined
        ) {
            fetchOptions.body =
                body;
        }

        emit(
            "neyo:api-request-start",
            {
                requestId,

                method,

                url:
                    url.href,

                sameOrigin
            }
        );

        let response;

        try {
            response =
                await fetch(
                    url.href,
                    fetchOptions
                );

        } catch (error) {
            const normalized =
                normalizeFetchError(
                    error,
                    {
                        method,

                        url:
                            url.href,

                        requestId,

                        signal:
                            combined.signal,

                        timedOut:
                            timeoutController
                                .timedOut
                    }
                );

            emit(
                "neyo:api-request-error",
                {
                    requestId,

                    method,

                    url:
                        url.href,

                    error:
                        normalized
                }
            );

            throw normalized;

        } finally {
            timeoutController
                .cleanup();

            combined
                .cleanup();
        }

        const responseType =
            options.responseType ||
            "auto";

        /*
         * For stream/raw callers, preserve the untouched
         * Response object.
         */

        if (
            responseType ===
                "response"
        ) {
            if (!response.ok) {
                let parsed = {
                    data: {},
                    raw: ""
                };

                try {
                    parsed =
                        await parseResponse(
                            response.clone(),
                            "auto"
                        );
                } catch {}

                const error =
                    new NeyoAPIError(
                        getErrorMessage(
                            parsed.data,
                            parsed.raw,
                            response
                        ),
                        {
                            status:
                                response.status,

                            statusText:
                                response
                                    .statusText,

                            method,

                            url:
                                url.href,

                            data:
                                parsed.data,

                            raw:
                                parsed.raw,

                            requestId,

                            response
                        }
                    );

                emit(
                    "neyo:api-request-error",
                    {
                        requestId,

                        method,

                        url:
                            url.href,

                        status:
                            response.status,

                        error
                    }
                );

                throw error;
            }

            emit(
                "neyo:api-request-end",
                {
                    requestId,

                    method,

                    url:
                        url.href,

                    status:
                        response.status
                }
            );

            return response;
        }

        const parsed =
            await parseResponse(
                response,
                responseType
            );

        if (!response.ok) {
            const error =
                new NeyoAPIError(
                    getErrorMessage(
                        parsed.data,
                        parsed.raw,
                        response
                    ),
                    {
                        status:
                            response.status,

                        statusText:
                            response
                                .statusText,

                        method,

                        url:
                            url.href,

                        data:
                            parsed.data,

                        raw:
                            parsed.raw,

                        requestId,

                        response
                    }
                );

            emit(
                "neyo:api-request-error",
                {
                    requestId,

                    method,

                    url:
                        url.href,

                    status:
                        response.status,

                    error
                }
            );

            throw error;
        }

        emit(
            "neyo:api-request-end",
            {
                requestId,

                method,

                url:
                    url.href,

                status:
                    response.status
            }
        );

        if (
            options.returnMeta ===
                true
        ) {
            return {
                data:
                    parsed.data,

                raw:
                    parsed.raw,

                response,

                status:
                    response.status,

                headers:
                    response.headers,

                requestId
            };
        }

        return parsed.data;
    }

    /* =====================================================
       GET
       ===================================================== */

    function get(
        url,
        options = {}
    ) {
        return request(
            url,
            {
                ...options,

                method:
                    "GET"
            }
        );
    }

    /* =====================================================
       POST
       ===================================================== */

    function post(
        url,
        body,
        options = {}
    ) {
        return request(
            url,
            {
                ...options,

                method:
                    "POST",

                body
            }
        );
    }

    /* =====================================================
       PUT
       ===================================================== */

    function put(
        url,
        body,
        options = {}
    ) {
        return request(
            url,
            {
                ...options,

                method:
                    "PUT",

                body
            }
        );
    }

    /* =====================================================
       PATCH
       ===================================================== */

    function patch(
        url,
        body,
        options = {}
    ) {
        return request(
            url,
            {
                ...options,

                method:
                    "PATCH",

                body
            }
        );
    }

    /* =====================================================
       DELETE
       ===================================================== */

    function remove(
        url,
        body = undefined,
        options = {}
    ) {
        return request(
            url,
            {
                ...options,

                method:
                    "DELETE",

                body
            }
        );
    }

    /* =====================================================
       RAW RESPONSE

       Used by streaming chat or special integrations.
       ===================================================== */

    function raw(
        url,
        options = {}
    ) {
        return request(
            url,
            {
                ...options,

                responseType:
                    "response"
            }
        );
    }

    /* =====================================================
       JSON REQUEST
       ===================================================== */

    function json(
        url,
        options = {}
    ) {
        return request(
            url,
            {
                ...options,

                responseType:
                    "json",

                accept:
                    options.accept ||
                    "application/json"
            }
        );
    }

    /* =====================================================
       AUTH API

       Transport only.
       auth.js decides what authenticated means.
       ===================================================== */

    const auth =
        Object.freeze({
            session(
                options = {}
            ) {
                return get(
                    ENDPOINTS.auth,
                    {
                        ...options,

                        redirect:
                            options.redirect ||
                            "error",

                        responseType:
                            "json"
                    }
                );
            },

            logout(
                options = {}
            ) {
                return post(
                    ENDPOINTS.auth,
                    {
                        action:
                            "logout"
                    },
                    {
                        ...options,

                        redirect:
                            options.redirect ||
                            "error",

                        responseType:
                            "json"
                    }
                );
            }
        });

    /* =====================================================
       HISTORY API

       Current contract:
       GET  /api/history
       POST /api/history { action, conversationId, ... }
       ===================================================== */

    const history =
        Object.freeze({
            list(
                options = {}
            ) {
                return get(
                    ENDPOINTS.history,
                    {
                        ...options,

                        responseType:
                            "json"
                    }
                );
            },

            action(
                action,
                conversationId,
                payload = {},
                options = {}
            ) {
                const id =
                    clean(
                        conversationId,
                        160
                    );

                if (!action) {
                    return Promise.reject(
                        new TypeError(
                            "[NEYO API] History action is required."
                        )
                    );
                }

                return post(
                    ENDPOINTS.history,
                    {
                        action,

                        conversationId:
                            id || undefined,

                        ...(
                            payload &&
                            typeof payload ===
                                "object"
                                ? payload
                                : {}
                        )
                    },
                    {
                        ...options,

                        responseType:
                            "json"
                    }
                );
            },

            getConversation(
                conversationId,
                options = {}
            ) {
                return this.action(
                    "get",
                    conversationId,
                    {},
                    options
                );
            },

            rename(
                conversationId,
                title,
                options = {}
            ) {
                return this.action(
                    "rename",
                    conversationId,
                    {
                        title
                    },
                    options
                );
            },

            remove(
                conversationId,
                options = {}
            ) {
                return this.action(
                    "delete",
                    conversationId,
                    {},
                    options
                );
            },

            pin(
                conversationId,
                options = {}
            ) {
                return this.action(
                    "pin",
                    conversationId,
                    {},
                    options
                );
            },

            unpin(
                conversationId,
                options = {}
            ) {
                return this.action(
                    "unpin",
                    conversationId,
                    {},
                    options
                );
            }
        });

    /* =====================================================
       CHAT API

       Payload stays owned by chat-runtime/chat module.
       No schema rewriting here.
       ===================================================== */

    const chat =
        Object.freeze({
            send(
                payload,
                options = {}
            ) {
                return post(
                    ENDPOINTS.chat,
                    payload,
                    {
                        timeout:
                            options.timeout ??
                            DEFAULTS.longTimeout,

                        accept:
                            options.accept ||
                            "application/json, text/event-stream, application/x-ndjson",

                        ...options
                    }
                );
            },

            raw(
                payload,
                options = {}
            ) {
                return post(
                    ENDPOINTS.chat,
                    payload,
                    {
                        timeout:
                            options.timeout ??
                            DEFAULTS.longTimeout,

                        accept:
                            options.accept ||
                            "application/json, text/event-stream, application/x-ndjson",

                        responseType:
                            "response",

                        ...options
                    }
                );
            }
        });

    /* =====================================================
       LEGACY UPLOAD SESSION API

       Current /api/upload contract:
       {
           filename,
           mimeType,
           size
       }
       ===================================================== */

    const upload =
        Object.freeze({
            createSession({
                filename,
                mimeType,
                size
            } = {},
            options = {}) {
                return post(
                    ENDPOINTS.upload,
                    {
                        filename,

                        mimeType:
                            mimeType ||
                            "application/octet-stream",

                        size:
                            Number(
                                size
                            ) ||
                            0
                    },
                    {
                        ...options,

                        responseType:
                            "json"
                    }
                );
            }
        });

    /* =====================================================
       NEW ATTACHMENT API

       Current new NEYO flow:
       1. /api/attachments/upload
       2. signed storage PUT
       3. /api/attachments/process
       ===================================================== */

    const attachments =
        Object.freeze({
            createUploadSession(
                payload,
                options = {}
            ) {
                return post(
                    ENDPOINTS
                        .attachmentUpload,
                    payload,
                    {
                        ...options,

                        responseType:
                            "json"
                    }
                );
            },

            process(
                payload,
                options = {}
            ) {
                return post(
                    ENDPOINTS
                        .attachmentProcess,
                    payload,
                    {
                        timeout:
                            options.timeout ??
                            DEFAULTS.longTimeout,

                        ...options,

                        responseType:
                            "json"
                    }
                );
            },

            /*
             * Signed storage URL upload.
             *
             * credentials default to "omit" for external URL.
             *
             * Important:
             * FormData Content-Type is NOT manually set.
             */

            uploadSigned(
                signedUrl,
                body,
                options = {}
            ) {
                return request(
                    signedUrl,
                    {
                        method:
                            options.method ||
                            "PUT",

                        body,

                        credentials:
                            options.credentials ||
                            "omit",

                        headers:
                            options.headers,

                        timeout:
                            options.timeout ??
                            DEFAULTS.longTimeout,

                        responseType:
                            options.responseType ||
                            "auto",

                        cache:
                            "no-store",

                        signal:
                            options.signal
                    }
                );
            }
        });

    /* =====================================================
       PROFILE
       ===================================================== */

    const profile =
        Object.freeze({
            get(
                options = {}
            ) {
                return request(
                    ENDPOINTS.profile,
                    {
                        method:
                            options.method ||
                            "GET",

                        ...options,

                        responseType:
                            options.responseType ||
                            "json"
                    }
                );
            },

            save(
                payload,
                options = {}
            ) {
                return post(
                    ENDPOINTS.profile,
                    payload,
                    {
                        ...options,

                        responseType:
                            "json"
                    }
                );
            },

            avatar(
                body,
                options = {}
            ) {
                return request(
                    ENDPOINTS
                        .profileAvatar,
                    {
                        method:
                            options.method ||
                            "POST",

                        body,

                        ...options,

                        responseType:
                            options.responseType ||
                            "json"
                    }
                );
            }
        });

    /* =====================================================
       CHECKOUT
       ===================================================== */

    const checkout =
        Object.freeze({
            create(
                source,
                options = {}
            ) {
                return post(
                    ENDPOINTS.checkout,
                    {
                        source
                    },
                    {
                        ...options,

                        responseType:
                            "json"
                    }
                );
            }
        });

    /* =====================================================
       VOICE
       ===================================================== */

    const voice =
        Object.freeze({
            token(
                payload = {},
                options = {}
            ) {
                return post(
                    ENDPOINTS.voiceToken,
                    payload,
                    {
                        ...options,

                        responseType:
                            "json"
                    }
                );
            },

            transcribe(
                body,
                options = {}
            ) {
                return post(
                    ENDPOINTS.transcribe,
                    body,
                    {
                        timeout:
                            options.timeout ??
                            DEFAULTS.longTimeout,

                        ...options
                    }
                );
            }
        });

    /* =====================================================
       STATUS HELPERS
       ===================================================== */

    function isUnauthorized(
        error
    ) {
        return (
            error instanceof
                NeyoAPIError &&
            (
                error.status ===
                    401 ||
                error.status ===
                    403
            )
        );
    }

    function isRateLimited(
        error
    ) {
        return (
            error instanceof
                NeyoAPIError &&
            error.status ===
                429
        );
    }

    function isServerError(
        error
    ) {
        return (
            error instanceof
                NeyoAPIError &&
            error.status >=
                500
        );
    }

    function isAbortError(
        error
    ) {
        return Boolean(
            error?.name ===
                "AbortError" ||
            (
                error instanceof
                    NeyoAPIError &&
                error.isAbort
            )
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

            endpoints:
                ENDPOINTS,

            defaults:
                DEFAULTS,

            Error:
                NeyoAPIError,

            request,

            get,

            post,

            put,

            patch,

            delete:
                remove,

            remove,

            raw,

            json,

            auth,

            chat,

            history,

            upload,

            attachments,

            profile,

            checkout,

            voice,

            createRequestId,

            combineSignals,

            isSameOrigin,

            isUnauthorized,

            isRateLimited,

            isServerError,

            isAbortError,

            getState() {
                return {
                    version:
                        VERSION,

                    endpoints: {
                        ...ENDPOINTS
                    }
                };
            }
        });

    /* =====================================================
       GLOBAL
       ===================================================== */

    try {
        Object.defineProperty(
            window,
            "NeyoAPI",
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
        window.NeyoAPI =
            api;
    }

    /* =====================================================
       READY
       ===================================================== */

    emit(
        "neyo:api-ready",
        {
            version:
                VERSION,

            endpoints: {
                ...ENDPOINTS
            }
        }
    );

})();
