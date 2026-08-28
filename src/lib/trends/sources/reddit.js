// Reddit's read-only JSON endpoints (any listing URL + ".json") work
// without authentication for public subreddits — no API key needed, just
// a descriptive User-Agent (Reddit rate-limits/blocks the default one).

import { mapWithConcurrency } from '../utils.js';

const DEFAULT_SUBREDDITS = [
  'selfimprovement',
  'DecidingToBeBetter',
  'GetMotivated',
  'Mindfulness',
  'Stoicism',
  'getdisciplined',
  'productivity',
];

/**
 * Pulls this week's top posts from a curated set of niche subreddits.
 * Relevance is baked in by only reading from on-niche subreddits (same
 * philosophy as the Google Trends seed list) rather than searching all of
 * Reddit, which would need heavier query-building to stay on-topic.
 */
export async function fetchNicheHotPosts({
  subreddits = DEFAULT_SUBREDDITS,
  limit = 15,
  timeframe = 'week',
} = {}) {
  const perSubreddit = await mapWithConcurrency(subreddits, 4, async (sub) => {
    try {
      const url = `https://www.reddit.com/r/${sub}/top.json?t=${timeframe}&limit=${limit}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'mindful-path-trend-finder/1.0 (by /r/selfimprovement reader)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return (json?.data?.children || [])
        .map((child) => child.data)
        .filter((p) => p?.title)
        .map((p) => ({
          subreddit: sub,
          title: p.title,
          score: p.score ?? 0,
          numComments: p.num_comments ?? 0,
          createdAt: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null,
          url: p.permalink ? `https://reddit.com${p.permalink}` : null,
        }));
    } catch (err) {
      console.warn(`[trends:reddit] r/${sub} failed:`, err.message);
      return [];
    }
  });
  return perSubreddit.flat();
}
