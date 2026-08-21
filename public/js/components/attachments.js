/*
=========================================================
NEYO — UNIVERSAL ATTACHMENTS v1

Frontend responsibilities:
- File picker
- Drag/drop
- Paste files
- Validate count + size
- Detect category
- Build attachment chips/previews
- Upload files
- Track upload / processing status
- Remove / retry
- Expose normalized attachment state to chat.js

Backend responsibilities:
- MIME/signature verification
- Virus/malware checks
- Parsing/extraction
- OCR
- archive extraction
- transcription
- chunking
- model-ready content

Designed for:
- PDF / DOCX / TXT / MD / RTF
- CSV / XLSX / XLS / TSV / JSON / XML
- PPTX
- source-code files
- PNG / JPG / WEBP / GIF / SVG
- MP3 / WAV / M4A / OGG
- MP4 / MOV / WEBM
- ZIP and other archives
- unknown binary files
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
     CATEGORY DETECTION
     ===================================================== */

  function getCategory(
    file
  ) {

    const type =
      String(
        file?.type || ""
      ).toLowerCase();


    const extension =
      getExtension(
        file?.name
      );


    if (
      type.startsWith(
        "image/"
      ) ||
      EXTENSIONS.image.has(
        extension
      )
    ) {
      return "image";
    }


    if (
      type.startsWith(
        "audio/"
      ) ||
      EXTENSIONS.audio.has(
        extension
      )
    ) {
      return "audio";
    }


    if (
      type.startsWith(
        "video/"
      ) ||
      EXTENSIONS.video.has(
        extension
      )
    ) {
      return "video";
    }


    if (
      type ===
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
      type.startsWith(
        "text/"
      )
    ) {
      return "text";
    }


    return "unknown";
  }


  /* =====================================================
     ICONS
     ===================================================== */

  function getIcon(
    category
  ) {

    const icons = {

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
    };


    return (
      icons[category] ||
      "file"
    );
  }


  /* =====================================================
     TOTAL SIZE
     ===================================================== */

  function getCurrentTotalSize() {

    let total =
      0;


    for (
      const item
      of state.items.values()
    ) {

      total +=
        item.file?.size ||
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

    if (!(file instanceof File)) {

      return {
        valid: false,
        message:
          "Invalid file."
      };
    }


    if (
      file.size <=
      0
    ) {

      return {
        valid: false,
        message:
          `${file.name} is empty.`
      };
    }


    if (
      file.size >
      CONFIG.maxFileSize
    ) {

      return {
        valid: false,
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
        valid: false,
        message:
          `You can attach up to ${CONFIG.maxFiles} files.`
      };
    }


    const newTotal =
      getCurrentTotalSize() +
      file.size;


    if (
      newTotal >
      CONFIG.maxTotalSize
    ) {

      return {
        valid: false,
        message:
          `Total attachments cannot exceed ${formatBytes(
            CONFIG.maxTotalSize
          )}.`
      };
    }


    return {
      valid: true,
      message: null
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

      const existing =
        item.file;


      if (
        existing.name ===
          file.name &&
        existing.size ===
          file.size &&
        existing.lastModified ===
          file.lastModified
      ) {

        return true;
      }
    }


    return false;
  }


  /* =====================================================
     ITEM FACTORY
     ===================================================== */

  function createAttachmentItem(
    file
  ) {

    const id =
      createId();


    const category =
      getCategory(
        file
      );


    return {

      id,

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

      status:
        "queued",

      progress:
        0,

      uploadId:
        null,

      remoteUrl:
        null,

      processId:
        null,

      extracted:
        false,

      previewUrl:
        null,

      error:
        null,

      metadata:
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
     CHIP MARKUP
     ===================================================== */

  function renderItem(
    item
  ) {

    let element =
      attachmentList.querySelector(
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


    const statusText = {

      queued:
        "Queued",

      uploading:
        `Uploading ${Math.round(
          item.progress
        )}%`,

      uploaded:
        "Uploaded",

      processing:
        "Reading file…",

      ready:
        "Ready",

      error:
        item.error ||
        "Couldn't process"
    }[
      item.status
    ] ||
    item.status;


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
              statusText
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
        state.items.get(id);


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
     STATE EVENT
     ===================================================== */

  function emitState() {

    const attachments =
      state.order
        .map(
          id =>
            state.items.get(id)
        )
        .filter(Boolean)
        .map(
          item => ({

            id:
              item.id,

            uploadId:
              item.uploadId,

            processId:
              item.processId,

            name:
              item.name,

            mime:
              item.mime,

            size:
              item.size,

            category:
              item.category,

            status:
              item.status,

            remoteUrl:
              item.remoteUrl,

            metadata:
              item.metadata,

            extracted:
              item.extracted
          })
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
        createAttachmentItem(
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
      Upload sequentially per item.
      Each upload itself is async.
      */

      uploadAttachment(
        item.id
      );
    }


    renderAll();
  }


  /* =====================================================
     ERROR EVENT
     ===================================================== */

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
     UPLOAD WITH PROGRESS
     ===================================================== */

  function uploadWithProgress(
    file,
    item
  ) {

    return new Promise(
      (
        resolve,
        reject
      ) => {

        const xhr =
          new XMLHttpRequest();


        const form =
          new FormData();


        form.append(
          "file",
          file,
          file.name
        );


        form.append(
          "clientAttachmentId",
          item.id
        );


        form.append(
          "category",
          item.category
        );


        xhr.open(
          "POST",
          CONFIG.uploadEndpoint,
          true
        );


        xhr.timeout =
          CONFIG.uploadTimeoutMs;


        xhr.responseType =
          "json";


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

            const data =
              xhr.response;


            if (
              xhr.status <
                200 ||
              xhr.status >=
                300
            ) {

              reject(
                new Error(
                  data?.error ||
                  `Upload failed (${xhr.status})`
                )
              );


              return;
            }


            resolve(
              data
            );
          };


        xhr.onerror =
          () => {

            reject(
              new Error(
                "Network error while uploading file."
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
          form
        );
      }
    );
  }


  /* =====================================================
     UPLOAD
     ===================================================== */

  async function uploadAttachment(
    id
  ) {

    const item =
      state.items.get(
        id
      );


    if (!item) {
      return false;
    }


    item.status =
      "uploading";

    item.error =
      null;

    item.progress =
      0;


    renderItem(
      item
    );


    try {

      const result =
        await uploadWithProgress(
          item.file,
          item
        );


      /*
      Item may have been removed while upload ran.
      */

      if (
        !state.items.has(
          id
        )
      ) {
        return false;
      }


      item.uploadId =
        result.uploadId ||
        result.id ||
        null;


      item.remoteUrl =
        result.url ||
        result.remoteUrl ||
        null;


      item.metadata =
        result.metadata ||
        null;


      item.progress =
        100;


      item.status =
        "uploaded";


      renderItem(
        item
      );


      debug(
        "Uploaded",
        {
          name:
            item.name,

          uploadId:
            item.uploadId
        }
      );


      /*
      Immediately ask backend to parse.
      */

      await processAttachment(
        id
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


      item.error =
        error?.message ||
        "Upload failed.";


      renderItem(
        item
      );


      emitState();


      return false;
    }
  }


  /* =====================================================
     PROCESS REQUEST
     ===================================================== */

  async function processAttachment(
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
      !item.uploadId
    ) {

      item.status =
        "error";


      item.error =
        "Upload reference missing.";


      renderItem(
        item
      );


      return false;
    }


    item.status =
      "processing";


    item.error =
      null;


    renderItem(
      item
    );


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


      if (!response.ok) {

        throw new Error(
          data?.error ||
          raw ||
          `File processing failed (${response.status})`
        );
      }


      if (
        !state.items.has(
          id
        )
      ) {
        return false;
      }


      item.processId =
        data?.processId ||
        data?.id ||
        null;


      item.metadata =
        data?.metadata ||
        item.metadata;


      item.extracted =
        Boolean(
          data?.extracted ??
          data?.ready ??
          true
        );


      item.status =
        "ready";


      renderItem(
        item
      );


      emitState();


      debug(
        "Ready",
        {
          name:
            item.name,

          category:
            item.category,

          processId:
            item.processId
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


      item.error =
        error?.name ===
          "AbortError"

          ? "File processing timed out."

          : error?.message ||
            "Could not read this file.";


      renderItem(
        item
      );


      emitState();


      return false;


    } finally {

      clearTimeout(
        timer
      );
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


    if (
      item.uploadId
    ) {

      processAttachment(
        id
      );

    } else {

      uploadAttachment(
        id
      );
    }
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
              item.uploadId
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
     READY ATTACHMENTS
     ===================================================== */

  function getReadyAttachments() {

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

          remoteUrl:
            item.remoteUrl,

          metadata:
            item.metadata
        })
      );
  }


  /* =====================================================
     ALL ATTACHMENTS
     ===================================================== */

  function getAttachments() {

    return state.order
      .map(
        id =>
          state.items.get(
            id
          )
      )
      .filter(Boolean)
      .map(
        item => ({

          id:
            item.id,

          uploadId:
            item.uploadId,

          processId:
            item.processId,

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

          status:
            item.status,

          error:
            item.error,

          remoteUrl:
            item.remoteUrl,

          metadata:
            item.metadata
        })
      );
  }


  /* =====================================================
     PICKER
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

      const files =
        event.target.files;


      await addFiles(
        files
      );


      /*
      Allows selecting same file again
      after removal.
      */

      fileInput.value =
        "";
    }
  );


  /* =====================================================
     DRAG & DROP
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
     PASTE FILES
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


      const action =
        button.dataset.action;


      if (
        action ===
        "remove"
      ) {

        removeAttachment(
          id
        );
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

      getAll:
        getAttachments,

      getReady:
        getReadyAttachments,

      hasPending:
        () =>
          getAttachments()
            .some(
              item =>
                ![
                  "ready",
                  "error"
                ].includes(
                  item.status
                )
            ),

      hasErrors:
        () =>
          getAttachments()
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
            getCurrentTotalSize(),

          dragging:
            state.dragging,

          attachments:
            getAttachments()
        })
    });


  /* =====================================================
     INIT
     ===================================================== */

  /*
  Browser picker:
  Leave accept broad.
  Backend does real validation.
  */

  fileInput.setAttribute(
    "accept",
    "*/*"
  );


  fileInput.multiple =
    true;


  attachmentList.hidden =
    true;


  debug(
    "Universal attachment controller ready",
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
