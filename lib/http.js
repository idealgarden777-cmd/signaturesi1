/*
=========================================================
NEYO — HTTP SECURITY HELPERS

Owns:
- JSON response headers
- Origin validation
- Basic API security headers
=========================================================
*/

"use strict";


/* =====================================================
   JSON HEADERS
   ===================================================== */

export function setJsonHeaders(res) {

    res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8"
    );

    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
    );

    res.setHeader(
        "Pragma",
        "no-cache"
    );

    res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
    );

    res.setHeader(
        "X-Frame-Options",
        "DENY"
    );

    res.setHeader(
        "Referrer-Policy",
        "no-referrer"
    );

}


/* =====================================================
   ORIGIN VALIDATION
   ===================================================== */

export function isAllowedOrigin(req) {

    const allowedOrigin =
        process.env.APP_ORIGIN;


    /*
    Production must have APP_ORIGIN.
    */

    if (!allowedOrigin) {

        if (
            process.env.NODE_ENV ===
            "production"
        ) {

            throw new Error(
                "APP_ORIGIN is required in production."
            );

        }


        return true;

    }


    const requestOrigin =
        req.headers?.origin;


    /*
    Server-to-server requests may not
    include the Origin header.
    */

    if (!requestOrigin) {

        return true;

    }


    try {

        const requestUrl =
            new URL(
                requestOrigin
            );


        const allowedUrl =
            new URL(
                allowedOrigin
            );


        return (
            requestUrl.origin ===
            allowedUrl.origin
        );

    } catch {

        return false;

    }

}
