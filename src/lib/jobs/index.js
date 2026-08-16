/**
 * Job Queue System for Web App ↔ Worker Communication
 *
 * This module provides:
 * - Job creation and management
 * - Signed credential generation for secure worker communication
 * - Job status tracking
 * - Webhook/callback handling for job completion
 */

import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

// Job types
export const JOB_TYPES = {
  RENDER_VIDEO: "render_video",
  RENDER_SHORT: "render_short",
  GENERATE_THUMBNAIL: "generate_thumbnail",
  GENERATE_SCRIPT: "generate_script",
  SYNTHESIZE_SPEECH: "synthesize_speech",
  FETCH_MEDIA: "fetch_media",
};

// Job statuses
export const JOB_STATUS = {
  PENDING: "pending",
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  EXPIRED: "expired",
};

// Default job TTL (24 hours)
export const DEFAULT_JOB_TTL_MS = 24 * 60 * 60 * 1000;

// Worker authentication
const WORKER_API_KEY = process.env.WORKER_API_KEY;
const WORKER_SIGNING_SECRET = process.env.WORKER_SIGNING_SECRET || process.env.WORKER_API_KEY;
const WEB_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * Generate a signed credential for worker authentication
 * Uses HMAC-SHA256 with timestamp to prevent replay attacks
 */
export function generateWorkerCredential(jobId, expiresInMs = 5 * 60 * 1000) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + expiresInMs;
  const payload = `${jobId}.${issuedAt}.${expiresAt}`;
  const signature = crypto
    .createHmac("sha256", WORKER_SIGNING_SECRET)
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

/**
 * Verify a worker credential
 */
export function verifyWorkerCredential(credential) {
  if (!credential || !WORKER_SIGNING_SECRET) return false;

  const parts = credential.split(".");
  if (parts.length !== 4) return false;

  const [jobId, issuedAt, expiresAt, signature] = parts;
  const payload = `${jobId}.${issuedAt}.${expiresAt}`;
  const expectedSignature = crypto
    .createHmac("sha256", WORKER_SIGNING_SECRET)
    .update(payload)
    .digest("hex");

  // Constant-time comparison
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return false;
  }

  const now = Date.now();
  if (now < parseInt(issuedAt) || now > parseInt(expiresAt)) {
    return false;
  }

  return { jobId, issuedAt: parseInt(issuedAt), expiresAt: parseInt(expiresAt) };
}

/**
 * Create a job payload for the worker
 */
export function createJobPayload(jobType, input, options = {}) {
  const jobId = options.jobId || uuidv4();
  const now = Date.now();
  const expiresAt = options.expiresAt || now + (options.ttlMs || DEFAULT_JOB_TTL_MS);

  const payload = {
    jobId,
    jobType,
    input,
    metadata: {
      createdAt: now,
      expiresAt,
      priority: options.priority || "normal",
      callbackUrl: options.callbackUrl || `${WEB_APP_URL}/api/jobs/callback`,
      webhookUrl: options.webhookUrl,
      retryCount: 0,
      maxRetries: options.maxRetries || 3,
    },
  };

  return payload;
}

/**
 * Sign a job payload for secure transmission
 */
export function signJobPayload(payload) {
  const payloadStr = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", WORKER_SIGNING_SECRET)
    .update(payloadStr)
    .digest("hex");
  return { payload, signature };
}

/**
 * Verify a signed job payload
 */
export function verifyJobPayload(payload, signature) {
  const payloadStr = JSON.stringify(payload);
  const expectedSignature = crypto
    .createHmac("sha256", WORKER_SIGNING_SECRET)
    .update(payloadStr)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

/**
 * Trigger a GitHub Actions workflow for a job
 */
export async function triggerWorkerJob(jobPayload, githubToken) {
  const { jobId, jobType } = jobPayload;
  const owner = process.env.GITHUB_REPOSITORY_OWNER || "Dazm86";
  const repo = process.env.GITHUB_REPOSITORY_NAME || "youtube-studio";

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "render_job",
        client_payload: {
          job_id: jobId,
          job_type: jobType,
          payload: JSON.stringify(jobPayload),
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to trigger worker: ${response.status} ${error}`);
  }

  return { triggered: true, jobId };
}

/**
 * Trigger a GitHub Actions workflow using workflow_dispatch
 */
export async function dispatchWorkerJob(jobPayload, githubToken) {
  const { jobId, jobType } = jobPayload;
  const owner = process.env.GITHUB_REPOSITORY_OWNER || "Dazm86";
  const repo = process.env.GITHUB_REPOSITORY_NAME || "youtube-studio";

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/render-worker.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          job_id: jobId,
          job_type: jobType,
          payload: JSON.stringify(jobPayload),
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to dispatch worker: ${response.status} ${error}`);
  }

  return { dispatched: true, jobId };
}

/**
 * Get GitHub Actions workflow run status
 */
export async function getWorkflowRunStatus(runId, githubToken) {
  const owner = process.env.GITHUB_REPOSITORY_OWNER || "Dazm86";
  const repo = process.env.GITHUB_REPOSITORY_NAME || "youtube-studio";

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`,
    {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get workflow status: ${response.status}`);
  }

  return response.json();
}

/**
 * Poll for job completion (for synchronous operations)
 */
export async function pollJobCompletion(jobId, githubToken, options = {}) {
  const { intervalMs = 10000, timeoutMs = 30 * 60 * 1000 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    // In a real implementation, this would check a job status store
    // For now, we'll check GitHub Actions runs
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    // Could implement checking workflow runs here
    // This is a placeholder for the polling logic
  }

  throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms`);
}

/**
 * Job result structure (what the worker returns)
 */
export function createJobResult(jobId, jobType, status, data = {}) {
  return {
    jobId,
    jobType,
    status,
    ...data,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Parse worker result from stdout
 */
export function parseWorkerResult(stdout) {
  const prefix = "WORKER_RESULT:";
  const lines = stdout.split("\n");
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      try {
        return JSON.parse(line.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export default {
  JOB_TYPES,
  JOB_STATUS,
  generateWorkerCredential,
  verifyWorkerCredential,
  createJobPayload,
  signJobPayload,
  verifyJobPayload,
  triggerWorkerJob,
  dispatchWorkerJob,
  getWorkflowRunStatus,
  pollJobCompletion,
  createJobResult,
  parseWorkerResult,
};