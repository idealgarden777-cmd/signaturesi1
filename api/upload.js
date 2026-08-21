/*
=========================================================
NEYO — ATTACHMENT UPLOAD SESSION v1

Purpose:
- Never proxy large file bytes through Vercel
- Validate attachment metadata server-side
- Generate private Supabase Storage path
- Generate signed upload token
- Return upload session to browser

Flow:
browser
  ↓ POST metadata
/api/attachments/upload
  ↓
validate file name / size / type
  ↓
create private storage path
  ↓
createSignedUploadUrl()
  ↓
browser uploads directly to Supabase Storage

Requires:
- @supabase/supabase-js

Environment:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- ATTACHMENTS_BUCKET (optional)

Default bucket:
- neyo-attachments
=========================================================
*/

import {
  createClient
} from "@supabase/supabase-js";

import crypto from "node:crypto";


/* =========================================================
   CONFIG
   ========================================================= */

const BUCKET =
  process.env.ATTACHMENTS_BUCKET ||
  "neyo-attachments";


const MAX_FILE_SIZE =
  100 * 1024 * 1024;


const MAX_NAME_LENGTH =
  220;


const MAX_FILES_PER_REQUEST =
  1;


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
   DANGEROUS EXTENSIONS

   We can accept arbitrary data,
   but executable formats should not enter
   the knowledge extraction pipeline.
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
    "jscript",
    "wsf",
    "wsh",
    "ps1xml",
    "apk",
    "app",
    "dmg",
    "pkg",
    "deb",
    "rpm",
    "iso"
  ]);


/* =========================================================
   JSON RESPONSE
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
   FILE HELPERS
   ========================================================= */

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
    index < 0 ||
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


function sanitizeFilename(
  filename
) {

  const raw =
    String(
      filename || "file"
    )
      .normalize("NFKC")
      .trim();


  const safe =
    raw
      .replace(
        /[\/\\]/g,
        "_"
      )
      .replace(
        /[\u0000-\u001F\u007F]/g,
        ""
      )
      .replace(
        /[^a-zA-Z0-9._()\- ]+/g,
        "_"
      )
      .replace(
        /\s+/g,
        " "
      )
      .replace(
        /^\.+/,
        ""
      )
      .slice(
        0,
        MAX_NAME_LENGTH
      );


  return (
    safe ||
    "file"
  );
}


/* =========================================================
   USER ID

   Replace this later with your real auth resolver.
   Never trust userId sent by browser.
   ========================================================= */

function resolveUserId(
  req
) {

  /*
  Temporary development fallback.

  Production:
  resolve from your authenticated session,
  Supabase JWT, or Signaturesi account token.
  */

  const headerId =
    req.headers[
      "x-neyo-user-id"
    ];


  if (
    typeof headerId ===
      "string" &&
    headerId.trim()
  ) {

    return headerId
      .trim()
      .replace(
        /[^a-zA-Z0-9_-]/g,
        ""
      )
      .slice(
        0,
        100
      );
  }


  return "anonymous";
}


/* =========================================================
   VALIDATION
   ========================================================= */

function validateMetadata(
  body
) {

  const name =
    String(
      body?.name || ""
    ).trim();


  const size =
    Number(
      body?.size
    );


  const mime =
    String(
      body?.mime ||
      "application/octet-stream"
    )
      .trim()
      .toLowerCase();


  const category =
    String(
      body?.category ||
      "unknown"
    )
      .trim()
      .toLowerCase();


  const clientAttachmentId =
    String(
      body?.clientAttachmentId ||
      ""
    )
      .trim();


  if (!name) {

    return {
      ok:
        false,

      error:
        "File name is required."
    };
  }


  if (
    name.length >
    MAX_NAME_LENGTH
  ) {

    return {
      ok:
        false,

      error:
        "File name is too long."
    };
  }


  if (
    !Number.isFinite(size) ||
    size <= 0
  ) {

    return {
      ok:
        false,

      error:
        "Invalid file size."
    };
  }


  if (
    size >
    MAX_FILE_SIZE
  ) {

    return {
      ok:
        false,

      error:
        "File is larger than the allowed limit."
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
        "Unsupported attachment category."
    };
  }


  const extension =
    getExtension(
      name
    );


  if (
    BLOCKED_EXTENSIONS.has(
      extension
    )
  ) {

    return {
      ok:
        false,

      error:
        "Executable files are not supported."
    };
  }


  return {
    ok:
      true,

    value: {
      name,
      size,
      mime,
      category,
      extension,
      clientAttachmentId
    }
  };
}


/* =========================================================
   STORAGE PATH
   ========================================================= */

function createStoragePath({
  userId,
  filename
}) {

  const date =
    new Date();


  const yyyy =
    String(
      date.getUTCFullYear()
    );


  const mm =
    String(
      date.getUTCMonth() + 1
    ).padStart(
      2,
      "0"
    );


  const dd =
    String(
      date.getUTCDate()
    ).padStart(
      2,
      "0"
    );


  const attachmentId =
    crypto.randomUUID();


  const safeFilename =
    sanitizeFilename(
      filename
    );


  const path =
    [
      "users",
      userId,
      yyyy,
      mm,
      dd,
      attachmentId,
      safeFilename
    ].join("/");


  return {
    attachmentId,
    path,
    safeFilename
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
      "[NEYO Upload] Supabase environment missing."
    );


    return sendJson(
      res,
      500,
      {
        error:
          "Attachment storage is not configured."
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
    validateMetadata(
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


  const file =
    validation.value;


  /* -------------------------------------------------------
     USER
     ------------------------------------------------------- */

  const userId =
    resolveUserId(
      req
    );


  /* -------------------------------------------------------
     STORAGE PATH
     ------------------------------------------------------- */

  const {
    attachmentId,
    path,
    safeFilename
  } =
    createStoragePath({
      userId,
      filename:
        file.name
    });


  try {

    /* -----------------------------------------------------
       ADMIN CLIENT

       service-role remains SERVER ONLY.
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
       SIGNED UPLOAD TOKEN
       ----------------------------------------------------- */

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
            upsert:
              false
          }
        );


    if (
      error ||
      !data?.token
    ) {

      throw (
        error ||
        new Error(
          "Signed upload token was not returned."
        )
      );
    }


    /* -----------------------------------------------------
       SUCCESS
       ----------------------------------------------------- */

    console.log(
      "[NEYO Upload] Session created",
      {
        attachmentId,
        userId,
        path,
        size:
          file.size,
        category:
          file.category
      }
    );


    return sendJson(
      res,
      200,
      {

        /*
        Internal attachment identifier.
        */

        uploadId:
          attachmentId,


        /*
        Browser needs these two values for
        Supabase uploadToSignedUrl().
        */

        path:
          data.path ||
          path,

        token:
          data.token,


        /*
        signedUrl is returned as well in case
        we later use direct TUS/HTTP upload.
        */

        signedUrl:
          data.signedUrl ||
          null,


        bucket:
          BUCKET,


        /*
        Useful normalized metadata.
        */

        file: {

          originalName:
            file.name,

          storedName:
            safeFilename,

          size:
            file.size,

          mime:
            file.mime,

          category:
            file.category,

          extension:
            file.extension
        },


        clientAttachmentId:
          file.clientAttachmentId || null,


        status:
          "upload-authorized"
      }
    );


  } catch (error) {

    console.error(
      "[NEYO Upload] Failed",
      {
        message:
          error?.message,

        attachmentId,

        path
      }
    );


    return sendJson(
      res,
      500,
      {
        error:
          error?.message ||
          "Could not create attachment upload."
      }
    );
  }
}
