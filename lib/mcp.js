/*
=========================================================
NEYO — ONE-CLICK MCP (remote MCP servers)
- User clicks "Connect" in Settings > Workspace, logs in
  (OAuth), token is saved ENCRYPTED in Supabase (neyo_mcp).
- In chat, NEYO acts as an MCP client (Streamable HTTP):
  tools/list -> Gemini function declarations, tools/call
  when the planner uses one.
- Only remote (online) MCP servers. Vercel can't run local
  (stdio) servers.
- Actions that CHANGE something need a clear ask from the
  user in the latest message (create / close / merge ...).
=========================================================
*/

import crypto from "node:crypto";

const env = name => String(process.env[name] || "").trim();

export const MCP_SERVERS = {
    github: {
        id: "github",
        name: "GitHub",
        prefix: "github_",
        url: "https://api.githubcopilot.com/mcp/",
        authorizeUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        scope: "repo read:org read:user gist notifications",
        clientId: () => env("NEYO_GITHUB_CLIENT_ID"),
        clientSecret: () => env("NEYO_GITHUB_CLIENT_SECRET"),
        headers: {
            "X-MCP-Toolsets": "context,repos,issues,pull_requests,users,gists"
        },
        // Messages that probably need this server.
        hint: /\b(git\s*hub|repo|repos|repository|repositories|issue|issues|pull\s*requests?|commit|commits|branch|branches|gist|gists|merge|fork|readme|workflow)\b/i,
        async account(token) {
            const response = await fetch("https://api.github.com/user", {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/vnd.github+json",
                    "User-Agent": "NEYO"
                }
            });
            if (!response.ok) {
                return "";
            }
            const user = await response.json().catch(() => ({}));
            return String(user.login || "");
        }
    }
};

export function mcpEnabled() {
    return env("NEYO_MCP").toLowerCase() !== "off";
}

export function serverConfigured(server) {
    return Boolean(server?.clientId() && server?.clientSecret());
}

/* ---------------------------------------------------------
   ENCRYPTION (AES-256-GCM). Key: NEYO_MCP_KEY, or derived
   from the Supabase service key (never leaves the server).
   --------------------------------------------------------- */

function secretKey() {
    const base = env("NEYO_MCP_KEY") || `${env("SUPABASE_SERVICE_ROLE_KEY")}:neyo-mcp-v1`;
    return crypto.createHash("sha256").update(base).digest();
}

export function encryptToken(text) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
    const data = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${data.toString("base64url")}`;
}

export function decryptToken(value) {
    const [version, iv, tag, data] = String(value || "").split(".");
    if (version !== "v1" || !iv || !tag || !data) {
        return "";
    }
    try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64url"));
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
    } catch {
        return "";
    }
}

/* ---------------------------------------------------------
   OAUTH STATE (signed, 10 minutes)
   --------------------------------------------------------- */

export function signState(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const mac = crypto.createHmac("sha256", secretKey()).update(body).digest("base64url");
    return `${body}.${mac}`;
}

export function readState(state) {
    const [body, mac] = String(state || "").split(".");
    if (!body || !mac) {
        return null;
    }
    const expected = crypto.createHmac("sha256", secretKey()).update(body).digest("base64url");
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return null;
    }
    try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (!payload?.t || Date.now() - payload.t > 10 * 60 * 1000) {
            return null;
        }
        return payload;
    } catch {
        return null;
    }
}

/* ---------------------------------------------------------
   STORAGE (table neyo_mcp)
   --------------------------------------------------------- */

export async function listConnections(supabase, userId) {
    const { data, error } = await supabase
        .from("neyo_mcp")
        .select("server, account, updated_at")
        .eq("user_id", userId);
    if (error) {
        throw error;
    }
    return data || [];
}

export async function saveConnection(supabase, { userId, server, token, account, scopes }) {
    const { error } = await supabase
        .from("neyo_mcp")
        .upsert({
            user_id: userId,
            server,
            token: encryptToken(token),
            account: account || "",
            scopes: scopes || "",
            updated_at: new Date().toISOString()
        }, { onConflict: "user_id,server" });
    if (error) {
        throw error;
    }
    toolCache.clear();
}

export async function deleteConnection(supabase, { userId, server }) {
    const { data } = await supabase
        .from("neyo_mcp")
        .select("token")
        .eq("user_id", userId)
        .eq("server", server)
        .maybeSingle();
    await supabase.from("neyo_mcp").delete().eq("user_id", userId).eq("server", server);
    toolCache.clear();
    return data?.token ? decryptToken(data.token) : "";
}

async function loadConnection(supabase, userId, server) {
    const { data, error } = await supabase
        .from("neyo_mcp")
        .select("token, account")
        .eq("user_id", userId)
        .eq("server", server)
        .maybeSingle();
    if (error || !data?.token) {
        return null;
    }
    const token = decryptToken(data.token);
    return token ? { token, account: data.account || "" } : null;
}

/* ---------------------------------------------------------
   MCP CLIENT (Streamable HTTP, JSON-RPC 2.0)
   --------------------------------------------------------- */

const PROTOCOL = "2025-06-18";

function parseBody(text, contentType, id) {
    if (/event-stream/i.test(contentType)) {
        const events = String(text).split(/\r?\n\r?\n/);
        for (const event of events) {
            const data = event
                .split(/\r?\n/)
                .filter(line => line.startsWith("data:"))
                .map(line => line.slice(5).trim())
                .join("\n");
            if (!data) continue;
            try {
                const message = JSON.parse(data);
                if (message && message.id === id) {
                    return message;
                }
            } catch {}
        }
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function createClient(server, token, timeoutMs = 15000) {
    let sessionId = "";
    let nextId = 1;

    async function post(body, wantReply) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(server.url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json, text/event-stream",
                    Authorization: `Bearer ${token}`,
                    "MCP-Protocol-Version": PROTOCOL,
                    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
                    ...(server.headers || {})
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            const sid = response.headers.get("mcp-session-id");
            if (sid) {
                sessionId = sid;
            }
            if (response.status === 401 || response.status === 403) {
                const error = new Error(`${server.name} login expired or not allowed (${response.status})`);
                error.auth = true;
                throw error;
            }
            if (!wantReply) {
                return null;
            }
            const text = await response.text();
            if (!response.ok) {
                throw new Error(`${server.name} MCP ${response.status}: ${text.slice(0, 160)}`);
            }
            const message = parseBody(text, response.headers.get("content-type") || "", body.id);
            if (!message) {
                throw new Error(`${server.name} MCP: empty reply`);
            }
            if (message.error) {
                throw new Error(`${server.name} MCP: ${message.error.message || "error"}`);
            }
            return message.result;
        } finally {
            clearTimeout(timer);
        }
    }

    const request = (method, params = {}) => post({ jsonrpc: "2.0", id: nextId++, method, params }, true);
    const notify = (method, params = {}) => post({ jsonrpc: "2.0", method, params }, false).catch(() => null);

    let ready = null;
    function start() {
        if (!ready) {
            ready = (async () => {
                await request("initialize", {
                    protocolVersion: PROTOCOL,
                    capabilities: {},
                    clientInfo: { name: "NEYO", version: "1.0" }
                });
                await notify("notifications/initialized");
            })();
        }
        return ready;
    }

    return {
        async listTools() {
            await start();
            const tools = [];
            let cursor;
            for (let page = 0; page < 4; page += 1) {
                const result = await request("tools/list", cursor ? { cursor } : {});
                (result?.tools || []).forEach(tool => tools.push(tool));
                cursor = result?.nextCursor;
                if (!cursor) break;
            }
            return tools;
        },
        async callTool(name, args) {
            await start();
            return request("tools/call", { name, arguments: args || {} });
        }
    };
}

/* ---------------------------------------------------------
   JSON SCHEMA -> GEMINI SCHEMA (safe subset)
   --------------------------------------------------------- */

function cleanSchema(schema, depth = 0) {
    if (!schema || typeof schema !== "object" || depth > 6) {
        return { type: "string" };
    }
    let type = schema.type;
    if (Array.isArray(type)) {
        type = type.find(item => item !== "null") || "string";
    }
    if (!type) {
        const option = (schema.anyOf || schema.oneOf || []).find(item => item && item.type && item.type !== "null");
        if (option) {
            return cleanSchema({ ...option, description: schema.description || option.description }, depth);
        }
        type = schema.properties ? "object" : "string";
    }
    const out = { type };
    if (schema.description) {
        out.description = String(schema.description).slice(0, 300);
    }
    if (Array.isArray(schema.enum) && schema.enum.length && schema.enum.every(item => typeof item === "string")) {
        out.enum = schema.enum.slice(0, 50);
    }
    if (type === "array") {
        out.items = cleanSchema(schema.items || { type: "string" }, depth + 1) || { type: "string" };
    }
    if (type === "object") {
        const properties = {};
        Object.entries(schema.properties || {}).slice(0, 40).forEach(([key, value]) => {
            if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key)) return;
            const clean = cleanSchema(value, depth + 1);
            if (!clean || (clean.type === "object" && !clean.properties)) return;
            properties[key] = clean;
        });
        if (!Object.keys(properties).length) {
            return null;
        }
        out.properties = properties;
        const required = (schema.required || []).filter(key => properties[key]);
        if (required.length) {
            out.required = required;
        }
    }
    return out;
}

const READ_NAME = /(^|[-_])(list|get|find|search|retrieve|read|fetch|describe|lookup|download|count)([-_]|$)/i;

function toDeclaration(server, tool) {
    const name = `${server.prefix}${String(tool.name || "").replace(/[^A-Za-z0-9_]/g, "_")}`.slice(0, 64);
    const hint = tool.annotations?.readOnlyHint;
    // No hint from the server: guess from the name (list/get/find/search...).
    const readOnly = hint === true ||
        (hint === undefined && READ_NAME.test(String(tool.name || "")));
    const declaration = {
        name,
        description: `[${server.name}${readOnly ? "" : ", CHANGES DATA"}] ${String(tool.description || tool.title || tool.name).slice(0, 400)}`
    };
    const parameters = cleanSchema(tool.inputSchema || {});
    if (parameters && parameters.type === "object" && parameters.properties) {
        declaration.parameters = parameters;
    }
    return { declaration, original: tool.name, readOnly };
}

/* ---------------------------------------------------------
   PIPEDREAM CONNECT: 3,000+ apps with one setup.
   Owner sets once in Vercel: PIPEDREAM_CLIENT_ID,
   PIPEDREAM_CLIENT_SECRET, PIPEDREAM_PROJECT_ID,
   PIPEDREAM_ENVIRONMENT (production | development).
   Each NEYO user connects their own apps; Pipedream keeps the
   tokens, keyed by the NEYO user id (external_user_id).
   --------------------------------------------------------- */

const PD_API = "https://api.pipedream.com/v1";
const PD_MCP_URL = "https://remote.mcp.pipedream.net/v3";

export function pipedreamConfigured() {
    return Boolean(env("PIPEDREAM_CLIENT_ID") && env("PIPEDREAM_CLIENT_SECRET") && env("PIPEDREAM_PROJECT_ID"));
}

function pdEnvironment() {
    return env("PIPEDREAM_ENVIRONMENT").toLowerCase() === "development" ? "development" : "production";
}

let pdTokenCache = { token: "", until: 0 };

async function pdToken() {
    if (pdTokenCache.token && Date.now() < pdTokenCache.until) {
        return pdTokenCache.token;
    }
    const response = await fetch(`${PD_API}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            grant_type: "client_credentials",
            client_id: env("PIPEDREAM_CLIENT_ID"),
            client_secret: env("PIPEDREAM_CLIENT_SECRET")
        })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
        throw new Error(`Pipedream token failed (${response.status})`);
    }
    const seconds = Number(data.expires_in) || 3600;
    pdTokenCache = { token: data.access_token, until: Date.now() + Math.max(60, seconds - 120) * 1000 };
    return data.access_token;
}

async function pdApi(path, { method = "GET", body } = {}) {
    const token = await pdToken();
    const response = await fetch(`${PD_API}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "x-pd-environment": pdEnvironment(),
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (response.status === 204) {
        return null;
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(`Pipedream ${method} ${path.split("?")[0]} ${response.status}: ${JSON.stringify(data || {}).slice(0, 160)}`);
    }
    return data;
}

const pdProject = () => encodeURIComponent(env("PIPEDREAM_PROJECT_ID"));
const accountCache = new Map();
const ACCOUNT_CACHE_MS = 5 * 60 * 1000;

function simpleApp(app = {}) {
    return {
        slug: String(app.name_slug || ""),
        name: String(app.name || app.name_slug || ""),
        img: String(app.img_src || ""),
        description: String(app.description || "").slice(0, 140)
    };
}

export async function pdListAccounts(userId, { fresh = false } = {}) {
    if (!pipedreamConfigured() || !userId) {
        return [];
    }
    const cached = accountCache.get(userId);
    if (!fresh && cached && Date.now() - cached.at < ACCOUNT_CACHE_MS) {
        return cached.list;
    }
    const data = await pdApi(`/connect/${pdProject()}/users/${encodeURIComponent(userId)}/accounts`);
    const items = Array.isArray(data) ? data : (data?.data || []);
    const list = items
        .filter(item => item && item.id && !item.dead)
        .map(item => ({
            id: String(item.id),
            name: String(item.name || ""),
            healthy: item.healthy !== false,
            app: simpleApp(item.app)
        }));
    accountCache.set(userId, { at: Date.now(), list });
    return list;
}

export async function pdSearchApps(query) {
    if (!pipedreamConfigured()) {
        return [];
    }
    const params = new URLSearchParams({
        limit: "12",
        sort_key: "featured_weight",
        sort_direction: "desc",
        has_actions: "true"
    });
    const q = String(query || "").trim().slice(0, 60);
    if (q) {
        params.set("q", q);
    }
    const data = await pdApi(`/connect/apps?${params}`);
    return (data?.data || []).map(simpleApp).filter(app => app.slug);
}

export async function pdConnectLink(userId, app, { origin }) {
    const slug = String(app || "").trim();
    if (!/^[a-z0-9_]{1,80}$/.test(slug)) {
        throw new Error("Bad app.");
    }
    const back = result => `${origin}/?mcp=${result}&server=${encodeURIComponent(slug)}`;
    const data = await pdApi(`/connect/${pdProject()}/tokens`, {
        method: "POST",
        body: {
            external_user_id: userId,
            success_redirect_uri: back("connected"),
            error_redirect_uri: back("error"),
            expires_in: 900
        }
    });
    if (!data?.connect_link_url) {
        throw new Error("No connect link.");
    }
    accountCache.delete(userId);
    const link = new URL(data.connect_link_url);
    link.searchParams.set("app", slug);
    return link.toString();
}

export async function pdDisconnect(userId, accountId) {
    const accounts = await pdListAccounts(userId, { fresh: true });
    // Only the user's own account can be removed.
    if (!accounts.some(item => item.id === accountId)) {
        throw new Error("Not your account.");
    }
    await pdApi(`/connect/${pdProject()}/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" });
    accountCache.delete(userId);
    toolCache.clear();
}

// Extra words people use for common apps (name + slug always match).
const APP_WORDS = {
    gmail: "email|emails|mail|mails|inbox",
    google_calendar: "calendar|meeting|meetings|event|events",
    google_drive: "drive",
    google_sheets: "sheet|sheets|spreadsheet",
    google_docs: "doc|docs|document",
    microsoft_outlook: "outlook|email|emails|mail|inbox",
    slack: "slack",
    notion: "notion",
    trello: "trello|board|card|cards",
    discord: "discord",
    telegram_bot_api: "telegram",
    whatsapp_business: "whatsapp",
    youtube_data_api: "youtube",
    supabase: "supabase|database|table|sql",
    github: "github|repo|repos|issue|issues|pull request"
};

function appMatcher(app) {
    const words = new Set();
    const add = value => {
        const clean = String(value || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
        if (clean.length >= 3) words.add(clean);
    };
    add(app.name);
    add(app.slug.replace(/_/g, " "));
    // "google_sheets" -> "sheets"; "microsoft_outlook" -> "outlook"
    const parts = app.slug.split("_").filter(part => part.length >= 4 && !/^(google|microsoft|api|app|bot|data|business|oauth)$/.test(part));
    parts.forEach(add);
    String(APP_WORDS[app.slug] || "").split("|").forEach(add);
    const escaped = [...words].map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*"));
    return escaped.length ? new RegExp(`\\b(${escaped.join("|")})\\b`, "i") : null;
}

function pdServer(userId, account) {
    const short = account.app.slug.replace(/[^a-z0-9]/g, "").slice(0, 14) || "app";
    return {
        id: `pd:${account.app.slug}`,
        name: account.app.name,
        prefix: `pd_${short}_`,
        url: PD_MCP_URL,
        headers: {
            "x-pd-project-id": env("PIPEDREAM_PROJECT_ID"),
            "x-pd-environment": pdEnvironment(),
            "x-pd-external-user-id": userId,
            "x-pd-app-slug": account.app.slug,
            "x-pd-account-id": account.id
        }
    };
}

async function pipedreamPieces(userId, question) {
    if (!pipedreamConfigured()) {
        return [];
    }
    const accounts = await pdListAccounts(userId).catch(error => {
        console.warn("[MCP] pipedream accounts", error?.message || error);
        return [];
    });
    const seen = new Set();
    const picked = accounts.filter(account => {
        if (!account.healthy || seen.has(account.app.slug)) return false;
        const matcher = appMatcher(account.app);
        if (!matcher || !matcher.test(question)) return false;
        seen.add(account.app.slug);
        return true;
    }).slice(0, 3);
    if (!picked.length) {
        return [];
    }
    const token = await pdToken();
    return picked.map(account => ({
        server: pdServer(userId, account),
        token,
        account: account.name,
        cacheKey: `pd:${userId}:${account.id}`,
        line: `- ${account.app.name} is connected${account.name ? ` (${account.name})` : ""}. Use the ${pdServer(userId, account).prefix}* tools for anything about the user's ${account.app.name}.`
    }));
}

/* ---------------------------------------------------------
   CHAT: tools for this user + message
   --------------------------------------------------------- */

const toolCache = new Map();
const TOOL_CACHE_MS = 10 * 60 * 1000;

// The user clearly asked to DO something (or confirmed).
const ACTION_ASK = /\b(bana|banao|banado|bana\s*do|create|make|close|reopen|band\s*kar|merge|comment|likh|likho|post|add|delete|remove|hata|hatao|mita|mitao|update|edit|change|badal|badlo|push|commit|assign|label|fork|star|unstar|rename|send|bhej|bhejo|bhej\s*do|reply|jawab\s*do|schedule|invite|archive|move|upload|haan|han|yes|ok|okay|theek\s*hai|confirm|go\s*ahead)\b/i;

export async function loadMcpTools(supabase, { userId, question, timeoutMs = 9000 } = {}) {
    if (!mcpEnabled() || !userId || !question || String(question).trim().length < 4) {
        return null;
    }
    const pieces = [];

    // Own OAuth servers (GitHub) — only when the message hints at them.
    await Promise.all(Object.values(MCP_SERVERS).filter(server => server.hint.test(question)).map(async server => {
        const conn = await loadConnection(supabase, userId, server.id).catch(() => null);
        if (!conn) return;
        pieces.push({
            server,
            token: conn.token,
            account: conn.account,
            cacheKey: crypto.createHash("sha256").update(`${server.id}:${conn.token}`).digest("hex"),
            line: `- ${server.name} is connected${conn.account ? ` as @${conn.account}` : ""}. Use the ${server.prefix}* tools for anything about the user's ${server.name} (their repos, issues, pull requests, files, commits, gists). "My repos" means @${conn.account || "the connected account"}.`
        });
    }));

    // Pipedream apps the user connected and the message mentions.
    const pdPieces = await pipedreamPieces(userId, question).catch(error => {
        console.warn("[MCP] pipedream", error?.message || error);
        return [];
    });
    pdPieces.forEach(piece => {
        // GitHub via own OAuth wins over Pipedream's GitHub.
        if (piece.server.headers["x-pd-app-slug"] === "github" && pieces.some(item => item.server.id === "github")) return;
        pieces.push(piece);
    });

    if (!pieces.length) {
        return null;
    }

    const declarations = [];
    const runners = new Map();
    const lines = [];

    await Promise.all(pieces.map(async piece => {
        const { server } = piece;
        const client = createClient(server, piece.token);
        let tools = toolCache.get(piece.cacheKey);
        if (!tools || Date.now() - tools.at > TOOL_CACHE_MS) {
            const list = await Promise.race([
                client.listTools(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("tools/list timeout")), timeoutMs))
            ]).catch(error => {
                console.warn("[MCP] list failed", server.id, error?.message || error);
                return null;
            });
            if (!list) return;
            tools = {
                at: Date.now(),
                list: list.slice(0, 60).map(tool => {
                    try {
                        return toDeclaration(server, tool);
                    } catch {
                        return null;
                    }
                }).filter(Boolean)
            };
            toolCache.set(piece.cacheKey, tools);
        }
        tools.list.forEach(item => {
            declarations.push(item.declaration);
            runners.set(item.declaration.name, { server, client, ...item });
        });
        lines.push(piece.line);
    }));

    if (!declarations.length) {
        return null;
    }

    const allowWrites = ACTION_ASK.test(question);
    console.log("[MCP] tools", declarations.length, "writes", allowWrites ? "allowed" : "blocked");

    return {
        declarations,
        has: name => runners.has(name),
        instruction: `CONNECTED APPS (MCP):
${lines.join("\n")}
- Read tools: use freely, call several in parallel, chain them (e.g. list repos, then read a file).
- Tools marked CHANGES DATA (create/edit/close/merge/comment/push/delete): only when the user's LATEST message clearly asks for that exact action (or confirms it). If unsure, do NOT call it; in your notes write what you would do so the writer can ask the user to confirm.
- If a tool result contains a pipedream.com connect link, give that link to the user so they can connect the account.
- Never reveal tokens or secrets.`,
        async run(name, args) {
            const item = runners.get(name);
            if (!item) {
                return { error: "Unknown tool." };
            }
            if (!item.readOnly && !allowWrites) {
                return { error: `This would change ${item.server.name}. Ask the user to confirm clearly first (e.g. "haan, kar do").` };
            }
            const started = Date.now();
            try {
                const result = await item.client.callTool(item.original, args);
                const text = (result?.content || [])
                    .map(part => part.type === "text" ? part.text : part.type === "resource" ? (part.resource?.text || "") : `[${part.type}]`)
                    .join("\n")
                    .slice(0, 8000);
                console.log("[MCP] call", name, result?.isError ? "error" : "ok", `${Date.now() - started}ms`);
                return result?.isError ? { error: text.slice(0, 1500) || "Tool failed." } : { result: text || "(empty)" };
            } catch (error) {
                console.warn("[MCP] call failed", name, error?.message || error);
                return { error: error?.auth ? `${item.server.name} login expired. Tell the user to reconnect it in Settings > Workspace.` : String(error?.message || error).slice(0, 300) };
            }
        }
    };
}
