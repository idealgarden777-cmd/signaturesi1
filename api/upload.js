/*
=========================================================
NEYO — ATTACHMENT UPLOAD AUTHORIZATION
FINAL v3

FILE:
api/attachments/upload.js

RESPONSIBILITIES
---------------------------------------------------------
✅ Authenticate user from server-side session
✅ Validate file metadata
✅ Enforce upload size limit
✅ Create isolated user storage path
✅ Create signed Supabase upload URL
✅ Return upload session to frontend

DOES NOT:
❌ Receive file bytes
❌ Parse files
❌ Process files
❌ Touch chat
❌ Trust user ID from browser
=========================================================
*/

import crypto from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { getAuthenticatedUser } from "../../lib/auth.js";


/* =====================================================
   CONFIG
   ===================================================== */

const BUCKET =
  process.env.ATTACHMENTS_BUCKET ||
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

  const key =
    cleanEnv(
      process.env.SUPABASE_SERVICE_ROLE_KEY
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
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },

      global: {
        headers: {
          "X-Client-Info":
            "signaturesi-neyo-attachment-upload"
        }
      }
    }
  );
}


/* =====================================================
   JSON HEADERS
   ===================================================== */

function setJsonHeaders(res) {
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
   REQUEST BODY
   ===================================================== */

async function readJsonBody(req) {
  /*
   * Vercel usually pre-parses JSON.
   */

  if (
    req.body &&
    typeof req.body === "object" &&
    !Buffer.isBuffer(req.body) &&
    !Array.isArray(req.body)
  ) {
    return req.body;
  }


  /*
   * Buffer body.
   */

  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > MAX_BODY_SIZE) {
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


  /*
   * String body.
   */

  if (typeof req.body === "string") {
    if (
      Buffer.byteLength(
        req.body,
        "utf8"
      ) > MAX_BODY_SIZE
    ) {
      throw new Error(
        "Request body is too large."
      );
    }

    try {
      return JSON.parse(req.body);
    } catch {
      throw new Error(
        "Invalid JSON request body."
      );
    }
  }


  /*
   * Raw Node request stream fallback.
   */

  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;

    if (total > MAX_BODY_SIZE) {
      throw new Error(
        "Request body is too large."
      );
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
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
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}


/* =====================================================
   PATH SAFETY
   ===================================================== */

function sanitizePathSegment(
  value,
  fallback = "file"
) {
  const cleaned =
    String(value ?? "")
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

function normalizeExtension(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 32);
}


/* =====================================================
   CATEGORY
   ===================================================== */

function normalizeCategory(value) {
  const category =
    String(value ?? "")
      .trim()
      .toLowerCase();

  return ALLOWED_CATEGORIES.has(category)
    ? category
    : "unknown";
}


/* =====================================================
   FILENAME
   ===================================================== */

function buildSafeFilename(
  originalName,
  extension
) {
  const name =
    cleanString(
      originalName,
      MAX_FILENAME_LENGTH
    );

  const ext =
    normalizeExtension(
      extension
    );

  const lastDot =
    name.lastIndexOf(".");

  let baseName =
    lastDot > 0
      ? name.slice(0, lastDot)
      : name;

  baseName =
    sanitizePathSegment(
      baseName,
      "attachment"
    );

  if (!ext) {
    return baseName;
  }

  return `${baseName}.${ext}`;
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
    Number(body.size);

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


  if (size > MAX_FILE_SIZE) {
    throw new Error(
      `File exceeds the ${Math.round(
        MAX_FILE_SIZE /
        (1024 * 1024)
      )} MB upload limit.`
    );
  }


  if (mime.length > 180) {
    throw new Error(
      "Invalid MIME type."
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
   PUBLIC ERROR
   ===================================================== */

function publicError(error) {
  const message =
    String(
      error?.message || ""
    );

  const safePhrases = [
    "File name",
    "file size",
    "upload limit",
    "Invalid upload metadata",
    "Invalid MIME",
    "Request body",
    "Invalid JSON"
  ];

  if (
    safePhrases.some(
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
  setJsonHeaders(res);


  /* ===================================================
     METHOD
     =================================================== */

  if (req.method !== "POST") {
    res.setHeader(
      "Allow",
      "POST"
    );

    return res
      .status(405)
      .json({
        error:
          "Method Not Allowed"
      });
  }


  /* ===================================================
     AUTHENTICATION
     =================================================== */

  let auth;

  try {
    auth =
      await getAuthenticatedUser(req);
  } catch (error) {
    console.error(
      "[NEYO Attachment Upload] Auth error:",
      error?.message
    );

    return res
      .status(401)
      .json({
        error:
          "Authentication required."
      });
  }


  /*
   * IMPORTANT:
   * Never read user identity from:
   *
   * req.headers["x-neyo-user-id"]
   *
   * The server derives identity from
   * the authenticated session cookie.
   */

  const userId =
    auth?.userId;

  if (!userId) {
    return res
      .status(401)
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
      await readJsonBody(req);
  } catch (error) {
    return res
      .status(400)
      .json({
        error:
          publicError(error)
      });
  }


  /* ===================================================
     VALIDATE METADATA
     =================================================== */

  let file;

  try {
    file =
      validatePayload(body);
  } catch (error) {
    return res
      .status(400)
      .json({
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
      "[NEYO Attachment Upload] Supabase configuration error:",
      error?.message
    );

    return res
      .status(500)
      .json({
        error:
          "Attachment storage is not configured."
      });
  }


  try {
    /* =================================================
       IDS
       ================================================= */

    const uploadId =
      crypto.randomUUID();


    /*
     * User ID comes exclusively from
     * authenticated server-side session.
     */

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


    /* =================================================
       STORAGE PATH
       =================================================

       users/
         {authenticated-user-id}/
           {upload-id}/
             {filename}
    */

    const path =
      [
        "users",
        safeUserId,
        uploadId,
        safeFilename
      ].join("/");


    /* =================================================
       SIGNED UPLOAD URL
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


    if (!data?.signedUrl) {
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
        name:
          file.name,
        size:
          file.size,
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

        path:
          data.path ||
          path,

        signedUrl:
          data.signedUrl,

        token:
          data.token ||
          null,

        method:
          "PUT",

        headers: {
          "x-upsert":
            "false"
        },

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
            file.extension,

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

        details:
          error?.details,

        hint:
          error?.hint
      }
    );

    return res
      .status(500)
      .json({
        error:
          "Unable to prepare this file for upload."
      });
  }
}
