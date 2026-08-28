# Trend Finder — integration notes

Everything below was written from `ROADMAP.md`/`PROJECT_STATE.md` alone —
the actual `lib/db/index.js`, `lib/providers/router.js`,
`lib/auth/authOptions.js`, `NavBar.js`, and home `page.js` weren't shared
in the session that built this feature. The code was written to avoid
touching any of those files directly (see "Why a separate DB pool" and
"Why a separate `generateText` guess" below), so nothing here risks
breaking what already works — but a few small manual steps and one quick
verification are worth doing.

## 1. Manual steps (required)

**Add a nav link.** `NavBar.js` wasn't shared, so add a link to `/trends`
there yourself — same pattern as the existing "⏰ زمان‌بندی خودکار" /
"🔌 ارائه‌دهنده‌های API" links `ROADMAP.md` mentions, e.g. something like:
```jsx
<Link href="/trends">📈 یافتن ترند</Link>
```

**Add a home-page card.** Same thing for `src/app/page.js`'s section
cards — add one pointing at `/trends`, matching whatever pattern the
existing long/short/analytics/etc. cards use.

**Set new environment variables in Render:**
- `YOUTUBE_API_KEY` — a plain API key (Google Cloud Console → Credentials
  → Create Credentials → API key), restricted to "YouTube Data API v3".
  This is separate from the existing OAuth client used for uploads.
  Without it, the YouTube competition/view-growth signal is skipped
  (scores default to neutral) — the scan still runs, just with weaker
  data for those two criteria.
- `TREND_MIN_SCORE`, `TREND_TOP_N`, `TREND_MAX_CANDIDATES`,
  `TREND_SEED_KEYWORDS`, `TREND_AI_BATCH_SIZE` — all optional, sensible
  defaults are baked in (see `PROJECT_STATE.md`'s env var list).

**Set up the GitHub Actions schedule** (`.github/workflows/trend-scan.yml`):
1. Repo → Settings → Secrets and variables → Actions → **Secrets** tab →
   New repository secret: `CRON_SECRET` = the same value already set in
   Render.
2. Same page → **Variables** tab → New repository variable: `APP_URL` =
   `https://youtube-studio-7bnw.onrender.com` (from the Deployment
   workflow section in `ROADMAP.md` — no trailing slash).

**Optional: let approving a topic pre-fill the studio.** `TrendFinder.js`
links to `/long?topic=...` / `/short?topic=...` on approval. If
`VideoStudio.js` doesn't already read a `topic` query param, add a small
`useEffect` there reading `useSearchParams().get('topic')` into whatever
state variable holds the topic input — a few lines, not shared here since
`VideoStudio.js` wasn't available either.

## 2. The two guessed integration points (worth a quick diff)

Both are deliberately isolated to one clearly-commented spot each, so a
mismatch is a one-line fix:

- **`src/lib/trends/analyzer.js` → `callTextAI()`** — calls
  `generateText({ prompt, system, maxTokens, temperature })` from
  `lib/providers/router.js` and expects back either a plain string or an
  object with a `.text`/`.content`/`.message` field. If the real
  `generateText()` takes a plain string instead of an options object, or
  returns something shaped differently, this one function is the only
  place to change.
- **`src/app/api/trends/scan-now/route.js` and
  `src/app/api/trends/[id]/route.js`** — both do
  `getServerSession(authOptions)` from `next-auth/next` +
  `@/lib/auth/authOptions.js`. If this project's actual session check
  looks different, the two marked lines in each file are the only things
  to change.

Everything else (the 5 data sources, scoring, DB schema, the cron-gated
scan route, the UI) doesn't depend on any file that wasn't already fully
documented in `PROJECT_STATE.md`.

## 3. Why a separate DB pool

`src/lib/trends/db.js` opens its own small `pg` pool against
`DATABASE_URL` instead of importing the pool from `lib/db/index.js`,
because that file's exact export shape wasn't available either. This is
safe to run alongside the existing pool (Postgres handles multiple pools
against the same connection string fine) and costs one extra small pool.
Once `lib/db/index.js` is shared, this can be trimmed to re-export its
pool instead — nothing else in this feature needs to change either way.

## 4. Quick smoke test after deploying

```bash
# 1. Confirm the cron-gated route responds (should stream NDJSON lines,
#    ending in a "done" event with topicsFound):
curl -N -X POST "https://youtube-studio-7bnw.onrender.com/api/trends/scan?secret=<CRON_SECRET>"

# 2. Confirm topics were saved:
curl "https://youtube-studio-7bnw.onrender.com/api/trends?status=pending"
```
Then open `/trends` in the browser (signed in) and try "Run scan now" —
if `generateText()`'s shape needed adjusting, the AI-analyzer stage will
fall back to the heuristic path automatically (topics still show up, just
with the fallback reasoning text) rather than crashing the scan, so this
is safe to try before fixing anything.
