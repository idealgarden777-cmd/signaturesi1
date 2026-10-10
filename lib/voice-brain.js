/*
=========================================================
NEYO VOICE BRAIN
Makes the live voice as smart as text chat:
- remembers the user (same memory box as chat)
- can look up past chats
- can save / forget facts when asked
- can hand a hard question to a stronger thinking model
- can put things (apps, visuals, notes, code) into the chat
=========================================================
*/

import { createClient } from "@supabase/supabase-js";
import {
    loadMemoryBox,
    saveMemories,
    extractFactsWithModel,
    memoryEnabled
} from "./memory.js";
import { searchPastResearch } from "./search-memory.js";

let supabaseClient = null;

function db() {
    if (supabaseClient) return supabaseClient;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    supabaseClient = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    return supabaseClient;
}

const THINK_MODELS = [
    String(process.env.NEYO_VOICE_THINK_MODEL || "").trim(),
    "gemini-3.8-flash",
    "gemini-2.5-flash"
].filter(Boolean);

const LEARN_MODEL =
    String(
        process.env.NEYO_RESEARCH_PLANNER_MODEL ||
        process.env.NEYO_FREE_FALLBACK_MODEL ||
        "gemini-3.1-flash-lite"
    ).trim();

/* ---------- tool declarations ---------- */

const tool = (name, description, properties, required) => ({
    name,
    description,
    parameters: { type: "OBJECT", properties, required }
});

const STR = description => ({ type: "STRING", description });

export const BRAIN_TOOLS = [
    tool(
        "recall_memory",
        "Look up what you saved about the user and what you discussed in earlier NEYO chats. Use when the user refers to something from before ('wo jo pichli baar', 'my project', 'what did we decide') or when personal context would make the answer better.",
        { query: STR("A few keywords of what to look for.") },
        ["query"]
    ),
    tool(
        "remember",
        "Save a lasting fact or preference about the user (name, city, job, project, goals, likes, how they want answers). Use when the user asks you to remember something, or states a clear lasting fact about themselves. Never save passwords, keys, card numbers or anything temporary.",
        {
            key: STR("short snake_case key; facts about the user start with user_, e.g. user_city"),
            value: STR("the fact, one short sentence")
        },
        ["key", "value"]
    ),
    tool(
        "forget",
        "Delete one saved memory when the user asks you to forget it. Use the exact key from your memory list.",
        { key: STR("the exact memory key") },
        ["key"]
    ),
    tool(
        "think_deep",
        "Hand a hard question to a stronger thinking model: maths, logic, code, planning, comparisons, step-by-step explanations, advice that needs careful reasoning. Put every fact it needs into the question (search first if fresh facts are needed). Returns a careful answer for you to say in short.",
        {
            question: STR("the full question with all needed context"),
            context: STR("optional extra facts, search results or user details")
        },
        ["question"]
    ),
    tool(
        "show_in_chat",
        "Put something on the user's screen in the NEYO chat: a mini app or game, a diagram or visual, a table, a plan, notes, a long list, code, or a written answer the user wants to keep. Write a clear request for the text assistant. Use when the user asks to make, build, draw, write down, show or save something, or when the answer is too long to speak.",
        { request: STR("the full request, in the user's language, with every detail they gave") },
        ["request"]
    )
];

export const BRAIN_RULES = [
    "You have a memory and helper tools. Use them quietly; never mention tool names.",
    "MEMORY lists what you already know about the user. Use it naturally to personalise answers, but don't recite it.",
    "When the user mentions something from before, call recall_memory before answering.",
    "When the user asks you to remember something, or tells you a lasting fact about themselves, call remember. When they ask you to forget something, call forget. Confirm in a few words.",
    "For hard reasoning (maths, code, planning, deep comparisons, tricky advice) call think_deep, then say the answer in short simple speech.",
    "When the user asks you to make, build, draw, write, list, plan or show something on screen (apps, games, diagrams, notes, code, tables), call show_in_chat with a full request, then say briefly that it is appearing in the chat. Don't read long content aloud.",
    "Before a tool that takes time, say a very short filler in the user's language."
].join(" ");

/* ---------- memory for the system instruction ---------- */

export async function voiceMemoryPrompt(userId, { off = false, timeoutMs = 900 } = {}) {
    if (off || !userId || !memoryEnabled()) return "";
    const client = db();
    if (!client) return "";
    try {
        const loaded = await Promise.race([
            loadMemoryBox(client, { userId, question: "" }),
            new Promise(resolve => setTimeout(() => resolve(null), timeoutMs))
        ]);
        const prompt = String(loaded?.prompt || "").trim();
        if (!prompt) return "";
        return ` What you know about this user (saved memory; use it, don't read it out): ${prompt.slice(0, 3500)}`;
    } catch {
        return "";
    }
}

/* ---------- tool actions ---------- */

function cleanKey(key) {
    return String(key || "")
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60);
}

async function recall(userId, query) {
    const client = db();
    if (!client) return { found: false, note: "Memory is not available." };
    const [box, past] = await Promise.all([
        loadMemoryBox(client, { userId, question: query }).catch(() => null),
        searchPastResearch({ supabase: client, userId, query, limit: 3, timeoutMs: 3500 }).catch(() => null)
    ]);
    const saved = String(box?.prompt || "").slice(0, 3000);
    const chats = (past?.results || []).map(item => ({
        date: item.date,
        chat: item.chat,
        answer: String(item.answer || "").slice(0, 700)
    }));
    return {
        found: Boolean(saved || chats.length),
        saved_memory: saved || "nothing saved",
        past_chats: chats,
        instructions: "Use this to answer in short speech. If nothing matches, say you don't remember that yet."
    };
}

async function remember(userId, key, value) {
    const client = db();
    const k = cleanKey(key);
    const v = String(value || "").replace(/\s+/g, " ").trim().slice(0, 400);
    if (!client || !k || !v) return { saved: false };
    const result = await saveMemories(client, { userId, copies: [{ key: k, value: v }] });
    return { saved: result.saved.includes(k), key: k };
}

async function forget(userId, key) {
    const client = db();
    const k = cleanKey(key);
    // one key at a time from voice: never wipe everything by accident
    if (!client || !k || k === "all") return { forgot: false };
    const result = await saveMemories(client, { userId, copies: [{ key: k, value: null }] });
    return { forgot: result.forgot.includes(k), key: k };
}

async function think(apiKey, question, context) {
    const today = new Intl.DateTimeFormat("en-US", {
        dateStyle: "full",
        timeZone: "Asia/Karachi"
    }).format(new Date());
    const prompt =
        `Today is ${today}. Think carefully and answer correctly. ` +
        "Your answer will be spoken aloud by a voice assistant, so give the final answer first, then the key reasoning in a few short plain sentences. No markdown, no tables, no code blocks; if code is needed, describe it briefly. " +
        "Reply in the same language as the question.\n\n" +
        (context ? `Context:\n${String(context).slice(0, 6000)}\n\n` : "") +
        `Question:\n${String(question).slice(0, 4000)}`;

    for (const model of THINK_MODELS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 22000);
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    signal: controller.signal,
                    body: JSON.stringify({
                        contents: [{ role: "user", parts: [{ text: prompt }] }],
                        generationConfig: { maxOutputTokens: 1500, temperature: 0.3 }
                    })
                }
            );
            const data = await response.json().catch(() => ({}));
            const text = (data?.candidates?.[0]?.content?.parts || [])
                .filter(part => !part.thought)
                .map(part => part.text || "")
                .join("")
                .trim();
            if (response.ok && text) {
                console.log("[VOICE_THINK]", model, text.length);
                return { answer: text.slice(0, 5000), instructions: "Say this in short natural speech in the user's language." };
            }
            console.warn("[VOICE_THINK] no answer from", model, response.status);
        } catch (error) {
            console.warn("[VOICE_THINK] failed", model, error?.message || error);
        } finally {
            clearTimeout(timer);
        }
    }
    return { answer: "", error: "Thinking failed. Answer as well as you can yourself." };
}

/* learn lasting facts from what the user said in the call */
async function learn(apiKey, userId, text) {
    const client = db();
    const said = String(text || "").trim().slice(-3000);
    if (!client || said.length < 20) return { saved: [] };
    const copies = await extractFactsWithModel({ apiKey, model: LEARN_MODEL, userText: said });
    if (!copies.length) return { saved: [] };
    const result = await saveMemories(client, { userId, copies });
    return { saved: result.saved };
}

export const BRAIN_ACTIONS = new Set(["recall", "remember", "forget", "think", "learn"]);

export async function runBrainAction({ action, body, userId, apiKey }) {
    const memoryOff = body?.memoryOff === true;
    if (memoryOff && action !== "think") {
        return { ok: false, note: "Memory is turned off in settings. Tell the user it is off." };
    }
    switch (action) {
        case "recall":
            return recall(userId, String(body?.query || "").slice(0, 200));
        case "remember":
            return remember(userId, body?.key, body?.value);
        case "forget":
            return forget(userId, body?.key);
        case "think":
            return think(apiKey, body?.question || "", body?.context || "");
        case "learn":
            return learn(apiKey, userId, body?.text);
        default:
            return { error: "Unknown action." };
    }
}
