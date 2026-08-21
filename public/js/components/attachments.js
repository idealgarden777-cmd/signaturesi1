/*
=========================================================
NEYO — UNIVERSAL ATTACHMENTS v2
SIGNED UPLOAD + PROCESSING

Flow:
1. Select / drop / paste file
2. Validate
3. POST metadata → /api/attachments/upload
4. Receive signed upload token/path
5. Upload file directly to Supabase Storage
6. POST → /api/attachments/process
7. Receive normalized document + chunks + stats
8. Mark attachment ready
9. Expose ready context to chat.js

Supports:
- documents
- spreadsheets
- presentations
- code
- text/data
- images
- audio
- video
- archives
- unknown safe files

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     DOM
     ===================================================== */

  const fileInput =
    document.getElementById(
      "attachmentInput"
    );

  const attachmentBtn =
    document.getElementById(
      "attachmentBtn"
    );

  const attachmentList =
    document.getElementById(
      "attachmentList"
    );

  const dropZone =
    document.getElementById(
      "composer"
    ) ||
    document.querySelector(
      ".composer"
    ) ||
    document.body;


  if (
    !fileInput ||
    !attachmentList
  ) {

    console.warn(
      "[NEYO Attachments] Required DOM missing."
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
        120000,

      processTimeoutMs:
        180000,

      debug:
        true
    });


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
     EXTENSION GROUPS
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
     UTILS
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
      crypto?.randomUUID
    ) {

      return crypto.randomUUID();
    }


    return (
      `att_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`
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
      index === -1 ||
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
      Number(bytes) ||
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


  /* =====================================================
     CATEGORY
     ===================================================== */

  function getCategory(
    file
  ) {

    const mime =
      String(
        file?.type || ""
      )
        .toLowerCase();


    const ext =
      getExtension(
        file?.name
      );


    if (
      mime.startsWith(
        "image/"
      ) ||
      EXTENSIONS.image.has(
        ext
      )
    ) {
      return "image";
    }


    if (
      mime.startsWith(
        "audio/"
      ) ||
      EXTENSIONS.audio.has(
        ext
      )
    ) {
      return "audio";
    }


    if (
      mime.startsWith(
        "video/"
      ) ||
      EXTENSIONS.video.has(
        ext
      )
    ) {
      return "video";
    }


    if (
      mime ===
        "application/pdf" ||
      EXTENSIONS.document.has(
        ext
      )
    ) {
      return "document";
    }


    if (
      EXTENSIONS.spreadsheet.has(
        ext
      )
    ) {
      return "spreadsheet";
    }


    if (
      EXTENSIONS.presentation.has(
        ext
      )
    ) {
      return "presentation";
    }


    if (
      EXTENSIONS.archive.has(
        ext
      )
    ) {
      return "archive";
    }


    if (
      EXTENSIONS.code.has(
        ext
      )
    ) {
      return "code";
    }


    if (
      EXTENSIONS.data.has(
        ext
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
        item.size ||
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
     ITEM
     ===================================================== */

  function createItem(
    file
  ) {

    const category =
      getCategory(
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

      mime:
        file.type ||
        "application/octet-stream",

      extension:
        getExtension(
          file.name
        ),

      category,


      /*
      Lifecycle
      */

      status:
        "queued",

      progress:
        0,

      error:
        null,


      /*
      Storage
      */

      uploadId:
        null,

      bucket:
        null,

      path:
        null,

      signedToken:
        null,


      /*
      Processing
      */

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


      /*
      Visual
      */

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
        return item.status;
    }
  }


  /* =====================================================
     RENDER
     ===================================================== */

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


      element.dataset.attachmentId =
        item.id;


      attachmentList.appendChild(
        element
      );
    }


    const preview =
      item.previewUrl

        ? `
          <div class="attachment-chip-preview">
            <img
              src="${escapeHtml(
                item.previewUrl
              )}"
              alt=""
            />
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


    element.dataset.status =
      item.status;


    element.innerHTML = `
      ${preview}

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
        renderItem(item);
      }
    }


    attachmentList.hidden =
      state.items.size ===
      0;


    emitState();
  }


  /* =====================================================
     STATE
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
            attachments
          }
        }
      )
    );
  }


  function emitError(
    message
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
            message
          }
        }
      )
    );
  }


  /* =====================================================
     ADD
     ===================================================== */

  async function addFiles(
    files
  ) {

    const incoming =
      Array.from(
        files || []
      );


    if (!incoming.length) {
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


      if (!validation.valid) {

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


      /*
      Fire pipeline asynchronously.
      */

      processPipeline(
        item.id
      );
    }


    renderAll();
  }


  /* =====================================================
     STEP 1 — CREATE SIGNED UPLOAD SESSION
     ===================================================== */

  async function createUploadSession(
    item
  ) {

    const response =
      await fetch(
        CONFIG.uploadSessionEndpoint,
        {
          method:
            "POST",

          credentials:
            "same-origin",

          headers: {

            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          },

          body:
            JSON.stringify({

              name:
                item.name,

              size:
                item.size,

              mime:
                item.mime,

              category:
                item.category,

              clientAttachmentId:
                item.id
            })
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


    if (!response.ok) {

      throw new Error(
        data?.error ||
        raw ||
        `Upload authorization failed (${response.status})`
      );
    }


    if (
      !data?.uploadId ||
      !data?.path ||
      !data?.token ||
      !data?.bucket
    ) {

      throw new Error(
        "Invalid upload authorization response."
      );
    }


    return data;
  }


  /* =====================================================
     STEP 2 — DIRECT SIGNED UPLOAD

     Uses Supabase REST signed upload URL directly.
     No frontend Supabase JS client required.
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

        if (!session.signedUrl) {

          reject(
            new Error(
              "Signed upload URL missing."
            )
          );

          return;
        }


        const xhr =
          new XMLHttpRequest();


        xhr.open(
          "PUT",
          session.signedUrl,
          true
        );


        xhr.timeout =
          CONFIG.uploadTimeoutMs;


        /*
        Supabase signed upload accepts the raw file.
        */

        xhr.setRequestHeader(
          "Content-Type",
          item.mime ||
          "application/octet-stream"
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


            reject(
              new Error(
                `Storage upload failed (${xhr.status}).`
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
     STEP 3 — PROCESS
     ===================================================== */

  async function requestProcessing(
    item
  ) {

    const controller =
      new AbortController();


    const timer =
      setTimeout(
        () => {

          controller.abort();

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
              "same-origin",

            headers: {

              "Content-Type":
                "application/json",

              Accept:
                "application/json"
            },

            body:
              JSON.stringify({

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
              }),

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
          `File processing failed (${response.status})`
        );
      }


      return {
        queued:
          false,

        data:
          data || {}
      };


    } finally {

      clearTimeout(
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


      renderItem(
        item
      );


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


      /* -------------------------------------------------
         PROCESS
         ------------------------------------------------- */

      item.status =
        "processing";


      renderItem(
        item
      );


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
        processing.data;


      item.processId =
        data.processId ||
        null;


      item.documentId =
        data.documentId ||
        null;


      /*
      202 = large file queued.
      We need polling/background worker later.
      */

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


        debug(
          "Attachment queued",
          {
            name:
              item.name,

            processId:
              item.processId
          }
        );


        return true;
      }


      /* -------------------------------------------------
         NORMALIZED RESPONSE
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


      item.ready =
        Boolean(
          data.ready
        );


      if (
        data.ready
      ) {

        item.status =
          "ready";

      } else {

        /*
        Example:
        image/audio/video accepted but
        multimodal pipeline not yet connected.
        */

        item.status =
          "ready";

        item.ready =
          true;
      }


      renderItem(
        item
      );


      emitState();


      debug(
        "Attachment ready",
        {
          name:
            item.name,

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

          ? "File processing timed out."

          : error?.message ||
            "Couldn't process this file.";


      renderItem(
        item
      );


      emitState();


      emitError(
        item.error
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
      return;
    }


    /*
    Start clean.
    New signed token/path avoids stale upload sessions.
    */

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

    item.error =
      null;


    processPipeline(
      id
    );
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
            "ready"
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

          extension:
            item.extension,

          category:
            item.category,

          size:
            item.size,

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


  /* =====================================================
     INPUT
     ===================================================== */

  attachmentBtn
    ?.addEventListener(
      "click",
      event => {

        event.preventDefault();

        fileInput.click();
      }
    );


  fileInput.addEventListener(
    "change",
    async event => {

      await addFiles(
        event.target.files
      );


      /*
      Allow selecting same file again
      after removal.
      */

      fileInput.value =
        "";
    }
  );


  /* =====================================================
     DRAG DROP
     ===================================================== */

  function hasFiles(
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


  dropZone.addEventListener(
    "dragenter",
    event => {

      if (
        !hasFiles(
          event
        )
      ) {
        return;
      }


      event.preventDefault();


      state.dragging =
        true;


      dropZone.classList.add(
        "is-file-dragging"
      );
    }
  );


  dropZone.addEventListener(
    "dragover",
    event => {

      if (
        !hasFiles(
          event
        )
      ) {
        return;
      }


      event.preventDefault();


      if (
        event.dataTransfer
      ) {

        event.dataTransfer.dropEffect =
          "copy";
      }
    }
  );


  dropZone.addEventListener(
    "dragleave",
    event => {

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
    }
  );


  dropZone.addEventListener(
    "drop",
    async event => {

      if (
        !hasFiles(
          event
        )
      ) {
        return;
      }


      event.preventDefault();


      state.dragging =
        false;


      dropZone.classList.remove(
        "is-file-dragging"
      );


      await addFiles(
        event.dataTransfer.files
      );
    }
  );


  /* =====================================================
     PASTE
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
          clipboardItem.getAsFile();


        if (file) {

          files.push(
            file
          );
        }
      }


      if (
        !files.length
      ) {
        return;
      }


      await addFiles(
        files
      );
    }
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
        button.dataset.action ===
        "remove"
      ) {

        removeAttachment(
          id
        );
      }


      if (
        button.dataset.action ===
        "retry"
      ) {

        retryAttachment(
          id
        );
      }
    }
  );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  window.NeyoAttachments =
    Object.freeze({

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

          count:
            state.items.size,

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

  fileInput.setAttribute(
    "accept",
    "*/*"
  );


  fileInput.multiple =
    true;


  attachmentList.hidden =
    true;


  debug(
    "Universal signed-upload attachment system ready",
    {
      maxFiles:
        CONFIG.maxFiles,

      maxFileSize:
        formatBytes(
          CONFIG.maxFileSize
        )
    }
  );

})();
