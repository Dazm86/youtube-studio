import { NextResponse } from "next/server";
import { verifyWorkerCredential, verifyJobPayload, JOB_STATUS, createJobResult } from "@/lib/jobs";

// In-memory job store (replace with DB in production)
const jobStore = new Map();

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

    // Verify payload signature if provided
    if (payload && signature) {
      if (!verifyJobPayload(payload, signature)) {
        return NextResponse.json({ error: "Invalid payload signature" }, { status: 401 });
      }
    }

    // Update job status
    const job = jobStore.get(jobId) || { jobId, status: JOB_STATUS.PENDING, createdAt: Date.now() };
    job.status = status || (error ? JOB_STATUS.FAILED : JOB_STATUS.COMPLETED);
    job.updatedAt = Date.now();
    job.result = result;
    job.error = error;
    jobStore.set(jobId, job);

    // If there's a webhook URL, notify it
    if (payload?.metadata?.webhookUrl) {
      try {
        await fetch(payload.metadata.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createJobResult(jobId, payload.jobType, job.status, { result, error })),
        });
      } catch (webhookErr) {
        console.error("Webhook notification failed:", webhookErr.message);
      }
    }

    return NextResponse.json({ success: true, jobId, status: job.status });
  } catch (err) {
    console.error("Job callback error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const job = jobStore.get(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(job);
}