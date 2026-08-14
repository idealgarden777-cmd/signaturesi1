/*
=========================================================
NEYO — LEMON SQUEEZY WEBHOOK

Route:
POST /api/webhooks/lemon

Database:
- public.user_subscriptions
- public.bean_users.plan_type

Required env:
- LEMON_SQUEEZY_WEBHOOK_SECRET
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
=========================================================
*/

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";


/* =====================================================
   HELPERS
   ===================================================== */

function clean(value) {
    return typeof value === "string"
        ? value.trim().replace(/^['"]|['"]$/g, "")
        : "";
}


function createSupabaseAdmin() {

    const url =
        clean(process.env.SUPABASE_URL);

    const serviceRoleKey =
        clean(
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );


    if (!url || !serviceRoleKey) {
        throw new Error(
            "Supabase configuration is missing."
        );
    }


    return createClient(
        url,
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
   RAW BODY
   ===================================================== */

async function getRawBody(req) {

    if (req.rawBody) {

        return Buffer.isBuffer(req.rawBody)
            ? req.rawBody
            : Buffer.from(req.rawBody);
    }


    /*
    Some Vercel runtimes may already parse req.body.
    Preserve the body as consistently as possible.
    */

    if (req.body) {

        if (Buffer.isBuffer(req.body)) {
            return req.body;
        }

        if (typeof req.body === "string") {
            return Buffer.from(
                req.body,
                "utf8"
            );
        }

        return Buffer.from(
            JSON.stringify(req.body),
            "utf8"
        );
    }


    const chunks = [];

    for await (const chunk of req) {

        chunks.push(
            Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk)
        );
    }


    return Buffer.concat(chunks);
}


/* =====================================================
   SIGNATURE
   ===================================================== */

function verifySignature(
    rawBody,
    signature,
    secret
) {

    if (
        !rawBody?.length ||
        !signature ||
        !secret
    ) {
        return false;
    }


    const expected =
        Buffer.from(
            crypto
                .createHmac(
                    "sha256",
                    secret
                )
                .update(rawBody)
                .digest("hex"),
            "utf8"
        );


    const received =
        Buffer.from(
            String(signature),
            "utf8"
        );


    if (
        expected.length !==
        received.length
    ) {
        return false;
    }


    return crypto.timingSafeEqual(
        expected,
        received
    );
}


/* =====================================================
   SUBSCRIPTION STATUS
   ===================================================== */

function hasProAccess(status) {

    return [
        "active",
        "on_trial",
        "past_due",
        "paused",
        "cancelled"
    ].includes(
        String(status || "")
            .toLowerCase()
    );
}


function normalizeDate(value) {

    if (!value) {
        return null;
    }


    const date =
        new Date(value);


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return null;
    }


    return date.toISOString();
}


/* =====================================================
   HANDLER
   ===================================================== */

export default async function handler(
    req,
    res
) {

    if (req.method !== "POST") {

        res.setHeader(
            "Allow",
            "POST"
        );

        return res
            .status(405)
            .json({
                error:
                    "Method Not Allowed"
            });
    }


    try {

        /* =============================================
           SECRET
           ============================================= */

        const webhookSecret =
            clean(
                process.env
                    .LEMON_SQUEEZY_WEBHOOK_SECRET
            );


        if (!webhookSecret) {

            console.error(
                "LEMON_SQUEEZY_WEBHOOK_SECRET missing."
            );

            return res
                .status(500)
                .json({
                    error:
                        "Webhook is not configured."
                });
        }


        /* =============================================
           VERIFY SIGNATURE
           ============================================= */

        const rawBody =
            await getRawBody(req);


        const signature =
            req.headers[
                "x-signature"
            ];


        if (
            !verifySignature(
                rawBody,
                signature,
                webhookSecret
            )
        ) {

            console.warn(
                "Invalid Lemon Squeezy webhook signature."
            );

            return res
                .status(401)
                .json({
                    error:
                        "Invalid webhook signature."
                });
        }


        /* =============================================
           PARSE PAYLOAD
           ============================================= */

        let payload;

        try {

            payload =
                JSON.parse(
                    rawBody.toString(
                        "utf8"
                    )
                );

        } catch {

            return res
                .status(400)
                .json({
                    error:
                        "Invalid JSON payload."
                });
        }


        const eventName =
            String(
                payload?.meta
                    ?.event_name || ""
            );


        /*
        Checkout custom data:
        checkout_data.custom.user_id
        becomes:
        meta.custom_data.user_id
        */

        const userId =
            String(
                payload
                    ?.meta
                    ?.custom_data
                    ?.user_id || ""
            ).trim();


        const data =
            payload?.data || {};


        const attributes =
            data?.attributes || {};


        /* =============================================
           IGNORE NON-SUBSCRIPTION EVENTS
           ============================================= */

        if (
            !eventName.startsWith(
                "subscription_"
            )
        ) {

            return res
                .status(200)
                .json({
                    received: true,
                    ignored: true
                });
        }


        if (!userId) {

            console.error(
                "Lemon webhook missing user_id.",
                {
                    eventName,
                    subscriptionId:
                        data?.id
                }
            );

            return res
                .status(400)
                .json({
                    error:
                        "Webhook user ID is missing."
                });
        }


        const subscriptionId =
            String(
                data?.id || ""
            ).trim();


        const status =
            String(
                attributes
                    ?.status || ""
            )
                .trim()
                .toLowerCase();


        const customerId =
            attributes
                ?.customer_id != null
                ? String(
                    attributes.customer_id
                )
                : null;


        const orderId =
            attributes
                ?.order_id != null
                ? String(
                    attributes.order_id
                )
                : null;


        const variantId =
            attributes
                ?.variant_id != null
                ? String(
                    attributes.variant_id
                )
                : null;


        const renewsAt =
            normalizeDate(
                attributes
                    ?.renews_at
            );


        const endsAt =
            normalizeDate(
                attributes
                    ?.ends_at
            );


        const planType =
            hasProAccess(status)
                ? "pro"
                : "free";


        const supabase =
            createSupabaseAdmin();


        /* =============================================
           VERIFY USER
           ============================================= */

        const {
            data: existingUser,
            error: userError
        } =
            await supabase
                .from(
                    "bean_users"
                )
                .select(
                    "id, plan_type, status"
                )
                .eq(
                    "id",
                    userId
                )
                .maybeSingle();


        if (
            userError ||
            !existingUser
        ) {

            console.error(
                "Webhook user not found:",
                userError
            );

            return res
                .status(404)
                .json({
                    error:
                        "User not found."
                });
        }


        /* =============================================
           UPSERT USER SUBSCRIPTION
           ============================================= */

        const now =
            new Date()
                .toISOString();


        const subscriptionRow = {

            user_id:
                userId,

            plan_tier:
                "pro",

            status:
                status || "unknown",

            provider:
                "lemon_squeezy",

            provider_subscription_id:
                subscriptionId || null,

            provider_customer_id:
                customerId,

            provider_order_id:
                orderId,

            variant_id:
                variantId,

            renews_at:
                renewsAt,

            ends_at:
                endsAt,

            updated_at:
                now

        };


        const {
            error:
                subscriptionError
        } =
            await supabase
                .from(
                    "user_subscriptions"
                )
                .upsert(
                    subscriptionRow,
                    {
                        onConflict:
                            "provider_subscription_id"
                    }
                );


        if (subscriptionError) {

            console.error(
                "Subscription sync failed:",
                subscriptionError
            );

            return res
                .status(500)
                .json({
                    error:
                        "Unable to sync subscription."
                });
        }


        /* =============================================
           UPDATE USER PLAN
           ============================================= */

        const {
            error:
                planError
        } =
            await supabase
                .from(
                    "bean_users"
                )
                .update({
                    plan_type:
                        planType,

                    updated_at:
                        now
                })
                .eq(
                    "id",
                    userId
                );


        if (planError) {

            console.error(
                "User plan update failed:",
                planError
            );

            return res
                .status(500)
                .json({
                    error:
                        "Unable to update user plan."
                });
        }


        console.log(
            "Lemon subscription synced.",
            {
                eventName,
                userId,
                subscriptionId,
                status,
                planType
            }
        );


        return res
            .status(200)
            .json({
                received: true,
                event:
                    eventName
            });

    } catch (error) {

        console.error(
            "Lemon webhook failed:",
            error
        );


        return res
            .status(500)
            .json({
                error:
                    "Webhook processing failed."
            });
    }
}
