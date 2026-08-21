/*
=========================================================
NEYO — ATTACHMENT UPLOAD AUTHORIZATION
FINAL v1

FILE:
api/attachments/upload.js

PURPOSE:
- Authenticate current NEYO user
- Validate attachment metadata
- Generate secure user-scoped storage path
- Create Supabase signed upload URL
- Return upload contract to attachments.js

IMPORTANT:
- This endpoint DOES NOT receive file bytes.
- Browser uploads directly to Supabase Storage.
- Service role key NEVER leaves the server.
- No anonymous upload paths.
- neo.js is untouched.

FLOW:

attachments.js
    ↓
POST /api/attachments/upload
    ↓
authenticate user
    ↓
validate metadata
    ↓
users/{userId}/{uploadId}/{filename}
    ↓
Supabase createSignedUploadUrl()
    ↓
signedUrl + token
    ↓
browser uploads file directly

=========================================================
*/

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "../../lib/auth.js";


/* =====================================================
   CONFIG
   ===================================================== */

const BUCKET =
  "neyo-attachments";

const MAX_FILE_SIZE =
  100 * 1024 * 1024;

const MAX_BODY_SIZE =
  64 * 1024;

const MAX_FILE_NAME_LENGTH =
  220;

const MAX_MIME_LENGTH =
  180;

const MAX_CATEGORY_LENGTH =
  64;

const ALLOWED_CATEGORIES =
  new Set([
    "image",
    "audio",
    "video",
    "document",
    "spreadsheet",
    "presentation",
    "archive",
    "data",
    "code",
    "text",
    "unknown"
  ]);


/* =====================================================
   SUPABASE ENV
   ===================================================== */

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/* =====================================================
   SUPABASE SERVER CLIENT
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
   RESPONSE HELPERS
   ===================================================== */

function setCommonHeaders(res) {
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
  status,
  body
) {
  setCommonHeaders(
    res
  );

  return res
    .status(status)
    .json(body);
}


/* =====================================================
   REQUEST BODY READER

   Supports:
   - Vercel parsed req.body object
   - JSON string
   - Buffer
   - raw request stream

   This prevents the previous:
   "File name is required."
   issue caused by body-format mismatch.
   ===================================================== */

async function readRequestBody(req) {
  const existing =
    req.body;


  /* -----------------------------------------------------
     Already parsed object
     ----------------------------------------------------- */

  if (
    existing &&
    typeof existing === "object" &&
    !Buffer.isBuffer(existing)
  ) {
    return existing;
  }


  /* -----------------------------------------------------
     Buffer
     ----------------------------------------------------- */

  if (
    Buffer.isBuffer(existing)
  ) {
    if (
      existing.length >
      MAX_BODY_SIZE
    ) {
      throw createHttpError(
        413,
        "Request metadata is too large."
      );
    }


    const text =
      existing
        .toString("utf8")
        .trim();


    if (!text) {
      return {};
    }


    return parseJson(
      text
    );
  }


  /* -----------------------------------------------------
     String
     ----------------------------------------------------- */

  if (
    typeof existing === "string"
  ) {
    if (
      Buffer.byteLength(
        existing,
        "utf8"
      ) >
      MAX_BODY_SIZE
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


  /* -----------------------------------------------------
     Raw stream fallback
     ----------------------------------------------------- */

  const chunks =
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
      MAX_BODY_SIZE
    ) {
      throw createHttpError(
        413,
        "Request metadata is too large."
      );
    }


    chunks.push(
      buffer
    );
  }


  if (
    chunks.length ===
    0
  ) {
    return {};
  }


  const text =
    Buffer
      .concat(chunks)
      .toString("utf8")
      .trim();


  if (!text) {
    return {};
  }


  return parseJson(
    text
  );
}


/* =====================================================
   JSON PARSER
   ===================================================== */

function parseJson(text) {
  try {
    const parsed =
      JSON.parse(
        text
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
   HTTP ERROR
   ===================================================== */

function createHttpError(
  status,
  message
) {
  const error =
    new Error(
      message
    );


  error.statusCode =
    status;


  return error;
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
   SAFE FILE NAME

   Example:

   "My Report (final).pdf"

   →

   "My_Report_final.pdf"

   Keeps filename readable while preventing:
   - path traversal
   - slashes
   - control characters
   - dangerous path syntax
   ===================================================== */

function sanitizeFileName(
  value
) {
  let name =
    cleanString(
      value,
      MAX_FILE_NAME_LENGTH
    );


  /*
  Remove any fake path supplied by browser/client.
  */

  name =
    name
      .replace(
        /\\/g,
        "/"
      )
      .split("/")
      .pop() || "";


  /*
  Remove path traversal.
  */

  name =
    name.replace(
      /\.\.+/g,
      "."
    );


  /*
  Replace unsupported characters.
  */

  name =
    name.replace(
      /[^a-zA-Z0-9._()\- ]+/g,
      "_"
    );


  /*
  Spaces → underscores.
  */

  name =
    name.replace(
      /\s+/g,
      "_"
    );


  /*
  Collapse repeated underscores.
  */

  name =
    name.replace(
      /_+/g,
      "_"
    );


  /*
  Avoid hidden/dot-only names.
  */

  name =
    name.replace(
      /^\.+/,
      ""
    );


  /*
  Trim filename again.
  */

  name =
    name
      .trim()
      .slice(
        0,
        MAX_FILE_NAME_LENGTH
      );


  return name;
}


/* =====================================================
   USER ID SAFETY

   User ID comes from authentication, not browser body.

   Still sanitize it before using in Storage path.
   ===================================================== */

function sanitizePathSegment(
  value
) {
  const result =
    String(
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


  if (!result) {
    throw createHttpError(
      401,
      "Invalid authenticated user."
    );
  }


  return result;
}


/* =====================================================
   NUMBER PARSER
   ===================================================== */

function parseFileSize(
  value
) {
  const size =
    Number(
      value
    );


  if (
    !Number.isFinite(size)
  ) {
    return null;
  }


  if (
    !Number.isSafeInteger(size)
  ) {
    return null;
  }


  return size;
}


/* =====================================================
   METADATA VALIDATION
   ===================================================== */

function validateMetadata(
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


  /* -----------------------------------------------------
     NAME
     ----------------------------------------------------- */

  const originalName =
    cleanString(
      body.name,
      MAX_FILE_NAME_LENGTH
    );


  if (!originalName) {
    throw createHttpError(
      400,
      "File name is required."
    );
  }


  const name =
    sanitizeFileName(
      originalName
    );


  if (!name) {
    throw createHttpError(
      400,
      "File name is invalid."
    );
  }


  /* -----------------------------------------------------
     SIZE
     ----------------------------------------------------- */

  const size =
    parseFileSize(
      body.size
    );


  if (
    size === null
  ) {
    throw createHttpError(
      400,
      "Valid file size is required."
    );
  }


  if (
    size <= 0
  ) {
    throw createHttpError(
      400,
      "File is empty."
    );
  }


  if (
    size >
    MAX_FILE_SIZE
  ) {
    throw createHttpError(
      413,
      `File exceeds the ${Math.round(
        MAX_FILE_SIZE /
        (
          1024 *
          1024
        )
      )} MB limit.`
    );
  }


  /* -----------------------------------------------------
     MIME
     ----------------------------------------------------- */

  const mime =
    cleanString(
      body.mime,
      MAX_MIME_LENGTH
    ) ||
    "application/octet-stream";


  /* -----------------------------------------------------
     EXTENSION
     ----------------------------------------------------- */

  const extension =
    cleanString(
      body.extension,
      32
    )
      .toLowerCase()
      .replace(
        /^\./,
        ""
      )
      .replace(
        /[^a-z0-9]+/g,
        ""
      );


  /* -----------------------------------------------------
     CATEGORY
     ----------------------------------------------------- */

  let category =
    cleanString(
      body.category,
      MAX_CATEGORY_LENGTH
    )
      .toLowerCase();


  if (
    !ALLOWED_CATEGORIES.has(
      category
    )
  ) {
    category =
      "unknown";
  }


  /* -----------------------------------------------------
     CLIENT ATTACHMENT ID

     Useful only for correlating frontend state.

     Never trusted for ownership/security.
     ----------------------------------------------------- */

  const clientAttachmentId =
    cleanString(
      body.clientAttachmentId,
      128
    );


  return {
    originalName,
    name,
    size,
    mime,
    extension,
    category,
    clientAttachmentId
  };
}


/* =====================================================
   AUTHENTICATION
   ===================================================== */

async function resolveAuthenticatedUser(
  req
) {
  let auth;


  try {
    /*
    Promise.resolve supports both:
    - synchronous getAuthenticatedUser()
    - asynchronous getAuthenticatedUser()
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


  /*
  Existing NEYO auth helper uses userId.

  Also tolerate an id property without trusting
  anything coming from the request body.
  */

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
   STORAGE PATH

   Every object lives under authenticated user prefix:

   users/
     {userId}/
       {uploadId}/
         filename.ext

   Chat/process APIs can enforce the same prefix.
   ===================================================== */

function createStoragePath({
  userId,
  uploadId,
  fileName
}) {
  const safeUserId =
    sanitizePathSegment(
      userId
    );


  const safeUploadId =
    sanitizePathSegment(
      uploadId
    );


  return [
    "users",
    safeUserId,
    safeUploadId,
    fileName
  ].join("/");
}


/* =====================================================
   HANDLER
   ===================================================== */

export default async function handler(
  req,
  res
) {
  setCommonHeaders(
    res
  );


  /* -----------------------------------------------------
     METHOD
     ----------------------------------------------------- */

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


  try {
    /* ---------------------------------------------------
       AUTHENTICATE FIRST
       --------------------------------------------------- */

    const user =
      await resolveAuthenticatedUser(
        req
      );


    /* ---------------------------------------------------
       READ + VALIDATE METADATA
       --------------------------------------------------- */

    const body =
      await readRequestBody(
        req
      );


    const file =
      validateMetadata(
        body
      );


    /* ---------------------------------------------------
       SERVER-GENERATED UPLOAD ID

       Browser cannot choose storage ownership/path.
       --------------------------------------------------- */

    const uploadId =
      crypto.randomUUID();


    const path =
      createStoragePath({
        userId:
          user.userId,

        uploadId,

        fileName:
          file.name
      });


    /* ---------------------------------------------------
       DEBUG

       Never log tokens or service-role credentials.
       --------------------------------------------------- */

    console.log(
      "[NEYO Upload] authorization",
      {
        uploadId,
        userId:
          user.userId,
        name:
          file.name,
        size:
          file.size,
        mime:
          file.mime,
        category:
          file.category,
        path
      }
    );


    /* ---------------------------------------------------
       CREATE SIGNED UPLOAD URL
       --------------------------------------------------- */

    const supabase =
      getSupabaseAdmin();


    const {
      data,
      error
    } =
      await supabase
        .storage
        .from(
          BUCKET
        )
        .createSignedUploadUrl(
          path,
          {
            /*
            Every upload receives a unique UUID path,
            so overwriting should never be necessary.
            */

            upsert:
              false
          }
        );


    if (error) {
      console.error(
        "[NEYO Upload] Supabase signing failed",
        {
          uploadId,
          message:
            error.message,
          status:
            error.statusCode ||
            error.status ||
            null
        }
      );


      throw createHttpError(
        502,
        "Could not prepare file upload."
      );
    }


    if (
      !data?.signedUrl
    ) {
      console.error(
        "[NEYO Upload] Missing signedUrl",
        {
          uploadId,
          hasData:
            Boolean(data)
        }
      );


      throw createHttpError(
        502,
        "Storage did not return a signed upload URL."
      );
    }


    if (
      !data?.token
    ) {
      console.error(
        "[NEYO Upload] Missing signed token",
        {
          uploadId
        }
      );


      throw createHttpError(
        502,
        "Storage did not return a signed upload token."
      );
    }


    /* ---------------------------------------------------
       SUCCESS

       Contract matches attachments.js.
       --------------------------------------------------- */

    return sendJson(
      res,
      200,
      {
        ok:
          true,

        uploadId,

        bucket:
          BUCKET,

        path:
          data.path ||
          path,

        signedUrl:
          data.signedUrl,

        token:
          data.token,

        /*
        Supabase uploadToSignedUrl uses PUT.
        attachments.js currently performs the
        signed request directly.
        */

        method:
          "PUT",

        headers: {
          "x-upsert":
            "false"
        },

        file: {
          name:
            file.name,

          originalName:
            file.originalName,

          size:
            file.size,

          mime:
            file.mime,

          extension:
            file.extension,

          category:
            file.category
        },

        clientAttachmentId:
          file.clientAttachmentId,

        status:
          "authorized"
      }
    );


  } catch (
    error
  ) {
    const status =
      Number(
        error?.statusCode
      ) || 500;


    const safeStatus =
      status >= 400 &&
      status <= 599
        ? status
        : 500;


    /*
    Never expose internal Supabase/service errors
    to browser for unexpected failures.
    */

    const message =
      safeStatus >= 500
        ? (
            error?.statusCode
              ? error.message
              : "Could not prepare attachment upload."
          )
        : (
            error?.message ||
            "Invalid upload request."
          );


    console.error(
      "[NEYO Upload] request failed",
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

        error:
          message
      }
    );
  }
}
