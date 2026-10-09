/*
NEYO Mini Apps: NEYO writes a small self-contained HTML/JS app
(a game, a simulation, a drawing board, a custom tool) and the
browser runs it inside the answer, in a locked sandbox
(public/js/components/mini-app.js): no network, no cookies, no
access to the NEYO page or the user's account.
*/

export const MINI_APP_HINT = `MINI APPS: when the user wants something to USE or PLAY that the Smart UI blocks cannot do (a game, a simulation, a drawing or music pad, a custom tool, an interactive demo, "app/game/tool bana do"), you can build a real mini app: one fenced code block with language neyo-app holding one complete HTML file. It runs inside the chat. Prefer Smart UI blocks for clocks, timers, calculators, charts and dashboards; use a mini app when those can't do it.`;

export const MINI_APP_RULE = `MINI APP RULES (the user asked for something interactive):
Write one short line about what you built and how to use it, then the app as:
\`\`\`neyo-app
<!doctype html>
<html><head><title>Short app name</title><style>/* only layout this app needs */</style></head>
<body>
<div class="app">
  <header class="header"><div><h1>Snake</h1><p class="sub">Arrow keys or swipe</p></div><div class="row"><span class="chip">Score <b id="score">0</b></span><span class="chip">Best <b id="best">0</b></span></div></header>
  <div class="stage"><canvas id="c" width="480" height="480"></canvas><div class="overlay" id="over"><h2>Ready?</h2><button class="primary lg" id="start">Start</button></div></div>
  <div class="row center"><button id="pause">Pause</button><button class="ghost" id="reset">Reset</button></div>
</div>
<script>/* the app */</script>
</body></html>
\`\`\`

DESIGN (NEYO look; the NEYO kit is already loaded in the app, so USE IT and don't fight it):
- The kit already styles html, body, h1-h3, p, buttons, inputs, selects, sliders, checkboxes, tables and focus rings in NEYO style, in light and dark. Do NOT set font-family, body background/colour/padding, or restyle buttons/inputs. Your <style> is only for layout specific to this app (sizes of a board, cells, a grid).
- Kit classes: .app (main column, gap 14) · .header + .sub (title row with small muted subtitle) · .row (.between .center) · .stack · .grid (.two .three) · .spacer · .field (label + input) · .card (soft panel) · .card.outline · .stage (soft rounded area for a canvas/board; children centred) · .overlay (blurred message over the stage: start, pause, game over; toggle with the hidden attribute) · .stat with .label + .value · .big (large number) · .chip (with <b>) · .chip.accent · .badge (.good .bad .warn) · .seg (segmented buttons; active button gets class "on") · .list (rows with dividers) · .progress > i (style="width:40%") · .pad (3x3 grid of 46px arrow buttons for phones) · .muted .strong .small .good .bad.
- Buttons: plain <button> = quiet; class "primary" = the ONE main action; "ghost" = minor; "sm" / "lg" / "icon" / "pill" sizes; "on" = selected.
- Colours only through variables: var(--bg) var(--fg) var(--strong) var(--muted) var(--line) var(--soft) var(--accent) var(--accent-fg) var(--accent-soft) var(--good) var(--bad) var(--warn); radius var(--r) / var(--r-lg). For <canvas> drawing read NEYO.colors() (same names: bg fg strong muted line soft accent accentFg good bad warn) and redraw inside NEYO.onTheme(fn) so dark mode works. NEYO.toast("Saved") shows a small message.
- Style: calm, minimal, monochrome with the one accent, generous spacing, rounded corners, clean numbers. NO gradients, neon, glow, heavy shadows, coloured page backgrounds, rainbow buttons, emoji decoration, ALL CAPS titles or borders around everything. One clear title; secondary info muted. Game pieces: simple flat shapes with rounded corners (accent for the player, var(--good)/var(--bad) for food/danger, var(--line) for grid lines).

BUILD:
- ONE self-contained file: inline <style> and <script> only. NO external files: no CDN, libraries, web fonts, image URLs or fetch/API calls (the network is blocked). Draw with HTML, CSS, SVG or <canvas>.
- Plain modern JavaScript that really works: no TODOs or placeholder functions. Finish the whole file; keep it compact (aim under 350 lines).
- Width is the chat column (300-760px): responsive. No 100vh, no position:fixed. A game canvas: fixed internal size (e.g. 480x480) scaled by CSS to the width; handle devicePixelRatio for sharp drawing. If it truly needs a fixed height add <meta name="neyo-height" content="520">.
- Mouse, touch and keyboard all work (games: arrow keys/WASD + swipe + .pad buttons on phones; prevent page scroll on arrow keys only while playing). Start/Pause/Restart, score, and a clear win/lose overlay.
- localStorage works (saved per app): keep high scores and settings.
- Labels in the user's language, short. Never mention sandboxes, iframes, HTML, the kit or "neyo-app" in your words.`;

const APP_WORDS = /\b(game|games|app|apps|mini ?app|tool|simulat\w*|simulator|playground|drawing|draw|paint|sketch|piano|drum|synth|maze|snake|tetris|tic[- ]?tac[- ]?toe|ludo|chess|puzzle|flappy|pong|breakout|memory game|typing test|whiteboard|canvas|animation|visuali[sz]\w*|interactive|khel|game\s*bana|widget)\b/i;
const BUILD_WORDS = /\b(bana|banao|banado|bana do|bana den|bana dein|banaye|banayein|banaen|make|build|create|code|design|chahiye|chahie|de do|dedo|theek|thik|fix|improve|update)\b/i;

/* true when the message asks NEYO to build something to use or play */
export function wantsMiniApp(text = "") {
    const t = String(text || "").slice(0, 1200);
    if (!t.trim()) return false;
    if (/```|\bexplain\b|\bdebug\b|\berror\b.*\bmera\b/i.test(t) && !/\bneyo-app\b/i.test(t)) return false;
    return APP_WORDS.test(t) && BUILD_WORDS.test(t);
}
