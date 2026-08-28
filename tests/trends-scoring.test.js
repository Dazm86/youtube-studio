// Plain-assert test for lib/trends' pure functions, matching this
// project's existing "no test runner installed" convention — run with:
//   node tests/trends-scoring.test.js
import assert from 'node:assert/strict';
import {
  scoreSearchGrowth,
  scoreViewGrowth,
  scoreFreshness,
  scoreCompetition,
} from '../src/lib/trends/scoring.js';
import { mapWithConcurrency } from '../src/lib/trends/utils.js';

function series(values) {
  return values.map((value, i) => ({ time: i, value }));
}

// --- scoreSearchGrowth ---
assert.equal(scoreSearchGrowth(null), 12, 'no data -> neutral 12');
assert.equal(scoreSearchGrowth(series([1, 1, 1])), 12, 'too little data -> neutral 12');
{
  // Deliberately below the 0-25 midpoint, not at it — this criterion
  // measures growth specifically, so flat (0% change) should score below
  // neutral, not exactly neutral. See the comment in scoring.js.
  const flat = scoreSearchGrowth(series([10, 10, 10, 10, 10, 10]));
  assert.ok(flat >= 6 && flat <= 10, `flat interest should be below-midpoint, got ${flat}`);
}
{
  const rising = scoreSearchGrowth(series([5, 5, 5, 20, 25, 30]));
  const flat = scoreSearchGrowth(series([10, 10, 10, 10, 10, 10]));
  assert.ok(rising > flat, `rising series (${rising}) should score above flat (${flat})`);
}
{
  const falling = scoreSearchGrowth(series([30, 25, 20, 10, 5, 2]));
  assert.ok(falling <= 5, `sharply falling series should score low, got ${falling}`);
}
assert.ok(scoreSearchGrowth(series([5, 5, 5, 20, 25, 30])) <= 25, 'never exceeds max 25');

// --- scoreViewGrowth ---
assert.equal(scoreViewGrowth([]), 10, 'no videos -> neutral 10');
assert.equal(scoreViewGrowth(null), 10, 'null -> neutral 10');
{
  const hot = scoreViewGrowth([{ viewsPerDay: 2000 }, { viewsPerDay: 1800 }]);
  const cold = scoreViewGrowth([{ viewsPerDay: 5 }, { viewsPerDay: 2 }]);
  assert.ok(hot > cold, `high velocity (${hot}) should beat low velocity (${cold})`);
  assert.ok(hot <= 25 && cold >= 0, 'stays within 0-25 bounds');
}

// --- scoreFreshness ---
assert.equal(scoreFreshness(null), 7, 'no data -> neutral 7');
{
  // Rises right at the very end -> should score high (fresh)
  const justRose = scoreFreshness(series([5, 5, 5, 5, 5, 5, 5, 5, 5, 30]));
  // Elevated for the whole window, never crosses from a low baseline -> low score
  const alwaysHigh = scoreFreshness(series([30, 30, 30, 30, 30, 30, 30, 30, 30, 30]));
  assert.ok(justRose > alwaysHigh, `a fresh rise (${justRose}) should beat sustained-high (${alwaysHigh})`);
}

// --- scoreCompetition ---
assert.equal(scoreCompetition(null), 8, 'missing API key/failed call -> neutral 8');
assert.equal(scoreCompetition(undefined), 8, 'undefined -> neutral 8');
{
  const lowSupply = scoreCompetition(200);
  const highSupply = scoreCompetition(200000);
  assert.ok(lowSupply > highSupply, `low supply (${lowSupply}) should score above saturated (${highSupply})`);
  assert.ok(lowSupply <= 15 && highSupply >= 0, 'stays within 0-15 bounds');
}
assert.equal(scoreCompetition(0), 15, 'zero existing videos -> max score 15');

// --- mapWithConcurrency ---
{
  const order = [];
  const results = await mapWithConcurrency([30, 10, 20], 3, async (ms, i) => {
    await new Promise((r) => setTimeout(r, ms));
    order.push(i);
    return ms * 2;
  });
  assert.deepEqual(results, [60, 20, 40], 'preserves input order regardless of completion order');
  assert.deepEqual(order.sort(), [0, 1, 2], 'all items processed exactly once');
}
{
  let maxInFlight = 0;
  let inFlight = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
  });
  assert.ok(maxInFlight <= 2, `concurrency limit respected, saw ${maxInFlight} in flight`);
}

console.log('All lib/trends pure-function tests passed.');
