/*
=========================================================
NEYO — UNIVERSAL ATTACHMENTS
FINAL FRONTEND CONTROLLER v1

IMPORTANT OWNERSHIP RULES

1. neo.js remains untouched.
2. #attachBtn remains owned by legacy UI / neo.js.
   It may continue opening the existing attachment popup.
3. This controller intercepts ONLY #addFilesMenuBtn.
4. Legacy #hiddenFileInput is NEVER used by this controller.
5. A private file input is created:
      #neyoAttachmentInput
6. #sendBtn is NEVER modified here.
7. Attachment state is exposed through:
      window.NeyoAttachments
8. Chat integration happens through public state/events.
9. File drag/drop and file paste are intercepted in capture
   mode so legacy upload listeners do not duplicate uploads.
10. Normal text paste remains untouched.

PIPELINE

Select / Drop / Paste
        ↓
validate
        ↓
create attachment
        ↓
render chip
        ↓
POST /api/attachments/upload
        ↓
signed storage upload
        ↓
POST /api/attachments/process
        ↓
READY
        ↓
window.NeyoAttachments.getReady()

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION
     ===================================================== */

  const VERSION =
    "neyo-attachments-final-v1";


  /* =====================================================
     DUPLICATE SCRIPT PROTECTION
     ===================================================== */

  if (
    window.NeyoAttachments &&
    window.NeyoAttachments.__controller === true
  ) {
    console.warn(
      "[NEYO Attachments] Controller already initialized."
    );

    return;
  }


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG = Object.freeze({
    uploadEndpoint:
      "/api/attachments/upload",

    processEndpoint:
      "/api/attachments/process",

    maxFiles:
      10,

    maxFileSize:
      100 * 1024 * 1024,

    maxTotalSize:
      300 * 1024 * 1024,

    authorizationTimeout:
      30000,

    storageTimeout:
      120000,

    processingTimeout:
      180000,

    debug:
      true
  });


  /* =====================================================
     DOM
     ===================================================== */

  const composerWrapper =
    document.getElementById(
      "composerWrapper"
    );

  const glassInputContainer =
    document.getElementById(
      "glassInputContainer"
    );

  const legacyAttachButton =
    document.getElementById(
      "attachBtn"
    );

  const addFilesMenuButton =
    document.getElementById(
      "addFilesMenuBtn"
    );

  const attachmentPopup =
    document.getElementById(
      "attachPopupMenu"
    );

  const dragDropOverlay =
    document.getElementById(
      "dragDropOverlay"
    );

  let attachmentList =
    document.getElementById(
      "attachedChipsWrapper"
    ) ||
    document.getElementById(
      "attachmentList"
    );


  /* =====================================================
     ATTACHMENT LIST FALLBACK

     Existing UI container is preferred.
     We create one ONLY if somehow missing.
     ===================================================== */

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

    if (glassInputContainer) {
      glassInputContainer.prepend(
        attachmentList
      );
    } else if (composerWrapper) {
      composerWrapper.prepend(
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

     DO NOT USE:
       #hiddenFileInput

     That legacy element remains untouched for neo.js.
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

    fileInput.setAttribute(
      "accept",
      "*/*"
    );

    fileInput.setAttribute(
      "aria-hidden",
      "true"
    );

    document.body.appendChild(
      fileInput
    );
  }


  /* =====================================================
     INTERNAL STATE
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
     EXTENSION GROUPS
     ===================================================== */

  const EXTENSIONS = Object.freeze({
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
      "pages"
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
      "mpg",
      "wmv"
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
      "parquet",
      "feather",
      "arrow"
    ]),

    code: new Set([
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
     SMALL UTILS
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
      globalThis.crypto &&
      typeof globalThis.crypto.randomUUID ===
        "function"
    ) {
      return globalThis.crypto.randomUUID();
    }

    return (
      "att_" +
      Date.now() +
      "_" +
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
        name || ""
      );

    const index =
      value.lastIndexOf(
        "."
      );

    if (
      index === -1 ||
      index === value.length - 1
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
      ) || 0;

    if (value < 1024) {
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
      value || ""
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


  function normalizeFileName(
    name
  ) {
    return String(
      name || ""
    )
      .replace(
        /[\u0000-\u001F\u007F]/g,
        ""
      )
      .trim()
      .slice(
        0,
        220
      );
  }


  /* =====================================================
     CATEGORY
     ===================================================== */

  function getCategory(
    file
  ) {
    const mime =
      String(
        file?.type || ""
      ).toLowerCase();

    const extension =
      getExtension(
        file?.name
      );

    if (
      mime.startsWith(
        "image/"
      ) ||
      EXTENSIONS.image.has(
        extension
      )
    ) {
      return "image";
    }

    if (
      mime.startsWith(
        "audio/"
      ) ||
      EXTENSIONS.audio.has(
        extension
      )
    ) {
      return "audio";
    }

    if (
      mime.startsWith(
        "video/"
      ) ||
      EXTENSIONS.video.has(
        extension
      )
    ) {
      return "video";
    }

    if (
      mime ===
        "application/pdf" ||
      EXTENSIONS.document.has(
        extension
      )
    ) {
      return "document";
    }

    if (
      EXTENSIONS.spreadsheet.has(
        extension
      )
    ) {
      return "spreadsheet";
    }

    if (
      EXTENSIONS.presentation.has(
        extension
      )
    ) {
      return "presentation";
    }

    if (
      EXTENSIONS.archive.has(
        extension
      )
    ) {
      return "archive";
    }

    if (
      EXTENSIONS.code.has(
        extension
      )
    ) {
      return "code";
    }

    if (
      EXTENSIONS.data.has(
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


  /* =====================================================
     ICON
     ===================================================== */

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
      normalizeFileName(
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

    if (
      file.size <= 0
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
          `${name} is larger than ${formatBytes(
            CONFIG.maxFileSize
          )}.`
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
     DUPLICATE FILE CHECK
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
     CREATE ATTACHMENT ITEM
     ===================================================== */

  function createItem(
    file
  ) {
    const name =
      normalizeFileName(
        file.name
      );

    return {
      id:
        createId(),

      file,

      name,

      originalName:
        file.name,

      size:
        file.size,

      lastModified:
        file.lastModified,

      mime:
        file.type ||
        "application/octet-stream",

      extension:
        getExtension(
          name
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

      token:
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

      xhr:
        null,

      abortController:
        null,

      createdAt:
        Date.now()
    };
  }


  /* =====================================================
     PREVIEW
     ===================================================== */

  function createPreview(
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
     STATUS LABEL
     ===================================================== */

  function getStatusLabel(
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
        return `Uploading ${Math.round(
          item.progress
        )}%`;

      case "uploaded":
        return "Uploaded";

      case "processing":
        return "Reading file…";

      case "queued-processing":
        return "Processing…";

      case "ready":
        return "Ready";

      case "cancelled":
        return "Cancelled";

      case "error":
        return (
          item.error ||
          "Couldn't process"
        );

      default:
        return "";
    }
  }


  /* =====================================================
     SERIALIZATION

     Raw File object is intentionally NOT exposed.
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

      mime:
        item.mime,

      mimeType:
        item.mime,

      extension:
        item.extension,

      category:
        item.category,

      size:
        item.size,

      status:
        item.status,

      progress:
        item.progress,

      ready:
        item.ready,

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


  /* =====================================================
     EVENTS
     ===================================================== */

  function emitState() {
    const attachments =
      state.order
        .map(
          id =>
            state.items.get(
              id
            )
        )
        .filter(Boolean)
        .map(
          serializeItem
        );

    window.dispatchEvent(
      new CustomEvent(
        "neyo:attachments-change",
        {
          detail: {
            attachments,
            count:
              attachments.length
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


  function emitReady(
    item
  ) {
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
  }


  /* =====================================================
     RENDER
     ===================================================== */

  function renderItem(
    item
  ) {
    let chip =
      attachmentList.querySelector(
        `[data-attachment-id="${item.id}"]`
      );

    if (!chip) {
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

    chip.classList.toggle(
      "is-ready",
      item.status ===
        "ready"
    );

    chip.classList.toggle(
      "is-error",
      item.status ===
        "error"
    );

    chip.classList.toggle(
      "is-uploading",
      item.status ===
        "uploading"
    );

    const visual =
      item.previewUrl
        ? `
          <div class="attachment-chip-preview">
            <img
              src="${escapeHtml(
                item.previewUrl
              )}"
              alt=""
              draggable="false"
            >
          </div>
        `
        : `
          <div class="attachment-chip-icon">
            <i
              data-lucide="${getIcon(
                item.category
              )}"
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
            data-attachment-action="retry"
            aria-label="Retry ${escapeHtml(
              item.name
            )}"
            data-tooltip="Retry"
            data-tooltip-position="top"
          >
            <i
              data-lucide="refresh-cw"
              size="15"
            ></i>
          </button>
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

          <span
            aria-hidden="true"
            class="attachment-chip-meta-dot"
          >
            ·
          </span>

          <span class="attachment-chip-status">
            ${escapeHtml(
              getStatusLabel(
                item
              )
            )}
          </span>

        </div>

        ${progress}

      </div>

      ${retry}

      <button
        type="button"
        class="attachment-chip-remove"
        data-attachment-action="remove"
        aria-label="Remove ${escapeHtml(
          item.name
        )}"
        data-tooltip="Remove"
        data-tooltip-position="top"
      >
        <i
          data-lucide="x"
          size="15"
        ></i>
      </button>
    `;

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

      if (item) {
        renderItem(
          item
        );
      }
    }

    const hasAttachments =
      state.items.size >
      0;

    attachmentList.hidden =
      !hasAttachments;

    attachmentList.classList.toggle(
      "has-attachments",
      hasAttachments
    );

    glassInputContainer
      ?.classList
      .toggle(
        "has-attachments",
        hasAttachments
      );

    composerWrapper
      ?.classList
      .toggle(
        "has-attachments",
        hasAttachments
      );

    emitState();
  }


  /* =====================================================
     CLOSE LEGACY POPUP

     We do not assume only one legacy CSS class.
     ===================================================== */

  function closeAttachmentPopup() {
    if (!attachmentPopup) {
      return;
    }

    attachmentPopup.classList.remove(
      "open",
      "active",
      "show",
      "visible"
    );

    attachmentPopup.setAttribute(
      "aria-hidden",
      "true"
    );

    legacyAttachButton
      ?.setAttribute(
        "aria-expanded",
        "false"
      );
  }


  /* =====================================================
     PRIVATE PICKER
     ===================================================== */

  function openPicker() {
    fileInput.value =
      "";

    fileInput.click();
  }


  /* =====================================================
     JSON FETCH HELPER
     ===================================================== */

  async function fetchJson(
    url,
    options,
    timeout
  ) {
    const controller =
      new AbortController();

    const timer =
      window.setTimeout(
        () => {
          controller.abort();
        },
        timeout
      );

    try {
      const response =
        await fetch(
          url,
          {
            ...options,
            signal:
              controller.signal
          }
        );

      const raw =
        await response.text();

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
        response,
        data,
        raw
      };
    } finally {
      window.clearTimeout(
        timer
      );
    }
  }


  /* =====================================================
     STEP 1 — AUTHORIZE UPLOAD
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
      "UPLOAD_SESSION_REQUEST",
      payload
    );

    const {
      response,
      data,
      raw
    } =
      await fetchJson(
        CONFIG.uploadEndpoint,
        {
          method:
            "POST",

          credentials:
            "same-origin",

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
        },
        CONFIG.authorizationTimeout
      );

    debug(
      "UPLOAD_SESSION_RESPONSE",
      {
        status:
          response.status,

        data
      }
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
        "Invalid upload authorization response."
      );
    }

    if (!data.uploadId) {
      throw new Error(
        "Upload ID missing."
      );
    }

    if (!data.bucket) {
      throw new Error(
        "Storage bucket missing."
      );
    }

    if (!data.path) {
      throw new Error(
        "Storage path missing."
      );
    }

    if (
      !data.signedUrl &&
      !data.url
    ) {
      throw new Error(
        "Signed upload URL missing."
      );
    }

    return {
      ...data,

      signedUrl:
        data.signedUrl ||
        data.url
    };
  }


  /* =====================================================
     STEP 2 — STORAGE UPLOAD

     Backend should preferably return:
       method: "PUT" / "POST"

     For compatibility with the current contract,
     PUT remains fallback.

     If backend contract changes later, only backend
     should return the correct method; no UI code changes.
     ===================================================== */

  function uploadFile(
    item,
    session
  ) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        const url =
          String(
            session.signedUrl ||
            ""
          );

        if (!url) {
          reject(
            new Error(
              "Signed upload URL missing."
            )
          );

          return;
        }

        const xhr =
          new XMLHttpRequest();

        item.xhr =
          xhr;

        const method =
          String(
            session.method ||
            session.uploadMethod ||
            "PUT"
          )
            .trim()
            .toUpperCase();

        xhr.open(
          method,
          url,
          true
        );

        xhr.timeout =
          CONFIG.storageTimeout;

        /*
        Backend may return additional required
        headers for the signed upload.
        */

        const sessionHeaders =
          session.headers &&
          typeof session.headers ===
            "object"
            ? session.headers
            : {};

        for (
          const [
            key,
            value
          ]
          of Object.entries(
            sessionHeaders
          )
        ) {
          if (
            value === null ||
            value === undefined
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

        if (
          !Object.keys(
            sessionHeaders
          ).some(
            key =>
              key.toLowerCase() ===
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
            item.xhr =
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
              const parsed =
                JSON.parse(
                  xhr.responseText
                );

              message =
                parsed?.error ||
                parsed?.message ||
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
            item.xhr =
              null;

            reject(
              new Error(
                "Network error during file upload."
              )
            );
          };

        xhr.ontimeout =
          () => {
            item.xhr =
              null;

            reject(
              new Error(
                "File upload timed out."
              )
            );
          };

        xhr.onabort =
          () => {
            item.xhr =
              null;

            reject(
              new DOMException(
                "Upload cancelled.",
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
     STEP 3 — PROCESS
     ===================================================== */

  async function processFile(
    item
  ) {
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

    const {
      response,
      data,
      raw
    } =
      await fetchJson(
        CONFIG.processEndpoint,
        {
          method:
            "POST",

          credentials:
            "same-origin",

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
        },
        CONFIG.processingTimeout
      );

    debug(
      "PROCESS_RESPONSE",
      {
        status:
          response.status,

        data
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
          data || {}
      };
    }

    if (!response.ok) {
      throw new Error(
        data?.error ||
        data?.message ||
        raw ||
        `Attachment processing failed (${response.status}).`
      );
    }

    return {
      queued:
        false,

      data:
        data || {}
    };
  }


  /* =====================================================
     FULL PIPELINE
     ===================================================== */

  async function runPipeline(
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
      /* -----------------------------------------------
         AUTHORIZE
         ----------------------------------------------- */

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

      item.token =
        session.token ||
        null;


      /* -----------------------------------------------
         STORAGE
         ----------------------------------------------- */

      item.status =
        "uploading";

      renderItem(
        item
      );

      emitState();

      await uploadFile(
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
        await processFile(
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

        window.dispatchEvent(
          new CustomEvent(
            "neyo:attachment-processing-queued",
            {
              detail: {
                attachment:
                  serializeItem(
                    item
                  ),

                response:
                  data
              }
            }
          )
        );

        return true;
      }


      /* -----------------------------------------------
         READY
         ----------------------------------------------- */

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

      item.stats =
        data.stats ||
        item.stats;

      item.warnings =
        Array.isArray(
          data.warnings
        )
          ? data.warnings
          : item.warnings;

      item.status =
        "ready";

      item.ready =
        true;

      item.error =
        null;

      renderItem(
        item
      );

      emitState();

      emitReady(
        item
      );

      debug(
        "READY",
        {
          name:
            item.name,

          category:
            item.category,

          path:
            item.path,

          chunks:
            item.chunks.length
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

      if (
        error?.name ===
        "AbortError"
      ) {
        item.status =
          "cancelled";

        item.error =
          null;
      } else {
        item.status =
          "error";

        item.error =
          error?.message ||
          "Couldn't process this attachment.";
      }

      item.ready =
        false;

      item.progress =
        0;

      renderItem(
        item
      );

      emitState();

      if (
        item.status ===
        "error"
      ) {
        emitError(
          item.error,
          item
        );
      }

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
        createPreview(
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
      Every file has an independent pipeline.
      Failure of one attachment does not stop others.
      */

      void runPipeline(
        item.id
      );
    }

    renderAll();

    return added;
  }


  /* =====================================================
     ABORT
     ===================================================== */

  function abortAttachment(
    item
  ) {
    try {
      item.xhr?.abort();
    } catch {}

    try {
      item.abortController
        ?.abort();
    } catch {}

    item.xhr =
      null;

    item.abortController =
      null;
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

    abortAttachment(
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
        value =>
          value !== id
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

            path:
              item.path
          }
        }
      )
    );

    return true;
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

    if (!item) {
      return false;
    }

    abortAttachment(
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

    item.error =
      null;

    item.progress =
      0;

    item.ready =
      false;

    item.status =
      "queued";

    renderItem(
      item
    );

    emitState();

    void runPipeline(
      id
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

    attachmentList.innerHTML =
      "";

    attachmentList.hidden =
      true;

    emitState();
  }


  /* =====================================================
     GETTERS
     ===================================================== */

  function getAll() {
    return state.order
      .map(
        id =>
          state.items.get(
            id
          )
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


  function hasPending() {
    return state.order.some(
      id => {
        const item =
          state.items.get(
            id
          );

        if (!item) {
          return false;
        }

        return [
          "queued",
          "authorizing",
          "uploading",
          "uploaded",
          "processing",
          "queued-processing"
        ].includes(
          item.status
        );
      }
    );
  }


  function hasErrors() {
    return state.order.some(
      id =>
        state.items.get(
          id
        )?.status ===
        "error"
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
            "[data-attachment-action]"
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

      const action =
        button.dataset
          .attachmentAction;

      if (
        action ===
        "remove"
      ) {
        removeAttachment(
          id
        );

        return;
      }

      if (
        action ===
        "retry"
      ) {
        retryAttachment(
          id
        );
      }
    }
  );


  /* =====================================================
     LEGACY + BUTTON

     DO NOT hijack this.

     Existing neo.js remains responsible for opening
     the attachment popup.

     This is intentional.
     ===================================================== */

  if (
    legacyAttachButton
  ) {
    debug(
      "Legacy #attachBtn preserved."
    );
  }


  /* =====================================================
     ADD FILES POPUP ACTION

     Capture phase is intentional.

     It prevents legacy handler from forwarding
     the click into #hiddenFileInput.
     ===================================================== */

  if (
    addFilesMenuButton
  ) {
    addFilesMenuButton.addEventListener(
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


  /* =====================================================
     PRIVATE INPUT CHANGE
     ===================================================== */

  fileInput.addEventListener(
    "change",
    event => {
      /*
      Copy FileList before clearing input.
      */

      const selectedFiles =
        Array.from(
          event.target
            ?.files ||
          []
        );

      /*
      Reset immediately so same file can be
      selected again after removing it.
      */

      fileInput.value =
        "";

      if (
        selectedFiles.length ===
        0
      ) {
        return;
      }

      void addFiles(
        selectedFiles
      );
    }
  );


  /* =====================================================
     DRAG / DROP HELPERS
     ===================================================== */

  function dragEventHasFiles(
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


  function dragBelongsToComposer(
    event
  ) {
    if (
      !composerWrapper
    ) {
      return true;
    }

    if (
      typeof event.composedPath ===
      "function"
    ) {
      return event
        .composedPath()
        .includes(
          composerWrapper
        );
    }

    return composerWrapper.contains(
      event.target
    );
  }


  function setDragging(
    dragging
  ) {
    state.dragging =
      Boolean(
        dragging
      );

    composerWrapper
      ?.classList
      .toggle(
        "is-file-dragging",
        state.dragging
      );

    glassInputContainer
      ?.classList
      .toggle(
        "is-file-dragging",
        state.dragging
      );

    if (
      dragDropOverlay
    ) {
      dragDropOverlay.classList.toggle(
        "active",
        state.dragging
      );

      dragDropOverlay.setAttribute(
        "aria-hidden",
        String(
          !state.dragging
        )
      );
    }
  }


  /* =====================================================
     DRAG ENTER
     ===================================================== */

  document.addEventListener(
    "dragenter",
    event => {
      if (
        !dragEventHasFiles(
          event
        )
      ) {
        return;
      }

      if (
        !dragBelongsToComposer(
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
        !dragEventHasFiles(
          event
        )
      ) {
        return;
      }

      if (
        !dragBelongsToComposer(
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
     DROP
     ===================================================== */

  document.addEventListener(
    "drop",
    event => {
      if (
        !dragEventHasFiles(
          event
        )
      ) {
        return;
      }

      if (
        !dragBelongsToComposer(
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

      setDragging(
        false
      );
    },
    true
  );


  /* =====================================================
     PASTE

     Only file clipboard items are intercepted.

     Normal:
       Ctrl+V text
       copied text
       URLs
       rich text

     remain completely untouched.
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
        of Array.from(
          clipboard.items ||
          []
        )
      ) {
        if (
          clipboardItem.kind !==
          "file"
        ) {
          continue;
        }

        const file =
          clipboardItem.getAsFile();

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

      event.stopImmediatePropagation();

      void addFiles(
        files
      );
    },
    true
  );


  /* =====================================================
     PUBLIC EVENT REQUESTS
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-open-request",
    () => {
      openPicker();
    }
  );


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

      hasPending,

      hasErrors,

      getState:
        () => {
          const all =
            getAll();

          return {
            version:
              VERSION,

            count:
              all.length,

            readyCount:
              all.filter(
                item =>
                  item.ready
              ).length,

            errorCount:
              all.filter(
                item =>
                  item.status ===
                  "error"
              ).length,

            pending:
              hasPending(),

            totalSize:
              getTotalSize(),

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
     INITIAL UI STATE
     ===================================================== */

  attachmentList.hidden =
    true;

  attachmentList.classList.remove(
    "has-attachments"
  );

  setDragging(
    false
  );

  fileInput.multiple =
    true;

  fileInput.setAttribute(
    "accept",
    "*/*"
  );

  emitState();


  /* =====================================================
     READY LOG
     ===================================================== */

  debug(
    "FINAL CONTROLLER READY",
    {
      version:
        VERSION,

      privateInput:
        fileInput.id,

      legacyInputUntouched:
        Boolean(
          document.getElementById(
            "hiddenFileInput"
          )
        ),

      legacyAttachButton:
        Boolean(
          legacyAttachButton
        ),

      addFilesMenuButton:
        Boolean(
          addFilesMenuButton
        ),

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
