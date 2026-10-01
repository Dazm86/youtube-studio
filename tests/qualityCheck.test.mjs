// تستِ منطقِ بررسیِ کیفیت + (اگه ffmpeg باشه) خروجیِ واقعیِ ffmpeg روی فایل‌هایِ ساختگی
import assert from "assert";
import { spawnSync } from "child_process";
import { parseQualityOutput, evaluateQuality } from "../src/lib/rendering/qualityCheck.js";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✅", n); } catch (e) { fail++; console.log("  ❌", n, "—", e.message); } };

const GOOD = "Stream #0:0: Video: h264\nStream #0:1: Audio: aac\n[Parsed_volumedetect_0 @ x] mean_volume: -22.5 dB\n[Parsed_volumedetect_0 @ x] max_volume: -3.0 dB";
console.log("evaluateQuality");
t("ویدیوی سالم → ok", () => assert.ok(evaluateQuality(parseQualityOutput(GOOD), { durationSec: 40, fileBytes: 100 }).ok));
t("صدایِ ساکت (-inf) → fatal", () => {
  const r = evaluateQuality(parseQualityOutput(GOOD.replace("-22.5", "-inf")), { durationSec: 40, fileBytes: 100 });
  assert.ok(!r.ok && r.fatal[0].includes("ساکت"));
});
t("میانگینِ -60dB → fatal؛ -40dB → ok", () => {
  assert.ok(!evaluateQuality(parseQualityOutput(GOOD.replace("-22.5", "-60")), { durationSec: 40 }).ok);
  assert.ok(evaluateQuality(parseQualityOutput(GOOD.replace("-22.5", "-40")), { durationSec: 40 }).ok);
});
t("بدونِ stream صدا → fatal", () => assert.ok(!evaluateQuality(parseQualityOutput("Stream #0:0: Video: h264"), { durationSec: 40 }).ok));
t("خیلی کوتاه / فایل خالی → fatal", () => {
  assert.ok(!evaluateQuality(parseQualityOutput(GOOD), { durationSec: 1.5 }).ok);
  assert.ok(!evaluateQuality(parseQualityOutput(GOOD), { durationSec: 40, fileBytes: 0 }).ok);
});
t("بخشِ سیاهِ ۵ ثانیه‌ای → فقط warning، ok می‌مونه", () => {
  const r = evaluateQuality(parseQualityOutput(GOOD + "\nblack_start:2 black_end:7 black_duration:5"), { durationSec: 60, fileBytes: 10 });
  assert.ok(r.ok && r.warnings.length === 1);
});
t("ffmpegِ بی‌خروجی (بدونِ هیچ خط) → fatal نه crash", () => {
  assert.ok(!evaluateQuality(parseQualityOutput(""), { durationSec: 40 }).ok);
});

if (spawnSync("ffmpeg", ["-version"]).status === 0) {
  console.log("\nخروجیِ واقعیِ ffmpeg");
  const probe = (args) => spawnSync("ffmpeg", ["-hide_banner", ...args, "-vf", "blackdetect=d=1:pic_th=0.98", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  t("ویدیوی تیره با صدایِ سینوسی: صدا شناسایی، سیاهی شناسایی", () => {
    const err = probe(["-f", "lavfi", "-i", "color=c=black:s=64x64:d=4:r=10", "-f", "lavfi", "-i", "sine=frequency=300:duration=4"]);
    const a = parseQualityOutput(err);
    assert.ok(a.hasVideo && a.hasAudio && a.meanVolumeDb > -40 && a.blackSegments.length >= 1, JSON.stringify(a));
  });
  t("صدایِ کاملاً ساکت شناسایی می‌شه", () => {
    const err = probe(["-f", "lavfi", "-i", "color=c=gray:s=64x64:d=4:r=10", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "4"]);
    const a = parseQualityOutput(err);
    assert.ok(a.meanVolumeDb === -Infinity || a.meanVolumeDb <= -50, JSON.stringify(a));
  });
}
console.log(`\n${pass} پاس، ${fail} شکست`);
process.exit(fail ? 1 : 0);
