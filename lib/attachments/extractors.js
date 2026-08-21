/*
=========================================================
NEYO — UNIVERSAL ATTACHMENT EXTRACTORS v1

Purpose:
- Convert uploaded files into model-readable content
- Handle common document/data/code formats
- Fail gracefully on unsupported binary formats
- Never execute uploaded content
- Limit extraction size
- Protect against malformed/huge archives

Supported extraction:
✓ TXT / MD / source code
✓ JSON / JSONL / NDJSON
✓ CSV / TSV
✓ XML / HTML / CSS
✓ YAML / YML
✓ TOML / INI / ENV
✓ PDF
✓ DOCX
✓ XLS / XLSX / XLSM / ODS
✓ PPTX
✓ SVG
✓ ZIP (safe text extraction)

Metadata/fallback:
✓ Images
✓ Audio
✓ Video
✓ unknown binary files

Requires:
npm install pdf-parse mammoth xlsx jszip

=========================================================
*/

import path from "node:path";


/* =========================================================
   CONFIG
   ========================================================= */

const CONFIG = Object.freeze({

  /*
  Maximum text returned directly to the model pipeline.
  Larger extracted documents are truncated here and should
  later be chunked/indexed by normalize/chunking layer.
  */

  maxExtractedChars:
    1_500_000,


  maxTextFileBytes:
    20 * 1024 * 1024,


  maxSpreadsheetSheets:
    50,


  maxSpreadsheetRowsPerSheet:
    20_000,


  maxSpreadsheetColumns:
    250,


  maxPptSlides:
    500,


  maxZipEntries:
    500,


  maxZipExpandedBytes:
    100 * 1024 * 1024,


  maxZipTextFiles:
    100,


  maxZipSingleEntryBytes:
    10 * 1024 * 1024
});


/* =========================================================
   EXTENSION GROUPS
   ========================================================= */

const TEXT_EXTENSIONS =
  new Set([
    "txt",
    "md",
    "markdown",
    "rtf",
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

    "sql",

    "dockerfile",
    "makefile",

    "env",
    "gitignore"
  ]);


const DATA_TEXT_EXTENSIONS =
  new Set([
    "json",
    "jsonl",
    "ndjson",

    "xml",

    "yaml",
    "yml",

    "toml",

    "ini",
    "conf",
    "cfg",

    "csv",
    "tsv"
  ]);


const SPREADSHEET_EXTENSIONS =
  new Set([
    "xls",
    "xlsx",
    "xlsm",
    "xlsb",
    "ods"
  ]);


const IMAGE_EXTENSIONS =
  new Set([
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "bmp",
    "tif",
    "tiff",
    "heic",
    "heif",
    "avif"
  ]);


const AUDIO_EXTENSIONS =
  new Set([
    "mp3",
    "wav",
    "m4a",
    "aac",
    "ogg",
    "oga",
    "opus",
    "flac",
    "aiff",
    "wma"
  ]);


const VIDEO_EXTENSIONS =
  new Set([
    "mp4",
    "mov",
    "m4v",
    "webm",
    "avi",
    "mkv",
    "mpeg",
    "mpg",
    "wmv"
  ]);


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function normalizeExtension(
  extension,
  name
) {

  const explicit =
    String(
      extension || ""
    )
      .trim()
      .toLowerCase()
      .replace(
        /^\./,
        ""
      );


  if (explicit) {
    return explicit;
  }


  return path
    .extname(
      String(
        name || ""
      )
    )
    .replace(
      /^\./,
      ""
    )
    .toLowerCase();
}


function normalizeMime(
  mime
) {

  return String(
    mime ||
    "application/octet-stream"
  )
    .trim()
    .toLowerCase()
    .split(";")[0];
}


function safeName(
  name
) {

  return String(
    name || "file"
  )
    .normalize("NFKC")
    .replace(
      /[\u0000-\u001F\u007F]/g,
      ""
    )
    .slice(
      0,
      300
    );
}


function clampText(
  text
) {

  const value =
    String(
      text || ""
    );


  if (
    value.length <=
    CONFIG.maxExtractedChars
  ) {

    return {
      text:
        value,

      truncated:
        false
    };
  }


  return {

    text:
      value.slice(
        0,
        CONFIG.maxExtractedChars
      ),

    truncated:
      true
  };
}


function normalizeWhitespace(
  text
) {

  return String(
    text || ""
  )
    .replace(
      /\r\n/g,
      "\n"
    )
    .replace(
      /\r/g,
      "\n"
    )
    .replace(
      /\u0000/g,
      ""
    )
    .replace(
      /[ \t]+\n/g,
      "\n"
    )
    .replace(
      /\n{4,}/g,
      "\n\n\n"
    )
    .trim();
}


function createResult({
  extracted = false,
  text = "",
  type = "unknown",
  parser = "none",
  metadata = {},
  warnings = [],
  truncated = false
} = {}) {

  const limited =
    clampText(
      normalizeWhitespace(
        text
      )
    );


  return {

    extracted:
      Boolean(
        extracted
      ),


    text:
      limited.text,


    type,


    parser,


    metadata:
      metadata &&
      typeof metadata ===
        "object"
        ? metadata
        : {},


    warnings:
      Array.isArray(
        warnings
      )
        ? warnings
        : [],


    truncated:
      Boolean(
        truncated ||
        limited.truncated
      )
  };
}


/* =========================================================
   ENCODING
   ========================================================= */

function decodeUtf8(
  buffer
) {

  /*
  Node Buffer's UTF-8 decoder safely replaces malformed
  sequences rather than throwing.
  */

  let text =
    buffer.toString(
      "utf8"
    );


  /*
  UTF-8 BOM
  */

  if (
    text.charCodeAt(0) ===
    0xfeff
  ) {

    text =
      text.slice(1);
  }


  return text;
}


/* =========================================================
   TEXT FILE
   ========================================================= */

async function extractPlainText({
  buffer,
  extension,
  name,
  mime
}) {

  if (
    buffer.length >
    CONFIG.maxTextFileBytes
  ) {

    return createResult({
      extracted:
        false,

      type:
        "text",

      parser:
        "text",

      metadata: {
        name,
        mime,
        extension
      },

      warnings: [
        "Text file is too large for inline extraction."
      ]
    });
  }


  const text =
    decodeUtf8(
      buffer
    );


  return createResult({

    extracted:
      true,

    text,

    type:
      "text",

    parser:
      "utf8",

    metadata: {
      encoding:
        "utf-8",

      extension,

      characters:
        text.length
    }
  });
}


/* =========================================================
   JSON
   ========================================================= */

async function extractJson({
  buffer,
  extension
}) {

  const source =
    decodeUtf8(
      buffer
    );


  /*
  JSON Lines
  */

  if (
    extension ===
      "jsonl" ||
    extension ===
      "ndjson"
  ) {

    const lines =
      source
        .split(/\r?\n/)
        .filter(
          line =>
            line.trim()
        );


    let valid =
      0;

    let invalid =
      0;


    for (
      const line
      of lines
    ) {

      try {

        JSON.parse(
          line
        );

        valid +=
          1;

      } catch {

        invalid +=
          1;
      }
    }


    return createResult({

      extracted:
        true,

      text:
        source,

      type:
        "jsonl",

      parser:
        "json-lines",

      metadata: {
        lines:
          lines.length,

        validJsonLines:
          valid,

        invalidJsonLines:
          invalid
      },

      warnings:
        invalid
          ? [
              `${invalid} line(s) were not valid JSON.`
            ]
          : []
    });
  }


  try {

    const parsed =
      JSON.parse(
        source
      );


    const formatted =
      JSON.stringify(
        parsed,
        null,
        2
      );


    return createResult({

      extracted:
        true,

      text:
        formatted,

      type:
        "json",

      parser:
        "json",

      metadata: {

        rootType:
          Array.isArray(parsed)
            ? "array"
            : typeof parsed
      }
    });


  } catch {

    return createResult({

      extracted:
        true,

      text:
        source,

      type:
        "json",

      parser:
        "text-fallback",

      warnings: [
        "File extension is JSON, but the content is not valid JSON."
      ]
    });
  }
}


/* =========================================================
   DELIMITED TEXT — CSV / TSV
   ========================================================= */

async function extractDelimited({
  buffer,
  extension
}) {

  const source =
    decodeUtf8(
      buffer
    );


  const delimiter =
    extension ===
      "tsv"
      ? "\t"
      : ",";


  const lines =
    source.split(
      /\r?\n/
    );


  return createResult({

    extracted:
      true,

    text:
      source,

    type:
      extension ===
        "tsv"
        ? "tsv"
        : "csv",

    parser:
      "delimited-text",

    metadata: {

      rows:
        lines.filter(
          Boolean
        ).length,

      delimiter:
        delimiter === "\t"
          ? "tab"
          : "comma"
    }
  });
}


/* =========================================================
   PDF
   ========================================================= */

async function extractPdf({
  buffer
}) {

  try {

    const module =
      await import(
        "pdf-parse"
      );


    /*
    pdf-parse package versions differ in how
    CommonJS/default exports are exposed.
    */

    const pdfParse =
      module.default ||
      module.pdf ||
      module;


    if (
      typeof pdfParse !==
      "function"
    ) {

      throw new Error(
        "pdf-parse export is unavailable."
      );
    }


    const result =
      await pdfParse(
        buffer
      );


    const text =
      result?.text ||
      "";


    return createResult({

      extracted:
        Boolean(
          text.trim()
        ),

      text,

      type:
        "pdf",

      parser:
        "pdf-parse",

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
          result?.info ||
          null,

        metadata:
          result?.metadata ||
          null
      },

      warnings:
        text.trim()
          ? []
          : [
              "No machine-readable text was found. This PDF may be scanned and require OCR."
            ]
    });


  } catch (error) {

    return createResult({

      extracted:
        false,

      type:
        "pdf",

      parser:
        "pdf-parse",

      warnings: [
        `PDF extraction failed: ${
          error?.message ||
          "unknown error"
        }`
      ]
    });
  }
}


/* =========================================================
   DOCX
   ========================================================= */

async function extractDocx({
  buffer
}) {

  try {

    const mammothModule =
      await import(
        "mammoth"
      );


    const mammoth =
      mammothModule.default ||
      mammothModule;


    const result =
      await mammoth
        .extractRawText({
          buffer
        });


    const text =
      result?.value ||
      "";


    const messages =
      Array.isArray(
        result?.messages
      )
        ? result.messages
        : [];


    return createResult({

      extracted:
        Boolean(
          text.trim()
        ),

      text,

      type:
        "docx",

      parser:
        "mammoth",

      metadata: {

        messages:
          messages.length
      },

      warnings:
        messages
          .map(
            item =>
              String(
                item?.message ||
                ""
              )
          )
          .filter(Boolean)
          .slice(
            0,
            20
          )
    });


  } catch (error) {

    return createResult({

      extracted:
        false,

      type:
        "docx",

      parser:
        "mammoth",

      warnings: [
        `DOCX extraction failed: ${
          error?.message ||
          "unknown error"
        }`
      ]
    });
  }
}


/* =========================================================
   LEGACY DOC
   ========================================================= */

async function extractLegacyDoc() {

  /*
  .doc is Microsoft's old binary format.
  Parsing it safely usually requires a dedicated conversion
  service / LibreOffice worker.

  Never pretend it's readable.
  */

  return createResult({

    extracted:
      false,

    type:
      "doc",

    parser:
      "unsupported-legacy-doc",

    warnings: [
      "Legacy .doc files require document conversion before text extraction."
    ]
  });
}


/* =========================================================
   SPREADSHEETS
   ========================================================= */

async function extractSpreadsheet({
  buffer,
  extension
}) {

  try {

    const XLSXModule =
      await import(
        "xlsx"
      );


    const XLSX =
      XLSXModule.default ||
      XLSXModule;


    const workbook =
      XLSX.read(
        buffer,
        {
          type:
            "buffer",

          cellDates:
            true,

          cellText:
            true
        }
      );


    const sheetNames =
      workbook
        .SheetNames
        .slice(
          0,
          CONFIG.maxSpreadsheetSheets
        );


    const output =
      [];


    const sheetMetadata =
      [];


    let truncated =
      workbook
        .SheetNames
        .length >
      sheetNames.length;


    for (
      const sheetName
      of sheetNames
    ) {

      const sheet =
        workbook
          .Sheets[
            sheetName
          ];


      if (!sheet) {
        continue;
      }


      let rows =
        XLSX
          .utils
          .sheet_to_json(
            sheet,
            {
              header:
                1,

              raw:
                false,

              defval:
                ""
            }
          );


      const originalRows =
        rows.length;


      if (
        rows.length >
        CONFIG
          .maxSpreadsheetRowsPerSheet
      ) {

        rows =
          rows.slice(
            0,
            CONFIG
              .maxSpreadsheetRowsPerSheet
          );

        truncated =
          true;
      }


      rows =
        rows.map(
          row =>
            Array
              .isArray(row)
              ? row.slice(
                  0,
                  CONFIG
                    .maxSpreadsheetColumns
                )
              : row
        );


      const csv =
        rows
          .map(
            row =>
              row
                .map(
                  value => {

                    const text =
                      String(
                        value ?? ""
                      );


                    if (
                      /[",\n]/.test(
                        text
                      )
                    ) {

                      return `"${text.replace(
                        /"/g,
                        '""'
                      )}"`;
                    }


                    return text;
                  }
                )
                .join(",")
          )
          .join("\n");


      output.push(
        `=== Sheet: ${sheetName} ===\n${csv}`
      );


      sheetMetadata.push({

        name:
          sheetName,

        rows:
          originalRows,

        extractedRows:
          rows.length
      });
    }


    return createResult({

      extracted:
        output.length >
        0,

      text:
        output.join(
          "\n\n"
        ),

      type:
        "spreadsheet",

      parser:
        "xlsx",

      metadata: {

        extension,

        sheets:
          workbook
            .SheetNames
            .length,

        extractedSheets:
          sheetMetadata.length,

        sheetInfo:
          sheetMetadata
      },

      truncated
    });


  } catch (error) {

    return createResult({

      extracted:
        false,

      type:
        "spreadsheet",

      parser:
        "xlsx",

      warnings: [
        `Spreadsheet extraction failed: ${
          error?.message ||
          "unknown error"
        }`
      ]
    });
  }
}


/* =========================================================
   XML HELPERS
   ========================================================= */

function decodeXmlEntities(
  value
) {

  return String(
    value || ""
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
      /&amp;/g,
      "&"
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
      /&#(\d+);/g,
      (
        _,
        number
      ) => {

        const code =
          Number(
            number
          );


        return Number.isFinite(
          code
        )
          ? String.fromCodePoint(
              code
            )
          : _;
      }
    );
}


/* =========================================================
   PPTX
   ========================================================= */

async function extractPptx({
  buffer
}) {

  try {

    const JSZipModule =
      await import(
        "jszip"
      );


    const JSZip =
      JSZipModule.default ||
      JSZipModule;


    const zip =
      await JSZip.loadAsync(
        buffer
      );


    const slideNames =
      Object
        .keys(
          zip.files
        )
        .filter(
          name =>
            /^ppt\/slides\/slide\d+\.xml$/i.test(
              name
            )
        )
        .sort(
          (
            a,
            b
          ) => {

            const aNum =
              Number(
                a.match(
                  /slide(\d+)\.xml/i
                )?.[1]
              ) ||
              0;


            const bNum =
              Number(
                b.match(
                  /slide(\d+)\.xml/i
                )?.[1]
              ) ||
              0;


            return (
              aNum -
              bNum
            );
          }
        );


    const selected =
      slideNames.slice(
        0,
        CONFIG.maxPptSlides
      );


    const output =
      [];


    for (
      let index = 0;
      index <
      selected.length;
      index += 1
    ) {

      const xml =
        await zip
          .file(
            selected[index]
          )
          ?.async(
            "string"
          );


      if (!xml) {
        continue;
      }


      const runs =
        [
          ...xml.matchAll(
            /<a:t[^>]*>([\s\S]*?)<\/a:t>/gi
          )
        ];


      const text =
        runs
          .map(
            match =>
              decodeXmlEntities(
                match[1]
              )
          )
          .join(" ")
          .trim();


      output.push(
        `=== Slide ${
          index + 1
        } ===\n${text}`
      );
    }


    return createResult({

      extracted:
        output.length >
        0,

      text:
        output.join(
          "\n\n"
        ),

      type:
        "pptx",

      parser:
        "pptx-jszip",

      metadata: {

        slides:
          slideNames.length,

        extractedSlides:
          selected.length
      },

      truncated:
        slideNames.length >
        selected.length
    });


  } catch (error) {

    return createResult({

      extracted:
        false,

      type:
        "pptx",

      parser:
        "pptx-jszip",

      warnings: [
        `PowerPoint extraction failed: ${
          error?.message ||
          "unknown error"
        }`
      ]
    });
  }
}


/* =========================================================
   SVG
   ========================================================= */

async function extractSvg({
  buffer
}) {

  const xml =
    decodeUtf8(
      buffer
    );


  const matches =
    [
      ...xml.matchAll(
        /<text[^>]*>([\s\S]*?)<\/text>/gi
      )
    ];


  const text =
    matches
      .map(
        match =>
          decodeXmlEntities(
            match[1]
              .replace(
                /<[^>]+>/g,
                " "
              )
          )
      )
      .join("\n");


  return createResult({

    extracted:
      Boolean(
        text.trim()
      ),

    text,

    type:
      "svg",

    parser:
      "svg-text",

    metadata: {

      bytes:
        buffer.length
    },

    warnings:
      text.trim()
        ? []
        : [
            "SVG contained no directly extractable text."
          ]
  });
}


/* =========================================================
   ZIP

   Safe text-oriented ZIP inspection.
   Do NOT execute anything inside archive.
   ========================================================= */

async function extractZip({
  buffer
}) {

  try {

    const JSZipModule =
      await import(
        "jszip"
      );


    const JSZip =
      JSZipModule.default ||
      JSZipModule;


    const zip =
      await JSZip.loadAsync(
        buffer
      );


    const entries =
      Object.values(
        zip.files
      );


    if (
      entries.length >
      CONFIG.maxZipEntries
    ) {

      return createResult({

        extracted:
          false,

        type:
          "zip",

        parser:
          "jszip",

        metadata: {
          entries:
            entries.length
        },

        warnings: [
          "Archive contains too many files to inspect safely."
        ]
      });
    }


    const output =
      [];


    const manifest =
      [];


    let expandedBytes =
      0;

    let textFiles =
      0;

    let truncated =
      false;


    for (
      const entry
      of entries
    ) {

      if (
        entry.dir
      ) {
        continue;
      }


      const name =
        entry.name;


      const extension =
        normalizeExtension(
          "",
          name
        );


      manifest.push(
        name
      );


      /*
      Only extract obviously text-oriented entries.
      */

      if (
        !TEXT_EXTENSIONS.has(
          extension
        ) &&
        !DATA_TEXT_EXTENSIONS.has(
          extension
        )
      ) {
        continue;
      }


      if (
        textFiles >=
        CONFIG.maxZipTextFiles
      ) {

        truncated =
          true;

        break;
      }


      const bytes =
        await entry.async(
          "uint8array"
        );


      expandedBytes +=
        bytes.byteLength;


      if (
        expandedBytes >
        CONFIG.maxZipExpandedBytes
      ) {

        truncated =
          true;

        break;
      }


      if (
        bytes.byteLength >
        CONFIG.maxZipSingleEntryBytes
      ) {

        continue;
      }


      const text =
        Buffer
          .from(bytes)
          .toString(
            "utf8"
          );


      output.push(
        `=== ${name} ===\n${text}`
      );


      textFiles +=
        1;
    }


    return createResult({

      extracted:
        output.length >
        0,

      text:
        output.join(
          "\n\n"
        ),

      type:
        "zip",

      parser:
        "jszip",

      metadata: {

        entries:
          manifest.length,

        textFilesExtracted:
          textFiles,

        files:
          manifest.slice(
            0,
            500
          )
      },

      truncated,

      warnings:
        output.length
          ? [
              "Archive extraction is limited to safe text-oriented files."
            ]
          : [
              "Archive contains no supported text files."
            ]
    });


  } catch (error) {

    return createResult({

      extracted:
        false,

      type:
        "zip",

      parser:
        "jszip",

      warnings: [
        `ZIP extraction failed: ${
          error?.message ||
          "unknown error"
        }`
      ]
    });
  }
}


/* =========================================================
   IMAGE
   ========================================================= */

async function extractImage({
  buffer,
  name,
  extension,
  mime
}) {

  /*
  Do not perform OCR here.

  Image should later be supplied directly to a multimodal
  Gemini request. Keeping image bytes out of extracted text
  is both faster and more accurate.
  */

  return createResult({

    extracted:
      false,

    type:
      "image",

    parser:
      "multimodal-required",

    metadata: {

      name,

      extension,

      mime,

      bytes:
        buffer.length,

      requiresVision:
        true
    },

    warnings: [
      "Image accepted. Visual understanding requires the multimodal attachment pipeline."
    ]
  });
}


/* =========================================================
   AUDIO
   ========================================================= */

async function extractAudio({
  buffer,
  name,
  extension,
  mime
}) {

  return createResult({

    extracted:
      false,

    type:
      "audio",

    parser:
      "transcription-required",

    metadata: {

      name,

      extension,

      mime,

      bytes:
        buffer.length,

      requiresTranscription:
        true
    },

    warnings: [
      "Audio accepted. Speech/content extraction requires the media transcription pipeline."
    ]
  });
}


/* =========================================================
   VIDEO
   ========================================================= */

async function extractVideo({
  buffer,
  name,
  extension,
  mime
}) {

  return createResult({

    extracted:
      false,

    type:
      "video",

    parser:
      "multimodal-required",

    metadata: {

      name,

      extension,

      mime,

      bytes:
        buffer.length,

      requiresVideoUnderstanding:
        true
    },

    warnings: [
      "Video accepted. Understanding requires the multimodal media pipeline."
    ]
  });
}


/* =========================================================
   UNKNOWN
   ========================================================= */

async function extractUnknown({
  buffer,
  name,
  extension,
  mime
}) {

  /*
  Heuristic:
  if the file contains almost no NUL bytes and is mostly
  printable characters, attempt a text fallback.
  */

  const sample =
    buffer.subarray(
      0,
      Math.min(
        buffer.length,
        64 * 1024
      )
    );


  let nulCount =
    0;

  let printable =
    0;


  for (
    const value
    of sample
  ) {

    if (
      value ===
      0
    ) {

      nulCount +=
        1;
    }


    if (
      value === 9 ||
      value === 10 ||
      value === 13 ||
      (
        value >= 32 &&
        value <= 126
      ) ||
      value >= 128
    ) {

      printable +=
        1;
    }
  }


  const ratio =
    sample.length
      ? printable /
        sample.length
      : 0;


  if (
    nulCount ===
      0 &&
    ratio >
      0.85
  ) {

    const text =
      decodeUtf8(
        buffer
      );


    return createResult({

      extracted:
        true,

      text,

      type:
        "unknown-text",

      parser:
        "text-heuristic",

      metadata: {

        name,

        extension,

        mime,

        printableRatio:
          Number(
            ratio.toFixed(
              3
            )
          )
      },

      warnings: [
        "Unknown file type was interpreted as plain text."
      ]
    });
  }


  return createResult({

    extracted:
      false,

    type:
      "binary",

    parser:
      "unsupported-binary",

    metadata: {

      name,

      extension,

      mime,

      bytes:
        buffer.length
    },

    warnings: [
      "File was stored successfully, but this binary format cannot currently be converted into text."
    ]
  });
}


/* =========================================================
   MAIN ROUTER
   ========================================================= */

export async function extractAttachment({
  buffer,
  name,
  mime,
  extension,
  category,
  size
}) {

  if (
    !Buffer.isBuffer(
      buffer
    )
  ) {

    throw new TypeError(
      "extractAttachment() requires a Node Buffer."
    );
  }


  const fileName =
    safeName(
      name
    );


  const ext =
    normalizeExtension(
      extension,
      fileName
    );


  const normalizedMime =
    normalizeMime(
      mime
    );


  const normalizedCategory =
    String(
      category ||
      "unknown"
    )
      .trim()
      .toLowerCase();


  const baseMetadata = {

    name:
      fileName,

    extension:
      ext,

    mime:
      normalizedMime,

    category:
      normalizedCategory,

    size:
      Number(size) ||
      buffer.length
  };


  try {

    let result;


    /* -----------------------------------------------------
       PDF
       ----------------------------------------------------- */

    if (
      ext ===
        "pdf" ||
      normalizedMime ===
        "application/pdf"
    ) {

      result =
        await extractPdf({
          buffer
        });
    }


    /* -----------------------------------------------------
       WORD
       ----------------------------------------------------- */

    else if (
      ext ===
        "docx"
    ) {

      result =
        await extractDocx({
          buffer
        });
    }


    else if (
      ext ===
        "doc"
    ) {

      result =
        await extractLegacyDoc();
    }


    /* -----------------------------------------------------
       POWERPOINT
       ----------------------------------------------------- */

    else if (
      ext ===
        "pptx"
    ) {

      result =
        await extractPptx({
          buffer
        });
    }


    else if (
      ext ===
        "ppt"
    ) {

      result =
        createResult({

          extracted:
            false,

          type:
            "ppt",

          parser:
            "unsupported-legacy-ppt",

          warnings: [
            "Legacy .ppt files require conversion before extraction."
          ]
        });
    }


    /* -----------------------------------------------------
       SPREADSHEET
       ----------------------------------------------------- */

    else if (
      SPREADSHEET_EXTENSIONS.has(
        ext
      )
    ) {

      result =
        await extractSpreadsheet({
          buffer,
          extension:
            ext
        });
    }


    /* -----------------------------------------------------
       JSON
       ----------------------------------------------------- */

    else if (
      [
        "json",
        "jsonl",
        "ndjson"
      ].includes(
        ext
      )
    ) {

      result =
        await extractJson({
          buffer,
          extension:
            ext
        });
    }


    /* -----------------------------------------------------
       CSV / TSV
       ----------------------------------------------------- */

    else if (
      ext ===
        "csv" ||
      ext ===
        "tsv"
    ) {

      result =
        await extractDelimited({
          buffer,
          extension:
            ext
        });
    }


    /* -----------------------------------------------------
       SVG
       ----------------------------------------------------- */

    else if (
      ext ===
        "svg" ||
      normalizedMime ===
        "image/svg+xml"
    ) {

      result =
        await extractSvg({
          buffer
        });
    }


    /* -----------------------------------------------------
       ZIP
       ----------------------------------------------------- */

    else if (
      ext ===
        "zip" ||
      normalizedMime ===
        "application/zip"
    ) {

      result =
        await extractZip({
          buffer
        });
    }


    /* -----------------------------------------------------
       IMAGE
       ----------------------------------------------------- */

    else if (
      IMAGE_EXTENSIONS.has(
        ext
      ) ||
      normalizedMime.startsWith(
        "image/"
      )
    ) {

      result =
        await extractImage({

          buffer,

          name:
            fileName,

          extension:
            ext,

          mime:
            normalizedMime
        });
    }


    /* -----------------------------------------------------
       AUDIO
       ----------------------------------------------------- */

    else if (
      AUDIO_EXTENSIONS.has(
        ext
      ) ||
      normalizedMime.startsWith(
        "audio/"
      )
    ) {

      result =
        await extractAudio({

          buffer,

          name:
            fileName,

          extension:
            ext,

          mime:
            normalizedMime
        });
    }


    /* -----------------------------------------------------
       VIDEO
       ----------------------------------------------------- */

    else if (
      VIDEO_EXTENSIONS.has(
        ext
      ) ||
      normalizedMime.startsWith(
        "video/"
      )
    ) {

      result =
        await extractVideo({

          buffer,

          name:
            fileName,

          extension:
            ext,

          mime:
            normalizedMime
        });
    }


    /* -----------------------------------------------------
       TEXT / CODE / CONFIG
       ----------------------------------------------------- */

    else if (
      TEXT_EXTENSIONS.has(
        ext
      ) ||
      DATA_TEXT_EXTENSIONS.has(
        ext
      ) ||
      normalizedMime.startsWith(
        "text/"
      )
    ) {

      result =
        await extractPlainText({

          buffer,

          extension:
            ext,

          name:
            fileName,

          mime:
            normalizedMime
        });
    }


    /* -----------------------------------------------------
       UNKNOWN
       ----------------------------------------------------- */

    else {

      result =
        await extractUnknown({

          buffer,

          name:
            fileName,

          extension:
            ext,

          mime:
            normalizedMime
        });
    }


    return {

      ...result,

      metadata: {

        ...baseMetadata,

        ...(
          result?.metadata ||
          {}
        )
      }
    };


  } catch (error) {

    console.error(
      "[NEYO Extractor] Unexpected failure",
      {

        name:
          fileName,

        extension:
          ext,

        mime:
          normalizedMime,

        message:
          error?.message
      }
    );


    return createResult({

      extracted:
        false,

      type:
        normalizedCategory ||
        "unknown",

      parser:
        "failed",

      metadata:
        baseMetadata,

      warnings: [
        `Attachment extraction failed: ${
          error?.message ||
          "unknown error"
        }`
      ]
    });
  }
}


/* =========================================================
   CAPABILITY QUERY
   ========================================================= */

export function getAttachmentCapability({
  name,
  extension,
  mime
} = {}) {

  const ext =
    normalizeExtension(
      extension,
      name
    );


  const normalizedMime =
    normalizeMime(
      mime
    );


  if (
    ext === "pdf"
  ) {

    return {
      supported:
        true,
      mode:
        "text-extraction"
    };
  }


  if (
    ext === "docx"
  ) {

    return {
      supported:
        true,
      mode:
        "text-extraction"
    };
  }


  if (
    ext === "pptx"
  ) {

    return {
      supported:
        true,
      mode:
        "text-extraction"
    };
  }


  if (
    SPREADSHEET_EXTENSIONS.has(
      ext
    )
  ) {

    return {
      supported:
        true,
      mode:
        "structured-extraction"
    };
  }


  if (
    TEXT_EXTENSIONS.has(
      ext
    ) ||
    DATA_TEXT_EXTENSIONS.has(
      ext
    )
  ) {

    return {
      supported:
        true,
      mode:
        "text-extraction"
    };
  }


  if (
    IMAGE_EXTENSIONS.has(
      ext
    ) ||
    normalizedMime.startsWith(
      "image/"
    )
  ) {

    return {
      supported:
        true,
      mode:
        "vision"
    };
  }


  if (
    AUDIO_EXTENSIONS.has(
      ext
    ) ||
    normalizedMime.startsWith(
      "audio/"
    )
  ) {

    return {
      supported:
        true,
      mode:
        "transcription"
    };
  }


  if (
    VIDEO_EXTENSIONS.has(
      ext
    ) ||
    normalizedMime.startsWith(
      "video/"
    )
  ) {

    return {
      supported:
        true,
      mode:
        "video-understanding"
    };
  }


  return {
    supported:
      true,

    mode:
      "fallback"
  };
}
