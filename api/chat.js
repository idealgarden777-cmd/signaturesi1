import { createClient } from "@supabase/supabase-js";
import { applyContextCache, dropContextCache } from "../lib/context-cache.js";
import { decideLocally, shouldUpgradeForGrounding } from "../lib/decide.js";
import { verifyAnswer, answerCheckEnabled } from "../lib/verify.js";
import { createPrivacySession, PRIVACY_RULE, privacyEnabled } from "../lib/privacy.js";
import { loadWorkspaceContext, saveWorkspaceSuggestions, WORKSPACE_RULE } from "../lib/workspaces.js";
import { SMART_UI_RULE } from "../lib/smart-ui.js";
import { MEMORY_RULE, memoryEnabled, createMemoryFilter, applyMemoryMarkers, saveMemories, loadMemoryBox, autoCodeCopies, looksLikeFact, extractFactsWithModel, touchMemories, wantsForget, wantsRemember, pickKeysToForget, resolveForgets } from "../lib/memory.js";

import {
    getAuthenticatedUser
} from "../lib/auth.js";

import {
    runDeepResearch,
    buildResearchPrompt,
    runLiveSearch,
    buildLiveSearchPrompt,
    decideSearch,
    WEAK_SEARCH_NOTE
} from "../lib/deep-research.js";

import {
    runToolAgent
} from "../lib/agent-tools.js";


/* =========================================================
   SUPABASE
   ========================================================= */

const supabase =
    createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        }
    );


/* =========================================================
   CONFIG
   ========================================================= */

const GEMINI_API_KEY =
    cleanEnv(
        process.env.GEMINI_API_KEY
    );


const ATTACHMENT_BUCKET =
    "neyo-attachments";


const MAX_ATTACHMENTS =
    5;


const MAX_MESSAGE_LENGTH =
    50000;


const MAX_HISTORY_MESSAGES =
    50;


const MAX_HISTORY_CHARS =
    60000;


const MAX_URL_CONTEXT_SOURCES =
    5;


const URL_FETCH_TIMEOUT_MS =
    8000;


const STREAM_HEARTBEAT_MS =
    5000;


const HISTORY_BUDGET_LIGHT = {
    messages: 12,
    chars: 12000
};


const HISTORY_BUDGET_STANDARD = {
    messages: 30,
    chars: 30000
};


const HISTORY_BUDGET_DEEP = {
    messages: 50,
    chars: MAX_HISTORY_CHARS
};


/* =========================================================
   MODELS
   ========================================================= */

const NEYO_FREE_PRIMARY_MODEL =
    cleanEnv(
        process.env.NEYO_FREE_PRIMARY_MODEL
    ) ||
    "gemma-4-26b-a4b-it";


const NEYO_FREE_FALLBACK_MODEL =
    cleanEnv(
        process.env.NEYO_FREE_FALLBACK_MODEL
    ) ||
    cleanEnv(
        process.env.GEMINI_FREE_MODEL
    ) ||
    "gemini-3.1-flash-lite";


const NEYO_LEVERAGE_PRIMARY_MODEL =
    cleanEnv(
        process.env.NEYO_LEVERAGE_PRIMARY_MODEL
    ) ||
    "gemma-4-26b-a4b-it";


const NEYO_LEVERAGE_ADVANCED_MODEL =
    cleanEnv(
        process.env.NEYO_LEVERAGE_ADVANCED_MODEL
    ) ||
    "gemma-4-31b-it";


const NEYO_LEVERAGE_FALLBACK_MODEL =
    cleanEnv(
        process.env.NEYO_LEVERAGE_FALLBACK_MODEL
    ) ||
    cleanEnv(
        process.env.GEMINI_PRO_MODEL
    ) ||
    "gemini-3.5-flash-lite";


/* =========================================================
   SYSTEM PROMPT
   ========================================================= */

const NEYO_RESPONSE_FORMAT = `
I'm NEYO — an AI personalized model by Signaturesi.

Adapt to the user's language, tone, context, and level of detail.

For simple questions, answer briefly and directly.
For complex tasks, reason carefully and give enough detail to solve the problem well.
Do not over-explain obvious points or repeat the user's question.
Do not narrate internal reasoning or hidden process.

Prioritize correctness, clarity, relevance, and practical usefulness.

Use concise wording by default, but do not sacrifice important information.
Expand only when the task requires depth, comparison, reasoning, technical detail, or step-by-step guidance.

Be natural and conversational, not robotic or templated.
If the user writes in Roman Urdu, respond naturally in Roman Urdu.
If they switch language, adapt automatically.

Use Markdown, bullets, headings, tables, or code blocks only when they improve readability.

When files, links, or context are provided, use them carefully.
If something is uncertain, say so instead of guessing.

Give the shortest complete high-quality answer that fully satisfies the user's request.
`;


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function cleanEnv(value) {

    return typeof value === "string"
        ? value.trim()
        : "";

}


function cleanString(
    value,
    max = MAX_MESSAGE_LENGTH
) {

    if (
        typeof value !== "string"
    ) {
        return "";
    }


    return value
        .replace(/\r\n?/g, "\n")
        .replace(
            /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
            ""
        )
        .trim()
        .slice(0, max);

}


function elapsed(start) {

    return Math.max(
        0,
        Date.now() - start
    );

}


function logTiming(
    name,
    value,
    extra = {}
) {

    console.log(
        `[NEYO Timing] ${name}`,
        {
            ms: value,
            ...extra
        }
    );

}


/* =========================================================
   ATTACHMENTS
   ========================================================= */

function validAttachmentList(
    attachments,
    userId,
    max = MAX_ATTACHMENTS
) {

    if (
        !Array.isArray(attachments)
    ) {
        return [];
    }


    const safeUserId =
        String(
            userId || ""
        ).trim();


    const userPrefix =
        `users/${safeUserId}/`;


    const seen =
        new Set();


    const output =
        [];


    for (
        const raw
        of attachments.slice(0, max)
    ) {

        if (
            !raw ||
            typeof raw !== "object"
        ) {
            continue;
        }


        const bucket =
            cleanString(
                raw.bucket ||
                ATTACHMENT_BUCKET,
                128
            );


        const path =
            cleanString(
                raw.path || "",
                1024
            );


        const uploadId =
            cleanString(
                raw.uploadId ||
                raw.upload_id ||
                "",
                128
            );


        const name =
            cleanString(
                raw.name ||
                "Attached file",
                220
            );


        const mime =
            cleanString(
                raw.mime ||
                raw.mimeType ||
                raw.type ||
                "application/octet-stream",
                180
            )
                .toLowerCase();


        const extension =
            cleanString(
                raw.extension || "",
                32
            )
                .replace(/^\./, "")
                .toLowerCase();


        const category =
            cleanString(
                raw.category ||
                "unknown",
                40
            )
                .toLowerCase();


        const size =
            Math.max(
                0,
                Number(raw.size) || 0
            );


        if (
            bucket !==
            ATTACHMENT_BUCKET
        ) {
            continue;
        }


        if (!path) {
            continue;
        }


        if (
            path.startsWith("/") ||
            path.includes("\\") ||
            path.includes("..")
        ) {
            continue;
        }


        if (
            !path.startsWith(
                userPrefix
            )
        ) {
            continue;
        }


        const key =
            `${bucket}:${path}`;


        if (
            seen.has(key)
        ) {
            continue;
        }


        seen.add(key);


        output.push({

            id:
                cleanString(
                    raw.id || "",
                    128
                ) ||
                uploadId ||
                null,

            uploadId:
                uploadId ||
                null,

            provider:
                "supabase",

            bucket,

            path,

            name,

            mime,

            mimeType:
                mime,

            type:
                mime,

            extension,

            category,

            size

        });

    }


    return output;

}


/* =========================================================
   PREFERENCES
   ========================================================= */

function normalizeIntelligence(
    value
) {

    const normalized =
        String(
            value || "standard"
        )
            .trim()
            .toLowerCase();


    if (
        [
            "standard",
            "high",
            "maximum"
        ].includes(normalized)
    ) {
        return normalized;
    }


    return "standard";

}


function normalizeLanguage(
    value
) {

    return cleanString(
        String(
            value || "auto"
        ),
        40
    )
        .toLowerCase() ||
        "auto";

}


function normalizePersonality(
    value
) {

    return cleanString(
        String(
            value || "neyo"
        ),
        50
    )
        .toLowerCase() ||
        "neyo";

}


// Settings > Workspace: the user's own standing instructions,
// answer length, and whether NEYO may search the web / use tools.
function normalizeWorkspace(
    value,
    privacy = null
) {

    const input =
        value && typeof value === "object"
            ? value
            : {};

    let instructions =
        String(input.instructions || "")
            .replace(/\u0000/g, "")
            .trim()
            .slice(0, 2000);

    if (instructions && privacy && typeof privacy.scrub === "function") {
        instructions = privacy.scrub(instructions);
    }

    return {
        instructions,
        length:
            ["short", "detailed"].includes(input.length)
                ? input.length
                : "auto",
        tools:
            input.tools === "off"
                ? "off"
                : "auto"
    };

}


// NEYO's <<WS_ACTION>> lines -> pending suggestions a person approves.
async function saveSuggestionsFor(
    workspaceId,
    userId,
    actions,
    restore
) {
    if (!workspaceId || !Array.isArray(actions) || !actions.length) {
        return null;
    }
    const fix = value =>
        typeof value === "string" && typeof restore === "function"
            ? restore(value)
            : value;
    const list =
        await saveWorkspaceSuggestions(
            String(workspaceId),
            userId,
            actions.map(action => {
                const out = {};
                for (const key of Object.keys(action || {})) {
                    out[key] = fix(action[key]);
                }
                return out;
            })
        );
    return list.length
        ? { id: String(workspaceId), suggestions: list }
        : null;
}


function normalizePrivateChat(
    value
) {

    return value === true;

}


/* =========================================================
   AUTOMATIC EFFORT
   ========================================================= */

function detectAutomaticEffort(
    text
) {

    const value =
        cleanString(
            text || "",
            12000
        )
            .toLowerCase();


    if (!value) {
        return "standard";
    }


    const deepSignals = [

        /\bdeep(?:ly)?\b/,
        /\bthorough(?:ly)?\b/,
        /\bcomplex\b/,
        /\bdifficult\b/,
        /\bhard\b/,
        /\barchitecture\b/,
        /\bdebug\b/,
        /\banaly[sz]e\b/,
        /\breason(?:ing)?\b/,
        /\bresearch\b/,
        /\bcompare\b/,
        /\boptimi[sz]e\b/,
        /\bproduction\b/,
        /\broot cause\b/,
        /\bstep[- ]by[- ]step\b/

    ];


    if (
        value.length >= 3500 ||
        deepSignals.some(
            pattern =>
                pattern.test(value)
        )
    ) {
        return "deep";
    }


    if (
        value.length <= 180 &&
        !value.includes("```")
    ) {
        return "light";
    }


    return "standard";

}


/* =========================================================
   HISTORY BUDGET
   ========================================================= */

function getHistoryBudget({
    autoEffort,
    isDeepResearch,
    attachments
} = {}) {

    if (
        isDeepResearch ||
        autoEffort === "deep" ||
        (
            Array.isArray(attachments) &&
            attachments.length > 0
        )
    ) {

        return HISTORY_BUDGET_DEEP;

    }


    if (
        autoEffort === "light"
    ) {

        return HISTORY_BUDGET_LIGHT;

    }


    return HISTORY_BUDGET_STANDARD;

}


function selectHistoryMessages(
    messages,
    {
        maxMessages =
            MAX_HISTORY_MESSAGES,

        maxChars =
            MAX_HISTORY_CHARS

    } = {}
) {

    if (
        !Array.isArray(messages) ||
        messages.length === 0
    ) {
        return [];
    }


    const recent =
        messages.slice(
            -maxMessages
        );


    const selected =
        [];


    let totalChars =
        0;


    for (
        let index =
                recent.length - 1;
        index >= 0;
        index -= 1
    ) {

        const message =
            recent[index];


        const content =
            cleanString(
                message?.content || ""
            );


        const cost =
            content.length;


        if (
            selected.length > 0 &&
            totalChars + cost >
                maxChars
        ) {

            break;

        }


        selected.push(message);


        totalChars += cost;

    }


    selected.reverse();


    // Context cache: when old messages are cut, cut in steps of 8,
    // so the start of the chat stays the same for a few turns
    // and the cached part can be reused.
    const start =
        messages.length - selected.length;

    if (start > 0) {

        const stableStart =
            Math.ceil(start / 8) * 8;

        const drop =
            stableStart - start;

        if (
            drop > 0 &&
            selected.length - drop >= 2
        ) {
            return selected.slice(drop);
        }

    }


    return selected;

}


/* =========================================================
   MODEL ROUTER
   ========================================================= */

function selectModelRoute({
    isPro = false,
    attachments = [],
    preferences = {},
    isDeepResearch = false,
    autoEffort = "standard"
} = {}) {

    const hasAttachments =
        Array.isArray(attachments) &&
        attachments.length > 0;


    if (
        isPro &&
        hasAttachments
    ) {

        return {

            primary:
                NEYO_LEVERAGE_ADVANCED_MODEL,

            fallback:
                NEYO_LEVERAGE_FALLBACK_MODEL,

            route:
                "leverage-multimodal"

        };

    }


    if (
        isPro &&
        (
            preferences.intelligence ===
                "maximum" ||
            isDeepResearch ||
            autoEffort ===
                "deep"
        )
    ) {

        return {

            primary:
                NEYO_LEVERAGE_ADVANCED_MODEL,

            fallback:
                NEYO_LEVERAGE_FALLBACK_MODEL,

            route:
                "leverage-advanced"

        };

    }


    if (isPro) {

        return {

            primary:
                NEYO_LEVERAGE_PRIMARY_MODEL,

            fallback:
                NEYO_LEVERAGE_FALLBACK_MODEL,

            route:
                "leverage-standard"

        };

    }


    return {

        primary:
            NEYO_FREE_PRIMARY_MODEL,

        fallback:
            NEYO_FREE_FALLBACK_MODEL,

        route:
            hasAttachments
                ? "free-multimodal"
                : "free-standard"

    };

}


/* =========================================================
   CHARACTERS (real chat personalities)
   ========================================================= */

const CHARACTER_SHARED_RULE =
    "Stay in this character's voice for the whole reply, but never let personality reduce accuracy or usefulness. You are still part of NEYO by Signaturesi.";

const CHARACTER_NAMES =
    Object.freeze({
        neyo: "Neyo",
        zadi: "Zadi",
        wizi: "Wizi",
        crony: "Crony"
    });

const CHARACTER_GENDERS =
    Object.freeze({
        neyo: "female",
        zadi: "male",
        wizi: "male",
        crony: "male"
    });

const CHARACTER_TEXT_PERSONAS =
    Object.freeze({
        neyo:
            "Character: you are Neyo, NEYO's main character. Personality: calm, warm, confident and smart, like a trusted friend who knows a lot. Give the clear practical answer first, then one helpful next step. Steady, reassuring tone; light humour only when it fits. " +
            CHARACTER_SHARED_RULE,
        zadi:
            "Character: you are Zadi, one of NEYO's characters. Personality: bold, energetic, expressive and confident, a hype friend and motivator. Write with punch and enthusiasm, use vivid words, push the user toward action, celebrate their wins and turn worries into a plan. Direct and honest, never rude. " +
            CHARACTER_SHARED_RULE,
        wizi:
            "Character: you are Wizi, one of NEYO's characters. Personality: endlessly curious, imaginative and clever, a little wizard of ideas. Explain how things work with simple examples and surprising facts, make learning feel like an adventure, and often end with one curious question back to the user. " +
            CHARACTER_SHARED_RULE,
        crony:
            "Character: you are Crony, NEYO's bouncy blue liquid-pill buddy. Personality: super friendly, playful, upbeat and casual, like a best friend. Relaxed cheerful wording, light jokes, keep the vibe positive, but still help properly and simply. " +
            CHARACTER_SHARED_RULE
    });

/* =========================================================
   SYSTEM
   ========================================================= */

function buildSystemInstruction(
    preferences = {}
) {

    const character =
        CHARACTER_NAMES[
            preferences.personality
        ]
            ? preferences.personality
            : "neyo";

    const characterName =
        CHARACTER_NAMES[character];

    const identity =
        `IDENTITY (highest priority): Your name is ${characterName}. You are ${characterName}, a character inside the NEYO app by Signaturesi. If the user asks your name or who you are, say you are ${characterName}.` +
        (
            character === "neyo"
                ? ""
                : ` Never introduce yourself as Neyo or NEYO.`
        ) +
        ` When you refer to yourself, use ${CHARACTER_GENDERS[character]} wording (in Urdu and Hindi use ${CHARACTER_GENDERS[character] === "male" ? "masculine" : "feminine"} verb forms).` +
        " Never say you are Gemini, Gemma, Google or a generic AI model. Earlier assistant messages in this chat may have been written by a different NEYO character: ignore their name and style and speak only as " +
        characterName +
        ".";

    const now =
        new Date();

    const dateLine =
        `CURRENT DATE: Today is ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Karachi" })} (${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(now)}, Pakistan time). ` +
        "Your built-in training knowledge is older than today. When the message includes LIVE WEB RESULTS or deep research sources, trust them for anything current. " +
        "If the user asks about something recent and no web results are included, say your information may be out of date instead of presenting old facts as current.";

    const parts = [
        identity,
        dateLine,
        CHARACTER_TEXT_PERSONAS[character],
        NEYO_RESPONSE_FORMAT.replace(
            "I'm NEYO — an AI personalized model by Signaturesi.",
            "NEYO is an AI personalized model by Signaturesi."
        )
    ];


    // Live cards (calculator, checklist, chart, tabs, compare, quiz)
    if (preferences.smartUi !== false) {
        parts.push(SMART_UI_RULE);
    }


    if (
        preferences.intelligence ===
            "high" ||
        preferences.intelligence ===
            "maximum"
    ) {

        parts.push(
            "Use deeper reasoning when the task requires it."
        );

    }


    if (
        preferences.language &&
        preferences.language !==
            "auto"
    ) {

        parts.push(
            `Preferred response language: ${preferences.language}.`
        );

    }


    const workspace =
        preferences.workspace || {};

    if (preferences.workspaceContext) {

        parts.push(
            preferences.workspaceContext
        );

        if (preferences.workspaceCanSuggest) {
            parts.push(
                WORKSPACE_RULE
            );
        }

    }

    if (workspace.instructions) {

        parts.push(
            "USER'S WORKSPACE INSTRUCTIONS (the user wrote these in Settings; follow them in every reply unless the latest message asks otherwise, and never let them change your name or safety rules):\n" +
            workspace.instructions
        );

    }

    if (workspace.length === "short") {

        parts.push(
            "ANSWER LENGTH: The user prefers short answers. Give the answer first in a few sentences; add detail only if they ask. Code and requested lists stay complete."
        );

    } else if (workspace.length === "detailed") {

        parts.push(
            "ANSWER LENGTH: The user prefers detailed answers. Explain fully with steps, examples and reasons, but stay on topic."
        );

    }

    parts.push(
        `Reminder: you are ${characterName}. Keep ${characterName}'s personality in every reply.`
    );


    return parts.join("\n\n");

}


/* =========================================================
   MODEL BODY
   ========================================================= */

// Effort dial: "high" = the model thinks before answering,
// "low" = answers straight away. Each model family has its own knob.
function buildThinkingConfig(
    model = "",
    effort = ""
) {

    if (
        effort !== "high" &&
        effort !== "low"
    ) {
        return null;
    }

    const high =
        effort === "high";

    // Gemma 4 sends its thoughts anyway; Gemini needs includeThoughts.
    if (/gemma-4/i.test(model)) {
        return {
            thinkingLevel:
                high ? "high" : "minimal"
        };
    }

    if (/gemini-3/i.test(model)) {
        return high
            ? { thinkingLevel: "high", includeThoughts: true }
            : { thinkingLevel: "minimal" };
    }

    if (/gemini-2\.5-pro/i.test(model)) {
        return high
            ? { thinkingBudget: -1, includeThoughts: true }
            : { thinkingBudget: 128 };
    }

    if (/gemini-2\.5/i.test(model)) {
        return high
            ? { thinkingBudget: -1, includeThoughts: true }
            : { thinkingBudget: 0 };
    }

    return null;

}


const SELF_CHECK_RULE =
    "Think carefully before answering. Then check your answer against the question: if it can be read two ways, use the most natural reading and state that assumption in one short line; no contradictions or impossible options; numbers must add up and match any tool results; never assume the user's gender, age or feelings (address the user neutrally).";


function buildGeminiBody(
    contents,
    isDeepResearch = false,
    preferences = {},
    model = ""
) {

    const thinkingConfig =
        preferences.noThinkingConfig
            ? null
            : buildThinkingConfig(
                model,
                preferences.thinkingEffort
            );

    return {

        systemInstruction: {

            parts: [
                {
                    text:
                        buildSystemInstruction(
                            preferences
                        ) +
                        (
                            privacyEnabled()
                                ? `\n\n${PRIVACY_RULE}`
                                : ""
                        ) +
                        (
                            memoryEnabled() && !preferences.memoryOff
                                ? `\n\n${MEMORY_RULE}`
                                : memoryEnabled()
                                    ? "\n\nMEMORY IS OFF: the user switched memory off in Settings. Don't save or recall anything across chats; if they ask you to remember something, say memory is off and they can turn it on in Settings > Memory."
                                    : ""
                        ) +
                        (
                            preferences.thinkingEffort === "high"
                                ? `\n\n${SELF_CHECK_RULE}`
                                : ""
                        )
                }
            ]

        },

        contents,

        generationConfig: {

            temperature:
                isDeepResearch
                    ? 0.45
                    : preferences
                        .intelligence ===
                        "maximum"
                        ? 0.5
                        : 0.65,

            topP:
                0.95,

            maxOutputTokens:
                (
                    isDeepResearch ||
                    preferences
                        .intelligence ===
                        "maximum"
                )
                    ? 8192
                    : 6144,

            ...(
                thinkingConfig
                    ? { thinkingConfig }
                    : {}
            )

        }

    };

}


/* =========================================================
   NORMAL MODEL CALL
   ========================================================= */

async function callGemini(
    messages,
    model,
    isDeepResearch = false,
    preferences = {}
) {

    if (!GEMINI_API_KEY) {

        throw new Error(
            "Gemini API key is missing."
        );

    }


        const cached =
        preferences.noContextCache
            ? { body: buildGeminiBody(messages, isDeepResearch, preferences, model), cacheName: null }
            : await applyContextCache({
                apiKey: GEMINI_API_KEY,
                model,
                body: buildGeminiBody(messages, isDeepResearch, preferences, model)
            });


const response =
        await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
            {

                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        cached.body
                    )

            }
        );


    const data =
        await response
            .json()
            .catch(
                () => ({})
            );


    if (
        !response.ok &&
        cached.cacheName
    ) {

        // The cache expired or was refused: same call without it.
        console.warn("[CACHE] request rejected, retrying without cache", model, response.status);

        dropContextCache(cached.cacheName);

        return callGemini(
            messages,
            model,
            isDeepResearch,
            {
                ...preferences,
                noContextCache: true
            }
        );

    }


    if (
        !response.ok &&
        response.status === 400 &&
        preferences.thinkingEffort &&
        !preferences.noThinkingConfig
    ) {

        // This model rejected the effort setting: run it without.
        console.warn(
            "[EFFORT] thinking config rejected, retrying without",
            model
        );

        return callGemini(
            messages,
            model,
            isDeepResearch,
            {
                ...preferences,
                noThinkingConfig: true
            }
        );

    }


    if (!response.ok) {

        const error =
            new Error(
                data?.error?.message ||
                `Model request failed (${response.status}).`
            );


        error.status =
            response.status;


        error.model =
            model;


        throw error;

    }


    return data;

}


/* =========================================================
   NORMAL ROUTE + FALLBACK
   ========================================================= */

async function callModelRoute(
    messages,
    route,
    isDeepResearch = false,
    preferences = {}
) {

    try {

        const data =
            await callGemini(
                messages,
                route.primary,
                isDeepResearch,
                preferences
            );


        return {
            data,
            usedFallback: false
        };

    } catch (
        primaryError
    ) {

        if (
            !route.fallback ||
            route.fallback ===
                route.primary
        ) {

            throw primaryError;

        }


        console.warn(
            "[NEYO Model Router] Primary failed, trying fallback:",
            {
                route:
                    route.route,

                message:
                    primaryError?.message
            }
        );


        const data =
            await callGemini(
                messages,
                route.fallback,
                isDeepResearch,
                preferences
            );


        return {
            data,
            usedFallback: true
        };

    }

}


/* =========================================================
   EXTRACT STREAM TEXT
   ========================================================= */

function extractVisibleStreamText(
    data
) {

    const parts =
        data
            ?.candidates?.[0]
            ?.content
            ?.parts;


    if (
        !Array.isArray(parts)
    ) {
        return "";
    }


    return parts
        .filter(
            part =>
                part &&
                part.thought !== true &&
                typeof part.text ===
                    "string"
        )
        .map(
            part =>
                part.text
        )
        .join("");

}


/* =========================================================
   UPSTREAM SSE PARSER
   ========================================================= */

function createSSEParser() {

    let buffer = "";


    function push(chunk) {

        buffer +=
            String(chunk || "")
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n");


        const blocks =
            buffer.split("\n\n");


        buffer =
            blocks.pop() || "";


        const events = [];


        for (
            const block
            of blocks
        ) {

            const dataLines =
                block
                    .split("\n")
                    .filter(
                        line =>
                            line.startsWith(
                                "data:"
                            )
                    )
                    .map(
                        line =>
                            line
                                .slice(5)
                                .replace(/^ /, "")
                    );


            if (
                dataLines.length === 0
            ) {
                continue;
            }


            const raw =
                dataLines
                    .join("\n")
                    .trim();


            if (
                !raw ||
                raw === "[DONE]"
            ) {
                continue;
            }


            try {

                events.push(
                    JSON.parse(raw)
                );

            } catch {

                console.warn(
                    "[NEYO Stream] Malformed upstream SSE event ignored."
                );

            }

        }


        return events;

    }


    function flush() {

        if (!buffer.trim()) {
            return [];
        }


        const remaining =
            buffer;


        buffer = "";


        return push(
            `${remaining}\n\n`
        );

    }


    return {
        push,
        flush
    };

}


/* =========================================================
   STREAM MODEL CALL
   ========================================================= */

async function callGeminiStream(
    messages,
    model,
    isDeepResearch = false,
    preferences = {},
    streamOptions = {}
) {

    const {
        signal,
        onText,
        onHeaders,
        onFirstText,
        onThought
    } = streamOptions;

    if (!GEMINI_API_KEY) {

        throw new Error(
            "Gemini API key is missing."
        );

    }


    const requestStarted =
        Date.now();


    const cached =
        preferences.noContextCache
            ? { body: buildGeminiBody(messages, isDeepResearch, preferences, model), cacheName: null }
            : await applyContextCache({
                apiKey: GEMINI_API_KEY,
                model,
                body: buildGeminiBody(messages, isDeepResearch, preferences, model)
            });


    const response =
        await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(GEMINI_API_KEY)}`,
            {

                method:
                    "POST",

                headers: {

                    "Content-Type":
                        "application/json",

                    Accept:
                        "text/event-stream"

                },

                body:
                    JSON.stringify(
                        cached.body
                    ),

                signal

            }
        );


    const headersMs =
        elapsed(
            requestStarted
        );


    if (
        typeof onHeaders ===
            "function"
    ) {

        onHeaders(
            headersMs,
            model
        );

    }


    if (!response.ok) {

        const raw =
            await response
                .text()
                .catch(
                    () => ""
                );


        let data = {};


        try {
            data =
                JSON.parse(raw);
        } catch {}


        const error =
            new Error(
                data?.error?.message ||
                raw ||
                `Streaming model request failed (${response.status}).`
            );


        error.status =
            response.status;


        error.model =
            model;


        error.emittedText =
            false;


        if (cached.cacheName) {

            // The cache expired or was refused: same call without it.
            console.warn("[CACHE] stream rejected, retrying without cache", model, response.status);

            dropContextCache(cached.cacheName);

            return callGeminiStream(
                messages,
                model,
                isDeepResearch,
                {
                    ...preferences,
                    noContextCache: true
                },
                streamOptions
            );

        }


        if (
            response.status === 400 &&
            preferences.thinkingEffort &&
            !preferences.noThinkingConfig
        ) {

            // This model rejected the effort setting: run it without.
            console.warn(
                "[EFFORT] thinking config rejected, retrying without",
                model,
                error.message
            );

            return callGeminiStream(
                messages,
                model,
                isDeepResearch,
                {
                    ...preferences,
                    noThinkingConfig: true
                },
                streamOptions
            );

        }


        throw error;

    }


    if (
        !response.body ||
        typeof response.body
            .getReader !==
            "function"
    ) {

        const error =
            new Error(
                "Streaming model response body is unavailable."
            );


        error.model =
            model;


        error.emittedText =
            false;


        throw error;

    }


    const reader =
        response.body.getReader();


    const decoder =
        new TextDecoder();


    const parser =
        createSSEParser();


    let reply = "";


    let emittedText = false;


    let firstTextReported =
        false;


    async function processEvents(
        events
    ) {

        for (
            const data
            of events
        ) {

            if (
                typeof onThought ===
                    "function"
            ) {

                const thought =
                    (
                        data
                            ?.candidates?.[0]
                            ?.content
                            ?.parts ||
                        []
                    )
                        .filter(
                            part =>
                                part?.thought === true &&
                                typeof part.text === "string"
                        )
                        .map(
                            part =>
                                part.text
                        )
                        .join("");

                if (thought) {
                    onThought(thought);
                }

            }


            const text =
                extractVisibleStreamText(
                    data
                );


            if (!text) {
                continue;
            }


            if (!firstTextReported) {

                firstTextReported =
                    true;


                if (
                    typeof onFirstText ===
                        "function"
                ) {

                    onFirstText(
                        elapsed(
                            requestStarted
                        ),
                        model
                    );

                }

            }


            emittedText =
                true;


            reply += text;


            if (
                typeof onText ===
                    "function"
            ) {

                await onText(text);

            }

        }

    }


    try {

        while (true) {

            const {
                done,
                value
            } =
                await reader.read();


            if (done) {
                break;
            }


            const chunk =
                decoder.decode(
                    value,
                    {
                        stream:
                            true
                    }
                );


            await processEvents(
                parser.push(chunk)
            );

        }


        const tail =
            decoder.decode();


        if (tail) {

            await processEvents(
                parser.push(tail)
            );

        }


        await processEvents(
            parser.flush()
        );


    } catch (
        error
    ) {

        error.emittedText =
            emittedText;


        error.partialReply =
            reply;


        throw error;


    } finally {

        try {
            await reader.cancel();
        } catch {}

    }


    return {
        reply,
        emittedText
    };

}


/* =========================================================
   STREAM ROUTER
   ========================================================= */

async function callModelRouteStream(
    messages,
    route,
    isDeepResearch = false,
    preferences = {},
    options = {}
) {

    try {

        const result =
            await callGeminiStream(
                messages,
                route.primary,
                isDeepResearch,
                preferences,
                options
            );


        return {
            ...result,
            usedFallback: false
        };


    } catch (
        primaryError
    ) {

        if (
            primaryError?.emittedText ===
                true ||
            !route.fallback ||
            route.fallback ===
                route.primary
        ) {

            throw primaryError;

        }


        console.warn(
            "[NEYO Model Router] Streaming primary failed before output, trying fallback:",
            {
                route:
                    route.route,

                message:
                    primaryError?.message
            }
        );


        const result =
            await callGeminiStream(
                messages,
                route.fallback,
                isDeepResearch,
                preferences,
                options
            );


        return {
            ...result,
            usedFallback: true
        };

    }

}


/* =========================================================
   CLIENT SSE
   ========================================================= */

function writeSSEHeartbeat(
    res
) {

    if (
        res.writableEnded ||
        res.destroyed
    ) {
        return false;
    }


    try {

        res.write(
            `: neyo-heartbeat ${Date.now()}\n\n`
        );


        return true;

    } catch {

        return false;

    }

}


function startSSEResponse(
    res
) {

    res.statusCode =
        200;


    res.setHeader(
        "Content-Type",
        "text/event-stream; charset=utf-8"
    );


    res.setHeader(
        "Cache-Control",
        "no-cache, no-transform"
    );


    res.setHeader(
        "Connection",
        "keep-alive"
    );


    res.setHeader(
        "X-Accel-Buffering",
        "no"
    );


    res.flushHeaders?.();


    writeSSEHeartbeat(res);

}


function writeSSE(
    res,
    data
) {

    if (
        res.writableEnded ||
        res.destroyed
    ) {
        return false;
    }


    try {

        res.write(
            `data: ${JSON.stringify(data)}\n\n`
        );


        return true;

    } catch {

        return false;

    }

}


/* =========================================================
   MODEL FILE HELPERS
   ========================================================= */

async function deleteGeminiFile(
    fileName
) {

    if (
        !GEMINI_API_KEY ||
        !fileName
    ) {
        return;
    }


    try {

        const safeName =
            String(fileName)
                .replace(/^\/+/, "");


        await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${safeName}?key=${encodeURIComponent(GEMINI_API_KEY)}`,
            {
                method:
                    "DELETE"
            }
        );


    } catch (
        error
    ) {

        console.warn(
            "[NEYO File Cleanup]",
            error?.message
        );

    }

}


async function waitForGeminiFile(
    fileName,
    fallbackMimeType
) {

    for (
        let attempt = 0;
        attempt < 60;
        attempt += 1
    ) {

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    2000
                )
        );


        const response =
            await fetch(
                `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${encodeURIComponent(GEMINI_API_KEY)}`
            );


        const data =
            await response
                .json()
                .catch(
                    () => ({})
                );


        if (!response.ok) {

            throw new Error(
                data?.error?.message ||
                "Unable to check model file status."
            );

        }


        if (
            data.state === "ACTIVE"
        ) {

            return {

                name:
                    data.name,

                uri:
                    data.uri,

                mimeType:
                    data.mimeType ||
                    fallbackMimeType

            };

        }


        if (
            data.state === "FAILED"
        ) {

            throw new Error(
                "Model could not process this attachment."
            );

        }

    }


    throw new Error(
        "File processing timed out."
    );

}


async function uploadSupabaseFileToGemini(
    file
) {

    const {
        data:
            storedFile,
        error
    } =
        await supabase
            .storage
            .from(file.bucket)
            .download(file.path);


    if (
        error ||
        !storedFile
    ) {

        throw new Error(
            error?.message ||
            `Unable to read attachment "${file.name}".`
        );

    }


    const bytes =
        Buffer.from(
            await storedFile
                .arrayBuffer()
        );


    if (
        bytes.length === 0
    ) {

        throw new Error(
            `Attachment "${file.name}" is empty.`
        );

    }


    const mimeType =
        file.mimeType ||
        storedFile.type ||
        "application/octet-stream";


    const startResponse =
        await fetch(
            `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(GEMINI_API_KEY)}`,
            {

                method:
                    "POST",

                headers: {

                    "X-Goog-Upload-Protocol":
                        "resumable",

                    "X-Goog-Upload-Command":
                        "start",

                    "X-Goog-Upload-Header-Content-Length":
                        String(
                            bytes.length
                        ),

                    "X-Goog-Upload-Header-Content-Type":
                        mimeType,

                    "Content-Type":
                        "application/json"

                },

                body:
                    JSON.stringify({

                        file: {

                            display_name:
                                file.name ||
                                "NEYO attachment"

                        }

                    })

            }
        );


    if (!startResponse.ok) {

        throw new Error(
            await startResponse
                .text()
                .catch(
                    () =>
                        "Unable to initialize file upload."
                )
        );

    }


    const uploadUrl =
        startResponse
            .headers
            .get(
                "x-goog-upload-url"
            );


    if (!uploadUrl) {

        throw new Error(
            "Model upload URL missing."
        );

    }


    const uploadResponse =
        await fetch(
            uploadUrl,
            {

                method:
                    "POST",

                headers: {

                    "Content-Length":
                        String(
                            bytes.length
                        ),

                    "X-Goog-Upload-Offset":
                        "0",

                    "X-Goog-Upload-Command":
                        "upload, finalize"

                },

                body:
                    bytes

            }
        );


    const payload =
        await uploadResponse
            .json()
            .catch(
                () => ({})
            );


    if (!uploadResponse.ok) {

        throw new Error(
            payload?.error?.message ||
            "Model file upload failed."
        );

    }


    const modelFile =
        payload?.file;


    if (
        !modelFile?.name ||
        !modelFile?.uri
    ) {

        throw new Error(
            "Model file information missing."
        );

    }


    if (
        modelFile.state ===
        "PROCESSING"
    ) {

        return waitForGeminiFile(
            modelFile.name,
            mimeType
        );

    }


    return {

        name:
            modelFile.name,

        uri:
            modelFile.uri,

        mimeType:
            modelFile.mimeType ||
            mimeType

    };

}


/* =========================================================
   URL HELPERS
   ========================================================= */

function extractUrlsFromText(
    text
) {

    if (!text) {
        return [];
    }


    const matches =
        text.match(
            /https?:\/\/[^\s<>"']+/g
        ) || [];


    return matches.filter(
        url => {

            try {

                const parsed =
                    new URL(url);


                const host =
                    parsed.hostname
                        .toLowerCase();


                if (
                    ![
                        "http:",
                        "https:"
                    ].includes(
                        parsed.protocol
                    )
                ) {
                    return false;
                }


                if (
                    host === "localhost" ||
                    host.startsWith("127.") ||
                    host.startsWith("10.") ||
                    host.startsWith("192.168.") ||
                    /^172\.(1[6-9]|2[0-9]|3[0-1])\./
                        .test(host)
                ) {
                    return false;
                }


                return true;

            } catch {

                return false;

            }

        }
    );

}


async function fetchUrlText(
    url,
    maxChars = 12000
) {

    try {

        const controller =
            new AbortController();


        const timeout =
            setTimeout(
                () =>
                    controller.abort(),
                URL_FETCH_TIMEOUT_MS
            );


        let response;


        try {

            response =
                await fetch(
                    url,
                    {
                        redirect:
                            "follow",

                        signal:
                            controller.signal
                    }
                );

        } finally {

            clearTimeout(timeout);

        }


        if (!response.ok) {
            return "";
        }


        const type =
            String(
                response.headers
                    .get(
                        "content-type"
                    ) || ""
            )
                .toLowerCase();


        if (
            !type.includes("text/") &&
            !type.includes(
                "application/xhtml+xml"
            )
        ) {
            return "";
        }


        let text =
            await response.text();


        text =
            text
                .replace(
                    /<script[\s\S]*?<\/script>/gi,
                    " "
                )
                .replace(
                    /<style[\s\S]*?<\/style>/gi,
                    " "
                )
                .replace(
                    /<[^>]+>/g,
                    " "
                )
                .replace(
                    /\s+/g,
                    " "
                )
                .trim();


        return text.slice(
            0,
            maxChars
        );


    } catch {

        return "";

    }

}


async function buildUrlContextMessages(
    query,
    urls
) {

    const contextParts =
        await Promise.all(
            urls.map(
                async url => ({
                    url,
                    content:
                        await fetchUrlText(url)
                })
            )
        );


    const context =
        contextParts
            .map(
                (
                    item,
                    index
                ) =>
                    `[URL ${index + 1}]\n${item.url}\n\n${item.content}`
            )
            .join("\n\n");


    return [
        {
            role:
                "user",

            parts: [
                {
                    text:
`${query}

Use the following URL content when relevant.

${context}`
                }
            ]
        }
    ];

}


/* =========================================================
   DEEP RESEARCH (own search + scraping, lib/deep-research.js)
   ========================================================= */

const DEEP_RESEARCH_PLANNER_MODEL =
    cleanEnv(
        process.env.NEYO_RESEARCH_PLANNER_MODEL
    ) ||
    NEYO_FREE_FALLBACK_MODEL;

const SEARCH_ROUTER_MODEL =
    cleanEnv(
        process.env.NEYO_SEARCH_ROUTER_MODEL
    ) ||
    DEEP_RESEARCH_PLANNER_MODEL;

const ANSWER_CHECK_MODEL =
    cleanEnv(
        process.env.NEYO_ANSWER_CHECK_MODEL
    ) ||
    NEYO_FREE_FALLBACK_MODEL;

const DEEP_RESEARCH_GROUNDING_MODEL =
    cleanEnv(
        process.env.NEYO_RESEARCH_GROUNDING_MODEL
    ) ||
    "gemini-2.5-flash-lite";


// Greetings / thanks / "ok" need no tools: answer at once.
const SMALL_TALK_WORDS =
    /^(hi+|hii+|hello+|hey+|hy|helo|salam|salaam|assalam ?o ?alaikum|assalamualaikum|aoa|slm|walaikum ?assalam|thanks?|thank you|thank u|thnx|thx|ty|shukriya|shukria|jazakallah|jazak allah|good|nice|great|cool|wow|lol|haha+|hehe+|bye|allah hafiz|khuda hafiz|good (morning|night|evening|afternoon)|kaise ho|kese ho|kaisi ho|kesi ho|kya haal hai|kia haal hai|how are you|how r u|what'?s up|sup)( (neyo|zadi|wizi|crony|yaar|yar|bhai|dost|jani|ji))*$/i;

function isSmallTalk(
    text = ""
) {

    const clean =
        String(text)
            .toLowerCase()
            .replace(/[^\p{L}\p{N}' ]+/gu, " ")
            .replace(/\s+/g, " ")
            .trim();

    return (
        clean.length > 0 &&
        clean.length <= 40 &&
        SMALL_TALK_WORDS.test(clean)
    );

}


async function applyDeepResearch(
    messages,
    userText,
    onStatus = () => {},
    mode = "deep",
    extra = {}
) {

    const live =
        mode === "live";

    // Zero-token decision (plain rules, no AI call): skip the
    // tool planner when it is clearly not needed, and pick effort.
    const lastParts =
        Array.isArray(messages) && messages.length
            ? messages[messages.length - 1]?.parts || []
            : [];

    const decision =
        decideLocally(
            userText,
            {
                hasAttachments:
                    lastParts.some(part => part.fileData || part.inlineData),
                smallTalk:
                    isSmallTalk(userText)
            }
        );

    if (live) {
        console.log("[DECIDE]", decision.lane, decision.effort, decision.reason);
    }

    if (
        live &&
        decision.lane === "direct"
    ) {

        return {
            messages,
            sources: [],
            effort: decision.effort,
            lane: "direct"
        };

    }

    const list =
        Array.isArray(messages)
            ? messages.map(
                message => ({
                    ...message,
                    parts:
                        Array.isArray(message.parts)
                            ? message.parts.map(
                                part => ({ ...part })
                            )
                            : []
                })
            )
            : [];

    const context =
        list
            .slice(-5, -1)
            .map(
                message =>
                    `${message.role === "model" ? "Assistant" : "User"}: ` +
                    message.parts
                        .map(part => part.text || "")
                        .join(" ")
                        .slice(0, 600)
            )
            .join("\n");

    let research = null;

    let routed = null;

    // Tool results kept when the second check sends us to live search.
    let carried = null;

    let carriedEffort = "";

    // NEW: the model itself picks and chains tools (search, maths,
    // currency, weather, time, read page, its own Python code).
    if (
        live &&
        cleanEnv(process.env.NEYO_TOOL_AGENT).toLowerCase() !== "off"
    ) {

        try {

            const agent =
                await runToolAgent({
                    question:
                        userText,
                    context,
                    apiKey:
                        GEMINI_API_KEY,
                    model:
                        cleanEnv(process.env.NEYO_TOOL_AGENT_MODEL) ||
                        SEARCH_ROUTER_MODEL,
                    plannerModel:
                        DEEP_RESEARCH_PLANNER_MODEL,
                    groundingModel:
                        DEEP_RESEARCH_GROUNDING_MODEL,
                    onStatus
                });

            // Rules spotted a hard question -> think, whatever the planner said.
            if (decision.effort === "high") {
                agent.effort = "high";
            }

            const agentSearched =
                (agent.calls || []).some(
                    name => name === "web_search" || name === "lookup_law"
                );

            // Second opinion: the tool planner did not search. If the
            // search router thinks fresh facts are needed (latest, top,
            // named products, AI models...), search anyway so the
            // answer is not built on old memory.
            if (!agentSearched) {
                const second =
                    await decideSearch({
                        question:
                            userText,
                        context,
                        apiKey:
                            GEMINI_API_KEY,
                        model:
                            SEARCH_ROUTER_MODEL
                    }).catch(() => null);

                console.log(
                    "[SEARCH_SECOND_CHECK]",
                    second?.by,
                    second?.search,
                    (second?.queries || []).join(" | ")
                );

                if (second?.search) {
                    routed = second;
                    carried = agent.used ? agent : null;
                    carriedEffort = agent.effort || "";
                    onStatus("searching", {
                        queries:
                            routed.queries
                    });
                }
            }

            if (!routed && !agent.used) {
                return {
                    messages,
                    sources: [],
                    effort:
                        agent.effort || "low",
                    lane: decision.lane
                };
            }

            if (!routed) {

            const agentPrompt =
                agent.research?.contextText
                    ? buildLiveSearchPrompt(
                        userText,
                        {
                            contextText:
                                agent.toolText +
                                agent.research.contextText
                        }
                    )
                    : `${userText}\n\n${agent.toolText}\nThese tool results were computed just now and are exact: use them, follow any rules above, and never contradict them. Do not mention the tools by name.` +
                        (agentSearched ? `\n\n${WEAK_SEARCH_NOTE}` : "");

            let agentLast =
                list[list.length - 1];

            if (
                !agentLast ||
                agentLast.role !== "user"
            ) {
                agentLast = {
                    role: "user",
                    parts: []
                };
                list.push(agentLast);
            }

            const agentTextPart =
                agentLast.parts.find(
                    part =>
                        typeof part.text === "string"
                );

            if (agentTextPart) {
                agentTextPart.text =
                    agentTextPart.text.includes(userText) && userText
                        ? agentTextPart.text.replace(userText, agentPrompt)
                        : `${agentTextPart.text}\n\n${agentPrompt}`;
            } else {
                agentLast.parts.unshift({
                    text: agentPrompt
                });
            }

            return {
                messages:
                    list,
                sources:
                    agent.sources || [],
                evidence:
                    agent.research?.contextText
                        ? agent.toolText + agent.research.contextText
                        : "",
                effort:
                    agent.effort || "low"
            };

            }

        } catch (error) {

            console.warn(
                "[TOOL_AGENT_FALLBACK]",
                error?.message || error
            );

        }

    }

    if (live && !routed) {

        routed =
            await decideSearch({
                question:
                    userText,
                context,
                apiKey:
                    GEMINI_API_KEY,
                model:
                    SEARCH_ROUTER_MODEL
            }).catch(() => null);

        console.log(
            "[SEARCH_ROUTER]",
            routed?.by,
            routed?.search,
            routed?.hard ? "hard" : "simple",
            (routed?.queries || []).join(" | ")
        );

        if (!routed?.search) {
            return {
                messages,
                sources: []
            };
        }

        onStatus("searching", {
            queries:
                routed.queries
        });

    }

    try {

        research =
            await (live ? runLiveSearch : runDeepResearch)({
                question:
                    userText,
                context,
                apiKey:
                    GEMINI_API_KEY,
                plannerModel:
                    DEEP_RESEARCH_PLANNER_MODEL,
                groundingModel:
                    DEEP_RESEARCH_GROUNDING_MODEL,
                options:
                    routed
                        ? {
                            queries:
                                routed.queries,
                            news:
                                routed.news,
                            hard:
                                routed.hard
                        }
                        : undefined,
                onStatus
            });

    } catch (error) {

        console.error(
            "[DEEP_RESEARCH_FAILED]",
            error?.message || error
        );

    }

    // Live search found nothing: say so to the model (old knowledge
    // must not be passed off as the latest). buildLiveSearchPrompt
    // adds WEAK_SEARCH_NOTE when there is no research.
    const prompt =
        (carried?.toolText
            ? `${carried.toolText}\nThese tool results were computed just now and are exact: use them and never contradict them. Do not mention the tools by name.\n\n`
            : "") +
        (live
            ? buildLiveSearchPrompt(
                userText,
                research
            )
            : buildResearchPrompt(
                userText,
                research
            ));

    let last =
        list[list.length - 1];

    if (
        !last ||
        last.role !== "user"
    ) {
        last = {
            role: "user",
            parts: []
        };
        list.push(last);
    }

    const textPart =
        last.parts.find(
            part =>
                typeof part.text === "string"
        );

    if (textPart) {
        textPart.text =
            textPart.text.includes(userText) && userText
                ? textPart.text.replace(userText, prompt)
                : `${textPart.text}\n\n${prompt}`;
    } else {
        last.parts.unshift({
            text: prompt
        });
    }

    return {
        messages:
            list,
        sources:
            [
                ...(carried?.sources || []),
                ...(research?.sources || [])
            ],
        evidence:
            research?.contextText
                ? (carried?.toolText || "") + research.contextText
                : "",
        ...(carriedEffort
            ? { effort: decision.effort === "high" ? "high" : carriedEffort }
            : {})
    };

}


/* =========================================================
   SAVE MESSAGE
   ========================================================= */

async function saveMessage(
    conversationId,
    role,
    content,
    attachments = [],
    sources = []
) {

    if (!conversationId) {
        return;
    }


    const base = {

        conversation_id:
            conversationId,

        role,

        content:
            cleanString(content)

    };


    const full = {

        ...base,

        attachments:
            Array.isArray(attachments)
                ? attachments
                : [],

        sources:
            Array.isArray(sources)
                ? sources
                : []

    };


    const {
        error
    } =
        await supabase
            .from(
                "chat_messages"
            )
            .insert(full);


    if (!error) {
        return;
    }


    if (
        /attachments|sources/i
            .test(
                error.message || ""
            )
    ) {

        const {
            error:
                fallbackError
        } =
            await supabase
                .from(
                    "chat_messages"
                )
                .insert(base);


        if (fallbackError) {
            throw fallbackError;
        }


        return;

    }


    throw error;

}


/* =========================================================
   EXTRACT NORMAL REPLY
   ========================================================= */

function extractFinalReply(
    parts
) {

    if (
        !Array.isArray(parts)
    ) {
        return "";
    }


    return parts
        .filter(
            part =>
                part &&
                part.thought !== true &&
                typeof part.text ===
                    "string" &&
                part.text.trim()
        )
        .map(
            part =>
                part.text
        )
        .join("")
        .trim();

}


/* =========================================================
   MAIN
   ========================================================= */

export default async function handler(
    req,
    res
) {

    const totalStarted =
        Date.now();


    let userMessageSaved =
        Promise.resolve();


    let userId =
        null;


    let reservedType =
        null;


    let streamResponseStarted =
        false;


    let streamCompleted =
        false;


    let streamAbortController =
        null;


    let streamHeartbeatTimer =
        null;


    const geminiFiles =
        [];


    if (
        req.method !== "POST"
    ) {

        res.setHeader(
            "Allow",
            "POST"
        );


        return res
            .status(405)
            .json({
                error:
                    "Method not allowed"
            });

    }


    try {

        /* =================================================
           AUTH
           ================================================= */

        const authStarted =
            Date.now();


        const auth =
            await getAuthenticatedUser(
                req
            );


        logTiming(
            "AUTH_MS",
            elapsed(authStarted)
        );


        if (!auth?.userId) {

            return res
                .status(401)
                .json({
                    error:
                        "Authentication required. Please log in."
                });

        }


        userId =
            auth.userId;


        /* =================================================
           BODY
           ================================================= */

        const body =
            req.body &&
            typeof req.body ===
                "object"
                ? req.body
                : {};


        const messages =
            Array.isArray(
                body.messages
            )
                ? body.messages
                : [];


        if (
            messages.length === 0
        ) {

            return res
                .status(400)
                .json({
                    error:
                        "Messages array required"
                });

        }


        const lastMsg =
            messages[
                messages.length - 1
            ];


        if (
            !lastMsg ||
            lastMsg.role !== "user"
        ) {

            return res
                .status(400)
                .json({
                    error:
                        "Last message must be user"
                });

        }


        // ZERO-TRUST PRIVACY: scrub keys, passwords, cards, IDs and
        // mask emails / phones before anything leaves this server.
        // The real text is kept only for saving in the user's own DB.
        const originalUserText =
            cleanString(
                lastMsg.content || ""
            );

        const privacy =
            createPrivacySession();

        messages.forEach(message => {
            if (
                message &&
                typeof message.content === "string"
            ) {
                message.content =
                    privacy.scrub(message.content);
            }
        });

        if (privacy.changed) {
            console.log("[PRIVACY] masked", privacy.counts);
        }


        const preferences = {

            intelligence:
                normalizeIntelligence(
                    body.intelligence
                ),

            language:
                normalizeLanguage(
                    body.language
                ),

            personality:
                normalizePersonality(
                    body.personality
                ),

            workspace:
                normalizeWorkspace(
                    body.workspace,
                    privacy
                ),

            memoryOff:
                body.memoryOff === true

        };


        const privateChat =
            normalizePrivateChat(
                body.privateChat
            );

        // Settings > Memory switched off: NEYO neither reads nor saves memory.
        const memoryOff =
            body.memoryOff === true;


        // NEYO Workspace picked in the composer: its project, members,
        // tasks, decisions, notes and files become context for NEYO.
        if (body.workspaceId) {
            const lastUserText =
                [...messages].reverse().find(m => m?.role === "user")?.content || "";
            const wsContext =
                await loadWorkspaceContext(
                    String(body.workspaceId),
                    userId,
                    typeof lastUserText === "string" ? lastUserText : ""
                );
            if (wsContext?.text) {
                preferences.workspaceContext =
                    privacy.scrub(wsContext.text);
                preferences.workspaceCanSuggest =
                    wsContext.role !== "viewer";
                console.log("[WORKSPACE] context", wsContext.name, wsContext.text.length);
            }
        }


        const isDeepResearch =
            Boolean(
                body.isDeepResearch
            );


        /* =================================================
           CREDIT
           ================================================= */

        const creditStarted =
            Date.now();


        const {
            data:
                reserveResult,
            error:
                reserveError
        } =
            await supabase
                .rpc(
                    "reserve_message",
                    {
                        p_user_id:
                            userId
                    }
                );


        logTiming(
            "CREDIT_MS",
            elapsed(creditStarted)
        );


        if (reserveError) {

            throw new Error(
                "Unable to check message credits."
            );

        }


        reservedType =
            reserveResult;


        if (
            reservedType === "limit"
        ) {

            return res
                .status(429)
                .json({
                    error:
                        "MESSAGE_LIMIT_REACHED",

                    creditsRemaining:
                        0
                });

        }


        if (
            ![
                "pro",
                "free",
                "reward"
            ].includes(
                reservedType
            )
        ) {

            throw new Error(
                "Invalid credit reservation response."
            );

        }


        const isPro =
            reservedType === "pro";


        /* =================================================
           PREPARATION
           ================================================= */

        const prepStarted =
            Date.now();


        const bodyAttachments =
            Array.isArray(
                body.attachments
            )
                ? body.attachments
                : [];


        const messageAttachments =
            Array.isArray(
                lastMsg.attachments
            )
                ? lastMsg.attachments
                : [];


        const rawAttachments =
            bodyAttachments.length > 0
                ? bodyAttachments
                : messageAttachments;


        const attachments =
            validAttachmentList(
                rawAttachments,
                userId
            );


        const userText =
            cleanString(
                lastMsg.content || ""
            );


        const autoEffort =
            detectAutomaticEffort(
                userText
            );


        const historyBudget =
            getHistoryBudget({
                autoEffort,
                isDeepResearch,
                attachments
            });


        const history =
            selectHistoryMessages(
                messages,
                {
                    maxMessages:
                        historyBudget.messages,

                    maxChars:
                        historyBudget.chars
                }
            );


        console.log(
            "[NEYO History]",
            {
                effort:
                    autoEffort,

                budgetMessages:
                    historyBudget.messages,

                budgetChars:
                    historyBudget.chars,

                selectedMessages:
                    history.length,

                selectedChars:
                    history.reduce(
                        (
                            total,
                            message
                        ) =>
                            total +
                            String(
                                message?.content ||
                                ""
                            ).length,
                        0
                    )
            }
        );


        const modelRoute =
            selectModelRoute({
                isPro,
                attachments,
                preferences,
                isDeepResearch,
                autoEffort
            });


        console.log(
            "[NEYO Model Router]",
            {
                plan:
                    isPro
                        ? "leverage"
                        : "free",

                route:
                    modelRoute.route,

                effort:
                    autoEffort,

                multimodal:
                    attachments.length > 0
            }
        );


        const geminiMessages =
            history.map(
                message => ({
                    role:
                        message.role ===
                            "assistant"
                            ? "model"
                            : "user",

                    parts: [
                        {
                            text:
                                cleanString(
                                    message.content ||
                                    ""
                                )
                        }
                    ]
                })
            );


        if (
            geminiMessages.length === 0
        ) {

            geminiMessages.push({
                role:
                    "user",

                parts: [
                    {
                        text:
                            userText ||
                            "Please respond to the user."
                    }
                ]
            });

        }


        /* =================================================
           ATTACHMENTS
           ================================================= */

        if (
            attachments.length > 0
        ) {

            const preparedFiles =
                await Promise.all(
                    attachments.map(
                        file =>
                            uploadSupabaseFileToGemini(
                                file
                            )
                    )
                );


            const lastModelMessage =
                geminiMessages[
                    geminiMessages.length -
                    1
                ];


            const fileParts =
                preparedFiles
                    .filter(Boolean)
                    .map(
                        file => {

                            geminiFiles.push(
                                file.name
                            );


                            return {

                                fileData: {

                                    mimeType:
                                        file.mimeType,

                                    fileUri:
                                        file.uri

                                }

                            };

                        }
                    );


            lastModelMessage.role =
                "user";


            lastModelMessage.parts = [

                {
                    text:
                        userText ||
                        "Please analyze the attached file."
                },

                ...fileParts

            ];

        }


        const urls =
            extractUrlsFromText(
                userText
            );


        logTiming(
            "PREP_MS",
            elapsed(prepStarted),
            {
                effort:
                    autoEffort,

                historyMessages:
                    history.length,

                attachments:
                    attachments.length,

                urls:
                    urls.length
            }
        );


        /* =================================================
           CONVERSATION
           ================================================= */

        let conversationId =
            privateChat
                ? null
                : cleanString(
                    body.conversationId ||
                    "",
                    128
                ) ||
                null;


        if (
            !privateChat &&
            conversationId
        ) {

            const {
                data:
                    existingConversation,
                error:
                    conversationLookupError
            } =
                await supabase
                    .from(
                        "chat_conversations"
                    )
                    .select(
                        "id,user_id"
                    )
                    .eq(
                        "id",
                        conversationId
                    )
                    .eq(
                        "user_id",
                        userId
                    )
                    .maybeSingle();


            if (
                conversationLookupError
            ) {

                throw conversationLookupError;

            }


            if (
                !existingConversation
            ) {

                console.warn(
                    "[NEYO Chat] Invalid/stale conversation ID ignored:",
                    conversationId
                );


                conversationId =
                    null;

            }

        }


        if (
            !privateChat &&
            !conversationId
        ) {

            const {
                data:
                    conversationRow,
                error
            } =
                await supabase
                    .from(
                        "chat_conversations"
                    )
                    .insert({

                        user_id:
                            userId,

                        title:
                            cleanString(
                                body.title ||
                                originalUserText ||
                                attachments[0]
                                    ?.name ||
                                "New conversation",
                                100
                            ) ||
                            "New conversation"

                    })
                    .select("id")
                    .single();


            if (error) {
                throw error;
            }


            conversationId =
                conversationRow.id;

        }


        // Saved in the background; awaited before the reply is saved
        // so the order in history stays user -> assistant.
        userMessageSaved =
            privateChat
                ? Promise.resolve()
                : saveMessage(
                    conversationId,
                    "user",
                    originalUserText ||
                    "Attachment",
                    attachments,
                    []
                ).catch(error => {
                    console.error(
                        "[NEYO Chat] user message save failed:",
                        error?.message || error
                    );
                });


        /* =================================================
           STREAMING
           ================================================= */

        if (
            body.stream === true
        ) {

            streamAbortController =
                new AbortController();


            res.on(
                "close",
                () => {

                    if (
                        streamHeartbeatTimer
                    ) {

                        clearInterval(
                            streamHeartbeatTimer
                        );


                        streamHeartbeatTimer =
                            null;

                    }


                    if (
                        !streamCompleted &&
                        !streamAbortController
                            .signal
                            .aborted
                    ) {

                        try {

                            streamAbortController
                                .abort();

                        } catch {}

                    }

                }
            );


            let streamMessages =
                geminiMessages;


            let sources = [];

            let researchEvidence = "";


            let usedUrlContext =
                false;


            if (
                attachments.length === 0 &&
                urls.length > 0
            ) {

                const limitedUrls =
                    urls.slice(
                        0,
                        MAX_URL_CONTEXT_SOURCES
                    );


                streamMessages =
                    await buildUrlContextMessages(
                        userText,
                        limitedUrls
                    );


                sources =
                    limitedUrls.map(
                        url => ({
                            title: url,
                            url
                        })
                    );


                usedUrlContext =
                    true;

            }


            startSSEResponse(res);


            streamResponseStarted =
                true;


            // Where the time goes (sent to the browser console).
            const timing = {
                beforeStreamMs:
                    elapsed(totalStarted)
            };

            // Tell the client what NEYO is doing so the
            // character thinking indicator can follow it.
            writeSSE(
                res,
                {
                    type:
                        "status",
                    stage:
                        isDeepResearch
                            ? "research"
                            : usedUrlContext
                                ? "links"
                                : attachments.length > 0
                                    ? (
                                        attachments.every(
                                            item =>
                                                String(
                                                    item?.mime ||
                                                    item?.mimeType ||
                                                    item?.type ||
                                                    ""
                                                ).startsWith(
                                                    "image/"
                                                )
                                        )
                                            ? "image"
                                            : "files"
                                    )
                                    : "thinking"
                }
            );

            const wantsLiveSearch =
                !isDeepResearch &&
                attachments.length === 0 &&
                !usedUrlContext &&
                preferences.workspace?.tools !== "off";

            // Effort dial for the writer: "high" = think first, "low" = answer
            // at once. The planner decides; heavy tools force "high".
            let writerEffort =
                isDeepResearch ||
                autoEffort === "deep" ||
                attachments.length > 0
                    ? "high"
                    : "";

            // MEMORY BOX: saved chunks + facts for this user (0 tokens).
            // The model sees the key list; AUTO_PASTE markers expand here.
            const emptyMemory =
                { box: new Map(), prompt: "" };

            const memoryPromise =
                privateChat || memoryOff
                    ? Promise.resolve(emptyMemory)
                    : loadMemoryBox(
                        supabase,
                        {
                            userId,
                            question:
                                originalUserText,
                            scrub:
                                privacy.scrub
                        }
                    ).catch(() => emptyMemory);

            let packHit =
                null;

            let packChunks =
                [];

            if (
                !packHit &&
                (
                    isDeepResearch ||
                    wantsLiveSearch
                ) &&
                attachments.length === 0 &&
                userText
            ) {

                const researched =
                    await applyDeepResearch(
                        streamMessages,
                        userText,
                        (stage, info = {}) =>
                            writeSSE(
                                res,
                                {
                                    type:
                                        "status",
                                    stage:
                                        stage === "planning" &&
                                        !isDeepResearch
                                            ? "searching"
                                            : stage,
                                    count:
                                        info.count,
                                    queries:
                                        info.queries
                                }
                            ),
                        isDeepResearch
                            ? "deep"
                            : "live",
                        {
                            userId,
                            privateChat
                        }
                    );

                streamMessages =
                    researched.messages;

                researchEvidence =
                    researched.evidence || "";

                timing.toolsMs =
                    elapsed(totalStarted) -
                    timing.beforeStreamMs;

                if (researched.lane) {
                    timing.lane =
                        researched.lane;
                }

                if (
                    researched.effort &&
                    !writerEffort
                ) {
                    writerEffort =
                        researched.effort;
                }

                sources = [
                    ...sources,
                    ...researched.sources
                ];

                // Accuracy: hard questions answered from web results
                // (comparisons, rankings, exact numbers) go to the
                // bigger writer, which joins sources more carefully.
                if (
                    shouldUpgradeForGrounding({
                        question:
                            userText,
                        sourceCount:
                            researched.sources.length,
                        effort:
                            researched.effort,
                        isDeepResearch,
                        currentModel:
                            modelRoute.primary,
                        advancedModel:
                            NEYO_LEVERAGE_ADVANCED_MODEL,
                        setting:
                            process.env.NEYO_GROUNDED_UPGRADE
                    })
                ) {
                    modelRoute.fallback =
                        modelRoute.primary;
                    modelRoute.primary =
                        NEYO_LEVERAGE_ADVANCED_MODEL;
                    modelRoute.route =
                        `${modelRoute.route}+grounded`;
                    timing.groundedUpgrade = true;
                }

            }


            streamHeartbeatTimer =
                setInterval(
                    () => {

                        const alive =
                            writeSSEHeartbeat(
                                res
                            );


                        if (
                            !alive &&
                            streamHeartbeatTimer
                        ) {

                            clearInterval(
                                streamHeartbeatTimer
                            );


                            streamHeartbeatTimer =
                                null;

                        }

                    },
                    STREAM_HEARTBEAT_MS
                );


            streamHeartbeatTimer
                .unref
                ?.();


            let firstTokenLogged =
                false;


            const modelStarted =
                Date.now();


            if (!writerEffort) {
                writerEffort =
                    autoEffort === "light"
                        ? "low"
                        : "high";
            }

            timing.effort =
                writerEffort;

            const memoryLoaded =
                packHit
                    ? emptyMemory
                    : await memoryPromise;

            const memoryPrompt =
                memoryLoaded.prompt;

            if (memoryPrompt) {

                const lastMemory =
                    streamMessages[streamMessages.length - 1];

                if (lastMemory?.role === "user") {
                    streamMessages = [
                        ...streamMessages.slice(0, -1),
                        {
                            ...lastMemory,
                            parts: [
                                ...(lastMemory.parts || []),
                                { text: memoryPrompt }
                            ]
                        }
                    ];
                }

            }

            // AUTO_COPY: memory signals are cut out of the live text.
            const signalFilter =
                createMemoryFilter(
                    memoryLoaded.box
                );

            let thoughtChars =
                0;

            // Put masked emails / phones back as the answer streams.
            const privacyStream =
                privacy.createStreamRestorer();

            const sendPackHit =
                () => {

                    for (
                        let index = 0;
                        index < packHit.length;
                        index += 160
                    ) {
                        writeSSE(
                            res,
                            {
                                type:
                                    "delta",
                                content:
                                    packHit.slice(index, index + 160)
                            }
                        );
                    }

                    return {
                        reply:
                            packHit,
                        usedFallback:
                            false
                    };

                };

            const streamResult =
                packHit
                    ? sendPackHit()
                    : await callModelRouteStream(
                    streamMessages,
                    modelRoute,
                    isDeepResearch,
                    {
                        ...preferences,
                        thinkingEffort:
                            writerEffort
                    },
                    {

                        // Live thinking: short pieces of the model's
                        // thoughts while it works.
                        onThought:
                            thought => {

                                if (
                                    thoughtChars > 6000
                                ) {
                                    return;
                                }

                                thoughtChars +=
                                    thought.length;

                                writeSSE(
                                    res,
                                    {
                                        type:
                                            "thought",
                                        content:
                                            privacy.restore(
                                                thought.slice(0, 600)
                                            )
                                    }
                                );

                            },


                        signal:
                            streamAbortController
                                .signal,


                        onHeaders:
                            (
                                ms,
                                model
                            ) => {

                                logTiming(
                                    "MODEL_HEADERS_MS",
                                    ms,
                                    {
                                        route:
                                            modelRoute.route,

                                        model
                                    }
                                );

                            },


                        onFirstText:
                            (
                                ms,
                                model
                            ) => {

                                if (
                                    firstTokenLogged
                                ) {
                                    return;
                                }


                                firstTokenLogged =
                                    true;

                                timing.firstTokenMs =
                                    elapsed(
                                        totalStarted
                                    );


                                logTiming(
                                    "FIRST_TOKEN_MS",
                                    elapsed(
                                        totalStarted
                                    ),
                                    {
                                        modelRequestMs:
                                            ms,

                                        route:
                                            modelRoute.route,

                                        model
                                    }
                                );

                            },


                        onText:
                            text => {

                                const safeText =
                                    privacyStream.push(
                                        signalFilter.push(text)
                                    );

                                if (!safeText) {
                                    return;
                                }

                                writeSSE(
                                    res,
                                    {
                                        type:
                                            "delta",

                                        content:
                                            safeText
                                    }
                                );

                            }

                    }
                );


            logTiming(
                "MODEL_TOTAL_MS",
                elapsed(modelStarted),
                {
                    route:
                        modelRoute.route,

                    fallback:
                        streamResult
                            .usedFallback
                }
            );


            const privacyTail =
                packHit
                    ? ""
                    : privacyStream.push(
                        signalFilter.flush()
                    ) +
                    privacyStream.flush();

            if (privacyTail) {
                writeSSE(
                    res,
                    {
                        type:
                            "delta",
                        content:
                            privacyTail
                    }
                );
            }

            const signals =
                applyMemoryMarkers(
                    streamResult.reply,
                    memoryLoaded.box
                );

            let reply =
                privacy.restore(
                    signals.text
                );

            // ANSWER CHECK: an answer written from web results is
            // read again next to the same evidence; unsupported
            // pieces are fixed and the browser gets the fixed text.
            if (
                reply &&
                researchEvidence &&
                sources.length &&
                answerCheckEnabled(process.env.NEYO_ANSWER_CHECK)
            ) {
                writeSSE(
                    res,
                    { type: "check", state: "checking" }
                );
                const checkStarted =
                    Date.now();
                const checked =
                    await verifyAnswer({
                        question:
                            userText,
                        answer:
                            reply,
                        evidence:
                            researchEvidence,
                        apiKey:
                            GEMINI_API_KEY,
                        model:
                            ANSWER_CHECK_MODEL
                    });
                timing.checkMs =
                    elapsed(checkStarted);
                timing.checkFixes =
                    checked.fixes;
                if (checked.fixes && checked.text) {
                    reply =
                        checked.text;
                    writeSSE(
                        res,
                        {
                            type: "check",
                            state: "revised",
                            fixes: checked.fixes,
                            text: reply
                        }
                    );
                } else {
                    writeSSE(
                        res,
                        {
                            type: "check",
                            state:
                                checked.checked
                                    ? "ok"
                                    : "skipped"
                        }
                    );
                }
            }

            // AUTO_COPY: the writer's signals; if it forgot and the user
            // clearly told a fact, one tiny backup call extracts it.
            const memorySaved =
                privateChat || memoryOff || !memoryEnabled()
                    ? null
                    : (async () => {
                        const boxKeys =
                            [...memoryLoaded.box.keys()];
                        const copies =
                            resolveForgets(
                                signals.copies,
                                boxKeys
                            );
                        const forgetAsked =
                            wantsForget(userText);
                        if (
                            !forgetAsked &&
                            !copies.some(copy => copy.chunk) &&
                            !signals.pastes.length &&
                            !isDeepResearch
                        ) {
                            copies.push(
                                ...autoCodeCopies(
                                    signals.text,
                                    userText
                                )
                            );
                        }
                        if (
                            !forgetAsked &&
                            !copies.some(copy => !copy.chunk && !copy.forget) &&
                            (
                                looksLikeFact(userText) ||
                                wantsRemember(userText)
                            )
                        ) {
                            copies.push(
                                ...await extractFactsWithModel({
                                    apiKey:
                                        GEMINI_API_KEY,
                                    model:
                                        NEYO_FREE_FALLBACK_MODEL,
                                    userText
                                })
                            );
                        }
                        if (
                            forgetAsked &&
                            !copies.some(copy => copy.forget)
                        ) {
                            copies.push(
                                ...resolveForgets(
                                    await pickKeysToForget({
                                    apiKey:
                                        GEMINI_API_KEY,
                                    model:
                                        NEYO_FREE_FALLBACK_MODEL,
                                    userText,
                                    keys:
                                        boxKeys
                                    }),
                                    boxKeys
                                )
                            );
                        }
                        const used =
                            [
                                ...signals.pastes,
                                ...(memoryLoaded.openedKeys || [])
                            ];
                        const [result] =
                            await Promise.all([
                                copies.length
                                    ? saveMemories(
                                        supabase,
                                        {
                                            userId,
                                            copies,
                                            restore:
                                                privacy.restore
                                        }
                                    )
                                    : { saved: [], forgot: [] },
                                used.length
                                    ? touchMemories(
                                        supabase,
                                        { userId, keys: used }
                                    )
                                    : null
                            ]);
                        return result;
                    })().catch(error => {
                        console.warn("[MEMORY] save error", error?.message || error);
                        return null;
                    });

            let memoryResult =
                null;

            const workspaceSuggested =
                preferences.workspaceCanSuggest
                    ? saveSuggestionsFor(
                        body.workspaceId,
                        userId,
                        signals.actions,
                        privacy.restore
                    ).catch(() => null)
                    : Promise.resolve(null);


            if (!reply) {

                throw new Error(
                    "NEYO returned an empty response."
                );

            }


            timing.modelMs =
                elapsed(modelStarted);



            if (!privateChat) {

                await userMessageSaved;

                [memoryResult] = await Promise.all([
                    memorySaved,
                    saveMessage(
                        conversationId,
                        "assistant",
                        reply,
                        [],
                        sources
                    ),
                ]);

            }


            if (
                streamHeartbeatTimer
            ) {

                clearInterval(
                    streamHeartbeatTimer
                );


                streamHeartbeatTimer =
                    null;

            }


            writeSSE(
                res,
                {
                    type:
                        "done",

                    done:
                        true,

                    conversationId:
                        privateChat
                            ? null
                            : conversationId,

                    privateChat,

                    sources,

                    usedUrlContext,

                    privacy:
                        privacy.changed
                            ? privacy.counts
                            : null,

                    workspace:
                        await workspaceSuggested,

                    memory:
                        memoryResult &&
                        (
                            memoryResult.saved?.length ||
                            memoryResult.forgot?.length
                        )
                            ? memoryResult
                            : null,

                    creditType:
                        reservedType,

                    timing: {
                        ...timing,
                        totalMs:
                            elapsed(totalStarted)
                    }
                }
            );


            streamCompleted =
                true;


            if (
                !res.writableEnded &&
                !res.destroyed
            ) {

                res.write(
                    "data: [DONE]\n\n"
                );


                res.end();

            }


            logTiming(
                "TOTAL_MS",
                elapsed(totalStarted),
                {
                    streaming:
                        true,

                    route:
                        modelRoute.route
                }
            );


            return;

        }


        /* =================================================
           NON-STREAMING
           ================================================= */

        let normalMessages =
            geminiMessages;


        let sources = [];

        let researchEvidence = "";


        let usedUrlContext =
            false;


        if (
            attachments.length === 0 &&
            urls.length > 0
        ) {

            const limitedUrls =
                urls.slice(
                    0,
                    MAX_URL_CONTEXT_SOURCES
                );


            normalMessages =
                await buildUrlContextMessages(
                    userText,
                    limitedUrls
                );


            sources =
                limitedUrls.map(
                    url => ({
                        title: url,
                        url
                    })
                );


            usedUrlContext =
                true;

        }


        if (
            (
                isDeepResearch ||
                (
                    !usedUrlContext &&
                    preferences.workspace?.tools !== "off"
                )
            ) &&
            attachments.length === 0 &&
            userText
        ) {

            const researched =
                await applyDeepResearch(
                    normalMessages,
                    userText,
                    () => {},
                    isDeepResearch
                        ? "deep"
                        : "live",
                    {
                        userId,
                        privateChat
                    }
                );

            normalMessages =
                researched.messages;

            researchEvidence =
                researched.evidence || "";

            sources = [
                ...sources,
                ...researched.sources
            ];

            if (
                shouldUpgradeForGrounding({
                    question:
                        userText,
                    sourceCount:
                        researched.sources.length,
                    effort:
                        researched.effort,
                    isDeepResearch,
                    currentModel:
                        modelRoute.primary,
                    advancedModel:
                        NEYO_LEVERAGE_ADVANCED_MODEL,
                    setting:
                        process.env.NEYO_GROUNDED_UPGRADE
                })
            ) {
                modelRoute.fallback =
                    modelRoute.primary;
                modelRoute.primary =
                    NEYO_LEVERAGE_ADVANCED_MODEL;
                modelRoute.route =
                    `${modelRoute.route}+grounded`;
            }

        }


        const modelStarted =
            Date.now();


        const modelResponse =
            await callModelRoute(
                normalMessages,
                modelRoute,
                isDeepResearch,
                preferences
            );


        logTiming(
            "MODEL_TOTAL_MS",
            elapsed(modelStarted),
            {
                streaming:
                    false,

                route:
                    modelRoute.route,

                fallback:
                    modelResponse
                        .usedFallback
            }
        );


        const finalSignals =
            applyMemoryMarkers(
            extractFinalReply(
                modelResponse
                    ?.data
                    ?.candidates?.[0]
                    ?.content
                    ?.parts
            )
            );

        let reply =
            privacy.restore(
                finalSignals.text
            );

        if (
            reply &&
            researchEvidence &&
            sources.length &&
            answerCheckEnabled(process.env.NEYO_ANSWER_CHECK)
        ) {
            const checked =
                await verifyAnswer({
                    question:
                        userText,
                    answer:
                        reply,
                    evidence:
                        researchEvidence,
                    apiKey:
                        GEMINI_API_KEY,
                    model:
                        ANSWER_CHECK_MODEL
                });
            if (checked.fixes && checked.text) {
                reply =
                    checked.text;
            }
        }

        const workspaceSuggested =
            preferences.workspaceCanSuggest
                ? await saveSuggestionsFor(
                    body.workspaceId,
                    userId,
                    finalSignals.actions,
                    privacy.restore
                ).catch(() => null)
                : null;


        if (!reply) {

            throw new Error(
                "NEYO returned an empty response."
            );

        }


        if (!privateChat) {

            await userMessageSaved;

            await saveMessage(
                conversationId,
                "assistant",
                reply,
                [],
                sources
            );

        }


        logTiming(
            "TOTAL_MS",
            elapsed(totalStarted),
            {
                streaming:
                    false,

                route:
                    modelRoute.route
            }
        );


        return res
            .status(200)
            .json({

                reply,

                conversationId:
                    privateChat
                        ? null
                        : conversationId,

                privateChat,

                sources:
                    sources.length > 0
                        ? sources
                        : undefined,

                usedUrlContext,

                workspace:
                    workspaceSuggested || undefined,

                creditType:
                    reservedType,

                attachmentsReceived:
                    rawAttachments.length,

                attachmentsAccepted:
                    attachments.length

            });


    } catch (
        error
    ) {

        if (
            streamHeartbeatTimer
        ) {

            clearInterval(
                streamHeartbeatTimer
            );


            streamHeartbeatTimer =
                null;

        }


        console.error(
            "[NEYO Chat Error]",
            {
                message:
                    error?.message,

                name:
                    error?.name
            }
        );


        logTiming(
            "TOTAL_ERROR_MS",
            elapsed(totalStarted)
        );


        if (
            !streamCompleted &&
            userId &&
            (
                reservedType === "free" ||
                reservedType === "reward"
            )
        ) {

            try {

                await supabase
                    .rpc(
                        "refund_message",
                        {
                            p_user_id:
                                userId,

                            p_type:
                                reservedType
                        }
                    );

            } catch {}

        }


        if (
            streamResponseStarted
        ) {

            writeSSE(
                res,
                {
                    type:
                        "error",

                    error:
                        error?.name ===
                            "AbortError"
                            ? "Generation stopped."
                            : error?.message ||
                                "Unable to complete request."
                }
            );


            if (
                !res.writableEnded &&
                !res.destroyed
            ) {

                res.end();

            }


            return;

        }


        return res
            .status(
                error?.status >= 400 &&
                error?.status < 600
                    ? error.status
                    : 500
            )
            .json({
                error:
                    error?.message ||
                    "Unable to complete request."
            });


    } finally {

        // Never leave the user-message save half done.
        await userMessageSaved;


        if (
            streamHeartbeatTimer
        ) {

            clearInterval(
                streamHeartbeatTimer
            );


            streamHeartbeatTimer =
                null;

        }


        if (
            geminiFiles.length > 0
        ) {

            await Promise.allSettled(
                geminiFiles.map(
                    fileName =>
                        deleteGeminiFile(
                            fileName
                        )
                )
            );

        }

    }

}
