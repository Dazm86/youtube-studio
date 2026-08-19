import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions, refreshAccessToken } from "@/lib/auth/authOptions";
import { NextResponse } from "next/server";
import { dispatchAndTrackJob, JOB_TYPES } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getRunPipeline() {
  const { runPipeline } = await import("@/lib/pipeline");
  return runPipeline;
}

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
      // بدون «درخواست HTTP ورودی تازه» می‌خوابونه. برای همین، جدا از
      // heartbeat، هر ۵ دقیقه یه درخواست HTTP واقعی و تازه به URL عمومی
      // خودِ سایت می‌زنیم؛ همین یکی جلوی خوابیدن سرویس رو می‌گیره.
      const selfPingUrl = process.env.NEXTAUTH_URL;
      const selfPing = selfPingUrl
        ? setInterval(() => {
            fetch(`${selfPingUrl}/api/status`).catch((err) => {
              console.error("self-ping failed:", err.message);
            });
          }, 5 * 60 * 1000)
        : null;

      try {
        // Check if worker is enabled
        const useWorker = process.env.USE_RENDER_WORKER === "true";

        if (useWorker) {
          // Dispatch to worker
          send({ status: "در صف پردازش ویدیو (Worker)...", progress: 5 });

          const githubToken = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
          if (!githubToken) {
            throw new Error("Worker dispatch not configured (missing GITHUB_TOKEN)");
          }

          // accessToken اینجا عمداً فرستاده نمی‌شه — worker خودش موقعِ
          // آپلود (که ممکنه دقیقه‌ها بعد از dispatch باشه) یک توکنِ تازه
          // مستقیم از دیتابیس/گوگل می‌گیره (همون الگویِ scheduler/run)،
          // پس این توکنِ کوتاه‌عمر تا اون موقع منقضی می‌شد.
          const { jobId } = await dispatchAndTrackJob(
            JOB_TYPES.RENDER_VIDEO,
            {
              script, title, description, thumbnailText, tags: tagsRaw, privacyStatus, publishAt,
              videoMode, useVideoClips, imageKeyword, titleB, thumbnailTextB,
            },
            {
              githubToken,
              callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/jobs/callback`,
              webhookUrl: process.env.ALERT_WEBHOOK_URL,
            }
          );

          send({
            done: true,
            jobId,
            status: "queued",
            progress: 10,
            message: `ویدیو به worker سپرده شد (Job: ${jobId}) — رندر/آپلود ممکنه چند دقیقه طول بکشه؛ از همین صفحه وضعیتش قابل پیگیریه.`,
          });
        } else {
          // Run in-process (current behavior)
          const runPipeline = await getRunPipeline();
          const result = await runPipeline(
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
              getUploadAccessToken: async () => {
                try {
                  const rawToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
                  if (rawToken && rawToken.refreshToken) {
                    const refreshed = await refreshAccessToken(rawToken);
                    if (refreshed.accessToken) return refreshed.accessToken;
                  }
                } catch (refreshErr) {
                  console.error("token refresh before upload failed:", refreshErr.message);
                }
                return accessToken;
              },
            },
            { emit: send }
          );

          send({ done: true, ...result, progress: 100 });
        }
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
