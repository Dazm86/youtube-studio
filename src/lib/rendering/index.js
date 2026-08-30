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
  const { pickMayaPose, escapeDrawtextForShort } = await import("./mayaThumbnail.js");
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

// فیکسِ ۲۰۲۶-۰۸-۲۱ — زیرنویسِ روی ویدیو (drawtext) عرض/wrap نداشت؛
// x=(w-text_w)/2 وسط‌چین می‌کنه ولی اگه text_w از عرضِ ویدیو بیشتر
// باشه (که برای هر جمله‌ی نسبتاً بلندی در fontsize=48 پیش میاد)، متن
// از هر دو طرف می‌زنه بیرون — دقیقاً چیزی که تو خروجیِ واقعی دیده شد.
// عرضِ هر کاراکتر اینجا مستقیم از خودِ فایلِ فونتِ پروژه
// (public/fonts/DejaVuSans-Bold.ttf) با PIL استخراج و در برابرِ
// اندازه‌گیریِ واقعیِ چند جمله راستی‌آزمایی شد (خطای کمتر از ۰.۰۵٪).
// واحد: ۱۰۰۰ یونیت = یک em (استانداردِ طراحیِ فونت).
const CHAR_WIDTHS_PER_1000EM = {
  " ": 348, "!": 456, '"': 521, "#": 838, $: 696, "%": 1002, "&": 872, "'": 306,
  "(": 457, ")": 457, "*": 523, "+": 838, ",": 380, "-": 415, ".": 380, "/": 365,
  0: 696, 1: 696, 2: 696, 3: 696, 4: 696, 5: 696, 6: 696, 7: 696, 8: 696, 9: 696,
  ":": 400, ";": 400, "<": 838, "=": 838, ">": 838, "?": 580, "@": 1000,
  A: 774, B: 762, C: 734, D: 830, E: 683, F: 683, G: 821, H: 837, I: 372, J: 372,
  K: 775, L: 637, M: 995, N: 837, O: 850, P: 733, Q: 850, R: 770, S: 720, T: 682,
  U: 812, V: 774, W: 1103, X: 771, Y: 724, Z: 725,
  "[": 457, "\\": 365, "]": 457, "^": 838, _: 500, "`": 500,
  a: 675, b: 716, c: 593, d: 716, e: 678, f: 435, g: 716, h: 712, i: 343, j: 343,
  k: 665, l: 343, m: 1042, n: 712, o: 687, p: 716, q: 716, r: 493, s: 595, t: 478,
  u: 712, v: 652, w: 924, x: 645, y: 652, z: 582,
  "{": 712, "|": 365, "}": 712, "~": 838,
  "\u2018": 380, "\u2019": 380, "\u201c": 657, "\u201d": 657, "\u2014": 1000,
  "\u2013": 500, "\u2026": 1000,
};
const DEFAULT_CHAR_WIDTH_PER_1000EM = 700; // برای کاراکترهای خارج از جدول (فارسی و ...)

function measureTextWidthPx(text, fontsize) {
  let units = 0;
  for (const ch of text) {
    units += CHAR_WIDTHS_PER_1000EM[ch] ?? DEFAULT_CHAR_WIDTH_PER_1000EM;
  }
  return (units * fontsize) / 1000;
}

// wrap حریصانه: کلمه‌به‌کلمه به خطِ جاری اضافه می‌کنه تا وقتی از
// maxWidthPx رد بشه، اونجا خط رو می‌شکنه. یک کلمه‌ی تنهایی که خودش از
// maxWidthPx بلندتره (نادر) دست‌نخورده رو خط خودش می‌مونه.
function wrapCaptionText(text, fontsize, maxWidthPx) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines = [];
  let currentLine = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${currentLine} ${words[i]}`;
    if (measureTextWidthPx(candidate, fontsize) <= maxWidthPx) {
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = words[i];
    }
  }
  lines.push(currentLine);
  return lines;
}

function buildScaleFilter(targetW, targetH) {
  return `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black@1[v0]`;
}

// افکتِ Ken Burns (زومِ آرومِ رو عکسِ ثابت) — اضافه‌شدِ ۲۰۲۶-۰۸-۲۲، طبقِ
// نقدِ Gemini («تصاویر پس‌زمینه همچنان به‌صورت عکس‌های ثابت تعویض
// می‌شوند... زومِ آروم جلوه‌ی بسیار زنده‌تری می‌ده»). برخلافِ
// buildScaleFilter (که کلِ عکس رو با پدینگِ مشکی جا می‌ده، «contain»)،
// اینجا عکس رو بزرگ‌تر از قابِ نهایی اسکیل می‌کنیم («cover»، بدونِ
// پدینگ) تا zoompan همیشه رزولوشنِ کافی برای زوم داشته باشه، بدونِ
// این‌که لبه‌ی مشکی یا پیکسلی‌شدن دیده بشه. با ffmpegِ واقعی تست شد.
function buildKenBurnsFilter(targetW, targetH, durationSec, fps) {
  const totalFrames = Math.max(1, Math.round(durationSec * fps));
  const upscaleW = targetW * 2;
  const upscaleH = targetH * 2;
  const zoomEnd = 1.12; // زومِ نهاییِ ظریف — ۱۲٪، نه چیزِ چشمگیر
  const zoomStep = (zoomEnd - 1) / totalFrames;
  return (
    `[0:v]scale=${upscaleW}:${upscaleH}:force_original_aspect_ratio=increase,` +
    `crop=${upscaleW}:${upscaleH},` +
    `zoompan=z='min(zoom+${zoomStep.toFixed(6)},${zoomEnd})':d=${totalFrames}:s=${targetW}x${targetH}:fps=${fps}[v0]`
  );
}

function buildCaptionFilter(captionLine, videoW, videoH, fontPath, fontsize, lineIndex) {
  const margin = Math.round(videoH * 0.08);
  // فیکسِ ۲۰۲۶-۰۸-۲۱ — `\'` به‌عنوان escape برای آپاستروف تو یک مقدارِ
  // تکی‌کوتیشن‌شده‌ی ffmpeg اصلاً کار نمی‌کنه (برخلافِ escapeِ معمولیِ
  // shell) — با ffmpegِ واقعی تست شد: دقیقاً همون خطای «Output with
  // label 'v1' does not exist» رو می‌ده، چون کوتیشن زودتر از موعد بسته
  // می‌شه و بقیه‌ی رشته دیگه به‌عنوان متنِ داخلِ کوتیشن خونده نمی‌شه. چون
  // اسکریپت‌های انگلیسی پر از آپاستروفن («I've»، «don't»، «Alex's»)، این
  // عملاً هر رندرِ لانگی که به این خط می‌رسید رو می‌شکست. به‌جای escapeِ
  // درستِ ffmpeg (که پیچیده‌تره: '\''), از همون ترفندی استفاده می‌کنیم
  // که mayaThumbnail.js و script/timing.js از قبل برای همین دقیقاً
  // مشکل استفاده می‌کنن: آپاستروف رو با کوتیشنِ گردِ یونیکد (’) عوض
  // می‌کنیم — دیگه اصلاً کاراکترِ خاصِ ffmpeg نیست، نیازی به escape نداره.
  const escaped = captionLine.text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\u2019")
    .replace(/%/g, "\\%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");

  // wrap رو *قبل* از escapeِ کوتیشن/کولون انجام می‌دیم که اندازه‌گیریِ
  // عرض رو خراب نکنه (کاراکترهای escape‌شده تو رندرِ نهایی حذف می‌شن،
  // پس نباید تو محاسبه‌ی عرض حساب بشن) — برای همین wrap رو رو متنِ
  // escapeشده اجرا می‌کنیم ولی چون escapeِ همین چند کاراکتر طولِ رشته
  // رو عملاً عوض نمی‌کنه (فقط یک بک‌اسلش قبلش میاد که ffmpeg موقعِ
  // نمایش حذفش می‌کنه)، تفاوتِ عرضِ واقعی ناچیزه.
  const maxWidthPx = videoW * 0.92;
  const wrappedLines = wrapCaptionText(escaped, fontsize, maxWidthPx);
  const wrappedText = wrappedLines.join("\n");

  const xExpr = `(w-text_w)/2`;
  const yExpr = `h-${margin}-text_h`;
  return `[v0]drawtext=fontfile=${fontPath}:text='${wrappedText}':fontsize=${fontsize}:fontcolor=white:borderw=3:bordercolor=black@0.8:x=${xExpr}:y=${yExpr}:line_spacing=8[v1]`;
}

// موقعیت/اندازه‌ی اورلیِ مایا — فیکسِ ۲۰۲۶-۰۸-۲۲: قبلاً پایینِ‌وسط،
// scale=۰.۳۵×min(W,H) بود. محاسبه‌ی دستی نشون داد این دقیقاً تو همون
// محدوده‌ی عمودیِ زیرنویس می‌افتاد (هر دو نزدیکِ لبه‌ی پایین، وسط‌چین)
// — دقیقاً همون چیزی که تو نقدِ Gemini به‌عنوانِ «آواتار زیرنویس رو
// پوشونده» گزارش شد. حالا گوشه‌ی بالا-راست، کوچیک‌تر — کاملاً جدا از
// زیرنویس (که پایینه) صرف‌نظر از این‌که زیرنویس چند خط wrap بشه.
const MAYA_SCALE_RATIO = 0.22;
const MAYA_MARGIN_RATIO = 0.035;
function mayaOverlayExpr(videoW, videoH) {
  const marginX = Math.round(videoW * MAYA_MARGIN_RATIO);
  const marginY = Math.round(videoH * MAYA_MARGIN_RATIO);
  return `W-w-${marginX}:${marginY}`;
}

function buildMayaFilter(poseImgPath, videoW, videoH) {
  const scale = Math.round(Math.min(videoW, videoH) * MAYA_SCALE_RATIO);
  return `[1:v]scale=${scale}:${scale}:force_original_aspect_ratio=decrease[maya];[v1][maya]overlay=${mayaOverlayExpr(videoW, videoH)}[v2]`;
}

// ---------- انیمیشنِ مایا (پلک‌زدن + باز/بسته‌شدنِ دهن) ----------
//
// اضافه‌شدِ ۲۰۲۶-۰۸-۲۲ — قبلاً یک عکسِ ثابت (پوزِ بدونِ پسوند) رو کل
// سگمنت روی ویدیو overlay می‌شد. برای هر پوز، ۴ حالت از قبل تو
// public/maya/ موجوده: پایه (دهن‌بسته/چشم‌باز)، -blink (دهن‌بسته/
// چشم‌بسته)، -talk (دهن‌باز/چشم‌باز)، -talk-blink (دهن‌باز/چشم‌بسته).
// این تابع بینِ این ۴ تا، طیِ کلِ سگمنت، یک توالیِ زمان‌بندی‌شده می‌سازه:
// دهن هر ~۰.۲۸ ثانیه باز/بسته می‌شه (شبیه‌سازیِ حرکتِ حرف‌زدن)، و هر
// چند تیک یک‌بار (~۳ ثانیه) یک پلکِ کوتاه هم اضافه می‌شه.
//
// نکته‌ی مهم: عکسِ پایه اندازه‌اش با سه‌تای دیگه فرق داره (احتمالاً جدا
// تولید شده)، برخلافِ -blink/-talk/-talk-blink که دقیقاً هم‌اندازه و
// هم‌ترازن. یعنی وقتی نوبتِ عکسِ پایه می‌شه، یک پرشِ بصریِ کوچیک ممکنه
// دیده بشه — این ریسک آگاهانه پذیرفته شد (جایگزینش این بود که دهن هیچ‌وقت
// بسته نشه، که طبیعی‌تر به‌نظر نمی‌رسید).
const MAYA_TICK_SEC = 0.28;
const MAYA_BLINK_EVERY_TICKS = Math.round(3.2 / MAYA_TICK_SEC);

function buildMayaAnimationBuckets(durationSec) {
  const buckets = { base: [], blink: [], talk: [], talkBlink: [] };
  let t = 0;
  let tickIndex = 0;
  let nextBlinkTick = MAYA_BLINK_EVERY_TICKS + Math.floor(Math.random() * 4);
  while (t < durationSec) {
    const end = Math.min(t + MAYA_TICK_SEC, durationSec);
    const mouthOpen = tickIndex % 2 === 1;
    const blinking = tickIndex === nextBlinkTick;
    if (blinking) {
      nextBlinkTick = tickIndex + MAYA_BLINK_EVERY_TICKS + Math.floor(Math.random() * 4);
    }
    const key = mouthOpen ? (blinking ? "talkBlink" : "talk") : blinking ? "blink" : "base";
    buckets[key].push([t, end]);
    t = end;
    tickIndex++;
  }
  return buckets;
}

function mayaEnableExpr(ranges) {
  if (ranges.length === 0) return "0";
  return ranges.map(([s, e]) => `between(t,${s.toFixed(3)},${e.toFixed(3)})`).join("+");
}

// poseFiles: { base, blink, talk, talkBlink } — چهار مسیرِ فایل، همه از
// قبل تأییدشده که وجود دارن. ffmpeg inputهاشون به ترتیب index ۱ تا ۴
// اضافه می‌شن (۰ خودِ ویدیوی سگمنته).
function buildMayaAnimationFilter(videoW, videoH, durationSec) {
  const boxSize = Math.round(Math.min(videoW, videoH) * MAYA_SCALE_RATIO);
  const buckets = buildMayaAnimationBuckets(durationSec);

  // فیکسِ همزمان — قبلاً scale=X:X (یه باکسِ کاملاً مربع) بود، ولی همه‌ی
  // عکس‌های مایا مستطیلی‌ان (نه مربع)، پس تصویر کش میومد. حالا با
  // force_original_aspect_ratio=decrease نسبتِ ابعادِ اصلی حفظ می‌شه.
  let filter =
    `[1:v]scale=${boxSize}:${boxSize}:force_original_aspect_ratio=decrease[m_base];` +
    `[2:v]scale=${boxSize}:${boxSize}:force_original_aspect_ratio=decrease[m_blink];` +
    `[3:v]scale=${boxSize}:${boxSize}:force_original_aspect_ratio=decrease[m_talk];` +
    `[4:v]scale=${boxSize}:${boxSize}:force_original_aspect_ratio=decrease[m_talkblink];`;

  const stages = [
    ["m_base", buckets.base],
    ["m_blink", buckets.blink],
    ["m_talk", buckets.talk],
    ["m_talkblink", buckets.talkBlink],
  ];

  const overlayPos = mayaOverlayExpr(videoW, videoH);
  let prevLabel = "v1";
  stages.forEach(([inputLabel, ranges], idx) => {
    const outLabel = idx === stages.length - 1 ? "v2" : `vov${idx}`;
    filter += `[${prevLabel}][${inputLabel}]overlay=${overlayPos}:enable='${mayaEnableExpr(ranges)}'[${outLabel}];`;
    prevLabel = outLabel;
  });

  return filter.slice(0, -1); // یک ; اضافه‌ی آخر رو حذف کن
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
        inputArg = ["-i", clipPath];
        // برای ویدیو: اسکیل/پد + لپ در صورت نیاز
        filterComplex = buildScaleFilter(width, height);
        if (asset.loop || dur > asset.durationSec) {
          filterComplex += `,loop=loop=-1:size=${Math.ceil(fps * (asset.durationSec || dur))},setpts=N/${fps}/TB`;
        }
      } else {
        // عکس: قبلاً یک فریمِ کاملاً ثابت بود؛ حالا زومِ آرومِ Ken Burns
        const imgPath = path.join(tmpDir, `img_${i}.png`);
        if (Buffer.isBuffer(asset.buffer)) {
          await fsp.writeFile(imgPath, asset.buffer);
        } else {
          await fsp.copyFile(asset.path, imgPath);
        }
        inputArg = ["-loop", "1", "-i", imgPath];
        filterComplex = buildKenBurnsFilter(width, height, dur, fps);
      }

      // زیرنویس
      filterComplex += `;${buildCaptionFilter(seg, width, height, fontPath, fontSize, i)}`;

      // مایا (اگر اسکریپت کلی هست) — انیمیشنِ پلک/دهن، ۲۰۲۶-۰۸-۲۲
      let mayaInputArg = [];
      let finalVideoLabel = "v1"; // default: after caption filter
      if (script) {
        // pickMayaPose از متن کل اسکریپت موود می‌گیره
        const { pickMayaPose } = await getMayaThumbnail();
        const pose = pickMayaPose(script);
        // فیکسِ ۲۰۲۶-۰۸-۲۱ — این مسیر (public/assets/images/maya/) هیچ‌وقت
        // وجود نداشته (فقط تو REORGANIZATION_PLAN.md به‌عنوان هدفِ آینده
        // بود، هیچ‌وقت واقعاً اجرا نشد)؛ چون با fs.existsSync گارد شده
        // بود، هیچ ارور نمی‌داد — فقط اورلی مایا بی‌صدا هیچ‌وقت اضافه
        // نمی‌شد. فایل‌های واقعیِ پوزها تو public/maya/ان.
        const mayaDir = path.join(process.cwd(), "public", "maya");
        const posePaths = {
          base: path.join(mayaDir, `${pose}.png`),
          blink: path.join(mayaDir, `${pose}-blink.png`),
          talk: path.join(mayaDir, `${pose}-talk.png`),
          talkBlink: path.join(mayaDir, `${pose}-talk-blink.png`),
        };
        const allExist = Object.values(posePaths).every((p) => fs.existsSync(p));
        if (allExist) {
          filterComplex += `;${buildMayaAnimationFilter(width, height, dur)}`;
          mayaInputArg = [
            "-loop", "1", "-i", posePaths.base,
            "-loop", "1", "-i", posePaths.blink,
            "-loop", "1", "-i", posePaths.talk,
            "-loop", "1", "-i", posePaths.talkBlink,
          ];
          finalVideoLabel = "v2";
        } else if (fs.existsSync(posePaths.base)) {
          // اگه یکی از ۴ حالت جا افتاده بود، حداقل همون رفتارِ قبلی
          // (عکسِ ثابتِ پایه) رو داشته باشیم، نه این‌که کل اورلی رو از دست بدیم
          filterComplex += `;${buildMayaFilter(posePaths.base, width, height)}`;
          mayaInputArg = ["-i", posePaths.base];
          finalVideoLabel = "v2";
        }
      }

      const segOut = path.join(tmpDir, `seg_${i}.mp4`);
      const args = [
        "-y",
        ...inputArg,
        ...mayaInputArg,
        "-filter_complex",
        filterComplex,
        "-map",
        `[${finalVideoLabel}]`,
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
    //
    // شبکه‌ی ایمنی (از ۲۰۲۶-۰۸-۱۸): قبل از این‌جا segmentFiles می‌تونست
    // خالی باشه (هیچ سگمنتی ساخته نشد) یا یکی از فایل‌هاش ۰ بایت/ناموجود
    // باشه، و concat demuxer به‌جای یک خطای واضح فقط می‌گفت
    // «concat.txt: Invalid data found when processing input» — که معلوم
    // نمی‌کرد مشکل از کجاست. این‌جا صریح چک می‌کنیم تا خطا همون‌جایی که
    // واقعاً رخ داده مشخص بشه.
    if (segmentFiles.length === 0) {
      throw new Error(
        "هیچ سگمنتی برای رندر ساخته نشد — احتمالاً همه‌ی durationها صفر/منفی بودن یا اسکریپت/مدیا خالی بود."
      );
    }
    for (const f of segmentFiles) {
      let stat;
      try {
        stat = await fsp.stat(f);
      } catch {
        throw new Error(`فایلِ سگمنتِ رندرشده گم شده: ${f}`);
      }
      if (stat.size === 0) {
        throw new Error(`فایلِ سگمنتِ رندرشده خالیه (۰ بایت) — ffmpeg موفق اعلام کرد ولی خروجی واقعی نساخت: ${f}`);
      }
    }

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
    //
    // فیکسِ ۲۰۲۶-۰۸-۲۰ — دو باگ که از بررسیِ اولیه (۲۰۲۶-۰۸-۱۸) مونده
    // بودن، امروز با اولین رندرِ واقعیِ worker بالاخره لو رفتن:
    // ۱. قبلاً `filter` با `[0:v]copy[v]` مقداردهی اولیه می‌شد، ولی توی
    //    *هر دو* شاخه‌ی if/else بلافاصله overwrite می‌شد (نه append) —
    //    یعنی گره‌ی ویدیو همیشه گم می‌شد و `-map [v]` به یک pad ناموجود
    //    اشاره می‌کرد → دقیقاً همون ارورِ «Output with label 'v' does
    //    not exist». چون ویدیو اصلاً نیازی به فیلتر نداره (کارِ ترکیب/
    //    زیرنویس/مایا از قبل رو تک‌تک سگمنت‌ها انجام شده)، دیگه از
    //    filter_complex برای ویدیو استفاده نمی‌کنیم — مستقیم `-map 0:v`
    //    با `-c:v copy`، که هم این باگ رو حل می‌کنه هم باگِ بعدی رو:
    // ۲. `-c:v copy` با یک stream که از filter_complex میاد اصلاً برای
    //    ffmpeg مجاز نیست («Filtering and streamcopy cannot be used
    //    together») — با حذفِ فیلترِ ویدیو، `-map 0:v` دیگه از هیچ
    //    filter graphی نمیاد، پس `-c:v copy` معتبره.
    // ۳. تو حالتِ BGM، `[1:a]` (روایتِ TTS) کم می‌شد نه `[2:a]` (خودِ
    //    موزیک) — برعکسِ منطقِ درست؛ اینجا هم سواپ شد.
    const finalArgs = [
      "-y",
      "-i",
      concatOut,
      "-i",
      ttsPath,
    ];
    let audioFilter;
    if (bgmPath && fs.existsSync(bgmPath)) {
      finalArgs.push("-i", bgmPath);
      audioFilter = `[2:a]volume=${bgmVolume}[bgm];[1:a][bgm]amix=inputs=2:duration=first[a]`;
    } else {
      audioFilter = "[1:a]anull[a]";
    }
    finalArgs.push(
      "-filter_complex",
      audioFilter,
      "-map",
      "0:v",
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

    // محاسبه مدت زمان نهایی — probeDurationSec همین پایین‌تر تو همین
    // فایل تعریف شده (hoisted)، نیازی به import (خودارجاعِ بی‌فایده و
    // بدونِ پسوند .js که زیرِ Node ESM خالص، مثلِ اجرای worker با
    // node، اصلاً resolve نمی‌شد) نبود.
    const durationSec = await probeDurationSec(outputPath);
    return { durationSec };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- probeDurationSec ----------

// فیکسِ ۲۰۲۶-۰۸-۳۰ — این تابع همیشه ۰ برمی‌گردوند، نه فقط تو سناریویِ خاصی:
// آرگومان‌هایی که پایین می‌ده (`-select_streams`, `-show_entries`,
// `-of`) مخصوصِ ffprobe ان، نه ffmpeg — و ffmpeg (که ffmpegPath واقعاً
// بهش اشاره می‌کنه، نه ffprobe) با خطایِ "Unrecognized option" ردشون
// می‌کنه، پس stdout همیشه خالی بوده و `parseFloat("") || 0` بی‌سروصدا ۰
// برمی‌گردونده. با تستِ مستقیم (نه فقط خوندنِ کد) تأیید شد. این یک باگِ
// از‌قبل‌موجود بود (نه چیزی از امروز)، ولی مستقیماً چک‌پوینتِ ۳ (که
// همین امروز، زودتر، اضافه شد) رو هم بی‌اثر می‌کرد — چون durationSec
// همیشه ۰ می‌شد، فاصله‌ش با audioDurationSec همیشه >۱۵٪ بود، یعنی
// چک‌پوینتِ ۳ داشت *هر* ویدیویی رو (نه فقط ویدیوهای واقعاً مشکل‌دار)
// پرچم می‌زد. فیکس: دقیقاً همون روشِ ثابت‌شده‌ی دیروز برایِ
// estimateAudioDurationSec — با خودِ ffmpeg (نه یک ffprobeِ فرضی)، از
// رویِ خطِ Duration تویِ stderr.
async function probeDurationSec(filePath) {
  const { stderr } = await import("child_process").then((cp) =>
    cp.spawnSync(ffmpegPath, ["-i", filePath], { encoding: "utf8" })
  );
  const match = (stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const [, hh, mm, ss] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

// ---------- estimateAudioDurationSec ----------
//
// فیکسِ ۲۰۲۶-۰۸-۲۹ — طبق نقدِ Gemini رو یه ویدیوی واقعی که ثانیه‌ی ۲۲ وسطِ
// جمله قطع شده بود: مسیرِ Buffer قبلاً فرض می‌کرد صدا همیشه دقیقاً
// 128kbps هست (`input.length / 16000`) و طولش رو صرفاً از رویِ حجمِ
// فایل حدس می‌زد — بدونِ اینکه واقعاً به خودِ صدا نگاه کنه. اگه bitrate
// واقعیِ msedge-tts با این فرض یکی نبود (که هست — TTSهای غیررسمی معمولاً
// bitrate صدا رو مستند نمی‌کنن)، این تخمین اشتباه می‌شد. این
// audioDurationSec غلط مستقیماً کلِ تایمینگِ رندر رو می‌سازه
// (distributeDurations, mediaCount, caption/chapter sync)، و چون رندرِ
// نهایی از `-shortest` استفاده می‌کنه (videoRender.js)، یک تخمینِ کمتر
// از واقعیت باعث می‌شه کلِ خروجی — صدا هم همراهش — دقیقاً همون‌جا قطع
// بشه، وسطِ جمله، بدونِ هیچ خطا یا هشداری.
// الان به‌جای حدس زدن، واقعاً با ffprobe از خودِ بافرِ صدا اندازه گرفته
// می‌شه — دقیقاً همون ابزاری که probeDurationSec پایین‌تر رویِ ویدیوی
// نهایی استفاده می‌کنه، فقط این‌جا رویِ فایلِ صوتیِ موقت.
// ورودیِ متنی (رشته) دست‌نخورده موند — برای تخمینِ سبک و پیش از TTS
// (وقتی هنوز صدایی برای probe کردن وجود نداره) هنوز معتبره.
async function estimateAudioDurationSec(input, wpm = 150) {
  if (Buffer.isBuffer(input)) {
    const tmpPath = path.join(os.tmpdir(), `audio-probe-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
    try {
      await fsp.writeFile(tmpPath, input);
      // به‌جای فرض کردنِ یک باینریِ ffprobeِ جداگانه (که @ffmpeg-installer/
      // ffmpeg تضمینش نمی‌کنه، فقط خودِ ffmpeg رو نصب می‌کنه)، از خودِ
      // ffmpeg استفاده می‌کنیم: `ffmpeg -i <file>` بدونِ هیچ خروجی‌ای،
      // exit code غیرصفر می‌ده (طبیعیه، منتظرِ خروجی بوده) ولی طولِ فایل
      // رو تو stderr به‌صورتِ «Duration: HH:MM:SS.ss» چاپ می‌کنه — یک
      // روشِ استاندارد و همیشه در دسترس، چون فقط به همون باینریِ ffmpeg
      // نیاز داره که کلِ این پروژه از قبل بهش متکیه.
      const { stderr } = await import("child_process").then((cp) =>
        cp.spawnSync(ffmpegPath, ["-i", tmpPath], { encoding: "utf8" })
      );
      const match = (stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match) {
        const [, hh, mm, ss] = match;
        const probed = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
        if (probed > 0) return probed;
      }
      console.warn("estimateAudioDurationSec: ffmpeg -i طولِ فایل رو تو stderr نداد، برگشت به تخمینِ حجمِ فایل (غیرقابل‌اعتماد)");
      return input.length / 16000;
    } catch (err) {
      console.warn("estimateAudioDurationSec: probe کردنِ صدا شکست خورد، برگشت به تخمینِ حجمِ فایل:", err.message);
      return input.length / 16000;
    } finally {
      await fsp.rm(tmpPath, { force: true }).catch(() => {});
    }
  }
  // String text — لازم نیست probe بشه، برای تخمینِ سبکِ پیش‌از-TTS خوبه
  const words = input.trim().split(/\s+/).filter(Boolean).length;
  return (words / wpm) * 60;
}

// ---------- trimSilenceFromAudio (skip - not implemented fully) ----------

// ---------- trimSilenceFromAudio ----------
//
// فیکسِ ۲۰۲۶-۰۸-۳۰ — قبلاً placeholder بود (فقط فایل رو بدونِ تغییر کپی
// می‌کرد). الان واقعاً سکوتِ ابتدا/انتها رو می‌بره — دقیقاً همون چیزی که
// کامنتِ صدازننده‌ش تو pipeline.js همیشه ادعا می‌کرد («چند دهم ثانیه
// سکوتِ اضافه که gTTS/msedge-tts می‌ذاره»).
//
// عمداً از فیلترِ silenceremove استفاده نشده: تست با یک فایلِ صوتیِ
// واقعی (الگویِ سکوتِ دقیقاً مشخص) نشون داد stop_periods=-1 (برایِ بریدنِ
// سکوتِ انتهایی) سکوت‌هایِ *داخلی* رو هم می‌بره، نه فقط انتهایی — که
// دقیقاً همون چیزیه که این تابع نباید بکنه (تایمینگِ محاسبه‌شده‌ی
// downstream رو به‌هم می‌زنه). به‌جاش: با silencedetect نقطه‌ی شروع/پایانِ
// واقعیِ محتوا پیدا می‌شه، بعد با -ss/-to + کپیِ استریم (بدونِ ری‌اِنکود)
// فقط همون بازه بریده می‌شه — پیش‌بینی‌پذیرتر و تست‌شده.
async function detectContentBounds(inputPath, thresholdDb = -40) {
  const totalDuration = await probeDurationSec(inputPath);
  const { stderr } = await import("child_process").then((cp) =>
    cp.spawnSync(ffmpegPath, ["-i", inputPath, "-af", `silencedetect=noise=${thresholdDb}dB:d=0.05`, "-f", "null", "-"], {
      encoding: "utf8",
    })
  );
  const text = stderr || "";
  const starts = [...text.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const ends = [...text.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));

  let trimStart = 0;
  let trimEnd = totalDuration;
  if (starts.length > 0 && starts[0] < 0.05) trimStart = ends[0];
  if (ends.length > 0 && ends[ends.length - 1] > totalDuration - 0.1) trimEnd = starts[starts.length - 1];
  // شبکه‌ی ایمنی: اگه به هر دلیلی (فایلِ کاملاً بی‌صدا، خطایِ پارس) نقطه‌ها
  // نامعتبر از آب دراومدن، اصلاً برش نمی‌زنیم.
  if (!(trimStart >= 0) || !(trimEnd > trimStart)) return { trimStart: 0, trimEnd: totalDuration };
  return { trimStart, trimEnd };
}

async function trimSilenceFromAudio(input, outputPath) {
  const returnBuffer = Buffer.isBuffer(input) && !outputPath;
  const tmpPath = path.join(os.tmpdir(), `audio-in-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
  const tmpOut = path.join(os.tmpdir(), `audio-trimmed-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);

  try {
    if (Buffer.isBuffer(input)) {
      await fsp.writeFile(tmpPath, input);
    } else {
      await fsp.copyFile(input, tmpPath);
    }

    const { trimStart, trimEnd } = await detectContentBounds(tmpPath);
    const totalDuration = await probeDurationSec(tmpPath);
    // چیزیِ قابلِ‌توجهی برایِ بریدن نبود (کمتر از ۵۰ میلی‌ثانیه از هرکدوم) —
    // یک کپیِ ساده کافیه، نیازی به فراخوانیِ اضافه‌ی ffmpeg نیست.
    if (trimStart < 0.05 && trimEnd > totalDuration - 0.05) {
      await fsp.copyFile(tmpPath, tmpOut);
    } else {
      const args = ["-y", "-i", tmpPath, "-ss", String(trimStart)];
      if (trimEnd < totalDuration) args.push("-to", String(trimEnd));
      args.push("-c", "copy", tmpOut);
      await import("child_process").then((cp) => cp.spawnSync(ffmpegPath, args, { encoding: "utf8" }));
      // اگه به هر دلیلی خروجی ساخته نشد (خطایِ ffmpeg)، امن‌ترین کار
      // برگشتن به صدایِ اصلیِ بدونِ تریمه، نه شکستِ کلِ pipeline.
      if (!fs.existsSync(tmpOut) || fs.statSync(tmpOut).size === 0) {
        await fsp.copyFile(tmpPath, tmpOut);
      }
    }

    if (returnBuffer) {
      return await fsp.readFile(tmpOut);
    }
    await fsp.copyFile(tmpOut, outputPath);
    return outputPath;
  } catch (err) {
    console.warn("trimSilenceFromAudio شکست خورد، صدایِ اصلیِ بدونِ تریم استفاده می‌شه:", err.message);
    if (returnBuffer) return Buffer.isBuffer(input) ? input : await fsp.readFile(input);
    if (!Buffer.isBuffer(input)) await fsp.copyFile(input, outputPath);
    else await fsp.writeFile(outputPath, input);
    return outputPath;
  } finally {
    await fsp.unlink(tmpPath).catch(() => {});
    await fsp.unlink(tmpOut).catch(() => {});
  }
}

// ---------- detectLongSilences ----------
//
// فیکسِ ۲۰۲۶-۰۸-۳۰ — قبلاً placeholder بود (همیشه آرایه‌ی خالی برمی‌گردوند).
// این تابع عمداً فقط *تشخیص* می‌ده، هیچ‌چیزی رو نمی‌بره — pipeline.js
// نتیجه‌ش رو فقط لاگ می‌کنه، چون بریدنِ سکوت‌هایِ داخلی تایمینگِ از‌قبل‌
// محاسبه‌شده‌ی caption/تصویر رو به‌هم می‌زنه (توضیحِ کاملش تو pipeline.js
// کنارِ محلِ فراخوانی هست).
async function detectLongSilences(input, thresholdDb = -40, minDurationSec = 1) {
  const tmpPath = path.join(os.tmpdir(), `audio-silence-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
  try {
    if (Buffer.isBuffer(input)) {
      await fsp.writeFile(tmpPath, input);
    } else if (typeof input === "string") {
      await fsp.copyFile(input, tmpPath);
    } else {
      return [];
    }

    const { stderr } = await import("child_process").then((cp) =>
      cp.spawnSync(ffmpegPath, ["-i", tmpPath, "-af", `silencedetect=noise=${thresholdDb}dB:d=0.2`, "-f", "null", "-"], {
        encoding: "utf8",
      })
    );
    const text = stderr || "";
    const starts = [...text.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
    const ends = [...text.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));

    const gaps = [];
    for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
      if (ends[i] - starts[i] >= minDurationSec) gaps.push({ start: starts[i], end: ends[i] });
    }
    return gaps;
  } catch (err) {
    console.warn("detectLongSilences شکست خورد (نادیده گرفته می‌شه):", err.message);
    return [];
  } finally {
    await fsp.unlink(tmpPath).catch(() => {});
  }
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
    // فیکسِ ۲۰۲۶-۰۸-۲۲ — همون باگِ overflowِ زیرنویسِ رندرِ لانگ اینجا هم
    // بود (fontsize ثابت، بدونِ چکِ عرض) — از همون wrapCaptionText که
    // برای buildCaptionFilter نوشته شده استفاده می‌کنیم.
    const captionFilters = (captionLines || [])
      .map((line, i) => {
        const escaped = escapeDrawtextForShort(line.text);
        const wrappedText = wrapCaptionText(escaped, 44, W * 0.92).join("\n");
        const s = Math.max(0, line.startSec);
        const e = Math.max(s + 0.1, line.endSec);
        const alphaExpr =
          `if(lt(t,${s}),0,` +
          `if(lt(t,${(s + FADE).toFixed(2)}),(t-${s})/${FADE},` +
          `if(lt(t,${(e - FADE).toFixed(2)}),1,` +
          `if(lt(t,${e}),(${e}-t)/${FADE},0))))`;
        return (
          `drawtext=fontfile=${fontPath}:text='${wrappedText}':fontsize=44:fontcolor=white:` +
          `borderw=3:bordercolor=black@0.8:x=(w-text_w)/2:y=h-260:line_spacing=8:` +
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

    await runFfmpeg(args);

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
};

// Re-export from mayaThumbnail (will be loaded dynamically at runtime)
export async function getMayaThumbnailExports() {
  const { pickMayaPose, capThumbnailWords, buildMayaThumbnail, buildMayaThumbnailVariants, escapeDrawtextForShort } = await import("./mayaThumbnail.js");
  return { pickMayaPose, capThumbnailWords, buildMayaThumbnail, buildMayaThumbnailVariants, escapeDrawtextForShort };
}