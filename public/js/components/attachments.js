/*
=========================================================
NEO — ATTACHMENTS
Production v7 — Baseline Safe

Baseline:
- Old working neo.js image compression
- Existing attachment-chip UI/classes
- Current authenticated signed-upload backend
- Current NeyoSendState attachment contract

Pipeline:
File select / drop / paste
    ↓
Local validation
    ↓
Image compression when useful
    ↓
POST /api/attachments/upload
    ↓
Backend signed upload URL
    ↓
Direct storage upload
    ↓
POST /api/attachments/process
    ↓
Ready / queued-processing / error

Owns:
- Attachment picker
- Draft attachment state
- Local validation
- Image compression
- Image preview URLs
- Signed upload
- Processing request
- Retry
- Remove
- Drag/drop
- Paste files
- Attachment chip DOM
- Attachment lifecycle events

Does NOT own:
- Chat send
- Composer text
- Conversation state
- /api/chat
- Message attachment rendering
- New Chat
- Legacy #attachBtn popup
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-attachments-production-v7";

  if (
    window.NeyoAttachments
      ?.__controller === true
  ) {
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
        5,

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

      imageCompression: {
        maxDimension:
          2048,

        quality:
          0.82,

        maxBytes:
          900 * 1024
      }
    });

  /* =====================================================
     DOM
     ===================================================== */

  /*
   * Do NOT take over legacy #attachBtn.
   *
   * Old neo.js may still use it to open its attachment menu.
   * We own the actual file-picking action.
   */

  const attachmentBtn =
    document.getElementById(
      "attachmentBtn"
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

    glassInputContainer
      ?.prepend(
        attachmentList
      );
  }

  /* =====================================================
     PRIVATE FILE INPUT
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

    fileInput.accept =
      "*/*";

    fileInput.hidden =
      true;

    fileInput.tabIndex =
      -1;

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

  const BLOCKED_EXTENSIONS =
    new Set([
      "exe",
      "msi",
      "com",
      "scr",
      "bat",
      "cmd",
      "ps1",
      "vbs",
      "vbe",
      "wsf",
      "wsh",
      "hta",
      "cpl",
      "jar"
    ]);

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
     ID
     ===================================================== */

  function createId() {
    try {
      if (
        globalThis.crypto
          ?.randomUUID
      ) {
        return globalThis.crypto
          .randomUUID();
      }
    } catch {}

    return (
      `att_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 10)}`
    );
  }

  /* =====================================================
     GENERIC HELPERS
     ===================================================== */

  function clamp(
    value,
    min,
    max
  ) {
    return Math.min(
      max,
      Math.max(
        min,
        Number(value) || 0
      )
    );
  }

  function formatBytes(
    bytes
  ) {
    const value =
      Number(bytes) || 0;

    if (value < 1024) {
      return `${value} B`;
    }

    if (
      value <
      1024 * 1024
    ) {
      return (
        `${(
          value / 1024
        ).toFixed(1)} KB`
      );
    }

    if (
      value <
      1024 * 1024 * 1024
    ) {
      return (
        `${(
          value /
          (1024 * 1024)
        ).toFixed(1)} MB`
      );
    }

    return (
      `${(
        value /
        (1024 * 1024 * 1024)
      ).toFixed(1)} GB`
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
      value.lastIndexOf(".");

    if (
      index < 0 ||
      index ===
        value.length - 1
    ) {
      return "";
    }

    return value
      .slice(index + 1)
      .toLowerCase();
  }

  function normalizeMime(
    file
  ) {
    return (
      String(
        file?.type ||
        "application/octet-stream"
      ).trim() ||
      "application/octet-stream"
    );
  }

  /* =====================================================
     CATEGORY
     ===================================================== */

  function getCategory(
    extension,
    mime = ""
  ) {
    const ext =
      String(
        extension || ""
      ).toLowerCase();

    const type =
      String(
        mime || ""
      ).toLowerCase();

    if (
      type.startsWith(
        "image/"
      ) ||
      [
        "jpg",
        "jpeg",
        "png",
        "webp",
        "gif",
        "bmp",
        "avif",
        "svg"
      ].includes(ext)
    ) {
      return "image";
    }

    if (
      type.startsWith(
        "audio/"
      ) ||
      [
        "mp3",
        "wav",
        "m4a",
        "aac",
        "ogg",
        "flac"
      ].includes(ext)
    ) {
      return "audio";
    }

    if (
      type.startsWith(
        "video/"
      ) ||
      [
        "mp4",
        "mov",
        "webm",
        "mkv",
        "avi"
      ].includes(ext)
    ) {
      return "video";
    }

    if (
      ext === "pdf" ||
      type.includes("pdf")
    ) {
      return "pdf";
    }

    if (
      [
        "doc",
        "docx",
        "odt",
        "rtf"
      ].includes(ext)
    ) {
      return "document";
    }

    if (
      [
        "xls",
        "xlsx",
        "csv",
        "ods"
      ].includes(ext)
    ) {
      return "spreadsheet";
    }

    if (
      [
        "ppt",
        "pptx",
        "odp"
      ].includes(ext)
    ) {
      return "presentation";
    }

    if (
      [
        "zip",
        "rar",
        "7z",
        "tar",
        "gz"
      ].includes(ext)
    ) {
      return "archive";
    }

    if (
      [
        "js",
        "ts",
        "tsx",
        "jsx",
        "py",
        "java",
        "c",
        "cpp",
        "h",
        "hpp",
        "cs",
        "go",
        "rs",
        "php",
        "rb",
        "html",
        "css",
        "json",
        "xml",
        "yaml",
        "yml",
        "sql",
        "sh"
      ].includes(ext)
    ) {
      return "code";
    }

    return "text";
  }

  /* =====================================================
     ICON
     ===================================================== */

  function getIcon(
    category
  ) {
    switch (category) {
      case "image":
        return "image";

      case "audio":
        return "audio-lines";

      case "video":
        return "video";

      case "pdf":
      case "document":
        return "file-text";

      case "spreadsheet":
        return "table";

      case "presentation":
        return "presentation";

      case "archive":
        return "archive";

      case "code":
        return "code";

      default:
        return "file";
    }
  }

  /* =====================================================
     IMAGE COMPRESSION

     Restored from old working NEO:
     - max dimension 2048
     - quality 0.82
     - target threshold ~900 KB
     - GIF/SVG untouched
     ===================================================== */

  async function compressImageFile(
    file,
    options =
      CONFIG.imageCompression
  ) {
    if (
      !(file instanceof File)
    ) {
      return file;
    }

    if (
      !file.type
        .toLowerCase()
        .startsWith(
          "image/"
        )
    ) {
      return file;
    }

    if (
      file.type ===
        "image/gif" ||
      file.type ===
        "image/svg+xml"
    ) {
      return file;
    }

    const {
      maxDimension,
      quality,
      maxBytes
    } = options;

    /*
     * Preserve old behavior:
     * already-small images are left unchanged.
     */

    if (
      file.size <=
      maxBytes
    ) {
      return file;
    }

    let bitmap = null;

    try {
      if (
        typeof createImageBitmap !==
        "function"
      ) {
        return file;
      }

      bitmap =
        await createImageBitmap(
          file
        );

      const originalWidth =
        bitmap.width;

      const originalHeight =
        bitmap.height;

      const scale =
        Math.min(
          1,
          maxDimension /
            Math.max(
              originalWidth,
              originalHeight
            )
        );

      const width =
        Math.max(
          1,
          Math.round(
            originalWidth *
              scale
          )
        );

      const height =
        Math.max(
          1,
          Math.round(
            originalHeight *
              scale
          )
        );

      const canvas =
        document.createElement(
          "canvas"
        );

      canvas.width =
        width;

      canvas.height =
        height;

      const context =
        canvas.getContext(
          "2d",
          {
            alpha:
              true
          }
        );

      if (!context) {
        return file;
      }

      context.drawImage(
        bitmap,
        0,
        0,
        width,
        height
      );

      const blob =
        await new Promise(
          resolve => {
            canvas.toBlob(
              resolve,
              "image/webp",
              quality
            );
          }
        );

      if (
        !blob ||
        blob.size <= 0 ||
        blob.size >=
          file.size
      ) {
        return file;
      }

      const baseName =
        file.name.replace(
          /\.[^/.]+$/,
          ""
        );

      return new File(
        [blob],
        `${baseName}.webp`,
        {
          type:
            "image/webp",

          lastModified:
            file.lastModified ||
            Date.now()
        }
      );

    } catch (error) {
      console.warn(
        "[NEO Attachments] Image compression failed; using original file.",
        error
      );

      return file;

    } finally {
      try {
        bitmap?.close?.();
      } catch {}
    }
  }

  /* =====================================================
     TOTAL SIZE
     ===================================================== */

  function getTotalSize() {
    let total = 0;

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

  /* =====================================================
     DUPLICATE
     ===================================================== */

  function isDuplicate(
    file
  ) {
    for (
      const item
      of state.items.values()
    ) {
      if (
        item.originalName ===
          file.name &&
        item.originalSize ===
          file.size &&
        item.originalLastModified ===
          file.lastModified
      ) {
        return true;
      }
    }

    return false;
  }

  /* =====================================================
     VALIDATE
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
        true
    };
  }

  /* =====================================================
     CREATE ITEM
     ===================================================== */

  function createItem(
    file,
    originalFile = file
  ) {
    const extension =
      getExtension(
        file.name
      );

    const mime =
      normalizeMime(
        file
      );

    return {
      id:
        createId(),

      file,

      name:
        file.name,

      size:
        file.size,

      mime,

      extension,

      category:
        getCategory(
          extension,
          mime
        ),

      originalName:
        originalFile.name,

      originalSize:
        originalFile.size,

      originalLastModified:
        originalFile.lastModified,

      lastModified:
        file.lastModified,

      compressed:
        file !==
        originalFile,

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

      uploadController:
        null,

      processController:
        null
    };
  }

  /* =====================================================
     PREVIEW
     ===================================================== */

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
      return URL.createObjectURL(
        item.file
      );
    } catch {
      return null;
    }
  }

  function revokePreview(
    item
  ) {
    if (
      !item?.previewUrl
    ) {
      return;
    }

    try {
      URL.revokeObjectURL(
        item.previewUrl
      );
    } catch {}

    item.previewUrl =
      null;
  }

  /* =====================================================
     SERIALIZE

     Deliberately excludes:
     - raw File
     - signed upload URL
     - token
     - AbortControllers

     previewUrl is included for local UI hydration only.
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

      type:
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

      previewUrl:
        item.previewUrl,

      compressed:
        Boolean(
          item.compressed
        ),

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

  /* =====================================================
     PUBLIC STATE
     ===================================================== */

  function getAll() {
    return state.order
      .map(
        id =>
          state.items.get(id)
      )
      .filter(Boolean)
      .map(
        serializeItem
      );
  }

  function getReady() {
    return state.order
      .map(
        id =>
          state.items.get(id)
      )
      .filter(
        item =>
          item &&
          item.ready ===
            true &&
          item.status ===
            "ready"
      )
      .map(
        serializeItem
      );
  }

  function getFiles() {
    return getAll();
  }

  function getCount() {
    return state.items.size;
  }

  function hasPending() {
    return getAll().some(
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
  }

  function hasErrors() {
    return getAll().some(
      item =>
        item.status ===
        "error"
    );
  }

  /* =====================================================
     STATE EMIT
     ===================================================== */

  function emitState() {
    const attachments =
      getAll();

    emit(
      "neyo:attachments-change",
      {
        count:
          attachments.length,

        ready:
          attachments.filter(
            item =>
              item.ready ===
              true
          ).length,

        errors:
          attachments.filter(
            item =>
              item.status ===
              "error"
          ).length,

        pending:
          hasPending(),

        totalSize:
          getTotalSize(),

        attachments
      }
    );
  }

  /* =====================================================
     NOTIFICATION / ERROR
     ===================================================== */

  function emitError(
    message,
    item = null
  ) {
    const text =
      String(
        message ||
        "Couldn't attach this file."
      );

    emit(
      "neyo:attachment-error",
      {
        message:
          text,

        attachment:
          item
            ? serializeItem(item)
            : null
      }
    );

    emit(
      "neyo:notification-request",
      {
        type:
          "error",

        message:
          text
      }
    );
  }

  /* =====================================================
     COMPOSER CLASS
     ===================================================== */

  function syncComposerClass() {
    const hasFiles =
      state.items.size > 0;

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
     STATUS
     ===================================================== */

  function getStatusLabel(
    item
  ) {
    switch (
      item.status
    ) {
      case "queued":
        return "Preparing";

      case "authorizing":
        return "Preparing";

      case "uploading":
        return "Uploading";

      case "uploaded":
        return "Uploaded";

      case "processing":
        return "Processing";

      case "queued-processing":
        return "Processing";

      case "ready":
        return "Ready";

      case "error":
        return (
          item.error ||
          "Upload failed"
        );

      default:
        return "";
    }
  }

  /* =====================================================
     CHIP DOM HELPERS
     ===================================================== */

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  function createIcon(
    name,
    size = 16
  ) {
    const icon =
      document.createElement(
        "i"
      );

    icon.setAttribute(
      "data-lucide",
      name
    );

    icon.setAttribute(
      "size",
      String(size)
    );

    icon.setAttribute(
      "aria-hidden",
      "true"
    );

    return icon;
  }

  /* =====================================================
     RENDER CHIP
     ===================================================== */

  function renderItem(
    item
  ) {
    if (!attachmentList) {
      return;
    }

    let chip =
      Array.from(
        attachmentList
          .querySelectorAll(
            "[data-attachment-id]"
          )
      ).find(
        element =>
          element.dataset
            .attachmentId ===
          item.id
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

    chip.replaceChildren();

    /* -----------------------------------------------
       PREVIEW / ICON
       ----------------------------------------------- */

    if (
      item.previewUrl
    ) {
      const preview =
        document.createElement(
          "div"
        );

      preview.className =
        "attachment-chip-preview";

      const image =
        document.createElement(
          "img"
        );

      image.src =
        item.previewUrl;

      image.alt = "";

      image.loading =
        "lazy";

      preview.appendChild(
        image
      );

      chip.appendChild(
        preview
      );

    } else {
      const iconWrap =
        document.createElement(
          "div"
        );

      iconWrap.className =
        "attachment-chip-icon";

      iconWrap.appendChild(
        createIcon(
          getIcon(
            item.category
          ),
          16
        )
      );

      chip.appendChild(
        iconWrap
      );
    }

    /* -----------------------------------------------
       BODY
       ----------------------------------------------- */

    const body =
      document.createElement(
        "div"
      );

    body.className =
      "attachment-chip-body";

    const name =
      document.createElement(
        "div"
      );

    name.className =
      "attachment-chip-name";

    name.textContent =
      item.name;

    name.title =
      item.name;

    const meta =
      document.createElement(
        "div"
      );

    meta.className =
      "attachment-chip-meta";

    const size =
      document.createElement(
        "span"
      );

    size.textContent =
      formatBytes(
        item.size
      );

    const divider =
      document.createElement(
        "span"
      );

    divider.textContent =
      "·";

    divider.setAttribute(
      "aria-hidden",
      "true"
    );

    const status =
      document.createElement(
        "span"
      );

    status.className =
      "attachment-chip-status";

    status.textContent =
      getStatusLabel(
        item
      );

    status.title =
      getStatusLabel(
        item
      );

    meta.append(
      size,
      divider,
      status
    );

    body.append(
      name,
      meta
    );

    /* -----------------------------------------------
       PROGRESS
       ----------------------------------------------- */

    if (
      item.status ===
        "uploading"
    ) {
      const progress =
        document.createElement(
          "div"
        );

      progress.className =
        "attachment-chip-progress";

      const bar =
        document.createElement(
          "span"
        );

      bar.style.width =
        `${clamp(
          item.progress,
          0,
          100
        )}%`;

      progress.appendChild(
        bar
      );

      body.appendChild(
        progress
      );
    }

    chip.appendChild(
      body
    );

    /* -----------------------------------------------
       ACTION
       ----------------------------------------------- */

    const action =
      document.createElement(
        "button"
      );

    action.type =
      "button";

    if (
      item.status ===
      "error"
    ) {
      action.className =
        "attachment-chip-retry";

      action.dataset.action =
        "retry";

      action.title =
        "Retry";

      action.setAttribute(
        "aria-label",
        "Retry attachment"
      );

      action.appendChild(
        createIcon(
          "rotate-ccw",
          14
        )
      );

    } else {
      action.className =
        "attachment-chip-remove";

      action.dataset.action =
        "remove";

      action.title =
        "Remove";

      action.setAttribute(
        "aria-label",
        "Remove attachment"
      );

      action.appendChild(
        createIcon(
          "x",
          14
        )
      );
    }

    chip.appendChild(
      action
    );

    attachmentList.hidden =
      false;

    syncComposerClass();

    refreshIcons();
  }

  /* =====================================================
     RENDER ALL
     ===================================================== */

  function renderAll() {
    if (!attachmentList) {
      return;
    }

    for (
      const id
      of state.order
    ) {
      const item =
        state.items.get(id);

      if (item) {
        renderItem(
          item
        );
      }
    }

    const validIds =
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
        !validIds.has(
          chip.dataset
            .attachmentId
        )
      ) {
        chip.remove();
      }
    }

    attachmentList.hidden =
      state.items.size === 0;

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
    } catch (error) {
      console.error(
        "[NEO Attachments] Could not open file picker:",
        error
      );

      return false;
    }
  }

  function closeAttachmentPopup() {
    if (!attachPopupMenu) {
      return;
    }

    attachPopupMenu.classList
      .remove(
        "active",
        "open",
        "show"
      );

    attachPopupMenu.setAttribute(
      "aria-hidden",
      "true"
    );

    document
      .getElementById(
        "attachBtn"
      )
      ?.setAttribute(
        "aria-expanded",
        "false"
      );
  }

  /* =====================================================
     READ RESPONSE
     ===================================================== */

  async function readResponse(
    response
  ) {
    const raw =
      await response.text();

    if (!raw) {
      return {
        raw: "",
        data: null
      };
    }

    try {
      return {
        raw,

        data:
          JSON.parse(raw)
      };

    } catch {
      return {
        raw,
        data: null
      };
    }
  }

  /* =====================================================
     CREATE UPLOAD SESSION
     ===================================================== */

  async function createUploadSession(
    item
  ) {
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

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json",

            "X-Neyo-Attachment-Client":
              VERSION
          },

          body:
            JSON.stringify({
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
            })
        }
      );

    const {
      data,
      raw
    } =
      await readResponse(
        response
      );

    if (!response.ok) {
      throw new Error(
        data?.error ||
        data?.message ||
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

    if (!data.signedUrl) {
      throw new Error(
        "Signed upload URL is missing."
      );
    }

    return data;
  }

  /* =====================================================
     SIGNED UPLOAD

     Preserve current backend/storage contract:
     signedUrl + FormData + cacheControl.
     ===================================================== */

  async function uploadToSignedUrl(
    item,
    session
  ) {
    if (
      !session?.signedUrl
    ) {
      throw new Error(
        "Signed upload URL is unavailable."
      );
    }

    if (
      !(item.file instanceof
        File)
    ) {
      throw new Error(
        "Attachment file is unavailable."
      );
    }

    const controller =
      new AbortController();

    item.uploadController =
      controller;

    const timer =
      window.setTimeout(
        () => {
          try {
            controller.abort(
              "timeout"
            );
          } catch {
            controller.abort();
          }
        },
        CONFIG.uploadTimeoutMs
      );

    try {
      item.progress =
        15;

      renderItem(
        item
      );

      emitState();

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

      const response =
        await fetch(
          session.signedUrl,
          {
            method:
              "PUT",

            headers: {
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

      if (!response.ok) {
        throw new Error(
          data?.message ||
          data?.error ||
          data?.error_description ||
          raw ||
          `File upload failed (${response.status}).`
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

    } catch (error) {
      if (
        controller.signal
          .aborted ||
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
        timer
      );

      item.uploadController =
        null;
    }
  }

  /* =====================================================
     REQUEST PROCESSING
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
          try {
            controller.abort(
              "timeout"
            );
          } catch {
            controller.abort();
          }
        },
        CONFIG.processTimeoutMs
      );

    try {
      const response =
        await fetch(
          CONFIG.processEndpoint,
          {
            method:
              "POST",

            credentials:
              "include",

            cache:
              "no-store",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json",

              "X-Neyo-Attachment-Client":
                VERSION
            },

            body:
              JSON.stringify({
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
              }),

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
          data?.message ||
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

    } catch (error) {
      if (
        controller.signal
          .aborted ||
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
     APPLY PROCESS DATA
     ===================================================== */

  function applyProcessData(
    item,
    data = {}
  ) {
    if (
      data.processId
    ) {
      item.processId =
        data.processId;
    }

    if (
      data.documentId
    ) {
      item.documentId =
        data.documentId;
    }

    if (
      data.stats !==
      undefined
    ) {
      item.stats =
        data.stats;
    }

    if (
      data.document !==
      undefined
    ) {
      item.document =
        data.document;
    }

    if (
      data.extraction !==
      undefined
    ) {
      item.extraction =
        data.extraction;
    }

    if (
      Array.isArray(
        data.chunks
      )
    ) {
      item.chunks =
        data.chunks;
    }

    if (
      Array.isArray(
        data.warnings
      )
    ) {
      item.warnings =
        data.warnings;
    }
  }

  /* =====================================================
     MARK READY
     ===================================================== */

  function markReady(
    item,
    data = {}
  ) {
    applyProcessData(
      item,
      data
    );

    item.status =
      "ready";

    item.ready =
      true;

    item.error =
      null;

    item.progress =
      100;

    renderItem(
      item
    );

    emitState();

    const serialized =
      serializeItem(
        item
      );

    emit(
      "neyo:attachment-ready",
      {
        attachment:
          serialized
      }
    );

    return serialized;
  }

  /* =====================================================
     PIPELINE
     ===================================================== */

  async function processPipeline(
    id
  ) {
    const item =
      state.items.get(id);

    if (!item) {
      return false;
    }

    try {
      item.status =
        "authorizing";

      item.ready =
        false;

      item.error =
        null;

      item.progress =
        0;

      renderItem(
        item
      );

      emitState();

      /* -----------------------------------------------
         AUTHORIZE
         ----------------------------------------------- */

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

      /* -----------------------------------------------
         UPLOAD
         ----------------------------------------------- */

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

      /* -----------------------------------------------
         PROCESS
         ----------------------------------------------- */

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

      applyProcessData(
        item,
        data
      );

      /* -----------------------------------------------
         ASYNC PROCESSING
         ----------------------------------------------- */

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

      /* -----------------------------------------------
         READY
         ----------------------------------------------- */

      markReady(
        item,
        data
      );

      return true;

    } catch (error) {
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
        String(
          error?.message ||
          "Couldn't process this file."
        );

      renderItem(
        item
      );

      emitState();

      emitError(
        item.error,
        item
      );

      return false;
    }
  }

  /* =====================================================
     ADD FILES

     Compression happens before item creation/upload.
     Duplicate detection uses original file identity.
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

    const added = [];

    for (
      const originalFile
      of incoming
    ) {
      if (
        !(originalFile instanceof
          File)
      ) {
        continue;
      }

      if (
        isDuplicate(
          originalFile
        )
      ) {
        continue;
      }

      /*
       * Validate original before expensive compression.
       */

      const initialValidation =
        validateFile(
          originalFile
        );

      if (
        !initialValidation.valid
      ) {
        emitError(
          initialValidation.message
        );

        continue;
      }

      let uploadFile =
        originalFile;

      const originalMime =
        normalizeMime(
          originalFile
        );

      if (
        originalMime.startsWith(
          "image/"
        ) &&
        originalMime !==
          "image/gif" &&
        originalMime !==
          "image/svg+xml" &&
        originalFile.size >
          CONFIG
            .imageCompression
            .maxBytes
      ) {
        /*
         * Compression state cannot yet use a chip because
         * final filename/size may change. Emit a lightweight
         * lifecycle signal instead.
         */

        emit(
          "neyo:attachment-compression-start",
          {
            name:
              originalFile.name,

            size:
              originalFile.size
          }
        );

        uploadFile =
          await compressImageFile(
            originalFile
          );

        emit(
          "neyo:attachment-compression-end",
          {
            originalName:
              originalFile.name,

            originalSize:
              originalFile.size,

            name:
              uploadFile.name,

            size:
              uploadFile.size,

            compressed:
              uploadFile !==
              originalFile
          }
        );
      }

      /*
       * Compression may change size/name/mime.
       */

      const finalValidation =
        validateFile(
          uploadFile
        );

      if (
        !finalValidation.valid
      ) {
        emitError(
          finalValidation.message
        );

        continue;
      }

      const item =
        createItem(
          uploadFile,
          originalFile
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

      emitState();

      /*
       * Upload runs independently.
       */

      void processPipeline(
        item.id
      );
    }

    return added;
  }

  /* =====================================================
     RETRY
     ===================================================== */

  function resetForRetry(
    item
  ) {
    try {
      item.uploadController
        ?.abort?.();
    } catch {}

    try {
      item.processController
        ?.abort?.();
    } catch {}

    item.uploadController =
      null;

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

    item.ready =
      false;

    item.progress =
      0;

    item.error =
      null;
  }

  function retryAttachment(
    id
  ) {
    const item =
      state.items.get(
        String(id || "")
      );

    if (!item) {
      return false;
    }

    if (
      item.status !==
      "error"
    ) {
      return false;
    }

    resetForRetry(
      item
    );

    renderItem(
      item
    );

    emitState();

    void processPipeline(
      item.id
    );

    emit(
      "neyo:attachment-retry",
      {
        attachment:
          serializeItem(
            item
          )
      }
    );

    return true;
  }

  /* =====================================================
     REMOVE
     ===================================================== */

  function removeAttachment(
    idOrObject
  ) {
    let id = "";

    if (
      typeof idOrObject ===
      "string"
    ) {
      id =
        idOrObject;

    } else if (
      idOrObject &&
      typeof idOrObject ===
        "object"
    ) {
      id =
        String(
          idOrObject.id ||
          ""
        );

      /*
       * Compatibility:
       * send-state may know uploadId/path but not local id.
       */

      if (!id) {
        const candidate =
          Array.from(
            state.items.values()
          ).find(
            item =>
              (
                idOrObject.uploadId &&
                item.uploadId ===
                  idOrObject.uploadId
              ) ||
              (
                idOrObject.path &&
                item.path ===
                  idOrObject.path
              )
          );

        id =
          candidate?.id ||
          "";
      }
    }

    if (!id) {
      return false;
    }

    const item =
      state.items.get(id);

    if (!item) {
      return false;
    }

    try {
      item.uploadController
        ?.abort?.(
          "removed"
        );
    } catch {
      try {
        item.uploadController
          ?.abort?.();
      } catch {}
    }

    try {
      item.processController
        ?.abort?.(
          "removed"
        );
    } catch {
      try {
        item.processController
          ?.abort?.();
      } catch {}
    }

    revokePreview(
      item
    );

    state.items.delete(
      id
    );

    state.order =
      state.order.filter(
        value =>
          value !== id
      );

    Array.from(
      attachmentList
        ?.querySelectorAll(
          "[data-attachment-id]"
        ) ||
      []
    )
      .find(
        element =>
          element.dataset
            .attachmentId ===
          id
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

     Used by New Chat owner.
     ===================================================== */

  function clearAttachments() {
    const ids =
      [
        ...state.order
      ];

    for (
      const id
      of ids
    ) {
      removeAttachment(
        id
      );
    }

    attachmentList
      ?.replaceChildren();

    if (attachmentList) {
      attachmentList.hidden =
        true;
    }

    syncComposerClass();

    emitState();

    emit(
      "neyo:attachments-cleared"
    );

    return true;
  }

  /* =====================================================
     ASYNC PROCESSING COMPLETION

     Backend/realtime/another coordinator can dispatch:
     neyo:attachment-processing-complete

     Matching supports:
     - local id
     - uploadId
     - processId
     - documentId
     ===================================================== */

  function findItemForCompletion(
    detail
  ) {
    const payload =
      detail?.attachment ||
      detail?.data ||
      detail ||
      {};

    const localId =
      String(
        payload.id ||
        payload.attachmentId ||
        detail?.id ||
        ""
      );

    if (
      localId &&
      state.items.has(
        localId
      )
    ) {
      return state.items.get(
        localId
      );
    }

    return (
      Array.from(
        state.items.values()
      ).find(
        item =>
          (
            payload.uploadId &&
            item.uploadId ===
              payload.uploadId
          ) ||
          (
            payload.processId &&
            item.processId ===
              payload.processId
          ) ||
          (
            payload.documentId &&
            item.documentId ===
              payload.documentId
          )
      ) ||
      null
    );
  }

  window.addEventListener(
    "neyo:attachment-processing-complete",
    event => {
      const detail =
        event.detail ||
        {};

      const item =
        findItemForCompletion(
          detail
        );

      if (!item) {
        return;
      }

      const data =
        detail.attachment ||
        detail.data ||
        detail;

      const status =
        String(
          data.status ||
          "ready"
        ).toLowerCase();

      if (
        status === "error" ||
        status === "failed"
      ) {
        item.status =
          "error";

        item.ready =
          false;

        item.error =
          String(
            data.error ||
            data.message ||
            "File processing failed."
          );

        renderItem(
          item
        );

        emitState();

        emitError(
          item.error,
          item
        );

        return;
      }

      markReady(
        item,
        data
      );
    }
  );

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
       * Allows same file to be selected again after remove.
       */

      fileInput.value =
        "";

      if (!files.length) {
        return;
      }

      await addFiles(
        files
      );
    }
  );

  /* =====================================================
     MODULAR BUTTON OWNERSHIP
     ===================================================== */

  function bindOpenButton(
    button
  ) {
    if (!button) {
      return;
    }

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();

        event.stopPropagation();

        event.stopImmediatePropagation();

        closeAttachmentPopup();

        openPicker();
      },
      true
    );
  }

  /*
   * New modular direct button if present.
   */

  bindOpenButton(
    attachmentBtn
  );

  /*
   * Old attachment popup's "Add files" action.
   */

  bindOpenButton(
    addFilesMenuBtn
  );

  /* =====================================================
     EXTERNAL OPEN
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
      !(target instanceof Node)
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
    value
  ) {
    state.dragging =
      Boolean(value);

    composerWrapper
      ?.classList
      .toggle(
        "is-dragging",
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

      if (files.length) {
        await addFiles(
          files
        );
      }
    },
    true
  );

  /* =====================================================
     PASTE FILES

     Text-only paste remains untouched.
     ===================================================== */

  document.addEventListener(
    "paste",
    async event => {
      const clipboard =
        event.clipboardData;

      if (!clipboard) {
        return;
      }

      const files = [];

      for (
        const item
        of clipboard.items
      ) {
        if (
          item.kind !==
          "file"
        ) {
          continue;
        }

        const file =
          item.getAsFile();

        if (file) {
          files.push(
            file
          );
        }
      }

      if (!files.length) {
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
     CHIP ACTIONS
     ===================================================== */

  attachmentList
    ?.addEventListener(
      "click",
      event => {
        const target =
          event.target;

        if (
          !(target instanceof
            Element)
        ) {
          return;
        }

        const button =
          target.closest(
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

        event.preventDefault();

        event.stopPropagation();

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

  const api =
    Object.freeze({
      __controller:
        true,

      version:
        VERSION,

      active:
        true,

      open:
        openPicker,

      openPicker,

      add:
        addFiles,

      addFiles,

      remove:
        removeAttachment,

      retry:
        retryAttachment,

      clear:
        clearAttachments,

      getAll,

      getReady,

      getFiles,

      getCount,

      hasPending,

      hasErrors,

      compressImageFile,

      /*
       * Compatibility only.
       *
       * Browser Supabase client is intentionally not needed.
       */

      setSupabaseClient() {
        return true;
      },

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          count:
            getCount(),

          totalSize:
            getTotalSize(),

          dragging:
            state.dragging,

          ready:
            getReady().length,

          pending:
            hasPending(),

          errors:
            hasErrors(),

          attachments:
            getAll()
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
     INIT
     ===================================================== */

  attachmentList.hidden =
    state.items.size === 0;

  syncComposerClass();

  emitState();

  emit(
    "neyo:attachments-ready",
    {
      version:
        VERSION,

      active:
        true,

      maxFiles:
        CONFIG.maxFiles,

      imageCompression:
        true,

      directSignedUpload:
        true,

      browserSupabaseClientRequired:
        false
    }
  );
})();
