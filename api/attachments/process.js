/*
=========================================================
NEYO — ATTACHMENT PROCESSOR
FINAL v1

FILE:
api/attachments/process.js

PURPOSE:
- Authenticate current user
- Validate uploaded Storage path ownership
- Never trust browser supplied ownership
- Download readable files from private Supabase bucket
- Pass file bytes to extractors.js
- Normalize extracted content using normalize.js
- Return document + chunks to attachments.js
- Keep large media as secure Storage references
- Never execute uploaded code/files

EXPECTED MODULE CONTRACTS:

lib/attachments/extractors.js
--------------------------------
export async function extractAttachment({
  buffer,
  name,
  mime,
  extension,
  category
})

returns:
{
  text: string,
  parser: string,
  metadata: object,
  warnings: string[],
  kind: string
}


lib/attachments/normalize.js
--------------------------------
export function normalizeAttachment({
  text,
  file,
  extraction
})

returns:
{
  document: object,
  chunks: array,
  stats: object,
  warnings: string[]
}

=========================================================
*/

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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


/*
Frontend allows uploads up to 100 MB.

But text extraction inside a serverless function
must have a smaller memory-safe ceiling.

Large images/audio/video are NOT downloaded here.
*/

const MAX_FILE_SIZE =
  100 * 1024 * 1024;


const MAX_EXTRACTABLE_FILE_SIZE =
  25 * 1024 * 1024;


const MAX_REQUEST_BODY_SIZE =
  64 * 1024;


const MAX_FILE_NAME_LENGTH =
  220;


const MAX_PATH_LENGTH =
  1024;


const ALLOWED_CATEGORIES =
  new Set([
    "document",
    "spreadsheet",
    "presentation",
    "image",
    "audio",
    "video",
    "archive",
    "data",
    "code",
    "text",
    "unknown"
  ]);


/* =====================================================
   CATEGORY BEHAVIOR
   ===================================================== */

/*
These categories should later be consumed
by api/chat through multimodal Storage loading.

No need to download 50–100 MB media into
this processing function.
*/

const MULTIMODAL_CATEGORIES =
  new Set([
    "image",
    "audio",
    "video"
  ]);


/*
Unknown binary file:

Store it safely and expose metadata,
but never pretend that its contents were read.
*/

const REFERENCE_ONLY_CATEGORIES =
  new Set([
    "unknown"
  ]);


/* =====================================================
   ENV
   ===================================================== */

const SUPABASE_URL =
  process.env.SUPABASE_URL;


const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/* =====================================================
   SUPABASE ADMIN CLIENT
   ===================================================== */

let supabaseAdmin =
  null;


function getSupabaseAdmin() {

  if (supabaseAdmin) {
    return supabaseAdmin;
  }


  if (!SUPABASE_URL) {
    throw new Error(
      "SUPABASE_URL is not configured."
    );
  }


  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }


  supabaseAdmin =
    createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    );


  return supabaseAdmin;
}


/* =====================================================
   HTTP ERROR
   ===================================================== */

function createHttpError(
  statusCode,
  message
) {

  const error =
    new Error(
      message
    );


  error.statusCode =
    statusCode;


  return error;
}


/* =====================================================
   RESPONSE
   ===================================================== */

function setCommonHeaders(
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );


  res.setHeader(
    "Pragma",
    "no-cache"
  );


  res.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );
}


function sendJson(
  res,
  statusCode,
  body
) {

  setCommonHeaders(
    res
  );


  return res
    .status(
      statusCode
    )
    .json(
      body
    );
}


/* =====================================================
   STRING CLEANUP
   ===================================================== */

function cleanString(
  value,
  maxLength
) {

  return String(
    value ?? ""
  )
    .replace(
      /[\u0000-\u001F\u007F]/g,
      ""
    )
    .trim()
    .slice(
      0,
      maxLength
    );
}


/* =====================================================
   JSON
   ===================================================== */

function parseJson(
  value
) {

  try {

    const parsed =
      JSON.parse(
        value
      );


    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {

      throw new Error();
    }


    return parsed;

  } catch {

    throw createHttpError(
      400,
      "Invalid JSON request body."
    );
  }
}


/* =====================================================
   BODY READER

   Handles:
   - already parsed body
   - Buffer
   - string
   - raw stream

   ===================================================== */

async function readRequestBody(
  req
) {

  const existing =
    req.body;


  /* -------------------------------------------------
     Already parsed object
     ------------------------------------------------- */

  if (
    existing &&
    typeof existing === "object" &&
    !Buffer.isBuffer(existing)
  ) {

    return existing;
  }


  /* -------------------------------------------------
     Buffer
     ------------------------------------------------- */

  if (
    Buffer.isBuffer(existing)
  ) {

    if (
      existing.length >
      MAX_REQUEST_BODY_SIZE
    ) {

      throw createHttpError(
        413,
        "Request metadata is too large."
      );
    }


    const text =
      existing
        .toString(
          "utf8"
        )
        .trim();


    if (!text) {
      return {};
    }


    return parseJson(
      text
    );
  }


  /* -------------------------------------------------
     String
     ------------------------------------------------- */

  if (
    typeof existing ===
    "string"
  ) {

    if (
      Buffer.byteLength(
        existing,
        "utf8"
      ) >
      MAX_REQUEST_BODY_SIZE
    ) {

      throw createHttpError(
        413,
        "Request metadata is too large."
      );
    }


    const text =
      existing.trim();


    if (!text) {
      return {};
    }


    return parseJson(
      text
    );
  }


  /* -------------------------------------------------
     Stream
     ------------------------------------------------- */

  const parts =
    [];


  let total =
    0;


  for await (
    const chunk
    of req
  ) {

    const buffer =
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);


    total +=
      buffer.length;


    if (
      total >
      MAX_REQUEST_BODY_SIZE
    ) {

      throw createHttpError(
        413,
        "Request metadata is too large."
      );
    }


    parts.push(
      buffer
    );
  }


  if (
    parts.length ===
    0
  ) {

    return {};
  }


  const text =
    Buffer
      .concat(
        parts
      )
      .toString(
        "utf8"
      )
      .trim();


  if (!text) {
    return {};
  }


  return parseJson(
    text
  );
}


/* =====================================================
   AUTH
   ===================================================== */

async function resolveAuthenticatedUser(
  req
) {

  let auth;


  try {

    /*
    Works whether existing auth helper
    is sync or async.
    */

    auth =
      await Promise.resolve(
        getAuthenticatedUser(
          req
        )
      );

  } catch {

    throw createHttpError(
      401,
      "Authentication required."
    );
  }


  const userId =
    auth?.userId ||
    auth?.id ||
    auth?.user?.id ||
    null;


  if (!userId) {

    throw createHttpError(
      401,
      "Authentication required."
    );
  }


  return {
    userId:
      String(
        userId
      )
  };
}


/* =====================================================
   SAFE PATH SEGMENT
   ===================================================== */

function sanitizePathSegment(
  value
) {

  return String(
    value ?? ""
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
   FILE SIZE
   ===================================================== */

function parseFileSize(
  value
) {

  const number =
    Number(
      value
    );


  if (
    !Number.isFinite(number) ||
    !Number.isSafeInteger(number)
  ) {

    return null;
  }


  return number;
}


/* =====================================================
   EXTENSION
   ===================================================== */

function cleanExtension(
  value
) {

  return String(
    value ?? ""
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


/* =====================================================
   CATEGORY
   ===================================================== */

function cleanCategory(
  value
) {

  const category =
    String(
      value ?? ""
    )
      .trim()
      .toLowerCase();


  if (
    ALLOWED_CATEGORIES.has(
      category
    )
  ) {

    return category;
  }


  return "unknown";
}


/* =====================================================
   REQUEST VALIDATION
   ===================================================== */

function validateRequestMetadata(
  body
) {

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {

    throw createHttpError(
      400,
      "Invalid attachment metadata."
    );
  }


  const uploadId =
    cleanString(
      body.uploadId,
      128
    );


  if (!uploadId) {

    throw createHttpError(
      400,
      "Upload ID is required."
    );
  }


  const bucket =
    cleanString(
      body.bucket ||
      BUCKET,
      128
    );


  if (
    bucket !==
    BUCKET
  ) {

    throw createHttpError(
      400,
      "Invalid attachment bucket."
    );
  }


  const path =
    cleanString(
      body.path,
      MAX_PATH_LENGTH
    );


  if (!path) {

    throw createHttpError(
      400,
      "Storage path is required."
    );
  }


  /*
  Storage paths must always be relative.
  */

  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("../") ||
    path.includes("/..")
  ) {

    throw createHttpError(
      400,
      "Invalid storage path."
    );
  }


  const name =
    cleanString(
      body.name,
      MAX_FILE_NAME_LENGTH
    );


  if (!name) {

    throw createHttpError(
      400,
      "File name is required."
    );
  }


  const size =
    parseFileSize(
      body.size
    );


  /*
  Older frontend versions may not send size.

  Storage download will give us the authoritative
  byte length later.

  Therefore missing size is allowed here.
  */

  if (
    size !== null &&
    (
      size <= 0 ||
      size >
      MAX_FILE_SIZE
    )
  ) {

    throw createHttpError(
      413,
      "Invalid or unsupported file size."
    );
  }


  const mime =
    cleanString(
      body.mime,
      180
    ) ||
    "application/octet-stream";


  const extension =
    cleanExtension(
      body.extension
    );


  const category =
    cleanCategory(
      body.category
    );


  return {
    uploadId,
    bucket,
    path,
    name,
    size,
    mime,
    extension,
    category
  };
}


/* =====================================================
   OWNERSHIP CHECK

   upload.js creates:

   users/{authenticatedUserId}/{uploadId}/{filename}

   process.js accepts ONLY that authenticated prefix.
   ===================================================== */

function assertPathOwnership({
  userId,
  uploadId,
  path
}) {

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

    throw createHttpError(
      403,
      "Attachment ownership validation failed."
    );
  }


  const expectedPrefix =
    `users/${safeUserId}/${safeUploadId}/`;


  if (
    !path.startsWith(
      expectedPrefix
    )
  ) {

    throw createHttpError(
      403,
      "You do not have access to this attachment."
    );
  }


  /*
  A valid path must contain an actual filename
  after the upload directory.
  */

  const fileName =
    path.slice(
      expectedPrefix.length
    );


  if (
    !fileName ||
    fileName.includes("/")
  ) {

    throw createHttpError(
      400,
      "Invalid attachment path."
    );
  }


  return {
    expectedPrefix,
    fileName
  };
}


/* =====================================================
   DOCUMENT IDs
   ===================================================== */

function createProcessId() {

  return crypto.randomUUID();
}


function createDocumentId() {

  return crypto.randomUUID();
}


/* =====================================================
   BASE DOCUMENT

   Shared by:
   - extracted documents
   - multimodal references
   - unknown file fallback
   ===================================================== */

function createBaseDocument({
  documentId,
  uploadId,
  bucket,
  path,
  name,
  mime,
  extension,
  category,
  size
}) {

  return {
    id:
      documentId,

    uploadId,

    provider:
      "supabase",

    bucket,

    path,

    name,

    mime,

    mimeType:
      mime,

    extension,

    category,

    size:
      Number(size) || 0,

    createdAt:
      new Date()
        .toISOString()
  };
}


/* =====================================================
   REFERENCE-ONLY RESULT

   Used for image/audio/video and unknown binary.

   It explicitly does NOT claim text extraction.
   ===================================================== */

function createReferenceResult({
  metadata,
  processId,
  documentId,
  parser,
  warning
}) {

  const document =
    createBaseDocument({
      documentId,
      uploadId:
        metadata.uploadId,
      bucket:
        metadata.bucket,
      path:
        metadata.path,
      name:
        metadata.name,
      mime:
        metadata.mime,
      extension:
        metadata.extension,
      category:
        metadata.category,
      size:
        metadata.size
    });


  const warnings =
    warning
      ? [warning]
      : [];


  return {
    ok:
      true,

    ready:
      true,

    processId,

    documentId,

    document,

    chunks:
      [],

    stats: {
      bytes:
        Number(
          metadata.size
        ) || 0,

      characters:
        0,

      chunks:
        0,

      processingMode:
        "storage-reference"
    },

    extraction: {
      parser,

      kind:
        metadata.category,

      extractedText:
        false,

      storageReference:
        true
    },

    warnings
  };
}


/* =====================================================
   DOWNLOAD FILE

   Private bucket; service-role server client only.
   ===================================================== */

async function downloadStorageFile({
  bucket,
  path
}) {

  const supabase =
    getSupabaseAdmin();


  const {
    data,
    error
  } =
    await supabase
      .storage
      .from(
        bucket
      )
      .download(
        path
      );


  if (error) {

    console.error(
      "[NEYO Process] Storage download failed",
      {
        path,
        message:
          error.message
      }
    );


    throw createHttpError(
      404,
      "Uploaded attachment could not be found."
    );
  }


  if (!data) {

    throw createHttpError(
      404,
      "Uploaded attachment could not be found."
    );
  }


  const arrayBuffer =
    await data.arrayBuffer();


  const buffer =
    Buffer.from(
      arrayBuffer
    );


  return buffer;
}


/* =====================================================
   EXTRACTION RESULT VALIDATION
   ===================================================== */

function normalizeExtractionResult(
  result,
  fallbackCategory
) {

  const extraction =
    result &&
    typeof result === "object"
      ? result
      : {};


  return {
    text:
      typeof extraction.text ===
      "string"
        ? extraction.text
        : "",

    parser:
      cleanString(
        extraction.parser ||
        "fallback",
        100
      ),

    kind:
      cleanString(
        extraction.kind ||
        fallbackCategory ||
        "unknown",
        64
      ),

    metadata:
      extraction.metadata &&
      typeof extraction.metadata ===
      "object" &&
      !Array.isArray(
        extraction.metadata
      )
        ? extraction.metadata
        : {},

    warnings:
      Array.isArray(
        extraction.warnings
      )
        ? extraction.warnings
            .map(
              warning =>
                cleanString(
                  warning,
                  500
                )
            )
            .filter(Boolean)
        : []
  };
}


/* =====================================================
   NORMALIZED RESULT VALIDATION

   Prevents a malformed normalize.js response
   from breaking the API contract.
   ===================================================== */

function validateNormalizedResult(
  result,
  fallbackDocument
) {

  const normalized =
    result &&
    typeof result === "object"
      ? result
      : {};


  const document =
    normalized.document &&
    typeof normalized.document ===
      "object"
      ? {
          ...fallbackDocument,
          ...normalized.document
        }
      : fallbackDocument;


  const chunks =
    Array.isArray(
      normalized.chunks
    )
      ? normalized.chunks
      : [];


  const stats =
    normalized.stats &&
    typeof normalized.stats ===
      "object"
      ? normalized.stats
      : {};


  const warnings =
    Array.isArray(
      normalized.warnings
    )
      ? normalized.warnings
      : [];


  return {
    document,
    chunks,
    stats,
    warnings
  };
}


/* =====================================================
   MAIN HANDLER
   ===================================================== */

export default async function handler(
  req,
  res
) {

  setCommonHeaders(
    res
  );


  /* -------------------------------------------------
     METHOD
     ------------------------------------------------- */

  if (
    req.method !==
    "POST"
  ) {

    res.setHeader(
      "Allow",
      "POST"
    );


    return sendJson(
      res,
      405,
      {
        ok:
          false,

        error:
          "Method not allowed."
      }
    );
  }


  try {

    /* =================================================
       AUTHENTICATION
       ================================================= */

    const user =
      await resolveAuthenticatedUser(
        req
      );


    /* =================================================
       BODY
       ================================================= */

    const body =
      await readRequestBody(
        req
      );


    const metadata =
      validateRequestMetadata(
        body
      );


    /* =================================================
       OWNERSHIP
       ================================================= */

    assertPathOwnership({
      userId:
        user.userId,

      uploadId:
        metadata.uploadId,

      path:
        metadata.path
    });


    /* =================================================
       IDS
       ================================================= */

    const processId =
      createProcessId();


    const documentId =
      createDocumentId();


    console.log(
      "[NEYO Process] start",
      {
        processId,
        documentId,

        userId:
          user.userId,

        uploadId:
          metadata.uploadId,

        name:
          metadata.name,

        category:
          metadata.category,

        mime:
          metadata.mime,

        size:
          metadata.size,

        path:
          metadata.path
      }
    );


    /* =================================================
       IMAGE / AUDIO / VIDEO

       Do NOT download here.

       api/chat.js will later consume these
       as multimodal Storage references.
       ================================================= */

    if (
      MULTIMODAL_CATEGORIES.has(
        metadata.category
      )
    ) {

      return sendJson(
        res,
        200,
        createReferenceResult({
          metadata,
          processId,
          documentId,

          parser:
            "multimodal-storage-reference",

          warning:
            null
        })
      );
    }


    /* =================================================
       UNKNOWN BINARY

       Safe fallback.

       We do not execute it.
       We do not claim to understand it.
       ================================================= */

    if (
      REFERENCE_ONLY_CATEGORIES.has(
        metadata.category
      )
    ) {

      return sendJson(
        res,
        200,
        createReferenceResult({
          metadata,
          processId,
          documentId,

          parser:
            "binary-storage-reference",

          warning:
            "This file was stored safely, but its contents were not automatically extracted."
        })
      );
    }


    /* =================================================
       EXTRACTION SIZE GUARD

       Prevent serverless memory exhaustion.

       Common text/docs should normally be much
       smaller than this.
       ================================================= */

    if (
      metadata.size !==
        null &&
      metadata.size >
        MAX_EXTRACTABLE_FILE_SIZE
    ) {

      throw createHttpError(
        413,
        `This ${metadata.category} file is too large for inline text extraction. Maximum extractable size is ${Math.round(
          MAX_EXTRACTABLE_FILE_SIZE /
          (
            1024 *
            1024
          )
        )} MB.`
      );
    }


    /* =================================================
       DOWNLOAD
       ================================================= */

    const buffer =
      await downloadStorageFile({
        bucket:
          metadata.bucket,

        path:
          metadata.path
      });


    /* =================================================
       ACTUAL SIZE CHECK

       Browser metadata is not authoritative.
       ================================================= */

    if (
      buffer.length <= 0
    ) {

      throw createHttpError(
        400,
        "Uploaded attachment is empty."
      );
    }


    if (
      buffer.length >
      MAX_FILE_SIZE
    ) {

      throw createHttpError(
        413,
        "Uploaded attachment exceeds the maximum file size."
      );
    }


    if (
      buffer.length >
      MAX_EXTRACTABLE_FILE_SIZE
    ) {

      throw createHttpError(
        413,
        `This file is too large for inline extraction. Maximum extractable size is ${Math.round(
          MAX_EXTRACTABLE_FILE_SIZE /
          (
            1024 *
            1024
          )
        )} MB.`
      );
    }


    metadata.size =
      buffer.length;


    /* =================================================
       EXTRACT

       extractors.js must NEVER execute uploaded files.

       Examples:
       txt  → UTF-8
       pdf  → pdf parser
       docx → mammoth
       xlsx → worksheet extraction
       pptx → XML text extraction
       zip  → safe archive inspection
       ================================================= */

    let extraction;


    try {

      extraction =
        await extractAttachment({
          buffer,

          name:
            metadata.name,

          mime:
            metadata.mime,

          extension:
            metadata.extension,

          category:
            metadata.category
        });

    } catch (
      error
    ) {

      console.error(
        "[NEYO Process] extraction failed",
        {
          processId,

          name:
            metadata.name,

          category:
            metadata.category,

          message:
            error?.message ||
            "Unknown extraction error"
        }
      );


      throw createHttpError(
        422,
        error?.message ||
        "The attachment could not be read."
      );
    }


    const safeExtraction =
      normalizeExtractionResult(
        extraction,
        metadata.category
      );


    /* =================================================
       BASE DOCUMENT
       ================================================= */

    const baseDocument =
      createBaseDocument({
        documentId,

        uploadId:
          metadata.uploadId,

        bucket:
          metadata.bucket,

        path:
          metadata.path,

        name:
          metadata.name,

        mime:
          metadata.mime,

        extension:
          metadata.extension,

        category:
          metadata.category,

        size:
          metadata.size
      });


    /* =================================================
       NORMALIZE + CHUNK

       normalize.js will own:
       - text cleanup
       - length limits
       - chunk generation
       - overlap
       - retrieval-friendly records
       ================================================= */

    let normalized;


    try {

      normalized =
        normalizeAttachment({
          text:
            safeExtraction.text,

          file: {
            ...baseDocument
          },

          extraction: {
            parser:
              safeExtraction.parser,

            kind:
              safeExtraction.kind,

            metadata:
              safeExtraction.metadata,

            warnings:
              safeExtraction.warnings
          }
        });

    } catch (
      error
    ) {

      console.error(
        "[NEYO Process] normalization failed",
        {
          processId,

          name:
            metadata.name,

          message:
            error?.message ||
            "Unknown normalization error"
        }
      );


      throw createHttpError(
        422,
        "Attachment text could not be normalized."
      );
    }


    const result =
      validateNormalizedResult(
        normalized,
        baseDocument
      );


    /* =================================================
       WARNINGS
       ================================================= */

    const warnings =
      [
        ...safeExtraction.warnings,
        ...result.warnings
      ]
        .map(
          value =>
            cleanString(
              value,
              500
            )
        )
        .filter(Boolean)
        .filter(
          (
            value,
            index,
            array
          ) =>
            array.indexOf(
              value
            ) === index
        );


    /* =================================================
       EXTRACTION SUMMARY

       Do not return raw Buffer.
       ================================================= */

    const extractionSummary = {
      parser:
        safeExtraction.parser,

      kind:
        safeExtraction.kind,

      extractedText:
        Boolean(
          safeExtraction.text
        ),

      characters:
        safeExtraction.text.length,

      metadata:
        safeExtraction.metadata
    };


    /* =================================================
       STATS
       ================================================= */

    const stats = {
      bytes:
        metadata.size,

      characters:
        safeExtraction.text.length,

      chunks:
        result.chunks.length,

      processingMode:
        "inline-extraction",

      ...(
        result.stats ||
        {}
      )
    };


    console.log(
      "[NEYO Process] complete",
      {
        processId,
        documentId,

        name:
          metadata.name,

        parser:
          safeExtraction.parser,

        bytes:
          metadata.size,

        characters:
          safeExtraction.text.length,

        chunks:
          result.chunks.length,

        warnings:
          warnings.length
      }
    );


    /* =================================================
       SUCCESS

       Contract consumed by attachments.js.
       ================================================= */

    return sendJson(
      res,
      200,
      {
        ok:
          true,

        ready:
          true,

        processId,

        documentId,

        document:
          result.document,

        chunks:
          result.chunks,

        stats,

        extraction:
          extractionSummary,

        warnings,

        status:
          "ready"
      }
    );


  } catch (
    error
  ) {

    const statusCode =
      Number(
        error?.statusCode
      ) || 500;


    const safeStatus =
      statusCode >= 400 &&
      statusCode <= 599
        ? statusCode
        : 500;


    /*
    Unexpected internal errors should not leak
    Supabase credentials, stack traces or internals.
    */

    const publicMessage =
      safeStatus >= 500
        ? (
            error?.statusCode
              ? error.message
              : "Could not process attachment."
          )
        : (
            error?.message ||
            "Invalid attachment processing request."
          );


    console.error(
      "[NEYO Process] request failed",
      {
        status:
          safeStatus,

        message:
          error?.message ||
          "Unknown error"
      }
    );


    return sendJson(
      res,
      safeStatus,
      {
        ok:
          false,

        ready:
          false,

        error:
          publicMessage
      }
    );
  }
}
