/*
=========================================================
NEYO — ATTACHMENT NORMALIZER
FINAL v2

FILE:
lib/attachments/normalize.js

RESPONSIBILITIES
---------------------------------------------------------
✅ Clean extracted text
✅ Normalize line endings
✅ Remove unsafe control characters
✅ Preserve useful structure
✅ Create bounded chunks
✅ Add chunk overlap
✅ Generate document metadata
✅ Generate extraction statistics
✅ Return stable contract for process.js/chat.js

DOES NOT:
❌ Execute content
❌ Summarize content
❌ Call AI
❌ Modify Supabase
❌ Trust attachment text as instructions
=========================================================
*/


/* =====================================================
   CONFIG
   ===================================================== */

const DEFAULTS =
  Object.freeze({
    maxDocumentCharacters:
      1_500_000,

    chunkCharacters:
      8_000,

    chunkOverlapCharacters:
      800,

    minimumChunkCharacters:
      200,

    maxChunks:
      250,

    maxTitleLength:
      220,

    maxWarningLength:
      500,

    maxWarnings:
      50
  });


/* =====================================================
   BASIC HELPERS
   ===================================================== */

function cleanString(
  value
) {
  return String(
    value ??
    ""
  );
}


function toFiniteInteger(
  value,
  fallback
) {
  const number =
    Number(
      value
    );


  if (
    !Number.isFinite(
      number
    )
  ) {
    return fallback;
  }


  return Math.max(
    0,
    Math.floor(
      number
    )
  );
}


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


/* =====================================================
   TEXT CLEANING
   ===================================================== */

function normalizeLineEndings(
  value
) {
  return cleanString(
    value
  )
    .replace(
      /\r\n/g,
      "\n"
    )
    .replace(
      /\r/g,
      "\n"
    );
}


function removeUnsafeControls(
  value
) {
  /*
   * Keep:
   * \n = 0x0A
   * \t = 0x09
   *
   * Remove other low control characters.
   */

  return cleanString(
    value
  )
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      ""
    );
}


function normalizeWhitespace(
  value
) {
  let text =
    cleanString(
      value
    );


  /*
   * Normalize non-breaking spaces.
   */

  text =
    text.replace(
      /\u00A0/g,
      " "
    );


  /*
   * Trim trailing spaces from every line.
   */

  text =
    text.replace(
      /[ \t]+$/gm,
      ""
    );


  /*
   * Avoid huge runs of empty lines,
   * but preserve paragraph structure.
   */

  text =
    text.replace(
      /\n{4,}/g,
      "\n\n\n"
    );


  return text.trim();
}


function normalizeText(
  value
) {
  return normalizeWhitespace(
    removeUnsafeControls(
      normalizeLineEndings(
        value
      )
    )
  );
}


/* =====================================================
   WARNING NORMALIZATION
   ===================================================== */

function normalizeWarnings(
  ...sources
) {
  const output =
    [];


  const seen =
    new Set();


  for (
    const source
    of sources
  ) {
    if (
      !Array.isArray(
        source
      )
    ) {
      continue;
    }


    for (
      const item
      of source
    ) {
      const warning =
        cleanString(
          item
        )
          .replace(
            /\s+/g,
            " "
          )
          .trim()
          .slice(
            0,
            DEFAULTS
              .maxWarningLength
          );


      if (!warning) {
        continue;
      }


      if (
        seen.has(
          warning
        )
      ) {
        continue;
      }


      seen.add(
        warning
      );


      output.push(
        warning
      );


      if (
        output.length >=
        DEFAULTS
          .maxWarnings
      ) {
        break;
      }
    }


    if (
      output.length >=
      DEFAULTS
        .maxWarnings
    ) {
      break;
    }
  }


  return output;
}


/* =====================================================
   FILE METADATA
   ===================================================== */

function normalizeFile(
  file =
    {}
) {
  return {
    id:
      cleanString(
        file.id
      )
        .trim() ||
      null,

    uploadId:
      cleanString(
        file.uploadId
      )
        .trim() ||
      null,

    provider:
      cleanString(
        file.provider
      )
        .trim() ||
      null,

    bucket:
      cleanString(
        file.bucket
      )
        .trim() ||
      null,

    path:
      cleanString(
        file.path
      )
        .trim() ||
      null,

    name:
      cleanString(
        file.name
      )
        .trim()
        .slice(
          0,
          DEFAULTS
            .maxTitleLength
        ) ||
      "Untitled attachment",

    mime:
      cleanString(
        file.mime ||
        file.mimeType
      )
        .trim() ||
      "application/octet-stream",

    mimeType:
      cleanString(
        file.mimeType ||
        file.mime
      )
        .trim() ||
      "application/octet-stream",

    extension:
      cleanString(
        file.extension
      )
        .trim()
        .toLowerCase(),

    category:
      cleanString(
        file.category
      )
        .trim()
        .toLowerCase() ||
      "unknown",

    size:
      toFiniteInteger(
        file.size,
        0
      )
  };
}


/* =====================================================
   EXTRACTION METADATA
   ===================================================== */

function normalizeExtraction(
  extraction =
    {}
) {
  return {
    parser:
      cleanString(
        extraction.parser
      )
        .trim() ||
      "unknown",

    kind:
      cleanString(
        extraction.kind
      )
        .trim() ||
      "unknown",

    metadata:
      extraction.metadata &&
      typeof extraction.metadata ===
        "object" &&
      !Array.isArray(
        extraction.metadata
      )
        ? extraction.metadata
        : {},

    warnings:
      normalizeWarnings(
        extraction.warnings
      )
  };
}


/* =====================================================
   DOCUMENT LIMIT
   ===================================================== */

function limitDocumentText(
  value,
  maxCharacters
) {
  const text =
    cleanString(
      value
    );


  if (
    text.length <=
    maxCharacters
  ) {
    return {
      text,
      truncated:
        false,

      originalCharacters:
        text.length
    };
  }


  return {
    text:
      text.slice(
        0,
        maxCharacters
      ),

    truncated:
      true,

    originalCharacters:
      text.length
  };
}


/* =====================================================
   SAFE SPLIT POSITION
   ===================================================== */

function findBestSplit(
  text,
  start,
  desiredEnd,
  minimumEnd
) {
  const maxEnd =
    Math.min(
      desiredEnd,
      text.length
    );


  if (
    maxEnd >=
    text.length
  ) {
    return text.length;
  }


  /*
   * Preference order:
   * 1. Paragraph break
   * 2. Line break
   * 3. Sentence ending
   * 4. Space
   * 5. Hard cut
   */

  const searchArea =
    text.slice(
      minimumEnd,
      maxEnd
    );


  const paragraph =
    searchArea.lastIndexOf(
      "\n\n"
    );


  if (
    paragraph >=
    0
  ) {
    return (
      minimumEnd +
      paragraph +
      2
    );
  }


  const newline =
    searchArea.lastIndexOf(
      "\n"
    );


  if (
    newline >=
    0
  ) {
    return (
      minimumEnd +
      newline +
      1
    );
  }


  const sentenceMatches =
    [
      ". ",
      "! ",
      "? "
    ];


  let bestSentence =
    -1;


  for (
    const marker
    of sentenceMatches
  ) {
    const index =
      searchArea.lastIndexOf(
        marker
      );


    if (
      index >
      bestSentence
    ) {
      bestSentence =
        index +
        marker.length;
    }
  }


  if (
    bestSentence >
    0
  ) {
    return (
      minimumEnd +
      bestSentence
    );
  }


  const space =
    searchArea.lastIndexOf(
      " "
    );


  if (
    space >=
    0
  ) {
    return (
      minimumEnd +
      space +
      1
    );
  }


  return maxEnd;
}


/* =====================================================
   CHUNK GENERATION
   ===================================================== */

function createChunks(
  text,
  {
    chunkCharacters,
    overlapCharacters,
    minimumChunkCharacters,
    maxChunks
  }
) {
  const chunks =
    [];


  const fullText =
    cleanString(
      text
    );


  if (!fullText) {
    return chunks;
  }


  const chunkSize =
    clamp(
      chunkCharacters,
      1_000,
      50_000
    );


  const overlap =
    clamp(
      overlapCharacters,
      0,
      Math.floor(
        chunkSize /
        2
      )
    );


  const minimumSize =
    clamp(
      minimumChunkCharacters,
      1,
      chunkSize
    );


  let start =
    0;


  let index =
    0;


  while (
    start <
      fullText.length &&
    chunks.length <
      maxChunks
  ) {
    const remaining =
      fullText.length -
      start;


    if (
      remaining <=
      chunkSize
    ) {
      const finalText =
        fullText
          .slice(
            start
          )
          .trim();


      if (finalText) {
        chunks.push({
          id:
            `chunk_${index + 1}`,

          index,

          start,

          end:
            fullText.length,

          characters:
            finalText.length,

          text:
            finalText
        });
      }


      break;
    }


    const desiredEnd =
      start +
      chunkSize;


    const minimumEnd =
      Math.min(
        desiredEnd,
        start +
          Math.floor(
            chunkSize *
            0.65
          )
      );


    let end =
      findBestSplit(
        fullText,
        start,
        desiredEnd,
        minimumEnd
      );


    if (
      end <=
      start
    ) {
      end =
        Math.min(
          start +
            chunkSize,
          fullText.length
        );
    }


    let chunkText =
      fullText
        .slice(
          start,
          end
        )
        .trim();


    /*
     * Avoid tiny chunks except at end.
     */

    if (
      chunkText.length <
        minimumSize &&
      end <
        fullText.length
    ) {
      end =
        Math.min(
          start +
            chunkSize,
          fullText.length
        );


      chunkText =
        fullText
          .slice(
            start,
            end
          )
          .trim();
    }


    if (
      chunkText
    ) {
      chunks.push({
        id:
          `chunk_${index + 1}`,

        index,

        start,

        end,

        characters:
          chunkText.length,

        text:
          chunkText
      });


      index +=
        1;
    }


    if (
      end >=
      fullText.length
    ) {
      break;
    }


    let nextStart =
      end -
      overlap;


    if (
      nextStart <=
      start
    ) {
      nextStart =
        end;
    }


    /*
     * Try not to start in middle of a word.
     */

    if (
      nextStart >
        0 &&
      nextStart <
        fullText.length &&
      !/\s/.test(
        fullText[
          nextStart -
          1
        ]
      ) &&
      !/\s/.test(
        fullText[
          nextStart
        ]
      )
    ) {
      const nextSpace =
        fullText.indexOf(
          " ",
          nextStart
        );


      if (
        nextSpace >
          nextStart &&
        nextSpace -
          nextStart <
          100
      ) {
        nextStart =
          nextSpace +
          1;
      }
    }


    start =
      nextStart;
  }


  return chunks;
}


/* =====================================================
   TEXT STATS
   ===================================================== */

function countWords(
  text
) {
  const cleaned =
    cleanString(
      text
    )
      .trim();


  if (!cleaned) {
    return 0;
  }


  return cleaned
    .split(
      /\s+/
    )
    .filter(
      Boolean
    )
    .length;
}


function countLines(
  text
) {
  if (!text) {
    return 0;
  }


  return cleanString(
    text
  )
    .split(
      "\n"
    )
    .length;
}


/* =====================================================
   MAIN NORMALIZER
   ===================================================== */

export function normalizeAttachment({
  text =
    "",
  file =
    {},
  extraction =
    {},
  options =
    {}
} = {}) {
  const normalizedFile =
    normalizeFile(
      file
    );


  const normalizedExtraction =
    normalizeExtraction(
      extraction
    );


  const maxDocumentCharacters =
    toFiniteInteger(
      options
        .maxDocumentCharacters,
      DEFAULTS
        .maxDocumentCharacters
    );


  const chunkCharacters =
    toFiniteInteger(
      options
        .chunkCharacters,
      DEFAULTS
        .chunkCharacters
    );


  const overlapCharacters =
    toFiniteInteger(
      options
        .chunkOverlapCharacters,
      DEFAULTS
        .chunkOverlapCharacters
    );


  const minimumChunkCharacters =
    toFiniteInteger(
      options
        .minimumChunkCharacters,
      DEFAULTS
        .minimumChunkCharacters
    );


  const maxChunks =
    toFiniteInteger(
      options
        .maxChunks,
      DEFAULTS
        .maxChunks
    );


  /* ===================================================
     CLEAN TEXT
     =================================================== */

  const cleanedText =
    normalizeText(
      text
    );


  /* ===================================================
     LIMIT DOCUMENT
     =================================================== */

  const limited =
    limitDocumentText(
      cleanedText,
      maxDocumentCharacters
    );


  /* ===================================================
     CHUNKS
     =================================================== */

  const chunks =
    createChunks(
      limited.text,
      {
        chunkCharacters,

        overlapCharacters,

        minimumChunkCharacters,

        maxChunks
      }
    );


  /* ===================================================
     WARNINGS
     =================================================== */

  const generatedWarnings =
    [];


  if (
    limited.truncated
  ) {
    generatedWarnings.push(
      `Document text was truncated from ${limited.originalCharacters.toLocaleString()} to ${maxDocumentCharacters.toLocaleString()} characters.`
    );
  }


  if (
    chunks.length >=
      maxChunks &&
    limited.text.length >
      0
  ) {
    const lastChunk =
      chunks[
        chunks.length -
        1
      ];


    if (
      lastChunk?.end <
      limited.text.length
    ) {
      generatedWarnings.push(
        `Chunk generation stopped after ${maxChunks} chunks.`
      );
    }
  }


  if (
    !limited.text
  ) {
    generatedWarnings.push(
      "No readable text was extracted from this attachment."
    );
  }


  const warnings =
    normalizeWarnings(
      normalizedExtraction
        .warnings,

      generatedWarnings
    );


  /* ===================================================
     DOCUMENT
     =================================================== */

  const document = {
    id:
      normalizedFile.id,

    uploadId:
      normalizedFile.uploadId,

    provider:
      normalizedFile.provider,

    bucket:
      normalizedFile.bucket,

    path:
      normalizedFile.path,

    name:
      normalizedFile.name,

    mime:
      normalizedFile.mime,

    mimeType:
      normalizedFile.mimeType,

    extension:
      normalizedFile.extension,

    category:
      normalizedFile.category,

    size:
      normalizedFile.size,

    parser:
      normalizedExtraction
        .parser,

    kind:
      normalizedExtraction
        .kind,

    text:
      limited.text,

    truncated:
      limited.truncated,

    metadata:
      normalizedExtraction
        .metadata,

    warnings
  };


  /* ===================================================
     CHUNK METADATA
     =================================================== */

  const documentChunks =
    chunks.map(
      (
        chunk,
        index
      ) => ({
        ...chunk,

        documentId:
          normalizedFile.id,

        uploadId:
          normalizedFile
            .uploadId,

        fileName:
          normalizedFile
            .name,

        category:
          normalizedFile
            .category,

        mime:
          normalizedFile
            .mime,

        ordinal:
          index +
          1
      })
    );


  /* ===================================================
     STATS
     =================================================== */

  const stats = {
    characters:
      limited.text.length,

    originalCharacters:
      limited
        .originalCharacters,

    words:
      countWords(
        limited.text
      ),

    lines:
      countLines(
        limited.text
      ),

    chunks:
      documentChunks
        .length,

    truncated:
      limited
        .truncated,

    sourceBytes:
      normalizedFile
        .size,

    parser:
      normalizedExtraction
        .parser,

    category:
      normalizedFile
        .category
  };


  /* ===================================================
     FINAL CONTRACT
     =================================================== */

  return {
    document,

    chunks:
      documentChunks,

    stats,

    warnings
  };
}


/* =====================================================
   RETRIEVAL HELPERS
   ===================================================== */

/*
 * Lightweight lexical score.
 * No embeddings are used here.
 */

function tokenize(
  value
) {
  return cleanString(
    value
  )
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}_-]+/gu,
      " "
    )
    .split(
      /\s+/
    )
    .map(
      item =>
        item.trim()
    )
    .filter(
      item =>
        item.length >
        1
    );
}


export function scoreAttachmentChunk(
  chunk,
  query
) {
  const queryTokens =
    tokenize(
      query
    );


  if (
    queryTokens.length ===
    0
  ) {
    return 0;
  }


  const text =
    cleanString(
      chunk?.text
    )
      .toLowerCase();


  if (!text) {
    return 0;
  }


  let score =
    0;


  for (
    const token
    of queryTokens
  ) {
    const escaped =
      token.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );


    const matches =
      text.match(
        new RegExp(
          `\\b${escaped}\\b`,
          "g"
        )
      );


    if (
      matches?.length
    ) {
      score +=
        Math.min(
          matches.length,
          8
        );
    }
  }


  /*
   * Small exact-query boost.
   */

  const normalizedQuery =
    queryTokens.join(
      " "
    );


  if (
    normalizedQuery &&
    text.includes(
      normalizedQuery
    )
  ) {
    score +=
      5;
  }


  return score;
}


/* =====================================================
   SELECT RELEVANT CHUNKS
   ===================================================== */

export function selectRelevantChunks(
  chunks,
  query,
  {
    limit =
      8,

    minimumScore =
      1,

    fallbackToFirst =
      true
  } = {}
) {
  const list =
    Array.isArray(
      chunks
    )
      ? chunks
      : [];


  if (
    list.length ===
    0
  ) {
    return [];
  }


  const ranked =
    list
      .map(
        chunk => ({
          chunk,

          score:
            scoreAttachmentChunk(
              chunk,
              query
            )
        })
      )
      .filter(
        item =>
          item.score >=
          minimumScore
      )
      .sort(
        (
          a,
          b
        ) => {
          if (
            b.score !==
            a.score
          ) {
            return (
              b.score -
              a.score
            );
          }


          return (
            Number(
              a.chunk
                ?.index
            ) -
            Number(
              b.chunk
                ?.index
            )
          );
        }
      )
      .slice(
        0,
        Math.max(
          1,
          Number(
            limit
          ) ||
          8
        )
      )
      .map(
        item =>
          item.chunk
      );


  if (
    ranked.length >
    0
  ) {
    /*
     * Restore natural document order
     * after relevance selection.
     */

    return ranked.sort(
      (
        a,
        b
      ) =>
        Number(
          a?.index
        ) -
        Number(
          b?.index
        )
    );
  }


  if (
    fallbackToFirst
  ) {
    return list.slice(
      0,
      Math.max(
        1,
        Number(
          limit
        ) ||
        8
      )
    );
  }


  return [];
}


/* =====================================================
   BUILD CONTEXT STRING
   ===================================================== */

export function buildAttachmentContext(
  attachment,
  {
    query =
      "",

    maxCharacters =
      90_000,

    maxChunks =
      8
  } = {}
) {
  if (
    !attachment ||
    typeof attachment !==
      "object"
  ) {
    return "";
  }


  const name =
    cleanString(
      attachment
        ?.document
        ?.name ||
      attachment
        ?.name ||
      "Attachment"
    );


  const chunks =
    Array.isArray(
      attachment
        ?.chunks
    )
      ? attachment.chunks
      : [];


  const selected =
    selectRelevantChunks(
      chunks,
      query,
      {
        limit:
          maxChunks,

        minimumScore:
          query
            ? 1
            : 0,

        fallbackToFirst:
          true
      }
    );


  let body =
    "";


  if (
    selected.length >
    0
  ) {
    body =
      selected
        .map(
          chunk =>
            cleanString(
              chunk?.text
            )
        )
        .filter(
          Boolean
        )
        .join(
          "\n\n"
        );

  } else {
    body =
      cleanString(
        attachment
          ?.document
          ?.text
      );
  }


  const header =
    `ATTACHMENT: ${name}`;


  const output =
    `${header}\n\n${body}`;


  return output.slice(
    0,
    Math.max(
      1,
      Number(
        maxCharacters
      ) ||
      90_000
    )
  );
}


export default normalizeAttachment;
