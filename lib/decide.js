/* =========================================================
   NEYO • ZERO-TOKEN DECISION ENGINE
   ---------------------------------------------------------
   Decides, with plain rules (no AI call, 0 tokens, <1 ms):
     lane   "direct" -> answer straight away, skip the tool planner
            "tools"  -> needs the planner (search, maths, code, law...)
            "unsure" -> let the planner decide (old behaviour)
     effort "high"   -> writer thinks first
            "low"    -> writer answers at once
   Only "direct" saves tokens, so it is used only when we are
   sure. Anything time-sensitive, numeric, code, law, links or
   names of real things goes to the planner.
   Env: NEYO_LOCAL_DECIDE=off turns it off.
   ========================================================= */

const NEEDS_TOOLS = [
    // live / changing facts
    /\b(latest|today|tonight|tomorrow|yesterday|now|current(ly)?|recent|news|update|breaking|live|this (week|month|year)|abhi|aaj|aj|kal|is waqt|filhal|taza|khabar)\b/i,
    /\b(price|prices|rate|rates|cost|kitne ka|kitne ki|qeemat|keemat|dollar|rupee|rupay|pkr|usd|bitcoin|btc|stock|share price|gold|sona)\b/i,
    /\b(weather|mausam|temperature|barish|score|match|result|election|winner|release date|launch)\b/i,
    /\b(20[2-9]\d)\b/,
    // law
    /\b(law|legal|illegal|qanoon|qanun|saza|section|act|fir|court|case|khula|divorce|talaq|visa|tax|rights|haq)\b/i,
    // links / files / code
    /https?:\/\/|www\./i,
    /```|\bfunction\s*\(|=>|\bdef\s+\w+\(|\bconst\s+\w+\s*=|\bclass\s+\w+|<\/?[a-z]+[^>]*>|\berror\b|\bbug\b|\bdebug\b|\bfix\b/i,
    // numbers to compute / puzzles / probability
    /\d+\s*[-+*/^×÷%]\s*\d+/,
    /\b(calculate|calculation|hisab|kitna|kitne|how many|how much|percent|percentage|probability|chance|odds|convert|solve|puzzle|riddle|equation)\b/i,
    // research-style asks
    /\b(research|compare|vs\.?|versus|search|find|dhoond|source|sources|reference)\b/i
];

const DIRECT_ASK = [
    // writing / creative
    /\b(poem|poetry|shayari|sher|ghazal|nazm|story|kahani|joke|lateefa|lyrics|song|caption|bio|slogan|tagline|wish|birthday message|greeting card)\b/i,
    // rewrite / language work on text the user gives
    /\b(rewrite|re-write|rephrase|paraphrase|improve( this| my)? (text|writing|email|message|paragraph)|proofread|grammar|correct (this|my)|translate|translation|tarjuma|summari[sz]e this|shorten|make it (shorter|longer|formal|casual|polite))\b/i,
    // plain chat / feelings / opinions
    /\b(how are you|kaise ho|kese ho|kya haal|i feel|i am (sad|happy|bored|tired)|udaas|bore ho|motivate|motivation|advice on life|tell me about yourself|who are you|tum kon ho|aap kon ho|your name|tumhara naam)\b/i
];

const HIGH_EFFORT = [
    /\b(prove|proof|derive|derivation|step[- ]by[- ]step|explain (why|how) .{0,40} works?|architecture|design (a|the) system|optimi[sz]e|algorithm|complexity|theorem|logic|reasoning|analy[sz]e|analysis|strategy|plan for|business plan|essay|research paper|thesis)\b/i,
    /[∫∑√π≤≥≠]|\\frac|\\int|\^\d/,
    /```/
];

function clean(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * @param {string} text      the user's message
 * @param {object} options   { hasAttachments, smallTalk }
 * @returns {{ lane: "direct"|"tools"|"unsure", effort: "high"|"low", reason: string }}
 */
export function decideLocally(text, { hasAttachments = false, smallTalk = false } = {}) {

    const value = clean(text);
    const length = value.length;

    const effort =
        HIGH_EFFORT.some(rule => rule.test(value)) || length > 1500
            ? "high"
            : "low";

    if (String(process.env.NEYO_LOCAL_DECIDE || "").toLowerCase() === "off") {
        return { lane: "unsure", effort, reason: "off" };
    }

    if (smallTalk) {
        return { lane: "direct", effort: "low", reason: "small talk" };
    }

    if (!value || hasAttachments) {
        return { lane: "unsure", effort, reason: hasAttachments ? "attachment" : "empty" };
    }

    const toolRule = NEEDS_TOOLS.find(rule => rule.test(value));
    if (toolRule) {
        return { lane: "tools", effort, reason: `needs tools: ${toolRule.source.slice(0, 30)}` };
    }

    // Names of real things (several Capitalised words in the middle
    // of a sentence) may need fresh facts -> let the planner check.
    const names =
        (value.slice(1).match(/(?:^|[\s,(])[A-Z][a-z]{2,}/g) || []).length;

    const directRule = DIRECT_ASK.find(rule => rule.test(value));

    if (directRule && names <= 2) {
        return { lane: "direct", effort, reason: `direct: ${directRule.source.slice(0, 30)}` };
    }

    // A long text pasted with a short instruction (rewrite, explain
    // this...) and nothing time-sensitive is answered directly.
    if (length > 600 && names <= 4 && /\b(this|is|ye|isko|isay|neeche|below|above|upar)\b/i.test(value.slice(0, 160))) {
        return { lane: "direct", effort, reason: "pasted text" };
    }

    return { lane: "unsure", effort, reason: "planner decides" };

}
