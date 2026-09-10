// src/lib/script/visualKeywords.js
//
// ۲۰۲۶-۰۹-۰۸ — کاربر گزارش داد فوتیجِ یک ویدیوی خاص (درباره‌ی گوشی/خواب)
// اصلاً با متن جور درنمی‌اومد، و ثانیه‌ی اول (هوک) بلافاصله موضوع رو
// نشون نمی‌داد. ریشه‌ش اینجا بود: مسیرِ خودکارِ فعلی (وقتی imageKeyword
// دستی خالیه — یعنی همیشه، مگر کاربر دستی چیزی تایپ کنه) برای هر بخش
// فقط raw caption رو به fetchImages/fetchClips می‌ده (به‌عنوانِ `text`،
// نه `keyword`)، و اونجا نهایتاً extractKeywords() تو
// providers/textUtils.js صداش می‌زنه — که کاملاً محلی/بدونِ AI و صرفاً
// «پرتکرارترین کلمه‌های غیرِ stopword» ه. رویِ یک جمله‌ی تکی (نه یک
// پاراگراف)، تقریباً هیچ کلمه‌ای تکرار نمی‌شه، پس "پرتکرارترین" عملاً
// می‌شه «همون ۴ تا کلمه‌ی اول که stopword نیستن» — بدونِ هیچ فرقی بینِ
// یک اسمِ عینی/قابل‌جستجو (phone, bed, clock) و یک فعل/کلمه‌ی انتزاعیِ
// بی‌ربط (check, finally, trying). این تابع اون حلقه رو با یک فراخوانیِ
// AI (یک‌جا برای کلِ ویدیو، دقیقاً همون الگوی batch-ی translateCaptions
// تو script/translate.js) جایگزین می‌کنه: برای هر caption، ۲-۴ کلمه‌ی
// *کاملاً عینی/دیداری* (اسم/صحنه‌ی فیزیکی، هیچ‌وقت احساس/مفهومِ انتزاعی)
// برمی‌گردونه — و برای بخشِ اول (هوک) صراحتاً می‌خواد که واضح‌ترین صحنه‌ی
// ممکن باشه، چون همون ثانیه‌ی اولیه‌ای‌یه که کاربر باید موضوع رو بفهمه.
//
// اگه این فراخوانی به هر دلیلی (rate-limit، خطای شبکه، JSON نامعتبر)
// شکست بخوره، caller باید graceful به همون مسیرِ قدیمی (fetchImages/
// fetchClips با {text: captions[i]}) برگرده — دقیقاً همون فلسفه‌ی
// «تخریبِ آروم»ی که بقیه‌ی این پروژه همه‌جا داره.

import { generateText } from "../providers/router.js";

const BATCH_SIZE = 12; // همون سقفِ امن‌شده‌ی translateCaptions — دلیلش رو بالا نوشتم

// نکته‌ی مهم: قانونِ ویژه‌ی «جمله‌ی #۱ = هوکِ کلِ ویدیو» فقط باید وقتی تو
// prompt باشه که این batch واقعاً از ایندکسِ ۰ی کلِ ویدیو شروع می‌شه —
// وگرنه (تو ویدیوهای بلندی که چند batch می‌شن) هر batch فکر می‌کرد
// اولین جمله‌ی *خودش* هوکِ کل ویدیوئه، که غلطه.
async function requestVisualKeywords(captions, strict, isFirstBatch) {
  const strictNote = strict
    ? `\n\nIMPORTANT: a previous attempt returned the wrong number of items. Double-check before answering: the output array must have exactly one entry per input sentence, in the same order. Never merge, split, skip, or reorder.`
    : "";
  const hookNote = isFirstBatch
    ? `\n\nSpecial rule for sentence #1 only (the video's opening hook): the query must capture the single most literal, unambiguous scene that lets a viewer understand what this whole video is about within the first second of seeing it on screen — prioritize obviousness over subtlety, even if sentence #1 itself reads more general than that.`
    : "";

  const prompt = `You're picking stock-footage/stock-photo search queries for a video, one per narration sentence below. Each query must describe a CONCRETE, PHYSICAL, VISUALLY FILMABLE scene — specific objects, settings, or actions (e.g. "person lying bed phone screen", "empty coffee cup morning light", "hand touching phone screen") — never an abstract feeling, emotion, or concept word (never things like "anxiety", "stress", "mindfulness", "growth", "journey"). If a sentence is abstract, infer the most literal physical scene a viewer would associate with it, don't just repeat its abstract words.${hookNote}${strictNote}

Sentences (JSON array, in order):
${JSON.stringify(captions)}

Return ONLY this JSON shape, nothing else — one query (2-4 words) per sentence, same order, same count:
{"queries": ["...", "..."]}`;

  const rawText = await generateText({ prompt, jsonMode: true, temperature: 0.3, maxTokens: 1500 });

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("پاسخِ کلیدواژه‌های تصویری یک JSON معتبر نبود");
  }

  const queries = parsed.queries;
  if (!Array.isArray(queries) || queries.length !== captions.length) {
    throw new Error(
      `کلیدواژه‌های تصویری تعداد نامعتبر برگردوند (${Array.isArray(queries) ? queries.length : "نامعتبر"} به‌جای ${captions.length})`
    );
  }
  return queries;
}

async function visualKeywordsBatch(captions, isFirstBatch) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await requestVisualKeywords(captions, attempt > 1, isFirstBatch);
    } catch (err) {
      lastError = err;
      if (attempt === 1) {
        console.warn(`کلیدواژه‌های تصویری بار اول شکست خورد (${err.message}) — یک تلاش دیگه...`);
      }
    }
  }
  throw lastError;
}

// captions: آرایه‌ی همون caption هایی که distributeDurations() تو
// pipeline.js تولید می‌کنه (هر index دقیقاً متناظر با یک بخشِ رسانه‌ست).
// خروجی: آرایه‌ی هم‌طولِ رشته‌های query، یا throw اگه AI شکست خورد —
// caller (pipeline.js) مسئولِ catch‌کردن و برگشتن به مسیرِ قدیمیه.
export async function extractVisualKeywordsForSegments(captions) {
  if (!captions || captions.length === 0) return [];
  if (captions.length <= BATCH_SIZE) {
    return await visualKeywordsBatch(captions, true);
  }
  const results = [];
  for (let i = 0; i < captions.length; i += BATCH_SIZE) {
    const batch = captions.slice(i, i + BATCH_SIZE);
    const queries = await visualKeywordsBatch(batch, i === 0);
    results.push(...queries);
  }
  return results;
}
