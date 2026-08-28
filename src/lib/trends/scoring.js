// Deterministic half of the scoring rubric (0-100 total):
//   searchGrowth   0-25  (Google Trends interest slope)
//   viewGrowth     0-25  (YouTube recent view velocity)
//   freshness      0-15  (how recently the topic left its own baseline)
//   competition    0-15  (LOWER existing supply = HIGHER score, on purpose)
// The other two (shortsFit, longFit, 0-10 each) are AI judgment calls made
// in analyzer.js, since "does this fit a 60s format" isn't something a
// time-series can answer.
//
// The whole point of this file is the strategy note the project owner
// gave: for a brand-new channel, a topic that is ALREADY huge is a worse
// target than a smaller topic that's clearly rising and not yet crowded.
// That's why competition rewards LOW saturation and freshness rewards a
// RECENT rise rather than sustained high interest.

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function average(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * 0-25. Compares the average of the most recent ~1/3 of the interest
 * series against the average of the ~1/3 before that. A neutral 12 is
 * returned when there isn't enough data (e.g. Trends call failed) so a
 * missing signal doesn't zero out an otherwise-good candidate.
 */
export function scoreSearchGrowth(interestSeries) {
  if (!interestSeries || interestSeries.length < 6) return 12;
  const values = interestSeries.map((p) => p.value);
  const third = Math.max(2, Math.floor(values.length / 3));
  const recent = average(values.slice(-third));
  const prior = average(values.slice(-2 * third, -third));
  if (prior <= 0) return recent > 0 ? 25 : 10;
  const pctChange = (recent - prior) / prior;
  // -50% or worse -> 0, flat (0%) -> ~8 (deliberately below the 12.5
  // midpoint — this criterion is specifically about growth, so "not
  // growing" should score below neutral, not at it), +100% or more -> 25
  const normalized = clamp((pctChange + 0.5) / 1.5, 0, 1);
  return Math.round(normalized * 25);
}

/**
 * 0-25. Uses recent videos' views-per-day-since-published as a velocity
 * signal, scaled against a modest baseline appropriate for a niche topic
 * (not a mainstream-viral one) so a handful of solidly-performing recent
 * uploads is enough to score well, without requiring viral outliers.
 */
export function scoreViewGrowth(youtubeItems) {
  if (!youtubeItems || youtubeItems.length === 0) return 10;
  const velocities = youtubeItems.map((v) => v.viewsPerDay).sort((a, b) => b - a);
  const topHalf = velocities.slice(0, Math.max(1, Math.ceil(velocities.length / 2)));
  const avgVelocity = average(topHalf);
  // 0 views/day -> 0; ~500/day -> ~18; 1500+/day -> 25 (niche-appropriate
  // scale, not mainstream-viral thresholds)
  const normalized = clamp(avgVelocity / 1500, 0, 1);
  return Math.round(normalized * 25);
}

/**
 * 0-15. Finds the most recent point where the series crossed from its own
 * "baseline" (bottom third of its range) up into "elevated" (top half),
 * and scores higher the more recent that crossing was. A topic that's
 * been elevated for the whole window (no recent baseline-crossing found)
 * scores low here even if it's currently high, because it isn't fresh.
 */
export function scoreFreshness(interestSeries) {
  if (!interestSeries || interestSeries.length < 6) return 7;
  const values = interestSeries.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range <= 0) return 5;
  const baselineCeiling = min + range / 3;
  const elevatedFloor = min + range / 2;

  let crossingIndex = -1;
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] <= baselineCeiling && values[i] >= elevatedFloor) {
      crossingIndex = i;
    }
  }
  if (crossingIndex === -1) return 5; // never left baseline, or has been up the whole time

  const pointsFromEnd = values.length - 1 - crossingIndex;
  const fractionFromEnd = pointsFromEnd / values.length; // 0 = crossed right at the end (freshest)
  const normalized = clamp(1 - fractionFromEnd, 0, 1);
  return Math.round(normalized * 15);
}

/**
 * 0-15. LOWER existing YouTube supply for the exact keyword = HIGHER
 * score. totalResults is search.list's total-match estimate; null (API
 * key missing / call failed) returns a neutral mid-score rather than
 * penalizing every candidate for a missing key.
 */
export function scoreCompetition(totalResults) {
  if (totalResults === null || totalResults === undefined) return 8;
  // <1k results: wide open (15). ~50k+ results: saturated (0).
  const saturation = clamp(Math.log10(Math.max(1, totalResults)) / Math.log10(50000), 0, 1);
  return Math.round((1 - saturation) * 15);
}
