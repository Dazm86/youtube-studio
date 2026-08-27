// Orchestrates the full Trend Finder pipeline:
//   Google Trends -> YouTube -> TikTok/Reddit -> News -> AI Analyzer
//   -> scoring -> top N above threshold -> saved as 'pending' for
//   human approval in the /trends UI.
//
// Mirrors this codebase's existing resilience philosophy: every source
// call already degrades gracefully on its own (see sources/*.js), and a
// failure in one candidate's deep-signal fetch or AI batch never aborts
// the whole scan — worst case that candidate gets neutral/heuristic
// scores instead of measured ones.

import { collectInitialCandidates, enrichCandidatesWithDeepSignals } from './candidates.js';
import { analyzeTopics } from './analyzer.js';
import { ensureTrendsSchema, createScanRow, finishScanRow, saveTrendTopics } from './db.js';

const MIN_SCORE = Number(process.env.TREND_MIN_SCORE || 75);
const TOP_N = Number(process.env.TREND_TOP_N || 20);

function computeTotal(t) {
  return (
    (t.scoreSearchGrowth || 0) +
    (t.scoreViewGrowth || 0) +
    (t.scoreFreshness || 0) +
    (t.scoreCompetition || 0) +
    (t.scoreShortsFit || 0) +
    (t.scoreLongFit || 0)
  );
}

/**
 * Runs one full trend scan end-to-end.
 * @param {object} opts
 * @param {(event: object) => void} opts.emit - progress callback, called
 *   with small JSON-serializable events; API routes forward these as
 *   NDJSON lines so the UI can show live stage-by-stage progress.
 */
export async function runTrendScan({ emit = () => {} } = {}) {
  await ensureTrendsSchema();
  const scanId = await createScanRow();
  emit({ stage: 'start', scanId });

  try {
    const initialCandidates = await collectInitialCandidates({ emit });
    emit({ stage: 'candidates_collected', count: initialCandidates.length });

    const enriched = await enrichCandidatesWithDeepSignals(initialCandidates, { emit });

    const analyzed = await analyzeTopics(enriched, { emit });

    const scored = analyzed
      .map((t) => ({ ...t, scoreTotal: computeTotal(t) }))
      .sort((a, b) => b.scoreTotal - a.scoreTotal);

    const qualifying = scored.filter((t) => t.scoreTotal >= MIN_SCORE).slice(0, TOP_N);

    await saveTrendTopics(scanId, qualifying);
    await finishScanRow(scanId, {
      status: 'completed',
      topicsFound: qualifying.length,
      candidatesConsidered: scored.length,
    });

    emit({
      stage: 'done',
      scanId,
      candidatesConsidered: scored.length,
      topicsFound: qualifying.length,
      minScore: MIN_SCORE,
    });

    return { scanId, candidatesConsidered: scored.length, topics: qualifying };
  } catch (err) {
    const message = String(err?.message || err);
    await finishScanRow(scanId, { status: 'failed', error: message }).catch(() => {});
    emit({ stage: 'error', message });
    throw err;
  }
}
