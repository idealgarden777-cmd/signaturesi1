/*
=========================================================
NEYO — CORE DOM
Production v1

Purpose:
- Central DOM lookup layer for NEYO
- Preserve Legend NEYO DOM contracts
- Preserve Current New NEYO DOM contracts
- Safe old/new compatibility aliases
- Detect missing/duplicate critical IDs
- No UI behavior
- No event ownership
- No API ownership
- No state ownership

Public:
window.NeyoDOM

Examples:

const sidebar = NeyoDOM.get("sidebar");

const {
    chatInput,
    sendBtn
} = NeyoDOM.refs();

NeyoDOM.q(".message");

NeyoDOM.qa(".history-item");

NeyoDOM.require("chatInput");

=========================================================
*/

(() => {
    "use strict";

    const VERSION =
        "neyo-core-dom-production-v1";

    /* =====================================================
       SINGLETON GUARD
       ===================================================== */

    if (
        window.NeyoDOM
            ?.__controller === true
    ) {
        return;
    }

    /* =====================================================
       EVENTS
       ===================================================== */

    function emit(
        name,
        detail = {}
    ) {
        const events =
            window.NeyoEvents;

        if (
            events
                ?.__controller === true &&
            typeof events.emit ===
                "function"
        ) {
            events.emit(
                name,
                detail
            );

            return;
        }

        window.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail
                }
            )
        );
    }

    /* =====================================================
       DOM CONTRACT

       Old Legend NEYO + Current New NEYO.

       Values are actual DOM IDs.

       Important:
       This registry does NOT create missing elements.
       ===================================================== */

    const IDS =
        Object.freeze({

            /* =================================================
               SIDEBAR
               ================================================= */

            sidebarScrim:
                "sidebarScrim",

            sidebar:
                "sidebar",

            brandBtn:
                "brandBtn",

            collapseSidebarBtn:
                "collapseSidebarBtn",

            newChatBtn:
                "newChatBtn",

            sidebarPersonalitiesBtn:
                "sidebarPersonalitiesBtn",

            historyList:
                "historyList",

            /* =================================================
               USER / ACCOUNT
               ================================================= */

            userPopupMenu:
                "userPopupMenu",

            settingsBtn:
                "settingsBtn",

            sidebarDarkModeToggle:
                "sidebarDarkModeToggle",

            logoutBtn:
                "logoutBtn",

            userProfileBtn:
                "userProfileBtn",

            userAvatar:
                "userAvatar",

            userNameDisplay:
                "userNameDisplay",

            userPlanBadge:
                "userPlanBadge",

            /* =================================================
               TOPBAR
               ================================================= */

            sidebarToggleBtn:
                "sidebarToggleBtn",

            modelBadgeBtn:
                "modelBadgeBtn",

            currentModelDisplay:
                "currentModelDisplay",

            modelDropdownMenu:
                "modelDropdownMenu",

            optL10:
                "optL10",

            optL12:
                "optL12",

            topBarDarkModeToggle:
                "topBarDarkModeToggle",

            /* =================================================
               CHAT SHELL
               ================================================= */

            scrollArea:
                "scrollArea",

            heroSection:
                "heroSection",

            chatMessages:
                "chatMessages",

            composerWrapper:
                "composerWrapper",

            glassInputContainer:
                "glassInputContainer",

            dragDropOverlay:
                "dragDropOverlay",

            liveSuggestions:
                "liveSuggestions",

            /* =================================================
               COMPOSER
               ================================================= */

            composerExpandBtn:
                "composerExpandBtn",

            attachBtn:
                "attachBtn",

            chatInput:
                "chatInput",

            sendBtn:
                "sendBtn",

            deepResearchToggleBtn:
                "deepResearchToggleBtn",

            personalMemoryBtn:
                "personalMemoryBtn",

            /* =================================================
               ATTACHMENTS
               ================================================= */

            attachPopupMenu:
                "attachPopupMenu",

            addFilesMenuBtn:
                "addFilesMenuBtn",

            hiddenFileInput:
                "hiddenFileInput",

            attachedChipsWrapper:
                "attachedChipsWrapper",

            attachmentList:
                "attachmentList",

            /* =================================================
               LEGACY VOICE / DICTATION
               ================================================= */

            voiceTranscribeContainer:
                "voiceTranscribeContainer",

            waveDotsBar:
                "waveDotsBar",

            stopRecBtn:
                "stopRecBtn",

            micBtn:
                "micBtn",

            /* =================================================
               HISTORY MENU
               ================================================= */

            historyPopupMenu:
                "historyPopupMenu",

            hpShareBtn:
                "hpShareBtn",

            hpPinBtn:
                "hpPinBtn",

            hpPinLabel:
                "hpPinLabel",

            hpRenameBtn:
                "hpRenameBtn",

            hpDeleteBtn:
                "hpDeleteBtn",

            /* =================================================
               SETTINGS ROOT
               ================================================= */

            neoSettingsOverlay:
                "neoSettingsOverlay",

            neoSettingsCloseBtn:
                "neoSettingsCloseBtn",

            settingsModal:
                "settingsModal",

            settingsCloseBtn:
                "settingsCloseBtn",

            /* =================================================
               SETTINGS — GENERAL
               ================================================= */

            settingsPanelGeneral:
                "settingsPanelGeneral",

            settingsThemeControl:
                "settingsThemeControl",

            settingsIntelligenceControl:
                "settingsIntelligenceControl",

            settingsPrivateChatToggle:
                "settingsPrivateChatToggle",

            settingsInterfaceControl:
                "settingsInterfaceControl",

            settingsLanguageBtn:
                "settingsLanguageBtn",

            settingsLanguageValue:
                "settingsLanguageValue",

            settingsLanguageMenu:
                "settingsLanguageMenu",

            settingsDefaultPersonalityBtn:
                "settingsDefaultPersonalityBtn",

            settingsDefaultPersonalityValue:
                "settingsDefaultPersonalityValue",

            settingsDefaultPersonalityMenu:
                "settingsDefaultPersonalityMenu",

            settingsOpenOnBtn:
                "settingsOpenOnBtn",

            settingsOpenOnValue:
                "settingsOpenOnValue",

            settingsOpenOnMenu:
                "settingsOpenOnMenu",

            settingsAutoSaveToggle:
                "settingsAutoSaveToggle",

            /* =================================================
               SETTINGS — PROFILE
               ================================================= */

            settingsPanelProfile:
                "settingsPanelProfile",

            settingsAvatarPreview:
                "settingsAvatarPreview",

            chooseAvatarBtn:
                "chooseAvatarBtn",

            removeAvatarBtn:
                "removeAvatarBtn",

            settingsAvatarFileInput:
                "settingsAvatarFileInput",

            settingsDisplayNameInput:
                "settingsDisplayNameInput",

            settingsUsernameInput:
                "settingsUsernameInput",

            saveProfileSettingsBtn:
                "saveProfileSettingsBtn",

            resetProfileSettingsBtn:
                "resetProfileSettingsBtn",

            settingsProfileCancelBtn:
                "settingsProfileCancelBtn",

            settingsProfileSaveBtn:
                "settingsProfileSaveBtn",

            settingsProfileName:
                "settingsProfileName",

            settingsProfileEmail:
                "settingsProfileEmail",

            settingsProfilePlan:
                "settingsProfilePlan",

            /* =================================================
               SETTINGS — OTHER PANELS
               ================================================= */

            settingsPanelNotifications:
                "settingsPanelNotifications",

            notificationCenter:
                "notificationCenter",

            settingsPanelPersonalities:
                "settingsPanelPersonalities",

            personalityGrid:
                "personalityGrid",

            settingsPanelBilling:
                "settingsPanelBilling",

            billingPlanText:
                "billingPlanText",

            settingsUpgradeBtn:
                "settingsUpgradeBtn",

            settingsPanelAppearance:
                "settingsPanelAppearance",

            appearancePreview:
                "appearancePreview",

            appearanceInterfaceControl:
                "appearanceInterfaceControl",

            appearanceThemeControl:
                "appearanceThemeControl",

            appearanceAccentControl:
                "appearanceAccentControl",

            appearanceTextSizeControl:
                "appearanceTextSizeControl",

            appearanceContentWidthControl:
                "appearanceContentWidthControl",

            appearanceSidebarDensityControl:
                "appearanceSidebarDensityControl",

            appearanceMotionControl:
                "appearanceMotionControl",

            settingsPanelWorkspace:
                "settingsPanelWorkspace",

            settingsPanelPrivacy:
                "settingsPanelPrivacy",

            settingsPanelMemory:
                "settingsPanelMemory",

            settingsPanelFiles:
                "settingsPanelFiles",

            settingsPanelAccessibility:
                "settingsPanelAccessibility",

            settingsPanelKeyboard:
                "settingsPanelKeyboard",

            settingsPanelAbout:
                "settingsPanelAbout",

            /* =================================================
               PERSONALITY MODAL
               ================================================= */

            personalityModal:
                "personalityModal",

            personalityModalCloseBtn:
                "personalityModalCloseBtn",

            /* =================================================
               UPGRADE
               ================================================= */

            upgradeModal:
                "upgradeModal",

            modalCloseBtn:
                "modalCloseBtn",

            upgradeActionBtn:
                "upgradeActionBtn",

            modalMaybeLaterBtn:
                "modalMaybeLaterBtn",

            /* =================================================
               NEW VOICE MODE
               ================================================= */

            neyoVoiceMode:
                "neyoVoiceMode",

            neyoMascot:
                "neyoMascot",

            neyoMascotLeftEye:
                "neyoMascotLeftEye",

            neyoMascotRightEye:
                "neyoMascotRightEye",

            neyoMascotMouth:
                "neyoMascotMouth",

            neyoCameraPreview:
                "neyoCameraPreview",

            neyoCameraVideo:
                "neyoCameraVideo",

            neyoMascotStatus:
                "neyoMascotStatus",

            voiceModeMicBtn:
                "voiceModeMicBtn",

            voiceModeCameraBtn:
                "voiceModeCameraBtn",

            voiceModeSpeakerBtn:
                "voiceModeSpeakerBtn",

            voiceModeEndBtn:
                "voiceModeEndBtn",

            /* =================================================
               CHARACTER PICKER
               ================================================= */

            characterPickerBtn:
                "characterPickerBtn",

            characterPicker:
                "characterPicker",

            characterPickerTitle:
                "characterPickerTitle",

            characterPickerCloseBtn:
                "characterPickerCloseBtn",

            characterPickerList:
                "characterPickerList"
        });

    /* =====================================================
       CRITICAL DOM

       Missing critical elements indicate that index.html and
       runtime are no longer using the same shell contract.

       We report these; we do NOT create replacements.
       ===================================================== */

    const CRITICAL =
        Object.freeze([
            "sidebar",
            "sidebarScrim",
            "collapseSidebarBtn",
            "sidebarToggleBtn",
            "newChatBtn",
            "historyList",
            "scrollArea",
            "heroSection",
            "chatMessages",
            "composerWrapper",
            "glassInputContainer",
            "chatInput",
            "attachBtn",
            "sendBtn",
            "userProfileBtn"
        ]);

    /* =====================================================
       COMPATIBILITY ALIASES

       Current new build moved some contracts while Legend
       build used older names.

       Alias means:
       "Use first element that actually exists."

       We do NOT mutate IDs.
       ===================================================== */

    const ALIASES =
        Object.freeze({

            /*
             * Legend:
             * #attachedChipsWrapper

             * New experimental build:
             * #attachmentList
             */

            attachmentContainer:
                Object.freeze([
                    "attachedChipsWrapper",
                    "attachmentList"
                ]),

            /*
             * Legend settings shell.
             */

            settingsOverlay:
                Object.freeze([
                    "neoSettingsOverlay",
                    "settingsModal"
                ]),

            settingsClose:
                Object.freeze([
                    "neoSettingsCloseBtn",
                    "settingsCloseBtn"
                ]),

            /*
             * Profile save/cancel naming changed between
             * shell revisions.
             */

            profileSaveBtn:
                Object.freeze([
                    "saveProfileSettingsBtn",
                    "settingsProfileSaveBtn"
                ]),

            profileCancelBtn:
                Object.freeze([
                    "resetProfileSettingsBtn",
                    "settingsProfileCancelBtn"
                ])
        });

    /* =====================================================
       CACHE

       Cache is intentionally weak/simple.

       refresh() clears references when shell is replaced.
       ===================================================== */

    const cache =
        new Map();

    /* =====================================================
       BASIC LOOKUP
       ===================================================== */

    function byId(
        id
    ) {
        const value =
            String(
                id ?? ""
            )
                .trim();

        if (!value) {
            return null;
        }

        return document
            .getElementById(
                value
            );
    }

    /* =====================================================
       GET

       NeyoDOM.get("chatInput")
       NeyoDOM.get("customActualId")
       ===================================================== */

    function get(
        key,
        options = {}
    ) {
        const name =
            String(
                key ?? ""
            )
                .trim();

        if (!name) {
            return null;
        }

        const cacheKey =
            `id:${name}`;

        if (
            options.fresh !==
                true &&
            cache.has(
                cacheKey
            )
        ) {
            const cached =
                cache.get(
                    cacheKey
                );

            /*
             * Never return detached stale elements.
             */

            if (
                cached === null ||
                cached.isConnected
            ) {
                return cached;
            }

            cache.delete(
                cacheKey
            );
        }

        const id =
            IDS[name] ||
            name;

        const element =
            byId(
                id
            );

        if (
            options.cache !==
                false
        ) {
            cache.set(
                cacheKey,
                element
            );
        }

        return element;
    }

    /* =====================================================
       REQUIRE

       Does not invent/create missing DOM.
       ===================================================== */

    function requireElement(
        key
    ) {
        const element =
            get(
                key,
                {
                    fresh:
                        true
                }
            );

        if (element) {
            return element;
        }

        const id =
            IDS[key] ||
            key;

        throw new Error(
            `[NEYO DOM] Required element "#${id}" is missing.`
        );
    }

    /* =====================================================
       OPTIONAL
       ===================================================== */

    function optional(
        key
    ) {
        return get(
            key
        );
    }

    /* =====================================================
       ALIAS LOOKUP
       ===================================================== */

    function alias(
        name
    ) {
        const keys =
            ALIASES[name];

        if (!keys) {
            return null;
        }

        for (
            const key
            of keys
        ) {
            const element =
                get(
                    key,
                    {
                        fresh:
                            true
                    }
                );

            if (element) {
                return element;
            }
        }

        return null;
    }

    /* =====================================================
       QUERY SELECTOR
       ===================================================== */

    function q(
        selector,
        root = document
    ) {
        if (
            !root ||
            typeof root
                .querySelector !==
                "function"
        ) {
            return null;
        }

        const value =
            String(
                selector ?? ""
            )
                .trim();

        if (!value) {
            return null;
        }

        try {
            return root
                .querySelector(
                    value
                );
        } catch {
            return null;
        }
    }

    /* =====================================================
       QUERY SELECTOR ALL

       Returns Array instead of NodeList.
       ===================================================== */

    function qa(
        selector,
        root = document
    ) {
        if (
            !root ||
            typeof root
                .querySelectorAll !==
                "function"
        ) {
            return [];
        }

        const value =
            String(
                selector ?? ""
            )
                .trim();

        if (!value) {
            return [];
        }

        try {
            return Array.from(
                root.querySelectorAll(
                    value
                )
            );
        } catch {
            return [];
        }
    }

    /* =====================================================
       CLOSEST
       ===================================================== */

    function closest(
        target,
        selector
    ) {
        if (
            !target ||
            typeof target
                .closest !==
                "function"
        ) {
            return null;
        }

        try {
            return target.closest(
                selector
            );
        } catch {
            return null;
        }
    }

    /* =====================================================
       MATCHES
       ===================================================== */

    function matches(
        target,
        selector
    ) {
        if (
            !target ||
            typeof target
                .matches !==
                "function"
        ) {
            return false;
        }

        try {
            return target.matches(
                selector
            );
        } catch {
            return false;
        }
    }

    /* =====================================================
       CONTAINS
       ===================================================== */

    function contains(
        parent,
        child
    ) {
        if (
            !parent ||
            !child ||
            typeof parent
                .contains !==
                "function"
        ) {
            return false;
        }

        try {
            return parent.contains(
                child
            );
        } catch {
            return false;
        }
    }

    /* =====================================================
       VISIBLE
       ===================================================== */

    function isVisible(
        element
    ) {
        if (
            !element ||
            !element.isConnected
        ) {
            return false;
        }

        if (
            element.hidden ||
            element.getAttribute(
                "aria-hidden"
            ) === "true"
        ) {
            return false;
        }

        const style =
            window
                .getComputedStyle(
                    element
                );

        if (
            style.display ===
                "none" ||
            style.visibility ===
                "hidden" ||
            Number(
                style.opacity
            ) === 0
        ) {
            return false;
        }

        const rect =
            element
                .getBoundingClientRect();

        return (
            rect.width > 0 ||
            rect.height > 0
        );
    }

    /* =====================================================
       FOCUSABLE
       ===================================================== */

    function isFocusable(
        element
    ) {
        if (
            !element ||
            !(element instanceof
                HTMLElement) ||
            element.hidden ||
            element.hasAttribute(
                "disabled"
            ) ||
            element.getAttribute(
                "aria-hidden"
            ) === "true"
        ) {
            return false;
        }

        const tabIndex =
            element.tabIndex;

        if (
            tabIndex >= 0
        ) {
            return true;
        }

        const tag =
            element.tagName
                .toLowerCase();

        if (
            [
                "button",
                "input",
                "select",
                "textarea"
            ].includes(
                tag
            )
        ) {
            return true;
        }

        if (
            tag === "a" &&
            element.hasAttribute(
                "href"
            )
        ) {
            return true;
        }

        return (
            element
                .getAttribute(
                    "contenteditable"
                ) === "true"
        );
    }

    /* =====================================================
       GET FOCUSABLES
       ===================================================== */

    function focusables(
        root = document
    ) {
        return qa(
            [
                "button:not([disabled])",
                "[href]",
                "input:not([disabled])",
                "select:not([disabled])",
                "textarea:not([disabled])",
                "[tabindex]:not([tabindex='-1'])",
                "[contenteditable='true']"
            ].join(","),
            root
        ).filter(
            isFocusable
        );
    }

    /* =====================================================
       SAFE FOCUS
       ===================================================== */

    function focus(
        target,
        options = {}
    ) {
        const element =
            typeof target ===
                "string"
                ? get(
                    target,
                    {
                        fresh:
                            true
                    }
                )
                : target;

        if (
            !element ||
            typeof element
                .focus !==
                "function"
        ) {
            return false;
        }

        try {
            element.focus({
                preventScroll:
                    options.preventScroll ??
                    true
            });

            return true;
        } catch {
            try {
                element.focus();

                return true;
            } catch {
                return false;
            }
        }
    }

    /* =====================================================
       SCROLL
       ===================================================== */

    function scrollIntoView(
        target,
        options = {}
    ) {
        const element =
            typeof target ===
                "string"
                ? get(
                    target,
                    {
                        fresh:
                            true
                    }
                )
                : target;

        if (
            !element ||
            typeof element
                .scrollIntoView !==
                "function"
        ) {
            return false;
        }

        try {
            element.scrollIntoView({
                behavior:
                    options.behavior ||
                    "auto",

                block:
                    options.block ||
                    "nearest",

                inline:
                    options.inline ||
                    "nearest"
            });

            return true;
        } catch {
            return false;
        }
    }

    /* =====================================================
       DATA ATTRIBUTE
       ===================================================== */

    function data(
        element,
        key,
        value
    ) {
        if (
            !element ||
            !element.dataset
        ) {
            return undefined;
        }

        const name =
            String(
                key ?? ""
            )
                .trim();

        if (!name) {
            return undefined;
        }

        if (
            arguments.length <
                3
        ) {
            return (
                element.dataset[
                    name
                ]
            );
        }

        if (
            value === null ||
            value === undefined
        ) {
            delete element
                .dataset[
                    name
                ];

            return undefined;
        }

        element.dataset[
            name
        ] =
            String(
                value
            );

        return (
            element.dataset[
                name
            ]
        );
    }

    /* =====================================================
       ARIA
       ===================================================== */

    function aria(
        element,
        name,
        value
    ) {
        if (
            !element ||
            typeof element
                .setAttribute !==
                "function"
        ) {
            return false;
        }

        const key =
            String(
                name ?? ""
            )
                .trim()
                .replace(
                    /^aria-/,
                    ""
                );

        if (!key) {
            return false;
        }

        const attribute =
            `aria-${key}`;

        if (
            value === null ||
            value === undefined
        ) {
            element
                .removeAttribute(
                    attribute
                );

            return true;
        }

        element.setAttribute(
            attribute,
            String(
                value
            )
        );

        return true;
    }

    /* =====================================================
       TEXT
       ===================================================== */

    function setText(
        element,
        value
    ) {
        if (!element) {
            return false;
        }

        element.textContent =
            String(
                value ?? ""
            );

        return true;
    }

    /* =====================================================
       SHOW / HIDE

       Generic helpers only.

       Feature modules decide WHICH classes/states they use.
       ===================================================== */

    function show(
        element
    ) {
        if (!element) {
            return false;
        }

        element.hidden =
            false;

        element.removeAttribute(
            "aria-hidden"
        );

        return true;
    }

    function hide(
        element
    ) {
        if (!element) {
            return false;
        }

        element.hidden =
            true;

        element.setAttribute(
            "aria-hidden",
            "true"
        );

        return true;
    }

    /* =====================================================
       TOGGLE CLASS
       ===================================================== */

    function toggleClass(
        element,
        className,
        force
    ) {
        if (
            !element ||
            !element.classList
        ) {
            return false;
        }

        const value =
            String(
                className ?? ""
            )
                .trim();

        if (!value) {
            return false;
        }

        if (
            force === undefined
        ) {
            return element
                .classList
                .toggle(
                    value
                );
        }

        element.classList
            .toggle(
                value,
                Boolean(
                    force
                )
            );

        return Boolean(
            force
        );
    }

    /* =====================================================
       REFS SNAPSHOT

       This returns known nodes at call time.

       We deliberately do not create one permanent static
       object because settings/modals can be replaced during
       migration.
       ===================================================== */

    function refs() {
        const result = {};

        for (
            const key
            of Object.keys(
                IDS
            )
        ) {
            result[key] =
                get(
                    key,
                    {
                        fresh:
                            true
                    }
                );
        }

        /*
         * Add semantic aliases.
         */

        result
            .attachmentContainer =
            alias(
                "attachmentContainer"
            );

        result
            .settingsOverlay =
            alias(
                "settingsOverlay"
            );

        result
            .settingsClose =
            alias(
                "settingsClose"
            );

        result
            .profileSaveBtn =
            alias(
                "profileSaveBtn"
            );

        result
            .profileCancelBtn =
            alias(
                "profileCancelBtn"
            );

        return result;
    }

    /* =====================================================
       REF PROXY

       NeyoDOM.ref.chatInput

       Always resolves current DOM instead of holding a stale
       element reference.
       ===================================================== */

    const refProxy =
        new Proxy(
            Object.create(
                null
            ),
            {
                get(
                    _target,
                    property
                ) {
                    if (
                        typeof property !==
                            "string"
                    ) {
                        return undefined;
                    }

                    if (
                        Object.prototype
                            .hasOwnProperty
                            .call(
                                ALIASES,
                                property
                            )
                    ) {
                        return alias(
                            property
                        );
                    }

                    return get(
                        property,
                        {
                            fresh:
                                true
                        }
                    );
                },

                has(
                    _target,
                    property
                ) {
                    if (
                        typeof property !==
                            "string"
                    ) {
                        return false;
                    }

                    return Boolean(
                        get(
                            property,
                            {
                                fresh:
                                    true
                            }
                        ) ||
                        alias(
                            property
                        )
                    );
                }
            }
        );

    /* =====================================================
       CACHE REFRESH
       ===================================================== */

    function refresh() {
        cache.clear();

        emit(
            "neyo:dom-refresh",
            {
                version:
                    VERSION
            }
        );

        return refs();
    }

    /* =====================================================
       DUPLICATE ID AUDIT

       Duplicate IDs caused some of the previous NEYO
       ownership/debugging confusion.

       This NEVER changes the DOM.
       ===================================================== */

    function findDuplicateIds() {
        const map =
            new Map();

        const duplicates =
            [];

        for (
            const element
            of document
                .querySelectorAll(
                    "[id]"
                )
        ) {
            const id =
                element.id;

            if (!id) {
                continue;
            }

            if (
                !map.has(
                    id
                )
            ) {
                map.set(
                    id,
                    [
                        element
                    ]
                );

                continue;
            }

            map.get(
                id
            ).push(
                element
            );
        }

        for (
            const [
                id,
                elements
            ]
            of map
        ) {
            if (
                elements.length >
                1
            ) {
                duplicates.push({
                    id,

                    count:
                        elements.length,

                    elements
                });
            }
        }

        return duplicates;
    }

    /* =====================================================
       MISSING CRITICAL AUDIT
       ===================================================== */

    function findMissingCritical() {
        return CRITICAL
            .filter(
                key =>
                    !get(
                        key,
                        {
                            fresh:
                                true
                        }
                    )
            )
            .map(
                key => ({
                    key,

                    id:
                        IDS[key] ||
                        key
                })
            );
    }

    /* =====================================================
       FULL AUDIT
       ===================================================== */

    function audit({
        log =
            false
    } = {}) {
        const missingCritical =
            findMissingCritical();

        const duplicates =
            findDuplicateIds();

        const present =
            [];

        const missing =
            [];

        for (
            const [
                key,
                id
            ]
            of Object.entries(
                IDS
            )
        ) {
            if (
                byId(
                    id
                )
            ) {
                present.push(
                    key
                );
            } else {
                missing.push(
                    key
                );
            }
        }

        const result = {
            version:
                VERSION,

            totalKnown:
                Object.keys(
                    IDS
                ).length,

            presentCount:
                present.length,

            missingCount:
                missing.length,

            present,

            missing,

            criticalMissing:
                missingCritical,

            duplicateIds:
                duplicates.map(
                    item => ({
                        id:
                            item.id,

                        count:
                            item.count
                    })
                ),

            healthy:
                (
                    missingCritical.length ===
                        0 &&
                    duplicates.length ===
                        0
                )
        };

        if (log) {
            if (
                result.healthy
            ) {
                console.info(
                    "[NEYO DOM] Audit passed.",
                    result
                );
            } else {
                console.warn(
                    "[NEYO DOM] Audit found issues.",
                    result
                );
            }
        }

        return result;
    }

    /* =====================================================
       DOM READY
       ===================================================== */

    function ready(
        callback
    ) {
        if (
            typeof callback !==
                "function"
        ) {
            return Promise.resolve();
        }

        if (
            document.readyState !==
                "loading"
        ) {
            try {
                return Promise.resolve(
                    callback()
                );
            } catch (error) {
                return Promise.reject(
                    error
                );
            }
        }

        return new Promise(
            (
                resolve,
                reject
            ) => {
                document
                    .addEventListener(
                        "DOMContentLoaded",
                        () => {
                            try {
                                resolve(
                                    callback()
                                );
                            } catch (
                                error
                            ) {
                                reject(
                                    error
                                );
                            }
                        },
                        {
                            once:
                                true
                        }
                    );
            }
        );
    }

    /* =====================================================
       WAIT FOR ELEMENT

       Useful for lazy UI modules without MutationObserver
       running forever.

       Polling is bounded and only starts when explicitly
       requested.
       ===================================================== */

    function waitFor(
        target,
        options = {}
    ) {
        const timeout =
            Number.isFinite(
                Number(
                    options.timeout
                )
            )
                ? Math.max(
                    0,
                    Number(
                        options.timeout
                    )
                )
                : 3000;

        const interval =
            Number.isFinite(
                Number(
                    options.interval
                )
            )
                ? Math.max(
                    16,
                    Number(
                        options.interval
                    )
                )
                : 50;

        const started =
            Date.now();

        const lookup =
            () => {
                if (
                    typeof target ===
                        "string"
                ) {
                    /*
                     * If target matches a known registry key,
                     * resolve by ID. Otherwise treat as selector.
                     */

                    if (
                        Object.prototype
                            .hasOwnProperty
                            .call(
                                IDS,
                                target
                            )
                    ) {
                        return get(
                            target,
                            {
                                fresh:
                                    true
                            }
                        );
                    }

                    if (
                        Object.prototype
                            .hasOwnProperty
                            .call(
                                ALIASES,
                                target
                            )
                    ) {
                        return alias(
                            target
                        );
                    }

                    return q(
                        target
                    );
                }

                return (
                    target &&
                    target.isConnected
                        ? target
                        : null
                );
            };

        const immediate =
            lookup();

        if (immediate) {
            return Promise.resolve(
                immediate
            );
        }

        return new Promise(
            (
                resolve,
                reject
            ) => {
                let timer =
                    null;

                const check =
                    () => {
                        const element =
                            lookup();

                        if (element) {
                            if (
                                timer !==
                                    null
                            ) {
                                clearTimeout(
                                    timer
                                );
                            }

                            resolve(
                                element
                            );

                            return;
                        }

                        if (
                            Date.now() -
                                started >=
                            timeout
                        ) {
                            reject(
                                new Error(
                                    `[NEYO DOM] Timed out waiting for "${String(target)}".`
                                )
                            );

                            return;
                        }

                        timer =
                            window.setTimeout(
                                check,
                                interval
                            );
                    };

                timer =
                    window.setTimeout(
                        check,
                        interval
                    );
            }
        );
    }

    /* =====================================================
       PUBLIC API
       ===================================================== */

    const api =
        Object.freeze({
            __controller:
                true,

            version:
                VERSION,

            ids:
                IDS,

            aliases:
                ALIASES,

            critical:
                CRITICAL,

            ref:
                refProxy,

            byId,

            get,

            optional,

            require:
                requireElement,

            alias,

            q,

            query:
                q,

            qa,

            queryAll:
                qa,

            closest,

            matches,

            contains,

            isVisible,

            isFocusable,

            focusables,

            focus,

            scrollIntoView,

            data,

            aria,

            setText,

            show,

            hide,

            toggleClass,

            refs,

            refresh,

            ready,

            waitFor,

            audit,

            findDuplicateIds,

            findMissingCritical,

            getState() {
                const auditResult =
                    audit();

                return {
                    version:
                        VERSION,

                    totalKnown:
                        auditResult
                            .totalKnown,

                    present:
                        auditResult
                            .presentCount,

                    missing:
                        auditResult
                            .missingCount,

                    criticalMissing:
                        auditResult
                            .criticalMissing
                            .length,

                    duplicateIds:
                        auditResult
                            .duplicateIds
                            .length,

                    healthy:
                        auditResult
                            .healthy
                };
            }
        });

    /* =====================================================
       GLOBAL
       ===================================================== */

    try {
        Object.defineProperty(
            window,
            "NeyoDOM",
            {
                value:
                    api,

                writable:
                    false,

                enumerable:
                    true,

                configurable:
                    true
            }
        );
    } catch {
        window.NeyoDOM =
            api;
    }

    /* =====================================================
       INITIAL AUDIT

       Only after DOM is ready.

       Missing OPTIONAL new/old IDs are normal during
       migration.

       We only warn for:
       - critical missing IDs
       - duplicate IDs
       ===================================================== */

    ready(
        () => {
            refresh();

            const result =
                audit();

            if (
                result
                    .criticalMissing
                    .length >
                    0
            ) {
                console.warn(
                    "[NEYO DOM] Critical shell elements missing:",
                    result
                        .criticalMissing
                );
            }

            if (
                result
                    .duplicateIds
                    .length >
                    0
            ) {
                console.error(
                    "[NEYO DOM] Duplicate IDs detected:",
                    result
                        .duplicateIds
                );
            }

            emit(
                "neyo:dom-ready",
                {
                    version:
                        VERSION,

                    healthy:
                        result
                            .healthy,

                    criticalMissing:
                        result
                            .criticalMissing,

                    duplicateIds:
                        result
                            .duplicateIds
                }
            );
        }
    );

})();
