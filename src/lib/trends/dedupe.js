// ۲۰۲۶-۱۰-۰۱ — فیلترِ موضوع‌هایِ تکراری برایِ اسکنِ Trend Finder.
// قبلاً هر اسکن فقط INSERT می‌کرد؛ یعنی موضوعی که ازش ویدیو ساخته شده بود
// (status='produced') دوباره با یک اسکنِ بعدی به‌عنوانِ «pending» برمی‌گشت و
// می‌شد دوباره تأییدش کرد و ساختش. این تابع (pure، بدونِ DB) کاندیدها رو با
// «موضوع‌هایِ موجود + عنوانِ ویدیوهایِ قبلی» مقایسه می‌کنه.
import { similarity } from "../utils/topicSimilarity.js";

export function filterNewTopics(candidates, existingTexts, { threshold = 0.6 } = {}) {
  const kept = [];
  const skipped = [];
  const known = [...(existingTexts || [])].filter(Boolean);
  for (const c of candidates || []) {
    const text = c.finalTopic || c.topic || "";
    let matched = null;
    for (const e of known) {
      if (similarity(text, e) >= threshold) { matched = e; break; }
    }
    if (matched) {
      skipped.push({ topic: text, matched });
    } else {
      kept.push(c);
      known.push(text); // دو کاندیدِ مشابه تو همین اسکن: فقط بهترین (لیست مرتب‌شده‌ست)
    }
  }
  return { kept, skipped };
}
