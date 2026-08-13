/*
=========================================================
NEYO — SIDEBAR CORE COMPONENT

Owns:
- Sidebar open / close
- Mobile scrim
- Body collapsed state
- Responsive initialization

Does NOT own:
- New chat logic
- History rendering
- Personalities
- Settings
=========================================================
*/

(() => {
    "use strict";

    const sidebar = document.getElementById("sidebar");
    const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
    const collapseSidebarBtn = document.getElementById("collapseSidebarBtn");
    const sidebarScrim = document.getElementById("sidebarScrim");

    if (!sidebar) return;

    const MOBILE_QUERY = "(max-width: 767px)";

    const isMobile = () =>
        window.matchMedia(MOBILE_QUERY).matches;

    const updateBodyState = () => {
        const collapsed =
            sidebar.classList.contains("collapsed");

        document.body.classList.toggle(
            "sidebar-collapsed",
            collapsed
        );
    };

    const syncScrim = () => {
        const open =
            !sidebar.classList.contains("collapsed");

        sidebarScrim?.classList.toggle(
            "visible",
            isMobile() && open
        );
    };

    const openSidebar = () => {
        sidebar.classList.remove("collapsed");

        syncScrim();
        updateBodyState();

        window.dispatchEvent(
            new CustomEvent("neyo:sidebar-open")
        );
    };

    const closeSidebar = () => {
        sidebar.classList.add("collapsed");

        sidebarScrim?.classList.remove("visible");
        updateBodyState();

        window.dispatchEvent(
            new CustomEvent("neyo:sidebar-close")
        );
    };

    const toggleSidebar = () => {
        const collapsed =
            sidebar.classList.contains("collapsed");

        if (collapsed) {
            openSidebar();
        } else {
            closeSidebar();
        }
    };

    const initializeSidebar = () => {
        if (isMobile()) {
            closeSidebar();
        } else {
            openSidebar();
            sidebarScrim?.classList.remove("visible");
        }

        updateBodyState();
    };

    sidebarToggleBtn?.addEventListener(
        "click",
        toggleSidebar
    );

    collapseSidebarBtn?.addEventListener(
        "click",
        toggleSidebar
    );

    sidebarScrim?.addEventListener(
        "click",
        closeSidebar
    );

    window.addEventListener(
        "neyo:sidebar-open-request",
        openSidebar
    );

    window.addEventListener(
        "neyo:sidebar-close-request",
        closeSidebar
    );

    window.addEventListener(
        "neyo:sidebar-toggle-request",
        toggleSidebar
    );

    initializeSidebar();

})();
