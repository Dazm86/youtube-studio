// A SEPARATE, self-contained `pg` pool from lib/db/index.js rather than
// sharing its pool. Originally this was a guess (lib/db/index.js wasn't
// available); now that it's been reviewed directly (2026-08-28): its pool
// and ensureSchema() aren't exported, only its ~30 specific query
// functions are, so "sharing" it would mean adding new exports to that
// file rather than just importing an existing one. Given how central
// db/index.js is (providers, videos, schedules, worker jobs all go
// through it), a second small pool against the same DATABASE_URL is the
// lower-risk choice — Postgres handles multiple pools against one
// connection string fine, and it keeps every trends-schema change
// contained to this one file.

import pg from 'pg';

const { Pool } = pg;

let pool;
function getPool() {
  if (!pool) {
    // Matches lib/db/index.js's own Pool config exactly (verified
    // 2026-08-28), rather than the "skip ssl if the string contains
    // localhost" heuristic this file used before that file was available.
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
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

export async function getTrendTopicById(id) {
  const { rows } = await getPool().query(`SELECT * FROM trend_topics WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Called by lib/autoProduce.js once a video actually uploads successfully
// for a topic that came from the Trend Finder queue — closes the loop so
// the /trends list shows it's already been made into a video, not still
// sitting there as "approved" forever.
export async function markTrendTopicProduced(id, videoId) {
  const { rows } = await getPool().query(
    `UPDATE trend_topics SET status = 'produced', video_id = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, videoId]
  );
  return rows[0] || null;
}
