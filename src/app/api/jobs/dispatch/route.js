import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { dispatchAndTrackJob, JOB_TYPES } from "@/lib/jobs";
import { getWorkerJob, listStaleWorkerJobs } from "@/lib/db/index.js";

// ۲۰۲۶-۰۸-۱۸ — همون dispatchAndTrackJob مشترکی که generate-and-upload
// هم صداش می‌زنه (credential دیگه گم نمی‌شه) + GET واقعاً از دیتابیس
// می‌خونه (قبلاً هر دو حالتِ GET صراحتاً stub بودن: "not_implemented" و
// آرایه‌ی همیشه‌خالی).
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { jobType, input } = body;

    if (jobType !== JOB_TYPES.RENDER_VIDEO && jobType !== JOB_TYPES.RENDER_SHORT) {
      return NextResponse.json({ error: "Invalid job type" }, { status: 400 });
    }

    const githubToken = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
    if (!githubToken) {
      return NextResponse.json(
        { error: "Worker dispatch not configured (missing GITHUB_TOKEN)" },
        { status: 503 }
      );
    }

    const { jobId } = await dispatchAndTrackJob(jobType, input, {
      githubToken,
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/jobs/callback`,
      webhookUrl: process.env.ALERT_WEBHOOK_URL,
    });

    return NextResponse.json({ success: true, jobId, jobType, status: "queued" });
  } catch (err) {
    console.error("Job dispatch error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");

  if (jobId) {
    const job = await getWorkerJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json(job);
  }

  // بدونِ jobId: jobهای queued/processing که مدتیه گیر کردن (احتمالاً
  // worker بدونِ callback کرش کرده) — برای هشدار تو UI.
  const stale = await listStaleWorkerJobs(30);
  return NextResponse.json({ staleJobs: stale });
}
