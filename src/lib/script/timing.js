export function splitSentences(text) {
  return (text.match(/[^.!?]+[.!?]*/g) || [text])
    .map((s) => s.trim())
    .filter(Boolean);
}

// ۲۰۲۶-۰۸-۲۱ — زیرنویسِ واقعاً یک‌جمله‌-در-یک‌خط، با زمان‌بندیِ دقیق.
// برخلافِ regroupForSubtitles (که بخش‌های رسانه رو صرفاً بر اساسِ
// مدت‌زمان به بلوک‌های ۵-۱۰ ثانیه‌ای می‌چسبونه و می‌تونه چند جمله رو
// قاطی کنه یا وسطِ جمله ببره)، این تابع مستقیم از خودِ متنِ اسکریپت
// (نه بخش‌های رسانه‌ای که segmentation‌شون به مرزِ جمله ربطی نداره)
// جمله‌ها رو با splitSentences جدا می‌کنه، و زمانِ هر جمله رو دقیقاً
// متناسب با سهمِ کلمه‌هاش از کلِ اسکریپت از کلِ audioDurationSec
// می‌ده — همون منطقِ توزیعِ distributeDurations، فقط واحدش «جمله»ست
// نه «تعداد بخشِ رسانه».
export function buildSentenceCaptions(script, totalDurationSec) {
  const sentences = splitSentences(script || "");
  if (sentences.length === 0 || !Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
    return { captions: [], durations: [] };
  }

  const wordCounts = sentences.map((s) => s.split(/\s+/).filter(Boolean).length || 1);
  const totalWords = wordCounts.reduce((sum, n) => sum + n, 0) || 1;

  const durations = wordCounts.map((wc) => (totalDurationSec * wc) / totalWords);

  return { captions: sentences, durations };
}

export function distributeDurations(script, imageCount, totalDuration) {
  const words = (script || "").split(/\s+/).filter(Boolean);
  const totalWords = words.length || 1;

  const buckets = new Array(imageCount).fill(0);
  const bucketText = new Array(imageCount).fill("");

  // هر کلمه‌ی اسکریپت رو بر اساس موقعیتش تو کل متن به یکی از imageCount
  // بخش نگاشت می‌کنیم — نه بر اساس جمله. روش قبلی هر جمله رو یک‌جا به
  // بخشِ جاری اضافه می‌کرد و فقط حداکثر یک‌بار به‌ازای هر جمله جلو
  // می‌رفت؛ نتیجه این بود که وقتی تعداد جمله‌ها از imageCount کمتر بود
  // (طبیعیِ یک اسکریپتِ کوتاهِ شورت با تعداد بخشِ بالا برای «برشِ سریع»
  // هر ۲ تا ۳ ثانیه) یا یک جمله به‌تنهایی سهمِ چند بخش رو پر می‌کرد،
  // خیلی از بخش‌های آخر اصلاً متنی نمی‌گرفتن (bucketText خالی می‌موند).
  // جستجوی رسانه‌ی هر بخش (pipeline.js) برای متنِ خالی به کلیدواژه‌ی
  // عمومیِ fallback ("nature" در registry.js) می‌افتاد و چون این fallback
  // برای چند بخشِ پشت‌سرهم عملاً یکی بود، نتیجه‌ی نهایی چند بخشِ پیاپی با
  // همون تصویر/کلیپِ ثابت و اغلب نامرتبط با موضوعِ اسکریپت بود — دقیقاً
  // برعکسِ هدفِ Phase 2 (برش هر ۲ تا ۳ ثانیه برای شورت‌ها). توزیعِ
  // کلمه‌به‌کلمه تضمین می‌کنه (تا وقتی کلِ اسکریپت حداقل imageCount کلمه
  // داشته باشه، که همیشه همینه) هر بخش متنِ خاصِ خودش رو بگیره، پس هر
  // بخش جستجوی رسانه‌ی مجزا و مرتبط با همون تکه از اسکریپت داره.
  for (let w = 0; w < words.length; w++) {
    let bucketIndex = Math.floor((w / totalWords) * imageCount);
    if (bucketIndex >= imageCount) bucketIndex = imageCount - 1;
    buckets[bucketIndex] += 1;
    bucketText[bucketIndex] += (bucketText[bucketIndex] ? " " : "") + words[w];
  }

  const minShare = 0.4 / imageCount;
  let shares = buckets.map((w) => Math.max(w / totalWords, minShare));
  const shareSum = shares.reduce((a, b) => a + b, 0);
  shares = shares.map((s) => s / shareSum);

  return {
    durations: shares.map((s) => totalDuration * s),
    captions: bucketText,
  };
}

export function escapeDrawtext(text) {
  return text
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

function formatSrtTime(totalSeconds) {
  const clamped = Math.max(0, totalSeconds);
  const wholeSeconds = Math.floor(clamped);
  const ms = Math.round((clamped - wholeSeconds) * 1000);
  const h = Math.floor(wholeSeconds / 3600);
  const m = Math.floor(wholeSeconds / 60) % 60;
  const s = wholeSeconds % 60;
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

// یک فایل SRT استاندارد از همون بخش‌ها/زمان‌بندی‌ای می‌سازه که برای
// جستجوی رسانه‌ی هر بخش هم استفاده شد — پس زیرنویس همیشه دقیقاً با
// همون تایمینگ ویدیوی رندرشده هماهنگه.
export function buildSrt(captions, durations) {
  let cursor = 0;
  const blocks = captions.map((text, i) => {
    const start = cursor;
    const end = cursor + durations[i];
    cursor = end;
    return `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${(text || "").trim()}\n`;
  });
  return blocks.join("\n");
}

// اعتبارسنجیِ ساختاریِ زیرنویس *قبل* از آپلود — نه یک تضمینِ ترجمه‌ی
// درست (اون کارِ translateCaptions.js با retry روی تعدادِ بخش‌هاست، از
// ۲۰۲۶-۰۸-۱۰)، بلکه یک لایه‌ی آخر برای رد نشدنِ داده‌ی ساختاریِ خراب به
// یوتیوب: طولِ نامنطبقِ captions/durations، duration غیرِعددی یا صفر/منفی
// (که formatSrtTime رو به "NaN:NaN:NaN,NaN" می‌شکونه)، یا متنِ کاملاً خالی.
// اینا معمولاً نباید اتفاق بیفتن، ولی اگه یه باگِ دیگه (شبیهِ همونی که تو
// ۲۰۲۶-۰۸-۱۰ فیکس شد) دوباره پیش بیاد، بهتره همینجا با یک خطای واضح رد
// بشیم تا این‌که یوتیوب یه پیامِ مبهم برگردونه یا زیرنویسِ خراب رو ساکت
// قبول کنه.
export function validateSrt(captions, durations) {
  const errors = [];
  if (!Array.isArray(captions) || !Array.isArray(durations)) {
    return { valid: false, errors: ["captions/durations آرایه نیستن"] };
  }
  if (captions.length !== durations.length) {
    errors.push(`طول captions (${captions.length}) با durations (${durations.length}) یکی نیست`);
    return { valid: false, errors }; // بقیه‌ی چک‌ها بی‌معنی می‌شن، همین‌جا برگرد
  }
  if (captions.length === 0) {
    errors.push("هیچ بخشی برای زیرنویس وجود نداره");
  }
  captions.forEach((text, i) => {
    const d = durations[i];
    if (typeof d !== "number" || !Number.isFinite(d) || d <= 0) {
      errors.push(`بخش ${i + 1}: مدت‌زمانِ نامعتبر (${d})`);
    }
    if (!text || !String(text).trim()) {
      errors.push(`بخش ${i + 1}: متنِ خالی`);
    }
  });
  return { valid: errors.length === 0, errors };
}

// بخش‌های ریزِ (captions, durations) که از distributeDurations می‌آد برای
// هماهنگی با تعداد آیتم‌های رسانه/رندر ساخته شدن (هر بخش = دقیقاً یک
// عکس/کلیپ و یک اجرای FFmpeg) و به همین خاطر می‌تونن خیلی کوتاه باشن
// (شورت: ~۲.۵ ثانیه) یا خیلی بلند (لانگ‌فرم‌های خیلی طولانی که به سقفِ
// ۸۰ بخش خورده باشن). این تابع همون بخش‌ها رو — بدون دست‌زدن به
// segmentationِ رسانه/رندرِ اصلی — برای خروجیِ SRT به بلوک‌های ۵ تا ۱۰
// ثانیه‌ای (پیش‌فرض) بازچینی می‌کنه: بخش‌های پشت‌سرهم رو تا وقتی به
// حداقل نرسیدن ادغام می‌کنه، و وقتی اضافه‌کردنِ بخشِ بعدی از سقف رد بشه
// بلوک رو می‌بنده. اگه یک بخشِ منفرد از قبل بزرگ‌تر از سقف باشه (نادر،
// فقط تو لانگ‌فرم‌های خیلی طولانی)، چون داده‌ی زمان‌بندی‌ای ریزتر از
// خودِ بخش نداریم، همون‌طور تنها رها می‌شه — بهترین تلاشِ ممکنه، نه یک
// تضمینِ سخت‌گیرانه.
export function regroupForSubtitles(captions, durations, minSec = 5, maxSec = 10) {
  const blocks = [];
  let curTexts = [];
  let curDuration = 0;

  for (let i = 0; i < captions.length; i++) {
    curTexts.push(captions[i]);
    curDuration += durations[i];

    const isLast = i === captions.length - 1;
    const nextDuration = isLast ? 0 : durations[i + 1];

    if (
      isLast ||
      curDuration >= maxSec ||
      (curDuration >= minSec && curDuration + nextDuration > maxSec)
    ) {
      blocks.push({ text: curTexts.join(" ").trim(), duration: curDuration });
      curTexts = [];
      curDuration = 0;
    }
  }

  return {
    captions: blocks.map((b) => b.text),
    durations: blocks.map((b) => b.duration),
  };
}

export function wrapCaption(text, maxCharsPerLine) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? current + " " + w : w;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.join("\\n");
}
