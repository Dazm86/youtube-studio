// Niche seed keywords for The Mindful Path's Trend Finder.
//
// Google Trends' global "daily trending searches" is mostly sports/
// politics/celebrity noise that's irrelevant to a mindfulness channel.
// Instead, each seed below is used to pull *related* and *rising* queries
// from Google Trends (i.e. "what's rising near this topic"), which keeps
// every candidate on-niche by construction. The same seeds are also used
// to query Google News per-topic.
//
// Edit this list any time the channel's content focus shifts — no code
// changes needed elsewhere, everything downstream just consumes
// getSeedKeywords().

export const DEFAULT_SEED_KEYWORDS = [
  'morning routine',
  'anxiety relief',
  'self discipline',
  'mindfulness practice',
  'meditation for beginners',
  'burnout recovery',
  'self love',
  'stoicism',
  'emotional healing',
  'productivity habits',
  'inner peace',
  'overthinking',
  'confidence building',
  'gratitude practice',
  'digital detox',
  'personal growth',
  'setting boundaries',
  'imposter syndrome',
];

// ۲۰۲۶-۰۸-۳۰ — کلیدواژه‌های فصلی، بر اساسِ ماهِ میلادیِ جاری، به‌صورتِ
// خودکار به لیستِ بالا *اضافه* می‌شن (نه جایگزینش) — یعنی ربطِ موضوعیِ
// کانال دست‌نخورده می‌مونه، فقط زاویه‌ی به‌روز هم بهش اضافه می‌شه. تقویمِ
// عمومیِ غربی/انگلیسی‌زبان (چون کلِ محتوایِ کانال هم انگلیسیه) — قابلِ
// ویرایش یا کاملاً غیرفعال‌کردن با TREND_SEASONAL_KEYWORDS=false.
const SEASONAL_KEYWORDS_BY_MONTH = {
  1: ['new year resolutions', 'new year new me', 'resolution burnout'],
  2: ['relationship anxiety', 'loneliness', 'self love'],
  3: ['spring cleaning mindset', 'fresh start motivation'],
  4: ['seasonal mood change', 'spring anxiety'],
  5: ['exam stress', 'finals anxiety'],
  6: ['summer burnout', 'summer body pressure'],
  7: ['vacation anxiety', 'summer slump'],
  8: ['back to school anxiety', 'school year stress'],
  9: ['back to school anxiety', 'productivity reset'],
  10: ['seasonal affective mood', 'fall anxiety'],
  11: ['holiday stress', 'family gathering anxiety', 'gratitude practice'],
  12: ['holiday burnout', 'year end reflection', 'new year anxiety'],
};

function getSeasonalKeywords() {
  const month = new Date().getMonth() + 1; // JS: 0-11 -> تقویمِ معمولی: 1-12
  return SEASONAL_KEYWORDS_BY_MONTH[month] || [];
}

/**
 * Returns the active seed keyword list. Override the base niche list via
 * the TREND_SEED_KEYWORDS env var (comma-separated), e.g. in Render:
 *   TREND_SEED_KEYWORDS=morning routine,stoicism,burnout recovery
 * Seasonal keywords (current month) are added on top of whichever base
 * list is active, unless TREND_SEASONAL_KEYWORDS=false.
 */
export function getSeedKeywords() {
  const fromEnv = process.env.TREND_SEED_KEYWORDS;
  const base =
    fromEnv && fromEnv.trim()
      ? fromEnv
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : DEFAULT_SEED_KEYWORDS;

  if (process.env.TREND_SEASONAL_KEYWORDS === 'false') return base;

  const seasonal = getSeasonalKeywords();
  const combined = [...base];
  for (const kw of seasonal) {
    if (!combined.includes(kw)) combined.push(kw);
  }
  return combined;
}
