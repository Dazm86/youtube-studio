// تستِ buildFinalAudioFilter — رشته‌ها + (اگه ffmpeg نصب باشه) اجرای واقعی.
import assert from "assert";
import { spawnSync } from "child_process";
import { buildFinalAudioFilter } from "../src/lib/rendering/audioFilter.js";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ✅", name); }
  catch (e) { fail++; console.log("  ❌", name, "—", e.message); }
}

console.log("buildFinalAudioFilter");
t("بدونِ BGM و کاور: فقط loudnorm", () => {
  const f = buildFinalAudioFilter({});
  assert.ok(f.startsWith("[1:a]loudnorm=") && f.endsWith("[a]") && !f.includes("amix"));
});
t("normalize=false بدونِ BGM → همون anull قدیمی", () => {
  assert.strictEqual(buildFinalAudioFilter({ normalize: false }), "[1:a]anull[a]");
});
t("کاور → adelay قبل از loudnorm", () => {
  const f = buildFinalAudioFilter({ delayMs: 1500 });
  assert.ok(f.indexOf("adelay=1500|1500") < f.indexOf("loudnorm"));
});
t("BGM: fade-in همیشه، fade-out فقط با مدتِ کافی", () => {
  const long = buildFinalAudioFilter({ hasBgm: true, totalDurationSec: 60 });
  assert.ok(long.includes("afade=t=in") && long.includes("afade=t=out:st=57.00"));
  const short = buildFinalAudioFilter({ hasBgm: true, totalDurationSec: 4 });
  assert.ok(short.includes("afade=t=in") && !short.includes("afade=t=out"));
  const unknown = buildFinalAudioFilter({ hasBgm: true, totalDurationSec: 0 });
  assert.ok(!unknown.includes("afade=t=out"));
});
t("BGM + normalize=false → loudnorm نداره ولی amix داره", () => {
  const f = buildFinalAudioFilter({ hasBgm: true, normalize: false });
  assert.ok(f.includes("amix=inputs=2:duration=first") && !f.includes("loudnorm"));
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
if (!hasFfmpeg) {
  console.log("\nffmpeg نصب نیست — تستِ اجرایِ واقعی رد شد");
} else {
  console.log("\nاجرای واقعی با ffmpeg");
  const variants = {
    "بدونِ BGM": { hasBgm: false },
    "با کاور": { hasBgm: false, delayMs: 1000 },
    "با BGM": { hasBgm: true, totalDurationSec: 10, bgmVolume: 0.12 },
    "با BGM+کاور": { hasBgm: true, delayMs: 1000, totalDurationSec: 10 },
  };
  // ویدیوی ورودی باید انکدشده باشه (مثلِ concatOut واقعی) — ویدیوی خامِ
  // lavfi با -c:v copy پکتی تولید نمی‌کنه و تست بی‌دلیل fail می‌شد.
  const mk = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=10:r=10",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "/tmp/_af_video.mp4"], { encoding: "utf8" });
  assert.strictEqual(mk.status, 0, "ساختِ ویدیوی آزمایشی شکست خورد");
  for (const [name, opts] of Object.entries(variants)) {
    t(name, () => {
      const filter = buildFinalAudioFilter(opts);
      const r = spawnSync("ffmpeg", [
        "-y", "-i", "/tmp/_af_video.mp4",
        "-f", "lavfi", "-i", "sine=frequency=220:duration=6",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=12",
        "-filter_complex", filter, "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-shortest", "/tmp/_af_test.mp4",
      ], { encoding: "utf8" });
      assert.strictEqual(r.status, 0, (r.stderr || "").split("\n").slice(-4).join(" | "));
    });
  }
}
console.log(`\n${pass} پاس، ${fail} شکست`);
process.exit(fail ? 1 : 0);
