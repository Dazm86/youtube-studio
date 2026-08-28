/**
 * Runs fn(item, index) over items with at most `limit` in flight at once,
 * preserving output order. Used throughout lib/trends to keep a scan's
 * ~100+ external HTTP calls (Trends/YouTube/Reddit/News, one per seed and
 * per candidate) from running one at a time — sequential would make a
 * single scan take many minutes longer than it needs to.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
