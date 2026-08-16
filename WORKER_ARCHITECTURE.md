# Worker Architecture Documentation

## Overview

This document describes the three-part architecture for YouTube Studio:

1. **Web App** (Next.js) - User interface, scheduling, API routes
2. **OmniRoute** (Provider Router) - Central AI provider abstraction with priority/fallback
3. **GitHub Actions Worker** - Heavy video processing (FFmpeg rendering, Shorts creation)

## Job Types

| Job Type | Description | Payload |
|----------|-------------|---------|
| `render_video` | Full video rendering with TTS, media, captions | Script, title, videoMode, media items, etc. |
| `render_short` | Vertical Short from source video | Source buffer, start/duration, captions |
| `generate_thumbnail` | Maya thumbnail generation | Title, text, script, background image |
| `generate_script` | AI script generation | Topic, duration, tone, language |
| `synthesize_speech` | TTS audio generation | Text, voice |
| `fetch_media` | Image/video fetching from providers | Query, count, orientation, type |

## Worker Communication Flow

```
┌─────────────┐     1. Create Job      ┌─────────────┐
│  Web App    │ ─────────────────────▶ │ Job Queue   │
│ (Next.js)   │                        │ (In-memory/ │
└─────────────┘                        │  Database)  │
       │                               └──────┬──────┘
       │                                      │
       │ 2. Dispatch to GitHub Actions        │
       ▼                                      ▼
┌─────────────────────┐              ┌─────────────────┐
│ GitHub Actions      │              │ Worker          │
│ Workflow Dispatch   │ ──────────▶  │ (src/worker/    │
│ (render-worker.yml) │              │  index.js)      │
└─────────────────────┘              └────────┬────────┘
                                               │
                                    3. Process & return result
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │ Callback to Web App │
                                    │ /api/jobs/callback  │
                                    └─────────────────────┘
```

## Security

### Worker Credentials

- **WORKER_API_KEY**: Shared secret for worker authentication
- **WORKER_SIGNING_SECRET**: HMAC key for signing credentials (defaults to WORKER_API_KEY)
- Credentials are time-limited (default 5 minutes) with HMAC-SHA256 signatures
- Prevents replay attacks and unauthorized job processing

### Payload Signing

- Job payloads are signed with HMAC-SHA256
- Worker verifies payload integrity before processing
- Callback verifies signature before updating job status

### GitHub Actions Secrets

Required secrets in GitHub repository settings:
- `WORKER_API_KEY`
- `WORKER_SIGNING_SECRET`
- `DATABASE_URL` (if worker needs DB access)
- `GITHUB_TOKEN` (for workflow dispatch)
- Provider API keys: `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `STABILITY_API_KEY`, `PEXELS_API_KEY`
- YouTube OAuth: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`

## Environment Variables

### Web App (.env.local)
```env
# Worker
USE_RENDER_WORKER=true
WORKER_API_KEY=your-secret-key
WORKER_SIGNING_SECRET=your-signing-secret
GITHUB_TOKEN=ghp_xxx
GITHUB_REPOSITORY_OWNER=your-username
GITHUB_REPOSITORY_NAME=your-repo
NEXT_PUBLIC_APP_URL=https://your-app.com
ALERT_WEBHOOK_URL=https://your-webhook.com
```

### Worker (GitHub Actions)
Set as repository secrets (see Security section).

## API Endpoints

### POST /api/jobs/dispatch
Dispatch a job to the worker.

**Request:**
```json
{
  "jobType": "render_video",
  "input": { ... },
  "options": {
    "priority": "normal",
    "webhookUrl": "https://...",
    "maxRetries": 3
  }
}
```

**Response:**
```json
{
  "success": true,
  "jobId": "uuid",
  "jobType": "render_video",
  "status": "queued",
  "credential": "jobId.timestamp.expiresAt.signature",
  "callbackUrl": "https://app.com/api/jobs/callback"
}
```

### POST /api/jobs/callback
Worker calls this to report job completion.

**Headers:**
```
Authorization: Bearer jobId.timestamp.expiresAt.signature
```

**Body:**
```json
{
  "payload": { ... },
  "signature": "hmac-sha256",
  "status": "completed",
  "result": { ... },
  "error": null
}
```

### GET /api/jobs/status?runId=xxx
Check GitHub Actions workflow run status.

## Worker Implementation

### Entry Point: `src/worker/index.js`

Handles all job types. Run with:
```bash
node src/worker/index.js <job_id> <job_type> <payload_json>
```

### Key Functions

- `renderVideoJob()` - Full video pipeline (TTS → media → render → upload)
- `renderShortJob()` - Vertical Short from source video
- `generateThumbnailJob()` - Maya thumbnail variants
- `generateScriptJob()` - AI script generation
- `synthesizeSpeechJob()` - TTS audio
- `fetchMediaJob()` - Image/video fetching

### Output Format

Worker outputs result to stdout with prefix:
```
WORKER_RESULT:{"jobId":"...","jobType":"...","status":"success","result":{...},"completedAt":"..."}
```

GitHub Actions captures this for artifact upload.

## GitHub Actions Workflow

File: `.github/workflows/render-worker.yml`

Triggers:
- `workflow_dispatch` (manual/API)
- `repository_dispatch` (from web app)

Steps:
1. Checkout repository
2. Setup Node.js 20
3. Install dependencies (`npm ci`)
4. Install FFmpeg (`apt-get install ffmpeg`)
5. Verify fonts/assets
6. Run worker
7. Upload logs on failure

Timeout: 45 minutes

## Local Development

### Test Worker Locally
```bash
# Set env vars
export WORKER_API_KEY=test-secret
export WORKER_SIGNING_SECRET=test-secret

# Run a test job
node src/worker/index.js test-job-123 render_video '{"script":"Hello world","title":"Test","videoMode":"long"}'
```

### Test Full Flow
1. Start web app: `npm run dev`
2. Set `USE_RENDER_WORKER=true` in `.env.local`
3. Configure GitHub PAT with `workflow` scope
4. Trigger video generation from UI
5. Check GitHub Actions for workflow run

## Job Payload Schema

### render_video
```json
{
  "script": "Full narration script",
  "title": "Video title",
  "description": "Video description",
  "thumbnailText": "Max 4 words for thumbnail",
  "tags": "tag1,tag2,tag3",
  "privacyStatus": "private|public|unlisted",
  "publishAt": "ISO datetime (optional)",
  "videoMode": "long|short",
  "useVideoClips": true|false,
  "imageKeyword": "pexels search keyword",
  "titleB": "A/B test title",
  "thumbnailTextB": "A/B test thumbnail text",
  "accessToken": "youtube oauth token",
  "durations": [{ "startSec": 0, "endSec": 5 }, ...],
  "captions": ["Caption 1", "Caption 2", ...],
  "mediaItems": [{ "type": "image", "buffer": "...", "durationSec": 5 }, ...],
  "audioBuffer": "base64 or buffer (optional)"
}
```

### render_short
```json
{
  "sourceBuffer": "base64 video",
  "startSec": 10,
  "durationSec": 30,
  "captionLines": [{ "text": "Caption", "startSec": 0, "endSec": 3 }, ...]
}
```

### generate_thumbnail
```json
{
  "title": "Video title",
  "thumbnailText": "Max 4 words",
  "script": "Full script for pose detection",
  "bgImageUrl": "https://... or { buffer, ext }",
  "variant": "A|B"
}
```

## Error Handling

- Worker exits with code 1 on failure
- GitHub Actions marks workflow as failed
- Logs uploaded as artifact on failure
- Webhook notified if `ALERT_WEBHOOK_URL` set
- Job status updated to `failed` via callback

## Monitoring

- GitHub Actions dashboard for workflow runs
- Worker logs in workflow run details
- Webhook notifications for failures
- Job status API for polling

## Scaling Considerations

- GitHub Actions: 20 concurrent jobs (free tier)
- Self-hosted runners for higher throughput
- Job queue in database for persistence
- Priority queue for urgent jobs
- Dead letter queue for failed jobs after max retries

## Future Improvements

1. Database-backed job queue (replace in-memory Map)
2. WebSocket/SSE for real-time progress updates
3. Artifact storage (S3/GCS) for large video outputs
4. Worker autoscaling with self-hosted runners
5. Job scheduling with cron triggers
6. Multi-region worker deployment