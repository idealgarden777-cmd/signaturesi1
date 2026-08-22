/*
=========================================================
NEYO — ATTACHMENTS CONTROLLER
FINAL v6 — DIRECT SIGNED UPLOAD

FILE:
public/js/components/attachments.js

FLOW
---------------------------------------------------------
1. User selects / drops / pastes file
2. Validate locally
3. POST metadata -> /api/attachments/upload
4. Receive uploadId + bucket + path + token + signedUrl
5. Upload directly to backend-generated Supabase signedUrl
6. POST metadata -> /api/attachments/process
7. Receive document / chunks / stats
8. Mark attachment READY

IMPORTANT
---------------------------------------------------------
✅ No browser Supabase client required
✅ Backend owns Supabase project selection
✅ Uses signed upload URL directly
✅ Never sends file bytes through Vercel API
✅ Explicit cacheControl avoids signed-upload bug
✅ Existing NEYO attachment events preserved
✅ #attachBtn remains owned by neo.js
=========================================================
*/

(() => {
    "use strict";

    /* =====================================================
       VERSION
       ===================================================== */

    const VERSION =
        "neyo-attachments-v6-direct-signed-upload";

    if (
        window.NeyoAttachments?.__controller ===
        true
    ) {
        console.warn(
            "[NEYO Attachments] Controller already initialized."
        );

        return;
    }


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG =
        Object.freeze({

            uploadSessionEndpoint:
                "/api/attachments/upload",

            processEndpoint:
                "/api/attachments/process",

            maxFiles:
                10,

            maxFileSize:
                100 * 1024 * 1024,

            maxTotalSize:
                300 * 1024 * 1024,

            uploadTimeoutMs:
                120_000,

            processTimeoutMs:
                180_000,

            cacheControl:
                "3600",

            debug:
                true
        });


    /* =====================================================
       DOM
       ===================================================== */

    const attachBtn =
        document.getElementById(
            "attachBtn"
        );

    const addFilesMenuBtn =
        document.getElementById(
            "addFilesMenuBtn"
        );

    const attachPopupMenu =
        document.getElementById(
            "attachPopupMenu"
        );

    const composerWrapper =
        document.getElementById(
            "composerWrapper"
        ) ||
        document.getElementById(
            "glassInputContainer"
        ) ||
        document.querySelector(
            ".composer-wrapper"
        ) ||
        document.body;

    const glassInputContainer =
        document.getElementById(
            "glassInputContainer"
        ) ||
        composerWrapper;

    const dragDropOverlay =
        document.getElementById(
            "dragDropOverlay"
        );

    let attachmentList =
        document.getElementById(
            "attachmentList"
        ) ||
        document.getElementById(
            "attachedChipsWrapper"
        );


    /*
    ---------------------------------------------------------
    Create attachment list if legacy HTML does not contain one.
    ---------------------------------------------------------
    */

    if (!attachmentList) {

        attachmentList =
            document.createElement(
                "div"
            );

        attachmentList.id =
            "attachmentList";

        attachmentList.className =
            "attached-chips-wrapper";

        attachmentList.hidden =
            true;

        glassInputContainer?.prepend(
            attachmentList
        );
    }


    /* =====================================================
       FILE INPUT
       ===================================================== */

    let fileInput =
        document.getElementById(
            "neyoAttachmentInput"
        );

    if (!fileInput) {

        fileInput =
            document.createElement(
                "input"
            );

        fileInput.type =
            "file";

        fileInput.id =
            "neyoAttachmentInput";

        fileInput.multiple =
            true;

        fileInput.hidden =
            true;

        fileInput.tabIndex =
            -1;

        fileInput.accept =
            "*/*";

        fileInput.setAttribute(
            "aria-hidden",
            "true"
        );

        document.body.appendChild(
            fileInput
        );
    }


    /* =====================================================
       STATE
       ===================================================== */

    const state = {

        items:
            new Map(),

        order:
            [],

        dragging:
            false
    };


    /* =====================================================
       EXTENSIONS
       ===================================================== */

    const EXTENSIONS =
        Object.freeze({

            document:
                new Set([
                    "pdf",
                    "doc",
                    "docx",
                    "odt",
                    "rtf",
                    "txt",
                    "md",
                    "markdown",
                    "tex"
                ]),

            spreadsheet:
                new Set([
                    "csv",
                    "tsv",
                    "xls",
                    "xlsx",
                    "xlsm",
                    "xlsb",
                    "ods"
                ]),

            presentation:
                new Set([
                    "ppt",
                    "pptx",
                    "odp"
                ]),

            image:
                new Set([
                    "png",
                    "jpg",
                    "jpeg",
                    "webp",
                    "gif",
                    "bmp",
                    "tif",
                    "tiff",
                    "svg",
                    "heic",
                    "heif",
                    "avif"
                ]),

            audio:
                new Set([
                    "mp3",
                    "wav",
                    "m4a",
                    "aac",
                    "ogg",
                    "oga",
                    "opus",
                    "flac",
                    "aiff"
                ]),

            video:
                new Set([
                    "mp4",
                    "mov",
                    "m4v",
                    "webm",
                    "avi",
                    "mkv",
                    "mpeg",
                    "mpg"
                ]),

            archive:
                new Set([
                    "zip",
                    "rar",
                    "7z",
                    "tar",
                    "gz",
                    "tgz",
                    "bz2",
                    "xz"
                ]),

            data:
                new Set([
                    "json",
                    "jsonl",
                    "ndjson",
                    "xml",
                    "yaml",
                    "yml",
                    "toml",
                    "ini",
                    "sql",
                    "db",
                    "sqlite",
                    "sqlite3",
                    "parquet"
                ]),

            code:
                new Set([
                    "js",
                    "mjs",
                    "cjs",
                    "jsx",
                    "ts",
                    "tsx",
                    "py",
                    "java",
                    "kt",
                    "c",
                    "h",
                    "cpp",
                    "hpp",
                    "cs",
                    "go",
                    "rs",
                    "php",
                    "rb",
                    "swift",
                    "dart",
                    "sh",
                    "bash",
                    "zsh",
                    "html",
                    "htm",
                    "css",
                    "scss",
                    "sass",
                    "less",
                    "vue",
                    "svelte",
                    "graphql",
                    "gql"
                ])
        });


    const BLOCKED_EXTENSIONS =
        new Set([
            "exe",
            "dll",
            "com",
            "scr",
            "msi",
            "bat",
            "cmd",
            "vbs",
            "vbe",
            "wsf",
            "wsh",
            "apk",
            "app",
            "dmg",
            "pkg",
            "deb",
            "rpm",
            "iso"
        ]);


    /* =====================================================
       DEBUG
       ===================================================== */

    function debug(
        ...args
    ) {

        if (!CONFIG.debug) {
            return;
        }

        console.log(
            "[NEYO Attachments]",
            ...args
        );
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


    function emitError(
        message,
        item = null
    ) {

        console.error(
            "[NEYO Attachments]",
            message
        );

        emit(
            "neyo:attachment-error",
            {
                message,

                attachment:
                    item
                        ? serializeItem(
                            item
                        )
                        : null
            }
        );
    }


    /* =====================================================
       HELPERS
       ===================================================== */

    function createId() {

        if (
            globalThis.crypto
                ?.randomUUID
        ) {
            return globalThis.crypto
                .randomUUID();
        }

        return (
            `att_${Date.now()}_` +
            Math.random()
                .toString(36)
                .slice(2)
        );
    }


    function clamp(
        value,
        min,
        max
    ) {

        return Math.max(
            min,
            Math.min(
                max,
                value
            )
        );
    }


    function getExtension(
        name
    ) {

        const value =
            String(
                name || ""
            );

        const index =
            value.lastIndexOf(
                "."
            );

        if (
            index < 0 ||
            index ===
                value.length - 1
        ) {
            return "";
        }

        return value
            .slice(
                index + 1
            )
            .toLowerCase()
            .trim();
    }


    function getCategory(
        extension
    ) {

        const ext =
            String(
                extension || ""
            )
                .toLowerCase();

        for (
            const [
                category,
                extensions
            ]
            of Object.entries(
                EXTENSIONS
            )
        ) {

            if (
                extensions.has(
                    ext
                )
            ) {
                return category;
            }
        }

        return "unknown";
    }


    function formatBytes(
        bytes
    ) {

        const value =
            Number(
                bytes
            ) || 0;

        if (
            value < 1024
        ) {
            return `${value} B`;
        }

        if (
            value <
            1024 * 1024
        ) {

            return `${(
                value / 1024
            ).toFixed(1)} KB`;
        }

        if (
            value <
            1024 *
            1024 *
            1024
        ) {

            return `${(
                value /
                (
                    1024 *
                    1024
                )
            ).toFixed(1)} MB`;
        }

        return `${(
            value /
            (
                1024 *
                1024 *
                1024
            )
        ).toFixed(2)} GB`;
    }


    function escapeHtml(
        value
    ) {

        return String(
            value ?? ""
        )
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );
    }


    function normalizeMime(
        file
    ) {

        const mime =
            String(
                file?.type ||
                ""
            )
                .trim()
                .toLowerCase();

        /*
        -----------------------------------------------------
        Backend currently accepts a controlled MIME list.

        For extensions whose browser MIME is outside that list,
        use application/octet-stream.

        Processing still receives the real extension/category.
        -----------------------------------------------------
        */

        const accepted =
            new Set([
                "image/jpeg",
                "image/png",
                "image/webp",

                "application/pdf",

                "text/plain",
                "text/html",
                "text/css",

                "application/javascript",
                "text/javascript",

                "application/json",

                "audio/mpeg",
                "audio/wav",

                "video/mp4",
                "video/webm",

                "application/octet-stream"
            ]);

        if (
            accepted.has(
                mime
            )
        ) {
            return mime;
        }

        return "application/octet-stream";
    }


    function getIcon(
        category
    ) {

        switch (
            category
        ) {

            case "document":
                return "file-text";

            case "spreadsheet":
                return "sheet";

            case "presentation":
                return "presentation";

            case "image":
                return "image";

            case "audio":
                return "audio-lines";

            case "video":
                return "video";

            case "archive":
                return "archive";

            case "code":
                return "file-code-2";

            case "data":
                return "database";

            default:
                return "file";
        }
    }


    function getStatusLabel(
        item
    ) {

        switch (
            item.status
        ) {

            case "queued":

            case "authorizing":

                return "Preparing";

            case "uploading":

                return `Uploading ${Math.round(
                    item.progress || 0
                )}%`;

            case "uploaded":

            case "processing":

                return "Reading";

            case "queued-processing":

                return "Processing";

            case "ready":

                return "Ready";

            case "error":

                return (
                    item.error ||
                    "Failed"
                );

            default:

                return "Preparing";
        }
    }


    function getTotalSize() {

        let total =
            0;

        for (
            const item
            of state.items.values()
        ) {

            total +=
                Number(
                    item.size
                ) || 0;
        }

        return total;
    }


    function isDuplicate(
        file
    ) {

        for (
            const item
            of state.items.values()
        ) {

            if (
                item.name ===
                    file.name &&
                item.size ===
                    file.size &&
                item.lastModified ===
                    file.lastModified
            ) {

                return true;
            }
        }

        return false;
    }


    /* =====================================================
       VALIDATE FILE
       ===================================================== */

    function validateFile(
        file
    ) {

        if (
            !(file instanceof File)
        ) {

            return {
                valid:
                    false,

                message:
                    "Invalid file."
            };
        }


        if (!file.name) {

            return {
                valid:
                    false,

                message:
                    "File name is missing."
            };
        }


        if (
            file.size <= 0
        ) {

            return {
                valid:
                    false,

                message:
                    `"${file.name}" is empty.`
            };
        }


        if (
            file.size >
            CONFIG.maxFileSize
        ) {

            return {
                valid:
                    false,

                message:
                    `"${file.name}" exceeds the ${formatBytes(
                        CONFIG.maxFileSize
                    )} file limit.`
            };
        }


        const extension =
            getExtension(
                file.name
            );


        if (
            BLOCKED_EXTENSIONS.has(
                extension
            )
        ) {

            return {
                valid:
                    false,

                message:
                    `"${file.name}" is not an allowed attachment type.`
            };
        }


        if (
            state.items.size >=
            CONFIG.maxFiles
        ) {

            return {
                valid:
                    false,

                message:
                    `Maximum ${CONFIG.maxFiles} attachments are allowed.`
            };
        }


        if (
            getTotalSize() +
            file.size >
            CONFIG.maxTotalSize
        ) {

            return {
                valid:
                    false,

                message:
                    `Total attachments cannot exceed ${formatBytes(
                        CONFIG.maxTotalSize
                    )}.`
            };
        }


        return {
            valid:
                true,

            extension,

            category:
                getCategory(
                    extension
                )
        };
    }


    /* =====================================================
       CREATE ITEM
       ===================================================== */

    function createItem(
        file
    ) {

        const extension =
            getExtension(
                file.name
            );

        return {

            id:
                createId(),

            file,

            name:
                file.name,

            size:
                file.size,

            mime:
                normalizeMime(
                    file
                ),

            extension,

            category:
                getCategory(
                    extension
                ),

            lastModified:
                file.lastModified,

            previewUrl:
                null,

            status:
                "queued",

            ready:
                false,

            progress:
                0,

            error:
                null,

            uploadId:
                null,

            bucket:
                null,

            path:
                null,

            token:
                null,

            signedUrl:
                null,

            processId:
                null,

            documentId:
                null,

            document:
                null,

            chunks:
                [],

            stats:
                null,

            extraction:
                null,

            warnings:
                [],

            processController:
                null
        };
    }


    function createPreviewUrl(
        item
    ) {

        if (
            item.category !==
            "image"
        ) {

            return null;
        }

        try {

            return URL
                .createObjectURL(
                    item.file
                );

        } catch {

            return null;
        }
    }


    /* =====================================================
       SERIALIZE
       ===================================================== */

    function serializeItem(
        item
    ) {

        return {

            id:
                item.id,

            uploadId:
                item.uploadId,

            processId:
                item.processId,

            documentId:
                item.documentId,

            name:
                item.name,

            size:
                item.size,

            mime:
                item.mime,

            mimeType:
                item.mime,

            extension:
                item.extension,

            category:
                item.category,

            status:
                item.status,

            ready:
                Boolean(
                    item.ready
                ),

            progress:
                Math.round(
                    item.progress || 0
                ),

            bucket:
                item.bucket,

            path:
                item.path,

            document:
                item.document,

            chunks:
                Array.isArray(
                    item.chunks
                )
                    ? item.chunks
                    : [],

            stats:
                item.stats,

            extraction:
                item.extraction,

            warnings:
                Array.isArray(
                    item.warnings
                )
                    ? item.warnings
                    : [],

            error:
                item.error
        };
    }


    function getAll() {

        return state.order
            .map(
                id =>
                    state.items.get(
                        id
                    )
            )
            .filter(
                Boolean
            )
            .map(
                serializeItem
            );
    }


    function getReady() {

        return state.order
            .map(
                id =>
                    state.items.get(
                        id
                    )
            )
            .filter(
                item =>
                    item &&
                    item.ready === true &&
                    item.status ===
                        "ready"
            )
            .map(
                serializeItem
            );
    }


    /* =====================================================
       STATE EMIT
       ===================================================== */

    function emitState() {

        const all =
            getAll();

        const ready =
            all.filter(
                item =>
                    item.ready
            );

        const errors =
            all.filter(
                item =>
                    item.status ===
                    "error"
            );

        const pending =
            all.some(
                item =>
                    [
                        "queued",
                        "authorizing",
                        "uploading",
                        "uploaded",
                        "processing",
                        "queued-processing"
                    ].includes(
                        item.status
                    )
            );


        emit(
            "neyo:attachments-change",
            {

                count:
                    all.length,

                ready:
                    ready.length,

                errors:
                    errors.length,

                pending,

                totalSize:
                    getTotalSize(),

                attachments:
                    all
            }
        );
    }


    function syncComposerClass() {

        const hasFiles =
            state.items.size >
            0;

        composerWrapper
            ?.classList
            .toggle(
                "has-attachments",
                hasFiles
            );

        glassInputContainer
            ?.classList
            .toggle(
                "has-attachments",
                hasFiles
            );
    }


    /* =====================================================
       RENDER
       ===================================================== */

    function renderItem(
        item
    ) {

        if (!attachmentList) {
            return;
        }

        let chip =
            attachmentList
                .querySelector(
                    `[data-attachment-id="${item.id}"]`
                );


        if (!chip) {

            chip =
                document.createElement(
                    "div"
                );

            chip.className =
                "attachment-chip";

            chip.dataset
                .attachmentId =
                item.id;

            attachmentList
                .appendChild(
                    chip
                );
        }


        chip.dataset.status =
            item.status;


        const status =
            getStatusLabel(
                item
            );


        const isError =
            item.status ===
            "error";


        const preview =
            item.previewUrl

                ? `
                    <div
                        class="attachment-chip-preview"
                    >
                        <img
                            src="${escapeHtml(
                                item.previewUrl
                            )}"
                            alt=""
                        >
                    </div>
                `

                : `
                    <div
                        class="attachment-chip-icon"
                    >
                        <i
                            data-lucide="${getIcon(
                                item.category
                            )}"
                            size="16"
                        ></i>
                    </div>
                `;


        const action =
            isError

                ? `
                    <button
                        class="attachment-chip-retry"
                        type="button"
                        data-action="retry"
                        title="Retry"
                        aria-label="Retry attachment"
                    >
                        <i
                            data-lucide="rotate-ccw"
                            size="14"
                        ></i>
                    </button>
                `

                : `
                    <button
                        class="attachment-chip-remove"
                        type="button"
                        data-action="remove"
                        title="Remove"
                        aria-label="Remove attachment"
                    >
                        <i
                            data-lucide="x"
                            size="14"
                        ></i>
                    </button>
                `;


        const progress =
            item.status ===
            "uploading"

                ? `
                    <div
                        class="attachment-chip-progress"
                    >
                        <span
                            style="width:${clamp(
                                item.progress || 0,
                                0,
                                100
                            )}%"
                        ></span>
                    </div>
                `

                : "";


        chip.innerHTML =
            `
                ${preview}

                <div
                    class="attachment-chip-body"
                >

                    <div
                        class="attachment-chip-name"
                        title="${escapeHtml(
                            item.name
                        )}"
                    >
                        ${escapeHtml(
                            item.name
                        )}
                    </div>

                    <div
                        class="attachment-chip-meta"
                    >

                        <span>
                            ${escapeHtml(
                                formatBytes(
                                    item.size
                                )
                            )}
                        </span>

                        <span
                            aria-hidden="true"
                        >
                            ·
                        </span>

                        <span
                            class="attachment-chip-status"
                            title="${escapeHtml(
                                status
                            )}"
                        >
                            ${escapeHtml(
                                status
                            )}
                        </span>

                    </div>

                    ${progress}

                </div>

                ${action}
            `;


        try {

            window.lucide
                ?.createIcons
                ?.();

        } catch {}
    }


    function renderAll() {

        if (!attachmentList) {
            return;
        }


        for (
            const id
            of state.order
        ) {

            const item =
                state.items.get(
                    id
                );

            if (item) {

                renderItem(
                    item
                );
            }
        }


        const knownIds =
            new Set(
                state.order
            );


        for (
            const chip
            of attachmentList
                .querySelectorAll(
                    "[data-attachment-id]"
                )
        ) {

            if (
                !knownIds.has(
                    chip.dataset
                        .attachmentId
                )
            ) {

                chip.remove();
            }
        }


        attachmentList.hidden =
            state.items.size ===
            0;

        syncComposerClass();

        emitState();
    }


    /* =====================================================
       PICKER
       ===================================================== */

    function openPicker() {

        try {

            fileInput.click();

            return true;

        } catch (
            error
        ) {

            console.error(
                "[NEYO Attachments] Could not open file picker:",
                error
            );

            return false;
        }
    }


    function closeLegacyPopup() {

        if (!attachPopupMenu) {
            return;
        }

        attachPopupMenu
            .classList
            .remove(
                "active",
                "open",
                "show"
            );

        attachPopupMenu
            .setAttribute(
                "aria-hidden",
                "true"
            );

        attachBtn
            ?.setAttribute(
                "aria-expanded",
                "false"
            );
    }


    /* =====================================================
       ADD FILES
       ===================================================== */

    async function addFiles(
        files
    ) {

        const incoming =
            Array.from(
                files || []
            );

        if (
            incoming.length ===
            0
        ) {

            return [];
        }


        const added =
            [];


        for (
            const file
            of incoming
        ) {

            if (
                isDuplicate(
                    file
                )
            ) {

                debug(
                    "Duplicate ignored:",
                    file.name
                );

                continue;
            }


            const validation =
                validateFile(
                    file
                );


            if (
                !validation.valid
            ) {

                emitError(
                    validation.message
                );

                continue;
            }


            const item =
                createItem(
                    file
                );


            item.previewUrl =
                createPreviewUrl(
                    item
                );


            state.items.set(
                item.id,
                item
            );


            state.order.push(
                item.id
            );


            added.push(
                serializeItem(
                    item
                )
            );


            renderItem(
                item
            );

            renderAll();


            /*
            -------------------------------------------------
            Pipeline runs asynchronously.
            -------------------------------------------------
            */

            void processPipeline(
                item.id
            );
        }


        return added;
    }


    /* =====================================================
       FETCH JSON HELPER
       ===================================================== */

    async function readResponse(
        response
    ) {

        const raw =
            await response
                .text();

        let data =
            null;


        if (raw) {

            try {

                data =
                    JSON.parse(
                        raw
                    );

            } catch {}
        }


        return {
            raw,
            data
        };
    }


    /* =====================================================
       STEP 1 — CREATE UPLOAD SESSION
       ===================================================== */

    async function createUploadSession(
        item
    ) {

        if (!item?.name) {

            throw new Error(
                "Attachment filename is missing before upload."
            );
        }


        const payload =
            {

                name:
                    item.name,

                size:
                    item.size,

                mime:
                    item.mime,

                extension:
                    item.extension,

                category:
                    item.category,

                clientAttachmentId:
                    item.id
            };


        debug(
            "UPLOAD_SESSION_REQUEST",
            payload
        );


        const response =
            await fetch(
                CONFIG
                    .uploadSessionEndpoint,
                {

                    method:
                        "POST",

                    credentials:
                        "include",

                    cache:
                        "no-store",

                    headers:
                        {

                            "Content-Type":
                                "application/json",

                            Accept:
                                "application/json",

                            "X-Neyo-Attachment-Client":
                                VERSION
                        },

                    body:
                        JSON.stringify(
                            payload
                        )
                }
            );


        const {
            data,
            raw
        } =
            await readResponse(
                response
            );


        debug(
            "UPLOAD_SESSION_RESPONSE",
            {

                status:
                    response.status,

                ok:
                    response.ok,

                data,

                raw:
                    data
                        ? undefined
                        : raw
            }
        );


        if (!response.ok) {

            throw new Error(
                data?.error ||
                raw ||
                `Upload authorization failed (${response.status}).`
            );
        }


        if (
            !data ||
            typeof data !==
                "object"
        ) {

            throw new Error(
                "Upload API returned an invalid response."
            );
        }


        if (!data.uploadId) {

            throw new Error(
                "Upload ID is missing."
            );
        }


        if (!data.bucket) {

            throw new Error(
                "Storage bucket is missing."
            );
        }


        if (!data.path) {

            throw new Error(
                "Storage path is missing."
            );
        }


        if (!data.token) {

            throw new Error(
                "Signed upload token is missing."
            );
        }


        /*
        -----------------------------------------------------
        v6 requires signedUrl.

        Backend creates this against the correct Supabase
        project so frontend does not need its own client.
        -----------------------------------------------------
        */

        if (!data.signedUrl) {

            throw new Error(
                "Signed upload URL is missing."
            );
        }


        return data;
    }


    /* =====================================================
       STEP 2 — DIRECT SIGNED UPLOAD
       ===================================================== */

    async function uploadToSignedUrl(
        item,
        session
    ) {

        if (
            !session?.signedUrl ||
            !session?.bucket ||
            !session?.path ||
            !session?.token
        ) {

            throw new Error(
                "Signed upload information is incomplete."
            );
        }


        if (
            !(item?.file instanceof File)
        ) {

            throw new Error(
                "Attachment file is unavailable."
            );
        }


        item.progress =
            0;

        renderItem(
            item
        );

        emitState();


        const controller =
            new AbortController();


        const timeout =
            window.setTimeout(
                () => {

                    controller.abort();

                },
                CONFIG
                    .uploadTimeoutMs
            );


        try {

            /*
            -------------------------------------------------
            Supabase Storage signed-upload body.

            Important:
            Do NOT manually set Content-Type header here.
            Browser must generate multipart boundary itself.
            -------------------------------------------------
            */

            const form =
                new FormData();


            form.append(
                "cacheControl",
                CONFIG.cacheControl
            );


            form.append(
                "",
                item.file,
                item.file.name
            );


            let signedHost =
                null;


            try {

                signedHost =
                    new URL(
                        session.signedUrl
                    ).host;

            } catch {}


            debug(
                "SIGNED_UPLOAD_REQUEST",
                {

                    uploadId:
                        session.uploadId,

                    bucket:
                        session.bucket,

                    path:
                        session.path,

                    signedHost,

                    size:
                        item.file.size,

                    mime:
                        item.mime
                }
            );


            /*
            -------------------------------------------------
            Show uploading state.

            Raw fetch does not expose reliable upload progress,
            so keep a visual non-zero state while uploading.
            -------------------------------------------------
            */

            item.progress =
                15;

            renderItem(
                item
            );

            emitState();


            const response =
                await fetch(
                    session.signedUrl,
                    {

                        method:
                            "PUT",

                        headers:
                            {

                                "x-upsert":
                                    "false"
                            },

                        body:
                            form,

                        cache:
                            "no-store",

                        signal:
                            controller.signal
                    }
                );


            const {
                data,
                raw
            } =
                await readResponse(
                    response
                );


            debug(
                "SIGNED_UPLOAD_RESPONSE",
                {

                    status:
                        response.status,

                    ok:
                        response.ok,

                    data,

                    raw:
                        data
                            ? undefined
                            : raw
                }
            );


            if (!response.ok) {

                const message =
                    data?.message ||
                    data?.error ||
                    data?.error_description ||
                    raw ||
                    `Supabase upload failed (${response.status}).`;


                throw new Error(
                    String(
                        message
                    )
                );
            }


            item.progress =
                100;

            item.status =
                "uploaded";


            renderItem(
                item
            );

            emitState();


            return true;

        } catch (
            error
        ) {

            if (
                error?.name ===
                "AbortError"
            ) {

                throw new Error(
                    "File upload timed out."
                );
            }


            throw error;

        } finally {

            window.clearTimeout(
                timeout
            );
        }
    }


    /* =====================================================
       STEP 3 — PROCESS FILE
       ===================================================== */

    async function requestProcessing(
        item
    ) {

        const controller =
            new AbortController();


        item.processController =
            controller;


        const timer =
            window.setTimeout(
                () => {

                    controller.abort();

                },
                CONFIG
                    .processTimeoutMs
            );


        try {

            const payload =
                {

                    uploadId:
                        item.uploadId,

                    bucket:
                        item.bucket,

                    path:
                        item.path,

                    name:
                        item.name,

                    size:
                        item.size,

                    mime:
                        item.mime,

                    extension:
                        item.extension,

                    category:
                        item.category
                };


            debug(
                "PROCESS_REQUEST",
                payload
            );


            const response =
                await fetch(
                    CONFIG
                        .processEndpoint,
                    {

                        method:
                            "POST",

                        credentials:
                            "include",

                        cache:
                            "no-store",

                        headers:
                            {

                                "Content-Type":
                                    "application/json",

                                Accept:
                                    "application/json",

                                "X-Neyo-Attachment-Client":
                                    VERSION
                            },

                        body:
                            JSON.stringify(
                                payload
                            ),

                        signal:
                            controller.signal
                    }
                );


            const {
                data,
                raw
            } =
                await readResponse(
                    response
                );


            debug(
                "PROCESS_RESPONSE",
                {

                    status:
                        response.status,

                    ok:
                        response.ok,

                    data,

                    raw:
                        data
                            ? undefined
                            : raw
                }
            );


            /*
            -------------------------------------------------
            202 = processing accepted asynchronously.
            -------------------------------------------------
            */

            if (
                response.status ===
                202
            ) {

                return {

                    queued:
                        true,

                    data:
                        data || {}
                };
            }


            if (!response.ok) {

                throw new Error(
                    data?.error ||
                    raw ||
                    `File processing failed (${response.status}).`
                );
            }


            return {

                queued:
                    false,

                data:
                    data || {}
            };

        } catch (
            error
        ) {

            if (
                error?.name ===
                "AbortError"
            ) {

                throw new Error(
                    "File processing timed out."
                );
            }


            throw error;

        } finally {

            window.clearTimeout(
                timer
            );


            item.processController =
                null;
        }
    }


    /* =====================================================
       COMPLETE PIPELINE
       ===================================================== */

    async function processPipeline(
        id
    ) {

        const item =
            state.items.get(
                id
            );


        if (!item) {

            return false;
        }


        try {

            /* ---------------------------------------------
               PREPARING
               --------------------------------------------- */

            item.status =
                "authorizing";

            item.error =
                null;

            item.progress =
                0;

            item.ready =
                false;


            renderItem(
                item
            );

            emitState();


            /* ---------------------------------------------
               CREATE SIGNED SESSION
               --------------------------------------------- */

            const session =
                await createUploadSession(
                    item
                );


            if (
                !state.items.has(
                    id
                )
            ) {

                return false;
            }


            item.uploadId =
                session.uploadId;

            item.bucket =
                session.bucket;

            item.path =
                session.path;

            item.token =
                session.token;

            item.signedUrl =
                session.signedUrl;


            /* ---------------------------------------------
               UPLOAD
               --------------------------------------------- */

            item.status =
                "uploading";


            renderItem(
                item
            );

            emitState();


            await uploadToSignedUrl(
                item,
                session
            );


            if (
                !state.items.has(
                    id
                )
            ) {

                return false;
            }


            /* ---------------------------------------------
               PROCESS
               --------------------------------------------- */

            item.status =
                "processing";


            renderItem(
                item
            );

            emitState();


            const processing =
                await requestProcessing(
                    item
                );


            if (
                !state.items.has(
                    id
                )
            ) {

                return false;
            }


            const data =
                processing.data ||
                {};


            item.processId =
                data.processId ||
                null;


            item.documentId =
                data.documentId ||
                null;


            item.stats =
                data.stats ||
                null;


            item.warnings =
                Array.isArray(
                    data.warnings
                )
                    ? data.warnings
                    : [];


            /* ---------------------------------------------
               QUEUED PROCESSING
               --------------------------------------------- */

            if (
                processing.queued
            ) {

                item.status =
                    "queued-processing";

                item.ready =
                    false;


                renderItem(
                    item
                );

                emitState();


                emit(
                    "neyo:attachment-processing-queued",
                    {

                        attachment:
                            serializeItem(
                                item
                            )
                    }
                );


                return true;
            }


            /* ---------------------------------------------
               READY
               --------------------------------------------- */

            item.document =
                data.document ||
                null;


            item.chunks =
                Array.isArray(
                    data.chunks
                )
                    ? data.chunks
                    : [];


            item.extraction =
                data.extraction ||
                null;


            item.ready =
                data.ready !==
                false;


            item.status =
                "ready";


            renderItem(
                item
            );

            emitState();


            emit(
                "neyo:attachment-ready",
                {

                    attachment:
                        serializeItem(
                            item
                        )
                }
            );


            debug(
                "READY",
                {

                    name:
                        item.name,

                    category:
                        item.category,

                    uploadId:
                        item.uploadId,

                    bucket:
                        item.bucket,

                    path:
                        item.path,

                    documentId:
                        item.documentId,

                    chunks:
                        item.chunks.length,

                    parser:
                        item.extraction
                            ?.parser ||
                        null
                }
            );


            return true;

        } catch (
            error
        ) {

            if (
                !state.items.has(
                    id
                )
            ) {

                return false;
            }


            item.status =
                "error";

            item.ready =
                false;

            item.progress =
                0;

            item.error =
                error?.message ||
                "Couldn't process this file.";


            renderItem(
                item
            );

            emitState();


            emitError(
                item.error,
                item
            );


            debug(
                "PIPELINE_ERROR",
                {

                    name:
                        item.name,

                    uploadId:
                        item.uploadId,

                    bucket:
                        item.bucket,

                    path:
                        item.path,

                    error:
                        item.error
                }
            );


            return false;
        }
    }


    /* =====================================================
       RETRY
       ===================================================== */

    function resetItemForRetry(
        item
    ) {

        try {

            item.processController
                ?.abort
                ?.();

        } catch {}


        item.processController =
            null;


        item.uploadId =
            null;

        item.bucket =
            null;

        item.path =
            null;

        item.token =
            null;

        item.signedUrl =
            null;

        item.processId =
            null;

        item.documentId =
            null;

        item.document =
            null;

        item.chunks =
            [];

        item.stats =
            null;

        item.extraction =
            null;

        item.warnings =
            [];

        item.status =
            "queued";

        item.progress =
            0;

        item.error =
            null;

        item.ready =
            false;
    }


    function retryAttachment(
        id
    ) {

        const item =
            state.items.get(
                id
            );


        if (!item) {

            return false;
        }


        resetItemForRetry(
            item
        );


        renderItem(
            item
        );

        emitState();


        void processPipeline(
            id
        );


        return true;
    }


    /* =====================================================
       REMOVE
       ===================================================== */

    function removeAttachment(
        id
    ) {

        const item =
            state.items.get(
                id
            );


        if (!item) {

            return false;
        }


        try {

            item.processController
                ?.abort
                ?.();

        } catch {}


        if (
            item.previewUrl
        ) {

            try {

                URL.revokeObjectURL(
                    item.previewUrl
                );

            } catch {}
        }


        state.items.delete(
            id
        );


        state.order =
            state.order.filter(
                value =>
                    value !==
                    id
            );


        attachmentList
            ?.querySelector(
                `[data-attachment-id="${id}"]`
            )
            ?.remove();


        renderAll();


        emit(
            "neyo:attachment-removed",
            {

                id,

                uploadId:
                    item.uploadId,

                bucket:
                    item.bucket,

                path:
                    item.path
            }
        );


        return true;
    }


    /* =====================================================
       CLEAR
       ===================================================== */

    function clearAttachments() {

        for (
            const id
            of [
                ...state.order
            ]
        ) {

            removeAttachment(
                id
            );
        }


        if (
            attachmentList
        ) {

            attachmentList.innerHTML =
                "";

            attachmentList.hidden =
                true;
        }


        syncComposerClass();

        emitState();
    }


    /* =====================================================
       ATTACH BUTTON OWNERSHIP
       ===================================================== */

    if (
        attachBtn
    ) {

        debug(
            "#attachBtn preserved for neo.js popup UX."
        );
    }


    if (
        addFilesMenuBtn
    ) {

        addFilesMenuBtn
            .addEventListener(
                "click",
                event => {

                    event.preventDefault();

                    event.stopPropagation();

                    event.stopImmediatePropagation();


                    closeLegacyPopup();

                    openPicker();
                },
                true
            );
    }


    /* =====================================================
       FILE INPUT
       ===================================================== */

    fileInput.addEventListener(
        "change",
        async event => {

            const files =
                Array.from(
                    event.target
                        ?.files ||
                    []
                );


            /*
            -------------------------------------------------
            Reset allows selecting same file again after remove.
            -------------------------------------------------
            */

            fileInput.value =
                "";


            if (
                files.length ===
                0
            ) {

                return;
            }


            await addFiles(
                files
            );
        }
    );


    /* =====================================================
       EXTERNAL OPEN EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:attachments-open-request",
        () => {

            openPicker();
        }
    );


    /* =====================================================
       DRAG / DROP
       ===================================================== */

    function eventHasFiles(
        event
    ) {

        const types =
            Array.from(
                event?.dataTransfer
                    ?.types ||
                []
            );

        return types.includes(
            "Files"
        );
    }


    function isInsideComposer(
        event
    ) {

        const target =
            event.target;


        if (
            !target ||
            !(
                target instanceof
                Node
            )
        ) {

            return false;
        }


        return Boolean(
            composerWrapper
                ?.contains(
                    target
                )
        );
    }


    function setDragging(
        active
    ) {

        state.dragging =
            Boolean(
                active
            );


        composerWrapper
            ?.classList
            .toggle(
                "is-file-dragging",
                state.dragging
            );


        dragDropOverlay
            ?.classList
            .toggle(
                "active",
                state.dragging
            );


        dragDropOverlay
            ?.setAttribute(
                "aria-hidden",
                state.dragging
                    ? "false"
                    : "true"
            );
    }


    document.addEventListener(
        "dragenter",
        event => {

            if (
                !eventHasFiles(
                    event
                ) ||
                !isInsideComposer(
                    event
                )
            ) {

                return;
            }


            event.preventDefault();

            event.stopPropagation();


            setDragging(
                true
            );
        },
        true
    );


    document.addEventListener(
        "dragover",
        event => {

            if (
                !eventHasFiles(
                    event
                ) ||
                !isInsideComposer(
                    event
                )
            ) {

                return;
            }


            event.preventDefault();

            event.stopPropagation();


            if (
                event.dataTransfer
            ) {

                event.dataTransfer
                    .dropEffect =
                    "copy";
            }


            setDragging(
                true
            );
        },
        true
    );


    document.addEventListener(
        "dragleave",
        event => {

            if (
                !state.dragging
            ) {

                return;
            }


            const related =
                event.relatedTarget;


            if (
                related instanceof
                    Node &&
                composerWrapper
                    ?.contains(
                        related
                    )
            ) {

                return;
            }


            setDragging(
                false
            );
        },
        true
    );


    document.addEventListener(
        "drop",
        async event => {

            if (
                !eventHasFiles(
                    event
                ) ||
                !isInsideComposer(
                    event
                )
            ) {

                return;
            }


            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation();


            setDragging(
                false
            );


            const files =
                Array.from(
                    event.dataTransfer
                        ?.files ||
                    []
                );


            if (
                files.length >
                0
            ) {

                await addFiles(
                    files
                );
            }
        },
        true
    );


    /* =====================================================
       PASTE FILES
       ===================================================== */

    document.addEventListener(
        "paste",
        async event => {

            const clipboard =
                event.clipboardData;


            if (!clipboard) {

                return;
            }


            const files =
                [];


            for (
                const clipboardItem
                of clipboard.items
            ) {

                if (
                    clipboardItem.kind !==
                    "file"
                ) {

                    continue;
                }


                const file =
                    clipboardItem
                        .getAsFile();


                if (file) {

                    files.push(
                        file
                    );
                }
            }


            if (
                files.length ===
                0
            ) {

                return;
            }


            event.preventDefault();


            await addFiles(
                files
            );
        },
        true
    );


    /* =====================================================
       CHIP BUTTONS
       ===================================================== */

    attachmentList
        ?.addEventListener(
            "click",
            event => {

                const button =
                    event.target
                        ?.closest
                        ?.(
                            "[data-action]"
                        );


                if (!button) {

                    return;
                }


                const chip =
                    button.closest(
                        "[data-attachment-id]"
                    );


                const id =
                    chip?.dataset
                        ?.attachmentId;


                if (!id) {

                    return;
                }


                if (
                    button.dataset
                        .action ===
                    "remove"
                ) {

                    removeAttachment(
                        id
                    );

                    return;
                }


                if (
                    button.dataset
                        .action ===
                    "retry"
                ) {

                    retryAttachment(
                        id
                    );
                }
            }
        );


    /* =====================================================
       CLEAR REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:attachments-clear-request",
        () => {

            clearAttachments();
        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    const publicApi =
        Object.freeze({

            __controller:
                true,

            version:
                VERSION,


            /*
            -------------------------------------------------
            Compatibility method.

            Old code may try to wire a Supabase client.
            v6 no longer needs it, so return true safely.
            -------------------------------------------------
            */

            setSupabaseClient:
                () => {

                    debug(
                        "External Supabase client ignored; v6 uses backend signedUrl."
                    );

                    return true;
                },


            open:
                openPicker,

            addFiles,

            remove:
                removeAttachment,

            retry:
                retryAttachment,

            clear:
                clearAttachments,

            getAll,

            getReady,


            hasPending:
                () =>
                    getAll()
                        .some(
                            item =>
                                [
                                    "queued",
                                    "authorizing",
                                    "uploading",
                                    "uploaded",
                                    "processing",
                                    "queued-processing"
                                ].includes(
                                    item.status
                                )
                        ),


            hasErrors:
                () =>
                    getAll()
                        .some(
                            item =>
                                item.status ===
                                "error"
                        ),


            getState:
                () => ({

                    version:
                        VERSION,

                    count:
                        state.items.size,

                    totalSize:
                        getTotalSize(),

                    dragging:
                        state.dragging,

                    ready:
                        getReady()
                            .length,

                    attachments:
                        getAll()
                })
        });


    Object.defineProperty(
        window,
        "NeyoAttachments",
        {

            value:
                publicApi,

            writable:
                false,

            configurable:
                true,

            enumerable:
                true
        }
    );


    /* =====================================================
       INIT
       ===================================================== */

    attachmentList.hidden =
        true;


    syncComposerClass();


    emitState();


    emit(
        "neyo:attachments-ready",
        {

            version:
                VERSION
        }
    );


    debug(
        "FINAL v6 READY",
        {

            version:
                VERSION,

            maxFiles:
                CONFIG.maxFiles,

            maxFileSize:
                formatBytes(
                    CONFIG.maxFileSize
                ),

            maxTotalSize:
                formatBytes(
                    CONFIG.maxTotalSize
                ),

            privateInput:
                fileInput.id,

            attachmentList:
                attachmentList.id,

            attachBtnOwnedByNeo:
                Boolean(
                    attachBtn
                ),

            addFilesOwned:
                Boolean(
                    addFilesMenuBtn
                ),

            directSignedUpload:
                true,

            browserSupabaseClientRequired:
                false
        }
    );

})();
