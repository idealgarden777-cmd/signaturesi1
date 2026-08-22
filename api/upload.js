import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "../lib/auth.js";
import { setJsonHeaders, isAllowedOrigin } from "../lib/http.js";

const BUCKET =
  process.env.LEGACY_UPLOAD_BUCKET ||
  "neo-uploads";

const MAX_FILE_SIZE =
  Number(process.env.MAX_UPLOAD_BYTES) ||
  100 * 1024 * 1024;


const clean = (value, max = 512) =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);


function adminClient() {
  const url =
    clean(process.env.SUPABASE_URL);

  const key =
    clean(
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

  if (!url || !key) {
    throw new Error(
      "Upload storage is not configured."
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
      }
    }
  );
}


function safeName(name) {
  const raw =
    clean(name || "file", 220)
      .normalize("NFKC");

  const dot =
    raw.lastIndexOf(".");

  const ext =
    dot > 0
      ? raw
          .slice(dot + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 20)
      : "";

  const base =
    (dot > 0
      ? raw.slice(0, dot)
      : raw
    )
      .replace(
        /[^a-zA-Z0-9._-]+/g,
        "-"
      )
      .replace(/-+/g, "-")
      .replace(
        /^[._-]+|[._-]+$/g,
        ""
      )
      .slice(0, 120) ||
    "file";

  return ext
    ? `${base}.${ext}`
    : base;
}


function bodyOf(req) {
  if (
    req.body &&
    typeof req.body === "object" &&
    !Buffer.isBuffer(req.body)
  ) {
    return req.body;
  }

  const raw =
    Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : req.body;

  if (
    typeof raw !== "string"
  ) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}


export default async function handler(
  req,
  res
) {
  setJsonHeaders(res);

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
        error:
          "Method Not Allowed"
      });
  }

  try {
    if (
      !isAllowedOrigin(req)
    ) {
      return res
        .status(403)
        .json({
          error:
            "Request origin is not allowed."
        });
    }


    const auth =
      await getAuthenticatedUser(req);

    if (!auth?.userId) {
      return res
        .status(401)
        .json({
          error:
            "Authentication required."
        });
    }


    const body =
      bodyOf(req);

    if (!body) {
      return res
        .status(400)
        .json({
          error:
            "Invalid upload request."
        });
    }


    const filename =
      clean(
        body.filename ||
        body.name,
        220
      );

    const mimeType =
      clean(
        body.mimeType ||
        body.mime ||
        "application/octet-stream",
        180
      ).toLowerCase();

    const size =
      Number(body.size);


    if (
      !filename ||
      !Number.isSafeInteger(size) ||
      size <= 0
    ) {
      return res
        .status(400)
        .json({
          error:
            "Valid file name and size are required."
        });
    }


    if (
      size > MAX_FILE_SIZE
    ) {
      return res
        .status(413)
        .json({
          error:
            `File exceeds the ${Math.round(
              MAX_FILE_SIZE /
              1024 /
              1024
            )} MB upload limit.`
        });
    }


    const safeFilename =
      safeName(filename);

    const now =
      new Date();

    const path =
      [
        "users",
        clean(auth.userId, 128),
        String(
          now.getUTCFullYear()
        ),
        String(
          now.getUTCMonth() + 1
        ).padStart(2, "0"),
        `${crypto.randomUUID()}-${safeFilename}`
      ].join("/");


    const {
      data,
      error
    } =
      await adminClient()
        .storage
        .from(BUCKET)
        .createSignedUploadUrl(
          path
        );


    if (error) {
      throw error;
    }


    if (
      !data?.path ||
      !data?.token
    ) {
      throw new Error(
        "Signed upload information was not returned."
      );
    }


    return res
      .status(200)
      .json({
        success: true,

        upload: {
          bucket:
            BUCKET,

          path:
            data.path,

          token:
            data.token,

          signedUrl:
            data.signedUrl ||
            null,

          filename:
            safeFilename,

          mimeType,

          size
        }
      });


  } catch (error) {
    console.error(
      "[NEYO Upload] Failed:",
      {
        message:
          error?.message,

        code:
          error?.code
      }
    );


    if (
      /auth|session|token/i.test(
        error?.message ||
        ""
      )
    ) {
      return res
        .status(401)
        .json({
          error:
            "Authentication required."
        });
    }


    return res
      .status(500)
      .json({
        error:
          "Unable to prepare the upload."
      });
  }
}
