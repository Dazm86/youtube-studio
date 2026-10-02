// تستِ منطقِ «ایده‌هایِ من»: اعتبارسنجی، تطبیقِ فرمت، ساختنِ متنِ موضوع.
// (لایه‌ی DB نیاز به Postgres واقعی داره و اینجا تست نمی‌شه.)
import assert from "assert";
import { validateIdeaInput, ideaMatchesMode, buildIdeaTopic, MAX_IDEA_LENGTH } from "../src/lib/ideas/pick.js";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✅", n); } catch (e) { fail++; console.log("  ❌", n, "—", e.message); } };

console.log("validateIdeaInput");
t("ایده‌ی معتبر + پیش‌فرضِ فرمت both", () => {
  const r = validateIdeaInput({ idea: "  Why I can't sleep  " });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.value, { idea: "Why I can't sleep", notes: "", format: "both" });
});
t("فارسی هم پذیرفته می‌شه", () => assert.ok(validateIdeaInput({ idea: "چرا شب‌ها خوابم نمی‌بره", format: "short" }).ok));
t("خیلی کوتاه / خالی / undefined رد می‌شه", () => {
  assert.ok(!validateIdeaInput({ idea: "ab" }).ok);
  assert.ok(!validateIdeaInput({ idea: "   " }).ok);
  assert.ok(!validateIdeaInput(undefined).ok);
  assert.ok(!validateIdeaInput(null).ok);
});
t("بیش از حدِ مجاز رد می‌شه (ایده و توضیحات)", () => {
  assert.ok(!validateIdeaInput({ idea: "a".repeat(MAX_IDEA_LENGTH + 1) }).ok);
  assert.ok(validateIdeaInput({ idea: "a".repeat(MAX_IDEA_LENGTH) }).ok);
  assert.ok(!validateIdeaInput({ idea: "good idea", notes: "n".repeat(601) }).ok);
});
t("فرمتِ نامعتبر رد می‌شه", () => assert.ok(!validateIdeaInput({ idea: "good idea", format: "reel" }).ok));
t("پیامِ خطا فارسیه و با regexِ route (ایده|توضیحات|فرمت) تطبیق می‌خوره", () => {
  for (const bad of [{ idea: "x" }, { idea: "good idea", format: "z" }, { idea: "good idea", notes: "n".repeat(700) }]) {
    assert.ok(/ایده|توضیحات|فرمت/.test(validateIdeaInput(bad).error), JSON.stringify(bad));
  }
});
t("مقدارِ غیرِ رشته (عدد) بدونِ کرش", () => assert.ok(validateIdeaInput({ idea: 12345 }).ok));

console.log("\nideaMatchesMode");
t("both به هر نوعی می‌خوره", () => {
  assert.ok(ideaMatchesMode({ format: "both" }, "long") && ideaMatchesMode({ format: "both" }, "short"));
});
t("long فقط به long؛ short فقط به short", () => {
  assert.ok(ideaMatchesMode({ format: "long" }, "long") && !ideaMatchesMode({ format: "long" }, "short"));
  assert.ok(ideaMatchesMode({ format: "short" }, "short") && !ideaMatchesMode({ format: "short" }, "long"));
});
t("mode نامشخص → هر فرمتی قبوله؛ ایده‌ی null → false", () => {
  assert.ok(ideaMatchesMode({ format: "long" }, undefined));
  assert.ok(!ideaMatchesMode(null, "long"));
});

console.log("\nbuildIdeaTopic");
t("فقط ایده", () => assert.strictEqual(buildIdeaTopic({ idea: "Stop overthinking" }), "Stop overthinking"));
t("ایده + توضیح", () =>
  assert.strictEqual(buildIdeaTopic({ idea: "Stop overthinking", notes: "start with a work story" }),
    "Stop overthinking — extra direction from the channel owner: start with a work story"));
t('دابل‌کوتیشن به ۱ تک‌کوتیشن تبدیل می‌شه (generateScript موضوع رو تو "" می‌ذاره)', () => {
  const out = buildIdeaTopic({ idea: 'The "5 second" rule', notes: 'say "now"' });
  assert.ok(!out.includes('"'), out);
});
t("ورودیِ ناقص بدونِ کرش", () => {
  assert.strictEqual(buildIdeaTopic({}), "");
  assert.strictEqual(buildIdeaTopic(null), "");
});

console.log(`\n${pass} پاس، ${fail} شکست`);
process.exit(fail ? 1 : 0);
