// همون منطقِ استخراج کلیدواژه‌ای که قبلاً تو media.js بود — اینجا منتقل
// شده تا هم آداپتورهای provider (که تو پوشه‌ی providers/ هستن) بتونن
// بدون import چرخه‌ای صداش بزنن، هم media.js خودش (که حالا فقط یک
// wrapper نازک روی router هست).

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "to", "of", "in", "on", "at", "for", "with", "by", "from",
  "as", "that", "this", "these", "those", "it", "its", "i", "you", "he",
  "she", "we", "they", "them", "his", "her", "our", "your", "their", "not",
  "no", "so", "if", "then", "than", "too", "very", "can", "will", "just",
  "about", "into", "over", "after", "before", "up", "down", "out", "off",
  "again", "there", "here", "what", "when", "where", "why", "how", "all",
  "any", "both", "each", "few", "more", "most", "other", "some", "such",
  "only", "own", "same", "also",
]);

export function extractKeywords(text, count = 4) {
  const words = (text || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([w]) => w)
    .join(" ");
}
