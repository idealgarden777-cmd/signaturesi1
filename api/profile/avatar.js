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

const BUCKET = "avatars";
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split("=");

    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
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

function getExtension(mimeType) {
  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };

  return extensions[mimeType] || null;
}

async function getAuthenticatedUser(req) {
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
    .select("id, username, status")
    .eq("id", session.user_id)
    .maybeSingle();

  if (userError || !user || user.status !== "active") {
    return null;
  }

  return user;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "POST, DELETE");

    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    /*
      POST action: "prepare"

      Creates a secure signed upload URL.
    */
    if (req.method === "POST" && req.body?.action === "prepare") {
      const filename = String(req.body?.filename || "").trim();
      const mimeType = String(req.body?.mimeType || "").trim();
      const size = Number(req.body?.size || 0);

      const extension = getExtension(mimeType);

      if (!filename || !extension) {
        return res.status(400).json({
          error: "Only JPG, PNG or WebP images are allowed"
        });
      }

      if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
        return res.status(400).json({
          error: "Profile photo must be under 5 MB"
        });
      }

      const path =
        `${user.id}/avatar-${Date.now()}-${crypto.randomUUID()}.${extension}`;

      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(path);

      if (error || !data?.token) {
        console.error("Avatar upload URL failed:", error);

        return res.status(500).json({
          error: "Unable to prepare avatar upload"
        });
      }

      // ✅ Reverted to local `path` to ensure exact match with token
      return res.status(200).json({
        success: true,
        upload: {
          bucket: BUCKET,
          path: path, // Local path, exactly as sent to createSignedUploadUrl
          token: data.token
        }
      });
    }

    /*
      POST action: "save"

      Saves uploaded avatar path in bean_profiles.
    */
    if (req.method === "POST" && req.body?.action === "save") {
      const path = String(req.body?.path || "").trim();

      if (!path || !path.startsWith(`${user.id}/`)) {
        return res.status(400).json({
          error: "Invalid avatar path"
        });
      }

      const { data: publicData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(path);

      const avatarUrl = publicData?.publicUrl;

      if (!avatarUrl) {
        return res.status(500).json({
          error: "Unable to create avatar URL"
        });
      }

      const { error: profileError } = await supabase
        .from("bean_profiles")
        .upsert(
          {
            user_id: user.id,
            display_name: user.username,
            avatar_url: avatarUrl,
            updated_at: new Date().toISOString()
          },
          {
            onConflict: "user_id"
          }
        );

      if (profileError) {
        console.error("Avatar profile update failed:", profileError);

        return res.status(500).json({
          error: "Unable to save profile photo"
        });
      }

      return res.status(200).json({
        success: true,
        avatarUrl
      });
    }

    /*
      DELETE

      Removes avatar URL from profile.
    */
    if (req.method === "DELETE") {
      const { error } = await supabase
        .from("bean_profiles")
        .update({
          avatar_url: null,
          updated_at: new Date().toISOString()
        })
        .eq("user_id", user.id);

      if (error) {
        console.error("Avatar removal failed:", error);

        return res.status(500).json({
          error: "Unable to remove profile photo"
        });
      }

      return res.status(200).json({
        success: true,
        avatarUrl: null
      });
    }

    return res.status(400).json({
      error: "Invalid avatar action"
    });
  } catch (error) {
    console.error("Avatar API exception:", error);

    return res.status(500).json({
      error: "Unable to process profile photo"
    });
  }
}
