const DEFAULTS = Object.freeze({
  maxDocumentCharacters: 1_500_000,
  chunkCharacters: 8_000,
  chunkOverlapCharacters: 800,
  maxChunks: 250
});


const clean = (value, max = Infinity) =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);


const positive = (value, fallback) => {
  const number = Number(value);

  return Number.isFinite(number) &&
    number > 0
    ? Math.floor(number)
    : fallback;
};


const unique = values =>
  [
    ...new Set(
      (values || [])
        .filter(Boolean)
        .map(String)
    )
  ];


/* =====================================================
   FILE
   ===================================================== */

function normalizeFile(file = {}) {
  const mime =
    clean(
      file.mime ||
      file.mimeType ||
      file.type ||
      "application/octet-stream",
      180
    ).toLowerCase();

  return {
    id:
      clean(file.id, 128) ||
      null,

    uploadId:
      clean(
        file.uploadId ||
        file.id,
        128
      ) || null,

    provider:
      clean(
        file.provider ||
        "supabase",
        40
      ),

    bucket:
      clean(file.bucket, 100),

    path:
      clean(file.path, 1024),

    name:
      clean(
        file.name ||
        "Attachment",
        220
      ),

    mime,
    mimeType: mime,

    extension:
      clean(file.extension, 24)
        .replace(/^\./, "")
        .toLowerCase(),

    category:
      clean(
        file.category ||
        "unknown",
        32
      ).toLowerCase(),

    size:
      Math.max(
        0,
        Number(file.size) || 0
      )
  };
}


/* =====================================================
   CHUNKS
   ===================================================== */

function makeChunks(
  text,
  size,
  overlap,
  limit
) {
  if (!text) {
    return [];
  }

  const chunks = [];

  for (
    let start = 0, index = 0;
    start < text.length &&
    index < limit;
    index += 1
  ) {
    const end =
      Math.min(
        text.length,
        start + size
      );

    chunks.push({
      id:
        `chunk_${index}`,

      index,
      start,
      end,

      text:
        text.slice(
          start,
          end
        )
    });

    if (
      end >= text.length
    ) {
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


/* =====================================================
   NORMALIZE
   ===================================================== */

export function normalizeAttachment({
  text = "",
  file = {},
  extraction = {},
  options = {}
} = {}) {

  const config = {
    maxDocumentCharacters:
      positive(
        options.maxDocumentCharacters,
        DEFAULTS.maxDocumentCharacters
      ),

    chunkCharacters:
      positive(
        options.chunkCharacters,
        DEFAULTS.chunkCharacters
      ),

    chunkOverlapCharacters:
      positive(
        options.chunkOverlapCharacters,
        DEFAULTS.chunkOverlapCharacters
      ),

    maxChunks:
      positive(
        options.maxChunks,
        DEFAULTS.maxChunks
      )
  };


  config.chunkOverlapCharacters =
    Math.min(
      config.chunkOverlapCharacters,
      Math.max(
        0,
        config.chunkCharacters - 1
      )
    );


  const normalizedFile =
    normalizeFile(file);

  const original =
    clean(text);

  const documentText =
    original.slice(
      0,
      config.maxDocumentCharacters
    );

  const truncated =
    original.length >
    documentText.length;


  const warnings =
    unique([
      ...(
        Array.isArray(
          extraction?.warnings
        )
          ? extraction.warnings
          : []
      ),

      ...(
        truncated
          ? [
              "Extracted text was truncated to the document context limit."
            ]
          : []
      )
    ]);


  const chunks =
    makeChunks(
      documentText,
      config.chunkCharacters,
      config.chunkOverlapCharacters,
      config.maxChunks
    );


  const documentId =
    `doc_${
      normalizedFile.uploadId ||
      normalizedFile.id ||
      "attachment"
    }`;


  return {
    file:
      normalizedFile,

    document: {
      id:
        documentId,

      name:
        normalizedFile.name,

      mime:
        normalizedFile.mime,

      extension:
        normalizedFile.extension,

      category:
        normalizedFile.category,

      size:
        normalizedFile.size,

      text:
        documentText
    },

    text:
      documentText,

    chunks,

    stats: {
      bytes:
        normalizedFile.size,

      characters:
        documentText.length,

      words:
        documentText
          ? documentText
              .split(/\s+/)
              .filter(Boolean)
              .length
          : 0,

      lines:
        documentText
          ? documentText
              .split("\n")
              .length
          : 0,

      chunks:
        chunks.length,

      truncated
    },

    extraction: {
      parser:
        clean(
          extraction?.parser ||
          "unknown",
          80
        ),

      kind:
        clean(
          extraction?.kind ||
          normalizedFile.category ||
          "unknown",
          80
        ),

      metadata:
        extraction?.metadata &&
        typeof extraction.metadata ===
          "object"
          ? extraction.metadata
          : {}
    },

    warnings
  };
}


/* =====================================================
   QUERY TERMS
   ===================================================== */

function queryTerms(query) {
  return [
    ...new Set(
      clean(
        query,
        4000
      )
        .toLowerCase()
        .match(
          /[\p{L}\p{N}_-]{3,}/gu
        ) || []
    )
  ].slice(
    0,
    40
  );
}


/* =====================================================
   RELEVANCE
   ===================================================== */

function scoreChunk(
  chunk,
  terms
) {
  if (!terms.length) {
    return 0;
  }

  const value =
    String(
      chunk?.text ||
      ""
    ).toLowerCase();

  let score = 0;

  for (const term of terms) {
    let position = 0;

    while (
      (
        position =
          value.indexOf(
            term,
            position
          )
      ) !== -1
    ) {
      score += 1;

      position +=
        term.length;

      if (score >= 100) {
        return score;
      }
    }
  }

  return score;
}


/* =====================================================
   CONTEXT
   ===================================================== */

export function buildAttachmentContext(
  normalized,
  {
    query = "",
    maxCharacters = 90_000,
    maxChunks = 12
  } = {}
) {
  if (
    !normalized ||
    typeof normalized !==
      "object"
  ) {
    return "";
  }


  const file =
    normalized.file ||
    normalized.document ||
    {};

  const document =
    normalized.document ||
    {};

  const characterLimit =
    positive(
      maxCharacters,
      90_000
    );

  const chunkLimit =
    positive(
      maxChunks,
      12
    );

  const chunks =
    Array.isArray(
      normalized.chunks
    )
      ? normalized.chunks
      : [];

  const terms =
    queryTerms(query);


  let selected =
    [];


  if (chunks.length) {

    if (terms.length) {
      selected =
        chunks
          .map(chunk => ({
            chunk,

            score:
              scoreChunk(
                chunk,
                terms
              )
          }))
          .sort(
            (a, b) =>
              b.score -
                a.score ||
              a.chunk.index -
                b.chunk.index
          )
          .slice(
            0,
            chunkLimit
          )
          .sort(
            (a, b) =>
              a.chunk.index -
              b.chunk.index
          )
          .map(
            item =>
              item.chunk
          );

    } else {
      selected =
        chunks.slice(
          0,
          chunkLimit
        );
    }
  }


  let body =
    selected
      .map(
        chunk =>
          chunk.text
      )
      .join("\n\n")
      .trim();


  /*
   * Small documents may not have chunks.
   */

  if (!body) {
    body =
      clean(
        document.text ||
        normalized.text ||
        ""
      );
  }


  if (!body) {
    return "";
  }


  const header =
    [
      `ATTACHMENT: ${
        clean(
          file.name ||
          document.name ||
          "Attachment",
          220
        )
      }`,

      `Type: ${
        clean(
          file.category ||
          document.category ||
          "unknown",
          40
        )
      }`,

      normalized
        .extraction
        ?.parser
        ? `Parser: ${
            clean(
              normalized
                .extraction
                .parser,
              80
            )
          }`
        : ""
    ]
      .filter(Boolean)
      .join("\n");


  const remaining =
    Math.max(
      0,
      characterLimit -
      header.length -
      2
    );


  return (
    `${header}\n\n${
      body.slice(
        0,
        remaining
      )
    }`
  )
    .slice(
      0,
      characterLimit
    )
    .trim();
}


export default normalizeAttachment;
