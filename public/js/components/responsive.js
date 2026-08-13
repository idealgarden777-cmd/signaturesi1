/*
=========================================================
NEYO — RESPONSIVE STATE COMPONENT

Owns:
- Mobile / tablet / desktop detection
- Viewport size state
- Orientation state
- Breakpoint change events
- Public responsive API

Does NOT own:
- Sidebar UI
- Composer UI
- Modal layout
- CSS styling
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       BREAKPOINTS
       ===================================================== */

    const BREAKPOINTS =
        Object.freeze({
            mobile: 767,
            tablet: 1023,
            desktop: 1024
        });


    /* =====================================================
       MEDIA QUERIES
       ===================================================== */

    const mobileQuery =
        window.matchMedia(
            `(max-width: ${BREAKPOINTS.mobile}px)`
        );


    const tabletQuery =
        window.matchMedia(
            `(min-width: ${BREAKPOINTS.mobile + 1}px) and (max-width: ${BREAKPOINTS.tablet}px)`
        );


    const desktopQuery =
        window.matchMedia(
            `(min-width: ${BREAKPOINTS.desktop}px)`
        );


    const portraitQuery =
        window.matchMedia(
            "(orientation: portrait)"
        );


    /* =====================================================
       STATE
       ===================================================== */

    let state = {
        width:
            window.innerWidth,

        height:
            window.innerHeight,

        mobile:
            mobileQuery.matches,

        tablet:
            tabletQuery.matches,

        desktop:
            desktopQuery.matches,

        portrait:
            portraitQuery.matches,

        landscape:
            !portraitQuery.matches
    };


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


    const getDeviceType = () => {

        if (state.mobile) {
            return "mobile";
        }

        if (state.tablet) {
            return "tablet";
        }

        return "desktop";

    };


    /* =====================================================
       ROOT CLASSES
       ===================================================== */

    const updateRootClasses = () => {

        const root =
            document.documentElement;


        root.classList.toggle(
            "is-mobile",
            state.mobile
        );


        root.classList.toggle(
            "is-tablet",
            state.tablet
        );


        root.classList.toggle(
            "is-desktop",
            state.desktop
        );


        root.classList.toggle(
            "is-portrait",
            state.portrait
        );


        root.classList.toggle(
            "is-landscape",
            state.landscape
        );


        root.dataset.device =
            getDeviceType();

    };


    /* =====================================================
       UPDATE STATE
       ===================================================== */

    const updateState = (
        source = "resize"
    ) => {

        const previous =
            { ...state };


        state = {

            width:
                window.innerWidth,

            height:
                window.innerHeight,

            mobile:
                mobileQuery.matches,

            tablet:
                tabletQuery.matches,

            desktop:
                desktopQuery.matches,

            portrait:
                portraitQuery.matches,

            landscape:
                !portraitQuery.matches

        };


        updateRootClasses();


        const deviceChanged =
            previous.mobile !==
                state.mobile ||
            previous.tablet !==
                state.tablet ||
            previous.desktop !==
                state.desktop;


        const orientationChanged =
            previous.portrait !==
            state.portrait;


        emit(
            "neyo:responsive-change",
            {
                ...state,

                device:
                    getDeviceType(),

                source,

                deviceChanged,

                orientationChanged
            }
        );


        if (deviceChanged) {

            emit(
                "neyo:breakpoint-change",
                {
                    device:
                        getDeviceType(),

                    ...state
                }
            );

        }


        if (orientationChanged) {

            emit(
                "neyo:orientation-change",
                {
                    portrait:
                        state.portrait,

                    landscape:
                        state.landscape
                }
            );

        }

    };


    /* =====================================================
       RESIZE THROTTLE
       ===================================================== */

    let resizeFrame = null;


    const handleResize = () => {

        if (resizeFrame) {
            return;
        }


        resizeFrame =
            requestAnimationFrame(
                () => {

                    resizeFrame =
                        null;


                    updateState(
                        "resize"
                    );

                }
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
       MEDIA QUERY EVENTS
       ===================================================== */

    const mediaQueries = [
        mobileQuery,
        tabletQuery,
        desktopQuery,
        portraitQuery
    ];


    mediaQueries.forEach(
        query => {

            if (
                typeof query
                    .addEventListener ===
                "function"
            ) {

                query.addEventListener(
                    "change",
                    () =>
                        updateState(
                            "media-query"
                        )
                );

            }

            else {

                query.addListener?.(
                    () =>
                        updateState(
                            "media-query"
                        )
                );

            }

        }
    );


    /* =====================================================
       VISUAL VIEWPORT
       ===================================================== */

    window.visualViewport
        ?.addEventListener(
            "resize",
            handleResize,
            {
                passive: true
            }
        );


    /* =====================================================
       PUBLIC REFRESH EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:responsive-refresh",
        () => {

            updateState(
                "manual"
            );

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    updateRootClasses();


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoResponsive =
        Object.freeze({

            isMobile:
                () =>
                    state.mobile,

            isTablet:
                () =>
                    state.tablet,

            isDesktop:
                () =>
                    state.desktop,

            isPortrait:
                () =>
                    state.portrait,

            isLandscape:
                () =>
                    state.landscape,

            getDevice:
                getDeviceType,

            getWidth:
                () =>
                    state.width,

            getHeight:
                () =>
                    state.height,

            getState:
                () =>
                    ({ ...state }),

            getBreakpoints:
                () =>
                    ({ ...BREAKPOINTS }),

            refresh:
                () =>
                    updateState(
                        "manual"
                    )

        });

})();
