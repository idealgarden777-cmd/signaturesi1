/*
=========================================================
NEYO — ATTACHMENTS
FINAL PRODUCTION MIXER v7

FILE:
public/js/components/attachments.js

OWNS
---------------------------------------------------------
- Attachment menu + native picker routing
- File selection / drag-drop / paste
- Validation / duplicate protection / limits
- Local image previews
- Optional safe image optimization
- Signed upload authorization
- Direct browser -> storage upload
- Attachment processing
- Ready / pending / error state
- Retry / remove / clear
- Composer attachment rail rendering
- Public attachment API + events

DOES NOT OWN
---------------------------------------------------------
- Chat sending
- Conversation state
- Message DOM
- Markdown
- History
- Composer text / Enter behavior

MIGRATION RULE
---------------------------------------------------------
This controller is authoritative even while legacy neo.js
is still physically loaded. Capture-phase routing prevents
legacy attachment handlers from also running.

After neo.js is removed, this file continues to work with
no behavior change.
=========================================================
*/

(() => {
  "use strict";

  const VERSION = "neyo-attachments-final-v7";

  if (window.NeyoAttachments?.__controller === true) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG = Object.freeze({
    uploadEndpoint: "/api/attachments/upload",
    processEndpoint: "/api/attachments/process",
    legacyUploadEndpoint: "/api/upload",

    maxFiles: 5,
    maxFileSize: 100 * 1024 * 1024,
    maxTotalSize: 300 * 1024 * 1024,

    uploadTimeoutMs: 120_000,
    processTimeoutMs: 180_000,
    processingPollMs: 1_500,

    cacheControl: "3600",

    previewRevokeDelayMs: 60_000,

    imageOptimizeThreshold: 900 * 1024,
    imageMaxDimension: 2048,
    imageQuality: 0.82
  });

  const PENDING_STATUSES = new Set([
    "queued",
    "optimizing",
    "authorizing",
    "uploading",
    "uploaded",
    "processing",
    "queued-processing"
  ]);

  const BLOCKED_EXTENSIONS = new Set([
    "exe",
    "dll",
    "com",
    "scr",
    "msi",
    "apk",
    "app",
    "dmg",
    "pkg",
    "deb",
    "rpm",
    "iso"
  ]);

  const GROUPS = Object.freeze({
    document: new Set([
      "pdf",
      "doc",
      "docx",
      "odt",
      "rtf",
      "txt",
      "md",
      "markdown",
      "tex",
      "epub"
    ]),

    spreadsheet: new Set([
      "csv",
      "tsv",
      "xls",
      "xlsx",
      "xlsm",
      "xlsb",
      "ods",
      "numbers"
    ]),

    presentation: new Set([
      "ppt",
      "pptx",
      "odp",
      "key"
    ]),

    image: new Set([
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

    audio: new Set([
      "mp3",
      "wav",
      "m4a",
      "aac",
      "ogg",
      "oga",
      "opus",
      "flac",
      "aiff",
      "wma"
    ]),

    video: new Set([
      "mp4",
      "mov",
      "m4v",
      "webm",
      "avi",
      "mkv",
      "mpeg",
      "mpg"
    ]),

    archive: new Set([
      "zip",
      "rar",
      "7z",
      "tar",
      "gz",
      "tgz",
      "bz2",
      "xz"
    ]),

    data: new Set([
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

    code: new Set([
      "js",
      "mjs",
      "cjs",
      "jsx",
      "ts",
      "tsx",
      "py",
      "java",
      "kt",
      "kts",
      "c",
      "h",
      "cc",
      "cpp",
      "cxx",
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
      "fish",
      "ps1",
      "bat",
      "cmd",
      "vbs",
      "html",
      "htm",
      "css",
      "scss",
      "sass",
      "less",
      "vue",
      "svelte",
      "graphql",
      "gql",
      "proto"
    ])
  });

  /* =====================================================
     DOM
     ===================================================== */

  const attachBtn = document.getElementById("attachBtn");
  const attachPopupMenu = document.getElementById("attachPopupMenu");
  const addFilesMenuBtn = document.getElementById("addFilesMenuBtn");
  const legacyFileInput = document.getElementById("hiddenFileInput");

  const composer =
    document.getElementById("composerWrapper") ||
    document.getElementById("glassInputContainer") ||
    document.querySelector(".composer-wrapper") ||
    document.body;

  const glass =
    document.getElementById("glassInputContainer") ||
    composer;

  const dragOverlay =
    document.getElementById("dragDropOverlay");

  let attachmentList =
    document.getElementById("attachedChipsWrapper") ||
    document.getElementById("attachmentList");

  if (!attachmentList) {
    attachmentList = document.createElement("div");
    attachmentList.id = "attachedChipsWrapper";
    attachmentList.className = "attached-chips-wrapper";
    attachmentList.setAttribute("aria-live", "polite");
    glass?.prepend?.(attachmentList);
  }

  let fileInput =
    document.getElementById("neyoAttachmentInput");

  if (!fileInput) {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.id = "neyoAttachmentInput";
    fileInput.multiple = true;
    fileInput.hidden = true;
    fileInput.tabIndex = -1;
    fileInput.accept = "*/*";
    fileInput.setAttribute("aria-hidden", "true");
    document.body.appendChild(fileInput);
  }

  /* =====================================================
     RUNTIME STATE
     ===================================================== */

  const legacyScriptPresent = Array
    .from(document.scripts || [])
    .some(script =>
      /(?:^|\/)neo\.js(?:\?|$)/.test(script.src || "")
    );

  const state = {
    items: new Map(),
    order: [],
    dragging: false,
    dragDepth: 0,
    menuOpen: false,
    destroyed: false
  };

  let supabaseClient = null;

  /* =====================================================
     BASIC HELPERS
     ===================================================== */

  function emit(name, detail = {}) {
    window.dispatchEvent(
      new CustomEvent(name, { detail })
    );
  }

  function createId() {
    return (
      globalThis.crypto?.randomUUID?.() ||
      `att_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clean(value, max = 500) {
    return String(value ?? "")
      .replace(/\u0000/g, "")
      .trim()
      .slice(0, max);
  }

  function extensionOf(name) {
    return (
      String(name || "")
        .toLowerCase()
        .match(/\.([a-z0-9]+)$/)?.[1] ||
      ""
    );
  }

  function formatBytes(bytes) {
    let value = Math.max(0, Number(bytes) || 0);

    if (value < 1024) {
      return `${value} B`;
    }

    const units = ["KB", "MB", "GB", "TB"];
    let index = 0;
    value /= 1024;

    while (
      value >= 1024 &&
      index < units.length - 1
    ) {
      value /= 1024;
      index += 1;
    }

    return `${
      value >= 10
        ? value.toFixed(0)
        : value.toFixed(1)
    } ${units[index]}`;
  }

  function categoryOf(extension, mime = "") {
    for (const [category, set] of Object.entries(GROUPS)) {
      if (set.has(extension)) {
        return category;
      }
    }

    const type = String(mime || "").toLowerCase();

    if (type.startsWith("image/")) return "image";
    if (type.startsWith("audio/")) return "audio";
    if (type.startsWith("video/")) return "video";
    if (type === "application/pdf") return "document";
    if (type.startsWith("text/")) return "text";

    return "unknown";
  }

  function iconOf(category) {
    return ({
      document: "file-text",
      spreadsheet: "sheet",
      presentation: "presentation",
      image: "image",
      audio: "audio-lines",
      video: "video",
      archive: "archive",
      data: "database",
      code: "file-code-2",
      text: "file-text",
      unknown: "file"
    })[category] || "file";
  }

  function statusLabel(item) {
    switch (item.status) {
      case "queued":
        return "Preparing";
      case "optimizing":
        return "Optimizing";
      case "authorizing":
        return "Preparing upload";
      case "uploading":
        return `Uploading ${Math.round(item.progress || 0)}%`;
      case "uploaded":
        return "Uploaded";
      case "processing":
        return "Reading file";
      case "queued-processing":
        return "Processing";
      case "ready":
        return "Ready";
      case "error":
        return item.error || "Attachment failed";
      default:
        return "Preparing";
    }
  }

  function refreshIcons() {
    try {
      window.lucide?.createIcons?.();
    } catch {}
  }

  function refreshComposerLayout() {
    try {
      window.NeyoComposerScrollbar?.refresh?.();
    } catch {}

    try {
      window.NeyoComposer?.refresh?.();
    } catch {}

    emit("neyo:composer-layout-request", {
      source: "attachments",
      count: state.items.size
    });
  }

  function getTotalSize() {
    return state.order.reduce((total, id) => {
      const item = state.items.get(id);
      return total + (Number(item?.size) || 0);
    }, 0);
  }

  function isDuplicate(file) {
    return state.order.some(id => {
      const item = state.items.get(id);

      return Boolean(
        item &&
        item.name === file.name &&
        item.size === file.size &&
        item.lastModified === file.lastModified
      );
    });
  }

  function isNativeFile(value) {
    return (
      typeof File !== "undefined" &&
      value instanceof File
    );
  }

  function isImageItem(item) {
    return (
      item?.category === "image" ||
      String(item?.mime || "").startsWith("image/")
    );
  }

  /* =====================================================
     VALIDATION
     ===================================================== */

  function validateFile(file) {
    if (!isNativeFile(file)) {
      return "Invalid file.";
    }

    const name = clean(file.name, 255);

    if (!name) {
      return "File name is missing.";
    }

    if (!Number.isFinite(file.size) || file.size <= 0) {
      return `"${name}" is empty.`;
    }

    if (file.size > CONFIG.maxFileSize) {
      return (
        `"${name}" exceeds the ` +
        `${formatBytes(CONFIG.maxFileSize)} limit.`
      );
    }

    const extension = extensionOf(name);

    if (BLOCKED_EXTENSIONS.has(extension)) {
      return `"${name}" is not an allowed attachment type.`;
    }

    if (state.items.size >= CONFIG.maxFiles) {
      return `Maximum ${CONFIG.maxFiles} attachments are allowed.`;
    }

    if (
      getTotalSize() + file.size >
      CONFIG.maxTotalSize
    ) {
      return (
        "Total attachments cannot exceed " +
        `${formatBytes(CONFIG.maxTotalSize)}.`
      );
    }

    if (isDuplicate(file)) {
      return `"${name}" is already attached.`;
    }

    return "";
  }

  /* =====================================================
     PREVIEW LIFECYCLE
     ===================================================== */

  function createPreviewUrl(file, category) {
    if (category !== "image") {
      return "";
    }

    try {
      return URL.createObjectURL(file);
    } catch {
      return "";
    }
  }

  function revokePreviewNow(url) {
    if (
      typeof url !== "string" ||
      !url.startsWith("blob:")
    ) {
      return;
    }

    try {
      URL.revokeObjectURL(url);
    } catch {}
  }

  function schedulePreviewRevoke(url) {
    if (
      typeof url !== "string" ||
      !url.startsWith("blob:")
    ) {
      return;
    }

    window.setTimeout(
      () => revokePreviewNow(url),
      CONFIG.previewRevokeDelayMs
    );
  }

  /* =====================================================
     ITEM
     ===================================================== */

  function createItem(file) {
    const extension = extensionOf(file.name);
    const mime = String(
      file.type || "application/octet-stream"
    ).toLowerCase();

    const category = categoryOf(extension, mime);

    return {
      id: createId(),
      revision: 0,

      file,
      uploadFile: file,

      name: clean(file.name, 255) || "attachment",
      size: Number(file.size) || 0,
      uploadedSize: Number(file.size) || 0,
      mime,
      uploadMime: mime,
      extension,
      category,
      lastModified: Number(file.lastModified) || 0,

      previewUrl: createPreviewUrl(file, category),

      provider: "supabase",
      status: "queued",
      ready: false,
      progress: 0,
      error: null,

      uploadId: null,
      bucket: null,
      path: null,
      token: null,

      processId: null,
      documentId: null,
      document: null,
      chunks: [],
      stats: null,
      extraction: null,
      warnings: [],

      uploadOperation: null,
      processController: null,
      processingPollController: null,

      createdAt: Date.now(),
      readyAt: null
    };
  }

  function serializeItem(item, { includePreview = true } = {}) {
    if (!item) return null;

    return {
      id: item.id,
      uploadId: item.uploadId,
      processId: item.processId,
      documentId: item.documentId,

      provider: item.provider || "supabase",
      bucket: item.bucket,
      path: item.path,

      name: item.name,
      size: item.size,
      uploadedSize: item.uploadedSize,

      mime: item.mime,
      mimeType: item.mime,
      type: item.mime,

      uploadMime: item.uploadMime,
      extension: item.extension,
      ext: item.extension,
      category: item.category,

      status: item.status,
      ready: Boolean(
        item.ready &&
        item.status === "ready" &&
        item.bucket &&
        item.path
      ),

      progress: Math.round(item.progress || 0),

      previewUrl:
        includePreview && item.previewUrl
          ? item.previewUrl
          : "",

      document: item.document,
      chunks: Array.isArray(item.chunks)
        ? item.chunks
        : [],
      stats: item.stats,
      extraction: item.extraction,
      warnings: Array.isArray(item.warnings)
        ? [...item.warnings]
        : [],

      error: item.error,
      createdAt: item.createdAt,
      readyAt: item.readyAt
    };
  }

  function getAll() {
    return state.order
      .map(id => state.items.get(id))
      .filter(Boolean)
      .map(item => serializeItem(item));
  }

  function getReady() {
    return state.order
      .map(id => state.items.get(id))
      .filter(item =>
        Boolean(
          item &&
          item.ready === true &&
          item.status === "ready" &&
          item.bucket &&
          item.path
        )
      )
      .map(item => serializeItem(item));
  }

  function getFiles() {
    return state.order
      .map(id => state.items.get(id))
      .filter(Boolean)
      .map(item => ({
        ...serializeItem(item),
        rawFile: item.file,
        file: item.file
      }));
  }

  function hasPending() {
    return state.order.some(id =>
      PENDING_STATUSES.has(
        state.items.get(id)?.status
      )
    );
  }

  function hasErrors() {
    return state.order.some(id =>
      state.items.get(id)?.status === "error"
    );
  }

  function getById(id) {
    const item = state.items.get(String(id || ""));
    return item ? serializeItem(item) : null;
  }

  /* =====================================================
     UI STATE EVENTS
     ===================================================== */

  function syncComposerClass() {
    const active = state.items.size > 0;

    composer?.classList?.toggle(
      "has-attachments",
      active
    );

    glass?.classList?.toggle(
      "has-attachments",
      active
    );
  }

  function emitState() {
    const attachments = getAll();

    emit("neyo:attachments-change", {
      version: VERSION,
      count: attachments.length,
      ready: getReady().length,
      pending: hasPending(),
      errors: attachments.filter(
        item => item.status === "error"
      ).length,
      totalSize: getTotalSize(),
      dragging: state.dragging,
      attachments,
      files: attachments
    });
  }

  function emitError(message, item = null, code = "ATTACHMENT_ERROR") {
    const value = clean(
      message || "Attachment failed.",
      1500
    );

    console.warn("[NEYO Attachments]", value);

    emit("neyo:attachment-error", {
      code,
      message: value,
      attachment: item
        ? serializeItem(item)
        : null
    });
  }

  function emitLimit(message) {
    emit("neyo:attachments-limit", {
      max: CONFIG.maxFiles,
      maxFiles: CONFIG.maxFiles,
      maxFileSize: CONFIG.maxFileSize,
      maxTotalSize: CONFIG.maxTotalSize,
      message: message ||
        `Maximum ${CONFIG.maxFiles} attachments are allowed.`
    });
  }

  /* =====================================================
     RENDER
     Keep old production CSS contract intact.
     ===================================================== */

  function addProgressBar(card, item) {
    if (!PENDING_STATUSES.has(item.status)) {
      return;
    }

    const progress = document.createElement("div");
    progress.className = "attachment-upload-progress";
    progress.setAttribute("aria-hidden", "true");

    Object.assign(progress.style, {
      position: "absolute",
      left: "0",
      right: "0",
      bottom: "0",
      height: "2px",
      overflow: "hidden",
      pointerEvents: "none"
    });

    const bar = document.createElement("span");

    const value =
      item.status === "uploading"
        ? clamp(item.progress || 0, 4, 100)
        : item.status === "processing" ||
          item.status === "queued-processing"
          ? 100
          : 8;

    Object.assign(bar.style, {
      display: "block",
      width: `${value}%`,
      height: "100%",
      background: "currentColor",
      opacity: "0.28",
      transition: "width 140ms ease"
    });

    progress.appendChild(bar);
    card.appendChild(progress);
  }

  function createRetryButton(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "attachment-retry-btn";
    button.dataset.action = "retry";
    button.dataset.tooltip = "Retry attachment";
    button.setAttribute(
      "aria-label",
      `Retry ${item.name}`
    );
    button.title = "Retry";

    button.innerHTML = `
      <i
        data-lucide="rotate-ccw"
        width="12"
        height="12"
        aria-hidden="true"
      ></i>
    `;

    Object.assign(button.style, {
      position: "absolute",
      right: "6px",
      bottom: "5px",
      width: "22px",
      height: "22px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: "0",
      borderRadius: "999px",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
      zIndex: "3"
    });

    return button;
  }

  function renderItem(item) {
    let card = Array
      .from(
        attachmentList.querySelectorAll(
          "[data-attachment-id]"
        )
      )
      .find(node =>
        node.dataset.attachmentId === item.id
      ) || null;

    if (!card) {
      card = document.createElement("div");
      card.className = "attachment-preview-card";
      card.dataset.attachmentId = item.id;
      attachmentList.appendChild(card);
    }

    card.dataset.status = item.status;
    card.dataset.category = item.category;
    card.classList.toggle(
      "attachment-preview-error",
      item.status === "error"
    );

    if (PENDING_STATUSES.has(item.status)) {
      card.setAttribute("aria-busy", "true");
    } else {
      card.removeAttribute("aria-busy");
    }

    card.title = `${item.name} — ${statusLabel(item)}`;
    card.replaceChildren();

    if (isImageItem(item) && item.previewUrl) {
      const image = document.createElement("img");
      image.src = item.previewUrl;
      image.alt = item.name || "Attached image";
      image.loading = "eager";
      image.decoding = "async";

      image.addEventListener(
        "error",
        () => {
          card.classList.add("attachment-preview-error");
        },
        { once: true }
      );

      card.appendChild(image);
    } else {
      const fileBox = document.createElement("div");
      fileBox.className = "attachment-preview-file";

      const icon = document.createElement("i");
      icon.setAttribute(
        "data-lucide",
        iconOf(item.category)
      );
      icon.setAttribute("aria-hidden", "true");

      const name = document.createElement("span");
      name.textContent = item.name || "Attached file";

      fileBox.append(icon, name);
      card.appendChild(fileBox);
    }

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "attachment-remove-btn";
    removeButton.dataset.action = "remove";
    removeButton.dataset.tooltip = "Remove attachment";
    removeButton.setAttribute(
      "aria-label",
      `Remove ${item.name || "attachment"}`
    );
    removeButton.title = "Remove";
    removeButton.innerHTML = `
      <i
        data-lucide="x"
        width="14"
        height="14"
        aria-hidden="true"
      ></i>
    `;

    card.appendChild(removeButton);

    if (item.status === "error") {
      card.appendChild(
        createRetryButton(item)
      );
    }

    addProgressBar(card, item);
  }

  function renderAll() {
    const known = new Set(state.order);

    for (const id of state.order) {
      const item = state.items.get(id);
      if (item) renderItem(item);
    }

    attachmentList
      .querySelectorAll("[data-attachment-id]")
      .forEach(node => {
        if (!known.has(node.dataset.attachmentId)) {
          node.remove();
        }
      });

    syncComposerClass();
    refreshIcons();
    refreshComposerLayout();
    emitState();

    return true;
  }

  /* =====================================================
     MENU / PICKER
     ===================================================== */

  function openMenu() {
    state.menuOpen = true;
    attachPopupMenu?.classList.add("show");
    attachBtn?.setAttribute("aria-expanded", "true");
    return true;
  }

  function closeMenu() {
    state.menuOpen = false;
    attachPopupMenu?.classList.remove("show");
    attachBtn?.setAttribute("aria-expanded", "false");
    return true;
  }

  function toggleMenu() {
    return state.menuOpen
      ? closeMenu()
      : openMenu();
  }

  function openPicker() {
    closeMenu();

    try {
      fileInput.click();
      return true;
    } catch (error) {
      emitError(
        error?.message ||
        "Could not open file picker."
      );
      return false;
    }
  }

  /* =====================================================
     SAFE IMAGE OPTIMIZATION
     Preserves original name/type and never blocks upload
     when the browser cannot optimize the image.
     ===================================================== */

  async function decodeImage(file) {
    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(file);
      } catch {}
    }

    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Image decode failed."));
      };

      image.src = url;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(resolve => {
      try {
        canvas.toBlob(
          blob => resolve(blob),
          mime,
          quality
        );
      } catch {
        resolve(null);
      }
    });
  }

  async function maybeOptimizeImage(item, revision) {
    const file = item.file;

    if (
      !file ||
      !isImageItem(item) ||
      file.size <= CONFIG.imageOptimizeThreshold
    ) {
      return file;
    }

    const mime = String(file.type || "").toLowerCase();

    if (![
      "image/jpeg",
      "image/jpg",
      "image/webp",
      "image/png"
    ].includes(mime)) {
      return file;
    }

    item.status = "optimizing";
    renderItem(item);
    emitState();

    try {
      const bitmap = await decodeImage(file);

      if (
        !isCurrent(item.id, revision) ||
        !bitmap
      ) {
        try {
          bitmap?.close?.();
        } catch {}

        return file;
      }

      const width = Number(bitmap.width) || 0;
      const height = Number(bitmap.height) || 0;

      if (!width || !height) {
        try {
          bitmap?.close?.();
        } catch {}

        return file;
      }

      const scale = Math.min(
        1,
        CONFIG.imageMaxDimension / Math.max(width, height)
      );

      if (
        scale >= 1 &&
        file.size <= CONFIG.imageOptimizeThreshold * 1.25
      ) {
        try {
          bitmap?.close?.();
        } catch {}

        return file;
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));

      const context = canvas.getContext("2d", {
        alpha: mime === "image/png"
      });

      if (!context) {
        try {
          bitmap?.close?.();
        } catch {}

        return file;
      }

      context.drawImage(
        bitmap,
        0,
        0,
        canvas.width,
        canvas.height
      );

      try {
        bitmap?.close?.();
      } catch {}

      const blob = await canvasToBlob(
        canvas,
        mime,
        mime === "image/png"
          ? undefined
          : CONFIG.imageQuality
      );

      if (
        !blob ||
        blob.size <= 0 ||
        blob.size >= file.size
      ) {
        return file;
      }

      const optimized = new File(
        [blob],
        file.name,
        {
          type: blob.type || file.type,
          lastModified: file.lastModified
        }
      );

      return optimized;
    } catch {
      return file;
    }
  }

  /* =====================================================
     RESPONSE / TIMEOUT HELPERS
     ===================================================== */

  async function readResponse(response) {
    const raw = await response.text();

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

  async function fetchWithTimeout(
    url,
    options,
    timeoutMs,
    controllerSlot = null,
    item = null
  ) {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      timeoutMs
    );

    if (item && controllerSlot) {
      item[controllerSlot] = controller;
    }

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Request timed out.");
      }

      throw error;
    } finally {
      window.clearTimeout(timer);

      if (
        item &&
        controllerSlot &&
        item[controllerSlot] === controller
      ) {
        item[controllerSlot] = null;
      }
    }
  }

  function normalizeUploadSession(data, fallbackMode = false) {
    const source = data?.upload || data || {};

    const uploadId =
      clean(
        data?.uploadId ||
        source.uploadId ||
        source.id ||
        "",
        128
      ) ||
      (fallbackMode ? createId() : "");

    return {
      uploadId,
      bucket: clean(source.bucket || data?.bucket || "", 128),
      path: clean(source.path || data?.path || "", 1000),
      token: clean(source.token || data?.token || "", 4000),
      signedUrl:
        source.signedUrl ||
        source.signed_url ||
        source.signedUploadUrl ||
        data?.signedUrl ||
        data?.signed_url ||
        data?.signedUploadUrl ||
        ""
    };
  }

  /* =====================================================
     STEP 1 — AUTHORIZE UPLOAD
     Modern endpoint first; old production endpoint only
     as a 404/405 compatibility fallback.
     ===================================================== */

  async function authorizeModern(item) {
    const response = await fetchWithTimeout(
      CONFIG.uploadEndpoint,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Neyo-Attachment-Client": VERSION
        },
        body: JSON.stringify({
          name: item.name,
          size: item.uploadedSize,
          mime: item.uploadMime,
          mimeType: item.uploadMime,
          extension: item.extension,
          category: item.category,
          clientAttachmentId: item.id
        })
      },
      CONFIG.uploadTimeoutMs,
      "processController",
      item
    );

    const { data, raw } = await readResponse(response);

    if (!response.ok) {
      const error = new Error(
        data?.error ||
        data?.message ||
        raw ||
        `Upload authorization failed (${response.status}).`
      );

      error.status = response.status;
      throw error;
    }

    const session = normalizeUploadSession(data, false);

    if (
      !session.uploadId ||
      !session.bucket ||
      !session.path ||
      !session.token
    ) {
      throw new Error(
        "Upload API returned incomplete signed upload information."
      );
    }

    return session;
  }

  async function authorizeLegacy(item) {
    const response = await fetchWithTimeout(
      CONFIG.legacyUploadEndpoint,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Neyo-Attachment-Client": VERSION
        },
        body: JSON.stringify({
          filename: item.name,
          mimeType: item.uploadMime,
          size: item.uploadedSize
        })
      },
      CONFIG.uploadTimeoutMs,
      "processController",
      item
    );

    const { data, raw } = await readResponse(response);

    if (!response.ok) {
      throw new Error(
        data?.error ||
        data?.message ||
        raw ||
        `Legacy upload authorization failed (${response.status}).`
      );
    }

    const session = normalizeUploadSession(data, true);

    if (
      !session.bucket ||
      !session.path ||
      !session.token
    ) {
      throw new Error(
        "Legacy upload API returned incomplete upload information."
      );
    }

    return session;
  }

  async function authorizeUpload(item) {
    try {
      return await authorizeModern(item);
    } catch (error) {
      if (![404, 405].includes(Number(error?.status))) {
        throw error;
      }

      return authorizeLegacy(item);
    }
  }

  /* =====================================================
     STEP 2 — DIRECT SIGNED UPLOAD
     ===================================================== */

  function uploadWithSignedUrl(item, session, revision) {
    return new Promise((resolve, reject) => {
      if (!session.signedUrl) {
        reject(new Error("Signed upload URL missing."));
        return;
      }

      const xhr = new XMLHttpRequest();
      item.uploadOperation = xhr;

      const form = new FormData();
      form.append("cacheControl", CONFIG.cacheControl);
      form.append("", item.uploadFile, item.uploadFile.name);

      xhr.open("PUT", session.signedUrl, true);
      xhr.timeout = CONFIG.uploadTimeoutMs;

      try {
        xhr.setRequestHeader("x-upsert", "false");
      } catch {}

      xhr.upload.onprogress = event => {
        if (
          !isCurrent(item.id, revision) ||
          !event.lengthComputable
        ) {
          return;
        }

        item.progress = clamp(
          (event.loaded / event.total) * 100,
          1,
          99
        );

        renderItem(item);
        emitState();
      };

      xhr.onload = () => {
        if (item.uploadOperation === xhr) {
          item.uploadOperation = null;
        }

        if (!isCurrent(item.id, revision)) {
          resolve(false);
          return;
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          item.progress = 100;
          resolve(true);
          return;
        }

        const error = new Error(
          `Storage upload failed (${xhr.status}).`
        );

        error.status = xhr.status;
        reject(error);
      };

      xhr.onerror = () => {
        if (item.uploadOperation === xhr) {
          item.uploadOperation = null;
        }

        reject(
          new Error("Network error during storage upload.")
        );
      };

      xhr.ontimeout = () => {
        if (item.uploadOperation === xhr) {
          item.uploadOperation = null;
        }

        reject(new Error("File upload timed out."));
      };

      xhr.onabort = () => {
        if (item.uploadOperation === xhr) {
          item.uploadOperation = null;
        }

        const error = new Error("File upload cancelled.");
        error.name = "AbortError";
        reject(error);
      };

      xhr.send(form);
    });
  }

  function discoverSupabaseClient() {
    const candidates = [
      supabaseClient,
      window.supabaseClient,
      window.NeyoSupabase,
      window.__supabaseClient
    ];

    return candidates.find(client =>
      client?.storage?.from
    ) || null;
  }

  async function uploadWithSupabaseClient(item, session) {
    const client = discoverSupabaseClient();

    if (!client?.storage?.from) {
      throw new Error(
        "Signed upload failed and no compatible storage client is available."
      );
    }

    const result = await client.storage
      .from(session.bucket)
      .uploadToSignedUrl(
        session.path,
        session.token,
        item.uploadFile,
        {
          contentType:
            item.uploadMime ||
            "application/octet-stream",
          cacheControl: CONFIG.cacheControl
        }
      );

    if (result?.error) {
      throw new Error(
        result.error.message ||
        "File upload failed."
      );
    }

    return true;
  }

  async function uploadToStorage(item, session, revision) {
    try {
      await uploadWithSignedUrl(item, session, revision);
      return true;
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        !discoverSupabaseClient()
      ) {
        throw error;
      }

      return uploadWithSupabaseClient(item, session);
    }
  }

  /* =====================================================
     STEP 3 — PROCESS
     ===================================================== */

  async function requestProcessing(item) {
    const response = await fetchWithTimeout(
      CONFIG.processEndpoint,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Neyo-Attachment-Client": VERSION
        },
        body: JSON.stringify({
          uploadId: item.uploadId,
          bucket: item.bucket,
          path: item.path,
          name: item.name,
          size: item.uploadedSize,
          mime: item.uploadMime,
          mimeType: item.uploadMime,
          extension: item.extension,
          category: item.category,
          clientAttachmentId: item.id
        })
      },
      CONFIG.processTimeoutMs,
      "processController",
      item
    );

    const { data, raw } = await readResponse(response);

    if ([404, 405].includes(response.status)) {
      return {
        unavailable: true,
        queued: false,
        data: {}
      };
    }

    if (response.status === 202) {
      return {
        unavailable: false,
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
      unavailable: false,
      queued: false,
      data: data || {}
    };
  }

  function applyProcessingData(item, data = {}) {
    item.processId =
      clean(
        data.processId ||
        data.process_id ||
        item.processId ||
        "",
        128
      ) || null;

    item.documentId =
      clean(
        data.documentId ||
        data.document_id ||
        item.documentId ||
        "",
        128
      ) || null;

    item.document =
      data.document ??
      item.document ??
      null;

    item.chunks = Array.isArray(data.chunks)
      ? data.chunks
      : item.chunks;

    item.stats =
      data.stats ??
      item.stats ??
      null;

    item.extraction =
      data.extraction ??
      item.extraction ??
      null;

    if (Array.isArray(data.warnings)) {
      item.warnings = [...data.warnings];
    }
  }

  async function pollProcessing(item, statusUrl, revision) {
    const deadline = Date.now() + CONFIG.processTimeoutMs;

    while (
      Date.now() < deadline &&
      isCurrent(item.id, revision)
    ) {
      await new Promise(resolve =>
        window.setTimeout(resolve, CONFIG.processingPollMs)
      );

      if (!isCurrent(item.id, revision)) {
        return null;
      }

      const response = await fetchWithTimeout(
        statusUrl,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "X-Neyo-Attachment-Client": VERSION
          }
        },
        Math.min(30_000, CONFIG.processTimeoutMs),
        "processingPollController",
        item
      );

      const { data, raw } = await readResponse(response);

      if (!response.ok) {
        throw new Error(
          data?.error ||
          data?.message ||
          raw ||
          `Attachment processing status failed (${response.status}).`
        );
      }

      const status = String(
        data?.status ||
        data?.state ||
        ""
      ).toLowerCase();

      if (
        data?.ready === true ||
        ["ready", "complete", "completed", "done"].includes(status)
      ) {
        return data || {};
      }

      if (
        ["error", "failed", "cancelled", "canceled"].includes(status)
      ) {
        throw new Error(
          data?.error ||
          data?.message ||
          "File processing failed."
        );
      }
    }

    throw new Error("File processing timed out.");
  }

  /* =====================================================
     PIPELINE SAFETY
     ===================================================== */

  function isCurrent(id, revision) {
    const current = state.items.get(id);

    return Boolean(
      current &&
      current.revision === revision
    );
  }

  function abortOperations(item) {
    try {
      item.uploadOperation?.abort?.();
    } catch {}

    try {
      item.processController?.abort?.();
    } catch {}

    try {
      item.processingPollController?.abort?.();
    } catch {}

    item.uploadOperation = null;
    item.processController = null;
    item.processingPollController = null;
  }

  function resetItemForRetry(item) {
    abortOperations(item);

    item.revision += 1;

    Object.assign(item, {
      uploadFile: item.file,
      uploadedSize: item.size,
      uploadMime: item.mime,

      status: "queued",
      ready: false,
      progress: 0,
      error: null,

      uploadId: null,
      bucket: null,
      path: null,
      token: null,

      processId: null,
      documentId: null,
      document: null,
      chunks: [],
      stats: null,
      extraction: null,
      warnings: [],

      readyAt: null
    });

    return item.revision;
  }

  async function runPipeline(id) {
    const item = state.items.get(id);

    if (!item) return false;

    const revision = item.revision;

    try {
      item.ready = false;
      item.progress = 0;
      item.error = null;

      const optimized = await maybeOptimizeImage(item, revision);

      if (!isCurrent(id, revision)) {
        return false;
      }

      item.uploadFile = optimized || item.file;
      item.uploadedSize =
        Number(item.uploadFile?.size) ||
        item.size;

      item.uploadMime = String(
        item.uploadFile?.type ||
        item.mime ||
        "application/octet-stream"
      ).toLowerCase();

      item.status = "authorizing";
      renderItem(item);
      emitState();

      const session = await authorizeUpload(item);

      if (!isCurrent(id, revision)) {
        return false;
      }

      item.uploadId = session.uploadId;
      item.bucket = session.bucket;
      item.path = session.path;
      item.token = session.token;
      item.status = "uploading";
      item.progress = 1;

      renderItem(item);
      emitState();

      await uploadToStorage(
        item,
        session,
        revision
      );

      if (!isCurrent(id, revision)) {
        return false;
      }

      item.status = "uploaded";
      item.progress = 100;

      renderItem(item);
      emitState();

      item.status = "processing";

      renderItem(item);
      emitState();

      const processed =
        await requestProcessing(item);

      if (!isCurrent(id, revision)) {
        return false;
      }

      if (processed.unavailable) {
        item.warnings = [
          ...item.warnings,
          "Attachment processing endpoint is unavailable; processing is deferred to chat."
        ];

        item.extraction =
          item.extraction || {
            mode: "deferred-to-chat"
          };
      } else {
        applyProcessingData(
          item,
          processed.data
        );
      }

      if (processed.queued) {
        const statusUrl =
          processed.data?.statusUrl ||
          processed.data?.status_url ||
          processed.data?.pollUrl ||
          processed.data?.poll_url ||
          "";

        item.status =
          "queued-processing";

        item.ready = false;

        renderItem(item);
        emitState();

        emit(
          "neyo:attachment-processing-queued",
          {
            attachment:
              serializeItem(item)
          }
        );

        if (!statusUrl) {
          return true;
        }

        const finalData =
          await pollProcessing(
            item,
            statusUrl,
            revision
          );

        if (
          !isCurrent(id, revision) ||
          !finalData
        ) {
          return false;
        }

        applyProcessingData(
          item,
          finalData
        );
      }

      item.status = "ready";
      item.ready = true;
      item.progress = 100;
      item.error = null;
      item.readyAt = Date.now();
      item.token = null;

      renderItem(item);
      emitState();

      emit(
        "neyo:attachment-ready",
        {
          attachment:
            serializeItem(item)
        }
      );

      return true;
    } catch (error) {
      if (!isCurrent(id, revision)) {
        return false;
      }

      if (error?.name === "AbortError") {
        return false;
      }

      item.status = "error";
      item.ready = false;
      item.progress = 0;

      item.error = clean(
        error?.message ||
        "Couldn't process this file.",
        1500
      );

      item.token = null;

      renderItem(item);
      emitState();
      emitError(item.error, item);

      return false;
    }
  }

  /* =====================================================
     ADD FILES
     ===================================================== */

  async function addFiles(value) {
    const files = Array
      .from(value || [])
      .filter(isNativeFile);

    if (!files.length) {
      return [];
    }

    const addedIds = [];

    for (const file of files) {
      const error = validateFile(file);

      if (error) {
        if (
          state.items.size >= CONFIG.maxFiles ||
          error.startsWith("Maximum")
        ) {
          emitLimit(error);
        }

        emitError(
          error,
          null,
          "ATTACHMENT_VALIDATION"
        );

        continue;
      }

      const item = createItem(file);

      state.items.set(
        item.id,
        item
      );

      state.order.push(
        item.id
      );

      addedIds.push(
        item.id
      );

      renderAll();

      emit(
        "neyo:attachment-added",
        {
          attachment:
            serializeItem(item)
        }
      );
    }

    const operations =
      addedIds.map(id =>
        runPipeline(id)
      );

    await Promise.allSettled(
      operations
    );

    return addedIds
      .map(id =>
        state.items.get(id)
      )
      .filter(Boolean)
      .map(item =>
        serializeItem(item)
      );
  }

  /* =====================================================
     RETRY / REMOVE / CLEAR
     ===================================================== */

  function resolveId(value) {
    if (typeof value === "number") {
      return state.order[value] || "";
    }

    if (typeof value === "string") {
      return value;
    }

    if (
      value &&
      typeof value === "object"
    ) {
      return String(
        value.id ||
        value.clientAttachmentId ||
        ""
      );
    }

    return "";
  }

  function retry(value) {
    const id = resolveId(value);
    const item = state.items.get(id);

    if (!item) return false;

    resetItemForRetry(item);
    renderAll();

    void runPipeline(id);

    emit(
      "neyo:attachment-retry",
      {
        attachment:
          serializeItem(item)
      }
    );

    return true;
  }

  function remove(value, options = {}) {
    const id = resolveId(value);
    const item = state.items.get(id);

    if (!item) return false;

    abortOperations(item);

    item.revision += 1;

    state.items.delete(id);

    state.order =
      state.order.filter(
        key => key !== id
      );

    if (
      options.immediatePreviewRevoke ===
      true
    ) {
      revokePreviewNow(
        item.previewUrl
      );
    } else {
      schedulePreviewRevoke(
        item.previewUrl
      );
    }

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
          item.path,

        attachment:
          serializeItem(item)
      }
    );

    return true;
  }

  function removeMany(
    values,
    options = {}
  ) {
    const list = Array.isArray(values)
      ? values
      : [values];

    let removed = 0;

    for (const value of list) {
      if (
        remove(
          value,
          options
        )
      ) {
        removed += 1;
      }
    }

    return removed;
  }

  function clear(options = {}) {
    const ids = [...state.order];

    for (const id of ids) {
      remove(id, options);
    }

    emit(
      "neyo:attachments-cleared",
      {
        count:
          ids.length
      }
    );

    return true;
  }

  /* =====================================================
     WAIT UNTIL SETTLED
     Useful for future send-state ownership.
     ===================================================== */

  async function waitUntilSettled({
    timeoutMs =
      CONFIG.processTimeoutMs +
      CONFIG.uploadTimeoutMs
  } = {}) {
    const started = Date.now();

    while (hasPending()) {
      if (
        Date.now() - started >=
        timeoutMs
      ) {
        return {
          settled: false,

          ready:
            getReady(),

          errors:
            getAll().filter(
              item =>
                item.status ===
                "error"
            )
        };
      }

      await new Promise(resolve =>
        window.setTimeout(
          resolve,
          100
        )
      );
    }

    return {
      settled: true,

      ready:
        getReady(),

      errors:
        getAll().filter(
          item =>
            item.status ===
            "error"
        )
    };
  }

  /* =====================================================
     FILE INPUT
     ===================================================== */

  fileInput.addEventListener(
    "change",
    () => {
      const files =
        Array.from(
          fileInput.files || []
        );

      /*
       * Allows selecting the same file
       * again after removal.
       */
      fileInput.value = "";

      if (files.length) {
        void addFiles(files);
      }
    }
  );

  /* =====================================================
     CHIP ACTIONS
     ===================================================== */

  attachmentList.addEventListener(
    "click",
    event => {
      const button =
        event.target
          ?.closest
          ?.("[data-action]");

      if (!button) {
        return;
      }

      const card =
        button.closest(
          "[data-attachment-id]"
        );

      const id =
        card?.dataset
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
     AUTHORITATIVE CLICK ROUTING
     Capture phase prevents neo.js attachment listeners.
     ===================================================== */

  document.addEventListener(
    "click",
    event => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const attach =
        target.closest("#attachBtn");

      if (attach) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        toggleMenu();

        return;
      }

      const addFiles =
        target.closest(
          "#addFilesMenuBtn"
        );

      if (addFiles) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        openPicker();

        return;
      }

      if (
        state.menuOpen &&
        !attachPopupMenu
          ?.contains(target)
      ) {
        closeMenu();
      }
    },
    true
  );

  /* =====================================================
     DRAG / DROP
     ===================================================== */

  function dragContainsFiles(event) {
    return Array
      .from(
        event.dataTransfer
          ?.types ||
        []
      )
      .includes("Files");
  }

  function eventInsideComposer(event) {
    return Boolean(
      event.target instanceof Node &&
      composer
        ?.contains
        ?.(event.target)
    );
  }

  function setDragging(value) {
    state.dragging =
      Boolean(value);

    if (!state.dragging) {
      state.dragDepth = 0;
    }

    composer
      ?.classList
      ?.toggle(
        "is-file-dragging",
        state.dragging
      );

    dragOverlay
      ?.classList
      ?.toggle(
        "show",
        state.dragging
      );

    /*
     * Compatibility with newer
     * overlay naming.
     */
    dragOverlay
      ?.classList
      ?.toggle(
        "active",
        state.dragging
      );

    dragOverlay
      ?.setAttribute
      ?.(
        "aria-hidden",
        state.dragging
          ? "false"
          : "true"
      );

    emit(
      "neyo:attachments-drag-state",
      {
        dragging:
          state.dragging
      }
    );
  }

  document.addEventListener(
    "dragenter",
    event => {
      if (
        !dragContainsFiles(event) ||
        !eventInsideComposer(event)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      state.dragDepth += 1;

      setDragging(true);
    },
    true
  );

  document.addEventListener(
    "dragover",
    event => {
      if (
        !dragContainsFiles(event) ||
        !eventInsideComposer(event)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect =
          "copy";
      }

      setDragging(true);
    },
    true
  );

  document.addEventListener(
    "dragleave",
    event => {
      if (!state.dragging) {
        return;
      }

      if (
        dragContainsFiles(event) &&
        eventInsideComposer(event)
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }

      state.dragDepth =
        Math.max(
          0,
          state.dragDepth - 1
        );

      const related =
        event.relatedTarget;

      if (
        state.dragDepth === 0 ||
        !(related instanceof Node) ||
        !composer
          ?.contains
          ?.(related)
      ) {
        setDragging(false);
      }
    },
    true
  );

  document.addEventListener(
    "drop",
    event => {
      if (
        !dragContainsFiles(event) ||
        !eventInsideComposer(event)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const files =
        Array.from(
          event.dataTransfer
            ?.files ||
          []
        );

      setDragging(false);

      if (files.length) {
        void addFiles(files);
      }
    },
    true
  );

  document.addEventListener(
    "dragend",
    () =>
      setDragging(false),
    true
  );

  window.addEventListener(
    "blur",
    () => {
      if (state.dragging) {
        setDragging(false);
      }
    }
  );

  /* =====================================================
     PASTE FILES
     Normal text-only paste is never touched.
     ===================================================== */

  document.addEventListener(
    "paste",
    event => {
      const clipboard =
        event.clipboardData;

      if (!clipboard) {
        return;
      }

      let files = Array
        .from(
          clipboard.items || []
        )
        .filter(
          item =>
            item.kind ===
            "file"
        )
        .map(
          item =>
            item.getAsFile()
        )
        .filter(Boolean);

      if (!files.length) {
        files =
          Array.from(
            clipboard.files ||
            []
          );
      }

      if (!files.length) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      void addFiles(files);
    },
    true
  );

  /* =====================================================
     EXTERNAL / ASYNC PROCESSING COMPLETION
     Allows a future background worker, realtime channel,
     or polling bridge to finish a queued attachment without
     changing this controller again.
     ===================================================== */

  function completeProcessing(
    value,
    data = {}
  ) {
    const id =
      resolveId(value);

    const item =
      state.items.get(id);

    if (!item) {
      return false;
    }

    applyProcessingData(
      item,
      data
    );

    item.status = "ready";

    item.ready =
      Boolean(
        item.bucket &&
        item.path
      );

    item.progress = 100;
    item.error = null;
    item.readyAt = Date.now();
    item.token = null;

    renderItem(item);
    emitState();

    if (item.ready) {
      emit(
        "neyo:attachment-ready",
        {
          attachment:
            serializeItem(item),

          source:
            "external-processing-complete"
        }
      );
    }

    return item.ready;
  }

  function failProcessing(
    value,
    message
  ) {
    const id =
      resolveId(value);

    const item =
      state.items.get(id);

    if (!item) {
      return false;
    }

    item.status = "error";
    item.ready = false;
    item.progress = 0;

    item.error = clean(
      message ||
      "File processing failed.",
      1500
    );

    renderItem(item);
    emitState();

    emitError(
      item.error,
      item,
      "ATTACHMENT_PROCESSING"
    );

    return true;
  }

  window.addEventListener(
    "neyo:attachment-processing-complete",
    event => {
      const detail =
        event.detail || {};

      completeProcessing(
        detail.id ||
        detail.attachmentId ||
        detail.attachment,

        detail.data ||
        detail.result ||
        detail
      );
    }
  );

  window.addEventListener(
    "neyo:attachment-processing-failed",
    event => {
      const detail =
        event.detail || {};

      failProcessing(
        detail.id ||
        detail.attachmentId ||
        detail.attachment,

        detail.message ||
        detail.error
      );
    }
  );

  /* =====================================================
     PUBLIC EVENT CONTRACT
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-open-request",
    openPicker
  );

  window.addEventListener(
    "neyo:attachments-open",
    openMenu
  );

  window.addEventListener(
    "neyo:attachments-close",
    closeMenu
  );

  window.addEventListener(
    "neyo:attachments-clear-request",
    () => clear()
  );

  /*
   * Old production event name.
   */
  window.addEventListener(
    "neyo:attachments-clear",
    () => clear()
  );

  /* =====================================================
     SUPABASE COMPATIBILITY
     Modern flow does not require it. Kept only as a safe
     fallback for older signed-upload behavior.
     ===================================================== */

  function setSupabaseClient(client) {
    if (
      client &&
      typeof client === "object" &&
      client.storage?.from
    ) {
      supabaseClient = client;
      return true;
    }

    if (client == null) {
      supabaseClient = null;
      return true;
    }

    return false;
  }

  function isApiReady() {
    return Boolean(
      typeof fetch === "function" &&
      typeof XMLHttpRequest !==
        "undefined" &&
      CONFIG.uploadEndpoint &&
      CONFIG.processEndpoint
    );
  }

  /* =====================================================
     CLEANUP
     ===================================================== */

  function destroy() {
    if (state.destroyed) {
      return true;
    }

    state.destroyed = true;

    for (const id of [...state.order]) {
      const item =
        state.items.get(id);

      if (!item) {
        continue;
      }

      abortOperations(item);
      revokePreviewNow(
        item.previewUrl
      );
    }

    state.items.clear();
    state.order = [];

    setDragging(false);
    closeMenu();

    attachmentList
      .replaceChildren();

    syncComposerClass();

    return true;
  }

  window.addEventListener(
    "pagehide",
    () => {
      for (
        const id
        of state.order
      ) {
        const item =
          state.items.get(id);

        if (item) {
          revokePreviewNow(
            item.previewUrl
          );
        }
      }

      setDragging(false);
    },
    {
      once: true
    }
  );

  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({
      __controller: true,

      version:
        VERSION,

      active: true,

      legacyCompatible:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      open:
        openPicker,

      openPicker,

      openMenu,

      closeMenu,

      toggleMenu,

      add:
        addFiles,

      addFiles,

      remove,

      removeMany,

      retry,

      clear,

      render:
        renderAll,

      getAll,

      getReady,

      getFiles,

      getById,

      getCount() {
        return state.items.size;
      },

      hasPending,

      hasErrors,

      waitUntilSettled,

      completeProcessing,

      failProcessing,

      setSupabaseClient,

      isApiReady,

      getFileCategory(file) {
        return categoryOf(
          extensionOf(
            file?.name
          ),

          file?.type ||
          file?.mimeType ||
          ""
        );
      },

      destroy,

      maxFiles:
        CONFIG.maxFiles,

      maxFileSize:
        CONFIG.maxFileSize,

      maxTotalSize:
        CONFIG.maxTotalSize,

      getState() {
        const attachments =
          getAll();

        return {
          version:
            VERSION,

          active:
            true,

          legacyScriptPresent,

          legacyOwnerActive:
            false,

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
            getTotalSize(),

          dragging:
            state.dragging,

          menuOpen:
            state.menuOpen,

          apiReady:
            isApiReady(),

          attachments
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoAttachments",
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
     INITIAL STATE
     ===================================================== */

  /*
   * Legacy input remains in DOM for compatibility,
   * but this controller never clicks it and never
   * relies on it.
   */
  if (legacyFileInput) {
    legacyFileInput.setAttribute(
      "data-neyo-legacy-input",
      "true"
    );
  }

  closeMenu();
  setDragging(false);
  renderAll();

  emit(
    "neyo:attachments-ready",
    {
      version:
        VERSION,

      active:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      maxFiles:
        CONFIG.maxFiles,

      maxFileSize:
        CONFIG.maxFileSize,

      maxTotalSize:
        CONFIG.maxTotalSize
    }
  );
})();
