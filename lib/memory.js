/* =========================================================
   NEYO • MEMORY BOX (one store for chunks + facts)
   ---------------------------------------------------------
   The model manages the box with small markers in its answer:

   AUTO_COPY (chunk)  <<AUTO_COPY {"key":"supabase_login_code"}>>
                      ...code or text the user sees...
                      <<END>>
                      -> markers are hidden, the text between them
                         is saved under that key.
   AUTO_COPY (fact)   <<AUTO_COPY {"key":"user_name","value":"Samuel"}>>
                      -> hidden line, saved. "value":null forgets.
   AUTO_PASTE         <<AUTO_PASTE {"key":"supabase_login_code"}>>
                      -> the server puts the saved text there, so the
                         model never re-types it (output tokens saved).

   Before each answer the model gets MEMORY (the list of keys:
   short facts in full, chunks only as a size hint) and OPEN (full
   text of the 1-2 chunks that match the question best).
   Choosing what to show costs 0 tokens (plain word match).

   Backups when the model forgets its markers:
   - fenced code in the reply is saved automatically,
   - a fact the user states is pulled out by one tiny cheap call.

   Table: neyo_memory (user_id, key, value, updated_at).
   Env: NEYO_MEMORY=off turns everything off.
   ========================================================= */

const TABLE = "neyo_memory";
const MAX_COPIES_PER_ANSWER = 4;
const MAX_ROWS_PER_USER = 200;
const MAX_VALUE_CHARS = 8000;
const FACT_CHARS = 120;
const INDEX_CHARS = 1400;
const INDEX_KEYS = 40;
const OPEN_CHARS = 3000;

const OPENERS = ["<<AUTO_COPY", "<<AUTO_PASTE", "<<END>>"];

export const MEMORY_RULE =
    'Memory box: MEMORY {json} lists saved items (short facts in full, chunks as "(chunk, N lines)"); OPEN shows the full text of the most relevant chunks. Use them quietly. ' +
    'To save a reusable part of your answer (code, setup steps, a decided design), put <<AUTO_COPY {"key":"short_snake_key"}>> on its own line before it and <<END>> on its own line after it (outside the code fence, around the whole fence). ' +
    'To save a lasting fact the user tells you: <<AUTO_COPY {"key":"user_name","value":"Samuel"}>> on its own line (keys about the user start with user_; "value":null forgets). ' +
    'To show a saved chunk unchanged, write only <<AUTO_PASTE {"key":"..."}>> on its own line instead of rewriting it; the server inserts the full text. If you change a chunk, write it fully and copy it again with the same key. ' +
    'Never save passwords, keys or card numbers. Never mention these markers.';

export function memoryEnabled() {
    return String(process.env.NEYO_MEMORY || "").toLowerCase() !== "off";
}

function cleanKey(key) {
    return String(key || "")
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 48);
}

function parseTag(tag) {
    // tag looks like: AUTO_COPY {"key":"x"} | AUTO_PASTE {...} | END
    const name = tag.startsWith("AUTO_COPY") ? "copy" : tag.startsWith("AUTO_PASTE") ? "paste" : "end";
    if (name === "end") {
        return { name };
    }
    const json = tag.slice(tag.indexOf("{"), tag.lastIndexOf("}") + 1);
    try {
        const data = JSON.parse(json);
        return {
            name,
            key: cleanKey(data.key),
            hasValue: Object.prototype.hasOwnProperty.call(data, "value"),
            value: data.value === null || data.value === undefined ? null : String(data.value)
        };
    } catch {
        return { name, key: "" };
    }
}

/* ---------- the marker filter (live stream + final text) ----------
   push() returns what the user should see; result() gives the full
   visible text and the copies to save. */

export function createMemoryFilter(box = new Map()) {

    let pending = "";
    let visible = "";
    let open = null;            // chunk being copied
    let eatNewline = false;     // marker sat on its own line
    const copies = [];
    const pastes = [];

    function emit(text) {
        if (!text) return "";
        visible += text;
        if (open) open.text += text;
        return text;
    }

    function handle(tag) {
        const info = parseTag(tag);
        if (info.name === "paste") {
            const saved = info.key ? box.get(info.key) : undefined;
            if (saved) {
                pastes.push(info.key);
                return emit(saved.replace(/\s+$/, "") + "\n");
            }
            if (info.key) console.warn("[MEMORY] paste key not found", info.key);
            return "";
        }
        if (info.name === "copy") {
            if (info.hasValue) {
                if (info.key && copies.length < MAX_COPIES_PER_ANSWER) {
                    copies.push({ key: info.key, value: info.value === null ? null : info.value.slice(0, FACT_CHARS * 3) });
                }
                return "";
            }
            closeOpen();
            if (info.key) open = { key: info.key, text: "" };
            return "";
        }
        closeOpen();            // <<END>>
        return "";
    }

    function closeOpen() {
        if (open && open.text.trim() && copies.length < MAX_COPIES_PER_ANSWER) {
            copies.push({ key: open.key, value: open.text.trim().slice(0, MAX_VALUE_CHARS), chunk: true });
        }
        open = null;
    }

    function push(chunk) {
        pending += chunk;
        let out = "";
        for (;;) {
            if (eatNewline && pending) {
                if (/^[ \t]*\n/.test(pending)) {
                    pending = pending.replace(/^[ \t]*\n/, "");
                    eatNewline = false;
                } else if (/^[ \t]*$/.test(pending)) {
                    return out;
                } else {
                    eatNewline = false;
                }
            }
            const start = pending.indexOf("<<");
            if (start === -1) {
                if (pending.endsWith("<")) {
                    out += emit(pending.slice(0, -1));
                    pending = "<";
                } else {
                    out += emit(pending);
                    pending = "";
                }
                return out;
            }
            out += emit(pending.slice(0, start));
            pending = pending.slice(start);

            const matches = OPENERS.filter(opener =>
                pending.length >= opener.length ? pending.startsWith(opener) : opener.startsWith(pending)
            );
            if (!matches.length) {
                out += emit("<<");          // ordinary "<<" (C++, heredoc)
                pending = pending.slice(2);
                continue;
            }
            if (matches.every(opener => pending.length < opener.length)) {
                return out;                 // need more text
            }
            const end = pending.indexOf(">>", 2);
            if (end === -1) {
                if (pending.length > 600) {
                    out += emit(pending);
                    pending = "";
                }
                return out;
            }
            const tag = pending.slice(2, end).trim();
            pending = pending.slice(end + 2);
            // a marker on its own line leaves no empty line behind
            eatNewline = /(^|\n)[ \t]*$/.test(visible);
            out += handle(tag);
        }
    }

    return {
        push,
        flush() {
            const rest = OPENERS.some(opener => opener.startsWith(pending) || pending.startsWith(opener)) ? "" : pending;
            pending = "";
            const out = emit(rest);
            closeOpen();
            return out;
        },
        result() {
            return { text: visible.replace(/\s+$/, ""), copies, pastes };
        }
    };
}

/* whole text at once (non-stream path) */
export function applyMemoryMarkers(text, box) {
    const filter = createMemoryFilter(box);
    filter.push(String(text || ""));
    filter.flush();
    return filter.result();
}

/* ---------- storage ---------- */

let tableMissing = false;

function noteError(error) {
    if (error && /relation|does not exist|schema cache/i.test(error.message || "")) {
        if (!tableMissing) console.warn("[MEMORY] table missing: run supabase/neyo_setup.sql once");
        tableMissing = true;
    }
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise(resolve => setTimeout(() => resolve({ data: null, error: { message: "timeout" } }), ms))
    ]);
}

const SECRET_KEY = /password|passwd|api_?key|secret|token|cvv|card_?number/i;
const SECRET_FACT = /\[REDACTED_|password|passwd|api[_ -]?key|\bcvv\b|\b\d{13,19}\b/i;

export async function saveMemories(supabase, { userId, copies, restore = text => text }) {

    if (!memoryEnabled() || tableMissing || !supabase || !userId || !copies?.length) {
        return;
    }

    const saved = [];

    for (const copy of copies) {
        if (!copy.key || SECRET_KEY.test(copy.key)) continue;

        if (copy.value === null) {
            const { error } = await withTimeout(supabase.from(TABLE).delete().eq("user_id", userId).eq("key", copy.key), 1500);
            noteError(error);
            saved.push(`${copy.key}(forget)`);
            continue;
        }

        const value = restore(copy.value).trim();
        if (!value || value.includes("[REDACTED_")) continue;
        if (!copy.chunk && SECRET_FACT.test(value)) continue;

        const { error } = await withTimeout(
            supabase.from(TABLE).upsert(
                { user_id: userId, key: copy.key, value: value.slice(0, MAX_VALUE_CHARS), updated_at: new Date().toISOString() },
                { onConflict: "user_id,key" }
            ),
            1500
        );
        noteError(error);
        if (error) {
            console.warn("[MEMORY] save failed", error.message);
        } else {
            saved.push(copy.key);
        }
    }

    if (saved.length) console.log("[MEMORY] auto_copy", saved.join(","));

    // keep only the newest rows
    const { data } = await withTimeout(
        supabase.from(TABLE).select("key").eq("user_id", userId).order("updated_at", { ascending: false }).range(MAX_ROWS_PER_USER, MAX_ROWS_PER_USER + 50),
        1500
    );
    if (Array.isArray(data) && data.length) {
        await withTimeout(supabase.from(TABLE).delete().eq("user_id", userId).in("key", data.map(row => row.key)), 1500);
    }
}

function words(text) {
    return new Set(
        String(text || "")
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, " ")
            .split(" ")
            .filter(word => word.length >= 3)
    );
}

/* ---------- AUTO_PASTE side: load the box for this answer ----------
   returns { box: Map(key -> real text), prompt: text for the model } */

export async function loadMemoryBox(supabase, { userId, question, scrub = text => text }) {

    const empty = { box: new Map(), prompt: "" };

    if (!memoryEnabled() || tableMissing || !supabase || !userId) return empty;

    const { data, error } = await withTimeout(
        supabase.from(TABLE).select("key, value, updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(MAX_ROWS_PER_USER),
        1200
    );

    if (error || !Array.isArray(data) || !data.length) {
        noteError(error);
        return empty;
    }

    const box = new Map(data.map(row => [row.key, row.value]));
    const asked = words(question);

    const ranked = data.map((row, index) => {
        const have = words(`${row.key.replace(/_/g, " ")} ${row.value.slice(0, 2000)}`);
        let hits = 0;
        asked.forEach(word => { if (have.has(word)) hits += 1; });
        const isFact = row.value.length <= FACT_CHARS && !row.value.includes("\n");
        const profile = row.key.startsWith("user_");
        return { row, hits, isFact, score: (profile ? 100 : 0) + hits * 3 - index * 0.05 };
    }).sort((a, b) => b.score - a.score);

    // MEMORY index: facts in full, chunks as a size hint
    const index = {};
    let size = 0;
    for (const item of ranked) {
        if (Object.keys(index).length >= INDEX_KEYS) break;
        const shown = item.isFact
            ? scrub(item.row.value)
            : `(chunk, ${item.row.value.split("\n").length} lines)`;
        const add = item.row.key.length + shown.length + 6;
        if (size + add > INDEX_CHARS) continue;
        index[item.row.key] = shown;
        size += add;
    }

    // OPEN: full text of the best matching chunks
    const opened = [];
    let openSize = 0;
    for (const item of ranked) {
        if (item.isFact || item.hits < 2 || opened.length >= 2) continue;
        const text = scrub(item.row.value);
        if (openSize + text.length > OPEN_CHARS) continue;
        opened.push(`[${item.row.key}]\n${text}`);
        openSize += text.length;
    }

    if (!Object.keys(index).length) return { box, prompt: "" };

    console.log("[MEMORY] box", Object.keys(index).length, "keys,", opened.length, "open");

    return {
        box,
        prompt:
            `\n\nMEMORY ${JSON.stringify(index)}` +
            (opened.length ? `\n\nOPEN\n${opened.join("\n\n")}` : "")
    };
}

/* ---------- backups when the model forgot its markers ---------- */

const STOP = new Set("the and for with that this what how kya kaise karo karna mein main hai hain aur bhi mujhe mera meri please bata batao chahiye code".split(" "));

/* fenced code in the reply -> saved chunks (max 2, 6+ lines) */
export function autoCodeCopies(reply, question) {
    const topicWords = [...words(question)].filter(word => !STOP.has(word) && /^[a-z0-9]+$/.test(word));
    const copies = [];
    const fence = /```([\w+-]*)[^\n]*\n[\s\S]*?```/g;
    let match;
    while ((match = fence.exec(String(reply || ""))) && copies.length < 2) {
        if (match[0].split("\n").length < 8) continue;
        const lang = cleanKey(match[1] || "code") || "code";
        const topic = topicWords.filter(word => word !== lang).slice(0, 4).join("_");
        const key = cleanKey(`${lang}_${topic || "snippet"}${copies.length ? `_${copies.length + 1}` : ""}`);
        copies.push({ key, value: match[0].slice(0, MAX_VALUE_CHARS), chunk: true });
    }
    return copies;
}

const FACT_CUE =
    /\b(mera|meri|mere|mujhe|muje|hamara|hamari|hamare|apna\s+naam|my|i\s+am|i'm|im|i\s+use|i\s+like|i\s+love|i\s+work|i\s+live|call\s+me|naam|name|(main|mai|mein)\s.{0,60}\b(hun|hoon|hu|tha|thi))\b/i;

const QUESTION_CUE =
    /\?\s*$|\b(kya|kia|kaun|kon|kaise|kese|kab|kahan|kidhar|what|who|how|when|where|which)\b/i;

export function looksLikeFact(text) {
    const clean = String(text || "").trim();
    if (clean.length < 6 || clean.length > 1500 || !FACT_CUE.test(clean)) return false;
    return !(QUESTION_CUE.test(clean) && clean.length < 60);
}

export async function extractFactsWithModel({ apiKey, model, userText }) {

    if (!apiKey || !model) return [];

    const prompt =
        'List lasting facts or preferences the user states about themselves or their work in this message (name, city, job, project, tech stack, goals, likes, language). Skip secrets, passwords, keys, card numbers and anything temporary. Reply only a JSON array like [{"key":"user_name","value":"Ali"}]; keys short snake_case, facts about the user start with user_. Reply [] if none.\n\nMessage:\n' +
        String(userText).slice(0, 1500);

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 200, temperature: 0 }
                })
            }
        );
        clearTimeout(timer);
        const data = await response.json().catch(() => ({}));
        const text = (data?.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("");
        const list = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1) || "[]");
        if (!Array.isArray(list)) return [];
        const copies = list
            .filter(item => item && item.key && item.value && !SECRET_KEY.test(item.key))
            .slice(0, MAX_COPIES_PER_ANSWER)
            .map(item => ({ key: cleanKey(item.key), value: String(item.value).slice(0, FACT_CHARS * 3) }))
            .filter(item => item.key);
        if (copies.length) console.log("[MEMORY] backup extract", copies.length);
        return copies;
    } catch (error) {
        console.warn("[MEMORY] backup extract failed", error?.message || error);
        return [];
    }
}
