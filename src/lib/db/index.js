import { Pool } from "pg";
import { encrypt } from "../providers/crypto.js";

let pool = null;
let schemaReady = null;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL تنظیم نشده");
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS videos (
          id SERIAL PRIMARY KEY,
          video_id TEXT NOT NULL,
          title TEXT,
          script TEXT,
          video_mode TEXT,
          use_video_clips BOOLEAN,
          image_keyword TEXT,
          views INTEGER,
          subscribers_gained INTEGER,
          likes INTEGER,
          avg_view_duration_sec NUMERIC,
          stats_updated_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      // ستون‌های جدید (عمق آنالیتیکس) — با ALTER چون ممکنه دیتابیس از قبل
      // با نسخه‌ی قدیمی‌تر ساخته شده باشه و CREATE TABLE IF NOT EXISTS
      // روش اثر نکنه.
      await getPool().query(`
        ALTER TABLE videos
          ADD COLUMN IF NOT EXISTS retention_pct NUMERIC,
          ADD COLUMN IF NOT EXISTS thumbnail_impressions INTEGER,
          ADD COLUMN IF NOT EXISTS thumbnail_ctr NUMERIC;
      `);
      // ستون جدید: متن جدای صورت کوچک (کوتاه‌تر از عنوان، مخصوص روی تصویر)
      await getPool().query(`
        ALTER TABLE videos
          ADD COLUMN IF NOT EXISTS thumbnail_text TEXT;
      `);
      // فاز ۳ — تست A/B عنوان/تامبنیل: هر ویدیو دو نسخه‌ی عنوان/متن تامبنیل
      // ذخیره می‌کنه؛ فقط نسخه‌ی A موقع آپلود واقعاً روی یوتیوب می‌ره (چون
      // Data API v3 هیچ endpoint عمومی‌ای برای split-test هم‌زمان نداره)،
      // نسخه‌ی B برای سوییچ دستی/بعدی (بر اساس CTR اولیه) نگه داشته می‌شه.
      await getPool().query(`
        ALTER TABLE videos
          ADD COLUMN IF NOT EXISTS title_a TEXT,
          ADD COLUMN IF NOT EXISTS title_b TEXT,
          ADD COLUMN IF NOT EXISTS thumbnail_text_a TEXT,
          ADD COLUMN IF NOT EXISTS thumbnail_text_b TEXT,
          ADD COLUMN IF NOT EXISTS active_variant TEXT DEFAULT 'A',
          ADD COLUMN IF NOT EXISTS variant_switched_at TIMESTAMPTZ;
      `);
      // فاز ۳ — پست‌های کامیونیتی: چون یوتیوب هیچ endpoint عمومی‌ای برای
      // پست کردن خودکار تو تب Community نداره، فقط پیش‌نویس (poll/quote)
      // تولیدشده با Groq رو اینجا نگه می‌داریم تا کاربر خودش دستی پیست کنه.
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS community_posts (
          id SERIAL PRIMARY KEY,
          video_id TEXT NOT NULL,
          post_type TEXT,
          post_text TEXT,
          poll_options JSONB,
          status TEXT DEFAULT 'draft',
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      // فاز ۳ — بازآفرینی شورت از یک ویدیوی بلند (بر اساس بازه‌ی
      // پربازدهی‌ترین نگه‌داشت مخاطب).
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS repurposed_shorts (
          id SERIAL PRIMARY KEY,
          source_video_id TEXT NOT NULL,
          short_video_id TEXT,
          start_sec NUMERIC,
          end_sec NUMERIC,
          retention_source TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      // فاز ۴ — زمان‌بندی خودکار: چون این پایپ‌لاین باید بدون هیچ نشست
      // مرورگرِ فعالی (نه NextAuth session، نه کوکی) بتونه آپلود کنه،
      // refresh_token گوگل رو (که با access_type=offline از قبل گرفته
      // می‌شه) اینجا هم ذخیره می‌کنیم، نه فقط تو کوکیِ رمزنگاری‌شده‌ی
      // NextAuth. یک ردیف ثابت (id=1) چون کل اپ تک‌کاربره/تک‌کاناله.
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS channel_auth (
          id INTEGER PRIMARY KEY DEFAULT 1,
          refresh_token TEXT,
          updated_at TIMESTAMPTZ DEFAULT now(),
          CONSTRAINT single_row CHECK (id = 1)
        );
      `);
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS schedules (
          id SERIAL PRIMARY KEY,
          video_mode TEXT NOT NULL,
          days_of_week INTEGER[] NOT NULL,
          time_of_day TEXT NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'Asia/Tehran',
          privacy_status TEXT NOT NULL DEFAULT 'public',
          enabled BOOLEAN NOT NULL DEFAULT true,
          last_run_date TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS schedule_runs (
          id SERIAL PRIMARY KEY,
          schedule_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          video_id TEXT,
          error TEXT,
          started_at TIMESTAMPTZ DEFAULT now(),
          finished_at TIMESTAMPTZ
        );
      `);

      // فاز ۵ — ارائه‌دهنده‌های API: کاربر یک اسم + کلید می‌ده، سیستم خودش
      // (با تست عملیِ چند endpoint شناخته‌شده) تشخیص می‌ده این کلید مال کدوم
      // سرویسه و چیکار می‌تونه بکنه (متن/عکس/ویدیو/صدا)، و کل پایپ‌لاین از
      // این جدول به‌جای مقادیر هاردکدِ env var می‌خونه. api_key رمزنگاری‌شده
      // (AES-256-GCM با کلیدی از NEXTAUTH_SECRET) ذخیره می‌شه؛ NULL یعنی
      // «از env var قدیمی استفاده کن» (ردیف‌های bootstrap) یا اصلاً کلید
      // لازم نداره (msedge-tts).
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS providers (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          service TEXT NOT NULL,
          api_key TEXT,
          capabilities TEXT[] NOT NULL DEFAULT '{}',
          enabled BOOLEAN NOT NULL DEFAULT true,
          built_in BOOLEAN NOT NULL DEFAULT false,
          last_check_ok BOOLEAN,
          last_check_message TEXT,
          last_checked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS provider_priority (
          task_type TEXT NOT NULL,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          priority INTEGER NOT NULL,
          PRIMARY KEY (task_type, provider_id)
        );
      `);
      // ۲۰۲۶-۰۸-۱۸ — بازسازیِ مسیر worker: قبلاً وضعیتِ jobها فقط تو یک
      // Map درون‌حافظه‌ای بود که با هر ری‌استارتِ سرور (رایج تو Render
      // free tier) کامل پاک می‌شد و بینِ چند instance هم به اشتراک
      // گذاشته نمی‌شد؛ حالا تو دیتابیس ماندگاره. worker خودش این جدول رو
      // نمی‌خونه/نمی‌نویسه (فقط در آخر یک callback HTTP می‌زنه)، فقط
      // وب‌اپ (dispatch و callback) باهاش کار داره.
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS worker_jobs (
          job_id TEXT PRIMARY KEY,
          job_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          input JSONB,
          result JSONB,
          error TEXT,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await ensureBuiltInProviders();
    })().catch((err) => {
      // اگه راه‌اندازیِ schema شکست بخوره، schemaReady رو null کن تا
      // درخواستِ بعدی از اول امتحان کنه — نه این‌که برای همیشه (تا
      // ری‌استارتِ کامل سرویس) با همین یک خطای قدیمی گیر کنه. دقیقاً
      // همین چیزی که باعث شد یک باگِ SQL کل سایت رو تا ری‌دیپلوی خراب نگه داره.
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

// ثبت خودکارِ provider های قدیمی (که تا الان env var هاردکد بودن) به‌عنوان
// ردیف‌های عادی تو همون جدول — تا هم چیزی برای دیپلوی‌های موجود خراب نشه،
// هم کاربر بتونه بعداً از همون صفحه‌ی مدیریت اولویتشون رو عوض کنه یا
// حذفشون کنه. idempotent: هر بار فقط اگه قبلاً ساخته نشده باشن اضافه می‌شن.
async function ensureBuiltInProviders() {
  await getPool().query(
    `INSERT INTO providers (name, service, api_key, capabilities, built_in)
     SELECT 'Groq (کلید قدیمی از env)', 'groq', NULL, ARRAY['text'], true
     WHERE $1::text IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM providers WHERE service = 'groq' AND built_in = true)`,
    [process.env.GROQ_API_KEY || null]
  );
  await getPool().query(
    `INSERT INTO providers (name, service, api_key, capabilities, built_in)
     SELECT 'Pexels (کلید قدیمی از env)', 'pexels', NULL, ARRAY['image','video'], true
     WHERE $1::text IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM providers WHERE service = 'pexels' AND built_in = true)`,
    [process.env.PEXELS_API_KEY || null]
  );
  await getPool().query(
    `INSERT INTO providers (name, service, api_key, capabilities, built_in)
     SELECT 'msedge-tts (رایگان، بدون کلید)', 'msedge-tts', NULL, ARRAY['audio'], true
     WHERE NOT EXISTS (SELECT 1 FROM providers WHERE service = 'msedge-tts' AND built_in = true)`
  );
}

// --- فاز ۵: ارائه‌دهنده‌های API ---

export async function listProviders() {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT id, name, service, capabilities, enabled, built_in,
            last_check_ok, last_check_message, last_checked_at, created_at,
            (api_key IS NOT NULL) AS has_custom_key
     FROM providers ORDER BY id ASC`
  );
  return res.rows;
}

export async function getProviderById(id) {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT id, name, service, api_key, capabilities, enabled, built_in FROM providers WHERE id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

export async function createProvider({ name, service, apiKey, capabilities, builtIn }) {
  await ensureSchema();
  const encrypted = apiKey ? encrypt(apiKey) : null;
  const res = await getPool().query(
    `INSERT INTO providers (name, service, api_key, capabilities, built_in)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, service, encrypted, capabilities || [], !!builtIn]
  );
  return res.rows[0].id;
}

export async function updateProvider(id, { name, service, apiKey, capabilities, enabled }) {
  await ensureSchema();
  const encrypted = apiKey ? encrypt(apiKey) : null;
  await getPool().query(
    `UPDATE providers SET
       name = COALESCE($2, name),
       service = COALESCE($3, service),
       api_key = COALESCE($4, api_key),
       capabilities = COALESCE($5, capabilities),
       enabled = COALESCE($6, enabled)
     WHERE id = $1`,
    [id, name || null, service || null, encrypted, capabilities || null, enabled ?? null]
  );
}

export async function deleteProvider(id) {
  await ensureSchema();
  await getPool().query(`DELETE FROM providers WHERE id = $1`, [id]);
}

export async function recordProviderCheck(id, { ok, message }) {
  await ensureSchema();
  await getPool().query(
    `UPDATE providers SET last_check_ok = $2, last_check_message = $3, last_checked_at = now() WHERE id = $1`,
    [id, !!ok, message || null]
  );
}

// provider های فعال و دارای یک قابلیت خاص، به ترتیب اولویتِ دستیِ کاربر
// (تنظیم‌نشده‌ها بعد از تنظیم‌شده‌ها، به ترتیب id). این تابع همون چیزیه که
// lib/providers/router.js صدا می‌زنه.
export async function getProvidersForCapability(taskType) {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT p.id, p.name, p.service, p.api_key, p.capabilities
     FROM providers p
     LEFT JOIN provider_priority pp ON pp.provider_id = p.id AND pp.task_type = $1
     WHERE p.enabled = true AND $1 = ANY(p.capabilities)
     ORDER BY COALESCE(pp.priority, 999999) ASC, p.id ASC`,
    [taskType]
  );
  return res.rows;
}

export async function getAllPriorities() {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT task_type, provider_id FROM provider_priority ORDER BY task_type, priority ASC`
  );
  const map = {};
  for (const row of res.rows) {
    if (!map[row.task_type]) map[row.task_type] = [];
    map[row.task_type].push(row.provider_id);
  }
  return map;
}

export async function setPriorityOrder(taskType, orderedProviderIds) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM provider_priority WHERE task_type = $1`, [taskType]);
    for (let i = 0; i < orderedProviderIds.length; i++) {
      await client.query(
        `INSERT INTO provider_priority (task_type, provider_id, priority) VALUES ($1, $2, $3)`,
        [taskType, orderedProviderIds[i], i]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getDbStatus() {
  if (!process.env.DATABASE_URL) {
    return { connected: false, error: "DATABASE_URL تنظیم نشده" };
  }
  try {
    await ensureSchema();
    const countRes = await getPool().query("SELECT COUNT(*) FROM videos");
    const lastRes = await getPool().query(
      "SELECT video_id, title, created_at FROM videos ORDER BY created_at DESC LIMIT 3"
    );
    return {
      connected: true,
      videoCount: parseInt(countRes.rows[0].count, 10),
      lastVideos: lastRes.rows,
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

export async function recordVideo({
  videoId,
  title,
  script,
  videoMode,
  useVideoClips,
  imageKeyword,
  thumbnailText,
  titleB,
  thumbnailTextB,
}) {
  try {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO videos
         (video_id, title, script, video_mode, use_video_clips, image_keyword,
          thumbnail_text, title_a, title_b, thumbnail_text_a, thumbnail_text_b, active_variant)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'A')`,
      [
        videoId,
        title || "",
        script || "",
        videoMode || "",
        !!useVideoClips,
        imageKeyword || "",
        thumbnailText || "",
        title || "",
        titleB || null,
        thumbnailText || "",
        thumbnailTextB || null,
      ]
    );
  } catch (err) {
    // ثبت آمار هیچ‌وقت نباید کل فرایند آپلود رو خراب کنه
    console.error("recordVideo failed:", err.message);
  }
}

// یک ویدیوی مشخص رو برای مصرف‌کننده‌هایی مثل پست کامیونیتی و بازآفرینی
// شورت برمی‌گردونه (به عنوان/اسکریپت نیاز دارن، نه کل لیست).
export async function getVideoByVideoId(videoId) {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT video_id, title, script, video_mode, title_a, title_b,
            thumbnail_text_a, thumbnail_text_b, active_variant
     FROM videos WHERE video_id = $1 LIMIT 1`,
    [videoId]
  );
  return res.rows[0] || null;
}

// سوییچ نسخه‌ی فعال عنوان/تامبنیل (A یا B). این جایگزینِ صادقانه‌ی
// "split test هم‌زمان" است — یوتیوب چنین چیزی رو از طریق API عمومی
// نمی‌ده، پس این یک سوییچ ترتیبی است: نسخه‌ی جدید واقعاً روی ویدیوی
// زنده (videos.update + thumbnails.set) اعمال می‌شه و از این لحظه به
// بعد سنجیده می‌شه.
export async function setActiveVariant(videoId, variant) {
  await ensureSchema();
  await getPool().query(
    `UPDATE videos SET active_variant = $2, variant_switched_at = now() WHERE video_id = $1`,
    [videoId, variant]
  );
}

export async function recordCommunityPost({ videoId, postType, postText, pollOptions }) {
  await ensureSchema();
  const res = await getPool().query(
    `INSERT INTO community_posts (video_id, post_type, post_text, poll_options, status)
     VALUES ($1, $2, $3, $4, 'draft') RETURNING id, created_at`,
    [videoId, postType || "quote", postText || "", JSON.stringify(pollOptions || null)]
  );
  return res.rows[0];
}

export async function getCommunityPostsForVideo(videoId) {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT id, post_type, post_text, poll_options, status, created_at
     FROM community_posts WHERE video_id = $1 ORDER BY created_at DESC`,
    [videoId]
  );
  return res.rows;
}

export async function recordRepurposedShort({
  sourceVideoId,
  shortVideoId,
  startSec,
  endSec,
  retentionSource,
}) {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO repurposed_shorts (source_video_id, short_video_id, start_sec, end_sec, retention_source)
     VALUES ($1, $2, $3, $4, $5)`,
    [sourceVideoId, shortVideoId || null, startSec, endSec, retentionSource]
  );
}

export async function getAllVideoIds() {
  await ensureSchema();
  const res = await getPool().query("SELECT DISTINCT video_id FROM videos");
  return res.rows.map((r) => r.video_id);
}

// برای صفحه‌ی «آنالیز کانال» — لیست کامل ویدیوها به‌همراه آمارشون.
export async function getAllVideos() {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT video_id, title, video_mode, use_video_clips, image_keyword,
            title_b, active_variant, variant_switched_at,
            views, subscribers_gained, likes, avg_view_duration_sec,
            retention_pct, thumbnail_impressions, thumbnail_ctr,
            stats_updated_at, created_at
     FROM videos
     ORDER BY created_at DESC
     LIMIT 200`
  );
  return res.rows;
}

export async function updateVideoStats(videoId, stats) {
  await ensureSchema();
  await getPool().query(
    `UPDATE videos
     SET views = $2, subscribers_gained = $3, likes = $4,
         avg_view_duration_sec = $5, retention_pct = $6,
         thumbnail_impressions = $7, thumbnail_ctr = $8,
         stats_updated_at = now()
     WHERE video_id = $1`,
    [
      videoId,
      stats.views ?? 0,
      stats.subscribersGained ?? 0,
      stats.likes ?? 0,
      stats.avgViewDurationSec ?? 0,
      stats.avgViewPercentage ?? 0,
      stats.thumbnailImpressions ?? 0,
      stats.thumbnailCtr ?? 0,
    ]
  );
}

// حلقه‌ی بازخورد: بهترین ویدیوهای قبلی از نظر نگه‌داشت مخاطب، تا تولید
// اسکریپت جدید از الگوهای موفق قبلی یاد بگیره. حداقل ۱۰ بازدید شرطه، تا
// یه ویدیوی تازه با ۱-۲ بازدید (که ممکنه خودِ صاحب کانال دیده باشه) بی‌جهت
// «بهترین» به‌حساب نیاد.
export async function getTopPerformingVideos(limit = 5) {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT title, script, video_mode, retention_pct, thumbnail_ctr, views
     FROM videos
     WHERE retention_pct IS NOT NULL AND retention_pct > 0 AND views >= 10
     ORDER BY retention_pct DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}

// --- فاز ۴: زمان‌بندی خودکار ---

// refresh_token گوگل رو ذخیره می‌کنه (هر بار کاربر لاگین می‌کنه، از
// authOptions.js صدا زده می‌شه). upsert روی همون ردیف ثابت id=1.
export async function saveRefreshToken(refreshToken) {
  if (!refreshToken) return; // گوگل همیشه refresh_token جدید برنمی‌گردونه؛ قدیمی رو دست‌نخورده نگه می‌داریم
  await ensureSchema();
  await getPool().query(
    `INSERT INTO channel_auth (id, refresh_token, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET refresh_token = $1, updated_at = now()`,
    [refreshToken]
  );
}

export async function getRefreshToken() {
  await ensureSchema();
  const res = await getPool().query(`SELECT refresh_token FROM channel_auth WHERE id = 1`);
  return res.rows[0]?.refresh_token || null;
}

export async function listSchedules() {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT id, video_mode, days_of_week, time_of_day, timezone, privacy_status,
            enabled, last_run_date, created_at
     FROM schedules ORDER BY created_at ASC`
  );
  return res.rows;
}

export async function createSchedule({
  videoMode,
  daysOfWeek,
  timeOfDay,
  timezone,
  privacyStatus,
}) {
  await ensureSchema();
  const res = await getPool().query(
    `INSERT INTO schedules (video_mode, days_of_week, time_of_day, timezone, privacy_status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [videoMode, daysOfWeek, timeOfDay, timezone || "Asia/Tehran", privacyStatus || "public"]
  );
  return res.rows[0];
}

export async function updateSchedule(id, { daysOfWeek, timeOfDay, timezone, privacyStatus, enabled }) {
  await ensureSchema();
  await getPool().query(
    `UPDATE schedules SET
       days_of_week = COALESCE($2, days_of_week),
       time_of_day = COALESCE($3, time_of_day),
       timezone = COALESCE($4, timezone),
       privacy_status = COALESCE($5, privacy_status),
       enabled = COALESCE($6, enabled)
     WHERE id = $1`,
    [id, daysOfWeek || null, timeOfDay || null, timezone || null, privacyStatus || null, enabled ?? null]
  );
}

export async function deleteSchedule(id) {
  await ensureSchema();
  await getPool().query(`DELETE FROM schedules WHERE id = $1`, [id]);
}

// claim کردنِ یک زمان‌بندی برای امروز — قبل از شروعِ واقعیِ رندر صدا زده
// می‌شه، تا اگه دو تا ping هم‌پوشان با هم برسن، دوبار اجرا نشه.
export async function markScheduleRan(id, dateStr) {
  await ensureSchema();
  await getPool().query(`UPDATE schedules SET last_run_date = $2 WHERE id = $1`, [id, dateStr]);
}

export async function startScheduleRun(scheduleId) {
  await ensureSchema();
  const res = await getPool().query(
    `INSERT INTO schedule_runs (schedule_id, status) VALUES ($1, 'running') RETURNING id`,
    [scheduleId]
  );
  return res.rows[0].id;
}

export async function finishScheduleRun(runId, { status, videoId, error }) {
  await ensureSchema();
  await getPool().query(
    `UPDATE schedule_runs SET status = $2, video_id = $3, error = $4, finished_at = now() WHERE id = $1`,
    [runId, status, videoId || null, error || null]
  );
}

export async function listRecentScheduleRuns(limit = 20) {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT id, schedule_id, status, video_id, error, started_at, finished_at
     FROM schedule_runs ORDER BY started_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

// ===================== worker_jobs (فاز بازسازیِ worker، ۲۰۲۶-۰۸-۱۸) =====================

export async function createWorkerJob({ jobId, jobType, input }) {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO worker_jobs (job_id, job_type, status, input) VALUES ($1, $2, 'queued', $3)
     ON CONFLICT (job_id) DO NOTHING`,
    [jobId, jobType, JSON.stringify(input || {})]
  );
}

export async function updateWorkerJob(jobId, { status, result, error }) {
  await ensureSchema();
  await getPool().query(
    `UPDATE worker_jobs
     SET status = COALESCE($2, status),
         result = COALESCE($3, result),
         error = COALESCE($4, error),
         updated_at = now()
     WHERE job_id = $1`,
    [jobId, status || null, result ? JSON.stringify(result) : null, error || null]
  );
}

export async function getWorkerJob(jobId) {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT job_id, job_type, status, input, result, error, created_at, updated_at
     FROM worker_jobs WHERE job_id = $1`,
    [jobId]
  );
  return res.rows[0] || null;
}

// jobهای «گیرکرده» — queued/processing که خیلی وقته آپدیت نشدن (مثلاً
// worker به‌خاطر یک کرشِ بدونِ callback هیچ‌وقت گزارش نداد) — برای
// نمایشِ هشدار تو UI، نه پاک‌سازیِ خودکار.
export async function listStaleWorkerJobs(olderThanMinutes = 30) {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT job_id, job_type, status, created_at, updated_at FROM worker_jobs
     WHERE status IN ('queued', 'processing') AND updated_at < now() - ($1 || ' minutes')::interval
     ORDER BY created_at DESC`,
    [olderThanMinutes]
  );
  return res.rows;
}