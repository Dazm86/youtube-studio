// ۲۰۲۶-۱۰-۰۱ — الگوهایِ ادعایِ درمانیِ غیرمجاز + disclaimerِ سلامت.
// از pipeline.js جدا شد تا بدونِ googleapis/node_modules قابلِ تست باشه؛
// pipeline.js همون checkRiskyKeywords رو re-export می‌کنه (API بدونِ تغییر).
//
// نکته: تشخیصِ این الگوها ویدیو رو PRIVATE آپلود می‌کنه (بازبینیِ دستی)،
// پس الگوها عمداً دقیق‌ان نه گسترده — یک الگویِ بیش‌ازحد عمومی یعنی
// خودکارسازی مدام متوقف می‌شه.
export const RISKY_CLAIM_PATTERNS = [
  /\bcures?\s+(your\s+)?(depression|anxiety|trauma|ptsd)\b/i,
  /\btreats?\s+(your\s+)?(depression|anxiety|trauma|ptsd)\b/i,
  /\breplaces?\s+(your\s+)?(therapy|medication|therapist)\b/i,
  /\bstop\s+taking\s+(your\s+)?medication\b/i,
  /\bguaranteed?\s+to\s+(cure|heal|fix)\b/i,
  /\bdiagnos(e|ed|is|ing)\b/i,
  // ۲۰۲۶-۱۰-۰۱ — الگوهایِ تازه
  /\bheals?\s+(your\s+)?(depression|anxiety|trauma|ptsd|panic)\b/i,
  /\b(clinically|scientifically|medically)\s+proven\s+to\s+(cure|heal|treat)\b/i,
  /\b(instead\s+of|no\s+need\s+for)\s+(therapy|medication|a\s+doctor|a\s+therapist|seeing\s+a\s+doctor)\b/i,
  /\bwill\s+(cure|heal)\s+(you|your)\b/i,
  /\bquit\s+(your\s+)?(meds|medication)\b/i,
  /\bcure[-\s]?all\b/i,
];

export function checkRiskyKeywords(script) {
  const hits = [];
  for (const pattern of RISKY_CLAIM_PATTERNS) {
    const m = (script || "").match(pattern);
    if (m) hits.push(m[0]);
  }
  return hits;
}

// موضوع‌هایِ سلامتِ روان — برایِ اینا یک خطِ disclaimer به توضیحاتِ ویدیو
// اضافه می‌شه (هم استانداردِ محتوایِ سلامت، هم محافظ در برابرِ ادعای ناخواسته).
const HEALTH_TOPIC_RE =
  /\b(anxiety|anxious|depress\w*|trauma\w*|ptsd|panic|burnout|therapy|therapist|medication|disorder|insomnia|suicid\w*|self[-\s]?harm)\b/i;

export const HEALTH_DISCLAIMER =
  "ℹ️ This video is for general wellbeing and education only — it isn't medical advice or a substitute for professional care. If you're struggling, please reach out to a qualified professional.";

export function needsHealthDisclaimer(script) {
  const text = script || "";
  return checkRiskyKeywords(text).length > 0 || HEALTH_TOPIC_RE.test(text);
}

// کلماتِ تماماً بزرگ (به‌جز خیلی کوتاه‌های رایج مثلِ "I") یا مخفف‌های
// چندحرفی که TTS ممکنه اشتباه تلفظ کنه — فقط تشخیص/لاگ، نه اصلاحِ خودکار
// (msedge-tts از طریقِ متنِ ساده صدا زده می‌شه، نه SSML با phoneme hint
// که بشه دقیقاً کنترلش کرد).
export function checkMispronunciationRisks(script) {
  const words = script.split(/\s+/);
  const suspicious = new Set();
  for (const w of words) {
    const clean = w.replace(/[^A-Za-z']/g, "");
    if (clean.length >= 2 && clean === clean.toUpperCase() && /[A-Z]/.test(clean) && clean !== "I") {
      suspicious.add(clean);
    }
  }
  return [...suspicious];
}
