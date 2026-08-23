/*
=========================================================
NEYO — ATTACHMENTS
PRODUCTION SAFE-HYBRID CONTROLLER v2

FILE:
public/js/components/attachments.js

GOALS
---------------------------------------------------------
✅ neo.js remains untouched
✅ One canonical attachment state
✅ Current uploaded files reach chat.js
✅ "Ready" means ACTUALLY API-ready
✅ Valid bucket + path required before Ready
✅ Add Files routed into modular attachment controller
✅ Prevent duplicate legacy Add Files handling
✅ Drag/drop supported
✅ Paste-file supported
✅ Multiple files supported
✅ Retry/remove supported
✅ Sent-ready attachments removable by runtime/send-state
✅ Pending/failed files never masquerade as Ready
✅ Text chat can continue even if another file failed
✅ Attachment-only sending supported by chat.js
✅ No browser Supabase client required

PIPELINE
---------------------------------------------------------

User selects file
    ↓
attachments.js
    ↓
POST /api/attachments/upload
    ↓
signed storage upload
    ↓
POST /api/attachments/process
    ↓
status = ready ONLY when:
  item.ready === true
  item.bucket exists
  item.path exists
    ↓
NeyoAttachments.getReady()
    ↓
chat-runtime.js / send-state.js
    ↓
neyo:chat-send-request
    ↓
chat.js
    ↓
/api/chat

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / DUPLICATE GUARD
     ===================================================== */

  const VERSION =
    "neyo-attachments-production-v2";


  if (
    window.NeyoAttachments
      ?.__controller ===
    true
  ) {
    console.warn(
      "[NEYO Attachments] Already initialized."
    );

    return;
  }


  /* =====================================================
     CONFIG
     ===================================================== */

  const CFG =
    Object.freeze({
      uploadEndpoint:
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

      debug:
        true
    });


  /* =====================================================
     DOM
     ===================================================== */

  const composer =
    document.getElementById(
      "composerWrapper"
    ) ||
    document.getElementById(
      "glassInputContainer"
    ) ||
    document.querySelector(
      ".composer-wrapper"
    );


  const glass =
    document.getElementById(
      "glassInputContainer"
    ) ||
    composer;


  const attachBtn =
    document.getElementById(
      "attachBtn"
    );


  const addFilesMenuBtn =
    document.getElementById(
      "addFilesMenuBtn"
    );


  const dragDropOverlay =
    document.getElementById(
      "dragDropOverlay"
    );


  /*
  -------------------------------------------------------
  Always prefer the current modular attachment shelf.

  Do NOT use the old legacy attachedChipsWrapper as the
  canonical state surface.
  -------------------------------------------------------
  */

  let attachmentList =
    document.getElementById(
      "attachmentList"
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
      "attached-chips-wrapper neyo-v2-attachment-list";

    attachmentList.hidden =
      true;


    if (
      glass
    ) {
      glass.prepend(
        attachmentList
      );

    } else {
      document.body.appendChild(
        attachmentList
      );
    }
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

  const state =
    {
      items:
        new Map(),

      order:
        [],

      dragging:
        false
    };


  const PENDING_STATUSES =
    new Set([
      "queued",
      "authorizing",
      "uploading",
      "uploaded",
      "processing",
      "queued-processing"
    ]);


  /* =====================================================
     BLOCKED EXECUTABLE TYPES
     ===================================================== */

  const BLOCKED_EXTENSIONS =
    new Set([
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


  /* =====================================================
     FILE GROUPS
     ===================================================== */

  const GROUPS =
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
     LOGGING
     ===================================================== */

  function debug(
    ...args
  ) {
    if (
      !CFG.debug
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
     ESCAPE
     ===================================================== */

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
     ID
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


  /* =====================================================
     EXTENSION
     ===================================================== */

  function extensionOf(
    name
  ) {
    return String(
      name ||
      ""
    )
      .toLowerCase()
      .match(
        /\.([a-z0-9]+)$/
      )
      ?.[1] ||
      "";
  }


  /* =====================================================
     FORMAT BYTES
     ===================================================== */

  function formatBytes(
    bytes
  ) {
    let value =
      Math.max(
        0,
        Number(
          bytes
        ) ||
        0
      );


    if (
      value <
      1024
    ) {
      return `${value} B`;
    }


    const units =
      [
        "KB",
        "MB",
        "GB"
      ];


    value /=
      1024;


    let index =
      0;


    while (
      value >=
        1024 &&
      index <
        units.length -
          1
    ) {
      value /=
        1024;

      index +=
        1;
    }


    return `${
      value >= 10
        ? value.toFixed(0)
        : value.toFixed(1)
    } ${units[index]}`;
  }


  /* =====================================================
     CATEGORY
     ===================================================== */

  function categoryOf(
    extension,
    mime = ""
  ) {
    for (
      const [
        category,
        extensions
      ]
      of Object.entries(
        GROUPS
      )
    ) {
      if (
        extensions.has(
          extension
        )
      ) {
        return category;
      }
    }


    const type =
      String(
        mime ||
        ""
      )
        .toLowerCase();


    if (
      type.startsWith(
        "image/"
      )
    ) {
      return "image";
    }


    if (
      type.startsWith(
        "audio/"
      )
    ) {
      return "audio";
    }


    if (
      type.startsWith(
        "video/"
      )
    ) {
      return "video";
    }


    if (
      type.startsWith(
        "text/"
      )
    ) {
      return "text";
    }


    return "unknown";
  }


  /* =====================================================
     TOTAL SIZE
     ===================================================== */

  function totalSize() {
    return [
      ...state.items.values()
    ]
      .reduce(
        (
          total,
          item
        ) =>
          total +
          (
            Number(
              item.size
            ) ||
            0
          ),
        0
      );
  }


  /* =====================================================
     DUPLICATE
     ===================================================== */

  function isDuplicate(
    file
  ) {
    return [
      ...state.items.values()
    ]
      .some(
        item =>
          item.name ===
            file.name &&
          item.size ===
            file.size &&
          item.lastModified ===
            file.lastModified
      );
  }


  /* =====================================================
     VALIDATE FILE
     ===================================================== */

  function validateFile(
    file
  ) {
    if (
      !(
        file instanceof
        File
      )
    ) {
      return "Invalid file.";
    }


    if (
      !file.name
    ) {
      return "File name is missing.";
    }


    if (
      file.size <=
      0
    ) {
      return (
        `"${file.name}" is empty.`
      );
    }


    if (
      file.size >
      CFG.maxFileSize
    ) {
      return (
        `"${file.name}" exceeds the ` +
        `${formatBytes(
          CFG.maxFileSize
        )} limit.`
      );
    }


    if (
      BLOCKED_EXTENSIONS.has(
        extensionOf(
          file.name
        )
      )
    ) {
      return (
        `"${file.name}" is not an allowed attachment type.`
      );
    }


    if (
      state.items.size >=
      CFG.maxFiles
    ) {
      return (
        `Maximum ${CFG.maxFiles} attachments are allowed.`
      );
    }


    if (
      totalSize() +
        file.size >
      CFG.maxTotalSize
    ) {
      return (
        "Total attachments cannot exceed " +
        formatBytes(
          CFG.maxTotalSize
        ) +
        "."
      );
    }


    if (
      isDuplicate(
        file
      )
    ) {
      return (
        `"${file.name}" is already attached.`
      );
    }


    return "";
  }


  /* =====================================================
     CREATE ITEM
     ===================================================== */

  function createItem(
    file
  ) {
    const extension =
      extensionOf(
        file.name
      );


    const category =
      categoryOf(
        extension,
        file.type
      );


    let previewUrl =
      null;


    if (
      category ===
      "image"
    ) {
      try {
        previewUrl =
          URL.createObjectURL(
            file
          );
      } catch {}
    }


    return {
      id:
        createId(),

      file,

      name:
        file.name,

      size:
        file.size,

      mime:
        String(
          file.type ||
          "application/octet-stream"
        )
          .toLowerCase(),

      extension,

      category,

      lastModified:
        file.lastModified,

      previewUrl,

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

      uploadController:
        null,

      processController:
        null
    };
  }


  /* =====================================================
     API-READY VALIDATION
     ===================================================== */

  function isApiReady(
    item
  ) {
    return Boolean(
      item &&
      item.ready ===
        true &&
      item.status ===
        "ready" &&
      typeof item.bucket ===
        "string" &&
      item.bucket.trim() &&
      typeof item.path ===
        "string" &&
      item.path.trim()
    );
  }


  /* =====================================================
     SERIALIZE
     ===================================================== */

  function serialize(
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
        isApiReady(
          item
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


  /* =====================================================
     PUBLIC STATE READERS
     ===================================================== */

  function getAll() {
    return state.order
      .map(
        key =>
          state.items.get(
            key
          )
      )
      .filter(
        Boolean
      )
      .map(
        serialize
      );
  }


  function getReady() {
    return state.order
      .map(
        key =>
          state.items.get(
            key
          )
      )
      .filter(
        isApiReady
      )
      .map(
        serialize
      );
  }


  function hasPending() {
    return [
      ...state.items.values()
    ]
      .some(
        item =>
          PENDING_STATUSES.has(
            item.status
          )
      );
  }


  function hasErrors() {
    return [
      ...state.items.values()
    ]
      .some(
        item =>
          item.status ===
          "error"
      );
  }


  /* =====================================================
     COMPOSER STATE
     ===================================================== */

  function syncComposer() {
    const active =
      state.items.size >
      0;


    composer
      ?.classList
      ?.toggle(
        "has-attachments",
        active
      );


    glass
      ?.classList
      ?.toggle(
        "has-attachments",
        active
      );
  }


  /* =====================================================
     EMIT STATE
     ===================================================== */

  function emitState() {
    const all =
      getAll();


    const ready =
      getReady();


    emit(
      "neyo:attachments-change",
      {
        version:
          VERSION,

        count:
          all.length,

        ready:
          ready.length,

        pending:
          hasPending(),

        errors:
          all.filter(
            item =>
              item.status ===
              "error"
          ).length,

        totalSize:
          totalSize(),

        attachments:
          all
      }
    );
  }


  /* =====================================================
     STATUS LABEL
     ===================================================== */

  function statusOf(
    item
  ) {
    if (
      isApiReady(
        item
      )
    ) {
      return "Ready";
    }


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
        return "Reading";

      case "processing":
        return "Reading";

      case "queued-processing":
        return "Processing";

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
     ICON
     ===================================================== */

  function iconOf(
    category
  ) {
    return (
      {
        document:
          "file-text",

        spreadsheet:
          "sheet",

        presentation:
          "presentation",

        image:
          "image",

        audio:
          "audio-lines",

        video:
          "video",

        archive:
          "archive",

        data:
          "database",

        code:
          "file-code-2",

        text:
          "file-text"
      }[
        category
      ] ||
      "file"
    );
  }


  /* =====================================================
     REFRESH ICONS
     ===================================================== */

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }


  /* =====================================================
     RENDER ITEM
     ===================================================== */

  function renderItem(
    item
  ) {
    let chip =
      attachmentList.querySelector(
        `[data-attachment-id="${CSS.escape(
          item.id
        )}"]`
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

      chip.dataset
        .attachmentId =
        item.id;

      attachmentList.appendChild(
        chip
      );
    }


    chip.dataset.status =
      item.status;


    chip.dataset.ready =
      isApiReady(
        item
      )
        ? "true"
        : "false";


    const visual =
      item.previewUrl
        ? `
          <div class="attachment-chip-preview">
            <img
              src="${escapeHtml(
                item.previewUrl
              )}"
              alt=""
            >
          </div>
        `
        : `
          <div class="attachment-chip-icon">
            <i
              data-lucide="${iconOf(
                item.category
              )}"
              aria-hidden="true"
            ></i>
          </div>
        `;


    const action =
      item.status ===
        "error"
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
              aria-hidden="true"
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
              aria-hidden="true"
            ></i>
          </button>
        `;


    const progress =
      item.status ===
        "uploading"
        ? `
          <div class="attachment-chip-progress">
            <span
              style="width:${Math.min(
                100,
                Math.max(
                  0,
                  item.progress ||
                  0
                )
              )}%"
            ></span>
          </div>
        `
        : "";


    chip.innerHTML = `
      ${visual}

      <div class="attachment-chip-body">

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

          <span class="attachment-chip-status">
            ${escapeHtml(
              statusOf(
                item
              )
            )}
          </span>

        </div>

        ${progress}

      </div>

      ${action}
    `;


    refreshIcons();
  }


  /* =====================================================
     RENDER ALL
     ===================================================== */

  function renderAll() {
    for (
      const key
      of state.order
    ) {
      const item =
        state.items.get(
          key
        );


      if (
        item
      ) {
        renderItem(
          item
        );
      }
    }


    const validIds =
      new Set(
        state.order
      );


    attachmentList
      .querySelectorAll(
        "[data-attachment-id]"
      )
      .forEach(
        node => {
          if (
            !validIds.has(
              node.dataset
                .attachmentId
            )
          ) {
            node.remove();
          }
        }
      );


    attachmentList.hidden =
      state.items.size ===
      0;


    syncComposer();

    emitState();
  }


  /* =====================================================
     FAILURE
     ===================================================== */

  function emitFailure(
    message,
    item = null
  ) {
    console.warn(
      "[NEYO Attachments]",
      message
    );


    emit(
      "neyo:attachment-error",
      {
        message:
          String(
            message ||
            "Attachment failed."
          ),

        attachment:
          item
            ? serialize(
                item
              )
            : null
      }
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


    if (
      !raw
    ) {
      return {
        data:
          null,

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
          null,

        raw
      };
    }
  }


  /* =====================================================
     FETCH WITH TIMEOUT
     ===================================================== */

  async function timedFetch(
    url,
    options,
    timeoutMs,
    target = null,
    controllerField =
      null
  ) {
    const controller =
      new AbortController();


    const timer =
      window.setTimeout(
        () => {
          try {
            controller.abort();
          } catch {}
        },
        timeoutMs
      );


    if (
      target &&
      controllerField
    ) {
      target[
        controllerField
      ] =
        controller;
    }


    try {
      return await fetch(
        url,
        {
          ...options,

          signal:
            controller.signal
        }
      );

    } catch (
      error
    ) {
      if (
        error?.name ===
        "AbortError"
      ) {
        throw new Error(
          "Request timed out."
        );
      }


      throw error;

    } finally {
      window.clearTimeout(
        timer
      );


      if (
        target &&
        controllerField &&
        target[
          controllerField
        ] ===
          controller
      ) {
        target[
          controllerField
        ] =
          null;
      }
    }
  }


  /* =====================================================
     AUTHORIZE
     ===================================================== */

  async function authorizeUpload(
    item
  ) {
    const response =
      await timedFetch(
        CFG.uploadEndpoint,
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
        },
        CFG.uploadTimeoutMs,
        item,
        "uploadController"
      );


    const {
      data,
      raw
    } =
      await readResponse(
        response
      );


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
      !data?.uploadId ||
      !data?.bucket ||
      !data?.path ||
      !data?.token ||
      !data?.signedUrl
    ) {
      throw new Error(
        "Upload API returned incomplete signed upload information."
      );
    }


    return data;
  }


  /* =====================================================
     STORAGE UPLOAD
     ===================================================== */

  async function uploadToStorage(
    item,
    session
  ) {
    const form =
      new FormData();


    form.append(
      "cacheControl",
      CFG.cacheControl
    );


    /*
    Keep the same storage signed-upload contract that the
    existing working backend expects.
    */

    form.append(
      "",
      item.file,
      item.file.name
    );


    item.progress =
      15;


    renderItem(
      item
    );

    emitState();


    const response =
      await timedFetch(
        session.signedUrl,
        {
          method:
            "PUT",

          cache:
            "no-store",

          headers: {
            "x-upsert":
              "false"
          },

          body:
            form
        },
        CFG.uploadTimeoutMs,
        item,
        "uploadController"
      );


    const {
      data,
      raw
    } =
      await readResponse(
        response
      );


    if (
      !response.ok
    ) {
      throw new Error(
        data?.message ||
        data?.error ||
        data?.error_description ||
        raw ||
        `Storage upload failed (${response.status}).`
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
  }


  /* =====================================================
     PROCESS
     ===================================================== */

  async function processAttachment(
    item
  ) {
    const response =
      await timedFetch(
        CFG.processEndpoint,
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
            })
        },
        CFG.processTimeoutMs,
        item,
        "processController"
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
  }


  /* =====================================================
     PIPELINE
     ===================================================== */

  async function pipeline(
    key
  ) {
    const item =
      state.items.get(
        key
      );


    if (
      !item
    ) {
      return false;
    }


    try {
      Object.assign(
        item,
        {
          status:
            "authorizing",

          ready:
            false,

          progress:
            0,

          error:
            null
        }
      );


      renderItem(
        item
      );

      emitState();


      /* ===============================================
         1. AUTHORIZE
         =============================================== */

      const session =
        await authorizeUpload(
          item
        );


      if (
        !state.items.has(
          key
        )
      ) {
        return false;
      }


      Object.assign(
        item,
        {
          uploadId:
            session.uploadId,

          bucket:
            String(
              session.bucket ||
              ""
            )
              .trim() ||
            null,

          path:
            String(
              session.path ||
              ""
            )
              .trim() ||
            null,

          status:
            "uploading"
        }
      );


      /*
      API-valid storage identity must already exist
      before upload continues.
      */

      if (
        !item.bucket ||
        !item.path
      ) {
        throw new Error(
          "Attachment storage path is missing."
        );
      }


      renderItem(
        item
      );

      emitState();


      /* ===============================================
         2. STORAGE UPLOAD
         =============================================== */

      await uploadToStorage(
        item,
        session
      );


      if (
        !state.items.has(
          key
        )
      ) {
        return false;
      }


      /* ===============================================
         3. PROCESS
         =============================================== */

      item.status =
        "processing";


      item.ready =
        false;


      renderItem(
        item
      );

      emitState();


      const result =
        await processAttachment(
          item
        );


      if (
        !state.items.has(
          key
        )
      ) {
        return false;
      }


      const data =
        result.data ||
        {};


      Object.assign(
        item,
        {
          processId:
            data.processId ||
            null,

          documentId:
            data.documentId ||
            null,

          document:
            data.document ||
            null,

          chunks:
            Array.isArray(
              data.chunks
            )
              ? data.chunks
              : [],

          stats:
            data.stats ||
            null,

          extraction:
            data.extraction ||
            null,

          warnings:
            Array.isArray(
              data.warnings
            )
              ? data.warnings
              : []
        }
      );


      /* ===============================================
         ASYNC PROCESSING
         =============================================== */

      if (
        result.queued
      ) {
        item.ready =
          false;


        item.status =
          "queued-processing";


        renderItem(
          item
        );

        emitState();


        emit(
          "neyo:attachment-processing-queued",
          {
            attachment:
              serialize(
                item
              )
          }
        );


        return true;
      }


      /* ===============================================
         CRITICAL READY VALIDATION
         =============================================== */

      /*
      Old bug:

      status = "ready"
      even when data.ready === false.

      This version NEVER does that.
      */

      if (
        data.ready ===
        false
      ) {
        throw new Error(
          "File processing did not finish successfully. Retry the attachment."
        );
      }


      if (
        !item.bucket ||
        !item.path
      ) {
        throw new Error(
          "Processed attachment has no storage location."
        );
      }


      item.ready =
        true;


      item.status =
        "ready";


      item.progress =
        100;


      /*
      Final hard assertion.

      If this fails, the chip must NOT display Ready.
      */

      if (
        !isApiReady(
          item
        )
      ) {
        throw new Error(
          "Attachment failed API-ready validation."
        );
      }


      renderItem(
        item
      );

      emitState();


      emit(
        "neyo:attachment-ready",
        {
          attachment:
            serialize(
              item
            )
        }
      );


      debug(
        "READY",
        {
          id:
            item.id,

          name:
            item.name,

          bucket:
            item.bucket,

          path:
            item.path
        }
      );


      return true;

    } catch (
      error
    ) {
      if (
        !state.items.has(
          key
        )
      ) {
        return false;
      }


      Object.assign(
        item,
        {
          status:
            "error",

          ready:
            false,

          progress:
            0,

          error:
            error?.message ||
            "Couldn't process this file."
        }
      );


      renderItem(
        item
      );

      emitState();


      emitFailure(
        item.error,
        item
      );


      return false;
    }
  }


  /* =====================================================
     ADD FILES
     ===================================================== */

  async function addFiles(
    value
  ) {
    const files =
      Array.from(
        value ||
        []
      )
        .filter(
          file =>
            file instanceof
            File
        );


    if (
      files.length ===
      0
    ) {
      return [];
    }


    const addedIds =
      [];


    for (
      const file
      of files
    ) {
      const error =
        validateFile(
          file
        );


      if (
        error
      ) {
        emitFailure(
          error
        );

        continue;
      }


      const item =
        createItem(
          file
        );


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
    }


    /*
    Process up to five attachments concurrently.
    */

    await Promise.allSettled(
      addedIds.map(
        pipeline
      )
    );


    return addedIds
      .map(
        key =>
          state.items.get(
            key
          )
      )
      .filter(
        Boolean
      )
      .map(
        serialize
      );
  }


  /* =====================================================
     RESET FOR RETRY
     ===================================================== */

  function resetItem(
    item
  ) {
    try {
      item.uploadController
        ?.abort
        ?.();
    } catch {}


    try {
      item.processController
        ?.abort
        ?.();
    } catch {}


    Object.assign(
      item,
      {
        uploadController:
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

        ready:
          false,

        progress:
          0,

        error:
          null
      }
    );
  }


  /* =====================================================
     RETRY
     ===================================================== */

  function retry(
    key
  ) {
    const item =
      state.items.get(
        key
      );


    if (
      !item
    ) {
      return false;
    }


    resetItem(
      item
    );


    renderAll();


    void pipeline(
      key
    );


    return true;
  }


  /* =====================================================
     REMOVE
     ===================================================== */

  function remove(
    key
  ) {
    const item =
      state.items.get(
        key
      );


    if (
      !item
    ) {
      return false;
    }


    try {
      item.uploadController
        ?.abort
        ?.();
    } catch {}


    try {
      item.processController
        ?.abort
        ?.();
    } catch {}


    try {
      if (
        item.previewUrl
      ) {
        URL.revokeObjectURL(
          item.previewUrl
        );
      }
    } catch {}


    state.items.delete(
      key
    );


    state.order =
      state.order.filter(
        itemId =>
          itemId !==
          key
      );


    renderAll();


    emit(
      "neyo:attachment-removed",
      {
        id:
          key,

        uploadId:
          item.uploadId,

        bucket:
          item.bucket,

        path:
          item.path
      }
    );


    debug(
      "REMOVED",
      {
        id:
          key,

        name:
          item.name
      }
    );


    return true;
  }


  /* =====================================================
     CLEAR
     ===================================================== */

  function clear() {
    const ids =
      [
        ...state.order
      ];


    for (
      const key
      of ids
    ) {
      remove(
        key
      );
    }


    return true;
  }


  /* =====================================================
     REMOVE MANY
     ===================================================== */

  function removeMany(
    attachments
  ) {
    if (
      !Array.isArray(
        attachments
      )
    ) {
      return false;
    }


    let changed =
      false;


    for (
      const attachment
      of attachments
    ) {
      const key =
        typeof attachment ===
          "string"
          ? attachment
          : attachment?.id;


      if (
        !key
      ) {
        continue;
      }


      if (
        remove(
          key
        )
      ) {
        changed =
          true;
      }
    }


    return changed;
  }


  /* =====================================================
     OPEN PICKER
     ===================================================== */

  function open() {
    try {
      fileInput.click();

      return true;

    } catch (
      error
    ) {
      emitFailure(
        error?.message ||
        "Could not open file picker."
      );

      return false;
    }
  }


  /* =====================================================
     PRIVATE INPUT CHANGE
     ===================================================== */

  fileInput.addEventListener(
    "change",
    async () => {
      const files =
        Array.from(
          fileInput.files ||
          []
        );


      /*
      Allows choosing the same file again after removal.
      */

      fileInput.value =
        "";


      if (
        files.length >
        0
      ) {
        await addFiles(
          files
        );
      }
    }
  );


  /* =====================================================
     ADD FILES BUTTON
     ===================================================== */

  /*
  -------------------------------------------------------
  IMPORTANT SAFE-HYBRID OWNERSHIP:

  neo.js stays loaded, but we intercept ONLY the actual
  Add Files action at capture phase.

  This prevents the legacy hidden input from creating a
  second attachment state.

  Main "+" / attach popup can still be owned by legacy UI.
  -------------------------------------------------------
  */

  if (
    addFilesMenuBtn
  ) {
    addFilesMenuBtn.addEventListener(
      "click",
      event => {
        event.preventDefault();

        event.stopPropagation();

        event.stopImmediatePropagation();


        open();
      },
      true
    );
  }


  /* =====================================================
     CHIP ACTIONS
     ===================================================== */

  attachmentList.addEventListener(
    "click",
    event => {
      const button =
        event.target
          ?.closest
          ?.(
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


      const key =
        chip?.dataset
          ?.attachmentId;


      if (
        !key
      ) {
        return;
      }


      event.preventDefault();

      event.stopPropagation();

      event.stopImmediatePropagation();


      if (
        button.dataset
          .action ===
        "remove"
      ) {
        remove(
          key
        );

        return;
      }


      if (
        button.dataset
          .action ===
        "retry"
      ) {
        retry(
          key
        );
      }
    },
    true
  );


  /* =====================================================
     DRAG / DROP HELPERS
     ===================================================== */

  function dragHasFiles(
    event
  ) {
    return Array.from(
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
    if (
      !composer ||
      !(
        event.target instanceof
        Node
      )
    ) {
      return false;
    }


    return composer.contains(
      event.target
    );
  }


  function setDragging(
    active
  ) {
    state.dragging =
      Boolean(
        active
      );


    composer
      ?.classList
      ?.toggle(
        "is-file-dragging",
        state.dragging
      );


    dragDropOverlay
      ?.classList
      ?.toggle(
        "active",
        state.dragging
      );


    dragDropOverlay
      ?.setAttribute
      ?.(
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
        !dragHasFiles(
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
        !dragHasFiles(
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
        related instanceof
          Node &&
        composer
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
        !dragHasFiles(
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
     ===================================================== */

  document.addEventListener(
    "paste",
    async event => {
      const clipboardItems =
        Array.from(
          event
            .clipboardData
            ?.items ||
          []
        );


      const files =
        clipboardItems
          .filter(
            item =>
              item.kind ===
              "file"
          )
          .map(
            item =>
              item.getAsFile()
          )
          .filter(
            Boolean
          );


      /*
      Normal text paste remains untouched.
      */

      if (
        files.length ===
        0
      ) {
        return;
      }


      event.preventDefault();

      event.stopPropagation();

      event.stopImmediatePropagation();


      await addFiles(
        files
      );
    },
    true
  );


  /* =====================================================
     BRIDGE EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-open-request",
    () => {
      open();
    }
  );


  window.addEventListener(
    "neyo:attachments-clear-request",
    () => {
      clear();
    }
  );


  /*
  Optional precise cleanup from chat-runtime/send-state.
  */

  window.addEventListener(
    "neyo:attachments-remove-sent",
    event => {
      removeMany(
        event.detail
          ?.attachments ||
        []
      );
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

      legacyCompatible:
        true,

      /*
      Compatibility with older experiments.
      No browser Supabase client is required.
      */

      setSupabaseClient:
        () =>
          true,

      open,

      addFiles,

      remove,

      removeMany,

      retry,

      clear,

      getAll,

      getReady,

      hasPending,

      hasErrors,

      isApiReady:
        attachment => {
          if (
            !attachment ||
            typeof attachment !==
            "object"
          ) {
            return false;
          }


          return Boolean(
            attachment.ready ===
              true &&
            attachment.status ===
              "ready" &&
            typeof attachment.bucket ===
              "string" &&
            attachment.bucket.trim() &&
            typeof attachment.path ===
              "string" &&
            attachment.path.trim()
          );
        },

      getState:
        () => {
          const all =
            getAll();


          const ready =
            getReady();


          return {
            version:
              VERSION,

            active:
              true,

            count:
              all.length,

            ready:
              ready.length,

            pending:
              hasPending(),

            errors:
              all.filter(
                item =>
                  item.status ===
                  "error"
              ).length,

            totalSize:
              totalSize(),

            dragging:
              state.dragging,

            attachments:
              all
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
     INITIALIZE
     ===================================================== */

  attachmentList.hidden =
    true;


  syncComposer();

  emitState();


  emit(
    "neyo:attachments-ready",
    {
      version:
        VERSION,

      active:
        true
    }
  );


  debug(
    "PRODUCTION v2 READY",
    {
      version:
        VERSION,

      maxFiles:
        CFG.maxFiles,

      maxFileSize:
        formatBytes(
          CFG.maxFileSize
        ),

      canonicalList:
        attachmentList.id,

      privateInput:
        fileInput.id,

      addFilesCapture:
        Boolean(
          addFilesMenuBtn
        ),

      neoUntouched:
        true
    }
  );

})();
