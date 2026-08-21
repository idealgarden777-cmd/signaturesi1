/*
=========================================================
NEYO — ATTACHMENT PROCESSOR API v2

Purpose:
- Validate uploaded attachment reference
- Verify storage ownership
- Download private object from Supabase Storage
- Extract raw content
- Normalize + chunk extracted content
- Return model-ready attachment structure
- Keep large files safe for future background processing

Requires:
- @supabase/supabase-js
- lib/attachments/extractors.js
- lib/attachments/normalize.js

Environment:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- ATTACHMENTS_BUCKET
=========================================================
*/

import crypto from "node:crypto";

import {
  createClient
} from "@supabase/supabase-js";

import {
  extractAttachment
} from "../../lib/attachments/extractors.js";

import {
  normalizeAttachment,
  buildRetrievalRecords
} from "../../lib/attachments/normalize.js";


/* =========================================================
   CONFIG
   ========================================================= */

const BUCKET =
  process.env.ATTACHMENTS_BUCKET ||
  "neyo-attachments";


const MAX_FILE_SIZE =
  100 * 1024 * 1024;


const MAX_INLINE_PROCESS_SIZE =
  25 * 1024 * 1024;


const MAX_FILENAME_LENGTH =
  220;


const MAX_PATH_LENGTH =
  1000;


const MAX_RESPONSE_CHUNKS =
  60;


/* =========================================================
   CATEGORY POLICY
   ========================================================= */

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


/* =========================================================
   BLOCKED EXECUTABLE EXTENSIONS
   ========================================================= */

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


/* =========================================================
   JSON
   ========================================================= */

function sendJson(
  res,
  status,
  body
) {

  res.status(status);

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  return res.end(
    JSON.stringify(body)
  );
}


/* =========================================================
   BODY
   ========================================================= */

function readBody(
  req
) {

  if (
    req.body &&
    typeof req.body === "object"
  ) {

    return req.body;
  }


  if (
    typeof req.body === "string"
  ) {

    try {

      return JSON.parse(
        req.body
      );

    } catch {

      return {};
    }
  }


  return {};
}


/* =========================================================
   STRING HELPERS
   ========================================================= */

function cleanString(
  value,
  maxLength = 500
) {

  return String(
    value || ""
  )
    .normalize("NFKC")
    .trim()
    .slice(
      0,
      maxLength
    );
}


function getExtension(
  filename
) {

  const name =
    String(
      filename || ""
    );


  const index =
    name.lastIndexOf(".");


  if (
    index === -1 ||
    index === name.length - 1
  ) {

    return "";
  }


  return name
    .slice(
      index + 1
    )
    .toLowerCase();
}


/* =========================================================
   AUTH / USER

   Replace this with your real Signaturesi auth resolver.
   Never trust userId from request body.
   ========================================================= */

function resolveUserId(
  req
) {

  const raw =
    req.headers[
      "x-neyo-user-id"
    ];


  if (
    typeof raw === "string" &&
    raw.trim()
  ) {

    const safe =
      raw
        .trim()
        .replace(
          /[^a-zA-Z0-9_-]/g,
          ""
        )
        .slice(
          0,
          100
        );


    if (safe) {
      return safe;
    }
  }


  return "anonymous";
}


/* =========================================================
   REQUEST VALIDATION
   ========================================================= */

function validateRequest(
  body
) {

  const uploadId =
    cleanString(
      body?.uploadId,
      100
    );


  const path =
    cleanString(
      body?.path,
      MAX_PATH_LENGTH
    );


  const name =
    cleanString(
      body?.name,
      MAX_FILENAME_LENGTH
    );


  const mime =
    cleanString(
      body?.mime ||
      "application/octet-stream",
      200
    )
      .toLowerCase();


  const category =
    cleanString(
      body?.category ||
      "unknown",
      50
    )
      .toLowerCase();


  const extension =
    cleanString(
      body?.extension ||
      getExtension(name),
      30
    )
      .toLowerCase();


  if (!uploadId) {

    return {
      ok:
        false,

      error:
        "Upload ID is required."
    };
  }


  if (!path) {

    return {
      ok:
        false,

      error:
        "Storage path is required."
    };
  }


  if (!name) {

    return {
      ok:
        false,

      error:
        "File name is required."
    };
  }


  if (
    !ALLOWED_CATEGORIES.has(
      category
    )
  ) {

    return {
      ok:
        false,

      error:
        "Invalid attachment category."
    };
  }


  if (
    BLOCKED_EXTENSIONS.has(
      extension
    )
  ) {

    return {
      ok:
        false,

      error:
        "Executable files cannot be processed."
    };
  }


  return {
    ok:
      true,

    value: {
      uploadId,
      path,
      name,
      mime,
      category,
      extension
    }
  };
}


/* =========================================================
   PATH OWNERSHIP
   ========================================================= */

function validateOwnershipPath({
  path,
  userId
}) {

  const normalized =
    String(
      path || ""
    )
      .replace(
        /\\/g,
        "/"
      );


  if (
    normalized.includes("..") ||
    normalized.startsWith("/")
  ) {

    return false;
  }


  const expectedPrefix =
    `users/${userId}/`;


  return normalized.startsWith(
    expectedPrefix
  );
}


/* =========================================================
   RESPONSE-SAFE CHUNKS

   Don't dump hundreds of chunks into a single API response.
   Full indexing records can later be stored in DB/vector store.
   ========================================================= */

function createResponseChunks(
  normalized
) {

  if (
    !Array.isArray(
      normalized?.chunks
    )
  ) {

    return [];
  }


  return normalized
    .chunks
    .slice(
      0,
      MAX_RESPONSE_CHUNKS
    )
    .map(
      chunk => ({

        id:
          chunk.id,

        index:
          chunk.index,

        heading:
          chunk.heading,

        startChar:
          chunk.startChar,

        endChar:
          chunk.endChar,

        characters:
          chunk.characters,

        text:
          chunk.text,

        source:
          chunk.source
      })
    );
}


/* =========================================================
   HANDLER
   ========================================================= */

export default async function handler(
  req,
  res
) {

  /* -------------------------------------------------------
     POST ONLY
     ------------------------------------------------------- */

  if (
    req.method !== "POST"
  ) {

    res.setHeader(
      "Allow",
      "POST"
    );


    return sendJson(
      res,
      405,
      {
        error:
          "Method not allowed."
      }
    );
  }


  /* -------------------------------------------------------
     ENV
     ------------------------------------------------------- */

  const supabaseUrl =
    process.env.SUPABASE_URL;


  const serviceRoleKey =
    process.env
      .SUPABASE_SERVICE_ROLE_KEY;


  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {

    console.error(
      "[NEYO Attachment Processor] Supabase environment missing."
    );


    return sendJson(
      res,
      500,
      {
        error:
          "Attachment processing is not configured."
      }
    );
  }


  /* -------------------------------------------------------
     REQUEST
     ------------------------------------------------------- */

  const body =
    readBody(
      req
    );


  const validation =
    validateRequest(
      body
    );


  if (
    !validation.ok
  ) {

    return sendJson(
      res,
      400,
      {
        error:
          validation.error
      }
    );
  }


  const attachment =
    validation.value;


  /* -------------------------------------------------------
     USER
     ------------------------------------------------------- */

  const userId =
    resolveUserId(
      req
    );


  /* -------------------------------------------------------
     OWNERSHIP CHECK
     ------------------------------------------------------- */

  if (
    !validateOwnershipPath({
      path:
        attachment.path,

      userId
    })
  ) {

    console.warn(
      "[NEYO Attachment Processor] Invalid ownership path",
      {
        userId,
        path:
          attachment.path
      }
    );


    return sendJson(
      res,
      403,
      {
        error:
          "You do not have access to this attachment."
      }
    );
  }


  /* -------------------------------------------------------
     IDS
     ------------------------------------------------------- */

  const processId =
    crypto.randomUUID();


  const documentId =
    crypto.randomUUID();


  try {

    /* -----------------------------------------------------
       SUPABASE
       ----------------------------------------------------- */

    const supabase =
      createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            persistSession:
              false,

            autoRefreshToken:
              false
          }
        }
      );


    /* -----------------------------------------------------
       DOWNLOAD
       ----------------------------------------------------- */

    const {
      data: blob,
      error: downloadError
    } =
      await supabase
        .storage
        .from(
          BUCKET
        )
        .download(
          attachment.path
        );


    if (
      downloadError ||
      !blob
    ) {

      throw (
        downloadError ||
        new Error(
          "Stored attachment could not be downloaded."
        )
      );
    }


    const size =
      Number(
        blob.size
      ) ||
      0;


    if (
      size <= 0
    ) {

      return sendJson(
        res,
        400,
        {
          error:
            "Uploaded file is empty."
        }
      );
    }


    if (
      size >
      MAX_FILE_SIZE
    ) {

      return sendJson(
        res,
        413,
        {
          error:
            "Uploaded file exceeds the processing limit."
        }
      );
    }


    /* -----------------------------------------------------
       LARGE FILE POLICY
       ----------------------------------------------------- */

    if (
      size >
      MAX_INLINE_PROCESS_SIZE
    ) {

      console.log(
        "[NEYO Attachment Processor] Background processing required",
        {
          processId,
          documentId,
          uploadId:
            attachment.uploadId,
          name:
            attachment.name,
          size
        }
      );


      return sendJson(
        res,
        202,
        {

          processId,


          documentId,


          uploadId:
            attachment.uploadId,


          status:
            "queued",


          ready:
            false,


          extracted:
            false,


          processingMode:
            "background",


          file: {

            name:
              attachment.name,

            mime:
              attachment.mime,

            extension:
              attachment.extension,

            category:
              attachment.category,

            size,

            path:
              attachment.path
          },


          message:
            "Large attachment accepted for background processing."
        }
      );
    }


    /* -----------------------------------------------------
       BLOB → BUFFER
       ----------------------------------------------------- */

    const arrayBuffer =
      await blob.arrayBuffer();


    const buffer =
      Buffer.from(
        arrayBuffer
      );


    /* -----------------------------------------------------
       RAW EXTRACTION
       ----------------------------------------------------- */

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
          attachment.category,


        size
      });


    /* -----------------------------------------------------
       NORMALIZATION + CHUNKING
       ----------------------------------------------------- */

    const normalized =
      normalizeAttachment(
        extraction,
        {

          documentId,


          uploadId:
            attachment.uploadId,


          processId,


          storagePath:
            attachment.path
        }
      );


    /* -----------------------------------------------------
       RETRIEVAL RECORDS

       These are ready for future:
       - embeddings
       - Supabase pgvector
       - semantic retrieval

       For now we only count them.
       ----------------------------------------------------- */

    const retrievalRecords =
      buildRetrievalRecords(
        normalized
      );


    const responseChunks =
      createResponseChunks(
        normalized
      );


    const responseChunksTruncated =
      normalized
        .chunks
        .length >
      responseChunks.length;


    /* -----------------------------------------------------
       SUCCESS
       ----------------------------------------------------- */

    console.log(
      "[NEYO Attachment Processor] Complete",
      {

        processId,


        documentId,


        uploadId:
          attachment.uploadId,


        name:
          attachment.name,


        category:
          attachment.category,


        parser:
          extraction.parser,


        extracted:
          extraction.extracted,


        normalizedReady:
          normalized.ready,


        chunks:
          normalized.chunks.length,


        characters:
          normalized.stats.characters
      }
    );


    return sendJson(
      res,
      200,
      {

        processId,


        documentId,


        uploadId:
          attachment.uploadId,


        status:
          "ready",


        ready:
          normalized.ready,


        extracted:
          Boolean(
            extraction.extracted
          ),


        processingMode:
          "inline",


        file: {

          name:
            attachment.name,

          mime:
            attachment.mime,

          extension:
            attachment.extension,

          category:
            attachment.category,

          size,

          bucket:
            BUCKET,

          path:
            attachment.path
        },


        /* -------------------------------------------------
           RAW EXTRACTION SUMMARY
           ------------------------------------------------- */

        extraction: {

          type:
            extraction.type,


          parser:
            extraction.parser,


          extracted:
            extraction.extracted,


          truncated:
            extraction.truncated,


          warnings:
            extraction.warnings,


          metadata:
            extraction.metadata
        },


        /* -------------------------------------------------
           NORMALIZED DOCUMENT
           ------------------------------------------------- */

        document:
          normalized.document,


        /* -------------------------------------------------
           MODEL / RETRIEVAL CHUNKS
           ------------------------------------------------- */

        chunks:
          responseChunks,


        chunksTruncatedInResponse:
          responseChunksTruncated,


        totalChunks:
          normalized.chunks.length,


        retrievalRecords:
          retrievalRecords.length,


        /* -------------------------------------------------
           STATS
           ------------------------------------------------- */

        stats:
          normalized.stats,


        warnings:
          normalized.warnings,


        metadata: {

          storageBucket:
            BUCKET,

          storagePath:
            attachment.path,

          originalName:
            attachment.name,

          mime:
            attachment.mime,

          extension:
            attachment.extension,

          category:
            attachment.category,

          size
        }
      }
    );


  } catch (error) {

    console.error(
      "[NEYO Attachment Processor] Failed",
      {

        processId,


        documentId,


        uploadId:
          attachment.uploadId,


        name:
          attachment.name,


        message:
          error?.message
      }
    );


    const rawMessage =
      String(
        error?.message ||
        ""
      );


    const safeMessage =
      rawMessage &&
      rawMessage.length < 300
        ? rawMessage
        : "Could not process attachment.";


    return sendJson(
      res,
      500,
      {

        processId,


        documentId,


        uploadId:
          attachment.uploadId,


        status:
          "error",


        ready:
          false,


        extracted:
          false,


        error:
          safeMessage ||
          "Could not process attachment."
      }
    );
  }
}
