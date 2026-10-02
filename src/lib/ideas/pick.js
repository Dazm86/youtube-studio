// ۲۰۲۶-۱۰-۰۱ — منطقِ pure (بدونِ DB) برایِ «ایده‌هایِ من»: اعتبارسنجی، ساختنِ
// متنِ موضوع برایِ generateScript، و تطبیقِ فرمتِ ایده با نوعِ ویدیو.

export const IDEA_FORMATS = ["both", "long", "short"];
export const MAX_IDEA_LENGTH = 300;
export const MAX_NOTES_LENGTH = 600;

// خروجی: { ok, value:{idea,notes,format} } یا { ok:false, error }
export function validateIdeaInput(input) {
  const idea = String(input?.idea ?? "").trim();
  const notes = String(input?.notes ?? "").trim();
  const format = input?.format ?? "both";
  if (idea.length < 3) return { ok: false, error: "ایده خیلی کوتاهه (حداقل ۳ حرف)" };
  if (idea.length > MAX_IDEA_LENGTH) return { ok: false, error: `ایده حداکثر ${MAX_IDEA_LENGTH} حرف می‌تونه باشه` };
  if (notes.length > MAX_NOTES_LENGTH) return { ok: false, error: `توضیحات حداکثر ${MAX_NOTES_LENGTH} حرف می‌تونه باشه` };
  if (!IDEA_FORMATS.includes(format)) return { ok: false, error: "فرمت باید both، long یا short باشه" };
  return { ok: true, value: { idea, notes, format } };
}

// آیا ایده برایِ این نوعِ ویدیو ("long"/"short") مناسبه؟
export function ideaMatchesMode(idea, mode) {
  if (!idea) return false;
  return idea.format === "both" || !mode || idea.format === mode;
}

// متنی که به generateScript به‌عنوانِ topic می‌ره. generateScript اون رو
// داخلِ دابل‌کوتیشن می‌ذاره، پس " به ' تبدیل می‌شه. توضیحاتِ اختیاری هم
// به‌عنوانِ راهنمایِ صاحبِ کانال کنارش می‌آد.
export function buildIdeaTopic(idea) {
  const base = String(idea?.idea ?? "").replace(/"/g, "'").trim();
  const notes = String(idea?.notes ?? "").replace(/"/g, "'").trim();
  return notes ? `${base} — extra direction from the channel owner: ${notes}` : base;
}
