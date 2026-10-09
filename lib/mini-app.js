/*
NEYO Mini Apps: NEYO writes a small self-contained HTML/JS app
(a game, a simulation, a drawing board, a custom tool) and the
browser runs it inside the answer, in a locked sandbox
(public/js/components/mini-app.js): no network, no cookies, no
access to the NEYO page or the user's account.
*/

export const MINI_APP_HINT = `MINI APPS: when the user wants something to USE or PLAY that the Smart UI blocks cannot do (a game, a simulation, a drawing or music pad, a custom tool, an interactive demo, "app/game/tool bana do"), you can build a real mini app: one fenced code block with language neyo-app holding one complete HTML file. It runs inside the chat. Prefer Smart UI blocks for clocks, timers, calculators, charts and dashboards; use a mini app when those can't do it.`;

export const MINI_APP_RULE = `MINI APP RULES (the user asked for something interactive):
Write one short line about what you built and how to use it (controls), then the app as:
\`\`\`neyo-app
<!doctype html>
<html><head><title>Short app name</title><style>...</style></head>
<body>...<script>...</script></body></html>
\`\`\`
- ONE self-contained file: inline <style> and <script> only. NO external files: no CDN, no libraries, no fonts, no images by URL, no fetch/API calls (the sandbox blocks the network). Draw with HTML, CSS, SVG or <canvas>; images only as inline SVG or data: URLs.
- Plain modern JavaScript. Make it really work: no TODOs, no placeholder functions, no "add your logic here". Finish the whole file; keep it compact (aim under 350 lines).
- Use the theme variables so it fits NEYO light and dark mode: var(--bg) page, var(--card) panels, var(--fg) text, var(--muted) soft text, var(--line) borders, var(--accent) buttons/highlights, var(--accent-fg) text on accent, var(--good) var(--bad) var(--warn). Basic buttons and inputs are already styled; body already has padding and a system font.
- Width is the chat column (300-760px): make it responsive. Do NOT use 100vh or position:fixed layouts; let the page have its natural height. For a game canvas, size it to the container width with a fixed aspect ratio. If it needs a fixed height, add <meta name="neyo-height" content="480">.
- Controls must work with mouse, touch and keyboard (for keys, also show on-screen buttons for phones). Start/Restart buttons for games; show score and a clear win/lose message.
- localStorage works (saved per app), so high scores and settings can be kept.
- Labels in the user's language, short. Never mention sandboxes, iframes, HTML or "neyo-app" in your words; just say what it does.`;

const APP_WORDS = /\b(game|games|app|apps|mini ?app|tool|simulat\w*|simulator|playground|drawing|draw|paint|sketch|piano|drum|synth|maze|snake|tetris|tic[- ]?tac[- ]?toe|ludo|chess|puzzle|flappy|pong|breakout|memory game|typing test|whiteboard|canvas|animation|visuali[sz]\w*|interactive|khel|game\s*bana|widget)\b/i;
const BUILD_WORDS = /\b(bana|banao|banado|bana do|bana den|bana dein|banaye|banayein|banaen|make|build|create|code|design|chahiye|chahie|de do|dedo|theek|thik|fix|improve|update)\b/i;

/* true when the message asks NEYO to build something to use or play */
export function wantsMiniApp(text = "") {
    const t = String(text || "").slice(0, 1200);
    if (!t.trim()) return false;
    if (/```|\bexplain\b|\bdebug\b|\berror\b.*\bmera\b/i.test(t) && !/\bneyo-app\b/i.test(t)) return false;
    return APP_WORDS.test(t) && BUILD_WORDS.test(t);
}
