import { google } from "googleapis";
import { Readable } from "stream";
import { synthesizeSpeech } from "./providers/router";
import { fetchImages, fetchClips } from "./media";
import { renderVideo, estimateAudioDurationSec } from "./videoRender";
import { distributeDurations, buildSrt, regroupForSubtitles } from "./scriptTiming";
import { translateCaptions } from "./translateCaptions";
import { buildMayaThumbnail } from "./mayaThumbnail";
import { generateCommunityPost } from "./communityPost";
import { recordVideo, recordCommunityPost } from "./db";

// این تابع دقیقاً همون پایپ‌لاینِ قبلیِ api/generate-and-upload/route.js
// هست — TTS → رسانه → رندر → آپلود → تامبنیل → زیرنویس → پست کامیونیتی
// — فقط از route جدا شده تا هم مسیر تعاملی (کاربر تو UI، پیشرفت به شکل
// stream) و هم زمان‌بند خودکار (بدون کاربر، بدون stream) از یک منطق
// واحد استفاده کنن، به‌جای این‌که دو کپیِ جدا از هم منحرف بشن.
//
// `emit(obj)` دقیقاً همون شکل send() قبلی رو داره — {status, progress}
// یا در پایان {done, videoId, ...} را نمی‌فرسته؛ خروجی نهایی رو خودِ
// این تابع return می‌کنه، caller تصمیم می‌گیره چطور اطلاع بده.
//
// `getUploadAccessToken` یک تابعِ async است که caller مشخص می‌کنه —
// مسیر تعاملی از کوکیِ NextAuth (`getToken`) تازه می‌کنه، زمان‌بند
// خودکار از refresh_token ذخیره‌شده تو DB. اینجا هیچ فرضی درباره‌ی
// وجود یک HTTP request/کوکی نمی‌کنیم.
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
  },
  { emit = () => {} } = {}
) {
  if (!script || !script.trim()) {
    throw new Error("متنی ارسال نشده");
  }

  // --- ۱. ساخت صدا ---
  emit({ status: "مرحله ۱ از ۵: در حال ساخت صدا...", progress: 2 });
  const { buffer: audioBuffer } = await synthesizeSpeech({ text: script });
  emit({ status: "صدا ساخته شد ✅", progress: 8 });

  // --- ۲. تقسیم اسکریپت به بخش‌های زمان‌بندی‌شده + گرفتن عکس/کلیپ مخصوص هر بخش ---
  const isShort = videoMode === "short";
  const audioDurationSec = await estimateAudioDurationSec(audioBuffer);
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
  const mediaCount = isShort
    ? Math.min(30, Math.max(8, Math.ceil(audioDurationSec / 2.5)))
    : Math.min(80, Math.max(6, Math.ceil(audioDurationSec / 6.5)));
  const { durations, captions } = distributeDurations(script, mediaCount, audioDurationSec);

  const orientation = isShort ? "portrait" : "landscape";
  const hasManualKeyword = imageKeyword && imageKeyword.trim();
  const mediaItems = [];

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
    mediaItems.push(...(useVideoClips ? mediaResult.clips : mediaResult.images));
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
      mediaItems.push(useVideoClips ? mediaResult.clips[0] : mediaResult.images[0]);
    }
  }

  const bgImageUrl = mediaItems[0] || "";
  emit({ status: "رسانه‌ها آماده شد ✅", progress: 15 });

  // --- ۳. رندر ویدیو ---
  emit({ status: "مرحله ۳ از ۵: در حال رندر ویدیو...", progress: 16 });
  const videoBuffer = await renderVideo({
    durations,
    captions,
    videoMode,
    useVideoClips,
    mediaItems,
    audioBuffer,
    onStatus: (s) => emit({ status: "مرحله ۳ از ۵: " + s }),
    onProgress: (p) => emit({ progress: 15 + p * 65 }),
  });
  emit({ status: "ویدیو رندر شد ✅", progress: 80 });

  // --- ۴. آپلود در یوتیوب ---
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
      snippet: { title: title || "بدون عنوان", description: description || "", tags },
      status: publishAt
        ? { privacyStatus: "private", publishAt: new Date(publishAt).toISOString() }
        : { privacyStatus: privacyStatus || "private" },
    },
    media: { body: Readable.from(videoBuffer) },
  });
  const videoId = uploadRes.data.id;

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
  });
  emit({ status: "مرحله ۵ از ۵: در حال تنظیم تامبنیل و زیرنویس...", progress: 92 });

  // --- ۵. تامبنیل ---
  let thumbnailStatus = "skipped";
  try {
    const thumbBuffer = await buildMayaThumbnail({
      title,
      thumbnailText,
      script,
      bgImageUrl,
      variant: "A",
    });
    await youtube.thumbnails.set({
      videoId,
      media: { mimeType: "image/png", body: Readable.from(thumbBuffer) },
    });
    thumbnailStatus = "ok";
  } catch (thumbErr) {
    console.error("thumbnail error:", thumbErr.message);
    thumbnailStatus = "failed: " + thumbErr.message;
  }

  // بخش‌های بالا (captions/durations) با تعداد آیتم‌های رسانه هماهنگن، نه با
  // طول خوانا برای زیرنویس — قبل از ساختِ SRT به بلوک‌های ۵ تا ۱۰ ثانیه‌ای
  // بازچینی می‌شن؛ segmentation رسانه/رندرِ بالا (mediaItems، renderVideo)
  // دست‌نخورده می‌مونه.
  const { captions: subtitleCaptions, durations: subtitleDurations } = regroupForSubtitles(
    captions,
    durations
  );

  // --- ۶. زیرنویس انگلیسی ---
  let captionStatus = "skipped";
  try {
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

  return {
    videoId,
    thumbnailStatus,
    captionStatus,
    translatedCaptionsSummary,
    communityPostStatus,
    communityPostDraft,
  };
}
