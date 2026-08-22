(() => {
  "use strict";

  const VERSION = "neyo-attachments-recovery-v1";
  if (window.NeyoAttachments?.__controller) return;

  const CFG = Object.freeze({
    upload: "/api/attachments/upload",
    process: "/api/attachments/process",

    maxFiles: 5,
    maxFile: 100 * 1024 * 1024,
    maxTotal: 300 * 1024 * 1024,

    uploadTimeout: 120_000,
    processTimeout: 180_000,

    cacheControl: "3600"
  });

  /* =====================================================
     RUNTIME OWNERSHIP
     ===================================================== */

  const runtime =
    document.documentElement?.dataset?.neyoRuntime ||
    document.body?.dataset?.neyoRuntime ||
    "";

  /*
   * CRITICAL:
   * While neo.js is the active legacy owner,
   * this controller must NOT duplicate:
   *
   * - attach button listeners
   * - legacy hidden input
   * - paste handling
   * - drag/drop handling
   * - composer attachment classes
   */

  const legacy =
    runtime === "legacy-stable" ||
    Boolean(
      document.getElementById("hiddenFileInput") &&
      document.querySelector('script[src*="/neo.js"]')
    );

  /* =====================================================
     DOM
     ===================================================== */

  const composer =
    document.getElementById("composerWrapper") ||
    document.getElementById("glassInputContainer") ||
    document.querySelector(".composer-wrapper") ||
    document.body;

  const glass =
    document.getElementById("glassInputContainer") ||
    composer;

  const overlay =
    document.getElementById("dragDropOverlay");

  const addFilesMenuBtn =
    document.getElementById("addFilesMenuBtn");

  /*
   * Never hijack legacy #attachedChipsWrapper while
   * neo.js is still the attachment owner.
   */

  let list =
    document.getElementById("attachmentList") ||
    (
      !legacy
        ? document.getElementById("attachedChipsWrapper")
        : null
    );

  if (!list) {
    list =
      document.createElement("div");

    list.id =
      "neyoAttachmentList";

    list.className =
      "attached-chips-wrapper neyo-v2-attachment-list";

    list.hidden = true;

    glass?.prepend?.(
      list
    );
  }

  /*
   * V2 owns its own private input.
   * Never reuse #hiddenFileInput from neo.js.
   */

  let input =
    document.getElementById("neyoAttachmentInput");

  if (!input) {
    input =
      Object.assign(
        document.createElement("input"),
        {
          type: "file",
          id: "neyoAttachmentInput",
          multiple: true,
          hidden: true,
          tabIndex: -1
        }
      );

    input.accept =
      "*/*";

    input.setAttribute(
      "aria-hidden",
      "true"
    );

    document.body.appendChild(
      input
    );
  }

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    items: new Map(),
    order: [],
    dragging: false
  };

  const PENDING =
    new Set([
      "queued",
      "authorizing",
      "uploading",
      "uploaded",
      "processing",
      "queued-processing"
    ]);

  /*
   * Block executable binary packages.
   * Text-based scripts remain analyzable.
   */

  const BLOCKED =
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

      document: new Set([
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
     UTILITIES
     ===================================================== */

  const emit =
    (name, detail = {}) =>
      window.dispatchEvent(
        new CustomEvent(
          name,
          { detail }
        )
      );

  const esc =
    value =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

  const extOf =
    name =>
      String(name || "")
        .toLowerCase()
        .match(
          /\.([a-z0-9]+)$/
        )?.[1] ||
      "";

  const id =
    () =>
      globalThis.crypto
        ?.randomUUID
        ?.() ||
      (
        `att_${Date.now()}_` +
        Math.random()
          .toString(36)
          .slice(2)
      );

  function fmt(bytes) {
    let n =
      Math.max(
        0,
        Number(bytes) || 0
      );

    if (n < 1024) {
      return `${n} B`;
    }

    const units =
      ["KB", "MB", "GB"];

    n /= 1024;

    let index = 0;

    while (
      n >= 1024 &&
      index <
      units.length - 1
    ) {
      n /= 1024;
      index += 1;
    }

    return (
      `${
        n >= 10
          ? n.toFixed(0)
          : n.toFixed(1)
      } ${units[index]}`
    );
  }

  function categoryOf(
    extension,
    mime = ""
  ) {

    for (
      const [
        category,
        set
      ]
      of Object.entries(
        GROUPS
      )
    ) {
      if (
        set.has(
          extension
        )
      ) {
        return category;
      }
    }

    const type =
      String(mime)
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

  const totalSize =
    () =>
      [...state.items.values()]
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

  const duplicate =
    file =>
      [...state.items.values()]
        .some(
          item =>
            item.name ===
              file.name &&
            item.size ===
              file.size &&
            item.lastModified ===
              file.lastModified
        );

  /* =====================================================
     VALIDATION
     ===================================================== */

  function validate(
    file
  ) {

    if (
      !(file instanceof File)
    ) {
      return "Invalid file.";
    }

    if (!file.name) {
      return "File name is missing.";
    }

    if (
      file.size <= 0
    ) {
      return (
        `"${file.name}" is empty.`
      );
    }

    if (
      file.size >
      CFG.maxFile
    ) {
      return (
        `"${file.name}" exceeds the ` +
        `${fmt(CFG.maxFile)} limit.`
      );
    }

    if (
      BLOCKED.has(
        extOf(file.name)
      )
    ) {
      return (
        `"${file.name}" is not an ` +
        "allowed attachment type."
      );
    }

    if (
      state.items.size >=
      CFG.maxFiles
    ) {
      return (
        `Maximum ${CFG.maxFiles} ` +
        "attachments are allowed."
      );
    }

    if (
      totalSize() +
      file.size >
      CFG.maxTotal
    ) {
      return (
        "Total attachments cannot exceed " +
        `${fmt(CFG.maxTotal)}.`
      );
    }

    if (
      duplicate(file)
    ) {
      return (
        `"${file.name}" is already attached.`
      );
    }

    return "";
  }

  /* =====================================================
     ITEM
     ===================================================== */

  function createItem(
    file
  ) {

    const extension =
      extOf(
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
        id(),

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

  const getAll =
    () =>
      state.order
        .map(
          key =>
            state.items.get(
              key
            )
        )
        .filter(Boolean)
        .map(
          serialize
        );

  const getReady =
    () =>
      state.order
        .map(
          key =>
            state.items.get(
              key
            )
        )
        .filter(
          item =>
            item?.ready &&
            item.status ===
              "ready"
        )
        .map(
          serialize
        );

  const hasPending =
    () =>
      [...state.items.values()]
        .some(
          item =>
            PENDING.has(
              item.status
            )
        );

  const hasErrors =
    () =>
      [...state.items.values()]
        .some(
          item =>
            item.status ===
            "error"
        );

  /* =====================================================
     UI STATE
     ===================================================== */

  function syncComposer() {

    /*
     * Never remove/add legacy composer state classes
     * while neo.js is still owner.
     */

    if (legacy) {
      return;
    }

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

  function emitState() {

    emit(
      "neyo:attachments-change",
      {
        version:
          VERSION,

        count:
          state.items.size,

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
          totalSize(),

        attachments:
          getAll()
      }
    );
  }

  const statusOf =
    item =>
      ({
        queued:
          "Preparing",

        authorizing:
          "Preparing",

        uploaded:
          "Reading",

        processing:
          "Reading",

        "queued-processing":
          "Processing",

        ready:
          "Ready"
      })[
        item.status
      ] ||
      (
        item.status ===
        "uploading"
          ? `Uploading ${Math.round(
              item.progress ||
              0
            )}%`
          : item.error ||
            "Preparing"
      );

  const iconOf =
    category =>
      ({
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
      })[
        category
      ] ||
      "file";

  /* =====================================================
     RENDER
     ===================================================== */

  function renderItem(
    item
  ) {

    let chip =
      [
        ...list.querySelectorAll(
          "[data-attachment-id]"
        )
      ]
        .find(
          node =>
            node.dataset
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

      list.appendChild(
        chip
      );
    }

    chip.dataset.status =
      item.status;

    const visual =
      item.previewUrl

        ? `
          <div class="attachment-chip-preview">
            <img
              src="${esc(
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
              style="width:${
                Math.min(
                  100,
                  Math.max(
                    0,
                    item.progress ||
                    0
                  )
                )
              }%"
            ></span>
          </div>
        `

        : "";

    chip.innerHTML =
      `
        ${visual}

        <div class="attachment-chip-body">

          <div
            class="attachment-chip-name"
            title="${esc(
              item.name
            )}"
          >
            ${esc(
              item.name
            )}
          </div>

          <div class="attachment-chip-meta">

            <span>
              ${esc(
                fmt(
                  item.size
                )
              )}
            </span>

            <span aria-hidden="true">
              ·
            </span>

            <span class="attachment-chip-status">
              ${esc(
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

    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  function renderAll() {

    state.order
      .forEach(
        key => {
          const item =
            state.items.get(
              key
            );

          if (item) {
            renderItem(
              item
            );
          }
        }
      );

    const known =
      new Set(
        state.order
      );

    list
      .querySelectorAll(
        "[data-attachment-id]"
      )
      .forEach(
        node => {

          if (
            !known.has(
              node.dataset
                .attachmentId
            )
          ) {
            node.remove();
          }
        }
      );

    list.hidden =
      state.items.size ===
      0;

    syncComposer();
    emitState();
  }

  function fail(
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
            ? serialize(item)
            : null
      }
    );
  }

  /* =====================================================
     RESPONSE
     ===================================================== */

  async function readResponse(
    response
  ) {

    const raw =
      await response.text();

    if (!raw) {
      return {
        data: null,
        raw: ""
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
        data: null,
        raw
      };
    }
  }

  /* =====================================================
     FETCH TIMEOUT
     ===================================================== */

  async function timedFetch(
    url,
    options,
    timeout,
    item = null
  ) {

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        timeout
      );

    if (item) {
      item.uploadController =
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

      clearTimeout(
        timer
      );

      if (
        item?.uploadController ===
        controller
      ) {
        item.uploadController =
          null;
      }
    }
  }

  /* =====================================================
     AUTHORIZE UPLOAD
     ===================================================== */

  async function authorize(
    item
  ) {

    const response =
      await timedFetch(
        CFG.upload,
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
        CFG.uploadTimeout,
        item
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
     DIRECT SIGNED UPLOAD
     ===================================================== */

  async function upload(
    item,
    session
  ) {

    const form =
      new FormData();

    /*
     * Explicit cacheControl avoids the signed-upload
     * cacheControl edge case.
     */

    form.append(
      "cacheControl",
      CFG.cacheControl
    );

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

    /*
     * Do NOT set Content-Type manually.
     * Browser must generate multipart boundary.
     */

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
        CFG.uploadTimeout,
        item
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

  async function process(
    item
  ) {

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        CFG.processTimeout
      );

    item.processController =
      controller;

    try {

      const response =
        await fetch(
          CFG.process,
          {
            method:
              "POST",

            credentials:
              "include",

            cache:
              "no-store",

            signal:
              controller.signal,

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
          }
        );

      const {
        data,
        raw
      } =
        await readResponse(
          response
        );

      /*
       * Future-compatible async processing.
       */

      if (
        response.status ===
        202
      ) {
        return {
          queued: true,
          data:
            data || {}
        };
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
          raw ||
          `File processing failed (${response.status}).`
        );
      }

      return {
        queued: false,
        data:
          data || {}
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

      clearTimeout(
        timer
      );

      if (
        item.processController ===
        controller
      ) {
        item.processController =
          null;
      }
    }
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

    if (!item) {
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

      /*
       * 1. Signed authorization
       */

      const session =
        await authorize(
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
            session.bucket,

          path:
            session.path,

          status:
            "uploading"
        }
      );

      renderItem(
        item
      );

      emitState();

      /*
       * 2. Direct browser -> Supabase upload
       */

      await upload(
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

      /*
       * 3. Processing
       */

      item.status =
        "processing";

      renderItem(
        item
      );

      emitState();

      const done =
        await process(
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
        done.data ||
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

          stats:
            data.stats ||
            null,

          warnings:
            Array.isArray(
              data.warnings
            )
              ? data.warnings
              : []
        }
      );

      /*
       * Async processing support.
       */

      if (
        done.queued
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
              serialize(
                item
              )
          }
        );

        return true;
      }

      /*
       * Ready
       */

      Object.assign(
        item,
        {
          document:
            data.document ||
            null,

          chunks:
            Array.isArray(
              data.chunks
            )
              ? data.chunks
              : [],

          extraction:
            data.extraction ||
            null,

          ready:
            data.ready !==
            false,

          status:
            "ready",

          progress:
            100
        }
      );

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

      fail(
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
        value || []
      )
        .filter(
          file =>
            file instanceof
            File
        );

    const added =
      [];

    for (
      const file
      of files
    ) {

      const error =
        validate(
          file
        );

      if (error) {
        fail(
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

      added.push(
        item.id
      );

      renderAll();
    }

    /*
     * Max five attachments:
     * parallel processing is safe and keeps UI responsive.
     */

    await Promise.allSettled(
      added.map(
        pipeline
      )
    );

    return added
      .map(
        key =>
          state.items.get(
            key
          )
      )
      .filter(Boolean)
      .map(
        serialize
      );
  }

  /* =====================================================
     RETRY / REMOVE / CLEAR
     ===================================================== */

  function reset(
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

  function retry(
    key
  ) {

    const item =
      state.items.get(
        key
      );

    if (!item) {
      return false;
    }

    reset(
      item
    );

    renderAll();

    void pipeline(
      key
    );

    return true;
  }

  function remove(
    key
  ) {

    const item =
      state.items.get(
        key
      );

    if (!item) {
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
        id =>
          id !== key
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

    return true;
  }

  function clear() {

    [
      ...state.order
    ]
      .forEach(
        remove
      );

    return true;
  }

  /* =====================================================
     PICKER
     ===================================================== */

  function open() {

    try {
      input.click();

      return true;

    } catch (
      error
    ) {

      fail(
        error?.message ||
        "Could not open file picker."
      );

      return false;
    }
  }

  input.addEventListener(
    "change",
    async () => {

      const files =
        Array.from(
          input.files ||
          []
        );

      /*
       * Allows same file to be selected again after removal.
       */

      input.value =
        "";

      if (
        files.length
      ) {
        await addFiles(
          files
        );
      }
    }
  );

  /* =====================================================
     CHIP ACTIONS
     ===================================================== */

  list.addEventListener(
    "click",
    event => {

      const button =
        event.target
          ?.closest
          ?.(
            "[data-action]"
          );

      if (!button) {
        return;
      }

      const key =
        button
          .closest(
            "[data-attachment-id]"
          )
          ?.dataset
          ?.attachmentId;

      if (!key) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (
        button.dataset
          .action ===
        "remove"
      ) {
        remove(
          key
        );

      } else if (
        button.dataset
          .action ===
        "retry"
      ) {
        retry(
          key
        );
      }
    }
  );

  /* =====================================================
     EXPLICIT BRIDGE EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-open-request",
    open
  );

  window.addEventListener(
    "neyo:attachments-clear-request",
    clear
  );

  /* =====================================================
     MODULAR-ONLY INPUT OWNERSHIP

     Do not register these while neo.js owns attachments.
     ===================================================== */

  if (!legacy) {

    addFilesMenuBtn
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();
          event.stopPropagation();

          open();
        }
      );

    const hasFiles =
      event =>
        Array.from(
          event
            ?.dataTransfer
            ?.types ||
          []
        )
          .includes(
            "Files"
          );

    const inside =
      event =>
        event.target instanceof
          Node &&
        Boolean(
          composer
            ?.contains
            ?.(
              event.target
            )
        );

    const dragging =
      active => {

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

        overlay
          ?.classList
          ?.toggle(
            "active",
            state.dragging
          );

        overlay
          ?.setAttribute
          ?.(
            "aria-hidden",
            state.dragging
              ? "false"
              : "true"
          );
      };

    document.addEventListener(
      "dragenter",
      event => {

        if (
          !hasFiles(event) ||
          !inside(event)
        ) {
          return;
        }

        event.preventDefault();

        dragging(
          true
        );
      },
      true
    );

    document.addEventListener(
      "dragover",
      event => {

        if (
          !hasFiles(event) ||
          !inside(event)
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

        dragging(
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
          related instanceof Node &&
          composer
            ?.contains
            ?.(
              related
            )
        ) {
          return;
        }

        dragging(
          false
        );
      },
      true
    );

    document.addEventListener(
      "drop",
      async event => {

        if (
          !hasFiles(event) ||
          !inside(event)
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        dragging(
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
          files.length
        ) {
          await addFiles(
            files
          );
        }
      },
      true
    );

    document.addEventListener(
      "paste",
      async event => {

        const files =
          Array.from(
            event
              .clipboardData
              ?.items ||
            []
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

        /*
         * Normal text paste remains untouched.
         */

        if (
          !files.length
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
  }

  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({

      __controller:
        true,

      version:
        VERSION,

      legacyCompatible:
        true,

      legacyOwnerActive:
        legacy,

      /*
       * Compatibility shim for old experimental code.
       * This controller does not require browser Supabase.
       */

      setSupabaseClient:
        () =>
          true,

      open,
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

          legacyOwnerActive:
            legacy,

          count:
            state.items.size,

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
            totalSize(),

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
        api,

      writable:
        false,

      configurable:
        true,

      enumerable:
        true
    }
  );

  /*
   * In legacy mode do NOT hide the old attachment list,
   * remove composer classes, or emit an empty change state.
   */

  if (!legacy) {
    list.hidden =
      true;

    syncComposer();
    emitState();
  }

  emit(
    "neyo:attachments-ready",
    {
      version:
        VERSION,

      legacyOwnerActive:
        legacy
    }
  );
})();
