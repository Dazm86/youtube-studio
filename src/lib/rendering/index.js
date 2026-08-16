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

async function getMayaThumbnail() {
  const { pickMayaPose, escapeDrawtextForShort } = await import("./mayaThumbnail");
  return { pickMayaPose, escapeDrawtextForShort };
}

// Sync getter for direct imports (like in registry.js)
function getPickMayaPoseSync() {
  if (!pickMayaPoseSync) {
    throw new Error("pickMayaPose not initialized yet - import mayaThumbnail first");
  }
  return pickMayaPoseSync;
}

let pickMayaPoseSync = null;
getMayaThumbnail().then(({ pickMayaPose }) => { pickMayaPoseSync = pickMayaPose; }).catch(() => {});

const ffmpegPath = ffmpegInstaller.path;

// --- فاز ۳: انتخاب موزیک زمینه‌ی پویا بر اساس حس‌وحال متن ---
// Pexels هیچ API صوتی نداره (فقط عکس/کلیپ)، پس این استخر یک پوشه‌ی محلیِ
// چند تراک لو-فای/امبینتِ آزادِ کپی‌رایت است (باید در public/audio/bgm/
// قرار بگیره). هر مود اسکریپت (از همون امتیازدهیِ pickMayaPose که برای
// تامبنیل هم استفاده می‌شه) به یکی از چند بستهٔ صوتیِ گسترده‌تر نگاشت
// می‌شه؛ اگر فایل مربوطه هنوز اضافه نشده باشه (یا هیچ‌کدوم نباشه)، رندر
// به‌جای شکست خوردن، به تُن سینوسیِ مصنوعیِ قبلی برمی‌گرده — پس این فیچر
// هیچ‌وقت رندر رو خراب نمی‌کنه، فقط وقتی فایل هست کیفیت بهتری می‌ده.
//
// هر مود می‌تونه چند فایل داشته باشه (کاندید۱.mp3، کاندید۲.mp3، ...) —
// یکی رندوم انتخاب می‌شه، تا بیننده‌ی پیوسته حسِ لوپِ عین‌هم رو نگیره.
// فقط لیستِ اسمِ فایلِ اولی (بدونِ پسوندِ عددی) هم همیشه تو آرایه هست، پس
// اگه فقط همون یک فایلِ قدیمی رو داری، دقیقاً همون رفتارِ قبلی می‌مونه.
const BGM_DIR = path.join(process.cwd(), "public", "audio", "bgm");
const MOOD_TO_BGM = {
  meditating: ["calm.mp3", "calm-2.mp3", "calm-3.mp3"],
  caring: ["calm.mp3", "calm-2.mp3", "calm-3.mp3"],
  thinking: ["reflective.mp3", "reflective-2.mp3", "reflective-3.mp3"],
  surprised: ["reflective.mp3", "reflective-2.mp3", "reflective-3.mp3"],
  greeting: ["hopeful.mp3", "hopeful-2.mp3", "hopeful-3.mp3"],
  teaching: ["hopeful.mp3", "hopeful-2.mp3", "hopeful-3.mp3"],
  excited: ["uplifting.mp3", "uplifting-2.mp3", "uplifting-3.mp3"],
  confident: ["uplifting.mp3", "uplifting-2.mp3", "uplifting-3.mp3"],
};

async function pickBgmPath(fullScriptText) {
  const { pickMayaPose } = await getMayaThumbnail();
  const mood = pickMayaPose(fullScriptText || "");
  const candidates = MOOD_TO_BGM[mood] || ["hopeful.mp3"];
  const existing = candidates
    .map((f) => path.join(BGM_DIR, f))
    .filter((p) => fs.existsSync(p));
  if (existing.length === 0) return null;
  return existing[Math.floor(Math.random() * existing.length)];
}

// چون رم سرور محدوده (پلن رایگان Render، ۵۱۲ مگابایت)، هیچ‌وقت بیشتر از این
// تعداد عکس/کلیپ رو در یک اجرای FFmpeg همزمان باز نمی‌کنیم. با BATCH_SIZE=1،
// هر عکس کاملاً جدا رندر می‌شه (بیشترین امنیت حافظه، حتی اگه بعداً فیلترهای
// سنگین‌تری اضافه بشه)؛ در آخر همه‌ی تکه‌ها به‌هم می‌چسبن.
const BATCH_SIZE = 1;

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

// ---------- توابع کمکی رندر ----------

function buildScaleFilter(targetW, targetH) {
  // محاسبه مقیاس تا ویدیو/عکس در کادرziel جا بشه (contain) —
  // aspect ratio حفظ می‌شه، اضلاع خالی با رنگ مشکی پر می‌شن.
  return `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black@1[v]`;
}

function buildCaptionFilter(captionLine, videoW, videoH, fontPath, fontsize, lineIndex) {
  const margin = Math.round(videoH * 0.08);
  const safeW = videoW - 120;
  const escaped = captionLine.text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
  const xExpr = `(w-text_w)/2`;
  const yExpr = `h-${margin}-text_h`;
  return `drawtext=fontfile=${fontPath}:text='${escaped}':fontsize=${fontsize}:fontcolor=white:borderw=3:bordercolor=black@0.8:x=${xExpr}:y=${yExpr}`;
}

function buildMayaFilter(poseImgPath, videoW, videoH) {
  const scale = Math.min(videoW, videoH) * 0.35;
  return `[1:v]scale=${scale}:${scale}[maya];[v][maya]overlay=(W-w)/2:H-h-40[v]`;
}

// ---------- تابع اصلی رندر ----------

// ورودی:
// - script: متن کاملِ روایت
// - segments: آرایه‌ی { text, startSec, endSec } برای زیرنویس
// - assets: آرایه‌ی { type: "image"|"video", path|buffer, durationSec?, loop? }
// - outputPath: مسیر فایل خروجی
// - opts: { width, height, fps, fontPath, fontSize, bgmPath?, bgmVolume? }
// خروجی: { durationSec }

async function renderVideo({
  script,
  segments,
  assets,
  outputPath,
  opts = {},
}) {
  const {
    width = 1920,
    height = 1080,
    fps = 30,
    fontPath = path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf"),
    fontSize = 48,
    bgmPath,
    bgmVolume = 0.12,
  } = opts;

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "render-"));
  const segmentFiles = [];

  try {
    // ۱. برای هر سگمنت (خط زیرنویس) یک ویدیو کوتاه بساز
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const dur = seg.endSec - seg.startSec;
      if (dur <= 0) continue;

      // انتخاب asset متناسب (Round-robin ساده)
      const asset = assets[i % assets.length];
      let inputArg;
      let filterComplex = "";

      if (asset.type === "video") {
        const clipPath = path.join(tmpDir, `clip_${i}.mp4`);
        if (Buffer.isBuffer(asset.buffer)) {
          await fsp.writeFile(clipPath, asset.buffer);
        } else {
          await fsp.copyFile(asset.path, clipPath);
        }
        inputArg = `-i "${clipPath}"`;
        // برای ویدیو: اسکیل/پد + لپ در صورت نیاز
        filterComplex = buildScaleFilter(width, height);
        if (asset.loop || dur > asset.durationSec) {
          filterComplex += `,loop=loop=-1:size=${Math.ceil(fps * (asset.durationSec || dur))},setpts=N/${fps}/TB`;
        }
      } else {
        // عکس: یک فریم استاتیک
        const imgPath = path.join(tmpDir, `img_${i}.png`);
        if (Buffer.isBuffer(asset.buffer)) {
          await fsp.writeFile(imgPath, asset.buffer);
        } else {
          await fsp.copyFile(asset.path, imgPath);
        }
        inputArg = `-loop 1 -i "${imgPath}"`;
        filterComplex = buildScaleFilter(width, height);
      }

      // زیرنویس
      filterComplex += `;${buildCaptionFilter(seg, width, height, fontPath, fontSize, i)}`;

      // مایا (اگر اسکریپت کلی 있으면)
      if (script) {
        // pickMayaPose از متن کل اسکریپت موود می‌گیره
        const { pickMayaPose } = await getMayaThumbnail();
        const pose = pickMayaPose(script);
        const posePath = path.join(process.cwd(), "public", "assets", "images", "maya", `${pose}.png`);
        if (fs.existsSync(posePath)) {
          filterComplex += `;${buildMayaFilter(posePath, width, height)}`;
        }
      }

      const segOut = path.join(tmpDir, `seg_${i}.mp4`);
      const args = [
        "-y",
        inputArg,
        "-filter_complex",
        filterComplex,
        "-map",
        "[v]",
        "-t",
        String(dur),
        "-r",
        String(fps),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        segOut,
      ];
      await runFfmpeg(args);
      segmentFiles.push(segOut);
    }

    // ۲. کانکت کردن همه سگمنت‌ها (concat demuxer)
    const listPath = path.join(tmpDir, "concat.txt");
    await fsp.writeFile(
      listPath,
      segmentFiles.map((f) => `file '${f}'`).join("\n")
    );

    const concatOut = path.join(tmpDir, "concat.mp4");
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      concatOut,
    ]);

    // ۳. синтеز صدا (TTS) برای کل اسکریپت
    const ttsPath = path.join(tmpDir, "tts.mp3");
    const { buffer: ttsBuffer } = await import("../providers/router.js").then((m) =>
      m.synthesizeSpeech({ text: script })
    );
    await fsp.writeFile(ttsPath, ttsBuffer);

    // ۴. ترکیب صدا + ویدیو (+ BGM اختیاری)
    const finalArgs = [
      "-y",
      "-i",
      concatOut,
      "-i",
      ttsPath,
    ];
    let filter = "[0:v]copy[v]";
    if (bgmPath && fs.existsSync(bgmPath)) {
      finalArgs.push("-i", bgmPath);
      filter = `[1:a]volume=${bgmVolume}[bgm];[2:a][bgm]amix=inputs=2:duration=first[a]`;
    } else {
      filter = "[1:a]anull[a]";
    }
    finalArgs.push(
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      outputPath
    );
    await runFfmpeg(finalArgs);

    // محاسبه مدت زمان نهایی
    const { probeDurationSec } = await import("./index");
    const durationSec = await probeDurationSec(outputPath);
    return { durationSec };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- probeDurationSec ----------

async function probeDurationSec(filePath) {
  const { stdout } = await import("child_process").then((cp) =>
    cp.spawnSync(ffmpegPath, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ])
  );
  return parseFloat(stdout.toString().trim()) || 0;
}

// ---------- estimateAudioDurationSec (heuristic) ----------

function estimateAudioDurationSec(text, wpm = 150) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (words / wpm) * 60;
}

// ---------- trimSilenceFromAudio (skip - not implemented fully) ----------

async function trimSilenceFromAudio(input, outputPath) {
  // Accept either file path (string) or Buffer
  if (Buffer.isBuffer(input)) {
    const tmpPath = path.join(os.tmpdir(), `audio-in-${Date.now()}.mp3`);
    await fsp.writeFile(tmpPath, input);
    await fsp.copyFile(tmpPath, outputPath);
    await fsp.unlink(tmpPath).catch(() => {});
    return outputPath;
  }
  // String path
  await fsp.copyFile(input, outputPath);
  return outputPath;
}

// ---------- detectLongSilences (placeholder) ----------

async function detectLongSilences(input, thresholdDb = -40, minDurationSec = 1) {
  // Accept either file path (string) or Buffer
  if (Buffer.isBuffer(input)) {
    const tmpPath = path.join(os.tmpdir(), `audio-silence-${Date.now()}.mp3`);
    await fsp.writeFile(tmpPath, input);
    const result = await detectLongSilences(tmpPath, thresholdDb, minDurationSec);
    await fsp.unlink(tmpPath).catch(() => {});
    return result;
  }
  // String path - placeholder returns empty array
  return [];
}

// ---------- probeHasAudioStream ----------

function probeHasAudioStream(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ["-i", filePath]);
    let stderrAll = "";
    proc.stderr.on("data", (chunk) => {
      stderrAll += chunk.toString();
    });
    proc.on("error", () => resolve(false));
    proc.on("close", () => resolve(/Stream #\d+:\d+.*Audio:/.test(stderrAll)));
  });
}

// ---------- renderVerticalShortFromSource ----------

export async function renderVerticalShortFromSource({
  sourceBuffer,
  startSec,
  durationSec,
  captionLines, // [{ text, startSec, endSec }]
  onStatus,
}) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "short-"));
  try {
    const inputPath = path.join(tmpDir, "source.mp4");
    await fsp.writeFile(inputPath, sourceBuffer);
    const outputPath = path.join(tmpDir, "short_output.mp4");
    const fontPath = path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf");

    const W = 720;
    const H = 1280;
    const coverW = 900;
    const coverH = 1600;
    const smallW = Math.round(coverW / 4);
    const smallH = Math.round(coverH / 4);

    onStatus && onStatus("در حال کراپ به فرمت عمودی...");

    // بررسی وجود استریم صدا تو فایل منبع — اگه فایل ورودی صدا نداشته
    // باشه، ارجاع به `[0:a]` تو filter_complex کل رندر رو با خطا متوقف
    // می‌کنه؛ پس قبلش چک می‌کنیم و فقط در صورت وجود صدا، تریم/مپ صدا رو
    // به گراف اضافه می‌کنیم.
    const hasAudio = await probeHasAudioStream(inputPath);

    // هر خطِ زیرنویس با drawtext جدا + enable='between(t,start,end)' —
    // هرکدوم با یک fade کوتاه (alpha از طریق دو drawtext هم‌پوشان ساده‌سازی
    // نشده، بلکه از پارامتر alpha خطیِ خودِ drawtext در بازه‌ی کوتاه
    // شروع/پایان استفاده می‌کنیم) تا حس "متحرک" داشته باشه، نه فقط ظاهر/
    // ناپدید شدنِ ناگهانی.
    const FADE = 0.25;
    const { escapeDrawtextForShort } = await getMayaThumbnail();
    const captionFilters = (captionLines || [])
      .map((line, i) => {
        const text = escapeDrawtextForShort(line.text);
        const s = Math.max(0, line.startSec);
        const e = Math.max(s + 0.1, line.endSec);
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
      // صدا هم باید دقیقاً همون بازه‌ی ویدیو رو ببره — وگرنه صدا از ابتدای
      // فایل منبع (یا نامنطبق با تصویر) پخش می‌شه.
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

    await runFfmpeg(args, durationSec, onStatus ? () => {} : null);

    const outputBuffer = await fsp.readFile(outputPath);
    return outputBuffer;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- Exports ----------

export {
  renderVideo,
  probeDurationSec,
  estimateAudioDurationSec,
  trimSilenceFromAudio,
  detectLongSilences,
  pickBgmPath,
  getPickMayaPoseSync as pickMayaPose,
  BATCH_SIZE,
};

// Re-export from mayaThumbnail (will be loaded dynamically at runtime)
export async function getMayaThumbnailExports() {
  const { pickMayaPose, capThumbnailWords, buildMayaThumbnail, buildMayaThumbnailVariants, escapeDrawtextForShort } = await import("./mayaThumbnail");
  return { pickMayaPose, capThumbnailWords, buildMayaThumbnail, buildMayaThumbnailVariants, escapeDrawtextForShort };
}