// Official YouTube Data API v3 (search.list + videos.list) — needs its own
// read-only API key rather than the channel's OAuth session, since the
// scheduled 6-hour scan runs with no browser session attached (same reason
// the scheduler and worker paths already avoid depending on a live
// session). Create a plain "API key" credential (not OAuth client) in the
// same Google Cloud project, restricted to YouTube Data API v3, and set it
// as YOUTUBE_API_KEY in Render.
//
// Used for two signals per candidate topic:
//   - competition: how many/how big the existing videos for this exact
//     keyword already are (more existing supply = harder for a new,
//     unknown channel to break in = LOWER score, on purpose — see
//     scoring.js)
//   - view growth: how fast recent videos on this topic are picking up
//     views relative to their age

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

/**
 * Searches recent videos for a keyword and pulls view/publish stats for
 * them. Returns totalResults (competition volume proxy) and per-video
 * views-per-day (growth proxy).
 */
export async function searchRecentVideos(
  keyword,
  { publishedAfterDays = 60, maxResults = 15 } = {}
) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn('[trends:youtube] YOUTUBE_API_KEY not set — skipping YouTube signal for', keyword);
    return { items: [], totalResults: null };
  }

  try {
    const publishedAfter = new Date(Date.now() - publishedAfterDays * 86400000).toISOString();
    const searchParams = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      order: 'viewCount',
      maxResults: String(maxResults),
      publishedAfter,
      q: keyword,
      key: apiKey,
    });
    const searchRes = await fetch(`${YT_BASE}/search?${searchParams.toString()}`);
    if (!searchRes.ok) throw new Error(`search HTTP ${searchRes.status}`);
    const searchJson = await searchRes.json();
    const totalResults = searchJson.pageInfo?.totalResults ?? null;
    const videoIds = (searchJson.items || []).map((i) => i.id?.videoId).filter(Boolean);
    if (videoIds.length === 0) return { items: [], totalResults };

    const statsParams = new URLSearchParams({
      part: 'statistics,snippet',
      id: videoIds.join(','),
      key: apiKey,
    });
    const statsRes = await fetch(`${YT_BASE}/videos?${statsParams.toString()}`);
    if (!statsRes.ok) throw new Error(`videos HTTP ${statsRes.status}`);
    const statsJson = await statsRes.json();

    const items = (statsJson.items || []).map((v) => {
      const publishedAt = new Date(v.snippet.publishedAt).getTime();
      const ageDays = Math.max(1, (Date.now() - publishedAt) / 86400000);
      const views = Number(v.statistics?.viewCount || 0);
      return {
        videoId: v.id,
        title: v.snippet?.title,
        channelId: v.snippet?.channelId,
        channelTitle: v.snippet?.channelTitle,
        publishedAt: v.snippet.publishedAt,
        views,
        viewsPerDay: views / ageDays,
      };
    });
    return { items, totalResults };
  } catch (err) {
    console.warn(`[trends:youtube] searchRecentVideos("${keyword}") failed:`, err.message);
    return { items: [], totalResults: null };
  }
}
