/*
=========================================================
NEYO — ATTACHMENT NORMALIZER
FINAL v1

FILE:
lib/attachments/normalize.js

PURPOSE:
- Normalize extracted attachment text
- Preserve useful structure
- Remove dangerous/control junk
- Enforce maximum document length
- Create retrieval-friendly chunks
- Keep chunk boundaries stable
- Add overlap for context continuity
- Return one stable contract

INPUT:

normalizeAttachment({
  text,
  file,
  extraction
})

OUTPUT:

{
  document,
  chunks,
  stats,
  warnings
}

IMPORTANT:
- Never executes uploaded content
- Never trusts extracted text length blindly
- Never creates unbounded chunk counts
- Keeps document metadata intact

=========================================================
*/


/* =====================================================
   CONFIG
   ===================================================== */

const MAX_DOCUMENT_CHARACTERS =
  1_500_000;

const TARGET_CHUNK_CHARACTERS =
  12_000;

const MIN_CHUNK_CHARACTERS =
  1_200;

const MAX_CHUNK_CHARACTERS =
  16_000;

const CHUNK_OVERLAP_CHARACTERS =
  1_200;

const MAX_CHUNKS =
  180;

const MAX_WARNING_LENGTH =
  500;


/* =====================================================
   STRING HELPERS
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


/* =====================================================
   NORMALIZE TEXT
   ===================================================== */

function normalizeText(
  value
) {

  let text =
    String(
      value ?? ""
    );


  /*
  Normalize newlines.
  */

  text =
    text.replace(
      /\r\n?/g,
      "\n"
    );


  /*
  Remove NULL and problematic control characters.

  Keep:
  - tab
  - newline
  */

  text =
    text.replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      ""
    );


  /*
  Normalize Unicode spaces.
  */

  text =
    text
      .replace(
        /\u00A0/g,
        " "
      )
      .replace(
        /[\u2000-\u200A]/g,
        " "
      )
      .replace(
        /\u202F/g,
        " "
      )
      .replace(
        /\u205F/g,
        " "
      )
      .replace(
        /\u3000/g,
        " "
      );


  /*
  Remove zero-width formatting characters
  that add no semantic value.
  */

  text =
    text.replace(
      /[\u200B-\u200D\u2060\uFEFF]/g,
      ""
    );


  /*
  Trim trailing horizontal whitespace.
  */

  text =
    text.replace(
      /[ \t]+\n/g,
      "\n"
    );


  /*
  Collapse excessive spaces inside lines.

  Tabs are preserved because spreadsheets/code
  may use them meaningfully.
  */

  text =
    text.replace(
      / {3,}/g,
      "  "
    );


  /*
  Limit excessive blank lines.
  */

  text =
    text.replace(
      /\n{4,}/g,
      "\n\n\n"
    );


  return text.trim();
}


/* =====================================================
   WARNINGS
   ===================================================== */

function normalizeWarnings(
  values
) {

  if (
    !Array.isArray(
      values
    )
  ) {

    return [];
  }


  return Array.from(
    new Set(
      values
        .map(
          value =>
            cleanString(
              value,
              MAX_WARNING_LENGTH
            )
        )
        .filter(
          Boolean
        )
    )
  );
}


/* =====================================================
   SAFE OBJECT
   ===================================================== */

function safeObject(
  value
) {

  if (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  ) {

    return value;
  }


  return {};
}


/* =====================================================
   DOCUMENT TEXT LIMIT
   ===================================================== */

function enforceDocumentLimit(
  text,
  warnings
) {

  if (
    text.length <=
    MAX_DOCUMENT_CHARACTERS
  ) {

    return text;
  }


  warnings.push(
    `Document text was truncated to ${MAX_DOCUMENT_CHARACTERS.toLocaleString()} characters.`
  );


  return text.slice(
    0,
    MAX_DOCUMENT_CHARACTERS
  );
}


/* =====================================================
   BOUNDARY SEARCH

   We prefer boundaries in this order:

   1. section / paragraph
   2. newline
   3. sentence
   4. whitespace
   5. hard character cut
   ===================================================== */

function findBestBoundary(
  text,
  start,
  idealEnd,
  maximumEnd
) {

  const safeIdeal =
    Math.min(
      idealEnd,
      text.length
    );


  const safeMaximum =
    Math.min(
      maximumEnd,
      text.length
    );


  if (
    safeIdeal >=
    text.length
  ) {

    return text.length;
  }


  /*
  Search slightly around ideal boundary,
  but never exceed maximum chunk size.
  */

  const searchStart =
    Math.max(
      start +
        MIN_CHUNK_CHARACTERS,
      safeIdeal -
        2_000
    );


  const searchEnd =
    safeMaximum;


  const segment =
    text.slice(
      searchStart,
      searchEnd
    );


  /* -------------------------------------------------
     PARAGRAPH
     ------------------------------------------------- */

  const paragraphIndex =
    segment.lastIndexOf(
      "\n\n"
    );


  if (
    paragraphIndex !==
    -1
  ) {

    return (
      searchStart +
      paragraphIndex +
      2
    );
  }


  /* -------------------------------------------------
     NEWLINE
     ------------------------------------------------- */

  const newlineIndex =
    segment.lastIndexOf(
      "\n"
    );


  if (
    newlineIndex !==
    -1
  ) {

    return (
      searchStart +
      newlineIndex +
      1
    );
  }


  /* -------------------------------------------------
     SENTENCE
     ------------------------------------------------- */

  const sentencePatterns = [
    ". ",
    "! ",
    "? ",
    "۔ ",
    "؟ "
  ];


  let bestSentence =
    -1;


  for (
    const pattern
    of sentencePatterns
  ) {

    const index =
      segment.lastIndexOf(
        pattern
      );


    if (
      index >
      bestSentence
    ) {

      bestSentence =
        index +
        pattern.length;
    }
  }


  if (
    bestSentence >
    0
  ) {

    return (
      searchStart +
      bestSentence
    );
  }


  /* -------------------------------------------------
     SPACE
     ------------------------------------------------- */

  const spaceIndex =
    segment.lastIndexOf(
      " "
    );


  if (
    spaceIndex !==
    -1
  ) {

    return (
      searchStart +
      spaceIndex +
      1
    );
  }


  /* -------------------------------------------------
     HARD CUT
     ------------------------------------------------- */

  return safeIdeal;
}


/* =====================================================
   OVERLAP START

   Try not to start a chunk in the middle of a word.
   ===================================================== */

function findOverlapStart(
  text,
  previousEnd
) {

  let start =
    Math.max(
      0,
      previousEnd -
        CHUNK_OVERLAP_CHARACTERS
    );


  if (
    start ===
    0
  ) {

    return 0;
  }


  /*
  Prefer paragraph/newline nearby.
  */

  const searchLimit =
    Math.min(
      previousEnd,
      start +
        400
    );


  const area =
    text.slice(
      start,
      searchLimit
    );


  const paragraph =
    area.indexOf(
      "\n\n"
    );


  if (
    paragraph !==
    -1
  ) {

    return (
      start +
      paragraph +
      2
    );
  }


  const newline =
    area.indexOf(
      "\n"
    );


  if (
    newline !==
    -1
  ) {

    return (
      start +
      newline +
      1
    );
  }


  /*
  Otherwise move to next whitespace.
  */

  const space =
    area.search(
      /\s/
    );


  if (
    space !==
    -1
  ) {

    return (
      start +
      space +
      1
    );
  }


  return start;
}


/* =====================================================
   CREATE CHUNKS
   ===================================================== */

function createChunks(
  text,
  file,
  warnings
) {

  if (!text) {
    return [];
  }


  const chunks =
    [];


  let start =
    0;


  let chunkIndex =
    0;


  while (
    start <
      text.length &&
    chunkIndex <
      MAX_CHUNKS
  ) {

    const remaining =
      text.length -
      start;


    /*
    Final small section.
    */

    if (
      remaining <=
      MAX_CHUNK_CHARACTERS
    ) {

      const content =
        text
          .slice(
            start
          )
          .trim();


      if (content) {

        chunks.push(
          createChunkRecord({
            index:
              chunkIndex,

            content,

            start,

            end:
              text.length,

            file
          })
        );
      }


      start =
        text.length;


      break;
    }


    const idealEnd =
      start +
      TARGET_CHUNK_CHARACTERS;


    const maximumEnd =
      start +
      MAX_CHUNK_CHARACTERS;


    let end =
      findBestBoundary(
        text,
        start,
        idealEnd,
        maximumEnd
      );


    /*
    Safety against accidental tiny chunks.
    */

    if (
      end -
        start <
      MIN_CHUNK_CHARACTERS
    ) {

      end =
        Math.min(
          start +
            TARGET_CHUNK_CHARACTERS,
          text.length
        );
    }


    /*
    Never exceed hard max.
    */

    if (
      end -
        start >
      MAX_CHUNK_CHARACTERS
    ) {

      end =
        start +
        MAX_CHUNK_CHARACTERS;
    }


    const content =
      text
        .slice(
          start,
          end
        )
        .trim();


    if (content) {

      chunks.push(
        createChunkRecord({
          index:
            chunkIndex,

          content,

          start,

          end,

          file
        })
      );
    }


    if (
      end >=
      text.length
    ) {

      break;
    }


    /*
    Start next chunk with context overlap.
    */

    const nextStart =
      findOverlapStart(
        text,
        end
      );


    /*
    Hard safety against infinite loops.
    */

    if (
      nextStart <=
      start
    ) {

      start =
        end;

    } else {

      start =
        nextStart;
    }


    chunkIndex +=
      1;
  }


  /* -------------------------------------------------
     MAX CHUNK LIMIT
     ------------------------------------------------- */

  if (
    start <
    text.length
  ) {

    warnings.push(
      `Document chunk limit was reached at ${MAX_CHUNKS} chunks.`
    );
  }


  return chunks;
}


/* =====================================================
   CHUNK RECORD
   ===================================================== */

function createChunkRecord({
  index,
  content,
  start,
  end,
  file
}) {

  const documentId =
    cleanString(
      file?.id,
      128
    );


  const uploadId =
    cleanString(
      file?.uploadId,
      128
    );


  const name =
    cleanString(
      file?.name ||
      "attachment",
      220
    );


  return {
    id:
      documentId
        ? `${documentId}:chunk:${index}`
        : (
            uploadId
              ? `${uploadId}:chunk:${index}`
              : `chunk:${index}`
          ),

    index,

    content,

    text:
      content,

    characterStart:
      start,

    characterEnd:
      end,

    characterCount:
      content.length,

    documentId:
      documentId ||
      null,

    uploadId:
      uploadId ||
      null,

    source: {
      provider:
        cleanString(
          file?.provider ||
          "supabase",
          64
        ),

      bucket:
        cleanString(
          file?.bucket,
          128
        ) ||
        null,

      path:
        cleanString(
          file?.path,
          1024
        ) ||
        null,

      name,

      mime:
        cleanString(
          file?.mime ||
          file?.mimeType ||
          "application/octet-stream",
          180
        ),

      extension:
        cleanString(
          file?.extension,
          32
        ),

      category:
        cleanString(
          file?.category ||
          "unknown",
          64
        )
    }
  };
}


/* =====================================================
   DOCUMENT RECORD
   ===================================================== */

function createDocumentRecord({
  file,
  text,
  extraction
}) {

  const safeFile =
    safeObject(
      file
    );


  const safeExtraction =
    safeObject(
      extraction
    );


  return {
    ...safeFile,

    id:
      cleanString(
        safeFile.id,
        128
      ) ||
      null,

    uploadId:
      cleanString(
        safeFile.uploadId,
        128
      ) ||
      null,

    provider:
      cleanString(
        safeFile.provider ||
        "supabase",
        64
      ),

    bucket:
      cleanString(
        safeFile.bucket,
        128
      ) ||
      null,

    path:
      cleanString(
        safeFile.path,
        1024
      ) ||
      null,

    name:
      cleanString(
        safeFile.name ||
        "attachment",
        220
      ),

    mime:
      cleanString(
        safeFile.mime ||
        safeFile.mimeType ||
        "application/octet-stream",
        180
      ),

    mimeType:
      cleanString(
        safeFile.mimeType ||
        safeFile.mime ||
        "application/octet-stream",
        180
      ),

    extension:
      cleanString(
        safeFile.extension,
        32
      ),

    category:
      cleanString(
        safeFile.category ||
        "unknown",
        64
      ),

    size:
      Number(
        safeFile.size
      ) || 0,

    text,

    textLength:
      text.length,

    extraction: {
      parser:
        cleanString(
          safeExtraction.parser ||
          "unknown",
          100
        ),

      kind:
        cleanString(
          safeExtraction.kind ||
          safeFile.category ||
          "unknown",
          64
        ),

      metadata:
        safeObject(
          safeExtraction.metadata
        )
    }
  };
}


/* =====================================================
   STATS
   ===================================================== */

function calculateStats({
  text,
  chunks,
  file,
  wasTruncated
}) {

  let words =
    0;


  if (text) {

    const matches =
      text.match(
        /\S+/g
      );


    words =
      matches
        ? matches.length
        : 0;
  }


  const chunkCharacters =
    chunks.reduce(
      (
        total,
        chunk
      ) =>
        total +
        Number(
          chunk.characterCount ||
          0
        ),
      0
    );


  return {
    bytes:
      Number(
        file?.size
      ) || 0,

    characters:
      text.length,

    words,

    chunks:
      chunks.length,

    chunkCharacters,

    averageChunkCharacters:
      chunks.length
        ? Math.round(
            chunkCharacters /
            chunks.length
          )
        : 0,

    targetChunkCharacters:
      TARGET_CHUNK_CHARACTERS,

    maxChunkCharacters:
      MAX_CHUNK_CHARACTERS,

    overlapCharacters:
      CHUNK_OVERLAP_CHARACTERS,

    truncated:
      Boolean(
        wasTruncated
      )
  };
}


/* =====================================================
   MAIN
   ===================================================== */

export function normalizeAttachment({
  text,
  file,
  extraction
}) {

  const warnings =
    [
      ...normalizeWarnings(
        extraction?.warnings
      )
    ];


  /* -------------------------------------------------
     NORMALIZE
     ------------------------------------------------- */

  let normalizedText =
    normalizeText(
      text
    );


  const originalLength =
    normalizedText.length;


  /* -------------------------------------------------
     DOCUMENT LIMIT
     ------------------------------------------------- */

  normalizedText =
    enforceDocumentLimit(
      normalizedText,
      warnings
    );


  const wasTruncated =
    normalizedText.length <
    originalLength;


  /* -------------------------------------------------
     DOCUMENT
     ------------------------------------------------- */

  const document =
    createDocumentRecord({
      file,
      text:
        normalizedText,
      extraction
    });


  /* -------------------------------------------------
     CHUNKS
     ------------------------------------------------- */

  const chunks =
    createChunks(
      normalizedText,
      document,
      warnings
    );


  /* -------------------------------------------------
     EMPTY TEXT

     This is not necessarily an error.

     Example:
     unsupported legacy format can return a valid
     document with warnings and no readable text.
     ------------------------------------------------- */

  if (
    !normalizedText
  ) {

    warnings.push(
      "No readable text was extracted from this attachment."
    );
  }


  /* -------------------------------------------------
     STATS
     ------------------------------------------------- */

  const stats =
    calculateStats({
      text:
        normalizedText,

      chunks,

      file:
        document,

      wasTruncated
    });


  /* -------------------------------------------------
     FINAL
     ------------------------------------------------- */

  return {
    document,

    chunks,

    stats,

    warnings:
      normalizeWarnings(
        warnings
      )
  };
}


/* =====================================================
   RETRIEVAL RECORD BUILDER

   Optional helper for future RAG/vector storage.

   process.js does not need to call this immediately,
   but keeping it here prevents future duplicate
   chunk-shaping logic elsewhere.
   ===================================================== */

export function buildRetrievalRecords({
  document,
  chunks
}) {

  const safeDocument =
    safeObject(
      document
    );


  const safeChunks =
    Array.isArray(
      chunks
    )
      ? chunks
      : [];


  return safeChunks.map(
    chunk => ({
      id:
        chunk.id,

      documentId:
        chunk.documentId ||
        safeDocument.id ||
        null,

      uploadId:
        chunk.uploadId ||
        safeDocument.uploadId ||
        null,

      content:
        String(
          chunk.content ||
          ""
        ),

      metadata: {
        chunkIndex:
          Number(
            chunk.index
          ) || 0,

        characterStart:
          Number(
            chunk.characterStart
          ) || 0,

        characterEnd:
          Number(
            chunk.characterEnd
          ) || 0,

        name:
          safeDocument.name ||
          null,

        mime:
          safeDocument.mime ||
          safeDocument.mimeType ||
          null,

        extension:
          safeDocument.extension ||
          null,

        category:
          safeDocument.category ||
          null,

        provider:
          safeDocument.provider ||
          null,

        bucket:
          safeDocument.bucket ||
          null,

        path:
          safeDocument.path ||
          null
      }
    })
  );
}


/* =====================================================
   DEFAULT EXPORT
   ===================================================== */

export default normalizeAttachment;
