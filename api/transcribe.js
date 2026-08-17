import { GoogleGenAI } from "@google/genai";

export const config = {
  api: {
    bodyParser: false
  }
};

const MODEL = "gemini-3.5-flash";
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_CONTEXT_CHARS = 5000;

function sendJson(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(body));
}

function normalizeContext(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, MAX_CONTEXT_CHARS);
}

async function parseMultipart(req) {
  const contentType = req.headers["content-type"];

  if (!contentType?.includes("multipart/form-data")) {
    throw new Error("INVALID_CONTENT_TYPE");
  }

  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;

    if (total > MAX_AUDIO_BYTES + 1024 * 1024) {
      throw new Error("AUDIO_TOO_LARGE");
    }

    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks);

  const request = new Request(
    "http://localhost/api/transcribe",
    {
      method: "POST",
      headers: {
        "content-type": contentType
      },
      body: rawBody
    }
  );

  return request.formData();
}

function buildPrompt(context) {
  return `
Transcribe the supplied audio accurately.

Rules:
- Return only the transcript.
- Do not answer the speaker.
- Do not summarize.
- Do not translate.
- Preserve the language actually spoken.
- Preserve mixed-language speech naturally.
- Add normal punctuation and capitalization.
- Preserve the speaker's original meaning.
- Correct only obvious recognition mistakes.
- Do not invent information.
- Do not rewrite the speaker's ideas.

${
  context
    ? `
Recent conversation context:

${context}

Use this context only to resolve genuinely ambiguous words.
Do not copy context into the transcript unless it was actually spoken.
`
    : ""
}

Return only the final transcript.
`.trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return sendJson(res, 405, {
      error: "Method not allowed."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return sendJson(res, 500, {
      error: "GEMINI_API_KEY is missing."
    });
  }

  try {
    const formData = await parseMultipart(req);

    const audioFile = formData.get("audio");

    const context = normalizeContext(
      formData.get("context")
    );

    if (
      !audioFile ||
      typeof audioFile.arrayBuffer !== "function"
    ) {
      return sendJson(res, 400, {
        error: "Audio file is required."
      });
    }

    const audioBuffer = Buffer.from(
      await audioFile.arrayBuffer()
    );

    if (!audioBuffer.length) {
      return sendJson(res, 400, {
        error: "Audio is empty."
      });
    }

    if (audioBuffer.length > MAX_AUDIO_BYTES) {
      return sendJson(res, 413, {
        error: "Recording is too large."
      });
    }

    console.log(
      "[NEYO Transcribe] WAV received",
      {
        mime: audioFile.type,
        bytes: audioBuffer.length,
        contextChars: context.length
      }
    );

    const ai = new GoogleGenAI({
      apiKey
    });

    const response =
      await ai.models.generateContent({
        model: MODEL,

        contents: [
          {
            role: "user",

            parts: [
              {
                text: buildPrompt(context)
              },

              {
                inlineData: {
                  mimeType: "audio/wav",
                  data: audioBuffer.toString("base64")
                }
              }
            ]
          }
        ]
      });

    const transcript =
      String(
        response.text || ""
      ).trim();

    if (!transcript) {
      console.error(
        "[NEYO Transcribe] empty response:",
        response
      );

      return sendJson(res, 422, {
        error: "No transcript returned."
      });
    }

    console.log(
      "[NEYO Transcribe] success",
      {
        chars: transcript.length
      }
    );

    return sendJson(res, 200, {
      transcript
    });

  } catch (error) {
    console.error(
      "[NEYO Transcribe] fatal:",
      error
    );

    if (
      error?.message ===
      "INVALID_CONTENT_TYPE"
    ) {
      return sendJson(res, 400, {
        error: "Expected multipart audio upload."
      });
    }

    if (
      error?.message ===
      "AUDIO_TOO_LARGE"
    ) {
      return sendJson(res, 413, {
        error: "Recording is too large."
      });
    }

    return sendJson(res, 500, {
      error:
        error?.message ||
        "Voice transcription failed."
    });
  }
}
