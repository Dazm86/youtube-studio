// Deliberately a SEPARATE, self-contained `pg` pool from lib/db/index.js
// rather than importing its pool/ensureSchema — that file wasn't shared in
// this session, so guessing at its export shape here risked breaking both
// modules. This is safe to run alongside it (Postgres handles multiple
// pools against the same DATABASE_URL fine) and costs nothing but one
// extra small connection pool.
//
// If you'd rather have a single shared pool, once you share lib/db/
// index.js this file can be trimmed to just re-export its pool — nothing
// else in the Trend Finder feature needs to change.

import pg from 'pg';

const { Pool } = pg;

let pool;
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    pool = new Pool({
      connectionString,
      ssl: connectionString && !connectionString.includes('localhost') ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

let schemaReady = false;
export async function ensureTrendsSchema() {
  if (schemaReady) return;
  const client = getPool();
  await client.query(`
    CREATE TABLE IF NOT EXISTS trend_scans (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'running',
      topics_found INTEGER DEFAULT 0,
      candidates_considered INTEGER DEFAULT 0,
      error TEXT
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS trend_topics (
      id SERIAL PRIMARY KEY,
      scan_id INTEGER REFERENCES trend_scans(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      angle TEXT,
      suggested_format TEXT,
      score_search_growth NUMERIC,
      score_view_growth NUMERIC,
      score_freshness NUMERIC,
      score_competition NUMERIC,
      score_shorts_fit NUMERIC,
      score_long_fit NUMERIC,
      score_total NUMERIC NOT NULL,
      reasoning TEXT,
      source_signals JSONB,
      status TEXT NOT NULL DEFAULT 'pending',
      video_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS trend_topics_status_idx ON trend_topics(status);`);
  await client.query(`CREATE INDEX IF NOT EXISTS trend_topics_score_idx ON trend_topics(score_total DESC);`);
  schemaReady = true;
}

export async function createScanRow() {
  const { rows } = await getPool().query(
    `INSERT INTO trend_scans (status) VALUES ('running') RETURNING id`
  );
  return rows[0].id;
}

export async function finishScanRow(scanId, { status, topicsFound = 0, candidatesConsidered = 0, error = null }) {
  await getPool().query(
    `UPDATE trend_scans
     SET status = $2, finished_at = now(), topics_found = $3, candidates_considered = $4, error = $5
     WHERE id = $1`,
    [scanId, status, topicsFound, candidatesConsidered, error]
  );
}

export async function saveTrendTopics(scanId, topics) {
  const client = getPool();
  for (const t of topics) {
    await client.query(
      `INSERT INTO trend_topics
        (scan_id, topic, angle, suggested_format,
         score_search_growth, score_view_growth, score_freshness, score_competition,
         score_shorts_fit, score_long_fit, score_total, reasoning, source_signals)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        scanId,
        t.finalTopic || t.topic,
        t.angle || null,
        t.suggestedFormat || 'both',
        t.scoreSearchGrowth,
        t.scoreViewGrowth,
        t.scoreFreshness,
        t.scoreCompetition,
        t.scoreShortsFit,
        t.scoreLongFit,
        t.scoreTotal,
        t.reasoning || null,
        JSON.stringify({
          seed: t.seed || null,
          trendsRelated: t.signals?.trendsRelated || [],
          reddit: t.signals?.reddit || [],
          news: t.signals?.news || [],
          youtubeTotalResults: t.youtubeTotalResults ?? null,
          topYoutubeVideos: (t.youtubeItems || []).slice(0, 3),
        }),
      ]
    );
  }
}

export async function listTrendTopics({ status, minScore, limit = 50 } = {}) {
  const conditions = [];
  const params = [];
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (minScore !== undefined && minScore !== null) {
    params.push(minScore);
    conditions.push(`score_total >= $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await getPool().query(
    `SELECT * FROM trend_topics ${where} ORDER BY score_total DESC, created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function getLatestScan() {
  const { rows } = await getPool().query(
    `SELECT * FROM trend_scans ORDER BY started_at DESC LIMIT 1`
  );
  return rows[0] || null;
}

export async function updateTrendTopicStatus(id, status) {
  const { rows } = await getPool().query(
    `UPDATE trend_topics SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return rows[0] || null;
}

// ===================== تولید کاملاً خودکار (۲۰۲۶-۰۸-۲۷) =====================
// این سه تابع برای دکمه‌ی «تولید کاملاً خودکار» هستن — انتخابِ خودکارِ
// بهترین موضوعِ approve‌شده به‌جای این‌که کاربر دستی از /trends انتخاب
// کنه و کپی/پیست کنه تو فرم.

// یک UPDATE اتمیک با یک زیرکوئریِ SELECT ... FOR UPDATE SKIP LOCKED:
// بهترین موضوعِ approve‌شده (بالاترین score_total) که با این mode
// سازگاره رو "claim" می‌کنه (status رو می‌بره رو 'producing') در یک
// رفت‌وبرگشتِ واحد به دیتابیس — یعنی اگه دو اجرای هم‌زمان (مثلاً کاربر
// دوبار دکمه رو بزنه) همین لحظه این تابع رو صدا بزنن، هرکدوم یک ردیفِ
// متفاوت می‌گیرن (یا اگه فقط یکی مونده، دومی null می‌گیره)، نه این‌که
// هر دو یک ویدیو رو از رویِ یک موضوع بسازن. 'producing' یک وضعیتِ
// داخلیه (نه یکی از ALLOWED_STATUSES تو api/trends/[id]/route.js) — تو
// UI فقط به‌شکلِ «بدونِ دکمه‌ی عمل» دیده می‌شه، مشکلی نیست.
export async function claimNextApprovedTopic(mode) {
  const { rows } = await getPool().query(
    `UPDATE trend_topics
     SET status = 'producing', updated_at = now()
     WHERE id = (
       SELECT id FROM trend_topics
       WHERE status = 'approved' AND suggested_format IN ('both', $1)
       ORDER BY score_total DESC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [mode]
  );
  return rows[0] || null;
}

// موفقیت: وضعیت نهایی 'produced' + videoId واقعی که آپلود شد.
export async function markTrendTopicProduced(id, videoId) {
  const { rows } = await getPool().query(
    `UPDATE trend_topics SET status = 'produced', video_id = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, videoId]
  );
  return rows[0] || null;
}

// شکست (مثلاً پایپ‌لاین وسط راه خطا داد): موضوع رو برمی‌گردونه به
// 'approved' تا دفعه‌ی بعد دوباره قابلِ انتخاب باشه، به‌جای این‌که برای
// همیشه تو حالتِ 'producing' گیر بمونه.
export async function releaseTrendTopicClaim(id) {
  const { rows } = await getPool().query(
    `UPDATE trend_topics SET status = 'approved', updated_at = now() WHERE id = $1 AND status = 'producing' RETURNING *`,
    [id]
  );
  return rows[0] || null;
}
