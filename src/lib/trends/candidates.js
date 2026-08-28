import { fetchRelatedQueries, fetchInterestOverTime } from './sources/googleTrends.js';
import { fetchNicheHotPosts } from './sources/reddit.js';
import { fetchNewsForKeyword } from './sources/news.js';
import { fetchTikTokSignal } from './sources/tiktok.js';
import { searchRecentVideos } from './sources/youtube.js';
import { getSeedKeywords } from './seeds.js';
import { scoreSearchGrowth, scoreViewGrowth, scoreFreshness, scoreCompetition } from './scoring.js';
import { mapWithConcurrency } from './utils.js';

const MAX_CANDIDATES = Number(process.env.TREND_MAX_CANDIDATES || 25);
// Every external source already degrades to an empty/neutral result on its
// own failure (see sources/*.js), so running several in flight at once is
// safe — a slow/broken one just delays its own slot, not the whole batch.
const CONCURRENCY = Number(process.env.TREND_FETCH_CONCURRENCY || 4);

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cheapRankValue(entry) {
  // Rough pre-filter score used only to decide which candidates are worth
  // the expensive per-topic calls (Trends interest-over-time + YouTube),
  // NOT the real rubric score. Combines whatever raw signals we already
  // have for free from the collection stage.
  let v = 0;
  for (const t of entry.signals.trendsRelated || []) v += Number(t.value) || 1;
  for (const r of entry.signals.reddit || []) v += (r.score || 0) / 20 + (r.numComments || 0) / 10;
  v += (entry.signals.news?.length || 0) * 5;
  return v;
}

/**
 * Stage 1 (Google Trends + TikTok/Reddit + News in the user-facing
 * progress feed): builds a niche-scoped candidate pool from related/rising
 * Trends queries per seed, niche subreddit hot posts, and per-seed news
 * headlines, dedupes them, cheaply ranks, and caps to MAX_CANDIDATES
 * before anything expensive runs. Seed-level calls run CONCURRENCY at a
 * time rather than one after another.
 */
export async function collectInitialCandidates({ emit = () => {} } = {}) {
  const seeds = getSeedKeywords();
  const candidateMap = new Map();

  emit({ stage: 'google_trends', status: 'running', progress: `0/${seeds.length} seeds` });
  const trendsResults = await mapWithConcurrency(seeds, CONCURRENCY, async (seed, i) => {
    const result = await fetchRelatedQueries(seed);
    emit({ stage: 'google_trends', status: 'running', progress: `${i + 1}/${seeds.length} seeds` });
    return result;
  });
  seeds.forEach((seed, i) => {
    const { rising, top } = trendsResults[i];
    for (const r of [...rising, ...top.slice(0, 5)]) {
      const key = normalize(r.query);
      if (!key) continue;
      const entry = candidateMap.get(key) || { topic: r.query, seed, signals: {} };
      entry.signals.trendsRelated = entry.signals.trendsRelated || [];
      entry.signals.trendsRelated.push({ value: r.value, fromSeed: seed });
      candidateMap.set(key, entry);
    }
  });
  emit({ stage: 'google_trends', status: 'done', count: candidateMap.size });

  emit({ stage: 'tiktok_reddit', status: 'running' });
  const redditPosts = await fetchNicheHotPosts();
  for (const p of redditPosts) {
    const key = normalize(p.title);
    if (!key) continue;
    const entry = candidateMap.get(key) || { topic: p.title, signals: {} };
    entry.signals.reddit = entry.signals.reddit || [];
    entry.signals.reddit.push(p);
    candidateMap.set(key, entry);
  }
  // TikTok: deliberate no-op stub today (see sources/tiktok.js) — called
  // here so it's automatically picked up the day a real adapter exists.
  await fetchTikTokSignal(null);
  emit({ stage: 'tiktok_reddit', status: 'done', count: redditPosts.length });

  emit({ stage: 'news', status: 'running', progress: `0/${seeds.length} seeds` });
  const newsResults = await mapWithConcurrency(seeds, CONCURRENCY, async (seed, i) => {
    const items = await fetchNewsForKeyword(seed);
    emit({ stage: 'news', status: 'running', progress: `${i + 1}/${seeds.length} seeds` });
    return items;
  });
  seeds.forEach((seed, i) => {
    for (const n of newsResults[i].slice(0, 5)) {
      const key = normalize(n.title);
      if (!key) continue;
      const entry = candidateMap.get(key) || { topic: n.title, seed, signals: {} };
      entry.signals.news = entry.signals.news || [];
      entry.signals.news.push(n);
      candidateMap.set(key, entry);
    }
  });
  emit({ stage: 'news', status: 'done', count: candidateMap.size });

  const ranked = Array.from(candidateMap.values()).sort((a, b) => cheapRankValue(b) - cheapRankValue(a));
  return ranked.slice(0, MAX_CANDIDATES);
}

/**
 * Stage 2: for each surviving candidate, fetches the expensive per-topic
 * signals (Trends interest-over-time, YouTube competition/view-velocity)
 * and computes the 4 deterministic rubric scores from scoring.js.
 * Candidates are processed CONCURRENCY at a time.
 */
export async function enrichCandidatesWithDeepSignals(candidates, { emit = () => {} } = {}) {
  let completed = 0;
  const enriched = await mapWithConcurrency(candidates, CONCURRENCY, async (c) => {
    const [interestSeries, youtubeResult] = await Promise.all([
      fetchInterestOverTime(c.topic),
      searchRecentVideos(c.topic),
    ]);
    completed++;
    emit({ stage: 'google_trends', status: 'running', progress: `signals ${completed}/${candidates.length}` });
    emit({ stage: 'youtube', status: 'running', progress: `${completed}/${candidates.length}` });

    return {
      ...c,
      interestSeries,
      youtubeItems: youtubeResult.items,
      youtubeTotalResults: youtubeResult.totalResults,
      scoreSearchGrowth: scoreSearchGrowth(interestSeries),
      scoreViewGrowth: scoreViewGrowth(youtubeResult.items),
      scoreFreshness: scoreFreshness(interestSeries),
      scoreCompetition: scoreCompetition(youtubeResult.totalResults),
    };
  });
  emit({ stage: 'youtube', status: 'done', count: enriched.length });
  return enriched;
}
