import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { getWorkflowRunStatus } from "@/lib/jobs";

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");

    if (!runId) {
      return NextResponse.json({ error: "Missing runId" }, { status: 400 });
    }

    const githubToken = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
    if (!githubToken) {
      return NextResponse.json(
        { error: "GitHub token not configured" },
        { status: 503 }
      );
    }

    const run = await getWorkflowRunStatus(runId, githubToken);

    return NextResponse.json({
      runId: run.id,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      htmlUrl: run.html_url,
      jobsUrl: run.jobs_url,
    });
  } catch (err) {
    console.error("Job status error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}