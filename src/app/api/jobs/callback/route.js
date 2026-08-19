import { NextResponse } from "next/server";
import { verifyWorkerCredential, verifyJobPayload } from "@/lib/jobs";
import { updateWorkerJob } from "@/lib/db/index.js";

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

    return NextResponse.json({ success: true, jobId });
  } catch (err) {
    console.error("Job callback error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
