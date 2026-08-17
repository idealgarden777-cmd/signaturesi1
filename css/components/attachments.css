/*
=========================================================
NEYO — ATTACHMENTS
PRODUCTION / COMPOSER-SAFE VERSION

Owns:
- Attachment popup
- Drag overlay visuals
- Attachment preview rail
- Image preview cards
- Generic file preview cards
- Remove button
- Attachment-state composer integration
- Responsive behavior
- Dark mode

Does NOT own:
- File selection logic
- Drag/drop JS
- Upload API
- Composer width
- Base composer colors/shadow
- Composer typing behavior
=========================================================
*/


/* =========================================================
   1. TOKENS
   ========================================================= */

#composerWrapper {
    --attachment-preview-height: 76px;
    --attachment-card-width: 132px;
    --attachment-card-height: 64px;
    --attachment-card-radius: 12px;
    --attachment-gap: 8px;
}


/* =========================================================
   2. POPUP MENU
   ========================================================= */

.attachment-popup-menu {
    position: absolute;

    left: 0;
    bottom: calc(100% + 12px);

    min-width: 180px;

    display: none;
    flex-direction: column;

    gap: 2px;

    padding: 8px 6px;

    border:
        1px solid
        rgba(0, 0, 0, 0.05);

    border-radius: 18px;

    background:
        rgba(255, 255, 255, 0.96);

    -webkit-backdrop-filter:
        blur(16px);

    backdrop-filter:
        blur(16px);

    box-shadow:
        0 12px 40px
        rgba(0, 0, 0, 0.12);

    z-index: 1000;

    box-sizing: border-box;
}


.attachment-popup-menu.show {
    display: flex;
}


/* =========================================================
   3. POPUP ITEM
   ========================================================= */

.attachment-popup-item {
    width: 100%;

    display: flex;
    align-items: center;

    gap: 12px;

    padding: 10px 14px;

    border: 0;
    border-radius: 12px;

    background: transparent;

    color: #1d1d1f;

    font-size: 14px;
    font-weight: 500;

    text-align: left;

    cursor: pointer;

    box-sizing: border-box;

    transition:
        background-color 120ms ease,
        color 120ms ease;
}


.attachment-popup-item:hover {
    background:
        rgba(0, 0, 0, 0.045);
}


.attachment-popup-item svg,
.attachment-popup-item i {
    width: 20px;
    height: 20px;

    flex: 0 0 20px;

    opacity: 0.72;
}


.attachment-popup-item span {
    flex: 1 1 auto;

    min-width: 0;
}


.attachment-popup-item .popup-shortcut {
    flex: 0 0 auto;

    font-size: 12px;
    font-weight: 400;

    letter-spacing: 0.25px;

    opacity: 0.42;
}


.attachment-popup-item.danger {
    color: #e5484d;
}


.attachment-popup-item.danger:hover {
    background:
        rgba(229, 72, 77, 0.08);
}


/* =========================================================
   4. DRAG OVERLAY
   Visual only.
   Must NEVER capture drag/drop events.
   ========================================================= */

#composerWrapper {
    position: relative;
}


.drag-drop-overlay {
    position: absolute;

    inset: 0;

    display: flex;
    flex-direction: column;

    align-items: center;
    justify-content: center;

    gap: 8px;

    border-radius: inherit;

    background:
        rgba(20, 20, 20, 0.68);

    -webkit-backdrop-filter:
        blur(6px);

    backdrop-filter:
        blur(6px);

    color: #ffffff;

    opacity: 0;
    visibility: hidden;

    pointer-events: none !important;

    z-index: 100;

    transition:
        opacity 140ms ease,
        visibility 140ms ease;
}


.drag-drop-overlay.show {
    opacity: 1;
    visibility: visible;

    pointer-events: none !important;
}


.drag-drop-overlay > svg,
.drag-drop-overlay > i {
    width: 28px;
    height: 28px;

    flex: 0 0 28px;

    margin: 0 0 2px;

    pointer-events: none;
}


.drag-drop-overlay > span {
    font-size: 14px;
    font-weight: 500;
    line-height: 1.3;

    pointer-events: none;
}


/* =========================================================
   5. EMPTY PREVIEW WRAPPER
   ========================================================= */

#attachedChipsWrapper:empty {
    display: none !important;

    width: 0 !important;
    height: 0 !important;

    min-width: 0 !important;
    min-height: 0 !important;

    margin: 0 !important;
    padding: 0 !important;
}


/* =========================================================
   6. ATTACHMENT STATE — OUTER COMPOSER

   Important:
   Attachment only adds preview row.
   Lower control rail keeps normal composer geometry.
   ========================================================= */

#glassInputContainer:has(
    #attachedChipsWrapper:not(:empty)
):not(.is-writing-expanded) {
    position: relative !important;

    display: block !important;

    height: auto !important;

    min-height:
        calc(
            var(--attachment-preview-height) +
            var(--neyo-pill-height, 56px)
        ) !important;

    max-height: none !important;

    padding: 0 !important;

    overflow: hidden !important;

    box-sizing: border-box !important;
}


/* =========================================================
   7. PREVIEW RAIL
   ========================================================= */

#glassInputContainer
#attachedChipsWrapper:not(:empty) {
    position: relative !important;

    width: 100% !important;

    height:
        var(--attachment-preview-height) !important;

    min-height:
        var(--attachment-preview-height) !important;

    max-height:
        var(--attachment-preview-height) !important;

    display: flex !important;
    align-items: center !important;

    flex-wrap: nowrap !important;
    flex: 0 0 auto !important;

    gap:
        var(--attachment-gap) !important;

    margin: 0 !important;

    padding:
        8px
        12px
        4px !important;

    overflow-x: auto !important;
    overflow-y: hidden !important;

    visibility: visible !important;
    opacity: 1 !important;

    box-sizing: border-box !important;

    z-index: 4 !important;

    scrollbar-width: none;
    -ms-overflow-style: none;
}


#glassInputContainer
#attachedChipsWrapper:not(:empty)::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
}


/* =========================================================
   8. ATTACHMENT CARD
   ========================================================= */

#glassInputContainer
#attachedChipsWrapper:not(:empty)
.attachment-preview-card {
    position: relative !important;

    width:
        var(--attachment-card-width) !important;

    height:
        var(--attachment-card-height) !important;

    min-width:
        var(--attachment-card-width) !important;

    min-height:
        var(--attachment-card-height) !important;

    max-width:
        var(--attachment-card-width) !important;

    max-height:
        var(--attachment-card-height) !important;

    flex:
        0 0 var(--attachment-card-width) !important;

    display: block !important;

    margin: 0 !important;
    padding: 0 !important;

    border:
        1px solid
        rgba(0, 0, 0, 0.06) !important;

    border-radius:
        var(--attachment-card-radius) !important;

    background:
        rgba(0, 0, 0, 0.025) !important;

    overflow: hidden !important;

    visibility: visible !important;
    opacity: 1 !important;

    box-sizing: border-box !important;

    flex-shrink: 0 !important;
}


/* =========================================================
   9. IMAGE PREVIEW
   ========================================================= */

#glassInputContainer
#attachedChipsWrapper:not(:empty)
.attachment-preview-card > img {
    display: block !important;

    width: 100% !important;
    height: 100% !important;

    min-width: 100% !important;
    min-height: 100% !important;

    max-width: 100% !important;
    max-height: 100% !important;

    margin: 0 !important;
    padding: 0 !important;

    object-fit: cover !important;
    object-position: center !important;

    border-radius: inherit !important;

    visibility: visible !important;
    opacity: 1 !important;

    background:
        rgba(0, 0, 0, 0.035);
}


/* =========================================================
   10. IMAGE ERROR FALLBACK
   ========================================================= */

#glassInputContainer
.attachment-preview-card.attachment-preview-error {
    background:
        rgba(0, 0, 0, 0.04) !important;
}


#glassInputContainer
.attachment-preview-card.attachment-preview-error > img {
    opacity: 0.28 !important;
}


/* =========================================================
   11. GENERIC FILE PREVIEW
   Current JS creates direct icon + span.
   ========================================================= */

#glassInputContainer
.attachment-preview-card
.attachment-preview-file {
    width: 100%;
    height: 100%;

    min-width: 0;

    display: flex;

    align-items: center;

    gap: 10px;

    margin: 0;

    padding:
        10px
        30px
        10px
        10px;

    border: 0;

    border-radius: inherit;

    background:
        rgba(0, 0, 0, 0.025);

    color:
        var(--text-primary, #1d1d1f);

    box-sizing: border-box;
}


#glassInputContainer
.attachment-preview-card
.attachment-preview-file > svg,

#glassInputContainer
.attachment-preview-card
.attachment-preview-file > i {
    width: 20px;
    height: 20px;

    flex: 0 0 20px;

    opacity: 0.62;
}


#glassInputContainer
.attachment-preview-card
.attachment-preview-file > span {
    min-width: 0;

    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    font-size: 13px;
    font-weight: 500;
}


/* =========================================================
   12. REMOVE BUTTON
   ========================================================= */

#glassInputContainer
.attachment-preview-card
.attachment-remove-btn {
    position: absolute !important;

    top: 6px !important;
    right: 6px !important;

    width: 22px !important;
    height: 22px !important;

    min-width: 22px !important;
    min-height: 22px !important;

    max-width: 22px !important;
    max-height: 22px !important;

    display: inline-flex !important;

    align-items: center !important;
    justify-content: center !important;

    margin: 0 !important;
    padding: 0 !important;

    border: 0 !important;
    border-radius: 999px !important;

    background:
        rgba(0, 0, 0, 0.56) !important;

    color:
        #ffffff !important;

    opacity: 1 !important;

    cursor: pointer !important;

    z-index: 6 !important;

    box-sizing: border-box !important;

    transition:
        background-color 120ms ease,
        transform 120ms ease !important;
}


#glassInputContainer
.attachment-preview-card
.attachment-remove-btn:hover {
    background:
        rgba(0, 0, 0, 0.78) !important;
}


#glassInputContainer
.attachment-preview-card
.attachment-remove-btn:active {
    transform:
        scale(0.94) !important;
}


#glassInputContainer
.attachment-preview-card
.attachment-remove-btn svg,

#glassInputContainer
.attachment-preview-card
.attachment-remove-btn i {
    width: 12px !important;
    height: 12px !important;

    pointer-events: none !important;
}


/* =========================================================
   13. LOWER INPUT ROW
   Exact normal composer geometry.
   ========================================================= */

#glassInputContainer:has(
    #attachedChipsWrapper:not(:empty)
):not(.is-writing-expanded)
.composer-input-row {
    position: relative !important;

    display: block !important;

    width: 100% !important;

    height:
        var(--neyo-pill-height, 56px) !important;

    min-height:
        var(--neyo-pill-height, 56px) !important;

    max-height:
        var(--neyo-pill-height, 56px) !important;

    margin: 0 !important;
    padding: 0 !important;

    box-sizing: border-box !important;
}


/* =========================================================
   14. CONTROLS
   Same coordinates as normal composer.
   ========================================================= */

#glassInputContainer:has(
    #attachedChipsWrapper:not(:empty)
):not(.is-writing-expanded)
#attachBtn,

#glassInputContainer:has(
    #attachedChipsWrapper:not(:empty)
):not(.is-writing-expanded)
#micBtn,

#glassInputContainer:has(
    #attachedChipsWrapper:not(:empty)
):not(.is-writing-expanded)
#sendBtn {
    position: absolute !important;

    top: auto !important;

    bottom:
        var(--neyo-control-bottom, 8px) !important;

    margin: 0 !important;

    transform: none !important;
}


/* + */

#glassInputContainer:has(
    #attachedChipsWrapper:not(:empty)
):not(.is-writing-expanded)
#attachBtn {
    left:
        var(--neyo-edge-x, 8px) !important;

    right: auto !important;
}


/* Send */

#glassInputContainer:has(
    #attachedChipsWrapper:not(:empty)
):not(.is-writing-expanded)
#sendBtn {
    right:
        var(--neyo-edge-x, 8px) !important;

    left: auto !important;
}


/* Mic */

#glassInputContainer:has(
    #attachedChipsWrapper:not(:empty)
):not(.is-writing-expanded)
#micBtn {
    right:
        calc(
            var(--neyo-edge-x, 8px) +
            var(--neyo-control-size, 40px) +
            var(--neyo-control-gap, 6px)
        ) !important;

    left: auto !important;
}


/* =========================================================
   15. TEXTAREA — ONE LINE WITH ATTACHMENT
   Same lower-row alignment as normal composer.
   ========================================================= */

#glassInputContainer:has(
    #attachedChipsWrapper:not(:empty)
):not(.is-writing-expanded):not(.composer-multiline)
textarea#chatInput {
    position: absolute !important;

    left: 0 !important;
    right: 0 !important;

    top: auto !important;
    bottom:
        var(--neyo-control-bottom, 8px) !important;

    width: 100% !important;

    height:
        var(--neyo-control-size, 40px) !important;

    min-height:
        var(--neyo-control-size, 40px) !important;

    max-height:
        var(--neyo-control-size, 40px) !important;

    margin: 0 !important;

    padding:
        8px
        var(--neyo-oneline-right, 96px)
        8px
        var(--neyo-oneline-left, 56px) !important;

    line-height: 24px !important;

    transform: none !important;

    box-sizing: border-box !important;
}


/* =========================================================
   16. MULTILINE WITH ATTACHMENTS
   Keep typing logic owned by composer-scrollbar.css.
   Only ensure preview row remains separate.
   ========================================================= */

#glassInputContainer:has(
    #attachedChipsWrapper:not(:empty)
).composer-multiline:not(.is-writing-expanded) {
    height: auto !important;

    min-height:
        calc(
            var(--attachment-preview-height) +
            var(--neyo-rail-height, 56px)
        ) !important;

    max-height: none !important;
}


#glassInputContainer:has(
    #attachedChipsWrapper:not(:empty)
).composer-multiline:not(.is-writing-expanded)
.composer-input-row {
    height: auto !important;

    min-height:
        var(--neyo-rail-height, 56px) !important;

    max-height: none !important;
}


/* =========================================================
   17. SUGGESTIONS
   Do not force display.
   Only prevent attachment-specific hiding.
   ========================================================= */

#composerWrapper:has(
    #attachedChipsWrapper:not(:empty)
)
.live-suggestions {
    visibility: visible;
    opacity: 1;
}


/* =========================================================
   18. DARK MODE
   ========================================================= */

body.dark-mode
.attachment-popup-menu {
    border-color:
        rgba(255, 255, 255, 0.08);

    background:
        rgba(28, 28, 28, 0.94);

    box-shadow:
        0 14px 46px
        rgba(0, 0, 0, 0.34);
}


body.dark-mode
.attachment-popup-item {
    color:
        rgba(255, 255, 255, 0.94);
}


body.dark-mode
.attachment-popup-item:hover {
    background:
        rgba(255, 255, 255, 0.07);
}


body.dark-mode
#glassInputContainer
.attachment-preview-card {
    border-color:
        rgba(255, 255, 255, 0.08) !important;

    background:
        rgba(255, 255, 255, 0.045) !important;
}


body.dark-mode
#glassInputContainer
.attachment-preview-card
.attachment-preview-file {
    background:
        rgba(255, 255, 255, 0.035);

    color:
        rgba(255, 255, 255, 0.92);
}


/* =========================================================
   19. MOBILE
   ========================================================= */

@media (max-width: 767px) {

    #composerWrapper {
        --attachment-preview-height: 70px;
        --attachment-card-width: 118px;
        --attachment-card-height: 60px;
        --attachment-card-radius: 11px;
        --attachment-gap: 6px;
    }


    #glassInputContainer
    #attachedChipsWrapper:not(:empty) {
        padding:
            6px
            8px
            4px !important;
    }


    #glassInputContainer:has(
        #attachedChipsWrapper:not(:empty)
    ):not(.is-writing-expanded) {
        min-height:
            calc(
                var(--attachment-preview-height) +
                var(--neyo-pill-height, 54px)
            ) !important;
    }


    #glassInputContainer:has(
        #attachedChipsWrapper:not(:empty)
    ):not(.is-writing-expanded)
    .composer-input-row {
        height:
            var(--neyo-pill-height, 54px) !important;

        min-height:
            var(--neyo-pill-height, 54px) !important;

        max-height:
            var(--neyo-pill-height, 54px) !important;
    }


    #glassInputContainer:has(
        #attachedChipsWrapper:not(:empty)
    ):not(.is-writing-expanded):not(.composer-multiline)
    textarea#chatInput {
        height:
            var(--neyo-control-size, 38px) !important;

        min-height:
            var(--neyo-control-size, 38px) !important;

        max-height:
            var(--neyo-control-size, 38px) !important;

        padding:
            7px
            var(--neyo-oneline-right, 90px)
            7px
            var(--neyo-oneline-left, 52px) !important;

        line-height: 24px !important;
    }


    .attachment-popup-menu {
        min-width: 160px;

        bottom:
            calc(100% + 10px);

        padding:
            6px
            4px;
    }


    .attachment-popup-item {
        gap: 10px;

        padding:
            9px
            12px;

        font-size: 13px;
    }


    .drag-drop-overlay {
        gap: 6px;
    }


    .drag-drop-overlay > svg,
    .drag-drop-overlay > i {
        width: 24px;
        height: 24px;

        flex-basis: 24px;
    }


    .drag-drop-overlay > span {
        font-size: 13px;
    }
}


/* =========================================================
   20. SMALL MOBILE
   ========================================================= */

@media (max-width: 380px) {

    #composerWrapper {
        --attachment-card-width: 108px;
        --attachment-gap: 5px;
    }


    #glassInputContainer
    #attachedChipsWrapper:not(:empty) {
        padding-left: 6px !important;
        padding-right: 6px !important;
    }
}


/* =========================================================
   21. TOUCH
   ========================================================= */

@media (pointer: coarse) {

    .attachment-popup-item,
    .attachment-remove-btn {
        touch-action:
            manipulation;

        -webkit-tap-highlight-color:
            transparent;
    }
}


/* =========================================================
   22. REDUCED MOTION
   ========================================================= */

@media (prefers-reduced-motion: reduce) {

    .attachment-popup-item,
    .attachment-remove-btn,
    .drag-drop-overlay {
        transition:
            none !important;
    }
}
