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
