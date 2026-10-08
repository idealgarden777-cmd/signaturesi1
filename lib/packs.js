/* =========================================================
   NEYO • ANSWER PACKS (chunk store, zero-token retrieval)
   ---------------------------------------------------------
   After every answer: the reply is cut into chunks (each code
   block is its own chunk, text is cut by paragraphs) and saved
   in Supabase table neyo_packs (see supabase/neyo_setup.sql).

   Before the next answer (no AI call, Postgres full-text):
   1. EXACT REPEAT: the same question asked again in ANOTHER
      chat, not time-sensitive, within PACK_MAX_DAYS -> the saved
      chunks are glued back and sent. 0 model tokens.
   2. RELATED: up to 3 matching chunks (usually earlier code)
      are glued into the prompt so the model reuses them instead
      of writing everything again (same names, same style).

   Env:
     NEYO_PACKS=off           turn everything off
     NEYO_PACKS_EXACT=off     keep related chunks, never answer from pack
     NEYO_PACK_MAX_DAYS=30
   If the table does not exist the code just does nothing.
   ========================================================= */

import crypto from "node:crypto";

const TABLE = "neyo_packs";
const MAX_CHUNK = 1200;
const MAX_CHUNKS = 14;
const RELATED_CHARS = 3500;

const STOP = new Set(("the and for with that this from are was were you your have has had not but what when where which who how why can could would should will into about there their them they then than also just only very more most some such like make made does did done mein main hai hain kya kar karo karna kaise kese aur bhi yeh woh wo isko usko mujhe muje mera meri mere apna apni tum aap hum koi kuch sab nahi nahin please plz bata batao chahiye chahta").split(" "));

const TIME_SENSITIVE =
    /\b(latest|today|tonight|tomorrow|yesterday|now|current|recent|news|live|abhi|aaj|aj|kal|filhal|price|rate|rates|qeemat|keemat|dollar|bitcoin|stock|gold|weather|mausam|score|match|result|election|20[2-9]\d)\b/i;

function packsOn() {
    return String(process.env.NEYO_PACKS || "").toLowerCase() !== "off";
}

export function normalizeQuestion(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function hashQuestion(text) {
    return crypto.createHash("sha1").update(normalizeQuestion(text)).digest("hex");
}

function terms(text) {
    const words = normalizeQuestion(text)
        .split(" ")
        .filter(word => word.length >= 3 && !STOP.has(word) && !/^\d+$/.test(word));
    return [...new Set(words)].slice(0, 14);
}

/* Cut a reply so that chunks.join("") === reply (exact glue). */
export function chunkReply(reply) {

    const text = String(reply || "");
    const pieces = text.split(/(```[\s\S]*?```)/g).filter(piece => piece !== "");
    const chunks = [];

    for (const piece of pieces) {

        if (piece.startsWith("```")) {
            const lang = (piece.match(/^```([\w+#.-]*)/) || [])[1] || "";
            chunks.push({ kind: "code", lang: lang.toLowerCase(), content: piece });
            continue;
        }

        let current = "";
        for (const part of piece.split(/(\n{2,})/)) {
            if (current.length + part.length > MAX_CHUNK && current.trim()) {
                chunks.push({ kind: "text", lang: "", content: current });
                current = "";
            }
            current += part;
        }
        if (current) {
            if (!current.trim() && chunks.length) {
                chunks[chunks.length - 1].content += current;
            } else {
                chunks.push({ kind: "text", lang: "", content: current });
            }
        }
    }

    return chunks;
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise(resolve => setTimeout(() => resolve({ data: null, error: { message: "timeout" } }), ms))
    ]);
}

let tableMissing = false;

function noteError(error) {
    if (error && /relation|does not exist|schema cache|function .* does not exist/i.test(error.message || "")) {
        if (!tableMissing) {
            console.warn("[PACKS] table/function missing: run supabase/neyo_setup.sql once");
        }
        tableMissing = true;
    }
}

/* Save one answer as chunks. */
export async function savePack(supabase, { userId, conversationId, question, reply }) {

    if (!packsOn() || tableMissing || !supabase || !userId) {
        return;
    }

    const cleanQuestion = String(question || "").trim();
    if (cleanQuestion.length < 8 || String(reply || "").length < 200) {
        return;
    }

    // Fresh facts (rates, news, weather...) go stale: keep only code from those.
    if (TIME_SENSITIVE.test(cleanQuestion) && !String(reply).includes("```")) {
        return;
    }

    const chunks = chunkReply(reply);
    if (!chunks.length || chunks.length > MAX_CHUNKS) {
        return;
    }

    const questionHash = hashQuestion(cleanQuestion);
    const rows = chunks.map((chunk, index) => ({
        user_id: userId,
        conversation_id: conversationId || null,
        question: cleanQuestion.slice(0, 2000),
        question_hash: questionHash,
        kind: chunk.kind,
        lang: chunk.lang || null,
        chunk_index: index,
        content: chunk.content
    }));

    // One answer per question per chat: replace an older copy.
    if (conversationId) {
        await withTimeout(
            supabase.from(TABLE).delete().eq("user_id", userId).eq("conversation_id", conversationId).eq("question_hash", questionHash),
            1500
        );
    }

    const { error } = await withTimeout(supabase.from(TABLE).insert(rows), 2000);
    if (error) {
        noteError(error);
        console.warn("[PACKS] save failed", error.message);
    } else {
        console.log("[PACKS] saved", rows.length, "chunks");
    }
}

/* Same question asked before in another chat -> glued answer. */
export async function findExactPack(supabase, { userId, conversationId, question }) {

    if (!packsOn() || tableMissing || !supabase || !userId) {
        return null;
    }
    if (String(process.env.NEYO_PACKS_EXACT || "").toLowerCase() === "off") {
        return null;
    }
    if (normalizeQuestion(question).length < 25) {
        return null;
    }

    const days = Number(process.env.NEYO_PACK_MAX_DAYS) || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const { data, error } = await withTimeout(
        supabase
            .from(TABLE)
            .select("conversation_id, chunk_index, content, created_at")
            .eq("user_id", userId)
            .eq("question_hash", hashQuestion(question))
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .limit(MAX_CHUNKS * 2),
        1500
    );

    if (error || !data?.length) {
        noteError(error);
        return null;
    }

    const source = data[0].conversation_id;
    if (conversationId && source === conversationId) {
        return null;    // same chat: the user wants a fresh answer
    }

    const parts = data
        .filter(row => row.conversation_id === source)
        .sort((a, b) => a.chunk_index - b.chunk_index);

    // must be complete: 0..n-1 without gaps
    if (parts.some((row, index) => row.chunk_index !== index)) {
        return null;
    }

    return parts.map(row => row.content).join("");
}

/* Earlier chunks related to this question (code first). */
export async function findRelatedChunks(supabase, { userId, question }) {

    if (!packsOn() || tableMissing || !supabase || !userId) {
        return [];
    }

    const wanted = terms(question);
    if (wanted.length < 2) {
        return [];
    }

    const { data, error } = await withTimeout(
        supabase.rpc("neyo_pack_search", { p_user: userId, p_query: wanted.join(" | "), p_limit: 8 }),
        1500
    );

    if (error || !Array.isArray(data)) {
        noteError(error);
        return [];
    }

    // Keep only strong matches: most of the question's words appear.
    const picked = [];
    let total = 0;

    const scored = data
        .map(row => {
            const hay = normalizeQuestion(`${row.question} ${row.content}`);
            const hits = wanted.filter(word => hay.includes(word)).length;
            return { ...row, overlap: hits / wanted.length };
        })
        .filter(row => row.overlap >= 0.5 && (row.kind === "code" || row.content.trim().length >= 80 && row.content.length <= 900))
        .sort((a, b) => (b.kind === "code") - (a.kind === "code") || b.overlap - a.overlap);

    for (const row of scored) {
        if (picked.length >= 3 || total + row.content.length > RELATED_CHARS) {
            continue;
        }
        picked.push(row);
        total += row.content.length;
    }

    return picked;
}

export function relatedChunksPrompt(chunks) {
    if (!chunks.length) {
        return "";
    }
    return `\n\n=== PACK: pieces of your own earlier answers to this user ===\n` +
        chunks.map((chunk, index) => `[piece ${index + 1}, earlier question: "${String(chunk.question).slice(0, 160)}"]\n${chunk.content}`).join("\n\n") +
        `\n=== END PACK ===\nIf a piece fits this question, reuse it (keep the same names and style, change only what is needed) instead of writing it again from zero. Ignore pieces that do not fit. Do not mention the pack.`;
}
