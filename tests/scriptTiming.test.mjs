// تست‌های واحد برای src/lib/scriptTiming.js — بدونِ هیچ وابستگیِ جدید
// (نه jest، نه هیچ test runner ای)، فقط assert خودِ Node. اجرا:
//
//   node tests/scriptTiming.test.mjs
//
// این فایل خودِ فایلِ واقعیِ سورس رو مستقیم import می‌کنه (نه یک کپی)،
// پس همیشه دقیقاً همون کدی که رندر واقعی استفاده می‌کنه رو تست می‌کنه.
// scriptTiming.js هیچ importی نداره (کاملاً خودکفاست)، پس اجرای مستقیمش
// با node ساده هم بدونِ نیاز به Next.js/webpack کار می‌کنه.

import assert from "node:assert/strict";
import {
  splitSentences,
  distributeDurations,
  buildSrt,
  validateSrt,
  regroupForSubtitles,
} from "../src/lib/script/timing.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
  }
}

console.log("distributeDurations");

test("هیچ بخشی خالی نمی‌مونه وقتی جمله‌ها کمتر از imageCount ان (باگِ اصلیِ فیکس‌شده)", () => {
  // این دقیقاً همون سناریوییه که باعثِ باگِ واقعی شد: یک اسکریپتِ ۱۰ جمله‌ای
  // با imageCount=20 (هدفِ «برشِ هر ۲.۵ ثانیه» برای شورت‌ها). قبل از فیکس،
  // نیمیِ بخش‌ها کاملاً خالی می‌موندن.
  const script = Array.from({ length: 10 }, (_, i) => `This is sentence number ${i + 1} with some words in it.`).join(" ");
  const { captions } = distributeDurations(script, 20, 50);
  const emptyCount = captions.filter((c) => !c || !c.trim()).length;
  assert.equal(emptyCount, 0, `انتظار می‌رفت هیچ بخشِ خالی‌ای نباشه، ولی ${emptyCount} بخش خالی بود`);
});

test("مجموعِ durations همیشه دقیقاً برابرِ totalDuration ـه", () => {
  const script = "word ".repeat(200);
  const { durations } = distributeDurations(script, 20, 50);
  const sum = durations.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 50) < 0.001, `مجموع ${sum} بود، انتظار ۵۰ می‌رفت`);
});

test("طولِ captions/durations همیشه دقیقاً برابرِ imageCount درخواستی‌ست", () => {
  const script = "word ".repeat(200);
  const { durations, captions } = distributeDurations(script, 17, 50);
  assert.equal(captions.length, 17);
  assert.equal(durations.length, 17);
});

test("اسکریپتِ کاملاً خالی 'undefined' تولید نمی‌کنه (باگِ لبه‌ایِ فیکس‌شده)", () => {
  const { captions } = distributeDurations("", 8, 30);
  for (const c of captions) {
    assert.notEqual(c, "undefined", "کپشن نباید حرفاً رشته‌ی 'undefined' باشه");
  }
});

test("کلماتِ بازسازی‌شده از کنارِ هم گذاشتنِ بخش‌ها، ترتیبِ اصلیِ اسکریپت رو حفظ می‌کنه", () => {
  const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
  const script = words.join(" ");
  const { captions } = distributeDurations(script, 4, 20);
  const reconstructed = captions.join(" ").split(/\s+/).filter(Boolean);
  assert.deepEqual(reconstructed, words);
});

console.log("\nvalidateSrt");

test("طول و مقادیرِ معتبر → valid=true", () => {
  const r = validateSrt(["a", "b", "c"], [1, 2, 3]);
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test("طولِ نامنطبقِ captions/durations رد می‌شه", () => {
  const r = validateSrt(["a", "b"], [1]);
  assert.equal(r.valid, false);
  assert.ok(r.errors.length > 0);
});

test("duration ی NaN رد می‌شه (وگرنه SRT به 'NaN:NaN:NaN,NaN' می‌شکست)", () => {
  const r = validateSrt(["a", "b"], [1, NaN]);
  assert.equal(r.valid, false);
});

test("duration ی صفر یا منفی رد می‌شه", () => {
  assert.equal(validateSrt(["a", "b"], [1, 0]).valid, false);
  assert.equal(validateSrt(["a", "b"], [1, -2]).valid, false);
});

test("متنِ خالی رد می‌شه", () => {
  const r = validateSrt(["a", ""], [1, 2]);
  assert.equal(r.valid, false);
});

console.log("\nbuildSrt");

test("خروجیِ SRT شاملِ تایم‌کدهای دنباله‌دار و متنِ درسته", () => {
  const srt = buildSrt(["hello", "world"], [2, 3]);
  assert.ok(srt.includes("00:00:00,000 --> 00:00:02,000"));
  assert.ok(srt.includes("00:00:02,000 --> 00:00:05,000"));
  assert.ok(srt.includes("hello"));
  assert.ok(srt.includes("world"));
});

console.log("\nsplitSentences");

test("جمله‌ها رو درست از هم جدا می‌کنه", () => {
  const sentences = splitSentences("Hello world. How are you? I am fine!");
  assert.equal(sentences.length, 3);
});

console.log("\nregroupForSubtitles");

test("بخش‌های کوچیک رو تا رسیدن به بازه‌ی هدف با هم ادغام می‌کنه", () => {
  // ۱۰ بخشِ ۱ ثانیه‌ای رو با هدفِ ۵-۱۰ ثانیه بده — باید تعدادِ خیلی کمتری
  // بلوکِ بزرگ‌تر برگردونه، نه ۱۰ بلوکِ ۱ ثانیه‌ای.
  const captions = Array.from({ length: 10 }, (_, i) => `word${i}`);
  const durations = Array.from({ length: 10 }, () => 1);
  const { captions: regrouped, durations: regroupedDurations } = regroupForSubtitles(
    captions,
    durations,
    5,
    10
  );
  assert.equal(regrouped.length, regroupedDurations.length);
  assert.ok(
    regrouped.length < 10,
    `انتظار ادغام می‌رفت، ولی ${regrouped.length} بلوک برگشت (بدونِ تغییر)`
  );
});

console.log(`\n${passed} پاس، ${failed} شکست`);
if (failed > 0) process.exit(1);
