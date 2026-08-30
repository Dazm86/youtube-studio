// بخشِ گزارش/فعالیتِ سایت — یک فیدِ ساده و متمرکز از «هر اتفاقی که تو
// سایت میفته»: آپلود ویدیو (موفق/ناموفق)، اسکنِ Trend Finder، اجرای
// زمان‌بندیِ خودکار، repurpose، پستِ کامیونیتی. از ۲۰۲۶-۰۸-۳۰ به بعد
// هر رویداد، در کنارِ ثبت تو دیتابیس، اگه تلگرام/دیسکورد تنظیم شده
// باشن، به‌صورتِ آنی هم اطلاع‌رسانی می‌شه — چون auto-produce بدونِ
// نظارتِ انسانی کار می‌کنه، چک‌کردنِ دستیِ `/activity` کافی نیست.
//
// سه تصمیمِ طراحیِ مهم:
// 1. مثلِ trends/db.js، یک pool کوچیکِ جدا از lib/db/index.js — چون اون
//    فایل pool/ensureSchema رو export نمی‌کنه (فقط تابع‌های خودش رو)، و
//    این یک فیچرِ کاملاً جانبیه که نباید ریسکی به مسیرهای اصلیِ دیتابیس
//    اضافه کنه.
// 2. logEvent() هرگز throw نمی‌کنه — دقیقاً همون فلسفه‌ی notifyWebhook تو
//    pipeline.js. این تابع قراره از وسطِ مسیرهای حیاتی (بعد از آپلودِ
//    موفقِ یک ویدیو، مثلاً) صدا زده بشه؛ اگه خودِ لاگ‌کردن به هر دلیلی
//    (DB قطع، تلگرام در دسترس نبود، و غیره) شکست بخوره، نباید نتیجه‌ی
//    کاری که داره لاگ می‌شه رو خراب کنه یا حتی کاربر رو نگران کنه —
//    فقط تو کنسول لاگ می‌شه.
// 3. ثبتِ دیتابیس و اطلاع‌رسانی کاملاً مستقلن (Promise.allSettled) —
//    اگه DB قطع باشه ولی تلگرام تنظیم شده باشه، پیام بازم می‌ره؛ برعکسش
//    هم همین‌طور.

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

async function saveToDb({ type, message, metadata }) {
  try {
    await ensureActivityLogSchema();
    await getPool().query(`INSERT INTO activity_log (type, message, metadata) VALUES ($1, $2, $3)`, [
      type,
      message,
      metadata ? JSON.stringify(metadata) : null,
    ]);
  } catch (err) {
    console.error("activityLog: ثبت تو دیتابیس شکست خورد (نادیده گرفته می‌شه):", err.message);
  }
}

const TYPE_EMOJI = {
  video_uploaded: "🎬",
  video_failed: "❌",
  trend_scan_completed: "📈",
  trend_scan_failed: "📈",
  schedule_triggered: "⏰",
  repurpose_completed: "♻️",
  community_post_created: "💬",
  script_review_flagged: "📝",
};

async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`activityLog: تلگرام HTTP ${res.status} (نادیده گرفته می‌شه): ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("activityLog: ارسالِ تلگرام شکست خورد (نادیده گرفته می‌شه):", err.message);
  }
}

async function notifyDiscord(text) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`activityLog: دیسکورد HTTP ${res.status} (نادیده گرفته می‌شه): ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("activityLog: ارسالِ دیسکورد شکست خورد (نادیده گرفته می‌شه):", err.message);
  }
}

function isTypeAllowed(type) {
  // ACTIVITY_NOTIFY_TYPES: لیستِ اختیاریِ کاما-جدا (مثلاً
  // "video_uploaded,video_failed") برایِ محدودکردنِ اطلاع‌رسانی به یک
  // زیرمجموعه — تنظیم‌نشده یعنی همه‌چیز اطلاع داده می‌شه.
  const filter = process.env.ACTIVITY_NOTIFY_TYPES;
  if (!filter || !filter.trim()) return true;
  const allowed = filter.split(",").map((s) => s.trim());
  return allowed.includes(type);
}

async function sendNotifications({ type, message }) {
  if (!isTypeAllowed(type)) return;
  const text = `${TYPE_EMOJI[type] || "•"} ${message}`;
  await Promise.allSettled([notifyTelegram(text), notifyDiscord(text)]);
}

/**
 * ثبتِ یک اتفاق. هیچ‌وقت throw نمی‌کنه — صدازننده هیچ‌وقت لازم نیست
 * try/catch دورش بذاره یا نتیجه‌ش رو await کنه (fire-and-forget امنه).
 * ثبتِ دیتابیس و اطلاع‌رسانیِ تلگرام/دیسکورد مستقلن؛ شکستِ یکی مانعِ
 * اون یکی نمی‌شه.
 *
 * @param {object} event
 * @param {string} event.type - مثلاً 'video_uploaded', 'video_failed',
 *   'trend_scan_completed', 'trend_scan_failed', 'schedule_triggered',
 *   'repurpose_completed', 'community_post_created', 'script_review_flagged'
 * @param {string} event.message - متنِ فارسیِ آماده برای نمایش
 * @param {object} [event.metadata] - جزئیاتِ اضافه (videoId, mode, ...)
 */
export async function logEvent({ type, message, metadata }) {
  await Promise.allSettled([saveToDb({ type, message, metadata }), sendNotifications({ type, message })]);
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
