// ۲۰۲۶-۱۰-۰۱ — جلوگیری از تکرارِ یک کلیپ/عکس تو یک ویدیو.
// کلیدِ یکتا فقط برایِ آیتم‌هایِ URL-دار (Pexels و...) وجود داره؛ عکس‌هایِ
// تولیدشده (buffer) هیچ‌وقت تکراری نیستن و کلید null می‌گیرن.
export function mediaKey(item) {
  if (!item) return null;
  if (typeof item === "string") return item;
  return item.path || item.url || null;
}

// اولین آیتمی که قبلاً استفاده نشده؛ اگه همه استفاده شده بودن null
export function pickUnused(items, usedKeys) {
  for (const it of items || []) {
    const k = mediaKey(it);
    if (!k || !usedKeys.has(k)) return it;
  }
  return null;
}
