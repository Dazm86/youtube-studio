// ۲۰۲۶-۱۰-۰۱ — بررسیِ کیفیتِ خودکارِ ویدیوی رندرشده، قبل از آپلود.
// منطقِ تحلیل اینجا pure و قابلِ تسته (بدونِ ffmpeg)؛ اجرای واقعیِ ffmpeg تو
// rendering/index.js: checkRenderedVideo() انجام می‌شه.
//
// دو سطح:
//  - fatal: ویدیو حتماً خراب/بی‌فایده‌ست (بدونِ تصویر/صدا، صدای کاملاً ساکت،
//    خیلی کوتاه) → pipeline قبل از آپلود متوقف می‌شه.
//  - warnings: مشکوکه ولی ممکنه عمدی باشه (مثلاً صحنه‌ی تاریکِ طولانی) →
//    فقط تو needsReviewReasons ثبت می‌شه، آپلود ادامه پیدا می‌کنه.

export const SILENT_DB = -50; // میانگینِ بلندی زیرِ این = عملاً ساکت
export const MIN_DURATION_SEC = 3;

export function parseQualityOutput(stderr) {
  const text = stderr || "";
  const num = (re) => {
    const m = text.match(re);
    if (!m) return null;
    return m[1] === "-inf" ? -Infinity : Number(m[1]);
  };
  const blackSegments = [];
  const blackRe = /black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g;
  let m;
  while ((m = blackRe.exec(text))) {
    blackSegments.push({ start: Number(m[1]), end: Number(m[2]), duration: Number(m[3]) });
  }
  return {
    hasVideo: /Stream #\d+:\d+.*?: Video:/.test(text),
    hasAudio: /Stream #\d+:\d+.*?: Audio:/.test(text),
    meanVolumeDb: num(/mean_volume:\s*(-inf|-?[\d.]+)\s*dB/),
    maxVolumeDb: num(/max_volume:\s*(-inf|-?[\d.]+)\s*dB/),
    blackSegments,
  };
}

export function evaluateQuality(analysis, { durationSec = 0, fileBytes = 1 } = {}) {
  const fatal = [];
  const warnings = [];
  if (!fileBytes || fileBytes <= 0) fatal.push("فایلِ ویدیو خالیه");
  if (!analysis.hasVideo) fatal.push("ویدیو فاقدِ stream تصویریه");
  if (!analysis.hasAudio) fatal.push("ویدیو فاقدِ stream صداست");
  if (durationSec > 0 && durationSec < MIN_DURATION_SEC) {
    fatal.push(`ویدیو خیلی کوتاهه (${durationSec.toFixed(1)} ثانیه)`);
  }
  if (analysis.hasAudio && analysis.meanVolumeDb !== null && analysis.meanVolumeDb <= SILENT_DB) {
    fatal.push(`صدایِ ویدیو عملاً ساکته (میانگین ${analysis.meanVolumeDb} dB)`);
  }
  if (durationSec > 0 && analysis.blackSegments.length > 0) {
    const blackTotal = analysis.blackSegments.reduce((a, b) => a + b.duration, 0);
    const longest = Math.max(...analysis.blackSegments.map((b) => b.duration));
    if (longest > 3) warnings.push(`یک بخشِ سیاه ${longest.toFixed(1)} ثانیه‌ای تو ویدیو هست`);
    else if (blackTotal > durationSec * 0.15) {
      warnings.push(`بیش از ۱۵٪ ویدیو فریمِ سیاهه (${blackTotal.toFixed(1)} از ${Math.round(durationSec)} ثانیه)`);
    }
  }
  return { ok: fatal.length === 0, fatal, warnings };
}
