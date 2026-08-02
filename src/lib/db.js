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
    schemaReady = getPool().query(`
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
}) {
  try {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO videos (video_id, title, script, video_mode, use_video_clips, image_keyword)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [videoId, title || "", script || "", videoMode || "", !!useVideoClips, imageKeyword || ""]
    );
  } catch (err) {
    // ثبت آمار هیچ‌وقت نباید کل فرایند آپلود رو خراب کنه
    console.error("recordVideo failed:", err.message);
  }
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
         avg_view_duration_sec = $5, stats_updated_at = now()
     WHERE video_id = $1`,
    [
      videoId,
      stats.views ?? 0,
      stats.subscribersGained ?? 0,
      stats.likes ?? 0,
      stats.avgViewDurationSec ?? 0,
    ]
  );
}
