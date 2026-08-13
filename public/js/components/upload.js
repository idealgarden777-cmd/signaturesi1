/*
=========================================================
NEYO — UPLOAD COMPONENT

Owns:
- /api/upload signed URL request
- Supabase signed file upload
- Upload progress state
- File metadata normalization
- Multiple file upload
- Public upload API

Does NOT own:
- Attachment picker UI
- Message sending
- Chat rendering
- File preview UI
- Image compression
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const UPLOAD_ENDPOINT =
        "/api/upload";

    const DEFAULT_BUCKET =
        "neo-uploads";

    const MAX_FILES =
        5;


    /* =====================================================
       STATE
       ===================================================== */

    let supabaseClient =
        null;

    let activeUploads =
        0;


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


    const readJsonResponse =
        async response => {

            const data =
                await response
                    .json()
                    .catch(
                        () => ({})
                    );


            if (!response.ok) {

                const error =
                    new Error(
                        data?.error ||
                        `Upload request failed (${response.status})`
                    );


                error.status =
                    response.status;


                error.data =
                    data;


                throw error;

            }


            return data;

        };


    /* =====================================================
       FILE CATEGORY
       ===================================================== */

    const getFileCategory =
        file => {

            const type =
                String(
                    file?.type ||
                    file?.mimeType ||
                    ""
                ).toLowerCase();


            if (
                type.startsWith(
                    "image/"
                )
            ) {
                return "image";
            }


            if (
                type.startsWith(
                    "audio/"
                )
            ) {
                return "audio";
            }


            if (
                type.startsWith(
                    "video/"
                )
            ) {
                return "video";
            }


            if (
                type ===
                "application/pdf" ||
                type.includes("pdf")
            ) {
                return "pdf";
            }


            return "text";

        };


    /* =====================================================
       SUPABASE CLIENT
       ===================================================== */

    const setSupabaseClient =
        client => {

            if (
                !client ||
                typeof client !==
                    "object"
            ) {
                return false;
            }


            supabaseClient =
                client;


            emit(
                "neyo:upload-client-ready"
            );


            return true;

        };


    const getSupabaseClient = () => {

        /*
        Future app bootstrap can explicitly call:

        NeyoUpload.setSupabaseClient(client)

        We do NOT create a second Supabase client here.
        */

        return supabaseClient;

    };


    /* =====================================================
       REQUEST SIGNED UPLOAD
       ===================================================== */

    const requestSignedUpload =
        async file => {

            if (
                !(file instanceof File)
            ) {

                throw new Error(
                    "Invalid file selected."
                );

            }


            const response =
                await fetch(
                    UPLOAD_ENDPOINT,
                    {
                        method:
                            "POST",

                        credentials:
                            "include",

                        cache:
                            "no-store",

                        headers: {

                            "Content-Type":
                                "application/json",

                            Accept:
                                "application/json"

                        },

                        body:
                            JSON.stringify({
                                filename:
                                    file.name,

                                mimeType:
                                    file.type ||
                                    "application/octet-stream",

                                size:
                                    file.size
                            })
                    }
                );


            const data =
                await readJsonResponse(
                    response
                );


            const upload =
                data?.upload;


            if (
                !upload?.bucket ||
                !upload?.path ||
                !upload?.token
            ) {

                throw new Error(
                    "Upload information was not returned."
                );

            }


            return upload;

        };


    /* =====================================================
       UPLOAD SINGLE FILE
       ===================================================== */

    const uploadFile =
        async fileEntry => {

            const rawFile =
                fileEntry?.rawFile instanceof
                    File
                    ? fileEntry.rawFile
                    : fileEntry instanceof File
                        ? fileEntry
                        : null;


            if (!rawFile) {

                throw new Error(
                    "Invalid file selected."
                );

            }


            const client =
                getSupabaseClient();


            if (!client) {

                throw new Error(
                    "Upload service is not ready."
                );

            }


            activeUploads++;


            emit(
                "neyo:upload-start",
                {
                    file:
                        rawFile,

                    activeUploads
                }
            );


            try {

                /* -----------------------------------------
                   SIGNED URL
                   ----------------------------------------- */

                const signed =
                    await requestSignedUpload(
                        rawFile
                    );


                emit(
                    "neyo:upload-signed",
                    {
                        file:
                            rawFile,

                        upload:
                            signed
                    }
                );


                /* -----------------------------------------
                   SUPABASE UPLOAD
                   ----------------------------------------- */

                const {
                    error
                } =
                    await client
                        .storage
                        .from(
                            signed.bucket ||
                            DEFAULT_BUCKET
                        )
                        .uploadToSignedUrl(
                            signed.path,
                            signed.token,
                            rawFile,
                            {
                                contentType:
                                    rawFile.type ||
                                    "application/octet-stream"
                            }
                        );


                if (error) {

                    throw new Error(
                        error.message ||
                        "File upload failed."
                    );

                }


                /* -----------------------------------------
                   RESULT
                   ----------------------------------------- */

                const uploaded = {

                    provider:
                        "supabase",

                    bucket:
                        signed.bucket,

                    path:
                        signed.path,

                    name:
                        rawFile.name,

                    mimeType:
                        rawFile.type ||
                        "application/octet-stream",

                    type:
                        rawFile.type ||
                        "application/octet-stream",

                    category:
                        fileEntry?.category ||
                        getFileCategory(
                            rawFile
                        ),

                    size:
                        rawFile.size,

                    previewUrl:
                        fileEntry?.previewUrl ||
                        ""

                };


                emit(
                    "neyo:upload-success",
                    {
                        file:
                            uploaded
                    }
                );


                return uploaded;

            }

            catch (error) {

                emit(
                    "neyo:upload-error",
                    {
                        file:
                            rawFile,

                        error
                    }
                );


                throw error;

            }

            finally {

                activeUploads =
                    Math.max(
                        0,
                        activeUploads - 1
                    );


                emit(
                    "neyo:upload-end",
                    {
                        file:
                            rawFile,

                        activeUploads
                    }
                );

            }

        };


    /* =====================================================
       UPLOAD MULTIPLE
       ===================================================== */

    const uploadFiles =
        async entries => {

            if (
                !Array.isArray(
                    entries
                )
            ) {
                return [];
            }


            const files =
                entries.slice(
                    0,
                    MAX_FILES
                );


            const uploaded =
                [];


            /*
            Sequential upload is intentional.

            Benefits:
            - Lower memory usage
            - Easier error handling
            - Less pressure on Supabase
            - Matches current neo.js behavior
            */

            for (
                const fileEntry of files
            ) {

                const result =
                    await uploadFile(
                        fileEntry
                    );


                uploaded.push(
                    result
                );

            }


            emit(
                "neyo:uploads-complete",
                {
                    files:
                        [...uploaded],

                    count:
                        uploaded.length
                }
            );


            return uploaded;

        };


    /* =====================================================
       UPLOAD ATTACHMENTS FROM COMPONENT
       ===================================================== */

    const uploadCurrentAttachments =
        async () => {

            const attachments =
                window.NeyoAttachments
                    ?.getFiles?.() ||
                [];


            if (!attachments.length) {
                return [];
            }


            return uploadFiles(
                attachments
            );

        };


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:upload-client-set",
        event => {

            setSupabaseClient(
                event.detail?.client
            );

        }
    );


    window.addEventListener(
        "neyo:upload-file-request",
        event => {

            uploadFile(
                event.detail?.file
            )
                .then(
                    file => {

                        emit(
                            "neyo:upload-file-result",
                            {
                                file
                            }
                        );

                    }
                )
                .catch(
                    error => {

                        console.error(
                            "File upload failed:",
                            error
                        );

                    }
                );

        }
    );


    window.addEventListener(
        "neyo:upload-files-request",
        event => {

            uploadFiles(
                event.detail?.files ||
                []
            )
                .then(
                    files => {

                        emit(
                            "neyo:upload-files-result",
                            {
                                files
                            }
                        );

                    }
                )
                .catch(
                    error => {

                        console.error(
                            "Files upload failed:",
                            error
                        );

                    }
                );

        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoUpload =
        Object.freeze({

            setSupabaseClient,

            upload:
                uploadFile,

            uploadFiles,

            uploadCurrentAttachments,

            requestSignedUpload,

            isUploading:
                () =>
                    activeUploads > 0,

            getActiveCount:
                () =>
                    activeUploads

        });

})();
