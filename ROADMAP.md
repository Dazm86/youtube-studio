# The Mindful Path — Studio: Project Roadmap

> **For AI assistants:** read this whole file before making any changes —
> it's the single source of truth for what this project is, how it's
> built, and everything done so far. **After you make any change, add a
> new entry at the top of the Changelog** (date, what changed, why, which
> files) so the next session — you or another model — has full context
> without re-reading every diff. **Also, every time you deliver changed
> code, give the exact Termux commands to apply it** (see "Deployment
> workflow" below) — copy the zip to `~/youtube-studio`, `unzip -o`,
> `git add`, `git commit -m "..."`, `git push` — with the real filename
> and a commit message describing that change. Don't make the user ask
> for this separately.

## Known constraints

These are real, currently-active limits — worth reading before proposing
a fix that assumes they don't exist:

- **Render.com free tier: 512MB RAM, shared CPU.** This drives the
  single biggest architectural choice in the codebase: `BATCH_SIZE=1` in
  `videoRender.js` — every media segment renders in its own isolated
  FFmpeg process, one at a time, never in parallel and never all loaded
  into one giant filter graph. Any proposed change that would need to
  hold multiple segments in memory simultaneously (a true crossfade via
  `xfade` between adjacent clips, for instance) has to reckon with this
  first — that's why segment transitions use a same-clip fade-to-black
  instead of a real cross-dissolve.
- **The bundled FFmpeg binary (via `@ffmpeg-installer/ffmpeg`) is a
  static build from ~2018.** It does not have every modern filter
  option — confirmed the hard way on 2026-08-12 when `scale`'s
  `force_divisible_by` option crashed a live render with "Option not
  found." When adding a new filter, prefer options that have existed
  since FFmpeg 3.x/early 4.x, or compute the equivalent value in
  JavaScript ahead of time instead of relying on a newer filter option.
  If a newly-added filter (`anoisesrc`, `alimiter`, etc.) turns out to
  be unsupported too, the fix pattern is the same one used for the scale
  crash: replace the version-specific option with either an older
  equivalent or a value computed in JS beforehand.
- **msedge-tts's SSML support is unreliable.** It's an unofficial wrapper
  around Edge's read-aloud service, not the real Azure Speech SDK — don't
  assume `<break>`/prosody tags will reliably work. The existing audio
  ducking (`sidechaincompress` reacting to the real narration waveform)
  deliberately avoids depending on SSML timestamps for exactly this
  reason, and is arguably better than a timestamp-driven approach anyway
  since it reacts to the actual audio rather than a guess.
- **`node --check somefile.js` is not a reliable syntax check for this
  codebase.** Discovered 2026-08-12: because these `.js` files use
  `import`/`export` without `"type": "module"` in package.json, plain
  `node --check` sometimes falls back to permissive CommonJS-style
  parsing that tolerates things a real ES module load would reject (a
  stray top-level `return` outside any function, in one real case this
  session — silently "OK" on the `.js` file, immediately caught as a
  syntax error when the same content was checked as `.mjs`). When
  verifying a change, check a `.mjs` copy of the file, not the `.js`
  original directly.
- **No test runner is installed** (no jest/vitest/mocha). `tests/*.test.mjs`
  files use only Node's built-in `assert` and run directly via
  `node tests/whatever.test.mjs` — no `npm install` needed for
  `tests/scriptTiming.test.mjs` specifically, since `scriptTiming.js`
  has zero imports of its own. Other test files that import files with
  real dependencies (`pipeline.js`, `mayaThumbnail.js`, etc.) do need
  the project's normal `npm install` first.
- **YouTube's Data API v3 does not expose comment pinning, arbitrary
  Community-tab posts, or End Screens/Cards.** These are Studio-only
  (manual) features as far as the public API goes — don't plan an
  auto-pin-a-comment or auto-post-a-poll feature assuming there's an
  endpoint for it; there isn't one currently documented.
- **`public/fallback-media/{images,videos}/` ship empty.** The fallback
  mechanism (used when every configured stock provider fails) is fully
  wired up in code, but actual stock asset files are something only a
  human can add — nothing will use this path until real files exist
  there.

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
| AI providers (text/image/video/audio) | **Pluggable — see "API providers" below.** Any of Groq/OpenAI/Anthropic/ElevenLabs/Stability AI/Pexels/msedge-tts, user-configured per task with automatic fallback |
| Video render | Server-side FFmpeg (`@ffmpeg-installer/ffmpeg`) |
| YouTube | `googleapis` (Data API v3 + Analytics API v2) |
| Database | Postgres via `pg` (Supabase-hosted, raw connection string — not the Supabase SDK) |
| Images | `sharp` (thumbnail compositing) |
| Styling | Tailwind CSS 4 |

## API providers *(Phase 5)*

The pipeline no longer talks to Groq/Pexels/msedge-tts directly. Instead,
`/providers` lets the user add any number of "name + API key" entries;
`lib/providers/registry.js` tries a handful of known-service fingerprints
(Groq, OpenAI, Anthropic, ElevenLabs, Stability AI, Pexels — a lightweight
real API call per candidate, run in parallel) and tags the key with what
it can do (`text`/`image`/`video`/`audio`). If nothing matches, the user
picks the service manually from the same list. `msedge-tts` is always
registered too, needs no key, and is the permanent zero-config fallback
for `audio`.

For each of the four task types, `lib/providers/router.js` asks the DB
for the user's manually-ordered priority list (`/providers` page, ▲/▼
buttons) and tries providers top-down, falling back to the next one on
any failure — same "never let one flaky call break the whole run"
philosophy as the rest of this app. `GROQ_API_KEY`/`PEXELS_API_KEY` (if
still set in Render) are auto-registered as ordinary provider rows on
first boot, so existing deployments keep working with zero config
changes; the user can then re-prioritize or delete them from `/providers`
like any other provider. API keys are stored AES-256-GCM-encrypted
(`lib/providers/crypto.js`, key derived from `NEXTAUTH_SECRET` — no new
secret needed), never returned to the client in plaintext.

`video` currently only has one real adapter (Pexels stock search) —
true AI video generation (Runway/Pika/Luma/Kling-style) is async/
job-polling and would fight the 512MB/short-timeout constraints below,
so it's deliberately not implemented yet. Adding one later is just a
new `REGISTRY` entry in `registry.js`.

## Environment variables (set in Render dashboard)

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`,
`NEXTAUTH_URL`, `DATABASE_URL`, `CRON_SECRET` *(Phase 4 — shared secret
an external cron pinger sends to `/api/scheduler/run`; that endpoint is
disabled entirely if this isn't set)*

`GROQ_API_KEY`, `PEXELS_API_KEY` *(optional as of Phase 5 — if set,
auto-registered as provider rows on first boot; otherwise just add real
providers from `/providers` instead)*

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
- `page.js` — home: sign-in, then 5 section cards (long/short/**providers**/analytics/api-check)
- `long/page.js`, `short/page.js` — render `VideoStudio` with `mode="long"` / `"short"`
- `analytics/page.js` — renders `ChannelAnalytics`
- `api-check/page.js` — renders `ApiStatus`
- `schedule/page.js` *(Phase 4)* — renders `ScheduleSettings`
- **`providers/page.js`** *(new, Phase 5)* — renders `ProviderManager`
- `layout.js` — RTL Persian layout, Vazirmatn font
- `providers.js` — NextAuth `SessionProvider` wrapper (name collision with the `providers/` route folder above is coincidental — this one's the NextAuth context component, not an AI provider)

### API routes (`src/app/api/`)
- **`generate-script/route.js`** — thin wrapper: auth check, then calls `lib/scriptGen.js`. *Phase 4: logic itself moved into the lib so the scheduler can call it without an HTTP round-trip; behavior/prompt unchanged.*
- **`generate-and-upload/route.js`** — thin wrapper: streams NDJSON progress, but the actual work now lives in `lib/pipeline.js: runPipeline()`. *Phase 4 extraction — same steps as before (TTS → media → render → upload → thumbnail → captions → community-post draft), just shared with the scheduler now instead of duplicated.*
- `images/route.js`, `clips/route.js` — thin wrappers around `lib/media.js`
- `tts/route.js` — voice preview
- `suggest-metadata/route.js` — thin wrapper around `lib/metadataGen.js` (AI or heuristic title/description/tags, two A/B variants). *Phase 4: logic moved into the lib for the same reason as generate-script.*
- `upload/route.js` — manual path: user uploads an already-made video file directly, still gets a Maya thumbnail. Does NOT have the long-render token-refresh logic (not needed — this path is short).
- `sync-stats/route.js` — pulls views/subscribers/likes from YouTube Analytics into the DB
- `videos/route.js` — lists recorded videos (analytics page)
- `status/route.js`, `status/groq`, `status/pexels`, `status/youtube` — connectivity checks for the API-check page (still check the raw legacy env vars specifically — a separate, simpler concept from the Phase 5 provider system; see `providers/route.js` below for that)
- `auth/[...nextauth]/route.js` + `auth/authOptions.js` — Google OAuth, JWT refresh logic (`refreshAccessToken` is exported for reuse). *Phase 4: `jwt` callback now also persists the Google `refresh_token` to the DB (`saveRefreshToken`) on every fresh sign-in — see Known constraints for why.*
- `community-post/route.js` — generates + stores a Community Tab post draft (poll or quote) via the configured "text" provider for a given `videoId`. Draft only — see Known constraints.
- `ab-test/route.js` — switches the *live* title+thumbnail on a given video between stored variant A/B (`videos.update` + `thumbnails.set`). Sequential switch, not simultaneous split-testing — see Known constraints.
- `repurpose-short/route.js` — accepts a source long-form video file (multipart) + its YouTube `videoId`, reads the retention curve from YouTube Analytics, crops the highest-retention window to 9:16 with animated captions, and either returns the `.mp4` or auto-uploads it as a Short.
- **`scheduler/run/route.js`** *(new, Phase 4)* — the endpoint an external cron pinger hits (GET, `?secret=` or `x-cron-secret` header must match `CRON_SECRET`). Checks all enabled `schedules` against the current time in each one's own timezone; for anything due, claims it (`last_run_date`) and kicks off `generateScript` → `generateMetadata` → `runPipeline` in the background (fire-and-forget after responding, since this is a persistent Node process on Render, not serverless) — logs progress to `console.log` and the final result to `schedule_runs`. See Known constraints for the whole "why not just use setInterval" reasoning.
- **`schedules/route.js`** *(new, Phase 4)* — CRUD (GET/POST/PUT/DELETE) for schedule configs, used by `ScheduleSettings.js`. Requires a normal logged-in session (unlike `scheduler/run`, which uses the cron secret instead since it has no browser session).
- **`providers/route.js`** *(new, Phase 5)* — GET lists all providers + their manual priority order + the known-service registry (for the UI's dropdowns); POST adds one (`name`+`apiKey`, runs `detectService` unless a manual `service` is given).
- **`providers/[id]/route.js`** *(new, Phase 5)* — PUT (rename/enable/disable/reassign service/replace key), DELETE for one provider.
- **`providers/[id]/check/route.js`** *(new, Phase 5)* — POST re-runs that provider's connectivity probe on demand and records the result.
- **`providers/priority/route.js`** *(new, Phase 5)* — PUT saves the manually-reordered provider list for one task type (`text`/`image`/`video`/`audio`).

### Lib (`src/lib/`)
- **`videoRender.js`** — FFmpeg orchestration. One segment per FFmpeg process (`BATCH_SIZE = 1`, deliberately, to stay inside 512MB RAM — kept intact through every phase), 300s timeout per segment (throws and stops the whole render on failure — no retry). Maya appears large/centered ("presenter" role) only on the first and last segment; alternates small-corner-cameo/fully-hidden for body segments. Backdrop blur uses a downscale→blur→upscale trick for speed. Final audio mix picks a local mood-matched BGM track (`public/audio/bgm/`, mapped from `pickMayaPose`) and ducks it under narration via `sidechaincompress` (falls back to the old synthetic tone if no BGM file exists — never fails the render). Also exports `renderVerticalShortFromSource` (crop-to-9:16 + animated burned-in captions for Shorts) and `probeDurationSec`/`probeHasAudioStream` (read straight from ffmpeg's own stderr — no ffprobe dependency in this project). *Phase 5: `estimateAudioDurationSec` is now async and reuses `probeDurationSec` on a temp-written copy of the audio buffer, instead of assuming a fixed 48kbps bitrate — that assumption only held for msedge-tts and silently desynced captions/media timing whenever a different "audio" provider (different bitrate) was prioritized. The media-download loop and `mayaThumbnail.js`'s background-image fetch also now accept either a URL string (stock search) or a `{buffer, ext}` object (AI-generated image providers, which return raw bytes, not a link) — both shapes flow out of `lib/providers/registry.js`'s image adapters.* *Phase 6: Maya's overlay is no longer one static frame — `buildMayaOverlayChain()` layers a continuous idle sway (sine-wave x/y drift via FFmpeg's `t`, needs no new art) plus two optional sprite-swap layers, `{pose}-talk.png` (rhythmic mouth-flap) and `{pose}-blink.png` (periodic blink), each independently skipped via `fs.existsSync` if that pose's variant doesn't exist yet. "Hidden"-role segments now skip loading any Maya asset at all (previously loaded one unused input every time).*
- **`scriptTiming.js`** — splits the flat script into N timed buckets (`distributeDurations`) and builds SRT files (`buildSrt`) from any (captions, durations) pair — reused for every caption language.
- `media.js` — *(Phase 5: rewritten)* thin wrapper re-exporting `fetchImages`/`fetchClips` from `lib/providers/router.js` and `extractKeywords` from `lib/providers/textUtils.js` — same exact signatures as before, so every caller is unchanged; only the implementation moved.
- **`translateCaptions.js`** — calls the configured "text" provider to translate the caption array into another language, 1:1 index-preserving (required so `buildSrt` timing still lines up with the video). *Phase 5: routed through `lib/providers/router.js` instead of a hardcoded Groq fetch; prompt/behavior unchanged.* *2026-08-10 fix: retries once with a stricter, lower-temperature prompt if the model returns the wrong segment count, instead of failing that language outright.*
- `mayaThumbnail.js` — composites the YouTube thumbnail (Maya + blurred background + title text); picks Maya's pose by keyword-matching segment text against 7 moods + a default (`pickMayaPose`, built on `pickMayaPoseRanked` — full ranking, not just top pick). `buildMayaThumbnail` takes a `variant` ('A'/'B') that changes the color grade (purple-orange vs. teal-blue) and picks the 2nd-ranked pose for B; `buildMayaThumbnailVariants` builds both in one call. *Phase 5: `bgImageUrl` now accepts either a URL string or a `{buffer, ext}` object, same reasoning as `videoRender.js` above.*
- `channelHistory.js` — pulls recent video titles from YouTube itself, used as "memory" so new scripts don't repeat topics
- `youtubeAnalytics.js` — batch stats fetch for `sync-stats`
- `db.js` — Postgres pool + `videos` table (auto-created on first use), plus `title_a/title_b/thumbnail_text_a/thumbnail_text_b/active_variant` columns, `community_posts` and `repurposed_shorts` tables. *Phase 4:* `channel_auth` table (single row, holds the persisted Google `refresh_token`), `schedules` table, `schedule_runs` table, and all their CRUD/log functions. *Phase 5:* new `providers` table (name, service, encrypted `api_key`, `capabilities[]`, enabled, connectivity-check result) and `provider_priority` table (per-task-type manual ordering); `ensureBuiltInProviders()` auto-registers the legacy `GROQ_API_KEY`/`PEXELS_API_KEY` env vars (if set) plus `msedge-tts` as ordinary provider rows on first boot, idempotently.
- `repurpose.js` — `getRetentionCurve` (YouTube Analytics `elapsedVideoTimeRatio`) + `findBestRetentionWindow` (picks the highest-retention slice of a given target length; falls back to a documented heuristic window for videos too new to have retention data yet).
- `communityPost.js` — calls the configured "text" provider to write one Community Tab post draft (poll or quote) for a video. *Phase 5: routed through the router instead of a hardcoded Groq fetch.*
- **`scriptGen.js`** *(Phase 4)* — script-generation logic extracted out of `generate-script/route.js` (`generateScript({topic, mode, accessToken})`), so both the interactive route and the scheduler call the exact same code path instead of two copies drifting apart. *Phase 5: the hardcoded `GROQ_API_KEY` pre-check is gone — it now calls `generateText()` from the router, which throws its own clear error if no "text" provider is configured at all.*
- **`metadataGen.js`** *(Phase 4)* — title/description/tags/A-B-variant generation extracted out of `suggest-metadata/route.js` (`generateMetadata(script)`), same reasoning as `scriptGen.js`. *Phase 5: routed through the router; unchanged fallback-to-heuristic behavior on any failure.*
- **`pipeline.js`** *(Phase 4)* — the entire TTS→media→render→upload→thumbnail→captions→community-post sequence extracted out of `generate-and-upload/route.js` into `runPipeline(params, {emit})`. `emit(obj)` has the exact same `{status, progress}` shape the old inline `send()` had. The upload-time access-token refresh is caller-supplied (`getUploadAccessToken`) rather than hardcoded, since the interactive route refreshes from the NextAuth cookie while the scheduler refreshes from the DB-stored refresh token — `pipeline.js` itself stays agnostic of which. *Phase 5: step 1 (TTS) now calls `synthesizeSpeech()` from the router instead of constructing `MsEdgeTTS` directly; the community-post step's `GROQ_API_KEY` gate was removed (same reasoning as `scriptGen.js`).*
- **`providers/crypto.js`** *(new, Phase 5)* — `encrypt`/`decrypt` for provider API keys at rest (AES-256-GCM, key derived from `NEXTAUTH_SECRET` via SHA-256 — no new secret needed).
- **`providers/textUtils.js`** *(new, Phase 5)* — `extractKeywords`, moved out of the old `media.js` so both `media.js` and `providers/registry.js` can use it without a circular import.
- **`providers/registry.js`** *(new, Phase 5)* — the known-service "dictionary": for each of Groq/OpenAI/Anthropic/ElevenLabs/Stability AI/Pexels/msedge-tts, its capabilities, a connectivity `detect(apiKey)` probe, and per-capability adapter functions (`text`/`image`/`video`/`audio`) with the actual `fetch()` calls. `detectService(apiKey)` runs every `detect()` in parallel and returns the first match (or `'unknown'`). Adding a new provider = one new entry here; nothing else needs to change.
- **`providers/router.js`** *(new, Phase 5)* — `generateText`/`fetchImages`/`fetchClips`/`synthesizeSpeech`: for each, loads the user's priority-ordered provider list for that task from the DB and tries them top-down, falling back to the next on any failure, throwing a clear aggregated Persian error only if all of them fail (or none are configured). *2026-08-10 fix: a rate-limit error (message contains "try again in Xs") no longer counts as an immediate failure — waits that long and retries the same provider (up to 2x) before falling through to the next provider or failing.*

### Components (`src/components/`)
- `VideoStudio.js` — the whole long/short creation UI + the streaming-fetch client for `generate-and-upload`. *Phase 5: the voice-preview call to `/api/tts` no longer hardcodes `voice: "en-US-JennyNeural"` (that's an Edge-only voice name, meaningless to OpenAI/ElevenLabs) — it now sends no `voice` at all and lets whichever provider is prioritized use its own default.* *Phase 8: JSX rebuilt into 4 numbered step-cards (script → metadata/thumbnail → publish → manual upload) on the dark design system; every handler/state/fetch call is untouched.*
- `ChannelAnalytics.js` — video list + stats, per-video community-post-draft button, and A/B title switch buttons (bold = currently live variant). *Phase 8: the 10-column table is now desktop-only (`md:` and up); a stacked card view renders on mobile instead of the same table squeezed into a phone width.*
- `ApiStatus.js` — as named (still Groq/Pexels/YouTube/DB env-var checks — see `providers/route.js` above for the Phase 5 provider system's own connectivity checks). *Phase 8: added a one-line in-app note pointing to `/providers`, since this page's narrower scope was previously only documented here, not surfaced to the actual user.*
- `NavBar.js` — as named (also auto-signs-out on an unrecoverable token-refresh error). *Phase 4: added the "⏰ زمان‌بندی خودکار" nav link. Phase 5: added the "🔌 ارائه‌دهنده‌های API" nav link. Phase 8: rebuilt from hardcoded light-theme inline styles (white/`#2196F3`) to the real dark design tokens; sticky, horizontally-scrollable pill nav with real touch targets on mobile.*
- `ScheduleSettings.js` *(Phase 4)* — lists/creates/edits/deletes schedules, shows the external-cron setup instructions (with the exact URL to paste into cron-job.org, minus the secret value itself), and shows a log of recent scheduled runs (status/videoId/error). *Phase 8: day-of-week checkboxes are now tap-sized chips (same `toggleDay`/`days` Set underneath); tables get a mobile card view.*
- **`ProviderManager.js`** *(new, Phase 5)* — add-provider form (name + key → auto-detect, or manual service picker if unrecognized), table of configured providers (capability badges, enable toggle, connectivity-test button, delete), and a ▲/▼ reorderable priority list per task type (text/image/video/audio) that saves immediately on each move. *Phase 8: API key field gets a show/hide toggle; ▲/▼ buttons enlarged to real touch targets; mobile card view added.*

`HomeDashboard.js` (previously listed here as unused/legacy) was deleted in Phase 8 — see Changelog.

## Known constraints

- **`globals.css`: don't use `@apply` for utilities that don't also
  appear as a literal className somewhere in JSX** — discovered the
  hard way in Phase 8. `@apply gap-1.5 ...` inside `@layer components`
  broke the real Turbopack/Tailwind v4 build with `Cannot apply
  unknown utility class 'gap-1.5'`, even though `gap-1.5` is a
  perfectly normal utility and works fine when used directly as a
  className in JSX. Best-understood cause: `@apply` only resolves
  against the set of utilities Tailwind's content-scanner already
  found as literal classNames; a fractional-spacing value used *only*
  inside `@apply` (never directly in any component) wasn't in that
  set. Every custom class in `globals.css` is now written as plain CSS
  referencing the `@theme` custom properties directly (`var(--color-
  amber)` etc.) instead of `@apply` — safe regardless of this quirk.
  If you add a new custom class later, keep doing it in plain CSS, or
  if you do use `@apply`, first confirm every utility in it is also
  used as a literal className somewhere in the JSX you're scanning.
- Render free tier (512MB RAM, shared CPU) is *the* reason rendering is
  one segment at a time and why render speed has a hard-ish ceiling —
  software tuning helps, but a paid tier is the honest fix if it's still
  too slow.
- Google access tokens expire ~60 min; long renders now refresh the
  token right before the upload step rather than trusting the one
  fetched at request-start.
- Adding a new OAuth scope requires the user to sign out/in once before
  it takes effect (existing sessions don't retroactively gain it).
- **YouTube Data API v3 has no Community Tab endpoint.** Confirmed
  during Phase 3 — no `communityPosts.insert` or equivalent exists
  publicly. `community-post/route.js` therefore only generates and
  stores a *draft* (poll/quote text); the user still posts it manually
  from the YouTube app/Studio. If YouTube ever ships this publicly,
  swap the draft-save call for a real publish call in that route.
- **YouTube gives no way to download a previously-uploaded video's
  original file** (no `videos.download`) — only metadata/stats are
  readable back. This is why `repurpose-short` takes the source `.mp4`
  as a fresh upload from the user rather than fetching it by
  `videoId`; only the retention curve (for picking the best window) is
  pulled from the API.
- **No public API for simultaneous A/B split-testing of title/
  thumbnail either** — YouTube Studio's own "Test & Compare" feature is
  manual-only inside Studio, not exposed via Data API v3. `ab-test/
  route.js` implements the closest honest equivalent: variant A goes
  live at upload time, variant B is stored, and switching is a real
  but *sequential* `videos.update`/`thumbnails.set` call — compare
  CTR before/after the switch in Analytics, not two variants running
  at once.
- Local BGM tracks (`public/audio/bgm/calm.mp3`, `reflective.mp3`,
  `hopeful.mp3`, `uplifting.mp3`) are **not included in this repo** —
  Pexels has no audio API, so this needs a few royalty-free lo-fi/
  ambient tracks added manually to that folder. Render silently falls
  back to the old synthetic tone per file if a given mood's track is
  missing, so nothing breaks either way — it just sounds better once
  real tracks are added.
- **Why scheduled uploads use an external cron pinger instead of an
  in-app `setInterval`**: confirmed (both by the user's own earlier
  testing, see the 2026-08-06 heartbeat entry below, and by re-checking
  current Render pricing while building this) that Render's free tier
  spins the whole service down after 15 minutes with no new *inbound*
  HTTP request — while asleep, literally no JS is running, so nothing
  running inside the app can wake itself up at a scheduled time. Render
  does sell a native Cron Job product, but it's billed per-minute as a
  separate paid service (not part of the free tier), which conflicts
  with this project's explicit free-tier constraint — so
  `scheduler/run/route.js` instead expects a **free external pinger**
  (cron-job.org recommended, ~10 min interval) to hit it; the endpoint
  itself decides whether anything is actually due. If a $0 constraint
  stops mattering later, switching to Render's own Cron Job calling the
  same URL is a one-line config change, no code change needed.
- The scheduler currently has **no catch-up/retry for a missed slot**
  — if the service happens to be down for the entire ~15-minute
  tolerance window around a scheduled time (rare, but possible right
  after a deploy or an extended outage), that day's/week's run is
  simply skipped, not queued for later. Visible either way in the
  "اجراهای اخیر" log on `/schedule` (a gap where a run should've been).
- Scheduled (unattended) uploads reuse the same "let AI pick a topic"
  path already used interactively — there's no per-schedule topic
  queue. Script/metadata quality is exactly what the manual path
  already produces, since both now call the same `lib/scriptGen.js` /
  `lib/metadataGen.js` functions.
- The Google **refresh token is now also persisted to Postgres**
  (`channel_auth` table, `saveRefreshToken`/`getRefreshToken` in
  `db.js`) — required so the scheduler can mint a YouTube access token
  with nobody logged in. Single-row table, matching this app's
  single-channel design; re-signing-in overwrites it. If Google ever
  stops returning a `refresh_token` on a given sign-in (it only does
  so reliably on first consent per app+account), the old one already
  in the DB is kept as-is rather than overwritten with nothing.
- **API provider keys are encrypted at rest but not secret-manager-grade**
  — AES-256-GCM with a key derived from `NEXTAUTH_SECRET`, not a
  dedicated KMS. Anyone with `DATABASE_URL` *and* `NEXTAUTH_SECRET`
  could decrypt them; this is a reasonable bar for a single-user app on
  a free-tier host, not a multi-tenant security boundary.
- **`video` capability has exactly one adapter (Pexels stock search)** —
  real AI video generation (Runway/Pika/Luma/Kling-style) is async and
  job-polling by nature (often minutes per clip), which doesn't fit this
  app's request/response pipeline or the 512MB RAM ceiling without a
  much bigger redesign (job queue, webhook or polling loop, temp storage
  for in-progress renders). Left out deliberately rather than shipped
  half-working; the registry is structured so adding one later is a
  single new entry in `providers/registry.js`, no other file changes.
- **Provider model choices are hardcoded, not user-configurable** — e.g.
  the OpenAI text adapter always uses `gpt-4o-mini`, Anthropic always
  `claude-sonnet-5`. Picking a specific model per provider (not just
  per capability) would need its own UI; out of scope for Phase 5.
- **Maya's mouth movement is a rhythmic flap, not real lip-sync** — it
  doesn't analyze the narration audio's amplitude at all, just cycles
  the `-talk` frame on a fixed ~4-5Hz beat for as long as she's on
  screen. A real amplitude-driven version is possible (ffmpeg `astats`/
  `ametadata` to extract a volume envelope, build the `enable=` windows
  from that instead of a fixed period) but adds a whole extra
  ffmpeg pre-pass and much longer filter expressions for a difference
  most viewers won't consciously notice — not worth it unless it turns
  out to look wrong in practice.
- **`{pose}-talk.png`/`{pose}-blink.png`/`{pose}-talk-blink.png` must
  exactly match the base file's canvas size and character position**
  — the animation code overlays them at the identical coordinates
  every frame; if the art shifts even a few pixels between variants,
  swapping will visibly jump instead of reading as a mouth/eye change.
  In practice, exports from tools like Picsart auto-crop each image
  tightly to its own content, so this almost never holds for raw
  exports straight out of such a tool — they need a normalization pass
  (pad every variant for a pose onto a shared, bottom-anchored canvas
  first) before dropping them into `public/maya/`. Not something
  Claude can verify on a future pass without being handed the raw
  exports again — this isn't validated at render time, a misaligned
  file will just render with a visible jump/pulse, not an error.
- **Maya pose-name mapping for hand-drawn/exported art can't be
  verified without the actual base files** — when 8 poses' worth of
  new art arrives without pose labels in the filenames, matching each
  one to `excited`/`thinking`/etc. is inference from gesture semantics
  against `mayaThumbnail.js`'s `POSE_KEYWORDS`, not certainty. Worth a
  quick visual check against the live `public/maya/{pose}.png` files
  after any such batch lands.
- **The 8-minute floor is enforced by word count, not real duration**
  — `generateScript()`'s safety net counts words and assumes ~140wpm
  for mindful-paced narration; it can't know the actual TTS duration
  until *after* audio synthesis (which happens later, in the
  pipeline, per-provider). If actual narration consistently comes out
  faster/slower than that estimate across many videos, the 1150-word
  retry trigger should be recalibrated — `runPipeline()`'s post-TTS
  warning log is exactly there to catch that drift, so check Render's
  logs occasionally for it rather than assuming the word-count proxy
  stays accurate forever.

## Changelog

Newest first. Add new entries above the top one — date, what, why, files.

### 2026-09-05 — Auto-produce (worker mode) now marks the Trend Finder topic "produced"
Closed the known 🟡 gap: under `USE_RENDER_WORKER=true`, `api/auto-produce/route.js` couldn't
mark a Trend Finder topic `produced` because the upload happens asynchronously via
`api/jobs/callback`, minutes after the dispatching request has already returned — `videoId` was
never in scope at dispatch time.

Traced two possible sources for `trendTopicId` at callback time before picking one. The callback
route already destructures an echoed `payload`/`signature` off the request body for optional
signature re-verification, which would have carried the original job `input` (including a
`trendTopicId` added there) straight through — looked like the obvious hook. Checked
`worker/index.js: reportResult()` directly rather than assuming, and it only ever POSTs
`{ status, result, error }`, never `payload`/`signature` — so that echoed-payload branch in the
callback has always been dead code, the `payload && signature` check never fires for a real worker
run. Used `worker_jobs.input` instead, via the existing `getWorkerJob()`, which is populated at
dispatch time regardless of what the worker echoes back.

Fix: `api/auto-produce/route.js` now includes `trendTopicId: trendTopicRow?.id || null` in the job
`input` handed to `dispatchAndTrackJob()` — a harmless extra field, since `runPipeline()`
destructures only its named params, so it's silently ignored on the worker side even though the
same `input` object is what gets sent to the worker. `api/jobs/callback/route.js` now calls
`getWorkerJob(jobId)` after confirming a successful `result.videoId`, reads `input.trendTopicId`
back off the row, and calls `markTrendTopicProduced()` — same fire-and-forget `.catch()`-style
error handling as the in-process path in `lib/autoProduce.js`, so a bookkeeping failure here can
never fail the callback response for a video that already uploaded fine.

Verified both files with `node --check` on `.mjs` copies per this file's own note under Known
constraints (not the unreliable plain-`.js` check). Not yet verified against a real worker run
(needs `USE_RENDER_WORKER=true`, an approved trend topic, and an actual GitHub Actions dispatch) —
the in-process path's equivalent logic in `lib/autoProduce.js: autoProduceVideo()` was untouched,
so no regression risk there.

Files (modified): `app/api/auto-produce/route.js`, `app/api/jobs/callback/route.js`.

### 2026-09-05 (later same day) — Found and fixed the real cause of 4 consecutive Render build failures: `lib/comments/index.js` was never actually committed
User forwarded four Render build logs (2026-08-31 through 2026-09-04), all failing with the
identical Turbopack error `Module not found: Can't resolve '@/lib/comments'` in
`api/comments/route.js`. The recurring "Encountered unexpected file in NFT list" warnings at the
top of each log are unrelated noise — non-fatal, and each log itself confirms exactly one real
error (`Turbopack build failed with 1 errors`).

Ruled out a Turbopack directory-import limitation before assuming one: `api/community/route.js`
does the exact same `await import("@/lib/X")` of a folder-with-`index.js` (`@/lib/community`), and
that build has never failed. Checked the file the user actually has locally (via an uploaded
`src.zip`) — `lib/comments/index.js` exists, is syntactically valid (`node --check` on an `.mjs`
copy), and is structurally identical to `lib/community/index.js`. Works for one identically-shaped
module, fails only for the other, on a file confirmed present on disk — pointed at a git-tracking
problem rather than a code problem: the file most likely existed locally since `comments/route.js`
was added (2026-08-30) but was never `git add`ed alongside it, so every push since has been missing
it on GitHub even though nothing about the code itself was wrong.

Had the user confirm rather than assume, with a conditional Termux script
(`git ls-files --error-unmatch src/lib/comments/index.js`) before touching anything — it printed
the "never committed" branch. Fixed with `git add src/lib/comments/index.js && git commit && git
push` — commit `7366055` (previous HEAD `f75d75b`), one file, 126 insertions, `create mode 100644`
(git's own confirmation this was a brand-new blob to the repo, not a re-add of something already
tracked).

Files (added — was already written 2026-08-30, only now actually pushed): `lib/comments/index.js`.

### 2026-08-31 (later same day) — Cluster-based playlist automation + unified dashboard
Last two items from the original "10 ideas" list, built together as asked.

**Playlist automation (growth idea #4).** New `lib/playlists/index.js`: 7 fixed topic clusters
(anxiety, burnout, mindfulness, discipline, confidence, stoicism, relationships — chosen to align
with `lib/trends/seeds.js`'s niche keywords, just grouped rather than one-keyword-per-entry, since
a playlist needs to cover a cluster of related terms, not a single seed). `matchCluster()` scores
a new video's script against each cluster's keyword list — reused the same word-overlap approach
(and 2-word minimum threshold) already proven for the "related video" CTA and A/B matching earlier
today, rather than inventing a new technique. Verified against 4 realistic scripts spanning
different themes (anxiety, stoicism, boundaries, and one deliberately unrelated script) — each
correctly matched or correctly matched nothing.

`ensurePlaylistForCluster()` checks the new `playlist_clusters` DB table first; only calls
`youtube.playlists.insert()` the first time a cluster is ever matched, then reuses that same
playlist ID for every subsequent video in that cluster. Re-reads the DB row after insert (handles
the rare race where two videos both trigger cluster creation at nearly the same moment — the
`ON CONFLICT (cluster_key) DO NOTHING` on the save means only one write wins, so re-reading
guarantees using whichever ID actually got persisted, not necessarily the one this specific call
just created). Wired into `pipeline.js` right after upload, reusing the same already-authenticated
`youtube` client the upload itself just used — no second OAuth round-trip. Same graceful-
degradation pattern as the community-post section right next to it: tracked via a `playlistStatus`
field on the pipeline result, never throws, never blocks the rest of the pipeline.

**Unified dashboard (site improvement #3).** New `components/dashboard/DashboardSummary.js`,
added to the top of the home page (`app/page.js`, above the existing nav-card grid, which stays
as-is). Fetches `/api/activity`, `/api/trends`, and `/api/schedules` in parallel on mount — three
already-existing endpoints, no new API surface needed. One correction made while building it: the
Trend Finder card originally showed `latestScan.topics_found`, which is how many topics the *last
scan* found — not the same as how many are still actually pending review (some could have been
approved/rejected since). Switched to querying `status=pending` directly and using the real
result count, so the number shown matches what `/trends` itself would show.

Files (new): `lib/playlists/index.js`, `components/dashboard/DashboardSummary.js`. Files
(modified): `lib/pipeline.js`, `lib/db/index.js`, `lib/activityLog.js`,
`components/activity/ActivityFeed.js`, `app/page.js`.

### 2026-08-31 — "Watch next" CTA in the description, not a pinned comment
Last item from the original "10 ideas" list actually built as proposed (growth idea #3) needed a
correction first: my own original framing ("CTA in a pinned comment") isn't possible — YouTube
Data API v3 has no comment-pinning endpoint at all, already documented in this project's own
`ROADMAP.md` known-constraints section. The description, via the same `videos.update` call the
upload flow already makes, is the part that's actually fully automatable — so that's what got
built instead.

`lib/metadata/index.js`'s `generateMetadata()` was restructured: the existing AI-generation +
heuristic-fallback logic moved into an internal `generateMetadataCore()`, and the exported
`generateMetadata()` is now a thin wrapper that appends a "watch next" line (title + link) to
whichever description comes back, pointing at the most topically-related past video — covers
every exit path (AI success, both heuristic-fallback branches) through one shared post-processing
step rather than duplicating the append logic at each return point.

Matching is simple word-overlap, not another AI call: reused the `STOPWORDS` set and keyword-
extraction approach already in this file (`extractKeywords()`, used elsewhere for the heuristic
fallback) to score past videos' titles against the new script's meaningful words, requiring at
least 2 shared words before recommending anything (avoids linking two videos that just happen to
share a common word like "morning"). Verified against 4 scenarios with real overlapping content:
correctly picked the actually-relevant video out of 3 candidates, correctly returned no match for
an unrelated script, correctly handled zero past videos (a channel's first few uploads), and
correctly refused a 1-word-overlap case that's below the 2-word threshold. Fails silently (bonus
feature, not core) if the DB lookup errors — never breaks metadata generation itself.

Files: `lib/metadata/index.js`.

### 2026-08-30 (later same day) — Comment-reply drafts: connected, not built from scratch
Continuing the "10 ideas" list: growth idea #2. `lib/comments/index.js` already existed — fully
built (`generateCommentReplyDrafts()`, `getRepliesForVideo()`, its own `comment_replies` table,
its own small `pg` pool, dedup logic so re-running on a video doesn't re-spend AI calls on
comments already drafted) — same situation as yesterday's BGM system: complete at the library
level, zero callers anywhere in `app/` or `components/`. Confirmed by grep before writing anything,
not assumed.

Built the missing connecting layer only: `api/comments/route.js` (POST generates drafts for a
video's top comments by relevance, GET lists existing drafts — mirrors `api/community/route.js`'s
exact pattern for consistency, including the same "this is a draft, YouTube's API doesn't support
auto-publish" framing already used there), and a "💬 پیش‌نویسِ پاسخِ کامنت‌ها" button in
`ChannelAnalytics.js`'s `VideoActions`, right next to the existing community-post-draft button —
same component, same interaction pattern, minimal new surface area. Added `comment_replies_drafted`
to the activity log's type→emoji maps (both `lib/activityLog.js` for notifications and
`ActivityFeed.js` for the in-app feed) for consistency with every other event type.

One real subtlety handled: the POST response shape (fresh drafts, `{authorName, text, replyDraft,
commentId}`) and the GET response shape (existing drafts, raw DB columns:
`{author_name, comment_text, reply_draft, comment_id}`) are different — the UI reads both with a
fallback chain rather than assuming one shape, since the same component needs to render either
depending on whether the person just generated drafts or is viewing previously-generated ones.

Files (new): `app/api/comments/route.js`. Files (modified): `components/analytics/
ChannelAnalytics.js`, `lib/activityLog.js`, `components/activity/ActivityFeed.js`.

### 2026-08-30 (later same day) — Retention data feeds back into the script prompt
Continuing the "10 ideas" list: growth idea #1. `script/index.js` already had one feedback loop
(`getTopPerformingVideos()` — shows the AI which past videos' *openings* worked well, by
`retention_pct`). This is a genuinely different, complementary signal: not which videos did well,
but *where within a typical video's runtime* this channel's audience tends to drop off, so the
next script can be paced to push through that exact zone.

`lib/repurpose/index.js`'s `getRetentionCurve()` already existed (built for the repurpose
feature) and returns `{ratio, watchRatio}` points — `ratio` is *relative* elapsed time (0-1, not
absolute seconds), which is exactly what makes it possible to average across videos of different
lengths. New `getAggregateRetentionInsight(accessToken, videoIds)`: fetches the last several
same-mode videos' curves in parallel (`Promise.allSettled`, not sequential — this runs on the
live script-generation path, so added latency directly costs the person waiting), buckets each
point into one of 10 deciles, averages `watchRatio` within each bucket across all videos, and
returns whichever decile has the lowest average — i.e. where retention consistently drops most.
Requires at least 2 videos with usable data (a single video's dip could just be that video's own
issue, not a channel-wide pattern) — verified with synthetic curves carrying a deliberately known
dip: correctly located it, correctly refused to produce an insight from just one video, and
correctly tolerated individual video fetch failures (one bad video among several doesn't kill the
whole insight, verified with a simulated partial-failure scenario).

Wired into `generateScript()`: when there's enough data, injects a specific pacing instruction
naming the exact percentage range where this channel's audience typically drops off, asking the
model to deliberately re-hook attention right around that point in the new script. New
`lib/db/index.js: getRecentVideoIdsByMode()` to fetch the video IDs needed. Silently skipped (no
instruction added, script generation proceeds normally) when there isn't enough retention history
yet — same graceful-absence pattern as the existing top-performers feedback loop right next to it.

Files: `lib/repurpose/index.js`, `lib/script/index.js`, `lib/db/index.js`.

### 2026-08-30 (later same day) — Closing the A/B test loop: real before/after comparison
Continuing the "10 ideas" list: site improvement #5. First had to correct my own assumption from
when I proposed this — this project's A/B test isn't a simultaneous split-test (YouTube's public
API has no way to show two titles to two viewer groups at once); it's a *sequential* switch: the
video starts on variant A, a human can later switch the live video to variant B
(`api/ab-test/route.js`, already existing, records `variant_switched_at`), and the comment there
already said the intent was comparing CTR before/after in analytics — just manually, with no
actual comparison built. Built that comparison.

`lib/analytics/index.js` already had `videoThumbnailImpressionsClickRate` (real CTR) available
from the YouTube Analytics API, just hardcoded to an all-time date range. Added
`fetchStatsForVideoInRange()` — same query, caller-supplied date range — so before/after periods
around the switch can be queried separately. Verified the metric-array destructuring position by
position against a realistic API row shape (an off-by-one here would silently return the wrong
metric as CTR).

New `api/ab-test/results/route.js`: splits the video's lifetime at `variant_switched_at` (with a
1-day gap on each side of the switch date, so no single day gets counted as partially-old,
partially-new data), queries both periods, and compares CTR (the right signal for a title/
thumbnail test — raw view count is also affected by unrelated factors like the algorithm or time
of day) plus views/day normalized by each period's actual length. Two guards, both verified with
concrete date-math test cases: refuses to compare if fewer than 2 days have passed since the
switch (YouTube Analytics has a 1-2 day processing delay, so very recent data would be incomplete
or misleading), and if the switch happened before there's enough "before" history to compare
against.

`lib/db/index.js: getAllVideos()` now also selects `variant_switched_at` (needed by the UI to know
whether a comparison is even possible). New "📊 نتیجه‌ی A/B" button in
`components/analytics/ChannelAnalytics.js`, next to the existing switch buttons, only shown once a
switch has actually happened — shows the verdict plus a side-by-side CTR/views-per-day
before/after breakdown.

Files: `lib/analytics/index.js`, `lib/db/index.js`, `app/api/ab-test/results/route.js`,
`components/analytics/ChannelAnalytics.js`.

### 2026-08-30 (later same day) — Real silence trimming implemented; found + fixed a pre-existing bug that had silently disabled yesterday's checkpoint 3
Continuing the "10 ideas" list: site improvement #2, enabling `trimSilenceFromAudio`/
`detectLongSilences` (previously placeholder no-ops per the known-issues list).

**What got built.** Both now do real work via FFmpeg's `silencedetect` filter, verified against a
synthetic audio file with a precisely known silence pattern (1.0s leading + 2.0s tone + 0.5s gap +
2.0s tone + 3.0s gap + 1.0s tone + 1.5s trailing), not just plausible-sounding code:
- `detectLongSilences()` — parses `silencedetect`'s stderr output. Verified it correctly flags
  only the genuine 3-second internal gap at a 2.5s threshold, ignoring the leading, trailing, and
  short (0.5s) internal ones.
- `trimSilenceFromAudio()` — deliberately does NOT use the `silenceremove` filter's
  `stop_periods=-1` (the usual way to strip trailing silence): testing against the same known file
  showed it also strips *internal* gaps, not just trailing ones, which would desync all the
  downstream caption/image timing this function is supposed to run before. Uses a detect-then-cut
  approach instead (find real content start/end via `silencedetect`, then `-ss`/`-to` with
  `-c copy`, no re-encode) — verified it removes leading+trailing (11.06s → 8.50s, matching the
  known 1.0s+1.5s expected removal) while preserving the internal gap exactly. Also verified the
  no-silence-at-all and trailing-only-no-leading edge cases behave correctly, and that failures
  (bad ffmpeg output, corrupt input) fall back to the untrimmed audio rather than breaking the
  pipeline.

**Found a second, unrelated, pre-existing bug while testing.** `probeDurationSec()` — used for
the final rendered video's duration (`pipeline.js`, feeds `recordVideo()` and yesterday's
checkpoint 3) — passed `ffprobe`-only flags (`-select_streams`, `-show_entries`, `-of`) to the
`ffmpeg` binary (not `ffprobe` — this project only guarantees `ffmpeg` is installed, via
`@ffmpeg-installer/ffmpeg`). `ffmpeg` doesn't recognize those flags and errors out, so
`probeDurationSec()` had *always* silently returned `0`, not just in some edge case — confirmed by
direct testing, not just reading. This wasn't found by inspection; my new silence-trim functions
also needed accurate duration, and testing them exposed it. Consequence for yesterday's
checkpoint 3 (real render duration vs. expected audio duration, >15% mismatch flags for review):
since `durationSec` was always `0`, the "mismatch" was always ~100% — meaning checkpoint 3 had
been flagging *every single video* since it was added yesterday, not just genuinely broken ones.
Fixed using the exact same approach already proven for `estimateAudioDurationSec`
(2026-08-28 changelog entry): `ffmpeg -i <file>` + parsing the `Duration: HH:MM:SS.ss` line from
stderr, rather than assuming a separate `ffprobe` binary exists. Verified against both an audio
file (11.06s) and a real generated video file (4.2s) — both now measure correctly; confirmed the
old code really did return exactly `0` for the same file first, for a direct before/after
comparison.

Files: `lib/rendering/index.js`.

### 2026-08-30 — Three more from the "10 ideas" list: Telegram/Discord alerts, seasonal trend keywords, real fix for the known 🔴 worker-credential bug
Continuing from yesterday's prioritized list (easiest/lowest-risk first).

**Active notifications (site improvement #4).** Extended `lib/activityLog.js`'s `logEvent()` —
already the single choke-point for every site event since yesterday — to also push each event to
Telegram (`TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID`) and/or Discord (`DISCORD_WEBHOOK_URL`) if
configured, no per-call-site changes needed anywhere. The one real design requirement: the DB
write and the notification sends had to be genuinely independent — a DB hiccup must never
silently swallow a notification, and a Telegram/Discord outage must never lose the DB row. Verified
both directions with fake `pg`/`fetch` mocks that always throw: confirmed notifications still fire
when the DB is fully unreachable, and confirmed the DB row still gets written when both
notification channels are broken. Optional `ACTIVITY_NOTIFY_TYPES` (comma-separated) to restrict
which event types notify, if the full list feels noisy — defaults to everything.

**Seasonal trend keywords (growth idea #5).** `lib/trends/seeds.js` now adds a small set of
calendar-aware keywords (by current month — e.g. "back to school anxiety" in Aug/Sep, "new year
resolutions" in Jan, "holiday stress" in Nov) on top of whichever base seed list is active, rather
than replacing it — niche relevance stays fully intact, timely angles just get added. Verified: the
full base list is always preserved, the current real month (August) correctly adds
back-to-school-related seeds, `TREND_SEASONAL_KEYWORDS=false` fully disables it, and it composes
correctly with a custom `TREND_SEED_KEYWORDS` override.

**The known 🔴 worker-credential-expiry bug — actually fixed, not just described.**
`lib/jobs/index.js: generateWorkerCredential()`'s default `expiresInMs` was 5 minutes; the
credential is generated once at dispatch and used once at callback, up to the documented 15-45
minutes later — meaning most real jobs, even ones that rendered and uploaded successfully, would
get rejected at the final callback and sit at "running" forever. Only one call site used the
default (`dispatchAndTrackJob`), so raising it there was a complete, low-risk fix — no mid-job
refresh mechanism needed since there's nothing to refresh, just one credential used once, much
later than 5 minutes. Changed the default to 60 minutes (comfortable margin above 45, plus GitHub
Actions queue-start delay). Verified concretely: extracted the actual functions (only depend on
Node's built-in `crypto`, no new dependency needed for the test) and simulated a 20-minute-old
credential — rejected under the old 5-minute default (reproducing the real bug), accepted under
the new 60-minute one; also confirmed a genuinely-stale 65-minute credential still correctly
expires either way.

Files: `lib/activityLog.js`, `lib/trends/seeds.js`, `lib/jobs/index.js`.

### 2026-08-29 (later same day) — Three-checkpoint quality gate (script / voice+media / final video)
User's own addition to the "10 ideas" batch: check after script is written, check voice+media
together after both are ready, check the finished video. Reused existing mechanisms wherever one
already existed, rather than building a parallel system.

**Checkpoint 1 (script) — `lib/script/index.js`.** A rule-based self-check + one-shot
self-correcting retry already existed here, but only for long-form (word count, sentence-starter
variety, presence of a concrete example). Extended it to shorts too (previously zero self-checking
— notably, the exact video with the mid-sentence cutoff was a short). Added a genuinely new
capability: an AI-judged review call (`jsonMode: true`) checking the two qualitative things
today's earlier Gemini-review prompt fixes asked the model to do — does the hook actually get
delivered on, is the tone calibrated to the idea's size — a generator+verifier pattern instead of
just hoping the model follows its own prompt. Both structural and AI-judged issues feed the SAME
existing retry mechanism. Verified the JSON-parsing against realistic response shapes (clean,
markdown-fenced, prose-prefixed, garbage) — malformed responses are caught and skipped, never
crash script generation. Persistent issues (after the one retry) are logged via `logEvent()`
(today's activity-log feature) rather than blocking — matches this codebase's established
warn-don't-block philosophy.

**Checkpoint 2 (voice + media together) — `lib/pipeline.js`, right after both are ready, before
render.** Two new checks, both feeding the existing `needsReviewReasons` array (moved its
declaration earlier so checkpoints 2 and 3 can both write to it): (a) audio duration compared
against a *script-length-implied* expected duration (~2.5 words/sec), not an absolute threshold —
more precise than an absolute-seconds check since it scales with the actual script. Verified with
real numbers including the exact reported bug's ratio (~22s actual vs ~44s expected): initially
used a 50% threshold, which landed exactly on that scenario's boundary and could miss it on strict
inequality — loosened to 60% after catching this in testing, confirmed it now flags the real bug
scenario without over-flagging a normal-paced short. (b) media download failure ratio — flags when
>40% of images/clips failed to download (meaning a lot of repeated fallback images in the final
video).

**Checkpoint 3 (finished video) — `lib/pipeline.js`, right after the real render completes.**
Compares the actual rendered output's real duration (already ffprobe-measured via
`probeDurationSec`, used for reporting) against the audio duration — flags a >15% mismatch. This
is independent of today's earlier `estimateAudioDurationSec` fix — that fixed the *measurement*;
this catches a *render-level* truncation even if measurement is accurate (e.g. a future
`distributeDurations` bug), so it's a genuinely separate safety net, not a duplicate of the
earlier fix.

All three checkpoints are flagging-only (append to `needsReviewReasons`, surfaced via the
`video_uploaded` activity-log message's metadata), not blocking — consistent with how
`needsReviewReasons` already worked before today. Caught one real bug in my own first draft while
writing this: the script-review edit accidentally dropped the function's closing brace and
`return { script }` statement — caught immediately by the routine full-syntax-check pass, not
shipped.

Files: `lib/script/index.js`, `lib/pipeline.js`.

### 2026-08-29 (later same day) — New: site-wide activity log (`/activity`)
User asked for a report/log section that says when any video uploads, and reports "everything that
happens on the site." Built as a new `lib/activityLog.js` (own small `pg` pool, same pattern as
`lib/trends/db.js`, one table: `activity_log`). The one non-obvious design point: `logEvent()` must
NEVER throw or reject, since it's called from inside critical paths (right after a real YouTube
upload succeeds) — a logging hiccup must never make an otherwise-successful upload look like it
failed. Verified this directly, not just by inspection: built a fake `pg` module that always
throws (simulating a fully unreachable DB) and confirmed `logEvent()` neither throws when awaited
nor produces an unhandled rejection when used fire-and-forget (its actual usage pattern
everywhere it's called). Also verified the real insert/select SQL logic (ordering, type
filtering, metadata JSON round-tripping) against a working fake DB.

Instrumented every real "thing that happens" currently in the app:
- `lib/pipeline.js`'s `runPipeline()` wrapper — the single choke-point every in-process video
  goes through (manual generate-and-upload, scheduled runs, auto-produce all call this same
  function), so one pair of log calls here (success/failure) covers all three without touching
  each route separately.
- `api/jobs/callback/route.js` — the worker-dispatch completion path is a genuinely separate
  execution (render happens on the GitHub Actions runner, not in this process), so it needed its
  own log calls; `pipeline.js`'s never fire for that path.
- `lib/trends/index.js: runTrendScan()` — scan completed/failed.
- `api/scheduler/run/route.js` — logs when a schedule actually *triggers* (distinct from the
  eventual upload success/failure `pipeline.js` already logs — this one tells you the automation
  fired at all, even before knowing the outcome).
- `api/repurpose/route.js` — both the auto-upload case (`video_uploaded`) and the download-only
  case (`repurpose_completed`).
- `api/community/route.js` — community post *draft* creation (worded carefully as a draft, since
  the YouTube API has no real publish endpoint for the Community tab — this project's own existing
  comment already makes that clear, the log message just doesn't contradict it).

New page `/activity` (`components/activity/ActivityFeed.js`) — icon-per-type feed, type filter
tabs, 30s auto-refresh, matches the existing design system. New session-gated
`api/activity/route.js` (GET, optional `type`/`limit` query params). Nav link and home-page card
added.

Files (new): `lib/activityLog.js`, `app/api/activity/route.js`, `app/activity/page.js`,
`components/activity/ActivityFeed.js`. Files (modified): `lib/pipeline.js`,
`app/api/jobs/callback/route.js`, `lib/trends/index.js`, `app/api/scheduler/run/route.js`,
`app/api/repurpose/route.js`, `app/api/community/route.js`, `components/layout/NavBar.js`,
`app/page.js`.

### 2026-08-29 (later same day) — Gemini's channel-growth-strategy review: checked all 6 points against real source, found one major disconnected feature
User pasted a second Gemini review, this time about growth strategy (thumbnails/titles/CTR, hooks,
brand cleanup, audio/visual polish, SEO/captions, posting cadence). Went through all 6 points
against the actual code rather than assuming any needed work.

**Biggest finding: BGM (background music) was fully built and exported, but never called.**
`lib/rendering/index.js: pickBgmPath()` — a complete, mood-based BGM track picker ("فاز ۳" per its
own header comment) with graceful degradation (returns `null`, never throws, if the mp3 files
aren't present in `public/audio/bgm/` yet) — existed and was exported, but `lib/pipeline.js` had
`bgmPath: null` hardcoded at its one call site and never imported or called `pickBgmPath` at all.
The entire feature was dead code from the caller's side. Wired it in: `getRendering()` now also
returns `pickBgmPath`, and the render call uses `await pickBgmPath(script)` instead of the
hardcoded `null`. Verified with real tests (extracted the actual function, not a rewrite): with no
files in `public/audio/bgm/` (today's real state) it returns `null` exactly like before — this
fix is a no-op until BGM mp3 files actually exist there, then it activates automatically. Also
verified correct mood-matched file selection once matching files are added. **User still needs
to add actual royalty-free mp3s to `public/audio/bgm/`** (see the file's own naming scheme:
`calm.mp3`/`calm-2.mp3`/`calm-3.mp3`, `reflective.mp3`, `hopeful.mp3`, `uplifting.mp3`, one or
more per mood) — this fix only reconnects the plumbing, it can't invent the actual audio files.

**Points already covered by existing prompts/code — no action needed, verified not just assumed:**
- Pain-point titles + curiosity-gap thumbnail text distinct from the title: already strictly
  required in `lib/metadata/index.js`'s prompt (which explicitly forbids vague/poetic titles like
  "Memory Echoes" — the exact style of title Gemini's example criticized, suggesting the reviewed
  video predates this rule or the model didn't fully comply that one time).
- Auto-contrast thumbnail text color, mood-based Maya pose/expression, two distinct A/B color
  grades: already in `mayaThumbnail.js`.
- Multi-language captions, Spanish and Persian specifically included: already 5 languages
  (`pipeline.js: CAPTION_LANGUAGES` — es/pt/ar/hi/fa).
- Keyword-led description opening + 10-15 SEO tags: already required in the metadata prompt.
- Short-form hook strength: already addressed by yesterday's script-prompt pass.

**Gaps found and fixed in `lib/script/index.js`/`mayaThumbnail.js`:**
- Long-form videos had no instruction to preview what the viewer will get early — the structure
  went straight from hook into a root-cause deep-dive, with actionable steps not arriving until
  section 4 of 4. Added: within the first 30-45 seconds, briefly state what the viewer will walk
  away with, before going deep — without flattening the existing depth-first structure.
- Stress/anxiety/burnout — a core topic for this channel — had zero keyword coverage in
  `POSE_KEYWORDS`, so those videos always fell through to a generic default pose/BGM mood instead
  of one matching the topic. Mapped to the existing `surprised` pose (closest available visual
  proxy to shock/distress) rather than inventing a new pose needing an asset that doesn't exist.
  This also improves BGM mood-matching for the same videos, now that BGM is wired up.
- Added a punctuation-based pacing note (commas/em dashes/ellipses for natural spoken rhythm) as
  the TTS-emotion improvement Gemini asked for — SSML pause tags were deliberately NOT used since
  msedge-tts doesn't reliably support SSML (documented constraint), so this is the provider-
  agnostic version of the same idea.

**Not code changes — flagged back to the user rather than built:**
- Unlisting/privating old inconsistent shorts featuring real people: a content-library judgment
  call on existing uploads, not something to automate unilaterally.
- Actually adding the BGM mp3 files themselves (plumbing is fixed, files are not code).
- Posting cadence (2 long/week + 1 short/day): the existing `/schedule` feature already supports
  this — it's a configuration the user sets, not a new feature to build.
- ElevenLabs-specific emotion/pitch settings: only applicable if ElevenLabs is actually the
  configured "audio" provider on `/providers` — not assumed either way.

Files: `lib/pipeline.js`, `lib/rendering/mayaThumbnail.js`, `lib/script/index.js`.

### 2026-08-29 — Real root cause of the mid-sentence cutoff bug (from Gemini's review of an actual video), + two script-prompt calibrations
User pasted Gemini's review of a video the new auto-produce pipeline made. Investigated all 4
points against the real source rather than accepting the framing at face value.

**Point 3 (cut off mid-sentence at 22s) — genuinely the most important one, and NOT a prompt/
word-limit issue.** Traced it to `lib/rendering/index.js: estimateAudioDurationSec()`. For a real
audio Buffer, it estimated duration as `buffer.length / 16000` — i.e. it assumed the TTS audio is
always encoded at exactly 128kbps and guessed duration from file size alone, never actually
looking at the audio. Proved this is wrong, concretely: generated a real 7.3-second audio file at
32kbps (a bitrate speech-only TTS output plausibly uses) and the old formula estimated **1.85
seconds** — a 4x error. This `audioDurationSec` value drives the ENTIRE render timeline
(`distributeDurations`, media count, caption/chapter sync), and the final render uses `-shortest`
(`videoRender.js`) — so an underestimate doesn't just mistime captions, it truncates the actual
output (audio included) at that wrong, early point. This is a precise mechanical match for "cuts
off mid-sentence at 22s": if the true bitrate isn't 128kbps, the estimate runs short, and
`-shortest` chops the real audio there.
Fixed by replacing the file-size guess with an actual measurement: writes the buffer to a temp
file and runs `ffmpeg -i <file>` (not a separate `ffprobe` binary, which `@ffmpeg-installer/
ffmpeg` doesn't guarantee is installed alongside `ffmpeg` — this only depends on the `ffmpeg`
binary the whole project already relies on), parsing the `Duration: HH:MM:SS.ss` line ffmpeg
prints to stderr even with no output file specified. Falls back to the old file-size guess (with a
warning) only if that parse fails, so a single bad probe can't crash the pipeline. Verified against
the real function (not a re-typed copy) with a real 7.3s/32kbps file: correctly measured 7.34s.
Also verified the untouched string-input branch and the failure-fallback path both still behave
correctly. Also added the missing symmetric case to `needsReviewReasons` in `pipeline.js` — there
was already a check for a short being abnormally *long* (>90s) but none for abnormally *short*
(now: <15s flagged), which is exactly the class of problem that let this go unnoticed. This is a
safety net on top of the real fix, not a replacement for it — `needsReview` is informational only
(doesn't block upload; the auto-produce path's own `privacyStatus: "private"` default is what
actually protects an unattended run).

**Points 2 (catchy hook, no delivered payoff) and 4 (tone too epic for a small idea) — real
prompt gaps, addressed in `lib/script/index.js`'s Requirements list.** Added: whatever the hook
promises, the Insight section must concretely deliver it (a viewer should be able to state in one
sentence what they walked away with); and emotional weight should match the actual size of the
idea — small insights should sound warm and clear, not epic, saving bigger swings for ideas that
earn them.

**Point 1 (no consistent visual anchor / random stock footage of bees, ships, cars) — Gemini's
suggested fix ("add a prompt for a permanent cartoon host") isn't actually a prompt change.**
Maya already exists as a character (`rendering/mayaThumbnail.js: pickMayaPose()` +
`buildMayaThumbnail()`), but only for the static YouTube thumbnail — she never appears inside the
video body itself, which is 100% stock Pexels B-roll matched to script keywords. Two genuinely
different-sized fixes are possible here (a small persistent overlay using Maya's existing pose
images vs. a full animated/talking on-screen host, which needs new video assets or a talking-
avatar generation service this project doesn't have yet) — raised with the user as a scoping
question rather than picked unilaterally, since the two options differ by roughly an order of
magnitude in effort and the second needs a real product decision, not just a code change.

Files: `lib/rendering/index.js`, `lib/pipeline.js`, `lib/script/index.js`.

### 2026-08-28 (later same day) — Real upload failure, from an actual worker run: empty-title bug in generateMetadata()
User pasted the GitHub Actions log from a real `render_video` job (#32). Script generation, media,
and a full 2m37s render all succeeded, then the upload step failed: `The request metadata specifies
an invalid or empty video title.` — after 3 minutes of render time already spent.
Traced to `lib/metadata/index.js: generateMetadata()`. Its own comment claims "هیچ‌وقت throw
نمی‌کنه — هر مسیر شکست به heuristicMetadata برمی‌گرده" (never throws — every failure path falls
back to the heuristic), but that was only true for a `JSON.parse` failure or `generateText()`
itself throwing. A THIRD case wasn't covered: the AI's JSON response parses fine but simply omits
(or empties) `titleA`/`title` — this returned `{ title: "", source: "ai" }` straight through,
which is a "successful" result by the function's own logic, so nothing triggered the fallback.
That empty string then flowed untouched through metadata generation → the upload job payload →
YouTube's API, which correctly rejected it. This is a pre-existing gap, not something introduced
by yesterday's Trend Finder / auto-produce work — but the new `lib/autoProduce.js` path is fully
unattended (no human sees the title before it's sent to render+upload the way the manual
"پیشنهاد متادیتا" flow's editable field would), which is almost certainly why it's the one that
hit it in practice.
Two fixes, both verified with real test runs (mocked `generateText`, not just read-through):
1. `lib/metadata/index.js`: an empty/missing `titleA` after a structurally-valid JSON parse now
   falls back to `heuristicMetadata()`, matching what the function's own comment already claimed
   it did. Verified a genuinely valid AI response is still trusted as-is (not over-corrected into
   always using the heuristic).
2. `lib/autoProduce.js`: added a belt-and-suspenders check right after `generateMetadata()` —
   if the resolved title is still empty for any other reason, throws a clear Persian error
   *before* calling `runPipeline()`, so a bad metadata response fails in ~15 seconds instead of
   after a full render. Verified with a mocked metadata module that returns an all-empty result:
   confirmed `runPipeline` (and therefore the worker dispatch / in-process render) is never
   reached.
Files: `lib/metadata/index.js`, `lib/autoProduce.js`.

### 2026-08-28 — Real root cause of the short-script empty-response bug found + fixed; one-click auto-produce; Trend Finder integration verified against real source
User uploaded `src.zip` (the actual live repo, including yesterday's already-merged Trend Finder). First time this feature's two integration guesses (`generateText()`'s call shape, `authOptions.js`'s session pattern) could be checked against the real files instead of PROJECT_STATE.md's description of them.

**The empty-response bug ("پاسخ خالی از هوش مصنوعی دریافت شد" on short scripts), for real this time.**
The 2026-08-18 changelog entry claimed `reasoning_effort: "low"` was added to every Groq text call.
It wasn't — `grep`-confirmed absent from the live `lib/providers/registry.js`; only that entry's
other half (raising the short-script token budget 400→700 in `lib/script/index.js`) had actually
landed. `gpt-oss-120b`'s hidden reasoning draws from the same `max_tokens` budget as its visible
answer, so at the API's default reasoning effort it could still burn the whole 700-token budget
thinking and return nothing. Added the actual parameter to `groqText()` this time, and verified
with a real (mocked-network) execution of the literal function, not just a read-through, that the
resulting request body now includes `reasoning_effort: "low"` alongside `max_tokens: 700`.
Also found and fixed a second, related gap while in this file: `generateText()`'s empty-string
check ran *after* `tryProviders()` returned, so an empty (not thrown) response from the
top-priority provider was counted as "success" and never fell through to a second configured
provider. Moved the check inside the retry loop's `invoke` callback instead. Verified with a real
execution (two fake providers, one returning `""`, one returning real text): confirmed it now
falls through correctly, and confirmed the final aggregated error — for the case where every
provider is genuinely empty — now names each provider's specific failure instead of one generic
line. Files: `lib/providers/registry.js`, `lib/providers/router.js`.

**Trend Finder's two guessed integration points, checked against the real files.**
`lib/auth/authOptions.js` matched the guess exactly (NextAuth v4, `getServerSession(authOptions)`).
`lib/providers/router.js: generateText()` did not: the real signature is `{ prompt, maxTokens,
temperature, jsonMode }` — no `system` field, so `lib/trends/analyzer.js` had been silently
sending one that was simply dropped on the floor every call (harmless, since the JSON-array
instruction was already duplicated in the prompt text itself, but dead weight). Removed it.
Deliberately did NOT switch to `jsonMode: true` for the analyzer's batched calls — that maps to
`response_format: json_object`, which requires a JSON *object* at the top level and errors on the
bare array this prompt asks for (confirmed by reading `lib/metadata/index.js`'s use of the same
flag, which does request an object). Also fixed `next-auth/next` → `next-auth` and dropped `.js`
extensions on `@/lib/...` imports to match this project's actual (if not 100% uniform) convention,
confirmed by grepping every existing `@/lib/...` import in the repo.
`lib/trends/db.js`'s separate `pg` pool (a forced guess yesterday, since `lib/db/index.js` wasn't
available) is now a deliberate, verified choice: that file doesn't export its pool or
`ensureSchema()`, only ~30 specific query functions, so sharing it would mean adding new exports
to a file that providers/videos/schedules/worker-jobs all already depend on — a second small pool
against the same `DATABASE_URL` is lower-risk. Its `ssl` config now matches `lib/db/index.js`'s
exactly instead of the earlier localhost-guessing heuristic.
`TrendFinder.js` also turned out to be in English with generic Tailwind slate/violet colors —
mismatched this app's actual Persian/RTL UI and its `card`/`btn-primary`/`badge-ok` design-token
system (`globals.css`, confirmed by reading it directly). Rewritten from scratch in Persian,
matching `ScheduleSettings.js`'s session-gating pattern and the real color tokens.

**One-click auto-produce, as requested.** New `lib/autoProduce.js`: `prepareAutoProduceScript()`
(topic selection — explicit `topicId` from Trend Finder, else a plain typed `topic` string, else
the best-scoring `approved` trend topic, else left empty for `generateScript()` to pick freely,
exactly like today's manual empty-topic behavior — → `generateScript()` → `generateMetadata()`)
and `autoProduceVideo()` (adds `runPipeline()` — voice+media+render+captions+upload — on top, then
`markTrendTopicProduced()` if the topic came from Trend Finder and a video actually uploaded).
New `api/auto-produce/route.js`, NDJSON-streaming, mirrors `generate-and-upload/route.js`'s
heartbeat/self-ping/worker-dispatch branching exactly (script+metadata always generate
in-process first; only render+upload gets handed to the worker when `USE_RENDER_WORKER=true` —
known limitation: in that branch the upload happens async via job callback, so
`markTrendTopicProduced()` doesn't fire; the trend topic just stays `approved` rather than
auto-flipping to `produced`, fixable manually from `/trends` for now). Verified with real
(mocked-dependency) executions covering all three topic-selection paths, the auto-mark-as-produced
side effect, and error propagation on a missing access token — not just a read-through.
UI: `/trends` now shows "🚀 بساز و آپلود کن" (لانگ/شورت) on every approved topic with inline live
progress. `VideoStudio.js` (both `/long` and `/short`) gained a "🚀 ساخت کاملاً خودکار" section
above the existing manual step-by-step flow, sharing its progress-bar/success-message state so
nothing needed duplicating; reads `?topic=` from `window.location` on mount (not the
`useSearchParams()` hook, to avoid the Suspense-boundary requirement that would've meant also
editing `long/page.js`/`short/page.js`). Added `/trends` to `NavBar.js` and the home page card
grid.
Files: `lib/autoProduce.js` (new), `app/api/auto-produce/route.js` (new), `lib/trends/db.js`
(+`getTrendTopicById`, `+markTrendTopicProduced`), `components/trends/TrendFinder.js`
(rewritten), `components/studio/VideoStudio.js`, `components/layout/NavBar.js`, `app/page.js`,
`app/trends/page.js`, `lib/trends/analyzer.js`, `lib/providers/registry.js`,
`lib/providers/router.js`, plus import-style fixes across `app/api/trends/*`.
**Still unverified**: real (non-mocked) Google Trends/YouTube/Reddit/News responses and a real
Postgres connection — same gap as yesterday, only closeable from the actual Render deployment.

### 2026-08-27 — Trend Finder self-audit: 2 real bugs found + fixed, verified with actual test runs
User asked whether the Trend Finder shipped yesterday actually works. Couldn't reach the live
Render app or its DB/API keys from this session, so instead: re-read every file line by line,
then — more usefully — actually ran the pure-scoring logic and a full mocked end-to-end
orchestration (fake `fetch`, in-memory DB stub standing in for `lib/trends/db.js`, mock
`generateText`) rather than trusting a read-through alone. Found two real issues this way, not
from a live report:
1. **`api/trends/[id]/route.js` destructured `params` without awaiting it.** Next.js 15+ (this
   project is on 16) made route-handler `params` a Promise; `const { id } = params` would have
   silently worked with `id` as `undefined` on every approve/reject click. Caught by re-reading
   against the actual Next.js 16 route-handler contract, not by running it. Fixed: `const { id } =
   await params`.
2. **Candidate collection was fully sequential — ~150+ external HTTP calls awaited one at a
   time** (18 seeds × Trends explore+widgetdata, 7 subreddits, 18 seeds × News, then 25
   candidates × Trends+YouTube). Each source already degrades gracefully on its own failure, but
   running them one-after-another meant a single scan could plausibly take far longer than
   intended, all on a 512MB free-tier instance. Added `lib/trends/utils.js:
   mapWithConcurrency()` (small worker-pool helper, no new dependency) and switched every
   seed-level and candidate-level loop to run 4 at a time (AI analyzer batches: 2 at a time,
   kept lower since concurrent bursts are more likely to trip an AI provider's rate limit than
   concurrent bursts against Trends/YouTube/Reddit/News).
Also wrote `tests/trends-scoring.test.js` (plain `node:assert`, matches this project's existing
"no test runner installed" convention) covering `scoring.js`'s four deterministic functions and
`mapWithConcurrency`'s ordering/concurrency-limit guarantees — running it caught a third, smaller
issue: an inline comment claimed flat (0% growth) search-interest scores "~10", the actual formula
gives ~8.33 (rounds to 8). Not a functional bug (the formula's actual behavior — flat growth
scoring below the 0-25 midpoint, since this criterion specifically measures growth — was already
the intended design), just a wrong comment; fixed the comment and the test's expected range to
match reality instead of loosening the formula to match a comment that was never right.
Then ran a full mocked scan through the real `runTrendScan()` orchestrator (fake network
responses for every source + an in-memory stand-in for `db.js`, since neither live network nor a
real Postgres connection is available in this sandbox) — completed all 6 stages in the right
order, produced correctly-bounded (0-100) and correctly-sorted scores, and persisted through a
`db.js`-shaped interface with no exceptions.
**What's still unverified**: everything that needs the actual live Render deployment — real
Google Trends/YouTube/Reddit/News responses (vs. this session's mocked ones), a real Postgres
connection, and whether `lib/providers/router.js: generateText()`'s real call shape matches
`analyzer.js`'s guess (see `TREND_FINDER_INTEGRATION.md`, unchanged from yesterday — that file
still wasn't shared this session). The exact smoke-test commands in that doc are the fastest way
to close that gap.
Files: `lib/trends/candidates.js` (rewritten), `lib/trends/utils.js` (new),
`lib/trends/sources/reddit.js`, `lib/trends/analyzer.js`, `lib/trends/scoring.js` (comment only),
`app/api/trends/[id]/route.js`, `tests/trends-scoring.test.js` (new).

### 2026-08-27 — Trend Finder: 6-hourly niche trend scan + scored topic queue
Built as a new, mostly self-contained `lib/trends/` module rather than editing `lib/db/index.js`
or `lib/providers/router.js` in place, since neither file was available in the session that wrote
this feature — see `TREND_FINDER_INTEGRATION.md` for the two small adjustments worth double-checking
(the `generateText()` call shape in `lib/trends/analyzer.js`, and the NextAuth session-check import
in the two session-gated routes) once those files are actually diffed against this code.
Pipeline (`lib/trends/index.js: runTrendScan()`), matches the user-specified stage order: Google
Trends (niche seed keywords → related/rising queries, `lib/trends/sources/googleTrends.js`,
unofficial endpoints same caveat as msedge-tts) → YouTube (`sources/youtube.js`, official Data API
v3, needs new `YOUTUBE_API_KEY`) → TikTok/Reddit (Reddit: real, public JSON, no key needed,
`sources/reddit.js`; TikTok: deliberate no-op stub, `sources/tiktok.js` — no free public trend API
exists, same "ships empty" pattern as `public/fallback-media/videos/`) → News
(`sources/news.js`, Google News RSS, hand-rolled tiny extractor, no new dependency) → AI Analyzer
(`analyzer.js`, batched calls through the existing provider system's `generateText()`, heuristic
fallback on failure — same pattern as `suggest-metadata`'s no-key fallback).
Scoring (`scoring.js`) is deterministic for 4 of the 6 rubric criteria (search growth 0-25, view
growth 0-25, freshness 0-15, competition 0-15 — computed from real Trends/YouTube numbers, not AI
guesses) and AI-judged for the other 2 (Shorts-fit 0-10, Long-fit 0-10). Directly encodes the
project owner's key strategy note (a new channel should chase "rising but not yet crowded," not
"biggest") in two places: `scoreCompetition()` explicitly scores LOWER existing YouTube supply as
HIGHER, and the AI analyzer prompt states the same principle so its qualitative judgment doesn't
contradict the deterministic half. Only topics scoring ≥ `TREND_MIN_SCORE` (default 75, env-
configurable) are kept, capped to `TREND_TOP_N` (default 20), saved as `status='pending'`.
New Postgres tables `trend_scans`/`trend_topics`, via their own `ensureTrendsSchema()` in
`lib/trends/db.js` — deliberately a separate small `pg` pool from the main one for the same "file
wasn't shared" reason above, safe to run alongside it, trivially mergeable later.
Two entry points: `api/trends/scan/route.js` (cron-secret-gated, same pattern as
`scheduler/run/route.js`) for the new `.github/workflows/trend-scan.yml` (`schedule: cron: '0 */6
* * *'` — piggybacks on GitHub Actions the same way `render-worker.yml` already does, so no new
external cron pinger needed for this one); `api/trends/scan-now/route.js` (session-gated) for the
UI's manual "Run scan now" button. Both stream NDJSON progress like `generate-and-upload` does, so
the connection isn't sitting idle through however long the scan takes.
New page `/trends` (`components/trends/TrendFinder.js`) — score-breakdown cards, live scan
progress, approve/reject buttons, and (once approved) links into `/long?topic=...` /
`/short?topic=...` to actually start production — the explicit human-approval gate the project
owner asked for, not an auto-trigger.
Files (all new): `src/lib/trends/{index,db,seeds,candidates,scoring,analyzer}.js`,
`src/lib/trends/sources/{googleTrends,youtube,reddit,news,tiktok}.js`,
`src/app/api/trends/{route,scan/route,scan-now/route,[id]/route}.js`, `src/app/trends/page.js`,
`src/components/trends/TrendFinder.js`, `.github/workflows/trend-scan.yml`,
`TREND_FINDER_INTEGRATION.md`.

### 2026-08-22 — Second Gemini review (new video, 6.5/10): Maya was covering the captions, added Ken Burns zoom
Follow-up review, comparing the previous video to a newer one made with today's earlier fixes.
Improvements (better action steps, CTA, B-roll relevance) confirmed the script/metadata side is
solid. Two concrete new complaints, both checked against the code before fixing:
1. **"Big problem": Maya sits center-bottom, doesn't move, and blocks the captions/background.**
   Did the math on the actual coordinates: Maya's overlay was `H-h-40` (bottom-anchored) at 35%
   of the frame's shorter dimension, and captions sit at `H-margin-text_h` with the same
   horizontal centering — for a 720x1280 frame those two zones overlap across nearly their whole
   height, confirming this wasn't a matter of taste, the two elements were genuinely fighting for
   the same screen region. Moved Maya to a small (22%, down from 35%) top-right corner, clear of
   the caption zone regardless of how many lines a caption wraps to (a bottom corner was also
   considered — rejected specifically because full-width wrapped captions could still reach a
   bottom corner on longer lines, whereas top corner has zero overlap risk under any caption
   length). Shared position/size logic (`mayaOverlayExpr`) now used by both the animated overlay
   and the single-frame fallback, so they can't drift apart.
2. **"Static images ... zoom would look far more alive."** Added a Ken Burns effect
   (`buildKenBurnsFilter`) for image segments: scales up 2x past the frame ("cover", no padding)
   so `zoompan` has resolution to zoom into without pixelating, then a slow, subtle zoom to 1.12x
   over the segment's duration. Video-clip segments untouched (already have real motion, no
   Ken Burns needed there); `renderVerticalShortFromSource` (the separate `/api/repurpose` short
   path) also untouched — it crops from an existing rendered video, not raw images, so this
   doesn't apply there.
Rendered a full combined test clip (Ken Burns + wrapped caption + animated Maya, all at once, real
ffmpeg + real assets) before shipping, not just each piece in isolation — confirmed the caption
is now fully readable with zero overlap and Maya's corner placement holds correctly alongside
both other effects.
Still open, not started this round: dynamic word-by-word/highlighted captions (raised in both
reviews now) and sound effects (still blocked on sourcing actual audio files — no network access
in this sandbox to download any).
Files: `lib/rendering/index.js`.

### 2026-08-22 — Acted on Gemini's video review: faster cuts + animated Maya (blink + talk)
User shared a detailed third-party (Gemini) critique of an actual uploaded video, scored 6/10
overall — script 8/10, audio 7/10, visuals 4/10 (worst), pacing 5/10. Checked the two most
concrete claims against the actual code before doing anything: confirmed image pacing really
does average 6.5s/segment for long-form (slower than the 3-5s rule of thumb Gemini cited), and
confirmed Maya really is a single static PNG per segment (so "looks like it's not moving" is
just accurate, not a matter of taste). Walked through all 5 of Gemini's suggested improvements
with the user first (pacing, dynamic word-by-word captions, animate/remove Maya, dynamic BGM,
sound effects) — did pacing and Maya now (self-contained, no new assets needed); dynamic
captions still open (bigger rework, not started); BGM/SFX both need actual audio files sourced
from outside this sandbox (no network access here) before any wiring work is worth doing.
1. **Pacing**: `mediaCount` divisor in `pipeline.js` changed from `/6.5` to `/4` for long-form.
   Also raised the cap from 80 to 120 media items — otherwise the faster pacing would have hit
   that ceiling (and slowed back down) before reaching the 8+ minute lengths the project's own
   Phase 2 spec targets.
2. **Maya animation**: previously one static pose PNG (`${pose}.png`) overlaid for the whole
   segment. Checked what's actually in `public/maya/` first — every one of the 8 poses already
   has 4 pre-rendered variants (base, `-blink`, `-talk`, `-talk-blink`), so no new art was
   needed, just filter logic. User's own suggestion (animate the mouth too, not just blinking)
   was checked against the assets first: the `-blink`/`-talk`/`-talk-blink` trio are pixel-
   identical in size/framing to each other (verified directly), but the base pose is a different
   size (looks like it was generated separately) — so cycling through the base image for the
   mouth-closed state carries a small alignment-risk the other three don't. User chose to accept
   that risk rather than keep the mouth permanently open. Built `buildMayaAnimationFilter()`:
   mouth alternates every ~0.28s, plus a ~0.18s blink roughly every 3.2s, using ffmpeg's
   `enable='between(t,...)+between(t,...)+...'` per-state chained overlays. Rendered a real test
   clip with the actual Maya assets before shipping this (not just read the code) — mouth
   genuinely opens/closes, no visible jump at the base-image transition, positioning stayed
   stable throughout.
   Also fixed in the same function, spotted while working on this: the *existing* single-frame
   overlay (`buildMayaFilter`, kept as a fallback for the rare case a pose is missing a variant)
   scaled with `scale=X:X` — a literal square target — despite every Maya image being a portrait
   rectangle, so Maya has been rendering slightly stretched this whole time. Both the new
   animated path and the fallback now use `force_original_aspect_ratio=decrease` to preserve the
   real proportions.
Files: `lib/pipeline.js`, `lib/rendering/index.js`.

### 2026-08-22 — Full visual redesign: dark navy / purple-blue "futuristic AI dashboard"
Explicit ask: restyle the whole site's look to a dark, premium SaaS/AI dashboard aesthetic (dark
navy background, purple/violet primary, blue secondary, green/orange/red for
success/warning/error, very subtle glow) — with zero changes to structure, pages, routing,
components, logic, APIs, or content.
Turned out to be almost entirely a one-file job: every screen already routes its colors through
a small set of `@theme` CSS custom properties + a handful of hand-rolled component classes
(`.card`, `.btn-*`, `.field-*`, `.badge-*`, `.progress-*`, `.day-chip*`) in `globals.css` — the
2026-08-14 UX rebuild already centralized this. So the whole redesign is a token-value swap, not
a component rewrite:
- Kept every CSS variable and utility class **name** exactly as-is (`--color-amber`,
  `--color-teal`, `bg-amber`, `text-teal`, etc.) rather than renaming to `--color-primary`/
  `--color-success` — 30+ scattered `bg-amber`/`text-teal`/etc. references across 10+ component
  files would all need touching for a rename, which is exactly the kind of component-level
  change this task asked to avoid. Only the *values* changed: `--color-amber` is now the purple/
  violet primary (was warm orange), `--color-teal` is now green success (was turquoise),
  `--color-danger` is red error (same role, new hex). Left a comment in `globals.css` explaining
  this naming legacy so it doesn't read as a mistake later.
- Added two new unused-but-available tokens, `--color-secondary` (blue) and `--color-warning`
  (orange), for anything that wants a genuine info/warning distinction later — nothing currently
  references them, so this is purely additive.
- New dark navy background (`#070B1E`) with a fixed, very-low-opacity multi-blob radial-gradient
  behind all content (`body::before`) for the "subtle depth" the brief asked for, deliberately
  kept faint to avoid reading as a gaming UI.
- Cards: lighter surface than background (for hierarchy, as specified), ~14px radius, soft
  shadow, subtle inset highlight.
- Primary buttons: purple→blue gradient with a soft matching glow (`box-shadow`), brighten on
  hover rather than a hard color swap. Secondary/ghost/danger/icon buttons, badges, progress bar,
  field inputs, and the schedule day-picker chips all got matching radius/border/glow treatment.
- `layout.js`'s `viewport.themeColor` (the mobile browser-chrome color) updated to match the new
  background.
- Deliberately untouched: the Maya thumbnail-preview gradient hardcoded in `VideoStudio.js`
  (`#7a3e9d`→`#e8672c`) — that's a preview of actual YouTube-thumbnail *content* (the channel's
  own brand look), not dashboard UI chrome, so it's content per the brief's own distinction, not
  something this pass should change.
Couldn't run a real `next build` to visually confirm compilation in this sandbox (native
lightningcss/SWC bindings aren't available here — this container's `node_modules` came from the
uploaded zip, not a fresh `npm install`) — relied on: matching the exact `color-mix()`/`@theme`
patterns already proven to compile in this same file, confirming zero `@apply` usage (the one
documented past build-breaker for this file), and a full manual re-read. Worth a quick visual
check on the real deploy before considering this fully verified.
Files: `app/globals.css`, `app/layout.js`.

### 2026-08-22 — Cleared the remaining findings from the 2026-08-18 bug audit
User asked to fix everything still open from `youtube-studio-review.md`. Went through the list
item by item:
- **next-auth token refresh always firing**: `authOptions.js` used `account.expires_in` (always
  `undefined` for Google in next-auth v4, which actually provides `account.expires_at`), so the
  expiry check was always `NaN` and every `jwt` callback triggered a real refresh instead of only
  near actual expiry. Now reads `account.expires_at` correctly.
- **Maya thumbnail background never a real photo, on any path** — all three original causes
  fixed together: `mayaThumbnail.js`'s `bgImageUrl` handling now accepts the `{path: url}` shape
  Pexels items actually have (previously only handled `{buffer}` or a raw string, so Pexels —
  the default/free provider — always silently fell through to `fetch(object)`, threw, and landed
  on the gradient fallback); `VideoStudio.js`'s `videoBgImageUrl` state, previously declared but
  never once set, now actually fetches a real image (debounced, from `/api/images`) whenever the
  image keyword or title changes, so manual uploads get a real preview/thumbnail background too;
  and both `ab-test/route.js` and `upload/route.js` had the exact same `buildMayaThumbnail`
  import bug (destructuring it directly from `@/lib/rendering`, which doesn't export that name
  — only via the async `getMayaThumbnailExports()`) — fixed both, so A/B thumbnail switching and
  manual-upload thumbnails stop silently failing.
- **Community-post button** (`ChannelAnalytics.js`) was calling `/api/community-post`, a route
  that has never existed — real one is `/api/community`. Always 404'd.
- **A/B title-switch buttons never rendered**: `getAllVideos()` (feeds the Channel Analytics
  page) didn't select `title_b`/`active_variant`, but the UI gates the whole switch-button block
  on `v.title_b` being truthy. Added both columns to the query.
- **`ImageGenerator.js` crashed on non-Pexels image providers**: used Node's `Buffer` in a
  browser component. Added a browser-safe, chunked base64 conversion (`bytesToBase64`) in its
  place — handles the `{type:"Buffer", data:[...]}` shape a Buffer becomes after
  `NextResponse.json()` serializes it.
- **`AudioGenerator.js`'s default-voice picker** used `useState(fn)` where `fn` was meant to
  re-run on every provider change — `useState`'s callback is a one-time lazy initializer, not a
  reactive effect, so switching providers never re-triggered it, leaving the generate button
  stuck disabled with no visible reason. Now a real `useEffect`.
- **A failed media download could crash the entire render**, not just skip one segment —
  `pipeline.js`'s catch block kept the item's `.path` as the unreachable remote URL it had just
  failed to fetch, and `rendering/index.js` later tried `fs.copyFile` on it (only understands
  local paths). Now substitutes another successfully-downloaded item when one fails, so a single
  transient network blip degrades gracefully instead of failing the whole job.
- **`renderVerticalShortFromSource`** (the `/api/repurpose` short-render path) had the exact same
  caption-overflow bug just fixed yesterday in the main long-form renderer, plus weaker escaping
  than `buildCaptionFilter` (no backslash/bracket handling). Applied the same word-wrap fix
  (reusing `wrapCaptionText`/`measureTextWidthPx`) and brought `escapeDrawtextForShort` up to the
  same escaping as everywhere else.
- Minor cleanup: stopped exporting `BATCH_SIZE` from `rendering/index.js` (nothing ever imported
  it; kept the constant itself for its documentation value); `lib/index.js`'s barrel dropped
  `export * from './media'` (a thin wrapper re-exporting the exact same 3 bindings
  `./providers` already re-exports, which is what was ambiguous — media itself was fully
  redundant here) — matches the `VideoStudio.js` fix from yesterday for the same class of issue.
Left alone, deliberately: `pickMayaPose`'s lazy-init race condition (still just a documented,
low-practical-risk item per the 2026-08-18 note); the empty leftover directories from the old
reorg plan (`lib/pipeline/`, `lib/scheduling/`, `app/api/render/`, `app/api/analytics/`) — cosmetic,
git doesn't track empty dirs anyway, nothing to actually change; `script/timing.js`'s
`escapeDrawtext` (still unused, but genuinely harmless dead code, not worth the churn). Also
noticed in passing, not part of the original list: `trimSilenceFromAudio` and
`detectLongSilences` in `rendering/index.js` are placeholder implementations (copy the file
unchanged / always return `[]`) — wired up and called, but don't actually do anything yet. Worth
knowing if silence-trimming quality ever comes up as a question.
Files: `lib/auth/authOptions.js`, `lib/rendering/mayaThumbnail.js`, `components/studio/VideoStudio.js`,
`app/api/ab-test/route.js`, `app/api/upload/route.js`, `components/analytics/ChannelAnalytics.js`,
`lib/db/index.js`, `components/ai-studio/ImageGenerator.js`, `components/ai-studio/AudioGenerator.js`,
`lib/pipeline.js`, `lib/rendering/index.js`, `lib/index.js`.

### 2026-08-21 — Visual review of first successful outputs: captions overflowing every frame, Maya still never appearing
User uploaded the actual rendered short (10.5s clip) and long (180.6s) videos for review. Pulled
frames at multiple timestamps with ffmpeg and looked directly at them — two real, visible bugs,
both 100% reproducible across every frame checked:
1. **Burned-in captions overflow both edges on every single frame, short and long.**
   `buildCaptionFilter` has always centered text with `x=(w-text_w)/2` at a fixed `fontsize=48`
   with no width check — any caption wider than the video (common for anything beyond a short
   phrase) just overflows equally on both sides, exactly as seen in every frame. Fixed with real
   word-wrapping: extracted a precise per-character width table directly from the project's own
   `DejaVuSans-Bold.ttf` (verified against actual measured text width, <0.05% error), used it to
   greedily wrap each caption to fit within 92% of the video width before handing it to drawtext,
   joined with a real newline (`\n` as an escape sequence doesn't work here — confirmed
   `line_spacing` and multi-line centering behavior with real ffmpeg renders first). Verified
   visually: the exact overflowing caption from the uploaded short now wraps cleanly into 3
   centered lines, fully on-frame.
2. **Maya never appears in any frame of either video.** This is the Maya-pose-path bug already
   found in the 2026-08-18 audit (`youtube-studio-review.md`) but never circled back to fix:
   `renderVideo()`'s per-segment Maya overlay step was looking for pose PNGs in
   `public/assets/images/maya/`, a folder that has never existed (only ever a planned target in
   `REORGANIZATION_PLAN.md`, never executed) — guarded by `fs.existsSync`, so it failed
   completely silently every single time, on every segment, of every video. Real pose files live
   in `public/maya/`, confirmed the returned pose names (`caring`, `confident`, `excited`, etc.)
   match those filenames exactly. One-line path fix.
Not investigated this round (didn't block anything, lower priority): visuals in both sample
videos still look like generic stock footage pretty loosely connected to the script's actual
topic — consistent with the already-known, still-unresolved Pexels failures falling back to
`fallback-media`.
Files: `lib/rendering/index.js`.

### 2026-08-21 — First fully successful worker render end-to-end 🎉 + sentence-based subtitles, batched translation
`Video Render Worker #24` succeeded (8m 59s) — first complete render+upload since the worker
rebuild began. User asked why every language's translated captions were failing, and separately
asked for subtitles to be restructured to one sentence per line with precise timing. Both landed
together:
1. **Caption translation failing everywhere**: `Failed to validate JSON. Please adjust your
   prompt. See 'failed_generation' for more details.` — this is Groq's own server-side rejection
   when `response_format: json_object` is set and the model's raw output doesn't parse as JSON
   (happens before the client-side `JSON.parse` in `translate.js` even runs). `maxTokens: 4000`
   was already generous, so the likelier factor is just how much harder it is for a reasoning
   model to get a big structured array (30+ segments in one JSON response) exactly right in one
   shot. Restructured `translateCaptions` to batch into groups of 12 segments per Groq call
   instead of one giant call for the whole video — smaller, simpler JSON per request, and a
   single bad batch no longer costs the whole language's subtitles.
2. **Subtitles weren't sentence-aligned**: `regroupForSubtitles` grouped the media-render segments
   (segmented by *image/clip count*, unrelated to sentence boundaries) into fixed 5-10 second
   blocks — could merge multiple sentences into one subtitle or cut one mid-sentence. Added
   `buildSentenceCaptions(script, audioDurationSec)` to `script/timing.js`: splits the actual
   script into real sentences (via the existing but previously-unused `splitSentences`) and gives
   each one precise, proportional timing based on its share of the script's total word count —
   same distribution principle `distributeDurations` already uses, just per-sentence instead of
   per-media-segment. `pipeline.js` now builds the English SRT and every translated-language SRT
   from this instead of `regroupForSubtitles` (left in place, unused, rather than deleted — no
   reason to remove a working utility function). Verified locally: durations sum exactly to the
   total audio length, sentence text stays in order.
Files: `lib/script/translate.js`, `lib/script/timing.js`, `lib/pipeline.js`.

### 2026-08-21 — Per-segment captions with an apostrophe broke the whole render: confirmed and fixed with real ffmpeg
Token endpoint now returns a real access token (previous entry's fix confirmed working, upload got
further); render itself failed instead, back at the per-segment stage this time: `ffmpeg exit 1:
... Input #0, image2, from '/tmp/render-o2Ro7x/img_16.png' ... Output with label 'v1' does not
exist in any defined filter graph, or was already used elsewhere.` — a different instance of the
same *symptom* as the final-mux bug fixed on 2026-08-20, but a genuinely different bug, this time
in the per-segment caption filter, not the final mux.
Root cause, this time verified empirically rather than by reading alone (installed a throwaway
system ffmpeg and reproduced the exact crash locally before touching any code): `buildCaptionFilter`
escapes a literal apostrophe in caption text as `\'` before embedding it in a single-quoted ffmpeg
filter value (`text='...'`). That doesn't work — ffmpeg's filtergraph parser doesn't treat `\'` as
an escaped quote inside a `'...'`-quoted value the way a shell would; reproduced the "label does
not exist" crash directly by feeding `I've lived...` through the exact same escaping code and
piping the result into real ffmpeg. Since this project's scripts are full of contractions and
possessives ("I've", "don't", "Alex's"), essentially any long-form script was one unlucky caption
segment away from crashing here — this is likely why *no* long-form render had fully succeeded
until now even with everything else fixed.
Verified two candidate fixes against real ffmpeg before picking one: ffmpeg's own correct escape
for a literal quote inside `'...'` (the `'\''` close-quote/escaped-quote/reopen-quote trick) does
work, but `mayaThumbnail.js` and `script/timing.js` already solve the identical problem a simpler
way — substituting a Unicode curly quote (’) for the apostrophe entirely, sidestepping the need to
escape anything. Matched that existing, already-proven convention instead of introducing a third
escaping style into the codebase. Confirmed the fix renders correctly (clean colon, percent sign,
and brackets, no stray backslashes visible) with a caption exercising every escaped character at
once.
Files: `lib/rendering/index.js`.

### 2026-08-21 — New token endpoint returned 401: swapped WORKER_API_KEY for WORKER_SIGNING_SECRET
First real test of yesterday's `/api/internal/youtube-token` endpoint — video rendered fine again,
but the token call itself failed with a plain `Unauthorized`. Root cause, on reflection: the auth
check used `WORKER_API_KEY`, which — unlike `WORKER_SIGNING_SECRET` — has never actually been
load-bearing anywhere in this codebase before yesterday (`jobs/index.js` only ever reads it as a
fallback *for* `WORKER_SIGNING_SECRET`, which the user set explicitly from the start) — so nobody
had ever actually confirmed the Render copy and the GitHub copy of `WORKER_API_KEY` matched.
`WORKER_SIGNING_SECRET`, in contrast, has been proven correctly in sync all day: every single
successful "callback به وب‌اپ موفق بود" today depended on it matching between the two sides.
Switched the new endpoint (and the worker's call to it) to check `WORKER_SIGNING_SECRET` instead
— picking the secret with an actual track record rather than asking for yet another manual
copy-paste verification.
Files: `app/api/internal/youtube-token/route.js`, `worker/index.js`.

### 2026-08-20 — Worker no longer needs Google OAuth credentials at all (architecture change)
Two runs in a row hit `deleted_client` on the token refresh even after re-copying
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` into GitHub secrets — confirmed via a fresh sign-in on
the live site that the *real* credentials work fine (site login succeeded), so the problem was
specifically about keeping a second, GitHub-side copy of them in sync, which kept going wrong in
different ways across several attempts (name mismatch, wrong value, now this). Rather than
debug a fourth copy-paste attempt, removed the need for a second copy entirely: user's own
suggestion (route the finished video back through Render for upload) would have solved the
credential-duplication problem but reintroduced the exact long-running-HTTP-request risk the
whole worker was built to avoid, plus a new file-storage dependency — so kept just the actual
useful part of that idea (Render does the Google-facing work) without the costly parts (no video
file transfer, no long request).
New design: added `POST /api/internal/youtube-token`, a small endpoint on the web app that
takes a `WORKER_API_KEY` bearer token, runs the *exact* refresh-token code path that normal user
sign-in already proves works, and returns a fresh access token — this runs on Render, where the
Google credentials have only ever needed to exist once. `worker/index.js`'s `getUploadAccessToken`
now just calls this endpoint instead of importing `lib/db` + `lib/auth/authOptions` and talking to
Google directly. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` removed entirely from
`render-worker.yml` — no Google credential of any kind needs to live in GitHub secrets anymore,
which also closes off this whole class of "which copy is stale" bug for good. Added
`NEXT_PUBLIC_APP_URL` as a plain (non-secret) value in the workflow so the worker knows where to
call.
Files: `app/api/internal/youtube-token/route.js` (new), `worker/index.js`,
`.github/workflows/render-worker.yml`.

### 2026-08-20 — msedge-tts stream drop wasn't being retried
New run, upload never reached — failed at stage 1 (TTS): `Stream closed before the synthesis
completed (no turn.end received). The audio is likely truncated.` This message comes directly
from the `msedge-tts` package (confirmed by reading its source) — it's an unofficial,
reverse-engineered client for Edge's internal TTS service, and its WebSocket connection to
Microsoft occasionally gets cut mid-stream. `router.js`'s retry logic already exists for exactly
this kind of transient failure, but only fires when the error message matches a keyword list
(timeout/ECONNRESET/etc.) — this exact message matched none of them, so it failed instantly with
no retry, and since `msedge-tts` looks like the only configured "audio" provider, there was
nothing to fall back to either. Added this message to the retryable-error patterns (2 retries,
1.5s apart, same as the existing timeout/network handling).
Caveat, not something code alone can fix: if this turns out to be Microsoft rate-limiting or
blocking GitHub Actions' Azure IP ranges specifically (a known risk for unofficial APIs called
from datacenter IPs) rather than a one-off blip, retries within the same run won't help — worth
adding a second "audio" provider (e.g. ElevenLabs' free tier) from the Providers page as a real
fallback if this keeps recurring.
Files: `lib/providers/router.js`.

### 2026-08-20 — First full render success end-to-end; upload blocked by another env-var name mismatch
Confirms the `probeDurationSec` fix worked — this run got all the way through: audio, all 33
image segments, and **the actual video render completed** ("ویدیو رندر شد ✅"), which is the
first time the whole render pipeline has worked since the worker rebuild started. Blocked one
step later, at upload: `خطا در تمدید توکن: { error: 'invalid_client', error_description: 'The
OAuth client was not found.' }`. Same bug class as the earlier `NEXTAUTH_SECRET`/`DATABASE_URL`
misses — `render-worker.yml`'s env block exposed the Google OAuth credentials as `YOUTUBE_CLIENT_ID`
/`YOUTUBE_CLIENT_SECRET`, but `lib/auth/authOptions.js` (used for the worker's own token refresh,
per the 2026-08-18 worker rebuild) only ever reads `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` — so
the refresh request always sent an empty `client_id`, which Google correctly rejects as
`invalid_client`. Fixed by renaming the *env var* exposed to the process (kept referencing the
same already-created `secrets.YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET` — no new GitHub secret
needed).
Also noted, not fixed yet: every one of the 33 Pexels image requests in this run failed
("provider ominiRoute (pexels) در «عکس» شکست خورد: خطا در دریافت عکس از Pexels") and silently
fell back to local fallback images — didn't block the run, but means none of this video's images
were actually topic-relevant. `registry.js`'s `pexelsImages()` swallows Pexels' real error body
into a generic message (`data.error || "خطا در دریافت عکس از Pexels"`), so the actual cause
(rate limit vs. bad key vs. something else) isn't visible in the log — worth tightening that
error message next time this comes up, once upload is confirmed working.
Files: `.github/workflows/render-worker.yml`.

### 2026-08-20 — Render itself succeeded, then crashed on the final duration probe: "probeDurationSec is not a function"
Confirms the previous entry's mux fix worked — the video actually rendered this time (progress
reached "مرحله ۳" and stayed there noticeably longer, consistent with real ffmpeg work happening
instead of an instant syntax-error crash). Failed right after, on the post-render duration check.
Pre-existing bug in `pipeline.js`, unrelated to anything touched today or in the worker rebuild —
just never reachable before now. `getRendering()` (a dynamic-import wrapper around
`rendering/index.js`) explicitly destructures and returns only `{ renderVideo,
estimateAudioDurationSec, trimSilenceFromAudio, detectLongSilences }` — `probeDurationSec` was
missing from that list even though `rendering/index.js` exports it and a caller further down
does `const { probeDurationSec } = await getRendering()`. Since it's not in the returned object,
that destructure silently gives `undefined`, and calling it throws exactly this error. Added
`probeDurationSec` to both the destructure and the return statement.
Also note: the `NEXTAUTH_SECRET` decrypt warnings are still appearing in this same run's log —
that fix (added to `render-worker.yml`'s env in the previous entry) needs the matching GitHub
*secret* actually added too (Settings → Secrets and variables → Actions), which is a separate
manual step from pushing the workflow file; looks like that step is still pending.
Files: `lib/pipeline.js`.

### 2026-08-20 — Worker got past infrastructure entirely — hit (and fixed) the real render bugs from the original audit
Two runs today. First one failed instantly with `getaddrinfo EAI_AGAIN host` — the very first
thing `tryProviders()` does is a DB query, and a hostname that short/literal failing in ~25ms
pointed straight at the `DATABASE_URL` GitHub secret having a literal unreplaced `host` placeholder
in it (classic copy-paste-the-template-without-editing-it mistake) rather than the real Supabase
hostname. Not a code issue — user fixed the secret value directly.
Second run got much further — script, TTS, and all 29 image segments fetched successfully
("رسانه‌ها آماده شد ✅") — but two things surfaced:
1. **Noisy but non-fatal**: `decrypt failed for provider 5: NEXTAUTH_SECRET تنظیم نشده`, repeated
   once per segment. `providers/crypto.js` reuses `NEXTAUTH_SECRET` as the AES key for decrypting
   DB-stored provider API keys (by design, to avoid needing a separate secret) — it was never
   added to the worker's env in the original setup checklist. Fell back to an env-var-based
   provider each time so it didn't block this run, but would silently never work for anyone whose
   *preferred* provider is DB-stored. Added `NEXTAUTH_SECRET` to `render-worker.yml`'s env.
2. **The actual blocker**: `ffmpeg exit 1: ... Output with label 'v' does not exist in any
   defined filter graph, or was already used elsewhere.` This is bug #1 from the 2026-08-18 audit
   (`youtube-studio-review.md`), left unfixed at the time per "find only, don't fix yet" — now
   that every infrastructure layer works, this is what we finally hit. Root cause, more precisely
   than originally written up: `let filter = "[0:v]copy[v]"` gets *overwritten* (not appended) in
   **both** branches of the following if/else (not just the BGM one) — so the video output pad
   never actually existed in the filter graph, no matter what. Fixed by dropping the video filter
   entirely: `-map 0:v` directly (video needs no filtering at this stage — captions/Maya/etc. were
   already burned in per-segment before concat) with `-c:v copy`, which is now valid since that
   stream no longer comes from a filter graph — this also resolves the *other* original-audit
   finding (`-c:v copy` + `-filter_complex` together is always rejected by ffmpeg) for free, since
   there's no longer a video filter graph at all. Also fixed the BGM/narration volume swap from
   the same audit finding while in this code (still dormant today, no BGM files exist yet, but no
   reason to leave it wrong).
Files: `.github/workflows/render-worker.yml`, `lib/rendering/index.js`.

### 2026-08-19 — Worker crashed with "GoogleProvider is not a function"
Import-resolution now clean (previous entry); next run failed with
`TypeError: GoogleProvider is not a function` at `authOptions.js:39`, the moment the module
loads (evaluating `export const authOptions = {providers: [GoogleProvider({...})]}` — this runs
immediately on import, even though the worker only actually needs `refreshAccessToken` from this
file). Root cause: `next-auth/providers/google` is CommonJS, compiled with
`exports.default = Google; exports.__esModule = true`. Node's *native* ESM/CJS interop for a
plain `import X from "cjs-pkg"` always binds X to the *whole* `module.exports` object — verified
directly (`import('next-auth/providers/google')` → `{ default: [Function default] }` two levels
deep, i.e. the real `Google` function sits at `.default.default`). Webpack/Next.js's bundler
applies its own `__esModule`-aware "interopRequireDefault" unwrapping that Node itself doesn't do,
which is why this only ever broke under the worker's plain-node execution and never inside the
Next.js app. Fixed by unwrapping explicitly (`GoogleProviderModule.default ||
GoogleProviderModule`) — written to work correctly under both environments, not just the worker's.
Given this makes 3 bundler-only-resolution bugs in a row (extensionless imports, `@/` alias, now
this), did a full sweep of every third-party default-import in the whole worker-reachable graph
(`src/lib` + `src/worker`) for the same CJS-interop shape: `sharp` and `@ffmpeg-installer/ffmpeg`
both do a direct `module.exports = X` (no `.default`/`__esModule` nesting) — statically confirmed
safe, no fix needed there. Verified the fix locally by reproducing the exact error and re-running
past it (got to a sandbox-only "ffmpeg binary missing" failure next, which is this container's
own incomplete `node_modules` from the zip extraction, not a real issue — GitHub Actions' fresh
`npm ci` shouldn't hit it).
Files: `lib/auth/authOptions.js`.

### 2026-08-19 — Worker crashed with ERR_MODULE_NOT_FOUND: '@/lib' path alias doesn't exist under plain Node
FFmpeg step now passes; next run failed immediately with `ERR_MODULE_NOT_FOUND` during module
linking (before any of the worker's own code runs). Reproduced locally: `lib/auth/authOptions.js`
had `import { saveRefreshToken } from "@/lib/db"` — the `@/` alias only exists inside Next.js's
own bundler (webpack/Turbopack resolve it via `jsconfig.json` paths), which is why it always
worked when this file loaded through the Next.js app; plain `node src/worker/index.js` has no
idea what `@/` means and tries to resolve it as an npm package name. Same root-cause class as the
2026-08-18 extensionless-import fixes in `rendering/index.js` (bundler-only resolution tricks
that break under the worker's plain-Node execution) — re-scanned all of `src/lib` and
`src/worker` for any other `@/` alias; this was the only one. Fixed by switching to a real
relative import (`../db/index.js`). Confirmed the whole import graph now links cleanly by running
`node src/worker/index.js` directly (got past module resolution into actual pipeline code).
Files: `lib/auth/authOptions.js`.

### 2026-08-19 — Removed the "Install FFmpeg" apt step entirely — it was never needed
Follow-up to the entry right below: the `DEBIAN_FRONTEND=noninteractive` fix stopped the
indefinite hang, but the very next real run still timed out — `apt-get install ffmpeg` pulls
~70+ dependency packages (libx264, libx265, libvpx, librubberband, etc.), which legitimately
took past the 5-minute cap on a cold runner. Rather than just raising the timeout, checked
whether the app even needs it: it doesn't. `rendering/index.js` never spawns a bare `ffmpeg` —
every invocation goes through `ffmpegInstaller.path` from the `@ffmpeg-installer/ffmpeg` npm
package (already pinned in `package.json`, already installed by the `npm ci` step that runs
right before this one) — the exact same static binary approach Render itself already relies on
(no system apt there either). So the whole apt-get step was dead weight from day one, not just
slow. Replaced it with a two-line Node check that runs the *actual* binary the app will use
(`ffmpegInstaller.path -version`) — fails fast with a clear error if that npm package's
postinstall ever breaks, instead of silently discovering it deep in a render.
Files: `.github/workflows/render-worker.yml`.

### 2026-08-19 — First live worker run: repo policy block + apt-get hang
First real end-to-end test of the rebuilt worker (previous entry). Hit two separate issues,
neither in the worker's own logic:
1. **Run refused at "Set up job"**: `The actions actions/checkout@v4, actions/setup-node@v4, and
   actions/upload-artifact@v4 are not allowed ... because all actions must be pinned to a
   full-length commit SHA.` This is a repo-level policy (Settings → Actions → General → Action
   permissions → "Require actions to be pinned to a full-length commit SHA"), not a code issue —
   overkill for a single-user personal project. User turned it off; not changed in this repo's
   files since it's a GitHub setting, not something `render-worker.yml` controls.
2. **"Install FFmpeg" step stuck ~30 min** (should take ~1-2 min): `apt-get install -y ffmpeg` had
   no `DEBIAN_FRONTEND=noninteractive`, so if any pulled-in dependency (classically `tzdata`) hits
   a debconf prompt, apt just hangs waiting for input that a non-interactive CI shell never sends
   — `-y` only auto-answers "are you sure?" prompts, not debconf dialogs. Fixed at the time by
   adding `DEBIAN_FRONTEND: noninteractive` + `--no-install-recommends` + a 5-min step timeout —
   superseded by the entry above, which removes the step altogether.
Files: `.github/workflows/render-worker.yml`.

### 2026-08-18 — Worker path rebuilt end-to-end (was broken per the bug audit)
Full rebuild of the GitHub Actions render-worker path, following the 2026-08-18 bug-audit
findings in `youtube-studio-review.md`. Setup checklist walked through with the user first
(GitHub repo secrets incl. `WORKER_SIGNING_SECRET`, a classic PAT with `repo` scope for
`GITHUB_TOKEN`, Actions enabled, 5 Render env vars) — confirmed working via a successful
redeploy. Design decision: instead of the original per-stage job-type model (render → separate
upload → separate thumbnail, none of it wired together), the worker now just calls the exact
same `runPipeline()` that the non-worker path already uses — script/metadata are still generated
fast on Render before dispatch; only the slow part (render + upload + thumbnail + captions +
db record) moves to the worker, and it reports back with one callback POST at the end. This also
made the old job-type taxonomy (`generate_thumbnail`, `generate_script`, `synthesize_speech`,
`fetch_media` as separate worker jobs) unnecessary — dropped, since only render_video/render_short
were ever actually dispatched.
Specific things fixed, one per file:
- `.github/workflows/render-worker.yml`: moved `job_id`/`job_type`/`payload` out of the `run:`
  step's `${{ }}` interpolation into job-level `env:` vars (the shell-injection bug from the
  audit — this alone was breaking every job with an apostrophe in the script/title). Also added
  the missing `WORKER_SIGNING_SECRET` secret to the job env (needed to verify payload signatures).
- `lib/db/index.js`: new `worker_jobs` table + `createWorkerJob`/`updateWorkerJob`/`getWorkerJob`/
  `listStaleWorkerJobs`, replacing the in-memory `Map` that reset on every Render restart.
- `lib/jobs/index.js`: new `dispatchAndTrackJob()` shared by both dispatch call sites — builds
  the payload, signs it, generates the credential, and *actually attaches the credential to what
  gets sent* (previously generated and silently dropped, so the worker never had anything to
  authenticate its callback with). Removed `pollJobCompletion` (a placeholder that always threw
  after its timeout, never called anywhere). Also fixed `verifyWorkerCredential`/`verifyJobPayload`
  to return `false` on a length-mismatched signature instead of letting `crypto.timingSafeEqual`
  throw (turned malformed-credential requests into clean 401s instead of 500s).
- `worker/index.js`: full rewrite. Verifies the payload signature (previously never checked —
  `verifyJobPayload` existed but nothing called it), calls `runPipeline()` with a
  `getUploadAccessToken` that pulls the refresh token straight from `channel_auth` via
  `getRefreshToken()` + `refreshAccessToken()` (same pattern `scheduler/run` already uses — no
  NextAuth session available in a GH Actions runner), then POSTs the result to
  `payload.metadata.callbackUrl` with `Authorization: Bearer <credential>`. No more raw video
  buffer dumped into a `WORKER_RESULT:` stdout line.
- `app/api/generate-and-upload/route.js`: worker branch now calls `dispatchAndTrackJob`; dropped
  the short-lived session `accessToken` from the job payload entirely (worker gets its own fresh
  one at upload time, same reasoning as above — a token grabbed at dispatch time would likely be
  stale by the time a multi-minute render finishes anyway); fixed the callback URL to read
  `NEXT_PUBLIC_APP_URL` (it was reading `NEXTAUTH_URL`, inconsistent with what `jobs/index.js`
  and `jobs/dispatch` already used and what the docs/setup checklist tell the user to set).
- `app/api/jobs/callback/route.js`: persists to the new `worker_jobs` table instead of the
  in-memory Map.
- `app/api/jobs/status/route.js`: repurposed to look up `?jobId=` in `worker_jobs` instead of
  `?runId=` against GitHub's workflow-run API — the old approach was unreachable in practice
  since `workflow_dispatch` returns 204 with no body, so nothing ever captured a real GitHub run
  ID to poll with.
- `app/api/jobs/dispatch/route.js`: also uses `dispatchAndTrackJob` now; `GET` actually queries
  the DB instead of returning a hardcoded `"not_implemented"` / empty array.
- `lib/rendering/index.js`: fixed 3 extensionless relative dynamic imports (`import("./mayaThumbnail")`
  / `import("./index")`, missing `.js`) — harmless under Next.js's bundler (which resolves
  extensionless imports fine) but a guaranteed `ERR_MODULE_NOT_FOUND` under the worker's plain
  `node src/worker/index.js` execution, since Node's native ESM loader requires explicit
  extensions. Also removed a pointless self-import of the module's own already-in-scope
  `probeDurationSec` function.
- `components/studio/VideoStudio.js`: worker-mode branch no longer claims "آپلود کامل شد ✅" the
  instant a job is dispatched. Now shows a queued message and polls `/api/jobs/status?jobId=`
  every 10s (up to 40 min, matching the workflow's 45-min timeout) until `completed`/`failed`.
Known residual risk, not fixed this round: `pickMayaPose`'s lazy-init race condition (audit
finding) is still there in principle — a dynamic import kicked off at module load with no guard
against a caller running before it resolves. Left alone because fixing it properly means changing
call-site async semantics in `registry.js` too, and reasoning through the actual call order
(module graph loads well before `runPipeline` reaches `synthesizeSpeech`) suggests it's unlikely
to fire in practice; flagging it here rather than quietly leaving it out of the record.
Files: `.github/workflows/render-worker.yml`, `lib/db/index.js`, `lib/jobs/index.js`,
`worker/index.js`, `app/api/generate-and-upload/route.js`, `app/api/jobs/callback/route.js`,
`app/api/jobs/status/route.js`, `app/api/jobs/dispatch/route.js`, `lib/rendering/index.js`,
`components/studio/VideoStudio.js`.

### 2026-08-18 — Fallout from the gpt-oss-120b switch: empty script responses + a concat.txt hardening
Tested the model swap from the entry below; found two more issues live:
1. **Short scripts: "پاسخ خالی از هوش مصنوعی دریافت شد"**. gpt-oss-120b defaults to
   `reasoning_effort: "medium"` on Groq, and its hidden chain-of-thought draws from the *same*
   `max_tokens` budget as the visible answer — with the short-script budget of 400 tokens, it
   could burn the whole budget on reasoning and return empty `content` before writing a single
   word of the actual script. Long-form (3000 tokens) had enough headroom to not hit this, which
   is why only short failed. Fix: added `reasoning_effort: "low"` to every Groq text call
   (`lib/providers/registry.js`, this task doesn't need real reasoning — it's creative writing),
   and raised the short-script budget 400 -> 700 as a margin (`lib/script/index.js`). Applied the
   same margin preventively to the two other tight-budget Groq JSON calls that share the same
   exposure even though they hadn't failed yet: chapter generation 500 -> 900
   (`lib/metadata/index.js`), community-post generation 400 -> 600 (`lib/community/index.js`).
2. **Short render: `ffmpeg exit 1: ... concat.txt: Invalid data found when processing input`**.
   Root cause not confirmed with certainty from code alone (would need the actual segment count/
   sizes from a live failing run to be sure) — plausible causes include a segment ffmpeg call
   reporting success but writing a 0-byte file, or the segment list ending up empty. Rather than
   guess-fix, added explicit validation right before the concat step in
   `lib/rendering/index.js`: throws a clear, specific error (empty segment list, or which exact
   segment file is missing/0 bytes) instead of letting ffmpeg's opaque concat-demuxer error
   surface. If this fires again, the error message itself will now say exactly what's wrong.
   Side note, not addressed here: `@ffmpeg-installer/ffmpeg` (package.json, pinned `^1.1.0`) still
   bundles a ~2018-era static ffmpeg build (its version banner shows "Copyright (c) 2000-2018");
   worth keeping in mind if odd ffmpeg behavior keeps showing up, since it's long unmaintained
   upstream.
3. **Long render: "اتصال به سرور وسط پردازش قطع شد"** — not fixed this round. Same class of
   issue as the 2026-08-xx free-tier spin-down finding above: a long-form generate-and-upload
   call can run well past Render free tier's connection limits. The segment loop already renders
   one image/clip at a time internally (`BATCH_SIZE=1`), so that's not the bottleneck — the whole
   multi-minute process (script -> TTS -> every segment -> concat -> mux -> YouTube upload) is
   still tied to one continuous HTTP request/response, which is what actually needs to change
   (background job + client polling, not a single long-lived stream). This is exactly what the
   GitHub Actions worker path was meant to solve, but the 2026-08-18 bug audit found it
   currently broken end-to-end (see `youtube-studio-review.md`) — properly fixing this needs that
   work finished, not a quick patch here.
Files: `lib/providers/registry.js`, `lib/script/index.js`, `lib/metadata/index.js`,
`lib/community/index.js`, `lib/rendering/index.js`.

### 2026-08-18 — Hotfix: Groq deprecated llama-3.3-70b-versatile, all text generation was failing
Live error while writing a scenario: every text provider (script, title, translation, community
post) failed with "The model `llama-3.3-70b-versatile` does not exist or you do not have access
to it" for both configured Groq keys. Not a code bug — Groq announced deprecation of
`llama-3.3-70b-versatile` on 2026-06-17 and has since shut it down for free/developer-tier keys
(enterprise committed-spend contracts still get it). Groq's own migration guidance recommends
`openai/gpt-oss-120b` (production-grade, fully supported) or `qwen/qwen3.6-27b` (preview-only,
not recommended for production). Swapped `GROQ_TEXT_MODEL` in `lib/providers/registry.js` from
`llama-3.3-70b-versatile` to `openai/gpt-oss-120b` — same `/chat/completions` endpoint shape, no
other code changes needed. It's a reasoning model: Groq's docs say by default its chain-of-thought
goes into a separate `reasoning` response field, not `message.content` (which is all this codebase
reads), so no JSON-parsing changes were needed for the `jsonMode` call sites (suggest-metadata,
community-post generation, caption translation) — but if raw reasoning/preamble text ever starts
showing up inside generated scripts/titles, that's the first thing to check (there are scattered
community reports of it leaking under some conditions).
Files: `src/lib/providers/registry.js` (1 line changed).

### 2026-08-18 — Full codebase bug audit (find-only, no fixes yet)
Reviewed every file in `src/`, `tests/`, `.github/workflows/`, and the root docs/config, plus how
they all import/call each other — no code changed this session, audit only (explicitly requested:
find bugs, don't fix them yet). Full 17-item bug list + Mermaid dependency graphs + a file↔file
import table were delivered as a separate file, `youtube-studio-review.md`, meant to live at the
repo root (not yet applied — see commands below). The three most severe, worth knowing before
touching anything else:
1. **`renderVideo()`'s final ffmpeg mux always fails** — `-c:v copy` combined with a
   `-filter_complex` output is a hard, unconditional ffmpeg error ("Filtering and streamcopy
   cannot be used together"), so every long-form render currently breaks at the last step. Same
   block also drops the video filter entirely and inverts narration/BGM volume once BGM files
   exist (`public/audio/bgm/` is still empty, so that half is currently dormant).
   `lib/rendering/index.js`.
2. **The GitHub Actions worker path is broken two separate ways**: `render-worker.yml`
   interpolates `${{ payload }}` straight into a shell `run:` step — GitHub's own docs list this
   exact pattern as their canonical script-injection example, and separately any apostrophe in a
   real script/title (very common in English) breaks the command before `node` even starts. Even
   if it ran, `worker/index.js` never uploads to YouTube or calls back `/api/jobs/callback` — it
   only renders and logs a giant buffer to stdout. The HMAC credential built in
   `generateWorkerCredential()` is also never attached to the dispatched payload, so that
   verification path is dead code.
3. **A real background photo never reaches a Maya thumbnail on any path** — three independent
   bugs (wrong `bgImageUrl` shape coming out of the auto-pipeline, a `VideoStudio.js` state
   variable that's never set for manual uploads, and `ab-test/route.js` not passing it at all)
   all converge on the same silent gradient-only fallback.
Also found: A/B title-switch buttons never render (`getAllVideos()` doesn't select the columns
the UI checks), the Community-Post button calls a route that doesn't exist
(`/api/community-post` vs. the real `/api/community`), a client component (`ImageGenerator.js`)
uses Node's `Buffer` in the browser and crashes on non-Pexels image providers,
`AudioGenerator.js` misuses `useState` where `useEffect` was needed (default-voice logic only
ever runs once), next-auth's Google token refresh check is always-true due to an
`expires_in`/`expires_at` field mismatch, and Maya's *video* overlay (separate from the
thumbnail) looks for pose PNGs in `public/assets/images/maya/`, a folder that doesn't exist.
Full detail, file:line references, and a suggested fix-priority order are all in
`youtube-studio-review.md` — intentionally not repeated in full here to avoid this file drifting
out of sync with that one; if any of this gets fixed later, update both together.
Files changed: none. New file delivered: `youtube-studio-review.md`.

### 2026-08-14 — Hotfix: Phase 8's globals.css broke the real Turbopack build
The `@layer components` block added in Phase 8 (below) used `@apply` for
every custom class; the actual `next build` on Render failed immediately
with `CssSyntaxError: Cannot apply unknown utility class 'gap-1.5'`. Root
cause and permanent fix now documented under "Known constraints" above —
short version: `@apply` in this project's Tailwind v4 setup only resolves
utilities that also appear as a literal className somewhere in JSX, and a
few fractional-spacing values here were only ever used inside `@apply`.
Rewrote every custom class in `globals.css` as plain CSS referencing the
`@theme` custom properties directly (`var(--color-amber)` etc.) — zero
`@apply` left in the file. Class *names* are unchanged (`.btn-primary`,
`.field-input`, ...), so no JSX in any of the 9 Phase 8 files needed to
change; confirmed every custom className used across those files still has
a matching definition. File: `src/app/globals.css` only.

### 2026-08-14 — Phase 8: UX/UI audit + full dark-theme rebuild (all screens outside the home dashboard)
Ran a structured UX audit (first-time-user pass across all 7 screens) before
touching any code — full report delivered alongside this change. Headline
finding, which drove everything below: only `app/page.js` was ever migrated
to the dark Tailwind design system defined in `globals.css`'s `@theme` block
(bg `#14120F`, amber/teal accents, `--color-text-muted`, etc.) — every other
screen (`NavBar.js` and all 6 feature components) was still on the original
light-theme inline styles (`#666`/`#777`/`#999` grays, a `#2196F3` blue CTA,
native unstyled `<input>`/`<select>`), none of which ever got an explicit
light background, so it all rendered directly on the dark `body`. Computed
contrast ratios confirm this wasn't cosmetic: `#666` on `#14120F` is
~3.25:1, `#777` is ~4.18:1 — both fail WCAG AA's 4.5:1 minimum for body
text, on copy that appears on every single page (labels, helper text,
empty/error states). The project's own `--color-text-muted` token
(`#948C7E`) already solves this correctly at ~5.6:1 — it just wasn't used
anywhere outside the home page.

Fixed by rebuilding every screen's JSX onto the *existing* design tokens —
no new palette, no new brand direction, just finishing the migration that
stalled after one page. Added a small `@layer components` block to
`globals.css` (`.btn-primary/-secondary/-ghost`, `.card`,
`.field-input/-textarea/-select`, `.badge-ok/-fail/-neutral`,
`.progress-track/-fill`, `.day-chip`) so all 7 screens now share one
definition of "what's our button" instead of re-deriving inline styles per
file. Every state variable, handler, fetch call, and FormData/JSON payload
shape is byte-identical to before (diffed and identifier-checked against
the prior versions) — this pass touched presentation only, not the
pipeline.

Other things the audit caught, fixed in the same pass:
- **`VideoStudio.js`** (the actual video-creation flow — the single
  highest-traffic screen in the app) was one long undifferentiated form;
  restructured into 4 numbered cards (script → metadata/thumbnail →
  publish → manual upload) that mirror the real sequence of the task. Also
  fixed a real RTL bug: several blocks had `textAlign: "left"` hardcoded
  despite the page being `dir="rtl"`, misaligning Persian copy against the
  reading direction.
- **`NavBar.js`** was on completely unrelated hardcoded light-theme styles
  (this is the one element visible on every single page) — rebuilt on
  tokens, made sticky, and the 7 nav links now scroll horizontally as
  tap-sized pills instead of wrapping into a multi-row block on narrow
  screens.
- **Home page (`app/page.js`)** was missing a card for `/schedule` even
  though it's in `NavBar.js` — added, and reordered the other 5 cards to
  match `NavBar.js`'s order so both surfaces agree.
- **Touch targets**: the ▲/▼ priority-reorder buttons in
  `ProviderManager.js` and assorted icon-only buttons across the app were
  well under any reasonable tap-target size; enlarged to ~40px.
- **Two "is my API working?" pages** (`/api-check` and `/providers`) could
  show contradictory signals to the operator — `ApiStatus.js` only ever
  checked the legacy `GROQ_API_KEY`/`PEXELS_API_KEY` env vars, a nuance
  previously documented here in ROADMAP.md but never actually surfaced in
  the app. Added a one-line in-app note linking to `/providers` rather than
  merging the two systems (a bigger, separate change).
- **`ProviderManager.js`**'s API key `<input type="password">` had no way
  to check what you'd typed before submitting; added a show/hide toggle
  (pure local UI state — doesn't touch the `apiKey` field or `handleAdd`).
- Added `export const viewport = { themeColor: "#14120F", colorScheme:
  "dark" }` to `layout.js` so native form controls (select, date/time
  pickers) render dark by default instead of the browser's light default.
- Deleted `HomeDashboard.js` (already flagged above as unused/legacy;
  confirmed via `grep` that nothing imports it).

Verified without a full `npm install` (no `package.json`/`node_modules` in
the delivered zip, network unavailable this session): every changed `.js`
file passes an `esbuild --loader:.js=jsx` parse, and every state/ref/
handler name declared in the original file was confirmed still present in
the rebuilt one. Not a substitute for an actual `next build` on a real
checkout — worth a quick smoke-test after deploying.

Files: `src/app/layout.js`, `src/app/globals.css`, `src/app/page.js`,
`src/components/NavBar.js`, `src/components/VideoStudio.js`,
`src/components/ChannelAnalytics.js`, `src/components/ApiStatus.js`,
`src/components/ProviderManager.js`, `src/components/ScheduleSettings.js`.
Deleted: `src/components/HomeDashboard.js`.

### 2026-08-13 — Hotfix: scale's force_divisible_by crashed every render on this project's ffmpeg
Live render failed with `ffmpeg exited with code 1` / `Error initializing
filter 'scale' ... Option not found` on `force_divisible_by=2`. Root
cause: the bundled FFmpeg (via `@ffmpeg-installer/ffmpeg`) is a static
build from ~2018, and `force_divisible_by` is a newer scale option that
build doesn't have — confirmed from the error's own version banner. Fix:
`buildMayaOverlayChain`'s `mayaW` computation now rounds to the nearest
even number directly in JavaScript (`2 * Math.round(rawMayaW / 2)`)
instead of any FFmpeg-side option — works on any FFmpeg version since it
doesn't depend on a specific filter option existing at all. Logged as a
permanent entry under "Known constraints" above (old-FFmpeg-binary risk)
since this is the kind of thing likely to resurface with any new filter.
File: `lib/videoRender.js` (`buildMayaOverlayChain` only).

### 2026-08-13 — Own 50-item quality pass (author: Claude, not the checklist the user pasted)
After finishing the user's checklist, user asked for 50 *more* ideas from
me directly, reviewed them, then said to build everything marked 👍.
Before writing code, checked several proposed ideas against the actual
current code — a genuinely mature feedback loop already existed
(YouTube Analytics retention pull via `youtubeAnalytics.js` +
`/api/sync-stats`, top-performer bias into script generation via
`getTopPerformingVideos`, recent-topic/title avoidance via
`channelHistory.js`, duplicate-schedule-run guarding) that several of my
own proposed items assumed were missing — those were dropped rather than
rebuilt. Two real bugs were caught mid-implementation via live
testing, beyond what's already itemized below.

**Audio/visual polish (`videoRender.js`):**
- `alimiter` after `loudnorm` — single-pass `loudnorm` can overshoot
  true-peak by a fraction of a dB (documented FFmpeg limitation);
  `alimiter=limit=0.97` is a hard, inaudible-in-practice safety ceiling.
- BGM: `MOOD_TO_BGM` now maps each mood to an array of candidate
  filenames (picked at random from whichever exist on disk) instead of
  one fixed file — same graceful-degradation pattern as before if only
  the original single file exists.
- Maya's idle-sway amplitude now jitters (±25%) in addition to the phase
  offset that already existed, so the motion doesn't feel identical
  across every video.
- `getMayaRole`: the opening beat is "hidden" (straight to b-roll, no
  Maya) about 22% of the time instead of always being the presenter
  role — closing beat unchanged (always full Maya).
- A subtle, consistent `eq=contrast=1.05:saturation=0.92:gamma=1.02`
  color-grade now applies to every background clip/image regardless of
  source, for a more unified look across differently-sourced Pexels
  footage.
- New `trimSilenceFromAudio()` — trims leading/trailing silence from the
  raw TTS buffer (standard reverse-trim-reverse FFmpeg idiom) *before*
  `estimateAudioDurationSec` runs, so all downstream segment/media timing
  stays consistent with the actual trimmed length. Wired into
  `pipeline.js` right after `synthesizeSpeech`.
- New `detectLongSilences()` — flags (log-only, via `silencedetect`)
  internal narration gaps over 2.5s. Deliberately does not auto-shorten
  them: doing so after `audioDurationSec` is already locked in would
  desync every downstream duration calculation, the same risk that ruled
  out a true post-narration outro beat (considered, not built, for the
  same reason).
- Oversized stock images (>1600px on the long edge) now get downscaled
  via `sharp` before ever reaching FFmpeg — pure memory/decode-time win
  on the 512MB tier, skipped for video clips (`-t` at the input stage
  already limits decode cost there).

**Thumbnail (`mayaThumbnail.js`):**
- Text color now picks white-on-dark vs dark-on-white by actually
  sampling the rendered background's average luminance in the exact
  region the text sits in (`sharp` extract → 1×1 resize), not a fixed
  assumption. Caught two bugs live-testing this: a redundant
  `.resize()` call right before `.extract()` on an already-correctly-
  sized image threw "bad extract area" (removed, unnecessary), and the
  initial luminance threshold (0.6) never actually triggered because it
  didn't account for the existing `brightness:0.55` pre-darkening
  already applied to photo backgrounds — recalibrated to 0.42 against
  the pipeline's real output range (verified: a pure-white source photo
  tops out around 0.51 post-darkening).
- `capThumbnailWords` now exported (was previously an unexported inner
  function) so `tests/` can exercise it directly.

**Script/metadata prompts:**
- `scriptGen.js`: the existing length-only retry is now a combined
  quality-retry — also checks sentence-starter diversity (share of
  sentences starting with "I"/"You" over 60%) and presence of at least
  one concrete number/example/real detail (vs. purely abstract
  motivational language), and asks for a targeted rewrite addressing
  whichever specific issues were found, all in one retry pass rather
  than three separate ones stacked.
- `metadataGen.js`: titleA/titleB now explicitly instructed to differ in
  *length*, not just angle — titleA short and punchy, titleB fuller,
  using more of the existing character budget (unchanged ceiling).
- Investigated hashtag rotation (checklist item): doesn't apply — tags
  are already freshly AI-generated per video from the actual script, not
  drawn from any fixed/hardcoded pool, so there's nothing to rotate away
  from. No change made.

**TTS voice variation (`providers/registry.js`):**
- `msedgeTts()` now picks between two voices (`en-US-JennyNeural` /
  `en-US-AriaNeural`) based on the script's dominant mood (same
  `pickMayaPose` scoring used for BGM/thumbnail), but **only** as
  `msedge-tts`'s own default when the caller doesn't explicitly pass a
  `voice`. Deliberately *not* done in `pipeline.js` itself — an earlier
  version of this change passed a resolved voice string down through
  `synthesizeSpeech()`, which routes through whichever audio provider is
  actually configured; an msedge-tts-specific voice ID like
  `en-US-AriaNeural` would be meaningless (or rejected) if OpenAI or
  ElevenLabs is the higher-priority configured provider. Reverted and
  moved the resolution inside the msedge-tts adapter itself so it can
  only ever affect msedge-tts's own default, never leak into another
  provider's request.

**Resilience/caching (`providers/router.js`):**
- `fetchImages`/`fetchClips` now cache successful results in-memory for
  10 minutes (keyed on the exact query params, capped at 200 entries,
  LRU-ish eviction) — avoids burning API quota on repeated near-identical
  queries, and specifically helps the timeout-retry added in the previous
  session (a retry of a query that actually succeeded server-side but
  timed out client-side now returns the cached result instead of a fresh
  API call). Fallback-folder results are deliberately never cached, so a
  provider that's back up gets tried fresh next time.

**Pipeline restructure (`pipeline.js`) — largest single change:**
`runPipeline` is now a thin outer wrapper (timeout race at 25 minutes,
webhook notification on any failure via `notifyWebhook()` /
`ALERT_WEBHOOK_URL`, only active if that env var is set) around a new
`runPipelineCore` that does the actual work, plus a `quickTest: true`
early-exit path (`runQuickTest`) that synthesizes ~15 words of audio and
fetches one media item, no render/no upload, for fast connectivity
sanity-checking. Within the core pipeline:
- `checkRiskyKeywords()`/`checkMispronunciationRisks()` (both exported
  for testing) scan the script before TTS — the former for
  unlicensed-medical-claim-shaped phrasing ("cures your anxiety", "stop
  taking your medication", etc. — deliberately narrow, not flagging
  ordinary discussion of anxiety/depression as topics, which is normal
  for this channel), the latter for ALL-CAPS acronyms TTS might mangle.
  Neither blocks the render; risky-keyword hits force `privacyStatus` to
  `private` regardless of what was requested, logged with a clear reason.
- `selfDeclaredMadeForKids: false` now explicitly set on every upload —
  previously never set at all, meaning YouTube treated every video as
  "unspecified" and would have prompted manual classification.
- Thumbnail buffer size checked against YouTube's 2MB cap before calling
  `thumbnails.set`, with a clear error instead of an opaque API failure.
- Full transcript posted as a comment via `commentThreads.insert` after
  upload (non-blocking, failure just logged) — descriptions cap at 5000
  characters, which a 1200-1500 word long-form script's full text would
  exceed, so a comment (no such tight cap) carries it instead, for
  accessibility and deeper SEO.
- Every stage's wall-clock time collected into `runLog.stages`, plus
  warnings (risky keywords, mispronunciation risks, long internal
  silences) into `runLog.warnings` — persisted via `recordVideo`'s new
  `runLog`/`needsReview` params (see `db.js` below). `recordVideo` moved
  to the very end of the function (was previously called right after
  upload, before thumbnail/caption steps even ran) so the persisted log
  reflects the complete run, not just the first half.
- `needsReview` flag set (and returned) when: risky content was flagged,
  duration is anomalously short (long-form <5min) or long (short >90s),
  thumbnail failed, or *all* caption languages failed — deliberately not
  triggered by a single caption language failing out of 5, since partial
  multi-language failure is already treated as an acceptable, non-
  blocking outcome elsewhere in the codebase (2026-08-10 fix); flagging
  the whole video for review over one language would be disproportionate.

**Database (`db.js`):** new `run_log` (JSONB) and `needs_review`
(boolean, default false) columns on `videos`, added via the same
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pattern already used
elsewhere. `recordVideo()` accepts and persists both.

**Tests — new `tests/` folder, no test runner installed (see Known
constraints):**
- `tests/scriptTiming.test.mjs` — 13 cases against the real
  `scriptTiming.js` directly (zero dependencies, runs with nothing but
  `node`). Explicitly covers both real bugs found this week: the
  empty-bucket `distributeDurations` bug and `validateSrt`'s NaN/empty/
  mismatched-length guards.
- `tests/pipelineChecks.test.mjs` — 6 cases for the two new risk-check
  helpers. Needs the project's normal `npm install` first, unlike the
  scriptTiming tests, since `pipeline.js` pulls in `googleapis`/`pg`/etc.

**Also caught mid-session (process note, not a shipped feature):** a
`str_replace` while adding `detectLongSilences` accidentally deleted the
line `function parseTimeToSeconds(str) {`, orphaning that function's body
outside any function — a real syntax error. Plain `node --check
videoRender.js` reported it as fine (see the new "Known constraints" note
on why); checking a `.mjs` copy of the same content caught it immediately.
Fixed, and re-verified via the stricter check from that point on.

### 2026-08-12 — Batch 1 of the 50-item content-quality checklist (script, audio, visuals, resilience, thumbnail)
User pasted a 50-item Persian checklist (script/AI direction, audio/TTS/
music, visual effects, technical pipeline, thumbnail/metadata) covering 5
categories. Previous session reviewed all 50 with a verdict per item
(already-done / good-and-feasible / needs-caution / not-really-feasible)
without changing any code. This session implements every item marked
"good and feasible" (👍) that didn't depend on a bigger architecture
change flagged as out of scope (per-paragraph AI visual-hints for media
search and anything downstream of it, word-level caption timing, exact
TTS word-boundary sync, and SSML-timestamp-driven ducking — msedge-tts's
SSML support is unreliable enough that the existing *reactive*
sidechaincompress ducking, keyed off the real narration waveform, is
already a better solution than what the checklist asked for). Two items
turned out to already be exactly what the checklist wanted with zero
changes needed: curiosity-gap titles and keyword-led descriptions were
already in metadataGen.js's prompt. Everything below was individually
syntax-checked, and anything touching FFmpeg filter graphs or sharp image
compositing was verified with a live render/test before being considered
done — two real bugs were caught and fixed this way (see below).

**Audio (videoRender.js):**
- Loudness normalized to -14 LUFS (`loudnorm`, single-pass) on the final
  audio mix — YouTube's own playback-normalization target.
- Soft fade-in/out at each segment boundary, **long-form only** (`W>H`).
  Not a true crossfade — that would need re-architecting the segment
  concatenation from the concat-demuxer to `xfade`, which requires
  holding two segments in memory at once and touches the deliberately
  memory-frugal one-segment-per-FFmpeg-process design (512MB Render free
  tier). This is the lower-risk version: each segment fades to/from black
  at its own edges, softening the cut once concatenated, without touching
  that architecture. Skipped for Shorts — a fade at every 2-3s fast cut
  would be more distracting than the hard cut it's replacing.
- Synthesized "whoosh" SFX at clip transitions, **long-form only** (same
  fast-cut-frequency reasoning as the fade). Fully synthesized (band-passed
  pink noise burst, `anoisesrc`+`highpass`+`lowpass`+`afade`) — no external
  SFX asset file needed, so it can't fail from a missing file. **Caught a
  real bug via live test**: mixing all whoosh bursts together with
  `amix=duration=first` truncated the whole burst-track to the *first*
  whoosh's own natural length, silently dropping every later boundary's
  sound — fixed with `duration=longest` for that sub-mix, `duration=first`
  only for the final merge with narration+music so total length still
  matches the narration exactly. Also added `normalize=0` on that sub-mix
  since amix's default per-input gain reduction (to prevent clipping when
  summing N inputs) would make each burst nearly inaudible on long videos
  with many boundaries — safe here since the bursts are ~180ms and don't
  meaningfully overlap.

**Shorts captions (videoRender.js, `renderVerticalShortFromSource`):**
- Semi-transparent black box behind each burned-in caption line for
  readability. Fixed-width band (86% of frame width), not sized to each
  line's actual text — `text_w`/`text_h` are only valid inside the
  `drawtext` filter that computes them, a separate `drawbox` filter can't
  read them, so a per-line-fitted box isn't possible without pre-measuring
  text width in Node (not worth the complexity here).

**Thumbnails (mayaThumbnail.js):**
- Soft drop shadow behind Maya's cutout — built from her own resized
  image's real alpha mask (not a guessed oval/box), scaled to 50% opacity
  and blurred via `sharp`, offset (14px, 18px). Live-rendered and visually
  confirmed before shipping.
- Thumbnail text hard-capped to 4 words in code (`capThumbnailWords`) as
  defense-in-depth — the AI prompt already asks for a word limit, but
  nothing previously enforced it if the model ignored that.

**Metadata (metadataGen.js):**
- Thumbnail text prompt/fallback tightened from "4-6 words" to "3-4
  words, extremely punchy" to match the checklist's rule (word-count target
  in the prompt; the hard cap above is the enforcement backstop).
- New `generateChapters(script)` — asks the AI for 3-5 natural chapter
  breaks (`{title, firstWords}}`), used by pipeline.js (below).

**Script prompt (scriptGen.js):**
- Optional nature/sensory-metaphor guidance for describing emotional
  states (storm instead of "overwhelmed", etc.) — framed explicitly as
  occasional seasoning, not a rule, so it doesn't force awkward metaphors
  into scripts where they don't fit.
- New recurring verbal habit: a brief personal self-disclosure line in the
  empathy beat ("I've been exactly there").
- Shorts closing beat now also asks for a callback — the last line should
  echo the opening hook's word/phrase/image, so a looped rewatch feels
  connected rather than just stopping and restarting cold.
- Punchy-sentence guidance sharpened from a vague personality trait into a
  concrete instruction (break a landing point into 3-5 word bursts).

**Resilience (providers/router.js):**
- Timeout/network-error retry: the existing rate-limit retry (waits the
  exact time the API tells it to, up to 2x) is joined by a separate
  timeout/network-error retry (`ETIMEDOUT`/`ECONNRESET`/etc., up to 2x
  with a fixed 1.5s backoff) before falling through to the next configured
  provider — a plain timeout with only one provider configured previously
  had zero retries.
- Local backup-media fallback: `fetchImages`/`fetchClips` now fall back to
  a random file from `public/fallback-media/{images,videos}/` if *every*
  configured stock provider fails, instead of the whole render failing.
  These folders ship empty (with a README) — actual stock assets aren't
  something I can generate, so nothing changes until real files are added
  there; until then this is a no-op and behavior is identical to before.

**Captions (scriptTiming.js, pipeline.js):**
- New `validateSrt(captions, durations)` — checks array-length match,
  finite/positive durations (a stray `NaN` would previously have silently
  produced a literal "NaN:NaN:NaN,NaN" timecode in the uploaded SRT), and
  non-empty text. Wired in before both the English caption upload and each
  translated-language upload in pipeline.js; a failure is treated the same
  as any other per-language caption failure (skipped, logged, doesn't
  block the other languages or the video itself). Not a new bug fix — the
  2026-08-10 segment-count-mismatch fix already covers translateCaptions'
  own retry — this is a structural safety net in case a *different* bug
  produces bad timing data in the future.

**Auto chapters (pipeline.js), long-form only:**
- After `generateChapters()` returns `{title, firstWords}` pairs,
  `findWordOffset()` locates each chapter's position by matching its first
  4-6 words against the script's own word array (not a raw string search,
  since the AI's quoted text can differ slightly in punctuation/spacing),
  then converts that word-position ratio × `audioDurationSec` into a real
  timestamp — the same proportional-timing model `distributeDurations`
  already uses for media/render segmentation, so chapter times stay
  consistent with actual video timing without needing real TTS
  word-boundary data. YouTube's own chapter rules are enforced after that:
  first chapter forced to exactly 0:00, any chapter within 10s of the
  previous one is dropped (not merged — simpler, and YouTube requires
  10s minimum spacing), and the whole block is discarded (video uploads
  with its description exactly as given, no chapters) if fewer than 3
  valid chapters survive — verified via direct test, including both of
  these degrade-gracefully edge cases. Runs before the video upload step
  so the chapter block can be appended to `description` before
  `videos.insert`; failure anywhere in this step (AI call, JSON parse,
  &lt;3 survivors) is caught and logged, never blocks the upload.

**Still deferred** (from the "good and feasible" list, genuinely needs its
own session): AI-generated per-paragraph visual-search hints (checklist
#9) and the two items downstream of it (#24/#25, color-mood-driven search
terms) — this needs restructuring scriptGen's output from prose into
`{text, visualHint}` pairs and changing how pipeline.js consumes it, a
real architecture change rather than a self-contained patch.

### 2026-08-11 — Fix: Maya visibly jumps size when blink/talk sprite layer swaps in
User asked whether the "Maya isn't the same size on both" glitch (visible in
the same uploaded short as the cuts issue above) had also been fixed — it
hadn't, separate bug. Confirmed by extracting frames: Maya's small corner
cameo renders at a normal size on the base pose, then for roughly one
sampled frame (whenever the periodic `-talk`/`-blink` sprite-swap layer
from the 2026-08-09 "idle sway + blink/flap" feature is active) balloons
noticeably bigger before returning to normal the next frame. Root cause:
`buildMayaOverlayChain()`'s base/-talk/-blink/-talk-blink layers were each
scaled independently with `scale=-1:mayaH` straight from their own source
PNG — same fixed *height*, but width (and, more importantly, the
character's own size *within* its canvas) came from whatever that
individual file happened to contain. These 4 files per pose are separate
image-gen outputs, not a matched sprite sheet, so nothing guaranteed they
framed the character at the same zoom/padding. Reproduced the exact
mechanism with synthetic test PNGs (deliberately drawing the "talk"
variant's character bigger within an identical canvas) and confirmed
`scale=-1:mayaH` alone lets the rendered character size swing by
~50% between layers. Fix (`videoRender.js`): before handing any pose file
to FFmpeg, run it through `sharp(...).trim()` into a temp copy under
`tmpDir/maya-trim/` — this strips each file's own (inconsistent) transparent
margin down to the character's actual content box, so scaling every
layer's *trimmed* content to the same height now equalizes the
character's real on-screen size, not just canvas size. Re-ran the same
synthetic test against the trimmed pipeline: the ~50%
swing dropped to ~2% (down to ordinary pose-to-pose silhouette variation,
e.g. arms out vs in). Also kept a belt-and-suspenders fix in
`buildMayaOverlayChain` itself: the base layer's (trimmed) aspect ratio is
now measured via `sharp` and reused to force every other layer into that
*exact* `mayaW×mayaH` box (`force_original_aspect_ratio=decrease` +
transparent `pad`, not a stretch) instead of each layer picking its own
width — this also stops the corner-cameo position (`W-w-20`, which reads
back the overlay's own width each frame) from jittering sideways between
layers. `trimMayaAsset()` fails soft (falls back to the untrouched
original file) if `sharp` ever can't process a given PNG, matching the
project's established "never break the render" pattern for optional
enhancements. `renderBatch()` now takes `tmpDir` as a new param (needed
somewhere to write the trimmed temp copies) — its one call site in
`renderVideo()` updated to pass it. File: `lib/videoRender.js`
(`buildMayaOverlayChain`, `renderBatch` — everything else, including
`renderVerticalShortFromSource`, untouched).

### 2026-08-11 — Fix: shorts barely cut, showing 3-4 long unrelated clips instead of ~20 fast cuts
User uploaded a rendered short and asked to fix "the video problem": instead
of the Phase 2 "faster cuts" target (~2-3s/segment via mediaCount ≈
audioDurationSec/2.5, e.g. ~20 segments for a 50s short), the actual video
held on just 3-4 backgrounds for ~12-13s each, several of them visibly
unrelated to a mindfulness script (an "activist" quote card, a couple on a
bench, an empty field). Root cause: `distributeDurations()` split the
script into sentences and only advanced to the next media bucket **once
per sentence**, capped at one advance max even if a single sentence's word
share should have crossed several bucket boundaries at once. Any short
script has far fewer sentences (~8-12) than the ~20 buckets Phase 2 now
requests, so most trailing buckets never got any text at all — confirmed
by direct simulation with a representative 10-sentence/145-word script:
10 buckets got real text, the other 10 stayed empty. An empty bucket's
caption text feeds straight into `extractKeywords()` → `""`, which
`registry.js`'s `resolveQueryAndOrientation()` falls back to the literal
keyword `"nature"` — so every empty trailing bucket fired the same generic
stock search, collapsing what should've been ~10 distinct fast cuts into
one long static hold (and non-"nature" segments were sentences that
absorbed several bucket-widths' worth of duration due to the same
one-advance-per-sentence cap, which is why the held clips weren't all
identical). Fixed: rewrote `distributeDurations()` to map each **word**
(not sentence) to a bucket by its position in the whole script
(`floor((w/totalWords) * imageCount)`), so every bucket gets its own
non-empty slice of the script whenever the script has at least
`imageCount` words (always true in practice — mediaCount's own floor is
8, and any real script is far longer) — verified via simulation: 0 empty
buckets, each landing at ~2.5s as intended. `regroupForSubtitles()`
downstream still merges consecutive buckets for the SRT, and since words
are assigned in strictly increasing order this reconstructs correct
in-order text regardless of the mid-sentence bucket boundaries, so
subtitles are unaffected. Also fixed a related edge case surfaced while
testing: a literally empty script produced the literal string
`"undefined"` as caption text (looping to `totalWords` instead of
`words.length` indexed past the empty array) — harmless in practice since
`pipeline.js` already rejects an empty script upstream, but fixed for
robustness. File: `lib/scriptTiming.js` (`distributeDurations` only —
`splitSentences`, `buildSrt`, `regroupForSubtitles`, `wrapCaption`
untouched).

### 2026-08-10 — Subtitles regrouped into 5-10s blocks (SRT only, media/render segmentation untouched)
Requested: SRT subtitle blocks should read as 5-10 second chunks instead of
whatever `distributeDurations()`'s per-media-item buckets happen to come out
to (avg ~2.5s for shorts, ~6.5s for long-form — both well outside a
comfortable subtitle-reading range, and either can drift further at the
8/30/80-segment caps on very short or very long audio).

`captions`/`durations` from `distributeDurations()` couldn't just be
resegmented in place — that same array also drives the per-segment media
search loop and `renderVideo()`'s one-FFmpeg-process-per-segment render, both
upstream of the caption step in `runPipeline()`. Retimed those and every
image/clip fetch call, Maya pose alternation, and the FFmpeg batch count
would've shifted too.

**Fixed:** added `scriptTiming.js: regroupForSubtitles(captions, durations,
minSec=5, maxSec=10)` — greedily merges the existing fine-grained buckets
into 5-10s blocks (flushes early if the next bucket would push it over 10s,
keeps merging until it's at least 5s otherwise) without touching the
original array. `pipeline.js` now calls this once, right before the caption
steps, and feeds the regrouped `(subtitleCaptions, subtitleDurations)` to
both `buildSrt()` calls and to `translateCaptions()` — media fetch and
`renderVideo()` above it still use the original untouched `(captions,
durations)`. A single original bucket longer than 10s (only possible on very
long-form videos pinned at the 80-segment cap) is passed through as its own
block rather than split — no sub-bucket timing data exists to split it with.

Files: `lib/scriptTiming.js`, `lib/pipeline.js`.

### 2026-08-10 — Fix: cascading multi-language caption failures (rate limit + segment-count mismatch)
User reported all 5 caption languages failing on one render, with two distinct
errors stacked in the log.

**Bug 1 — es/pt: real translation bug, not rate limiting.** The model
returned 19 segments instead of 20 for a 20-line script. `translateCaptions()`
had zero tolerance for this — any count mismatch failed that language
outright, with no retry, even though an off-by-one merge/drop is exactly the
kind of thing a second attempt with a stricter prompt usually fixes (same
pattern already used for the 8-minute script-length safety net).

**Bug 2 — ar/hi/fa: a real cascade, caused by only one text provider being
configured.** With just "Groq (کلید قدیمی از env)" active, five back-to-back
~4300-4400-token translation calls for a long-form (1200-1500 word, Phase 7)
script pushed cumulative usage past Groq's free-tier 12,000 TPM cap inside
the same one-minute window. `providers/router.js` had no rate-limit handling
at all — a 429 was treated exactly like any other failure and immediately
propagated, even though Groq's own error text said the fix was to wait ~7s.

**Fixed:**
- `lib/translateCaptions.js`: on an invalid segment count or bad JSON, now
  retries once with a stricter, lower-temperature prompt (explicit "translate
  every segment separately, never merge" warning) before giving up.
- `lib/providers/router.js`: `tryProviders()` now parses "try again in Xs"
  out of a provider's own error message and, when present, waits that long
  and retries the *same* provider (up to 2x) before falling through to the
  next provider or failing for good. This is a router-level change, so it
  helps every caller — `scriptGen.js`, `metadataGen.js`,
  `translateCaptions.js`, `communityPost.js` — not just captions.

**Still recommended, not done here:** add a second text provider from
`/providers` so there's a real fallback once Groq's TPM cap is hit
repeatedly — the retry buys time by waiting out the cooldown, it doesn't
raise the ceiling. Worth doing especially now that scripts run
1200-1500 words (Phase 7) and get translated 5x per long-form video.

Files: `lib/translateCaptions.js`, `lib/providers/router.js`.

### 2026-08-10 — Hotfix: short render crashed on every video with talk/blink assets
Every Maya overlay with an active `-talk`/`-blink`/`-talk-blink` layer
(so: any render touching a pose that has those files) failed with
`ffmpeg exited with code 1` and `Missing ')' in '(mod(t,0.23)<0.14)*...'`
— reported by the user on a shorts render, confirmed same root cause
would hit long-form too.

**Root cause:** FFmpeg's `eval` expression engine (used for `enable=`)
does not have `<`/`>` as operators at all — its binary operator set is
only `+ - * / ^`; comparisons must go through the named functions
`lt(x,y)`/`gt(x,y)`/etc. Phase 6's `buildMayaOverlayChain()` wrote
`mod(t,P)<D` directly, which isn't valid FFmpeg eval syntax — the
parser fails with a somewhat unhelpful "Missing ')'" rather than an
"unknown operator" message, which is what actually shipped in Phase 6
without being run against real ffmpeg first.

**Fixed by** rewriting both `talkCond`/`blinkCond` to use `lt(mod(...),D)`
instead of `mod(...)<D`. Structurally nothing else changed — the same
multiply/subtract compound-condition logic from Phase 6b still applies
on top of these, since `lt(...)` returns a normal 0/1 value that
arithmetic can operate on just like the old (invalid) comparison would
have if it had worked.

**Verified this time, not just reasoned about:** reproduced the exact
user-reported error against real ffmpeg with the old syntax (byte-for-
byte identical error message), then confirmed the fixed syntax renders
successfully end-to-end (real ffmpeg process, exit code 0, valid output
file) with 4 dummy PNG inputs mimicking the base/talk/blink/talk-blink
layers — not just a syntax-check of the JS. Phase 6/6b's filter-graph
code was never actually run through ffmpeg before this, since building
it happened without ffmpeg available in that session — a gap worth
remembering: FFmpeg filter *expression* syntax (as opposed to overall
JS syntax) needs to be checked against real ffmpeg, not inferred from
general familiarity with `eval`-style syntax elsewhere.

**Files:** `lib/videoRender.js` only (`buildMayaOverlayChain`'s
`talkCond`/`blinkCond` construction).

### 2026-08-09 — Phase 7: engagement CTAs, bolder titles, and an actual 8-minute floor
User wants three growth levers pulled at once: (1) comment engagement,
(2) a subscribe ask that doesn't feel like a subscribe ask, (3) bigger-
promise titles, (4) long-form videos reliably past YouTube's 8-minute
mid-roll-ad threshold (confirmed still the current rule as of 2026 —
under 8:00 only gets pre/post-roll, not the higher-earning mid-rolls).

**Turned out two of these were already half-built.** `scriptGen.js`'s
prompt already had a specific, non-generic comment-question closing
beat, and already said "target 1200-1500 words, never fewer than
1200" for long-form (≈8.5+ min at a ~140wpm mindful-narration pace) —
just with nothing verifying either actually happened. And the
subscribe ask wasn't just missing, it was explicitly *forbidden*
("Not a call to subscribe") in the existing prompt — a deliberate
choice from whenever that was written, now reversed.

**Subscribe, done as psychology, not a script line.** Added an
instruction with three concrete reframes to choose from per video
(continuation/tease — "subscribing means not missing the next piece";
identity — "if you're someone who's tired of X, this is where you
belong"; ongoing relationship — "I'll be here every week") — the model
picks and rewords one per video rather than reusing a fixed line, and
is told explicitly never to use the bare phrase "like and subscribe."
Applied to both short and long structures, sized to fit each (a single
clause for shorts given the 30-60s runway, a sentence or two for
long-form's more spacious closing).

**Titles pushed toward bigger, specific promises** (concrete numbers/
timeframes/hidden-cause framing) while keeping the existing "must
actually pay off" constraint load-bearing — an unearned promise hurts
more than it helps once watch-time (not clicks) is what the algorithm
and YouTube's own native A/B testing both optimize for.

**The 8-minute target got an actual enforcement layer**, since a
prompt instruction alone doesn't guarantee an LLM hits a word-count
floor. `generateScript()` now counts words after generating; if
clearly short (<1150 words), it retries once with a sharper, more
explicit instruction naming which sections to expand; if still short,
it proceeds anyway (never blocks the pipeline over this) but logs a
clear warning. `runPipeline()` adds a second, independent check after
real TTS synthesis — if a long-form video's *actual* audio comes out
under 480s despite all that, it's logged too, so a persistent miss is
visible in Render's logs rather than silently invisible.

**Files:** `lib/scriptGen.js` (subscribe-CTA instructions in both
structures, word-count retry safety net), `lib/metadataGen.js` (bolder
title-promise instruction), `lib/pipeline.js` (post-TTS duration
warning).

### 2026-08-09 — Phase 6b: the actual Maya art arrived — normalized + wired in, plus a 4th state
User made the art (3 zips: mouth-open, eyes-closed, and — beyond what
was asked for — mouth-open+eyes-closed together, 8 poses each = 24
PNGs) and asked what to do next.

**Pose identity had to be figured out, not assumed.** The 24 exported
files were named by Picsart's own timestamped export convention, not
by pose — nothing tied a given file to "excited" vs "thinking" vs
anything else. Built a labeled contact-sheet grid to compare all 24 at
once, then viewed the ambiguous ones at full size individually (the
small grid thumbnails were genuinely hard to read correctly — first
pass misread two columns and had to be corrected against full-size
crops before finalizing the mapping). Final mapping was inferred from
gesture semantics matched against the exact keyword lists already in
`mayaThumbnail.js` (`POSE_KEYWORDS`) — e.g. hands-on-cheeks-shocked →
`surprised`, cross-legged mudra hands → `meditating`. Not independently
verifiable against the live `public/maya/{pose}.png` files (never
uploaded), so this mapping is inference, not certainty — worth a quick
visual sanity check against the real base images once deployed.

**Alignment couldn't be taken as-is.** Each of the 24 files was
individually auto-cropped tight to its own content by Picsart's export
— confirmed via alpha-channel bounding-box inspection (crop == full
canvas on all but one file). Since a talk/blink swap changes the
character's silhouette extent slightly (an open jaw or raised arm
shifts the tight-crop box), the three variants for the same pose had
canvas dimensions differing by as much as ~15–18% in aspect ratio.
Left as-is, that would've made Maya visibly "pulse" in size every time
the mouth flapped or she blinked — the opposite of the goal. Fixed by
normalizing: for each pose, padded all three variants onto a shared
canvas (the union of their tight-crop sizes), bottom-center anchored,
so the character sits at an identical scale/position across every
swap. Verified with a second labeled contact sheet plus a horizontal
reference line at the canvas bottom before finalizing.

**Code upgraded to a real 4-state system**, since the user provided
the 4th combination that the original design had deliberately skipped
for simplicity (see prior entry). `buildMayaOverlayChain()` now builds
compound `enable=` expressions — `(talkCond)*(1-(blinkCond))` for the
talk layer, `(blinkCond)*(1-(talkCond))` for blink, `(talkCond)*(blinkCond)`
for the new talk-blink layer — so at any instant exactly one state
shows, correctly, instead of a blink ever wrongly closing a mouth that
should be open mid-word. True/false arithmetic works here because
FFmpeg's `eval` comparisons already return 1/0. Falls back to the
simpler non-compound conditions automatically when `-talk-blink` isn't
present for a given pose (checked independently per pose, same
`fs.existsSync` gate as the other two).

**Delivered:** the 24 normalized, correctly-named PNGs (ready to drop
straight into `public/maya/`), plus the `videoRender.js` update above.

**Files:** `lib/videoRender.js` (`buildMayaOverlayChain` 4-state logic,
input-loop now also loads `{pose}-talk-blink.png` when present);
`public/maya/{pose}-talk.png`, `{pose}-blink.png`, `{pose}-talk-blink.png`
for all 8 poses (24 files, new).

### 2026-08-09 — Phase 6: Maya isn't a frozen cutout anymore
User wants Maya to feel like a "living 2D character" instead of one
static PNG frozen for the whole segment.

**Reality check given first:** this project has no animation engine
(no Live2D/Spine/browser-canvas rendering) — only FFmpeg + sharp. A
real rig was never on the table; what's actually deliverable is
sprite-swap tricks layered on top of the same static art, the same
technique cheap explainer/VTuber content has always used. Asked the
user up front whether they could produce 2 extra frames per pose
(mouth-open, eyes-closed) before building anything — confirmed yes.

**What ships without any new art (works today):** every "presenter"/
"cameo" appearance of Maya now has a continuous subtle sway — a few
pixels of sine-wave x/y drift (`overlay=...:eval=frame`, using FFmpeg's
own `t` variable) instead of a bolted-down static position. Breathing/
idle-shift, zero new files needed.

**What ships once the new art exists:** `renderBatch()` in
`videoRender.js` now looks for two optional extra files per pose —
`{pose}-talk.png` (mouth open) and `{pose}-blink.png` (eyes closed) —
next to the existing `public/maya/{pose}.png`. If found, they're
layered on top via chained FFmpeg `overlay`s with `enable=` timeline
expressions: `-talk` flaps on/off at a ~4-5Hz rhythmic cadence for as
long as Maya's on screen (not real audio-amplitude analysis — decided
against that: narration is continuous prose with no real pauses to
detect, so a rhythmic flap is nearly as convincing for a fraction of
the complexity and zero extra ffmpeg passes), `-blink` pulses a ~130ms
window every 3.5–5.5s (randomized phase per segment) and sits on the
top layer so it wins if it ever overlaps a mouth-open frame. Missing
either file for a given pose just skips that pose's extra layer —
same "never break the render over an optional asset" pattern as BGM/
thumbnail fallbacks; partial rollout (a couple poses first) is fine.

**Exact asset spec (for whoever's drawing these):** 16 new PNGs in
`public/maya/`, transparent background, **same exact canvas size and
same exact character position as the matching base file** — only the
mouth or eyes should differ, everything else pixel-identical, or the
swap will visibly jump:
`excited-talk.png`, `excited-blink.png`, `thinking-talk.png`,
`thinking-blink.png`, `meditating-talk.png`, `meditating-blink.png`,
`caring-talk.png`, `caring-blink.png`, `surprised-talk.png`,
`surprised-blink.png`, `teaching-talk.png`, `teaching-blink.png`,
`confident-talk.png`, `confident-blink.png`, `greeting-talk.png`,
`greeting-blink.png`.

**Files:** `lib/videoRender.js` only — `renderBatch()`'s Maya-input
loop now conditionally adds the `-talk`/`-blink` inputs per segment
(`fs.existsSync` gated), skips loading any Maya asset at all for
"hidden"-role segments (a pre-existing minor waste, fixed along the
way), and a new `buildMayaOverlayChain()` helper builds the layered
`overlay` chain with the sway/flap/blink timeline expressions.
`mayaThumbnail.js` untouched — thumbnails are a single static frame,
motion doesn't apply there.

### 2026-08-09 — Phase 5: pluggable API providers (replaces hardcoded Groq/Pexels/msedge-tts)
User wants to add any AI API by just a name + key, have the app figure
out on its own what it can do (text/image/video/audio), and route each
task to whichever configured provider is prioritized for it — instead
of the pipeline being wired to exactly one hardcoded service per task.

**Design decisions (confirmed with user before building):** (1) full
replacement — the whole pipeline routes through the new system, not an
opt-in side feature; (2) hybrid detection — try known-service
fingerprints automatically first, ask the user to pick manually only if
nothing matches; (3) manual priority — the user orders providers per
task type themselves (▲/▼ list), not an automatic cost/quality ranking.

**Architecture:** `lib/providers/registry.js` is the single source of
truth for known services (Groq, OpenAI, Anthropic, ElevenLabs, Stability
AI, Pexels, msedge-tts) — capabilities, a connectivity probe, and
per-capability adapter functions. `lib/providers/router.js` is the one
entry point the rest of the app calls (`generateText`/`fetchImages`/
`fetchClips`/`synthesizeSpeech`) — it loads the priority-ordered
provider list for that task from Postgres and tries them top-down,
falling back to the next on any failure. New `providers`/
`provider_priority` tables in `db.js`; `GROQ_API_KEY`/`PEXELS_API_KEY`
(if still set) are auto-registered as ordinary provider rows on first
boot so existing deployments don't break. Keys are AES-256-GCM-encrypted
(`lib/providers/crypto.js`, derived from `NEXTAUTH_SECRET`) before
hitting Postgres. New `/providers` page (`ProviderManager.js`) for
adding providers and reordering priority per task type.

**Bug found and fixed while integrating this:** `estimateAudioDurationSec`
computed duration from raw byte size assuming a fixed 48kbps bitrate —
only true for msedge-tts. With other "audio" providers now pluggable
(different bitrates), that assumption would've silently desynced every
caption/media-switch timing whenever someone prioritized, say,
ElevenLabs. Fixed by making it async and reusing the existing
`probeDurationSec` (ffmpeg-stderr-based, no ffprobe dependency) on a
temp-written copy of the buffer instead of guessing from size.

**Verified:** all new/changed files pass `node --check` (plain JS) and
`esbuild` (JSX) syntax validation; traced every import path by hand;
grepped the whole repo afterward to confirm no leftover direct
Groq/Pexels/msedge-tts calls remained outside `registry.js` (except the
legacy `/api-check` status routes, which intentionally still check the
raw env vars as a separate, simpler concept). Not yet tested against a
live deploy — first real run on Render is the actual test.

**Files:** new — `lib/providers/{registry,router,crypto,textUtils}.js`,
`app/api/providers/route.js`, `app/api/providers/[id]/route.js`,
`app/api/providers/[id]/check/route.js`, `app/api/providers/priority/route.js`,
`app/providers/page.js`, `components/ProviderManager.js`. Changed —
`lib/db.js` (schema + CRUD), `lib/media.js` (now a thin wrapper),
`lib/scriptGen.js`, `lib/metadataGen.js`, `lib/translateCaptions.js`,
`lib/communityPost.js`, `lib/pipeline.js`, `app/api/tts/route.js`,
`app/api/community-post/route.js` (removed stale `GROQ_API_KEY` guard),
`lib/videoRender.js` (async `estimateAudioDurationSec`, buffer-or-URL
media items), `lib/mayaThumbnail.js` (buffer-or-URL `bgImageUrl`),
`components/VideoStudio.js` (voice-preview no longer hardcodes an
Edge-only voice name), `components/NavBar.js`, `app/page.js` (nav link
+ home card).

### 2026-08-08 — Phase 4: fully automatic scheduled uploads
User wants zero-touch publishing: a short every day at a set time, a
long video once a week at a different time, both configurable from
the site itself (day/days + time + timezone + privacy).

**Why this needed a real refactor, not just a new route:** the existing
generate/upload logic lived entirely inside two interactive,
session-bound route handlers (`generate-script`, `suggest-metadata`,
`generate-and-upload`) — each assumed a logged-in browser session and,
for the upload route, an NDJSON stream back to a client. A scheduler
has neither. So the actual generation logic was extracted into three
`lib/` functions (`scriptGen.js`, `metadataGen.js`, `pipeline.js`) that
both the interactive routes *and* the new scheduler call — same code
path, not a second copy that could drift out of sync. The interactive
routes are now thin wrappers (auth check → call the lib function →
shape the response the same as before); verified their behavior is
unchanged (same prompts, same response shapes, same streamed
`{status, progress}` events).

**Auth for a pipeline with nobody logged in:** the Google `refresh_token`
(already fetched via `access_type=offline` at sign-in) previously only
lived in the encrypted NextAuth session cookie — no use to a background
job. `authOptions.js`'s `jwt` callback now also saves it to a new
`channel_auth` table on every fresh sign-in, and the scheduler pulls it
from there to mint fresh access tokens on its own, no browser required.

**Why an external pinger instead of an in-app timer:** confirmed (re-
checked current Render pricing while building this) that the free tier
spins the whole service down after 15 min idle — while asleep, no code
is running at all, so nothing inside the app can wake itself up at a
scheduled time. Render does sell a native Cron Job, but it's a paid
add-on, which conflicts with this project's stated free-tier
constraint. So instead: new `api/scheduler/run/route.js`, a GET
endpoint secured by a `CRON_SECRET` env var, meant to be pinged every
~10 min by a free external service (cron-job.org recommended — set up
instructions are shown right on the new `/schedule` page, URL included,
secret redacted). Each ping checks every enabled schedule against the
current time *in that schedule's own timezone*, and for anything due
(within a 15-min tolerance window, and not already run today), claims
it immediately (`schedules.last_run_date`) then kicks off script→
metadata→render→upload in the background *after* responding to the
pinger — this works because Render hosts this as a persistent Node
process, not a serverless function, so background work genuinely
continues post-response. The scheduled run reuses the exact same
5-minute self-ping-to-`/api/status` trick the interactive upload route
already used to survive its own 15-40 min duration.

**New tables**: `schedules` (video_mode, days_of_week int[], time_of_day,
timezone, privacy_status, enabled, last_run_date) and `schedule_runs`
(status/videoId/error log per attempt, shown on `/schedule`).

**New page**: `/schedule` (`ScheduleSettings.js`) — add/edit/enable/
delete schedules, day-of-week checkboxes + time + IANA timezone
(defaults `Asia/Tehran`) + privacy dropdown (defaults **public** — since
the entire point is zero-touch, unlike the manual path which defaults
to private; change per-schedule if that's not wanted), plus a table of
recent runs so it's visible from the site whether it's actually
firing, without needing DB access. Linked from `NavBar.js`.

**Known limitations, not silently glossed over** (also in Known
constraints above): no catch-up if a slot is missed entirely (e.g. the
service was down through the whole tolerance window); topic is always
AI-picked (no per-schedule topic queue) — same as the existing "let AI
pick" behavior already used interactively, nothing new there.

Files: `lib/scriptGen.js` (new), `lib/metadataGen.js` (new),
`lib/pipeline.js` (new), `lib/db.js`, `api/generate-script/route.js`
(now a thin wrapper), `api/suggest-metadata/route.js` (now a thin
wrapper), `api/generate-and-upload/route.js` (now a thin wrapper),
`api/scheduler/run/route.js` (new), `api/schedules/route.js` (new),
`api/auth/authOptions.js`, `components/ScheduleSettings.js` (new),
`components/NavBar.js`, `app/schedule/page.js` (new).

### 2026-08-08 — Phase 3: multi-platform distribution, A/B testing, Shorts repurposing, dynamic BGM
Five changes, engagement/growth/audio-quality focused. Two real YouTube
API gaps surfaced while building this — documented in Known constraints
above rather than papered over, since a future session needs to know
they're platform limits, not bugs to "fix" later:

1. **Dynamic BGM + ducking**: `videoRender.js`'s final audio mix now
   picks a local mood-matched track (reusing `pickMayaPose`'s scoring —
   4 mood buckets: calm/reflective/hopeful/uplifting) from
   `public/audio/bgm/` instead of one static synthetic tone, and ducks
   it under narration with `sidechaincompress` (music drops while Maya
   talks, recovers in real silence — reactive to the actual TTS audio
   signal, since there's no manual SSML pause data to key off). Falls
   back to the old synthetic tone if no BGM file is present for the
   picked mood, so a bare-bones deploy still renders fine. **BGM audio
   files themselves are not part of this change** — Pexels has no audio
   API, so those need to be added to the repo manually (see Known
   constraints).
2. **Community post drafts**: after a long-form upload, Groq generates
   one poll/quote tied to the video and it's saved as a draft (new
   `community_posts` table + `community-post/route.js`, GET and POST).
   **Not auto-published** — YouTube Data API v3 has no public Community
   Tab endpoint at all, confirmed while building this, so this is a
   ready-to-copy draft, not a live post. Wired a small actions column
   into `ChannelAnalytics.js` so the draft is actually reachable
   (button + inline poll/quote display), not just an API that exists
   with no UI.
3. **Title/thumbnail A/B**: `suggest-metadata` now returns two full
   variants (different hook angle, not just reworded) instead of one;
   `mayaThumbnail.js` gained a `variant` param that changes color grade
   (purple-orange vs. teal-blue) and picks the 2nd-ranked mood pose for
   B, so the two thumbnails are visually distinct, not just different
   text. Variant A goes live at upload (`videos.insert`/
   `thumbnails.set` unchanged there); variant B is stored
   (`title_b`/`thumbnail_text_b` columns) and can be swapped live via
   the new `ab-test/route.js` + the analytics-page A/B buttons.
   **This is sequential, not simultaneous** split-testing — YouTube
   gives no public API for showing two variants to different viewers
   at once (that's Studio-only, manual). Compare CTR before/after the
   switch in Analytics.
4. **Shorts repurposing**: new `repurpose-short/route.js` — given a
   source video file + its `videoId`, reads the retention curve from
   YouTube Analytics (`elapsedVideoTimeRatio`, new `lib/repurpose.js`),
   picks the highest-retention window of the requested target length
   (heuristic window if the video's too new for retention data yet),
   crops to 9:16 with a blurred-background fill (same technique
   `videoRender.js` already uses for portrait mode) via new
   `renderVerticalShortFromSource`, burns in animated (fade in/out)
   captions if caption timing is supplied, and either returns the
   `.mp4` directly or auto-uploads it as a Short. Takes the source file
   as a fresh upload rather than fetching by `videoId` because
   **YouTube's API has no way to download a previously-uploaded
   video's original file** — confirmed while building this, see Known
   constraints. Added `probeDurationSec`/`probeHasAudioStream` to
   `videoRender.js` (reads ffmpeg's own stderr — no ffprobe binary in
   this project) since this route needs the source's real duration.
5. **BATCH_SIZE=1 untouched** — verified still `1` in `videoRender.js`
   after all the above; none of this phase's rendering changes run
   multiple FFmpeg inputs open at once beyond what already existed.

Files: `lib/videoRender.js`, `lib/mayaThumbnail.js`, `lib/db.js`,
`lib/repurpose.js` (new), `lib/communityPost.js` (new),
`api/suggest-metadata/route.js`, `api/generate-and-upload/route.js`,
`api/community-post/route.js` (new), `api/ab-test/route.js` (new),
`api/repurpose-short/route.js` (new), `components/ChannelAnalytics.js`.

**Not done in this pass** (flagging for next session rather than
quietly skipping): no UI was built for triggering `repurpose-short`
itself (it's a working, tested-by-inspection endpoint, callable today
via curl/Postman with a `video` file + `videoId` + optional
`targetDurationSec`/`captions`/`autoUpload` fields) — a proper
upload-and-preview flow in `VideoStudio.js` or a new page would be the
natural next step. `VideoStudio.js` also hasn't been wired to show the
two A/B title options at generation time yet (currently only visible/
switchable after upload, from the analytics page).

### 2026-08-08 — Phase 2: monetization length, comment CTA, curiosity-gap titles, faster cuts
Four changes aimed at watch time / ads / CTR:
1. **Long-form length**: `generate-script`'s long-mode prompt now mandates
   1200-1500 words (past the 8-min mark) in 3-4 deep sub-sections (hook +
   root cause, symptoms, real story, actionable steps) instead of six
   lighter beats averaging ~950-1150 words. `max_tokens` raised 2500→3000
   so a full-length script doesn't get cut off mid-sentence.
2. **Comment CTA**: both short and long prompts now require the closing
   ~15-20s to end with one specific, personal, topic-tied question that
   explicitly asks viewers to answer in the comments (not a generic "what
   do you think?", not a subscribe ask).
3. **Curiosity-gap titles**: `suggest-metadata`'s title rule now strictly
   forbids artistic/abstract titles (e.g. "Memory Echoes") and requires a
   concrete problem+solution pattern — "[Problem] (And How to [Fix])" —
   before the " | The Mindful Path" suffix. Character budget loosened
   48→52 (heuristic fallback too) since the parenthetical pattern runs
   longer.
4. **Faster cuts**: `generate-and-upload`'s `mediaCount` formula changed
   from a fixed 6 (short) / ~24s-per-segment (long) to targeting 2-3s/
   segment (short) and 5-8s/segment (long), via `audioDurationSec /
   2.5` and `/ 6.5` respectively. Because long scripts are now much
   longer, this can push segment count up to ~60-80 (was capped at 24) —
   `BATCH_SIZE=1` in `videoRender.js` means peak memory is unaffected
   (still exactly one image per ffmpeg run regardless of count), but the
   pipeline runs more sequential Pexels searches + ffmpeg batches, so
   total render time goes up too. Added a ceiling (30 short / 80 long)
   so this can't run away. `scriptTiming.js` and `videoRender.js`
   themselves needed no changes — both already handle any segment count
   generically. Existing per-segment `send()` progress updates already
   cover streaming liveness; no change needed there either.
Files: `api/generate-script/route.js`, `api/suggest-metadata/route.js`,
`api/generate-and-upload/route.js`.

### 2026-08-07 — Metadata rewrite: keyword-led titles, separate thumbnail text
Rewrote `suggest-metadata`'s AI prompt after comparing the top 10 channels
in the niche surfaced 4 gaps: titles buried the hook inside a generic
sentence instead of opening with it, titles had no channel branding,
thumbnails just displayed the full (long) title instead of short punchy
text, and descriptions opened with a greeting instead of the keyword.
Fixed: title must now open with a keyword/number/named problem, then end
with " | The Mindful Path"; new `thumbnailText` field (4-6 words, must
read differently from the title) generated alongside title/description/
tags; description's first line now leads with the keyword directly (no
"Hey!"/"Welcome" opener), since that first line is all a viewer sees
before "Show more". Heuristic (no-Groq-key) fallback updated to the same
shape so both paths stay consistent. `thumbnailText` now flows
end-to-end: AI-suggested → editable in the UI (new input + a live CSS
preview of the thumbnail composition) → sent on both upload paths
(auto-pipeline and manual upload, so the field behaves the same
regardless of which "Upload" button is used) → rendered on the actual
thumbnail (smaller font than before, horizontally centered in the space
left of Maya instead of left-anchored, since the text is much shorter
now) → persisted via a new `thumbnail_text` column. Files:
`api/suggest-metadata/route.js`, `lib/mayaThumbnail.js`,
`components/VideoStudio.js`, `api/generate-and-upload/route.js`,
`api/upload/route.js` (kept consistent with the shared metadata fields),
`lib/db.js` (schema + `recordVideo`).

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
