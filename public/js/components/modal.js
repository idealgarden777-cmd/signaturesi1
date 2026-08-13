/*
=========================================================
NEYO — GENERIC MODAL COMPONENT

Owns:
- Generic modal open / close
- Backdrop click
- Escape key close
- Focus management
- Body modal state
- Public modal events

Does NOT own:
- Settings-specific logic
- Profile logic
- Delete confirmation logic
- Share logic
- Business logic inside modals
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       STATE
       ===================================================== */

    let activeModal = null;
    let previousFocusedElement = null;


    /* =====================================================
       HELPERS
       ===================================================== */

    const getModal = target => {

        if (!target) return null;


        if (target instanceof HTMLElement) {
            return target;
        }


        if (typeof target === "string") {

            return (
                document.getElementById(target) ||
                document.querySelector(target)
            );
        }


        return null;
    };


    const emit = (
        name,
        modal,
        extra = {}
    ) => {

        window.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail: {
                        modal,
                        id:
                            modal?.id || null,
                        ...extra
                    }
                }
            )
        );
    };


    const getFocusableElements = modal => {

        if (!modal) {
            return [];
        }


        return Array.from(
            modal.querySelectorAll(
                [
                    "button:not([disabled])",
                    "[href]",
                    "input:not([disabled])",
                    "select:not([disabled])",
                    "textarea:not([disabled])",
                    "[tabindex]:not([tabindex='-1'])"
                ].join(",")
            )
        ).filter(
            element =>
                !element.hidden &&
                element.offsetParent !== null
        );
    };


    /* =====================================================
       BODY STATE
       ===================================================== */

    const updateBodyState = () => {

        document.body.classList.toggle(
            "modal-open",
            Boolean(activeModal)
        );
    };


    /* =====================================================
       OPEN
       ===================================================== */

    const openModal = (
        target,
        options = {}
    ) => {

        const modal =
            getModal(target);


        if (!modal) {
            return null;
        }


        /*
        If another modal is already open,
        close it before opening the next one.
        */

        if (
            activeModal &&
            activeModal !== modal
        ) {
            closeModal(
                activeModal,
                {
                    restoreFocus: false
                }
            );
        }


        previousFocusedElement =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;


        activeModal = modal;


        modal.classList.add("show");
        modal.classList.add("open");


        modal.setAttribute(
            "aria-hidden",
            "false"
        );


        modal.dataset.modalOpen =
            "true";


        updateBodyState();


        /* ---------------------------------------------
           AUTO FOCUS
           --------------------------------------------- */

        if (
            options.focus !== false
        ) {

            requestAnimationFrame(
                () => {

                    const autofocus =
                        modal.querySelector(
                            "[autofocus]"
                        );


                    const focusable =
                        getFocusableElements(
                            modal
                        );


                    (
                        autofocus ||
                        focusable[0] ||
                        modal
                    )?.focus?.();
                }
            );
        }


        emit(
            "neyo:modal-open",
            modal
        );


        return modal;
    };


    /* =====================================================
       CLOSE
       ===================================================== */

    const closeModal = (
        target = activeModal,
        options = {}
    ) => {

        const modal =
            getModal(target);


        if (!modal) {
            return;
        }


        modal.classList.remove(
            "show"
        );

        modal.classList.remove(
            "open"
        );


        modal.setAttribute(
            "aria-hidden",
            "true"
        );


        delete modal.dataset.modalOpen;


        if (
            activeModal === modal
        ) {
            activeModal = null;
        }


        updateBodyState();


        /* ---------------------------------------------
           RESTORE FOCUS
           --------------------------------------------- */

        if (
            options.restoreFocus !== false &&
            previousFocusedElement
        ) {

            requestAnimationFrame(
                () => {

                    previousFocusedElement
                        ?.focus?.();

                    previousFocusedElement =
                        null;
                }
            );
        }


        emit(
            "neyo:modal-close",
            modal
        );
    };


    /* =====================================================
       TOGGLE
       ===================================================== */

    const toggleModal = target => {

        const modal =
            getModal(target);


        if (!modal) {
            return;
        }


        const open =
            modal.dataset.modalOpen ===
            "true";


        if (open) {
            closeModal(modal);
        } else {
            openModal(modal);
        }
    };


    /* =====================================================
       CLOSE ACTIVE
       ===================================================== */

    const closeActiveModal = () => {

        if (!activeModal) {
            return;
        }


        closeModal(
            activeModal
        );
    };


    /* =====================================================
       BACKDROP CLICK
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            if (!activeModal) {
                return;
            }


            /*
            Only close if user clicks directly
            on the modal backdrop itself.
            */

            if (
                event.target ===
                activeModal
            ) {

                const backdropClose =
                    activeModal.dataset
                        .backdropClose;


                if (
                    backdropClose !==
                    "false"
                ) {
                    closeActiveModal();
                }
            }
        }
    );


    /* =====================================================
       ESCAPE KEY
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key !== "Escape" ||
                !activeModal
            ) {
                return;
            }


            const escapeClose =
                activeModal.dataset
                    .escapeClose;


            if (
                escapeClose !==
                "false"
            ) {
                closeActiveModal();
            }
        }
    );


    /* =====================================================
       FOCUS TRAP
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key !== "Tab" ||
                !activeModal
            ) {
                return;
            }


            const focusable =
                getFocusableElements(
                    activeModal
                );


            if (!focusable.length) {
                return;
            }


            const first =
                focusable[0];

            const last =
                focusable[
                    focusable.length - 1
                ];


            if (
                event.shiftKey &&
                document.activeElement === first
            ) {

                event.preventDefault();

                last.focus();
            }

            else if (
                !event.shiftKey &&
                document.activeElement === last
            ) {

                event.preventDefault();

                first.focus();
            }
        }
    );


    /* =====================================================
       DATA ATTRIBUTE BUTTONS
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            const openButton =
                event.target.closest(
                    "[data-modal-open]"
                );


            if (openButton) {

                const target =
                    openButton.dataset
                        .modalOpen;

                openModal(target);

                return;
            }


            const closeButton =
                event.target.closest(
                    "[data-modal-close]"
                );


            if (closeButton) {

                const target =
                    closeButton.dataset
                        .modalClose;


                if (target) {
                    closeModal(target);
                } else {
                    closeActiveModal();
                }
            }
        }
    );


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:modal-open-request",
        event => {

            openModal(
                event.detail?.target,
                event.detail?.options || {}
            );
        }
    );


    window.addEventListener(
        "neyo:modal-close-request",
        event => {

            closeModal(
                event.detail?.target ||
                activeModal
            );
        }
    );


    window.addEventListener(
        "neyo:modal-toggle-request",
        event => {

            toggleModal(
                event.detail?.target
            );
        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoModal =
        Object.freeze({

            open:
                openModal,

            close:
                closeModal,

            toggle:
                toggleModal,

            closeActive:
                closeActiveModal,

            getActive:
                () => activeModal,

            isOpen:
                target => {

                    const modal =
                        getModal(target);

                    return (
                        modal?.dataset
                            .modalOpen ===
                        "true"
                    );
                }
        });

})();
