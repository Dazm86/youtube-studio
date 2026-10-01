// تستِ safetyText (ادعایِ درمانی + disclaimer)، pronunciation (تلفظ) و greeting (سلامِ شورت)
import assert from "assert";
import { checkRiskyKeywords, needsHealthDisclaimer, HEALTH_DISCLAIMER } from "../src/lib/script/safetyText.js";
import { applyPronunciations, hasPronunciation } from "../src/lib/providers/pronunciation.js";
import { startsWithGreeting } from "../src/lib/script/greeting.js";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✅", n); } catch (e) { fail++; console.log("  ❌", n, "—", e.message); } };

console.log("ادعایِ درمانیِ جدید");
for (const [txt, label] of [
  ["Instead of therapy, just breathe for a minute.", "instead of therapy"],
  ["This habit heals your anxiety completely.", "heals your anxiety"],
  ["There is no need for a doctor if you do this.", "no need for a doctor"],
  ["Just quit your meds and focus on breathing.", "quit your meds"],
  ["Honestly it is a cure-all for stress.", "cure-all"],
  ["It is clinically proven to cure insomnia.", "clinically proven to cure"],
]) t(`پرچم می‌خوره: ${label}`, () => assert.ok(checkRiskyKeywords(txt).length > 0, txt));
for (const txt of [
  "Meditation can complement therapy and give you a calmer morning.",
  "Many people feel anxious before a big meeting, and that is normal.",
  "Take three slow breaths and notice your shoulders drop.",
]) t(`پرچم نمی‌خوره: ${txt.slice(0, 40)}…`, () => assert.deepStrictEqual(checkRiskyKeywords(txt), []));

console.log("\nDisclaimer");
t("موضوعِ اضطراب → disclaimer", () => assert.ok(needsHealthDisclaimer("Why anxiety peaks at night and what helps.")));
t("ادعایِ ریسکی → disclaimer", () => assert.ok(needsHealthDisclaimer("It will cure you.")));
t("موضوعِ عادی (آشپزی ذهن‌آگاه) → بدونِ disclaimer", () => assert.ok(!needsHealthDisclaimer("A calm way to wash dishes and enjoy the warm water.")));
t("متنِ disclaimer خالی/خیلی بلند نیست", () => assert.ok(HEALTH_DISCLAIMER.length > 40 && HEALTH_DISCLAIMER.length < 300));

console.log("\nدیکشنریِ تلفظ");
t("ADHD و CBT حرف‌به‌حرف", () => assert.strictEqual(applyPronunciations("ADHD and CBT help."), "A D H D and C B T help."));
t("مخففِ چسبیده به نقطه/کاما هم درست", () => assert.strictEqual(applyPronunciations("Try CBT, not OCD."), "Try C B T, not O C D."));
t("کلمه‌ی بزرگتر که شاملِ مخفف است دست نمی‌خوره", () => assert.strictEqual(applyPronunciations("ADHDX and XCBT"), "ADHDX and XCBT"));
t("e.g. و etc. به‌صورتِ متن", () => assert.strictEqual(applyPronunciations("Use tools, e.g. a timer, etc."), "Use tools, for example a timer, and so on"));
t("حروفِ کوچک (adhd) دست نمی‌خوره", () => assert.strictEqual(applyPronunciations("adhd"), "adhd"));
t("متنِ بدونِ مخفف بدونِ تغییر", () => assert.strictEqual(applyPronunciations("Breathe in slowly."), "Breathe in slowly."));
t("override از env", () => {
  process.env.PRONUNCIATION_OVERRIDES = JSON.stringify({ GAD: "G A D" });
  assert.strictEqual(applyPronunciations("GAD is common."), "G A D is common.");
  assert.ok(hasPronunciation("GAD"));
  process.env.PRONUNCIATION_OVERRIDES = "{bad json";
  assert.strictEqual(applyPronunciations("ADHD"), "A D H D"); // JSON خراب نباید کرش کنه
  delete process.env.PRONUNCIATION_OVERRIDES;
});
t("hasPronunciation برایِ مخففِ پیش‌فرض", () => assert.ok(hasPronunciation("ADHD") && !hasPronunciation("ASAP")));

console.log("\nسلامِ ابتدایِ شورت");
for (const g of ["Hey, quick tip for you.", "Hi there, I'm Maya.", "Welcome back to the channel", "Hello everyone", "I'm Maya and today we", "Today we're talking about sleep", "In this video I show you", "This is Maya.", "Good morning!"])
  t(`سلام شناسایی می‌شه: ${g}`, () => assert.ok(startsWithGreeting(g)));
for (const g of ["Stop scrolling. Do this instead.", "Today, stop doing this one thing.", "I'm tired of fake advice.", "Heyday of your focus is now.", "Your brain isn't broken.", ""])
  t(`سلام نیست: ${g || "(خالی)"}`, () => assert.ok(!startsWithGreeting(g)));

console.log(`\n${pass} پاس، ${fail} شکست`);
process.exit(fail ? 1 : 0);
