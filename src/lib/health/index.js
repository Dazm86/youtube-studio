// src/lib/health/index.js
//
// ۲۰۲۶-۰۹-۱۷ — امروز ~۷ تغییرِ کد زده شد که هیچ‌کدوم رویِ یک رندرِ واقعی
// چک نشدن؛ کاربر پرسید «نمیشه خودِ سایت هر چند وقت همه‌چی رو تست کنه که
// سالمه یا نه؟». این ماژول دقیقاً همونه — بر خلافِ api/status/route.js
// (که فقط چک می‌کنه یک env var *ست شده* یا نه)، اینجا واقعاً هر وابستگیِ
// بیرونی رو با کمترین هزینه‌ی ممکن صدا می‌زنیم: یک TTS واقعی (چند کلمه)،
// یک عکسِ واقعی از Pexels، یک متنِ واقعیِ خیلی کوتاه از Groq، یک کوئریِ
// واقعیِ دیتابیس، یک تمدیدِ واقعیِ توکنِ گوگل (بدونِ side effect — فقط
// یک access token تازه می‌گیره)، و یک درخواستِ واقعی به GitHub API.
//
// هر چک جدا try/catch می‌شه (دقیقاً همون درسِ ۲۰۲۶-۰۹-۰۸: یک چکِ خراب
// نباید جلوی بقیه رو بگیره) و جدا timeout می‌گیره (یک وابستگیِ آویزون
// نباید کلِ health-check رو معلق نگه داره، چون این باید سریع و قابلِ
// پینگ‌شدن با UptimeRobot بمونه).

import { synthesizeSpeech, generateText } from "../providers/router.js";
import { fetchImages } from "../media/index.js";
import { getDbStatus, getRefreshToken } from "../db/index.js";
import { refreshAccessToken } from "../auth/authOptions.js";
import { logEvent } from "../activityLog.js";

const CHECK_TIMEOUT_MS = 15000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`تایم‌اوت (${label}, بیشتر از ${ms / 1000} ثانیه)`)), ms)
    ),
  ]);
}

async function checkDatabase() {
  const status = await getDbStatus();
  if (!status.connected) throw new Error(status.error || "دیتابیس وصل نیست");
  return {};
}

async function checkYoutubeAuth() {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) throw new Error("هیچ refresh_token ای تو دیتابیس نیست — یک‌بار باید از خودِ سایت sign in کنی");
  const refreshed = await refreshAccessToken({ refreshToken });
  if (refreshed.error) throw new Error("تمدیدِ توکنِ گوگل شکست خورد — احتمالاً دسترسی لغو شده، باید دوباره sign in کنی");
  return {};
}

async function checkTts() {
  const { buffer } = await synthesizeSpeech({ text: "This is a health check." });
  if (!buffer || buffer.length === 0) throw new Error("صدایی برنگشت");
  return {};
}

async function checkMedia() {
  const result = await fetchImages({ keyword: "nature", count: 1, orientation: "landscape" });
  if (!result.images || result.images.length === 0) throw new Error("عکسی برنگشت");
  return {};
}

async function checkAiText() {
  const text = await generateText({ prompt: "Reply with exactly the word OK, nothing else.", maxTokens: 10, temperature: 0 });
  if (!text || text.trim().length === 0) throw new Error("متنی برنگشت");
  return {};
}

async function checkGithub() {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
  if (!token) throw new Error("GITHUB_TOKEN تنظیم نشده");
  const owner = process.env.GITHUB_REPOSITORY_OWNER || "Dazm86";
  const repo = process.env.GITHUB_REPOSITORY_NAME || "youtube-studio";
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`GitHub API خطای ${res.status} داد`);
  return {};
}

// critical=true یعنی خرابیِ این یکی باعثِ 503ِ کلِ endpoint می‌شه (پس
// UptimeRobot هم متوجه می‌شه و — اگه alert contact ست کرده باشی — ایمیل
// می‌گیری). غیرِcritical فقط لاگ می‌شه، جلوی 200 رو نمی‌گیره.
const CHECKS = [
  { key: "database", label: "دیتابیس", fn: checkDatabase, critical: true },
  { key: "youtubeAuth", label: "اتصال به گوگل/یوتیوب", fn: checkYoutubeAuth, critical: true },
  { key: "tts", label: "تبدیلِ متن به صدا", fn: checkTts, critical: true },
  { key: "media", label: "تصویر/کلیپ (Pexels)", fn: checkMedia, critical: true },
  { key: "aiText", label: "تولید متن (Groq)", fn: checkAiText, critical: true },
  { key: "github", label: "دسترسیِ گیت‌هاب", fn: checkGithub, critical: false },
];

export async function runHealthCheck() {
  const results = {};
  const failed = [];

  for (const check of CHECKS) {
    const startedAt = Date.now();
    try {
      await withTimeout(check.fn(), CHECK_TIMEOUT_MS, check.label);
      results[check.key] = { ok: true, label: check.label, ms: Date.now() - startedAt };
    } catch (err) {
      results[check.key] = { ok: false, label: check.label, ms: Date.now() - startedAt, error: err.message };
      failed.push({ key: check.key, label: check.label, error: err.message, critical: check.critical });
    }
  }

  if (failed.length > 0) {
    logEvent({
      type: "health_check_failed",
      message: `چکِ سلامت: ${failed.length} مورد شکست خورد — ${failed.map((f) => f.label).join("، ")}`,
      metadata: { failed },
    });
    console.error("health-check شکست‌ها:", failed.map((f) => `${f.key}: ${f.error}`).join(" | "));
  }

  return {
    ok: failed.filter((f) => f.critical).length === 0,
    checkedAt: new Date().toISOString(),
    results,
    failed,
  };
}
