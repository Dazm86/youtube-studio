import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions, refreshAccessToken } from "@/lib/auth/authOptions";
import { NextResponse } from "next/server";
import { dispatchAndTrackJob, JOB_TYPES } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getAutoProduce() {
  const { autoProduceVideo, prepareAutoProduceScript } = await import("@/lib/autoProduce");
  return { autoProduceVideo, prepareAutoProduceScript };
}

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { mode, topicId, topic, privacyStatus, publishAt, useVideoClips } = body;

  if (mode !== "long" && mode !== "short") {
    return NextResponse.json({ error: 'mode باید "long" یا "short" باشه' }, { status: 400 });
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

      // همون الگوی heartbeat + self-ping ی api/generate-and-upload — این
      // مسیر هم می‌تونه چند دقیقه طول بکشه (سناریو+متادیتا سریعه، ولی
      // voice+رسانه+رندر+آپلود همون هزینه‌ی زمانیِ معمولش رو داره).
      const heartbeat = setInterval(() => send({ ping: true }), 15000);
      const selfPingUrl = process.env.NEXTAUTH_URL;
      const selfPing = selfPingUrl
        ? setInterval(() => {
            fetch(`${selfPingUrl}/api/status`).catch((err) => {
              console.error("self-ping failed:", err.message);
            });
          }, 5 * 60 * 1000)
        : null;

      try {
        const { autoProduceVideo, prepareAutoProduceScript } = await getAutoProduce();
        const useWorker = process.env.USE_RENDER_WORKER === "true";

        if (useWorker) {
          // سناریو+متادیتا همیشه این‌جا (تعاملی، با نشستِ فعلی) آماده
          // می‌شه — دقیقاً همون کاری که api/generate-and-upload هم برای
          // مسیرِ worker انجام می‌ده؛ فقط بخشِ سنگین (رندر+آپلود) به
          // worker سپرده می‌شه.
          const { script, meta, trendTopicRow } = await prepareAutoProduceScript(
            { mode, topicId, topic, accessToken },
            { emit: send }
          );

          send({ status: "در صف پردازش ویدیو (Worker)...", progress: 20 });
          const githubToken = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
          if (!githubToken) {
            throw new Error("Worker dispatch not configured (missing GITHUB_TOKEN)");
          }

          const { jobId } = await dispatchAndTrackJob(
            JOB_TYPES.RENDER_VIDEO,
            {
              script,
              title: meta.titleA || meta.title,
              description: meta.description,
              thumbnailText: meta.thumbnailTextA || meta.thumbnailText,
              tags: (meta.tags || []).join(", "),
              titleB: meta.titleB,
              thumbnailTextB: meta.thumbnailTextB,
              privacyStatus: privacyStatus || "private",
              publishAt,
              videoMode: mode,
              useVideoClips: !!useVideoClips,
              imageKeyword: "",
              // ۲۰۲۶-۰۹-۰۵ — فقط برای این‌که api/jobs/callback بعداً
              // بتونه موضوعِ Trend Finder رو «produced» علامت بزنه؛
              // runPipeline() این فیلد رو نادیده می‌گیره (destructuring
              // صریحه، نه spread به SQL/جای دیگه)، پس اضافه‌کردنش این‌جا
              // بی‌خطره حتی با اینکه همین input عیناً به worker هم می‌ره.
              trendTopicId: trendTopicRow?.id || null,
            },
            {
              githubToken,
              callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/jobs/callback`,
              webhookUrl: process.env.ALERT_WEBHOOK_URL,
            }
          );

          // ۲۰۲۶-۰۹-۰۵ — قبلاً این‌جا videoId در دسترس نبود (آپلود
          // async و دقیقه‌ها بعد، از طریقِ callback انجام می‌شه)، پس
          // موضوعِ Trend Finder خودکار «produced» نمی‌شد. حالا
          // trendTopicId بالاتر تو input جاب ذخیره شده و
          // api/jobs/callback موقعِ گزارشِ موفقیت خودش از رویِ
          // worker_jobs.input می‌خونتش و markTrendTopicProduced رو صدا
          // می‌زنه — دیگه نیازی به علامت‌زدنِ دستی از /trends نیست.
          send({
            done: true,
            jobId,
            status: "queued",
            progress: 100,
            script,
            title: meta.titleA || meta.title,
            thumbnailText: meta.thumbnailTextA || meta.thumbnailText,
            description: meta.description,
            tags: (meta.tags || []).join(", "),
            topic: trendTopicRow?.topic || topic || "",
            trendTopicId: trendTopicRow?.id || null,
            message: `ویدیو به worker سپرده شد (Job: ${jobId}) — رندر/آپلود ممکنه چند دقیقه طول بکشه؛ از صفحه‌ی ویدیوی ${mode === "short" ? "شورت" : "لانگ"} قابل پیگیریه.`,
          });
        } else {
          const result = await autoProduceVideo(
            {
              mode,
              topicId,
              topic,
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
              privacyStatus,
              publishAt,
              useVideoClips,
            },
            { emit: send }
          );

          send({ done: true, ...result, progress: 100 });
        }
      } catch (err) {
        console.error("auto-produce error:", err);
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
