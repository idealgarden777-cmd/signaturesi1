/*
=========================================================
NEYO — ATTACHMENT UPLOAD AUTHORIZATION v2
ROBUST BODY PARSER + SIGNED UPLOAD

Purpose:
- Accept attachment metadata from browser
- Parse JSON safely on Vercel/serverless
- Validate filename/size/category
- Create private Supabase storage path
- Return signed upload authorization
- Never proxy large file bytes through this API

Requires:
- @supabase/supabase-js

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


const MAX_BODY_BYTES =
  64 * 1024;


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
   BLOCKED EXTENSIONS
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
   RESPONSE
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
   RAW BODY READER
   ========================================================= */

async function readRawBody(
  req
) {

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
      MAX_BODY_BYTES
    ) {

      throw new Error(
        "Request body is too large."
      );
    }


    chunks.push(
      buffer
    );
  }


  return Buffer
    .concat(chunks)
    .toString("utf8");
}


/* =========================================================
   ROBUST BODY PARSER
   ========================================================= */

async function readBody(
  req
) {

  /*
  Vercel/Next-style parsed object
  */

  if (
    req.body &&
    typeof req.body ===
      "object" &&
    !Buffer.isBuffer(
      req.body
    )
  ) {

    return req.body;
  }


  /*
  Buffer body
  */

  if (
    Buffer.isBuffer(
      req.body
    )
  ) {

    const text =
      req.body
        .toString("utf8")
        .trim();


    if (!text) {
      return {};
    }


    try {

      return JSON.parse(
        text
      );

    } catch {

      return {};
    }
  }


  /*
  String body
  */

  if (
    typeof req.body ===
      "string"
  ) {

    const text =
      req.body.trim();


    if (!text) {
      return {};
    }


    try {

      return JSON.parse(
        text
      );

    } catch {

      return {};
    }
  }


  /*
  Fallback:
  raw Node request stream
  */

  try {

    const raw =
      (
        await readRawBody(
          req
        )
      ).trim();


    if (!raw) {
      return {};
    }


    return JSON.parse(
      raw
    );


  } catch (error) {

    console.warn(
      "[NEYO Upload] Body parse failed:",
      error?.message
    );


    return {};
  }
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
   AUTH USER

   TEMPORARY:
   Replace later with real Signaturesi auth session.

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
   VALIDATION
   ========================================================= */

function validateMetadata(
  body
) {

  const name =
    String(
      body?.name ??
      ""
    )
      .normalize("NFKC")
      .trim();


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
      .trim()
      .slice(
        0,
        100
      );


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

  const now =
    new Date();


  const year =
    String(
      now.getUTCFullYear()
    );


  const month =
    String(
      now.getUTCMonth() + 1
    ).padStart(
      2,
      "0"
    );


  const day =
    String(
      now.getUTCDate()
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
      year,
      month,
      day,
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
     METHOD
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
      "[NEYO Upload] Missing Supabase environment."
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


  try {

    /* -----------------------------------------------------
       BODY
       ----------------------------------------------------- */

    const body =
      await readBody(
        req
      );


    /*
    Temporary debug.
    Remove after upload is verified.
    */

    console.log(
      "[NEYO Upload] Parsed request",
      {
        hasBody:
          Boolean(body),

        keys:
          body &&
          typeof body ===
            "object"
            ? Object.keys(body)
            : [],

        name:
          body?.name,

        size:
          body?.size,

        mime:
          body?.mime,

        category:
          body?.category
      }
    );


    /* -----------------------------------------------------
       VALIDATE
       ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       USER
       ----------------------------------------------------- */

    const userId =
      resolveUserId(
        req
      );


    /* -----------------------------------------------------
       STORAGE LOCATION
       ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       SUPABASE CLIENT
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
       SIGNED UPLOAD
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
      error
    ) {

      throw error;
    }


    if (
      !data?.token
    ) {

      throw new Error(
        "Signed upload token was not returned."
      );
    }


    if (
      !data?.path
    ) {

      throw new Error(
        "Signed upload path was not returned."
      );
    }


    /* -----------------------------------------------------
       SUCCESS
       ----------------------------------------------------- */

    console.log(
      "[NEYO Upload] Authorized",
      {

        attachmentId,

        userId,

        name:
          file.name,

        path:
          data.path,

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

        uploadId:
          attachmentId,


        bucket:
          BUCKET,


        path:
          data.path,


        token:
          data.token,


        signedUrl:
          data.signedUrl ||
          null,


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
          file.clientAttachmentId ||
          null,


        status:
          "upload-authorized"
      }
    );


  } catch (error) {

    console.error(
      "[NEYO Upload] Failed:",
      error
    );


    const status =
      Number(
        error?.status
      );


    return sendJson(
      res,
      (
        status >= 400 &&
        status < 600
      )
        ? status
        : 500,
      {
        error:
          error?.message ||
          "Could not authorize attachment upload."
      }
    );
  }
}
