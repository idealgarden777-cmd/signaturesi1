/*
=========================================================
NEYO — ATTACHMENTS COMPONENT
STABLE PRODUCTION VERSION

Owns:
- Attachment picker
- Attachment popup open / close
- Selected file state
- Attachment preview chips
- Remove attachment
- Drag & drop
- Paste upload
- File category detection
- Public attachment API

Does NOT own:
- Supabase upload
- /api/upload
- Message sending
- Image compression
- Chat API
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
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
       CONSTANTS
       ===================================================== */

    const MAX_ATTACHED_FILES = 5;


    /* =====================================================
       STATE
       ===================================================== */

    let attachedFiles = [];

    let dragDepth = 0;


    /* =====================================================
       HELPERS
       ===================================================== */

    function refreshIcons() {
        if (
            window.lucide &&
            typeof window.lucide.createIcons === "function"
        ) {
            try {
                window.lucide.createIcons();
            } catch {
                // Safe fallback.
            }
        }
    }


    function getFileCategory(file) {
        const type =
            String(file?.type || "")
                .toLowerCase();

        if (type.startsWith("image/")) {
            return "image";
        }

        if (type.startsWith("audio/")) {
            return "audio";
        }

        if (type.startsWith("video/")) {
            return "video";
        }

        if (type.includes("pdf")) {
            return "pdf";
        }

        return "text";
    }


    function isImageAttachment(file) {
        if (!file) {
            return false;
        }

        if (
            file.type?.startsWith("image/")
        ) {
            return true;
        }

        if (
            file.mimeType?.startsWith("image/")
        ) {
            return true;
        }

        if (
            file.category === "image"
        ) {
            return true;
        }

        const name =
            String(file.name || "")
                .toLowerCase();

        return /\.(png|jpg|jpeg|webp|gif)$/i
            .test(name);
    }


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

            default:
                return "file";
        }
    }


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

        return "";
    }


    function isRealFile(file) {
        return (
            typeof File !== "undefined" &&
            file instanceof File
        );
    }


    function hasFilesInDrag(event) {
        const types =
            Array.from(
                event.dataTransfer?.types || []
            );

        return types.includes("Files");
    }


    function fileAlreadyAttached(file) {
        return attachedFiles.some(
            item =>
                item.name === file.name &&
                item.size === file.size &&
                item.type === (
                    file.type ||
                    "application/octet-stream"
                )
        );
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
                        files: [
                            ...attachedFiles
                        ],

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
        if (!attachedChipsWrapper) {
            return;
        }

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


                /* -----------------------------------------
                   IMAGE PREVIEW
                   ----------------------------------------- */

                if (
                    isImageAttachment(file)
                ) {
                    const image =
                        document.createElement(
                            "img"
                        );

                    image.alt =
                        file.name ||
                        "Uploaded image";

                    image.src =
                        getPreviewUrl(file);

                    image.loading =
                        "lazy";

                    image.decoding =
                        "async";

                    card.appendChild(
                        image
                    );
                }


                /* -----------------------------------------
                   NORMAL FILE
                   ----------------------------------------- */

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


                /* -----------------------------------------
                   REMOVE
                   ----------------------------------------- */

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
                    .appendChild(card);
            }
        );


        refreshIcons();

        emitChange();


        /*
        Allow composer modules to recalculate
        after attachment rail height changes.
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


        for (const file of selected) {

            if (
                attachedFiles.length >=
                MAX_ATTACHED_FILES
            ) {
                emitLimit();

                break;
            }


            if (!isRealFile(file)) {
                continue;
            }


            /*
            Avoid accidental duplicate drops/selections.
            */

            if (
                fileAlreadyAttached(file)
            ) {
                continue;
            }


            const category =
                getFileCategory(file);


            const entry = {
                name:
                    file.name,

                type:
                    file.type ||
                    "application/octet-stream",

                mimeType:
                    file.type ||
                    "application/octet-stream",

                category,

                size:
                    file.size,

                rawFile:
                    file,

                previewUrl:
                    category === "image"
                        ? URL.createObjectURL(
                            file
                        )
                        : ""
            };


            attachedFiles.push(
                entry
            );
        }


        renderAttachments();
    }


    /* =====================================================
       REMOVE
       ===================================================== */

    function removeAttachment(index) {
        const file =
            attachedFiles[index];


        if (
            file?.previewUrl?.startsWith(
                "blob:"
            )
        ) {
            try {
                URL.revokeObjectURL(
                    file.previewUrl
                );
            } catch {
                // Safe cleanup.
            }
        }


        attachedFiles.splice(
            index,
            1
        );


        renderAttachments();
    }


    /* =====================================================
       CLEAR
       ===================================================== */

    function clearAttachments() {
        attachedFiles.forEach(
            file => {

                if (
                    file?.previewUrl
                        ?.startsWith(
                            "blob:"
                        )
                ) {
                    try {
                        URL.revokeObjectURL(
                            file.previewUrl
                        );
                    } catch {
                        // Safe cleanup.
                    }
                }

            }
        );


        attachedFiles = [];

        renderAttachments();
    }


    /* =====================================================
       ATTACH POPUP
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


    attachBtn?.addEventListener(
        "click",
        event => {
            event.preventDefault();
            event.stopPropagation();

            toggleAttachmentMenu();
        }
    );


    addFilesMenuBtn?.addEventListener(
        "click",
        event => {
            event.preventDefault();
            event.stopPropagation();

            closeAttachmentMenu();

            /*
            Native file picker.
            Must stay inside direct user interaction.
            */

            hiddenFileInput?.click();
        }
    );


    /* =====================================================
       FILE INPUT
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
                addFiles(files);
            }


            /*
            Allow selecting same file again
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

            const clickedButton =
                attachBtn?.contains(
                    event.target
                );


            const clickedMenu =
                attachPopupMenu?.contains(
                    event.target
                );


            if (
                !clickedButton &&
                !clickedMenu
            ) {
                closeAttachmentMenu();
            }
        }
    );


    /* =====================================================
       DRAG OVERLAY HELPERS
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
       Stable nested-element-safe implementation.
       ===================================================== */

    if (composerWrapper) {

        composerWrapper.addEventListener(
            "dragenter",
            event => {

                if (
                    !hasFilesInDrag(event)
                ) {
                    return;
                }


                event.preventDefault();
                event.stopPropagation();


                dragDepth += 1;

                showDragOverlay();
            }
        );


        composerWrapper.addEventListener(
            "dragover",
            event => {

                if (
                    !hasFilesInDrag(event)
                ) {
                    return;
                }


                event.preventDefault();
                event.stopPropagation();


                if (
                    event.dataTransfer
                ) {
                    event.dataTransfer
                        .dropEffect =
                        "copy";
                }


                showDragOverlay();
            }
        );


        composerWrapper.addEventListener(
            "dragleave",
            event => {

                if (
                    !hasFilesInDrag(event)
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


        composerWrapper.addEventListener(
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
                    addFiles(files);
                }
            }
        );
    }


    /* =====================================================
       GLOBAL DRAG SAFETY

       If cursor leaves browser/window while dragging,
       overlay must not remain stuck.
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


            addFiles(files);
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
       PAGE CLEANUP
       ===================================================== */

    window.addEventListener(
        "pagehide",
        () => {

            attachedFiles.forEach(
                file => {

                    if (
                        file?.previewUrl
                            ?.startsWith(
                                "blob:"
                            )
                    ) {
                        try {
                            URL.revokeObjectURL(
                                file.previewUrl
                            );
                        } catch {
                            // Safe cleanup.
                        }
                    }

                }
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
                () => [
                    ...attachedFiles
                ],

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

})();
