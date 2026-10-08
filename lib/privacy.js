/* =========================================================
   NEYO • ZERO-TRUST PRIVACY LAYER (PII + secret scrubbing)
   ---------------------------------------------------------
   Runs on our own server BEFORE any text goes to an outside
   AI model, search engine or tool.

   1. Secrets are destroyed (never restored):
        API keys, tokens, passwords, private keys, DB passwords
        -> [REDACTED_SECRET]
        card numbers (Luhn checked) -> [REDACTED_CARD]
        CNIC / SSN -> [REDACTED_ID], IBAN -> [REDACTED_IBAN]
   2. Personal details are masked with numbered placeholders
      and put back only in the answer the user sees:
        emails -> [EMAIL_1], phones -> [PHONE_1],
        internal IPs -> [IP_1],
        company words from NEYO_PRIVACY_TERMS -> [PRIVATE_1]
      The AI never sees the real value.

   Env:
     NEYO_PRIVACY=off            turn the whole layer off
     NEYO_PRIVACY_TERMS=a,b,c    extra enterprise words to hide
   Values are never logged, only counts.
   ========================================================= */

const SECRET = "[REDACTED_SECRET]";

const SECRET_PATTERNS = [
    // PEM private keys
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, () => SECRET],
    // database / queue urls with a password
    [/\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql):\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, (m, a, b, c) => `${a}${SECRET}${c}`],
    // well known key shapes
    [/\bAIza[0-9A-Za-z_-]{35}\b/g, () => SECRET],
    [/\bsk-(?:proj-|ant-|or-v1-)?[A-Za-z0-9_-]{20,}/g, () => SECRET],
    [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}/g, () => SECRET],
    [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, () => SECRET],
    [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, () => SECRET],
    [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g, () => SECRET],
    [/\bhf_[A-Za-z0-9]{30,}\b/g, () => SECRET],
    [/\bgsk_[A-Za-z0-9]{30,}\b/g, () => SECRET],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, () => SECRET],
    [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{20,}=*/g, (m, a) => `${a} ${SECRET}`],
    // label = value  (password: abc, "api_key": "xyz", TOKEN=...)
    [/\b(\w*?(?:password|passwd|pwd|passcode|pin|secret|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|token|client[_-]?secret|private[_-]?key|cvv|cvc))(["']?\s*[:=]\s*["']?)([^\s"',;`()\[\]{}]{3,})/gi, (m, a, b, value, offset, all) => (looksLikeCode(value, all[offset + m.length]) ? m : `${a}${b}${SECRET}`)],
    // spoken form: "mera password abc@123 hai", "pin is 4321"
    [/\b(password|passwd|passcode|pin)(\s+(?:is|hai|he|h|tha|=)?\s*)((?=\S*[\d@#$%!&*])\S{4,})/gi, (m, a, b) => `${a}${b}${SECRET}`]
];

// "token = req.headers.x", "pin: getPin()", "key = None" are code, not secrets.
const CODE_WORDS =
    /^(process|req|res|request|response|this|self|config|settings|props|options|args|data|await|new|null|undefined|true|false|none|nil|input)\b/i;

function looksLikeCode(value, nextChar) {
    return nextChar === "(" ||
        CODE_WORDS.test(value) ||
        /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(value);
}

function luhn(digits) {
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
        let d = digits.charCodeAt(i) - 48;
        if (double) {
            d *= 2;
            if (d > 9) {
                d -= 9;
            }
        }
        sum += d;
        double = !double;
    }
    return sum % 10 === 0;
}

const ID_PATTERNS = [
    // payment cards: 13-19 digits, spaces or dashes allowed, Luhn valid
    [/\b\d(?:[ -]?\d){12,18}\b/g, m => {
        const digits = m.replace(/\D/g, "");
        const spaced = /[ -]/.test(m);
        const sizeOk = digits.length === 15 || digits.length === 16 || (spaced && digits.length >= 13 && digits.length <= 19);
        return sizeOk && luhn(digits) && !/^(\d)\1+$/.test(digits)
            ? "[REDACTED_CARD]"
            : m;
    }],
    // Pakistani CNIC 12345-1234567-1, or 13 digits after the word cnic
    [/\b\d{5}-\d{7}-\d\b/g, () => "[REDACTED_ID]"],
    [/\b(cnic|nic|id card|shanakhti card)(\D{0,12})(\d{13})\b/gi, (m, a, b) => `${a}${b}[REDACTED_ID]`],
    // US SSN
    [/\b\d{3}-\d{2}-\d{4}\b/g, () => "[REDACTED_ID]"],
    // IBAN (PK36SCBL0000001123456702, GB.. etc)
    [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, m => (m.replace(/\s/g, "").length >= 15 ? "[REDACTED_IBAN]" : m)]
];

const MASK_PATTERNS = [
    ["EMAIL", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
    // Pakistani mobiles 03xx-xxxxxxx / +92 3xx xxxxxxx
    ["PHONE", /(?:\+92|0092|\b0)[\s-]?3\d{2}[\s-]?\d{7}\b/g],
    // other international numbers with a leading +
    ["PHONE", /\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g],
    // internal network addresses
    ["IP", /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g]
];

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function customTerms() {
    return String(process.env.NEYO_PRIVACY_TERMS || "")
        .split(",")
        .map(term => term.trim())
        .filter(term => term.length >= 3)
        .slice(0, 100);
}

export const PRIVACY_RULE =
    "Privacy: some private details in the chat were replaced on the server by placeholders such as [EMAIL_1], [PHONE_1], [IP_1] or [PRIVATE_1]. Use those placeholders exactly as written when you need them (they are swapped back for the user automatically) and never comment on them. [REDACTED_SECRET], [REDACTED_CARD], [REDACTED_ID] and [REDACTED_IBAN] are hidden for safety: never ask the user to share them again, and if the user shared a real key or password, gently advise rotating it.";

export function privacyEnabled() {
    return String(process.env.NEYO_PRIVACY || "").toLowerCase() !== "off";
}

export function createPrivacySession() {

    const enabled = privacyEnabled();
    const byValue = new Map();      // real value -> placeholder
    const byHolder = new Map();     // placeholder -> real value
    const counters = {};
    const counts = {};

    const terms = customTerms();
    const termRegex = terms.length
        ? new RegExp(`\\b(?:${terms.map(escapeRegex).join("|")})\\b`, "gi")
        : null;

    function count(kind) {
        counts[kind] = (counts[kind] || 0) + 1;
    }

    function holderFor(kind, value) {
        const key = `${kind}:${value.toLowerCase()}`;
        if (byValue.has(key)) {
            return byValue.get(key);
        }
        counters[kind] = (counters[kind] || 0) + 1;
        const holder = `[${kind}_${counters[kind]}]`;
        byValue.set(key, holder);
        byHolder.set(holder, value);
        return holder;
    }

    function scrub(text) {

        if (!enabled || typeof text !== "string" || !text) {
            return text;
        }

        let out = text;

        for (const [pattern, replace] of SECRET_PATTERNS) {
            out = out.replace(pattern, (...args) => {
                const next = replace(...args);
                if (next !== args[0]) {
                    count("secret");
                }
                return next;
            });
        }

        for (const [pattern, replace] of ID_PATTERNS) {
            out = out.replace(pattern, (...args) => {
                const next = replace(...args);
                if (next !== args[0]) {
                    count("id");
                }
                return next;
            });
        }

        for (const [kind, pattern] of MASK_PATTERNS) {
            out = out.replace(pattern, match => {
                count(kind.toLowerCase());
                return holderFor(kind, match);
            });
        }

        if (termRegex) {
            out = out.replace(termRegex, match => {
                count("private");
                return holderFor("PRIVATE", match);
            });
        }

        return out;

    }

    function restore(text) {
        if (!enabled || typeof text !== "string" || !byHolder.size) {
            return text;
        }
        return text.replace(/\[(EMAIL|PHONE|IP|PRIVATE)_(\d{1,4})\]/g, holder => byHolder.get(holder) ?? holder);
    }

    // Streaming: a placeholder can be cut between two chunks
    // ("[EMA" + "IL_1]"), so hold back an unfinished "[..." tail.
    function createStreamRestorer() {
        let pending = "";
        return {
            push(chunk) {
                if (!byHolder.size) {
                    return chunk;
                }
                pending += chunk;
                const open = pending.lastIndexOf("[");
                let ready = pending;
                if (open !== -1 && pending.indexOf("]", open) === -1 && pending.length - open <= 16 && /^\[[A-Z_]*\d*$/.test(pending.slice(open))) {
                    ready = pending.slice(0, open);
                    pending = pending.slice(open);
                } else {
                    pending = "";
                }
                return restore(ready);
            },
            flush() {
                const rest = restore(pending);
                pending = "";
                return rest;
            }
        };
    }

    return {
        enabled,
        scrub,
        restore,
        createStreamRestorer,
        counts,
        get changed() {
            return Object.keys(counts).length > 0;
        }
    };

}
