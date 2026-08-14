/*
=========================================================
NEYO — LEMON SQUEEZY WEBHOOK

Route:
POST /api/webhooks/lemon

Owns:
- Lemon webhook signature verification
- Subscription event processing
- User ID resolution from meta.custom_data
- Subscription sync to Supabase
- User plan activation/deactivation

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

async function getRawBody(req) {

    if (req.rawBody) {
        return Buffer.isBuffer(req.rawBody)
            ? req.rawBody
            : Buffer.from(req.rawBody);
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
   SIGNATURE VERIFY
   ===================================================== */

function verifySignature(
    rawBody,
    signature,
    secret
) {

    if (
        !rawBody ||
        !signature ||
        !secret
    ) {
        return false;
    }


    const digest =
        crypto
            .createHmac(
                "sha256",
                secret
            )
            .update(rawBody)
            .digest("hex");


    const digestBuffer =
        Buffer.from(
            digest,
            "utf8"
        );


    const signatureBuffer =
        Buffer.from(
            signature,
            "utf8"
        );


    if (
        digestBuffer.length !==
        signatureBuffer.length
    ) {
        return false;
    }


    return crypto.timingSafeEqual(
        digestBuffer,
        signatureBuffer
    );
}


/* =====================================================
   STATUS HELPERS
   ===================================================== */

function isProStatus(status) {

    return [
        "active",
        "on_trial",
        "past_due",
        "paused"
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


        const rawBody =
            await getRawBody(req);


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

            return res
                .status(401)
                .json({
                    error:
                        "Invalid webhook signature."
                });
        }


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


        const customData =
            payload?.meta
                ?.custom_data || {};


        const userId =
            String(
                customData
                    ?.user_id || ""
            ).trim();


        const data =
            payload?.data || {};


        const attributes =
            data?.attributes || {};


        const lemonSubscriptionId =
            String(
                data?.id || ""
            ).trim();


        const status =
            String(
                attributes
                    ?.status || ""
            ).toLowerCase();


        const variantId =
            attributes
                ?.variant_id != null
                ? String(
                    attributes.variant_id
                )
                : null;


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


        /*
        We only process subscription events.
        Other events still receive 200
        so Lemon does not keep retrying.
        */

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
                "Webhook missing custom user_id.",
                {
                    eventName,
                    subscriptionId:
                        lemonSubscriptionId
                }
            );


            return res
                .status(400)
                .json({
                    error:
                        "Webhook user ID is missing."
                });
        }


        const supabase =
            createSupabaseAdmin();


        /* =================================================
           VERIFY LOCAL USER
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
                    "id, status"
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
                "Webhook user not found.",
                userError
            );


            return res
                .status(404)
                .json({
                    error:
                        "User not found."
                });
        }


        /* =================================================
           UPSERT SUBSCRIPTION
           ================================================= */

        const subscriptionRow = {

            user_id:
                userId,

            provider:
                "lemon_squeezy",

            provider_subscription_id:
                lemonSubscriptionId,

            provider_customer_id:
                customerId,

            provider_order_id:
                orderId,

            variant_id:
                variantId,

            status:
                status || "unknown",

            renews_at:
                renewsAt,

            ends_at:
                endsAt,

            updated_at:
                new Date()
                    .toISOString()

        };


        const {
            error:
                subscriptionError
        } =
            await supabase
                .from(
                    "subscriptions"
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


        /* =================================================
           UPDATE USER PLAN
           ================================================= */

        const nextPlan =
            isProStatus(status)
                ? "pro"
                : "free";


        const {
            error:
                planError
        } =
            await supabase
                .from(
                    "bean_users"
                )
                .update({
                    plan:
                        nextPlan,
                    updated_at:
                        new Date()
                            .toISOString()
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
            "Lemon webhook processed.",
            {
                eventName,
                userId,
                subscriptionId:
                    lemonSubscriptionId,
                status,
                plan:
                    nextPlan
            }
        );


        return res
            .status(200)
            .json({
                received: true
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


/*
=========================================================
IMPORTANT — VERCEL RAW BODY

Lemon signature verification requires the exact raw body.

If your Vercel setup automatically parses request bodies
before this function runs, add the appropriate Vercel
configuration so this route receives raw request bytes.
=========================================================
*/
