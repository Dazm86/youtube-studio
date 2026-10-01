// ۲۰۲۶-۱۰-۰۱ — ساختِ filter_complexِ مرحله‌ی نهاییِ صدا، جدا از renderVideo
// تا بدونِ نیاز به ffmpeg/node_modules قابلِ تست باشه.
//
// دو چیزِ جدید نسبت به قبل:
// ۱. loudnorm (هدف -16 LUFS) تا بلندیِ صدا بینِ همه‌ی ویدیوها یکسان باشه.
//    `aresample=44100` بعدش لازمه چون loudnorm خروجی رو تا 192kHz
//    upsample می‌کنه (رفتارِ شناخته‌شده‌ی این فیلتر).
// ۲. fade in/out رویِ BGM، تا موزیک ناگهانی شروع/قطع نشه.
// normalize=false → همون filterِ قدیمی (بدونِ loudnorm)، برایِ fallback اگه
// ffmpegِ دیپلوی‌شده (قدیمی) با loudnorm شکست بخوره.

const LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100";

export function buildFinalAudioFilter({
  hasBgm = false,
  bgmVolume = 0.12,
  delayMs = 0,
  totalDurationSec = 0,
  normalize = true,
  fadeInSec = 2,
  fadeOutSec = 3,
} = {}) {
  const tail = normalize ? `,${LOUDNORM}` : "";
  const narr = delayMs > 0 ? `adelay=${delayMs}|${delayMs}` : null;

  if (!hasBgm) {
    const chain = [narr, normalize ? LOUDNORM : null].filter(Boolean).join(",");
    return `[1:a]${chain || "anull"}[a]`;
  }

  let bgm = `volume=${bgmVolume}`;
  if (fadeInSec > 0) bgm += `,afade=t=in:st=0:d=${fadeInSec}`;
  // fade-out فقط وقتی مدتِ کل معلومه و از fade-in+fade-out بلندتره
  if (fadeOutSec > 0 && totalDurationSec > fadeInSec + fadeOutSec + 1) {
    const st = (totalDurationSec - fadeOutSec).toFixed(2);
    bgm += `,afade=t=out:st=${st}:d=${fadeOutSec}`;
  }

  const narrLabel = narr ? `[1:a]${narr}[narr];` : "";
  const narrRef = narr ? "[narr]" : "[1:a]";
  return `${narrLabel}[2:a]${bgm}[bgm];${narrRef}[bgm]amix=inputs=2:duration=first${tail}[a]`;
}
