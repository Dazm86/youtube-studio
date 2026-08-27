// خط جدید (۲۰۲۶-۰۸-۲۷) — پشتِ دکمه‌ی «تولید کاملاً خودکار» تو
// VideoStudio.js. ترتیب دقیقاً همونیه که خواسته شده بود: موضوع (از
// Trend Finder) → سناریو → عنوان/تگ‌ها → صدا → عکس/کلیپ → رندر →
// زیرنویس → هماهنگیِ همه‌چیز → آپلود.
//
// این فایل خودش رندرکننده‌ی جدیدی نیست — فقط سه قدمِ اولی که کاربر
// قبلاً دستی و جداگانه انجام می‌داد (انتخابِ موضوع، دکمه‌ی «بنویس
// سناریو»، دکمه‌ی «پیشنهاد عنوان/تگ») رو خودکار می‌کنه، بعد دقیقاً همون
// runPipeline() موجودِ pipeline.js رو صدا می‌زنه — همون صدا → رسانه →
// رندر → آپلود → تامبنیل → زیرنویس (انگلیسی + ۵ زبان) → پستِ کامیونیتی
// که برای ساخت‌وآپلودِ دستی هم استفاده می‌شه. یعنی هر فیکس/بهبودِ بعدیِ
// pipeline.js خودکار شاملِ این مسیر هم می‌شه، بدونِ نگه‌داریِ دو نسخه‌ی
// جدا از هم.
//
// عمداً همیشه IN-PROCESS اجرا می‌شه (نه از طریقِ worker/jobs، حتی اگه
// USE_RENDER_WORKER=true باشه) — دقیقاً همون انتخابی که «زمان‌بندِ
// خودکار» (api/scheduler/run) و «Repurpose» هم از قبل دارن (نگاه کن
// PROJECT_STATE.md، بخشِ «Key flows»: هر دو صراحتاً می‌گن «Runs
// in-process — never via the worker/jobs system»). دو دلیل: (۱) خودِ
// مسیرِ in-process با heartbeat + self-ping (همون مکانیزمِ
// api/generate-and-upload/route.js) از قبل مشکلِ خوابیدنِ Render free
// tier رو حل کرده — یعنی worker برای *زنده‌ماندنِ رندرِ طولانی* اصلاً
// لازم نیست، فقط یک گزینه‌ی جایگزینه؛ (۲) قلاب‌کردنِ تکمیل‌شدنِ async
// ورکر به وضعیتِ trend_topics (claim/release) یک پیچیدگیِ اضافه‌ست که
// دقیقاً با باگِ شناخته‌شده‌ی «انقضای credential کال‌بکِ ورکر قبل از
// اتمامِ رندرهای واقعی» (نگاه کن Known issues) تداخل می‌کرد و نتیجه‌ش
// نامطمئن می‌شد. اگه بعداً اون باگ فیکس شد، اضافه‌کردنِ مسیرِ worker به
// این تابع هم یک تغییرِ جدا و مشخصه، نه چیزی که الان لازم باشه.

import {
  ensureTrendsSchema,
  claimNextApprovedTopic,
  markTrendTopicProduced,
  releaseTrendTopicClaim,
} from "./trends/db.js";
import { generateScript } from "./script/index.js";
import { generateMetadata } from "./metadata/index.js";

async function getRunPipeline() {
  // همون الگویِ dynamic import خودِ pipeline.js/route های دیگه — جلوگیری
  // از بارشدنِ زودهنگامِ وابستگی‌های سنگین (ffmpeg و ...) در زمانِ build.
  const { runPipeline } = await import("./pipeline.js");
  return runPipeline;
}

/**
 * @param {object} opts
 * @param {"long"|"short"} opts.mode
 * @param {string} [opts.privacyStatus] - همون مقدارِ فرمِ VideoStudio (پیش‌فرض "private")
 * @param {string} [opts.publishAt]
 * @param {boolean} [opts.useVideoClips] - همون چک‌باکسِ فرم (پیش‌فرض false: عکسِ ثابت)
 * @param {string} [opts.accessToken]
 * @param {() => Promise<string>} [opts.getUploadAccessToken]
 * @param {(event: object) => void} opts_emit - همون emit استریمِ NDJSON بقیه‌ی مسیرها
 */
export async function runAutoProduce(
  { mode, privacyStatus, publishAt, useVideoClips, accessToken, getUploadAccessToken },
  { emit = () => {} } = {}
) {
  const videoMode = mode === "short" ? "short" : "long";

  await ensureTrendsSchema();

  // --- ۰. انتخابِ موضوع از صفِ تاییدشده‌ی Trend Finder ---
  emit({ stage: "topic", status: "🔎 در حال انتخاب بهترین موضوعِ تاییدشده از Trend Finder..." });
  const claimed = await claimNextApprovedTopic(videoMode);
  if (!claimed) {
    throw new Error(
      `هیچ موضوعِ تاییدشده‌ای برای «${
        videoMode === "short" ? "ویدیوی شورت" : "ویدیوی لانگ"
      }» تو Trend Finder موجود نیست — اول از صفحه‌ی Trend Finder یک موضوع رو approve کن (اگه هنوز اسکنی نزدی، اول یک اسکن بزن).`
    );
  }
  emit({
    stage: "topic",
    status: `موضوع انتخاب شد: «${claimed.topic}» (امتیاز ${Math.round(Number(claimed.score_total) || 0)}/100) ✅`,
    topic: claimed.topic,
    trendTopicId: claimed.id,
    scoreTotal: Number(claimed.score_total) || 0,
  });

  // از این‌جا به بعد موضوع "claim" شده (status='producing') — هر شکستی
  // قبل از آپلودِ موفق باید claim رو آزاد کنه (پایین‌تر، finally-مانند)
  // تا موضوع برای تلاشِ بعدی گم نشه.
  try {
    // --- ۱. نوشتنِ سناریو ---
    emit({ stage: "script", status: "✍️ در حال نوشتن سناریو..." });
    const { script } = await generateScript({ topic: claimed.topic, mode: videoMode, accessToken });
    emit({ stage: "script", status: "سناریو نوشته شد ✅", script });

    // --- ۲. عنوان، تامبنیل، توضیحات و تگ‌ها ---
    emit({ stage: "metadata", status: "✨ در حال ساختِ عنوان، تامبنیل، توضیحات و تگ..." });
    const metaResult = await generateMetadata(script);
    const tags = (metaResult.tags || []).join(", ");
    emit({
      stage: "metadata",
      status: "عنوان/تامبنیل/توضیحات/تگ آماده شد ✅",
      metadata: {
        title: metaResult.title,
        titleB: metaResult.titleB,
        thumbnailText: metaResult.thumbnailText,
        thumbnailTextB: metaResult.thumbnailTextB,
        description: metaResult.description,
        tags,
      },
    });

    // --- ۳ تا ۸: صدا → رسانه → رندر → آپلود → تامبنیل → زیرنویس (+ترجمه) →
    // پستِ کامیونیتی — همون runPipeline موجود؛ progressِ ۲..۱۰۰ خودش از
    // اینجا به بعد رو emit می‌کنه.
    const runPipeline = await getRunPipeline();
    const result = await runPipeline(
      {
        script,
        title: metaResult.title,
        description: metaResult.description,
        thumbnailText: metaResult.thumbnailText,
        tags,
        privacyStatus: privacyStatus || "private",
        publishAt,
        videoMode,
        useVideoClips: !!useVideoClips,
        imageKeyword: "", // خالی = جستجوی جداگانه به‌ازای هر بخش، طبقِ متنِ همون بخش
        titleB: metaResult.titleB,
        thumbnailTextB: metaResult.thumbnailTextB,
        accessToken,
        getUploadAccessToken,
      },
      { emit }
    );

    await markTrendTopicProduced(claimed.id, result.videoId);
    return { ...result, autoTopic: claimed.topic, trendTopicId: claimed.id };
  } catch (err) {
    await releaseTrendTopicClaim(claimed.id).catch((releaseErr) => {
      console.error("releaseTrendTopicClaim شکست خورد (نادیده گرفته می‌شه):", releaseErr.message);
    });
    throw err;
  }
}
