/*
=========================================================
NEYO — UNIVERSAL ATTACHMENT EXTRACTORS
FINAL v1

FILE:
lib/attachments/extractors.js

PURPOSE:
- Safely extract readable content from supported files
- NEVER execute uploaded code/scripts/binaries
- Return one stable extraction contract
- Keep unsupported/proprietary formats graceful
- Protect against huge extracted text / ZIP abuse

SUPPORTED DIRECTLY:
- TXT / Markdown / source code / config files
- JSON / JSONL / NDJSON / XML / YAML / SQL etc.
- PDF
- DOCX
- RTF
- ODT
- XLS / XLSX / XLSM / XLSB
- CSV / TSV
- PPTX
- ODP
- ZIP
- GZ

GRACEFUL FALLBACK:
- DOC legacy
- PPT legacy
- Pages
- Numbers
- Keynote
- RAR / 7Z / TAR / BZ2 / XZ
- SQLite / DB
- Parquet / Feather / Arrow
- Unknown binary

IMPORTANT:
Images/audio/video are handled by process.js as
multimodal Storage references and normally do not
reach this extractor.

OUTPUT CONTRACT:

{
  text: string,
  parser: string,
  kind: string,
  metadata: object,
  warnings: string[]
}

=========================================================
*/

import zlib from "node:zlib";


/* =====================================================
   LIMITS
   ===================================================== */

const MAX_TEXT_CHARACTERS =
  1_500_000;

const MAX_ARCHIVE_ENTRIES =
  2_000;

const MAX_ARCHIVE_TEXT_ENTRIES =
  100;

const MAX_ARCHIVE_ENTRY_BYTES =
  4 * 1024 * 1024;

const MAX_ARCHIVE_TOTAL_TEXT_BYTES =
  12 * 1024 * 1024;

const MAX_SPREADSHEET_ROWS_PER_SHEET =
  20_000;

const MAX_SPREADSHEET_SHEETS =
  50;

const MAX_PRESENTATION_SLIDES =
  500;


/* =====================================================
   TEXT-LIKE EXTENSIONS
   ===================================================== */

const TEXT_EXTENSIONS =
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

    "dockerfile",
    "makefile",
    "env",
    "gitignore",

    "ini",
    "toml",

    "yaml",
    "yml",

    "sql",

    "xml"
  ]);


/* =====================================================
   ARCHIVE TEXT EXTENSIONS
   ===================================================== */

const ARCHIVE_TEXT_EXTENSIONS =
  new Set([
    ...TEXT_EXTENSIONS,

    "json",
    "jsonl",
    "ndjson",

    "csv",
    "tsv"
  ]);


/* =====================================================
   HELPERS
   ===================================================== */

function cleanString(
  value,
  maxLength = 500
) {

  return String(
    value ?? ""
  )
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      ""
    )
    .trim()
    .slice(
      0,
      maxLength
    );
}


function normalizeExtension(
  value
) {

  return String(
    value ?? ""
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
    )
    .slice(
      0,
      32
    );
}


function getExtensionFromName(
  name
) {

  const value =
    String(
      name ?? ""
    );


  const index =
    value.lastIndexOf(
      "."
    );


  if (
    index === -1 ||
    index === value.length - 1
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


  throw new Error(
    "Attachment data is invalid."
  );
}


function truncateText(
  text,
  warnings
) {

  const value =
    String(
      text ?? ""
    );


  if (
    value.length <=
    MAX_TEXT_CHARACTERS
  ) {

    return value;
  }


  warnings.push(
    `Extracted text was truncated to ${MAX_TEXT_CHARACTERS.toLocaleString()} characters.`
  );


  return value.slice(
    0,
    MAX_TEXT_CHARACTERS
  );
}


function normalizeNewlines(
  value
) {

  return String(
    value ?? ""
  )
    .replace(
      /\r\n?/g,
      "\n"
    )
    .replace(
      /\u0000/g,
      ""
    );
}


function decodeTextBuffer(
  buffer
) {

  const data =
    ensureBuffer(
      buffer
    );


  /*
  UTF-8 first.

  TextDecoder replacement behavior safely handles
  invalid byte sequences instead of executing anything.
  */

  let text =
    data.toString(
      "utf8"
    );


  /*
  Strip UTF-8 BOM.
  */

  if (
    text.charCodeAt(0) ===
    0xFEFF
  ) {

    text =
      text.slice(
        1
      );
  }


  return normalizeNewlines(
    text
  );
}


function decodeXmlEntities(
  value
) {

  return String(
    value ?? ""
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
      "\""
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
        number
      ) => {

        const code =
          Number(
            number
          );


        if (
          !Number.isFinite(
            code
          )
        ) {

          return "";
        }


        try {

          return String.fromCodePoint(
            code
          );

        } catch {

          return "";
        }
      }
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (
        _match,
        hex
      ) => {

        const code =
          parseInt(
            hex,
            16
          );


        if (
          !Number.isFinite(
            code
          )
        ) {

          return "";
        }


        try {

          return String.fromCodePoint(
            code
          );

        } catch {

          return "";
        }
      }
    );
}


function xmlToPlainText(
  xml
) {

  let value =
    String(
      xml ?? ""
    );


  /*
  Add useful boundaries before stripping tags.
  */

  value =
    value
      .replace(
        /<(?:w:p|a:p|text:p|text:h|table:table-row|office:annotation)\b[^>]*>/gi,
        "\n"
      )
      .replace(
        /<(?:w:br|a:br|text:line-break)\b[^>]*\/?>/gi,
        "\n"
      )
      .replace(
        /<(?:w:tab|text:tab)\b[^>]*\/?>/gi,
        "\t"
      );


  value =
    value.replace(
      /<[^>]+>/g,
      ""
    );


  value =
    decodeXmlEntities(
      value
    );


  return normalizeNewlines(
    value
  )
    .replace(
      /[ \t]+\n/g,
      "\n"
    )
    .replace(
      /\n[ \t]+/g,
      "\n"
    )
    .replace(
      /\n{3,}/g,
      "\n\n"
    )
    .trim();
}


function uniqueWarnings(
  warnings
) {

  return Array.from(
    new Set(
      warnings
        .map(
          warning =>
            cleanString(
              warning,
              500
            )
        )
        .filter(
          Boolean
        )
    )
  );
}


function createResult({
  text = "",
  parser,
  kind,
  metadata = {},
  warnings = []
}) {

  const safeWarnings =
    uniqueWarnings(
      warnings
    );


  return {
    text:
      truncateText(
        normalizeNewlines(
          text
        ).trim(),
        safeWarnings
      ),

    parser:
      cleanString(
        parser ||
        "unknown",
        100
      ),

    kind:
      cleanString(
        kind ||
        "unknown",
        64
      ),

    metadata:
      metadata &&
      typeof metadata ===
        "object" &&
      !Array.isArray(
        metadata
      )
        ? metadata
        : {},

    warnings:
      uniqueWarnings(
        safeWarnings
      )
  };
}


/* =====================================================
   PLAIN TEXT
   ===================================================== */

function extractPlainText({
  buffer,
  extension,
  category
}) {

  return createResult({
    text:
      decodeTextBuffer(
        buffer
      ),

    parser:
      "plain-text",

    kind:
      category ||
      (
        extension ===
        "txt"
          ? "text"
          : "code"
      ),

    metadata: {
      encoding:
        "utf-8"
    }
  });
}


/* =====================================================
   JSON
   ===================================================== */

function extractJson({
  buffer,
  extension
}) {

  const warnings =
    [];


  const raw =
    decodeTextBuffer(
      buffer
    );


  /*
  JSONL / NDJSON are intentionally not parsed as one JSON
  document because each line is independent.
  */

  if (
    extension ===
      "jsonl" ||
    extension ===
      "ndjson"
  ) {

    const lines =
      raw
        .split(
          "\n"
        )
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
      of lines.slice(
        0,
        10_000
      )
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


    if (
      invalid >
      0
    ) {

      warnings.push(
        `${invalid} JSONL line(s) could not be parsed during validation.`
      );
    }


    return createResult({
      text:
        raw,

      parser:
        "json-lines",

      kind:
        "data",

      metadata: {
        lines:
          lines.length,

        validatedLines:
          valid + invalid,

        validLines:
          valid,

        invalidLines:
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


    let formatted;


    try {

      formatted =
        JSON.stringify(
          parsed,
          null,
          2
        );

    } catch {

      formatted =
        raw;
    }


    return createResult({
      text:
        formatted,

      parser:
        "json",

      kind:
        "data",

      metadata: {
        rootType:
          Array.isArray(
            parsed
          )
            ? "array"
            : typeof parsed
      }
    });

  } catch {

    warnings.push(
      "JSON parsing failed; raw text was used instead."
    );


    return createResult({
      text:
        raw,

      parser:
        "json-fallback-text",

      kind:
        "data",

      warnings
    });
  }
}


/* =====================================================
   CSV / TSV
   ===================================================== */

async function extractDelimited({
  buffer,
  extension
}) {

  const XLSXModule =
    await import(
      "xlsx"
    );


  const XLSX =
    XLSXModule.default ||
    XLSXModule;


  const text =
    decodeTextBuffer(
      buffer
    );


  const delimiter =
    extension ===
    "tsv"
      ? "\t"
      : ",";


  let workbook;


  try {

    workbook =
      XLSX.read(
        text,
        {
          type:
            "string",

          FS:
            delimiter,

          raw:
            false
        }
      );

  } catch (
    error
  ) {

    throw new Error(
      `Could not read ${extension.toUpperCase()} file: ${error?.message || "invalid file"}`
    );
  }


  return workbookToText(
    workbook,
    XLSX,
    {
      parser:
        extension ===
        "tsv"
          ? "xlsx-tsv"
          : "xlsx-csv",

      kind:
        "spreadsheet"
    }
  );
}


/* =====================================================
   SPREADSHEET
   ===================================================== */

async function extractSpreadsheet({
  buffer,
  extension
}) {

  const XLSXModule =
    await import(
      "xlsx"
    );


  const XLSX =
    XLSXModule.default ||
    XLSXModule;


  let workbook;


  try {

    workbook =
      XLSX.read(
        ensureBuffer(
          buffer
        ),
        {
          type:
            "buffer",

          cellDates:
            true,

          cellFormula:
            false,

          cellHTML:
            false,

          dense:
            false
        }
      );

  } catch (
    error
  ) {

    throw new Error(
      `Could not read spreadsheet: ${error?.message || "invalid spreadsheet"}`
    );
  }


  return workbookToText(
    workbook,
    XLSX,
    {
      parser:
        `xlsx-${extension || "spreadsheet"}`,

      kind:
        "spreadsheet"
    }
  );
}


function workbookToText(
  workbook,
  XLSX,
  {
    parser,
    kind
  }
) {

  const warnings =
    [];


  const sheetNames =
    Array.isArray(
      workbook?.SheetNames
    )
      ? workbook.SheetNames
      : [];


  const selectedSheets =
    sheetNames.slice(
      0,
      MAX_SPREADSHEET_SHEETS
    );


  if (
    sheetNames.length >
    MAX_SPREADSHEET_SHEETS
  ) {

    warnings.push(
      `Only the first ${MAX_SPREADSHEET_SHEETS} worksheet(s) were processed.`
    );
  }


  const sections =
    [];


  let totalRows =
    0;


  for (
    const sheetName
    of selectedSheets
  ) {

    const sheet =
      workbook.Sheets?.[
        sheetName
      ];


    if (!sheet) {
      continue;
    }


    let rows;


    try {

      rows =
        XLSX.utils.sheet_to_json(
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

    } catch {

      rows =
        [];
    }


    const originalRowCount =
      rows.length;


    if (
      rows.length >
      MAX_SPREADSHEET_ROWS_PER_SHEET
    ) {

      rows =
        rows.slice(
          0,
          MAX_SPREADSHEET_ROWS_PER_SHEET
        );


      warnings.push(
        `Worksheet "${sheetName}" was truncated to ${MAX_SPREADSHEET_ROWS_PER_SHEET.toLocaleString()} rows.`
      );
    }


    totalRows +=
      rows.length;


    const body =
      rows
        .map(
          row =>
            Array
              .from(
                row || []
              )
              .map(
                cell =>
                  String(
                    cell ?? ""
                  )
                    .replace(
                      /\r?\n/g,
                      " "
                    )
                    .trim()
              )
              .join(
                "\t"
              )
        )
        .join(
          "\n"
        );


    sections.push(
      [
        `# Worksheet: ${sheetName}`,
        body
      ]
        .filter(
          Boolean
        )
        .join(
          "\n"
        )
    );


    if (
      originalRowCount >
      rows.length
    ) {

      warnings.push(
        `Worksheet "${sheetName}" contains additional rows that were not included.`
      );
    }
  }


  return createResult({
    text:
      sections.join(
        "\n\n"
      ),

    parser,

    kind,

    metadata: {
      sheets:
        sheetNames.length,

      processedSheets:
        selectedSheets.length,

      rows:
        totalRows,

      sheetNames:
        selectedSheets
    },

    warnings
  });
}


/* =====================================================
   PDF
   ===================================================== */

async function extractPdf({
  buffer
}) {

  const module =
    await import(
      "pdf-parse"
    );


  const pdfParse =
    module.default ||
    module;


  let result;


  try {

    result =
      await pdfParse(
        ensureBuffer(
          buffer
        )
      );

  } catch (
    error
  ) {

    throw new Error(
      `Could not read PDF: ${error?.message || "invalid PDF"}`
    );
  }


  const warnings =
    [];


  if (
    !String(
      result?.text || ""
    ).trim()
  ) {

    warnings.push(
      "No readable text was found in this PDF. It may be scanned or image-based."
    );
  }


  return createResult({
    text:
      result?.text ||
      "",

    parser:
      "pdf-parse",

    kind:
      "document",

    metadata: {
      pages:
        Number(
          result?.numpages
        ) || 0,

      renderedPages:
        Number(
          result?.numrender
        ) || 0,

      info:
        result?.info &&
        typeof result.info ===
          "object"
          ? result.info
          : {}
    },

    warnings
  });
}


/* =====================================================
   DOCX
   ===================================================== */

async function extractDocx({
  buffer
}) {

  const module =
    await import(
      "mammoth"
    );


  const mammoth =
    module.default ||
    module;


  let result;


  try {

    result =
      await mammoth.extractRawText({
        buffer:
          ensureBuffer(
            buffer
          )
      });

  } catch (
    error
  ) {

    throw new Error(
      `Could not read DOCX document: ${error?.message || "invalid DOCX"}`
    );
  }


  const warnings =
    [];


  if (
    Array.isArray(
      result?.messages
    )
  ) {

    for (
      const message
      of result.messages
    ) {

      const text =
        cleanString(
          message?.message,
          500
        );


      if (text) {

        warnings.push(
          text
        );
      }
    }
  }


  return createResult({
    text:
      result?.value ||
      "",

    parser:
      "mammoth-docx",

    kind:
      "document",

    metadata: {},

    warnings
  });
}


/* =====================================================
   RTF
   ===================================================== */

function extractRtf({
  buffer
}) {

  const raw =
    decodeTextBuffer(
      buffer
    );


  let text =
    raw;


  /*
  Decode basic hex escaped characters:
  \'hh
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
  Unicode:
  \u1234?
  */

  text =
    text.replace(
      /\\u(-?\d+)\??/g,
      (
        _match,
        number
      ) => {

        let code =
          Number(
            number
          );


        if (
          !Number.isFinite(
            code
          )
        ) {

          return "";
        }


        if (
          code <
          0
        ) {

          code +=
            65536;
        }


        try {

          return String.fromCharCode(
            code
          );

        } catch {

          return "";
        }
      }
    );


  /*
  Useful paragraph boundaries.
  */

  text =
    text
      .replace(
        /\\par[d]?/g,
        "\n"
      )
      .replace(
        /\\line/g,
        "\n"
      )
      .replace(
        /\\tab/g,
        "\t"
      );


  /*
  Remove destinations such as font/color tables.
  */

  text =
    text.replace(
      /\{\\(?:fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}/gi,
      ""
    );


  /*
  Remove control words.
  */

  text =
    text.replace(
      /\\[a-zA-Z]+-?\d* ?/g,
      ""
    );


  /*
  Remove remaining braces/control escapes.
  */

  text =
    text
      .replace(
        /[{}]/g,
        ""
      )
      .replace(
        /\\([\\{}])/g,
        "$1"
      );


  return createResult({
    text,

    parser:
      "rtf-safe-text",

    kind:
      "document",

    metadata: {},

    warnings: [
      "RTF extraction uses a safe text parser; complex formatting is not preserved."
    ]
  });
}


/* =====================================================
   ZIP MODULE
   ===================================================== */

async function loadJsZip() {

  const module =
    await import(
      "jszip"
    );


  return (
    module.default ||
    module
  );
}


/* =====================================================
   ODT
   ===================================================== */

async function extractOdt({
  buffer
}) {

  const JSZip =
    await loadJsZip();


  let zip;


  try {

    zip =
      await JSZip.loadAsync(
        ensureBuffer(
          buffer
        )
      );

  } catch (
    error
  ) {

    throw new Error(
      `Could not read ODT document: ${error?.message || "invalid ODT"}`
    );
  }


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
      xmlToPlainText(
        xml
      ),

    parser:
      "odt-content-xml",

    kind:
      "document",

    metadata: {}
  });
}


/* =====================================================
   PPTX
   ===================================================== */

async function extractPptx({
  buffer
}) {

  const JSZip =
    await loadJsZip();


  let zip;


  try {

    zip =
      await JSZip.loadAsync(
        ensureBuffer(
          buffer
        )
      );

  } catch (
    error
  ) {

    throw new Error(
      `Could not read PPTX presentation: ${error?.message || "invalid PPTX"}`
    );
  }


  const slidePaths =
    Object
      .keys(
        zip.files
      )
      .filter(
        path =>
          /^ppt\/slides\/slide\d+\.xml$/i.test(
            path
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
            ) || 0;


          const bNum =
            Number(
              b.match(
                /slide(\d+)\.xml/i
              )?.[1]
            ) || 0;


          return (
            aNum -
            bNum
          );
        }
      );


  const warnings =
    [];


  const selected =
    slidePaths.slice(
      0,
      MAX_PRESENTATION_SLIDES
    );


  if (
    slidePaths.length >
    MAX_PRESENTATION_SLIDES
  ) {

    warnings.push(
      `Only the first ${MAX_PRESENTATION_SLIDES} slides were processed.`
    );
  }


  const sections =
    [];


  for (
    let index =
      0;
    index <
      selected.length;
    index +=
      1
  ) {

    const entry =
      zip.file(
        selected[
          index
        ]
      );


    if (!entry) {
      continue;
    }


    const xml =
      await entry.async(
        "string"
      );


    const text =
      xmlToPlainText(
        xml
      );


    sections.push(
      [
        `# Slide ${index + 1}`,
        text
      ]
        .filter(
          Boolean
        )
        .join(
          "\n"
        )
    );
  }


  return createResult({
    text:
      sections.join(
        "\n\n"
      ),

    parser:
      "pptx-slide-xml",

    kind:
      "presentation",

    metadata: {
      slides:
        slidePaths.length,

      processedSlides:
        selected.length
    },

    warnings
  });
}


/* =====================================================
   ODP
   ===================================================== */

async function extractOdp({
  buffer
}) {

  const JSZip =
    await loadJsZip();


  let zip;


  try {

    zip =
      await JSZip.loadAsync(
        ensureBuffer(
          buffer
        )
      );

  } catch (
    error
  ) {

    throw new Error(
      `Could not read ODP presentation: ${error?.message || "invalid ODP"}`
    );
  }


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


  /*
  Count presentation pages before stripping.
  */

  const slideCount =
    (
      xml.match(
        /<draw:page\b/gi
      ) ||
      []
    ).length;


  return createResult({
    text:
      xmlToPlainText(
        xml
      ),

    parser:
      "odp-content-xml",

    kind:
      "presentation",

    metadata: {
      slides:
        slideCount
    }
  });
}


/* =====================================================
   ZIP SAFETY
   ===================================================== */

function getZipEntryUncompressedSize(
  entry
) {

  const value =
    Number(
      entry?._data
        ?.uncompressedSize
    );


  return Number.isFinite(
    value
  )
    ? value
    : null;
}


function safeArchiveEntryName(
  value
) {

  const name =
    String(
      value ?? ""
    )
      .replace(
        /\\/g,
        "/"
      )
      .replace(
        /^\/+/,
        ""
      );


  if (
    name.includes(
      "../"
    ) ||
    name.startsWith(
      ".."
    )
  ) {

    return "";
  }


  return name.slice(
    0,
    500
  );
}


/* =====================================================
   GENERIC ZIP
   ===================================================== */

async function extractZip({
  buffer
}) {

  const JSZip =
    await loadJsZip();


  let zip;


  try {

    zip =
      await JSZip.loadAsync(
        ensureBuffer(
          buffer
        )
      );

  } catch (
    error
  ) {

    throw new Error(
      `Could not read ZIP archive: ${error?.message || "invalid ZIP"}`
    );
  }


  const entries =
    Object.values(
      zip.files
    );


  if (
    entries.length >
    MAX_ARCHIVE_ENTRIES
  ) {

    throw new Error(
      `ZIP archive contains too many entries. Maximum is ${MAX_ARCHIVE_ENTRIES}.`
    );
  }


  const warnings =
    [];


  const listing =
    [];


  const extractedSections =
    [];


  let textEntries =
    0;


  let totalTextBytes =
    0;


  for (
    const entry
    of entries
  ) {

    const safeName =
      safeArchiveEntryName(
        entry.name
      );


    if (!safeName) {

      warnings.push(
        "An unsafe archive path was ignored."
      );

      continue;
    }


    if (
      entry.dir
    ) {

      listing.push(
        `${safeName}/`
      );

      continue;
    }


    const size =
      getZipEntryUncompressedSize(
        entry
      );


    listing.push(
      size ===
      null
        ? safeName
        : `${safeName} (${size} bytes)`
    );


    if (
      textEntries >=
      MAX_ARCHIVE_TEXT_ENTRIES
    ) {

      continue;
    }


    const extension =
      getExtensionFromName(
        safeName
      );


    if (
      !ARCHIVE_TEXT_EXTENSIONS.has(
        extension
      )
    ) {

      continue;
    }


    /*
    If JSZip knows decompressed size,
    reject oversized text entry before decompression.
    */

    if (
      size !==
        null &&
      size >
        MAX_ARCHIVE_ENTRY_BYTES
    ) {

      warnings.push(
        `Skipped large text entry "${safeName}".`
      );

      continue;
    }


    if (
      totalTextBytes >=
      MAX_ARCHIVE_TOTAL_TEXT_BYTES
    ) {

      warnings.push(
        "Archive text extraction limit was reached."
      );

      break;
    }


    let content;


    try {

      content =
        await entry.async(
          "nodebuffer"
        );

    } catch {

      warnings.push(
        `Could not read archive entry "${safeName}".`
      );

      continue;
    }


    if (
      content.length >
      MAX_ARCHIVE_ENTRY_BYTES
    ) {

      warnings.push(
        `Skipped large text entry "${safeName}".`
      );

      continue;
    }


    if (
      totalTextBytes +
        content.length >
      MAX_ARCHIVE_TOTAL_TEXT_BYTES
    ) {

      warnings.push(
        "Archive text extraction limit was reached."
      );

      break;
    }


    totalTextBytes +=
      content.length;


    textEntries +=
      1;


    const text =
      decodeTextBuffer(
        content
      );


    extractedSections.push(
      [
        `# File: ${safeName}`,
        text
      ].join(
        "\n"
      )
    );
  }


  const text =
    [
      "# ZIP archive contents",
      listing.join(
        "\n"
      ),

      extractedSections.length
        ? "\n# Readable files\n"
        : "",

      extractedSections.join(
        "\n\n"
      )
    ]
      .filter(
        Boolean
      )
      .join(
        "\n"
      );


  if (
    textEntries >=
    MAX_ARCHIVE_TEXT_ENTRIES
  ) {

    warnings.push(
      `Only the first ${MAX_ARCHIVE_TEXT_ENTRIES} readable archive entries were extracted.`
    );
  }


  return createResult({
    text,

    parser:
      "jszip-safe-archive",

    kind:
      "archive",

    metadata: {
      entries:
        entries.length,

      readableEntries:
        textEntries,

      extractedTextBytes:
        totalTextBytes
    },

    warnings
  });
}


/* =====================================================
   GZIP
   ===================================================== */

function extractGzip({
  buffer,
  name
}) {

  let decompressed;


  try {

    decompressed =
      zlib.gunzipSync(
        ensureBuffer(
          buffer
        ),
        {
          maxOutputLength:
            MAX_ARCHIVE_TOTAL_TEXT_BYTES
        }
      );

  } catch (
    error
  ) {

    throw new Error(
      `Could not decompress GZIP file: ${error?.message || "invalid GZIP"}`
    );
  }


  const originalName =
    String(
      name ?? ""
    ).replace(
      /\.gz$/i,
      ""
    );


  const innerExtension =
    getExtensionFromName(
      originalName
    );


  const warnings =
    [];


  if (
    innerExtension &&
    !ARCHIVE_TEXT_EXTENSIONS.has(
      innerExtension
    )
  ) {

    warnings.push(
      "The compressed file was decompressed, but its inner format is not known to be text."
    );
  }


  return createResult({
    text:
      decodeTextBuffer(
        decompressed
      ),

    parser:
      "node-gzip",

    kind:
      "archive",

    metadata: {
      compressedBytes:
        ensureBuffer(
          buffer
        ).length,

      decompressedBytes:
        decompressed.length,

      innerFileName:
        originalName,

      innerExtension
    },

    warnings
  });
}


/* =====================================================
   UNSUPPORTED FORMAT
   ===================================================== */

function unsupportedResult({
  extension,
  category,
  message
}) {

  return createResult({
    text:
      "",

    parser:
      "unsupported-safe-fallback",

    kind:
      category ||
      "unknown",

    metadata: {
      extension
    },

    warnings: [
      message ||
      `The .${extension || "unknown"} format was stored safely but automatic text extraction is not available.`
    ]
  });
}


/* =====================================================
   MAIN ROUTER
   ===================================================== */

export async function extractAttachment({
  buffer,
  name,
  mime,
  extension,
  category
}) {

  const data =
    ensureBuffer(
      buffer
    );


  const safeName =
    cleanString(
      name ||
      "attachment",
      220
    );


  const ext =
    normalizeExtension(
      extension ||
      getExtensionFromName(
        safeName
      )
    );


  const safeMime =
    cleanString(
      mime ||
      "application/octet-stream",
      180
    )
      .toLowerCase();


  const safeCategory =
    cleanString(
      category ||
      "unknown",
      64
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

    return extractPdf({
      buffer:
        data
    });
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

    return extractDocx({
      buffer:
        data
    });
  }


  /* ===================================================
     LEGACY DOC
     =================================================== */

  if (
    ext ===
    "doc"
  ) {

    return unsupportedResult({
      extension:
        ext,

      category:
        "document",

      message:
        "Legacy .doc files are stored safely, but automatic extraction is not enabled. Convert the document to DOCX or PDF for full reading."
    });
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

    return extractRtf({
      buffer:
        data
    });
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

    return extractOdt({
      buffer:
        data
    });
  }


  /* ===================================================
     APPLE PAGES
     =================================================== */

  if (
    ext ===
    "pages"
  ) {

    return unsupportedResult({
      extension:
        ext,

      category:
        "document",

      message:
        "Apple Pages files are stored safely, but automatic extraction is not currently available. Export to PDF or DOCX for full reading."
    });
  }


  /* ===================================================
     CSV / TSV
     =================================================== */

  if (
    ext ===
      "csv" ||
    ext ===
      "tsv" ||
    safeMime ===
      "text/csv" ||
    safeMime ===
      "text/tab-separated-values"
  ) {

    return extractDelimited({
      buffer:
        data,

      extension:
        ext ===
        "tsv"
          ? "tsv"
          : "csv"
    });
  }


  /* ===================================================
     EXCEL
     =================================================== */

  if (
    [
      "xls",
      "xlsx",
      "xlsm",
      "xlsb",
      "ods"
    ].includes(
      ext
    )
  ) {

    return extractSpreadsheet({
      buffer:
        data,

      extension:
        ext
    });
  }


  /* ===================================================
     APPLE NUMBERS
     =================================================== */

  if (
    ext ===
    "numbers"
  ) {

    return unsupportedResult({
      extension:
        ext,

      category:
        "spreadsheet",

      message:
        "Apple Numbers files are stored safely, but automatic extraction is not currently available. Export to XLSX or CSV for full reading."
    });
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

    return extractPptx({
      buffer:
        data
    });
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

    return extractOdp({
      buffer:
        data
    });
  }


  /* ===================================================
     LEGACY PPT
     =================================================== */

  if (
    ext ===
    "ppt"
  ) {

    return unsupportedResult({
      extension:
        ext,

      category:
        "presentation",

      message:
        "Legacy .ppt files are stored safely, but automatic extraction is not enabled. Convert to PPTX or PDF for full reading."
    });
  }


  /* ===================================================
     APPLE KEYNOTE
     =================================================== */

  if (
    ext ===
    "key"
  ) {

    return unsupportedResult({
      extension:
        ext,

      category:
        "presentation",

      message:
        "Apple Keynote files are stored safely, but automatic extraction is not currently available. Export to PPTX or PDF for full reading."
    });
  }


  /* ===================================================
     JSON
     =================================================== */

  if (
    [
      "json",
      "jsonl",
      "ndjson"
    ].includes(
      ext
    ) ||
    safeMime.includes(
      "json"
    )
  ) {

    return extractJson({
      buffer:
        data,

      extension:
        ext ||
        "json"
    });
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

    return extractZip({
      buffer:
        data
    });
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

    return extractGzip({
      buffer:
        data,

      name:
        safeName
    });
  }


  /* ===================================================
     UNSUPPORTED ARCHIVES
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

    return unsupportedResult({
      extension:
        ext,

      category:
        "archive",

      message:
        `The .${ext} archive was stored safely, but automatic extraction for this archive format is not enabled. ZIP is supported directly.`
    });
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

    return unsupportedResult({
      extension:
        ext,

      category:
        "data",

      message:
        `The .${ext} file was stored safely, but automatic structured extraction is not currently enabled for this format.`
    });
  }


  /* ===================================================
     TEXT / CODE / CONFIG
     =================================================== */

  if (
    TEXT_EXTENSIONS.has(
      ext
    ) ||
    safeMime.startsWith(
      "text/"
    )
  ) {

    return extractPlainText({
      buffer:
        data,

      extension:
        ext,

      category:
        safeCategory
    });
  }


  /* ===================================================
     IMAGE / AUDIO / VIDEO

     Normally process.js handles these before this
     function. This fallback remains defensive.
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

    return unsupportedResult({
      extension:
        ext,

      category:
        safeCategory,

      message:
        "This media file should be handled through NEYO multimodal processing rather than text extraction."
    });
  }


  /* ===================================================
     FINAL SAFE FALLBACK
     =================================================== */

  return unsupportedResult({
    extension:
      ext,

    category:
      safeCategory,

    message:
      "This file was stored safely, but NEYO could not identify a safe automatic text extractor for its format."
  });
}


/* =====================================================
   DEFAULT EXPORT

   Supports either import style:

   import { extractAttachment } from ...
   or
   import extractAttachment from ...
   ===================================================== */

export default extractAttachment;
