/*
=========================================================
NEYO — SEARCH COMPONENT

Owns:
- Search query state
- Text normalization
- Generic item filtering
- History/search result matching
- Search events
- Public search API

Does NOT own:
- Search modal UI
- History fetching
- History rendering
- Chat API
- Navigation
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       STATE
       ===================================================== */

    let currentQuery = "";

    let sourceItems = [];

    let filteredItems = [];


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


    const normalizeText = value => {

        return String(
            value ?? ""
        )
            .normalize("NFKD")
            .toLowerCase()
            .trim();

    };


    const normalizeQuery = query => {

        return normalizeText(
            query
        )
            .replace(
                /\s+/g,
                " "
            );

    };


    /* =====================================================
       SEARCHABLE TEXT
       ===================================================== */

    const getItemSearchText =
        item => {

            if (
                typeof item ===
                "string"
            ) {
                return item;
            }


            if (
                !item ||
                typeof item !==
                "object"
            ) {
                return "";
            }


            /*
            Supports common future history fields:
            title
            name
            text
            content
            preview
            model
            personality
            */

            return [
                item.title,
                item.name,
                item.text,
                item.content,
                item.preview,
                item.model,
                item.personality
            ]
                .filter(Boolean)
                .join(" ");

        };


    /* =====================================================
       MATCH
       ===================================================== */

    const matchesQuery = (
        item,
        query
    ) => {

        const normalizedQuery =
            normalizeQuery(
                query
            );


        if (!normalizedQuery) {
            return true;
        }


        const searchableText =
            normalizeText(
                getItemSearchText(
                    item
                )
            );


        /*
        Multi-word search:
        every word must exist somewhere
        in the searchable item.
        */

        const terms =
            normalizedQuery
                .split(" ")
                .filter(Boolean);


        return terms.every(
            term =>
                searchableText.includes(
                    term
                )
        );

    };


    /* =====================================================
       FILTER
       ===================================================== */

    const filterItems = (
        items = sourceItems,
        query = currentQuery
    ) => {

        if (!Array.isArray(items)) {
            return [];
        }


        const normalized =
            normalizeQuery(
                query
            );


        if (!normalized) {
            return [
                ...items
            ];
        }


        return items.filter(
            item =>
                matchesQuery(
                    item,
                    normalized
                )
        );

    };


    /* =====================================================
       RUN SEARCH
       ===================================================== */

    const search = query => {

        currentQuery =
            normalizeQuery(
                query
            );


        filteredItems =
            filterItems(
                sourceItems,
                currentQuery
            );


        emit(
            "neyo:search-results",
            {
                query:
                    currentQuery,

                results: [
                    ...filteredItems
                ],

                count:
                    filteredItems.length,

                total:
                    sourceItems.length
            }
        );


        return [
            ...filteredItems
        ];

    };


    /* =====================================================
       SET SOURCE
       ===================================================== */

    const setItems = items => {

        sourceItems =
            Array.isArray(items)
                ? [...items]
                : [];


        return search(
            currentQuery
        );

    };


    /* =====================================================
       ADD ITEM
       ===================================================== */

    const addItem = item => {

        if (
            item === undefined ||
            item === null
        ) {
            return;
        }


        sourceItems.push(
            item
        );


        search(
            currentQuery
        );

    };


    /* =====================================================
       REMOVE ITEM
       ===================================================== */

    const removeItem = predicate => {

        if (
            typeof predicate !==
            "function"
        ) {
            return;
        }


        sourceItems =
            sourceItems.filter(
                item =>
                    !predicate(item)
            );


        search(
            currentQuery
        );

    };


    /* =====================================================
       CLEAR QUERY
       ===================================================== */

    const clear = () => {

        currentQuery =
            "";


        filteredItems = [
            ...sourceItems
        ];


        emit(
            "neyo:search-clear",
            {
                results: [
                    ...filteredItems
                ]
            }
        );


        emit(
            "neyo:search-results",
            {
                query:
                    "",

                results: [
                    ...filteredItems
                ],

                count:
                    filteredItems.length,

                total:
                    sourceItems.length
            }
        );


        return [
            ...filteredItems
        ];

    };


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:search-request",
        event => {

            search(
                event.detail?.query ||
                ""
            );

        }
    );


    window.addEventListener(
        "neyo:search-items-set",
        event => {

            setItems(
                event.detail?.items
            );

        }
    );


    window.addEventListener(
        "neyo:search-clear-request",
        clear
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoSearch =
        Object.freeze({

            search,

            setItems,

            addItem,

            removeItem,

            clear,

            matches:
                matchesQuery,

            filter:
                filterItems,

            getQuery:
                () =>
                    currentQuery,

            getResults:
                () =>
                    [...filteredItems],

            getItems:
                () =>
                    [...sourceItems]

        });

})();
