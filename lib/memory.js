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
const MAX_ROWS_DEFAULT = 200;
const MAX_VALUE_CHARS = 8000;
const FACT_CHARS = 120;
const INDEX_CHARS = 1400;
const INDEX_KEYS = 40;
const OPEN_CHARS = 3000;

const OPENERS = ["<<AUTO_COPY", "<<AUTO_PASTE", "<<AUTO_FORGET", "<<WS_ACTION", "<<END>>"];

function maxRows() {
    const n = Number(process.env.NEYO_MEMORY_MAX);
    return n >= 20 && n <= 2000 ? n : MAX_ROWS_DEFAULT;
}

export const MEMORY_RULE =
    'Memory box (you manage it yourself): MEMORY {json} lists saved items (short facts in full, chunks as "(chunk, N lines)"); OPEN shows the full text of the most relevant chunks. Use them quietly. ' +
    'To save a reusable part of your answer (code, setup steps, a decided design), put <<AUTO_COPY {"key":"short_snake_key"}>> on its own line before it and <<END>> on its own line after it (outside the code fence, around the whole fence). ' +
    'To save a lasting fact: <<AUTO_COPY {"key":"user_name","value":"Samuel"}>> on its own line (keys about the user start with user_). ' +
    'To show a saved chunk unchanged, write only <<AUTO_PASTE {"key":"..."}>> on its own line instead of rewriting it; the server inserts the full text. If you change a chunk, write it fully and copy it again with the same key. ' +
    'To forget: <<AUTO_FORGET {"key":"..."}>> (a key, a prefix like "supabase_*", or "all"). Save only what will help later; replace outdated items with the same key and forget ones that are wrong or no longer needed, so the box stays small. ' +
    'When the user says yaad karlo / remember, save it; when they say bhool jao / forget, forget the matching items; then confirm in a few words like a person would. ' +
    'Never save passwords, keys or card numbers. Never show these markers.';

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
    const name = tag.startsWith("AUTO_COPY") ? "copy" : tag.startsWith("AUTO_PASTE") ? "paste" : tag.startsWith("AUTO_FORGET") ? "forget" : "end";
    if (name === "end") {
        return { name };
    }
    const json = tag.slice(tag.indexOf("{"), tag.lastIndexOf("}") + 1);
    try {
        const data = JSON.parse(json);
        const raw = String(data.key || "").trim().toLowerCase();
        return {
            name,
            pattern: raw === "all" || raw === "*" ? "all" : raw.endsWith("*") ? cleanKey(raw.slice(0, -1)) + "*" : "",
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
    const actions = [];         // <<WS_ACTION {...}>> workspace suggestions

    function emit(text) {
        if (!text) return "";
        visible += text;
        if (open) open.text += text;
        return text;
    }

    function handle(tag) {
        if (tag.startsWith("WS_ACTION")) {
            try {
                const data = JSON.parse(tag.slice(tag.indexOf("{"), tag.lastIndexOf("}") + 1));
                if (data && typeof data === "object" && actions.length < 8) actions.push(data);
            } catch {}
            return "";
        }
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
        if (info.name === "forget") {
            const key = info.pattern || info.key;
            if (key && key !== "*") copies.push({ key, value: null, forget: true });
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
                if (pending.length > 2500) {
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
            return { text: visible.replace(/\s+$/, ""), copies, pastes, actions };
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
// Things that must never be stored as a memory: passwords, card numbers
// (with or without spaces), API keys/tokens from common providers.
const SECRET_FACT = new RegExp([
    "\\[REDACTED_",
    "password|passwd|pass code|passcode|\\bpin\\b|\\botp\\b",
    "api[_ -]?key|secret[_ -]?key|access[_ -]?token|private[_ -]?key",
    "\\bcvv\\b|\\bcvc\\b",
    "\\b(?:\\d[ -]?){13,19}\\b",
    "\\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}",
    "\\bAIza[0-9A-Za-z_-]{20,}",
    "\\bgh[pousr]_[A-Za-z0-9]{20,}",
    "\\bxox[abposr]-[A-Za-z0-9-]{10,}",
    "\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\."
].join("|"), "i");

export async function saveMemories(supabase, { userId, copies, restore = text => text }) {

    const result = { saved: [], forgot: [] };

    if (!memoryEnabled() || tableMissing || !supabase || !userId || !copies?.length) {
        return result;
    }

    for (const copy of copies) {
        if (!copy.key) continue;

        if (copy.value === null) {
            let query = supabase.from(TABLE).delete().eq("user_id", userId);
            if (copy.key === "all") {
                // whole box
            } else if (copy.key.endsWith("*")) {
                query = query.like("key", `${copy.key.slice(0, -1)}%`);
            } else {
                query = query.eq("key", copy.key);
            }
            const { error } = await withTimeout(query, 1500);
            noteError(error);
            if (!error) result.forgot.push(copy.key);
            continue;
        }

        if (SECRET_KEY.test(copy.key)) continue;
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
            result.saved.push(copy.key);
        }
    }

    if (result.saved.length) console.log("[MEMORY] auto_copy", result.saved.join(","));
    if (result.forgot.length) console.log("[MEMORY] auto_forget", result.forgot.join(","));

    if (result.saved.length) await trimBox(supabase, userId);

    return result;
}

/* keep the box small: over the limit, drop the oldest unused
   automatic code copies first, then the oldest of the rest */
async function trimBox(supabase, userId) {
    const limit = maxRows();
    const { data } = await withTimeout(
        supabase.from(TABLE).select("key, updated_at").eq("user_id", userId).order("updated_at", { ascending: true }).limit(limit + 100),
        1500
    );
    if (!Array.isArray(data) || data.length <= limit) return;
    const extra = data.length - limit;
    const victims = [
        ...data.filter(row => row.key.startsWith("auto_")),
        ...data.filter(row => !row.key.startsWith("auto_") && !row.key.startsWith("user_")),
        ...data.filter(row => row.key.startsWith("user_"))
    ].slice(0, extra).map(row => row.key);
    if (victims.length) {
        await withTimeout(supabase.from(TABLE).delete().eq("user_id", userId).in("key", victims), 1500);
        console.log("[MEMORY] trimmed", victims.length);
    }
}

/* items the model used stay fresh (they are trimmed last) */
export async function touchMemories(supabase, { userId, keys }) {
    if (!memoryEnabled() || tableMissing || !supabase || !userId || !keys?.length) return;
    await withTimeout(
        supabase.from(TABLE).update({ updated_at: new Date().toISOString() }).eq("user_id", userId).in("key", [...new Set(keys)]),
        1500
    );
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
        supabase.from(TABLE).select("key, value, updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(maxRows()),
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
    const openedKeys = [];
    let openSize = 0;
    for (const item of ranked) {
        if (item.isFact || item.hits < 2 || opened.length >= 2) continue;
        const text = scrub(item.row.value);
        // a chunk the privacy layer had to cut stays closed: the model
        // must AUTO_PASTE it so the user gets the real text back
        if (text.includes("[REDACTED_") || openSize + text.length > OPEN_CHARS) continue;
        opened.push(`[${item.row.key}]\n${text}`);
        openedKeys.push(item.row.key);
        openSize += text.length;
    }

    if (!Object.keys(index).length) return { box, prompt: "", openedKeys };

    console.log("[MEMORY] box", Object.keys(index).length, "keys,", opened.length, "open");

    return {
        box,
        openedKeys,
        prompt:
            `\n\nMEMORY (${data.length} saved${data.length > Object.keys(index).length ? `, ${Object.keys(index).length} shown` : ""}) ${JSON.stringify(index)}` +
            (opened.length ? `\n\nOPEN (to show one unchanged, write only <<AUTO_PASTE {"key":"..."}>>; never retype it)\n${opened.join("\n\n")}` : "")
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
        const key = cleanKey(`auto_${lang}_${topic || "snippet"}${copies.length ? `_${copies.length + 1}` : ""}`);
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

/* ---------- backups for "bhool jao" / "yaad karlo" ---------- */

const FORGET_CUE = /\b(bh?o?o?l\s*(ja|jao|jana|jaao|do)|bhul\s*(ja|jao)|forget|mita\s*(do|de|dein)|delete\s+(kar|karo|memory|it)|hata\s*(do|de))\b/i;
const REMEMBER_CUE = /\b(yaad\s*(kar|rakh|rkh|kr)\w*|remember|save\s*kar\w*|note\s*kar\w*)\b/i;

export function wantsForget(text) {
    return FORGET_CUE.test(String(text || ""));
}

export function wantsRemember(text) {
    return REMEMBER_CUE.test(String(text || ""));
}

/* the model did not forget anything itself: pick the keys with one tiny call */
export async function pickKeysToForget({ apiKey, model, userText, keys }) {
    if (!apiKey || !model || !keys?.length) return [];
    const prompt =
        'The user wants an assistant to forget something. Saved memory keys: ' + JSON.stringify(keys.slice(0, 200)) +
        '\nUser message: ' + String(userText).slice(0, 800) +
        '\nReply only a JSON array of the keys to delete, ["all"] if they want everything forgotten, or [] if nothing matches.';
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
                    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 150, temperature: 0 }
                })
            }
        );
        clearTimeout(timer);
        const data = await response.json().catch(() => ({}));
        const text = (data?.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("");
        const list = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1) || "[]");
        if (!Array.isArray(list)) return [];
        const picked = list.map(String).filter(key => key === "all" || keys.includes(key)).slice(0, 50);
        if (picked.length) console.log("[MEMORY] backup forget", picked.length);
        return picked.map(key => ({ key, value: null, forget: true }));
    } catch (error) {
        console.warn("[MEMORY] backup forget failed", error?.message || error);
        return [];
    }
}

/* The model may name a forget loosely ("project", "supabase*").
   Turn every forget into the real saved keys; drop ones that match
   nothing so the backup can take over. */
export function resolveForgets(copies, keys) {
    const out = [];
    const seen = new Set();
    const add = copy => {
        if (!seen.has(copy.key)) {
            seen.add(copy.key);
            out.push(copy);
        }
    };
    for (const copy of copies) {
        if (!copy.forget && copy.value !== null) {
            out.push(copy);
            continue;
        }
        if (copy.key === "all") {
            add(copy);
            continue;
        }
        const wanted = copy.key.replace(/\*$/, "");
        if (!copy.key.endsWith("*") && keys.includes(wanted)) {
            add({ key: wanted, value: null, forget: true });
            continue;
        }
        let matches = keys.filter(key => key.startsWith(wanted));
        if (!matches.length) matches = keys.filter(key => key.includes(wanted));
        if (!matches.length) {
            const parts = wanted.split("_").filter(part => part.length >= 4 && part !== "user");
            matches = keys.filter(key => parts.some(part => key.includes(part)));
        }
        matches.slice(0, 50).forEach(key => add({ key, value: null, forget: true }));
        if (!matches.length) console.log("[MEMORY] forget matched nothing", copy.key);
    }
    return out;
}

/* ---------- Settings > Memory: see, add, edit and forget ---------- */
// GET  /api/history?resource=memory            -> { items, max }
// POST /api/history?resource=memory {action}   -> save | delete | clear

function kindOf(key, value) {
    if (key.startsWith("user_")) return "you";
    if (key.startsWith("auto_") || value.includes("\n") || value.length > FACT_CHARS) return "saved";
    return "learned";
}

function keyFromText(text) {
    const base = cleanKey(String(text).split(/\s+/).slice(0, 5).join("_")).slice(0, 36) || "note";
    return `user_${base}`;
}

export async function handleMemoryRequest(req, res, { supabase, userId }) {
    if (!userId) return res.status(401).json({ error: "Please log in." });
    if (!memoryEnabled()) return res.status(200).json({ items: [], max: maxRows(), disabled: true });

    try {
        if (req.method === "GET") {
            const { data, error } = await supabase
                .from(TABLE)
                .select("key, value, updated_at")
                .eq("user_id", userId)
                .order("updated_at", { ascending: false })
                .limit(maxRows() + 100);
            if (error) {
                noteError(error);
                if (tableMissing) return res.status(503).json({ error: "Memory needs a database update (run supabase/neyo_setup.sql)." });
                throw error;
            }
            return res.status(200).json({
                max: maxRows(),
                items: (data || []).map(row => ({
                    key: row.key,
                    value: row.value,
                    kind: kindOf(row.key, row.value),
                    lines: row.value.split("\n").length,
                    updatedAt: row.updated_at
                }))
            });
        }

        if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

        let body = req.body;
        if (typeof body === "string") {
            try { body = JSON.parse(body); } catch { body = {}; }
        }
        body = body && typeof body === "object" ? body : {};

        if (body.action === "clear") {
            const { error } = await supabase.from(TABLE).delete().eq("user_id", userId);
            if (error) throw error;
            console.log("[MEMORY] cleared by user");
            return res.status(200).json({ ok: true });
        }

        if (body.action === "delete") {
            const key = String(body.key || "");
            if (!key) return res.status(400).json({ error: "Missing key." });
            const { error } = await supabase.from(TABLE).delete().eq("user_id", userId).eq("key", key);
            if (error) throw error;
            return res.status(200).json({ ok: true });
        }

        if (body.action === "save") {
            const value = String(body.value || "").trim();
            if (!value) return res.status(400).json({ error: "Write something to remember." });
            if (value.length > MAX_VALUE_CHARS) return res.status(400).json({ error: "That's too long to remember." });
            if (SECRET_FACT.test(value) || value.includes("[REDACTED_")) {
                return res.status(400).json({ error: "Passwords, keys and card numbers can't be saved in memory." });
            }
            // editing keeps its key; a new memory from the user gets user_<words>
            let key = body.key ? String(body.key).slice(0, 64) : keyFromText(value);
            if (!body.key) {
                const { data } = await supabase.from(TABLE).select("key").eq("user_id", userId).like("key", `${key}%`);
                const taken = new Set((data || []).map(row => row.key));
                let n = 2;
                const base = key;
                while (taken.has(key)) key = `${base}_${n++}`;
            }
            const { error } = await supabase.from(TABLE).upsert(
                { user_id: userId, key, value, updated_at: new Date().toISOString() },
                { onConflict: "user_id,key" }
            );
            if (error) throw error;
            await trimBox(supabase, userId);
            return res.status(200).json({ ok: true, item: { key, value, kind: kindOf(key, value), lines: value.split("\n").length, updatedAt: new Date().toISOString() } });
        }

        return res.status(400).json({ error: "Unknown action." });
    } catch (error) {
        console.error("[MEMORY] settings error", error?.message || error);
        return res.status(500).json({ error: "Memory request failed. Please try again." });
    }
}
