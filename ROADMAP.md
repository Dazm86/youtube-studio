# The Mindful Path — Studio: Project Roadmap

> **For AI assistants:** read this whole file before making any changes —
> it's the single source of truth for what this project is, how it's
> built, and everything done so far. **After you make any change, add a
> new entry at the top of the Changelog** (date, what changed, why, which
> files) so the next session — you or another model — has full context
> without re-reading every diff.

## What this is

An automated YouTube content pipeline for **The Mindful Path** — a
mindfulness/personal-growth channel hosted by an animated character
named Maya (orange-to-purple gradient hair, energetic/inspiring
personality). One person runs the whole channel through this app: pick
a topic (or let AI pick one), AI writes the script, AI generates voice +
matching stock footage + Maya overlays, the server renders the final
video, uploads straight to YouTube with an AI-suggested title/
description/tags, a custom thumbnail, and subtitles in 5 languages — no
video editor, no manual upload.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Hosting | Render.com, **free tier — 512MB RAM, shared CPU** |
| Auth | NextAuth v4 + Google OAuth (YouTube scopes) |
| Script/translation AI | Groq API, `llama-3.3-70b-versatile` |
| Stock media | Pexels API (photos + video clips) |
| Text-to-speech | `msedge-tts` (voice: `en-US-JennyNeural`) |
| Video render | Server-side FFmpeg (`@ffmpeg-installer/ffmpeg`) |
| YouTube | `googleapis` (Data API v3 + Analytics API v2) |
| Database | Postgres via `pg` (Supabase-hosted, raw connection string — not the Supabase SDK) |
| Images | `sharp` (thumbnail compositing) |
| Styling | Tailwind CSS 4 |

## Environment variables (set in Render dashboard)

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`,
`NEXTAUTH_URL`, `GROQ_API_KEY`, `PEXELS_API_KEY`, `DATABASE_URL`

## Deployment workflow (Termux, Android)

Development happens by receiving changed files from an AI assistant,
copying them into the local repo, and pushing. Render auto-deploys on
every push to the connected GitHub branch.

- Repo: `github.com/Dazm86/youtube-studio.git`
- Local path: `~/youtube-studio`
- Live URL: `https://youtube-studio-7bnw.onrender.com`

Standard pattern for applying a zip of changed files from
`/sdcard/Download/`:
```bash
cp /sdcard/Download/<name>.zip ~/youtube-studio
cd ~/youtube-studio
unzip -o <name>.zip
git add <changed files>
git commit -m "<message>"
git push
```

## Architecture / file map

### Pages (`src/app/`)
- `page.js` — home: sign-in, then 4 section cards (long/short/analytics/api-check)
- `long/page.js`, `short/page.js` — render `VideoStudio` with `mode="long"` / `"short"`
- `analytics/page.js` — renders `ChannelAnalytics`
- `api-check/page.js` — renders `ApiStatus`
- `layout.js` — RTL Persian layout, Vazirmatn font
- `providers.js` — NextAuth `SessionProvider` wrapper

### API routes (`src/app/api/`)
- **`generate-script/route.js`** — Groq call that writes the narration: story→emotion→insight→action formula, Maya's energetic personality + rotating catchphrase kit baked into the prompt. Plain text output (not JSON) — must stay editable in the UI textarea and usable as-is by TTS/metadata calls.
- **`generate-and-upload/route.js`** — the core pipeline, streams progress as newline-delimited JSON. Steps: TTS → bucket script into timed segments (`distributeDurations`) → per-segment Pexels search → FFmpeg render (per-segment batches) → refresh Google token → upload to YouTube → thumbnail → English SRT caption → translated captions (5 languages). Sends a heartbeat ping every 15s throughout.
- `images/route.js`, `clips/route.js` — thin wrappers around `lib/media.js`
- `tts/route.js` — voice preview
- `suggest-metadata/route.js` — AI (or heuristic fallback) title/description/tags from a script
- `upload/route.js` — manual path: user uploads an already-made video file directly, still gets a Maya thumbnail. Does NOT have the long-render token-refresh logic (not needed — this path is short).
- `sync-stats/route.js` — pulls views/subscribers/likes from YouTube Analytics into the DB
- `videos/route.js` — lists recorded videos (analytics page)
- `status/route.js`, `status/groq`, `status/pexels`, `status/youtube` — connectivity checks for the API-check page
- `auth/[...nextauth]/route.js` + `auth/authOptions.js` — Google OAuth, JWT refresh logic (`refreshAccessToken` is exported for reuse)

### Lib (`src/lib/`)
- **`videoRender.js`** — FFmpeg orchestration. One segment per FFmpeg process (`BATCH_SIZE = 1`, deliberately, to stay inside 512MB RAM), 300s timeout per segment (throws and stops the whole render on failure — no retry). Maya appears large/centered ("presenter" role) only on the first and last segment; alternates small-corner-cameo/fully-hidden for body segments. Backdrop blur uses a downscale→blur→upscale trick for speed.
- **`scriptTiming.js`** — splits the flat script into N timed buckets (`distributeDurations`) and builds SRT files (`buildSrt`) from any (captions, durations) pair — reused for every caption language.
- `media.js` — Pexels search (`fetchImages`/`fetchClips`); auto-extracts keywords from text when no manual keyword is given.
- **`translateCaptions.js`** — Groq call that translates the caption array into another language, 1:1 index-preserving (required so `buildSrt` timing still lines up with the video).
- `mayaThumbnail.js` — composites the YouTube thumbnail (Maya + blurred background + title text); also picks Maya's pose (`pickMayaPose`) by keyword-matching segment text against 7 moods + a default.
- `channelHistory.js` — pulls recent video titles from YouTube itself, used as "memory" so new scripts don't repeat topics
- `youtubeAnalytics.js` — batch stats fetch for `sync-stats`
- `db.js` — Postgres pool + `videos` table (auto-created on first use)

### Components (`src/components/`)
- `VideoStudio.js` — the whole long/short creation UI + the streaming-fetch client for `generate-and-upload`
- `ChannelAnalytics.js`, `ApiStatus.js`, `NavBar.js` — as named (NavBar also auto-signs-out on an unrecoverable token-refresh error)
- `HomeDashboard.js` — **unused/legacy**, superseded by the inline dashboard in `app/page.js`. Safe to ignore or delete.

## Known constraints

- Render free tier (512MB RAM, shared CPU) is *the* reason rendering is
  one segment at a time and why render speed has a hard-ish ceiling —
  software tuning helps, but a paid tier is the honest fix if it's still
  too slow.
- Google access tokens expire ~60 min; long renders now refresh the
  token right before the upload step rather than trusting the one
  fetched at request-start.
- Adding a new OAuth scope requires the user to sign out/in once before
  it takes effect (existing sessions don't retroactively gain it).

## Changelog

Newest first. Add new entries above the top one — date, what, why, files.

### 2026-08-06 — Real fix for the mid-render disconnect (self-ping)
The 2026-08-05 heartbeat entry below was an incomplete fix. User
discovered by testing (manually visiting the site kept a render alive
past 15 min; not visiting, it died at ~15 min every time) that the
in-stream heartbeat wasn't the mechanism — confirmed against Render's
docs: free web services spin down after 15 min with no *new inbound
HTTP request* to the service. Writing more bytes onto an
already-open response stream doesn't count as new inbound traffic, so
the old heartbeat never actually reset Render's timer. Real fix: every
5 minutes during a render, the server now makes a genuine new HTTP
request to its own public URL (`NEXTAUTH_URL` + `/api/status`) — this
*does* count as inbound traffic and keeps the instance from spinning
down mid-render. Kept the old in-stream heartbeat too (harmless,
still useful against generic idle-connection drops on the client
side) — just added the real fix alongside it. File:
`api/generate-and-upload/route.js`.

### 2026-08-06 — Analytics depth + feedback loop
DB now tracks retention (`averageViewPercentage`), thumbnail impressions,
and thumbnail CTR (`videoThumbnailImpressions`/
`videoThumbnailImpressionsClickRate` — added to the YouTube Analytics
API on 2026-01-15, confirmed via the official metrics reference before
using them; query falls back to the original basic metric set if the
combined query is ever rejected). Analytics page now shows retention%
and CTR per video. Feedback loop: `generate-script` now pulls the
channel's top-retention past videos (min. 10 views, to avoid a
1-view fluke topping the list) and includes just their opening line +
retention% in the prompt as "what's worked" context — degrades silently
to normal generation if there's no data yet or the DB call fails. Files:
`lib/db.js`, `lib/youtubeAnalytics.js`, `api/generate-script/route.js`,
`components/ChannelAnalytics.js`.

### 2026-08-06 — This roadmap file
Added this file so any future session (same model or a different one)
can onboard instantly instead of re-deriving project state from scratch.

### 2026-08-06 — Multi-language subtitles
Added `translateCaptions.js`; after the English caption uploads,
translates the same segment array into Spanish/Portuguese/Arabic/Hindi/
Persian via Groq and uploads each as its own YouTube caption track.
Independent per language — one failing doesn't affect the others or the
overall upload. Files: `lib/translateCaptions.js` (new),
`api/generate-and-upload/route.js`, `components/VideoStudio.js`.

### 2026-08-05 — Token refresh before upload
Long renders (15-40+ min) could outlive the ~60min access token fetched
at request-start, failing the final YouTube upload with an auth error
after a fully successful render. Now force-refreshes the token (via
`next-auth/jwt`'s `getToken` + the exported `refreshAccessToken`) right
before the YouTube API calls, independent of render duration. Files:
`api/auth/authOptions.js`, `api/generate-and-upload/route.js`.

### 2026-08-05 — Reliability: heartbeat + faster render
Long renders were silently dying mid-way with no error shown — likely
an idle-connection timeout somewhere in the path (mobile network or a
proxy) since no bytes were sent during a single slow segment. Added: a
15s heartbeat ping on the stream; client-side detection of an
unexplained stream end (shows a clear error instead of leaving stale
status text on screen); fewer segments for long videos (24s/segment
instead of 15s, cutting segment count meaningfully); faster background
blur (blur a downscaled copy then scale back up — verified with a local
ffmpeg benchmark: same look, less compute). Files: `lib/videoRender.js`,
`api/generate-and-upload/route.js`, `components/VideoStudio.js`.

### 2026-08-04 — Captions: SRT instead of burned-in
Removed the burned-in `drawtext` captions from the render. Instead
builds a proper SRT (`scriptTiming.js: buildSrt`) from the same segment
timing already used for media search, and uploads it as an English
YouTube caption track after the video upload — sets up multi-language
support as a natural next step. Required a new OAuth scope
(`youtube.force-ssl`). Files: `lib/scriptTiming.js`,
`lib/videoRender.js`, `api/generate-and-upload/route.js`,
`api/auth/authOptions.js`, `components/VideoStudio.js`.

### 2026-08-04 — Maya: personality + staging
Script prompt now gives Maya an energetic/inspiring voice with a
rotating catchphrase kit (reworded each time, never copy-pasted
verbatim). Visually, Maya is now large/centered ("presenter" role) only
on the hook and closing segments; alternates small-corner-cameo/
fully-hidden through the body — instead of being a small static corner
sticker on every single segment. Files: `api/generate-script/route.js`,
`lib/videoRender.js`.

### 2026-08-04 — Per-segment media, script formula, longer render timeout
Each script segment now gets its own Pexels search using that segment's
own text, instead of one search for the whole video (manual keyword
mode intentionally keeps the old single-theme behavior). Script prompt
rewritten around a story→emotion→insight→action formula with explicit
beat structure (hook/empathy/insight/closing for shorts; 6-beat for
longs) and a retention rule (something new every 20-30s). Per-segment
FFmpeg timeout raised 90s→300s. Files: `api/generate-script/route.js`,
`lib/videoRender.js`, `api/generate-and-upload/route.js`.

### Baseline (pre-existing before this changelog started)
Next.js studio automating: AI script (Groq) → TTS (msedge-tts) → stock
media (Pexels) → server-side FFmpeg render → YouTube upload (googleapis)
→ Postgres tracking (Supabase-hosted). 4 pages (long/short/analytics/
api-check). Maya thumbnail generator with mood-based pose picker.
