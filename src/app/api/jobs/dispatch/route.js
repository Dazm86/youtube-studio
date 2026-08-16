import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import {
  createJobPayload,
  signJobPayload,
  generateWorkerCredential,
  dispatchWorkerJob,
  JOB_TYPES,
  JOB_STATUS,
} from "@/lib/jobs";

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { jobType, input, options = {} } = body;

    // Validate job type
    if (!Object.values(JOB_TYPES).includes(jobType)) {
      return NextResponse.json({ error: "Invalid job type" }, { status: 400 });
    }

    // Create job payload
    const jobPayload = createJobPayload(jobType, input, {
      ...options,
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/jobs/callback`,
    });

    // Sign payload for integrity
    const { payload, signature } = signJobPayload(jobPayload);

    // Generate worker credential
    const credential = generateWorkerCredential(jobPayload.jobId);

    // Dispatch to GitHub Actions
    const githubToken = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
    if (!githubToken) {
      return NextResponse.json(
        { error: "Worker dispatch not configured (missing GITHUB_TOKEN)" },
        { status: 503 }
      );
    }

    const { dispatched, jobId } = await dispatchWorkerJob({ ...jobPayload, signature }, githubToken);

    // Store job locally for tracking
    // In production, save to database
    const jobRecord = {
      jobId,
      jobType,
      status: JOB_STATUS.QUEUED,
      userId: session.user.id || session.user.email,
      createdAt: Date.now(),
      payload: jobPayload,
    };

    // TODO: Save to database
    console.log("Job dispatched:", jobRecord);

    return NextResponse.json({
      success: true,
      jobId,
      jobType,
      status: JOB_STATUS.QUEUED,
      credential, // For worker to authenticate callbacks
      callbackUrl: jobPayload.metadata.callbackUrl,
    });
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
    // Return specific job (from DB in production)
    return NextResponse.json({ jobId, status: "not_implemented" });
  }

  // Return user's recent jobs (from DB in production)
  return NextResponse.json({ jobs: [] });
}