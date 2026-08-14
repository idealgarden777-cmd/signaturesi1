/*
=========================================================
NEYO — LEMON SQUEEZY WEBHOOK
Vercel Raw-Body Safe Version

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
   IMPORTANT — DISABLE BODY PARSING
   ===================================================== */

export const config = {
    api: {
        bodyParser: false
    }
};


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

    const key =
        clean(
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );


    if (!url || !key) {
        throw new Error(
            "Supabase configuration is missing."
        );
    }


    return createClient(
        url,
        key,
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

async function readRawBody(req) {

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
   SIGNATURE VERIFY
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


    const digest =
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
        digest.length !==
        received.length
    ) {
        return false;
    }


    return crypto.timingSafeEqual(
        digest,
        received
    );
}


/* =====================================================
   STATUS
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


    return Number.isNaN(
        date.getTime()
    )
        ? null
        : date.toISOString();
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
           WEBHOOK SECRET
           ============================================= */

        const secret =
            clean(
                process.env
                    .LEMON_SQUEEZY_WEBHOOK_SECRET
            );


        if (!secret) {

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
           RAW BODY + SIGNATURE
           ============================================= */

        const rawBody =
            await readRawBody(req);


        const signature =
            String(
                req.headers[
                    "x-signature"
                ] || ""
            );


        if (
            !verifySignature(
                rawBody,
                signature,
                secret
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
                        "Invalid webhook JSON."
                });
        }


        const eventName =
            String(
                payload?.meta
                    ?.event_name || ""
            );


        const customData =
            payload?.meta
                ?.custom_data || {};


        const userId =
            String(
                customData
                    ?.user_id || ""
            ).trim();


        /* =============================================
           IGNORE EVENTS WE DON'T NEED
           ============================================= */

        const supportedEvents =
            new Set([
                "subscription_created",
                "subscription_updated",
                "subscription_cancelled",
                "subscription_resumed",
                "subscription_expired",
                "subscription_paused",
                "subscription_unpaused"
            ]);


        /*
        Payment-success event is an invoice object,
        not the subscription object.

        The actual subscription state is handled
        by subscription_created / updated events.
        */

        if (
            eventName ===
            "subscription_payment_success"
        ) {

            return res
                .status(200)
                .json({
                    received: true,
                    ignored: true,
                    event:
                        eventName
                });
        }


        if (
            !supportedEvents.has(
                eventName
            )
        ) {

            return res
                .status(200)
                .json({
                    received: true,
                    ignored: true,
                    event:
                        eventName
                });
        }


        /* =============================================
           USER ID
           ============================================= */

        if (!userId) {

            console.error(
                "Webhook custom user_id missing.",
                {
                    eventName
                }
            );


            return res
                .status(400)
                .json({
                    error:
                        "Webhook user ID is missing."
                });
        }


        const data =
            payload?.data || {};


        const attributes =
            data?.attributes || {};


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


        if (
            !subscriptionId
        ) {

            return res
                .status(400)
                .json({
                    error:
                        "Subscription ID is missing."
                });
        }


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


        const now =
            new Date()
                .toISOString();


        const supabase =
            createSupabaseAdmin();


        /* =============================================
           VERIFY USER
           ============================================= */

        const {
            data: user,
            error: userError
        } =
            await supabase
                .from(
                    "bean_users"
                )
                .select(
                    "id"
                )
                .eq(
                    "id",
                    userId
                )
                .maybeSingle();


        if (
            userError ||
            !user
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
           UPSERT SUBSCRIPTION
           ============================================= */

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
                subscriptionId,

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
                "Plan update failed:",
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
            "Lemon subscription webhook processed.",
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
