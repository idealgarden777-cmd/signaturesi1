import zlib from "node:zlib";

const LIMIT = Object.freeze({
  chars: 1_500_000,
  zipEntries: 1000,
  zipReadable: 80,
  zipEntryBytes: 4 * 1024 * 1024,
  zipTotalBytes: 12 * 1024 * 1024,
  sheets: 30,
  rows: 10_000,
  slides: 300
});

const TEXT = new Set([
  "txt","md","markdown","tex","html","htm","css","scss","sass","less",
  "js","mjs","cjs","jsx","ts","tsx","py","java","kt","kts","c","h",
  "cc","cpp","cxx","hpp","cs","go","rs","php","rb","swift","dart",
  "scala","sh","bash","zsh","fish","ps1","vue","svelte","graphql","gql",
  "proto","xml","yaml","yml","toml","ini","sql","env","gitignore"
]);

const JSON_TYPES =
  new Set(["json","jsonl","ndjson"]);

const SHEETS =
  new Set(["xls","xlsx","xlsm","xlsb","ods"]);

const MEDIA =
  new Set(["image","audio","video"]);

const APP_TEXT =
  new Set([
    "application/javascript",
    "application/x-javascript",
    "application/xml",
    "application/xhtml+xml"
  ]);

const buf = value =>
  Buffer.isBuffer(value)
    ? value
    : Buffer.from(value || []);

const extOf = name =>
  String(name || "")
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/)?.[1] || "";

const normExt = value =>
  String(value || "")
    .toLowerCase()
    .replace(/^\./, "")
    .replace(/[^a-z0-9]/g, "");

const utf8 = value =>
  buf(value)
    .toString("utf8")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n");


function result(
  text = "",
  parser = "unknown",
  kind = "unknown",
  metadata = {},
  warnings = []
) {
  let value =
    String(text || "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .trim();

  const notes =
    [...new Set(
      (warnings || [])
        .filter(Boolean)
        .map(String)
    )];

  if (value.length > LIMIT.chars) {
    value =
      value.slice(
        0,
        LIMIT.chars
      );

    notes.push(
      `Extracted text was truncated to ${LIMIT.chars.toLocaleString()} characters.`
    );
  }

  return {
    text: value,
    parser,
    kind,
    metadata,
    warnings: notes
  };
}


const modDefault = mod =>
  mod?.default || mod;


const xmlText = xml =>
  String(xml || "")
    .replace(
      /<(?:a|text):(?:br|tab)[^>]*\/?\s*>/gi,
      "\n"
    )
    .replace(
      /<\/[^>]+>/g,
      "\n"
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();


async function pdf(buffer) {
  /*
   * IMPORTANT:
   * Do not import "pdf-parse" package root.
   * pdf-parse v1.x root can execute demo/test code.
   */

  const parse =
    modDefault(
      await import(
        "pdf-parse/lib/pdf-parse.js"
      )
    );

  const out =
    await parse(
      buf(buffer)
    );

  return result(
    out?.text,
    "pdf-parse",
    "pdf",
    {
      pages:
        Number(out?.numpages) ||
        null,

      info:
        out?.info || {}
    }
  );
}


async function docx(buffer) {
  const mammoth =
    modDefault(
      await import("mammoth")
    );

  const out =
    await mammoth
      .extractRawText({
        buffer:
          buf(buffer)
      });

  return result(
    out?.value,
    "mammoth",
    "docx",
    {},
    out?.messages
      ?.map(item => item?.message)
      .filter(Boolean)
  );
}


async function spreadsheet(
  buffer,
  extension
) {
  const XLSX =
    modDefault(
      await import("xlsx")
    );

  const workbook =
    XLSX.read(
      buf(buffer),
      {
        type: "buffer",
        cellDates: true
      }
    );

  const names =
    (workbook.SheetNames || [])
      .slice(
        0,
        LIMIT.sheets
      );

  const sections = [];
  const sheets = [];

  for (const name of names) {
    const rows =
      XLSX.utils
        .sheet_to_json(
          workbook.Sheets[name],
          {
            header: 1,
            raw: false,
            defval: "",
            blankrows: false
          }
        )
        .slice(
          0,
          LIMIT.rows
        );

    sections.push(
      `### Sheet: ${name}\n` +
      rows
        .map(row =>
          row
            .map(value =>
              String(value ?? "")
                .replace(/\t/g, " ")
            )
            .join("\t")
        )
        .join("\n")
    );

    sheets.push({
      name,
      rows: rows.length
    });
  }

  const warnings =
    (workbook.SheetNames || []).length >
    LIMIT.sheets
      ? [
          `Only the first ${LIMIT.sheets} sheets were extracted.`
        ]
      : [];

  return result(
    sections.join("\n\n"),
    "xlsx",
    extension,
    {
      sheets,
      totalSheets:
        workbook.SheetNames
          ?.length || 0
    },
    warnings
  );
}


async function zipLoad(buffer) {
  const JSZip =
    modDefault(
      await import("jszip")
    );

  return JSZip.loadAsync(
    buf(buffer)
  );
}


async function odt(buffer) {
  const zip =
    await zipLoad(buffer);

  const file =
    zip.file("content.xml");

  if (!file) {
    throw new Error(
      "ODT content.xml is missing."
    );
  }

  return result(
    xmlText(
      await file.async("string")
    ),
    "odt-xml",
    "odt"
  );
}


async function presentation(
  buffer,
  type
) {
  const zip =
    await zipLoad(buffer);

  if (type === "odp") {
    const file =
      zip.file("content.xml");

    if (!file) {
      throw new Error(
        "ODP content.xml is missing."
      );
    }

    return result(
      xmlText(
        await file.async("string")
      ),
      "odp-xml",
      "odp"
    );
  }

  const files =
    Object.keys(zip.files)
      .filter(name =>
        /^ppt\/slides\/slide\d+\.xml$/i
          .test(name)
      )
      .sort(
        (a, b) =>
          (
            +a.match(
              /slide(\d+)/i
            )?.[1] || 0
          ) -
          (
            +b.match(
              /slide(\d+)/i
            )?.[1] || 0
          )
      );

  const slides = [];

  for (
    const [index, name]
    of files
      .slice(
        0,
        LIMIT.slides
      )
      .entries()
  ) {
    slides.push(
      `### Slide ${index + 1}\n` +
      xmlText(
        await zip
          .file(name)
          .async("string")
      )
    );
  }

  const warnings =
    files.length >
    LIMIT.slides
      ? [
          `Only the first ${LIMIT.slides} slides were extracted.`
        ]
      : [];

  return result(
    slides.join("\n\n"),
    "pptx-xml",
    "pptx",
    {
      slides:
        Math.min(
          files.length,
          LIMIT.slides
        ),

      totalSlides:
        files.length
    },
    warnings
  );
}


function rtf(buffer) {
  let text =
    utf8(buffer)
      .replace(
        /\\'([0-9a-f]{2})/gi,
        (_, hex) =>
          Buffer
            .from([
              parseInt(hex, 16)
            ])
            .toString("latin1")
      )
      .replace(
        /\\u(-?\d+)\??/g,
        (_, value) =>
          String.fromCharCode(
            (
              Number(value) +
              65536
            ) %
            65536
          )
      )
      .replace(
        /\\(?:par[d]?|line)\b/g,
        "\n"
      )
      .replace(
        /\\tab\b/g,
        "\t"
      )
      .replace(
        /\\[a-z]+-?\d* ?/gi,
        ""
      )
      .replace(
        /\\([{}\\])/g,
        "$1"
      )
      .replace(
        /[{}]/g,
        ""
      );

  return result(
    text,
    "rtf-safe",
    "rtf",
    {},
    [
      "RTF extraction is best-effort and may not preserve complex formatting."
    ]
  );
}


function json(
  buffer,
  extension
) {
  const raw =
    utf8(buffer);

  if (
    [
      "jsonl",
      "ndjson"
    ].includes(extension)
  ) {
    const warnings = [];
    const output = [];

    for (
      const line
      of raw
        .split(/\n/)
        .filter(item =>
          item.trim()
        )
    ) {
      try {
        output.push(
          JSON.stringify(
            JSON.parse(line),
            null,
            2
          )
        );

      } catch {
        output.push(line);

        warnings.push(
          "Some JSON-lines entries were invalid and preserved as text."
        );
      }
    }

    return result(
      output.join("\n\n"),
      "json-lines",
      extension,
      {},
      warnings
    );
  }

  try {
    return result(
      JSON.stringify(
        JSON.parse(raw),
        null,
        2
      ),
      "json",
      "json",
      {
        valid: true
      }
    );

  } catch {
    return result(
      raw,
      "json-fallback-text",
      "json",
      {
        valid: false
      },
      [
        "JSON parsing failed; raw text was preserved."
      ]
    );
  }
}


const readableArchiveFile =
  name => {
    const extension =
      extOf(name);

    return (
      TEXT.has(extension) ||
      JSON_TYPES.has(extension) ||
      [
        "csv",
        "tsv",
        "rtf"
      ].includes(extension)
    );
  };


async function zipText(buffer) {
  const zip =
    await zipLoad(buffer);

  const names =
    Object.keys(zip.files);

  if (
    names.length >
    LIMIT.zipEntries
  ) {
    throw new Error(
      `ZIP contains too many entries (${names.length}).`
    );
  }

  const output = [];
  const warnings = [];

  let count = 0;
  let total = 0;

  for (const name of names) {
    const entry =
      zip.files[name];

    if (
      !entry ||
      entry.dir ||
      !readableArchiveFile(name) ||
      count >= LIMIT.zipReadable
    ) {
      continue;
    }

    const declared =
      Number(
        entry?._data
          ?.uncompressedSize
      ) || 0;

    if (
      declared >
      LIMIT.zipEntryBytes
    ) {
      warnings.push(
        `Skipped large archive entry: ${name}`
      );

      continue;
    }

    const data =
      await entry.async(
        "nodebuffer"
      );

    if (
      data.length >
      LIMIT.zipEntryBytes
    ) {
      warnings.push(
        `Skipped large archive entry: ${name}`
      );

      continue;
    }

    if (
      total +
      data.length >
      LIMIT.zipTotalBytes
    ) {
      warnings.push(
        "Archive extraction stopped at the safe text limit."
      );

      break;
    }

    total += data.length;
    count += 1;

    const extension =
      extOf(name);

    const body =
      JSON_TYPES.has(extension)
        ? json(
            data,
            extension
          ).text
        : utf8(data);

    output.push(
      `### File: ${name}\n${body}`
    );
  }

  if (!count) {
    warnings.push(
      "No supported readable text files were found inside the ZIP archive."
    );
  }

  return result(
    output.join("\n\n"),
    "zip-safe-text",
    "zip",
    {
      totalEntries:
        names.length,

      readableEntries:
        count,

      extractedBytes:
        total
    },
    warnings
  );
}


function gzip(
  buffer,
  name
) {
  const data =
    zlib.gunzipSync(
      buf(buffer),
      {
        maxOutputLength:
          LIMIT.zipTotalBytes
      }
    );

  const inner =
    String(name || "")
      .replace(
        /\.gz$/i,
        ""
      );

  const extension =
    extOf(inner);

  return result(
    JSON_TYPES.has(extension)
      ? json(
          data,
          extension
        ).text
      : utf8(data),

    "gzip",
    "gz",

    {
      innerName:
        inner || null,

      decompressedBytes:
        data.length
    }
  );
}


export async function extractAttachment({
  buffer,
  name = "",
  mime = "",
  extension = "",
  category = ""
} = {}) {
  const data =
    buf(buffer);

  if (!data.length) {
    throw new Error(
      "Attachment is empty."
    );
  }

  const ext =
    normExt(extension) ||
    extOf(name);

  const type =
    String(mime || "")
      .toLowerCase()
      .trim();

  const cat =
    String(category || "")
      .toLowerCase()
      .trim();


  if (
    ext === "pdf" ||
    type === "application/pdf"
  ) {
    return pdf(data);
  }


  if (
    ext === "docx" ||
    type.includes(
      "wordprocessingml.document"
    )
  ) {
    return docx(data);
  }


  if (
    ext === "rtf" ||
    [
      "application/rtf",
      "text/rtf"
    ].includes(type)
  ) {
    return rtf(data);
  }


  if (
    ext === "odt" ||
    type ===
      "application/vnd.oasis.opendocument.text"
  ) {
    return odt(data);
  }


  if (
    ext === "pptx" ||
    type.includes(
      "presentationml.presentation"
    )
  ) {
    return presentation(
      data,
      "pptx"
    );
  }


  if (
    ext === "odp" ||
    type ===
      "application/vnd.oasis.opendocument.presentation"
  ) {
    return presentation(
      data,
      "odp"
    );
  }


  if (
    SHEETS.has(ext)
  ) {
    return spreadsheet(
      data,
      ext
    );
  }


  if (
    [
      "csv",
      "tsv"
    ].includes(ext)
  ) {
    return result(
      utf8(data),
      `${ext}-text`,
      ext
    );
  }


  if (
    JSON_TYPES.has(ext) ||
    [
      "application/json",
      "application/ld+json"
    ].includes(type)
  ) {
    return json(
      data,
      ext || "json"
    );
  }


  if (
    ext === "zip" ||
    [
      "application/zip",
      "application/x-zip",
      "application/x-zip-compressed"
    ].includes(type)
  ) {
    return zipText(data);
  }


  if (
    /\.tar\.(?:gz|gzip)$/i
      .test(name)
  ) {
    return result(
      "",
      "unsupported",
      "tar.gz",
      {},
      [
        ".tar.gz archives are stored safely but are not text-extracted yet."
      ]
    );
  }


  if (
    ext === "gz" ||
    [
      "application/gzip",
      "application/x-gzip"
    ].includes(type)
  ) {
    return gzip(
      data,
      name
    );
  }


  if (
    TEXT.has(ext) ||
    type.startsWith("text/") ||
    APP_TEXT.has(type) ||
    cat === "text" ||
    cat === "code"
  ) {
    return result(
      utf8(data),
      "plain-text",
      ext ||
      cat ||
      "text"
    );
  }


  if (
    MEDIA.has(cat)
  ) {
    return result(
      "",
      "multimodal-reference",
      cat,
      {},
      [
        `${cat} content is handled by the multimodal chat pipeline.`
      ]
    );
  }


  if (
    [
      "doc",
      "ppt"
    ].includes(ext)
  ) {
    return result(
      "",
      "unsupported",
      ext,
      {},
      [
        `Legacy .${ext} is not directly extractable; convert it to ${
          ext === "doc"
            ? ".docx"
            : ".pptx"
        }.`
      ]
    );
  }


  if (
    [
      "rar",
      "7z",
      "tar",
      "tgz",
      "bz2",
      "xz"
    ].includes(ext)
  ) {
    return result(
      "",
      "unsupported",
      ext,
      {},
      [
        `.${ext} archives are stored safely but are not text-extracted yet.`
      ]
    );
  }


  return result(
    "",
    "unsupported",
    ext ||
    cat ||
    "unknown",
    {},
    [
      "No safe text extractor is available for this file format yet."
    ]
  );
}


export default extractAttachment;
