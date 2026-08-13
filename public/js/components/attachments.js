/*
=========================================================
NEYO — ATTACHMENTS COMPONENT

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


    /* =====================================================
       HELPERS
       ===================================================== */

    const refreshIcons = () => {
        if (window.lucide?.createIcons) {
            window.lucide.createIcons();
        }
    };


    const getFileCategory = file => {
        const type =
            file?.type || "";

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
    };


    const isImageAttachment = file => {
        if (!file) return false;

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
    };


    const getFileIcon = file => {

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
    };


    const getPreviewUrl = file => {

        if (!file) return "";

        if (file.previewUrl) {
            return file.previewUrl;
        }

        if (file.signedUrl) {
            return file.signedUrl;
        }

        return "";
    };


    /* =====================================================
       EVENTS
       ===================================================== */

    const emitChange = () => {

        window.dispatchEvent(
            new CustomEvent(
                "neyo:attachments-change",
                {
                    detail: {
                        files: [...attachedFiles],
                        count: attachedFiles.length
                    }
                }
            )
        );
    };


    /* =====================================================
       RENDER
       ===================================================== */

    const renderAttachments = () => {

        if (!attachedChipsWrapper) {
            return;
        }

        attachedChipsWrapper.replaceChildren();


        attachedFiles.forEach(
            (file, index) => {

                const card =
                    document.createElement("div");

                card.className =
                    "attachment-preview-card";


                /* -----------------------------------------
                   IMAGE PREVIEW
                   ----------------------------------------- */

                if (
                    isImageAttachment(file)
                ) {

                    const image =
                        document.createElement("img");

                    image.alt =
                        file.name ||
                        "Uploaded image";

                    image.src =
                        getPreviewUrl(file);

                    card.appendChild(
                        image
                    );
                }

                /* -----------------------------------------
                   FILE PREVIEW
                   ----------------------------------------- */

                else {

                    const box =
                        document.createElement("div");

                    box.className =
                        "attachment-preview-file";


                    const icon =
                        document.createElement("i");

                    icon.setAttribute(
                        "data-lucide",
                        getFileIcon(file)
                    );


                    const name =
                        document.createElement("span");

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
                   REMOVE BUTTON
                   ----------------------------------------- */

                const removeBtn =
                    document.createElement("button");

                removeBtn.type =
                    "button";

                removeBtn.className =
                    "attachment-remove-btn";

                removeBtn.dataset.tooltip =
                    "Remove attachment";

                removeBtn.setAttribute(
                    "aria-label",
                    "Remove attachment"
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
                    () => {
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
    };


    /* =====================================================
       ADD FILES
       ===================================================== */

    const addFiles = files => {

        const selected =
            Array.from(files || []);


        for (const file of selected) {

            if (
                attachedFiles.length >=
                MAX_ATTACHED_FILES
            ) {

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

                break;
            }


            if (
                !(file instanceof File)
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
                        ? URL.createObjectURL(file)
                        : ""
            };


            attachedFiles.push(
                entry
            );
        }


        renderAttachments();
    };


    /* =====================================================
       REMOVE
       ===================================================== */

    const removeAttachment = index => {

        const file =
            attachedFiles[index];


        if (
            file?.previewUrl?.startsWith(
                "blob:"
            )
        ) {
            URL.revokeObjectURL(
                file.previewUrl
            );
        }


        attachedFiles.splice(
            index,
            1
        );


        renderAttachments();
    };


    /* =====================================================
       CLEAR
       ===================================================== */

    const clearAttachments = () => {

        attachedFiles.forEach(
            file => {

                if (
                    file?.previewUrl?.startsWith(
                        "blob:"
                    )
                ) {
                    URL.revokeObjectURL(
                        file.previewUrl
                    );
                }
            }
        );


        attachedFiles = [];

        renderAttachments();
    };


    /* =====================================================
       ATTACH POPUP
       ===================================================== */

    const openAttachmentMenu = () => {
        attachPopupMenu
            ?.classList
            .add("show");
    };


    const closeAttachmentMenu = () => {
        attachPopupMenu
            ?.classList
            .remove("show");
    };


    const toggleAttachmentMenu = () => {

        attachPopupMenu
            ?.classList
            .toggle("show");
    };


    attachBtn?.addEventListener(
        "click",
        event => {

            event.stopPropagation();

            toggleAttachmentMenu();
        }
    );


    addFilesMenuBtn?.addEventListener(
        "click",
        event => {

            event.stopPropagation();

            closeAttachmentMenu();

            hiddenFileInput?.click();
        }
    );


    /* =====================================================
       FILE INPUT
       ===================================================== */

    hiddenFileInput?.addEventListener(
        "change",
        event => {

            const files =
                event.target.files;

            if (
                files?.length
            ) {
                addFiles(files);
            }


            /*
            Reset input so selecting the same
            file again still triggers change.
            */

            event.target.value = "";
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
       DRAG & DROP
       ===================================================== */

    if (composerWrapper) {

        [
            "dragenter",
            "dragover"
        ].forEach(
            eventName => {

                composerWrapper
                    .addEventListener(
                        eventName,
                        event => {

                            event.preventDefault();
                            event.stopPropagation();

                            dragDropOverlay
                                ?.classList
                                .add("show");
                        }
                    );
            }
        );


        [
            "dragleave",
            "drop"
        ].forEach(
            eventName => {

                composerWrapper
                    .addEventListener(
                        eventName,
                        event => {

                            event.preventDefault();
                            event.stopPropagation();

                            dragDropOverlay
                                ?.classList
                                .remove("show");
                        }
                    );
            }
        );


        composerWrapper.addEventListener(
            "drop",
            event => {

                const files =
                    event.dataTransfer
                        ?.files;

                if (
                    files?.length
                ) {
                    addFiles(files);
                }
            }
        );
    }


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
                files?.length
            ) {
                addFiles(files);
            }
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
       PUBLIC API

       Future modules can use:

       NeyoAttachments.getFiles()
       NeyoAttachments.clear()
       NeyoAttachments.add(files)
       ===================================================== */

    window.NeyoAttachments =
        Object.freeze({

            getFiles: () =>
                [...attachedFiles],

            getCount: () =>
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

})();
