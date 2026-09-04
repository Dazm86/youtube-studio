import { NextResponse } from "next/server";
import { verifyWorkerCredential, verifyJobPayload } from "@/lib/jobs";
import { updateWorkerJob, getWorkerJob } from "@/lib/db/index.js";
import { logEvent } from "@/lib/activityLog.js";
import { markTrendTopicProduced } from "@/lib/trends/db.js";

// ۲۰۲۶-۰۸-۱۸ — قبلاً یک Map درون‌حافظه‌ای بود که با هر ری‌استارتِ سرور
// (رایج تو Render free tier) پاک می‌شد؛ الان تو دیتابیس ماندگاره.
export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const credential = authHeader?.replace("Bearer ", "");

    if (!credential) {
      return NextResponse.json({ error: "Missing credentials" }, { status: 401 });
    }

    const verified = verifyWorkerCredential(credential);
    if (!verified) {
      return NextResponse.json({ error: "Invalid or expired credentials" }, { status: 401 });
    }

    const { jobId } = verified;
    const body = await request.json();
    const { payload, signature, status, result, error } = body;

    // اگه payload/signature هم فرستاده شده باشه (برای integrity extra)، چکش کن.
    if (payload && signature && !verifyJobPayload(payload, signature)) {
      return NextResponse.json({ error: "Invalid payload signature" }, { status: 401 });
    }

    await updateWorkerJob(jobId, {
      status: status || (error ? "failed" : "completed"),
      result,
      error,
    });

    // بخشِ گزارش/فعالیت — این مسیرِ جدا از لاگِ خودِ pipeline.js تو
    // runPipeline() هست، چون اینجا رندرِ واقعی رویِ ماشینِ GitHub
    // Actions (worker) اتفاق افتاده، نه این پروسه؛ pipeline.js فقط
    // مسیرِ in-process رو می‌بینه.
    if (!error && result?.videoId) {
      logEvent({
        type: "video_uploaded",
        message: `ویدیو با موفقیت آپلود شد (Worker، Job ${jobId})`,
        metadata: { videoId: result.videoId, jobId, viaWorker: true },
      });

      // ۲۰۲۶-۰۹-۰۵ — بستنِ حلقه‌ی Trend Finder برایِ مسیرِ worker. تو
      // مسیرِ in-process این کار رو lib/autoProduce.js:autoProduceVideo()
      // مستقیم انجام می‌ده چون videoId همون‌جا در دسترسه؛ این‌جا آپلود
      // async و دقیقه‌ها بعد از dispatch کامل می‌شه. trendTopicId رو از
      // رویِ خودِ ردیفِ worker_jobs می‌خونیم (input jsonb، همونی که
      // api/auto-produce/route.js موقعِ dispatch توش گذاشته) — نه از
      // payload اکوشده، چون worker/index.js:reportResult() اصلاً
      // payload/signature رو تو بدنه‌ی این callback نمی‌فرسته (فقط
      // status/result/error)، پس چکِ `payload && signature` چند خط
      // بالاتر همیشه false بوده و هست.
      try {
        const jobRow = await getWorkerJob(jobId);
        const trendTopicId = jobRow?.input?.trendTopicId;
        if (trendTopicId) {
          await markTrendTopicProduced(trendTopicId, result.videoId);
        }
      } catch (markErr) {
        console.error(
          "markTrendTopicProduced (worker callback) failed (video already uploaded fine):",
          markErr.message
        );
      }
    } else if (error) {
      logEvent({
        type: "video_failed",
        message: `ساختِ ویدیو (Worker، Job ${jobId}) شکست خورد: ${error}`,
        metadata: { jobId, error, viaWorker: true },
      });
    }

    return NextResponse.json({ success: true, jobId });
  } catch (err) {
    console.error("Job callback error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
