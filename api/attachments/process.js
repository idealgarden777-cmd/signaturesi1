import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import {
  getAuthenticatedUser
} from "../../lib/auth.js";

import {
  setJsonHeaders,
  isAllowedOrigin
} from "../../lib/http.js";

import {
  extractAttachment
} from "../../lib/attachments/extractors.js";


const BUCKET = "neyo-attachments";

const MAX_FILE =
  Number(process.env.MAX_ATTACHMENT_BYTES) ||
  100 * 1024 * 1024;

const MAX_EXTRACT =
  Number(process.env.MAX_EXTRACTABLE_ATTACHMENT_BYTES) ||
  25 * 1024 * 1024;

const TEXTUAL = new Set([
  "document",
  "spreadsheet",
  "presentation",
  "archive",
  "data",
  "code",
  "text"
]);


const clean = (value, max = 512) =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);

const safe = value =>
  clean(value, 180)
    .replace(/[^a-zA-Z0-9._-]+/g, "_");


function admin() {
  const url =
    clean(process.env.SUPABASE_URL, 500);

  const key =
    clean(
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      1000
    );

  if (!url || !key) {
    throw new Error(
      "Attachment storage is not configured."
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}


function bodyOf(req) {
  if (
    req.body &&
    typeof req.body === "object" &&
    !Buffer.isBuffer(req.body)
  ) {
    return req.body;
  }

  try {
    return JSON.parse(
      Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : req.body || "{}"
    );
  } catch {
    return null;
  }
}


function makeChunks(
  text,
  size = 8000,
  overlap = 800,
  limit = 150
) {
  if (!text) return [];

  const chunks = [];

  for (
    let start = 0, index = 0;
    start < text.length && index < limit;
    index += 1
  ) {
    const end =
      Math.min(
        text.length,
        start + size
      );

    chunks.push({
      index,
      text:
        text.slice(
          start,
          end
        ),
      start,
      end
    });

    if (end >= text.length) {
      break;
    }

    start =
      Math.max(
        start + 1,
        end - overlap
      );
  }

  return chunks;
}


async function verifyStored(
  db,
  path,
  expectedSize
) {
  const slash =
    path.lastIndexOf("/");

  const folder =
    path.slice(0, slash);

  const filename =
    path.slice(slash + 1);

  const {
    data,
    error
  } =
    await db.storage
      .from(BUCKET)
      .list(folder, {
        limit: 10,
        search: filename
      });

  if (error) {
    throw error;
  }

  const object =
    (data || [])
      .find(
        item =>
          item.name === filename
      );

  if (!object) {
    throw new Error(
      "Uploaded attachment was not found in storage."
    );
  }

  const actualSize =
    Number(
      object.metadata?.size
    ) || 0;

  if (
    actualSize > MAX_FILE ||
    expectedSize > MAX_FILE
  ) {
    throw new Error(
      "Attachment exceeds the allowed size."
    );
  }

  return (
    actualSize ||
    expectedSize ||
    0
  );
}


async function download(
  db,
  path
) {
  const {
    data,
    error
  } =
    await db.storage
      .from(BUCKET)
      .download(path);

  if (error || !data) {
    throw new Error(
      "Unable to read the uploaded attachment."
    );
  }

  const buffer =
    Buffer.from(
      await data.arrayBuffer()
    );

  if (!buffer.length) {
    throw new Error(
      "Attachment is empty."
    );
  }

  if (
    buffer.length >
    MAX_EXTRACT
  ) {
    throw new Error(
      "Attachment is too large for direct extraction."
    );
  }

  return buffer;
}


export default async function handler(
  req,
  res
) {
  setJsonHeaders(res);

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

  try {
    if (!isAllowedOrigin(req)) {
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
            "Invalid processing request."
        });
    }

    const uploadId =
      clean(
        body.uploadId,
        128
      );

    const bucket =
      clean(
        body.bucket ||
        BUCKET,
        80
      );

    const path =
      clean(
        body.path,
        1024
      );

    const name =
      clean(
        body.name ||
        "Attachment",
        220
      );

    const mime =
      clean(
        body.mime ||
        body.mimeType ||
        "application/octet-stream",
        180
      ).toLowerCase();

    const extension =
      clean(
        body.extension,
        24
      )
        .replace(/^\./, "")
        .toLowerCase();

    const category =
      clean(
        body.category ||
        "unknown",
        32
      ).toLowerCase();

    const declaredSize =
      Math.max(
        0,
        Number(body.size) || 0
      );

    if (
      !uploadId ||
      !path
    ) {
      return res
        .status(400)
        .json({
          error:
            "uploadId and path are required."
        });
    }

    if (bucket !== BUCKET) {
      return res
        .status(400)
        .json({
          error:
            "Invalid attachment bucket."
        });
    }

    const prefix =
      `users/${safe(auth.userId)}/` +
      `${safe(uploadId)}/`;

    if (
      !path.startsWith(prefix) ||
      path.includes("..") ||
      path.includes("\\")
    ) {
      return res
        .status(403)
        .json({
          error:
            "You do not have access to this attachment."
        });
    }

    const db =
      admin();

    const actualSize =
      await verifyStored(
        db,
        path,
        declaredSize
      );

    const processId =
      crypto.randomUUID();

    const documentId =
      `doc_${uploadId}`;


    /*
     * Image / audio / video:
     * no text extraction needed here.
     * api/chat.js handles multimodal reading.
     */

    if (
      !TEXTUAL.has(
        category
      )
    ) {
      return res
        .status(200)
        .json({
          ready: true,
          processId,
          documentId,

          document: {
            id: documentId,
            name,
            mime,
            extension,
            category,
            size: actualSize,
            text: ""
          },

          chunks: [],

          stats: {
            bytes: actualSize,
            characters: 0,
            chunks: 0
          },

          extraction: {
            parser:
              "deferred-to-chat",
            extracted:
              false
          },

          warnings: []
        });
    }


    /*
     * Large textual file:
     * keep attachment usable,
     * but avoid loading huge files in Vercel memory.
     */

    if (
      actualSize >
      MAX_EXTRACT
    ) {
      return res
        .status(200)
        .json({
          ready: true,
          processId,
          documentId,

          document: {
            id: documentId,
            name,
            mime,
            extension,
            category,
            size: actualSize,
            text: ""
          },

          chunks: [],

          stats: {
            bytes: actualSize,
            characters: 0,
            chunks: 0
          },

          extraction: {
            parser:
              "deferred-large-file",
            extracted:
              false
          },

          warnings: [
            "File is ready, but text extraction is deferred because of its size."
          ]
        });
    }


    /*
     * Normal textual extraction.
     */

    const buffer =
      await download(
        db,
        path
      );

    const extraction =
      await extractAttachment({
        buffer,
        name,
        mime,
        extension,
        category
      });

    const extractedText =
      String(
        extraction?.text ||
        ""
      )
        .replace(/\u0000/g, "")
        .trim();

    const chunks =
      makeChunks(
        extractedText
      );

    const warnings =
      Array.isArray(
        extraction?.warnings
      )
        ? extraction.warnings
        : [];

    return res
      .status(200)
      .json({
        ready: true,
        processId,
        documentId,

        document: {
          id: documentId,
          name,
          mime,
          extension,
          category,
          size: buffer.length,
          text: extractedText
        },

        chunks,

        stats: {
          bytes: buffer.length,
          characters:
            extractedText.length,
          chunks:
            chunks.length
        },

        extraction: {
          ...extraction,
          text: undefined
        },

        warnings
      });

  } catch (error) {
    console.error(
      "[NEYO Attachment Process]",
      error?.message
    );

    return res
      .status(500)
      .json({
        error:
          error?.message ||
          "Unable to process attachment."
      });
  }
}
