cat > src/lib/videoRender.js << 'EOF_VIDEORENDER'
import { spawn } from "child_process";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { distributeDurations, escapeDrawtext, wrapCaption } from "./scriptTiming";
import { pickMayaPose } from "./mayaThumbnail";

const ffmpegPath = ffmpegInstaller.path;

// چون رم سرور محدوده (پلن رایگان Render، ۵۱۲ مگابایت)، هیچ‌وقت بیشتر از این
// تعداد عکس/کلیپ رو در یک اجرای FFmpeg همزمان باز نمی‌کنیم. با BATCH_SIZE=1،
// هر عکس کاملاً جدا رندر می‌شه (بیشترین امنیت حافظه، حتی اگه بعداً فیلترهای
// سنگین‌تری اضافه بشه)؛ در آخر همه‌ی تکه‌ها به‌هم می‌چسبن.
const BATCH_SIZE = 1;

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

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// یک تکه (batch) از عکس‌ها/کلیپ‌ها رو بدون صدا به یک ویدیوی کوچیک تبدیل می‌کنه.
async function renderBatch({
  batchPaths,
  batchDurations,
  batchCaptions,
  W,
  H,
  skipZoom,
  fontPath,
  useVideoClips,
  outputPath,
  onProgress,
}) {
  const n = batchPaths.length;
  const args = [];

  for (let i = 0; i < n; i++) {
    if (useVideoClips) {
      args.push("-stream_loop", "-1", "-t", batchDurations[i].toFixed(2), "-i", batchPaths[i]);
    } else {
      args.push("-loop", "1", "-framerate", "25", "-t", batchDurations[i].toFixed(2), "-i", batchPaths[i]);
    }
  }

  // یک ورودیِ عکس مایا هم به ازای هر تکه‌ی محتوا اضافه می‌کنیم — پوزش بر اساس
  // حس‌وحال همون بخش از متن انتخاب می‌شه (همون منطق تامبنیل خودکار).
  const mayaDir = path.join(process.cwd(), "public", "maya");
  for (let i = 0; i < n; i++) {
    const pose = pickMayaPose(batchCaptions[i] || "");
    const mayaPath = path.join(mayaDir, `${pose}.png`);
    args.push("-loop", "1", "-framerate", "25", "-t", batchDurations[i].toFixed(2), "-i", mayaPath);
  }
  const mayaInputStart = n;

  let filter = "";
  for (let i = 0; i < n; i++) {
    const captionText = wrapCaption(escapeDrawtext(batchCaptions[i] || ""), W < H ? 22 : 38);
    const coverW = skipZoom ? W : 900;
    const coverH = skipZoom ? H : 1600;
    // به‌جای بریدن دو طرف عکس برای پر کردن قاب، یک پس‌زمینه‌ی محو از خودِ
    // عکس می‌سازیم و خودِ عکس رو کامل (بدون افتادن چیزی) وسط می‌ذاریم.
    filter +=
      `[${i}:v]split=2[bg${i}][fg${i}];` +
      `[bg${i}]scale=${coverW}:${coverH}:force_original_aspect_ratio=increase,` +
      `crop=${coverW}:${coverH},gblur=sigma=20[bgblur${i}];` +
      `[fg${i}]scale=${coverW}:${coverH}:force_original_aspect_ratio=decrease[fgs${i}];` +
      `[bgblur${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2[cf${i}];`;

    const postChain = skipZoom
      ? `fps=25`
      : `zoompan=z='min(zoom+0.0012,1.25)':d=1:` +
        `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=720x1280:fps=25`;

    const mayaH = Math.round(H * 0.28);
    const mayaIdx = mayaInputStart + i;

    filter +=
      `[cf${i}]${postChain},` +
      `format=yuv420p,setsar=1,` +
      `drawtext=fontfile=${fontPath}:text='${captionText}':fontsize=44:` +
      `fontcolor=white:borderw=3:bordercolor=black@0.8:box=1:` +
      `boxcolor=black@0.35:boxborderw=18:x=(w-text_w)/2:y=h-th-70:` +
      `line_spacing=10[capped${i}];` +
      `[${mayaIdx}:v]scale=-1:${mayaH}[mayascaled${i}];` +
      `[capped${i}][mayascaled${i}]overlay=W-w-20:20[v${i}];`;
  }

  let finalLabel = "v0";
  if (n > 1) {
    const inputsList = Array.from({ length: n }, (_, i) => `[v${i}]`).join("");
    filter += `${inputsList}concat=n=${n}:v=1:a=0[vout];`;
    finalLabel = "vout";
  }
  filter = filter.replace(/;$/, "");

  args.push("-filter_complex", filter);
  args.push("-map", `[${finalLabel}]`);
  args.push("-an");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-b:v", "2500k");
  args.push("-y", outputPath);

  const batchDurationSec = batchDurations.reduce((a, b) => a + b, 0);
  await runFfmpeg(args, batchDurationSec, onProgress);
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
      onProgress && onProgress(((i + 1) / N) * 0.15); // دانلود ~۱۵٪ اول
    }

    const audioPath = path.join(tmpDir, "narration.mp3");
    await fsp.writeFile(audioPath, audioBuffer);

    const fontPath = path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf");
    const skipZoom = useVideoClips || !isShort;

    // --- رندر تکه‌تکه: هیچ‌وقت بیش از BATCH_SIZE ورودی همزمان باز نمی‌مونه ---
    const pathBatches = chunkArray(mediaPaths, BATCH_SIZE);
    const durationBatches = chunkArray(perImageDurations, BATCH_SIZE);
    const captionBatches = chunkArray(captions, BATCH_SIZE);

    const batchOutputPaths = [];
    let doneSoFarSec = 0;
    for (let b = 0; b < pathBatches.length; b++) {
      onStatus &&
        onStatus(`در حال رندر تکه‌ی ${b + 1} از ${pathBatches.length}...`);
      const batchOut = path.join(tmpDir, `batch${b}.mp4`);
      const batchDurSec = durationBatches[b].reduce((a, c) => a + c, 0);

      await renderBatch({
        batchPaths: pathBatches[b],
        batchDurations: durationBatches[b],
        batchCaptions: captionBatches[b],
        W,
        H,
        skipZoom,
        fontPath,
        useVideoClips,
        outputPath: batchOut,
        onProgress: (p) => {
          const overallSec = doneSoFarSec + p * batchDurSec;
          onProgress && onProgress(0.15 + (overallSec / audioDurationSec) * 0.65);
        },
      });

      doneSoFarSec += batchDurSec;
      batchOutputPaths.push(batchOut);
    }

    // --- چسباندن تکه‌ها به هم (خیلی سبک، فقط کپی جریان، بدون رمزگذاری دوباره) ---
    onStatus && onStatus("در حال چسباندن تکه‌ها به هم...");
    const listPath = path.join(tmpDir, "concat_list.txt");
    const listContent = batchOutputPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join("\n");
    await fsp.writeFile(listPath, listContent);

    const silentFullPath = path.join(tmpDir, "silent_full.mp4");
    await runFfmpeg(
      ["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-y", silentFullPath],
      0,
      null
    );
    onProgress && onProgress(0.85);

    // --- افزودن صدا (روایت + هاله‌ی موزیک) — ویدیو فقط کپی می‌شه، رمزگذاری نمی‌شه ---
    onStatus && onStatus("در حال افزودن صدا...");
    const outputPath = path.join(tmpDir, "output.mp4");
    const musicFilter = `aevalsrc=0.05*sin(2*PI*110*t)+0.035*sin(2*PI*164.81*t)+0.025*sin(2*PI*220*t):s=44100:d=${audioDurationSec.toFixed(
      2
    )}`;
    const finalArgs = [
      "-i", silentFullPath,
      "-i", audioPath,
      "-f", "lavfi", "-i", musicFilter,
      "-filter_complex",
      "[1:a][2:a]amix=inputs=2:duration=first[premix];[premix]volume=2.0[aout]",
      "-map", "0:v",
      "-map", "[aout]",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest",
      "-y", outputPath,
    ];
    await runFfmpeg(finalArgs, audioDurationSec, (p) => {
      onProgress && onProgress(0.85 + p * 0.15);
    });

    const outputBuffer = await fsp.readFile(outputPath);
    return outputBuffer;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
EOF_VIDEORENDER
