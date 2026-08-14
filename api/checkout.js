/*
=========================================================
NEYO — LEMON SQUEEZY CHECKOUT API

Route:
POST /api/checkout

Owns:
- Authentication check
- Origin protection
- Lemon Squeezy checkout creation
- User ID → checkout custom data
- Hosted checkout fallback
- Safe checkout URL validation

Server-only:
- API keys
- Store ID
- Variant ID
=========================================================
*/

import {
    getAuthenticatedUser
} from "../lib/auth.js";

import {
    setJsonHeaders,
    isAllowedOrigin
} from "../lib/http.js";


/* =====================================================
   HELPERS
   ===================================================== */

function clean(value) {

    return typeof value === "string"
        ? value
            .trim()
            .replace(
                /^['"]|['"]$/g,
                ""
            )
        : "";

}


function safeLemonCheckoutUrl(
    value
) {

    const raw =
        clean(value);


    if (!raw) {

        return "";

    }


    try {

        const url =
            new URL(raw);


        const hostname =
            url.hostname
                .toLowerCase();


        const trustedHost =
            hostname ===
                "lemonsqueezy.com" ||
            hostname.endsWith(
                ".lemonsqueezy.com"
            );


        if (
            url.protocol !==
                "https:" ||
            !trustedHost
        ) {

            return "";

        }


        return url.toString();

    } catch {

        return "";

    }

}


/* =====================================================
   HANDLER
   ===================================================== */

export default async function handler(
    req,
    res
) {

    /* =================================================
       RESPONSE HEADERS
       ================================================= */

    setJsonHeaders(res);


    /* =================================================
       METHOD
       ================================================= */

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


    /* =================================================
       ORIGIN SECURITY
       ================================================= */

    try {

        if (
            !isAllowedOrigin(req)
        ) {

            return res
                .status(403)
                .json({
                    error:
                        "Request origin is not allowed."
                });

        }

    } catch (error) {

        console.error(
            "Checkout origin validation failed:",
            error?.message
        );


        return res
            .status(500)
            .json({
                error:
                    "Checkout is not configured safely."
            });

    }


    /* =================================================
       AUTHENTICATION
       ================================================= */

    const user =
        getAuthenticatedUser(req);


    if (
        !user?.userId
    ) {

        return res
            .status(401)
            .json({
                error:
                    "Authentication required."
            });

    }


    /* =================================================
       ENVIRONMENT VARIABLES
       ================================================= */

    const apiKey =
        clean(
            process.env
                .LEMON_SQUEEZY_API_KEY
        );


    const storeId =
        clean(
            process.env
                .LEMON_SQUEEZY_STORE_ID
        );


    const variantId =
        clean(
            process.env
                .LEMON_SQUEEZY_VARIANT_ID
        );


    const successUrl =
        clean(
            process.env
                .LEMON_SQUEEZY_SUCCESS_URL ||
            process.env
                .APP_ORIGIN
        );


    const hostedCheckoutUrl =
        safeLemonCheckoutUrl(
            process.env
                .LEMON_SQUEEZY_CHECKOUT_URL
        );


    /* =================================================
       CONFIG CHECK
       ================================================= */

    if (
        !apiKey ||
        !storeId ||
        !variantId
    ) {

        /*
        Optional fallback.

        If hosted checkout URL exists,
        checkout can still open.
        */

        if (
            hostedCheckoutUrl
        ) {

            return res
                .status(200)
                .json({
                    success:
                        true,

                    url:
                        hostedCheckoutUrl,

                    mode:
                        "hosted"
                });

        }


        console.error(
            "Lemon Squeezy checkout configuration missing.",
            {
                apiKey:
                    Boolean(apiKey),

                storeId:
                    Boolean(storeId),

                variantId:
                    Boolean(
                        variantId
                    )
            }
        );


        return res
            .status(503)
            .json({
                error:
                    "Checkout is not configured."
            });

    }


    /* =================================================
       CHECKOUT ATTRIBUTES
       ================================================= */

    const attributes = {

        checkout_data: {

            custom: {

                user_id:
                    String(
                        user.userId
                    ),

                username:
                    String(
                        user.username ||
                        ""
                    )

            }

        }

    };


    /*
    After successful payment,
    Lemon redirects user back to NEYO.
    */

    if (
        successUrl
    ) {

        attributes
            .product_options = {

            redirect_url:
                successUrl

        };

    }


    /* =================================================
       CREATE LEMON CHECKOUT
       ================================================= */

    try {

        const response =
            await fetch(
                "https://api.lemonsqueezy.com/v1/checkouts",
                {

                    method:
                        "POST",

                    headers: {

                        Accept:
                            "application/vnd.api+json",

                        "Content-Type":
                            "application/vnd.api+json",

                        Authorization:
                            `Bearer ${apiKey}`

                    },

                    body:
                        JSON.stringify({

                            data: {

                                type:
                                    "checkouts",

                                attributes,

                                relationships: {

                                    store: {

                                        data: {

                                            type:
                                                "stores",

                                            id:
                                                storeId

                                        }

                                    },

                                    variant: {

                                        data: {

                                            type:
                                                "variants",

                                            id:
                                                variantId

                                        }

                                    }

                                }

                            }

                        })

                }
            );


        const data =
            await response
                .json()
                .catch(
                    () => ({})
                );


        /* =============================================
           PROVIDER ERROR
           ============================================= */

        if (
            !response.ok
        ) {

            const providerMessage =
                data
                    ?.errors?.[0]
                    ?.detail ||
                "Checkout provider request failed.";


            console.error(
                "Lemon Squeezy API error:",
                {
                    status:
                        response.status,

                    message:
                        providerMessage
                }
            );


            return res
                .status(502)
                .json({
                    error:
                        "Unable to start checkout."
                });

        }


        /* =============================================
           GET CHECKOUT URL
           ============================================= */

        const checkoutUrl =
            safeLemonCheckoutUrl(
                data
                    ?.data
                    ?.attributes
                    ?.url
            );


        if (
            !checkoutUrl
        ) {

            console.error(
                "Lemon Squeezy checkout URL missing."
            );


            return res
                .status(502)
                .json({
                    error:
                        "Checkout URL was not returned."
                });

        }


        /* =============================================
           SUCCESS
           ============================================= */

        return res
            .status(200)
            .json({

                success:
                    true,

                url:
                    checkoutUrl,

                mode:
                    "dynamic"

            });

    } catch (error) {

        console.error(
            "Lemon Squeezy checkout failed:",
            error?.message
        );


        return res
            .status(502)
            .json({
                error:
                    "Unable to start checkout. Please try again."
            });

    }

}
