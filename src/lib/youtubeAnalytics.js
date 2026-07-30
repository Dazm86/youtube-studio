import { google } from "googleapis";

// آمار همه‌ی ویدیوهای داده‌شده رو در یک درخواست از YouTube Analytics می‌گیره.
// برمی‌گردونه: { [videoId]: { views, subscribersGained, likes, avgViewDurationSec } }
export async function fetchStatsForVideos(accessToken, videoIds) {
  if (!videoIds || videoIds.length === 0) return {};

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const youtubeAnalytics = google.youtubeAnalytics({
    version: "v2",
    auth: oauth2Client,
  });

  const res = await youtubeAnalytics.reports.query({
    ids: "channel==MINE",
    startDate: "2020-01-01",
    endDate: new Date().toISOString().slice(0, 10),
    metrics: "views,subscribersGained,likes,averageViewDuration",
    dimensions: "video",
    filters: `video==${videoIds.join(",")}`,
    maxResults: 200,
  });

  const rows = res.data.rows || [];
  const result = {};
  for (const row of rows) {
    const [videoId, views, subscribersGained, likes, avgViewDurationSec] = row;
    result[videoId] = {
      views: Number(views) || 0,
      subscribersGained: Number(subscribersGained) || 0,
      likes: Number(likes) || 0,
      avgViewDurationSec: Number(avgViewDurationSec) || 0,
    };
  }
  return result;
}
