/*
=========================================================
NEYO — ATTACHMENTS CONTROLLER
FINAL v3 — CONFLICT-FREE BASELINE

FILE:
public/js/components/attachments.js

OWNERSHIP
---------------------------------------------------------
neo.js
  ✅ #attachBtn / "+" popup UX
  ✅ Deep Research menu item
  ✅ Personalities menu item

attachments.js
  ✅ #addFilesMenuBtn
  ✅ private file input
  ✅ file validation
  ✅ upload authorization
  ✅ signed Storage upload
  ✅ processing
  ✅ attachment chips
  ✅ progress
  ✅ retry / remove
  ✅ drag + drop
  ✅ file paste
  ✅ ready attachment state

attachments.js DOES NOT OWN:
  ❌ #attachBtn
  ❌ #sendBtn
  ❌ #chatInput
  ❌ chat API
  ❌ voice
  ❌ mascot
  ❌ characters
  ❌ history

PUBLIC:
window.NeyoAttachments
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / DUPLICATE GUARD
     ===================================================== */

  const VERSION =
    "neyo-attachments-final-v3";


  if (
    window.NeyoAttachments?.__controller === true
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

      debug:
        true
    });


  /* =====================================================
     DOM
     ===================================================== */

  /*
   * IMPORTANT:
   * #attachBtn belongs to neo.js.
   * We only keep a reference for diagnostics.
   */

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
    document.querySelector(
      ".composer"
    );


  const glassInputContainer =
    document.getElementById(
      "glassInputContainer"
    );


  const dropZone =
    composerWrapper ||
    glassInputContainer ||
    document.body;


  let attachmentList =
    document.getElementById(
      "attachmentList"
    ) ||
    document.getElementById(
      "attachedChipsWrapper"
    );


  /*
   * Safe fallback only.
   */

  if (!attachmentList) {
    attachmentList =
      document.createElement(
        "div"
      );

    attachmentList.id =
      "attachmentList";

    attachmentList.className =
      "attached-chips-wrapper attachment-list";

    attachmentList.hidden =
      true;

    (
      glassInputContainer ||
      composerWrapper ||
      document.body
    ).prepend(
      attachmentList
    );
  }


  /* =====================================================
     PRIVATE FILE INPUT

     We deliberately do NOT use:
     #attachmentInput
     #hiddenFileInput

     This prevents old listeners from receiving File objects.
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
     FILE GROUPS
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
          "tex",
          "pages"
        ]),

      spreadsheet:
        new Set([
          "csv",
          "tsv",
          "xls",
          "xlsx",
          "xlsm",
          "xlsb",
          "ods",
          "numbers"
        ]),

      presentation:
        new Set([
          "ppt",
          "pptx",
          "odp",
          "key"
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
          "aiff",
          "wma"
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
          "mpg",
          "wmv"
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
          "parquet",
          "feather",
          "arrow"
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
          "pyw",

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
          "scala",

          "sh",
          "bash",
          "zsh",
          "fish",
          "ps1",

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
          "proto",

          "dockerfile",
          "makefile",
          "env",
          "gitignore"
        ])
    });


  /*
   * Executable / installer formats.
   * Files are data, but there is no useful reason
   * for this chat upload pipeline to accept these.
   */

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
      "rpm"
    ]);


  /* =====================================================
     UTILITIES
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


  function createId() {
    if (
      globalThis.crypto
        ?.randomUUID
    ) {
      return globalThis
        .crypto
        .randomUUID();
    }

    return (
      `att_${Date.now()}_` +
      Math.random()
        .toString(36)
        .slice(2)
    );
  }


  function cleanString(
    value
  ) {
    return String(
      value ??
      ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .trim();
  }


  function getExtension(
    name
  ) {
    const value =
      cleanString(
        name
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
      .toLowerCase();
  }


  function formatBytes(
    bytes
  ) {
    const value =
      Number(
        bytes
      ) ||
      0;

    if (
      value <
      1024
    ) {
      return `${value} B`;
    }

    if (
      value <
      1024 * 1024
    ) {
      return (
        `${(
          value /
          1024
        ).toFixed(1)} KB`
      );
    }

    if (
      value <
      1024 *
        1024 *
        1024
    ) {
      return (
        `${(
          value /
          (
            1024 *
            1024
          )
        ).toFixed(1)} MB`
      );
    }

    return (
      `${(
        value /
        (
          1024 *
          1024 *
          1024
        )
      ).toFixed(2)} GB`
    );
  }


  function escapeHtml(
    value
  ) {
    return String(
      value ??
      ""
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


  /* =====================================================
     CATEGORY
     ===================================================== */

  function getCategory(
    file
  ) {
    const mime =
      cleanString(
        file?.type
      )
        .toLowerCase();

    const extension =
      getExtension(
        file?.name
      );


    if (
      mime.startsWith(
        "image/"
      ) ||
      EXTENSIONS
        .image
        .has(
          extension
        )
    ) {
      return "image";
    }


    if (
      mime.startsWith(
        "audio/"
      ) ||
      EXTENSIONS
        .audio
        .has(
          extension
        )
    ) {
      return "audio";
    }


    if (
      mime.startsWith(
        "video/"
      ) ||
      EXTENSIONS
        .video
        .has(
          extension
        )
    ) {
      return "video";
    }


    if (
      mime ===
        "application/pdf" ||
      EXTENSIONS
        .document
        .has(
          extension
        )
    ) {
      return "document";
    }


    if (
      EXTENSIONS
        .spreadsheet
        .has(
          extension
        )
    ) {
      return "spreadsheet";
    }


    if (
      EXTENSIONS
        .presentation
        .has(
          extension
        )
    ) {
      return "presentation";
    }


    if (
      EXTENSIONS
        .archive
        .has(
          extension
        )
    ) {
      return "archive";
    }


    if (
      EXTENSIONS
        .code
        .has(
          extension
        )
    ) {
      return "code";
    }


    if (
      EXTENSIONS
        .data
        .has(
          extension
        )
    ) {
      return "data";
    }


    if (
      mime.startsWith(
        "text/"
      )
    ) {
      return "text";
    }


    return "unknown";
  }


  function getIcon(
    category
  ) {
    const icons = {
      image:
        "image",

      audio:
        "audio-lines",

      video:
        "video",

      document:
        "file-text",

      spreadsheet:
        "table-2",

      presentation:
        "presentation",

      archive:
        "archive",

      code:
        "file-code-2",

      data:
        "database",

      text:
        "file-text",

      unknown:
        "file"
    };

    return (
      icons[
        category
      ] ||
      "file"
    );
  }


  /* =====================================================
     TOTAL SIZE
     ===================================================== */

  function getTotalSize() {
    let total =
      0;

    for (
      const item
      of state.items
        .values()
    ) {
      total +=
        Number(
          item.size
        ) ||
        0;
    }

    return total;
  }


  /* =====================================================
     VALIDATION
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


    const name =
      cleanString(
        file.name
      );


    if (!name) {
      return {
        valid:
          false,

        message:
          "File name is missing."
      };
    }


    const extension =
      getExtension(
        name
      );


    if (
      BLOCKED_EXTENSIONS
        .has(
          extension
        )
    ) {
      return {
        valid:
          false,

        message:
          `${name} is not supported.`
      };
    }


    if (
      file.size <=
      0
    ) {
      return {
        valid:
          false,

        message:
          `${name} is empty.`
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
          `${name} is larger than ${formatBytes(CONFIG.maxFileSize)}.`
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
          `You can attach up to ${CONFIG.maxFiles} files.`
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
          `Total attachments cannot exceed ${formatBytes(CONFIG.maxTotalSize)}.`
      };
    }


    return {
      valid:
        true
    };
  }


  function isDuplicate(
    file
  ) {
    for (
      const item
      of state.items
        .values()
    ) {
      if (
        item.name ===
          file.name &&
        item.size ===
          file.size &&
        item.file
          ?.lastModified ===
          file.lastModified
      ) {
        return true;
      }
    }

    return false;
  }


  /* =====================================================
     INTERNAL ITEM
     ===================================================== */

  function createItem(
    file
  ) {
    return {
      id:
        createId(),

      file,

      name:
        cleanString(
          file.name
        ),

      size:
        Number(
          file.size
        ) ||
        0,

      mime:
        cleanString(
          file.type
        ) ||
        "application/octet-stream",

      extension:
        getExtension(
          file.name
        ),

      category:
        getCategory(
          file
        ),

      status:
        "queued",

      progress:
        0,

      error:
        null,

      ready:
        false,

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

      previewUrl:
        null,

      uploadXhr:
        null,

      processController:
        null,

      createdAt:
        Date.now()
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
     PUBLIC SERIALIZATION
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
        item.ready,

      progress:
        item.progress,

      bucket:
        item.bucket,

      path:
        item.path,

      document:
        item.document,

      chunks:
        item.chunks,

      stats:
        item.stats,

      extraction:
        item.extraction,

      warnings:
        item.warnings,

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
          item.status ===
            "ready" &&
          item.ready ===
            true
      )
      .map(
        serializeItem
      );
  }


  function hasPending() {
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
      );
  }


  function hasErrors() {
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
      .some(
        item =>
          item.status ===
          "error"
      );
  }


  /* =====================================================
     EVENTS
     ===================================================== */

  function emitState() {
    const attachments =
      getAll();

    window.dispatchEvent(
      new CustomEvent(
        "neyo:attachments-change",
        {
          detail: {
            attachments,

            files:
              attachments,

            count:
              attachments.length,

            ready:
              getReady()
                .length,

            pending:
              hasPending(),

            errors:
              attachments
                .filter(
                  item =>
                    item.status ===
                    "error"
                )
                .length
          }
        }
      )
    );
  }


  function emitError(
    message,
    item = null
  ) {
    console.warn(
      "[NEYO Attachments]",
      message
    );

    window.dispatchEvent(
      new CustomEvent(
        "neyo:attachment-error",
        {
          detail: {
            message,

            attachment:
              item
                ? serializeItem(
                    item
                  )
                : null
          }
        }
      )
    );
  }


  /* =====================================================
     CHIP UI
     ===================================================== */

  function getStatusText(
    item
  ) {
    switch (
      item.status
    ) {
      case "queued":
        return "Queued";

      case "authorizing":
        return "Preparing…";

      case "uploading":
        return (
          `Uploading ${Math.round(item.progress)}%`
        );

      case "uploaded":
        return "Uploaded";

      case "processing":
        return "Reading…";

      case "queued-processing":
        return "Processing…";

      case "ready":
        return "Ready";

      case "error":
        return (
          item.error ||
          "Failed"
        );

      default:
        return (
          item.status ||
          ""
        );
    }
  }


  function renderItem(
    item
  ) {
    let element =
      attachmentList
        .querySelector(
          `[data-attachment-id="${item.id}"]`
        );


    if (!element) {
      element =
        document.createElement(
          "div"
        );

      element.className =
        "attachment-chip";

      element.dataset
        .attachmentId =
        item.id;

      attachmentList
        .appendChild(
          element
        );
    }


    element.dataset.status =
      item.status;


    const visual =
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
              data-lucide="${getIcon(item.category)}"
              aria-hidden="true"
            ></i>
          </div>
        `;


    const progress =
      item.status ===
        "uploading"
        ? `
          <div
            class="attachment-chip-progress"
            aria-hidden="true"
          >
            <span
              style="width:${clamp(
                item.progress,
                0,
                100
              )}%"
            ></span>
          </div>
        `
        : "";


    const retry =
      item.status ===
        "error"
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
      ${visual}

      <div class="attachment-chip-body">

        <div class="attachment-chip-name">
          ${escapeHtml(item.name)}
        </div>

        <div class="attachment-chip-meta">

          <span>
            ${escapeHtml(formatBytes(item.size))}
          </span>

          <span aria-hidden="true">
            ·
          </span>

          <span class="attachment-chip-status">
            ${escapeHtml(getStatusText(item))}
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
      window
        .lucide
        ?.createIcons
        ?.();
    } catch {}
  }


  function renderAll() {
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


    attachmentList.hidden =
      state.items.size ===
      0;


    attachmentList
      .classList
      .toggle(
        "has-attachments",
        state.items.size >
          0
      );


    /*
     * Allows composer CSS to react without
     * JS forcing dimensions.
     */

    composerWrapper
      ?.classList
      .toggle(
        "has-attachments",
        state.items.size >
          0
      );


    emitState();
  }


  /* =====================================================
     PICKER
     ===================================================== */

  function openPicker() {
    fileInput.value =
      "";

    fileInput.click();
  }


  function closePopup() {
    if (!attachPopupMenu) {
      return;
    }


    attachPopupMenu
      .classList
      .remove(
        "open",
        "active",
        "show",
        "visible"
      );


    attachPopupMenu
      .setAttribute(
        "aria-hidden",
        "true"
      );


    /*
     * Keep the + button semantically synchronized.
     */

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
        files ||
        []
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


      emitState();


      /*
       * Parallel processing is intentional.
       * Each attachment owns its own XHR/controller.
       */

      void processPipeline(
        item.id
      );
    }


    renderAll();


    return added;
  }


  /* =====================================================
     STEP 1 — CREATE SIGNED UPLOAD SESSION
     ===================================================== */

  async function createUploadSession(
    item
  ) {
    const payload = {
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
      "Upload authorization:",
      {
        name:
          item.name,

        size:
          item.size,

        category:
          item.category
      }
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

          headers: {
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


    const raw =
      await response.text();


    let data =
      null;


    try {
      data =
        JSON.parse(
          raw
        );
    } catch {}


    if (
      !response.ok
    ) {
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


    if (
      !data.uploadId
    ) {
      throw new Error(
        "Upload ID is missing."
      );
    }


    if (
      !data.bucket
    ) {
      throw new Error(
        "Storage bucket is missing."
      );
    }


    if (
      !data.path
    ) {
      throw new Error(
        "Storage path is missing."
      );
    }


    const signedUrl =
      data.signedUrl ||
      data.url;


    if (!signedUrl) {
      throw new Error(
        "Signed upload URL is missing."
      );
    }


    return {
      ...data,

      signedUrl
    };
  }


  /* =====================================================
     STEP 2 — DIRECT STORAGE UPLOAD
     ===================================================== */

  function uploadToSignedUrl(
    item,
    session
  ) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        const signedUrl =
          cleanString(
            session
              ?.signedUrl
          );


        if (!signedUrl) {
          reject(
            new Error(
              "Signed upload URL is missing."
            )
          );

          return;
        }


        const xhr =
          new XMLHttpRequest();


        item.uploadXhr =
          xhr;


        const method =
          cleanString(
            session?.method ||
            session?.uploadMethod ||
            "PUT"
          )
            .toUpperCase() ||
          "PUT";


        xhr.open(
          method,
          signedUrl,
          true
        );


        xhr.timeout =
          CONFIG
            .uploadTimeoutMs;


        /*
         * Apply server-authorized headers first.
         */

        if (
          session.headers &&
          typeof session.headers ===
            "object"
        ) {
          for (
            const [
              key,
              value
            ]
            of Object.entries(
              session.headers
            )
          ) {
            if (
              value ===
                undefined ||
              value ===
                null
            ) {
              continue;
            }

            xhr.setRequestHeader(
              key,
              String(
                value
              )
            );
          }
        }


        const suppliedHeaders =
          Object.keys(
            session.headers ||
            {}
          )
            .map(
              value =>
                value.toLowerCase()
            );


        if (
          !suppliedHeaders.includes(
            "content-type"
          )
        ) {
          xhr.setRequestHeader(
            "Content-Type",
            item.mime ||
            "application/octet-stream"
          );
        }


        xhr.upload.onprogress =
          event => {
            if (
              !event
                .lengthComputable
            ) {
              return;
            }


            item.progress =
              clamp(
                (
                  event.loaded /
                  event.total
                ) *
                  100,
                0,
                100
              );


            renderItem(
              item
            );


            emitState();
          };


        xhr.onload =
          () => {
            item.uploadXhr =
              null;


            if (
              xhr.status >=
                200 &&
              xhr.status <
                300
            ) {
              resolve(
                true
              );

              return;
            }


            let message =
              `Storage upload failed (${xhr.status}).`;


            try {
              const body =
                JSON.parse(
                  xhr.responseText
                );

              message =
                body?.message ||
                body?.error ||
                message;
            } catch {}


            reject(
              new Error(
                message
              )
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
                "Upload cancelled.",
                "AbortError"
              )
            );
          };


        /*
         * Raw File body.
         * The signed upload URL authorizes the
         * destination and Storage path.
         */

        xhr.send(
          item.file
        );
      }
    );
  }


  /* =====================================================
     STEP 3 — PROCESS ATTACHMENT
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
        () =>
          controller.abort(),
        CONFIG
          .processTimeoutMs
      );


    try {
      const payload = {
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
        "Processing attachment:",
        {
          name:
            item.name,

          category:
            item.category
        }
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

            headers: {
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
              controller
                .signal
          }
        );


      const raw =
        await response.text();


      let data =
        null;


      try {
        data =
          JSON.parse(
            raw
          );
      } catch {}


      if (
        response.status ===
        202
      ) {
        return {
          queued:
            true,

          data:
            data ||
            {}
        };
      }


      if (
        !response.ok
      ) {
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
          data ||
          {}
      };


    } finally {
      window.clearTimeout(
        timer
      );

      item.processController =
        null;
    }
  }


  /* =====================================================
     FULL PIPELINE
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
         AUTHORIZE
         --------------------------------------------- */

      item.status =
        "authorizing";

      item.progress =
        0;

      item.error =
        null;

      item.ready =
        false;


      renderItem(
        item
      );

      emitState();


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


      item.progress =
        100;

      item.status =
        "uploaded";


      renderItem(
        item
      );

      emitState();


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
         SERVER QUEUED PROCESSING
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


        window.dispatchEvent(
          new CustomEvent(
            "neyo:attachment-processing-queued",
            {
              detail: {
                attachment:
                  serializeItem(
                    item
                  )
              }
            }
          )
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
        true;


      item.status =
        "ready";


      renderItem(
        item
      );

      emitState();


      window.dispatchEvent(
        new CustomEvent(
          "neyo:attachment-ready",
          {
            detail: {
              attachment:
                serializeItem(
                  item
                )
            }
          }
        )
      );


      debug(
        "Ready:",
        {
          name:
            item.name,

          category:
            item.category,

          uploadId:
            item.uploadId,

          path:
            item.path
        }
      );


      return true;


    } catch (
      error
    ) {
      /*
       * If item was removed while upload/process
       * was being cancelled, there is nothing
       * left to render as an error.
       */

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


      item.error =
        error?.name ===
          "AbortError"
          ? "Attachment operation was cancelled."
          : (
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
     RETRY
     ===================================================== */

  function resetForRetry(
    item
  ) {
    try {
      item.uploadXhr
        ?.abort?.();
    } catch {}


    try {
      item.processController
        ?.abort?.();
    } catch {}


    item.uploadXhr =
      null;


    item.processController =
      null;


    item.uploadId =
      null;


    item.bucket =
      null;


    item.path =
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


    resetForRetry(
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
      item.uploadXhr
        ?.abort?.();
    } catch {}


    try {
      item.processController
        ?.abort?.();
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
      .querySelector(
        `[data-attachment-id="${id}"]`
      )
      ?.remove();


    renderAll();


    window.dispatchEvent(
      new CustomEvent(
        "neyo:attachment-removed",
        {
          detail: {
            id,

            uploadId:
              item.uploadId,

            bucket:
              item.bucket,

            path:
              item.path
          }
        }
      )
    );


    return true;
  }


  /* =====================================================
     CLEAR
     ===================================================== */

  function clearAttachments() {
    const ids = [
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


    attachmentList.innerHTML =
      "";


    attachmentList.hidden =
      true;


    composerWrapper
      ?.classList
      .remove(
        "has-attachments"
      );


    emitState();
  }


  /* =====================================================
     + BUTTON OWNERSHIP

     DO NOTHING.

     neo.js remains owner of #attachBtn.
     ===================================================== */

  if (attachBtn) {
    debug(
      "#attachBtn preserved for existing popup UX."
    );
  }


  /* =====================================================
     ADD FILES MENU OWNERSHIP

     Capture phase prevents any legacy file-picker
     handler attached specifically to Add Files.

     Other popup items remain untouched.
     ===================================================== */

  if (
    addFilesMenuBtn
  ) {
    addFilesMenuBtn.addEventListener(
      "click",
      event => {
        event.preventDefault();

        event.stopPropagation();

        event
          .stopImmediatePropagation();


        closePopup();


        openPicker();
      },
      true
    );
  } else {
    console.warn(
      "[NEYO Attachments] #addFilesMenuBtn was not found."
    );
  }


  /* =====================================================
     PRIVATE INPUT CHANGE
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
       * Allows choosing the same file again
       * after it has been removed.
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
     DRAG / DROP HELPERS
     ===================================================== */

  function eventHasFiles(
    event
  ) {
    return Array
      .from(
        event
          ?.dataTransfer
          ?.types ||
        []
      )
      .includes(
        "Files"
      );
  }


  function isInsideComposer(
    event
  ) {
    if (!composerWrapper) {
      return true;
    }


    const path =
      typeof event
        .composedPath ===
        "function"
          ? event
              .composedPath()
          : [];


    if (
      path.includes(
        composerWrapper
      )
    ) {
      return true;
    }


    return composerWrapper
      .contains(
        event.target
      );
  }


  function showDragState() {
    state.dragging =
      true;


    dropZone
      ?.classList
      .add(
        "is-file-dragging"
      );


    document
      .getElementById(
        "dragDropOverlay"
      )
      ?.classList
      .add(
        "active"
      );
  }


  function hideDragState() {
    state.dragging =
      false;


    dropZone
      ?.classList
      .remove(
        "is-file-dragging"
      );


    document
      .getElementById(
        "dragDropOverlay"
      )
      ?.classList
      .remove(
        "active"
      );
  }


  /* =====================================================
     DRAG ENTER
     ===================================================== */

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

      event
        .stopImmediatePropagation();


      showDragState();
    },
    true
  );


  /* =====================================================
     DRAG OVER
     ===================================================== */

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

      event
        .stopImmediatePropagation();


      if (
        event.dataTransfer
      ) {
        event.dataTransfer
          .dropEffect =
          "copy";
      }


      showDragState();
    },
    true
  );


  /* =====================================================
     DROP
     ===================================================== */

  document.addEventListener(
    "drop",
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

      event
        .stopImmediatePropagation();


      const files =
        Array.from(
          event
            .dataTransfer
            ?.files ||
          []
        );


      hideDragState();


      if (
        files.length
      ) {
        void addFiles(
          files
        );
      }
    },
    true
  );


  /* =====================================================
     DRAG LEAVE
     ===================================================== */

  document.addEventListener(
    "dragleave",
    event => {
      if (
        !state.dragging
      ) {
        return;
      }


      if (
        event.relatedTarget &&
        composerWrapper
          ?.contains(
            event.relatedTarget
          )
      ) {
        return;
      }


      hideDragState();
    },
    true
  );


  /* =====================================================
     FILE PASTE

     Only clipboard Files are intercepted.
     Normal text paste remains 100% untouched.
     ===================================================== */

  document.addEventListener(
    "paste",
    event => {
      const clipboard =
        event.clipboardData;


      if (!clipboard) {
        return;
      }


      const files =
        [];


      for (
        const clipboardItem
        of clipboard.items ||
        []
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

      event.stopPropagation();

      event
        .stopImmediatePropagation();


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
      const action =
        event.target
          ?.closest?.(
            "[data-action]"
          );


      if (!action) {
        return;
      }


      const chip =
        action.closest(
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
        action.dataset
          .action ===
        "remove"
      ) {
        removeAttachment(
          id
        );

        return;
      }


      if (
        action.dataset
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
     SUCCESSFUL CHAT → CLEAR ATTACHMENTS
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-clear-request",
    clearAttachments
  );


  /* =====================================================
     EXTERNAL OPEN REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-open-request",
    openPicker
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

      hasPending,

      hasErrors,

      getState:
        () => ({
          version:
            VERSION,

          count:
            state.items
              .size,

          ready:
            getReady()
              .length,

          pending:
            hasPending(),

          errors:
            getAll()
              .filter(
                item =>
                  item.status ===
                  "error"
              )
              .length,

          totalSize:
            getTotalSize(),

          dragging:
            state.dragging,

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

  fileInput.multiple =
    true;


  fileInput.accept =
    "*/*";


  attachmentList.hidden =
    state.items.size ===
    0;


  composerWrapper
    ?.classList
    .remove(
      "has-attachments"
    );


  emitState();


  debug(
    "FINAL v3 READY",
    {
      version:
        VERSION,

      attachBtnPreserved:
        Boolean(
          attachBtn
        ),

      addFilesOwned:
        Boolean(
          addFilesMenuBtn
        ),

      privateInput:
        fileInput.id,

      attachmentList:
        attachmentList.id,

      maxFiles:
        CONFIG.maxFiles,

      maxFileSize:
        formatBytes(
          CONFIG.maxFileSize
        )
    }
  );

})();
