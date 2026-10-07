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

import { runLiveSearch, readUrlText } from "./deep-research.js";

const MAX_ROUNDS = 4;

const FUNCTION_DECLARATIONS = [
    {
        name: "web_search",
        description: "Search the live web (free meta-search across many engines, fact-checked). Use for anything current, factual, about real people/companies/products/places/events, prices, news, or when unsure. Call it several times in parallel for different sub-questions.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Short English search query, include month and year for current info." },
                hard: { type: "boolean", description: "true for difficult, multi-part or high-stakes questions (reads more sources)." }
            },
            required: ["query"]
        }
    },
    {
        name: "read_url",
        description: "Read the text of one specific web page (when the user gives a link or a result needs a closer look).",
        parameters: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"]
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
        name: "get_weather",
        description: "Current weather and 3-day forecast for a city.",
        parameters: {
            type: "object",
            properties: { city: { type: "string", description: "e.g. Lahore" } },
            required: ["city"]
        }
    }
];

function plannerInstruction() {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
    return `You are the tool planner of NEYO, an AI assistant. Today is ${today}.
Your job is ONLY to decide which tools to call and gather what is needed. Another model writes the final answer.
- If the message is small talk, creative writing, coding help, opinions, or general knowledge that does not change, call NO tools and reply exactly: NO_TOOLS
- Otherwise call the tools needed. Call several in parallel when the question has several parts. After results come back, call more tools if something is still missing or needs checking (chaining). For maths on found numbers use calculate or code_execution.
- For anything about a named person, company, product, AI model, price, score, news, law, event or "latest/today/now", use web_search (the model's own knowledge is out of date).
- LAW questions (qanoon, saza, haq, rights, section, act, FIR, divorce/khula, property, tax, visa, job/labour rules, "kya ye legal hai"): ALWAYS call lookup_law with the country (default Pakistan for Pakistani users; add province if known). For several countries call it once per country.
- SCIENCE questions (physics, chemistry, biology, astronomy, maths laws and formulas): use science_lookup for the concept, physical_constant for exact constants, and calculate or code_execution for any numbers. Use web_search for new discoveries.
- You control every tool: combine them freely (e.g. lookup_law + calculate for fines, web_search + convert_currency, science_lookup + code_execution).
- When you have enough, reply with a few short notes of what you found (facts with numbers and dates). Do not write the final answer.`;
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
   GEMINI CALL
   --------------------------------------------------------- */

async function callPlanner({ apiKey, model, contents, withCode, timeoutMs }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const tools = [{ functionDeclarations: FUNCTION_DECLARATIONS }];
    if (withCode) {
        tools.push({ codeExecution: {} });
    }
    const generationConfig = { temperature: 0.1, maxOutputTokens: 1200 };
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
                    systemInstruction: { parts: [{ text: plannerInstruction() }] },
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
    budgetMs = 40000
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
    const toolNotes = [];
    const sources = [];
    const calls = [];
    let research = null;
    let usedAny = false;
    let legalUsed = false;

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const remaining = budgetMs - (Date.now() - started);
        if (remaining < 4000) {
            break;
        }
        let data;
        try {
            data = await callPlanner({ apiKey, model, contents, withCode, timeoutMs: Math.min(12000, remaining) });
        } catch (error) {
            // Some models can't mix code execution with function calling: retry without it.
            if (withCode && error?.status === 400) {
                withCode = false;
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
        if (!functionCalls.length) {
            const text = parts.filter(part => part.text && !part.thought).map(part => part.text).join("").trim();
            if (round === 0 && !usedAny && /NO_TOOLS/i.test(text)) {
                return { used: false, toolText: "", research: null, sources: [], calls };
            }
            if (text && !/NO_TOOLS/i.test(text)) {
                toolNotes.push(`Planner notes:\n${text.slice(0, 1500)}`);
            }
            break;
        }

        usedAny = true;
        contents.push(content);

        // Run all web searches of this round together (one fact-checked research).
        const searchCalls = functionCalls.filter(call => call.name === "web_search");
        let searchSummary = null;
        if (searchCalls.length) {
            const queries = searchCalls.map(call => String(call.args?.query || "").trim()).filter(Boolean).slice(0, 5);
            const hard = searchCalls.some(call => call.args?.hard);
            status("searching", { queries });
            const result = await runLiveSearch({
                question,
                context,
                apiKey,
                plannerModel: plannerModel || model,
                groundingModel,
                options: { queries, hard, budgetMs: Math.max(8000, Math.min(hard ? 30000 : 15000, budgetMs - (Date.now() - started) - 3000)) },
                onStatus: status
            }).catch(error => {
                console.warn("[TOOL_AGENT] search failed", error?.message || error);
                return null;
            });
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

        // Law lookups: one fact-checked search per country on official law sites.
        const lawCalls = functionCalls.filter(call => call.name === "lookup_law");
        const lawOutputs = await Promise.all(lawCalls.map(async call => {
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
        const responses = await Promise.all(functionCalls.map(async call => {
            const args = call.args || {};
            calls.push(call.name);
            let output;
            try {
                if (call.name === "web_search") {
                    output = searchSummary;
                } else if (call.name === "lookup_law") {
                    output = lawOutputs[lawIndex++];
                } else if (call.name === "science_lookup") {
                    status("reading", { count: 1 });
                    output = await scienceLookup(args);
                    if (output?.url) {
                        sources.push({ title: `${output.title} - Wikipedia`, url: output.url, published: "", snippet: String(output.text || "").slice(0, 200) });
                    }
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
                    status("reading", { count: 1 });
                    const page = await readUrlText(String(args.url || "")).catch(() => null);
                    output = page?.text
                        ? { title: page.title || "", published: page.published || "", text: String(page.text).slice(0, 6000) }
                        : { error: "Could not read page." };
                    if (page?.text) {
                        sources.push({ title: page.title || args.url, url: page.finalUrl || args.url, published: page.published || "", snippet: String(page.text).slice(0, 200) });
                    }
                } else {
                    output = { error: "Unknown tool." };
                }
            } catch (error) {
                output = { error: String(error?.message || error).slice(0, 200) };
            }
            if (call.name !== "web_search" && call.name !== "lookup_law") {
                toolNotes.push(`Tool ${call.name}(${JSON.stringify(args).slice(0, 200)}) →\n${JSON.stringify(output).slice(0, 2000)}`);
            }
            return { functionResponse: { name: call.name, response: { result: output } } };
        }));

        contents.push({ role: "user", parts: responses });
    }

    console.log("[TOOL_AGENT]", calls.join(",") || "none", `${Date.now() - started}ms`);

    if (!usedAny) {
        return { used: false, toolText: "", research: null, sources: [], calls };
    }

    const legalRules = legalUsed
        ? `=== LEGAL ANSWER RULES ===
- Name the exact law, act and section/article number from the LAW RESULTS, and the punishment/fine exactly as written. Never invent a section number.
- Say which country/province it applies to; laws differ by place. Mention the latest amendment if a result shows one.
- If the sources don't show the exact section, say so clearly instead of guessing.
- End with one short line: this is general legal information, not legal advice; for a real case talk to a lawyer.

`
        : "";
    const toolText = (toolNotes.length
        ? `=== TOOL RESULTS (exact, computed just now) ===\n${toolNotes.join("\n\n")}\n\n`
        : "") + legalRules;

    return {
        used: true,
        toolText,
        research,
        sources,
        calls
    };
}
