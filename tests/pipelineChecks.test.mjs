// تست‌های واحد برای دو تابعِ کمکیِ pipeline.js (checkRiskyKeywords و
// checkMispronunciationRisks). برخلافِ scriptTiming.test.mjs (که هیچ
// وابستگی‌ای نداره)، pipeline.js خودش import هایی داره (googleapis, pg
// از طریقِ db.js، sharp از طریقِ videoRender.js/mayaThumbnail.js، ...) —
// یعنی این تست فقط بعد از یک npm install معمولیِ پروژه (نه تو یک محیطِ
// خالی) قابلِ‌اجراست. اجرا:
//
//   node tests/pipelineChecks.test.mjs

import assert from "node:assert/strict";
import { checkRiskyKeywords, checkMispronunciationRisks } from "../src/lib/pipeline.js";

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

console.log("checkRiskyKeywords");

test("اسکریپتِ معمولیِ mindfulness چیزی رو پرچم نمی‌زنه (بحثِ اضطراب/افسردگی به‌عنوانِ موضوع طبیعیه)", () => {
  const script =
    "Anxiety can feel overwhelming at night. Depression makes even small tasks feel heavy. Here are three habits that helped me find calm again.";
  assert.deepEqual(checkRiskyKeywords(script), []);
});

test("ادعای درمانیِ صریح پرچم می‌خوره", () => {
  const script = "This simple trick cures your anxiety completely, no therapy needed.";
  const hits = checkRiskyKeywords(script);
  assert.ok(hits.length > 0, "انتظار می‌رفت حداقل یک الگو تشخیص داده بشه");
});

test("توصیه به قطعِ دارو پرچم می‌خوره", () => {
  const hits = checkRiskyKeywords("You should stop taking your medication once you feel better.");
  assert.ok(hits.length > 0);
});

console.log("\ncheckMispronunciationRisks");

test("کلماتِ عادی چیزی برنمی‌گردونه", () => {
  const risks = checkMispronunciationRisks("This is a normal calm sentence about mindfulness.");
  assert.deepEqual(risks, []);
});

test("مخفف‌های تماماً بزرگ رو پیدا می‌کنه", () => {
  const risks = checkMispronunciationRisks("The CBT and ASMR methods both helped me a lot.");
  assert.ok(risks.includes("CBT"));
  assert.ok(risks.includes("ASMR"));
});

test("کلمه‌ی تنهای 'I' رو اشتباهی پرچم نمی‌زنه", () => {
  const risks = checkMispronunciationRisks("I know I can do this.");
  assert.deepEqual(risks, []);
});

console.log(`\n${passed} پاس، ${failed} شکست`);
if (failed > 0) process.exit(1);
