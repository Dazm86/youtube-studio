// TikTok has no free/public trend-discovery API. The official TikTok
// Research API requires a separate approved-researcher application, not a
// simple API-key integration like the other sources in this folder — so
// unlike Google Trends/YouTube/Reddit/News, this adapter ships as a
// deliberate stub. Same "ships empty until a human fills it in" pattern
// already used for public/fallback-media/videos/ elsewhere in this
// project (see ROADMAP.md / PROJECT_STATE.md known constraints).
//
// If a TikTok data source ever becomes available (official Research API
// access, or a third-party aggregator), implement fetchTikTokSignal(topic)
// below to return { mentionCount, growthHint } — candidates.js already
// calls this and treats a null return as "no signal" without breaking the
// rest of the scan.

export async function fetchTikTokSignal(_topic) {
  return null;
}
