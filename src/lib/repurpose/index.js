import { google } from "googleapis";

// از YouTube Analytics منحنیِ نگه‌داشتِ مخاطب رو با dimension
// elapsedVideoTimeRatio می‌گیره (۰ تا ۱، تقسیم به صدک‌های نسبی طول
// ویدیو — نه ثانیه‌ی مطلق، چون یوتیوب همیشه نسبی گزارش می‌ده) و
// audienceWatchRatio رو به‌عنوان معیارِ "کدوم بخش بیشتر نگه داشته"
// برمی‌گردونه. این تنها API عمومیِ یوتیوب برای همچین داده‌ایه؛ دانلودِ
// خودِ فایل ویدیوی آپلودشده از طریق Data API v3 اصلاً امکان‌پذیر نیست
// (هیچ videos.download عمومی وجود نداره) — برای همین این تابع فقط
// "کدوم بازه" رو مشخص می‌کنه، نه این‌که خودش فایل رو بیاره؛ فایل منبع
// باید جدا (مستقیم از دستگاه کاربر) به endpoint بازآفرینیِ شورت داده بشه.
export async function getRetentionCurve(accessToken, videoId) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const youtubeAnalytics = google.youtubeAnalytics({ version: "v2", auth: oauth2Client });

  const res = await youtubeAnalytics.reports.query({
    ids: "channel==MINE",
    startDate: "2020-01-01",
    endDate: new Date().toISOString().slice(0, 10),
    metrics: "audienceWatchRatio",
    dimensions: "elapsedVideoTimeRatio",
    filters: `video==${videoId}`,
    maxResults: 100,
  });

  return (res.data.rows || []).map(([ratio, watch]) => ({
    ratio: Number(ratio),
    watchRatio: Number(watch),
  }));
}

// بازه‌ی targetDurationSec ثانیه‌ای با بالاترین میانگینِ نگه‌داشت رو تو
// طول کل ویدیو (totalDurationSec) پیدا می‌کنه. اگه ویدیو خیلی تازه باشه
// و هنوز داده‌ی نگه‌داشتِ کافی نداشته باشه (کمتر از چند صدک)، به یک
// heuristic صادقانه برمی‌گرده: بازه‌ی بلافاصله بعد از هوکِ اول (که
// معمولاً چگالیِ محتوای تازه‌ی بالایی داره)، به‌جای این‌که ادعای اشتباهی
// درباره‌ی "بهترین نگه‌داشت" داشته باشیم.
export function findBestRetentionWindow(curve, totalDurationSec, targetDurationSec) {
  const windowRatio = Math.min(0.9, targetDurationSec / totalDurationSec);

  if (!curve || curve.length < 5) {
    const startRatio = 0.12; // بعد از هوک، قبل از میانه‌ی کند
    return {
      startSec: startRatio * totalDurationSec,
      endSec: Math.min(totalDurationSec, (startRatio + windowRatio) * totalDurationSec),
      source: "heuristic (insufficient retention data yet)",
    };
  }

  const sorted = [...curve].sort((a, b) => a.ratio - b.ratio);
  let bestStartRatio = 0;
  let bestAvg = -1;
  for (let i = 0; i < sorted.length; i++) {
    const startRatio = sorted[i].ratio;
    const endRatio = Math.min(1, startRatio + windowRatio);
    const inWindow = sorted.filter((p) => p.ratio >= startRatio && p.ratio <= endRatio);
    if (inWindow.length === 0) continue;
    const avg = inWindow.reduce((a, p) => a + p.watchRatio, 0) / inWindow.length;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestStartRatio = startRatio;
    }
  }

  const startSec = bestStartRatio * totalDurationSec;
  const endSec = Math.min(totalDurationSec, startSec + targetDurationSec);
  return { startSec, endSec, source: "youtube_analytics_retention" };
}
