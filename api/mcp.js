/*
NEYO — one-click MCP connections
GET  /api/mcp?action=status               -> { servers: [...] }
GET  /api/mcp?action=connect&server=github -> redirect to GitHub login
GET  /api/mcp?code=..&state=..            -> GitHub returns here
POST /api/mcp?action=disconnect  {server} -> removes the connection
Pipedream (3,000+ apps):
GET  /api/mcp?action=apps&q=gmail          -> { apps: [...] }
POST /api/mcp?action=pd_connect  {app}     -> { url } (Pipedream login page)
POST /api/mcp?action=pd_disconnect {account} -> removes that app account
*/

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "../lib/auth.js";
import {
    MCP_SERVERS,
    serverConfigured,
    signState,
    readState,
    listConnections,
    saveConnection,
    deleteConnection,
    pipedreamConfigured,
    pdListAccounts,
    pdSearchApps,
    pdConnectLink,
    pdDisconnect
} from "../lib/mcp.js";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
);

const STATE_COOKIE = "neyo_mcp_state";

function origin(req) {
    const fixed = String(process.env.NEYO_PUBLIC_URL || "").trim().replace(/\/+$/, "");
    if (fixed) return fixed;
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    return `${proto}://${host}`;
}

function callbackUrl(req) {
    return `${origin(req)}/api/mcp`;
}

function getCookie(req, name) {
    for (const cookie of String(req.headers.cookie || "").split(";")) {
        const [key, ...rest] = cookie.trim().split("=");
        if (key === name) return decodeURIComponent(rest.join("="));
    }
    return "";
}

function redirect(res, url) {
    res.statusCode = 302;
    res.setHeader("Location", url);
    res.setHeader("Cache-Control", "no-store");
    res.end();
}

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
}

function back(res, result, server = "") {
    redirect(res, `/?mcp=${encodeURIComponent(result)}${server ? `&server=${encodeURIComponent(server)}` : ""}`);
}

async function readBody(req) {
    if (req.body && typeof req.body === "object") return req.body;
    if (typeof req.body === "string") {
        try { return JSON.parse(req.body); } catch { return {}; }
    }
    return await new Promise(resolve => {
        let data = "";
        req.on("data", chunk => { data += chunk; if (data.length > 10000) req.destroy(); });
        req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
        req.on("error", () => resolve({}));
    });
}

export default async function handler(req, res) {
    const url = new URL(req.url, "http://local");
    // GitHub comes back to /api/mcp?code=...&state=... (no action).
    const action = url.searchParams.get("action") ||
        (url.searchParams.get("state") ? "callback" : "status");

    try {
        const auth = await getAuthenticatedUser(req).catch(() => null);
        const userId = auth?.userId || "";

        /* ---------- STATUS ---------- */
        if (action === "status") {
            if (!userId) return json(res, 401, { error: "Login required." });
            let rows = [];
            let tableMissing = false;
            try {
                rows = await listConnections(supabase, userId);
            } catch (error) {
                tableMissing = true;
                console.warn("[MCP] status", error?.message || error);
            }
            const servers = Object.values(MCP_SERVERS).map(server => {
                const row = rows.find(item => item.server === server.id);
                return {
                    id: server.id,
                    name: server.name,
                    configured: serverConfigured(server) && !tableMissing,
                    connected: Boolean(row),
                    account: row?.account || ""
                };
            });
            let accounts = [];
            let pdError = false;
            if (pipedreamConfigured()) {
                accounts = await pdListAccounts(userId, { fresh: true }).catch(error => {
                    pdError = true;
                    console.warn("[MCP] pipedream status", error?.message || error);
                    return [];
                });
            }
            return json(res, 200, {
                servers,
                pipedream: {
                    configured: pipedreamConfigured() && !pdError,
                    accounts
                }
            });
        }

        /* ---------- PIPEDREAM ---------- */
        if (action === "apps") {
            if (!userId) return json(res, 401, { error: "Login required." });
            if (!pipedreamConfigured()) return json(res, 200, { apps: [] });
            const apps = await pdSearchApps(url.searchParams.get("q") || "");
            return json(res, 200, { apps });
        }

        if (action === "pd_connect") {
            if (req.method !== "POST") return json(res, 405, { error: "POST only." });
            if (!userId) return json(res, 401, { error: "Login required." });
            if (!pipedreamConfigured()) return json(res, 400, { error: "Not set up on the server." });
            const body = await readBody(req);
            const link = await pdConnectLink(userId, body.app, { origin: origin(req) });
            return json(res, 200, { url: link });
        }

        if (action === "pd_disconnect") {
            if (req.method !== "POST") return json(res, 405, { error: "POST only." });
            if (!userId) return json(res, 401, { error: "Login required." });
            const body = await readBody(req);
            await pdDisconnect(userId, String(body.account || ""));
            return json(res, 200, { ok: true });
        }

        /* ---------- CONNECT ---------- */
        if (action === "connect") {
            const server = MCP_SERVERS[url.searchParams.get("server") || ""];
            if (!server) return back(res, "error", "");
            if (!userId) return back(res, "login", server.id);
            if (!serverConfigured(server)) return back(res, "not_configured", server.id);

            const nonce = crypto.randomBytes(16).toString("base64url");
            const state = signState({ u: userId, s: server.id, n: nonce, t: Date.now() });
            res.setHeader("Set-Cookie", `${STATE_COOKIE}=${nonce}; Path=/api/mcp; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);

            const target = new URL(server.authorizeUrl);
            target.searchParams.set("client_id", server.clientId());
            target.searchParams.set("redirect_uri", callbackUrl(req));
            target.searchParams.set("scope", server.scope);
            target.searchParams.set("state", state);
            target.searchParams.set("allow_signup", "false");
            return redirect(res, target.toString());
        }

        /* ---------- CALLBACK ---------- */
        if (action === "callback") {
            const state = readState(url.searchParams.get("state"));
            const server = MCP_SERVERS[state?.s || ""];
            res.setHeader("Set-Cookie", `${STATE_COOKIE}=; Path=/api/mcp; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
            if (!state || !server) return back(res, "error", "");
            if (url.searchParams.get("error")) return back(res, "cancelled", server.id);
            // Signed state + this browser's nonce cookie prove who started it.
            if ((userId && userId !== state.u) || getCookie(req, STATE_COOKIE) !== state.n) {
                return back(res, "error", server.id);
            }
            const ownerId = state.u;
            const code = url.searchParams.get("code");
            if (!code) return back(res, "error", server.id);

            const response = await fetch(server.tokenUrl, {
                method: "POST",
                headers: { Accept: "application/json", "Content-Type": "application/json" },
                body: JSON.stringify({
                    client_id: server.clientId(),
                    client_secret: server.clientSecret(),
                    code,
                    redirect_uri: callbackUrl(req)
                })
            });
            const tokenData = await response.json().catch(() => ({}));
            const token = tokenData?.access_token;
            if (!token) {
                console.warn("[MCP] token exchange failed", tokenData?.error || response.status);
                return back(res, "error", server.id);
            }
            const account = await server.account(token).catch(() => "");
            await saveConnection(supabase, {
                userId: ownerId,
                server: server.id,
                token,
                account,
                scopes: tokenData.scope || ""
            });
            console.log("[MCP] connected", server.id);
            return back(res, "connected", server.id);
        }

        /* ---------- DISCONNECT ---------- */
        if (action === "disconnect") {
            if (req.method !== "POST") return json(res, 405, { error: "POST only." });
            if (!userId) return json(res, 401, { error: "Login required." });
            const body = await readBody(req);
            const server = MCP_SERVERS[String(body.server || "")];
            if (!server) return json(res, 400, { error: "Unknown server." });
            const token = await deleteConnection(supabase, { userId, server: server.id });
            // Also remove NEYO's access on GitHub (best effort).
            if (token && server.id === "github" && serverConfigured(server)) {
                const basic = Buffer.from(`${server.clientId()}:${server.clientSecret()}`).toString("base64");
                await fetch(`https://api.github.com/applications/${server.clientId()}/grant`, {
                    method: "DELETE",
                    headers: {
                        Authorization: `Basic ${basic}`,
                        Accept: "application/vnd.github+json",
                        "Content-Type": "application/json",
                        "User-Agent": "NEYO"
                    },
                    body: JSON.stringify({ access_token: token })
                }).catch(() => null);
            }
            return json(res, 200, { ok: true });
        }

        return json(res, 400, { error: "Unknown action." });
    } catch (error) {
        console.error("[MCP] handler", error?.message || error);
        if (action === "connect" || action === "callback") return back(res, "error", "");
        return json(res, 500, { error: "Something went wrong." });
    }
}
