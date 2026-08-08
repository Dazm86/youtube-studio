import { Pool } from "pg";

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
    })();
  }
  await schemaReady;
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
