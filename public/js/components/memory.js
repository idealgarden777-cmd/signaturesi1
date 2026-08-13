/*
=========================================================
NEYO — MEMORY COMPONENT

Owns:
- Memory on/off state
- Local memory cache
- Add/update/delete memory items
- Chat preference sync
- Memory lifecycle events
- Public memory API

Does NOT own:
- Settings modal layout
- Chat API implementation
- Backend memory endpoint
- Profile rendering
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const STORAGE_KEY =
        "neo_user_memories";

    const MEMORY_ENABLED_KEY =
        "neyo_memory_enabled";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const memoryToggle =
        document.getElementById(
            "memoryToggle"
        );


    /* =====================================================
       STATE
       ===================================================== */

    let enabled =
        true;

    let memories =
        [];


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


    const clone =
        value => {

            try {

                return structuredClone(
                    value
                );

            }

            catch {

                return JSON.parse(
                    JSON.stringify(
                        value
                    )
                );

            }

        };


    const createId = () => {

        if (
            crypto?.randomUUID
        ) {

            return crypto.randomUUID();

        }


        return [
            Date.now(),
            Math.random()
                .toString(36)
                .slice(2)
        ].join("-");

    };


    /* =====================================================
       STORAGE
       ===================================================== */

    const loadEnabledState = () => {

        try {

            const stored =
                localStorage.getItem(
                    MEMORY_ENABLED_KEY
                );


            if (stored === null) {
                return true;
            }


            return stored === "true";

        }

        catch {

            return true;

        }

    };


    const saveEnabledState = () => {

        try {

            localStorage.setItem(
                MEMORY_ENABLED_KEY,
                String(enabled)
            );

        }

        catch {
            // Storage unavailable.
        }

    };


    const loadStoredMemories = () => {

        try {

            const raw =
                localStorage.getItem(
                    STORAGE_KEY
                );


            if (!raw) {
                return [];
            }


            const parsed =
                JSON.parse(raw);


            return Array.isArray(
                parsed
            )
                ? parsed
                : [];

        }

        catch {

            return [];

        }

    };


    const saveMemories = () => {

        try {

            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(
                    memories
                )
            );

        }

        catch {
            // Storage unavailable.
        }

    };


    /* =====================================================
       UI
       ===================================================== */

    const updateUi = () => {

        memoryToggle
            ?.classList
            .toggle(
                "active",
                enabled
            );


        memoryToggle
            ?.setAttribute(
                "aria-pressed",
                String(enabled)
            );


        document.documentElement
            .dataset.memory =
            enabled
                ? "on"
                : "off";

    };


    /* =====================================================
       CHAT SYNC
       ===================================================== */

    const syncChatPreference = () => {

        window.NeyoChat
            ?.setPreferences?.({
                memory:
                    enabled
            });

    };


    /* =====================================================
       SET ENABLED
       ===================================================== */

    const setEnabled = (
        value,
        options = {}
    ) => {

        const next =
            Boolean(value);


        if (
            enabled === next &&
            options.force !== true
        ) {
            return enabled;
        }


        enabled =
            next;


        saveEnabledState();

        updateUi();

        syncChatPreference();


        if (
            options.silent !== true
        ) {

            emit(
                "neyo:memory-state-change",
                {
                    enabled
                }
            );

        }


        return enabled;

    };


    /* =====================================================
       TOGGLE
       ===================================================== */

    const toggleMemory = () => {

        return setEnabled(
            !enabled
        );

    };


    /* =====================================================
       ADD MEMORY
       ===================================================== */

    const addMemory = (
        content,
        metadata = {}
    ) => {

        const text =
            String(
                content || ""
            ).trim();


        if (!text) {
            return null;
        }


        const memory = {

            id:
                createId(),

            content:
                text,

            createdAt:
                new Date()
                    .toISOString(),

            updatedAt:
                new Date()
                    .toISOString(),

            metadata:
                metadata &&
                typeof metadata ===
                    "object"
                    ? {
                        ...metadata
                    }
                    : {}

        };


        memories.unshift(
            memory
        );


        saveMemories();


        emit(
            "neyo:memory-added",
            {
                memory:
                    clone(memory),

                memories:
                    clone(memories)
            }
        );


        return clone(
            memory
        );

    };


    /* =====================================================
       UPDATE MEMORY
       ===================================================== */

    const updateMemory = (
        id,
        values = {}
    ) => {

        const index =
            memories.findIndex(
                memory =>
                    memory.id === id
            );


        if (index < 0) {
            return null;
        }


        const current =
            memories[index];


        const next = {

            ...current,

            ...values,

            id:
                current.id,

            updatedAt:
                new Date()
                    .toISOString()

        };


        if (
            typeof next.content ===
            "string"
        ) {

            next.content =
                next.content.trim();

        }


        memories[index] =
            next;


        saveMemories();


        emit(
            "neyo:memory-updated",
            {
                memory:
                    clone(next),

                memories:
                    clone(memories)
            }
        );


        return clone(
            next
        );

    };


    /* =====================================================
       DELETE MEMORY
       ===================================================== */

    const deleteMemory = id => {

        const exists =
            memories.some(
                memory =>
                    memory.id === id
            );


        if (!exists) {
            return false;
        }


        memories =
            memories.filter(
                memory =>
                    memory.id !== id
            );


        saveMemories();


        emit(
            "neyo:memory-deleted",
            {
                id,

                memories:
                    clone(memories)
            }
        );


        return true;

    };


    /* =====================================================
       CLEAR ALL
       ===================================================== */

    const clearMemories = () => {

        memories =
            [];


        saveMemories();


        emit(
            "neyo:memories-cleared"
        );


        return true;

    };


    /* =====================================================
       REPLACE MEMORY LIST
       ===================================================== */

    const setMemories = items => {

        memories =
            Array.isArray(
                items
            )
                ? items.map(
                    item => ({
                        ...item
                    })
                )
                : [];


        saveMemories();


        emit(
            "neyo:memories-set",
            {
                memories:
                    clone(memories)
            }
        );


        return clone(
            memories
        );

    };


    /* =====================================================
       FIND
       ===================================================== */

    const getMemory = id => {

        const memory =
            memories.find(
                item =>
                    item.id === id
            );


        return memory
            ? clone(memory)
            : null;

    };


    /* =====================================================
       TOGGLE EVENT
       ===================================================== */

    memoryToggle
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();


                toggleMemory();

            }
        );


    /* =====================================================
       EXTERNAL EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:memory-set",
        event => {

            setEnabled(
                event.detail?.enabled,
                {
                    silent:
                        Boolean(
                            event.detail?.silent
                        )
                }
            );

        }
    );


    window.addEventListener(
        "neyo:memory-toggle-request",
        toggleMemory
    );


    window.addEventListener(
        "neyo:memory-add-request",
        event => {

            addMemory(
                event.detail?.content,
                event.detail?.metadata ||
                {}
            );

        }
    );


    window.addEventListener(
        "neyo:memory-delete-request",
        event => {

            deleteMemory(
                event.detail?.id
            );

        }
    );


    window.addEventListener(
        "neyo:memories-clear-request",
        clearMemories
    );


    /* =====================================================
       LOGOUT
       ===================================================== */

    window.addEventListener(
        "neyo:logout-success",
        () => {

            memories =
                [];


            try {

                localStorage.removeItem(
                    STORAGE_KEY
                );

            }

            catch {
                // Storage unavailable.
            }

        }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    enabled =
        loadEnabledState();


    memories =
        loadStoredMemories();


    updateUi();

    syncChatPreference();


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoMemory =
        Object.freeze({

            enable:
                () =>
                    setEnabled(
                        true
                    ),

            disable:
                () =>
                    setEnabled(
                        false
                    ),

            toggle:
                toggleMemory,

            setEnabled,

            isEnabled:
                () =>
                    enabled,

            add:
                addMemory,

            update:
                updateMemory,

            delete:
                deleteMemory,

            clear:
                clearMemories,

            setMemories,

            get:
                getMemory,

            getAll:
                () =>
                    clone(
                        memories
                    ),

            getCount:
                () =>
                    memories.length

        });

})();
