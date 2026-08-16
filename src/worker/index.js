#!/usr/bin/env node
/**
 * Video Render Worker Entry Point
 *
 * This worker is triggered by GitHub Actions to process video rendering jobs.
 * It receives a job payload, processes it using FFmpeg, and returns results.
 *
 * Usage: node src/worker/index.js <job_id> <job_type> <payload_json>
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

// Dynamic imports for native modules to avoid build-time issues on unsupported platforms
async function getSharp() {
  const sharp = await import("sharp");
  return sharp.default;
}

async function getRendering() {
  const { renderVideo, probeDurationSec, estimateAudioDurationSec } = await import("../lib/rendering/index.js");
  return { renderVideo, probeDurationSec, estimateAudioDurationSec };
}

async function getMayaThumbnail() {
  const { buildMayaThumbnail, capThumbnailWords } = await import("../lib/rendering/mayaThumbnail.js");
  return { buildMayaThumbnail, capThumbnailWords };
}

import { synthesizeSpeech, generateText, fetchImages, fetchClips } from "../lib/providers/router.js";
import { distributeDurations, buildSrt, validateSrt, regroupForSubtitles } from "../lib/script/timing.js";
import { translateCaptions } from "../lib/script/translate.js";
import { google } from "googleapis";
import { Readable } from "stream";
import { verifyWorkerCredential } from "../lib/jobs/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..", "..");

const ffmpegPath = ffmpegInstaller.path;

// Job types
const JOB_TYPES = {
  RENDER_VIDEO: "render_video",
  RENDER_SHORT: "render_short",
  GENERATE_THUMBNAIL: "generate_thumbnail",
  GENERATE_SCRIPT: "generate_script",
  SYNTHESIZE_SPEECH: "synthesize_speech",
  FETCH_MEDIA: "fetch_media",
};

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, ...data };
  console.log(JSON.stringify(entry));
}

async function runFfmpeg(args, { stdinData } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    proc.stdout.on("data", (c) => chunks.push(c));
    let stderr = "";
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exit ${code}: ${stderr}`));
    });
    if (stdinData) proc.stdin.write(stdinData);
    proc.stdin.end();
  });
}

async function renderVideoJob(payload) {
  const {
    script,
    title,
    description,
    thumbnailText,
    tags,
    privacyStatus,
    publishAt,
    videoMode,
    useVideoClips,
    imageKeyword,
    titleB,
    thumbnailTextB,
    accessToken,
    durations: providedDurations,
    captions: providedCaptions,
    mediaItems: providedMediaItems,
    audioBuffer: providedAudioBuffer,
  } = payload;

  const isShort = videoMode === "short";
  const orientation = isShort ? "portrait" : "landscape";

  // 1. Generate audio if not provided
  let audioBuffer = providedAudioBuffer;
  if (!audioBuffer) {
    log("info", "Generating speech", { jobId: payload.jobId });
    const { buffer } = await synthesizeSpeech({ text: script });
    audioBuffer = buffer;
  }

  // 2. Estimate audio duration
  const { estimateAudioDurationSec } = await getRendering();
  const audioDurationSec = await estimateAudioDurationSec(audioBuffer);
  log("info", "Audio duration estimated", { durationSec: audioDurationSec });

  // 3. Get media items if not provided
  let mediaItems = providedMediaItems || [];
  if (!mediaItems.length) {
    const mediaCount = isShort
      ? Math.min(30, Math.max(8, Math.ceil(audioDurationSec / 2.5)))
      : Math.min(80, Math.max(6, Math.ceil(audioDurationSec / 6.5)));

    log("info", "Fetching media", { count: mediaCount, orientation });
    const mediaResult = useVideoClips
      ? await fetchClips({ keyword: imageKeyword || "", count: mediaCount, orientation })
      : await fetchImages({ keyword: imageKeyword || "", count: mediaCount, orientation });
    mediaItems = useVideoClips ? mediaResult.clips : mediaResult.images;
  }

  // 4. Prepare segments (durations + captions)
  let { durations, captions } = providedDurations && providedCaptions
    ? { durations: providedDurations, captions: providedCaptions }
    : distributeDurations(script, mediaItems.length, audioDurationSec);

  // 5. Render video
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "worker-render-"));
  const outputPath = path.join(tmpDir, "output.mp4");

  try {
    log("info", "Starting video render", { jobId: payload.jobId });

    const { renderVideo, probeDurationSec } = await getRendering();

    const assets = mediaItems.map((item, i) => ({
      type: useVideoClips ? "video" : "image",
      buffer: item.buffer || null,
      path: item.path || null,
      durationSec: item.durationSec,
      loop: item.loop,
    }));

    await renderVideo({
      script,
      segments: captions.map((text, i) => ({
        text,
        startSec: durations[i].startSec,
        endSec: durations[i].endSec,
      })),
      assets,
      outputPath,
      opts: {
        width: isShort ? 720 : 1920,
        height: isShort ? 1280 : 1080,
        fps: 30,
        fontPath: path.join(PROJECT_ROOT, "public", "fonts", "DejaVuSans-Bold.ttf"),
        fontSize: isShort ? 44 : 48,
        bgmPath: null, // Could be added from payload
        bgmVolume: 0.12,
      },
    });

    const videoBuffer = await fsp.readFile(outputPath);
    const durationSec = await probeDurationSec(outputPath);

    log("info", "Video render complete", { durationSec, size: videoBuffer.length });

    return { videoBuffer, durationSec };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function renderShortJob(payload) {
  const { sourceBuffer, startSec, durationSec, captionLines } = payload;

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "worker-short-"));
  const inputPath = path.join(tmpDir, "source.mp4");
  const outputPath = path.join(tmpDir, "short_output.mp4");
  const fontPath = path.join(PROJECT_ROOT, "public", "fonts", "DejaVuSans-Bold.ttf");

  try {
    await fsp.writeFile(inputPath, sourceBuffer);

    const W = 720;
    const H = 1280;
    const coverW = 900;
    const coverH = 1600;
    const smallW = Math.round(coverW / 4);
    const smallH = Math.round(coverH / 4);

    // Check for audio stream
    const hasAudio = await new Promise((resolve) => {
      const proc = spawn(ffmpegPath, ["-i", inputPath]);
      let stderrAll = "";
      proc.stderr.on("data", (chunk) => (stderrAll += chunk.toString()));
      proc.on("error", () => resolve(false));
      proc.on("close", () => resolve(/Stream #\d+:\d+.*Audio:/.test(stderrAll)));
    });

    const FADE = 0.25;
    const captionFilters = (captionLines || [])
      .map((line, i) => {
        const text = String(line.text || "")
          .replace(/\\/g, "\\\\")
          .replace(/:/g, "\\:")
          .replace(/'/g, "\\'")
          .replace(/%/g, "\\%")
          .replace(/\[/g, "\\[")
          .replace(/\]/g, "\\]");
        const s = Math.max(0, line.startSec || 0);
        const e = Math.max(s + 0.1, line.endSec || s + 1);
        const alphaExpr =
          `if(lt(t,${s}),0,` +
          `if(lt(t,${(s + FADE).toFixed(2)}),(t-${s})/${FADE},` +
          `if(lt(t,${(e - FADE).toFixed(2)}),1,` +
          `if(lt(t,${e}),(${e}-t)/${FADE},0))))`;
        return (
          `drawtext=fontfile=${fontPath}:text='${text}':fontsize=44:fontcolor=white:` +
          `borderw=3:bordercolor=black@0.8:x=(w-text_w)/2:y=h-260:` +
          `enable='between(t,${s},${e})':alpha='${alphaExpr}'`
        );
      })
      .join(",");

    const filter =
      `[0:v]trim=start=${startSec.toFixed(2)}:duration=${durationSec.toFixed(2)},setpts=PTS-STARTPTS,` +
      `split=2[bg][fg];` +
      `[bg]scale=${coverW}:${coverH}:force_original_aspect_ratio=increase,crop=${coverW}:${coverH},` +
      `scale=${smallW}:${smallH},gblur=sigma=8,scale=${coverW}:${coverH}[bgblur];` +
      `[fg]scale=${coverW}:${coverH}:force_original_aspect_ratio=decrease[fgs];` +
      `[bgblur][fgs]overlay=(W-w)/2:(H-h)/2,scale=${W}:${H},format=yuv420p` +
      (captionFilters ? `,${captionFilters}` : "") +
      `[vout]` +
      (hasAudio
        ? `;[0:a]atrim=start=${startSec.toFixed(2)}:duration=${durationSec.toFixed(2)},asetpts=PTS-STARTPTS[aout]`
        : "");

    const args = [
      "-i", inputPath,
      "-filter_complex", filter,
      "-map", "[vout]",
      ...(hasAudio ? ["-map", "[aout]"] : []),
      "-t", durationSec.toFixed(2),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-b:v", "2500k",
      ...(hasAudio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
      "-y", outputPath,
    ];

    await runFfmpeg(args);
    const outputBuffer = await fsp.readFile(outputPath);
    return { videoBuffer: outputBuffer };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function generateThumbnailJob(payload) {
  const { title, thumbnailText, script, bgImageUrl, variant } = payload;
  log("info", "Generating thumbnail", { variant });

  const { buildMayaThumbnail, capThumbnailWords } = await getMayaThumbnail();

  const thumbBuffer = await buildMayaThumbnail({
    title,
    thumbnailText: capThumbnailWords(thumbnailText || title, 4),
    script,
    bgImageUrl,
    variant: variant || "A",
  });

  return { thumbnailBuffer: thumbBuffer };
}

async function generateScriptJob(payload) {
  const { topic, videoMode, durationMinutes, tone, language } = payload;
  log("info", "Generating script", { topic, videoMode });

  const prompt = `Write a ${durationMinutes}-minute ${videoMode} YouTube script about "${topic}".
Tone: ${tone || "informative and engaging"}
Language: ${language || "English"}

Structure:
- Hook (first 15 seconds)
- Main content divided into clear sections
- Call to action at the end
- Include visual cues for B-roll/media suggestions

Output as JSON: { "script": "...", "title": "...", "thumbnailText": "...", "tags": "..." }`;

  const { text } = await generateText({ prompt, system: "You are an expert YouTube scriptwriter." });

  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch {
    // Fallback if JSON parsing fails
    return { script: text, title: topic, thumbnailText: topic, tags: "" };
  }
}

async function synthesizeSpeechJob(payload) {
  const { text, voice } = payload;
  log("info", "Synthesizing speech", { textLength: text.length });

  const { buffer } = await synthesizeSpeech({ text, voice });
  return { audioBuffer: buffer };
}

async function fetchMediaJob(payload) {
  const { query, count, orientation, type } = payload;
  log("info", "Fetching media", { query, count, type });

  if (type === "video") {
    const result = await fetchClips({ text: query, count, orientation });
    return { clips: result.clips };
  } else {
    const result = await fetchImages({ text: query, count, orientation });
    return { images: result.images };
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error("Usage: node src/worker/index.js <job_id> <job_type> <payload_json>");
    console.error("Job types:", Object.values(JOB_TYPES).join(", "));
    process.exit(1);
  }

  const [jobId, jobType, payloadJson] = args;
  let payload;

  try {
    payload = JSON.parse(payloadJson);
  } catch (err) {
    log("error", "Invalid payload JSON", { error: err.message });
    process.exit(1);
  }

  payload.jobId = jobId;

  // Verify worker credential if provided in payload
  if (payload.credential) {
    const verified = verifyWorkerCredential(payload.credential);
    if (!verified || verified.jobId !== jobId) {
      log("error", "Invalid worker credential", { jobId });
      process.exit(1);
    }
    log("info", "Worker credential verified", { jobId });
  }

  log("info", "Starting job", { jobId, jobType });

  try {
    let result;

    switch (jobType) {
      case JOB_TYPES.RENDER_VIDEO:
        result = await renderVideoJob(payload);
        break;
      case JOB_TYPES.RENDER_SHORT:
        result = await renderShortJob(payload);
        break;
      case JOB_TYPES.GENERATE_THUMBNAIL:
        result = await generateThumbnailJob(payload);
        break;
      case JOB_TYPES.GENERATE_SCRIPT:
        result = await generateScriptJob(payload);
        break;
      case JOB_TYPES.SYNTHESIZE_SPEECH:
        result = await synthesizeSpeechJob(payload);
        break;
      case JOB_TYPES.FETCH_MEDIA:
        result = await fetchMediaJob(payload);
        break;
      default:
        throw new Error(`Unknown job type: ${jobType}`);
    }

    // Output result as JSON for GitHub Actions to capture
    const output = {
      jobId,
      jobType,
      status: "success",
      result,
      completedAt: new Date().toISOString(),
    };

    console.log("WORKER_RESULT:" + JSON.stringify(output));
    log("info", "Job completed successfully", { jobId, jobType });
    process.exit(0);
  } catch (err) {
    const output = {
      jobId,
      jobType,
      status: "failed",
      error: err.message,
      stack: err.stack,
      completedAt: new Date().toISOString(),
    };

    console.log("WORKER_RESULT:" + JSON.stringify(output));
    log("error", "Job failed", { jobId, jobType, error: err.message });
    process.exit(1);
  }
}

main();