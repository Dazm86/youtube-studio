import { google } from "googleapis";

const FULL_METRICS =
  "views,subscribersGained,likes,averageViewDuration,averageViewPercentage,videoThumbnailImpressions,videoThumbnailImpressionsClickRate";
const BASIC_METRICS = "views,subscribersGained,likes,averageViewDuration";

async function queryVideoMetrics(youtubeAnalytics, videoIds, metrics) {
  const res = await youtubeAnalytics.reports.query({
    ids: "channel==MINE",
    startDate: "2020-01-01",
    endDate: new Date().toISOString().slice(0, 10),
    metrics,
    dimensions: "video",
    filters: `video==${videoIds.join(",")}`,
    maxResults: 200,
  });
  return res.data.rows || [];
}

// آمار همه‌ی ویدیوهای داده‌شده رو در یک درخواست از YouTube Analytics می‌گیره.
// برمی‌گردونه: { [videoId]: { views, subscribersGained, likes, avgViewDurationSec,
//                              avgViewPercentage, thumbnailImpressions, thumbnailCtr } }
export async function fetchStatsForVideos(accessToken, videoIds) {
  if (!videoIds || videoIds.length === 0) return {};

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const youtubeAnalytics = google.youtubeAnalytics({
    version: "v2",
    auth: oauth2Client,
  });

  let rows;
  let hasFullMetrics = true;
  try {
    rows = await queryVideoMetrics(youtubeAnalytics, videoIds, FULL_METRICS);
  } catch (err) {
    // متریک‌های تامبنیل/نگه‌داشت شاید رو بعضی حساب‌ها هنوز در دسترس نباشن —
    // با ست پایه‌ای که همیشه کار می‌کنه دوباره امتحان می‌کنیم.
    console.error("full metrics query failed, retrying with basic set:", err.message);
    hasFullMetrics = false;
    rows = await queryVideoMetrics(youtubeAnalytics, videoIds, BASIC_METRICS);
  }

  const result = {};
  for (const row of rows) {
    if (hasFullMetrics) {
      const [
        videoId,
        views,
        subscribersGained,
        likes,
        avgViewDurationSec,
        avgViewPercentage,
        thumbnailImpressions,
        thumbnailCtr,
      ] = row;
      result[videoId] = {
        views: Number(views) || 0,
        subscribersGained: Number(subscribersGained) || 0,
        likes: Number(likes) || 0,
        avgViewDurationSec: Number(avgViewDurationSec) || 0,
        avgViewPercentage: Number(avgViewPercentage) || 0,
        thumbnailImpressions: Number(thumbnailImpressions) || 0,
        thumbnailCtr: Number(thumbnailCtr) || 0,
      };
    } else {
      const [videoId, views, subscribersGained, likes, avgViewDurationSec] = row;
      result[videoId] = {
        views: Number(views) || 0,
        subscribersGained: Number(subscribersGained) || 0,
        likes: Number(likes) || 0,
        avgViewDurationSec: Number(avgViewDurationSec) || 0,
        avgViewPercentage: 0,
        thumbnailImpressions: 0,
        thumbnailCtr: 0,
      };
    }
  }
  return result;
}
