import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "../lib/auth.js";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    }
);

const GEMINI_API_KEY = cleanEnv(process.env.GEMINI_API_KEY);
const UPLOAD_BUCKET = "neo-uploads";
const MAX_ATTACHMENTS = 5;
const MAX_MESSAGE_LENGTH = 50000;
const MAX_HISTORY_MESSAGES = 50;
const MAX_URL_CONTEXT_SOURCES = 5;
const DDG_USER_AGENT =
    "NEO/1.0 (https://signaturesi.com; contact@signaturesi.com)";

const NEO_RESPONSE_FORMAT = `
You are NEYO, a natural, intelligent conversational assistant.

VOICE AND TONE
- Match the user's language, tone, and level of formality.
- When the user writes Roman Urdu, respond in natural Roman Urdu.
- Sound human, direct, calm, and confident.
- Avoid generic openings such as:
  "Bilkul honest jawab deta hoon",
  "Great question",
  "Certainly",
  or "As an AI".
- Do not sound corporate, scripted, overly cheerful, or robotic.
- Use emojis only when they genuinely fit the user's tone, with a maximum of one.
- Do not repeat the user's question before answering.
- Do not end every answer with a question or invitation.

ORGANIZATION
- Keep the structure proportional to the request.
- For simple questions, use one or two natural paragraphs.
- Use headings only when the answer has genuinely different sections.
- Avoid excessive bullet points, checkmarks, numbered lists, and separators.
- Prefer short paragraphs over template-style lists.
- Do not restate the same idea in multiple sections.

ACCURACY AND JUDGMENT
- Do not invent the user's education, job, personality, background, or intentions.
- Only make personal inferences when directly supported by the conversation.
- Clearly label uncertain observations as impressions, not facts.
- Avoid exaggerated certainty.
- Answer the actual question first.

WRITING QUALITY
- Use clean, valid GitHub-flavored Markdown.
- Put every heading on its own line.
- Put each list item on its own line.
- Use bold only for short labels or genuinely important phrases.
- Never bold entire paragraphs.
- Use fenced code blocks with the correct language.
- Use [Website name](https://example.com) for links.
- Keep paragraphs readable and naturally paced.

MATH AND SCIENCE
- Use \\( ... \\) for inline mathematics.
- Use \\[ ... \\] for display equations.
- Put major equations on separate lines.
- Explain important symbols clearly after the equation.
- Never expose raw LaTeX without delimiters.

STYLE EXAMPLE
User: "Kya meri baaton se main human lagta hoon?"

Good response:
"Haan, bilkul. Aapka style direct, spontaneous aur feedback-driven hai, jo natural human conversation jaisa lagta hai. Aap kabhi formal ho jate ho, lekin overall bot-like feel nahi aati."

Bad response:
"Bilkul honest jawab deta hoon! Here are several observations about your personality and professional background..."
`;

function cleanString(str, max = MAX_MESSAGE_LENGTH) {
    if (typeof str !== "string") return "";

    return str
        .replace(/\r\n?/g, "\n")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
        .trim()
        .slice(0, max);
}

function cleanEnv(value) {
    return typeof value === "string"
        ? value.trim()
        : "";
}

function validAttachmentList(
    attachments,
    userId,
    max = MAX_ATTACHMENTS
) {
    if (!Array.isArray(attachments)) {
        return [];
    }

    return attachments
        .slice(0, max)
        .map(file => ({
            provider:
                "supabase",

            bucket:
                UPLOAD_BUCKET,

            path:
                String(
                    file.path || ""
                ).trim(),

            name:
                String(
                    file.name ||
                    "Attached file"
                )
                    .replace(
                        /[\\/]/g,
                        "-"
                    )
                    .slice(
                        0,
                        180
                    ),

            mimeType:
                String(
                    file.mimeType ||
                    file.type ||
                    "application/octet-stream"
                )
                    .slice(
                        0,
                        120
                    ),

            type:
                String(
                    file.mimeType ||
                    file.type ||
                    "application/octet-stream"
                )
                    .slice(
                        0,
                        120
                    ),

            category:
                String(
                    file.category ||
                    "text"
                )
                    .toLowerCase()
                    .slice(
                        0,
                        20
                    ),

            size:
                Number.isFinite(
                    Number(file.size)
                )
                    ? Math.max(
                        0,
                        Number(file.size)
                    )
                    : 0
        }))
        .filter(
            file =>
                file.path &&
                file.path.startsWith(
                    `users/${userId}/`
                ) &&
                !file.path.includes("..")
        );
}

function extractUrlsFromText(text) {
    if (!text) {
        return [];
    }

    const urlRegex =
        /https?:\/\/[^\s<>"']+/g;

    const matches =
        text.match(
            urlRegex
        ) || [];

    return matches.filter(
        url => {
            try {
                const parsed =
                    new URL(url);

                return (
                    parsed.protocol ===
                        "https:" &&
                    !parsed.hostname.includes(
                        "localhost"
                    ) &&
                    !parsed.hostname.match(
                        /^127\.\d+\.\d+\.\d+$/
                    ) &&
                    !parsed.hostname.match(
                        /^192\.168\./
                    ) &&
                    !parsed.hostname.match(
                        /^10\./
                    ) &&
                    !parsed.hostname.match(
                        /^172\.(1[6-9]|2[0-9]|3[0-1])\./
                    )
                );
            } catch {
                return false;
            }
        }
    );
}

function normalizeUrl(url) {
    try {
        const parsed =
            new URL(url);

        parsed.search = "";
        parsed.hash = "";

        return parsed.toString();
    } catch {
        return url;
    }
}

function deduplicateUrls(urls) {
    const seen =
        new Set();

    return urls.filter(
        url => {
            const normalized =
                normalizeUrl(
                    url
                );

            if (
                seen.has(
                    normalized
                )
            ) {
                return false;
            }

            seen.add(
                normalized
            );

            return true;
        }
    );
}

function normalizeDuckDuckGoUrl(
    rawHref
) {
    if (!rawHref) {
        return null;
    }

    try {
        const parsed =
            new URL(
                rawHref,
                "https://duckduckgo.com"
            );

        let destination =
            parsed.searchParams
                .get("uddg");

        if (destination) {
            destination =
                decodeURIComponent(
                    destination
                );
        } else {
            destination =
                parsed.href;
        }

        const finalUrl =
            new URL(
                destination
            );

        if (
            ![
                "http:",
                "https:"
            ].includes(
                finalUrl.protocol
            )
        ) {
            return null;
        }

        if (
            finalUrl.hostname
                .toLowerCase()
                .includes(
                    "duckduckgo.com"
                )
        ) {
            return null;
        }

        finalUrl.hash = "";

        [
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_term",
            "utm_content"
        ].forEach(
            key => {
                finalUrl.searchParams
                    .delete(
                        key
                    );
            }
        );

        return finalUrl.href;
    } catch {
        return null;
    }
}

async function searchDuckDuckGo(
    query,
    limit = 10
) {
    const cleanQuery =
        String(
            query || ""
        ).trim();

    if (!cleanQuery) {
        return [];
    }

    const endpoints = [
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`,
        `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(cleanQuery)}`
    ];

    for (
        const endpoint
        of endpoints
    ) {
        try {
            const response =
                await fetch(
                    endpoint,
                    {
                        method:
                            "GET",

                        headers: {
                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",

                            "Accept":
                                "text/html,application/xhtml+xml",

                            "Accept-Language":
                                "en-US,en;q=0.9"
                        },

                        redirect:
                            "follow"
                    }
                );

            if (!response.ok) {
                console.warn(
                    "DuckDuckGo HTTP error:",
                    response.status,
                    endpoint
                );

                continue;
            }

            const html =
                await response.text();

            console.log(
                "DuckDuckGo response:",
                {
                    endpoint,
                    htmlLength:
                        html.length
                }
            );

            if (
                !html ||
                html.length < 500 ||
                /captcha|unusual traffic|anomaly/i
                    .test(html)
            ) {
                console.warn(
                    "DuckDuckGo returned blocked or empty HTML."
                );

                continue;
            }

            const results = [];
            const seen =
                new Set();

            const resultBlocks =
                html.split(
                    /<div class="result[^"]*">/gi
                );

            if (
                resultBlocks.length >
                1
            ) {
                for (
                    const block
                    of resultBlocks
                ) {
                    if (
                        results.length >=
                        limit
                    ) {
                        break;
                    }

                    const anchorMatch =
                        block.match(
                            /<a\s+[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/i
                        );

                    if (!anchorMatch) {
                        continue;
                    }

                    const rawHref =
                        anchorMatch[1];

                    const title =
                        anchorMatch[2]
                            .replace(
                                /<[^>]*>/g,
                                ""
                            )
                            .trim();

                    const url =
                        normalizeDuckDuckGoUrl(
                            rawHref
                        );

                    if (
                        !url ||
                        seen.has(url) ||
                        !title
                    ) {
                        continue;
                    }

                    const snippetMatch =
                        block.match(
                            /<div\s+class="result__snippet"[^>]*>([^<]*)<\/div>/i
                        );

                    const snippet =
                        snippetMatch
                            ? snippetMatch[1]
                                .replace(
                                    /<[^>]*>/g,
                                    ""
                                )
                                .trim()
                            : "";

                    seen.add(url);

                    results.push({
                        url,
                        title,
                        snippet
                    });
                }
            }

            if (
                results.length ===
                0
            ) {
                const trs =
                    html.split(
                        /<tr\s*>/gi
                    );

                for (
                    const tr
                    of trs
                ) {
                    if (
                        results.length >=
                        limit
                    ) {
                        break;
                    }

                    const linkMatch =
                        tr.match(
                            /<a\s+[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/i
                        );

                    if (!linkMatch) {
                        continue;
                    }

                    const rawHref =
                        linkMatch[1];

                    const title =
                        linkMatch[2]
                            .replace(
                                /<[^>]*>/g,
                                ""
                            )
                            .trim();

                    const url =
                        normalizeDuckDuckGoUrl(
                            rawHref
                        );

                    if (
                        !url ||
                        seen.has(url) ||
                        !title
                    ) {
                        continue;
                    }

                    const snippetMatch =
                        tr.match(
                            /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/i
                        );

                    const snippet =
                        snippetMatch
                            ? snippetMatch[1]
                                .replace(
                                    /<[^>]*>/g,
                                    ""
                                )
                                .trim()
                            : "";

                    seen.add(url);

                    results.push({
                        url,
                        title,
                        snippet
                    });
                }
            }

            if (
                results.length >
                0
            ) {
                return results;
            }
        } catch (
            error
        ) {
            console.warn(
                "DuckDuckGo search failed:",
                error
            );
        }
    }

    return [];
}

async function fetchUrlText(
    url,
    maxChars = 12000
) {
    try {
        const response =
            await fetch(
                url,
                {
                    method:
                        "GET",

                    headers: {
                        "User-Agent":
                            DDG_USER_AGENT,

                        "Accept":
                            "text/html,text/plain,application/xhtml+xml"
                    },

                    redirect:
                        "follow"
                }
            );

        if (!response.ok) {
            return "";
        }

        const contentType =
            String(
                response.headers
                    .get(
                        "content-type"
                    ) || ""
            ).toLowerCase();

        if (
            !contentType.includes(
                "text/html"
            ) &&
            !contentType.includes(
                "text/plain"
            ) &&
            !contentType.includes(
                "application/xhtml+xml"
            )
        ) {
            return "";
        }

        let html =
            await response.text();

        html =
            html
                .replace(
                    /<script[\s\S]*?<\/script>/gi,
                    " "
                )
                .replace(
                    /<style[\s\S]*?<\/style>/gi,
                    " "
                )
                .replace(
                    /<noscript[\s\S]*?<\/noscript>/gi,
                    " "
                )
                .replace(
                    /<svg[\s\S]*?<\/svg>/gi,
                    " "
                )
                .replace(
                    /<[^>]+>/g,
                    " "
                )
                .replace(
                    /&nbsp;/gi,
                    " "
                )
                .replace(
                    /&amp;/gi,
                    "&"
                )
                .replace(
                    /&quot;/gi,
                    '"'
                )
                .replace(
                    /&#39;/gi,
                    "'"
                )
                .replace(
                    /\s+/g,
                    " "
                )
                .trim();

        return html.slice(
            0,
            maxChars
        );
    } catch {
        return "";
    }
}

function buildSearchContext(
    results
) {
    return results
        .map(
            (
                result,
                index
            ) => {
                return [
                    `[Source ${index + 1}]`,
                    `Title: ${result.title}`,
                    `URL: ${result.url}`,
                    result.snippet
                        ? `Snippet: ${result.snippet}`
                        : "",
                    result.content
                        ? `Content: ${result.content}`
                        : ""
                ]
                    .filter(Boolean)
                    .join("\n");
            }
        )
        .join(
            "\n\n"
        );
}

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
            "high"
        ].includes(
            normalized
        )
    ) {
        return normalized;
    }

    return "standard";
}

function normalizeLanguage(
    value
) {
    const normalized =
        String(
            value || "auto"
        )
            .trim()
            .toLowerCase();

    return normalized
        .slice(
            0,
            40
        ) || "auto";
}

function normalizePersonality(
    value
) {
    const normalized =
        String(
            value || "neyo"
        )
            .trim()
            .toLowerCase();

    return normalized
        .slice(
            0,
            50
        ) || "neyo";
}

function normalizePrivateChat(
    value
) {
    return value === true;
}

function buildPreferenceInstruction(
    preferences = {}
) {
    const parts = [];

    if (
        preferences.intelligence ===
        "high"
    ) {
        parts.push(
            "Use deeper reasoning and more thorough analysis when useful, while keeping the final answer concise and readable."
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

    if (
        preferences.personality &&
        preferences.personality !==
        "neyo"
    ) {
        parts.push(
            `Preferred personality/style preset: ${preferences.personality}.`
        );
    }

    return parts.join(
        "\n"
    );
}

async function uploadSupabaseFileToGemini(
    file
) {
    if (
        !GEMINI_API_KEY
    ) {
        throw new Error(
            "Gemini API key is missing."
        );
    }

    const {
        data,
        error
    } =
        await supabase.storage
            .from(
                file.bucket ||
                UPLOAD_BUCKET
            )
            .download(
                file.path
            );

    if (error) {
        throw new Error(
            error.message ||
            "Unable to download attachment."
        );
    }

    const bytes =
        Buffer.from(
            await data.arrayBuffer()
        );

    const startResponse =
        await fetch(
            "https://generativelanguage.googleapis.com/upload/v1beta/files?key=" +
            encodeURIComponent(
                GEMINI_API_KEY
            ),
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
                        file.mimeType ||
                        "application/octet-stream",

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        file: {
                            display_name:
                                file.name
                        }
                    })
            }
        );

    if (!startResponse.ok) {
        throw new Error(
            "Unable to initialize Gemini file upload."
        );
    }

    const uploadUrl =
        startResponse.headers
            .get(
                "x-goog-upload-url"
            );

    if (!uploadUrl) {
        throw new Error(
            "Gemini upload URL missing."
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

    if (
        !uploadResponse.ok
    ) {
        throw new Error(
            "Gemini file upload failed."
        );
    }

    const payload =
        await uploadResponse.json();

    return payload.file || null;
}

async function deleteGeminiFile(
    apiKey,
    fileName
) {
    if (
        !apiKey ||
        !fileName
    ) {
        return;
    }

    try {
        await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${encodeURIComponent(apiKey)}`,
            {
                method:
                    "DELETE"
            }
        );
    } catch {}
}

function buildGeminiBody(
    contents,
    isDeepResearch = false,
    preferences = {}
) {
    const preferenceInstruction =
        buildPreferenceInstruction(
            preferences
        );

    return {
        systemInstruction: {
            parts: [
                {
                    text:
                        `${NEO_RESPONSE_FORMAT}\n\n${preferenceInstruction}`
                }
            ]
        },

        contents,

        generationConfig: {
            temperature:
                isDeepResearch
                    ? 0.45
                    : (
                        preferences.intelligence ===
                        "high"
                            ? 0.5
                            : 0.65
                    ),

            topP:
                0.95,

            maxOutputTokens:
                isDeepResearch
                    ? 8192
                    : 4096
        }
    };
}

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
                        buildGeminiBody(
                            messages,
                            isDeepResearch,
                            preferences
                        )
                    )
            }
        );

    const data =
        await response
            .json()
            .catch(
                () => ({})
            );

    if (!response.ok) {
        throw new Error(
            data?.error
                ?.message ||
            `Gemini request failed (${response.status}).`
        );
    }

    return data;
}

async function callGeminiUrlContext(
    query,
    urls,
    model,
    isDeepResearch = false,
    preferences = {}
) {
    const contextParts = [];

    for (
        const url
        of urls
    ) {
        const content =
            await fetchUrlText(
                url
            );

        contextParts.push(
            {
                url,
                content
            }
        );
    }

    const context =
        contextParts
            .map(
                (
                    item,
                    index
                ) =>
                    `[URL ${index + 1}]
${item.url}

${item.content}`
            )
            .join(
                "\n\n"
            );

    const messages = [
        {
            role:
                "user",

            parts: [
                {
                    text:
                        `${query}

Use the following live URL context when relevant. Do not invent information beyond the supplied context.

${context}`
                }
            ]
        }
    ];

    return callGemini(
        messages,
        model,
        isDeepResearch,
        preferences
    );
}

async function smartWebAnswer(
    query,
    model,
    isDeepResearch = false,
    preferences = {}
) {
    const results =
        await searchDuckDuckGo(
            query,
            isDeepResearch
                ? 10
                : 6
        );

    if (
        results.length ===
        0
    ) {
        throw new Error(
            "No web results found."
        );
    }

    const enriched = [];

    for (
        const result
        of results.slice(
            0,
            isDeepResearch
                ? 8
                : 5
        )
    ) {
        const content =
            await fetchUrlText(
                result.url,
                isDeepResearch
                    ? 16000
                    : 9000
            );

        enriched.push({
            ...result,
            content
        });
    }

    const context =
        buildSearchContext(
            enriched
        );

    const messages = [
        {
            role:
                "user",

            parts: [
                {
                    text:
                        `${query}

You have fresh web search context below. Answer using it when relevant. Prefer the newest and most trustworthy source. If sources conflict, say so. Do not invent facts.

${context}`
                }
            ]
        }
    ];

    const response =
        await callGemini(
            messages,
            model,
            isDeepResearch,
            preferences
        );

    const reply =
        response
            ?.candidates?.[0]
            ?.content
            ?.parts?.[0]
            ?.text ||
        "";

    return {
        reply,

        sources:
            enriched.map(
                result => ({
                    title:
                        result.title,

                    url:
                        result.url,

                    snippet:
                        result.snippet
                })
            ),

        usedUrlContext:
            true
    };
}

async function saveMessage(
    supabaseClient,
    conversationId,
    role,
    content,
    attachments = [],
    sources = []
) {
    const {
        error
    } =
        await supabaseClient
            .from(
                "chat_messages"
            )
            .insert({
                conversation_id:
                    conversationId,

                role,

                content,

                attachments:
                    Array.isArray(
                        attachments
                    )
                        ? attachments
                        : [],

                sources:
                    Array.isArray(
                        sources
                    )
                        ? sources
                        : []
            });

    if (error) {
        throw new Error(
            error.message
        );
    }
}

export default async function handler(
    req,
    res
) {
    if (
        req.method !==
        "POST"
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

    let geminiFiles = [];
    let reservedType = null;
    let userId = null;
    let isPro = false;

    try {
        const user =
            await getAuthenticatedUser(
                req
            );

        if (!user?.id) {
            return res
                .status(401)
                .json({
                    error:
                        "UNAUTHORIZED"
                });
        }

        userId =
            user.id;

        const {
            messages,
            conversationId,
            isDeepResearch,
            title
        } =
            req.body || {};

        const preferences = {
            intelligence:
                normalizeIntelligence(
                    req.body
                        ?.intelligence
                ),

            language:
                normalizeLanguage(
                    req.body
                        ?.language
                ),

            personality:
                normalizePersonality(
                    req.body
                        ?.personality
                )
        };

        const privateChat =
            normalizePrivateChat(
                req.body
                    ?.privateChat
            );

        if (
            !Array.isArray(
                messages
            ) ||
            messages.length ===
                0
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
            lastMsg?.role !==
            "user"
        ) {
            return res
                .status(400)
                .json({
                    error:
                        "Last message must be user"
                });
        }

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

        if (reserveError) {
            console.error(
                "Credit reservation failed:",
                reserveError
            );

            return res
                .status(500)
                .json({
                    error:
                        "Unable to check message credits."
                });
        }

        reservedType =
            reserveResult;

        if (
            ![
                "pro",
                "free",
                "reward",
                "limit"
            ].includes(
                reservedType
            )
        ) {
            throw new Error(
                "Invalid credit reservation response."
            );
        }

        if (
            reservedType ===
            "limit"
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

        isPro =
            reservedType ===
            "pro";

        const receivedAttachments =
            Array.isArray(
                req.body
                    .attachments
            )
                ? req.body
                    .attachments
                : (
                    lastMsg
                        ?.attachments ||
                    []
                );

        let attachments =
            validAttachmentList(
                receivedAttachments,
                user.id
            );

        const history =
            messages.slice(
                -MAX_HISTORY_MESSAGES
            );

        const geminiMessages =
            history
                .map(
                    msg => ({
                        role:
                            msg.role ===
                            "assistant"
                                ? "model"
                                : msg.role,

                        parts: [
                            {
                                text:
                                    cleanString(
                                        msg.content ||
                                        ""
                                    )
                            }
                        ]
                    })
                )
                .filter(
                    message =>
                        message
                            .parts[0]
                            .text ||
                        message
                            .attachments
                            ?.length
                );

        if (
            attachments.length >
                0 &&
            GEMINI_API_KEY
        ) {
            const lastGeminiMessage =
                geminiMessages[
                    geminiMessages.length -
                    1
                ];

            if (
                !lastGeminiMessage
            ) {
                throw new Error(
                    "Unable to prepare attachment message."
                );
            }

            const originalText =
                cleanString(
                    lastMsg.content ||
                    "Please analyze the attached file."
                );

            const attachmentParts =
                [];

            for (
                const file
                of attachments
            ) {
                const geminiFile =
                    await uploadSupabaseFileToGemini(
                        file
                    );

                if (
                    !geminiFile?.uri
                ) {
                    continue;
                }

                geminiFiles.push(
                    geminiFile.name
                );

                attachmentParts.push({
                    fileData: {
                        mimeType:
                            geminiFile
                                .mimeType,

                        fileUri:
                            geminiFile
                                .uri
                    }
                });
            }

            lastGeminiMessage.parts =
                [
                    {
                        text:
                            originalText
                    },
                    ...attachmentParts
                ];
        }

        let convId =
            privateChat
                ? null
                : (
                    conversationId ||
                    null
                );

        if (
            !privateChat &&
            !convId
        ) {
            const {
                data:
                    newConv,
                error:
                    convError
            } =
                await supabase
                    .from(
                        "chat_conversations"
                    )
                    .insert({
                        user_id:
                            user.id,

                        title:
                            cleanString(
                                title ||
                                "New conversation",
                                100
                            )
                    })
                    .select(
                        "id"
                    )
                    .single();

            if (convError) {
                throw new Error(
                    convError.message
                );
            }

            convId =
                newConv.id;
        }

        const userText =
            cleanString(
                lastMsg.content ||
                ""
            );

        if (
            !privateChat
        ) {
            await saveMessage(
                supabase,
                convId,
                "user",
                userText ||
                    "Attachment",
                attachments,
                []
            );
        }

        const model =
            isPro
                ? (
                    cleanEnv(
                        process.env
                            .GEMINI_PRO_MODEL
                    ) ||
                    "gemini-3.5-flash-lite"
                )
                : (
                    cleanEnv(
                        process.env
                            .GEMINI_FREE_MODEL
                    ) ||
                    "gemini-3.1-flash-lite"
                );

        const lowerQuery =
            userText
                .toLowerCase();

        const isCurrentQuery =
            /\b(current|now|latest|today|this month|july|august|202[4-9]|real[- ]time)\b/
                .test(
                    lowerQuery
                );

        const isCompareQuery =
            /\b(compare|difference|versus|vs|different|which|between)\b/
                .test(
                    lowerQuery
                );

        const isSpecificQuery =
            /\b(how much|what is|value|price|net worth|population|weather|stock|price|rate|exchange|who|which company|where is)\b/
                .test(
                    lowerQuery
                );

        const hasUrl =
            extractUrlsFromText(
                userText
            ).length >
            0;

        let reply = "";
        let sources = [];
        let usedUrlContext =
            false;

        if (hasUrl) {
            const urls =
                extractUrlsFromText(
                    userText
                ).slice(
                    0,
                    MAX_URL_CONTEXT_SOURCES
                );

            try {
                const contextResponse =
                    await callGeminiUrlContext(
                        userText,
                        urls,
                        model,
                        isDeepResearch,
                        preferences
                    );

                reply =
                    contextResponse
                        ?.candidates?.[0]
                        ?.content
                        ?.parts?.[0]
                        ?.text ||
                    "";

                const metadata =
                    contextResponse
                        ?.candidates?.[0]
                        ?.url_context_metadata
                        ?.url_metadata ||
                    [];

                sources =
                    metadata
                        .filter(
                            item =>
                                item
                                    .url_retrieval_status ===
                                "URL_RETRIEVAL_STATUS_SUCCESS"
                        )
                        .map(
                            item => ({
                                title:
                                    item.url ||
                                    "Source",

                                url:
                                    item.url,

                                status:
                                    "success"
                            })
                        );

                if (
                    sources.length ===
                    0
                ) {
                    sources =
                        urls.map(
                            url => ({
                                title:
                                    new URL(
                                        url
                                    )
                                        .hostname
                                        .replace(
                                            /^www\./,
                                            ""
                                        ),

                                url,

                                status:
                                    "success"
                            })
                        );
                }

                usedUrlContext =
                    true;
            } catch (
                error
            ) {
                console.warn(
                    "Direct URL Context failed:",
                    error
                );
            }
        } else if (
            isCurrentQuery ||
            isCompareQuery ||
            isSpecificQuery
        ) {
            try {
                const result =
                    await smartWebAnswer(
                        userText,
                        model,
                        isDeepResearch,
                        preferences
                    );

                reply =
                    result.reply;

                sources =
                    result.sources ||
                    [];

                usedUrlContext =
                    result.usedUrlContext ||
                    false;
            } catch (
                error
            ) {
                console.warn(
                    "Smart web search failed, falling back to normal Gemini:",
                    error
                );
            }
        }

        if (!reply) {
            const geminiResponse =
                await callGemini(
                    geminiMessages,
                    model,
                    isDeepResearch,
                    preferences
                );

            reply =
                geminiResponse
                    ?.candidates?.[0]
                    ?.content
                    ?.parts?.[0]
                    ?.text ||
                "";

            if (!reply) {
                throw new Error(
                    "Gemini returned empty response"
                );
            }
        }

        if (
            !privateChat
        ) {
            await saveMessage(
                supabase,
                convId,
                "assistant",
                reply,
                [],
                sources
            );
        }

        return res.json({
            reply,

            conversationId:
                privateChat
                    ? null
                    : convId,

            privateChat,

            usedUrlContext,

            sources:
                sources.length >
                0
                    ? sources
                    : undefined,

            creditType:
                reservedType
        });

    } catch (
        error
    ) {
        console.error(
            "Chat error:",
            error
        );

        if (
            userId &&
            (
                reservedType ===
                    "free" ||
                reservedType ===
                    "reward"
            )
        ) {
            const {
                error:
                    refundError
            } =
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

            if (refundError) {
                console.error(
                    "Credit refund failed:",
                    refundError
                );
            }
        }

        return res
            .status(500)
            .json({
                error:
                    error.message ||
                    "Unable to complete request."
            });

    } finally {
        if (
            geminiFiles.length >
                0 &&
            GEMINI_API_KEY
        ) {
            await Promise.all(
                geminiFiles.map(
                    fileName =>
                        deleteGeminiFile(
                            GEMINI_API_KEY,
                            fileName
                        )
                )
            );
        }
    }
}
