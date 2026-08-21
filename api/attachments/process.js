/*
=========================================================
NEYO — ATTACHMENT PROCESSOR API v1

Purpose:
- Validate uploaded attachment reference
- Verify file belongs to current user
- Download private object from Supabase Storage
- Detect normalized file type
- Run safe extraction pipeline
- Return model-ready extraction metadata
- Never execute uploaded files
- Gracefully handle unsupported formats

Flow:
Browser
  ↓
Supabase Storage upload complete
  ↓
POST /api/attachments/process
  ↓
validate
  ↓
verify path ownership
  ↓
download private object
  ↓
extractAttachment()
  ↓
normalize result
  ↓
return processId + extracted content metadata

Requires:
- @supabase/supabase-js
- lib/attachments/extractors.js

Environment:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- ATTACHMENTS_BUCKET (optional)
=========================================================
*/

import crypto from "node:crypto";

import {
  createClient
} from "@supabase/supabase-js";

import {
  extractAttachment
} from "../../lib/attachments/extractors.js";


/* =========================================================
   CONFIG
   ========================================================= */

const BUCKET =
  process.env.ATTACHMENTS_BUCKET ||
  "neyo-attachments";


/*
Maximum uploaded object size we will accept
for processing.

Upload API currently allows 100 MB.
*/

const MAX_FILE_SIZE =
  100 * 1024 * 1024;


/*
Inline extraction should remain conservative
inside a serverless function.

Heavy media / huge documents should later move
to a background worker.
*/

const MAX_INLINE_PROCESS_SIZE =
  25 * 1024 * 1024;


const MAX_FILENAME_LENGTH =
  220;


const MAX_PATH_LENGTH =
  1000;


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
    typeof req.body ===
      "object"
  ) {

    return req.body;
  }


  if (
    typeof req.body ===
      "string"
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
    index ===
      name.length - 1
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
   USER ID

   IMPORTANT:
   Replace this with your real Signaturesi auth resolver.

   Never trust a userId sent inside request body.
   ========================================================= */

function resolveUserId(
  req
) {

  const raw =
    req.headers[
      "x-neyo-user-id"
    ];


  if (
    typeof raw ===
      "string" &&
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
   PATH SECURITY
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


  /*
  Prevent basic path traversal.
  */

  if (
    normalized.includes(
      ".."
    )
  ) {

    return false;
  }


  if (
    normalized.startsWith(
      "/"
    )
  ) {

    return false;
  }


  /*
  Upload API creates:
  users/{userId}/YYYY/MM/DD/{attachmentId}/file.ext
  */

  const expectedPrefix =
    `users/${userId}/`;


  return normalized.startsWith(
    expectedPrefix
  );
}


/* =========================================================
   FILE SIZE
   ========================================================= */

function getBlobSize(
  blob
) {

  const size =
    Number(
      blob?.size
    );


  if (
    !Number.isFinite(size)
  ) {

    return 0;
  }


  return size;
}


/* =========================================================
   EXTRACTION RESULT SANITIZER
   ========================================================= */

function normalizeExtractionResult(
  result
) {

  const value =
    result &&
    typeof result ===
      "object"
      ? result
      : {};


  return {

    extracted:
      Boolean(
        value.extracted
      ),


    /*
    Human/model readable text.

    extractors.js should already enforce
    its own text-size limits.
    */

    text:
      typeof value.text ===
        "string"
        ? value.text
        : "",


    /*
    Structured data such as:
    sheets, pages, dimensions, duration etc.
    */

    metadata:
      value.metadata &&
      typeof value.metadata ===
        "object"
        ? value.metadata
        : {},


    type:
      cleanString(
        value.type ||
        "unknown",
        100
      ),


    parser:
      cleanString(
        value.parser ||
        "none",
        100
      ),


    truncated:
      Boolean(
        value.truncated
      ),


    warnings:
      Array.isArray(
        value.warnings
      )
        ? value.warnings
            .map(
              warning =>
                cleanString(
                  warning,
                  500
                )
            )
            .filter(Boolean)
            .slice(
              0,
              20
            )
        : []
  };
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
     OWNERSHIP
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
     PROCESS ID
     ------------------------------------------------------- */

  const processId =
    crypto.randomUUID();


  try {

    /* -----------------------------------------------------
       SUPABASE ADMIN CLIENT
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
       DOWNLOAD PRIVATE OBJECT
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


    /* -----------------------------------------------------
       SIZE VALIDATION
       ----------------------------------------------------- */

    const size =
      getBlobSize(
        blob
      );


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

      /*
      We intentionally do NOT try to parse huge documents
      inside a normal serverless request.

      Later:
      enqueue background processing job here.
      */

      console.log(
        "[NEYO Attachment Processor] Large file queued",
        {
          processId,
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

            size
          },


          message:
            "Large attachment accepted for background processing."
        }
      );
    }


    /* -----------------------------------------------------
       BLOB → ARRAYBUFFER
       ----------------------------------------------------- */

    const arrayBuffer =
      await blob.arrayBuffer();


    const buffer =
      Buffer.from(
        arrayBuffer
      );


    /* -----------------------------------------------------
       EXTRACTION

       Actual format-specific logic belongs in:
       lib/attachments/extractors.js
       ----------------------------------------------------- */

    const rawExtraction =
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


    const extraction =
      normalizeExtractionResult(
        rawExtraction
      );


    /* -----------------------------------------------------
       SUCCESS
       ----------------------------------------------------- */

    console.log(
      "[NEYO Attachment Processor] Complete",
      {

        processId,


        uploadId:
          attachment.uploadId,


        file:
          attachment.name,


        size,


        category:
          attachment.category,


        parser:
          extraction.parser,


        extracted:
          extraction.extracted,


        truncated:
          extraction.truncated
      }
    );


    return sendJson(
      res,
      200,
      {

        processId,


        uploadId:
          attachment.uploadId,


        status:
          "ready",


        ready:
          true,


        extracted:
          extraction.extracted,


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

          path:
            attachment.path
        },


        extraction: {

          type:
            extraction.type,


          parser:
            extraction.parser,


          text:
            extraction.text,


          truncated:
            extraction.truncated,


          warnings:
            extraction.warnings
        },


        metadata: {
          ...extraction.metadata,

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


        uploadId:
          attachment.uploadId,


        name:
          attachment.name,


        message:
          error?.message
      }
    );


    const message =
      String(
        error?.message ||
        ""
      );


    /*
    Don't expose arbitrary internal stack traces.
    */

    const safeMessage =
      message &&
      message.length <
        300
        ? message
        : "Could not process attachment.";


    return sendJson(
      res,
      500,
      {

        processId,


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
