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

## Health check

`GET /api/history?resource=health` returns `200` when Gemini, `APP_ORIGIN` and the database are ready, `503` otherwise. Point an uptime monitor at it.

## Environment variables (Vercel)

`GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN`, `SESSION_COOKIE_NAME` (optional), plus the payment keys used by `api/checkout.js` and `api/webhooks/lemon.js`.
