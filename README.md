# NEYO • Signaturesi

AI chat app with four characters (Neyo, Zadi, Wizi, Crony), voice mode, shared memory,
deep research and team Workspaces linked to Bean. Live at https://neyo.signaturesi.com.

## Stack

- `index.html` + `public/` — the app in the browser (`public/neo.js` core, `public/js/components/*`)
- `css/components/*` — styles (`polish.css` loads last)
- `api/*` — Vercel serverless functions (max 12 on the Hobby plan)
- `lib/*` — shared server code (auth, memory, privacy, workspaces, guard)
- Supabase (database, storage, Bean login sessions) and Google Gemini (AI)

## Checks before every deploy

```bash
npm install
npm run check        # syntax check + tests + build
```

| Command | What it does |
|---|---|
| `npm run check:syntax` | `node --check` on every JavaScript file |
| `npm test` | Node test runner on `tests/**/*.test.js` (no real database or AI is touched) |
| `npm run build` | Vite production build |

GitHub Actions runs the same checks on every push to `main` (`.github/workflows/ci.yml`).

## Security rules

- Every voice API route checks: same website (`APP_ORIGIN`), logged-in user, per-user rate limit (`lib/guard.js`). The limit is shared across all servers through Supabase (`supabase/neyo_rate_limit.sql`) and falls back to a per-server limit if that is unavailable.
- Chat messages are limited by the credit system (`reserve_message`).
- Passwords, card numbers and API keys are hidden before a message reaches the AI (`lib/privacy.js`) and are never saved to memory (`lib/memory.js`).
- Secrets live only in Vercel environment variables, never in the browser.

## Smart UI cards

NEYO can add one live card to an answer: calculator, checklist/timeline, chart, tabs, compare or quiz. The model writes a ```neyo-ui block with JSON (rule in `lib/smart-ui.js`); `public/js/components/smart-ui.js` draws it with safe DOM/SVG (no AI HTML, formulas use an own parser in `smart-ui-core.js`). Broken data is dropped, the written answer stays. Tests: `tests/smart-ui.test.js`.

## Health check

`GET /api/history?resource=health` returns `200` when Gemini, `APP_ORIGIN` and the database are ready, `503` otherwise. Point an uptime monitor at it.

## Environment variables (Vercel)

`GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN`, `SESSION_COOKIE_NAME` (optional), plus the payment keys used by `api/checkout.js` and `api/webhooks/lemon.js`.

## Web search

Free scrapers (Brave, Bing, DuckDuckGo, Yahoo, Mojeek, news feeds, Wikipedia, Hacker News, Reddit) run in parallel. Cloud servers often get blocked, so there are backups:

- **Google Search grounding** (Gemini 2.5 Flash-Lite, free daily quota): used once per question only when the free results are weak. `NEYO_GOOGLE_GROUNDING` = `fallback` (default) | `always` | `off`. `NEYO_GROUNDING_DAILY_CAP` (default 400, shared across servers when `supabase/neyo_rate_limit.sql` is set up).
- **Optional search APIs** with free plans; add a key and it joins automatically: `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`.
- **Page reader backup** for pages that block servers: r.jina.ai, a few pages per question (`JINA_API_KEY` optional).
- Results that are not opened still add their snippet (marked as snippet only). If nothing comes back, the model is told to say it could not check live sources instead of passing old knowledge off as the latest.
