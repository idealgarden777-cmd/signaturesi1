/*
=========================================================
NEYO — UNIVERSAL ATTACHMENT EXTRACTORS
STABLE v3 — SERVERLESS SAFE

FILE:
lib/attachments/extractors.js

EXPORT:
extractAttachment({ buffer, name, mime, extension, category })

GOALS
---------------------------------------------------------
✅ Never execute uploaded code/macros/scripts
✅ Serverless-safe PDF loading
✅ Corrupt/unsupported files degrade to warnings
✅ Bounded archive / spreadsheet / text extraction
✅ TXT / Markdown / code / JSON / CSV / TSV
✅ XLS / XLSX / XLSM / XLSB / ODS
✅ PDF / DOCX / RTF / ODT
✅ PPTX / ODP
✅ ZIP / GZIP
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
   EXTENSIONS
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


const MULTIMODAL_CATEGORIES =
  new Set([
    "image",
    "audio",
    "video"
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


  return normalizeExtension(
    value.slice(
      index + 1
    )
  );
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


  if (
    buffer instanceof
    ArrayBuffer
  ) {

    return Buffer.from(
      new Uint8Array(
        buffer
      )
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


/* =====================================================
   RESULT
   ===================================================== */

function createResult({

  text =
    "",

  parser =
    "unknown",

  kind =
    "unknown",

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
        ].filter(
          Boolean
        )
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

    parser,

    kind,

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
   SAFE PARSER FAILURE
   ===================================================== */

function parserFailure(
  kind,
  parser,
  error
) {

  const message =
    cleanString(
      error?.message ||
      error ||
      "Unknown parser error"
    );


  console.warn(
    "[NEYO Extractor] Parser fallback",
    {

      kind,

      parser,

      message
    }
  );


  return createResult({

    text:
      "",

    parser:
      `${parser}-failed`,

    kind,

    metadata: {

      failed:
        true
    },

    warnings: [

      `The ${String(
        kind
      ).toUpperCase()} file was stored successfully but its text could not be extracted safely.`
    ]
  });
}


async function safeExtract(
  kind,
  parser,
  fn
) {

  try {

    const result =
      await fn();


    if (
      !result ||
      typeof result !==
        "object"
    ) {

      throw new Error(
        "Extractor returned an invalid result."
      );
    }


    return result;

  } catch (
    error
  ) {

    return parserFailure(
      kind,
      parser,
      error
    );
  }
}


/* =====================================================
   UNSUPPORTED
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

    metadata: {

      referenceOnly:
        true
    },

    warnings: [

      message
    ]
  });
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

        output.push(
          JSON.stringify(
            JSON.parse(
              line
            ),
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

      warnings: [

        "JSON parsing failed; content was preserved as plain text."
      ]
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

  return createResult({

    text:
      decodeUtf8(
        buffer
      ),

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
   SPREADSHEETS
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


  const allNames =
    Array.isArray(
      workbook.SheetNames
    )
      ? workbook.SheetNames
      : [];


  const sheetNames =
    allNames.slice(
      0,
      LIMITS
        .maxSpreadsheetSheets
    );


  const sections =
    [];


  const metadataSheets =
    [];


  const warnings =
    [];


  for (
    const sheetName
    of sheetNames
  ) {

    const sheet =
      workbook.Sheets?.[
        sheetName
      ];


    if (!sheet) {

      continue;
    }


    const allRows =
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
        );


    const rows =
      allRows.slice(
        0,
        LIMITS
          .maxSpreadsheetRowsPerSheet
      );


    const rendered =
      rows.map(
        row =>

          (
            Array.isArray(
              row
            )
              ? row
              : [
                  row
                ]
          )
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
                  .replace(
                    /\r?\n/g,
                    " "
                  )
            )
            .join(
              "\t"
            )
      );


    sections.push(
      `### Sheet: ${sheetName}\n${rendered.join(
        "\n"
      )}`
    );


    metadataSheets.push({

      name:
        sheetName,

      rows:
        rows.length,

      totalRows:
        allRows.length
    });


    if (
      allRows.length >
      LIMITS
        .maxSpreadsheetRowsPerSheet
    ) {

      warnings.push(
        `Sheet "${sheetName}" was limited to ${LIMITS.maxSpreadsheetRowsPerSheet.toLocaleString()} rows.`
      );
    }
  }


  if (
    allNames.length >
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
        allNames.length
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

  /*
   * IMPORTANT
   * ---------------------------------------------------
   * DO NOT:
   *
   * await import("pdf-parse")
   *
   * pdf-parse@1.1.1 package root can execute its
   * debug/sample code in ESM/serverless environments.
   *
   * That is what causes:
   *
   * ./test/data/05-versions-space.pdf
   * ENOENT
   *
   * Import the actual library implementation instead.
   */


  const imported =
    await import(
      "pdf-parse/lib/pdf-parse.js"
    );


  const pdfParse =
    imported.default ||
    imported;


  if (
    typeof pdfParse !==
    "function"
  ) {

    throw new TypeError(
      "PDF parser is unavailable."
    );
  }


  const safeBuffer =
    ensureBuffer(
      buffer
    );


  /*
   * Basic PDF signature validation.
   */

  if (
    safeBuffer.length <
      5 ||
    safeBuffer
      .subarray(
        0,
        5
      )
      .toString(
        "ascii"
      ) !==
      "%PDF-"
  ) {

    throw new Error(
      "The file does not contain a valid PDF header."
    );
  }


  const result =
    await pdfParse(
      safeBuffer,
      {

        max:
          0
      }
    );


  const warnings =
    [];


  if (
    !cleanString(
      result?.text
    )
  ) {

    warnings.push(
      "No selectable text was found in this PDF. It may be scanned or image-only."
    );
  }


  return createResult({

    text:
      result?.text ||
      "",

    parser:
      "pdf-parse-lib",

    kind:
      "pdf",

    metadata: {

      pages:
        Number(
          result?.numpages
        ) ||
        null,

      renderedPages:
        Number(
          result?.numrender
        ) ||
        null,

      info:
        result?.info &&
        typeof result.info ===
          "object"
            ? result.info
            : {},

      metadata:
        result?.metadata &&
        typeof result.metadata ===
          "object"
            ? result.metadata
            : {}
    },

    warnings
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


  if (
    !mammoth
      ?.extractRawText
  ) {

    throw new TypeError(
      "DOCX parser is unavailable."
    );
  }


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
              cleanString(
                item?.message
              )
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
   RTF
   ===================================================== */

function extractRtf(
  buffer
) {

  let text =
    decodeUtf8(
      buffer
    );


  const warnings = [

    "RTF extraction uses a safe best-effort parser and may not preserve complex formatting."
  ];


  text =
    text
      .replace(
        /{\\\*[^{}]*}/g,
        " "
      )
      .replace(
        /\\(?:fonttbl|colortbl|stylesheet|info|pict|object)\b[^{}]*/gi,
        " "
      )
      .replace(
        /\\'([0-9a-fA-F]{2})/g,
        (
          _match,
          hex
        ) =>

          Buffer
            .from([
              parseInt(
                hex,
                16
              )
            ])
            .toString(
              "latin1"
            )
      )
      .replace(
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
      )
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
      )
      .replace(
        /\\[a-zA-Z]+-?\d* ?/g,
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
   ZIP LOADER
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


  if (
    !JSZip
      ?.loadAsync
  ) {

    throw new TypeError(
      "ZIP parser is unavailable."
    );
  }


  return JSZip.loadAsync(
    ensureBuffer(
      buffer
    ),
    {

      checkCRC32:
        false
    }
  );
}


/* =====================================================
   XML ENTITIES
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


/* =====================================================
   OFFICE XML
   ===================================================== */

function stripOfficeXml(
  xml
) {

  return decodeEntities(

    String(
      xml ??
      ""
    )
      .replace(
        /<(?:a|text):br\b[^>]*\/?>/gi,
        "\n"
      )
      .replace(
        /<(?:a|text):tab\b[^>]*\/?>/gi,
        "\t"
      )
      .replace(
        /<text:line-break\b[^>]*\/?>/gi,
        "\n"
      )
      .replace(
        /<text:tab\b[^>]*\/?>/gi,
        "\t"
      )
      .replace(
        /<\/\s*(?:a:p|text:p|text:h|w:p)\s*>/gi,
        "\n"
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
  )
    .replace(
      /[ \t]+/g,
      " "
    )
    .replace(
      / *\n */g,
      "\n"
    )
    .replace(
      /\n{3,}/g,
      "\n\n"
    )
    .trim();
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
   ODT
   ===================================================== */

async function extractOdt(
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
      "ODT content.xml is missing."
    );
  }


  const xml =
    await content.async(
      "string"
    );


  return createResult({

    text:
      stripOfficeXml(
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


  const allSlideFiles =
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
      );


  const slideFiles =
    allSlideFiles.slice(
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

    const file =
      zip.file(
        slideFiles[
          index
        ]
      );


    if (!file) {

      continue;
    }


    const xml =
      await file.async(
        "string"
      );


    const text =
      stripOfficeXml(
        xml
      );


    if (text) {

      slides.push(
        `### Slide ${index + 1}\n${text}`
      );
    }
  }


  const warnings =
    [];


  if (
    allSlideFiles.length >
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
        slideFiles.length,

      totalSlides:
        allSlideFiles.length
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


  return createResult({

    text:
      stripOfficeXml(
        xml
      ),

    parser:
      "odp-content-xml",

    kind:
      "odp"
  });
}


/* =====================================================
   ZIP HELPERS
   ===================================================== */

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
   ZIP
   ===================================================== */

async function extractZip(
  buffer
) {

  const zip =
    await loadZip(
      buffer
    );


  const allNames =
    Object.keys(
      zip.files
    );


  const names =
    allNames.slice(
      0,
      LIMITS
        .maxZipEntries
    );


  const warnings =
    [];


  const output =
    [];


  let readableCount =
    0;


  let totalBytes =
    0;


  if (
    allNames.length >
    LIMITS
      .maxZipEntries
  ) {

    warnings.push(
      `Archive inspection was limited to the first ${LIMITS.maxZipEntries} entries.`
    );
  }


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
      entry.dir ||
      !isProbablyTextFilename(
        name
      )
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


    const text =
      JSON_EXTENSIONS
        .has(
          extension
        )
          ? extractJson(
              data,
              extension
            ).text
          : decodeUtf8(
              data
            );


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
        allNames.length,

      inspectedEntries:
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


  const text =
    JSON_EXTENSIONS
      .has(
        innerExtension
      )
        ? extractJson(
            output,
            innerExtension
          ).text
        : decodeUtf8(
            output
          );


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
      .toLowerCase()
      .split(
        ";",
        1
      )[0]
      .trim();


  const safeCategory =
    cleanString(
      category
    )
      .toLowerCase();


  /* ===================================================
     EMPTY
     =================================================== */

  if (
    safeBuffer.length ===
    0
  ) {

    return createResult({

      text:
        "",

      parser:
        "empty",

      kind:
        ext ||
        safeCategory ||
        "unknown",

      warnings: [

        "The uploaded file is empty."
      ]
    });
  }


  /* ===================================================
     MULTIMODAL
     =================================================== */

  if (
    MULTIMODAL_CATEGORIES
      .has(
        safeCategory
      )
  ) {

    return unsupportedResult(

      safeCategory,

      `${safeCategory} files are handled as secure multimodal references rather than text extraction.`
    );
  }


  /* ===================================================
     PDF
     =================================================== */

  if (
    ext ===
      "pdf" ||
    safeMime ===
      "application/pdf"
  ) {

    return safeExtract(
      "pdf",
      "pdf-parse-lib",
      () =>
        extractPdf(
          safeBuffer
        )
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

    return safeExtract(
      "docx",
      "mammoth",
      () =>
        extractDocx(
          safeBuffer
        )
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

    return safeExtract(
      "rtf",
      "rtf-safe",
      () =>
        extractRtf(
          safeBuffer
        )
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

    return safeExtract(
      "odt",
      "odt-content-xml",
      () =>
        extractOdt(
          safeBuffer
        )
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

    return safeExtract(
      "pptx",
      "pptx-xml",
      () =>
        extractPptx(
          safeBuffer
        )
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

    return safeExtract(
      "odp",
      "odp-content-xml",
      () =>
        extractOdp(
          safeBuffer
        )
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

    return safeExtract(
      ext ||
      "spreadsheet",
      "xlsx",
      () =>
        extractSpreadsheet(
          safeBuffer,
          ext
        )
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

    return safeExtract(
      ext,
      `${ext}-text`,
      () =>
        extractDelimitedText(
          safeBuffer,
          ext
        )
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

    return safeExtract(
      ext ||
      "json",
      "json",
      () =>
        extractJson(
          safeBuffer,
          ext ||
          "json"
        )
    );
  }


  /* ===================================================
     ZIP
     =================================================== */

  if (
    ext ===
      "zip" ||
    safeMime ===
      "application/zip" ||
    safeMime ===
      "application/x-zip-compressed"
  ) {

    return safeExtract(
      "zip",
      "zip-safe-text",
      () =>
        extractZip(
          safeBuffer
        )
    );
  }


  /* ===================================================
     GZIP
     =================================================== */

  if (
    ext ===
      "gz" ||
    safeMime ===
      "application/gzip" ||
    safeMime ===
      "application/x-gzip"
  ) {

    return safeExtract(
      "gz",
      "gzip",
      () =>
        extractGzip(
          safeBuffer,
          name
        )
    );
  }


  /* ===================================================
     TEXT / CODE
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

    return safeExtract(

      ext ||
      safeCategory ||
      "text",

      "utf8",

      () =>
        extractPlainText(
          safeBuffer,
          ext ||
          safeCategory ||
          "text"
        )
    );
  }


  /* ===================================================
     LEGACY DOC
     =================================================== */

  if (
    ext ===
      "doc"
  ) {

    return unsupportedResult(

      "doc",

      "Legacy .doc files are stored safely but are not directly readable. Convert to .docx or PDF."
    );
  }


  /* ===================================================
     LEGACY PPT
     =================================================== */

  if (
    ext ===
      "ppt"
  ) {

    return unsupportedResult(

      "ppt",

      "Legacy .ppt files are stored safely but are not directly readable. Convert to .pptx or PDF."
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

      `.${ext} files are stored safely but are not currently readable. Export to PDF or an Office format first.`
    );
  }


  /* ===================================================
     DATABASE / COLUMNAR
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

      `.${ext} files are stored safely but are not currently parsed directly. Export relevant data to CSV, TSV, JSON, or XLSX.`
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

      `.${ext} archive extraction is not enabled. ZIP and GZIP are supported.`
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
