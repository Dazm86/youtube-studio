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

// ۲۰۲۶-۰۹-۰۸ — چک‌لیستِ تفسیرِ آمار: چهار قانونِ آستانه‌ای درخواستی.
// عمداً کاملاً ریاضی/بدونِ AI — رویِ داده‌ای که already synced هست
// (views/likes/thumbnail_ctr/retention_pct تو جدولِ videos) کار می‌کنه،
// هیچ API call یا هزینه‌ی اضافه‌ای نداره.
//
// دو تا از ۴ قانون («افتِ نگه‌داشت دقیقاً تو ۳۰ ثانیه‌ی اول» برای
// ویدیوی بلند، و «swipe-away rate» برای شورت) به یک منحنیِ نگه‌داشتِ
// زمان‌بندی‌شده (elapsedVideoTimeRatio، شبیهِ getRetentionCurve تو
// repurpose/index.js) + طولِ دقیقِ ویدیو نیاز دارن که هیچ‌کدوم الان تو
// دیتابیس ذخیره نمی‌شن (فقط retention_pct کلی/میانگین ذخیره می‌شه، نه
// منحنی). برای همین این دو قانون با نزدیک‌ترین پراکسیِ ممکن از رویِ
// retention_pct پیاده شدن:
//   - ویدیویِ بلند: retention_pct پایین یعنی به‌طورِ میانگین خیلی زود
//     رهاش می‌کنن؛ حدِ ۵۰٪ مستقیماً رویِ همون میانگین.
//   - شورت: چون کلِ ویدیو فقط ۳۰-۶۰ ثانیه‌ست، retention_pct میانگین
//     عملاً همون سیگنالِ "چقدر زود رهاش کردن" رو می‌ده (فاصله‌ی "اولش"
//     و "کلش" تو یک شورت خیلی کمه) — حدِ ۷۰٪ (یعنی swipe-away بیشتر
//     از ۳۰٪) رویِ همون.
// اگه بعداً منحنیِ واقعی + طولِ دقیقِ ویدیو ذخیره بشه، این دو قانون
// می‌تونن دقیق‌تر (بدونِ پراکسی) بشن.
export function computeHealthFlags(video, channelMedianViews) {
  const flags = [];
  const ctr = Number(video.thumbnail_ctr);
  const retention = Number(video.retention_pct);
  const views = Number(video.views) || 0;
  const likes = Number(video.likes) || 0;

  if (video.thumbnail_ctr != null && ctr < 4) {
    flags.push({
      level: "warning",
      message: `CTR ${ctr.toFixed(1)}٪ — زیرِ ۴٪. تامبنیل رو عوض کن و متنِ روش رو به ۳ کلمه‌ی شوکه‌کننده تقلیل بده.`,
    });
  }

  if (video.retention_pct != null) {
    if (video.video_mode !== "short" && retention < 50) {
      flags.push({
        level: "warning",
        message: `نگه‌داشتِ میانگین ${retention.toFixed(0)}٪ — زیرِ ۵۰٪. مقدمه‌چینی احتمالاً طولانی بوده؛ داستانِ اولیه رو حذف کن، مستقیم برو سراغِ راهکار.`,
      });
    }
    if (video.video_mode === "short" && retention < 70) {
      flags.push({
        level: "warning",
        message: `نگه‌داشتِ میانگین ${retention.toFixed(0)}٪ — یعنی مخاطب زود رهاش کرده. قلابِ ۳ثانیه‌ی اول نیاز به شوکِ بصری/صوتیِ قوی‌تر داره.`,
      });
    }
  }

  if (channelMedianViews > 0 && views > 0 && views < channelMedianViews && likes / views > 0.05) {
    flags.push({
      level: "info",
      message: `نسبتِ لایک بالاست (${((likes / views) * 100).toFixed(1)}٪) ولی بازدید زیرِ میانه‌ی کانالـه — کیفیت خوبه، احتمالاً موضوع پرجستجو نیست. عنوان رو سوالی/پرجستجوتر بازنویسی کن.`,
    });
  }

  return flags;
}

// خروجیِ getAllVideos() رو با healthFlags پر می‌کنه — برای هر ویدیو، بر
// اساسِ بقیه‌ی ویدیوهای همون لیست (برای میانه‌ی بازدید).
export function annotateVideosWithHealthFlags(videos) {
  const viewCounts = videos
    .map((v) => Number(v.views) || 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const medianViews = viewCounts.length > 0 ? viewCounts[Math.floor(viewCounts.length / 2)] : 0;
  return videos.map((v) => ({ ...v, healthFlags: computeHealthFlags(v, medianViews) }));
}
