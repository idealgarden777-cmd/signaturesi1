/*
=========================================================
NEO — ATTACHMENTS
Production v1

Owns:
- selected File objects
- validation
- local image preview
- upload authorization
- signed storage upload
- processing
- ready/error state
- retry/remove/clear
- drag/drop + file paste

Does NOT own:
- chat sending
- send button
- textarea
- model menu
- voice
- message rendering
- topbar
=========================================================
*/

(() => {
  "use strict";

  const VERSION = "neo-attachments-production-v1";

  if (window.NeyoAttachments?.__controller === true) return;

  const CONFIG = Object.freeze({
    uploadEndpoint: "/api/attachments/upload",
    processEndpoint: "/api/attachments/process",

    maxFiles: 5,
    maxFileSize: 100 * 1024 * 1024,
    maxTotalSize: 300 * 1024 * 1024,

    uploadTimeoutMs: 120000,
    processTimeoutMs: 180000
  });

  /* =====================================================
     DOM
     ===================================================== */

  const attachBtn =
    document.getElementById("attachBtn");

  const attachmentBtn =
    document.getElementById("attachmentBtn");

  const addFilesMenuBtn =
    document.getElementById("addFilesMenuBtn");

  const attachPopupMenu =
    document.getElementById("attachPopupMenu");

  const composer =
    document.getElementById("composerWrapper") ||
    document.getElementById("glassInputContainer") ||
    document.querySelector(".composer-wrapper") ||
    document.querySelector(".composer");

  const dropZone =
    composer || document.body;

  let attachmentList =
    document.getElementById("attachmentList") ||
    document.getElementById("attachedChipsWrapper");

  if (!attachmentList) {
    attachmentList = document.createElement("div");
    attachmentList.id = "attachmentList";
    attachmentList.className =
      "attached-chips-wrapper attachment-list";
    attachmentList.hidden = true;

    (
      document.getElementById("glassInputContainer") ||
      composer ||
      document.body
    ).prepend(attachmentList);
  }

  /* =====================================================
     PRIVATE FILE INPUT

     Important:
     Old neo.js must never receive the real FileList.
     ===================================================== */

  let fileInput =
    document.getElementById("neyoAttachmentInput");

  if (!fileInput) {
    fileInput = document.createElement("input");
    fileInput.id = "neyoAttachmentInput";
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.accept = "*/*";
    fileInput.hidden = true;
    fileInput.tabIndex = -1;
    fileInput.setAttribute("aria-hidden", "true");
    document.body.appendChild(fileInput);
  }

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    items: new Map(),
    order: [],
    dragging: false
  };

  const PENDING_STATES = new Set([
    "queued",
    "authorizing",
    "uploading",
    "processing",
    "queued-processing"
  ]);

  /* =====================================================
     TYPES
     ===================================================== */

  const TYPES = Object.freeze({
    document: new Set([
      "pdf", "doc", "docx", "odt", "rtf",
      "txt", "md", "markdown", "tex", "pages"
    ]),

    spreadsheet: new Set([
      "csv", "tsv", "xls", "xlsx",
      "xlsm", "xlsb", "ods", "numbers"
    ]),

    presentation: new Set([
      "ppt", "pptx", "odp", "key"
    ]),

    image: new Set([
      "png", "jpg", "jpeg", "webp", "gif",
      "bmp", "tif", "tiff", "svg",
      "heic", "heif", "avif"
    ]),

    audio: new Set([
      "mp3", "wav", "m4a", "aac", "ogg",
      "oga", "opus", "flac", "aiff", "wma"
    ]),

    video: new Set([
      "mp4", "mov", "m4v", "webm",
      "avi", "mkv", "mpeg", "mpg", "wmv"
    ]),

    archive: new Set([
      "zip", "rar", "7z", "tar",
      "gz", "tgz", "bz2", "xz"
    ]),

    data: new Set([
      "json", "jsonl", "ndjson",
      "xml", "yaml", "yml",
      "toml", "ini", "sql",
      "parquet", "feather", "arrow"
    ]),

    code: new Set([
      "js", "mjs", "cjs", "jsx",
      "ts", "tsx", "py", "java",
      "kt", "c", "h", "cc", "cpp",
      "hpp", "cs", "go", "rs",
      "php", "rb", "swift", "dart",
      "sh", "bash", "zsh",
      "html", "htm", "css",
      "scss", "sass", "less",
      "vue", "svelte", "graphql",
      "gql", "proto"
    ])
  });

  const BLOCKED_EXTENSIONS = new Set([
    "exe", "dll", "com", "scr",
    "msi", "bat", "cmd",
    "vbs", "vbe", "wsf", "wsh",
    "apk", "app", "dmg",
    "pkg", "deb", "rpm"
  ]);

  /* =====================================================
     HELPERS
     ===================================================== */

  function emit(name, detail = {}) {
    window.dispatchEvent(
      new CustomEvent(name, { detail })
    );
  }

  function createId() {
    return (
      globalThis.crypto?.randomUUID?.() ||
      `att_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`
    );
  }

  function extensionOf(name) {
    const value = String(name || "");
    const index = value.lastIndexOf(".");

    return (
      index >= 0 &&
      index < value.length - 1
        ? value.slice(index + 1).toLowerCase()
        : ""
    );
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;

    if (value < 1024) {
      return `${value} B`;
    }

    if (value < 1024 ** 2) {
      return `${(value / 1024).toFixed(1)} KB`;
    }

    if (value < 1024 ** 3) {
      return `${(value / 1024 ** 2).toFixed(1)} MB`;
    }

    return `${(value / 1024 ** 3).toFixed(2)} GB`;
  }

  function totalSize() {
    let total = 0;

    for (const item of state.items.values()) {
      total += item.size;
    }

    return total;
  }

  function categoryOf(file) {
    const mime =
      String(file.type || "").toLowerCase();

    const ext =
      extensionOf(file.name);

    if (
      mime.startsWith("image/") ||
      TYPES.image.has(ext)
    ) {
      return "image";
    }

    if (
      mime.startsWith("audio/") ||
      TYPES.audio.has(ext)
    ) {
      return "audio";
    }

    if (
      mime.startsWith("video/") ||
      TYPES.video.has(ext)
    ) {
      return "video";
    }

    if (
      mime === "application/pdf" ||
      TYPES.document.has(ext)
    ) {
      return "document";
    }

    if (TYPES.spreadsheet.has(ext)) {
      return "spreadsheet";
    }

    if (TYPES.presentation.has(ext)) {
      return "presentation";
    }

    if (TYPES.archive.has(ext)) {
      return "archive";
    }

    if (TYPES.code.has(ext)) {
      return "code";
    }

    if (TYPES.data.has(ext)) {
      return "data";
    }

    if (mime.startsWith("text/")) {
      return "text";
    }

    return "unknown";
  }

  function iconFor(category) {
    return {
      image: "image",
      audio: "audio-lines",
      video: "video",
      document: "file-text",
      spreadsheet: "table-2",
      presentation: "presentation",
      archive: "archive",
      code: "file-code-2",
      data: "database",
      text: "file-text",
      unknown: "file"
    }[category] || "file";
  }

  function validate(file) {
    if (!(file instanceof File)) {
      return "Invalid file.";
    }

    const name =
      String(file.name || "").trim();

    if (!name) {
      return "File name is missing.";
    }

    if (
      BLOCKED_EXTENSIONS.has(
        extensionOf(name)
      )
    ) {
      return `${name} is not allowed.`;
    }

    if (file.size <= 0) {
      return `${name} is empty.`;
    }

    if (
      file.size >
      CONFIG.maxFileSize
    ) {
      return (
        `${name} exceeds the ` +
        `${formatBytes(CONFIG.maxFileSize)} limit.`
      );
    }

    if (
      state.items.size >=
      CONFIG.maxFiles
    ) {
      return (
        `You can attach up to ` +
        `${CONFIG.maxFiles} files.`
      );
    }

    if (
      totalSize() + file.size >
      CONFIG.maxTotalSize
    ) {
      return (
        `Total attachments cannot exceed ` +
        `${formatBytes(CONFIG.maxTotalSize)}.`
      );
    }

    return null;
  }

  function isDuplicate(file) {
    for (
      const item
      of state.items.values()
    ) {
      if (
        item.name === file.name &&
        item.size === file.size &&
        item.lastModified === file.lastModified
      ) {
        return true;
      }
    }

    return false;
  }

  /* =====================================================
     ITEM
     ===================================================== */

  function createItem(file) {
    const category =
      categoryOf(file);

    let previewUrl = null;

    if (category === "image") {
      try {
        previewUrl =
          URL.createObjectURL(file);
      } catch {}
    }

    return {
      id: createId(),

      file,

      name: file.name,
      size: file.size,
      mime:
        file.type ||
        "application/octet-stream",

      extension:
        extensionOf(file.name),

      category,
      lastModified:
        file.lastModified,

      previewUrl,

      status: "queued",
      progress: 0,
      ready: false,
      error: null,

      uploadId: null,
      bucket: null,
      path: null,

      processId: null,
      documentId: null,

      document: null,
      chunks: [],
      stats: null,
      extraction: null,
      warnings: [],

      uploadXhr: null,
      processController: null,

      revision: 0
    };
  }

  /* =====================================================
     SERIALIZATION

     Never expose File object to chat payload.
     ===================================================== */

  function serialize(item) {
    return {
      id: item.id,

      uploadId: item.uploadId,
      processId: item.processId,
      documentId: item.documentId,

      name: item.name,
      size: item.size,

      mime: item.mime,
      mimeType: item.mime,

      extension: item.extension,
      category: item.category,

      status: item.status,
      ready: item.ready,
      progress: Math.round(item.progress || 0),

      bucket: item.bucket,
      path: item.path,

      document: item.document,

      chunks:
        Array.isArray(item.chunks)
          ? item.chunks
          : [],

      stats: item.stats,
      extraction: item.extraction,

      warnings:
        Array.isArray(item.warnings)
          ? item.warnings
          : [],

      error: item.error
    };
  }

  function getAll() {
    return state.order
      .map(id => state.items.get(id))
      .filter(Boolean)
      .map(serialize);
  }

  function getReady() {
    return state.order
      .map(id => state.items.get(id))
      .filter(
        item =>
          item?.ready === true &&
          item.status === "ready"
      )
      .map(serialize);
  }

  function getFiles() {
    return state.order
      .map(id => state.items.get(id)?.file)
      .filter(Boolean);
  }

  function hasPending() {
    return state.order.some(id =>
      PENDING_STATES.has(
        state.items.get(id)?.status
      )
    );
  }

  function hasErrors() {
    return state.order.some(
      id =>
        state.items.get(id)?.status ===
        "error"
    );
  }

  /* =====================================================
     STATE EVENTS
     ===================================================== */

  function emitState() {
    const attachments =
      getAll();

    emit(
      "neyo:attachments-change",
      {
        attachments,

        // Temporary legacy aliases
        files: attachments,

        count: attachments.length,
        ready: getReady().length,
        pending: hasPending(),
        errors:
          attachments.filter(
            item =>
              item.status === "error"
          ).length,

        totalSize: totalSize()
      }
    );
  }

  function fail(message, item = null) {
    if (item) {
      item.status = "error";
      item.ready = false;
      item.error = message;
    }

    emit(
      "neyo:attachment-error",
      {
        message,

        attachment:
          item
            ? serialize(item)
            : null
      }
    );
  }

  /* =====================================================
     STATUS UI
     ===================================================== */

  function statusText(item) {
    switch (item.status) {
      case "queued":
        return "Queued";

      case "authorizing":
        return "Preparing…";

      case "uploading":
        return `Uploading ${Math.round(item.progress)}%`;

      case "processing":
        return "Reading file…";

      case "queued-processing":
        return "Processing…";

      case "ready":
        return "Ready";

      case "error":
        return (
          item.error ||
          "Couldn't process"
        );

      default:
        return "";
    }
  }

  function renderItem(item) {
    let element =
      attachmentList.querySelector(
        `[data-attachment-id="${CSS.escape(item.id)}"]`
      );

    if (!element) {
      element =
        document.createElement("div");

      element.className =
        "attachment-chip";

      element.dataset.attachmentId =
        item.id;

      attachmentList.appendChild(
        element
      );
    }

    element.dataset.status =
      item.status;

    const preview =
      item.previewUrl
        ? `
          <div class="attachment-chip-preview">
            <img
              src="${escapeHtml(item.previewUrl)}"
              alt=""
              draggable="false"
            >
          </div>
        `
        : `
          <div class="attachment-chip-icon">
            <i
              data-lucide="${iconFor(item.category)}"
              aria-hidden="true"
            ></i>
          </div>
        `;

    const progress =
      item.status === "uploading"
        ? `
          <div
            class="attachment-chip-progress"
            aria-hidden="true"
          >
            <span
              style="width:${Math.max(
                0,
                Math.min(100, item.progress)
              )}%"
            ></span>
          </div>
        `
        : "";

    const retry =
      item.status === "error"
        ? `
          <button
            type="button"
            class="attachment-chip-retry"
            data-action="retry"
            aria-label="Retry ${escapeHtml(item.name)}"
          >
            <i
              data-lucide="refresh-cw"
              aria-hidden="true"
            ></i>
          </button>
        `
        : "";

    element.innerHTML = `
      ${preview}

      <div class="attachment-chip-body">
        <div class="attachment-chip-name">
          ${escapeHtml(item.name)}
        </div>

        <div class="attachment-chip-meta">
          <span>${escapeHtml(formatBytes(item.size))}</span>
          <span aria-hidden="true">·</span>
          <span class="attachment-chip-status">
            ${escapeHtml(statusText(item))}
          </span>
        </div>

        ${progress}
      </div>

      ${retry}

      <button
        type="button"
        class="attachment-chip-remove"
        data-action="remove"
        aria-label="Remove ${escapeHtml(item.name)}"
      >
        <i
          data-lucide="x"
          aria-hidden="true"
        ></i>
      </button>
    `;

    try {
      window.lucide?.createIcons?.();
    } catch {}
  }

  function renderAll() {
    attachmentList.hidden =
      state.items.size === 0;

    attachmentList.classList.toggle(
      "has-attachments",
      state.items.size > 0
    );

    composer?.classList.toggle(
      "has-attachments",
      state.items.size > 0
    );

    for (
      const id
      of state.order
    ) {
      const item =
        state.items.get(id);

      if (item) {
        renderItem(item);
      }
    }

    emitState();
  }

  /* =====================================================
     HTTP
     ===================================================== */

  async function readJson(response) {
    const raw =
      await response.text();

    if (!raw) {
      return {
        data: null,
        raw: ""
      };
    }

    try {
      return {
        data: JSON.parse(raw),
        raw
      };
    } catch {
      return {
        data: null,
        raw
      };
    }
  }

  async function authorize(item) {
    const response =
      await fetch(
        CONFIG.uploadEndpoint,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json",

            "X-Neyo-Attachment-Client":
              VERSION
          },

          body: JSON.stringify({
            name: item.name,
            size: item.size,
            mime: item.mime,
            extension: item.extension,
            category: item.category,
            clientAttachmentId: item.id
          })
        }
      );

    const { data, raw } =
      await readJson(response);

    if (!response.ok) {
      throw new Error(
        data?.error ||
        data?.message ||
        raw ||
        `Upload authorization failed (${response.status}).`
      );
    }

    if (
      !data?.uploadId ||
      !data?.bucket ||
      !data?.path ||
      !data?.signedUrl
    ) {
      throw new Error(
        "Upload API returned an incomplete signed-upload response."
      );
    }

    return data;
  }

  /* =====================================================
     SIGNED UPLOAD

     Browser -> private storage.
     File bytes do NOT pass through /api/upload.
     ===================================================== */

  function upload(item, session) {
    return new Promise(
      (resolve, reject) => {
        const xhr =
          new XMLHttpRequest();

        item.uploadXhr =
          xhr;

        const method =
          String(
            session.method ||
            session.uploadMethod ||
            "PUT"
          ).toUpperCase();

        xhr.open(
          method,
          session.signedUrl,
          true
        );

        xhr.timeout =
          CONFIG.uploadTimeoutMs;

        /*
         * Backend-generated signed endpoint defines the
         * storage destination. Only safe content headers
         * are supplied by the browser.
         */

        xhr.setRequestHeader(
          "Content-Type",
          item.mime
        );

        if (
          session.cacheControl
        ) {
          xhr.setRequestHeader(
            "Cache-Control",
            String(
              session.cacheControl
            )
          );
        }

        xhr.upload.onprogress =
          event => {
            if (
              !event.lengthComputable
            ) {
              return;
            }

            item.progress =
              Math.max(
                0,
                Math.min(
                  100,
                  (
                    event.loaded /
                    event.total
                  ) * 100
                )
              );

            renderItem(item);
            emitState();
          };

        xhr.onload =
          () => {
            item.uploadXhr =
              null;

            if (
              xhr.status >= 200 &&
              xhr.status < 300
            ) {
              resolve(true);
              return;
            }

            let message =
              `Storage upload failed (${xhr.status}).`;

            try {
              const response =
                JSON.parse(
                  xhr.responseText
                );

              message =
                response?.error ||
                response?.message ||
                message;
            } catch {}

            reject(
              new Error(message)
            );
          };

        xhr.onerror =
          () => {
            item.uploadXhr =
              null;

            reject(
              new Error(
                "Network error during file upload."
              )
            );
          };

        xhr.ontimeout =
          () => {
            item.uploadXhr =
              null;

            reject(
              new Error(
                "File upload timed out."
              )
            );
          };

        xhr.onabort =
          () => {
            item.uploadXhr =
              null;

            reject(
              new DOMException(
                "Upload aborted.",
                "AbortError"
              )
            );
          };

        xhr.send(
          item.file
        );
      }
    );
  }

  /* =====================================================
     PROCESSING
     ===================================================== */

  async function processFile(item) {
    const controller =
      new AbortController();

    item.processController =
      controller;

    const timeout =
      window.setTimeout(
        () => controller.abort(),
        CONFIG.processTimeoutMs
      );

    try {
      const response =
        await fetch(
          CONFIG.processEndpoint,
          {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json",

              "X-Neyo-Attachment-Client":
                VERSION
            },

            body: JSON.stringify({
              uploadId: item.uploadId,
              bucket: item.bucket,
              path: item.path,

              name: item.name,
              size: item.size,
              mime: item.mime,

              extension:
                item.extension,

              category:
                item.category
            }),

            signal:
              controller.signal
          }
        );

      const { data, raw } =
        await readJson(response);

      if (
        response.status === 202
      ) {
        return {
          queued: true,
          data: data || {}
        };
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
          data?.message ||
          raw ||
          `File processing failed (${response.status}).`
        );
      }

      return {
        queued: false,
        data: data || {}
      };

    } catch (error) {
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
        timeout
      );

      if (
        item.processController ===
        controller
      ) {
        item.processController =
          null;
      }
    }
  }

  /* =====================================================
     READY
     ===================================================== */

  function markReady(
    item,
    data = {}
  ) {
    item.processId =
      data.processId ||
      item.processId ||
      null;

    item.documentId =
      data.documentId ||
      item.documentId ||
      null;

    item.document =
      data.document ||
      null;

    item.chunks =
      Array.isArray(data.chunks)
        ? data.chunks
        : [];

    item.stats =
      data.stats ||
      null;

    item.extraction =
      data.extraction ||
      null;

    item.warnings =
      Array.isArray(data.warnings)
        ? data.warnings
        : [];

    item.status =
      "ready";

    item.progress =
      100;

    item.ready =
      true;

    item.error =
      null;

    renderItem(item);
    emitState();

    emit(
      "neyo:attachment-ready",
      {
        attachment:
          serialize(item)
      }
    );
  }

  /* =====================================================
     PIPELINE
     ===================================================== */

  async function pipeline(id) {
    const item =
      state.items.get(id);

    if (!item) {
      return false;
    }

    const revision =
      ++item.revision;

    try {
      Object.assign(
        item,
        {
          status:
            "authorizing",

          progress:
            0,

          ready:
            false,

          error:
            null
        }
      );

      renderItem(item);
      emitState();

      /* -----------------------------------------------
         1. Authorize
         ----------------------------------------------- */

      const session =
        await authorize(item);

      if (
        !state.items.has(id) ||
        item.revision !== revision
      ) {
        return false;
      }

      item.uploadId =
        session.uploadId;

      item.bucket =
        session.bucket;

      item.path =
        session.path;

      /* -----------------------------------------------
         2. Upload
         ----------------------------------------------- */

      item.status =
        "uploading";

      renderItem(item);
      emitState();

      await upload(
        item,
        session
      );

      if (
        !state.items.has(id) ||
        item.revision !== revision
      ) {
        return false;
      }

      item.progress =
        100;

      /* -----------------------------------------------
         3. Process
         ----------------------------------------------- */

      item.status =
        "processing";

      renderItem(item);
      emitState();

      const processing =
        await processFile(item);

      if (
        !state.items.has(id) ||
        item.revision !== revision
      ) {
        return false;
      }

      const data =
        processing.data || {};

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

      /* -----------------------------------------------
         Async processor
         ----------------------------------------------- */

      if (
        processing.queued
      ) {
        item.status =
          "queued-processing";

        item.ready =
          false;

        renderItem(item);
        emitState();

        emit(
          "neyo:attachment-processing-queued",
          {
            attachment:
              serialize(item)
          }
        );

        return true;
      }

      markReady(
        item,
        data
      );

      return true;

    } catch (error) {
      if (
        !state.items.has(id) ||
        item.revision !== revision
      ) {
        return false;
      }

      /*
       * Abort caused by user removal is not a visible
       * attachment failure.
       */

      if (
        error?.name ===
        "AbortError" &&
        !state.items.has(id)
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

      renderItem(item);
      emitState();

      fail(
        item.error,
        item
      );

      return false;
    }
  }

  /* =====================================================
     ADD FILES
     ===================================================== */

  async function addFiles(value) {
    const files =
      Array.from(value || [])
        .filter(
          file =>
            file instanceof File
        );

    const added =
      [];

    for (
      const file
      of files
    ) {
      if (
        isDuplicate(file)
      ) {
        continue;
      }

      const error =
        validate(file);

      if (error) {
        fail(error);
        continue;
      }

      const item =
        createItem(file);

      state.items.set(
        item.id,
        item
      );

      state.order.push(
        item.id
      );

      added.push(
        item.id
      );
    }

    renderAll();

    /*
     * Maximum five files means parallel processing is
     * reasonable and gives much better UX than serial
     * uploads.
     */

    await Promise.allSettled(
      added.map(
        id =>
          pipeline(id)
      )
    );

    return added
      .map(
        id =>
          state.items.get(id)
      )
      .filter(Boolean)
      .map(serialize);
  }

  /* =====================================================
     RETRY
     ===================================================== */

  function resetForRetry(item) {
    item.revision += 1;

    try {
      item.uploadXhr?.abort();
    } catch {}

    try {
      item.processController?.abort();
    } catch {}

    Object.assign(
      item,
      {
        uploadXhr:
          null,

        processController:
          null,

        uploadId:
          null,

        bucket:
          null,

        path:
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

        status:
          "queued",

        progress:
          0,

        ready:
          false,

        error:
          null
      }
    );
  }

  function retry(id) {
    const item =
      state.items.get(
        String(id)
      );

    if (!item) {
      return false;
    }

    resetForRetry(item);

    renderItem(item);
    emitState();

    void pipeline(
      item.id
    );

    return true;
  }

  /* =====================================================
     REMOVE
     ===================================================== */

  function remove(id) {
    const key =
      String(id || "");

    const item =
      state.items.get(key);

    if (!item) {
      return false;
    }

    item.revision += 1;

    try {
      item.uploadXhr?.abort();
    } catch {}

    try {
      item.processController?.abort();
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

    state.items.delete(key);

    state.order =
      state.order.filter(
        current =>
          current !== key
      );

    attachmentList
      .querySelector(
        `[data-attachment-id="${CSS.escape(key)}"]`
      )
      ?.remove();

    renderAll();

    emit(
      "neyo:attachment-removed",
      {
        id: key,
        uploadId: item.uploadId,
        path: item.path
      }
    );

    return true;
  }

  /* =====================================================
     CLEAR
     ===================================================== */

  function clear() {
    const ids =
      [...state.order];

    for (
      const id
      of ids
    ) {
      remove(id);
    }

    attachmentList.replaceChildren();
    attachmentList.hidden = true;

    composer?.classList.remove(
      "has-attachments",
      "is-file-dragging"
    );

    state.dragging =
      false;

    emitState();

    emit(
      "neyo:attachments-cleared"
    );

    return true;
  }

  /* =====================================================
     PICKER
     ===================================================== */

  function openPicker() {
    fileInput.value = "";
    fileInput.click();

    return true;
  }

  function closeLegacyPopup() {
    if (
      !attachPopupMenu
    ) {
      return;
    }

    attachPopupMenu.classList.remove(
      "open",
      "active",
      "show",
      "visible"
    );

    attachPopupMenu.setAttribute(
      "aria-hidden",
      "true"
    );
  }

  /*
   * Do NOT bind #attachBtn here.
   *
   * Current production neo.js still owns the existing
   * + popup UX. We only intercept the actual Add Files
   * operation so the legacy uploader never receives files.
   */

  if (
    attachmentBtn
  ) {
    attachmentBtn.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        openPicker();
      },
      true
    );
  }

  if (
    addFilesMenuBtn
  ) {
    addFilesMenuBtn.addEventListener(
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
    event => {
      const files =
        Array.from(
          event.target.files || []
        );

      fileInput.value = "";

      if (files.length) {
        void addFiles(files);
      }
    }
  );

  /* =====================================================
     DRAG / DROP
     ===================================================== */

  function hasDraggedFiles(event) {
    return Array
      .from(
        event.dataTransfer?.types ||
        []
      )
      .includes("Files");
  }

  function insideDropZone(event) {
    if (
      dropZone ===
      document.body
    ) {
      return true;
    }

    const path =
      typeof event.composedPath ===
        "function"
        ? event.composedPath()
        : [];

    return (
      path.includes(dropZone) ||
      dropZone.contains(
        event.target
      )
    );
  }

  document.addEventListener(
    "dragenter",
    event => {
      if (
        !hasDraggedFiles(event) ||
        !insideDropZone(event)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      state.dragging =
        true;

      dropZone.classList.add(
        "is-file-dragging"
      );

      emitState();
    },
    true
  );

  document.addEventListener(
    "dragover",
    event => {
      if (
        !hasDraggedFiles(event) ||
        !insideDropZone(event)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (
        event.dataTransfer
      ) {
        event.dataTransfer.dropEffect =
          "copy";
      }
    },
    true
  );

  document.addEventListener(
    "drop",
    event => {
      if (
        !hasDraggedFiles(event) ||
        !insideDropZone(event)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      state.dragging =
        false;

      dropZone.classList.remove(
        "is-file-dragging"
      );

      const files =
        event.dataTransfer?.files;

      if (
        files?.length
      ) {
        void addFiles(
          files
        );
      }

      emitState();
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

      /*
       * Ignore movement between children inside composer.
       */

      if (
        event.relatedTarget instanceof Node &&
        dropZone.contains(
          event.relatedTarget
        )
      ) {
        return;
      }

      state.dragging =
        false;

      dropZone.classList.remove(
        "is-file-dragging"
      );

      emitState();
    },
    true
  );

  /* =====================================================
     PASTE

     Only clipboard FILES are intercepted.
     Normal text paste remains completely untouched.
     ===================================================== */

  document.addEventListener(
    "paste",
    event => {
      const clipboard =
        event.clipboardData;

      if (!clipboard) {
        return;
      }

      const files = [];

      for (
        const entry
        of clipboard.items || []
      ) {
        if (
          entry.kind !==
          "file"
        ) {
          continue;
        }

        const file =
          entry.getAsFile();

        if (file) {
          files.push(file);
        }
      }

      if (!files.length) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      void addFiles(
        files
      );
    },
    true
  );

  /* =====================================================
     CHIP ACTIONS
     ===================================================== */

  attachmentList.addEventListener(
    "click",
    event => {
      const button =
        event.target instanceof Element
          ? event.target.closest(
              "[data-action]"
            )
          : null;

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

      event.preventDefault();
      event.stopPropagation();

      if (
        button.dataset.action ===
        "remove"
      ) {
        remove(id);
        return;
      }

      if (
        button.dataset.action ===
        "retry"
      ) {
        retry(id);
      }
    }
  );

  /* =====================================================
     ASYNC PROCESSOR COMPLETION

     If /process returns HTTP 202, a future/background
     worker can complete the item through this event.

     This avoids falsely marking an unfinished file READY.
     ===================================================== */

  window.addEventListener(
    "neyo:attachment-processing-complete",
    event => {
      const detail =
        event.detail || {};

      const id =
        String(
          detail.attachmentId ||
          detail.id ||
          ""
        );

      const processId =
        String(
          detail.processId ||
          ""
        );

      let item =
        id
          ? state.items.get(id)
          : null;

      if (
        !item &&
        processId
      ) {
        item =
          [...state.items.values()]
            .find(
              candidate =>
                String(
                  candidate.processId ||
                  ""
                ) ===
                processId
            );
      }

      if (!item) {
        return;
      }

      if (
        detail.error
      ) {
        item.status =
          "error";

        item.ready =
          false;

        item.error =
          String(detail.error);

        renderItem(item);
        emitState();

        fail(
          item.error,
          item
        );

        return;
      }

      markReady(
        item,
        detail
      );
    }
  );

  /* =====================================================
     EXTERNAL REQUESTS
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-open-request",
    openPicker
  );

  window.addEventListener(
    "neyo:attachments-clear-request",
    clear
  );

  /* Legacy aliases during migration */

  window.addEventListener(
    "neyo:attachments-open",
    openPicker
  );

  window.addEventListener(
    "neyo:attachments-clear",
    clear
  );

  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({
      __controller: true,
      version: VERSION,

      open:
        openPicker,

      openPicker,

      add:
        addFiles,

      addFiles,

      remove,

      retry,

      clear,

      getAll,

      getReady,

      getFiles,

      getCount() {
        return state.items.size;
      },

      hasPending,

      hasErrors,

      getState() {
        const attachments =
          getAll();

        return {
          version: VERSION,

          count:
            attachments.length,

          ready:
            getReady().length,

          pending:
            hasPending(),

          errors:
            attachments.filter(
              item =>
                item.status ===
                "error"
            ).length,

          totalSize:
            totalSize(),

          dragging:
            state.dragging,

          maxFiles:
            CONFIG.maxFiles,

          maxFileSize:
            CONFIG.maxFileSize,

          attachments
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoAttachments",
    {
      value: api,
      writable: false,
      configurable: true,
      enumerable: true
    }
  );

  /* =====================================================
     INIT
     ===================================================== */

  fileInput.multiple = true;
  fileInput.accept = "*/*";

  attachmentList.hidden =
    state.items.size === 0;

  emitState();

  emit(
    "neyo:attachments-ready",
    {
      version: VERSION,
      maxFiles:
        CONFIG.maxFiles,
      maxFileSize:
        CONFIG.maxFileSize
    }
  );
})();
