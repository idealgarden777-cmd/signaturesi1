import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

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

function getCookie(req, name) {
  const cookies = String(req?.headers?.cookie || "").split(";");

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split("=");

    if (key === name) {
      try {
        return decodeURIComponent(valueParts.join("="));
      } catch {
        return valueParts.join("=");
      }
    }
  }

  return null;
}

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

export async function getAuthenticatedUser(req) {
  const cookieName =
    process.env.SESSION_COOKIE_NAME || "bean_session";

  const rawToken = getCookie(req, cookieName);

  if (!rawToken) {
    return null;
  }

  const tokenHash = hashToken(rawToken);

  const { data: session, error: sessionError } = await supabase
    .from("bean_sessions")
    .select("user_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (
    sessionError ||
    !session ||
    session.revoked_at ||
    new Date(session.expires_at).getTime() <= Date.now()
  ) {
    return null;
  }

  const { data: user, error: userError } = await supabase
    .from("bean_users")
    .select("id, username, display_name, status")
    .eq("id", session.user_id)
    .maybeSingle();

  if (
    userError ||
    !user ||
    user.status !== "active"
  ) {
    return null;
  }

  return {
    userId: user.id,
    username: user.username,
    displayName: user.display_name
  };
}
