/*
=========================================================
NEYO — ATTACHMENT UPLOAD AUTHORIZATION
STABLE v3

FILE:
api/attachments/upload.js

RESPONSIBILITIES
---------------------------------------------------------
✅ Authenticate user
✅ Validate upload metadata
✅ Validate size / MIME / filename
✅ Verify storage bucket exists
✅ Create tenant-isolated storage path
✅ Create Supabase signed upload token
✅ Return clean upload session

IMPORTANT
---------------------------------------------------------
This endpoint DOES NOT receive file bytes.

Frontend should upload with:

supabase.storage
  .from(bucket)
  .uploadToSignedUrl(path, token, file, {
    contentType: file.type
  });

=========================================================
*/

import crypto from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import {
  getAuthenticatedUser
} from "../../lib/auth.js";


/* =====================================================
   CONFIG
   ===================================================== */

const BUCKET =
  "neyo-attachments";


const MAX_FILE_SIZE =
  100 * 1024 * 1024;


const MAX_BODY_SIZE =
  64 * 1024;


const MAX_FILENAME_LENGTH =
  220;


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


const ALLOWED_MIME_TYPES =
  new Set([
    "image/jpeg",
    "image/png",
    "image/webp",

    "application/pdf",

    "text/plain",
    "text/html",
    "text/css",

    "application/javascript",
    "text/javascript",

    "application/json",

    "audio/mpeg",
    "audio/wav",

    "video/mp4",
    "video/webm",

    "application/octet-stream"
  ]);


/* =====================================================
   ENV
   ===================================================== */

function cleanEnv(value) {
  return typeof value === "string"
    ? value
        .trim()
        .replace(/^["']|["']$/g, "")
    : "";
}


/* =====================================================
   SUPABASE ADMIN
   ===================================================== */

function createSupabaseAdmin() {
  const url =
    cleanEnv(
      process.env.SUPABASE_URL
    );


  const serviceRoleKey =
    cleanEnv(
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );


  if (!url) {
    throw new Error(
      "SUPABASE_URL is missing."
    );
  }


  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing."
    );
  }


  return createClient(
    url,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },

      global: {
        headers: {
          "X-Client-Info":
            "signaturesi-neyo-upload-v3"
        }
      }
    }
  );
}


/* =====================================================
   RESPONSE HEADERS
   ===================================================== */

function setHeaders(res) {
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
   JSON BODY
   ===================================================== */

async function readJsonBody(req) {
  if (
    req.body &&
    typeof req.body === "object" &&
    !Buffer.isBuffer(req.body) &&
    !Array.isArray(req.body)
  ) {
    return req.body;
  }


  if (Buffer.isBuffer(req.body)) {
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
        req.body.toString("utf8")
      );
    } catch {
      throw new Error(
        "Invalid JSON request body."
      );
    }
  }


  if (
    typeof req.body === "string"
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


  const chunks = [];

  let total = 0;


  for await (
    const chunk
    of req
  ) {
    total += chunk.length;


    if (
      total >
      MAX_BODY_SIZE
    ) {
      throw new Error(
        "Request body is too large."
      );
    }


    chunks.push(chunk);
  }


  if (
    chunks.length === 0
  ) {
    return {};
  }


  const raw =
    Buffer
      .concat(chunks)
      .toString("utf8");


  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      "Invalid JSON request body."
    );
  }
}


/* =====================================================
   STRING HELPERS
   ===================================================== */

function cleanString(
  value,
  maxLength = 512
) {
  return String(
    value ?? ""
  )
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}


/* =====================================================
   SAFE PATH
   ===================================================== */

function sanitizePathSegment(
  value,
  fallback = "file"
) {
  const cleaned =
    String(
      value ?? ""
    )
      .normalize("NFKC")
      .replace(
        /[\u0000-\u001f\u007f]/g,
        ""
      )
      .replace(
        /[^a-zA-Z0-9._-]+/g,
        "_"
      )
      .replace(
        /_+/g,
        "_"
      )
      .replace(
        /^[._-]+/,
        ""
      )
      .replace(
        /[._-]+$/,
        ""
      )
      .slice(0, 180);


  return cleaned || fallback;
}


/* =====================================================
   EXTENSION
   ===================================================== */

function getExtensionFromName(
  filename
) {
  const name =
    String(
      filename ?? ""
    );


  const lastDot =
    name.lastIndexOf(".");


  if (
    lastDot <= 0 ||
    lastDot ===
      name.length - 1
  ) {
    return "";
  }


  return normalizeExtension(
    name.slice(
      lastDot + 1
    )
  );
}


function normalizeExtension(
  value
) {
  return String(
    value ?? ""
  )
    .trim()
    .toLowerCase()
    .replace(/^\./, "")
    .replace(
      /[^a-z0-9]/g,
      ""
    )
    .slice(0, 32);
}


/* =====================================================
   CATEGORY
   ===================================================== */

function normalizeCategory(
  value
) {
  const category =
    String(
      value ?? ""
    )
      .trim()
      .toLowerCase();


  return ALLOWED_CATEGORIES
    .has(category)
      ? category
      : "unknown";
}


/* =====================================================
   FILENAME
   ===================================================== */

function buildSafeFilename(
  originalName,
  requestedExtension
) {
  const original =
    cleanString(
      originalName,
      MAX_FILENAME_LENGTH
    );


  const detectedExtension =
    getExtensionFromName(
      original
    );


  const requested =
    normalizeExtension(
      requestedExtension
    );


  const extension =
    requested ||
    detectedExtension;


  let baseName =
    original;


  const lastDot =
    original.lastIndexOf(".");


  if (
    lastDot > 0
  ) {
    baseName =
      original.slice(
        0,
        lastDot
      );
  }


  baseName =
    sanitizePathSegment(
      baseName,
      "attachment"
    );


  if (!extension) {
    return baseName;
  }


  return `${baseName}.${extension}`;
}


/* =====================================================
   MIME
   ===================================================== */

function normalizeMime(value) {
  const mime =
    cleanString(
      value ||
      "application/octet-stream",
      180
    )
      .toLowerCase()
      .split(";")[0]
      .trim();


  return (
    mime ||
    "application/octet-stream"
  );
}


/* =====================================================
   VALIDATION
   ===================================================== */

function validatePayload(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw new Error(
      "Invalid upload metadata."
    );
  }


  const name =
    cleanString(
      body.name,
      MAX_FILENAME_LENGTH
    );


  const size =
    Number(
      body.size
    );


  const mime =
    normalizeMime(
      body.mime
    );


  const extension =
    normalizeExtension(
      body.extension
    );


  const category =
    normalizeCategory(
      body.category
    );


  const clientAttachmentId =
    cleanString(
      body.clientAttachmentId,
      128
    );


  if (!name) {
    throw new Error(
      "File name is required."
    );
  }


  if (
    !Number.isSafeInteger(size) ||
    size <= 0
  ) {
    throw new Error(
      "Invalid file size."
    );
  }


  if (
    size >
    MAX_FILE_SIZE
  ) {
    throw new Error(
      "File exceeds the 100 MB upload limit."
    );
  }


  if (
    !ALLOWED_MIME_TYPES.has(
      mime
    )
  ) {
    throw new Error(
      "Unsupported file type."
    );
  }


  return {
    name,
    size,
    mime,
    extension,
    category,
    clientAttachmentId
  };
}


/* =====================================================
   SAFE ERROR MESSAGE
   ===================================================== */

function publicError(error) {
  const message =
    String(
      error?.message ||
      ""
    );


  const allowed =
    [
      "File name",
      "Invalid file size",
      "upload limit",
      "Invalid upload metadata",
      "Unsupported file type",
      "Request body",
      "Invalid JSON"
    ];


  if (
    allowed.some(
      phrase =>
        message.includes(phrase)
    )
  ) {
    return message;
  }


  return (
    "Unable to prepare this file for upload."
  );
}


/* =====================================================
   HANDLER
   ===================================================== */

export default async function handler(
  req,
  res
) {
  setHeaders(res);


  /* ===================================================
     METHOD
     =================================================== */

  if (
    req.method !== "POST"
  ) {
    res.setHeader(
      "Allow",
      "POST"
    );


    return res
      .status(405)
      .json({
        ok: false,
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
        getAuthenticatedUser(req)
      );
  } catch (error) {
    console.error(
      "[NEYO Attachment Upload] Auth failed:",
      error?.message
    );


    return res
      .status(401)
      .json({
        ok: false,
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
      .status(401)
      .json({
        ok: false,
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
      await readJsonBody(req);
  } catch (error) {
    return res
      .status(400)
      .json({
        ok: false,
        error:
          publicError(error)
      });
  }


  /* ===================================================
     VALIDATION
     =================================================== */

  let file;


  try {
    file =
      validatePayload(body);
  } catch (error) {
    return res
      .status(400)
      .json({
        ok: false,
        error:
          publicError(error)
      });
  }


  /* ===================================================
     SUPABASE
     =================================================== */

  let supabase;


  try {
    supabase =
      createSupabaseAdmin();
  } catch (error) {
    console.error(
      "[NEYO Attachment Upload] Supabase config:",
      error?.message
    );


    return res
      .status(500)
      .json({
        ok: false,
        error:
          "Attachment storage is not configured."
      });
  }


  try {
    /* =================================================
       VERIFY BUCKET
       ================================================= */

    const {
      data: bucketData,
      error: bucketError
    } =
      await supabase
        .storage
        .getBucket(
          BUCKET
        );


    if (
      bucketError ||
      !bucketData
    ) {
      console.error(
        "[NEYO Attachment Upload] Bucket missing:",
        {
          bucket: BUCKET,
          message:
            bucketError?.message
        }
      );


      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Attachment storage bucket is unavailable."
        });
    }


    /* =================================================
       PATH
       ================================================= */

    const uploadId =
      crypto.randomUUID();


    const safeUserId =
      sanitizePathSegment(
        userId,
        "user"
      );


    const safeFilename =
      buildSafeFilename(
        file.name,
        file.extension
      );


    const path =
      [
        "users",
        safeUserId,
        uploadId,
        safeFilename
      ].join("/");


    /* =================================================
       CREATE SIGNED UPLOAD TOKEN
       ================================================= */

    const {
      data,
      error
    } =
      await supabase
        .storage
        .from(BUCKET)
        .createSignedUploadUrl(
          path,
          {
            upsert: false
          }
        );


    if (error) {
      throw error;
    }


    if (
      !data?.token
    ) {
      throw new Error(
        "Supabase did not return an upload token."
      );
    }


    if (
      !data?.signedUrl
    ) {
      throw new Error(
        "Supabase did not return a signed upload URL."
      );
    }


    /* =================================================
       SUCCESS
       ================================================= */

    console.log(
      "[NEYO Attachment Upload] Authorized",
      {
        userId,
        uploadId,
        bucket: BUCKET,
        path,
        name: file.name,
        size: file.size,
        mime: file.mime,
        category:
          file.category
      }
    );


    return res
      .status(200)
      .json({
        ok: true,

        status:
          "authorized",

        uploadId,

        bucket:
          BUCKET,

        path,

        token:
          data.token,

        signedUrl:
          data.signedUrl,

        uploadMethod:
          "supabase-uploadToSignedUrl",

        file: {
          name:
            safeFilename,

          originalName:
            file.name,

          size:
            file.size,

          mime:
            file.mime,

          extension:
            file.extension ||
            getExtensionFromName(
              file.name
            ),

          category:
            file.category
        },

        clientAttachmentId:
          file.clientAttachmentId ||
          null
      });
  } catch (error) {
    console.error(
      "[NEYO Attachment Upload] Failed",
      {
        message:
          error?.message,

        code:
          error?.code,

        status:
          error?.status,

        statusCode:
          error?.statusCode,

        details:
          error?.details,

        hint:
          error?.hint
      }
    );


    return res
      .status(500)
      .json({
        ok: false,
        error:
          "Unable to prepare this file for upload."
      });
  }
}
