import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "../lib/auth.js";
import { setJsonHeaders, isAllowedOrigin } from "../lib/http.js";

const BUCKET =
  process.env.UPLOAD_BUCKET ||
  "neyo-attachments";

const MAX_SIZE =
  Number(process.env.MAX_ATTACHMENT_BYTES) ||
  100 * 1024 * 1024;

const clean = (value, max = 220) =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);

function supabaseAdmin() {
  const url = clean(process.env.SUPABASE_URL, 500);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 1000);

  if (!url || !key) {
    throw new Error("Storage is not configured.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function safeFilename(name) {
  const value = clean(name || "file");

  const dot = value.lastIndexOf(".");
  const ext =
    dot > 0
      ? value.slice(dot + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 20)
      : "";

  const base =
    (dot > 0 ? value.slice(0, dot) : value)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 120) ||
    "file";

  return ext
    ? `${base}.${ext}`
    : base;
}

export default async function handler(req, res) {
  setJsonHeaders(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  try {
    if (!isAllowedOrigin(req)) {
      return res.status(403).json({
        error: "Request origin is not allowed."
      });
    }

    const auth =
      await getAuthenticatedUser(req);

    if (!auth?.userId) {
      return res.status(401).json({
        error: "Authentication required."
      });
    }

    const body =
      req.body &&
      typeof req.body === "object"
        ? req.body
        : {};

    const filename =
      clean(
        body.filename ||
        body.name
      );

    const size =
      Number(body.size);

    const mimeType =
      clean(
        body.mimeType ||
        body.mime ||
        "application/octet-stream",
        180
      ).toLowerCase();

    if (
      !filename ||
      !Number.isFinite(size) ||
      size <= 0
    ) {
      return res.status(400).json({
        error: "Valid file name and size are required."
      });
    }

    if (size > MAX_SIZE) {
      return res.status(413).json({
        error: "File is too large."
      });
    }

    const uploadId =
      crypto.randomUUID();

    const path = [
      "users",
      clean(auth.userId, 128),
      uploadId,
      safeFilename(filename)
    ].join("/");

    const { data, error } =
      await supabaseAdmin()
        .storage
        .from(BUCKET)
        .createSignedUploadUrl(path);

    if (error) {
      throw error;
    }

    if (!data?.path || !data?.token) {
      throw new Error(
        "Upload information was not returned."
      );
    }

    return res.status(200).json({
      success: true,

      uploadId,

      upload: {
        bucket: BUCKET,
        path: data.path,
        token: data.token,
        signedUrl: data.signedUrl || null,
        filename: safeFilename(filename),
        mimeType,
        size
      }
    });

  } catch (error) {
    console.error(
      "[NEYO Upload]",
      error?.message
    );

    return res.status(500).json({
      error: "Unable to prepare file upload."
    });
  }
}
