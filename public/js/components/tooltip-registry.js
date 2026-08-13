/*
=========================================================
NEYO — TOOLTIP REGISTRY
Adds missing tooltips to static + dynamically created UI.
Does NOT modify neo.js.
=========================================================
*/

(() => {
    "use strict";

    const registry = [
        // Chat — assistant actions
        [".copy-msg-btn", "Copy response", "top"],
        [".share-msg-btn", "Share response", "top"],
        [".regen-msg-btn", "Regenerate response", "top"],

        // Chat — user actions
        [".user-edit-btn", "Edit message", "top"],
        [".user-copy-btn", "Copy message", "top"],

        // Message edit state
        [".edit-btn-cancel", "Cancel editing", "top"],
        [".edit-btn-save", "Save and submit", "top"],

        // History
        [".history-three-dot", "Conversation options", "left"],

        // Attachments
        [".attachment-remove-btn", "Remove attachment", "top"],

        // Toast / notification
        [".neo-toast-close", "Close notification", "left"],

        // Main UI
        ["#brandBtn", "NEYO home", "right"],
        ["#collapseSidebarBtn", "Close sidebar", "right"],
        ["#newChatBtn", "New conversation", "right"],
        ["#sidebarPersonalitiesBtn", "NEYO Personalities", "right"],
        ["#settingsBtn", "Settings", "right"],
        ["#sidebarDarkModeToggle", "Appearance", "right"],
        ["#logoutBtn", "Log out", "right"],
        ["#userProfileBtn", "Account", "right"],

        // Topbar
        ["#sidebarToggleBtn", "Toggle sidebar", "right"],
        ["#modelBadgeBtn", "Choose model", "bottom"],
        ["#topBarDarkModeToggle", "Change theme", "bottom"],

        // Composer
        ["#composerExpandBtn", "Expand composer", "top"],
        ["#attachBtn", "Attach files", "top"],
        ["#micBtn", "Voice input", "top"],
        ["#stopRecBtn", "Stop listening", "top"],
        ["#sendBtn", "Send message", "top"],

        // Attachment popup
        ["#addFilesMenuBtn", "Add files", "right"],
        ["#deepResearchToggleBtn", "Deep Research", "right"],
        ["#personalMemoryBtn", "NEYO Personalities", "right"],

        // History popup
        ["#hpShareBtn", "Share conversation", "left"],
        ["#hpPinBtn", "Pin conversation", "left"],
        ["#hpRenameBtn", "Rename conversation", "left"],
        ["#hpDeleteBtn", "Delete conversation", "left"],

        // Settings
        ["#neoSettingsCloseBtn", "Close settings", "right"],
        ["#chooseAvatarBtn", "Change profile photo", "top"],
        ["#removeAvatarBtn", "Remove profile photo", "top"],
        ["#saveProfileSettingsBtn", "Save profile", "top"],
        ["#resetProfileSettingsBtn", "Cancel changes", "top"],
        ["#settingsUpgradeBtn", "Upgrade to Pro", "top"],

        // Upgrade modal
        ["#modalCloseBtn", "Close", "left"],
        ["#upgradeActionBtn", "Upgrade to Pro", "top"],
        ["#modalMaybeLaterBtn", "Maybe later", "top"]
    ];


    function applyTooltip(element, text, position = "top") {
        if (!element) return;

        element.dataset.tooltip = text;
        element.dataset.tooltipPosition = position;

        if (!element.getAttribute("aria-label")) {
            const hasVisibleText =
                (element.textContent || "").trim().length > 0;

            if (!hasVisibleText) {
                element.setAttribute("aria-label", text);
            }
        }
    }


    function scan(root = document) {
        registry.forEach(([selector, text, position]) => {
            if (
                root instanceof Element &&
                root.matches(selector)
            ) {
                applyTooltip(root, text, position);
            }

            root.querySelectorAll?.(selector).forEach(element => {
                applyTooltip(element, text, position);
            });
        });
    }


    // Initial page
    scan(document);


    // Dynamic chat messages, history items, notifications, attachments, etc.
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    scan(node);
                }
            });
        });
    });


    observer.observe(document.body, {
        childList: true,
        subtree: true
    });


    window.NeyoTooltipRegistry = Object.freeze({
        refresh: () => scan(document)
    });

})();
