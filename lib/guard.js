/*
=========================================================
NEYO — API GUARD
One place for the checks every paid API route needs:
- same-site origin only (APP_ORIGIN)
- logged-in NEYO / Bean user only
- simple per-user rate limit

The rate limit lives in the function's memory, so it is
per server instance (Vercel may run a few). It stops
loops and casual abuse; it is not a billing system.
=========================================================
*/

import { getAuthenticatedUser } from "./auth.js";
import { isAllowedOrigin } from "./http.js";

const buckets = new Map();
const MAX_BUCKETS = 5000;

function send(res, status, body) {
    res.status(status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.json(body);
}

/*
Returns true when this key is still under its limit, and
records the hit. limit = hits allowed per windowMs.
*/
export function takeRateLimit(key, limit, windowMs, now = Date.now()) {
    const since = now - windowMs;
    const hits = (buckets.get(key) || []).filter(time => time > since);

    if (hits.length >= limit) {
        buckets.set(key, hits);
        return {
            ok: false,
            retryAfterSec: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000))
        };
    }

    hits.push(now);
    buckets.set(key, hits);

    // keep memory small on long-lived instances
    if (buckets.size > MAX_BUCKETS) {
        for (const [bucketKey, times] of buckets) {
            if (!times.length || times[times.length - 1] <= since) {
                buckets.delete(bucketKey);
            }
            if (buckets.size <= MAX_BUCKETS / 2) break;
        }
    }

    return { ok: true, remaining: limit - hits.length };
}

export function resetRateLimits() {
    buckets.clear();
}

/*
Use at the top of a handler:

    const user = await guardRequest(req, res, { name: "voice", limit: 20, windowMs: 600000 });
    if (!user) return; // response already sent
*/
export async function guardRequest(req, res, { name = "api", limit = 30, windowMs = 10 * 60 * 1000 } = {}) {
    let originOk = false;
    try {
        originOk = isAllowedOrigin(req);
    } catch (error) {
        console.error(`[NEYO Guard] ${name} origin config:`, error.message);
        send(res, 500, { error: "Service is not configured." });
        return null;
    }

    if (!originOk) {
        send(res, 403, { error: "Request blocked." });
        return null;
    }

    let user = null;
    try {
        user = await getAuthenticatedUser(req);
    } catch (error) {
        console.error(`[NEYO Guard] ${name} auth failed:`, error.message);
    }

    if (!user?.userId) {
        send(res, 401, { error: "Please log in to use this.", authenticated: false });
        return null;
    }

    const rate = takeRateLimit(`${name}:${user.userId}`, limit, windowMs);
    if (!rate.ok) {
        res.setHeader("Retry-After", String(rate.retryAfterSec));
        send(res, 429, { error: "Too many requests. Please wait a moment and try again." });
        return null;
    }

    return user;
}
