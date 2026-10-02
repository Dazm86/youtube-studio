// ۲۰۲۶-۱۰-۰۱ — صفِ «ایده‌هایِ من»: ایده‌هایی که صاحبِ کانال دستی وارد می‌کنه و
// آپلودِ خودکار (scheduler) و «ساختِ کاملاً خودکار» اول از این صف برمی‌دارن،
// قبل از Trend Finder یا انتخابِ موضوع توسطِ خودِ AI.
//
// مثلِ lib/trends/db.js یک pool کوچکِ مستقل (db/index.js فقط تابع‌هایِ
// کوئری‌اش رو export می‌کنه، نه pool/ensureSchema رو).
//
// وضعیت‌ها: pending (منتظرِ نوبت) → used (ازش ویدیو ساخته شد، video_id ثبت می‌شه)
//          | skipped (کاربر کنارش گذاشت؛ می‌تونه دوباره pending بشه)
import pg from "pg";
import { validateIdeaInput } from "./pick.js";

const { Pool } = pg;

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
    });
  }
  return pool;
}

let schemaReady = false;
export async function ensureIdeasSchema() {
  if (schemaReady) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS user_ideas (
      id SERIAL PRIMARY KEY,
      idea TEXT NOT NULL,
      notes TEXT,
      format TEXT NOT NULL DEFAULT 'both',
      status TEXT NOT NULL DEFAULT 'pending',
      video_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      used_at TIMESTAMPTZ,
      claimed_at TIMESTAMPTZ
    );
  `);
  await getPool().query(`CREATE INDEX IF NOT EXISTS user_ideas_status_idx ON user_ideas(status, created_at);`);
  schemaReady = true;
}

export async function addIdea(input) {
  const v = validateIdeaInput(input);
  if (!v.ok) throw new Error(v.error);
  await ensureIdeasSchema();
  const { rows } = await getPool().query(
    `INSERT INTO user_ideas (idea, notes, format) VALUES ($1, $2, $3) RETURNING *`,
    [v.value.idea, v.value.notes || null, v.value.format]
  );
  return rows[0];
}

export async function listIdeas({ status } = {}) {
  await ensureIdeasSchema();
  const params = [];
  let where = "";
  if (status) {
    params.push(status);
    where = "WHERE status = $1";
  }
  // در انتظارها به ترتیبِ ورود (اولی‌ها اول ساخته می‌شن)، بقیه جدیدترین اول
  const order = status === "pending" ? "created_at ASC, id ASC" : "created_at DESC, id DESC";
  const { rows } = await getPool().query(`SELECT * FROM user_ideas ${where} ORDER BY ${order} LIMIT 300`, params);
  return rows;
}

export async function updateIdeaStatus(id, status) {
  await ensureIdeasSchema();
  const { rows } = await getPool().query(
    `UPDATE user_ideas SET status = $2::text,
       video_id = CASE WHEN $2::text = 'pending' THEN NULL ELSE video_id END,
       used_at = CASE WHEN $2::text = 'pending' THEN NULL ELSE used_at END,
       claimed_at = CASE WHEN $2::text = 'pending' THEN NULL ELSE claimed_at END
     WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return rows[0] || null;
}

export async function deleteIdea(id) {
  await ensureIdeasSchema();
  const { rowCount } = await getPool().query(`DELETE FROM user_ideas WHERE id = $1`, [id]);
  return rowCount > 0;
}

// «ادعایِ» اتمیک: اولین ایده‌ی pending که به این نوعِ ویدیو می‌خوره رو برمی‌داره
// و همون لحظه وضعیتش رو 'in_progress' می‌کنه (FOR UPDATE SKIP LOCKED) تا اگه دو
// اجرای هم‌زمان (مثلاً زمان‌بندیِ شورت و لانگ، یا دو ping) هم‌زمان بیان، هر
// دو یک ایده رو برنندارن. اگه تولید شکست بخوره releaseIdea برش می‌گردونه.
export async function claimNextIdea(mode) {
  await ensureIdeasSchema();
  await releaseStaleIdeas().catch((err) => console.error("releaseStaleIdeas failed:", err.message));
  const modes = mode === "short" || mode === "long" ? ["both", mode] : ["both", "long", "short"];
  const { rows } = await getPool().query(
    `UPDATE user_ideas SET status = 'in_progress', claimed_at = now()
     WHERE id = (
       SELECT id FROM user_ideas
       WHERE status = 'pending' AND format = ANY($1::text[])
       ORDER BY created_at ASC, id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [modes]
  );
  return rows[0] || null;
}

export async function markIdeaUsed(id, videoId) {
  await ensureIdeasSchema();
  const { rows } = await getPool().query(
    `UPDATE user_ideas SET status = 'used', video_id = $2::text, used_at = now() WHERE id = $1 RETURNING *`,
    [id, videoId || null]
  );
  return rows[0] || null;
}

// تولید شکست خورد → ایده به صف برمی‌گرده، چیزی از دست نمی‌ره.
export async function releaseIdea(id) {
  await ensureIdeasSchema();
  await getPool().query(`UPDATE user_ideas SET status = 'pending' WHERE id = $1 AND status = 'in_progress'`, [id]);
}

// ایده‌هایی که بیش از ۲ ساعت «در حال تولید» مونده‌ان (مثلاً سرور وسطِ کار
// ری‌استارت شده) به صف برمی‌گردن — وگرنه برای همیشه گم می‌شدن. (۲ ساعت > حداکثرِ
// زمانِ یک تولید: PIPELINE_TIMEOUT_MS ۲۵ دقیقه، worker ۴۵ دقیقه.)
export async function releaseStaleIdeas() {
  await ensureIdeasSchema();
  const { rowCount } = await getPool().query(
    `UPDATE user_ideas SET status = 'pending', claimed_at = NULL
     WHERE status = 'in_progress' AND claimed_at < now() - interval '2 hours'`
  );
  return rowCount;
}
