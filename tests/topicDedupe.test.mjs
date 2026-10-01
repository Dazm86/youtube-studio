// تستِ تشخیصِ موضوعِ تکراری (Trend Finder + auto-produce) و dedupeِ کلیپ‌ها
import assert from "assert";
import { similarity, findSimilarTitles } from "../src/lib/utils/topicSimilarity.js";
import { filterNewTopics } from "../src/lib/trends/dedupe.js";
import { mediaKey, pickUnused } from "../src/lib/media/dedupe.js";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✅", n); } catch (e) { fail++; console.log("  ❌", n, "—", e.message); } };

console.log("similarity");
t("موضوعِ کوتاه ≈ عنوانِ بلندِ همون موضوع", () =>
  assert.ok(similarity("stop overthinking at night", "How to Stop Overthinking at Night (3 Steps) | The Mindful Path") >= 0.6));
t("جمله‌بندیِ متفاوت با همون محتوا", () =>
  assert.ok(similarity("why you can't focus at work", "Can't Focus at Work? Here's Why (And How to Fix It)") >= 0.6));
t("موضوعِ نامرتبط → پایین", () =>
  assert.ok(similarity("morning breathing routine", "Why You Can't Sleep After Scrolling") < 0.6));
t("فقط یک کلمه‌ی مشترک → صفر (جلوگیریِ false positive)", () =>
  assert.strictEqual(similarity("anxiety before presentations", "anxiety relief exercises"), 0));
t("ورودیِ خالی/خیلی کوتاه امن است", () => {
  assert.strictEqual(similarity("", "abc def"), 0);
  assert.strictEqual(similarity("focus", "focus"), 0); // یک کلمه → بی‌معنی
});
t("findSimilarTitles بهترین‌ها رو مرتب می‌کنه", () => {
  const r = findSimilarTitles("stop overthinking at night", ["Cooking calm meals", "Stop Overthinking at Night Fast", "Morning stretch ideas"]);
  assert.strictEqual(r.length, 1);
  assert.ok(r[0].title.includes("Overthinking"));
});

console.log("\nfilterNewTopics (اسکنِ ترند)");
const cand = (topic, score) => ({ finalTopic: topic, scoreTotal: score });
t("موضوعِ ساخته‌شده دوباره پیشنهاد نمی‌شه", () => {
  const { kept, skipped } = filterNewTopics(
    [cand("Why you can't stop overthinking at night", 90), cand("Digital detox for beginners", 80)],
    ["Stop Overthinking at Night Fast"]
  );
  assert.deepStrictEqual(kept.map((k) => k.finalTopic), ["Digital detox for beginners"]);
  assert.strictEqual(skipped.length, 1);
});
t("دو کاندیدِ مشابه تو همین اسکن: فقط بالاترین امتیاز می‌مونه", () => {
  const { kept } = filterNewTopics([cand("morning anxiety relief routine", 95), cand("routine for morning anxiety relief", 85), cand("evening wind down ritual", 70)], []);
  assert.deepStrictEqual(kept.map((k) => k.finalTopic), ["morning anxiety relief routine", "evening wind down ritual"]);
});
t("لیستِ موجودِ خالی/null → همه می‌مونن", () => {
  assert.strictEqual(filterNewTopics([cand("a b c", 1)], null).kept.length, 1);
  assert.strictEqual(filterNewTopics(null, []).kept.length, 0);
});
t("از topic هم (نه فقط finalTopic) استفاده می‌کنه", () => {
  const { skipped } = filterNewTopics([{ topic: "stop overthinking at night" }], ["How to Stop Overthinking at Night"]);
  assert.strictEqual(skipped.length, 1);
});

console.log("\ndedupeِ کلیپ/عکس");
t("mediaKey: path، string، buffer", () => {
  assert.strictEqual(mediaKey({ path: "https://x/1.mp4" }), "https://x/1.mp4");
  assert.strictEqual(mediaKey("https://x/2.jpg"), "https://x/2.jpg");
  assert.strictEqual(mediaKey({ buffer: Buffer.from("a") }), null);
  assert.strictEqual(mediaKey(null), null);
});
t("pickUnused اولین استفاده‌نشده", () => {
  const used = new Set(["a", "b"]);
  assert.deepStrictEqual(pickUnused([{ path: "a" }, { path: "b" }, { path: "c" }, { path: "d" }], used), { path: "c" });
});
t("همه استفاده‌شده → null؛ آیتمِ بدونِ کلید (تولیدشده) همیشه مجازه", () => {
  assert.strictEqual(pickUnused([{ path: "a" }], new Set(["a"])), null);
  const gen = { buffer: Buffer.from("x") };
  assert.strictEqual(pickUnused([{ path: "a" }, gen], new Set(["a"])), gen);
  assert.strictEqual(pickUnused([], new Set()), null);
  assert.strictEqual(pickUnused(undefined, new Set()), null);
});

console.log(`\n${pass} پاس، ${fail} شکست`);
process.exit(fail ? 1 : 0);
