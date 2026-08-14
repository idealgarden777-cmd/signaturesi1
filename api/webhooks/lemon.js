/*
=========================================================
NEYO — LEMON SQUEEZY WEBHOOK
FINAL SUBSCRIPTION SYNC

Route:
POST /api/webhooks/lemon

Handles:
- subscription_created
- subscription_updated
- subscription_payment_success
- subscription_cancelled
- subscription_resumed
- subscription_expired
- subscription_paused
- subscription_unpaused

Database:
- public.user_subscriptions
- public.bean_users.plan_type

Required env:
- LEMON_SQUEEZY_WEBHOOK_SECRET
- LEMON_SQUEEZY_API_KEY
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
=========================================================
*/

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";


/* =====================================================
   VERCEL RAW BODY
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


    const expectedHex =
        crypto
            .createHmac(
                "sha256",
                secret
            )
            .update(rawBody)
            .digest("hex");


    const expected =
        Buffer.from(
            expectedHex,
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
   DATE
   ===================================================== */

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
   ACCESS STATUS
   ===================================================== */

function hasProAccess(status) {

    const value =
        String(status || "")
            .trim()
            .toLowerCase();


    return [
        "active",
        "on_trial",
        "past_due",
        "paused",
        "cancelled"
    ].includes(value);

}


/* =====================================================
   FETCH SUBSCRIPTION FROM LEMON
   ===================================================== */

async function fetchSubscription(
    subscriptionId
) {

    const apiKey =
        clean(
            process.env.LEMON_SQUEEZY_API_KEY
        );


    if (!apiKey) {

        throw new Error(
            "LEMON_SQUEEZY_API_KEY is missing."
        );

    }


    const response =
        await fetch(
            `https://api.lemonsqueezy.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
            {
                method: "GET",

                headers: {
                    Accept:
                        "application/vnd.api+json",

                    "Content-Type":
                        "application/vnd.api+json",

                    Authorization:
                        `Bearer ${apiKey}`
                }
            }
        );


    const json =
        await response
            .json()
            .catch(
                () => ({})
            );


    if (!response.ok) {

        const detail =
            json
                ?.errors?.[0]
                ?.detail ||
            "Unable to retrieve Lemon subscription.";


        throw new Error(detail);

    }


    if (
        json?.data?.type !==
        "subscriptions"
    ) {

        throw new Error(
            "Invalid subscription response from Lemon Squeezy."
        );

    }


    return json.data;

}


/* =====================================================
   NORMALIZE SUBSCRIPTION
   ===================================================== */

function normalizeSubscription(data) {

    const attributes =
        data?.attributes || {};


    return {

        subscriptionId:
            String(
                data?.id || ""
            ).trim(),

        status:
            String(
                attributes?.status || ""
            )
                .trim()
                .toLowerCase(),

        customerId:
            attributes?.customer_id != null
                ? String(
                    attributes.customer_id
                )
                : null,

        orderId:
            attributes?.order_id != null
                ? String(
                    attributes.order_id
                )
                : null,

        variantId:
            attributes?.variant_id != null
                ? String(
                    attributes.variant_id
                )
                : null,

        renewsAt:
            normalizeDate(
                attributes?.renews_at
            ),

        endsAt:
            normalizeDate(
                attributes?.ends_at
            )

    };

}


/* =====================================================
   SYNC TO SUPABASE
   ===================================================== */

async function syncSubscription({
    userId,
    subscriptionData
}) {

    const supabase =
        createSupabaseAdmin();


    const subscription =
        normalizeSubscription(
            subscriptionData
        );


    if (
        !subscription.subscriptionId
    ) {

        throw new Error(
            "Subscription ID is missing."
        );

    }


    const now =
        new Date()
            .toISOString();


    /* -------------------------------------------------
       VERIFY USER
       ------------------------------------------------- */

    const {
        data: user,
        error: userError
    } =
        await supabase
            .from("bean_users")
            .select(
                "id, plan_type"
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

        throw new Error(
            "Webhook user was not found."
        );

    }


    /* -------------------------------------------------
       SUBSCRIPTION UPSERT
       ------------------------------------------------- */

    const row = {

        user_id:
            userId,

        plan_tier:
            "pro",

        status:
            subscription.status ||
            "unknown",

        provider:
            "lemon_squeezy",

        provider_subscription_id:
            subscription.subscriptionId,

        provider_customer_id:
            subscription.customerId,

        provider_order_id:
            subscription.orderId,

        variant_id:
            subscription.variantId,

        renews_at:
            subscription.renewsAt,

        ends_at:
            subscription.endsAt,

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
                row,
                {
                    onConflict:
                        "provider_subscription_id"
                }
            );


    if (
        subscriptionError
    ) {

        console.error(
            "Subscription upsert error:",
            subscriptionError
        );


        throw new Error(
            "Unable to sync subscription."
        );

    }


    /* -------------------------------------------------
       USER PLAN
       ------------------------------------------------- */

    const nextPlan =
        hasProAccess(
            subscription.status
        )
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
                plan_type:
                    nextPlan,

                updated_at:
                    now
            })
            .eq(
                "id",
                userId
            );


    if (
        planError
    ) {

        console.error(
            "Plan update error:",
            planError
        );


        throw new Error(
            "Unable to update user plan."
        );

    }


    return {
        subscriptionId:
            subscription.subscriptionId,

        status:
            subscription.status,

        plan:
            nextPlan
    };

}


/* =====================================================
   MAIN HANDLER
   ===================================================== */

export default async function handler(
    req,
    res
) {

    if (
        req.method !==
        "POST"
    ) {

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

        const secret =
            clean(
                process.env
                    .LEMON_SQUEEZY_WEBHOOK_SECRET
            );


        if (!secret) {

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

            return res
                .status(401)
                .json({
                    error:
                        "Invalid webhook signature."
                });

        }


        /* =============================================
           PARSE JSON
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
                payload
                    ?.meta
                    ?.event_name || ""
            ).trim();


        const userId =
            String(
                payload
                    ?.meta
                    ?.custom_data
                    ?.user_id || ""
            ).trim();


        if (!userId) {

            return res
                .status(400)
                .json({
                    error:
                        "Webhook user ID is missing."
                });

        }


        let subscriptionData =
            null;


        /* =============================================
           PAYMENT SUCCESS
           ============================================= */

        if (
            eventName ===
            "subscription_payment_success"
        ) {

            /*
            Payment-success payload is a
            subscription-invoice object.

            We use its subscription_id to fetch
            the actual subscription.
            */

            const subscriptionId =
                payload
                    ?.data
                    ?.attributes
                    ?.subscription_id;


            if (
                !subscriptionId
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Payment event subscription ID is missing."
                    });

            }


            subscriptionData =
                await fetchSubscription(
                    String(
                        subscriptionId
                    )
                );

        }


        /* =============================================
           DIRECT SUBSCRIPTION EVENTS
           ============================================= */

        else if (
            payload?.data?.type ===
            "subscriptions"
        ) {

            subscriptionData =
                payload.data;

        }


        /* =============================================
           IGNORE OTHER EVENTS
           ============================================= */

        else {

            return res
                .status(200)
                .json({
                    received:
                        true,

                    ignored:
                        true,

                    event:
                        eventName
                });

        }


        /* =============================================
           SYNC
           ============================================= */

        const result =
            await syncSubscription({
                userId,
                subscriptionData
            });


        console.log(
            "Lemon subscription synced.",
            {
                event:
                    eventName,

                userId,

                subscriptionId:
                    result.subscriptionId,

                status:
                    result.status,

                plan:
                    result.plan
            }
        );


        return res
            .status(200)
            .json({
                received:
                    true,

                synced:
                    true,

                event:
                    eventName,

                plan:
                    result.plan
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
                    error?.message ||
                    "Webhook processing failed."
            });

    }

}
