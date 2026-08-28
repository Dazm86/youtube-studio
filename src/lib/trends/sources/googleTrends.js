// Google Trends has no official public API. This talks to the same
// undocumented endpoints trends.google.com's own frontend uses (the
// approach every open-source "google-trends-api" style library takes).
// Same caveat as msedge-tts elsewhere in this project: it's an unofficial
// integration against a service that can change shape without notice.
// Every function here degrades to an empty/neutral result on failure
// instead of throwing, so one broken endpoint never kills the scan.

const TRENDS_BASE = 'https://trends.google.com/trends/api';

function stripXssiPrefix(text) {
  // Google prefixes these JSON responses with ")]}',\n" to prevent naive
  // <script src> JSON hijacking. Has to be stripped before JSON.parse.
  return text.replace(/^\)\]\}',?\n?/, '');
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MindfulPathTrendFinder/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const raw = await res.text();
  return JSON.parse(stripXssiPrefix(raw));
}

/**
 * Global daily trending searches. Mostly off-niche noise (used only as a
 * light bonus signal, not the primary candidate source — see seeds.js).
 */
export async function fetchDailyTrends({ geo = 'US', hl = 'en-US' } = {}) {
  try {
    const url = `${TRENDS_BASE}/dailytrends?hl=${hl}&geo=${geo}&ns=15`;
    const json = await fetchJson(url);
    const days = json?.default?.trendingSearchesDays || [];
    const items = [];
    for (const day of days) {
      for (const t of day.trendingSearches || []) {
        items.push({
          title: t.title?.query,
          traffic: t.formattedTraffic,
          relatedQueries: (t.relatedQueries || []).map((q) => q.query),
        });
      }
    }
    return items;
  } catch (err) {
    console.warn('[trends:googleTrends] fetchDailyTrends failed:', err.message);
    return [];
  }
}

async function getExploreWidgets(keyword, { geo, hl, timeRange }) {
  const req = {
    comparisonItem: [{ keyword, geo, time: timeRange }],
    category: 0,
    property: '',
  };
  const url = `${TRENDS_BASE}/explore?hl=${hl}&tz=0&req=${encodeURIComponent(JSON.stringify(req))}`;
  const json = await fetchJson(url);
  return json.widgets || [];
}

/**
 * Related + rising queries for one seed keyword — the main candidate-topic
 * source. "rising" is the important one: queries with a recently sharp
 * increase near this seed, which is exactly the "growing but maybe not
 * saturated yet" signal this feature is built around.
 */
export async function fetchRelatedQueries(
  keyword,
  { geo = 'US', hl = 'en-US', timeRange = 'today 1-m' } = {}
) {
  try {
    const widgets = await getExploreWidgets(keyword, { geo, hl, timeRange });
    const widget = widgets.find((w) => w.id === 'RELATED_QUERIES');
    if (!widget) return { rising: [], top: [] };
    const dataUrl = `${TRENDS_BASE}/widgetdata/relatedsearches?hl=${hl}&tz=0&req=${encodeURIComponent(
      JSON.stringify(widget.request)
    )}&token=${widget.token}`;
    const dataJson = await fetchJson(dataUrl);
    const rankedLists = dataJson?.default?.rankedList || [];
    const top = (rankedLists[0]?.rankedKeyword || []).map((k) => ({ query: k.query, value: k.value }));
    const rising = (rankedLists[1]?.rankedKeyword || []).map((k) => ({ query: k.query, value: k.value }));
    return { rising, top };
  } catch (err) {
    console.warn(`[trends:googleTrends] fetchRelatedQueries("${keyword}") failed:`, err.message);
    return { rising: [], top: [] };
  }
}

/**
 * Interest-over-time series for one exact keyword (0-100 relative scale).
 * Used to compute the "search growth" score and the "freshness" score
 * (how recently the series left its own baseline).
 */
export async function fetchInterestOverTime(
  keyword,
  { geo = 'US', hl = 'en-US', timeRange = 'today 1-m' } = {}
) {
  try {
    const widgets = await getExploreWidgets(keyword, { geo, hl, timeRange });
    const widget = widgets.find((w) => w.id === 'TIMESERIES');
    if (!widget) return [];
    const dataUrl = `${TRENDS_BASE}/widgetdata/multiline?hl=${hl}&tz=0&req=${encodeURIComponent(
      JSON.stringify(widget.request)
    )}&token=${widget.token}`;
    const dataJson = await fetchJson(dataUrl);
    const points = dataJson?.default?.timelineData || [];
    return points.map((p) => ({ time: Number(p.time) * 1000, value: p.value?.[0] ?? 0 }));
  } catch (err) {
    console.warn(`[trends:googleTrends] fetchInterestOverTime("${keyword}") failed:`, err.message);
    return [];
  }
}
