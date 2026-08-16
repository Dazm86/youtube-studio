# YouTube Studio - Project Reorganization Plan

## Current Structure Analysis

### API Routes (21 routes, already partially organized)
```
src/app/api/
├── ab-test/route.js                    # A/B testing for titles/thumbnails
├── auth/[...nextauth]/route.js         # NextAuth handler
├── clips/route.js                      # Fetch video clips from Pexels
├── community/route.js                  # Generate community posts
├── generate-and-upload/route.js        # Main pipeline: script → render → upload
├── generate-script/route.js            # Generate script from topic
├── images/route.js                     # Fetch images from Pexels/OpenAI
├── providers/                          # Provider management
│   ├── route.js                        # List/create providers
│   ├── [id]/route.js                   # Update/delete provider
│   ├── [id]/check/route.js             # Health check provider
│   └── priority/route.js               # Set priority order
├── repurpose/route.js                  # Create Shorts from long videos
├── scheduler/run/route.js              # Cron-triggered scheduled runs
├── schedules/route.js                  # Schedule CRUD
├── status/                             # Health checks
│   ├── route.js                        # Overall status
│   ├── groq/route.js                   # Groq API status
│   ├── pexels/route.js                 # Pexels API status
│   └── youtube/route.js                # YouTube API status
├── suggest-metadata/route.js           # Generate metadata from script
├── sync-stats/route.js                 # Sync video stats from YouTube
├── tts/route.js                        # Text-to-speech synthesis
├── upload/route.js                     # Direct video upload
└── videos/route.js                     # List user videos
```

### Components (6 components, flat structure)
```
src/components/
├── ApiStatus.js        # API status display
├── ChannelAnalytics.js # Channel analytics charts
├── NavBar.js           # Navigation bar
├── ProviderManager.js  # Provider management UI
├── ScheduleSettings.js # Schedule configuration
└── VideoStudio.js      # Main video creation studio
```

### Library Files (17 files + providers subfolder)
```
src/lib/
├── channelHistory.js      # Recent video titles
├── communityPost.js       # Community post generation
├── db.js                  # PostgreSQL schema + CRUD (603 lines)
├── mayaThumbnail.js       # Thumbnail generation with Maya avatar
├── media.js               # Pexels/OpenAI/Stability media fetch
├── metadataGen.js         # AI + heuristic metadata (A/B titles)
├── pipeline.js            # Master orchestration (637 lines)
├── providers/
│   ├── crypto.js          # AES-256-GCM encryption
│   ├── registry.js        # Service adapters + auto-detection
│   ├── router.js          # Priority routing + retries + fallback
│   └── textUtils.js       # Text utilities
├── repurpose.js           # Shorts from retention data
├── scriptGen.js           # LLM script with quality loop
├── scriptTiming.js        # Caption timing/distribution
├── translateCaptions.js   # Multilingual SRT (5 langs)
├── videoRender.js         # FFmpeg rendering with Maya (982 lines)
└── youtubeAnalytics.js    # YouTube Analytics API
```

### Public Assets
```
public/
├── fallback-media/
│   ├── images/ (README only)
│   └── videos/ (README only)
├── ffmpeg-core/           # @ffmpeg/ffmpeg WASM files
├── fonts/                 # DejaVuSans-Bold.ttf
└── maya/                  # Maya avatar PNGs (32 files)
```

### Pages (7 pages)
```
src/app/
├── page.js               # Home dashboard
├── layout.js             # Root layout
├── providers/page.js     # Provider management
├── schedule/page.js      # Schedule management
├── analytics/page.js     # Analytics dashboard
├── long/page.js          # Long video studio
├── short/page.js         # Short video studio
└── api-check/page.js     # API status check
```

---

## Target Structure

### 1. API Routes - Domain-Based Organization (Already mostly done ✓)

The API routes are already organized into domain-based folders. Need to verify:
- All routes use `route.js` naming (Next.js App Router convention) ✓
- Dynamic routes properly structured as `[id]/route.js` ✓
- Nested routes properly structured as `priority/route.js` ✓

**No changes needed** - API routes are already well-organized.

### 2. Components - Domain-Based Structure

```
src/components/
├── ui/                      # Shared/reusable UI primitives
│   ├── Button.js
│   ├── Card.js
│   ├── Input.js
│   ├── Select.js
│   ├── Modal.js
│   └── index.js
├── layout/                  # Layout components
│   ├── NavBar.js
│   ├── Sidebar.js
│   └── Footer.js
├── schedule/                # Schedule-related components
│   └── ScheduleSettings.js
├── providers/               # Provider management
│   └── ProviderManager.js
├── studio/                  # Video creation studio
│   └── VideoStudio.js
├── analytics/               # Analytics components
│   └── ChannelAnalytics.js
├── api-status/              # API status display
│   └── ApiStatus.js
└── index.js                 # Barrel exports
```

### 3. Library Files - Logical Domain Groupings

```
src/lib/
├── auth/                    # Authentication utilities
│   └── authOptions.js       # Moved from src/app/api/auth/
├── db/                      # Database layer
│   ├── index.js             # Pool, schema, migrations
│   ├── queries/             # Organized query modules
│   │   ├── videos.js
│   │   ├── providers.js
│   │   ├── schedules.js
│   │   ├── runs.js
│   │   └── stats.js
│   └── schema.sql           # Reference schema
├── providers/               # Provider abstraction (existing structure good)
│   ├── crypto.js
│   ├── registry.js
│   ├── router.js
│   └── textUtils.js
├── pipeline/                # Pipeline orchestration
│   ├── index.js             # Main runPipeline export
│   ├── steps/               # Individual pipeline steps
│   │   ├── generateScript.js
│   │   ├── generateMetadata.js
│   │   ├── synthesizeSpeech.js
│   │   ├── fetchMedia.js
│   │   ├── renderVideo.js
│   │   ├── uploadVideo.js
│   │   └── postProcess.js
│   └── utils/
│       ├── selfPing.js
│       └── progress.js
├── rendering/               # Video rendering (split from videoRender.js)
│   ├── index.js
│   ├── ffmpeg.js            # FFmpeg wrapper
│   ├── filters/             # FFmpeg filter graphs
│   │   ├── captions.js
│   │   ├── transitions.js
│   │   └── bgm.js
│   ├── maya/                # Maya avatar rendering
│   │   ├── poses.js
│   │   └── thumbnail.js
│   └── assets/              # Asset management
├── media/                   # Media fetching
│   ├── index.js
│   ├── pexels.js
│   ├── openai.js
│   └── stability.js
├── metadata/                # Metadata generation
│   ├── index.js
│   ├── generator.js
│   ├── chapters.js
│   └── abTest.js
├── scheduling/              # Scheduling logic
│   ├── index.js
│   ├── cron.js
│   └── timezone.js
├── analytics/               # YouTube Analytics
│   ├── index.js
│   ├── retention.js
│   └── stats.js
├── community/               # Community posts
│   └── index.js
├── repurpose/               # Shorts repurposing
│   └── index.js
├── script/                  # Script generation
│   ├── index.js
│   ├── generator.js
│   ├── timing.js
│   └── translate.js
├── utils/                   # Shared utilities
│   ├── crypto.js
│   ├── date.js
│   └── text.js
└── index.js                 # Barrel exports
```

### 4. Public Assets - Organized Structure

```
public/
├── assets/
│   ├── audio/
│   │   └── bgm/             # Background music files
│   ├── fonts/
│   │   └── DejaVuSans-Bold.ttf
│   ├── images/
│   │   ├── fallback/        # Fallback images
│   │   └── maya/            # Maya avatar PNGs
│   └── videos/
│       └── fallback/        # Fallback videos
├── ffmpeg-core/             # Keep as-is (required by @ffmpeg/ffmpeg)
└── favicon.ico              # If exists
```

### 5. Test Structure

```
tests/
├── unit/
│   ├── lib/
│   │   ├── db.test.js
│   │   ├── providers/
│   │   ├── pipeline/
│   │   ├── rendering/
│   │   ├── media/
│   │   ├── metadata/
│   │   ├── scheduling/
│   │   ├── analytics/
│   │   ├── community/
│   │   ├── repurpose/
│   │   └── script/
│   └── components/
│       ├── ui/
│       ├── layout/
│       ├── schedule/
│       ├── providers/
│       ├── studio/
│       ├── analytics/
│       └── api-status/
├── integration/
│   ├── api/
│   │   ├── providers.test.js
│   │   ├── schedules.test.js
│   │   ├── upload.test.js
│   │   └── pipeline.test.js
│   └── db/
│       └── schema.test.js
├── e2e/
│   ├── video-creation.test.js
│   ├── scheduling.test.js
│   └── provider-management.test.js
├── fixtures/
│   ├── sample-script.txt
│   ├── sample-video.mp4
│   └── sample-audio.mp3
├── setup.js
└── jest.config.js
```

---

## Migration Strategy

### Phase 1: Components Reorganization (Low Risk)
1. Create new component folders
2. Move components to appropriate folders
3. Update all imports in pages
4. Create barrel export files

### Phase 2: Library Reorganization (Medium Risk)
1. Create new lib folder structure
2. Move files to appropriate domains (without splitting large files yet)
3. Update all imports across the codebase
4. Create barrel export files

### Phase 3: Public Assets Reorganization (Low Risk)
1. Create new assets folder structure
2. Move files
3. Update references in code (videoRender.js, mayaThumbnail.js)

### Phase 4: Test Structure Creation (New)
1. Create test directory structure
2. Add jest/vitest configuration
3. Write basic test scaffolding

### Phase 5: Verification
1. Run build to verify no broken imports
2. Run lint
3. Run tests (if any exist)

---

## Import Path Updates Required

### Components
- `src/components/NavBar.js` → `src/components/layout/NavBar.js`
- `src/components/VideoStudio.js` → `src/components/studio/VideoStudio.js`
- `src/components/ScheduleSettings.js` → `src/components/schedule/ScheduleSettings.js`
- `src/components/ProviderManager.js` → `src/components/providers/ProviderManager.js`
- `src/components/ChannelAnalytics.js` → `src/components/analytics/ChannelAnalytics.js`
- `src/components/ApiStatus.js` → `src/components/api-status/ApiStatus.js`

### Library Files
- `src/lib/authOptions.js` (new location) - Move from `src/app/api/auth/authOptions.js`
- `src/lib/db/` - Restructure db.js into modular queries
- `src/lib/rendering/` - Move videoRender.js and mayaThumbnail.js
- `src/lib/media/` - Move media.js
- `src/lib/metadata/` - Move metadataGen.js
- `src/lib/scheduling/` - Move scheduling logic from pipeline.js
- `src/lib/analytics/` - Move youtubeAnalytics.js and repurpose.js
- `src/lib/community/` - Move communityPost.js
- `src/lib/script/` - Move scriptGen.js, scriptTiming.js, translateCaptions.js
- `src/lib/utils/` - Move shared utilities

### Public Assets
- `public/maya/` → `public/assets/images/maya/`
- `public/fonts/` → `public/assets/fonts/`
- `public/fallback-media/images/` → `public/assets/images/fallback/`
- `public/fallback-media/videos/` → `public/assets/videos/fallback/`
- Need to create `public/assets/audio/bgm/` for background music

---

## Files to Modify (Import Updates)

### Pages that import components:
- `src/app/layout.js` - imports NavBar
- `src/app/page.js` - imports various components
- `src/app/providers/page.js` - imports ProviderManager
- `src/app/schedule/page.js` - imports ScheduleSettings
- `src/app/analytics/page.js` - imports ChannelAnalytics
- `src/app/long/page.js` - imports VideoStudio
- `src/app/short/page.js` - imports VideoStudio
- `src/app/api-check/page.js` - imports ApiStatus

### API routes that import lib:
- All 21 API routes import from `../../../lib/` or similar
- Need to update to new paths

### Lib files that import each other:
- pipeline.js imports from providers, media, videoRender, scriptTiming, translateCaptions, mayaThumbnail, metadataGen, communityPost, db
- videoRender.js imports from mayaThumbnail
- providers/router.js imports from providers/registry, providers/crypto
- etc.

---

## Execution Order

1. **Create new directory structure** (mkdir -p)
2. **Move component files** to new locations
3. **Update component imports** in pages
4. **Create component barrel exports** (index.js files)
5. **Move lib files** to new domain folders (without splitting)
6. **Update lib imports** across all files
7. **Create lib barrel exports**
8. **Move public assets** to new structure
9. **Update asset references** in code
10. **Create test structure**
11. **Run build verification**
12. **Run lint**
13. **Document any breaking changes**

---

## Risk Mitigation

- **Don't split large files** (pipeline.js, videoRender.js, db.js) in this reorganization - keep them intact but move to appropriate folders
- **Use barrel exports** (index.js) to maintain backward compatibility during transition
- **Test build after each phase** to catch import errors early
- **Keep git history** - use git mv for tracking
- **Update one domain at a time** to minimize scope of changes