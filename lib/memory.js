/* =========================================================
   NEYO • SMART MEMORY (AUTO_COPY / AUTO_PASTE signals)
   ---------------------------------------------------------
   AUTO_COPY  - while answering, the model may add a tiny JSON
                signal at the very end:
                  <<AUTO_COPY {"key":"fav_language","value":"JavaScript"}>>
                The server cuts it out of the stream (the user never
                sees it) and saves it in Supabase table neyo_memory.
                {"key":"x","value":null} forgets a fact.
   AUTO_PASTE - before every answer the server picks the saved
                facts that match the question (plain word match,
                0 tokens, no extra AI call) and pastes them as one
                compact JSON line. Profile facts (key "user_...")
                are always pasted.
   Env: NEYO_MEMORY=off turns it off.
   Table: supabase/neyo_setup.sql (missing table -> no-op).
   ========================================================= */

const TABLE = "neyo_memory";
const MAX_PER_ANSWER = 3;
const MAX_PER_USER = 200;
const PASTE_CHARS = 900;
const OPEN = "<<AUTO_COPY";

export const MEMORY_RULE =
    'Memory: facts saved earlier arrive as MEMORY {json}; use them quietly when relevant. When the user shares a lasting fact or preference worth remembering (name, project, stack, style, goals; never passwords, keys or card numbers), add at the very end of your answer one line per fact (max 3): <<AUTO_COPY {"key":"short_snake_key","value":"short fact"}>>. Use keys starting with user_ for facts about the user. To forget a fact use "value":null. Never mention these lines.';

export function memoryEnabled() {
    return String(process.env.NEYO_MEMORY || "").toLowerCase() !== "off";
}

/* ---------- AUTO_COPY: cut signals out of the stream ---------- */

export function createSignalFilter() {

    let pending = "";

    function isOpenPrefix(tail) {
        return OPEN.startsWith(tail) || tail.startsWith(OPEN);
    }

    return {
        push(chunk) {
            pending += chunk;
            let out = "";
            for (;;) {
                const start = pending.indexOf("<<");
                if (start === -1) {
                    // keep a single trailing "<" (could become "<<")
                    if (pending.endsWith("<")) {
                        out += pending.slice(0, -1);
                        pending = "<";
                    } else {
                        out += pending;
                        pending = "";
                    }
                    return out;
                }
                out += pending.slice(0, start);
                pending = pending.slice(start);
                const tail = pending.slice(0, OPEN.length);
                if (!isOpenPrefix(tail)) {
                    // ordinary "<<" (C++ cout, shell heredoc...)
                    out += "<<";
                    pending = pending.slice(2);
                    continue;
                }
                if (pending.length < OPEN.length) {
                    return out;             // wait for more text
                }
                const end = pending.indexOf(">>");
                if (end === -1) {
                    if (pending.length > 800) {
                        out += pending;     // never closed: give it back
                        pending = "";
                    }
                    return out;
                }
                pending = pending.slice(end + 2).replace(/^[ \t]*\n?/, "");
            }
        },
        flush() {
            const rest = pending.startsWith(OPEN) ? "" : pending;
            pending = "";
            return rest;
        }
    };
}

/* Take signals out of the full reply: { clean, copies } */
export function extractSignals(text) {

    const copies = [];
    const clean = String(text || "").replace(/<<AUTO_COPY\s*(\{[\s\S]*?\})\s*>>[ \t]*\n?/g, (match, json) => {
        try {
            const data = JSON.parse(json);
            const key = String(data.key || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
            if (key && copies.length < MAX_PER_ANSWER) {
                copies.push({
                    key,
                    value: data.value === null ? null : String(data.value ?? "").slice(0, 300)
                });
            }
        } catch {
            // broken JSON: just drop the signal
        }
        return "";
    });

    return { clean: clean.replace(/\s+$/, ""), copies };
}

/* ---------- storage ---------- */

let tableMissing = false;

function noteError(error) {
    if (error && /relation|does not exist|schema cache/i.test(error.message || "")) {
        if (!tableMissing) {
            console.warn("[MEMORY] table missing: run supabase/neyo_setup.sql once");
        }
        tableMissing = true;
    }
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise(resolve => setTimeout(() => resolve({ data: null, error: { message: "timeout" } }), ms))
    ]);
}

const SECRETISH = /\[REDACTED_|password|passwd|api[_ -]?key|secret|token|cvv|\b\d{13,19}\b/i;

export async function saveMemories(supabase, { userId, copies, restore = text => text }) {

    if (!memoryEnabled() || tableMissing || !supabase || !userId || !copies?.length) {
        return;
    }

    for (const copy of copies) {
        if (copy.value === null) {
            const { error } = await withTimeout(supabase.from(TABLE).delete().eq("user_id", userId).eq("key", copy.key), 1500);
            noteError(error);
            continue;
        }
        const value = restore(copy.value).trim();
        if (!value || SECRETISH.test(value) || SECRETISH.test(copy.key)) {
            continue;   // never store secrets, even if the model tries
        }
        const { error } = await withTimeout(
            supabase.from(TABLE).upsert(
                { user_id: userId, key: copy.key, value, updated_at: new Date().toISOString() },
                { onConflict: "user_id,key" }
            ),
            1500
        );
        noteError(error);
        if (error) {
            console.warn("[MEMORY] save failed", error.message);
        }
    }

    console.log("[MEMORY] auto_copy", copies.map(copy => `${copy.key}${copy.value === null ? "(forget)" : ""}`).join(","));

    // keep the newest MAX_PER_USER facts
    const { data } = await withTimeout(
        supabase.from(TABLE).select("key").eq("user_id", userId).order("updated_at", { ascending: false }).range(MAX_PER_USER, MAX_PER_USER + 50),
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

/* ---------- AUTO_PASTE ---------- */

export async function loadMemoryPrompt(supabase, { userId, question, scrub = text => text }) {

    if (!memoryEnabled() || tableMissing || !supabase || !userId) {
        return "";
    }

    const { data, error } = await withTimeout(
        supabase.from(TABLE).select("key, value, updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(MAX_PER_USER),
        1200
    );

    if (error || !Array.isArray(data) || !data.length) {
        noteError(error);
        return "";
    }

    const asked = words(question);

    const scored = data.map((row, index) => {
        const have = words(`${row.key.replace(/_/g, " ")} ${row.value}`);
        let hits = 0;
        asked.forEach(word => {
            if (have.has(word)) {
                hits += 1;
            }
        });
        const profile = row.key.startsWith("user_");
        return { row, score: (profile ? 5 : 0) + hits * 2 - index * 0.01, keep: profile || hits > 0 };
    })
        .filter(item => item.keep)
        .sort((a, b) => b.score - a.score);

    const picked = {};
    let size = 0;
    for (const { row } of scored) {
        const value = scrub(row.value);
        const add = row.key.length + value.length + 6;
        if (size + add > PASTE_CHARS) {
            continue;
        }
        picked[row.key] = value;
        size += add;
    }

    if (!Object.keys(picked).length) {
        return "";
    }

    console.log("[MEMORY] auto_paste", Object.keys(picked).length);

    return `\n\nMEMORY ${JSON.stringify(picked)}`;
}
