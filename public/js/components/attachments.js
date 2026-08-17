/*
=========================================================
NEYO — ATTACHMENTS
STABLE PRODUCTION VERSION

Owns:
- Attachment popup
- Native file picker
- Drag & drop
- Paste files
- Attachment state
- Image preview URLs
- File preview cards
- Remove / clear
- Duplicate protection
- Public API

Does NOT own:
- Actual remote upload
- Supabase storage
- Message sending
- Composer geometry
- Attachment CSS
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       DOM
       ===================================================== */

    const attachBtn =
        document.getElementById("attachBtn");

    const attachPopupMenu =
        document.getElementById("attachPopupMenu");

    const addFilesMenuBtn =
        document.getElementById("addFilesMenuBtn");

    const hiddenFileInput =
        document.getElementById("hiddenFileInput");

    const attachedChipsWrapper =
        document.getElementById("attachedChipsWrapper");

    const composerWrapper =
        document.getElementById("composerWrapper");

    const dragDropOverlay =
        document.getElementById("dragDropOverlay");


    /* =====================================================
       REQUIRED ELEMENT
       ===================================================== */

    if (!attachedChipsWrapper) {
        return;
    }


    /* =====================================================
       CONFIG
       ===================================================== */

    const MAX_ATTACHED_FILES = 5;


    /* =====================================================
       STATE
       ===================================================== */

    let attachedFiles = [];

    let dragDepth = 0;


    /* =====================================================
       ICON REFRESH
       ===================================================== */

    function refreshIcons() {
        if (
            window.lucide &&
            typeof window.lucide.createIcons === "function"
        ) {
            try {
                window.lucide.createIcons();
            } catch {
                // Non-fatal.
            }
        }
    }


    /* =====================================================
       FILE CATEGORY
       MIME + extension fallback
       ===================================================== */

    function getFileCategory(file) {
        const type =
            String(
                file?.type || ""
            ).toLowerCase();

        const name =
            String(
                file?.name || ""
            ).toLowerCase();


        /* IMAGE */

        if (
            type.startsWith("image/") ||
            /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|svg)$/i
                .test(name)
        ) {
            return "image";
        }


        /* AUDIO */

        if (
            type.startsWith("audio/") ||
            /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i
                .test(name)
        ) {
            return "audio";
        }


        /* VIDEO */

        if (
            type.startsWith("video/") ||
            /\.(mp4|webm|mov|m4v|avi|mkv)$/i
                .test(name)
        ) {
            return "video";
        }


        /* PDF */

        if (
            type.includes("pdf") ||
            /\.pdf$/i.test(name)
        ) {
            return "pdf";
        }


        /* DOCUMENT */

        if (
            /\.(doc|docx|rtf|odt)$/i
                .test(name)
        ) {
            return "document";
        }


        /* SPREADSHEET */

        if (
            /\.(xls|xlsx|csv|ods)$/i
                .test(name)
        ) {
            return "spreadsheet";
        }


        /* PRESENTATION */

        if (
            /\.(ppt|pptx|odp)$/i
                .test(name)
        ) {
            return "presentation";
        }


        /* CODE */

        if (
            /\.(js|jsx|ts|tsx|py|java|c|cpp|cs|go|rs|php|rb|swift|kt|html|css|json|xml|yaml|yml|sql|sh)$/i
                .test(name)
        ) {
            return "code";
        }


        return "text";
    }


    /* =====================================================
       IMAGE DETECTION
       ===================================================== */

    function isImageAttachment(file) {
        if (!file) {
            return false;
        }


        if (
            String(
                file.type || ""
            )
                .toLowerCase()
                .startsWith("image/")
        ) {
            return true;
        }


        if (
            String(
                file.mimeType || ""
            )
                .toLowerCase()
                .startsWith("image/")
        ) {
            return true;
        }


        if (
            file.category === "image"
        ) {
            return true;
        }


        const name =
            String(
                file.name || ""
            ).toLowerCase();


        return /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|svg)$/i
            .test(name);
    }


    /* =====================================================
       ICON MAPPING
       ===================================================== */

    function getFileIcon(file) {
        const category =
            file?.category ||
            getFileCategory(file);


        switch (category) {

            case "image":
                return "image";

            case "audio":
                return "music";

            case "video":
                return "video";

            case "pdf":
                return "file-text";

            case "document":
                return "file-text";

            case "spreadsheet":
                return "sheet";

            case "presentation":
                return "presentation";

            case "code":
                return "file-code";

            default:
                return "file";
        }
    }


    /* =====================================================
       PREVIEW URL
       ===================================================== */

    function getPreviewUrl(file) {
        if (!file) {
            return "";
        }


        if (file.previewUrl) {
            return file.previewUrl;
        }


        if (file.signedUrl) {
            return file.signedUrl;
        }


        if (file.url) {
            return file.url;
        }


        return "";
    }


    /* =====================================================
       VALID FILE
       ===================================================== */

    function isNativeFile(file) {
        return (
            typeof File !== "undefined" &&
            file instanceof File
        );
    }


    /* =====================================================
       DUPLICATE CHECK
       ===================================================== */

    function isDuplicateFile(file) {
        return attachedFiles.some(
            item =>
                item.name === file.name &&
                item.size === file.size &&
                item.lastModified ===
                    file.lastModified
        );
    }


    /* =====================================================
       DRAG FILE CHECK
       ===================================================== */

    function dragContainsFiles(event) {
        const types =
            Array.from(
                event.dataTransfer
                    ?.types || []
            );


        return types.includes(
            "Files"
        );
    }


    /* =====================================================
       CREATE PREVIEW URL
       ===================================================== */

    function createPreviewUrl(file, category) {
        if (
            category !== "image" &&
            !isImageAttachment(file)
        ) {
            return "";
        }


        try {
            return URL.createObjectURL(
                file
            );
        } catch {
            return "";
        }
    }


    /* =====================================================
       REVOKE PREVIEW
       ===================================================== */

    function revokePreview(file) {
        const url =
            file?.previewUrl;


        if (
            typeof url === "string" &&
            url.startsWith("blob:")
        ) {
            try {
                URL.revokeObjectURL(
                    url
                );
            } catch {
                // Non-fatal cleanup.
            }
        }
    }


    /* =====================================================
       EVENTS
       ===================================================== */

    function emitChange() {
        window.dispatchEvent(
            new CustomEvent(
                "neyo:attachments-change",
                {
                    detail: {
                        files:
                            [...attachedFiles],

                        count:
                            attachedFiles.length
                    }
                }
            )
        );
    }


    function emitLimit() {
        window.dispatchEvent(
            new CustomEvent(
                "neyo:attachments-limit",
                {
                    detail: {
                        max:
                            MAX_ATTACHED_FILES
                    }
                }
            )
        );
    }


    /* =====================================================
       RENDER
       ===================================================== */

    function renderAttachments() {
        attachedChipsWrapper
            .replaceChildren();


        attachedFiles.forEach(
            (file, index) => {

                const card =
                    document.createElement(
                        "div"
                    );


                card.className =
                    "attachment-preview-card";


                card.dataset.attachmentIndex =
                    String(index);


                /* =========================================
                   IMAGE PREVIEW
                   ========================================= */

                if (
                    isImageAttachment(file)
                ) {

                    const image =
                        document.createElement(
                            "img"
                        );


                    image.alt =
                        file.name ||
                        "Attached image";


                    const previewUrl =
                        getPreviewUrl(file);


                    if (previewUrl) {
                        image.src =
                            previewUrl;
                    }


                    image.loading =
                        "eager";


                    image.decoding =
                        "async";


                    /*
                    If browser cannot decode image,
                    keep card alive rather than breaking
                    attachment rendering.
                    */

                    image.addEventListener(
                        "error",
                        () => {
                            card.classList.add(
                                "attachment-preview-error"
                            );
                        },
                        {
                            once: true
                        }
                    );


                    card.appendChild(
                        image
                    );
                }


                /* =========================================
                   NORMAL FILE
                   ========================================= */

                else {

                    const box =
                        document.createElement(
                            "div"
                        );


                    box.className =
                        "attachment-preview-file";


                    const icon =
                        document.createElement(
                            "i"
                        );


                    icon.setAttribute(
                        "data-lucide",
                        getFileIcon(file)
                    );


                    icon.setAttribute(
                        "aria-hidden",
                        "true"
                    );


                    const name =
                        document.createElement(
                            "span"
                        );


                    name.textContent =
                        file.name ||
                        "Attached file";


                    box.append(
                        icon,
                        name
                    );


                    card.appendChild(
                        box
                    );
                }


                /* =========================================
                   REMOVE BUTTON
                   ========================================= */

                const removeBtn =
                    document.createElement(
                        "button"
                    );


                removeBtn.type =
                    "button";


                removeBtn.className =
                    "attachment-remove-btn";


                removeBtn.dataset.tooltip =
                    "Remove attachment";


                removeBtn.setAttribute(
                    "aria-label",
                    `Remove ${
                        file.name ||
                        "attachment"
                    }`
                );


                removeBtn.innerHTML = `
                    <i
                        data-lucide="x"
                        width="14"
                        height="14"
                        aria-hidden="true"
                    ></i>
                `;


                removeBtn.addEventListener(
                    "click",
                    event => {

                        event.preventDefault();
                        event.stopPropagation();

                        removeAttachment(
                            index
                        );
                    }
                );


                card.appendChild(
                    removeBtn
                );


                attachedChipsWrapper
                    .appendChild(
                        card
                    );
            }
        );


        refreshIcons();

        emitChange();


        /*
        Composer JS may need to recalculate
        after attachment row changes.
        */

        window.NeyoComposerScrollbar
            ?.refresh?.();
    }


    /* =====================================================
       ADD FILES
       ===================================================== */

    function addFiles(files) {
        const selected =
            Array.from(
                files || []
            );


        if (!selected.length) {
            return;
        }


        let changed = false;


        for (const file of selected) {

            /* -----------------------------------------
               Maximum attachment count
               ----------------------------------------- */

            if (
                attachedFiles.length >=
                MAX_ATTACHED_FILES
            ) {

                emitLimit();

                break;
            }


            /* -----------------------------------------
               Only real browser File objects
               ----------------------------------------- */

            if (
                !isNativeFile(file)
            ) {
                continue;
            }


            /* -----------------------------------------
               Skip duplicates
               ----------------------------------------- */

            if (
                isDuplicateFile(file)
            ) {
                continue;
            }


            const category =
                getFileCategory(file);


            const previewUrl =
                createPreviewUrl(
                    file,
                    category
                );


            const entry = {

                id:
                    (
                        window.crypto
                            ?.randomUUID?.() ||
                        `${Date.now()}-${Math.random()
                            .toString(36)
                            .slice(2)}`
                    ),

                name:
                    file.name ||
                    "attachment",

                type:
                    file.type ||
                    "application/octet-stream",

                mimeType:
                    file.type ||
                    "application/octet-stream",

                category,

                size:
                    Number(
                        file.size || 0
                    ),

                lastModified:
                    Number(
                        file.lastModified || 0
                    ),

                rawFile:
                    file,

                previewUrl
            };


            attachedFiles.push(
                entry
            );


            changed = true;
        }


        if (changed) {
            renderAttachments();
        }
    }


    /* =====================================================
       REMOVE ONE
       ===================================================== */

    function removeAttachment(index) {
        if (
            index < 0 ||
            index >= attachedFiles.length
        ) {
            return;
        }


        const [
            removed
        ] =
            attachedFiles.splice(
                index,
                1
            );


        revokePreview(
            removed
        );


        renderAttachments();
    }


    /* =====================================================
       CLEAR ALL
       ===================================================== */

    function clearAttachments() {
        attachedFiles.forEach(
            revokePreview
        );


        attachedFiles = [];


        renderAttachments();
    }


    /* =====================================================
       POPUP MENU
       ===================================================== */

    function openAttachmentMenu() {
        attachPopupMenu
            ?.classList
            .add("show");
    }


    function closeAttachmentMenu() {
        attachPopupMenu
            ?.classList
            .remove("show");
    }


    function toggleAttachmentMenu() {
        attachPopupMenu
            ?.classList
            .toggle("show");
    }


    /* =====================================================
       + BUTTON
       ===================================================== */

    attachBtn?.addEventListener(
        "click",
        event => {

            event.preventDefault();
            event.stopPropagation();

            toggleAttachmentMenu();
        }
    );


    /* =====================================================
       ADD FILES MENU ITEM
       ===================================================== */

    addFilesMenuBtn?.addEventListener(
        "click",
        event => {

            event.preventDefault();
            event.stopPropagation();


            closeAttachmentMenu();


            /*
            Must remain inside the direct user click
            so browser allows native picker.
            */

            hiddenFileInput
                ?.click();
        }
    );


    /* =====================================================
       NATIVE FILE INPUT
       ===================================================== */

    hiddenFileInput?.addEventListener(
        "change",
        event => {

            const input =
                event.currentTarget;


            const files =
                input?.files;


            if (
                files &&
                files.length
            ) {
                addFiles(
                    files
                );
            }


            /*
            Important:
            Allows selecting same file again
            after it has been removed.
            */

            if (input) {
                input.value = "";
            }
        }
    );


    /* =====================================================
       CLICK OUTSIDE
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            const target =
                event.target;


            const insideButton =
                attachBtn
                    ?.contains(target);


            const insideMenu =
                attachPopupMenu
                    ?.contains(target);


            if (
                !insideButton &&
                !insideMenu
            ) {
                closeAttachmentMenu();
            }
        }
    );


    /* =====================================================
       DRAG OVERLAY
       ===================================================== */

    function showDragOverlay() {
        dragDropOverlay
            ?.classList
            .add("show");
    }


    function hideDragOverlay() {
        dragDepth = 0;


        dragDropOverlay
            ?.classList
            .remove("show");
    }


    /* =====================================================
       DRAG & DROP
       Single controlled pipeline.
       ===================================================== */

    if (composerWrapper) {

        /* -----------------------------------------
           DRAG ENTER
           ----------------------------------------- */

        composerWrapper
            .addEventListener(
                "dragenter",
                event => {

                    if (
                        !dragContainsFiles(
                            event
                        )
                    ) {
                        return;
                    }


                    event.preventDefault();
                    event.stopPropagation();


                    dragDepth += 1;


                    showDragOverlay();
                }
            );


        /* -----------------------------------------
           DRAG OVER
           ----------------------------------------- */

        composerWrapper
            .addEventListener(
                "dragover",
                event => {

                    if (
                        !dragContainsFiles(
                            event
                        )
                    ) {
                        return;
                    }


                    event.preventDefault();
                    event.stopPropagation();


                    if (
                        event.dataTransfer
                    ) {
                        event.dataTransfer.dropEffect =
                            "copy";
                    }


                    showDragOverlay();
                }
            );


        /* -----------------------------------------
           DRAG LEAVE
           ----------------------------------------- */

        composerWrapper
            .addEventListener(
                "dragleave",
                event => {

                    if (
                        !dragContainsFiles(
                            event
                        )
                    ) {
                        return;
                    }


                    event.preventDefault();
                    event.stopPropagation();


                    dragDepth =
                        Math.max(
                            0,
                            dragDepth - 1
                        );


                    if (
                        dragDepth === 0
                    ) {
                        hideDragOverlay();
                    }
                }
            );


        /* -----------------------------------------
           DROP
           ----------------------------------------- */

        composerWrapper
            .addEventListener(
                "drop",
                event => {

                    event.preventDefault();
                    event.stopPropagation();


                    const files =
                        event.dataTransfer
                            ?.files;


                    hideDragOverlay();


                    if (
                        files &&
                        files.length
                    ) {
                        addFiles(
                            files
                        );
                    }
                }
            );
    }


    /* =====================================================
       GLOBAL DRAG SAFETY
       ===================================================== */

    document.addEventListener(
        "dragend",
        hideDragOverlay
    );


    window.addEventListener(
        "blur",
        () => {

            if (
                dragDropOverlay
                    ?.classList
                    .contains("show")
            ) {
                hideDragOverlay();
            }
        }
    );


    /* =====================================================
       PASTE FILES
       ===================================================== */

    document.addEventListener(
        "paste",
        event => {

            const files =
                event.clipboardData
                    ?.files;


            if (
                !files ||
                !files.length
            ) {
                return;
            }


            addFiles(
                files
            );
        }
    );


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:attachments-clear",
        clearAttachments
    );


    window.addEventListener(
        "neyo:attachments-open",
        openAttachmentMenu
    );


    window.addEventListener(
        "neyo:attachments-close",
        closeAttachmentMenu
    );


    /* =====================================================
       CLEANUP
       ===================================================== */

    window.addEventListener(
        "pagehide",
        () => {

            attachedFiles
                .forEach(
                    revokePreview
                );


            hideDragOverlay();
        },
        {
            once: true
        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoAttachments =
        Object.freeze({

            getFiles:
                () =>
                    [...attachedFiles],

            getCount:
                () =>
                    attachedFiles.length,

            add:
                addFiles,

            remove:
                removeAttachment,

            clear:
                clearAttachments,

            render:
                renderAttachments,

            openMenu:
                openAttachmentMenu,

            closeMenu:
                closeAttachmentMenu,

            maxFiles:
                MAX_ATTACHED_FILES
        });


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    hideDragOverlay();

    renderAttachments();

})();
