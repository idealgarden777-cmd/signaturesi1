/*
=========================================================
NEYO — UNIVERSAL ATTACHMENT EXTRACTORS
FINAL v2

FILE:
lib/attachments/extractors.js

EXPORT:
extractAttachment({
  buffer,
  name,
  mime,
  extension,
  category
})

RETURNS:
{
  text,
  parser,
  kind,
  metadata,
  warnings
}

SUPPORTED
---------------------------------------------------------
✅ TXT / Markdown / code / config
✅ JSON / JSONL / NDJSON
✅ CSV / TSV
✅ XLS / XLSX / XLSM / XLSB / ODS
✅ PDF
✅ DOCX
✅ RTF (safe best-effort)
✅ ODT
✅ PPTX
✅ ODP
✅ ZIP text extraction
✅ GZIP
✅ Graceful unsupported fallback

DOES NOT:
❌ Execute uploaded code
❌ Run macros
❌ Run scripts
❌ Extract executable binaries
❌ Trust file contents as instructions
=========================================================
*/

import zlib from "node:zlib";


/* =====================================================
   LIMITS
   ===================================================== */

const LIMITS =
  Object.freeze({
    maxExtractedCharacters:
      1_500_000,

    maxZipEntries:
      2_000,

    maxReadableZipEntries:
      100,

    maxArchiveEntryBytes:
      4 * 1024 * 1024,

    maxArchiveTextBytes:
      12 * 1024 * 1024,

    maxSpreadsheetSheets:
      50,

    maxSpreadsheetRowsPerSheet:
      20_000,

    maxPresentationSlides:
      500
  });


/* =====================================================
   EXTENSION GROUPS
   ===================================================== */

const PLAIN_TEXT_EXTENSIONS =
  new Set([
    "txt",
    "md",
    "markdown",
    "tex",

    "js",
    "mjs",
    "cjs",
    "jsx",
    "ts",
    "tsx",

    "py",
    "pyw",

    "java",
    "kt",
    "kts",

    "c",
    "h",
    "cc",
    "cpp",
    "cxx",
    "hpp",

    "cs",
    "go",
    "rs",
    "php",
    "rb",
    "swift",
    "dart",
    "scala",

    "sh",
    "bash",
    "zsh",
    "fish",
    "ps1",

    "html",
    "htm",
    "css",
    "scss",
    "sass",
    "less",

    "vue",
    "svelte",

    "graphql",
    "gql",
    "proto",

    "xml",
    "yaml",
    "yml",
    "toml",
    "ini",
    "sql",

    "dockerfile",
    "makefile",
    "env",
    "gitignore"
  ]);


const JSON_EXTENSIONS =
  new Set([
    "json",
    "jsonl",
    "ndjson"
  ]);


const SPREADSHEET_EXTENSIONS =
  new Set([
    "xls",
    "xlsx",
    "xlsm",
    "xlsb",
    "ods"
  ]);


/* =====================================================
   BASIC HELPERS
   ===================================================== */

function cleanString(
  value
) {
  return String(
    value ??
    ""
  )
    .replace(
      /\u0000/g,
      ""
    )
    .trim();
}


function normalizeExtension(
  value
) {
  return String(
    value ??
    ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /^\./,
      ""
    )
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}


function getExtensionFromName(
  name
) {
  const value =
    cleanString(
      name
    );

  const index =
    value.lastIndexOf(
      "."
    );

  if (
    index < 0 ||
    index ===
      value.length - 1
  ) {
    return "";
  }

  return value
    .slice(
      index + 1
    )
    .toLowerCase();
}


function ensureBuffer(
  buffer
) {
  if (
    Buffer.isBuffer(
      buffer
    )
  ) {
    return buffer;
  }

  if (
    buffer instanceof
    Uint8Array
  ) {
    return Buffer.from(
      buffer
    );
  }

  throw new TypeError(
    "Attachment buffer is required."
  );
}


function limitText(
  value,
  max =
    LIMITS
      .maxExtractedCharacters
) {
  const text =
    String(
      value ??
      ""
    );

  if (
    text.length <=
    max
  ) {
    return {
      text,
      truncated:
        false
    };
  }

  return {
    text:
      text.slice(
        0,
        max
      ),

    truncated:
      true
  };
}


function decodeUtf8(
  buffer
) {
  return ensureBuffer(
    buffer
  )
    .toString(
      "utf8"
    )
    .replace(
      /\u0000/g,
      ""
    );
}


function createResult({
  text =
    "",
  parser,
  kind,
  metadata =
    {},
  warnings =
    []
}) {
  const limited =
    limitText(
      text
    );

  const finalWarnings =
    Array.isArray(
      warnings
    )
      ? [
          ...warnings
        ]
      : [];

  if (
    limited.truncated
  ) {
    finalWarnings.push(
      `Extracted text was truncated at ${LIMITS.maxExtractedCharacters.toLocaleString()} characters.`
    );
  }

  return {
    text:
      limited.text,

    parser:
      parser ||
      "unknown",

    kind:
      kind ||
      "unknown",

    metadata:
      metadata &&
      typeof metadata ===
        "object"
          ? metadata
          : {},

    warnings:
      finalWarnings
  };
}


/* =====================================================
   PLAIN TEXT
   ===================================================== */

function extractPlainText(
  buffer,
  extension
) {
  return createResult({
    text:
      decodeUtf8(
        buffer
      ),

    parser:
      "utf8",

    kind:
      extension ||
      "text"
  });
}


/* =====================================================
   JSON
   ===================================================== */

function extractJson(
  buffer,
  extension
) {
  const raw =
    decodeUtf8(
      buffer
    );

  const warnings =
    [];


  if (
    extension ===
      "jsonl" ||
    extension ===
      "ndjson"
  ) {
    const lines =
      raw
        .split(
          /\r?\n/
        )
        .filter(
          line =>
            line.trim()
        );


    const output =
      [];


    let valid =
      0;


    let invalid =
      0;


    for (
      const line
      of lines
    ) {
      try {
        const parsed =
          JSON.parse(
            line
          );

        output.push(
          JSON.stringify(
            parsed,
            null,
            2
          )
        );

        valid +=
          1;

      } catch {
        output.push(
          line
        );

        invalid +=
          1;
      }
    }


    if (
      invalid >
      0
    ) {
      warnings.push(
        `${invalid} line(s) were not valid JSON and were preserved as plain text.`
      );
    }


    return createResult({
      text:
        output.join(
          "\n\n"
        ),

      parser:
        "json-lines",

      kind:
        extension,

      metadata: {
        lines:
          lines.length,

        validJsonLines:
          valid,

        invalidJsonLines:
          invalid
      },

      warnings
    });
  }


  try {
    const parsed =
      JSON.parse(
        raw
      );


    return createResult({
      text:
        JSON.stringify(
          parsed,
          null,
          2
        ),

      parser:
        "json",

      kind:
        "json",

      metadata: {
        valid:
          true
      }
    });

  } catch {
    warnings.push(
      "JSON parsing failed; content was preserved as plain text."
    );


    return createResult({
      text:
        raw,

      parser:
        "json-fallback-text",

      kind:
        "json",

      metadata: {
        valid:
          false
      },

      warnings
    });
  }
}


/* =====================================================
   CSV / TSV
   ===================================================== */

function extractDelimitedText(
  buffer,
  extension
) {
  const raw =
    decodeUtf8(
      buffer
    );


  return createResult({
    text:
      raw,

    parser:
      extension ===
        "tsv"
          ? "tsv-text"
          : "csv-text",

    kind:
      extension
  });
}


/* =====================================================
   XLS / XLSX / ODS
   ===================================================== */

async function extractSpreadsheet(
  buffer,
  extension
) {
  const imported =
    await import(
      "xlsx"
    );


  const XLSX =
    imported.default ||
    imported;


  const workbook =
    XLSX.read(
      ensureBuffer(
        buffer
      ),
      {
        type:
          "buffer",

        cellDates:
          true,

        cellText:
          false,

        cellNF:
          false
      }
    );


  const sheetNames =
    Array.isArray(
      workbook.SheetNames
    )
      ? workbook.SheetNames
          .slice(
            0,
            LIMITS
              .maxSpreadsheetSheets
          )
      : [];


  const sections =
    [];


  const metadataSheets =
    [];


  for (
    const sheetName
    of sheetNames
  ) {
    const sheet =
      workbook.Sheets[
        sheetName
      ];


    if (!sheet) {
      continue;
    }


    const rows =
      XLSX.utils
        .sheet_to_json(
          sheet,
          {
            header:
              1,

            raw:
              false,

            defval:
              "",

            blankrows:
              false
          }
        )
        .slice(
          0,
          LIMITS
            .maxSpreadsheetRowsPerSheet
        );


    const rendered =
      rows.map(
        row =>
          row
            .map(
              cell =>
                String(
                  cell ??
                  ""
                )
                  .replace(
                    /\t/g,
                    " "
                  )
            )
            .join(
              "\t"
            )
      );


    sections.push(
      `### Sheet: ${sheetName}\n${rendered.join("\n")}`
    );


    metadataSheets.push({
      name:
        sheetName,

      rows:
        rows.length
    });
  }


  const warnings =
    [];


  if (
    workbook.SheetNames
      ?.length >
    LIMITS
      .maxSpreadsheetSheets
  ) {
    warnings.push(
      `Only the first ${LIMITS.maxSpreadsheetSheets} spreadsheet sheets were extracted.`
    );
  }


  return createResult({
    text:
      sections.join(
        "\n\n"
      ),

    parser:
      "xlsx",

    kind:
      extension,

    metadata: {
      sheets:
        metadataSheets,

      totalSheets:
        workbook.SheetNames
          ?.length ||
        0
    },

    warnings
  });
}


/* =====================================================
   PDF
   ===================================================== */

async function extractPdf(
  buffer
) {
  const imported =
    await import(
      "pdf-parse"
    );


  const pdfParse =
    imported.default ||
    imported;


  const result =
    await pdfParse(
      ensureBuffer(
        buffer
      )
    );


  return createResult({
    text:
      result?.text ||
      "",

    parser:
      "pdf-parse",

    kind:
      "pdf",

    metadata: {
      pages:
        Number(
          result?.numpages
        ) ||
        null,

      info:
        result?.info &&
        typeof result.info ===
          "object"
            ? result.info
            : {}
    }
  });
}


/* =====================================================
   DOCX
   ===================================================== */

async function extractDocx(
  buffer
) {
  const imported =
    await import(
      "mammoth"
    );


  const mammoth =
    imported.default ||
    imported;


  const result =
    await mammoth
      .extractRawText({
        buffer:
          ensureBuffer(
            buffer
          )
      });


  const warnings =
    Array.isArray(
      result?.messages
    )
      ? result.messages
          .map(
            item =>
              item?.message
          )
          .filter(
            Boolean
          )
      : [];


  return createResult({
    text:
      result?.value ||
      "",

    parser:
      "mammoth",

    kind:
      "docx",

    warnings
  });
}


/* =====================================================
   SAFE RTF — BEST EFFORT
   ===================================================== */

function extractRtf(
  buffer
) {
  let text =
    decodeUtf8(
      buffer
    );


  const warnings =
    [
      "RTF extraction uses a safe best-effort text parser and may not preserve complex formatting."
    ];


  /*
   * Remove common destination groups.
   * This is intentionally conservative.
   */

  text =
    text.replace(
      /{\\\*[^{}]*}/g,
      " "
    );


  text =
    text.replace(
      /\\(?:fonttbl|colortbl|stylesheet|info|pict|object)\b[^{}]*/gi,
      " "
    );


  /*
   * Hex escapes: \'hh
   */

  text =
    text.replace(
      /\\'([0-9a-fA-F]{2})/g,
      (
        _match,
        hex
      ) => {
        try {
          return Buffer
            .from(
              [
                parseInt(
                  hex,
                  16
                )
              ]
            )
            .toString(
              "latin1"
            );
        } catch {
          return "";
        }
      }
    );


  /*
   * Unicode escapes: \uN?
   */

  text =
    text.replace(
      /\\u(-?\d+)\??/g,
      (
        _match,
        value
      ) => {
        let code =
          Number(
            value
          );

        if (
          code <
          0
        ) {
          code +=
            65536;
        }

        try {
          return String
            .fromCharCode(
              code
            );
        } catch {
          return "";
        }
      }
    );


  /*
   * Common paragraph controls.
   */

  text =
    text
      .replace(
        /\\par[d]?\b/g,
        "\n"
      )
      .replace(
        /\\line\b/g,
        "\n"
      )
      .replace(
        /\\tab\b/g,
        "\t"
      );


  /*
   * Remove remaining RTF control words.
   */

  text =
    text.replace(
      /\\[a-zA-Z]+-?\d* ?/g,
      ""
    );


  /*
   * Remove escaped braces/backslashes.
   */

  text =
    text
      .replace(
        /\\([{}\\])/g,
        "$1"
      )
      .replace(
        /[{}]/g,
        ""
      );


  return createResult({
    text,

    parser:
      "rtf-safe",

    kind:
      "rtf",

    warnings
  });
}


/* =====================================================
   ZIP HELPERS
   ===================================================== */

async function loadZip(
  buffer
) {
  const imported =
    await import(
      "jszip"
    );


  const JSZip =
    imported.default ||
    imported;


  return JSZip.loadAsync(
    ensureBuffer(
      buffer
    )
  );
}


function isProbablyTextFilename(
  name
) {
  const extension =
    getExtensionFromName(
      name
    );


  return (
    PLAIN_TEXT_EXTENSIONS
      .has(
        extension
      ) ||
    JSON_EXTENSIONS
      .has(
        extension
      ) ||
    [
      "csv",
      "tsv",
      "rtf"
    ].includes(
      extension
    )
  );
}


/* =====================================================
   ODT
   ===================================================== */

async function extractOdt(
  buffer
) {
  const zip =
    await loadZip(
      buffer
    );


  const contentFile =
    zip.file(
      "content.xml"
    );


  if (!contentFile) {
    throw new Error(
      "ODT content.xml is missing."
    );
  }


  let xml =
    await contentFile.async(
      "string"
    );


  xml =
    xml
      .replace(
        /<text:tab[^>]*\/>/gi,
        "\t"
      )
      .replace(
        /<text:line-break[^>]*\/>/gi,
        "\n"
      )
      .replace(
        /<\/text:p>/gi,
        "\n"
      )
      .replace(
        /<\/text:h>/gi,
        "\n"
      )
      .replace(
        /<[^>]+>/g,
        " "
      );


  return createResult({
    text:
      decodeEntities(
        xml
      ),

    parser:
      "odt-content-xml",

    kind:
      "odt"
  });
}


/* =====================================================
   PPTX
   ===================================================== */

async function extractPptx(
  buffer
) {
  const zip =
    await loadZip(
      buffer
    );


  const slideFiles =
    Object.keys(
      zip.files
    )
      .filter(
        name =>
          /^ppt\/slides\/slide\d+\.xml$/i
            .test(
              name
            )
      )
      .sort(
        naturalSlideSort
      )
      .slice(
        0,
        LIMITS
          .maxPresentationSlides
      );


  const slides =
    [];


  for (
    let index =
      0;
    index <
      slideFiles.length;
    index +=
      1
  ) {
    const xml =
      await zip
        .file(
          slideFiles[
            index
          ]
        )
        ?.async(
          "string"
        );


    if (!xml) {
      continue;
    }


    const text =
      extractOfficeXmlText(
        xml
      );


    slides.push(
      `### Slide ${index + 1}\n${text}`
    );
  }


  const warnings =
    [];


  const totalSlides =
    Object.keys(
      zip.files
    )
      .filter(
        name =>
          /^ppt\/slides\/slide\d+\.xml$/i
            .test(
              name
            )
      )
      .length;


  if (
    totalSlides >
    LIMITS
      .maxPresentationSlides
  ) {
    warnings.push(
      `Only the first ${LIMITS.maxPresentationSlides} slides were extracted.`
    );
  }


  return createResult({
    text:
      slides.join(
        "\n\n"
      ),

    parser:
      "pptx-xml",

    kind:
      "pptx",

    metadata: {
      slides:
        Math.min(
          totalSlides,
          LIMITS
            .maxPresentationSlides
        ),

      totalSlides
    },

    warnings
  });
}


/* =====================================================
   ODP
   ===================================================== */

async function extractOdp(
  buffer
) {
  const zip =
    await loadZip(
      buffer
    );


  const content =
    zip.file(
      "content.xml"
    );


  if (!content) {
    throw new Error(
      "ODP content.xml is missing."
    );
  }


  const xml =
    await content.async(
      "string"
    );


  const text =
    extractOfficeXmlText(
      xml
    );


  return createResult({
    text,

    parser:
      "odp-content-xml",

    kind:
      "odp"
  });
}


/* =====================================================
   OFFICE XML TEXT
   ===================================================== */

function decodeEntities(
  value
) {
  return String(
    value ??
    ""
  )
    .replace(
      /&lt;/g,
      "<"
    )
    .replace(
      /&gt;/g,
      ">"
    )
    .replace(
      /&quot;/g,
      '"'
    )
    .replace(
      /&apos;/g,
      "'"
    )
    .replace(
      /&amp;/g,
      "&"
    )
    .replace(
      /&#(\d+);/g,
      (
        _match,
        code
      ) => {
        try {
          return String
            .fromCodePoint(
              Number(
                code
              )
            );
        } catch {
          return "";
        }
      }
    )
    .replace(
      /&#x([0-9a-fA-F]+);/g,
      (
        _match,
        code
      ) => {
        try {
          return String
            .fromCodePoint(
              parseInt(
                code,
                16
              )
            );
        } catch {
          return "";
        }
      }
    );
}


function extractOfficeXmlText(
  xml
) {
  let text =
    String(
      xml ??
      ""
    );


  text =
    text
      .replace(
        /<(?:a|text):br\b[^>]*\/?>/gi,
        "\n"
      )
      .replace(
        /<(?:a|text):tab\b[^>]*\/?>/gi,
        "\t"
      )
      .replace(
        /<\/(?:a:p|text:p|text:h)>/gi,
        "\n"
      );


  const extracted =
    [];


  const regex =
    /<(?:a:t|text:span|text:p|text:h)[^>]*>([\s\S]*?)<\/(?:a:t|text:span|text:p|text:h)>/gi;


  let match;


  while (
    (
      match =
        regex.exec(
          text
        )
    )
  ) {
    const value =
      decodeEntities(
        match[1]
          .replace(
            /<[^>]+>/g,
            " "
          )
      )
        .replace(
          /\s+/g,
          " "
        )
        .trim();


    if (value) {
      extracted.push(
        value
      );
    }
  }


  if (
    extracted.length
  ) {
    return extracted.join(
      "\n"
    );
  }


  return decodeEntities(
    text
      .replace(
        /<[^>]+>/g,
        " "
      )
  );
}


function naturalSlideSort(
  a,
  b
) {
  const aNumber =
    Number(
      a.match(
        /slide(\d+)\.xml/i
      )?.[1]
    ) ||
    0;


  const bNumber =
    Number(
      b.match(
        /slide(\d+)\.xml/i
      )?.[1]
    ) ||
    0;


  return (
    aNumber -
    bNumber
  );
}


/* =====================================================
   ZIP ARCHIVE SAFE EXTRACTION
   ===================================================== */

async function extractZip(
  buffer
) {
  const zip =
    await loadZip(
      buffer
    );


  const names =
    Object.keys(
      zip.files
    );


  if (
    names.length >
    LIMITS
      .maxZipEntries
  ) {
    throw new Error(
      `ZIP contains too many entries (${names.length}).`
    );
  }


  const output =
    [];


  const warnings =
    [];


  let readableCount =
    0;


  let totalBytes =
    0;


  for (
    const name
    of names
  ) {
    const entry =
      zip.files[
        name
      ];


    if (
      !entry ||
      entry.dir
    ) {
      continue;
    }


    if (
      readableCount >=
      LIMITS
        .maxReadableZipEntries
    ) {
      break;
    }


    if (
      !isProbablyTextFilename(
        name
      )
    ) {
      continue;
    }


    const data =
      await entry.async(
        "nodebuffer"
      );


    if (
      data.length >
      LIMITS
        .maxArchiveEntryBytes
    ) {
      warnings.push(
        `"${name}" was skipped because it is too large to inspect safely.`
      );

      continue;
    }


    if (
      totalBytes +
        data.length >
      LIMITS
        .maxArchiveTextBytes
    ) {
      warnings.push(
        "Archive text extraction stopped after reaching the safe archive text limit."
      );

      break;
    }


    totalBytes +=
      data.length;


    readableCount +=
      1;


    const extension =
      getExtensionFromName(
        name
      );


    let text;


    if (
      JSON_EXTENSIONS
        .has(
          extension
        )
    ) {
      text =
        extractJson(
          data,
          extension
        ).text;

    } else {
      text =
        decodeUtf8(
          data
        );
    }


    output.push(
      `### File: ${name}\n${text}`
    );
  }


  if (
    readableCount ===
    0
  ) {
    warnings.push(
      "No supported readable text files were found inside the ZIP archive."
    );
  }


  if (
    names.length >
    LIMITS
      .maxReadableZipEntries
  ) {
    warnings.push(
      `Archive inspection is limited to ${LIMITS.maxReadableZipEntries} readable entries.`
    );
  }


  return createResult({
    text:
      output.join(
        "\n\n"
      ),

    parser:
      "zip-safe-text",

    kind:
      "zip",

    metadata: {
      totalEntries:
        names.length,

      readableEntries:
        readableCount,

      extractedBytes:
        totalBytes
    },

    warnings
  });
}


/* =====================================================
   GZIP
   ===================================================== */

function extractGzip(
  buffer,
  name
) {
  const output =
    zlib.gunzipSync(
      ensureBuffer(
        buffer
      ),
      {
        maxOutputLength:
          LIMITS
            .maxArchiveTextBytes
      }
    );


  const innerName =
    String(
      name ||
      ""
    )
      .replace(
        /\.gz$/i,
        ""
      );


  const innerExtension =
    getExtensionFromName(
      innerName
    );


  let text =
    decodeUtf8(
      output
    );


  if (
    JSON_EXTENSIONS
      .has(
        innerExtension
      )
  ) {
    text =
      extractJson(
        output,
        innerExtension
      ).text;
  }


  return createResult({
    text,

    parser:
      "gzip",

    kind:
      "gz",

    metadata: {
      decompressedBytes:
        output.length,

      innerName:
        innerName ||
        null
    }
  });
}


/* =====================================================
   UNSUPPORTED FORMAT
   ===================================================== */

function unsupportedResult(
  kind,
  message
) {
  return createResult({
    text:
      "",

    parser:
      "unsupported",

    kind,

    warnings: [
      message
    ]
  });
}


/* =====================================================
   MAIN EXTRACTOR
   ===================================================== */

export async function extractAttachment({
  buffer,
  name =
    "",
  mime =
    "",
  extension =
    "",
  category =
    ""
} = {}) {
  const safeBuffer =
    ensureBuffer(
      buffer
    );


  const ext =
    normalizeExtension(
      extension
    ) ||
    getExtensionFromName(
      name
    );


  const safeMime =
    cleanString(
      mime
    )
      .toLowerCase();


  const safeCategory =
    cleanString(
      category
    )
      .toLowerCase();


  /* ===================================================
     PDF
     =================================================== */

  if (
    ext ===
      "pdf" ||
    safeMime ===
      "application/pdf"
  ) {
    return extractPdf(
      safeBuffer
    );
  }


  /* ===================================================
     DOCX
     =================================================== */

  if (
    ext ===
      "docx" ||
    safeMime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractDocx(
      safeBuffer
    );
  }


  /* ===================================================
     RTF
     =================================================== */

  if (
    ext ===
      "rtf" ||
    safeMime ===
      "application/rtf" ||
    safeMime ===
      "text/rtf"
  ) {
    return extractRtf(
      safeBuffer
    );
  }


  /* ===================================================
     ODT
     =================================================== */

  if (
    ext ===
      "odt" ||
    safeMime ===
      "application/vnd.oasis.opendocument.text"
  ) {
    return extractOdt(
      safeBuffer
    );
  }


  /* ===================================================
     PPTX
     =================================================== */

  if (
    ext ===
      "pptx" ||
    safeMime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return extractPptx(
      safeBuffer
    );
  }


  /* ===================================================
     ODP
     =================================================== */

  if (
    ext ===
      "odp" ||
    safeMime ===
      "application/vnd.oasis.opendocument.presentation"
  ) {
    return extractOdp(
      safeBuffer
    );
  }


  /* ===================================================
     SPREADSHEET
     =================================================== */

  if (
    SPREADSHEET_EXTENSIONS
      .has(
        ext
      )
  ) {
    return extractSpreadsheet(
      safeBuffer,
      ext
    );
  }


  /* ===================================================
     CSV / TSV
     =================================================== */

  if (
    ext ===
      "csv" ||
    ext ===
      "tsv"
  ) {
    return extractDelimitedText(
      safeBuffer,
      ext
    );
  }


  /* ===================================================
     JSON
     =================================================== */

  if (
    JSON_EXTENSIONS
      .has(
        ext
      ) ||
    safeMime ===
      "application/json"
  ) {
    return extractJson(
      safeBuffer,
      ext ||
      "json"
    );
  }


  /* ===================================================
     ZIP
     =================================================== */

  if (
    ext ===
      "zip" ||
    safeMime ===
      "application/zip"
  ) {
    return extractZip(
      safeBuffer
    );
  }


  /* ===================================================
     GZIP
     =================================================== */

  if (
    ext ===
      "gz" ||
    safeMime ===
      "application/gzip"
  ) {
    return extractGzip(
      safeBuffer,
      name
    );
  }


  /* ===================================================
     PLAIN TEXT / CODE / CONFIG
     =================================================== */

  if (
    PLAIN_TEXT_EXTENSIONS
      .has(
        ext
      ) ||
    safeMime.startsWith(
      "text/"
    ) ||
    safeCategory ===
      "text" ||
    safeCategory ===
      "code"
  ) {
    return extractPlainText(
      safeBuffer,
      ext ||
      safeCategory ||
      "text"
    );
  }


  /* ===================================================
     LEGACY OFFICE
     =================================================== */

  if (
    ext ===
      "doc"
  ) {
    return unsupportedResult(
      "doc",
      "Legacy .doc files are not directly readable. Convert the file to .docx and attach it again."
    );
  }


  if (
    ext ===
      "ppt"
  ) {
    return unsupportedResult(
      "ppt",
      "Legacy .ppt files are not directly readable. Convert the file to .pptx and attach it again."
    );
  }


  /* ===================================================
     APPLE OFFICE
     =================================================== */

  if (
    [
      "pages",
      "numbers",
      "key"
    ].includes(
      ext
    )
  ) {
    return unsupportedResult(
      ext,
      `.${ext} files are stored safely but are not currently readable by this extractor. Export to PDF or an Office format first.`
    );
  }


  /* ===================================================
     DATABASE / COLUMNAR DATA
     =================================================== */

  if (
    [
      "db",
      "sqlite",
      "sqlite3",
      "parquet",
      "feather",
      "arrow"
    ].includes(
      ext
    )
  ) {
    return unsupportedResult(
      ext,
      `.${ext} files are not currently parsed directly. Export the relevant data to CSV, TSV, JSON, or XLSX.`
    );
  }


  /* ===================================================
     OTHER ARCHIVES
     =================================================== */

  if (
    [
      "rar",
      "7z",
      "tar",
      "tgz",
      "bz2",
      "xz"
    ].includes(
      ext
    )
  ) {
    return unsupportedResult(
      ext,
      `.${ext} archive extraction is not currently enabled. ZIP or GZIP is supported.`
    );
  }


  /* ===================================================
     IMAGE / AUDIO / VIDEO

     These should normally never reach this extractor
     because process.js stores them as references.
     =================================================== */

  if (
    [
      "image",
      "audio",
      "video"
    ].includes(
      safeCategory
    )
  ) {
    return unsupportedResult(
      safeCategory,
      `${safeCategory} files are handled as secure multimodal references rather than text extraction.`
    );
  }


  /* ===================================================
     UNKNOWN
     =================================================== */

  return unsupportedResult(
    ext ||
    safeCategory ||
    "unknown",
    "This file format is stored securely but does not currently have a safe text extractor."
  );
}


export default extractAttachment;
