// Safe fake settings so server files can be imported in tests.
// Nothing here talks to the real Supabase or Gemini.
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role";
process.env.SUPABASE_ANON_KEY ||= "test-anon";
process.env.GEMINI_API_KEY ||= "test-gemini-key";
process.env.APP_ORIGIN ||= "https://neyo.signaturesi.com";
process.env.NODE_ENV ||= "test";

export const ROOT = new URL("../../", import.meta.url);

// Minimal Vercel-style response object that records what a handler sent.
export function fakeRes() {
    const out = { statusCode: 200, headers: {}, body: undefined };
    const res = {
        status(code) { out.statusCode = code; return res; },
        setHeader(name, value) { out.headers[String(name).toLowerCase()] = value; return res; },
        getHeader(name) { return out.headers[String(name).toLowerCase()]; },
        json(body) { out.body = body; return res; },
        send(body) { out.body = body; return res; },
        end(body) { if (body !== undefined) out.body = body; return res; }
    };
    return { res, out };
}
