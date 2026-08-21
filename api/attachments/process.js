/*
=========================================================
NEYO — ATTACHMENT PROCESSING API
FINAL v2

FILE:
api/attachments/process.js

RESPONSIBILITIES
---------------------------------------------------------
✅ Authenticate user
✅ Validate attachment metadata
✅ Verify attachment belongs to current user
✅ Download private file from Supabase Storage
✅ Extract text from supported document/data formats
✅ Normalize extracted content
✅ Return document/chunks/stats
✅ Handle image/audio/video as secure storage references

DOES NOT:
❌ Modify chat
❌ Touch neo.js
❌ Execute uploaded code
❌ Trust client-provided extracted text
=========================================================
*/

import crypto from "node:crypto";

import {
  createClient
} from "@supabase/supabase-js";

import {
  getAuthenticatedUser
} from "../../lib/auth.js";

import {
  extractAttachment
} from "../../lib/attachments/extractors.js";

import {
  normalizeAttachment
} from "../../lib/attachments/normalize.js";


/* =====================================================
   CONFIG
   ===================================================== */

const BUCKET =
  "neyo-attachments";


const MAX_FILE_SIZE =
  100 * 1024 * 1024;


const MAX_INLINE_EXTRACT_SIZE =
  25 * 1024 * 1024;


const MAX_BODY_SIZE =
  64 * 1024;


const MAX_FILENAME_LENGTH =
  220;


const MAX_PATH_LENGTH =
  1024;


const MULTIMODAL_CATEGORIES =
  new Set([
    "image",
    "audio",
    "video"
  ]);


const TEXTUAL_CATEGORIES =
  new Set([
    "document",
    "spreadsheet",
    "presentation",
    "archive",
    "data",
    "code",
    "text"
  ]);


const ALLOWED_CATEGORIES =
  new Set([
    ...MULTIMODAL_CATEGORIES,
    ...TEXTUAL_CATEGORIES,
    "unknown"
  ]);


/* =====================================================
   ENV
   ===================================================== */

function cleanEnv(
  value
) {
  return typeof value ===
    "string"
      ? value
          .trim()
          .replace(
            /^["']|["']$/g,
            ""
          )
      : "";
}


/* =====================================================
   SUPABASE ADMIN
   ===================================================== */

function createSupabaseAdmin() {
  const url =
    cleanEnv(
      process.env
        .SUPABASE_URL
    );


  const key =
    cleanEnv(
      process.env
        .SUPABASE_SERVICE_ROLE_KEY
    );


  if (!url) {
    throw new Error(
      "SUPABASE_URL is missing."
    );
  }


  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing."
    );
  }


  return createClient(
    url,
    key,
    {
      auth: {
        persistSession:
          false,

        autoRefreshToken:
          false,

        detectSessionInUrl:
          false
      },

      global: {
        headers: {
          "X-Client-Info":
            "signaturesi-neyo-attachment-process"
        }
      }
    }
  );
}


/* =====================================================
   JSON HEADERS
   ===================================================== */

function setJsonHeaders(
  res
) {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  res.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );
}


/* =====================================================
   BODY PARSER
   ===================================================== */

async function readJsonBody(
  req
) {
  if (
    req.body &&
    typeof req.body ===
      "object" &&
    !Buffer.isBuffer(
      req.body
    ) &&
    !Array.isArray(
      req.body
    )
  ) {
    return req.body;
  }


  if (
    Buffer.isBuffer(
      req.body
    )
  ) {
    if (
      req.body.length >
      MAX_BODY_SIZE
    ) {
      throw new Error(
        "Request body is too large."
      );
    }


    try {
      return JSON.parse(
        req.body
          .toString(
            "utf8"
          )
      );
    } catch {
      throw new Error(
        "Invalid JSON request body."
      );
    }
  }


  if (
    typeof req.body ===
    "string"
  ) {
    if (
      Buffer.byteLength(
        req.body,
        "utf8"
      ) >
      MAX_BODY_SIZE
    ) {
      throw new Error(
        "Request body is too large."
      );
    }


    try {
      return JSON.parse(
        req.body
      );
    } catch {
      throw new Error(
        "Invalid JSON request body."
      );
    }
  }


  const chunks =
    [];


  let total =
    0;


  for await (
    const chunk
    of req
  ) {
    total +=
      chunk.length;


    if (
      total >
      MAX_BODY_SIZE
    ) {
      throw new Error(
        "Request body is too large."
      );
    }


    chunks.push(
      chunk
    );
  }


  if (
    chunks.length ===
    0
  ) {
    return {};
  }


  const raw =
    Buffer
      .concat(
        chunks
      )
      .toString(
        "utf8"
      );


  try {
    return JSON.parse(
      raw
    );
  } catch {
    throw new Error(
      "Invalid JSON request body."
    );
  }
}


/* =====================================================
   HELPERS
   ===================================================== */

function cleanString(
  value,
  maxLength =
    512
) {
  return String(
    value ??
    ""
  )
    .replace(
      /\u0000/g,
      ""
    )
    .trim()
    .slice(
      0,
      maxLength
    );
}


function normalizeExtension(
  value
) {
  return String(
    value ??
    ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /^\./,
      ""
    )
    .replace(
      /[^a-z0-9]/g,
      ""
    )
    .slice(
      0,
      32
    );
}


function normalizeCategory(
  value
) {
  const category =
    String(
      value ??
      ""
    )
      .trim()
      .toLowerCase();


  return ALLOWED_CATEGORIES
    .has(
      category
    )
      ? category
      : "unknown";
}


function sanitizePathSegment(
  value
) {
  return String(
    value ??
    ""
  )
    .trim()
    .replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    )
    .slice(
      0,
      128
    );
}


/* =====================================================
   VALIDATE REQUEST
   ===================================================== */

function validatePayload(
  body,
  userId
) {
  if (
    !body ||
    typeof body !==
      "object" ||
    Array.isArray(
      body
    )
  ) {
    throw new Error(
      "Invalid attachment metadata."
    );
  }


  const uploadId =
    cleanString(
      body.uploadId,
      128
    );


  const bucket =
    cleanString(
      body.bucket ||
      BUCKET,
      128
    );


  const path =
    cleanString(
      body.path,
      MAX_PATH_LENGTH
    );


  const name =
    cleanString(
      body.name,
      MAX_FILENAME_LENGTH
    );


  const mime =
    cleanString(
      body.mime ||
      "application/octet-stream",
      180
    );


  const extension =
    normalizeExtension(
      body.extension
    );


  const category =
    normalizeCategory(
      body.category
    );


  const size =
    Number(
      body.size
    ) ||
    0;


  if (!uploadId) {
    throw new Error(
      "Upload ID is required."
    );
  }


  if (!path) {
    throw new Error(
      "Attachment path is required."
    );
  }


  if (!name) {
    throw new Error(
      "Attachment name is required."
    );
  }


  if (
    bucket !==
    BUCKET
  ) {
    throw new Error(
      "Invalid attachment bucket."
    );
  }


  if (
    path.length >
    MAX_PATH_LENGTH
  ) {
    throw new Error(
      "Attachment path is too long."
    );
  }


  if (
    path.startsWith(
      "/"
    ) ||
    path.includes(
      "\\"
    ) ||
    path.includes(
      "../"
    ) ||
    path.includes(
      "/.."
    )
  ) {
    throw new Error(
      "Invalid attachment path."
    );
  }


  if (
    size < 0 ||
    size >
    MAX_FILE_SIZE
  ) {
    throw new Error(
      "Attachment size is invalid."
    );
  }


  const safeUserId =
    sanitizePathSegment(
      userId
    );


  const safeUploadId =
    sanitizePathSegment(
      uploadId
    );


  if (
    !safeUserId ||
    !safeUploadId
  ) {
    throw new Error(
      "Invalid attachment ownership metadata."
    );
  }


  /*
   * Exact path contract from upload.js:
   *
   * users/{userId}/{uploadId}/{filename}
   */

  const requiredPrefix =
    `users/${safeUserId}/${safeUploadId}/`;


  if (
    !path.startsWith(
      requiredPrefix
    )
  ) {
    throw new Error(
      "You do not have access to this attachment."
    );
  }


  return {
    uploadId,
    bucket,
    path,
    name,
    mime,
    extension,
    category,
    size
  };
}


/* =====================================================
   DOWNLOAD PRIVATE STORAGE FILE
   ===================================================== */

async function downloadFile(
  supabase,
  attachment
) {
  const {
    data,
    error
  } =
    await supabase
      .storage
      .from(
        attachment.bucket
      )
      .download(
        attachment.path
      );


  if (error) {
    console.error(
      "[NEYO Attachment Process] Download error:",
      {
        path:
          attachment.path,

        message:
          error.message,

        code:
          error.code
      }
    );


    throw new Error(
      `"${attachment.name}" could not be read from storage.`
    );
  }


  if (!data) {
    throw new Error(
      `"${attachment.name}" was not found.`
    );
  }


  const arrayBuffer =
    await data.arrayBuffer();


  const buffer =
    Buffer.from(
      arrayBuffer
    );


  if (
    buffer.length ===
    0
  ) {
    throw new Error(
      `"${attachment.name}" is empty.`
    );
  }


  if (
    buffer.length >
    MAX_FILE_SIZE
  ) {
    throw new Error(
      `"${attachment.name}" exceeds the allowed size.`
    );
  }


  /*
   * Small allowance because browser metadata and
   * actual storage byte length can occasionally differ.
   */

  if (
    attachment.size >
      0 &&
    buffer.length >
      attachment.size +
      4096
  ) {
    throw new Error(
      `"${attachment.name}" failed size validation.`
    );
  }


  return buffer;
}


/* =====================================================
   STORAGE-REFERENCE DOCUMENT

   Used for image/audio/video and unsupported formats.
   ===================================================== */

function createReferenceDocument({
  attachment,
  processId,
  warning =
    null
}) {
  const warnings =
    warning
      ? [
          warning
        ]
      : [];


  const document = {
    id:
      processId,

    uploadId:
      attachment.uploadId,

    provider:
      "supabase",

    bucket:
      attachment.bucket,

    path:
      attachment.path,

    name:
      attachment.name,

    mime:
      attachment.mime,

    mimeType:
      attachment.mime,

    extension:
      attachment.extension,

    category:
      attachment.category,

    size:
      attachment.size,

    mode:
      "storage-reference",

    text:
      "",

    warnings
  };


  return {
    document,
    chunks:
      [],

    stats: {
      characters:
        0,

      chunks:
        0,

      referenceOnly:
        true
    },

    extraction: {
      parser:
        "storage-reference",

      kind:
        attachment.category,

      metadata: {},

      warnings
    },

    warnings
  };
}


/* =====================================================
   PUBLIC ERROR
   ===================================================== */

function publicError(
  error
) {
  const message =
    String(
      error?.message ||
      ""
    );


  const safeTerms =
    [
      "Upload ID",
      "Attachment",
      "attachment",
      "could not be read",
      "was not found",
      "is empty",
      "exceeds",
      "size validation",
      "access to this attachment",
      "Invalid attachment",
      "processing",
      "unsupported",
      "too large"
    ];


  if (
    safeTerms.some(
      term =>
        message
          .toLowerCase()
          .includes(
            term.toLowerCase()
          )
    )
  ) {
    return message;
  }


  return (
    "Unable to process this attachment."
  );
}


/* =====================================================
   MAIN HANDLER
   ===================================================== */

export default async function handler(
  req,
  res
) {
  setJsonHeaders(
    res
  );


  /* ===================================================
     METHOD
     =================================================== */

  if (
    req.method !==
    "POST"
  ) {
    res.setHeader(
      "Allow",
      "POST"
    );


    return res
      .status(
        405
      )
      .json({
        error:
          "Method Not Allowed"
      });
  }


  /* ===================================================
     AUTH
     =================================================== */

  let auth;


  try {
    auth =
      await Promise.resolve(
        getAuthenticatedUser(
          req
        )
      );
  } catch (
    error
  ) {
    console.error(
      "[NEYO Attachment Process] Auth error:",
      error?.message
    );


    return res
      .status(
        401
      )
      .json({
        error:
          "Authentication required."
      });
  }


  const userId =
    auth?.userId ||
    auth?.id ||
    auth?.user?.id;


  if (!userId) {
    return res
      .status(
        401
      )
      .json({
        error:
          "Authentication required."
      });
  }


  /* ===================================================
     BODY
     =================================================== */

  let body;


  try {
    body =
      await readJsonBody(
        req
      );
  } catch (
    error
  ) {
    return res
      .status(
        400
      )
      .json({
        error:
          publicError(
            error
          )
      });
  }


  /* ===================================================
     VALIDATE
     =================================================== */

  let attachment;


  try {
    attachment =
      validatePayload(
        body,
        userId
      );
  } catch (
    error
  ) {
    return res
      .status(
        400
      )
      .json({
        error:
          publicError(
            error
          )
      });
  }


  /* ===================================================
     SUPABASE
     =================================================== */

  let supabase;


  try {
    supabase =
      createSupabaseAdmin();
  } catch (
    error
  ) {
    console.error(
      "[NEYO Attachment Process] Supabase configuration error:",
      error?.message
    );


    return res
      .status(
        500
      )
      .json({
        error:
          "Attachment processing is not configured."
      });
  }


  /* ===================================================
     PROCESS ID
     =================================================== */

  const processId =
    crypto.randomUUID();


  const documentId =
    crypto.randomUUID();


  try {
    /* =================================================
       IMAGE / AUDIO / VIDEO

       Do not download here.
       api/chat.js can later load these securely and
       pass them to Gemini multimodal processing.

       This keeps /process lightweight.
       ================================================= */

    if (
      MULTIMODAL_CATEGORIES
        .has(
          attachment.category
        )
    ) {
      const reference =
        createReferenceDocument({
          attachment,
          processId
        });


      reference.document.id =
        documentId;


      console.log(
        "[NEYO Attachment Process] Reference ready:",
        {
          name:
            attachment.name,

          category:
            attachment.category,

          path:
            attachment.path
        }
      );


      return res
        .status(
          200
        )
        .json({
          ok:
            true,

          ready:
            true,

          status:
            "ready",

          processId,

          documentId,

          document:
            reference.document,

          chunks:
            reference.chunks,

          stats:
            reference.stats,

          extraction:
            reference.extraction,

          warnings:
            reference.warnings
        });
    }


    /* =================================================
       UNKNOWN FORMAT

       Keep storage reference rather than pretending
       that content was extracted.
       ================================================= */

    if (
      attachment.category ===
      "unknown"
    ) {
      const reference =
        createReferenceDocument({
          attachment,
          processId,

          warning:
            "This file type is stored securely but is not currently readable by the attachment extractor."
        });


      reference.document.id =
        documentId;


      return res
        .status(
          200
        )
        .json({
          ok:
            true,

          ready:
            true,

          status:
            "ready",

          processId,

          documentId,

          document:
            reference.document,

          chunks:
            reference.chunks,

          stats:
            reference.stats,

          extraction:
            reference.extraction,

          warnings:
            reference.warnings
        });
    }


    /* =================================================
       TEXTUAL FILE SIZE LIMIT
       ================================================= */

    if (
      TEXTUAL_CATEGORIES
        .has(
          attachment.category
        ) &&
      attachment.size >
        MAX_INLINE_EXTRACT_SIZE
    ) {
      return res
        .status(
          413
        )
        .json({
          error:
            `"${attachment.name}" is too large for direct text extraction. Maximum extractable size is ${Math.round(
              MAX_INLINE_EXTRACT_SIZE /
              (
                1024 *
                1024
              )
            )} MB.`
        });
    }


    /* =================================================
       DOWNLOAD
       ================================================= */

    const buffer =
      await downloadFile(
        supabase,
        attachment
      );


    if (
      buffer.length >
      MAX_INLINE_EXTRACT_SIZE
    ) {
      return res
        .status(
          413
        )
        .json({
          error:
            `"${attachment.name}" is too large for direct text extraction.`
        });
    }


    /* =================================================
       EXTRACT
       ================================================= */

    const extraction =
      await extractAttachment({
        buffer,

        name:
          attachment.name,

        mime:
          attachment.mime,

        extension:
          attachment.extension,

        category:
          attachment.category
      });


    if (
      !extraction ||
      typeof extraction !==
        "object"
    ) {
      throw new Error(
        "Attachment extractor returned an invalid result."
      );
    }


    /* =================================================
       NORMALIZE
       ================================================= */

    const normalized =
      normalizeAttachment({
        text:
          extraction.text ||
          "",

        file: {
          id:
            documentId,

          uploadId:
            attachment.uploadId,

          provider:
            "supabase",

          bucket:
            attachment.bucket,

          path:
            attachment.path,

          name:
            attachment.name,

          mime:
            attachment.mime,

          mimeType:
            attachment.mime,

          extension:
            attachment.extension,

          category:
            attachment.category,

          size:
            buffer.length
        },

        extraction
      });


    if (
      !normalized ||
      typeof normalized !==
        "object"
    ) {
      throw new Error(
        "Attachment normalization returned an invalid result."
      );
    }


    const warnings =
      [
        ...(
          Array.isArray(
            extraction.warnings
          )
            ? extraction.warnings
            : []
        ),

        ...(
          Array.isArray(
            normalized.warnings
          )
            ? normalized.warnings
            : []
        )
      ];


    /* =================================================
       SUCCESS
       ================================================= */

    console.log(
      "[NEYO Attachment Process] Ready:",
      {
        processId,
        documentId,

        name:
          attachment.name,

        category:
          attachment.category,

        parser:
          extraction.parser,

        characters:
          normalized
            ?.stats
            ?.characters,

        chunks:
          normalized
            ?.chunks
            ?.length
      }
    );


    return res
      .status(
        200
      )
      .json({
        ok:
          true,

        ready:
          true,

        status:
          "ready",

        processId,

        documentId,

        document:
          normalized.document,

        chunks:
          normalized.chunks,

        stats:
          normalized.stats,

        extraction: {
          parser:
            extraction.parser ||
            "unknown",

          kind:
            extraction.kind ||
            attachment.category,

          metadata:
            extraction.metadata ||
            {},

          warnings:
            Array.isArray(
              extraction.warnings
            )
              ? extraction.warnings
              : []
        },

        warnings
      });


  } catch (
    error
  ) {
    console.error(
      "[NEYO Attachment Process] Failed",
      {
        message:
          error?.message,

        code:
          error?.code,

        details:
          error?.details,

        hint:
          error?.hint,

        uploadId:
          attachment.uploadId,

        path:
          attachment.path,

        name:
          attachment.name,

        category:
          attachment.category
      }
    );


    return res
      .status(
        500
      )
      .json({
        error:
          publicError(
            error
          )
      });
  }
}
