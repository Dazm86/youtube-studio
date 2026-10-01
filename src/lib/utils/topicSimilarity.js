// ۲۰۲۶-۱۰-۰۱ — تشخیصِ موضوع/عنوانِ تکراری، با هم‌پوشانیِ کلماتِ معنادار
// (Jaccard روی کلماتِ غیرِ stopword، با ریشه‌یابیِ خیلی ساده). مقایسه‌ی
// رشته‌ای ساده‌ست، نه AI/embedding — برای «این تقریباً همون ویدیوی قبلیه»
// کافیه و هزینه‌ای نداره.
const STOP = new Set(
  ("a an the and or but of to in on for with at by from as is are was were be been it its this that these those " +
    "you your youre yours i me my we our they their he she his her how why what when where which who whom " +
    "do does did doing done can could should would will just not no so if then than too very more most " +
    "about into out up down over under again still also why's how's and's way ways things thing " +
    "mindful path the's").split(/\s+/)
);

function stem(w) {
  return w.replace(/(ing|ed|es|s)$/, (m, _g, off) => (off >= 3 ? "" : m));
}

export function contentTokens(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .replace(/'/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem)
  );
}

// ضریبِ هم‌پوشانی (intersection / کوچک‌ترین مجموعه) به‌جای Jaccard: یک
// «موضوع» کوتاه ("stop overthinking at night") باید با یک «عنوانِ» بلند
// ("How to Stop Overthinking at Night (3 Steps)") تطبیق بخوره؛ Jaccard
// به‌خاطرِ کلماتِ اضافیِ عنوان همیشه پایین می‌اومد. برایِ جلوگیری از
// تطبیقِ اشتباه با یک کلمه‌ی مشترک، حداقل ۲ کلمه‌ی معنادارِ مشترک و حداقل
// ۲ کلمه در کوچک‌ترین طرف لازمه.
export function similarity(a, b) {
  const A = contentTokens(a);
  const B = contentTokens(b);
  const smaller = Math.min(A.size, B.size);
  if (smaller < 2) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  if (inter < 2) return 0;
  return inter / smaller;
}

export function findSimilarTitles(candidate, titles, { threshold = 0.6, limit = 3 } = {}) {
  return (titles || [])
    .map((title) => ({ title, score: similarity(candidate, title) }))
    .filter((r) => r.score >= threshold)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}
