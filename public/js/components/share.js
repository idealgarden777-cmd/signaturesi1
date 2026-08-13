/*
=========================================================
NEYO — SHARE COMPONENT

Owns:
- Native Web Share API
- Clipboard fallback
- Share lifecycle events
- Share result state
- Public share API

Does NOT own:
- Message action buttons
- Share modal UI
- Chat API
- Message rendering
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       STATE
       ===================================================== */

    let sharing =
        false;


    /* =====================================================
       HELPERS
       ===================================================== */

    const emit = (
        name,
        detail = {}
    ) => {

        window.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail
                }
            )
        );

    };


    const cleanText =
        value => {

            return String(
                value || ""
            ).trim();

        };


    /* =====================================================
       COPY FALLBACK
       ===================================================== */

    const copyToClipboard =
        async text => {

            const value =
                cleanText(text);


            if (!value) {
                return false;
            }


            if (
                navigator.clipboard
                    ?.writeText
            ) {

                await navigator
                    .clipboard
                    .writeText(
                        value
                    );


                return true;

            }


            const textarea =
                document.createElement(
                    "textarea"
                );


            textarea.value =
                value;


            textarea.style.position =
                "fixed";


            textarea.style.opacity =
                "0";


            document.body.appendChild(
                textarea
            );


            textarea.focus();

            textarea.select();


            const copied =
                document.execCommand(
                    "copy"
                );


            textarea.remove();


            return copied;

        };


    /* =====================================================
       SHARE
       ===================================================== */

    const share = async ({
        text = "",
        title = "",
        url = ""
    } = {}) => {

        if (sharing) {
            return false;
        }


        const clean =
            cleanText(text);


        if (
            !clean &&
            !url
        ) {
            return false;
        }


        sharing =
            true;


        emit(
            "neyo:share-start",
            {
                text:
                    clean,

                title,

                url
            }
        );


        try {

            /* -----------------------------------------
               NATIVE SHARE
               ----------------------------------------- */

            if (
                typeof navigator.share ===
                "function"
            ) {

                const payload = {};


                if (title) {
                    payload.title =
                        title;
                }


                if (clean) {
                    payload.text =
                        clean;
                }


                if (url) {
                    payload.url =
                        url;
                }


                await navigator.share(
                    payload
                );


                emit(
                    "neyo:share-success",
                    {
                        method:
                            "native"
                    }
                );


                return true;

            }


            /* -----------------------------------------
               CLIPBOARD FALLBACK
               ----------------------------------------- */

            const fallbackText =
                [
                    clean,
                    url
                ]
                    .filter(Boolean)
                    .join("\n\n");


            const copied =
                await copyToClipboard(
                    fallbackText
                );


            if (!copied) {

                throw new Error(
                    "Could not copy share content."
                );

            }


            window.NeyoNotifications
                ?.success?.(
                    "Copied to clipboard"
                );


            emit(
                "neyo:share-success",
                {
                    method:
                        "clipboard"
                }
            );


            return true;

        }

        catch (error) {

            /*
            User cancelling native share
            is not a real failure.
            */

            if (
                error?.name ===
                "AbortError"
            ) {

                emit(
                    "neyo:share-cancelled"
                );


                return false;

            }


            emit(
                "neyo:share-error",
                {
                    error
                }
            );


            window.NeyoNotifications
                ?.error?.(
                    error?.message ||
                    "Could not share this message."
                );


            return false;

        }

        finally {

            sharing =
                false;


            emit(
                "neyo:share-end"
            );

        }

    };


    /* =====================================================
       MESSAGE ACTION CONNECTION
       ===================================================== */

    window.addEventListener(
        "neyo:message-share-request",
        event => {

            share({
                text:
                    event.detail?.text ||
                    "",

                title:
                    "NEYO",

                url:
                    event.detail?.url ||
                    ""
            });

        }
    );


    /* =====================================================
       GENERIC SHARE REQUEST
       ===================================================== */

    window.addEventListener(
        "neyo:share-request",
        event => {

            share({
                text:
                    event.detail?.text ||
                    "",

                title:
                    event.detail?.title ||
                    "",

                url:
                    event.detail?.url ||
                    ""
            });

        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoShare =
        Object.freeze({

            share,

            copy:
                copyToClipboard,

            isSharing:
                () =>
                    sharing,

            isNativeSupported:
                () =>
                    typeof navigator.share ===
                    "function"

        });

})();
