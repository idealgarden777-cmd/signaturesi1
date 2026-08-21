/*
=========================================================
NEYO — ATTACHMENT NORMALIZER v1

Purpose:
- Normalize extractor output
- Clean unsafe/noisy text
- Preserve file metadata
- Split large content into model-safe chunks
- Add overlap for continuity
- Produce compact context payloads
- Prepare attachment content for retrieval/RAG

Input:
{
  extracted,
  text,
  type,
  parser,
  metadata,
  warnings,
  truncated
}

Output:
{
  ready,
  document,
  chunks,
  stats,
  warnings
}

Does NOT own:
- file upload
- MIME verification
- parsing PDF/DOCX/etc
- embeddings
- vector database
- model calls
=========================================================
*/

import crypto from "node:crypto";


/* =========================================================
   CONFIG
   ========================================================= */

const CONFIG =
  Object.freeze({

    /*
    Character-based chunking is intentionally
    deterministic and tokenizer-independent.

    Roughly:
    4 chars ≈ 1 token in common English text.
    */

    targetChunkChars:
      12000,

    minChunkChars:
      1200,

    maxChunkChars:
      16000,

    overlapChars:
      1200,


    /*
    Hard safety ceiling after extraction.
    Huge documents should later use background
    indexing and retrieval.
    */

    maxDocumentChars:
      1_500_000,


    maxChunks:
      180,


    maxWarnings:
      30,


    maxMetadataDepth:
      5,


    maxMetadataArrayItems:
      100,


    maxMetadataStringChars:
      5000
  });


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}


function createId(
  prefix = "chunk"
) {

  return `${prefix}_${crypto.randomUUID()}`;
}


function cleanString(
  value,
  maxLength =
    CONFIG.maxMetadataStringChars
) {

  return String(
    value ?? ""
  )
    .normalize("NFKC")
    .replace(
      /\u0000/g,
      ""
    )
    .trim()
    .slice(
      0,
      maxLength
    );
}


/* =========================================================
   TEXT CLEANING
   ========================================================= */

function normalizeText(
  text
) {

  return String(
    text || ""
  )

    /*
    Normalize line endings
    */

    .replace(
      /\r\n/g,
      "\n"
    )

    .replace(
      /\r/g,
      "\n"
    )


    /*
    Remove null/control noise
    while preserving tab/newline.
    */

    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      ""
    )


    /*
    Normalize unusual Unicode spaces
    */

    .replace(
      /[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g,
      " "
    )


    /*
    Remove trailing spaces
    */

    .replace(
      /[ \t]+\n/g,
      "\n"
    )


    /*
    Collapse excessive spaces
    */

    .replace(
      /[ \t]{4,}/g,
      "   "
    )


    /*
    Avoid huge blank regions
    */

    .replace(
      /\n{5,}/g,
      "\n\n\n\n"
    )

    .trim();
}


/* =========================================================
   METADATA SANITIZER
   ========================================================= */

function sanitizeMetadata(
  value,
  depth = 0
) {

  if (
    depth >
    CONFIG.maxMetadataDepth
  ) {

    return null;
  }


  if (
    value === null ||
    value === undefined
  ) {

    return null;
  }


  if (
    typeof value ===
    "string"
  ) {

    return cleanString(
      value
    );
  }


  if (
    typeof value ===
      "number" ||
    typeof value ===
      "boolean"
  ) {

    return value;
  }


  if (
    value instanceof Date
  ) {

    return value.toISOString();
  }


  if (
    Array.isArray(
      value
    )
  ) {

    return value
      .slice(
        0,
        CONFIG.maxMetadataArrayItems
      )
      .map(
        item =>
          sanitizeMetadata(
            item,
            depth + 1
          )
      );
  }


  if (
    typeof value ===
    "object"
  ) {

    const output =
      {};


    for (
      const [
        key,
        item
      ]
      of Object.entries(
        value
      )
    ) {

      const safeKey =
        cleanString(
          key,
          150
        );


      if (!safeKey) {
        continue;
      }


      output[safeKey] =
        sanitizeMetadata(
          item,
          depth + 1
        );
    }


    return output;
  }


  return cleanString(
    value
  );
}


/* =========================================================
   WARNINGS
   ========================================================= */

function normalizeWarnings(
  warnings
) {

  if (
    !Array.isArray(
      warnings
    )
  ) {

    return [];
  }


  const unique =
    new Set();


  for (
    const warning
    of warnings
  ) {

    const value =
      cleanString(
        warning,
        700
      );


    if (!value) {
      continue;
    }


    unique.add(
      value
    );


    if (
      unique.size >=
      CONFIG.maxWarnings
    ) {

      break;
    }
  }


  return [
    ...unique
  ];
}


/* =========================================================
   NATURAL BREAK FINDER
   ========================================================= */

function findPreferredBreak(
  text,
  start,
  targetEnd
) {

  const maxEnd =
    Math.min(
      text.length,
      start +
      CONFIG.maxChunkChars
    );


  const minEnd =
    Math.min(
      text.length,
      start +
      CONFIG.minChunkChars
    );


  if (
    maxEnd >=
    text.length
  ) {

    return text.length;
  }


  let searchEnd =
    clamp(
      targetEnd,
      minEnd,
      maxEnd
    );


  /*
  Priority:
  1. section break
  2. paragraph
  3. sentence
  4. newline
  5. whitespace
  6. hard cut
  */

  const candidates = [
    {
      pattern:
        /\n={3,}[^\n]*={3,}\n/g,

      minimum:
        minEnd
    },

    {
      pattern:
        /\n\n/g,

      minimum:
        minEnd
    },

    {
      pattern:
        /[.!?]\s+/g,

      minimum:
        minEnd
    },

    {
      pattern:
        /\n/g,

      minimum:
        minEnd
    },

    {
      pattern:
        /\s+/g,

      minimum:
        minEnd
    }
  ];


  const windowStart =
    Math.max(
      start,
      searchEnd -
      4500
    );


  const searchText =
    text.slice(
      windowStart,
      maxEnd
    );


  for (
    const candidate
    of candidates
  ) {

    let best =
      -1;


    candidate.pattern.lastIndex =
      0;


    let match;


    while (
      (
        match =
          candidate.pattern.exec(
            searchText
          )
      )
    ) {

      const absolute =
        windowStart +
        match.index +
        match[0].length;


      if (
        absolute <
        candidate.minimum
      ) {
        continue;
      }


      if (
        absolute >
        maxEnd
      ) {
        break;
      }


      /*
      Prefer breaks near target.
      */

      if (
        absolute <=
        searchEnd +
        1200
      ) {

        best =
          absolute;
      }
    }


    if (
      best >
      start
    ) {

      return best;
    }
  }


  return maxEnd;
}


/* =========================================================
   CHUNK TITLE DETECTION
   ========================================================= */

function detectChunkHeading(
  text
) {

  const lines =
    String(
      text || ""
    )
      .split("\n")
      .map(
        line =>
          line.trim()
      )
      .filter(Boolean)
      .slice(
        0,
        8
      );


  for (
    const line
    of lines
  ) {

    if (
      line.length >
      140
    ) {
      continue;
    }


    /*
    Markdown headings
    */

    if (
      /^#{1,6}\s+/.test(
        line
      )
    ) {

      return line.replace(
        /^#{1,6}\s+/,
        ""
      );
    }


    /*
    PowerPoint/PDF generated section labels
    */

    if (
      /^===.+===$/.test(
        line
      )
    ) {

      return line
        .replace(
          /^===\s*/,
          ""
        )
        .replace(
          /\s*===$/,
          ""
        );
    }


    /*
    Short title-like line
    */

    if (
      line.length <=
        80 &&
      !/[.!?]$/.test(
        line
      )
    ) {

      return line;
    }
  }


  return null;
}


/* =========================================================
   CHUNK CREATION
   ========================================================= */

function chunkText(
  text,
  documentId
) {

  const source =
    normalizeText(
      text
    );


  if (!source) {
    return [];
  }


  if (
    source.length <=
    CONFIG.maxChunkChars
  ) {

    return [
      {
        id:
          createId(
            "chunk"
          ),

        documentId,

        index:
          0,

        startChar:
          0,

        endChar:
          source.length,

        characters:
          source.length,

        heading:
          detectChunkHeading(
            source
          ),

        text:
          source
      }
    ];
  }


  const chunks =
    [];


  let start =
    0;

  let index =
    0;


  while (
    start <
      source.length &&
    chunks.length <
      CONFIG.maxChunks
  ) {

    const targetEnd =
      start +
      CONFIG.targetChunkChars;


    const end =
      findPreferredBreak(
        source,
        start,
        targetEnd
      );


    if (
      end <=
      start
    ) {

      break;
    }


    const chunkTextValue =
      source
        .slice(
          start,
          end
        )
        .trim();


    if (
      chunkTextValue
    ) {

      chunks.push({

        id:
          createId(
            "chunk"
          ),

        documentId,

        index,

        startChar:
          start,

        endChar:
          end,

        characters:
          chunkTextValue.length,

        heading:
          detectChunkHeading(
            chunkTextValue
          ),

        text:
          chunkTextValue
      });


      index +=
        1;
    }


    if (
      end >=
      source.length
    ) {

      break;
    }


    /*
    Character overlap maintains context
    between neighboring chunks.
    */

    const nextStart =
      Math.max(
        end -
        CONFIG.overlapChars,
        start + 1
      );


    start =
      nextStart;
  }


  return chunks;
}


/* =========================================================
   DOCUMENT SUMMARY METADATA
   ========================================================= */

function buildDocumentMetadata(
  extraction
) {

  const metadata =
    sanitizeMetadata(
      extraction?.metadata ||
      {}
    ) ||
    {};


  return {

    ...metadata,

    type:
      cleanString(
        extraction?.type ||
        metadata.type ||
        "unknown",
        100
      ),

    parser:
      cleanString(
        extraction?.parser ||
        "unknown",
        100
      )
  };
}


/* =========================================================
   MODEL CONTEXT LABEL
   ========================================================= */

function buildContextLabel(
  metadata
) {

  const name =
    cleanString(
      metadata?.name ||
      metadata?.originalName ||
      "Attachment",
      250
    );


  const type =
    cleanString(
      metadata?.type ||
      metadata?.category ||
      "file",
      100
    );


  return `${name} (${type})`;
}


/* =========================================================
   MAIN NORMALIZER
   ========================================================= */

export function normalizeAttachment(
  extraction,
  {
    documentId =
      createId(
        "doc"
      ),

    uploadId =
      null,

    processId =
      null,

    storagePath =
      null
  } = {}
) {

  const warnings =
    normalizeWarnings(
      extraction?.warnings
    );


  const extracted =
    Boolean(
      extraction?.extracted
    );


  let text =
    normalizeText(
      extraction?.text ||
      ""
    );


  let documentTruncated =
    Boolean(
      extraction?.truncated
    );


  /* -------------------------------------------------------
     HARD DOCUMENT CEILING
     ------------------------------------------------------- */

  if (
    text.length >
    CONFIG.maxDocumentChars
  ) {

    text =
      text.slice(
        0,
        CONFIG.maxDocumentChars
      );


    documentTruncated =
      true;


    warnings.push(
      "Document was shortened before chunking because it exceeded the maximum inline indexing size."
    );
  }


  const metadata =
    buildDocumentMetadata(
      extraction
    );


  const chunks =
    extracted &&
    text
      ? chunkText(
          text,
          documentId
        )
      : [];


  const chunkLimitReached =
    (
      chunks.length >=
      CONFIG.maxChunks
    ) &&
    (
      chunks.at(-1)
        ?.endChar <
      text.length
    );


  if (
    chunkLimitReached
  ) {

    documentTruncated =
      true;


    warnings.push(
      "Only the first portion of this document was chunked because the maximum chunk count was reached."
    );
  }


  const uniqueWarnings =
    normalizeWarnings(
      warnings
    );


  const ready =
    Boolean(
      extracted &&
      chunks.length >
        0
    );


  const contextLabel =
    buildContextLabel(
      metadata
    );


  return {

    ready,


    document: {

      id:
        documentId,


      uploadId:
        uploadId ||
        null,


      processId:
        processId ||
        null,


      storagePath:
        storagePath ||
        null,


      name:
        cleanString(
          metadata?.name ||
          metadata?.originalName ||
          "Attachment",
          300
        ),


      label:
        contextLabel,


      type:
        cleanString(
          extraction?.type ||
          metadata?.type ||
          "unknown",
          100
        ),


      parser:
        cleanString(
          extraction?.parser ||
          "unknown",
          100
        ),


      extracted,


      truncated:
        documentTruncated,


      characters:
        text.length,


      chunkCount:
        chunks.length,


      metadata
    },


    chunks:


      chunks.map(
        chunk => ({

          ...chunk,


          /*
          Convenience payload for downstream
          RAG/model context assembly.
          */

          source: {

            documentId,

            uploadId:
              uploadId ||
              null,

            processId:
              processId ||
              null,

            name:
              contextLabel,

            type:
              cleanString(
                extraction?.type ||
                "unknown",
                100
              )
          }
        })
      ),


    stats: {

      characters:
        text.length,


      chunks:
        chunks.length,


      averageChunkChars:
        chunks.length
          ? Math.round(
              chunks.reduce(
                (
                  total,
                  chunk
                ) =>
                  total +
                  chunk.characters,
                0
              ) /
              chunks.length
            )
          : 0,


      extracted,


      truncated:
        documentTruncated
    },


    warnings:
      uniqueWarnings
  };
}


/* =========================================================
   BATCH NORMALIZER
   ========================================================= */

export function normalizeAttachments(
  attachments
) {

  if (
    !Array.isArray(
      attachments
    )
  ) {

    return [];
  }


  return attachments.map(
    (
      attachment,
      index
    ) => {

      const extraction =
        attachment?.extraction ||
        attachment;


      return normalizeAttachment(
        extraction,
        {

          documentId:
            attachment?.documentId ||
            createId(
              `doc${index}`
            ),


          uploadId:
            attachment?.uploadId ||
            null,


          processId:
            attachment?.processId ||
            null,


          storagePath:
            attachment?.storagePath ||
            attachment?.path ||
            null
        }
      );
    }
  );
}


/* =========================================================
   CONTEXT ASSEMBLY

   Useful for small attachments where every chunk
   can be directly sent to model.

   Large collections should use retrieval instead.
   ========================================================= */

export function buildAttachmentContext(
  normalized,
  {
    maxChars =
      50000,

    maxChunks =
      8
  } = {}
) {

  if (
    !normalized?.ready ||
    !Array.isArray(
      normalized.chunks
    )
  ) {

    return {
      text:
        "",

      chunks:
        [],

      truncated:
        false
    };
  }


  const selected =
    [];


  let total =
    0;

  let truncated =
    false;


  for (
    const chunk
    of normalized.chunks
  ) {

    if (
      selected.length >=
      maxChunks
    ) {

      truncated =
        true;

      break;
    }


    const header =
      [
        `[Attachment: ${
          normalized.document.label
        }]`,

        chunk.heading
          ? `[Section: ${chunk.heading}]`
          : null,

        `[Chunk ${
          chunk.index + 1
        }/${normalized.chunks.length}]`
      ]
        .filter(Boolean)
        .join("\n");


    const block =
      `${header}\n${chunk.text}`;


    if (
      total +
      block.length >
      maxChars
    ) {

      const remaining =
        maxChars -
        total;


      if (
        remaining >
        500
      ) {

        selected.push({
          ...chunk,

          text:
            chunk.text.slice(
              0,
              Math.max(
                0,
                remaining -
                header.length -
                2
              )
            ),

          contextTruncated:
            true
        });
      }


      truncated =
        true;

      break;
    }


    selected.push(
      chunk
    );


    total +=
      block.length +
      2;
  }


  const text =
    selected
      .map(
        chunk => {

          const header =
            [
              `[Attachment: ${
                normalized.document.label
              }]`,

              chunk.heading
                ? `[Section: ${chunk.heading}]`
                : null,

              `[Chunk ${
                chunk.index + 1
              }/${normalized.chunks.length}]`
            ]
              .filter(Boolean)
              .join("\n");


          return `${header}\n${chunk.text}`;
        }
      )
      .join(
        "\n\n"
      );


  return {

    text,

    chunks:
      selected,

    truncated
  };
}


/* =========================================================
   RETRIEVAL RECORDS

   Ready for embeddings / pgvector later.
   ========================================================= */

export function buildRetrievalRecords(
  normalized
) {

  if (
    !normalized?.ready
  ) {

    return [];
  }


  return normalized.chunks.map(
    chunk => ({

      id:
        chunk.id,


      documentId:
        normalized.document.id,


      uploadId:
        normalized.document.uploadId,


      processId:
        normalized.document.processId,


      chunkIndex:
        chunk.index,


      heading:
        chunk.heading,


      text:
        chunk.text,


      characters:
        chunk.characters,


      startChar:
        chunk.startChar,


      endChar:
        chunk.endChar,


      metadata: {

        documentName:
          normalized.document.name,

        documentType:
          normalized.document.type,

        parser:
          normalized.document.parser,

        ...normalized.document.metadata
      }
    })
  );
}


/* =========================================================
   CAPABILITY SUMMARY
   ========================================================= */

export function getNormalizationConfig() {

  return {
    ...CONFIG
  };
}
