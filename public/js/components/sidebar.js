/*
=========================================================
NEO — SIDEBAR
Production v1 — Old neo.js Exact Baseline

Old working behavior preserved:
- Desktop: sidebar open
- Mobile: sidebar collapsed
- Mobile scrim only when sidebar is open
- Topbar toggle toggles sidebar
- Internal collapse button toggles sidebar
- Scrim click toggles/closes sidebar
- body.sidebar-collapsed always synced
- Crossing 767px breakpoint reinitializes state
- New Chat closes mobile sidebar
- History conversation open closes mobile sidebar

Owns:
- Sidebar open / close / toggle
- Sidebar scrim
- body.sidebar-collapsed
- Responsive sidebar initialization
- Sidebar buttons

Does NOT own:
- New Chat logic
- History rendering
- Profile menu
- Topbar model menu
- Settings
=========================================================
*/

(() => {
    "use strict";

    const VERSION = "neo-sidebar-v1";

    if (
        window.NeyoSidebar?.__controller === true
    ) {
        return;
    }

    /* =====================================================
       DOM
       ===================================================== */

    const sidebar =
        document.getElementById("sidebar");

    const sidebarToggleBtn =
        document.getElementById(
            "sidebarToggleBtn"
        );

    const collapseSidebarBtn =
        document.getElementById(
            "collapseSidebarBtn"
        );

    const sidebarScrim =
        document.getElementById(
            "sidebarScrim"
        );

    if (!sidebar) {
        return;
    }

    /* =====================================================
       CONSTANTS
       ===================================================== */

    const MOBILE_QUERY =
        "(max-width: 767px)";

    /* =====================================================
       STATE
       ===================================================== */

    let lastResponsiveMode =
        window.matchMedia(
            MOBILE_QUERY
        ).matches;

    /* =====================================================
       HELPERS
       ===================================================== */

    const isMobile = () =>
        window.matchMedia(
            MOBILE_QUERY
        ).matches;

    const isCollapsed = () =>
        sidebar.classList.contains(
            "collapsed"
        );

    const isOpen = () =>
        !isCollapsed();

    /* =====================================================
       EVENTS
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

    /* =====================================================
       BODY STATE

       Exact old neo.js contract:
       body.sidebar-collapsed
       ===================================================== */

    const updateBodySidebarState = () => {
        const collapsed =
            sidebar.classList.contains(
                "collapsed"
            );

        document.body.classList.toggle(
            "sidebar-collapsed",
            Boolean(collapsed)
        );
    };

    /* =====================================================
       SCRIM

       Old neo.js:
       visible only on mobile when sidebar is open.
       ===================================================== */

    const syncScrim = () => {
        const visible =
            isMobile() &&
            isOpen();

        sidebarScrim?.classList.toggle(
            "visible",
            visible
        );

        /*
         * Compatibility for CSS builds that used .show.
         * Harmless if unused.
         */

        sidebarScrim?.classList.toggle(
            "show",
            visible
        );

        sidebarScrim?.setAttribute(
            "aria-hidden",
            String(!visible)
        );
    };

    /* =====================================================
       BUTTON ARIA
       ===================================================== */

    const syncButtons = () => {
        const open =
            isOpen();

        sidebarToggleBtn?.setAttribute(
            "aria-expanded",
            String(open)
        );

        sidebarToggleBtn?.setAttribute(
            "aria-label",
            open
                ? "Close sidebar"
                : "Open sidebar"
        );

        collapseSidebarBtn?.setAttribute(
            "aria-expanded",
            String(open)
        );

        collapseSidebarBtn?.setAttribute(
            "aria-label",
            "Collapse sidebar"
        );
    };

    /* =====================================================
       SYNC
       ===================================================== */

    const sync = (
        reason = "sync"
    ) => {
        updateBodySidebarState();
        syncScrim();
        syncButtons();

        emit(
            "neyo:sidebar-state",
            {
                version:
                    VERSION,

                reason,

                mobile:
                    isMobile(),

                collapsed:
                    isCollapsed(),

                open:
                    isOpen()
            }
        );
    };

    /* =====================================================
       OPEN
       ===================================================== */

    const openSidebar = (
        reason = "open"
    ) => {
        sidebar.classList.remove(
            "collapsed"
        );

        sync(reason);

        emit(
            "neyo:sidebar-open",
            {
                reason
            }
        );

        return true;
    };

    /* =====================================================
       CLOSE
       ===================================================== */

    const closeSidebar = (
        reason = "close"
    ) => {
        sidebar.classList.add(
            "collapsed"
        );

        /*
         * Old neo.js explicitly removed mobile scrim.
         */

        sidebarScrim?.classList.remove(
            "visible",
            "show"
        );

        sync(reason);

        emit(
            "neyo:sidebar-close",
            {
                reason
            }
        );

        return true;
    };

    /* =====================================================
       TOGGLE

       Exact old behavior:
       sidebar.classList.toggle("collapsed")
       ===================================================== */

    const toggleSidebar = (
        reason = "toggle"
    ) => {
        sidebar.classList.toggle(
            "collapsed"
        );

        sync(reason);

        emit(
            isOpen()
                ? "neyo:sidebar-open"
                : "neyo:sidebar-close",
            {
                reason
            }
        );

        return true;
    };

    /* =====================================================
       INITIALIZE

       Exact OLD WORKING neo.js:

       Mobile:
       - body collapsed
       - sidebar collapsed
       - scrim hidden

       Desktop:
       - body open
       - sidebar open
       - scrim hidden

       No desktop persistence.
       ===================================================== */

    const initializeSidebarState = (
        reason = "initialize"
    ) => {
        const mobile =
            isMobile();

        if (mobile) {
            document.body.classList.add(
                "sidebar-collapsed"
            );

            sidebar.classList.add(
                "collapsed"
            );

            sidebarScrim?.classList.remove(
                "visible",
                "show"
            );
        } else {
            document.body.classList.remove(
                "sidebar-collapsed"
            );

            sidebar.classList.remove(
                "collapsed"
            );

            sidebarScrim?.classList.remove(
                "visible",
                "show"
            );
        }

        updateBodySidebarState();
        syncScrim();
        syncButtons();

        emit(
            "neyo:sidebar-state",
            {
                version:
                    VERSION,

                reason,

                mobile,

                collapsed:
                    isCollapsed(),

                open:
                    isOpen()
            }
        );

        return true;
    };

    /* =====================================================
       BUTTON OWNERSHIP

       neo.js abhi physically loaded hai.
       Capture phase prevents old neo.js from toggling again.
       ===================================================== */

    sidebarToggleBtn?.addEventListener(
        "click",
        event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            toggleSidebar(
                "topbar-toggle"
            );
        },
        true
    );

    collapseSidebarBtn?.addEventListener(
        "click",
        event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            toggleSidebar(
                "collapse-button"
            );
        },
        true
    );

    /* =====================================================
       SCRIM

       Old neo.js used toggleSidebar().
       In mobile open state this effectively closes it.
       ===================================================== */

    sidebarScrim?.addEventListener(
        "click",
        event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            if (
                isMobile() &&
                isOpen()
            ) {
                closeSidebar(
                    "scrim"
                );
            } else {
                syncScrim();
            }
        },
        true
    );

    /* =====================================================
       NEW CHAT

       Old neo.js:
       New Chat on mobile collapses sidebar.
       We listen to canonical event instead of owning button.
       ===================================================== */

    window.addEventListener(
        "neyo:chat-new",
        () => {
            if (!isMobile()) {
                return;
            }

            closeSidebar(
                "new-chat"
            );
        }
    );

    /* =====================================================
       HISTORY OPEN

       Preserve mobile drawer UX.
       ===================================================== */

    window.addEventListener(
        "neyo:history-opened",
        () => {
            if (!isMobile()) {
                return;
            }

            closeSidebar(
                "history-opened"
            );
        }
    );

    /* =====================================================
       REQUEST EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:sidebar-open-request",
        () => {
            openSidebar(
                "external-open"
            );
        }
    );

    window.addEventListener(
        "neyo:sidebar-close-request",
        () => {
            closeSidebar(
                "external-close"
            );
        }
    );

    window.addEventListener(
        "neyo:sidebar-collapse-request",
        () => {
            closeSidebar(
                "external-collapse"
            );
        }
    );

    window.addEventListener(
        "neyo:sidebar-toggle-request",
        () => {
            toggleSidebar(
                "external-toggle"
            );
        }
    );

    /* =====================================================
       RESPONSIVE

       Exact old neo.js behavior:
       only reinitialize when crossing mobile/desktop mode.
       ===================================================== */

    const handleResize = () => {
        const mobile =
            isMobile();

        if (
            mobile ===
            lastResponsiveMode
        ) {
            return;
        }

        lastResponsiveMode =
            mobile;

        initializeSidebarState(
            "responsive-change"
        );
    };

    window.addEventListener(
        "resize",
        handleResize,
        {
            passive: true
        }
    );

    /* =====================================================
       ESCAPE — MOBILE ONLY

       Safe improvement.
       Does not change desktop old behavior.
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {
            if (
                event.key !== "Escape" ||
                !isMobile() ||
                isCollapsed()
            ) {
                return;
            }

            const target =
                event.target;

            if (
                target instanceof Element &&
                target.closest(
                    [
                        "[role='dialog']",
                        ".modal",
                        ".history-dialog"
                    ].join(",")
                )
            ) {
                return;
            }

            event.preventDefault();

            closeSidebar(
                "escape"
            );

            requestAnimationFrame(
                () => {
                    sidebarToggleBtn
                        ?.focus?.();
                }
            );
        },
        true
    );

    /* =====================================================
       PUBLIC API
       ===================================================== */

    const api =
        Object.freeze({
            __controller:
                true,

            version:
                VERSION,

            active:
                true,

            open:
                openSidebar,

            close:
                closeSidebar,

            collapse:
                closeSidebar,

            toggle:
                toggleSidebar,

            initialize:
                initializeSidebarState,

            refresh() {
                sync(
                    "manual-refresh"
                );

                return true;
            },

            isOpen,

            isCollapsed,

            isMobile,

            getState() {
                return {
                    version:
                        VERSION,

                    active:
                        true,

                    mobile:
                        isMobile(),

                    collapsed:
                        isCollapsed(),

                    open:
                        isOpen(),

                    bodyCollapsed:
                        document.body
                            .classList
                            .contains(
                                "sidebar-collapsed"
                            ),

                    scrimVisible:
                        Boolean(
                            sidebarScrim &&
                            (
                                sidebarScrim.classList
                                    .contains(
                                        "visible"
                                    ) ||
                                sidebarScrim.classList
                                    .contains(
                                        "show"
                                    )
                            )
                        )
                };
            }
        });

    Object.defineProperty(
        window,
        "NeyoSidebar",
        {
            value:
                api,

            writable:
                false,

            configurable:
                true,

            enumerable:
                true
        }
    );

    /* =====================================================
       INIT
       ===================================================== */

    initializeSidebarState();

    emit(
        "neyo:sidebar-ready",
        {
            version:
                VERSION,

            baseline:
                "old-neo.js",

            mobile:
                isMobile(),

            collapsed:
                isCollapsed()
        }
    );
})();
