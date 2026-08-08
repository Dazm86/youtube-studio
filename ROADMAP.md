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
- **`generate-and-upload/route.js`** — the core pipeline, streams progress as newline-delimited JSON. Steps: TTS → bucket script into timed segments (`distributeDurations`) → per-segment Pexels search → FFmpeg render (per-segment batches, dynamic ducked BGM) → refresh Google token → upload to YouTube → thumbnail (variant A live, variant B stored) → English SRT caption → translated captions (5 languages) → community-post draft (long-form only). Sends a heartbeat ping every 15s throughout.
- `images/route.js`, `clips/route.js` — thin wrappers around `lib/media.js`
- `tts/route.js` — voice preview
- `suggest-metadata/route.js` — AI (or heuristic fallback) title/description/tags from a script; now returns **two** title + thumbnail-text variants (A/B) per call.
- `upload/route.js` — manual path: user uploads an already-made video file directly, still gets a Maya thumbnail. Does NOT have the long-render token-refresh logic (not needed — this path is short).
- `sync-stats/route.js` — pulls views/subscribers/likes from YouTube Analytics into the DB
- `videos/route.js` — lists recorded videos (analytics page)
- `status/route.js`, `status/groq`, `status/pexels`, `status/youtube` — connectivity checks for the API-check page
- `auth/[...nextauth]/route.js` + `auth/authOptions.js` — Google OAuth, JWT refresh logic (`refreshAccessToken` is exported for reuse)
- **`community-post/route.js`** *(new, Phase 3)* — generates + stores a Community Tab post draft (poll or quote) via Groq for a given `videoId`. Draft only — see Known constraints.
- **`ab-test/route.js`** *(new, Phase 3)* — switches the *live* title+thumbnail on a given video between stored variant A/B (`videos.update` + `thumbnails.set`). Sequential switch, not simultaneous split-testing — see Known constraints.
- **`repurpose-short/route.js`** *(new, Phase 3)* — accepts a source long-form video file (multipart) + its YouTube `videoId`, reads the retention curve from YouTube Analytics, crops the highest-retention window to 9:16 with animated captions, and either returns the `.mp4` or auto-uploads it as a Short.

### Lib (`src/lib/`)
- **`videoRender.js`** — FFmpeg orchestration. One segment per FFmpeg process (`BATCH_SIZE = 1`, deliberately, to stay inside 512MB RAM — **kept intact in Phase 3**), 300s timeout per segment (throws and stops the whole render on failure — no retry). Maya appears large/centered ("presenter" role) only on the first and last segment; alternates small-corner-cameo/fully-hidden for body segments. Backdrop blur uses a downscale→blur→upscale trick for speed. *Phase 3:* final audio mix now picks a local mood-matched BGM track (`public/audio/bgm/`, mapped from `pickMayaPose`) and ducks it under narration via `sidechaincompress` (falls back to the old synthetic tone if no BGM file exists — never fails the render). New exports: `renderVerticalShortFromSource` (crop-to-9:16 + animated burned-in captions for Shorts) and `probeDurationSec` (reads source duration from ffmpeg's own stderr — no ffprobe dependency in this project).
- **`scriptTiming.js`** — splits the flat script into N timed buckets (`distributeDurations`) and builds SRT files (`buildSrt`) from any (captions, durations) pair — reused for every caption language.
- `media.js` — Pexels search (`fetchImages`/`fetchClips`); auto-extracts keywords from text when no manual keyword is given.
- **`translateCaptions.js`** — Groq call that translates the caption array into another language, 1:1 index-preserving (required so `buildSrt` timing still lines up with the video).
- `mayaThumbnail.js` — composites the YouTube thumbnail (Maya + blurred background + title text); picks Maya's pose by keyword-matching segment text against 7 moods + a default. *Phase 3:* `pickMayaPose` now built on `pickMayaPoseRanked` (full ranking, not just top pick); `buildMayaThumbnail` takes a `variant` ('A'/'B') that changes the color grade (purple-orange vs. teal-blue) and picks the 2nd-ranked pose for B; new `buildMayaThumbnailVariants` builds both in one call.
- `channelHistory.js` — pulls recent video titles from YouTube itself, used as "memory" so new scripts don't repeat topics
- `youtubeAnalytics.js` — batch stats fetch for `sync-stats`
- `db.js` — Postgres pool + `videos` table (auto-created on first use). *Phase 3:* added `title_a/title_b/thumbnail_text_a/thumbnail_text_b/active_variant` columns + `setActiveVariant`/`getVideoByVideoId`; new `community_posts` and `repurposed_shorts` tables + their record/get functions.
- **`repurpose.js`** *(new, Phase 3)* — `getRetentionCurve` (YouTube Analytics `elapsedVideoTimeRatio`) + `findBestRetentionWindow` (picks the highest-retention slice of a given target length; falls back to a documented heuristic window for videos too new to have retention data yet).
- **`communityPost.js`** *(new, Phase 3)* — Groq call that writes one Community Tab post draft (poll or quote) for a video.

### Components (`src/components/`)
- `VideoStudio.js` — the whole long/short creation UI + the streaming-fetch client for `generate-and-upload`
- `ChannelAnalytics.js` — as named. *Phase 3:* added a per-video actions column — "generate community post draft" (shows the poll/quote inline) and A/B title switch buttons (bold = currently live variant).
- `ApiStatus.js`, `NavBar.js` — as named (NavBar also auto-signs-out on an unrecoverable token-refresh error)
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

## Changelog

Newest first. Add new entries above the top one — date, what, why, files.

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
