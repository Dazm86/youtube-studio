export function splitSentences(text) {
  return (text.match(/[^.!?]+[.!?]*/g) || [text])
    .map((s) => s.trim())
    .filter(Boolean);
}

export function distributeDurations(script, imageCount, totalDuration) {
  const sentences = splitSentences(script);
  const wordCounts = sentences.map(
    (s) => s.split(/\s+/).filter(Boolean).length || 1
  );
  const totalWords = wordCounts.reduce((a, b) => a + b, 0) || 1;

  const buckets = new Array(imageCount).fill(0);
  const bucketText = new Array(imageCount).fill("");
  let acc = 0;
  let bucketIndex = 0;
  for (let i = 0; i < sentences.length; i++) {
    acc += wordCounts[i];
    buckets[bucketIndex] += wordCounts[i];
    bucketText[bucketIndex] += (bucketText[bucketIndex] ? " " : "") + sentences[i];
    const shareSoFar = acc / totalWords;
    if (
      shareSoFar >= (bucketIndex + 1) / imageCount &&
      bucketIndex < imageCount - 1
    ) {
      bucketIndex++;
    }
  }

  const minShare = 0.4 / imageCount;
  let shares = buckets.map((w) => Math.max(w / totalWords, minShare));
  const shareSum = shares.reduce((a, b) => a + b, 0);
  shares = shares.map((s) => s / shareSum);

  return {
    durations: shares.map((s) => totalDuration * s),
    captions: bucketText,
  };
}

export function escapeDrawtext(text) {
  return text
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

function formatSrtTime(totalSeconds) {
  const clamped = Math.max(0, totalSeconds);
  const wholeSeconds = Math.floor(clamped);
  const ms = Math.round((clamped - wholeSeconds) * 1000);
  const h = Math.floor(wholeSeconds / 3600);
  const m = Math.floor(wholeSeconds / 60) % 60;
  const s = wholeSeconds % 60;
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

// یک فایل SRT استاندارد از همون بخش‌ها/زمان‌بندی‌ای می‌سازه که برای
// جستجوی رسانه‌ی هر بخش هم استفاده شد — پس زیرنویس همیشه دقیقاً با
// همون تایمینگ ویدیوی رندرشده هماهنگه.
export function buildSrt(captions, durations) {
  let cursor = 0;
  const blocks = captions.map((text, i) => {
    const start = cursor;
    const end = cursor + durations[i];
    cursor = end;
    return `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${(text || "").trim()}\n`;
  });
  return blocks.join("\n");
}

export function wrapCaption(text, maxCharsPerLine) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? current + " " + w : w;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.join("\\n");
}
