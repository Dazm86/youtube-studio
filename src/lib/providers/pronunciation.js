// ۲۰۲۶-۱۰-۰۱ — دیکشنریِ تلفظ: قبل از TTS، مخففِ‌هایی که موتورِ صدا اشتباه
// می‌خونه (مثلاً «ADHD» رو یک کلمه) به شکلِ حرف‌به‌حرف بازنویسی می‌شن.
// فقط متنِ ورودیِ TTS عوض می‌شه — اسکریپت، زیرنویس و توضیحات دست‌نخورده‌ان.
// اضافه‌کردنِ مورد جدید بدونِ تغییرِ کد: env به‌شکلِ JSON، مثلاً
//   PRONUNCIATION_OVERRIDES={"GAD":"G A D","Nietzsche":"Nee-chuh"}

const DEFAULT_ENTRIES = [
  ["ADHD", "A D H D"],
  ["PTSD", "P T S D"],
  ["OCD", "O C D"],
  ["CBT", "C B T"],
  ["DBT", "D B T"],
  ["MBSR", "M B S R"],
  ["HRV", "H R V"],
  ["ASMR", "A S M R"],
  ["e.g.", "for example", "i"],
  ["i.e.", "that is", "i"],
  ["vs.", "versus", "i"],
  ["etc.", "and so on", "i"],
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readOverrides() {
  try {
    const raw = process.env.PRONUNCIATION_OVERRIDES;
    if (!raw) return [];
    const obj = JSON.parse(raw);
    return Object.entries(obj).filter(([k, v]) => typeof k === "string" && typeof v === "string");
  } catch {
    return [];
  }
}

function allEntries(extra) {
  return [...DEFAULT_ENTRIES, ...readOverrides(), ...(extra || [])];
}

export function applyPronunciations(text, extraEntries) {
  if (!text) return text;
  let out = text;
  for (const [from, to, flags] of allEntries(extraEntries)) {
    // lookaround به‌جایِ \b تا کلیدهایِ دارایِ نقطه ("e.g.") هم درست کار کنن
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(from)}(?![A-Za-z0-9])`, `g${flags || ""}`);
    out = out.replace(re, to);
  }
  return out;
}

// آیا این کلمه‌ی تماماً بزرگ زیرِ پوششِ دیکشنری هست؟ (برایِ فیلترِ لاگِ هشدار)
export function hasPronunciation(word) {
  return allEntries().some(([from]) => from === word);
}
