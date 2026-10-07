/* =========================================================
   NEYO CONTEXT CACHE
   ---------------------------------------------------------
   Long chats send the same old messages to the model again
   and again. This keeps the older part of the chat (plus the
   system prompt) in a Gemini "cachedContent", so each new
   question only sends the new messages.

   - Checkpoints: the cached part grows in steps of 4 messages,
     so one cache is reused for about 2 turns before a new
     (bigger) one is made.
   - Only used when the old part is big enough
     (NEYO_CACHE_MIN_TOKENS, default 2048 estimated tokens).
   - Models: NEYO_CONTEXT_CACHE = "gemma" (default, free on
     the free tier), "all" (paid key), or "off".
   - Every failure falls back to a normal request.
   ========================================================= */

import { createHash } from "node:crypto";

const MODE =
    String(process.env.NEYO_CONTEXT_CACHE || "gemma").toLowerCase();

const MIN_TOKENS =
    Number(process.env.NEYO_CACHE_MIN_TOKENS) || 2048;

const TTL_SECONDS =
    Number(process.env.NEYO_CACHE_TTL_SECONDS) || 3600;

const CREATE_TIMEOUT_MS = 4000;

const CHUNK = 4;

// key -> { name, expiresAt }
const caches = new Map();

// key or "model:<name>" -> time until we stop trying
const blocked = new Map();


function modelAllowed(model = "") {

    if (MODE === "off") return false;

    if (MODE === "all") return /gemma|gemini/i.test(model);

    return /gemma/i.test(model);

}


function estimateTokens(systemText, contents) {

    let chars =
        String(systemText || "").length;

    let extra = 0;

    for (const item of contents) {

        for (const part of item.parts || []) {

            if (typeof part.text === "string") {
                chars += part.text.length;
            } else if (part.fileData || part.inlineData) {
                extra += 1000;
            }

        }

    }

    return Math.round(chars / 3.5) + extra;

}


function isBlocked(key) {

    const until =
        blocked.get(key);

    if (!until) return false;

    if (Date.now() > until) {
        blocked.delete(key);
        return false;
    }

    return true;

}


function block(key, ms) {

    blocked.set(key, Date.now() + ms);

}


async function createCache({ apiKey, model, systemText, prefix, key }) {

    const controller =
        new AbortController();

    const timer =
        setTimeout(() => controller.abort(), CREATE_TIMEOUT_MS);

    try {

        const response =
            await fetch(
                `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${encodeURIComponent(apiKey)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: `models/${model}`,
                        displayName: `neyo-${key.slice(0, 16)}`,
                        ...(systemText
                            ? { systemInstruction: { parts: [{ text: systemText }] } }
                            : {}),
                        contents: prefix,
                        ttl: `${TTL_SECONDS}s`
                    }),
                    signal: controller.signal
                }
            );

        const data =
            await response.json().catch(() => ({}));

        if (!response.ok || !data?.name) {

            const message =
                String(data?.error?.message || response.status);

            console.warn("[CACHE] create failed", model, message.slice(0, 200));

            // Model can't cache at all -> stop trying for an hour.
            if (/not supported|not found|unsupported|permission|not available/i.test(message)) {
                block(`model:${model}`, 60 * 60 * 1000);
            } else {
                block(key, 30 * 60 * 1000);
            }

            return null;

        }

        const expiresAt =
            Date.parse(data.expireTime || "") ||
            Date.now() + TTL_SECONDS * 1000;

        caches.set(key, { name: data.name, expiresAt });

        console.log(
            "[CACHE] created",
            model,
            data.name,
            data.usageMetadata?.totalTokenCount || ""
        );

        return data.name;

    } catch (error) {

        console.warn("[CACHE] create error", model, error?.name || error?.message);

        block(key, 5 * 60 * 1000);

        return null;

    } finally {

        clearTimeout(timer);

    }

}


/**
 * Returns a request body that uses a cache when it helps,
 * or the same body unchanged.
 * Result: { body, cacheName, cachedMessages, created }
 */
export async function applyContextCache({ apiKey, model, body }) {

    const plain = { body, cacheName: null, cachedMessages: 0, created: false };

    try {

        if (!apiKey || !modelAllowed(model) || isBlocked(`model:${model}`)) {
            return plain;
        }

        const contents =
            Array.isArray(body?.contents) ? body.contents : [];

        // Older part = everything before the current question,
        // cut at a 4-message checkpoint that ends on a model reply.
        let cut =
            Math.floor((contents.length - 1) / CHUNK) * CHUNK;

        while (cut > 0 && contents[cut - 1]?.role !== "model") {
            cut -= 1;
        }

        if (cut < 2) return plain;

        const prefix =
            contents.slice(0, cut);

        const systemText =
            body.systemInstruction?.parts?.map(part => part.text || "").join("") || "";

        if (estimateTokens(systemText, prefix) < MIN_TOKENS) {
            return plain;
        }

        const key =
            createHash("sha256")
                .update(model)
                .update("\u0000")
                .update(systemText)
                .update("\u0000")
                .update(JSON.stringify(prefix))
                .digest("hex");

        if (isBlocked(key)) return plain;

        let created = false;

        let entry =
            caches.get(key);

        if (entry && entry.expiresAt - Date.now() < 2 * 60 * 1000) {
            caches.delete(key);
            entry = null;
        }

        let name =
            entry?.name || null;

        if (!name) {

            name =
                await createCache({ apiKey, model, systemText, prefix, key });

            created = Boolean(name);

        }

        if (!name) return plain;

        console.log("[CACHE]", created ? "new" : "reused", model, `${cut} old messages`);

        const { systemInstruction, tools, toolConfig, ...rest } = body;

        return {
            body: {
                ...rest,
                cachedContent: name,
                contents: contents.slice(cut)
            },
            cacheName: name,
            cachedMessages: cut,
            created,
            key
        };

    } catch (error) {

        console.warn("[CACHE] skipped", error?.message);

        return plain;

    }

}


/** Call when a request that used the cache was rejected. */
export function dropContextCache(cacheName) {

    for (const [key, entry] of caches) {

        if (entry.name === cacheName) {
            caches.delete(key);
            block(key, 10 * 60 * 1000);
        }

    }

}
