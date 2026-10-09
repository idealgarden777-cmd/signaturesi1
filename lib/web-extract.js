/*
=========================================================
NEYO — LIVE WEB EXTRACTION
Pulls the part of a page that matters, with no AI call:
- focus  : keeps the passages that best match what is asked
           (plus their heading), in page order
- format : text | tables (table rows) | list (bullet items) |
           links (needs page.links)
Input is the readable text from deep-research readPage
(headings start with "## ", list items with "- ", table cells
are joined with " | ").
=========================================================
*/

function terms(text = "") {
    return [...new Set(
        String(text)
            .toLowerCase()
            .split(/[^\p{L}\p{N}.-]+/u)
            .filter(term => term.length > 1)
    )];
}

function blocksOf(text = "") {
    const lines = String(text).split("\n");
    const blocks = [];
    let heading = "";
    let current = [];
    const flush = () => {
        if (current.length) {
            blocks.push({ heading, text: current.join("\n") });
            current = [];
        }
    };
    lines.forEach(line => {
        if (line.startsWith("## ")) {
            flush();
            heading = line.slice(3).trim();
            return;
        }
        current.push(line);
        if (current.join("\n").length > 700) {
            flush();
        }
    });
    flush();
    return blocks;
}

function pickLines(text, test) {
    return String(text).split("\n").filter(test);
}

export function extractFromPage(page = {}, { focus = "", format = "text", maxChars = 6000 } = {}) {
    const text = String(page.text || "");
    const kind = String(format || "text").toLowerCase();

    if (kind === "tables") {
        const rows = pickLines(text, line => (line.match(/ \| /g) || []).length >= 1);
        if (rows.length) {
            return { format: "tables", content: rows.join("\n").slice(0, maxChars) };
        }
    }
    if (kind === "list") {
        const items = pickLines(text, line => line.startsWith("- ") && line.length > 4);
        if (items.length) {
            return { format: "list", content: items.join("\n").slice(0, maxChars) };
        }
    }
    if (kind === "links" && Array.isArray(page.links) && page.links.length) {
        return { format: "links", content: page.links.slice(0, 40) };
    }

    const wanted = terms(focus);
    if (!wanted.length || text.length <= maxChars) {
        return { format: "text", content: text.slice(0, maxChars) };
    }

    const blocks = blocksOf(text).map((block, index) => {
        const haystack = `${block.heading} ${block.text}`.toLowerCase();
        const hits = wanted.filter(term => haystack.includes(term)).length;
        const numbers = /\d/.test(block.text) && /(price|rate|rs|pkr|\$|%|date|spec|score|\d{4})/i.test(focus) ? 0.3 : 0;
        return { ...block, index, score: hits / wanted.length + numbers };
    });

    const picked = [];
    let used = 0;
    [...blocks]
        .filter(block => block.score > 0)
        .sort((a, b) => b.score - a.score)
        .forEach(block => {
            const size = block.text.length + block.heading.length + 6;
            if (used + size <= maxChars) {
                picked.push(block);
                used += size;
            }
        });

    if (!picked.length) {
        return { format: "text", content: text.slice(0, maxChars), note: "Nothing matched the focus; showing the start of the page." };
    }

    return {
        format: "text",
        focus,
        content: picked
            .sort((a, b) => a.index - b.index)
            .map(block => (block.heading ? `## ${block.heading}\n` : "") + block.text)
            .join("\n…\n")
    };
}
