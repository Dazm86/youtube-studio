// بخشِ گزارش/فعالیتِ سایت — یک فیدِ ساده و متمرکز از «هر اتفاقی که تو
// سایت میفته»: آپلود ویدیو (موفق/ناموفق)، اسکنِ Trend Finder، اجرای
// زمان‌بندیِ خودکار، repurpose، پستِ کامیونیتی.
//
// دو تصمیمِ طراحیِ مهم:
// 1. مثلِ trends/db.js، یک pool کوچیکِ جدا از lib/db/index.js — چون اون
//    فایل pool/ensureSchema رو export نمی‌کنه (فقط تابع‌های خودش رو)، و
//    این یک فیچرِ کاملاً جانبیه که نباید ریسکی به مسیرهای اصلیِ دیتابیس
//    اضافه کنه.
// 2. logEvent() هرگز throw نمی‌کنه — دقیقاً همون فلسفه‌ی notifyWebhook تو
//    pipeline.js. این تابع قراره از وسطِ مسیرهای حیاتی (بعد از آپلودِ
//    موفقِ یک ویدیو، مثلاً) صدا زده بشه؛ اگه خودِ لاگ‌کردن به هر دلیلی
//    (DB قطع، و غیره) شکست بخوره، نباید نتیجه‌ی کاری که داره لاگ می‌شه
//    رو خراب کنه یا حتی کاربر رو نگران کنه — فقط تو کنسول لاگ می‌شه.

import pg from "pg";

const { Pool } = pg;

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

let schemaReady = false;
async function ensureActivityLogSchema() {
  if (schemaReady) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await getPool().query(`CREATE INDEX IF NOT EXISTS activity_log_created_idx ON activity_log(created_at DESC);`);
  schemaReady = true;
}

/**
 * ثبتِ یک اتفاق. هیچ‌وقت throw نمی‌کنه — صدازننده هیچ‌وقت لازم نیست
 * try/catch دورش بذاره یا نتیجه‌ش رو await کنه (fire-and-forget امنه).
 *
 * @param {object} event
 * @param {string} event.type - مثلاً 'video_uploaded', 'video_failed',
 *   'trend_scan_completed', 'trend_scan_failed', 'schedule_triggered',
 *   'repurpose_completed', 'community_post_created'
 * @param {string} event.message - متنِ فارسیِ آماده برای نمایش
 * @param {object} [event.metadata] - جزئیاتِ اضافه (videoId, mode, ...)
 */
export async function logEvent({ type, message, metadata }) {
  try {
    await ensureActivityLogSchema();
    await getPool().query(`INSERT INTO activity_log (type, message, metadata) VALUES ($1, $2, $3)`, [
      type,
      message,
      metadata ? JSON.stringify(metadata) : null,
    ]);
  } catch (err) {
    console.error("logEvent شکست خورد (نادیده گرفته می‌شه):", err.message);
  }
}

export async function listRecentEvents({ limit = 50, type } = {}) {
  await ensureActivityLogSchema();
  const params = [];
  let where = "";
  if (type) {
    params.push(type);
    where = `WHERE type = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await getPool().query(
    `SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}
