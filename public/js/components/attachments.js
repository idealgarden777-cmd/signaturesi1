/*
=========================================================
NEYO — ATTACHMENTS CONTROLLER
FINAL v4 — SIGNED UPLOAD + PROCESSING

FILE:
public/js/components/attachments.js

FLOW
---------------------------------------------------------
1. User selects / drops / pastes file
2. Validate locally
3. POST metadata -> /api/attachments/upload
4. Receive uploadId + bucket + path + signedUrl
5. Upload raw File directly to signed URL
6. POST metadata -> /api/attachments/process
7. Receive document / chunks / stats
8. Mark attachment READY
9. chat.js receives secure storage metadata only

OWNERSHIP
---------------------------------------------------------
✅ Owns private file input
✅ Owns file upload state
✅ Owns attachment chips
✅ Owns drag/drop + pasted files
✅ Owns retry/remove
✅ Owns #addFilesMenuBtn

DOES NOT OWN
---------------------------------------------------------
❌ #attachBtn
❌ #sendBtn
❌ #chatInput
❌ chat transport
❌ voice
❌ mascot
❌ neo.js

IMPORTANT
---------------------------------------------------------
#attachBtn remains owned by neo.js popup UX.
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / DUPLICATE GUARD
     ===================================================== */

  const VERSION =
    "neyo-attachments-final-v4";


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


  if (
    !attachmentList
  ) {
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


  if (
    !fileInput
  ) {
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
     DEBUG
     ===================================================== */

  function debug(
    ...args
  ) {
    if (
      !CONFIG.debug
    ) {
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
    detail =
      {}
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
    item =
      null
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


  function getExtension(
    name
  ) {
    const value =
      String(
        name ||
        ""
      );


    const index =
      value.lastIndexOf(
        "."
      );


    if (
      index <
        0 ||
      index ===
        value.length -
        1
    ) {
      return "";
    }


    return value
      .slice(
        index +
          1
      )
      .toLowerCase();
  }


  function getCategory(
    extension
  ) {
    const ext =
      String(
        extension ||
        ""
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


    return (
      "unknown"
    );
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
     ICON
     ===================================================== */

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


  /* =====================================================
     STATUS LABEL
     ===================================================== */

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
        return (
          `Uploading ${Math.round(
            item.progress ||
            0
          )}%`
        );

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


  /* =====================================================
     TOTAL SIZE
     ===================================================== */

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
        ) ||
        0;
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


    if (
      !file.name
    ) {
      return {
        valid:
          false,

        message:
          "File name is missing."
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
     ITEM
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
        file.type ||
        "application/octet-stream",

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

      uploadXhr:
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
          item.progress ||
          0
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
          item.ready ===
            true &&
          item.status ===
            "ready"
      )
      .map(
        serializeItem
      );
  }


  /* =====================================================
     EMIT STATE
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


  /* =====================================================
     COMPOSER CLASS
     ===================================================== */

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
     RENDER CHIP
     ===================================================== */

  function renderItem(
    item
  ) {
    if (
      !attachmentList
    ) {
      return;
    }


    let chip =
      attachmentList
        .querySelector(
          `[data-attachment-id="${item.id}"]`
        );


    if (
      !chip
    ) {
      chip =
        document.createElement(
          "div"
        );


      chip.className =
        "attachment-chip";


      chip.dataset.attachmentId =
        item.id;


      attachmentList.appendChild(
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
          <div class="attachment-chip-preview">
            <img
              src="${escapeHtml(item.previewUrl)}"
              alt=""
            >
          </div>
        `
        : `
          <div class="attachment-chip-icon">
            <i
              data-lucide="${getIcon(item.category)}"
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
          <div class="attachment-chip-progress">
            <span
              style="width:${clamp(
                item.progress ||
                0,
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

        <div class="attachment-chip-body">

          <div
            class="attachment-chip-name"
            title="${escapeHtml(item.name)}"
          >
            ${escapeHtml(item.name)}
          </div>

          <div class="attachment-chip-meta">

            <span>
              ${escapeHtml(
                formatBytes(
                  item.size
                )
              )}
            </span>

            <span aria-hidden="true">
              ·
            </span>

            <span
              class="attachment-chip-status"
              title="${escapeHtml(status)}"
            >
              ${escapeHtml(status)}
            </span>

          </div>

          ${progress}

        </div>

        ${action}
      `;


    try {
      window
        .lucide
        ?.createIcons
        ?.();
    } catch {}
  }


  /* =====================================================
     RENDER ALL
     ===================================================== */

  function renderAll() {
    if (
      !attachmentList
    ) {
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


      if (
        item
      ) {
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
     OPEN PICKER
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


  /* =====================================================
     CLOSE LEGACY POPUP
     ===================================================== */

  function closeLegacyPopup() {
    if (
      !attachPopupMenu
    ) {
      return;
    }


    attachPopupMenu.classList.remove(
      "active",
      "open",
      "show"
    );


    attachPopupMenu.setAttribute(
      "aria-hidden",
      "true"
    );


    if (
      attachBtn
    ) {
      attachBtn.setAttribute(
        "aria-expanded",
        "false"
      );
    }
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


      renderAll();


      /*
       * Run every file independently.
       * One failed file must not stop others.
       */

      void processPipeline(
        item.id
      );
    }


    return added;
  }


  /* =====================================================
     STEP 1 — UPLOAD AUTHORIZATION
     ===================================================== */

  async function createUploadSession(
    item
  ) {
    if (
      !item?.name
    ) {
      throw new Error(
        "Attachment filename is missing before upload."
      );
    }


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
      "UPLOAD_SESSION_REQUEST",
      payload
    );


    const response =
      await fetch(
        CONFIG.uploadSessionEndpoint,
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
        raw
          ? JSON.parse(
              raw
            )
          : null;
    } catch {}


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


    if (
      !response.ok
    ) {
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


    /*
     * CRITICAL v4 FIX:
     *
     * token is NOT required.
     * signedUrl is the actual browser upload contract.
     */

    const signedUrl =
      data.signedUrl ||
      data.url;


    if (
      !signedUrl
    ) {
      throw new Error(
        "Signed upload URL is missing."
      );
    }


    return {
      ...data,

      signedUrl,

      method:
        String(
          data.method ||
          "PUT"
        )
          .trim()
          .toUpperCase(),

      headers:
        data.headers &&
        typeof data.headers ===
          "object"
            ? data.headers
            : {}
    };
  }


  /* =====================================================
     STEP 2 — DIRECT SIGNED STORAGE UPLOAD
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
          String(
            session?.signedUrl ||
            ""
          );


        if (
          !signedUrl
        ) {
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
          String(
            session?.method ||
            "PUT"
          )
            .trim()
            .toUpperCase();


        xhr.open(
          method,
          signedUrl,
          true
        );


        xhr.timeout =
          CONFIG.uploadTimeoutMs;


        /*
         * Apply backend supplied upload headers first.
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


            try {
              xhr.setRequestHeader(
                key,
                String(
                  value
                )
              );
            } catch {}
          }
        }


        /*
         * Avoid overriding backend Content-Type
         * if it already supplied one.
         */

        const hasContentType =
          Object.keys(
            session.headers ||
            {}
          )
            .some(
              key =>
                key.toLowerCase() ===
                "content-type"
            );


        if (
          !hasContentType
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
              !event.lengthComputable
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
              const response =
                JSON.parse(
                  xhr.responseText
                );


              message =
                response?.message ||
                response?.error ||
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
                "Network error during storage upload."
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
        () =>
          controller.abort(),
        CONFIG.processTimeoutMs
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
        "PROCESS_REQUEST",
        payload
      );


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
              JSON.stringify(
                payload
              ),

            signal:
              controller.signal
          }
        );


      const raw =
        await response.text();


      let data =
        null;


      try {
        data =
          raw
            ? JSON.parse(
                raw
              )
            : null;

      } catch {}


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


    if (
      !item
    ) {
      return false;
    }


    try {

      /* -------------------------------------------------
         PREPARING
         ------------------------------------------------- */

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


      /* -------------------------------------------------
         AUTHORIZATION
         ------------------------------------------------- */

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


      /* -------------------------------------------------
         UPLOADING
         ------------------------------------------------- */

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


      /* -------------------------------------------------
         READING / PROCESSING
         ------------------------------------------------- */

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


      /* -------------------------------------------------
         QUEUED SERVER PROCESSING
         ------------------------------------------------- */

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


      /* -------------------------------------------------
         READY
         ------------------------------------------------- */

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


      debug(
        "PIPELINE_ERROR",
        {
          name:
            item.name,

          status:
            item.status,

          error:
            item.error
        }
      );


      return false;
    }
  }


  /* =====================================================
     RESET FOR RETRY
     ===================================================== */

  function resetItemForRetry(
    item
  ) {
    try {
      item.uploadXhr
        ?.abort
        ?.();
    } catch {}


    try {
      item.processController
        ?.abort
        ?.();
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


  /* =====================================================
     RETRY
     ===================================================== */

  function retryAttachment(
    id
  ) {
    const item =
      state.items.get(
        id
      );


    if (
      !item
    ) {
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


    if (
      !item
    ) {
      return false;
    }


    try {
      item.uploadXhr
        ?.abort
        ?.();
    } catch {}


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
     BUTTON OWNERSHIP
     ===================================================== */

  /*
   * DO NOT bind #attachBtn.
   *
   * neo.js owns its popup behavior.
   */

  if (
    attachBtn
  ) {
    debug(
      "#attachBtn preserved for neo.js popup UX."
    );
  }


  /*
   * We own only Add Files inside popup.
   */

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


        closeLegacyPopup();

        openPicker();
      },
      true
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
       * Important:
       * reset so same file can be selected again.
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
     EXTERNAL OPEN REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-open-request",
    () => {
      openPicker();
    }
  );


  /* =====================================================
     DRAG HELPERS
     ===================================================== */

  function eventHasFiles(
    event
  ) {
    const types =
      Array.from(
        event
          ?.dataTransfer
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

      setDragging(
        true
      );
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


      if (
        event.dataTransfer
      ) {
        event.dataTransfer.dropEffect =
          "copy";
      }


      setDragging(
        true
      );
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


      const related =
        event.relatedTarget;


      if (
        related instanceof Node &&
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


  /* =====================================================
     DROP
     ===================================================== */

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

      event
        .stopImmediatePropagation();


      setDragging(
        false
      );


      const files =
        Array.from(
          event
            .dataTransfer
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

     Normal text paste remains untouched.
     ===================================================== */

  document.addEventListener(
    "paste",
    async event => {
      const clipboard =
        event.clipboardData;


      if (
        !clipboard
      ) {
        return;
      }


      const files =
        [];


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


        if (
          file
        ) {
          files.push(
            file
          );
        }
      }


      /*
       * If clipboard has no files,
       * leave normal text paste alone.
       */

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
     CHIP ACTIONS
     ===================================================== */

  attachmentList.addEventListener(
    "click",
    event => {
      const button =
        event.target.closest(
          "[data-action]"
        );


      if (
        !button
      ) {
        return;
      }


      const chip =
        button.closest(
          "[data-attachment-id]"
        );


      const id =
        chip?.dataset
          ?.attachmentId;


      if (
        !id
      ) {
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
     PUBLIC CLEAR REQUEST
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
    "FINAL v4 READY",
    {
      version:
        VERSION,

      maxFiles:
        CONFIG.maxFiles,

      maxFileSize:
        formatBytes(
          CONFIG.maxFileSize
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
        )
    }
  );

})();
