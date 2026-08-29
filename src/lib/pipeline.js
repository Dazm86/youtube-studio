import { google } from "googleapis";
import { Readable } from "stream";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import { synthesizeSpeech } from "./providers/router.js";
import { fetchImages, fetchClips } from "./media/index.js";
import { distributeDurations, buildSrt, validateSrt, buildSentenceCaptions } from "./script/timing.js";
import { translateCaptions } from "./script/translate.js";
import { generateChapters } from "./metadata/index.js";
import { generateCommunityPost } from "./community/index.js";
import { recordVideo, recordCommunityPost } from "./db/index.js";

// Download media from URL to local buffer
async function downloadMedia(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download media: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

// Dynamic imports for rendering functions to avoid build-time issues on unsupported platforms
async function getRendering() {
  const {
    renderVideo,
    probeDurationSec,
    estimateAudioDurationSec,
    trimSilenceFromAudio,
    detectLongSilences,
    pickBgmPath,
  } = await import("./rendering/index.js");
  return { renderVideo, probeDurationSec, estimateAudioDurationSec, trimSilenceFromAudio, detectLongSilences, pickBgmPath };
}

async function getMayaThumbnail() {
  const { buildMayaThumbnail } = await import("./rendering/mayaThumbnail.js");
  return { buildMayaThumbnail };
}

function formatChapterTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

// دنبالِ اولین وقوعِ چند-کلمه‌ی firstWords (که generateChapters برگردونده)
// تو آرایه‌ی کلمه‌های خودِ اسکریپت می‌گرده تا موقعیتِ آن فصل رو به‌عنوانِ
// اندیسِ کلمه پیدا کنه — نه یک indexOf خامِ رشته‌ای، چون فاصله‌گذاری/
// نقطه‌گذاریِ خروجیِ AI ممکنه دقیقاً با متنِ اصلی یکی نباشه؛ کلمه‌به‌کلمه و
// بدونِ علائمِ نگارشی مقایسه می‌کنیم تا این تفاوت‌های جزئی مشکل نسازن.
function findWordOffset(scriptWords, firstWords) {
  const clean = (w) => w.toLowerCase().replace(/[^\w']/g, "");
  const needle = String(firstWords || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map(clean)
    .filter(Boolean);
  if (needle.length === 0) return null;
  const hay = scriptWords.map(clean);
  for (let i = 0; i <= hay.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  // اگه کلِ عبارت پیدا نشد، حداقل با اولین کلمه‌ش تطبیق بده — بهتر از
  // این‌که کل فصل رو بی‌خیال بشیم.
  const idx = hay.findIndex((w) => w === needle[0]);
  return idx >= 0 ? idx : null;
}

// نشانه‌های متنیِ generateChapters (عنوان + چند کلمه‌ی اول) رو به
// تایم‌استمپِ واقعی تبدیل می‌کنه — با همون مدلِ «نسبتِ موقعیتِ کلمه از کلِ
// اسکریپت × audioDurationSec» که distributeDurations هم برای هماهنگیِ
// رسانه/رندر استفاده می‌کنه، پس با تایمینگِ واقعیِ ویدیو هم‌خونی داره. بعد
// قوانینِ خودِ یوتیوب رو اعمال می‌کنه: فصلِ اول باید دقیقاً ۰:۰۰ باشه، هر
// فصل حداقل ۱۰ ثانیه از قبلی فاصله داشته باشه، و حداقل ۳ فصل معتبر بمونه
// وگرنه یوتیوب اصلاً فصل‌بندی رو نشون نمی‌ده (در این حالت null برمی‌گردونه
// و توضیحات بدونِ فصل‌بندی می‌مونه — شکستِ این ویژگی نباید آپلود رو بگیره).
function buildChapterBlock(script, chapters, audioDurationSec) {
  const scriptWords = (script || "").split(/\s+/).filter(Boolean);
  const totalWords = scriptWords.length || 1;
  const entries = [];
  for (const ch of chapters) {
    const offset = findWordOffset(scriptWords, ch.firstWords);
    if (offset == null) continue;
    entries.push({
      title: String(ch.title || "").trim() || "بخش بعدی",
      sec: audioDurationSec * (offset / totalWords),
    });
  }
  if (entries.length === 0) return null;
  entries.sort((a, b) => a.sec - b.sec);
  entries[0].sec = 0;

  const filtered = [entries[0]];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].sec - filtered[filtered.length - 1].sec >= 10) {
      filtered.push(entries[i]);
    }
  }
  if (filtered.length < 3) return null;

  return filtered.map((e) => `${formatChapterTime(e.sec)} ${e.title}`).join("\n");
}

// این تابع دقیقاً همون پایپ‌لاینِ قبلیِ api/generate-and-upload/route.js
// هست — TTS → رسانه → رندر → آپلود → تامبنیل → زیرنویس → پست کامیونیتی
// — فقط از route جدا شده تا هم مسیر تعاملی (کاربر تو UI، پیشرفت به شکل
// stream) و هم زمان‌بند خودکار (بدون کاربر، بدون stream) از یک منطق
// واحد استفاده کنن، به‌جای این‌که دو کپیِ جدا از هم منحرف بشن.
//
// چک‌لیستِ ریسک/انطباق — نه یک فیلترِ محتوایی سخت‌گیرانه، فقط چند الگوی
// مشخص که شکلِ «ادعای درمانیِ غیرمجاز» دارن (نه صرفاً بحث دربابِ اضطراب/
// افسردگی به‌عنوانِ موضوع، که برای یک کانالِ mindfulness کاملاً طبیعیه).
// تشخیصِ این الگوها باعثِ رد یا توقفِ رندر *نمی‌شه* — فقط لاگ می‌شه و
// ویدیو با privacyStatus خصوصی آپلود می‌شه (پایین‌تر) تا قبل از عمومی‌شدن
// یک بازبینیِ دستی بشه.
const RISKY_CLAIM_PATTERNS = [
  /\bcures?\s+(your\s+)?(depression|anxiety|trauma|ptsd)\b/i,
  /\btreats?\s+(your\s+)?(depression|anxiety|trauma|ptsd)\b/i,
  /\breplaces?\s+(your\s+)?(therapy|medication|therapist)\b/i,
  /\bstop\s+taking\s+(your\s+)?medication\b/i,
  /\bguaranteed?\s+to\s+(cure|heal|fix)\b/i,
  /\bdiagnos(e|ed|is|ing)\b/i,
];

export function checkRiskyKeywords(script) {
  const hits = [];
  for (const pattern of RISKY_CLAIM_PATTERNS) {
    const m = script.match(pattern);
    if (m) hits.push(m[0]);
  }
  return hits;
}

// کلماتِ تماماً بزرگ (به‌جز خیلی کوتاه‌های رایج مثلِ "I") یا مخفف‌های
// چندحرفی که TTS ممکنه اشتباه تلفظ کنه — فقط تشخیص/لاگ، نه اصلاحِ خودکار
// (msedge-tts از طریقِ متنِ ساده صدا زده می‌شه، نه SSML با phoneme hint
// که بشه دقیقاً کنترلش کرد).
export function checkMispronunciationRisks(script) {
  const words = script.split(/\s+/);
  const suspicious = new Set();
  for (const w of words) {
    const clean = w.replace(/[^A-Za-z']/g, "");
    if (clean.length >= 2 && clean === clean.toUpperCase() && /[A-Z]/.test(clean) && clean !== "I") {
      suspicious.add(clean);
    }
  }
  return [...suspicious];
}

// اطلاع‌رسانیِ شکست به یک webhook عمومی (تلگرام/Slack/Discord/هرچیزی که
// POST ساده قبول کنه) — فقط وقتی ALERT_WEBHOOK_URL تنظیم شده باشه، وگرنه
// بی‌صدا هیچ‌کاری نمی‌کنه (نه خطا، نه لاگِ اضافه). خودِ این تابع هیچ‌وقت
// throw نمی‌کنه — شکستِ اطلاع‌رسانی نباید رویِ نتیجه‌ی پایپ‌لاین اثر بذاره.
async function notifyWebhook(event, details) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, details, at: new Date().toISOString() }),
    });
  } catch (err) {
    console.error("notifyWebhook شکست خورد (نادیده گرفته می‌شه):", err.message);
  }
}

// `emit(obj)` دقیقاً همون شکل send() قبلی رو داره — {status, progress}
// یا در پایان {done, videoId, ...} را نمی‌فرسته؛ خروجی نهایی رو خودِ
// این تابع return می‌کنه، caller تصمیم می‌گیره چطور اطلاع بده.
//
// `getUploadAccessToken` یک تابعِ async است که caller مشخص می‌کنه —
// مسیر تعاملی از کوکیِ NextAuth (`getToken`) تازه می‌کنه، زمان‌بند
// خودکار از refresh_token ذخیره‌شده تو DB. اینجا هیچ فرضی درباره‌ی
// وجود یک HTTP request/کوکی نمی‌کنیم.
//
// `quickTest: true` یک مسیرِ کوتاه‌شده‌ست — فقط چند ثانیه صدا/یک سگمنت
// رندر می‌کنه و آپلود نمی‌کنه، صرفاً برای چک‌کردنِ سلامتِ کلیدها/تنظیمات
// (Groq/Pexels/msedge-tts/ffmpeg) قبل از یک اجرای واقعی. تایم‌اوتِ کلیِ
// پایپ‌لاین (پایین‌تر) رویِ این مسیر اعمال نمی‌شه چون خودش قراره سریع
// باشه.
const PIPELINE_TIMEOUT_MS = 25 * 60 * 1000; // ۲۵ دقیقه — اگه یک اجرا گیر کنه، اجرای زمان‌بندی‌شده‌ی بعدی نامحدود بلاک نشه

export async function runPipeline(
  {
    script,
    title,
    description,
    thumbnailText,
    tags: tagsRaw,
    privacyStatus,
    publishAt,
    videoMode,
    useVideoClips,
    imageKeyword,
    titleB,
    thumbnailTextB,
    accessToken,
    getUploadAccessToken,
    quickTest,
  },
  { emit = () => {} } = {}
) {
  if (!script || !script.trim()) {
    throw new Error("متنی ارسال نشده");
  }

  if (quickTest) {
    return runQuickTest({ script, videoMode, useVideoClips, imageKeyword }, { emit });
  }

  const runLog = { stages: {}, warnings: [], flags: {} };
  const stageStart = {};
  const beginStage = (name) => {
    stageStart[name] = Date.now();
  };
  const endStage = (name) => {
    if (stageStart[name] != null) {
      runLog.stages[name] = Date.now() - stageStart[name];
    }
  };

  const pipelineStartedAt = Date.now();
  try {
    return await Promise.race([
      runPipelineCore(
        {
          script, title, description, thumbnailText, tagsRaw, privacyStatus, publishAt,
          videoMode, useVideoClips, imageKeyword, titleB, thumbnailTextB, accessToken,
          getUploadAccessToken,
        },
        { emit, runLog, beginStage, endStage }
      ),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`پایپ‌لاین بیشتر از ${PIPELINE_TIMEOUT_MS / 60000} دقیقه طول کشید و متوقف شد`)),
          PIPELINE_TIMEOUT_MS
        )
      ),
    ]);
  } catch (err) {
    runLog.stages.totalMs = Date.now() - pipelineStartedAt;
    await notifyWebhook("pipeline_failed", {
      title: title || "(بدون عنوان)",
      error: err.message,
      runLog,
    });
    throw err;
  }
}

// یک رندرِ خیلی کوچیک (چند ثانیه، بدونِ آپلود) فقط برای چک‌کردنِ زنجیره‌ی
// AI متن → TTS → یک فریمِ تصویری، بدونِ صرفِ کاملِ APIها یا صبرِ چند
// دقیقه‌ای رندرِ واقعی. خطای همین مسیر دقیقاً همون چیزیه که یک اجرای
// واقعی هم باهاش شکست می‌خورد، ولی ظرفِ چند ثانیه معلوم می‌شه.
async function runQuickTest({ script, videoMode, useVideoClips, imageKeyword }, { emit }) {
  emit({ status: "تستِ سریع: در حال ساختِ چند ثانیه صدا...", progress: 10 });
  const shortScript = script.split(/\s+/).slice(0, 15).join(" ") || "This is a quick test.";
  const { buffer: audioBuffer } = await synthesizeSpeech({ text: shortScript });
  emit({ status: "تستِ سریع: صدا OK ✅ — در حال گرفتنِ یک عکس/کلیپ نمونه...", progress: 40 });
  const isShort = videoMode === "short";
  const orientation = isShort ? "portrait" : "landscape";
  const mediaResult = useVideoClips
    ? await fetchClips({ text: shortScript, keyword: imageKeyword, count: 1, orientation })
    : await fetchImages({ text: shortScript, keyword: imageKeyword, count: 1, orientation });
  const mediaOk = useVideoClips ? mediaResult.clips?.length > 0 : mediaResult.images?.length > 0;
  emit({ status: `تستِ سریع: رسانه ${mediaOk ? "OK ✅" : "شکست ❌"}`, progress: 90 });
  return {
    quickTest: true,
    audioOk: !!audioBuffer && audioBuffer.length > 0,
    mediaOk,
  };
}

async function runPipelineCore(
  {
    script,
    title,
    description,
    thumbnailText,
    tagsRaw,
    privacyStatus,
    publishAt,
    videoMode,
    useVideoClips,
    imageKeyword,
    titleB,
    thumbnailTextB,
    accessToken,
    getUploadAccessToken,
  },
  { emit, runLog, beginStage, endStage }
) {
  // --- بررسی‌های پیش از ساختِ صدا: کلیدواژه‌های حساس + کلماتِ مستعدِ
  // بدتلفظی — فقط تشخیص/لاگ، هیچ‌کدوم رندر رو متوقف نمی‌کنن. نتیجه‌ی
  // riskyHits پایین‌تر (بعد از آماده‌شدنِ videoId) رویِ privacyStatus اثر
  // می‌ذاره.
  const riskyHits = checkRiskyKeywords(script);
  if (riskyHits.length > 0) {
    runLog.warnings.push(`کلیدواژه‌ی حساس/ادعای درمانی: ${riskyHits.join("، ")}`);
    runLog.flags.riskyContent = true;
  }
  const mispronunciationRisks = checkMispronunciationRisks(script);
  if (mispronunciationRisks.length > 0) {
    runLog.warnings.push(`کلماتِ مستعدِ بدتلفظی توسطِ TTS: ${mispronunciationRisks.join("، ")}`);
  }

  // --- ۱. ساخت صدا ---
  beginStage("audio");
  emit({ status: "مرحله ۱ از ۵: در حال ساخت صدا...", progress: 2 });
  const { buffer: rawAudioBuffer } = await synthesizeSpeech({ text: script });

  // Get rendering functions dynamically
  const { trimSilenceFromAudio, detectLongSilences, estimateAudioDurationSec: estimateAudioDuration } = await getRendering();

  // gTTS/msedge-tts گاهی چند دهم ثانیه سکوتِ اضافه قبل/بعدِ روایت می‌ذاره
  // — قبل از این‌که audioDurationSec (که کلِ تایمینگِ رسانه/رندر بهش
  // وابسته‌ست) محاسبه بشه می‌بریمش، تا هوکِ اولِ ویدیو معطل نمونه و این
  // تریم با محاسباتِ بعدی هم‌خون بمونه.
  const audioBuffer = await trimSilenceFromAudio(rawAudioBuffer);
  endStage("audio");
  emit({ status: "صدا ساخته شد ✅", progress: 8 });

  // سکوت‌های *داخلیِ* غیرعادی‌طولانی — فقط لاگ می‌شه (نه اصلاحِ خودکار،
  // که تایمینگِ محاسبه‌شده‌ی پایین‌تر رو به‌هم می‌زد؛ توضیحش تو
  // videoRender.js/detectLongSilences هست).
  try {
    const longGaps = await detectLongSilences(audioBuffer, 2.5);
    if (longGaps.length > 0) {
      runLog.warnings.push(
        `${longGaps.length} سکوتِ داخلیِ بلند (بیشتر از ۲.۵ ثانیه) تو روایت پیدا شد: ${longGaps
          .map((g) => `${g.start.toFixed(1)}s-${g.end.toFixed(1)}s`)
          .join("، ")}`
      );
    }
  } catch (gapErr) {
    console.error("detectLongSilences شکست خورد (نادیده گرفته می‌شه):", gapErr.message);
  }


  // --- ۲. تقسیم اسکریپت به بخش‌های زمان‌بندی‌شده + گرفتن عکس/کلیپ مخصوص هر بخش ---
  const isShort = videoMode === "short";
  const audioDurationSec = await estimateAudioDuration(audioBuffer);
  if (!isShort && audioDurationSec < 480) {
    // هدفِ پرامپتِ اسکریپت (scriptGen.js) رد شدن از ۸ دقیقه‌ست، چون زیرِ
    // این آستانه یوتیوب اجازه‌ی چند تبلیغِ میان‌ویدیو نمی‌ده — این فقط یک
    // هشدارِ قابل‌پیگیریه، رندر رو متوقف نمی‌کنه (شبکه‌ی ایمنیِ کلمه‌شمار
    // تو خودِ scriptGen.js از قبل تلاششو کرده).
    console.warn(
      `runPipeline: ویدیوی لانگ ~${Math.round(audioDurationSec / 60)} دقیقه (${Math.round(
        audioDurationSec
      )} ثانیه) دراومد — زیرِ آستانه‌ی ۸ دقیقه‌ی یوتیوب برای تبلیغِ میان‌ویدیو.`
    );
  }
  // فیکسِ ۲۰۲۶-۰۸-۲۲ — طبق نقدِ Gemini رو یه ویدیوی واقعی: تصاویر با
  // میانگینِ ۶.۵ ثانیه خیلی کند عوض می‌شدن (قانونِ رایجِ صنعت: هر ۳-۵
  // ثانیه یه تغییرِ بصری). به ۴ ثانیه تغییر کرد. سقفِ mediaCount هم از
  // ۸۰ به ۱۲۰ رفت بالا — وگرنه برای ویدیوهای ۸+ دقیقه‌ای (هدفِ فازِ ۲ی
  // خودِ روودمپ) این ریتمِ سریع‌تر زودتر از ۸۰ به سقف می‌خورد و دوباره کند می‌شد.
  const mediaCount = isShort
    ? Math.min(30, Math.max(8, Math.ceil(audioDurationSec / 2.5)))
    : Math.min(120, Math.max(6, Math.ceil(audioDurationSec / 4)));
  const { durations, captions } = distributeDurations(script, mediaCount, audioDurationSec);

  // --- فصل‌بندیِ خودکار (Chapters) — فقط ویدیوهای بلند، چون Shorts نه
  // جایی برای نشون‌دادنِ فصل‌ها دارن نه اصلاً به این حدِ طول می‌رسن. شکستِ
  // این قدم (AI جواب نداد، یا کمتر از ۳ فصلِ معتبر بعدِ اعمالِ قوانینِ
  // یوتیوب باقی موند) نباید آپلود رو بگیره — description همون‌طور که
  // کاربر نوشته باقی می‌مونه، فقط بدونِ فصل‌بندی.
  let finalDescription = description || "";
  if (!isShort) {
    try {
      const chapters = await generateChapters(script);
      const chapterBlock = buildChapterBlock(script, chapters, audioDurationSec);
      if (chapterBlock) {
        finalDescription = `${finalDescription}\n\n${chapterBlock}`.trim();
      }
    } catch (chErr) {
      console.error("chapter generation failed (continuing without chapters):", chErr.message);
    }
  }

  const orientation = isShort ? "portrait" : "landscape";
  const hasManualKeyword = imageKeyword && imageKeyword.trim();
  const mediaItems = [];
  beginStage("media");

  if (hasManualKeyword) {
    emit({
      status: useVideoClips
        ? "مرحله ۲ از ۵: در حال گرفتن کلیپ ویدیویی..."
        : "مرحله ۲ از ۵: در حال گرفتن عکس...",
      progress: 10,
    });
    const mediaResult = useVideoClips
      ? await fetchClips({ keyword: imageKeyword, count: mediaCount, orientation })
      : await fetchImages({ keyword: imageKeyword, count: mediaCount, orientation });
    const items = useVideoClips ? mediaResult.clips : mediaResult.images;
    if (items && items.length > 0) {
      mediaItems.push(...items);
    }
  } else {
    for (let i = 0; i < captions.length; i++) {
      emit({
        status: `مرحله ۲ از ۵: در حال گرفتن ${useVideoClips ? "کلیپ" : "عکس"} برای بخش ${
          i + 1
        } از ${captions.length}...`,
        progress: 10 + (i / captions.length) * 5,
      });
      const mediaResult = useVideoClips
        ? await fetchClips({ text: captions[i], count: 1, orientation })
        : await fetchImages({ text: captions[i], count: 1, orientation });
      const item = useVideoClips ? mediaResult.clips?.[0] : mediaResult.images?.[0];
      if (item) mediaItems.push(item);
    }
  }

  // Ensure we have at least one media item (fallback to local media if needed)
  if (mediaItems.length === 0) {
    console.warn("No media items retrieved from providers, using local fallback media");
    const { fetchImages, fetchClips } = await import("./providers/router.js");
    const fallbackResult = useVideoClips
      ? await fetchClips({ keyword: "nature", count: Math.max(1, mediaCount), orientation })
      : await fetchImages({ keyword: "nature", count: Math.max(1, mediaCount), orientation });
    const fallbackItems = useVideoClips ? fallbackResult.clips : fallbackResult.images;
    if (fallbackItems && fallbackItems.length > 0) {
      mediaItems.push(...fallbackItems);
    }
  }

  const bgImageUrl = mediaItems[0] || "";
  endStage("media");
  emit({ status: "رسانه‌ها آماده شد ✅", progress: 15 });

  // --- ۳. رندر ویدیو ---
  beginStage("render");
  emit({ status: "مرحله ۳ از ۵: در حال رندر ویدیو...", progress: 16 });
  const { renderVideo } = await getRendering();

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pipeline-render-"));
  const outputPath = path.join(tmpDir, "output.mp4");

  let videoBuffer;
  let durationSec;

  // Download any URL-based media items to local buffers before rendering
  const mediaItemsWithBuffers = await Promise.all(mediaItems.map(async (item) => {
    if (item.buffer) return item;
    if (item.path && (item.path.startsWith('http://') || item.path.startsWith('https://'))) {
      try {
        const buffer = await downloadMedia(item.path);
        return { ...item, buffer };
      } catch (err) {
        console.error(`Failed to download media from ${item.path}:`, err.message);
        return { ...item, downloadFailed: true }; // پایین جایگزین می‌شه
      }
    }
    return item;
  }));

  // فیکسِ ۲۰۲۶-۰۸-۲۲ — قبلاً وقتی دانلود شکست می‌خورد، آیتمِ اصلی
  // (بدونِ buffer، با path که همون URLِ ریموتِ دانلودنشده می‌مونه)
  // دست‌نخورده برمی‌گشت. renderVideo() بعداً برای هر asset یِ بدونِ
  // buffer، fs.copyFile(asset.path, ...) صدا می‌زد — که فقط مسیرِ محلی
  // می‌فهمه، نه URL — یعنی یک دانلودِ ناموفق (مثلاً یک خطای شبکه‌ی
  // لحظه‌ای) کلِ رندر رو می‌ترکوند، نه فقط همون یک سگمنت رو. حالا هر
  // آیتمِ دانلودنشده با یک آیتمِ *واقعاً* دانلودشده (buffer معتبر)
  // جایگزین می‌شه، اگه حداقل یکی موفق بوده باشه.
  const successfulItems = mediaItemsWithBuffers.filter((item) => item.buffer && !item.downloadFailed);
  const finalMediaItems = mediaItemsWithBuffers.map((item, i) => {
    if (!item.downloadFailed) return item;
    if (successfulItems.length === 0) return item; // چاره‌ای نیست، همون قبلی می‌مونه
    return successfulItems[i % successfulItems.length];
  });

  try {
    const assets = finalMediaItems.map((item, i) => ({
      type: useVideoClips ? "video" : "image",
      buffer: item.buffer || null,
      path: item.path || null,
      durationSec: item.durationSec,
      loop: item.loop,
    }));

    const { probeDurationSec, pickBgmPath } = await getRendering();

    // فیکسِ ۲۰۲۶-۰۸-۲۹ — pickBgmPath (انتخابِ موزیکِ زمینه بر اساسِ موودِ
    // اسکریپت) از «فاز ۳» کاملاً ساخته و export شده بود، ولی هیچ‌جا صدا
    // زده نمی‌شد؛ اینجا همیشه null هاردکد بود، یعنی کلِ سیستمِ BGM از اول
    // خاموش بود. اگه فایل‌های صوتیِ واقعی تو public/audio/bgm/ نباشن،
    // pickBgmPath خودش به‌صورتِ امن null برمی‌گردونه (renderVideo هم قبلاً
    // دقیقاً همین حالت رو مدیریت می‌کرد) — یعنی این فیکس هیچ رندری رو
    // نمی‌شکنه، فقط وقتی فایل باشه واقعاً استفاده‌اش می‌کنه.
    const bgmPath = await pickBgmPath(script);

    // Convert durations (array of segment durations) to cumulative startSec/endSec
    let cursor = 0;
    const segments = captions.map((text, i) => {
      const startSec = cursor;
      const endSec = cursor + durations[i];
      cursor = endSec;
      return { text, startSec, endSec };
    });

    await renderVideo({
      script,
      segments,
      assets,
      outputPath,
      opts: {
        width: videoMode === "short" ? 720 : 1920,
        height: videoMode === "short" ? 1280 : 1080,
        fps: 30,
        fontPath: path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf"),
        fontSize: videoMode === "short" ? 44 : 48,
        bgmPath,
        bgmVolume: 0.12,
      },
    });

    videoBuffer = await fsp.readFile(outputPath);
    durationSec = await probeDurationSec(outputPath);

    emit({ status: "ویدیو رندر شد ✅", progress: 80 });
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
  endStage("render");

  // --- ۴. آپلود در یوتیوب ---
  beginStage("upload");
  // رندر ممکنه ۱۵-۴۰ دقیقه طول کشیده باشه — توکنِ ابتدای درخواست ممکنه
  // الان منقضی شده باشه. caller مشخص می‌کنه چطور توکن تازه بگیره.
  let uploadAccessToken = accessToken;
  if (getUploadAccessToken) {
    try {
      const fresh = await getUploadAccessToken();
      if (fresh) uploadAccessToken = fresh;
    } catch (refreshErr) {
      console.error("token refresh before upload failed:", refreshErr.message);
    }
  }

  emit({ status: "مرحله ۴ از ۵: در حال آپلود در یوتیوب...", progress: 85 });
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: uploadAccessToken });
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  const tags = (tagsRaw || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const uploadRes = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title: title || "بدون عنوان", description: finalDescription, tags },
      status: {
        // این فیلد قبلاً اصلاً ست نمی‌شد — یعنی یوتیوب هر ویدیو رو
        // «نامشخص» می‌ذاشت و صاحبِ کانال مجبور بود دستی از استودیو
        // مشخص کنه؛ محتوای این کانال (خودیاری/mindfulness) واضحاً
        // برای بزرگسالانه، پس صریح false ست می‌کنیم.
        selfDeclaredMadeForKids: false,
        ...(publishAt
          ? { privacyStatus: "private", publishAt: new Date(publishAt).toISOString() }
          : { privacyStatus: runLog.flags.riskyContent ? "private" : privacyStatus || "private" }),
      },
    },
    media: { body: Readable.from(videoBuffer) },
  });
  const videoId = uploadRes.data.id;
  endStage("upload");
  if (runLog.flags.riskyContent && !publishAt) {
    runLog.warnings.push(
      "چون کلیدواژه‌ی حساس/ادعای درمانی تو اسکریپت پیدا شد، privacyStatus صرفِ‌نظر از تنظیماتِ درخواستی روی خصوصی گذاشته شد — قبل از عمومی‌کردن یک بازبینیِ دستی لازمه."
    );
  }

  // انحرافاتِ غیرعادی که ارزشِ یک نگاهِ دستی رو دارن، قبل از این‌که
  // خودِ فیلد نهایی بشه جمع می‌کنیم (thumbnailStatus/captionStatus
  // پایین‌تر هم اضافه می‌شن).
  const needsReviewReasons = [];
  if (runLog.flags.riskyContent) needsReviewReasons.push("کلیدواژه‌ی حساس/ادعای درمانی");
  if (!isShort && audioDurationSec < 300) needsReviewReasons.push("ویدیوی لانگ غیرعادی کوتاه");
  if (isShort && audioDurationSec > 90) needsReviewReasons.push("Short غیرعادی بلند");
  // ۲۰۲۶-۰۸-۲۹ — چکِ متقارنِ بالایی، که قبلاً نبود: یک short که به‌طرز
  // غیرعادی کوتاهه (زیرِ نصفِ حداقلِ هدفِ ۳۰ ثانیه‌ی پرامپت) تقریباً
  // همیشه یعنی صدا ناقص ساخته شده یا رندر زودتر از موعد بریده — دقیقاً
  // همون چیزی که estimateAudioDurationSec رو همین امروز فیکس کرد، ولی
  // این‌جا هم به‌عنوانِ یک شبکه‌ی ایمنیِ اضافه می‌مونه، چون مسیرِ
  // auto-produce هیچ انسانی رو قبل از آپلود نداره.
  if (isShort && audioDurationSec < 15) needsReviewReasons.push("Short غیرعادی کوتاه (احتمالِ صدای ناقص)");

  emit({ status: "مرحله ۵ از ۵: در حال تنظیم تامبنیل و زیرنویس...", progress: 92 });

  // --- ۵. تامبنیل ---
  let thumbnailStatus = "skipped";
  try {
    const { buildMayaThumbnail } = await getMayaThumbnail();
    const thumbBuffer = await buildMayaThumbnail({
      title,
      thumbnailText,
      script,
      bgImageUrl,
      variant: "A",
    });
    // یوتیوب آپلودِ تامبنیل رو بالای ۲ مگابایت رد می‌کنه — به‌جای این‌که
    // بذاریم youtube.thumbnails.set خودش با یه خطای API نه‌چندان واضح
    // شکست بخوره، همینجا با یه پیامِ روشن چک می‌کنیم.
    const THUMB_MAX_BYTES = 2 * 1024 * 1024;
    if (thumbBuffer.length > THUMB_MAX_BYTES) {
      throw new Error(
        `حجمِ تامبنیل (${(thumbBuffer.length / 1024 / 1024).toFixed(2)}MB) از سقفِ ۲مگابایتیِ یوتیوب بیشتره`
      );
    }
    await youtube.thumbnails.set({
      videoId,
      media: { mimeType: "image/png", body: Readable.from(thumbBuffer) },
    });
    thumbnailStatus = "ok";
  } catch (thumbErr) {
    console.error("thumbnail error:", thumbErr.message);
    thumbnailStatus = "failed: " + thumbErr.message;
    needsReviewReasons.push("شکستِ تامبنیل");
  }

  // --- ترنسکریپتِ کامل به‌عنوانِ کامنت ---
  // توضیحاتِ یوتیوب سقفِ ۵۰۰۰ کاراکتری داره که اسکریپت‌های لانگ‌فرم
  // (۱۲۰۰-۱۵۰۰ کلمه ≈ ۷۰۰۰-۹۰۰۰ کاراکتر) راحت ردش می‌کنن، پس به‌جای
  // description از یک کامنتِ جداگانه (که همچین سقفِ تنگی نداره) استفاده
  // می‌کنیم — هم دسترسی‌پذیریِ بهتر، هم SEO عمیق‌ترِ کاملِ متن. شکستِ این
  // قدم (مثلاً کامنت‌ها برای این ویدیو غیرفعاله) نباید آپلود رو تحتِ‌تأثیر
  // بذاره.
  try {
    await youtube.commentThreads.insert({
      part: ["snippet"],
      requestBody: {
        snippet: {
          videoId,
          topLevelComment: { snippet: { textOriginal: script } },
        },
      },
    });
  } catch (commentErr) {
    console.error("transcript comment error (نادیده گرفته می‌شه):", commentErr.message);
  }

  // فیکسِ ۲۰۲۶-۰۸-۲۱ — قبلاً اینجا از regroupForSubtitles استفاده
  // می‌شد که بخش‌های رسانه (که segmentation‌شون بر اساسِ تعدادِ
  // عکس/کلیپ بود، نه مرزِ جمله) رو صرفاً بر اساسِ مدت‌زمان به بلوک‌های
  // ۵-۱۰ ثانیه‌ای می‌چسبوند — نتیجه بلوک‌هایی بود که چند جمله رو قاطی
  // می‌کردن یا وسطِ جمله می‌بریدن. حالا مستقیم از خودِ متنِ اسکریپت
  // جمله‌جمله جدا می‌شه، با زمان‌بندیِ دقیقِ متناسب با تعدادِ کلمه‌ی هر
  // جمله — یک جمله در هر خط، نه یک بلوکِ زمانیِ ثابت.
  const { captions: subtitleCaptions, durations: subtitleDurations } = buildSentenceCaptions(
    script,
    audioDurationSec
  );

  // --- ۶. زیرنویس انگلیسی ---
  let captionStatus = "skipped";
  try {
    const check = validateSrt(subtitleCaptions, subtitleDurations);
    if (!check.valid) {
      throw new Error(`ساختار زیرنویس نامعتبره: ${check.errors.join("؛ ")}`);
    }
    const srtContent = buildSrt(subtitleCaptions, subtitleDurations);
    await youtube.captions.insert({
      part: ["snippet"],
      requestBody: { snippet: { videoId, language: "en", name: "English", isDraft: false } },
      media: {
        mimeType: "application/octet-stream",
        body: Readable.from(Buffer.from(srtContent, "utf-8")),
      },
    });
    captionStatus = "ok";
  } catch (capErr) {
    console.error("caption upload error:", capErr.message);
    captionStatus = "failed: " + capErr.message;
  }

  // --- ۷. زیرنویس چندزبانه ---
  const CAPTION_LANGUAGES = [
    { code: "es", name: "Español" },
    { code: "pt", name: "Português" },
    { code: "ar", name: "العربية" },
    { code: "hi", name: "हिन्दी" },
    { code: "fa", name: "فارسی" },
  ];
  let translatedOk = 0;
  for (const lang of CAPTION_LANGUAGES) {
    try {
      emit({ status: `در حال ترجمه و آپلود زیرنویس ${lang.name}...`, progress: 96 });
      const translated = await translateCaptions(subtitleCaptions, lang.name);
      const check = validateSrt(translated, subtitleDurations);
      if (!check.valid) {
        throw new Error(`ساختار زیرنویسِ ترجمه‌شده نامعتبره: ${check.errors.join("؛ ")}`);
      }
      const translatedSrt = buildSrt(translated, subtitleDurations);
      await youtube.captions.insert({
        part: ["snippet"],
        requestBody: {
          snippet: { videoId, language: lang.code, name: lang.name, isDraft: false },
        },
        media: {
          mimeType: "application/octet-stream",
          body: Readable.from(Buffer.from(translatedSrt, "utf-8")),
        },
      });
      translatedOk++;
    } catch (langErr) {
      console.error(`caption ${lang.code} failed:`, langErr.message);
    }
  }
  const translatedCaptionsSummary = `${translatedOk} از ${CAPTION_LANGUAGES.length} زبان اضافه شد`;

  // --- ۸. پیش‌نویس پست کامیونیتی (فقط برای ویدیوهای لانگ) ---
  let communityPostStatus = "skipped";
  let communityPostDraft = null;
  if (!isShort) {
    try {
      emit({ status: "در حال ساخت پیش‌نویس پست کامیونیتی...", progress: 98 });
      communityPostDraft = await generateCommunityPost({ title, script });
      await recordCommunityPost({ videoId, ...communityPostDraft });
      communityPostStatus = "ok";
    } catch (postErr) {
      console.error("community post generation failed:", postErr.message);
      communityPostStatus = "failed: " + postErr.message;
    }
  }

  if (captionStatus !== "ok") needsReviewReasons.push("شکستِ زیرنویسِ انگلیسی");
  // فقط وقتی *همه‌ی* زبان‌های ترجمه شکست خوردن پرچم می‌زنیم، نه یک زبانِ
  // تکی — شکستِ یک زبان از ۵ تا (که طراحیِ فیکسِ ۲۰۲۶-۰۸-۱۰ هم عمداً
  // به‌عنوانِ یک افتِ جزئیِ قابلِ‌قبول در نظر گرفته، نه یک شکستِ کلی)
  // ارزشِ نگه‌داشتنِ کلِ ویدیو برای بازبینیِ دستی رو نداره.
  if (translatedOk === 0 && CAPTION_LANGUAGES.length > 0) {
    needsReviewReasons.push("شکستِ کاملِ زیرنویسِ چندزبانه");
  }
  const needsReview = needsReviewReasons.length > 0;
  if (needsReview) runLog.flags.needsReview = needsReviewReasons;

  await recordVideo({
    videoId,
    title,
    script,
    videoMode,
    useVideoClips,
    imageKeyword,
    thumbnailText,
    titleB,
    thumbnailTextB,
    runLog,
    needsReview,
  });

  return {
    videoId,
    thumbnailStatus,
    captionStatus,
    translatedCaptionsSummary,
    communityPostStatus,
    communityPostDraft,
    needsReview,
    needsReviewReasons,
    runLog,
  };
}
