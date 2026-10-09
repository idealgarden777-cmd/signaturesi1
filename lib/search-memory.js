/*
=========================================================
NEYO — SEARCH MEMORY
Finds what NEYO already researched for this user in earlier
chats (chat_conversations + chat_messages, no new table).
Used by the tool agent's search_memory tool, e.g.
"pichli baar jo laptop dekhe the", "wo research dobara dikhao",
or to reuse an earlier answer before searching the web again.
Only the user's own conversations. Never used in Private Chat.
=========================================================
*/

const STOP = new Set(
    "a an and are as at be by for from how in is it of on or the to what when where which who why with was were this that these those me my i you your we our they them he she ka ki ke ko se me mein main hai hain tha thi the kya kia aur ya bhi wo woh ye yeh jo jab tak par pe kar karo kaise kaisa kaun kon sab abhi pichli pichle baar dafa wala wali wale dekha dekhe dikhao batao bataya search research".split(" ")
);

export function memoryTerms(query = "") {
    return [...new Set(
        String(query)
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .filter(term => term.length > 2 && !STOP.has(term))
    )].slice(0, 6);
}

function excerpt(text, terms, size = 700) {
    const clean = String(text || "").replace(/```neyo-ui[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
    const lower = clean.toLowerCase();
    let at = -1;
    for (const term of terms) {
        at = lower.indexOf(term);
        if (at >= 0) {
            break;
        }
    }
    const start = Math.max(0, at - Math.floor(size / 3));
    return (start > 0 ? "…" : "") + clean.slice(start, start + size) + (start + size < clean.length ? "…" : "");
}

function parseSources(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim().startsWith("[")) {
        try {
            return JSON.parse(value);
        } catch {
            return [];
        }
    }
    return [];
}

/**
 * @returns {Promise<{found:number, results:Array}>}
 */
export async function searchPastResearch({ supabase, userId, query, limit = 4, timeoutMs = 4000 } = {}) {
    if (!supabase || !userId) {
        return { found: 0, results: [], note: "Search memory is not available." };
    }
    const terms = memoryTerms(query);
    if (!terms.length) {
        return { found: 0, results: [], note: "Give a topic to look for." };
    }

    const work = (async () => {
        const conversations = await supabase
            .from("chat_conversations")
            .select("id,title")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(300);
        if (conversations.error || !conversations.data?.length) {
            return [];
        }
        const titles = new Map(conversations.data.map(row => [row.id, row.title || ""]));
        // Only letters/digits reach the filter string (terms are split on everything else).
        const filter = terms.map(term => `content.ilike.%${term}%`).join(",");
        const messages = await supabase
            .from("chat_messages")
            .select("conversation_id,content,sources,created_at")
            .in("conversation_id", [...titles.keys()])
            .eq("role", "assistant")
            .or(filter)
            .order("created_at", { ascending: false })
            .limit(40);
        if (messages.error) {
            return [];
        }
        return (messages.data || []).map(row => ({ ...row, title: titles.get(row.conversation_id) || "" }));
    })();

    const rows = await Promise.race([
        work.catch(() => []),
        new Promise(resolve => setTimeout(() => resolve([]), timeoutMs))
    ]);

    const scored = rows
        .map(row => {
            const haystack = `${row.title} ${row.content}`.toLowerCase();
            const hits = terms.filter(term => haystack.includes(term)).length;
            return { row, score: hits / terms.length };
        })
        .filter(item => item.score >= (terms.length <= 2 ? 0.5 : 0.4))
        .sort((a, b) => b.score - a.score || String(b.row.created_at).localeCompare(String(a.row.created_at)));

    const results = scored.slice(0, limit).map(({ row }) => ({
        date: String(row.created_at || "").slice(0, 10),
        chat: String(row.title || "").slice(0, 80),
        answer: excerpt(row.content, terms),
        sources: parseSources(row.sources)
            .slice(0, 4)
            .map(item => ({ title: String(item?.title || "").slice(0, 100), url: String(item?.url || "") }))
            .filter(item => /^https?:\/\//.test(item.url))
    }));

    return {
        found: results.length,
        results,
        note: results.length
            ? "These are NEYO's own earlier answers (dated). Facts may have changed since: for anything current, also run web_search."
            : "Nothing about this in earlier chats."
    };
}
