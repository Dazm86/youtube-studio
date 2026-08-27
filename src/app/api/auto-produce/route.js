// «تولید کاملاً خودکار» (۲۰۲۶-۰۸-۲۷) — همون الگوی استریمِ NDJSON و
// نگه‌داشتنِ زنده‌ی اتصال (heartbeat + self-ping) که
// api/generate-and-upload/route.js داره، چون این‌جا هم رندر می‌تونه
// ۱۵-۴۰ دقیقه طول بکشه و باید جلوی خوابیدنِ Render free tier رو بگیره.
// تنها فرقش: بدنه‌ی درخواست script/title/... نمی‌خواد — فقط mode (و
// چندتا تنظیماتِ اختیاریِ انتشار) — چون موضوع/سناریو/متادیتا رو خودِ
// runAutoProduce می‌سازه.

import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions, refreshAccessToken } from "@/lib/auth/authOptions";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getRunAutoProduce() {
  const { runAutoProduce } = await import("@/lib/autoProduce.js");
  return runAutoProduce;
}

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { videoMode, privacyStatus, publishAt, useVideoClips } = body;
  const mode = videoMode === "short" ? "short" : "long";

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

      // نگاه کن api/generate-and-upload/route.js برای توضیحِ کاملِ چرایی —
      // heartbeat به‌تنهایی کافی نیست چون از دیدِ Render «درخواستِ ورودیِ
      // تازه» حساب نمی‌شه؛ این self-ping هر ۵ دقیقه هست که واقعاً بیدار
      // نگهش می‌داره.
      const selfPingUrl = process.env.NEXTAUTH_URL;
      const selfPing = selfPingUrl
        ? setInterval(() => {
            fetch(`${selfPingUrl}/api/status`).catch((err) => {
              console.error("self-ping failed:", err.message);
            });
          }, 5 * 60 * 1000)
        : null;

      try {
        const runAutoProduce = await getRunAutoProduce();
        const result = await runAutoProduce(
          {
            mode,
            privacyStatus,
            publishAt,
            useVideoClips,
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
