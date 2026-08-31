import { google } from "googleapis";

const FULL_METRICS =
  "views,subscribersGained,likes,averageViewDuration,averageViewPercentage,videoThumbnailImpressions,videoThumbnailImpressionsClickRate";
const BASIC_METRICS = "views,subscribersGained,likes,averageViewDuration";

async function queryVideoMetrics(youtubeAnalytics, videoIds, metrics, startDate, endDate) {
  const res = await youtubeAnalytics.reports.query({
    ids: "channel==MINE",
    startDate,
    endDate,
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
  const allTimeStart = "2020-01-01";
  const allTimeEnd = new Date().toISOString().slice(0, 10);
  try {
    rows = await queryVideoMetrics(youtubeAnalytics, videoIds, FULL_METRICS, allTimeStart, allTimeEnd);
  } catch (err) {
    // متریک‌های تامبنیل/نگه‌داشت شاید رو بعضی حساب‌ها هنوز در دسترس نباشن —
    // با ست پایه‌ای که همیشه کار می‌کنه دوباره امتحان می‌کنیم.
    console.error("full metrics query failed, retrying with basic set:", err.message);
    hasFullMetrics = false;
    rows = await queryVideoMetrics(youtubeAnalytics, videoIds, BASIC_METRICS, allTimeStart, allTimeEnd);
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

// ۲۰۲۶-۰۸-۳۰ — برایِ بستنِ حلقه‌ی A/B (`api/ab-test/results`): آمارِ یک
// ویدیویِ خاص رو برایِ یک بازه‌ی تاریخِ دلخواه می‌گیره (نه کلِ تاریخچه)،
// تا بشه دوره‌ی قبل از سوییچِ نسخه رو با دوره‌ی بعدش مقایسه کرد. همون
// الگویِ query که fetchStatsForVideos استفاده می‌کنه، فقط برایِ یک
// ویدیو و یک بازه‌ی مشخص.
export async function fetchStatsForVideoInRange(accessToken, videoId, startDate, endDate) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const youtubeAnalytics = google.youtubeAnalytics({ version: "v2", auth: oauth2Client });

  let rows;
  let hasFullMetrics = true;
  try {
    rows = await queryVideoMetrics(youtubeAnalytics, [videoId], FULL_METRICS, startDate, endDate);
  } catch (err) {
    console.error("fetchStatsForVideoInRange: full metrics failed, retrying basic:", err.message);
    hasFullMetrics = false;
    rows = await queryVideoMetrics(youtubeAnalytics, [videoId], BASIC_METRICS, startDate, endDate);
  }

  if (!rows || rows.length === 0) {
    return { views: 0, thumbnailImpressions: 0, thumbnailCtr: 0, avgViewPercentage: 0 };
  }
  const row = rows[0];
  if (hasFullMetrics) {
    const [, views, , , , avgViewPercentage, thumbnailImpressions, thumbnailCtr] = row;
    return {
      views: Number(views) || 0,
      thumbnailImpressions: Number(thumbnailImpressions) || 0,
      thumbnailCtr: Number(thumbnailCtr) || 0,
      avgViewPercentage: Number(avgViewPercentage) || 0,
    };
  }
  const [, views] = row;
  return { views: Number(views) || 0, thumbnailImpressions: 0, thumbnailCtr: 0, avgViewPercentage: 0 };
}
