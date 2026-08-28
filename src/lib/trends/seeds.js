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

/**
 * Returns the active seed keyword list. Override via the TREND_SEED_KEYWORDS
 * env var (comma-separated) without touching code, e.g. in Render:
 *   TREND_SEED_KEYWORDS=morning routine,stoicism,burnout recovery
 */
export function getSeedKeywords() {
  const fromEnv = process.env.TREND_SEED_KEYWORDS;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return DEFAULT_SEED_KEYWORDS;
}
