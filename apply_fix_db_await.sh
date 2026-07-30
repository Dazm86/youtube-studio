cat > src/app/api/generate-and-upload/route.js << 'EOF_ROUTE'
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { google } from "googleapis";
import { Readable } from "stream";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { fetchImages, fetchClips } from "../../../lib/media";
import { renderVideo } from "../../../lib/videoRender";
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

        // --- ۲. گرفتن عکس/کلیپ ---
        const isShort = videoMode === "short";
        const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
        const estimatedSeconds = (wordCount / 140) * 60;
        const mediaCount = isShort
          ? 6
          : Math.min(24, Math.max(6, Math.ceil(estimatedSeconds / 15)));

        send({
          status: useVideoClips
            ? "مرحله ۲ از ۵: در حال گرفتن کلیپ ویدیویی..."
            : "مرحله ۲ از ۵: در حال گرفتن عکس...",
          progress: 10,
        });
        const orientation = isShort ? "portrait" : "landscape";
        const mediaResult = useVideoClips
          ? await fetchClips({
              text: script,
              keyword: imageKeyword,
              count: mediaCount,
              orientation,
            })
          : await fetchImages({
              text: script,
              keyword: imageKeyword,
              count: mediaCount,
              orientation,
            });
        const mediaItems = useVideoClips ? mediaResult.clips : mediaResult.images;
        const bgImageUrl = mediaItems[0] || "";
        send({ status: "رسانه‌ها آماده شد ✅", progress: 15 });

        // --- ۳. رندر ویدیو ---
        send({ status: "مرحله ۳ از ۵: در حال رندر ویدیو...", progress: 16 });
        const videoBuffer = await renderVideo({
          script,
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
EOF_ROUTE
