/*
=========================================================
NEYO — NOTIFICATIONS COMPONENT

Owns:
- Toast notifications
- Success / error / warning / info states
- Auto dismiss
- Manual dismiss
- Notification queue
- Public notification API

Does NOT own:
- Browser push notifications
- Email notifications
- Settings preferences
- Backend alerts
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const DEFAULT_DURATION = 3500;

    const MAX_VISIBLE = 3;


    /* =====================================================
       STATE
       ===================================================== */

    let container = null;

    let notificationId = 0;

    const queue = [];


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


    const refreshIcons = () => {

        if (
            window.lucide
                ?.createIcons
        ) {
            window.lucide
                .createIcons();
        }

    };


    /* =====================================================
       CONTAINER
       ===================================================== */

    const getContainer = () => {

        if (
            container &&
            document.body.contains(
                container
            )
        ) {
            return container;
        }


        container =
            document.getElementById(
                "neyoNotifications"
            );


        if (container) {
            return container;
        }


        container =
            document.createElement(
                "div"
            );


        container.id =
            "neyoNotifications";


        container.className =
            "notification-container";


        container.setAttribute(
            "aria-live",
            "polite"
        );


        container.setAttribute(
            "aria-atomic",
            "false"
        );


        document.body.appendChild(
            container
        );


        return container;

    };


    /* =====================================================
       TYPE CONFIG
       ===================================================== */

    const getTypeConfig = type => {

        switch (type) {

            case "success":
                return {
                    icon:
                        "check-circle",
                    className:
                        "success"
                };

            case "error":
                return {
                    icon:
                        "circle-alert",
                    className:
                        "error"
                };

            case "warning":
                return {
                    icon:
                        "triangle-alert",
                    className:
                        "warning"
                };

            default:
                return {
                    icon:
                        "info",
                    className:
                        "info"
                };

        }

    };


    /* =====================================================
       REMOVE
       ===================================================== */

    const removeNotification = (
        element,
        options = {}
    ) => {

        if (
            !(element instanceof HTMLElement)
        ) {
            return;
        }


        if (
            element.dataset.removing ===
            "true"
        ) {
            return;
        }


        element.dataset.removing =
            "true";


        element.classList.add(
            "is-leaving"
        );


        const finalize = () => {

            element.remove();


            emit(
                "neyo:notification-removed",
                {
                    id:
                        element.dataset
                            .notificationId
                }
            );


            processQueue();

        };


        if (
            options.immediate === true
        ) {

            finalize();

            return;

        }


        window.setTimeout(
            finalize,
            180
        );

    };


    /* =====================================================
       CREATE
       ===================================================== */

    const createNotification = ({
        message = "",
        type = "info",
        duration = DEFAULT_DURATION,
        title = ""
    } = {}) => {

        const host =
            getContainer();


        const config =
            getTypeConfig(type);


        const id =
            ++notificationId;


        const toast =
            document.createElement(
                "div"
            );


        toast.className = [
            "notification-toast",
            `notification-${config.className}`
        ].join(" ");


        toast.dataset.notificationId =
            String(id);


        toast.setAttribute(
            "role",
            type === "error"
                ? "alert"
                : "status"
        );


        /* =================================================
           ICON
           ================================================= */

        const iconWrap =
            document.createElement(
                "div"
            );


        iconWrap.className =
            "notification-icon";


        iconWrap.innerHTML = `
            <i
                data-lucide="${config.icon}"
                width="18"
                height="18"
                aria-hidden="true"
            ></i>
        `;


        /* =================================================
           CONTENT
           ================================================= */

        const content =
            document.createElement(
                "div"
            );


        content.className =
            "notification-content";


        if (title) {

            const heading =
                document.createElement(
                    "div"
                );


            heading.className =
                "notification-title";


            heading.textContent =
                title;


            content.appendChild(
                heading
            );

        }


        const text =
            document.createElement(
                "div"
            );


        text.className =
            "notification-message";


        text.textContent =
            String(message);


        content.appendChild(
            text
        );


        /* =================================================
           CLOSE
           ================================================= */

        const closeBtn =
            document.createElement(
                "button"
            );


        closeBtn.type =
            "button";


        closeBtn.className =
            "notification-close";


        closeBtn.setAttribute(
            "aria-label",
            "Dismiss notification"
        );


        closeBtn.innerHTML = `
            <i
                data-lucide="x"
                width="15"
                height="15"
                aria-hidden="true"
            ></i>
        `;


        closeBtn.addEventListener(
            "click",
            () => {

                removeNotification(
                    toast
                );

            }
        );


        toast.append(
            iconWrap,
            content,
            closeBtn
        );


        host.appendChild(
            toast
        );


        refreshIcons();


        requestAnimationFrame(
            () => {

                toast.classList.add(
                    "is-visible"
                );

            }
        );


        emit(
            "neyo:notification-shown",
            {
                id,
                message,
                title,
                type
            }
        );


        if (
            Number.isFinite(duration) &&
            duration > 0
        ) {

            window.setTimeout(
                () => {

                    removeNotification(
                        toast
                    );

                },
                duration
            );

        }


        return toast;

    };


    /* =====================================================
       QUEUE
       ===================================================== */

    const processQueue = () => {

        const host =
            getContainer();


        while (
            queue.length &&
            host.children.length <
                MAX_VISIBLE
        ) {

            const item =
                queue.shift();


            createNotification(
                item
            );

        }

    };


    /* =====================================================
       SHOW
       ===================================================== */

    const show = (
        message,
        options = {}
    ) => {

        const payload = {

            message,

            type:
                options.type ||
                "info",

            title:
                options.title ||
                "",

            duration:
                options.duration ??
                DEFAULT_DURATION

        };


        const host =
            getContainer();


        if (
            host.children.length >=
            MAX_VISIBLE
        ) {

            queue.push(
                payload
            );


            return null;

        }


        return createNotification(
            payload
        );

    };


    /* =====================================================
       SHORTCUTS
       ===================================================== */

    const success = (
        message,
        options = {}
    ) => {

        return show(
            message,
            {
                ...options,
                type:
                    "success"
            }
        );

    };


    const error = (
        message,
        options = {}
    ) => {

        return show(
            message,
            {
                ...options,
                type:
                    "error"
            }
        );

    };


    const warning = (
        message,
        options = {}
    ) => {

        return show(
            message,
            {
                ...options,
                type:
                    "warning"
            }
        );

    };


    const info = (
        message,
        options = {}
    ) => {

        return show(
            message,
            {
                ...options,
                type:
                    "info"
            }
        );

    };


    /* =====================================================
       CLEAR
       ===================================================== */

    const clear = () => {

        queue.length =
            0;


        const host =
            getContainer();


        Array.from(
            host.children
        ).forEach(
            element => {

                removeNotification(
                    element,
                    {
                        immediate:
                            true
                    }
                );

            }
        );

    };


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:notification-show",
        event => {

            show(
                event.detail?.message ||
                "",
                event.detail ||
                {}
            );

        }
    );


    window.addEventListener(
        "neyo:notification-success",
        event => {

            success(
                event.detail?.message ||
                "",
                event.detail ||
                {}
            );

        }
    );


    window.addEventListener(
        "neyo:notification-error",
        event => {

            error(
                event.detail?.message ||
                "",
                event.detail ||
                {}
            );

        }
    );


    window.addEventListener(
        "neyo:notification-warning",
        event => {

            warning(
                event.detail?.message ||
                "",
                event.detail ||
                {}
            );

        }
    );


    window.addEventListener(
        "neyo:notification-info",
        event => {

            info(
                event.detail?.message ||
                "",
                event.detail ||
                {}
            );

        }
    );


    window.addEventListener(
        "neyo:notifications-clear",
        clear
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoNotifications =
        Object.freeze({

            show,

            success,

            error,

            warning,

            info,

            clear,

            getCount:
                () =>
                    getContainer()
                        .children
                        .length,

            getQueueCount:
                () =>
                    queue.length

        });

})();
