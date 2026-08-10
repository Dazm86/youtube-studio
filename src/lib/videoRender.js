import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { pickMayaPose } from "./mayaThumbnail";

const ffmpegPath = ffmpegInstaller.path;

// --- فاز ۳: انتخاب موزیک زمینه‌ی پویا بر اساس حس‌وحال متن ---
// Pexels هیچ API صوتی نداره (فقط عکس/کلیپ)، پس این استخر یک پوشه‌ی محلیِ
// چند تراک لو-فای/امبینتِ آزادِ کپی‌رایت است (باید در public/audio/bgm/
// قرار بگیره). هر مود اسکریپت (از همون امتیازدهیِ pickMayaPose که برای
// تامبنیل هم استفاده می‌شه) به یکی از چند بستهٔ صوتیِ گسترده‌تر نگاشت
// می‌شه؛ اگر فایل مربوطه هنوز اضافه نشده باشه (یا هیچ‌کدوم نباشه)، رندر
// به‌جای شکست خوردن، به تُن سینوسیِ مصنوعیِ قبلی برمی‌گرده — پس این فیچر
// هیچ‌وقت رندر رو خراب نمی‌کنه، فقط وقتی فایل هست کیفیت بهتری می‌ده.
const BGM_DIR = path.join(process.cwd(), "public", "audio", "bgm");
const MOOD_TO_BGM = {
  meditating: "calm.mp3",
  caring: "calm.mp3",
  thinking: "reflective.mp3",
  surprised: "reflective.mp3",
  greeting: "hopeful.mp3",
  teaching: "hopeful.mp3",
  excited: "uplifting.mp3",
  confident: "uplifting.mp3",
};

function pickBgmPath(fullScriptText) {
  const mood = pickMayaPose(fullScriptText || "");
  const filename = MOOD_TO_BGM[mood] || "hopeful.mp3";
  const fullPath = path.join(BGM_DIR, filename);
  return fs.existsSync(fullPath) ? fullPath : null;
}

// چون رم سرور محدوده (پلن رایگان Render، ۵۱۲ مگابایت)، هیچ‌وقت بیشتر از این
// تعداد عکس/کلیپ رو در یک اجرای FFmpeg همزمان باز نمی‌کنیم. با BATCH_SIZE=1،
// هر عکس کاملاً جدا رندر می‌شه (بیشترین امنیت حافظه، حتی اگه بعداً فیلترهای
// سنگین‌تری اضافه بشه)؛ در آخر همه‌ی تکه‌ها به‌هم می‌چسبن.
const BATCH_SIZE = 1;

// مدت زمانِ واقعیِ فایل صوتی رو اندازه می‌گیره — همون تکنیکِ probeDurationSec
// (پایین‌تر، برای فایل‌های ویدیویی) رو برای یک بافرِ صوتی هم به کار می‌بره:
// بافر رو یک لحظه رو دیسک می‌نویسه، بعد از خروجیِ stderr خودِ ffmpeg
// می‌خونتش. قبلاً این عدد فقط از رویِ اندازه‌ی بایت با فرضِ ثابتِ ۴۸kbps
// (خروجیِ همیشگیِ msedge-tts) حساب می‌شد؛ از وقتی provider های صوتیِ دیگه
// (OpenAI، ElevenLabs — هرکدوم با بیت‌ریتِ متفاوت) هم ممکنه فعال باشن،
// اون فرض دیگه درست نیست و باعثِ به‌هم‌ریختنِ زمان‌بندیِ زیرنویس/رسانه
// می‌شد؛ اگه probe به هر دلیلی شکست بخوره (فرمت غیرمنتظره)، رندر کامل
// نمی‌شکنه — به همون فرضِ قدیمی به‌عنوان آخرین راه‌چاره برمی‌گردیم.
export async function estimateAudioDurationSec(audioBuffer) {
  const tmpFile = path.join(
    os.tmpdir(),
    `probe-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`
  );
  await fsp.writeFile(tmpFile, audioBuffer);
  try {
    return await probeDurationSec(tmpFile);
  } catch {
    return audioBuffer.length / 6000; // آخرین راه‌چاره، فرضِ ۴۸kbps
  } finally {
    fsp.unlink(tmpFile).catch(() => {});
  }
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

// طول واقعیِ یک فایل ویدیوی منبع رو بدون نیاز به ffprobe جدا (که تو این
// پروژه نصب نیست) از خروجی stderr خودِ ffmpeg می‌خونه — همون باینریِ
// @ffmpeg-installer/ffmpeg که رندر اصلی هم استفاده می‌کنه.
export function probeDurationSec(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-i", filePath]);
    let stderrAll = "";
    proc.stderr.on("data", (chunk) => {
      stderrAll += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", () => {
      const m = stderrAll.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (!m) return reject(new Error("طول فایل ویدیو خونده نشد (فرمت نامعتبر؟)"));
      const [, hh, mm, ss, cs] = m;
      resolve(
        parseInt(hh) * 3600 + parseInt(mm) * 60 + parseInt(ss) + parseInt(cs) / 100
      );
    });
  });
}

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

// مایا فقط تو اولین بخش (هوک/شروع) و آخرین بخش (پایان) به‌صورت مجریِ
// بزرگ ظاهر می‌شه. بخش‌های وسط (بدنه‌ی ویدیو) یکی‌درمیون یا کوچیک تو
// گوشه‌ست یا اصلاً نیست — تا هم حس مجری واقعی بده، هم قاب رو برای
// رسانه‌ی هر بخش شلوغ نکنه.
function getMayaRole(index, total) {
  if (total <= 1) return "presenter";
  if (index === 0 || index === total - 1) return "presenter";
  const bodyIndex = index - 1;
  return bodyIndex % 2 === 0 ? "cameo" : "hidden";
}

// مایا رو به‌جای یک عکسِ کاملاً ساکت، با چند لایه‌ی روی‌همِ اختیاری زنده
// می‌کنه — همه‌شون از رویِ همون عکس‌های PNG (بدون نیاز به موتور انیمیشن
// واقعی)، با overlay‌های پی‌درپیِ FFmpeg که هرکدوم enable=<شرط زمانی>
// دارن (وقتی enable قسمت غیرفعاله، اون overlay فقط فریمِ ورودیش رو بدون
// تغییر رد می‌کنه — دقیقاً همین رفتار باعث می‌شه لایه‌چینی کار کنه):
//   ۱) لایه‌ی base — همیشه روشن، با یک نوسانِ ملایمِ x/y (نفس‌کشیدن/تاب‌
//      خوردن) به‌جای موقعیتِ کاملاً ثابت.
//   ۲) لایه‌ی «-talk» (دهان‌باز) — با ریتم دوره‌ای، شبیه تکنیکِ فلپِ دهانِ
//      ویدیوهای ارزونِ توضیحی/وی‌تیوبری؛ تحلیل واقعیِ دامنه‌ی صدا نیست
//      (پیچیدگی/هزینه‌ی رندر بیشتر برای این پروژه‌ی تک‌نفره ارزشش رو
//      نداره)، ولی چون تقریباً کل مدتی که مایا رو صفحه‌ست دارن صحبت
//      می‌کنن، خروجیش قانع‌کننده‌ست.
//   ۳) لایه‌ی «-blink» (چشم‌بسته/دهان‌بسته) — دوره‌ای، هر ۳.۵ تا ۵.۵
//      ثانیه یک‌بار برای ~۱۳۰ میلی‌ثانیه.
//   ۴) لایه‌ی «-talk-blink» (دهان‌باز + چشم‌بسته، برای لحظه‌ای که پلک‌زدن
//      دقیقاً وسط یک فلپِ دهان‌باز بیفته) — اگه این فایل موجود باشه،
//      شرط‌های ۲ و ۳ با هم AND/NOT ترکیب می‌شن (ضرب/تفریق تو عبارت eval
//      فریمویرکِ FFmpeg، چون true=1 و false=0) تا هر لحظه دقیقاً یکی از
//      چهار حالت نشون داده بشه، نه این‌که پلک‌زدن اشتباهی دهانِ بازِ
//      وسطِ حرف‌زدن رو ببنده.
// هر فایلی که موجود نباشه، همون لایه اصلاً ساخته نمی‌شه و منطق به‌صورت
// خودکار به حالتِ ساده‌ترِ بدونِ اون لایه برمی‌گرده — نبودِ هیچ‌کدوم از
// این فایل‌ها رندر رو نمی‌شکنه.
function buildMayaOverlayChain({ i, H, isPresenter, maya, srcLabel, outLabel }) {
  const mayaH = Math.round(H * (isPresenter ? 0.88 : 0.28));
  const baseX = isPresenter ? "(W-w)/2" : "W-w-20";
  const baseY = isPresenter ? "H-h" : "20";
  const bobAmpX = isPresenter ? 3 : 1.5;
  const bobAmpY = isPresenter ? 4 : 2;
  const phase = Math.random() * 6.28;
  const mayaX = `${baseX}+${bobAmpX}*sin(2*PI*t/5+${phase.toFixed(2)})`;
  const mayaY = `${baseY}+${bobAmpY}*sin(2*PI*t/3.2+${((phase * 1.6) % 6.28).toFixed(2)})`;

  let f = `[${maya.baseIdx}:v]scale=-1:${mayaH}[mayabase${i}];`;
  f += `[${srcLabel}][mayabase${i}]overlay=${mayaX}:${mayaY}:eval=frame[mstack0_${i}];`;
  let stack = `mstack0_${i}`;
  let stackN = 0;

  const flapPeriod = (0.2 + Math.random() * 0.08).toFixed(2);
  const flapOpen = (parseFloat(flapPeriod) * 0.6).toFixed(2);
  // نکته‌ی مهم: عبارت‌های eval فریمورک خودِ FFmpeg اصلاً عملگرهای مقایسه‌ای
  // خام `<`/`>` رو نمی‌شناسه (فقط + - * / ^ باینری هست) — مقایسه باید با
  // توابعِ lt(x,y)/gt(x,y) نوشته بشه، وگرنه با خطای مبهمِ parse شکست
  // می‌خوره («Missing ')'» با این‌که پرانتزها بالانسن).
  const talkCond = `lt(mod(t,${flapPeriod}),${flapOpen})`;

  const blinkPeriod = (3.5 + Math.random() * 2).toFixed(2);
  const blinkOffset = (Math.random() * parseFloat(blinkPeriod)).toFixed(2);
  const blinkCond = `lt(mod(t+${blinkOffset},${blinkPeriod}),0.13)`;

  const hasTalk = maya.talkIdx != null;
  const hasBlink = maya.blinkIdx != null;
  const hasBoth = hasTalk && hasBlink && maya.talkBlinkIdx != null;

  if (hasTalk) {
    stackN++;
    const enable = hasBoth ? `(${talkCond})*(1-(${blinkCond}))` : talkCond;
    f += `[${maya.talkIdx}:v]scale=-1:${mayaH}[mayatalk${i}];`;
    f +=
      `[${stack}][mayatalk${i}]overlay=${mayaX}:${mayaY}:eval=frame:` +
      `enable='${enable}'[mstack${stackN}_${i}];`;
    stack = `mstack${stackN}_${i}`;
  }

  if (hasBlink) {
    stackN++;
    const enable = hasBoth ? `(${blinkCond})*(1-(${talkCond}))` : blinkCond;
    f += `[${maya.blinkIdx}:v]scale=-1:${mayaH}[mayablink${i}];`;
    f +=
      `[${stack}][mayablink${i}]overlay=${mayaX}:${mayaY}:eval=frame:` +
      `enable='${enable}'[mstack${stackN}_${i}];`;
    stack = `mstack${stackN}_${i}`;
  }

  if (hasBoth) {
    stackN++;
    f += `[${maya.talkBlinkIdx}:v]scale=-1:${mayaH}[mayatalkblink${i}];`;
    f +=
      `[${stack}][mayatalkblink${i}]overlay=${mayaX}:${mayaY}:eval=frame:` +
      `enable='(${talkCond})*(${blinkCond})'[mstack${stackN}_${i}];`;
    stack = `mstack${stackN}_${i}`;
  }

  f += `[${stack}]null[${outLabel}];`;
  return f;
}

// یک تکه (batch) از عکس‌ها/کلیپ‌ها رو بدون صدا به یک ویدیوی کوچیک تبدیل می‌کنه.
async function renderBatch({
  batchPaths,
  batchDurations,
  batchCaptions,
  batchStartIndex,
  totalSegments,
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
  // اگه کنار عکسِ اصلیِ هر ژست، نسخه‌ی «-talk» (دهان‌باز)، «-blink»
  // (چشم‌بسته)، و/یا «-talk-blink» (هر دو با هم) هم موجود باشه، به‌عنوان
  // لایه‌ی اضافه روی همون ژست سوار می‌شه (پایین‌تر) تا مایا به‌جای یک
  // عکسِ کاملاً یخ‌زده، حرکتِ نرمِ بدن + پلک‌زدنِ دوره‌ای + فلپِ دهانِ
  // هم‌ریتم با صحبت داشته باشه. نبودِ هرکدوم از این فایل‌ها اصلاً رندر رو
  // نمی‌شکنه — فقط همون ژستِ بدون اون لایه، ساده‌تر می‌مونه (دقیقاً همون
  // فلسفه‌ی «تخریب آرومِ» BGM/تامبنیل).
  const mayaDir = path.join(process.cwd(), "public", "maya");
  const mayaInputs = [];
  let nextInputIdx = n;
  for (let i = 0; i < n; i++) {
    const globalIndex = batchStartIndex + i;
    const role = getMayaRole(globalIndex, totalSegments);
    const entry = { role, isPresenter: role === "presenter" };

    if (role !== "hidden") {
      const pose = pickMayaPose(batchCaptions[i] || "");
      const basePath = path.join(mayaDir, `${pose}.png`);
      args.push("-loop", "1", "-framerate", "25", "-t", batchDurations[i].toFixed(2), "-i", basePath);
      entry.baseIdx = nextInputIdx++;

      const talkPath = path.join(mayaDir, `${pose}-talk.png`);
      if (fs.existsSync(talkPath)) {
        args.push("-loop", "1", "-framerate", "25", "-t", batchDurations[i].toFixed(2), "-i", talkPath);
        entry.talkIdx = nextInputIdx++;
      }

      const blinkPath = path.join(mayaDir, `${pose}-blink.png`);
      if (fs.existsSync(blinkPath)) {
        args.push("-loop", "1", "-framerate", "25", "-t", batchDurations[i].toFixed(2), "-i", blinkPath);
        entry.blinkIdx = nextInputIdx++;
      }

      // حالتِ چهارم (اختیاری): دهان‌باز + چشم‌بسته با هم — برای لحظه‌ای که
      // پلک‌زدن دقیقاً وسطِ یک فلپِ دهان‌باز بیفته. نبودش مشکلی نیست؛
      // buildMayaOverlayChain خودش به حالتِ ساده‌ترِ سه‌حالته برمی‌گرده.
      const talkBlinkPath = path.join(mayaDir, `${pose}-talk-blink.png`);
      if (fs.existsSync(talkBlinkPath)) {
        args.push("-loop", "1", "-framerate", "25", "-t", batchDurations[i].toFixed(2), "-i", talkBlinkPath);
        entry.talkBlinkIdx = nextInputIdx++;
      }
    }
    mayaInputs.push(entry);
  }

  let filter = "";
  for (let i = 0; i < n; i++) {
    const { role, isPresenter } = mayaInputs[i];

    const coverW = skipZoom ? W : 900;
    const coverH = skipZoom ? H : 1600;

    const smallW = Math.max(2, Math.round(coverW / 4));
    const smallH = Math.max(2, Math.round(coverH / 4));

    if (isPresenter) {
      // حالت «مجری»: پس‌زمینه فقط محو و کمی تیره‌ست (بدون عکس تیز روش)،
      // چون مایا که بزرگ جلوش می‌شینه قراره سوژه‌ی اصلی قاب باشه.
      // بلور رو رو یه نسخه‌ی کوچیک‌شده می‌زنیم (نه روی تصویر کامل) — نتیجه‌ی
      // بصری یکیه، ولی حجم محاسبات gblur به‌شدت کمتره.
      filter +=
        `[${i}:v]scale=${coverW}:${coverH}:force_original_aspect_ratio=increase,` +
        `crop=${coverW}:${coverH},eq=brightness=-0.12,` +
        `scale=${smallW}:${smallH},gblur=sigma=8,scale=${coverW}:${coverH}[cf${i}];`;
    } else {
      // به‌جای بریدن دو طرف عکس برای پر کردن قاب، یک پس‌زمینه‌ی محو از خودِ
      // عکس می‌سازیم و خودِ عکس رو کامل (بدون افتادن چیزی) وسط می‌ذاریم.
      filter +=
        `[${i}:v]split=2[bg${i}][fg${i}];` +
        `[bg${i}]scale=${coverW}:${coverH}:force_original_aspect_ratio=increase,` +
        `crop=${coverW}:${coverH},scale=${smallW}:${smallH},gblur=sigma=6,` +
        `scale=${coverW}:${coverH}[bgblur${i}];` +
        `[fg${i}]scale=${coverW}:${coverH}:force_original_aspect_ratio=decrease[fgs${i}];` +
        `[bgblur${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2[cf${i}];`;
    }

    const postChain = skipZoom
      ? `fps=25`
      : `zoompan=z='min(zoom+0.0012,1.25)':d=1:` +
        `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=720x1280:fps=25`;

    filter +=
      `[cf${i}]${postChain},` +
      `format=yuv420p,setsar=1,` +
      `drawtext=fontfile=${fontPath}:text='The Mindful Path':fontsize=26:` +
      `fontcolor=white@0.85:borderw=2:bordercolor=black@0.6:x=20:y=20[capped${i}];`;

    if (role === "hidden") {
      // این بخش، مایا داخل قاب نیست — رسانه خودش قاب رو پر می‌کنه.
      filter += `[capped${i}]null[v${i}];`;
    } else {
      filter += buildMayaOverlayChain({
        i,
        H,
        isPresenter,
        maya: mayaInputs[i],
        srcLabel: `capped${i}`,
        outLabel: `v${i}`,
      });
    }
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
  durations,
  captions,
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

    const audioDurationSec = await estimateAudioDurationSec(audioBuffer);
    const perImageDurations = durations;

    onStatus && onStatus(`در حال دانلود ${N} فایل رسانه...`);
    const mediaExt = useVideoClips ? "mp4" : "jpg";
    const mediaPaths = [];
    for (let i = 0; i < N; i++) {
      const item = mediaItems[i];
      // آیتم یا یک URL قابل‌دانلوده (سرویس‌های استوک مثل Pexels) یا از قبل
      // بایت خامه (سرویس‌های تولیدکننده‌ی عکس مثل OpenAI/Stability که
      // base64 برمی‌گردونن، نه لینک).
      let buf;
      if (item && typeof item === "object" && item.buffer) {
        buf = item.buffer;
      } else {
        const res = await fetch(item);
        if (!res.ok) throw new Error(`دانلود رسانه ${i + 1} ناموفق بود`);
        buf = Buffer.from(await res.arrayBuffer());
      }
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
    const BATCH_TIMEOUT_MS = 300000;
    for (let b = 0; b < pathBatches.length; b++) {
      onStatus &&
        onStatus(`در حال رندر تکه‌ی ${b + 1} از ${pathBatches.length}...`);
      const batchOut = path.join(tmpDir, `batch${b}.mp4`);
      const batchDurSec = durationBatches[b].reduce((a, c) => a + c, 0);

      const batchPromise = renderBatch({
        batchPaths: pathBatches[b],
        batchDurations: durationBatches[b],
        batchCaptions: captionBatches[b],
        batchStartIndex: b * BATCH_SIZE,
        totalSegments: N,
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

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`زمان تکه‌ی ${b + 1} از ${pathBatches.length} تموم شد (بیشتر از ۳۰۰ ثانیه طول کشید)`)),
          BATCH_TIMEOUT_MS
        )
      );

      try {
        await Promise.race([batchPromise, timeoutPromise]);
      } catch (err) {
        throw new Error(`تکه‌ی ${b + 1} از ${pathBatches.length} شکست خورد: ${err.message}`);
      }

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
    try {
      await runFfmpeg(
        ["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-y", silentFullPath],
        0,
        null
      );
    } catch (err) {
      throw new Error(`چسباندن تکه‌ها شکست خورد: ${err.message}`);
    }
    onProgress && onProgress(0.85);

    // --- افزودن صدا (روایت + موزیک زمینه‌ی داکشده) — ویدیو فقط کپی می‌شه، رمزگذاری نمی‌شه ---
    onStatus && onStatus("در حال افزودن صدا...");
    const outputPath = path.join(tmpDir, "output.mp4");
    const fullScriptText = captions.join(" ");
    const bgmPath = pickBgmPath(fullScriptText);

    let musicInputArgs;
    let musicIsRealTrack = false;
    if (bgmPath) {
      // تراک واقعی: لوپ می‌شه تا طول روایت رو بپوشونه، بعد به همون طول
      // برش می‌خوره (اگه تراک از روایت کوتاه‌تر بود لوپ لازمه؛ اگه
      // بلندتر بود -t همون‌جا کوتاهش می‌کنه).
      musicInputArgs = ["-stream_loop", "-1", "-t", audioDurationSec.toFixed(2), "-i", bgmPath];
      musicIsRealTrack = true;
    } else {
      // نبود فایل BGM محلی → بازگشت امن به تُن مصنوعیِ قبلی، تا رندر
      // هیچ‌وقت به‌خاطر نبود یک فایل صوتی شکست نخوره.
      const musicFilter = `aevalsrc=0.05*sin(2*PI*110*t)+0.035*sin(2*PI*164.81*t)+0.025*sin(2*PI*220*t):s=44100:d=${audioDurationSec.toFixed(
        2
      )}`;
      musicInputArgs = ["-f", "lavfi", "-i", musicFilter];
    }

    // Audio ducking: به‌جای یک ولوم ثابت برای موزیک، sidechaincompress
    // موزیک رو زنده بر اساس بلندیِ لحظه‌ایِ خودِ صدای روایت (ورودی ۱)
    // فشرده می‌کنه — یعنی هر جا Maya حرف می‌زنه موزیک خودکار پایین
    // می‌ره، و هر مکث واقعی توی صدای ضبط‌شده (چون از متن ساده به TTS
    // می‌دیم و SSML دستی نداریم، مکث‌ها را از رویِ خودِ سیگنال صدا
    // تشخیص می‌دیم، نه از روی تگ‌های از پیش‌نوشته) موزیک خودش کمی بالا
    // میاد — این دقیقاً هدف "duck زیر صحبت / بالا رفتن تو مکث‌ها"ست،
    // فقط واکنشیِ واقعی به جای وابسته به تایم‌استمپ‌های تخمینی.
    const duckFilter = musicIsRealTrack
      ? "[2:a][1:a]sidechaincompress=threshold=0.045:ratio=10:attack=15:release=350:makeup=1[music_ducked];" +
        "[1:a][music_ducked]amix=inputs=2:duration=first:weights=1 0.8[premix];" +
        "[premix]volume=1.6[aout]"
      : "[1:a][2:a]amix=inputs=2:duration=first[premix];[premix]volume=2.0[aout]";

    const finalArgs = [
      "-i", silentFullPath,
      "-i", audioPath,
      ...musicInputArgs,
      "-filter_complex", duckFilter,
      "-map", "0:v",
      "-map", "[aout]",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest",
      "-y", outputPath,
    ];
    try {
      await runFfmpeg(finalArgs, audioDurationSec, (p) => {
        onProgress && onProgress(0.85 + p * 0.15);
      });
    } catch (err) {
      throw new Error(`افزودن صدا شکست خورد: ${err.message}`);
    }

    const outputBuffer = await fsp.readFile(outputPath);
    return outputBuffer;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// --- فاز ۴: بازآفرینیِ شورت از یک بازه‌ی ویدیوی بلند ---
// یک بازه‌ی مشخص (startSec..endSec) از یک ویدیوی منبعِ افقی رو می‌گیره،
// به ۹:۱۶ عمودی کراپ می‌کنه (پس‌زمینه‌ی محو + خودِ فریم وسط، همون تکنیک
// خودِ videoRender برای رسانه‌های افقی تو حالت شورت)، و زیرنویسِ متحرک
// (fade in/out هر خط، هم‌زمان با durations هر خط) روش می‌سوزونه — چون
// این خروجی قراره مستقیم آپلود بشه، زیرنویسِ سوخته این‌جا (بر خلاف
// ویدیوهای اصلی) عمداً درسته: شورت‌ها اغلب بی‌صدا دیده می‌شن.
// همیشه با BATCH_SIZE=1 هم‌خانواده می‌مونه: این یک اجرای FFmpeg تکی روی
// یک فایل ورودیِ از قبل کوچیک‌شده (فقط طول targetDuration) است، نه رندر
// چندبخشیِ سنگین.
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

function escapeDrawtextForShort(text) {
  return String(text || "")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}
