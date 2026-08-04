import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { google } from "googleapis";
import { Readable } from "stream";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { fetchImages, fetchClips } from "../../../lib/media";
import { renderVideo, estimateAudioDurationSec } from "../../../lib/videoRender";
import { distributeDurations } from "../../../lib/scriptTiming";
import { buildMayaThumbnail } from "../../../lib/mayaThumbnail";
import { recordVideo } from "../../../lib/db";

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
    tags: tagsRaw,
    privacyStatus,
    publishAt,
    videoMode,
    useVideoClips,
    imageKeyword,
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
        const mediaCount = isShort
          ? 6
          : Math.min(24, Math.max(6, Math.ceil(audioDurationSec / 15)));
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
        send({ status: "مرحله ۴ از ۵: در حال آپلود در یوتیوب...", progress: 85 });
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: accessToken });
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
        });
        send({ status: "مرحله ۵ از ۵: در حال تنظیم تامبنیل...", progress: 92 });

        // --- ۵. تامبنیل ---
        let thumbnailStatus = "skipped";
        try {
          const thumbBuffer = await buildMayaThumbnail({ title, script, bgImageUrl });
          await youtube.thumbnails.set({
            videoId,
            media: { mimeType: "image/png", body: Readable.from(thumbBuffer) },
          });
          thumbnailStatus = "ok";
        } catch (thumbErr) {
          console.error("thumbnail error:", thumbErr.message);
          thumbnailStatus = "failed: " + thumbErr.message;
        }

        send({ done: true, videoId, thumbnailStatus, progress: 100 });
      } catch (err) {
        console.error("generate-and-upload error:", err);
        send({ error: err.message || "خطای نامشخص" });
      } finally {
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
