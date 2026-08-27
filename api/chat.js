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


// ================================================================
// NEO SYSTEM INSTRUCTION
// ================================================================

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


// ================================================================
// HELPERS
// ================================================================

function cleanString(
    str,
    max = MAX_MESSAGE_LENGTH
) {
    if (
        typeof str !==
        "string"
    ) {
        return "";
    }

    return str
        .replace(
            /\r\n?/g,
            "\n"
        )
        .replace(
            /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
            ""
        )
        .trim()
        .slice(
            0,
            max
        );
}


function cleanEnv(
    value
) {
    return typeof value ===
        "string"
        ? value.trim()
        : "";
}


function validAttachmentList(
    attachments,
    userId,
    max = MAX_ATTACHMENTS
) {
    if (
        !Array.isArray(
            attachments
        )
    ) {
        return [];
    }

    return attachments
        .slice(
            0,
            max
        )
        .map(
            file => ({
                provider:
                    "supabase",

                bucket:
                    UPLOAD_BUCKET,

                path:
                    String(
                        file.path ||
                        ""
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
                        Number(
                            file.size
                        )
                    )
                        ? Math.max(
                            0,
                            Number(
                                file.size
                            )
                        )
                        : 0
            })
        )
        .filter(
            file =>
                file.path &&
                file.path.startsWith(
                    `users/${userId}/`
                ) &&
                !file.path.includes(
                    ".."
                )
        );
}


function extractUrlsFromText(
    text
) {
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
                    new URL(
                        url
                    );

                return (
                    parsed.protocol ===
                        "https:" &&

                    !parsed.hostname
                        .includes(
                            "localhost"
                        ) &&

                    !parsed.hostname
                        .match(
                            /^127\.\d+\.\d+\.\d+$/
                        ) &&

                    !parsed.hostname
                        .match(
                            /^192\.168\./
                        ) &&

                    !parsed.hostname
                        .match(
                            /^10\./
                        ) &&

                    !parsed.hostname
                        .match(
                            /^172\.(1[6-9]|2[0-9]|3[0-1])\./
                        )
                );

            } catch {
                return false;
            }
        }
    );
}


function normalizeUrl(
    url
) {
    try {
        const parsed =
            new URL(
                url
            );

        parsed.search =
            "";

        parsed.hash =
            "";

        return parsed.toString();

    } catch {
        return url;
    }
}


function deduplicateUrls(
    urls
) {
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


// ================================================================
// DUCKDUCKGO SEARCH
// ================================================================

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
            parsed
                .searchParams
                .get(
                    "uddg"
                );

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

        finalUrl.hash =
            "";

        [
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_term",
            "utm_content"
        ].forEach(
            key => {
                finalUrl
                    .searchParams
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
            query ||
            ""
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

                            Accept:
                                "text/html,application/xhtml+xml",

                            "Accept-Language":
                                "en-US,en;q=0.9"
                        },

                        redirect:
                            "follow"
                    }
                );

            if (
                !response.ok
            ) {
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
                html.length <
                    500 ||
                /captcha|unusual traffic|anomaly/i
                    .test(
                        html
                    )
            ) {
                console.warn(
                    "DuckDuckGo returned blocked or empty HTML."
                );

                continue;
            }

            const results =
                [];

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

                    if (
                        !anchorMatch
                    ) {
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
                        seen.has(
                            url
                        ) ||
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

                    seen.add(
                        url
                    );

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

                    if (
                        !linkMatch
                    ) {
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
                        seen.has(
                            url
                        ) ||
                        !title
                    ) {
                        continue;
                    }

                    const snippetMatch =
                        tr.match(
                            /<td[^>]*class="result-snippet"[^>]*>([^<]*)<\/td>/i
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

                    seen.add(
                        url
                    );

                    results.push({
                        url,
                        title,
                        snippet
                    });
                }
            }

            console.log(
                "DuckDuckGo parsed results:",
                results.length
            );

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


// ================================================================
// SEARCH PLANNER
// ================================================================

async function createSmartSearchPlan(
    query
) {
    const planningPrompt = `
You are a search planner. Given a user's question, generate 2–3 specific web search queries to find the most accurate and current information.

Return ONLY a JSON object with the following structure:
{
  "mode": "web",
  "queries": ["query1", "query2", "query3"],
  "entity": "main entity name (if any)",
  "preferredPageTypes": ["type1", "type2"],
  "avoidPageTypes": ["type1", "type2"]
}

Rules:
- Queries should be specific and include context like current year, latest, or real-time if relevant.
- Prefer queries that target direct profiles, official pages, or real-time data sources.
- Avoid queries that return generic lists or homepages.
- If the question is about a person, include their full name.
- If about a company, include the official name.
- Return only JSON, no other text.

User question: ${query}
`;

    try {
        const response =
            await callGeminiForJson(
                planningPrompt
            );

        const text =
            response
                ?.candidates?.[0]
                ?.content
                ?.parts?.[0]
                ?.text ||
            "";

        const jsonMatch =
            text.match(
                /\{[\s\S]*\}/
            );

        if (
            jsonMatch
        ) {
            return JSON.parse(
                jsonMatch[0]
            );
        }

        return {
            mode:
                "web",

            queries: [
                query,
                `${query} latest`,
                `${query} 2026`
            ],

            entity:
                "",

            preferredPageTypes: [
                "direct profile",
                "official page",
                "real-time"
            ],

            avoidPageTypes: [
                "generic list",
                "homepage",
                "social media"
            ]
        };

    } catch (
        error
    ) {
        console.warn(
            "Search planning failed, using fallback:",
            error
        );

        return {
            mode:
                "web",

            queries: [
                query,
                `${query} latest`,
                `${query} 2026`
            ],

            entity:
                "",

            preferredPageTypes: [
                "direct profile",
                "official page",
                "real-time"
            ],

            avoidPageTypes: [
                "generic list",
                "homepage",
                "social media"
            ]
        };
    }
}


async function callGeminiForJson(
    prompt
) {
    if (
        !GEMINI_API_KEY
    ) {
        throw new Error(
            "Gemini API key missing"
        );
    }

    const url =
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const body = {
        contents: [
            {
                role:
                    "user",

                parts: [
                    {
                        text:
                            prompt
                    }
                ]
            }
        ],

        generationConfig: {
            temperature:
                0.2,

            maxOutputTokens:
                512
        }
    };

    const response =
        await fetch(
            url,
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        body
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
        !response.ok
    ) {
        throw new Error(
            data
                ?.error
                ?.message ||
            "Planning API error"
        );
    }

    return data;
}


// ================================================================
// RESULT RANKING
// ================================================================

function rankSearchResults(
    results,
    plan
) {
    return results
        .map(
            item => {
                let score =
                    0;

                const title =
                    (
                        item.title ||
                        ""
                    ).toLowerCase();

                const url =
                    (
                        item.url ||
                        ""
                    ).toLowerCase();

                const domain =
                    url
                        .replace(
                            /^https?:\/\//,
                            ""
                        )
                        .split(
                            "/"
                        )[0] ||
                    "";

                if (
                    plan.entity &&
                    title.includes(
                        plan.entity
                            .toLowerCase()
                    )
                ) {
                    score +=
                        35;
                }

                if (
                    url.includes(
                        "/profile/"
                    )
                ) {
                    score +=
                        30;
                } else if (
                    url.includes(
                        "/real-time"
                    )
                ) {
                    score +=
                        25;
                } else if (
                    url.includes(
                        "/latest"
                    )
                ) {
                    score +=
                        20;
                } else if (
                    url.includes(
                        "/today"
                    )
                ) {
                    score +=
                        15;
                }

                if (
                    domain.includes(
                        "bloomberg"
                    )
                ) {
                    score +=
                        25;
                } else if (
                    domain.includes(
                        "forbes"
                    )
                ) {
                    score +=
                        20;
                } else if (
                    domain.includes(
                        "reuters"
                    ) ||
                    domain.includes(
                        "apnews"
                    )
                ) {
                    score +=
                        18;
                } else if (
                    domain.includes(
                        "wsj"
                    ) ||
                    domain.includes(
                        "ft"
                    )
                ) {
                    score +=
                        15;
                } else if (
                    domain.includes(
                        "wikipedia"
                    )
                ) {
                    score +=
                        10;
                } else if (
                    domain.includes(
                        "twitter"
                    ) ||
                    domain.includes(
                        "facebook"
                    ) ||
                    domain.includes(
                        "instagram"
                    )
                ) {
                    score -=
                        50;
                } else if (
                    domain.includes(
                        "reddit"
                    ) ||
                    domain.includes(
                        "quora"
                    )
                ) {
                    score -=
                        20;
                } else if (
                    domain.includes(
                        "youtube"
                    )
                ) {
                    score -=
                        10;
                }

                if (
                    url.includes(
                        "/worlds-billionaires"
                    )
                ) {
                    score -=
                        20;
                }

                if (
                    url.includes(
                        "/list/"
                    )
                ) {
                    score -=
                        15;
                }

                if (
                    url.includes(
                        "/home/"
                    )
                ) {
                    score -=
                        30;
                }

                if (
                    url.includes(
                        "/search"
                    )
                ) {
                    score -=
                        25;
                }

                const yearMatch =
                    url.match(
                        /20[2-9][0-9]/
                    );

                if (
                    yearMatch
                ) {
                    score +=
                        10;
                }

                if (
                    item.snippet &&
                    item.snippet.length >
                        100
                ) {
                    score +=
                        5;
                }

                return {
                    ...item,

                    score:
                        Math.max(
                            0,
                            score
                        )
                };
            }
        )
        .sort(
            (
                a,
                b
            ) =>
                b.score -
                a.score
        )
        .slice(
            0,
            10
        );
}


// ================================================================
// FOCUSED RETRY SEARCH
// ================================================================

async function runFocusedSearch(
    plan,
    rankedResults
) {
    const domains =
        rankedResults
            .slice(
                0,
                3
            )
            .map(
                result => {
                    try {
                        const url =
                            new URL(
                                result.url
                            );

                        return url.hostname
                            .replace(
                                /^www\./,
                                ""
                            );

                    } catch {
                        return null;
                    }
                }
            )
            .filter(
                Boolean
            );

    const extraQueries =
        [];

    const entity =
        plan.entity ||
        "";

    domains.forEach(
        domain => {
            if (
                domain
            ) {
                extraQueries.push(
                    `site:${domain} "${entity}"`
                );
            }
        }
    );

    if (
        extraQueries.length ===
        0
    ) {
        extraQueries.push(
            `"${entity}" profile`
        );
    }

    const searchPromises =
        extraQueries
            .slice(
                0,
                2
            )
            .map(
                query =>
                    searchDuckDuckGo(
                        query
                    )
            );

    const results =
        await Promise.all(
            searchPromises
        );

    return results.flat();
}


// ================================================================
// GENERAL PREFERENCE HELPERS
// ================================================================

function normalizeIntelligence(
    value
) {
    return value ===
        "maximum"
        ? "maximum"
        : "standard";
}


function normalizeLanguage(
    value
) {
    const allowed = [
        "auto",
        "english",
        "urdu",
        "roman-urdu"
    ];

    return allowed.includes(
        value
    )
        ? value
        : "auto";
}


function normalizePersonality(
    value
) {
    const allowed = [
        "neyo",
        "zadi",
        "wizi"
    ];

    return allowed.includes(
        value
    )
        ? value
        : "neyo";
}


function normalizePrivateChat(
    value
) {
    return value ===
        true;
}


// ================================================================
// DYNAMIC SYSTEM INSTRUCTION BUILDER
// ================================================================

function buildSystemInstruction({
    intelligence = "standard",
    language = "auto",
    personality = "neyo"
} = {}) {
    const intelligenceInstruction =
        intelligence ===
        "maximum"
            ? `
INTELLIGENCE MODE — MAXIMUM
- Use deeper analysis for difficult requests.
- Check assumptions, edge cases, constraints, and internal consistency before answering.
- Prefer correctness and completeness over speed.
- For simple requests, remain concise and do not over-explain.
`
            : `
INTELLIGENCE MODE — STANDARD
- Prioritize fast, clear, accurate responses.
- Use deeper analysis only when the task actually requires it.
- Avoid unnecessary complexity.
`;

    const languageInstructions = {
        auto: `
LANGUAGE
- Detect the user's language naturally.
- Match the user's language unless they explicitly request another language.
`,

        english: `
LANGUAGE
- Respond in English by default.
- Preserve quoted or technical text when another language is necessary.
`,

        urdu: `
LANGUAGE
- Respond in natural Urdu script by default.
- Keep technical names and code in their appropriate original form.
`,

        "roman-urdu": `
LANGUAGE
- Respond in natural Roman Urdu by default.
- Keep code, APIs, technical identifiers, and product names unchanged.
`
    };

    const personalityInstructions = {
        neyo: `
PERSONALITY — NEYO
- Balanced, intelligent, practical, and composed.
- Strong at thinking, writing, decision support, and everyday work.
- Balance speed with useful reasoning.
`,

        zadi: `
PERSONALITY — ZADI
- Creative, expressive, imaginative, and polished.
- Strong at writing, branding, ideation, storytelling, and creative exploration.
- Do not sacrifice factual accuracy for creativity.
`,

        wizi: `
PERSONALITY — WIZI
- Research-oriented, analytical, careful, and evidence-conscious.
- Strong at investigation, comparison, technical analysis, and structured reasoning.
- Clearly distinguish verified information from uncertainty.
`
    };

    return `
${NEO_RESPONSE_FORMAT}

${intelligenceInstruction}

${languageInstructions[language]}

${personalityInstructions[personality]}
`.trim();
}


// ================================================================
// GENERATION CONFIG BUILDER
// ================================================================

function getGenerationConfig(
    intelligence,
    isDeepResearch
) {
    if (
        isDeepResearch
    ) {
        return {
            temperature:
                0.5,

            maxOutputTokens:
                8192
        };
    }

    if (
        intelligence ===
        "maximum"
    ) {
        return {
            temperature:
                0.55,

            maxOutputTokens:
                8192
        };
    }

    return {
        temperature:
            0.65,

        maxOutputTokens:
            4096
    };
}


// ================================================================
// GEMINI URL CONTEXT CALL
// ================================================================

async function callGeminiUrlContext(
    query,
    urls,
    model,
    isDeepResearch,
    preferences
) {
    if (
        !GEMINI_API_KEY
    ) {
        throw new Error(
            "Gemini API key missing"
        );
    }

    const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const contextPrompt = `
Read only these URLs and answer the user's question based on their content:

${urls
    .map(
        (
            item,
            index
        ) =>
            `${index + 1}. ${item}`
    )
    .join(
        "\n"
    )}

Original question: ${query}

Rules:
- Extract only the requested information from these URLs.
- If a URL cannot be accessed, note that.
- Do not search the web or add information from other sources.
- Cite the source for each piece of information.
- If multiple sources show different values, explain the difference.
- Be concise and answer the actual question first.
- If the answer is not found in any URL, say "I could not verify this from the provided sources."
`;

    const body = {
        systemInstruction: {
            parts: [
                {
                    text:
                        buildSystemInstruction(
                            preferences
                        )
                }
            ]
        },

        contents: [
            {
                role:
                    "user",

                parts: [
                    {
                        text:
                            contextPrompt
                    }
                ]
            }
        ],

        tools: [
            {
                url_context:
                    {}
            }
        ],

        generationConfig:
            getGenerationConfig(
                preferences.intelligence,
                isDeepResearch
            )
    };

    const response =
        await fetch(
            url,
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        body
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
        !response.ok
    ) {
        console.error(
            "Gemini URL Context error:",
            data
        );

        throw new Error(
            data
                ?.error
                ?.message ||
            "Gemini API error"
        );
    }

    return data;
}


// ================================================================
// SMART WEB ANSWER
// ================================================================

async function smartWebAnswer(
    query,
    model,
    isDeepResearch,
    preferences
) {
    const plan =
        await createSmartSearchPlan(
            query
        );

    const searchResults =
        await Promise.all(
            plan.queries
                .slice(
                    0,
                    3
                )
                .map(
                    searchQuery =>
                        searchDuckDuckGo(
                            searchQuery
                        )
                )
        );

    let allResults =
        searchResults.flat();

    let ranked =
        rankSearchResults(
            allResults,
            plan
        );

    if (
        ranked.length ===
        0
    ) {
        const retryResults =
            await runFocusedSearch(
                plan,
                ranked
            );

        const combined = [
            ...ranked,
            ...retryResults
        ];

        ranked =
            rankSearchResults(
                combined,
                plan
            );
    }

    const urls =
        ranked
            .filter(
                item =>
                    item?.url
            )
            .slice(
                0,
                5
            )
            .map(
                item =>
                    item.url
            );

    if (
        urls.length ===
        0
    ) {
        console.warn(
            "No usable DuckDuckGo URLs found.",
            {
                query,
                plan,
                searchResultCount:
                    allResults.length
            }
        );

        throw new Error(
            "I could not find usable pages for this request."
        );
    }

    const geminiResponse =
        await callGeminiUrlContext(
            query,
            urls,
            model,
            isDeepResearch,
            preferences
        );

    const reply =
        geminiResponse
            ?.candidates?.[0]
            ?.content
            ?.parts?.[0]
            ?.text ||
        "";

    const urlMetadata =
        geminiResponse
            ?.candidates?.[0]
            ?.url_context_metadata
            ?.url_metadata ||
        [];

    const sources =
        urlMetadata
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

    const finalSources =
        sources.length >
        0
            ? sources
            : urls.map(
                sourceUrl => ({
                    title:
                        new URL(
                            sourceUrl
                        )
                            .hostname
                            .replace(
                                /^www\./,
                                ""
                            ),

                    url:
                        sourceUrl,

                    status:
                        "success"
                })
            );

    return {
        reply:
            reply ||
            "No reply generated.",

        sources:
            finalSources,

        usedUrlContext:
            true
    };
}


// ================================================================
// STANDARD GEMINI CALL
// ================================================================

async function callGemini(
    messages,
    model,
    isDeepResearch,
    preferences
) {
    if (
        !GEMINI_API_KEY
    ) {
        throw new Error(
            "Gemini API key missing"
        );
    }

    const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const body = {
        systemInstruction: {
            parts: [
                {
                    text:
                        buildSystemInstruction(
                            preferences
                        )
                }
            ]
        },

        contents:
            messages,

        generationConfig:
            getGenerationConfig(
                preferences.intelligence,
                isDeepResearch
            )
    };

    const response =
        await fetch(
            url,
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        body
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
        !response.ok
    ) {
        console.error(
            "Gemini API error:",
            data
        );

        throw new Error(
            data
                ?.error
                ?.message ||
            "Gemini API error"
        );
    }

    return data;
}


// ================================================================
// GEMINI FILE UPLOAD HELPERS
// ================================================================

async function deleteGeminiFile(
    apiKey,
    fileName
) {
    if (
        !fileName ||
        !apiKey
    ) {
        return;
    }

    const safeName =
        String(
            fileName
        ).replace(
            /^\/+/,
            ""
        );

    try {
        await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${safeName}?key=${encodeURIComponent(apiKey)}`,
            {
                method:
                    "DELETE"
            }
        );

    } catch (
        error
    ) {
        console.warn(
            "Gemini temporary file deletion failed:",
            error
        );
    }
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
            .from(
                file.bucket ||
                UPLOAD_BUCKET
            )
            .download(
                file.path
            );

    if (
        error ||
        !storedFile
    ) {
        throw new Error(
            error?.message ||
            `Unable to read ${file.name}.`
        );
    }

    const mimeType =
        file.mimeType ||
        storedFile.type ||
        "application/octet-stream";

    const bytes =
        await storedFile
            .arrayBuffer();

    const startResponse =
        await fetch(
            `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(GEMINI_API_KEY)}`,
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json",

                    "X-Goog-Upload-Protocol":
                        "resumable",

                    "X-Goog-Upload-Command":
                        "start",

                    "X-Goog-Upload-Header-Content-Length":
                        String(
                            bytes.byteLength
                        ),

                    "X-Goog-Upload-Header-Content-Type":
                        mimeType
                },

                body:
                    JSON.stringify({
                        file: {
                            displayName:
                                file.name ||
                                "NEO attachment"
                        }
                    })
            }
        );

    if (
        !startResponse.ok
    ) {
        const details =
            await startResponse
                .text()
                .catch(
                    () => ""
                );

        throw new Error(
            details ||
            "Gemini upload initialization failed."
        );
    }

    const uploadUrl =
        startResponse
            .headers
            .get(
                "x-goog-upload-url"
            );

    if (
        !uploadUrl
    ) {
        throw new Error(
            "Gemini upload URL was not returned."
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
                            bytes.byteLength
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

    const uploadData =
        await uploadResponse
            .json()
            .catch(
                () => ({})
            );

    if (
        !uploadResponse.ok
    ) {
        throw new Error(
            uploadData
                ?.error
                ?.message ||
            "Gemini file upload failed."
        );
    }

    const geminiFile =
        uploadData?.file;

    if (
        !geminiFile?.name ||
        !geminiFile?.uri
    ) {
        throw new Error(
            "Gemini file information was not returned."
        );
    }

    if (
        geminiFile.state ===
        "PROCESSING"
    ) {
        return await waitForGeminiFile(
            geminiFile.name,
            mimeType
        );
    }

    if (
        geminiFile.state ===
        "FAILED"
    ) {
        throw new Error(
            `Gemini could not process ${file.name}.`
        );
    }

    return {
        name:
            geminiFile.name,

        uri:
            geminiFile.uri,

        mimeType:
            geminiFile.mimeType ||
            mimeType
    };
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

        if (
            !response.ok
        ) {
            throw new Error(
                data
                    ?.error
                    ?.message ||
                "Unable to check Gemini file status."
            );
        }

        if (
            data.state ===
            "ACTIVE"
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
            data.state ===
            "FAILED"
        ) {
            throw new Error(
                "Gemini could not process this file."
            );
        }
    }

    throw new Error(
        "Gemini file processing timed out."
    );
}


// ================================================================
// SAVE MESSAGE
// ================================================================

async function saveMessage(
    supabase,
    conversationId,
    role,
    content,
    attachments,
    sources
) {
    const {
        error
    } =
        await supabase
            .from(
                "chat_messages"
            )
            .insert({
                conversation_id:
                    conversationId,

                role,

                content:
                    cleanString(
                        content,
                        MAX_MESSAGE_LENGTH
                    ),

                attachments:
                    attachments ||
                    [],

                sources:
                    sources ||
                    []
            });

    if (
        error
    ) {
        throw new Error(
            error.message
        );
    }
}


// ================================================================
// MAIN HANDLER
// ================================================================

export default async (
    req,
    res
) => {
    const geminiFiles =
        [];

    let userId =
        null;

    let reservedType =
        null;

    let isPro =
        false;


    try {
        // ============================================================
        // AUTH
        // IMPORTANT:
        // lib/auth.js returns auth.userId
        // ============================================================

        const auth =
            await getAuthenticatedUser(
                req
            );

        if (
            !auth?.userId
        ) {
            return res
                .status(
                    401
                )
                .json({
                    error:
                        "Authentication required. Please log in."
                });
        }

        const user = {
            id:
                auth.userId,

            username:
                auth.username ||
                "user"
        };

        userId =
            user.id;


        // ============================================================
        // REQUEST
        // ============================================================

        const {
            messages,
            conversationId,
            isDeepResearch,
            title
        } =
            req.body ||
            {};


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
                .status(
                    400
                )
                .json({
                    error:
                        "Messages array required"
                });
        }


        const lastMsg =
            messages[
                messages.length -
                1
            ];


        if (
            lastMsg?.role !==
            "user"
        ) {
            return res
                .status(
                    400
                )
                .json({
                    error:
                        "Last message must be user"
                });
        }


        // ============================================================
        // CREDIT RESERVATION
        // ============================================================

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


        if (
            reserveError
        ) {
            console.error(
                "Credit reservation failed:",
                reserveError
            );

            return res
                .status(
                    500
                )
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
                .status(
                    429
                )
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


        // ============================================================
        // ATTACHMENTS
        // ============================================================

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


        const attachments =
            validAttachmentList(
                receivedAttachments,
                user.id
            );


        // ============================================================
        // GEMINI HISTORY
        // ============================================================

        const history =
            messages.slice(
                -MAX_HISTORY_MESSAGES
            );


        const geminiMessages =
            history
                .map(
                    message => ({
                        role:
                            message.role ===
                            "assistant"
                                ? "model"
                                : message.role,

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


        // ============================================================
        // GEMINI ATTACHMENTS
        // ============================================================

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


            lastGeminiMessage.parts = [
                {
                    text:
                        originalText
                },

                ...attachmentParts
            ];
        }


        // ============================================================
        // CONVERSATION PERSISTENCE
        // ============================================================

        let convId =
            privateChat
                ? null
                : conversationId ||
                    null;


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


            if (
                convError
            ) {
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


        // ============================================================
        // MODEL
        // ============================================================

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


        // ============================================================
        // SEARCH DECISION
        // ============================================================

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


        let reply =
            "";

        let sources =
            [];

        let usedUrlContext =
            false;


        // ============================================================
        // DIRECT URL CONTEXT
        // ============================================================

        if (
            hasUrl
        ) {
            const urls =
                extractUrlsFromText(
                    userText
                )
                    .slice(
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

            // ========================================================
            // SMART WEB SEARCH
            // ========================================================

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


        // ============================================================
        // NORMAL GEMINI FALLBACK
        // ============================================================

        if (
            !reply
        ) {
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


            if (
                !reply
            ) {
                throw new Error(
                    "Gemini returned empty response"
                );
            }
        }


        // ============================================================
        // SAVE ASSISTANT
        // ============================================================

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


        // ============================================================
        // RESPONSE
        // ============================================================

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


        // ============================================================
        // CREDIT REFUND
        // ============================================================

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


            if (
                refundError
            ) {
                console.error(
                    "Credit refund failed:",
                    refundError
                );
            }
        }


        return res
            .status(
                500
            )
            .json({
                error:
                    error.message ||
                    "Unable to complete request."
            });


    } finally {

        // ============================================================
        // DELETE ONLY TEMPORARY GEMINI FILES
        // Never delete Supabase original attachment.
        // ============================================================

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
};
