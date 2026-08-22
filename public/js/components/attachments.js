/*
=========================================================
NEYO — ATTACHMENTS
FINAL CLEAN v1

FILE:
public/js/components/attachments.js

OWNS
---------------------------------------------------------
- Private file input
- Add Files menu item
- Local validation
- File classification
- Image preview URLs
- Drag/drop
- Clipboard file paste
- Upload authorization
- Direct signed upload
- Processing request
- Retry / remove / clear
- Attachment chips
- Attachment state/events

DOES NOT OWN
---------------------------------------------------------
- #attachBtn popup launcher
- Send button
- Enter key
- /api/chat
- Conversation state
- Message rendering
- History

FLOW
---------------------------------------------------------
selected
→ authorizing
→ uploading
→ processing
→ ready

Failure
→ error
→ retry/remove

IMPORTANT
---------------------------------------------------------
- neo.js still owns #attachBtn
- only READY attachments are exposed by getReady()
- failed/pending attachments never become chat-ready
- removing a file aborts its active work
- stale async pipelines cannot overwrite a retried item
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-attachments-final-clean-v1";


  if (
    window.NeyoAttachments?.__controller ===
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

  const CONFIG =
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
        false
    });


  /* =====================================================
     STATUS
     ===================================================== */

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
     DOM
     ===================================================== */

  const addFilesMenuBtn =
    document.getElementById(
      "addFilesMenuBtn"
    );


  const attachPopupMenu =
    document.getElementById(
      "attachPopupMenu"
    );


  const attachBtn =
    document.getElementById(
      "attachBtn"
    );


  const composerWrapper =
    document.getElementById(
      "composerWrapper"
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


    fileInput.id =
      "neyoAttachmentInput";


    fileInput.type =
      "file";


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

  const state =
    {
      items:
        new Map(),

      order:
        [],

      dragging:
        false
    };


  /* =====================================================
     SUPPORTED EXTENSIONS
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
          "aiff",
          "webm"
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
     ALLOWED STORAGE MIME TYPES
     ===================================================== */

  const STORAGE_MIME_TYPES =
    new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/svg+xml",

      "application/pdf",

      "text/plain",
      "text/html",
      "text/css",
      "text/javascript",
      "text/csv",
      "text/markdown",
      "text/xml",

      "application/javascript",
      "application/json",
      "application/xml",

      "application/zip",
      "application/gzip",

      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",

      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.ms-powerpoint",

      "audio/mpeg",
      "audio/wav",
      "audio/webm",
      "audio/ogg",

      "video/mp4",
      "video/webm",

      "application/octet-stream"
    ]);


  /* =====================================================
     BASIC HELPERS
     ===================================================== */

  function debug(
    ...args
  ) {
    if (
      CONFIG.debug
    ) {
      console.log(
        "[NEYO Attachments]",
        ...args
      );
    }
  }


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


  function cleanString(
    value
  ) {
    return String(
      value ??
      ""
    ).trim();
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
        Number(
          value
        ) || 0
      )
    );
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


  function getCategory(
    extension
  ) {
    const ext =
      cleanString(
        extension
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


  function normalizeMime(
    file
  ) {
    const mime =
      cleanString(
        file?.type
      )
        .toLowerCase();


    if (
      STORAGE_MIME_TYPES.has(
        mime
      )
    ) {
      return mime;
    }


    return "application/octet-stream";
  }


  function formatBytes(
    bytes
  ) {
    const value =
      Math.max(
        0,
        Number(
          bytes
        ) || 0
      );


    if (
      value < 1024
    ) {
      return `${value} B`;
    }


    if (
      value <
      1024 * 1024
    ) {
      return `${
        (
          value /
          1024
        ).toFixed(1)
      } KB`;
    }


    if (
      value <
      1024 *
      1024 *
      1024
    ) {
      return `${
        (
          value /
          (
            1024 *
            1024
          )
        ).toFixed(1)
      } MB`;
    }


    return `${
      (
        value /
        (
          1024 *
          1024 *
          1024
        )
      ).toFixed(2)
    } GB`;
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
        return "table-2";

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
          item.progress
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


  /* =====================================================
     STATE HELPERS
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

      runId:
        0,

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

      uploadController:
        null,

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
     SERIALIZATION
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
            "ready" &&
          Boolean(
            item.path
          )
      )
      .map(
        serializeItem
      );
  }


  function hasPending() {
    return state.order
      .some(
        id => {
          const item =
            state.items.get(
              id
            );


          return Boolean(
            item &&
            PENDING_STATUSES.has(
              item.status
            )
          );
        }
      );
  }


  function hasErrors() {
    return state.order
      .some(
        id =>
          state.items
            .get(
              id
            )
            ?.status ===
          "error"
      );
  }


  /* =====================================================
     STATE EVENT
     ===================================================== */

  function emitState() {
    emit(
      "neyo:attachments-change",
      {
        count:
          state.items.size,

        ready:
          getReady()
            .length,

        errors:
          getAll()
            .filter(
              item =>
                item.status ===
                "error"
            )
            .length,

        pending:
          hasPending(),

        totalSize:
          getTotalSize(),

        attachments:
          getAll()
      }
    );
  }


  /* =====================================================
     COMPOSER CLASS
     ===================================================== */

  function syncComposerClass() {
    const active =
      state.items.size >
      0;


    composerWrapper
      ?.classList
      .toggle(
        "has-attachments",
        active
      );


    glassInputContainer
      ?.classList
      .toggle(
        "has-attachments",
        active
      );


    attachmentList.hidden =
      !active;
  }


  /* =====================================================
     CHIP DOM HELPERS
     ===================================================== */

  function createIconElement(
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
      String(
        size
      )
    );


    return icon;
  }


  function createPreviewElement(
    item
  ) {
    if (
      item.previewUrl
    ) {
      const wrapper =
        document.createElement(
          "div"
        );


      wrapper.className =
        "attachment-chip-preview";


      const image =
        document.createElement(
          "img"
        );


      image.src =
        item.previewUrl;


      image.alt =
        "";


      wrapper.appendChild(
        image
      );


      return wrapper;
    }


    const wrapper =
      document.createElement(
        "div"
      );


    wrapper.className =
      "attachment-chip-icon";


    wrapper.appendChild(
      createIconElement(
        getIcon(
          item.category
        )
      )
    );


    return wrapper;
  }


  /* =====================================================
     RENDER ITEM
     ===================================================== */

  function renderItem(
    item
  ) {
    let chip =
      attachmentList
        .querySelector(
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


    chip.replaceChildren();


    chip.appendChild(
      createPreviewElement(
        item
      )
    );


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


    const separator =
      document.createElement(
        "span"
      );


    separator.textContent =
      "·";


    separator.setAttribute(
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
      status.textContent;


    meta.append(
      size,
      separator,
      status
    );


    body.append(
      name,
      meta
    );


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
        createIconElement(
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
        createIconElement(
          "x",
          14
        )
      );
    }


    chip.appendChild(
      action
    );


    try {
      window.lucide
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
        element => {
          if (
            !validIds.has(
              element.dataset
                .attachmentId
            )
          ) {
            element.remove();
          }
        }
      );


    syncComposerClass();


    emitState();
  }


  /* =====================================================
     ERROR
     ===================================================== */

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
     PICKER
     ===================================================== */

  function openPicker() {
    try {
      fileInput.click();

      return true;

    } catch (
      error
    ) {
      emitError(
        error?.message ||
        "Could not open file picker."
      );


      return false;
    }
  }


  function closeLegacyPopup() {
    if (
      !attachPopupMenu
    ) {
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
     HTTP
     ===================================================== */

  async function readResponse(
    response
  ) {
    const raw =
      await response.text();


    let data =
      null;


    if (
      raw
    ) {
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


  function getServerError(
    response,
    data,
    raw,
    fallback
  ) {
    return cleanString(
      data?.message ||
      data?.error ||
      data?.error_description ||
      raw
    ) ||
    `${fallback} (${response.status}).`;
  }


  /* =====================================================
     UPLOAD SESSION
     ===================================================== */

  async function createUploadSession(
    item,
    signal
  ) {
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


    const response =
      await fetch(
        CONFIG.uploadEndpoint,
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

          signal
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
      !response.ok
    ) {
      throw new Error(
        getServerError(
          response,
          data,
          raw,
          "Upload authorization failed"
        )
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


    for (
      const field
      of [
        "uploadId",
        "bucket",
        "path",
        "token",
        "signedUrl"
      ]
    ) {
      if (
        !data[field]
      ) {
        throw new Error(
          `Upload response is missing ${field}.`
        );
      }
    }


    return data;
  }


  /* =====================================================
     DIRECT SIGNED UPLOAD
     ===================================================== */

  async function uploadToSignedUrl(
    item,
    session,
    signal
  ) {
    if (
      !(item.file instanceof File)
    ) {
      throw new Error(
        "Attachment file is unavailable."
      );
    }


    const form =
      new FormData();


    form.append(
      "cacheControl",
      CONFIG.cacheControl
    );


    /*
    -------------------------------------------------------
    Preserve proven signed-upload body used by the
    existing backend/Supabase flow.

    Do NOT manually set Content-Type.
    Browser creates multipart boundary.
    -------------------------------------------------------
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

          signal
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
      !response.ok
    ) {
      throw new Error(
        getServerError(
          response,
          data,
          raw,
          "Storage upload failed"
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
  }


  /* =====================================================
     PROCESSING
     ===================================================== */

  async function requestProcessing(
    item,
    signal
  ) {
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

          signal
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
          data ||
          {}
      };
    }


    if (
      !response.ok
    ) {
      throw new Error(
        getServerError(
          response,
          data,
          raw,
          "File processing failed"
        )
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
     TIMEOUT CONTROLLER
     ===================================================== */

  function createTimedController(
    timeoutMs
  ) {
    const controller =
      new AbortController();


    const timeoutId =
      window.setTimeout(
        () => {
          try {
            controller.abort();

          } catch {}
        },
        timeoutMs
      );


    return {
      controller,

      clear() {
        window.clearTimeout(
          timeoutId
        );
      }
    };
  }


  /* =====================================================
     PIPELINE
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


    /*
    -------------------------------------------------------
    Every run gets a unique number.

    Retry increments it.

    Old/stale async results are ignored.
    -------------------------------------------------------
    */

    const runId =
      ++item.runId;


    const stillCurrent =
      () =>
        state.items.get(
          id
        ) ===
          item &&
        item.runId ===
          runId;


    try {
      /* =================================================
         AUTHORIZE
         ================================================= */

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


      const uploadAuth =
        createTimedController(
          CONFIG.uploadTimeoutMs
        );


      item.uploadController =
        uploadAuth.controller;


      let session;


      try {
        session =
          await createUploadSession(
            item,
            uploadAuth.controller.signal
          );

      } finally {
        uploadAuth.clear();


        if (
          item.uploadController ===
          uploadAuth.controller
        ) {
          item.uploadController =
            null;
        }
      }


      if (
        !stillCurrent()
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


      /* =================================================
         UPLOAD
         ================================================= */

      item.status =
        "uploading";


      renderItem(
        item
      );


      emitState();


      const upload =
        createTimedController(
          CONFIG.uploadTimeoutMs
        );


      item.uploadController =
        upload.controller;


      try {
        await uploadToSignedUrl(
          item,
          session,
          upload.controller.signal
        );

      } finally {
        upload.clear();


        if (
          item.uploadController ===
          upload.controller
        ) {
          item.uploadController =
            null;
        }
      }


      if (
        !stillCurrent()
      ) {
        return false;
      }


      /* =================================================
         PROCESS
         ================================================= */

      item.status =
        "processing";


      renderItem(
        item
      );


      emitState();


      const processing =
        createTimedController(
          CONFIG.processTimeoutMs
        );


      item.processController =
        processing.controller;


      let result;


      try {
        result =
          await requestProcessing(
            item,
            processing.controller.signal
          );

      } finally {
        processing.clear();


        if (
          item.processController ===
          processing.controller
        ) {
          item.processController =
            null;
        }
      }


      if (
        !stillCurrent()
      ) {
        return false;
      }


      const data =
        result.data ||
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


      /* =================================================
         ASYNC PROCESSING
         ================================================= */

      if (
        result.queued
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


      /* =================================================
         READY VALIDATION
         ================================================= */

      if (
        data.ready ===
        false
      ) {
        throw new Error(
          cleanString(
            data.message ||
            data.error
          ) ||
          "The file was processed but is not ready."
        );
      }


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


      item.progress =
        100;


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
        item.name
      );


      return true;

    } catch (
      error
    ) {
      if (
        !stillCurrent()
      ) {
        return false;
      }


      /*
      -------------------------------------------------------
      Removal aborts requests and deletes item.
      That case never becomes an error chip.
      -------------------------------------------------------
      */

      if (
        error?.name ===
          "AbortError" &&
        !state.items.has(
          id
        )
      ) {
        return false;
      }


      item.uploadController =
        null;


      item.processController =
        null;


      item.status =
        "error";


      item.ready =
        false;


      item.progress =
        0;


      item.error =
        error?.name ===
          "AbortError"
          ? "Operation timed out."
          : cleanString(
              error?.message
            ) ||
            "Couldn't process this file.";


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
        state.items.size >=
        CONFIG.maxFiles
      ) {
        emitError(
          `Maximum ${CONFIG.maxFiles} attachments are allowed.`
        );


        break;
      }


      if (
        isDuplicate(
          file
        )
      ) {
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


      syncComposerClass();


      emitState();


      void processPipeline(
        item.id
      );
    }


    return added;
  }


  /* =====================================================
     ABORT ITEM
     ===================================================== */

  function abortItem(
    item
  ) {
    /*
    -------------------------------------------------------
    Increment runId BEFORE aborting.

    Any old promise is now stale even if abort arrives late.
    -------------------------------------------------------
    */

    item.runId +=
      1;


    try {
      item.uploadController
        ?.abort();

    } catch {}


    try {
      item.processController
        ?.abort();

    } catch {}


    item.uploadController =
      null;


    item.processController =
      null;
  }


  /* =====================================================
     RETRY
     ===================================================== */

  function retry(
    id
  ) {
    const item =
      state.items.get(
        id
      );


    if (
      !item ||
      item.status !==
        "error"
    ) {
      return false;
    }


    abortItem(
      item
    );


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

  function remove(
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


    abortItem(
      item
    );


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
        currentId =>
          currentId !==
          id
      );


    attachmentList
      .querySelector(
        `[data-attachment-id="${CSS.escape(
          id
        )}"]`
      )
      ?.remove();


    syncComposerClass();


    emitState();


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

  function clear() {
    const removed =
      state.order
        .map(
          id =>
            state.items.get(
              id
            )
        )
        .filter(
          Boolean
        );


    /*
    -------------------------------------------------------
    Batch clear:
    no repeated render/state event for every item.
    -------------------------------------------------------
    */

    removed.forEach(
      item => {
        abortItem(
          item
        );


        if (
          item.previewUrl
        ) {
          try {
            URL.revokeObjectURL(
              item.previewUrl
            );

          } catch {}
        }
      }
    );


    state.items.clear();


    state.order =
      [];


    attachmentList
      .replaceChildren();


    syncComposerClass();


    emitState();


    emit(
      "neyo:attachments-cleared",
      {
        count:
          removed.length
      }
    );


    return true;
  }


  /* =====================================================
     FILE INPUT
     ===================================================== */

  fileInput.addEventListener(
    "change",
    async event => {
      const selected =
        Array.from(
          event.target
            ?.files ||
          []
        );


      /*
      Same file can be selected again after removal.
      */

      fileInput.value =
        "";


      if (
        selected.length >
        0
      ) {
        await addFiles(
          selected
        );
      }
    }
  );


  /* =====================================================
     ADD FILES MENU BUTTON
     ===================================================== */

  addFilesMenuBtn
    ?.addEventListener(
      "click",
      event => {
        event.preventDefault();


        closeLegacyPopup();


        openPicker();
      }
    );


  /* =====================================================
     EXTERNAL OPEN
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-open-request",
    openPicker
  );


  /* =====================================================
     DRAG / DROP
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


  function eventInsideComposer(
    event
  ) {
    const target =
      event.target;


    return Boolean(
      target instanceof Node &&
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
        !eventInsideComposer(
          event
        )
      ) {
        return;
      }


      event.preventDefault();


      setDragging(
        true
      );
    }
  );


  document.addEventListener(
    "dragover",
    event => {
      if (
        !eventHasFiles(
          event
        ) ||
        !eventInsideComposer(
          event
        )
      ) {
        return;
      }


      event.preventDefault();


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
    }
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
    }
  );


  document.addEventListener(
    "drop",
    async event => {
      if (
        !eventHasFiles(
          event
        ) ||
        !eventInsideComposer(
          event
        )
      ) {
        return;
      }


      event.preventDefault();


      setDragging(
        false
      );


      const dropped =
        Array.from(
          event.dataTransfer
            ?.files ||
          []
        );


      if (
        dropped.length >
        0
      ) {
        await addFiles(
          dropped
        );
      }
    }
  );


  /* =====================================================
     PASTE FILES
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
        const entry
        of clipboard.items
      ) {
        if (
          entry.kind !==
          "file"
        ) {
          continue;
        }


        const file =
          entry.getAsFile();


        if (
          file
        ) {
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


      /*
      -------------------------------------------------------
      Only prevent default when a real file was pasted.

      Normal text paste remains untouched.
      -------------------------------------------------------
      */

      event.preventDefault();


      await addFiles(
        files
      );
    }
  );


  /* =====================================================
     CHIP ACTIONS
     ===================================================== */

  attachmentList
    .addEventListener(
      "click",
      event => {
        const button =
          event.target
            ?.closest?.(
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
          button.dataset.action ===
          "remove"
        ) {
          remove(
            id
          );


          return;
        }


        if (
          button.dataset.action ===
          "retry"
        ) {
          retry(
            id
          );
        }
      }
    );


  /* =====================================================
     EXTERNAL CLEAR
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-clear-request",
    clear
  );


  /* =====================================================
     PAGE CLEANUP
     ===================================================== */

  window.addEventListener(
    "pagehide",
    () => {
      for (
        const item
        of state.items.values()
      ) {
        abortItem(
          item
        );


        if (
          item.previewUrl
        ) {
          try {
            URL.revokeObjectURL(
              item.previewUrl
            );

          } catch {}
        }
      }
    },
    {
      once:
        true
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

      remove,

      retry,

      clear,

      getAll,

      getReady,

      hasPending,

      hasErrors,

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

          pending:
            hasPending(),

          errors:
            hasErrors(),

          attachments:
            getAll()
        }),

      /*
      -------------------------------------------------------
      Temporary legacy compatibility.
      No browser Supabase client is required.
      -------------------------------------------------------
      */

      setSupabaseClient:
        () =>
          true
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

})();
