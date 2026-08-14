import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";


/* =====================================================
   SUPABASE ADMIN
   ===================================================== */

function cleanEnv(value) {
    return typeof value === "string"
        ? value.trim().replace(/^["']|["']$/g, "")
        : "";
}


function createSupabaseAdmin() {

    const supabaseUrl =
        cleanEnv(
            process.env.SUPABASE_URL
        );

    const serviceRoleKey =
        cleanEnv(
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );


    if (
        !supabaseUrl ||
        !serviceRoleKey
    ) {

        throw new Error(
            "Supabase configuration is missing."
        );

    }


    return createClient(
        supabaseUrl,
        serviceRoleKey,
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        }
    );
}


/* =====================================================
   COOKIE
   ===================================================== */

function getCookie(
    req,
    name
) {

    const cookies =
        String(
            req?.headers?.cookie || ""
        ).split(";");


    for (
        const cookie of cookies
    ) {

        const [
            key,
            ...valueParts
        ] =
            cookie
                .trim()
                .split("=");


        if (
            key === name
        ) {

            const value =
                valueParts.join("=");


            try {

                return decodeURIComponent(
                    value
                );

            } catch {

                return value;

            }

        }

    }


    return null;
}


/* =====================================================
   TOKEN HASH
   ===================================================== */

function hashToken(token) {

    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

}


/* =====================================================
   HANDLER
   ===================================================== */

export default async function handler(
    req,
    res
) {

    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
    );


    if (
        req.method !== "GET"
    ) {

        res.setHeader(
            "Allow",
            "GET"
        );


        return res
            .status(405)
            .json({
                error:
                    "Method not allowed"
            });

    }


    try {

        const supabase =
            createSupabaseAdmin();


        /* =================================================
           SESSION COOKIE
           ================================================= */

        const cookieName =
            cleanEnv(
                process.env
                    .SESSION_COOKIE_NAME
            ) ||
            "bean_session";


        const rawToken =
            getCookie(
                req,
                cookieName
            );


        if (!rawToken) {

            return res
                .status(401)
                .json({
                    error:
                        "Unauthorized"
                });

        }


        /* =================================================
           SESSION LOOKUP
           ================================================= */

        const tokenHash =
            hashToken(
                rawToken
            );


        const {
            data: session,
            error: sessionError
        } =
            await supabase
                .from(
                    "bean_sessions"
                )
                .select(
                    "user_id, expires_at, revoked_at"
                )
                .eq(
                    "token_hash",
                    tokenHash
                )
                .maybeSingle();


        if (
            sessionError ||
            !session ||
            session.revoked_at ||
            new Date(
                session.expires_at
            ).getTime() <= Date.now()
        ) {

            return res
                .status(401)
                .json({
                    error:
                        "Unauthorized"
                });

        }


        /* =================================================
           USER
           ================================================= */

        const {
            data: user,
            error: userError
        } =
            await supabase
                .from(
                    "bean_users"
                )
                .select(
                    "id, username, display_name, status, plan_type"
                )
                .eq(
                    "id",
                    session.user_id
                )
                .maybeSingle();


        if (
            userError ||
            !user ||
            user.status !== "active"
        ) {

            return res
                .status(401)
                .json({
                    error:
                        "Unauthorized"
                });

        }


        /* =================================================
           PROFILE
           ================================================= */

        const {
            data: profile,
            error: profileError
        } =
            await supabase
                .from(
                    "bean_profiles"
                )
                .select(
                    "display_name, avatar_url"
                )
                .eq(
                    "user_id",
                    user.id
                )
                .maybeSingle();


        if (
            profileError
        ) {

            console.error(
                "Profile lookup failed:",
                profileError
            );


            return res
                .status(500)
                .json({
                    error:
                        "Unable to load profile"
                });

        }


        /* =================================================
           RESPONSE
           ================================================= */

        const planType =
            String(
                user.plan_type ||
                "free"
            )
                .trim()
                .toLowerCase();


        return res
            .status(200)
            .json({

                user: {

                    id:
                        user.id,

                    username:
                        user.username,

                    displayName:
                        user.display_name,

                    planType:
                        planType === "pro"
                            ? "pro"
                            : "free"

                },


                profile: {

                    displayName:
                        profile?.display_name ||
                        user.display_name ||
                        user.username ||
                        "User",

                    avatarUrl:
                        profile?.avatar_url ||
                        null

                }

            });

    } catch (error) {

        console.error(
            "Profile API exception:",
            error
        );


        return res
            .status(500)
            .json({
                error:
                    "Unable to load profile"
            });

    }

}
