import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { getWorkerJob } from "@/lib/db/index.js";

// ۲۰۲۶-۰۸-۱۸ — قبلاً این route وضعیت رو با runId از GitHub Actions API
// می‌گرفت، ولی هیچ‌جای کد runId واقعیِ گیت‌هاب رو برنمی‌گردوند (dispatch
// از طریق workflow_dispatch جواب ۲۰۴ بدونِ بدنه می‌ده، جایی که runId
// توش نیست) — یعنی این route عملاً از هیچ مسیری صدا زده نمی‌شد. حالا
// مستقیم رو jobId خودمون (که از همون لحظه‌ی dispatch در دسترسه) و
// جدولِ worker_jobs کار می‌کنه؛ همون jobIdی که وقتِ dispatch به کلاینت
// برگردونده می‌شه.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const job = await getWorkerJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({
      jobId: job.job_id,
      jobType: job.job_type,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    });
  } catch (err) {
    console.error("Job status error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
