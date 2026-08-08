import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions, refreshAccessToken } from "../auth/authOptions";
import { google } from "googleapis";
import { Readable } from "stream";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { fetchImages, fetchClips } from "../../../lib/media";
import { renderVideo, estimateAudioDurationSec } from "../../../lib/videoRender";
import { distributeDurations, buildSrt } from "../../../lib/scriptTiming";
import { translateCaptions } from "../../../lib/translateCaptions";
import { buildMayaThumbnail } from "../../../lib/mayaThumbnail";
import { generateCommunityPost } from "../../../lib/communityPost";
import { recordVideo, recordCommunityPost } from "../../../lib/db";

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const body = await req.json();
  const {
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
  } = body;

  if (!script || !script.trim()) {
    return NextResponse.json({ error: "متنی ارسال نشده" }, { status: 400 });
  }

  const accessToken = session.accessToken;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // کنترلر ممکنه از قبل بسته شده باشه؛ مهم نیست
        }
      };

      const heartbeat = setInterval(() => send({ ping: true }), 15000);

      // نکته‌ی مهم: heartbeat بالا فقط رو همین stream باز، داده می‌فرسته —
      // از نگاه خودِ Render این «ترافیک ورودی جدید» حساب نمی‌شه، چون هیچ
      // درخواست تازه‌ای به سرویس نمی‌رسه، فقط خروجیِ یه درخواستِ قبلاً
      // شروع‌شده ادامه پیدا می‌کنه. Render پلن رایگان رو بعد از ۱۵ دقیقه
      // بدون «درخواست HTTP ورودی تازه» می‌خوابونه — دقیقاً چیزی که خودت با
      // تست دستی کشف کردی. برای همین، جدا از heartbeat، هر ۵ دقیقه یه
      // درخواست HTTP واقعی و تازه به URL عمومی خودِ سایت می‌زنیم؛ همین یکی
      // جلوی خوابیدن سرویس رو می‌گیره.
      const selfPingUrl = process.env.NEXTAUTH_URL;
      const selfPing = selfPingUrl
        ? setInterval(() => {
            fetch(`${selfPingUrl}/api/status`).catch((err) => {
              console.error("self-ping failed:", err.message);
            });
          }, 5 * 60 * 1000)
        : null;

      try {
        // --- ۱. ساخت صدا ---
        send({ status: "مرحله ۱ از ۵: در حال ساخت صدا...", progress: 2 });
        const tts = new MsEdgeTTS();
        await tts.setMetadata(
          "en-US-JennyNeural",
          OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
        );
        const { audioStream } = await tts.toStream(script);
        const chunks = [];
        for await (const chunk of audioStream) chunks.push(chunk);
        const audioBuffer = Buffer.concat(chunks);
        send({ status: "صدا ساخته شد ✅", progress: 8 });

        // --- ۲. تقسیم اسکریپت به بخش‌های زمان‌بندی‌شده + گرفتن عکس/کلیپ مخصوص هر بخش ---
        const isShort = videoMode === "short";
        const audioDurationSec = estimateAudioDurationSec(audioBuffer);
        // سرعت تعویض تصویر: کوتاه هر ۲-۳ ثانیه (محور ۲.۵)، بلند هر ۵-۸ ثانیه
        // (محور ۶.۵) — چون اسکریپت بلند حالا خیلی طولانی‌تره (۱۲۰۰-۱۵۰۰ کلمه،
        // یعنی ~۸-۱۰ دقیقه)، این با تقسیم قبلی (هر ۲۴ ثانیه) فاصله‌ی زیادی داره:
        // تعداد قطعات می‌تونه به ~۶۰-۸۰ برسه. از نظر حافظه مشکلی نیست، چون
        // BATCH_SIZE=1 تو videoRender.js هر قطعه رو کاملاً جدا رندر می‌کنه —
        // ولی یعنی به همون نسبت تعداد درخواست Pexels و رندرهای پی‌درپی بیشتر
        // می‌شه (کل پایپ‌لاین کندتر می‌شه، نه سنگین‌تر). برای همین یه سقف
        // (۸۰) گذاشتیم که از حد معقولی رد نشه.
        const mediaCount = isShort
          ? Math.min(30, Math.max(8, Math.ceil(audioDurationSec / 2.5)))
          : Math.min(80, Math.max(6, Math.ceil(audioDurationSec / 6.5)));
        const { durations, captions } = distributeDurations(
          script,
          mediaCount,
          audioDurationSec
        );

        const orientation = isShort ? "portrait" : "landscape";
        const hasManualKeyword = imageKeyword && imageKeyword.trim();
        const mediaItems = [];

        if (hasManualKeyword) {
          // کلیدواژه‌ی دستی یعنی کاربر می‌خواد همه‌ی رسانه‌ها حول یک موضوع
          // مشخص باشن؛ رفتار قبلی (یک جستجوی کلی برای کل ویدیو) عمداً حفظ می‌شه.
          send({
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
          // حالت خودکار: هر بخش/تایم‌استمپ از اسکریپت جستجوی عکس/کلیپ
          // مخصوص به خودش رو می‌گیره، به‌جای یک جستجوی کلی برای کل اسکریپت.
          for (let i = 0; i < captions.length; i++) {
            send({
              status: `مرحله ۲ از ۵: در حال گرفتن ${
                useVideoClips ? "کلیپ" : "عکس"
              } برای بخش ${i + 1} از ${captions.length}...`,
              progress: 10 + (i / captions.length) * 5,
            });
            const mediaResult = useVideoClips
              ? await fetchClips({ text: captions[i], count: 1, orientation })
              : await fetchImages({ text: captions[i], count: 1, orientation });
            mediaItems.push(
              useVideoClips ? mediaResult.clips[0] : mediaResult.images[0]
            );
          }
        }

        const bgImageUrl = mediaItems[0] || "";
        send({ status: "رسانه‌ها آماده شد ✅", progress: 15 });

        // --- ۳. رندر ویدیو ---
        send({ status: "مرحله ۳ از ۵: در حال رندر ویدیو...", progress: 16 });
        const videoBuffer = await renderVideo({
          durations,
          captions,
          videoMode,
          useVideoClips,
          mediaItems,
          audioBuffer,
          onStatus: (s) => send({ status: "مرحله ۳ از ۵: " + s }),
          onProgress: (p) => send({ progress: 15 + p * 65 }),
        });
        send({ status: "ویدیو رندر شد ✅", progress: 80 });

        // --- ۴. آپلود در یوتیوب ---
        // رندر ممکنه ۱۵-۴۰ دقیقه طول کشیده باشه — یعنی توکنی که اول
        // درخواست گرفتیم ممکنه الان منقضی شده باشه. یه بار دیگه، همین‌جا،
        // با refresh_token یه توکن تازه می‌گیریم، نه این‌که به توکن اولیه
        // اعتماد کنیم.
        let uploadAccessToken = accessToken;
        try {
          const rawToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
          if (rawToken && rawToken.refreshToken) {
            const refreshed = await refreshAccessToken(rawToken);
            if (refreshed.accessToken) uploadAccessToken = refreshed.accessToken;
          }
        } catch (refreshErr) {
          console.error("token refresh before upload failed:", refreshErr.message);
        }

        send({ status: "مرحله ۴ از ۵: در حال آپلود در یوتیوب...", progress: 85 });
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
            snippet: {
              title: title || "بدون عنوان",
              description: description || "",
              tags,
            },
            status: publishAt
              ? {
                  privacyStatus: "private",
                  publishAt: new Date(publishAt).toISOString(),
                }
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
        send({ status: "مرحله ۵ از ۵: در حال تنظیم تامبنیل و زیرنویس...", progress: 92 });

        // --- ۵. تامبنیل ---
        // فقط نسخه‌ی A همین‌جا واقعاً روی ویدیو ست می‌شه — نسخه‌ی B تو
        // دیتابیس نگه داشته می‌شه و بعداً از طریق api/ab-test می‌شه بهش
        // سوییچ کرد (چون یوتیوب split-test هم‌زمان از طریق API نمی‌ده).
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

        // --- ۶. زیرنویس (SRT جدا، نه سوخته تو تصویر) ---
        // همون بخش‌بندی/زمان‌بندی‌ای که برای جستجوی رسانه استفاده شد اینجا
        // هم به‌کار می‌ره، پس زیرنویس همیشه با ویدیوی رندرشده هم‌زمانه.
        // این مسیر یه زبان (انگلیسی) رو آپلود می‌کنه؛ برای چندزبانه کردن،
        // کافیه همین متن ترجمه بشه و با language/name متفاوت دوباره insert بشه.
        let captionStatus = "skipped";
        try {
          const srtContent = buildSrt(captions, durations);
          await youtube.captions.insert({
            part: ["snippet"],
            requestBody: {
              snippet: { videoId, language: "en", name: "English", isDraft: false },
            },
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
        // همون متنِ بخش‌بندی‌شده (captions) که برای SRT انگلیسی استفاده شد،
        // اینجا هم پایه‌ست — فقط ترجمه می‌شه، تایمینگ (durations) عوض نمی‌شه.
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
            send({
              status: `در حال ترجمه و آپلود زیرنویس ${lang.name}...`,
              progress: 96,
            });
            const translated = await translateCaptions(captions, lang.name);
            const translatedSrt = buildSrt(translated, durations);
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
        // فقط پیش‌نویسه — یوتیوب راهی برای انتشار خودکار تو تب Community
        // از طریق API عمومی نمی‌ده (توضیح کامل تو lib/communityPost.js).
        // هیچ خطایی اینجا نباید کل آپلود رو خراب کنه، دقیقاً مثل
        // تامبنیل/زیرنویس.
        let communityPostStatus = "skipped";
        let communityPostDraft = null;
        if (!isShort && process.env.GROQ_API_KEY) {
          try {
            send({ status: "در حال ساخت پیش‌نویس پست کامیونیتی...", progress: 98 });
            communityPostDraft = await generateCommunityPost({ title, script });
            await recordCommunityPost({ videoId, ...communityPostDraft });
            communityPostStatus = "ok";
          } catch (postErr) {
            console.error("community post generation failed:", postErr.message);
            communityPostStatus = "failed: " + postErr.message;
          }
        }

        send({
          done: true,
          videoId,
          thumbnailStatus,
          captionStatus,
          translatedCaptionsSummary,
          communityPostStatus,
          communityPostDraft,
          progress: 100,
        });
      } catch (err) {
        console.error("generate-and-upload error:", err);
        send({ error: err.message || "خطای نامشخص" });
      } finally {
        clearInterval(heartbeat);
        if (selfPing) clearInterval(selfPing);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
