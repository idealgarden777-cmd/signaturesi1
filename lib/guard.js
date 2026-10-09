/*
=========================================================
NEYO — API GUARD
One place for the checks every paid API route needs:
- same-site origin only (APP_ORIGIN)
- logged-in NEYO / Bean user only
- simple per-user rate limit

Rate limit: shared across every Vercel server through the
Supabase function neyo_rate_hit (supabase/neyo_rate_limit.sql).
If that SQL has not been run yet, or Supabase is slow, it
falls back to a per-server memory limit, so NEYO never
breaks because of the limiter.
=========================================================
*/

import { getAuthenticatedUser } from "./auth.js";
import { isAllowedOrigin } from "./http.js";
import { createClient } from "@supabase/supabase-js";

let rateDb = null;
let sharedLimitMissing = false;

function getRateDb() {
    if (rateDb) return rateDb;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    rateDb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return rateDb;
}

// tests swap in a fake database
export function __setRateDb(db) {
    rateDb = db;
    sharedLimitMissing = false;
}

/*
Shared limit across all servers. Returns null when the shared
limiter is not available, so the caller uses the memory limit.
*/
export async function takeSharedRateLimit(key, limit, windowMs, timeoutMs = 1500) {
    if (sharedLimitMissing) return null;
    const db = getRateDb();
    if (!db?.rpc) return null;

    try {
        const call = db.rpc("neyo_rate_hit", {
            p_key: key,
            p_limit: limit,
            p_window_seconds: Math.ceil(windowMs / 1000)
        });
        const timeout = new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), timeoutMs));
        const result = await Promise.race([call, timeout]);

        if (result?.timedOut) return null;
        if (result?.error) {
            // function not created yet: stop asking on this server
            if (/PGRST202|42883|could not find|does not exist/i.test(`${result.error.code} ${result.error.message}`)) {
                sharedLimitMissing = true;
                console.warn("[NEYO Guard] shared rate limit not set up; run supabase/neyo_rate_limit.sql");
            }
            return null;
        }

        const data = typeof result?.data === "string" ? JSON.parse(result.data) : result?.data;
        if (!data || typeof data.ok !== "boolean") return null;
        return { ok: data.ok, retryAfterSec: Number(data.retry_after) || 1, remaining: data.remaining };
    } catch (error) {
        console.warn("[NEYO Guard] shared rate limit error:", error?.message || error);
        return null;
    }
}

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

    const rateKey = `${name}:${user.userId}`;
    const rate =
        (await takeSharedRateLimit(rateKey, limit, windowMs)) ||
        takeRateLimit(rateKey, limit, windowMs);
    if (!rate.ok) {
        res.setHeader("Retry-After", String(rate.retryAfterSec));
        send(res, 429, { error: "Too many requests. Please wait a moment and try again." });
        return null;
    }

    return user;
}
