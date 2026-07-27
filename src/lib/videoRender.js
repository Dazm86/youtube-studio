import { spawn } from "child_process";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { distributeDurations, escapeDrawtext, wrapCaption } from "./scriptTiming";

const ffmpegPath = ffmpegInstaller.path;

// msedge-tts is requested at a fixed 48kbps CBR mono mp3, so duration can be
// computed directly from the file size without needing ffprobe.
function estimateAudioDurationSec(audioBuffer) {
  return audioBuffer.length / 6000; // 48000 bits/s = 6000 bytes/s
}

function parseTimeToSeconds(str) {
  const m = str.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (!m) return null;
  const [, hh, mm, ss, cs] = m;
  return (
    parseInt(hh) * 3600 + parseInt(mm) * 60 + parseInt(ss) + parseInt(cs) / 100
  );
}

function runFfmpeg(args, totalDurationSec, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderrTail = "";

    proc.stderr.on("data", (chunk) => {
      const str = chunk.toString();
      stderrTail = (stderrTail + str).slice(-4000);
      const t = parseTimeToSeconds(str);
      if (t !== null && totalDurationSec > 0 && onProgress) {
        onProgress(Math.max(0, Math.min(1, t / totalDurationSec)));
      }
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail}`));
    });
  });
}

export async function renderVideo({
  script,
  videoMode,
  useVideoClips,
  mediaItems,
  audioBuffer,
  onStatus,
  onProgress,
}) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "render-"));

  try {
    const isShort = videoMode === "short";
    const W = isShort ? 720 : 1280;
    const H = isShort ? 1280 : 720;
    const N = mediaItems.length;

    const audioDurationSec = estimateAudioDurationSec(audioBuffer);
    const { durations: perImageDurations, captions } = distributeDurations(
      script,
      N,
      audioDurationSec
    );

    onStatus && onStatus(`در حال دانلود ${N} فایل رسانه...`);
    const mediaExt = useVideoClips ? "mp4" : "jpg";
    const mediaPaths = [];
    for (let i = 0; i < N; i++) {
      const res = await fetch(mediaItems[i]);
      if (!res.ok) throw new Error(`دانلود رسانه ${i + 1} ناموفق بود`);
      const buf = Buffer.from(await res.arrayBuffer());
      const filePath = path.join(tmpDir, `media${i}.${mediaExt}`);
      await fsp.writeFile(filePath, buf);
      mediaPaths.push(filePath);
      onProgress && onProgress((i + 1) / N / 4); // media download ~= first quarter
    }

    const audioPath = path.join(tmpDir, "narration.mp3");
    await fsp.writeFile(audioPath, audioBuffer);

    const fontPath = path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf");
    const outputPath = path.join(tmpDir, "output.mp4");

    const skipZoom = useVideoClips || !isShort;
    const FADE = Math.min(0.5, Math.min(...perImageDurations) / 3);
    const compensation = (FADE * (N - 1)) / N;
    const clipDurations = perImageDurations.map((d) => d + compensation);

    const args = [];
    for (let i = 0; i < N; i++) {
      if (useVideoClips) {
        args.push(
          "-stream_loop", "-1",
          "-t", clipDurations[i].toFixed(2),
          "-i", mediaPaths[i]
        );
      } else {
        args.push(
          "-loop", "1",
          "-framerate", "25",
          "-t", clipDurations[i].toFixed(2),
          "-i", mediaPaths[i]
        );
      }
    }
    args.push("-i", audioPath);
    const musicIdx = N + 1;
    args.push(
      "-f", "lavfi",
      "-i",
      `aevalsrc=0.05*sin(2*PI*110*t)+0.035*sin(2*PI*164.81*t)+0.025*sin(2*PI*220*t):s=44100:d=${audioDurationSec.toFixed(
        2
      )}`
    );

    let filter = "";
    for (let i = 0; i < N; i++) {
      const captionText = wrapCaption(escapeDrawtext(captions[i] || ""), isShort ? 22 : 38);
      const visualChain = skipZoom
        ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=25`
        : `scale=900:1600:force_original_aspect_ratio=increase,` +
          `crop=900:1600,` +
          `zoompan=z='min(zoom+0.0012,1.25)':d=1:` +
          `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=720x1280:fps=25`;
      filter +=
        `[${i}:v]${visualChain},` +
        `format=yuv420p,setsar=1,` +
        `drawtext=fontfile=${fontPath}:text='${captionText}':fontsize=44:` +
        `fontcolor=white:borderw=3:bordercolor=black@0.8:box=1:` +
        `boxcolor=black@0.35:boxborderw=18:x=(w-text_w)/2:y=h-th-70:` +
        `line_spacing=10[v${i}];`;
    }

    let finalLabel = "v0";
    if (N > 1) {
      let cumulative = clipDurations[0];
      let prevLabel = "v0";
      for (let i = 1; i < N; i++) {
        const offset = cumulative - FADE;
        const outLabel = `x${i}`;
        filter += `[${prevLabel}][v${i}]xfade=transition=fade:duration=${FADE.toFixed(
          2
        )}:offset=${offset.toFixed(2)}[${outLabel}];`;
        cumulative = cumulative + clipDurations[i] - FADE;
        prevLabel = outLabel;
      }
      finalLabel = prevLabel;
    }

    const audioMixFilter = `[${N}:a][${musicIdx}:a]amix=inputs=2:duration=first:normalize=0[aout]`;
    filter = filter.replace(/;$/, "") + ";" + audioMixFilter;

    args.push("-filter_complex", filter);
    args.push("-map", `[${finalLabel}]`);
    args.push("-map", "[aout]");
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-b:v", "2500k");
    args.push("-c:a", "aac", "-b:a", "128k");
    args.push("-shortest");
    args.push("-y", outputPath);

    onStatus && onStatus("در حال رندر نهایی ویدیو...");
    await runFfmpeg(args, audioDurationSec, (p) => {
      onProgress && onProgress(0.25 + p * 0.75); // render = remaining 75%
    });

    const outputBuffer = await fsp.readFile(outputPath);
    return outputBuffer;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
