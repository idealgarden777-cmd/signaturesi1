/*
=========================================================
NEYO — TOOL AGENT v1
The model itself decides which tools to use (like ChatGPT):
it can call several tools at once, read the results and call
more tools (chaining), then hands everything to the writer.

Tools (all free):
- web_search       : our own free meta-search + fact check
- read_url         : read one web page
- calculate        : exact math
- get_datetime     : current date/time in any timezone
- convert_currency : live exchange rates (open.er-api.com)
- get_weather      : current weather + 3 days (open-meteo.com)
- code_execution   : Gemini writes and runs its own Python
                     (its "own tool" for anything else)
=========================================================
*/

import vm from "node:vm";
import { runLiveSearch, readUrlText, planDiscovery } from "./deep-research.js";
import { extractFromPage } from "./web-extract.js";
import { deepReason, solveLogic } from "./reasoning.js";
import { createWorkspace, createGraph, runProbability, analyzeJs } from "./power-tools.js";
import { runJsTests, formatTestRun, prepareJs } from "./code-runner.js";

const MAX_ROUNDS = 4;
// Hard reasoning gets more rounds and more time (dynamic budget).
const MAX_ROUNDS_REASONING = 6;
const REASONING_EXTRA_MS = 20000;

const FUNCTION_DECLARATIONS = [
    {
        name: "web_search",
        description: "Search the live web (many engines + Google backup, fact-checked). Use for anything current, factual, about real people/companies/products/places/events, prices, news, or when unsure. Call it several times in parallel for different sub-questions. Pick the mode that fits.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Short English search query, include month and year for current info." },
                mode: { type: "string", enum: ["quick", "news", "deep", "discover"], description: "quick = one fact or short answer (default). news = latest events/headlines, newest first. deep = big, multi-part or high-stakes research: reads many more pages and searches again for gaps (slower). discover = open-ended 'explore / what is out there / ideas / overview of a field': searches many different angles and suggests what to explore next." },
                freshness: { type: "string", enum: ["day", "week", "month", "year", "any"], description: "How recent results must be. day/week for breaking news, prices, scores; month for recent releases; any for timeless facts." },
                site: { type: "string", description: "Optional: limit to one website, e.g. reddit.com, gov.pk, arxiv.org." },
                hard: { type: "boolean", description: "true for difficult, multi-part or high-stakes questions (reads more sources). Same as mode deep but faster." }
            },
            required: ["query"]
        }
    },
    {
        name: "read_url",
        description: "LIVE WEB EXTRACTION: open 1-4 specific web pages and pull out what is needed (when the user gives a link, or a search result needs a closer look: specs, prices, tables, lists, a schedule, the exact wording). Works on most pages, including some that block bots.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string" },
                urls: { type: "array", items: { type: "string" }, description: "Up to 4 pages to read together." },
                focus: { type: "string", description: "What to extract, e.g. 'price and specs', 'fixture dates', 'section 489-F'. Returns the most relevant parts." },
                format: { type: "string", enum: ["text", "tables", "list", "links"], description: "text (default), tables (table rows only), list (bullet items), links (links on the page)." }
            }
        }
    },
    {
        name: "search_memory",
        description: "SEARCH MEMORY: look through what NEYO already found and answered for this user in earlier chats (dated, with the sources used then). Use when the user refers to an earlier chat or research ('pichli baar', 'wo jo pehle dekha tha', 'again', 'remember when'), or to reuse earlier research before searching again. For current facts also call web_search.",
        parameters: {
            type: "object",
            properties: { query: { type: "string", description: "Topic keywords, e.g. 'laptop under 200k', 'Islamabad flats rent'." } },
            required: ["query"]
        }
    },
    {
        name: "calculate",
        description: "Exact arithmetic. Supports + - * / % ^ parentheses and Math functions (sqrt, round, pow, log, sin...).",
        parameters: {
            type: "object",
            properties: { expression: { type: "string", description: "e.g. (393.64-392.76)/392.76*100" } },
            required: ["expression"]
        }
    },
    {
        name: "get_datetime",
        description: "Current date and time in a timezone.",
        parameters: {
            type: "object",
            properties: { timezone: { type: "string", description: "IANA name, e.g. Asia/Karachi. Default Asia/Karachi." } }
        }
    },
    {
        name: "convert_currency",
        description: "Live currency conversion, e.g. USD to PKR.",
        parameters: {
            type: "object",
            properties: {
                amount: { type: "number" },
                from: { type: "string", description: "ISO code, e.g. USD" },
                to: { type: "string", description: "ISO code, e.g. PKR" }
            },
            required: ["from", "to"]
        }
    },
    {
        name: "lookup_law",
        description: "Find the actual law of a country: acts, sections, punishments, rights, rules, taxes, procedures. Searches official law sites (e.g. pakistancode.gov.pk, punjablaws.gov.pk, legislation.gov.uk, law.cornell.edu, indiacode.nic.in). Use for ANY legal question.",
        parameters: {
            type: "object",
            properties: {
                country: { type: "string", description: "Country (and province/state if known), e.g. Pakistan, Punjab Pakistan, UK, USA California. Default Pakistan if the user is Pakistani and does not say." },
                topic: { type: "string", description: "Short English legal topic, e.g. 'punishment for cheque bounce', 'tenant eviction rules', 'khula procedure'." }
            },
            required: ["topic"]
        }
    },
    {
        name: "science_lookup",
        description: "Explain a law, theory or concept of science/maths (physics, chemistry, biology, astronomy, maths): returns an encyclopedia summary with the formula context.",
        parameters: {
            type: "object",
            properties: { topic: { type: "string", description: "e.g. Newton's law of universal gravitation, Ohm's law, photosynthesis" } },
            required: ["topic"]
        }
    },
    {
        name: "physical_constant",
        description: "Exact official (CODATA/SI) value of a physical constant: speed of light, gravitational constant G, Planck, Boltzmann, Avogadro, electron charge/mass, proton mass, gas constant R, standard gravity g, permittivity, Stefan-Boltzmann, standard atmosphere.",
        parameters: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"]
        }
    },
    {
        name: "fix_code",
        description: "Debug and fix the user's code (the code is taken from the user's message automatically, do not copy it). Proves the bugs and the fix with real test runs (JavaScript in a safe sandbox, Python via code execution), fixes every bug and re-tests until the tests pass. Use when the user shares code with an error/bug, asks to fix, debug, run, test or improve code.",
        parameters: {
            type: "object",
            properties: {
                language: { type: "string", description: "e.g. python, javascript, typescript, html, css, sql, java, c++" },
                problem: { type: "string", description: "What is wrong / the error message / what the user wants, in short English." }
            },
            required: ["problem"]
        }
    },
    {
        name: "deep_reason",
        description: "Careful multi-step reasoning with self-check: solves the problem with independent attempts, compares them and verifies all maths with Python. Use for word problems, multi-step calculations, planning, comparisons with numbers, puzzles, proofs and tricky logic. Gather facts first (web_search etc.) and pass them in facts.",
        parameters: {
            type: "object",
            properties: {
                problem: { type: "string", description: "The full problem in clear English, with every number and detail from the user." },
                goal: { type: "string", description: "What exactly must be found or decided." },
                constraints: { type: "string", description: "Rules/limits the answer must respect." },
                facts: { type: "string", description: "Verified facts from other tools (prices, rates, constants) to use." },
                difficulty: { type: "string", enum: ["medium", "hard"], description: "medium = 2-4 clear steps (1 attempt + check). hard = many steps, puzzles, proofs, traps, high stakes (2 attempts + tie-breaker + check)." }
            },
            required: ["problem", "difficulty"]
        }
    },
    {
        name: "solve_logic",
        description: "Z3 theorem prover / constraint solver. Write the problem as an SMT-LIB2 script. Proves exact answers for: logic puzzles, scheduling/timetables, assignments, seating, 'find numbers that satisfy...', systems of equations/inequalities, integer problems, optimisation (maximize/minimize), checking if a claim always holds (assert its negation: unsat = proven).",
        parameters: {
            type: "object",
            properties: {
                smtlib: { type: "string", description: "Complete SMT-LIB2 script: (declare-const x Int) ... (assert ...) ... optional (maximize ...)/(minimize ...) then (check-sat) (get-model). No include/exit." },
                goal: { type: "string", description: "What the script checks, in short English." }
            },
            required: ["smtlib"]
        }
    },
    {
        name: "code_workspace",
        description: "Micro-Git code workspace with AST static analysis. Holds the code from the user's message as files (never runs it). Actions: list | read {path} (numbered lines) | analyze {path} (JS: parse errors, functions, possibly-undefined & unused names, risky patterns, complexity; other languages: light checks) | edit {path, find, replace, all?, message} (exact replace, auto-commit, returns diff + syntax check) | rename {path, from, to} (AST-safe JS rename) | write {path, content} | diff {path, version} | log | revert {version}. Final changed files go to the writer automatically.",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["list", "read", "analyze", "edit", "rename", "write", "diff", "log", "revert"] },
                path: { type: "string" },
                find: { type: "string" },
                replace: { type: "string" },
                all: { type: "boolean" },
                from: { type: "string" },
                to: { type: "string" },
                content: { type: "string" },
                version: { type: "number" },
                message: { type: "string", description: "Commit message." }
            },
            required: ["action"]
        }
    },
    {
        name: "probability",
        description: "Probabilistic programming & Bayesian inference engine (exact, no guessing). mode bayes: hypotheses [{name, prior, likelihoods:[P(each evidence|H)]}] or prior+likelihood+false_positive (medical tests, spam, 'how likely is X given Y'). mode beta_update: successes, failures, prior_a, prior_b, threshold (true rate from data, A/B tests, reviews). mode simulate: Monte Carlo over uncertain variables {name:{dist:normal|uniform|lognormal|triangular|bernoulli|binomial|poisson|exponential|beta|choice|constant, ...params}} with formula and optional condition using 'result' (risk, budgets, chances, ranges).",
        parameters: {
            type: "object",
            properties: {
                mode: { type: "string", enum: ["bayes", "beta_update", "simulate"] },
                hypotheses: { type: "array", items: { type: "object", properties: { name: { type: "string" }, prior: { type: "number" }, likelihoods: { type: "array", items: { type: "number" } } } } },
                prior: { type: "number" },
                likelihood: { type: "number" },
                false_positive: { type: "number" },
                successes: { type: "number" },
                failures: { type: "number" },
                prior_a: { type: "number" },
                prior_b: { type: "number" },
                threshold: { type: "number" },
                variables: { type: "string", description: "JSON text, e.g. {\"price\":{\"dist\":\"normal\",\"mean\":280,\"sd\":5},\"litres\":{\"dist\":\"uniform\",\"min\":40,\"max\":60}} (params: mean sd | min max mode | mu sigma | p n | lambda | rate | a b | values weights | value)" },
                formula: { type: "string", description: "e.g. price*litres" },
                condition: { type: "string", description: "e.g. result > 15000" },
                samples: { type: "number" }
            },
            required: ["mode"]
        }
    },
    {
        name: "knowledge_graph",
        description: "Dynamic mind-map of facts for complex topics, comparisons and research. action add {facts:[{subject, relation, object, source}]} (detects conflicting facts between sources) | query {entity} | path {from, to} | summary {entity?}. The final mind map goes to the writer automatically.",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["add", "query", "path", "summary"] },
                facts: { type: "array", items: { type: "object", properties: { subject: { type: "string" }, relation: { type: "string" }, object: { type: "string" }, source: { type: "string" } } } },
                entity: { type: "string" },
                from: { type: "string" },
                to: { type: "string" }
            },
            required: ["action"]
        }
    },
    {
        name: "get_weather",
        description: "Current weather and 3-day forecast for a city.",
        parameters: {
            type: "object",
            properties: { city: { type: "string", description: "e.g. Lahore" } },
            required: ["city"]
        }
    }
];

// Turns the planner's web_search calls (each with its own mode,
// freshness and site) into one research run with the right depth.
const FRESH_DAYS = { day: 2, week: 8, month: 35, year: 370 };

export function planSearchCalls(searchCalls = []) {
    const args = searchCalls.map(call => call?.args || {});
    const modes = [...new Set(args.map(item => {
        const mode = String(item.mode || "").toLowerCase();
        return ["quick", "news", "deep", "discover"].includes(mode) ? mode : (item.hard ? "deep" : "quick");
    }))];
    const queries = args
        .map(item => {
            const query = String(item.query || "").trim();
            const site = String(item.site || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
            return query && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(site) ? `site:${site} ${query}` : query;
        })
        .filter(Boolean)
        .slice(0, 6);
    const days = args.map(item => FRESH_DAYS[String(item.freshness || "").toLowerCase()]).filter(Boolean);
    const deep = modes.includes("deep");
    const discover = modes.includes("discover");
    const hard = deep || discover || args.some(item => item.hard);
    const options = {
        hard,
        ...(modes.includes("news") ? { news: true } : {}),
        ...(days.length ? { maxAgeDays: Math.min(...days) } : {})
    };
    if (deep) {
        Object.assign(options, { maxPages: 12, pageChars: 4500, totalContextChars: 48000, snippetSources: 14, followUpMinRemainingMs: 9000, verifyChars: 30000, readerFallbacks: 4 });
    } else if (discover) {
        Object.assign(options, { maxPages: 10, pageChars: 3500, totalContextChars: 40000, snippetSources: 14 });
    }
    return { modes, queries, options, budgetMs: deep ? 40000 : discover ? 32000 : hard ? 30000 : 15000 };
}

function plannerInstruction() {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
    return `You are the tool planner of NEYO, an AI assistant. Today is ${today}.
Your job is ONLY to decide which tools to call and gather what is needed. Another model writes the final answer.
- CODE: if the user shares code that has an error/bug, or asks to fix, debug, run, test or correct code, call fix_code (do not copy the code into the call). Plain "how do I write X" questions need no tools.
- If the message is small talk, creative writing, opinions, or general knowledge that does not change, call NO tools and reply exactly: NO_TOOLS
- EFFORT: whenever you reply with text (NO_TOOLS or your final notes), add a last line "EFFORT: high" if writing the answer needs careful step-by-step thinking (maths, logic, code, tricky or high-stakes analysis, long careful writing, anything easy to get wrong), otherwise "EFFORT: low" (chat, simple facts, short answers).
- Otherwise call the tools needed. Call several in parallel when the question has several parts. After results come back, call more tools if something is still missing or needs checking (chaining). For maths on found numbers use calculate or code_execution.
- For anything about a named person, company, product, AI model, price, score, news, law, event, ranking or "latest/top/best/today/now", use web_search (the model's own knowledge is out of date).
- SEARCH IS FLEXIBLE, choose per question (you may mix them in one round):
  * web_search mode quick: one fact. mode news (+ freshness day/week): what happened. mode deep: big research, many parts, money/health decisions, "full report". mode discover: open-ended exploring ("is field ke bare mein batao", ideas, options, what's new in X, top lists).
  * site: when one website is the best source (official site, reddit for opinions, a government site).
  * read_url (live extraction) with focus/format: when a found page or a user link holds the exact detail (price table, specs, schedule, a list). Read up to 4 pages at once.
  * search_memory: when the user points to an earlier chat or research, or the topic was clearly researched before.
  * Plan first for multi-part questions: one web_search per sub-question in parallel, then a second round for anything still missing.
- LAW questions (qanoon, saza, haq, rights, section, act, FIR, divorce/khula, property, tax, visa, job/labour rules, "kya ye legal hai"): ALWAYS call lookup_law with the country (default Pakistan for Pakistani users; add province if known). For several countries call it once per country.
- SCIENCE questions (physics, chemistry, biology, astronomy, maths laws and formulas): use science_lookup for the concept, physical_constant for exact constants, and calculate or code_execution for any numbers. Use web_search for new discoveries.
- You control every tool: combine them freely (e.g. lookup_law + calculate for fines, web_search + convert_currency, science_lookup + code_execution).
- CODE WORKSPACE: when the user shares code, you may call code_workspace analyze first (fast static check, never runs code), then fix_code for running/testing. For small exact fixes or renames use code_workspace edit/rename (each edit is committed and syntax-checked; revert if it breaks). For JavaScript, prefer analyze before fixing.
- PROBABILITY ("chance", "probability", "kitna risk", medical test accuracy, A/B test, odds, uncertain ranges): use the probability tool (bayes / beta_update / simulate) instead of guessing. Combine with deep_reason for explanation if hard.
- KNOWLEDGE MAP: for complex research, comparisons of many things, timelines or relationships, call knowledge_graph add with the key facts you found (with source sites), then summary. It flags facts where sources disagree.
- DIFFICULTY (decide yourself how much thinking a question needs):
  * EASY (one step, simple fact, one formula): no reasoning tool; use calculate if there is any arithmetic.
  * MEDIUM (2-4 steps: word problems, budgets, unit/rate problems, comparisons with numbers, plans): deep_reason difficulty "medium".
  * HARD (many steps, puzzles, riddles with traps, proofs, probability, optimisation, high-stakes money/health decisions): deep_reason difficulty "hard".
  * CONSTRAINTS (puzzles with rules, schedules, who-sits-where, find values that satisfy conditions, max/min with limits, "is this always true"): call solve_logic with a correct SMT-LIB2 script (you may also call deep_reason in parallel to explain it). If Z3 returns an error, fix the script and call again once.
  * Gather missing real-world facts FIRST (web_search, convert_currency, physical_constant), then reason in the next round with those facts.
- When you have enough, reply with a few short notes of what you found (facts with numbers and dates), then the EFFORT line. Do not write the final answer.`;
}

/* ---------------------------------------------------------
   TOOL IMPLEMENTATIONS
   --------------------------------------------------------- */

async function fetchJson(url, timeoutMs = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

function safeCalculate(expression = "") {
    const text = String(expression).slice(0, 300).replace(/\^/g, "**").replace(/×/g, "*").replace(/÷/g, "/").replace(/,/g, "");
    // Only numbers, operators, parentheses, dots, spaces and Math function names.
    const stripped = text.replace(/\b(sqrt|cbrt|abs|round|floor|ceil|pow|log|log10|log2|exp|sin|cos|tan|asin|acos|atan|min|max|PI|E)\b/g, "");
    if (/[^0-9+\-*/%().\s]/.test(stripped)) {
        return { error: "Only plain maths is allowed." };
    }
    const prepared = text.replace(/\b(sqrt|cbrt|abs|round|floor|ceil|pow|log|log10|log2|exp|sin|cos|tan|asin|acos|atan|min|max|PI|E)\b/g, "Math.$1");
    try {
        const value = Function(`"use strict"; return (${prepared});`)();
        return Number.isFinite(value) ? { expression, result: Number(value.toPrecision(12)) } : { error: "Not a finite number." };
    } catch {
        return { error: "Could not calculate." };
    }
}

function getDatetime(timezone = "Asia/Karachi") {
    const zone = String(timezone || "Asia/Karachi");
    try {
        const now = new Date();
        return {
            timezone: zone,
            date: new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now),
            time: new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(now),
            weekday: new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long" }).format(now)
        };
    } catch {
        return { error: "Unknown timezone." };
    }
}

async function convertCurrency({ amount = 1, from = "USD", to = "PKR" } = {}) {
    const base = String(from).toUpperCase().slice(0, 3);
    const target = String(to).toUpperCase().slice(0, 3);
    const data = await fetchJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`);
    const rate = data?.rates?.[target];
    if (!rate) {
        return { error: `No rate for ${base} to ${target}.` };
    }
    const value = Number(amount || 1);
    return {
        from: base,
        to: target,
        rate,
        amount: value,
        result: Number((value * rate).toFixed(4)),
        rates_updated: data.time_last_update_utc || "",
        source: "open.er-api.com (interbank rate; open-market rates in Pakistan can differ)"
    };
}

const WEATHER_CODES = {
    0: "clear", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 80: "rain showers", 81: "rain showers", 82: "violent rain showers",
    95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail"
};

async function getWeather({ city = "Lahore" } = {}) {
    const geo = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(String(city).slice(0, 80))}`);
    const place = geo?.results?.[0];
    if (!place) {
        return { error: `City not found: ${city}` };
    }
    const data = await fetchJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m" +
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&forecast_days=3&timezone=auto"
    );
    const current = data?.current || {};
    const daily = data?.daily || {};
    return {
        place: `${place.name}, ${place.country || ""}`.trim(),
        now: {
            time: current.time,
            temperature_c: current.temperature_2m,
            feels_like_c: current.apparent_temperature,
            humidity: current.relative_humidity_2m,
            wind_kmh: current.wind_speed_10m,
            condition: WEATHER_CODES[current.weather_code] || String(current.weather_code ?? "")
        },
        days: (daily.time || []).map((day, index) => ({
            date: day,
            max_c: daily.temperature_2m_max?.[index],
            min_c: daily.temperature_2m_min?.[index],
            rain_chance: daily.precipitation_probability_max?.[index],
            condition: WEATHER_CODES[daily.weather_code?.[index]] || ""
        })),
        source: "open-meteo.com"
    };
}

/* ---------------------------------------------------------
   LAW + SCIENCE
   --------------------------------------------------------- */

const LAW_SITES = [
    { match: /pakistan|pak\b|lahore|karachi|islamabad|punjab|sindh|kpk|khyber|balochistan/i, sites: ["pakistancode.gov.pk", "punjablaws.gov.pk", "sindhlaws.gov.pk", "kpcode.kp.gov.pk", "na.gov.pk", "supremecourt.gov.pk", "fbr.gov.pk", "secp.gov.pk"] },
    { match: /india|bharat/i, sites: ["indiacode.nic.in", "legislative.gov.in", "indiankanoon.org", "main.sci.gov.in"] },
    { match: /\buk\b|united kingdom|england|britain|scotland|wales/i, sites: ["legislation.gov.uk", "gov.uk", "cps.gov.uk"] },
    { match: /\bus\b|usa|united states|america|california|texas|new york|florida/i, sites: ["law.cornell.edu", "congress.gov", "uscode.house.gov", "usa.gov", "justia.com"] },
    { match: /uae|dubai|abu dhabi|emirates/i, sites: ["u.ae", "uaelegislation.gov.ae", "moj.gov.ae", "dubaicourts.gov.ae"] },
    { match: /saudi|ksa|riyadh/i, sites: ["laws.boe.gov.sa", "my.gov.sa", "moj.gov.sa"] },
    { match: /canada/i, sites: ["laws-lois.justice.gc.ca", "canada.ca"] },
    { match: /australia/i, sites: ["legislation.gov.au", "australia.gov.au"] },
    { match: /\beu\b|europe|european union|germany|france|italy|spain/i, sites: ["eur-lex.europa.eu", "europa.eu", "gesetze-im-internet.de", "legifrance.gouv.fr"] },
    { match: /bangladesh/i, sites: ["bdlaws.minlaw.gov.bd"] },
    { match: /qatar/i, sites: ["almeezan.qa"] },
    { match: /turkey|turkiye/i, sites: ["mevzuat.gov.tr"] },
    { match: /malaysia/i, sites: ["agc.gov.my"] },
    { match: /china/i, sites: ["npc.gov.cn", "english.www.gov.cn"] }
];

const WORLD_LAW_SITES = ["constituteproject.org", "worldlii.org", "ilo.org", "un.org", "refworld.org"];

function lawQueries(country = "", topic = "") {
    const place = String(country || "Pakistan").slice(0, 60);
    const subject = String(topic || "").slice(0, 120);
    const group = LAW_SITES.find(item => item.match.test(place));
    const sites = group ? group.sites : WORLD_LAW_SITES;
    const first = sites.slice(0, 3).map(site => `site:${site}`).join(" OR ");
    // Short queries work best on free engines.
    return [
        `${subject} ${place}`.trim(),
        `${subject} ${first}`,
        `${place} ${subject} law section`
    ];
}

async function scienceLookup({ topic = "" } = {}) {
    const term = String(topic).slice(0, 120);
    const headers = { "User-Agent": "NeyoBot/1.0 (https://neyo.signaturesi.com)" };
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(term)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
        const search = await (await fetch(searchUrl, { headers, signal: controller.signal })).json();
        const title = search?.query?.search?.[0]?.title;
        if (!title) {
            return { error: "Not found." };
        }
        const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&format=json&redirects=1&titles=${encodeURIComponent(title)}`;
        const data = await (await fetch(extractUrl, { headers, signal: controller.signal })).json();
        const page = Object.values(data?.query?.pages || {})[0] || {};
        return {
            title,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
            text: String(page.extract || "").slice(0, 5000),
            source: "Wikipedia"
        };
    } finally {
        clearTimeout(timer);
    }
}

// CODATA 2018 / SI exact values.
const CONSTANTS = [
    { keys: /speed of light|\bc\b|light speed/i, name: "Speed of light in vacuum (c)", value: "299792458", unit: "m/s", exact: true },
    { keys: /gravitational constant|\bbig g\b|newton.*constant/i, name: "Newtonian constant of gravitation (G)", value: "6.67430e-11", unit: "m^3 kg^-1 s^-2", exact: false },
    { keys: /standard gravity|acceleration due to gravity|small g|gravity on earth|g0/i, name: "Standard acceleration of gravity (g)", value: "9.80665", unit: "m/s^2", exact: true },
    { keys: /reduced planck|h ?bar|ħ/i, name: "Reduced Planck constant (ħ)", value: "1.054571817e-34", unit: "J s", exact: true },
    { keys: /planck/i, name: "Planck constant (h)", value: "6.62607015e-34", unit: "J s", exact: true },
    { keys: /boltzmann/i, name: "Boltzmann constant (k)", value: "1.380649e-23", unit: "J/K", exact: true },
    { keys: /avogadro/i, name: "Avogadro constant (N_A)", value: "6.02214076e23", unit: "1/mol", exact: true },
    { keys: /gas constant|\br\b/i, name: "Molar gas constant (R)", value: "8.314462618", unit: "J mol^-1 K^-1", exact: true },
    { keys: /elementary charge|electron charge|charge of electron/i, name: "Elementary charge (e)", value: "1.602176634e-19", unit: "C", exact: true },
    { keys: /electron mass|mass of electron/i, name: "Electron mass (m_e)", value: "9.1093837015e-31", unit: "kg", exact: false },
    { keys: /proton mass|mass of proton/i, name: "Proton mass (m_p)", value: "1.67262192369e-27", unit: "kg", exact: false },
    { keys: /neutron mass|mass of neutron/i, name: "Neutron mass (m_n)", value: "1.67492749804e-27", unit: "kg", exact: false },
    { keys: /permittivity|epsilon/i, name: "Vacuum electric permittivity (ε0)", value: "8.8541878128e-12", unit: "F/m", exact: false },
    { keys: /permeability|mu ?0/i, name: "Vacuum magnetic permeability (μ0)", value: "1.25663706212e-6", unit: "N/A^2", exact: false },
    { keys: /stefan|boltzmann radiation/i, name: "Stefan–Boltzmann constant (σ)", value: "5.670374419e-8", unit: "W m^-2 K^-4", exact: true },
    { keys: /atmosphere|atm/i, name: "Standard atmosphere", value: "101325", unit: "Pa", exact: true },
    { keys: /faraday/i, name: "Faraday constant (F)", value: "96485.33212", unit: "C/mol", exact: true },
    { keys: /electron ?volt|\bev\b/i, name: "Electron volt (eV)", value: "1.602176634e-19", unit: "J", exact: true }
];

function physicalConstant({ name = "" } = {}) {
    const found = CONSTANTS.find(item => item.keys.test(String(name).trim()));
    return found
        ? { ...found, keys: undefined, source: "CODATA 2018 / SI (NIST)" }
        : { error: "Unknown constant. Use science_lookup or web_search." };
}

/* ---------------------------------------------------------
   CODE DOCTOR (find + fix + test bugs)
   --------------------------------------------------------- */

const CODE_MODEL_DEFAULT = "gemini-2.5-flash";

function extractCode(text = "") {
    const blocks = [...String(text).matchAll(/```([\w+#.-]*)\n?([\s\S]*?)```/g)];
    if (blocks.length) {
        return {
            language: blocks[0][1] || "",
            code: blocks.map(block => block[2]).join("\n\n// ----- next block -----\n\n")
        };
    }
    return { language: "", code: String(text) };
}

function guessLanguage(code = "", hint = "") {
    const named = String(hint || "").toLowerCase();
    if (named) {
        return named.replace(/^js$/, "javascript").replace(/^py$/, "python").replace(/^ts$/, "typescript");
    }
    if (/^\s*(def |import |from \w+ import|print\()/m.test(code)) return "python";
    if (/\b(function|const|let|=>|console\.log|document\.)/.test(code)) return "javascript";
    if (/<\/?(div|html|body|script|span)\b/i.test(code)) return "html";
    if (/\bSELECT\b[\s\S]*\bFROM\b/i.test(code)) return "sql";
    return "";
}

// Parse only (never runs the code): safe on the server.
function jsSyntaxCheck(code = "") {
    try {
        new vm.Script(code, { filename: "user-code.js" });
        return "JavaScript syntax check: OK (no syntax errors).";
    } catch (error) {
        const line = String(error?.stack || "").match(/user-code\.js:(\d+)/)?.[1];
        return `JavaScript syntax check: ${error?.name || "Error"}: ${error?.message}${line ? ` (line ${line})` : ""}`;
    }
}

/* ---------- JavaScript: prove the bug, prove the fix ----------
   1. static analysis (acorn) gives hints
   2. code model returns bugs + fixed code + tests (JSON)
   3. tests run on the ORIGINAL (should fail where the bug is)
      and on the FIX (must all pass) in the QuickJS sandbox
   4. failures go back to the model, up to 3 rounds
   ---------------------------------------------------------- */

async function callCodeJson({ apiKey, prompt, timeoutMs }) {
    const models = [process.env.NEYO_CODE_MODEL?.trim() || CODE_MODEL_DEFAULT, "gemini-2.5-flash-lite"];
    let lastError = null;
    for (const model of [...new Set(models)]) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(4000, timeoutMs));
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ role: "user", parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.1, maxOutputTokens: 16000, responseMimeType: "application/json" }
                    }),
                    signal: controller.signal
                }
            );
            if (!response.ok) {
                lastError = new Error(`code model ${model} ${response.status}`);
                continue;
            }
            const data = await response.json();
            const text = (data?.candidates?.[0]?.content?.parts || []).filter(part => part.text && !part.thought).map(part => part.text).join("").trim();
            const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
            if (json && typeof json.fixed_code === "string") {
                return { json, model };
            }
            lastError = new Error("code model returned no fixed_code");
        } catch (error) {
            lastError = error;
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastError || new Error("code model failed");
}

async function fixJavaScript({ apiKey, code, problem, timeoutMs }) {
    const started = Date.now();
    const left = () => timeoutMs - (Date.now() - started);
    const analysis = analyzeJs(prepareJs(code).source);
    const hints = analysis.parses
        ? [
            analysis.possibly_undefined?.length ? `possibly undefined: ${analysis.possibly_undefined.join(", ")}` : "",
            analysis.never_read?.length ? `never read: ${analysis.never_read.join(", ")}` : "",
            analysis.warnings?.length ? `warnings: ${analysis.warnings.join("; ")}` : ""
        ].filter(Boolean).join("\n") || "no static warnings"
        : `SYNTAX ERROR: ${analysis.syntax_error}`;

    const basePrompt = `You are NEYO's code doctor, the best JavaScript debugger. Find and fix EVERY bug in the user's code.
User's problem: ${String(problem || "find and fix bugs").slice(0, 500)}
Static analysis hints (approximate, confirm before trusting):
${hints}

USER CODE:
\`\`\`js
${code}
\`\`\`

Rules:
- Find root causes: syntax, logic, off-by-one, wrong types (string vs number), missing/undefined values, async mistakes, wrong comparisons, edge cases, security issues.
- Keep the user's names, style and structure. Change only what is needed. Never shorten the code.
- Write 4 to 10 tests that call the user's functions. Expected values must come from what the code is SUPPOSED to do (the user's intent), never copied from your fix. Include normal cases, edge cases (empty, zero, negative, strings, missing fields) and one that reproduces the reported problem.
- Each test: "call" is ONE JavaScript expression (e.g. total([{price: "10"}])), "expected" is a JavaScript expression of the right result (e.g. 10, "abc", [1,2], {a:1}) or "THROWS" if it should throw. No DOM, no network, no timers.
- If the code has no callable functions (only DOM work), return "tests": [].

Reply with JSON only:
{"bugs":[{"where":"line N / function","problem":"what is wrong","fix":"what you changed"}],"fixed_code":"<complete fixed code>","tests":[{"name":"short","call":"...","expected":"..."}]}`;

    let prompt = basePrompt;
    let best = null;
    const history = [];
    for (let round = 1; round <= 3 && left() > 6000; round += 1) {
        let reply;
        try {
            reply = await callCodeJson({ apiKey, prompt, timeoutMs: Math.min(30000, left() - 2000) });
        } catch (error) {
            history.push(`round ${round}: model error ${error?.message || error}`);
            break;
        }
        const { json, model } = reply;
        const tests = Array.isArray(json.tests) ? json.tests.slice(0, 12) : [];
        const fixedRun = await runJsTests(json.fixed_code, tests);
        const originalRun = await runJsTests(code, tests);
        const candidate = { json, model, tests, fixedRun, originalRun, round };
        const fixedOk = fixedRun.ran && !fixedRun.loadError && fixedRun.passed === fixedRun.total;
        if (!best || (fixedRun.passed || 0) - (fixedRun.total || 0) >= (best.fixedRun.passed || 0) - (best.fixedRun.total || 0)) {
            best = candidate;
        }
        history.push(`round ${round}: fix ${fixedRun.ran ? `${fixedRun.passed}/${fixedRun.total}` : "not run"}, original ${originalRun.ran ? `${originalRun.passed}/${originalRun.total}` : "not run"}`);
        if (!fixedRun.ran) {
            break;
        }
        const originalAllPass = originalRun.ran && !originalRun.loadError && originalRun.total > 0 && originalRun.passed === originalRun.total;
        const claimsBugs = Array.isArray(json.bugs) && json.bugs.length > 0;
        if (fixedOk && !(originalAllPass && claimsBugs && round === 1 && tests.length)) {
            break;
        }
        prompt = `${basePrompt}

YOUR PREVIOUS ANSWER (round ${round}):
${JSON.stringify({ bugs: json.bugs, fixed_code: json.fixed_code, tests }).slice(0, 14000)}

REAL SANDBOX RESULTS:
${formatTestRun("Your FIXED code", fixedRun)}
${formatTestRun("The ORIGINAL code", originalRun)}
${fixedOk ? "Your fix passes, but the ORIGINAL code also passes every test, so the tests do not reproduce the bugs you claim. Add tests that fail on the original." : "Some tests FAILED on your fix. Decide honestly for each failure: is the fixed code wrong, or was the expected value wrong? Correct it."}
Return the complete JSON again.`;
    }

    if (!best) {
        return { error: history.join("; ") || "code doctor failed" };
    }
    const { json, fixedRun, originalRun, model } = best;
    const allPass = fixedRun.ran && !fixedRun.loadError && fixedRun.total > 0 && fixedRun.passed === fixedRun.total;
    const bugs = (Array.isArray(json.bugs) ? json.bugs : []).slice(0, 15)
        .map(bug => `- ${bug.where || "?"}: ${bug.problem || ""} -> ${bug.fix || ""}`).join("\n") || "- (none listed)";
    const testsLine = !fixedRun.ran
        ? `NOT RUN (${fixedRun.reason})`
        : fixedRun.total === 0
            ? "NOT RUN (no callable functions to test; loaded in sandbox " + (fixedRun.loadError ? `with error: ${fixedRun.loadError.split("\n")[0]}` : "without errors") + ")"
            : allPass
                ? `PASSED (${fixedRun.passed}/${fixedRun.total} tests run in a JavaScript sandbox; the original code passed ${originalRun.ran ? `${originalRun.passed}/${originalRun.total}` : "n/a"})`
                : `FAILED (${fixedRun.passed}/${fixedRun.total} passed after ${best.round} rounds)`;
    const report = `BUGS:
${bugs}
FIXED CODE:
\`\`\`javascript
${json.fixed_code}
\`\`\`
TESTS: ${testsLine}`;
    const runs = [];
    if (fixedRun.ran) {
        runs.push(formatTestRun("ORIGINAL code", originalRun));
        runs.push(formatTestRun("FIXED code", fixedRun));
    }
    console.log("[CODE_DOCTOR] js", history.join(" | "), `${Date.now() - started}ms`);
    return { report, runs, model, history };
}

async function fixCode({ apiKey, question, args = {}, timeoutMs = 35000 }) {
    const found = extractCode(question);
    const code = found.code.slice(0, 30000);
    const language = guessLanguage(code, args.language || found.language);

    if (/^(javascript|js|node|nodejs)$/.test(language) && !prepareJs(code).blockers.length && process.env.NEYO_JS_SANDBOX !== "off") {
        try {
            const result = await fixJavaScript({ apiKey, code, problem: args.problem, timeoutMs });
            if (result.report) {
                return { language: "javascript", checks: [jsSyntaxCheck(prepareJs(code).source)], report: result.report.slice(0, 24000), runs: result.runs, model: result.model };
            }
            console.warn("[CODE_DOCTOR] js path failed, using classic doctor:", result.error);
        } catch (error) {
            console.warn("[CODE_DOCTOR] js path crashed, using classic doctor:", error?.message || error);
        }
    }
    const checks = [];
    if (/javascript|^js$|node/.test(language) && !/<[A-Za-z][^>]*>/.test(code) && !/^\s*(import|export)\b/m.test(code)) {
        checks.push(jsSyntaxCheck(code));
    }
    if (/json/.test(language)) {
        try {
            JSON.parse(code);
            checks.push("JSON check: valid.");
        } catch (error) {
            checks.push(`JSON check: ${error.message}`);
        }
    }

    const prompt = `You are NEYO's code doctor. Fix the user's code.
Language: ${language || "detect it"}
User's problem: ${String(args.problem || "find and fix bugs").slice(0, 500)}
${checks.length ? `Automatic checks:\n${checks.join("\n")}\n` : ""}
User message with the code:
${code}

Steps:
1. Find EVERY bug (syntax, logic, edge cases, wrong output, security issues). Find the root cause, not just the symptom.
2. If it is Python: RUN the original with the code execution tool to see the real error, then run the fixed version with small tests until they pass.
   If it is another language: you cannot run it directly. Reason line by line. When the bug is in the logic/algorithm, re-write that logic in Python and run tests on it to prove the fix.
3. Keep the user's style, names and structure. Change only what is needed.

Reply in exactly this format:
BUGS:
- <line or place>: <what was wrong> -> <fix>
FIXED CODE:
\`\`\`<language>
<the complete fixed code, never shortened, no "..." placeholders>
\`\`\`
TESTS: <PASSED (what was run) | FAILED (why) | NOT RUN (why)>`;

    const models = [process.env.NEYO_CODE_MODEL?.trim() || CODE_MODEL_DEFAULT, "gemini-2.5-flash-lite"];
    let lastError = null;
    for (const model of [...new Set(models)]) {
        for (const withCode of [true, false]) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const body = {
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 12000 }
                };
                if (withCode) {
                    body.tools = [{ codeExecution: {} }];
                }
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
                    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal }
                );
                if (!response.ok) {
                    lastError = new Error(`code model ${model} ${response.status}`);
                    lastError.status = response.status;
                    if (response.status === 400 && withCode) {
                        continue;
                    }
                    break;
                }
                const data = await response.json();
                const parts = data?.candidates?.[0]?.content?.parts || [];
                const runs = [];
                parts.forEach(part => {
                    if (part.executableCode?.code) {
                        runs.push(`Ran:\n${String(part.executableCode.code).slice(0, 1200)}`);
                    }
                    if (part.codeExecutionResult) {
                        runs.push(`Result (${part.codeExecutionResult.outcome || "OK"}):\n${String(part.codeExecutionResult.output || "").slice(0, 1200)}`);
                    }
                });
                const report = parts.filter(part => part.text && !part.thought).map(part => part.text).join("\n").trim();
                if (report) {
                    return { language, checks, report: report.slice(0, 24000), runs: runs.slice(-6), model };
                }
            } catch (error) {
                lastError = error;
            } finally {
                clearTimeout(timer);
            }
        }
    }
    return { language, checks, error: String(lastError?.message || "Code doctor failed.") };
}

/* ---------------------------------------------------------
   GEMINI CALL
   --------------------------------------------------------- */

// Safety net: if the API ever rejects the new tool schemas, retry with the proven core set.
const CORE_TOOL_NAMES = new Set(["web_search", "read_url", "search_memory", "calculate", "get_datetime", "convert_currency", "lookup_law", "science_lookup", "physical_constant", "fix_code", "get_weather"]);

async function callPlanner({ apiKey, model, contents, withCode, timeoutMs, coreOnly = false, extraTools = null, hidden = null }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const baseTools = (coreOnly ? FUNCTION_DECLARATIONS.filter(item => CORE_TOOL_NAMES.has(item.name)) : FUNCTION_DECLARATIONS)
        .filter(item => !hidden?.has(item.name));
    // Connected apps (MCP) stay even in core mode: the user asked about them.
    const tools = [{ functionDeclarations: extraTools?.declarations?.length ? [...baseTools, ...extraTools.declarations] : baseTools }];
    if (withCode) {
        tools.push({ codeExecution: {} });
    }
    const generationConfig = { temperature: 0.1, maxOutputTokens: 3000 };
    if (/gemini-3/i.test(model)) {
        generationConfig.thinkingConfig = { thinkingLevel: "low" };
    } else if (/gemini-2\.5/i.test(model)) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: plannerInstruction() + (extraTools?.instruction ? `\n\n${extraTools.instruction}` : "") }] },
                    contents,
                    tools,
                    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
                    generationConfig
                }),
                signal: controller.signal
            }
        );
        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            const error = new Error(`planner ${response.status}: ${detail.slice(0, 200)}`);
            error.status = response.status;
            throw error;
        }
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

/* ---------------------------------------------------------
   AGENT LOOP
   --------------------------------------------------------- */

/**
 * Lets the model pick and chain tools.
 * Returns { used, toolText, research, sources, calls } or throws
 * (caller falls back to the old search router).
 */
export async function runToolAgent({
    question,
    context = "",
    apiKey,
    model,
    plannerModel,
    groundingModel = "",
    onStatus = () => {},
    extraTools = null,
    memorySearch = null,
    budgetMs = Number(process.env.NEYO_AGENT_MAX_MS) || 150000
} = {}) {
    if (!apiKey || !model || !question) {
        throw new Error("tool agent not configured");
    }
    const started = Date.now();
    const status = (stage, info = {}) => {
        try {
            onStatus(stage, info);
        } catch {}
    };

    const contents = [{
        role: "user",
        parts: [{ text: (context ? `Recent chat:\n${context}\n\n` : "") + `User message:\n${String(question).slice(0, 4000)}` }]
    }];

    let withCode = true;
    let coreOnly = false;
    let dropExtra = false;
    const toolNotes = [];
    const sources = [];
    const calls = [];
    let research = null;
    let usedAny = false;
    let legalUsed = false;
    let codeUsed = false;
    let codeReport = "";
    let maxRounds = MAX_ROUNDS;
    let budget = budgetMs;
    let plannerEffort = "";
    const reasoningNotes = [];
    const searchStyles = [];
    const exploreIdeas = [];
    // search_memory only when this chat may read earlier chats (not Private Chat).
    const hidden = typeof memorySearch === "function" ? null : new Set(["search_memory"]);
    const workspace = createWorkspace(question);
    const graph = createGraph();

    for (let round = 0; round < maxRounds; round += 1) {
        const remaining = budget - (Date.now() - started);
        if (remaining < 4000) {
            break;
        }
        let data;
        try {
            data = await callPlanner({ apiKey, model, contents, withCode, coreOnly, hidden, extraTools: dropExtra ? null : extraTools, timeoutMs: Math.min(12000, remaining) });
        } catch (error) {
            // Some models can't mix code execution with function calling: retry without it.
            if (withCode && error?.status === 400) {
                withCode = false;
                round -= 1;
                continue;
            }
            if (!coreOnly && error?.status === 400) {
                console.warn("[TOOL_AGENT] new tools rejected, using core tools", error?.message || error);
                coreOnly = true;
                round -= 1;
                continue;
            }
            if (extraTools && !dropExtra && error?.status === 400) {
                console.warn("[TOOL_AGENT] app (MCP) tools rejected", error?.message || error);
                dropExtra = true;
                round -= 1;
                continue;
            }
            if (round === 0) {
                throw error;
            }
            break;
        }

        const content = data?.candidates?.[0]?.content;
        const parts = content?.parts || [];

        // Code the model wrote and ran itself.
        parts.forEach(part => {
            if (part.executableCode?.code) {
                usedAny = true;
                toolNotes.push(`Python code Neyo ran:\n${String(part.executableCode.code).slice(0, 1500)}`);
            }
            if (part.codeExecutionResult) {
                toolNotes.push(`Code result (${part.codeExecutionResult.outcome || "OK"}):\n${String(part.codeExecutionResult.output || "").slice(0, 1500)}`);
            }
        });

        const functionCalls = parts.filter(part => part.functionCall).map(part => part.functionCall);
        const roundText = parts.filter(part => part.text && !part.thought).map(part => part.text).join("");
        const effortMatch = roundText.match(/EFFORT:\s*(high|low)/i);
        if (effortMatch) {
            plannerEffort = effortMatch[1].toLowerCase();
        }
        if (!functionCalls.length) {
            const text = roundText.replace(/EFFORT:\s*(high|low)/gi, "").trim();
            if (round === 0 && !usedAny && /NO_TOOLS/i.test(text)) {
                return { used: false, toolText: "", research: null, sources: [], calls, effort: plannerEffort || "low" };
            }
            if (text && !/NO_TOOLS/i.test(text)) {
                toolNotes.push(`Planner notes:\n${text.slice(0, 1500)}`);
            }
            break;
        }

        usedAny = true;
        contents.push(content);

        // Dynamic budget: reasoning questions get more rounds and time.
        if (maxRounds === MAX_ROUNDS && functionCalls.some(call => call.name === "deep_reason" || call.name === "solve_logic")) {
            maxRounds = MAX_ROUNDS_REASONING;
            budget = budgetMs + REASONING_EXTRA_MS;
        }

        // Run all web searches of this round together (one fact-checked research).
        // STRUCTURE: every tool of this round starts at the same moment.
        // Searches are batched into one fact-checked research, law
        // lookups run one per country, everything else runs on its own;
        // none waits for another. Identical calls are run once.
        const roundStarted = Date.now();
        const searchCalls = functionCalls.filter(call => call.name === "web_search");
        const searchPromise = (async () => {
        let searchSummary = null;
        if (searchCalls.length) {
            const plan = planSearchCalls(searchCalls);
            let queries = plan.queries;
            let explore = [];
            if (plan.modes.includes("discover")) {
                status("planning");
                const discovery = await planDiscovery(question, context, { apiKey, plannerModel: plannerModel || model }).catch(() => null);
                if (discovery?.queries?.length) {
                    const seen = new Set(queries.map(item => item.toLowerCase()));
                    queries = queries.concat(discovery.queries.filter(item => !seen.has(item.toLowerCase()))).slice(0, 6);
                }
                explore = discovery?.explore || [];
            }
            status("searching", { queries });
            const left = budgetMs - (Date.now() - started) - 3000;
            const result = await runLiveSearch({
                question,
                context,
                apiKey,
                plannerModel: plannerModel || model,
                groundingModel,
                options: {
                    queries,
                    ...plan.options,
                    maxQueries: Math.max(queries.length, 3),
                    budgetMs: Math.max(8000, Math.min(plan.budgetMs, left))
                },
                onStatus: status
            }).catch(error => {
                console.warn("[TOOL_AGENT] search failed", error?.message || error);
                return null;
            });
            if (result) {
                result.styles = plan.modes;
                result.explore = explore;
                searchStyles.push(...plan.modes);
                exploreIdeas.push(...explore);
            }
            if (result?.contextText) {
                research = research
                    ? {
                        ...result,
                        contextText: `${research.contextText}\n\n=== MORE RESULTS ===\n${result.contextText}`,
                        sources: [...research.sources, ...result.sources]
                    }
                    : result;
                result.sources.forEach(source => sources.push(source));
                searchSummary = {
                    mode: plan.modes.join(","),
                    ...(explore.length ? { explore_next: explore } : {}),
                    fact_check: (result.factSheet || "").slice(0, 2500),
                    top_sources: result.sources.slice(0, 6).map((item, index) => ({
                        n: index + 1,
                        title: item.title,
                        site: (() => { try { return new URL(item.url).hostname; } catch { return ""; } })(),
                        published: item.published,
                        snippet: item.snippet
                    }))
                };
            } else {
                searchSummary = { error: "No results found." };
            }
        }
        return searchSummary;
        })();

        // Law lookups: one fact-checked search per country on official law sites.
        const lawCalls = functionCalls.filter(call => call.name === "lookup_law");
        const lawPromise = Promise.all(lawCalls.map(async call => {
            const queries = lawQueries(call.args?.country, call.args?.topic);
            status("searching", { queries: queries.slice(0, 2) });
            const result = await runLiveSearch({
                question: `${call.args?.country || "Pakistan"} law: ${call.args?.topic || question}`,
                context,
                apiKey,
                plannerModel: plannerModel || model,
                groundingModel,
                options: { queries, hard: true, budgetMs: Math.max(8000, Math.min(25000, budgetMs - (Date.now() - started) - 3000)) },
                onStatus: status
            }).catch(() => null);
            if (!result?.sources?.length) {
                const wiki = await scienceLookup({ topic: `${call.args?.topic || ""} ${call.args?.country || "Pakistan"} law` }).catch(() => null);
                legalUsed = true;
                if (wiki?.text) {
                    toolNotes.push(`Law background (encyclopedia, not the official text) ${wiki.title}:\n${wiki.text.slice(0, 2500)}`);
                    sources.push({ title: `${wiki.title} - Wikipedia`, url: wiki.url, published: "", snippet: wiki.text.slice(0, 200) });
                    return { note: "Official text not found; encyclopedia background only. Do not quote exact punishments unless sure.", background: wiki.text.slice(0, 2500) };
                }
                return { error: "No official law text found. Say you could not confirm the exact section." };
            }
            research = research
                ? { ...result, contextText: `${research.contextText}\n\n=== LAW RESULTS ===\n${result.contextText}`, sources: [...research.sources, ...result.sources] }
                : { ...result, contextText: `=== LAW RESULTS ===\n${result.contextText}` };
            result.sources.forEach(source => sources.push(source));
            legalUsed = true;
            return {
                fact_check: (result.factSheet || "").slice(0, 2500),
                sources: result.sources.slice(0, 6).map((item, index) => ({ n: index + 1, title: item.title, url: item.url, published: item.published, snippet: item.snippet }))
            };
        }));

        let lawIndex = 0;
        const sameCall = new Map();
        const toolTimes = [];
        const responses = await Promise.all(functionCalls.map(async call => {
            const args = call.args || {};
            calls.push(call.name);
            const myLaw = call.name === "lookup_law" ? lawIndex++ : -1;
            const key = `${call.name}:${JSON.stringify(args)}`;
            const shared = !["web_search", "lookup_law"].includes(call.name) && sameCall.has(key);
            let output;
            const toolStarted = Date.now();
            let settle = () => {};
            if (!shared && !["web_search", "lookup_law"].includes(call.name)) {
                sameCall.set(key, new Promise(resolve => { settle = resolve; }));
            }
            try {
                if (shared) {
                    output = await sameCall.get(key);
                } else if (call.name === "web_search") {
                    output = await searchPromise;
                } else if (call.name === "lookup_law") {
                    output = (await lawPromise)[myLaw];
                } else if (extraTools?.has?.(call.name)) {
                    status("searching", { queries: [call.name.replace(/_/g, " ")] });
                    output = await extraTools.run(call.name, args);
                } else if (call.name === "science_lookup") {
                    status("reading", { count: 1 });
                    output = await scienceLookup(args);
                    if (output?.url) {
                        sources.push({ title: `${output.title} - Wikipedia`, url: output.url, published: "", snippet: String(output.text || "").slice(0, 200) });
                    }
                } else if (call.name === "fix_code") {
                    status("thinking");
                    const doctor = await fixCode({
                        apiKey,
                        question,
                        args,
                        timeoutMs: Math.max(10000, budget - (Date.now() - started))
                    });
                    codeUsed = true;
                    if (doctor.report) {
                        codeReport = `=== CODE DOCTOR REPORT (language: ${doctor.language || "unknown"}) ===\n` +
                            (doctor.checks.length ? `${doctor.checks.join("\n")}\n\n` : "") +
                            (doctor.runs.length ? `Code actually executed:\n${doctor.runs.join("\n\n")}\n\n` : "Code was not executed.\n\n") +
                            doctor.report;
                        output = { done: true, tests: (doctor.report.match(/TESTS:\s*([^\n]+)/) || [])[1] || "unknown", note: "Full fixed code is passed to the writer. Do not call fix_code again." };
                    } else {
                        output = { error: doctor.error, checks: doctor.checks };
                    }
                } else if (call.name === "deep_reason") {
                    const result = await deepReason({
                        apiKey,
                        question,
                        args,
                        timeoutMs: Math.max(6000, Math.min(90000, budget - (Date.now() - started) - 2000)),
                        onStatus: status
                    });
                    if (result.final) {
                        reasoningNotes.push(`=== REASONING RESULT (${result.difficulty}, ${result.attempts} independent attempt(s), answers ${result.agreement}${result.check ? `, Python check: ${result.check.python}` : ", not checked"}) ===
Approach: ${result.approach}
Assumptions: ${result.assumptions || "NONE"}
Key steps:
${result.steps}
FINAL (${result.verified ? "VERIFIED" : "not verified"}): ${result.final}
Confidence: ${result.confidence}${result.other_answers.length ? `\nOther attempt said: ${result.other_answers.join(" | ")}` : ""}${result.check?.issues && !/^none/i.test(result.check.issues) ? `\nChecker found: ${result.check.issues}` : ""}${result.check?.python_output ? `\nPython output: ${result.check.python_output}` : ""}`);
                        output = { final: result.final, verified: result.verified, agreement: result.agreement, confidence: result.confidence, note: "Full reasoning is passed to the writer. Do not call deep_reason again for the same problem." };
                    } else {
                        output = result;
                    }
                } else if (call.name === "solve_logic") {
                    status("solving");
                    output = await solveLogic({ args, timeoutMs: Math.max(3000, Math.min(9000, budget - (Date.now() - started) - 1500)) });
                    if (output.status === "sat" || output.status === "unsat") {
                        reasoningNotes.push(`=== Z3 SOLVER (mathematically checked) ===
Goal: ${output.goal || "-"}
Result: ${output.status.toUpperCase()} - ${output.meaning}
${output.output}`);
                    }
                } else if (call.name === "code_workspace") {
                    status("analyzing");
                    output = workspace.run(args);
                } else if (call.name === "probability") {
                    status("checking");
                    output = runProbability(args);
                } else if (call.name === "knowledge_graph") {
                    status("mapping");
                    output = graph.run(args);
                } else if (call.name === "physical_constant") {
                    output = physicalConstant(args);
                } else if (call.name === "calculate") {
                    status("thinking");
                    output = safeCalculate(args.expression);
                } else if (call.name === "get_datetime") {
                    output = getDatetime(args.timezone);
                } else if (call.name === "convert_currency") {
                    status("searching", { queries: [`${args.from} to ${args.to}`] });
                    output = await convertCurrency(args);
                } else if (call.name === "get_weather") {
                    status("searching", { queries: [`weather ${args.city}`] });
                    output = await getWeather(args);
                } else if (call.name === "read_url") {
                    const urls = [...new Set([args.url, ...(Array.isArray(args.urls) ? args.urls : [])].map(item => String(item || "").trim()).filter(Boolean))].slice(0, 4);
                    status("reading", { count: urls.length });
                    const pages = await Promise.all(urls.map(async url => {
                        const page = await readUrlText(url).catch(() => null);
                        if (!page?.text) {
                            return { url, error: "Could not read page." };
                        }
                        sources.push({ title: page.title || url, url: page.finalUrl || url, published: page.published || "", snippet: String(page.text).slice(0, 200) });
                        return { url: page.finalUrl || url, title: page.title || "", published: page.published || "", ...extractFromPage(page, { focus: args.focus, format: args.format, maxChars: urls.length > 1 ? 3000 : 6000 }) };
                    }));
                    output = urls.length ? (pages.length === 1 ? pages[0] : { pages }) : { error: "No url given." };
                } else if (call.name === "search_memory") {
                    status("searching", { queries: [`memory: ${args.query || ""}`] });
                    output = typeof memorySearch === "function"
                        ? await memorySearch(String(args.query || question))
                        : { error: "Search memory is off in this chat." };
                    if (output?.found) {
                        searchStyles.push("memory");
                        output.results.forEach(item => item.sources?.forEach(source => sources.push({ title: source.title || source.url, url: source.url, published: item.date, snippet: `From an earlier chat (${item.date})` })));
                    }
                } else {
                    output = { error: "Unknown tool." };
                }
            } catch (error) {
                output = { error: String(error?.message || error).slice(0, 200) };
            }
            settle(output);
            toolTimes.push(`${call.name}${shared ? "(same)" : ""}=${Date.now() - toolStarted}ms`);
            if (shared) {
                return { functionResponse: { name: call.name, response: { result: output } } };
            }
            if (!["web_search", "lookup_law", "deep_reason"].includes(call.name) && !(call.name === "solve_logic" && reasoningNotes.length && (output?.status === "sat" || output?.status === "unsat"))) {
                toolNotes.push(`Tool ${call.name}(${JSON.stringify(args).slice(0, 200)}) →\n${JSON.stringify(output).slice(0, extraTools?.has?.(call.name) || call.name === "read_url" ? 9000 : call.name === "search_memory" ? 5000 : 2000)}`);
            }
            return { functionResponse: { name: call.name, response: { result: output } } };
        }));

        console.log(`[TOOL_ROUND ${round}]`, toolTimes.join(" "), `total=${Date.now() - roundStarted}ms`);
        contents.push({ role: "user", parts: responses });
    }

    console.log("[TOOL_AGENT]", calls.join(",") || "none", `${Date.now() - started}ms`);

    if (!usedAny) {
        return { used: false, toolText: "", research: null, sources: [], calls, effort: plannerEffort || "low" };
    }

    const legalRules = legalUsed
        ? `=== LEGAL ANSWER RULES ===
- Name the exact law, act and section/article number from the LAW RESULTS, and the punishment/fine exactly as written. Never invent a section number.
- Say which country/province it applies to; laws differ by place. Mention the latest amendment if a result shows one.
- If the sources don't show the exact section, say so clearly instead of guessing.
- End with one short line: this is general legal information, not legal advice; for a real case talk to a lawyer.

`
        : "";
    const codeRules = codeUsed
        ? `${codeReport}

=== CODE ANSWER RULES ===
- Start with a short list of the bugs found (what was wrong and why), in the user's language.
- Then give the COMPLETE fixed code in one code block (never shorten it, no "..." placeholders), taken from the CODE DOCTOR REPORT; double-check it yourself.
- If the report shows ORIGINAL vs FIXED test runs, add one short line like "Original code: 1/5 tests passed, fixed code: 5/5 passed (run in a sandbox)" and a tiny list of the most telling tests.
- Say "tested" only if TESTS says PASSED and code was actually executed. Otherwise say it was checked but not run, and how the user can test it.
- If the doctor failed, fix the code yourself carefully and say it was not run.

`
        : "";
    const reasoningRules = reasoningNotes.length
        ? `${reasoningNotes.join("\n\n")}

=== REASONING ANSWER RULES ===
- Give the FINAL answer first, then a short clear working (main steps with numbers) in the user's language. Do not copy the internal format.
- If the result is VERIFIED or from Z3 (sat/unsat), state it confidently. A Z3 "unsat" means proven impossible (or the checked claim is proven true).
- If attempts disagreed or it is not verified, say which answer is most likely and what is uncertain.
- Mention assumptions that change the answer. Never invent extra numbers.

`
        : "";
    const workspaceReport = workspace.report();
    const graphReport = graph.report();
    const powerRules = (workspaceReport ? `${workspaceReport}

=== WORKSPACE RULES ===
- The FINAL CODE above is the edited version (syntax status shown). Give it complete in one code block and explain the changes briefly.

` : "") + (graphReport ? `${graphReport}

=== MIND MAP RULES ===
- Use the map to organise the answer (main topic -> branches). If the user asked for a mind map, show it as a nested bullet list. Mention conflicts honestly.

` : "");
    const toolText = codeRules + reasoningRules + powerRules + (toolNotes.length
        ? `=== TOOL RESULTS (exact, computed just now) ===\n${toolNotes.join("\n\n")}\n\n`
        : "") + legalRules;

    // Answers built on reasoning / maths / code / law get a final self-review.
    // The writer thinks (high effort) when the planner asks for it or
    // when the answer rests on reasoning / code / law tools.
    const HEAVY_TOOLS = ["deep_reason", "solve_logic", "probability", "code_workspace", "fix_code", "lookup_law", "knowledge_graph"];
    const review = calls.some(name => HEAVY_TOOLS.includes(name)) || toolNotes.some(note => note.startsWith("Python code Neyo ran"));
    const effort = review || plannerEffort === "high" ? "high" : "low";

    return {
        used: true,
        toolText,
        research,
        styles: [...new Set(searchStyles)],
        explore: [...new Set(exploreIdeas)].slice(0, 3),
        sources,
        calls,
        review,
        effort
    };
}
