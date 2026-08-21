/*
=========================================================
NEYO — UNIVERSAL ATTACHMENTS v3
FINAL ISOLATED ATTACHMENT CONTROLLER

Goals:
- Keep legacy neo.js untouched
- Preserve legacy attachment popup
- Use private file input
- Prevent old hiddenFileInput upload flow
- Signed upload architecture
- Processing pipeline
- Drag/drop
- Paste files
- Multiple files
- Image previews
- Retry/remove/clear
- Chat-ready normalized context
- Attachment-only messages support
- Legacy + new DOM compatibility
- No duplicate file ownership

Architecture:

Legacy + / popup UI
        ↓
addFilesMenuBtn
        ↓
private #neyoAttachmentInputV3
        ↓
attachments.js
        ↓
/api/attachments/upload
        ↓
Supabase signed upload
        ↓
/api/attachments/process
        ↓
normalized document/chunks
        ↓
window.NeyoAttachments
        ↓
chat.js

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION
     ===================================================== */

  const VERSION =
    "attachments-v3-final";


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
        120000,

      processTimeoutMs:
        180000,

      debug:
        true
    });


  /* =====================================================
     PREVENT DUPLICATE COMPONENT INITIALIZATION

     Useful when scripts accidentally load twice.
     ===================================================== */

  if (
    window.NeyoAttachments
      ?.version ===
    VERSION
  ) {

    console.warn(
      "[NEYO Attachments] Already initialized."
    );

    return;
  }


  /* =====================================================
     DOM
     ===================================================== */

  /*
  IMPORTANT:

  We DO NOT use legacy:
  #hiddenFileInput

  That input remains available to neo.js,
  but this system never fires its change event.
  */

  const newAttachmentBtn =
    document.getElementById(
      "attachmentBtn"
    );


  const legacyAttachBtn =
    document.getElementById(
      "attachBtn"
    );


  const addFilesMenuBtn =
    document.getElementById(
      "addFilesMenuBtn"
    );


  let attachmentList =
    document.getElementById(
      "attachmentList"
    ) ||
    document.getElementById(
      "attachedChipsWrapper"
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


  const dropZone =
    composerWrapper ||
    document.body;


  const legacyPopup =
    document.getElementById(
      "attachPopupMenu"
    );


  /* =====================================================
     PRIVATE INPUT

     Only this component owns this input.
     ===================================================== */

  let fileInput =
    document.getElementById(
      "neyoAttachmentInputV3"
    );


  if (!fileInput) {

    fileInput =
      document.createElement(
        "input"
      );


    fileInput.type =
      "file";


    fileInput.id =
      "neyoAttachmentInputV3";


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
     ATTACHMENT LIST FALLBACK
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


    if (
      composerWrapper
    ) {

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
     UTILS
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
        name ||
        ""
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

      return `${(
        value /
        1024
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
      value ||
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
      String(
        file?.type ||
        ""
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

    return ({
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
    })[
      category
    ] ||
    "file";
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


    if (
      !file.name?.trim()
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
          `${file.name} is empty.`
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
          `${file.name} is larger than ${formatBytes(
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
     DUPLICATE CHECK
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
     CREATE ITEM
     ===================================================== */

  function createItem(
    file
  ) {

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


      uploadId:
        null,

      bucket:
        null,

      path:
        null,

      signedToken:
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

      ready:
        false,


      previewUrl:
        null,

      createdAt:
        Date.now()
    };
  }


  /* =====================================================
     IMAGE PREVIEW
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
     STATUS
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

      case "error":
        return (
          item.error ||
          "Couldn't process"
        );

      default:
        return (
          item.status ||
          ""
        );
    }
  }


  /* =====================================================
     RENDER ITEM
     ===================================================== */

  function renderItem(
    item
  ) {

    if (
      !attachmentList
    ) {

      return;
    }


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


      attachmentList.appendChild(
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


    element.innerHTML = `
      ${visual}

      <div class="attachment-chip-body">

        <div class="attachment-chip-name">
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
              getStatusText(
                item
              )
            )}
          </span>

        </div>

        ${
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
            : ""
        }

      </div>

      ${
        item.status ===
        "error"
          ? `
            <button
              type="button"
              class="attachment-chip-retry"
              data-action="retry"
              aria-label="Retry ${escapeHtml(
                item.name
              )}"
            >
              <i
                data-lucide="refresh-cw"
                aria-hidden="true"
              ></i>
            </button>
          `
          : ""
      }

      <button
        type="button"
        class="attachment-chip-remove"
        data-action="remove"
        aria-label="Remove ${escapeHtml(
          item.name
        )}"
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


      if (item) {

        renderItem(
          item
        );
      }
    }


    attachmentList.hidden =
      state.items.size ===
      0;


    attachmentList.classList.toggle(
      "has-attachments",
      state.items.size >
      0
    );


    emitState();
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

      mime:
        item.mime,

      mimeType:
        item.mime,

      extension:
        item.extension,

      size:
        item.size,

      category:
        item.category,

      status:
        item.status,

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
     STATE EVENT
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

            /*
            New architecture
            */

            attachments,


            /*
            Legacy compatibility
            */

            files:
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
      !incoming.length
    ) {

      return;
    }


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


      renderItem(
        item
      );


      emitState();


      /*
      Run independently.

      One file failure must not break
      other attachment uploads.
      */

      void processPipeline(
        item.id
      );
    }


    renderAll();
  }


  /* =====================================================
     STEP 1
     CREATE SIGNED UPLOAD SESSION
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
        String(
          item.name
        ),

      size:
        Number(
          item.size
        ),

      mime:
        String(
          item.mime ||
          "application/octet-stream"
        ),

      category:
        String(
          item.category ||
          "unknown"
        ),

      clientAttachmentId:
        String(
          item.id ||
          ""
        )
    };


    /*
    Critical debugging checkpoint.

    This proves exactly what leaves
    the frontend.
    */

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
        `Upload authorization failed (${response.status})`
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
        "Upload ID missing."
      );
    }


    if (
      !data.bucket
    ) {

      throw new Error(
        "Storage bucket missing."
      );
    }


    if (
      !data.path
    ) {

      throw new Error(
        "Storage path missing."
      );
    }


    if (
      !data.token
    ) {

      throw new Error(
        "Signed upload token missing."
      );
    }


    if (
      !data.signedUrl
    ) {

      throw new Error(
        "Signed upload URL missing."
      );
    }


    return data;
  }


  /* =====================================================
     STEP 2
     SIGNED STORAGE UPLOAD
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
              "Signed upload URL missing."
            )
          );

          return;
        }


        const xhr =
          new XMLHttpRequest();


        /*
        Backend contract currently returns a
        direct signed upload URL.

        Keep method centralized here so if
        storage contract changes later,
        only this function changes.
        */

        const method =
          String(
            session?.method ||
            session?.uploadMethod ||
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


        xhr.setRequestHeader(
          "Content-Type",
          item.mime ||
          "application/octet-stream"
        );


        xhr.setRequestHeader(
          "Cache-Control",
          "no-store"
        );


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

              const result =
                JSON.parse(
                  xhr.responseText
                );


              message =
                result?.message ||
                result?.error ||
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

            reject(
              new Error(
                "Network error during storage upload."
              )
            );
          };


        xhr.onabort =
          () => {

            reject(
              new DOMException(
                "Upload aborted.",
                "AbortError"
              )
            );
          };


        xhr.ontimeout =
          () => {

            reject(
              new Error(
                "File upload timed out."
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
     STEP 3
     PROCESS FILE
     ===================================================== */

  async function requestProcessing(
    item
  ) {

    const controller =
      new AbortController();


    const timer =
      window.setTimeout(
        () => {

          controller.abort();

        },
        CONFIG.processTimeoutMs
      );


    try {

      const payload = {

        uploadId:
          item.uploadId,

        path:
          item.path,

        name:
          item.name,

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
          JSON.parse(
            raw
          );

      } catch {}


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
          `File processing failed (${response.status})`
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

      /* -------------------------------------------------
         AUTHORIZE
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


      item.signedToken =
        session.token;


      /* -------------------------------------------------
         UPLOAD
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


      item.status =
        "uploaded";


      renderItem(
        item
      );


      emitState();


      /* -------------------------------------------------
         PROCESS
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


      /* -------------------------------------------------
         ASYNC BACKEND JOB
         ------------------------------------------------- */

      if (
        processing.queued
      ) {

        item.status =
          "queued-processing";


        item.ready =
          false;


        item.stats =
          data.stats ||
          null;


        item.warnings =
          Array.isArray(
            data.warnings
          )
            ? data.warnings
            : [];


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


        debug(
          "Attachment processing queued:",
          item.name
        );


        /*
        IMPORTANT:

        We deliberately do not invent a polling
        API contract here.

        If process.js later returns 202,
        its real status endpoint can be connected
        to this event without corrupting this file.
        */


        return true;
      }


      /* -------------------------------------------------
         NORMALIZED RESULT
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


      item.stats =
        data.stats ||
        null;


      item.extraction =
        data.extraction ||
        null;


      item.warnings =
        Array.isArray(
          data.warnings
        )
          ? data.warnings
          : [];


      /*
      Successful process response means the
      attachment is available to chat.

      Some media files legitimately have no
      extracted text because api/chat will use
      Gemini multimodal fallback.
      */

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
        "Attachment ready",
        {
          name:
            item.name,

          category:
            item.category,

          path:
            item.path,

          documentId:
            item.documentId,

          chunks:
            item.chunks.length,

          parser:
            item.extraction
              ?.parser
        }
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


    item.uploadId =
      null;


    item.bucket =
      null;


    item.path =
      null;


    item.signedToken =
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


    item.ready =
      false;


    item.progress =
      0;


    item.error =
      null;


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
          item.status ===
            "ready" &&
          item.ready ===
            true
      )
      .map(
        item => ({

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
            item.warnings
        })
      );
  }


  function hasPending() {

    return getAll()
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

    return getAll()
      .some(
        item =>
          item.status ===
          "error"
      );
  }


  /* =====================================================
     OPEN FILE PICKER
     ===================================================== */

  function openPicker() {

    /*
    Reset first.

    Allows selecting same filename again.
    */

    fileInput.value =
      "";


    fileInput.click();
  }


  /* =====================================================
     NEW ATTACHMENT BUTTON

     New architecture button:
     direct file picker.
     ===================================================== */

  if (
    newAttachmentBtn
  ) {

    newAttachmentBtn
      .addEventListener(
        "click",
        event => {

          event.preventDefault();


          event.stopPropagation();


          event
            .stopImmediatePropagation();


          openPicker();

        },
        true
      );
  }


  /* =====================================================
     LEGACY ATTACH BUTTON

     CRITICAL:

     DO NOT intercept legacy #attachBtn.

     neo.js is allowed to open its existing popup.

     This preserves current UI.

     Actual Add Files menu action is intercepted below.
     ===================================================== */

  if (
    legacyAttachBtn
  ) {

    debug(
      "Legacy attach button preserved for popup UI."
    );
  }


  /* =====================================================
     ADD FILES MENU BUTTON

     This is where old hiddenFileInput would
     normally become involved.

     Capture phase intercepts ONLY this action.
     ===================================================== */

  if (
    addFilesMenuBtn
  ) {

    addFilesMenuBtn
      .addEventListener(
        "click",
        event => {

          event.preventDefault();


          event.stopPropagation();


          event
            .stopImmediatePropagation();


          openPicker();


          /*
          Close existing popup gracefully.
          Support common legacy active classes.
          */

          legacyPopup
            ?.classList
            .remove(
              "open",
              "active",
              "show",
              "visible"
            );


          legacyPopup
            ?.setAttribute(
              "aria-hidden",
              "true"
            );

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
        event.target
          ?.files;


      if (
        files?.length
      ) {

        await addFiles(
          files
        );
      }


      fileInput.value =
        "";
    }
  );


  /* =====================================================
     DRAG DROP — ISOLATED CAPTURE MODE

     neo.js may also own drag/drop.

     Capture-phase handlers only intercept when
     actual Files are present.
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

    if (
      !composerWrapper
    ) {

      return true;
    }


    const path =
      typeof event
        .composedPath ===
        "function"
        ? event.composedPath()
        : [];


    if (
      path.includes(
        composerWrapper
      )
    ) {

      return true;
    }


    return composerWrapper.contains(
      event.target
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


      event
        .stopImmediatePropagation();


      state.dragging =
        true;


      dropZone.classList.add(
        "is-file-dragging"
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


      event
        .stopImmediatePropagation();


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


      state.dragging =
        false;


      dropZone.classList.remove(
        "is-file-dragging"
      );


      const files =
        event.dataTransfer
          ?.files;


      if (
        files?.length
      ) {

        void addFiles(
          files
        );
      }

    },
    true
  );


  /*
  Drag leave doesn't need to block
  legacy logic aggressively.
  */

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

    },
    true
  );


  /* =====================================================
     PASTE FILES — ISOLATED CAPTURE MODE

     Normal text paste is untouched.

     Only intercept clipboard events containing files.
     ===================================================== */

  document.addEventListener(
    "paste",
    event => {

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
        !files.length
      ) {

        /*
        Normal text paste continues normally.
        */

        return;
      }


      /*
      Block legacy file-paste upload only.
      */

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

  attachmentList
    ?.addEventListener(
      "click",
      event => {

        const action =
          event.target
            ?.closest
            ?.(
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
     PUBLIC CLEAR REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-clear-request",
    () => {

      clearAttachments();
    }
  );


  /* =====================================================
     PUBLIC PICKER REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-open-request",
    () => {

      openPicker();
    }
  );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  window.NeyoAttachments =
    Object.freeze({

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
            state.items.size,

          ready:
            getReady().length,

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


  /* =====================================================
     INIT
     ===================================================== */

  attachmentList.hidden =
    state.items.size ===
    0;


  fileInput.multiple =
    true;


  fileInput.setAttribute(
    "accept",
    "*/*"
  );


  emitState();


  debug(
    "Universal attachments ready",
    {
      version:
        VERSION,

      privateInput:
        fileInput.id,

      maxFiles:
        CONFIG.maxFiles,

      maxFileSize:
        formatBytes(
          CONFIG.maxFileSize
        ),

      legacyPopup:
        Boolean(
          legacyPopup
        ),

      legacyAttachBtn:
        Boolean(
          legacyAttachBtn
        ),

      addFilesMenuBtn:
        Boolean(
          addFilesMenuBtn
        )
    }
  );

})();
