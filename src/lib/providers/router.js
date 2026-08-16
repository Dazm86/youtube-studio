// src/lib/providers/router.js
//
// نقطه‌ی ورودِ واحد برای «یک کار بده، بهترین provider موجود انجامش بده».
// اولویت provider ها برای هر task_type از دیتابیس میاد (کاربر خودش از
// صفحه‌ی /providers مرتب‌شون می‌کنه)؛ اگه اولی شکست خورد، خودکار میره
// سراغ بعدی — دقیقاً همون فلسفه‌ی «تخریب آرومِ» بقیه‌ی این پروژه (مثلاً
// fallback موسیقی/heuristic متادیتا).
//
// یک استثنا: خطای rate-limit روی همون provider رو فوری «شکست» حساب
// نمی‌کنیم — چون خودِ پیام خطا معمولاً می‌گه چند ثانیه دیگه صبر کن،
// همون‌قدر صبر می‌کنیم و همون provider رو دوباره امتحان می‌کنیم (حداکثر
// چند بار) قبل از این‌که بریم سراغ provider بعدی یا شکست نهایی. بدون
// این، وقتی فقط یک provider تنظیم شده، چند فراخوانی پشت‌سرهم (مثل ترجمه‌ی
// زیرنویس به ۵ زبان) به‌محض برخورد اول به سقف TPM همه‌شون زنجیره‌ای fail
// می‌شدن.

import fs from "fs";
import path from "path";
import { getProvidersForCapability } from "../db/index.js";
import { REGISTRY, TASK_LABELS } from "./registry.js";
import { decrypt } from "./crypto.js";

// providerهای bootstrap (ساخته‌شده‌ی خودکار از env var قدیمی) هیچ کلیدی
// تو دیتابیس ندارن (api_key = NULL) — یعنی «از همون env var قدیمی استفاده کن».
const ENV_FALLBACK_KEY = {
  groq: () => process.env.GROQ_API_KEY || null,
  pexels: () => process.env.PEXELS_API_KEY || null,
};

export function resolveApiKey(providerRow) {
  if (providerRow.api_key) {
    try {
      return decrypt(providerRow.api_key);
    } catch (err) {
      console.error(`decrypt failed for provider ${providerRow.id}:`, err.message);
      return null;
    }
  }
  const envFn = ENV_FALLBACK_KEY[providerRow.service];
  return envFn ? envFn() : null;
}

const MAX_RATE_LIMIT_RETRIES = 2;
// تایم‌اوت با rate-limit فرق داره: rate-limit عمداً منتظر می‌مونه چون
// دقیقاً می‌دونیم کِی پنجره رد می‌شه؛ تایم‌اوت/قطعیِ شبکه معمولاً یک اتفاقِ
// گذرا و کوتاه‌مدته که یک یا دو تلاشِ فوریِ دیگه (با یک فاصله‌ی کوتاه، نه
// صبرِ طولانی) اغلب حلش می‌کنه — پس همون provider رو تا ۳ بار (۱ اصلی + ۲
// تلاشِ مجدد) امتحان می‌کنیم قبل از این‌که بی‌خیالش بشیم و بریم سراغ
// provider بعدی.
const MAX_TIMEOUT_RETRIES = 2;
const TIMEOUT_RETRY_DELAY_MS = 1500;

function isTimeoutOrNetworkError(message) {
  return /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network error|fetch failed/i.test(
    message || ""
  );
}

// خیلی از providerهای متنی (مثلاً Groq) وقتی به rate limit می‌خورن، دقیقاً
// می‌گن چند ثانیه دیگه صبر کن — مثلاً «Please try again in 7.02s». همون
// عدد رو استخراج می‌کنیم به‌جای یک تاخیر ثابت حدسی.
function extractRetryAfterMs(message) {
  const match = /try again in ([\d.]+)\s*s/i.exec(message || "");
  if (!match) return null;
  const seconds = parseFloat(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.ceil(seconds * 1000) + 500; // یه کم بیشتر صبر کن تا مطمئن شیم پنجره رد شده
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// آخرین خط دفاع وقتی *همه‌ی* provider های استوک (Pexels و هرچی بعدش
// تنظیم شده) شکست خوردن — نه یک تلاشِ دیگه برای یک provider، بلکه یک
// پوشه‌ی محلیِ عکس/کلیپِ ثابت که همیشه تو دیسک هست، پس رندر کاملاً
// متوقف نمی‌شه. عمداً خالیه (فقط یک README) چون فایل‌های واقعیِ استوک
// asset ـن، نه چیزی که از کد قابل‌تولید باشه — کاربر باید خودش چندتا
// عکس/کلیپِ پیش‌فرضِ بی‌ربط-به-موضوع (مثلاً چشم‌انداز طبیعت، آسمان,...)
// اونجا بذاره. نبودِ فایل تو پوشه یعنی fallback هم در دسترس نیست، پس
// خطای اصلی همون‌طور که بود throw می‌شه — این هیچ رفتاری رو بدتر نمی‌کنه،
// فقط وقتی فایل باشه یک راهِ نجاتِ اضافه می‌ده.
const LOCAL_FALLBACK_DIR = {
  images: path.join(process.cwd(), "public", "fallback-media", "images"),
  videos: path.join(process.cwd(), "public", "fallback-media", "videos"),
};

function listLocalFallbackFiles(kind) {
  const dir = LOCAL_FALLBACK_DIR[kind];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => !f.startsWith(".") && f.toLowerCase() !== "readme.md")
      .map((f) => path.join(dir, f));
  } catch {
    return []; // پوشه اصلاً وجود نداره یا خالیه — بی‌سروصدا یعنی «fallback در دسترس نیست»
  }
}

function localFallbackItems(kind, count) {
  const files = listLocalFallbackFiles(kind);
  if (files.length === 0) return null;
  const n = Math.max(1, count || 1);
  const items = [];
  for (let i = 0; i < n; i++) {
    // اگه فایل‌های محلی از تعدادِ درخواستی کمتر بود، می‌چرخیم روی همون‌ها —
    // بهتر از این‌که رندر به‌خاطرِ کمبودِ asset متوقف بشه.
    const filePath = files[i % files.length];
    try {
      items.push({ buffer: fs.readFileSync(filePath) });
    } catch (readErr) {
      console.error(`خوندنِ فایلِ fallback شکست خورد (${filePath}):`, readErr.message);
    }
  }
  return items.length > 0 ? items : null;
}

async function tryProviders(taskType, invoke) {
  const providers = await getProvidersForCapability(taskType);
  const label = TASK_LABELS[taskType] || taskType;

  if (providers.length === 0) {
    throw new Error(
      `هیچ ارائه‌دهنده‌ی فعالی برای «${label}» تنظیم نشده — از صفحه‌ی «ارائه‌دهنده‌های API» یکی اضافه کن.`
    );
  }

  const errors = [];

  for (const p of providers) {
    const entry = REGISTRY[p.service];
    if (!entry || !entry.adapters[taskType]) continue; // داده‌ی ناسازگار (مثلاً سرویس حذف‌شده)، رد شو

    const apiKey = entry.noKeyNeeded ? null : resolveApiKey(p);
    if (!entry.noKeyNeeded && !apiKey) {
      errors.push(`${p.name}: کلیدی در دسترس نیست`);
      continue;
    }

    let rateLimitRetries = 0;
    let timeoutRetries = 0;
    for (;;) {
      try {
        return await invoke(entry, apiKey);
      } catch (err) {
        const waitMs = extractRetryAfterMs(err.message);
        if (waitMs && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
          rateLimitRetries++;
          console.warn(
            `provider "${p.name}" (${p.service}) در «${label}» به rate limit خورد — ${(waitMs / 1000).toFixed(
              1
            )} ثانیه صبر و تلاش دوباره (${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})`
          );
          await sleep(waitMs);
          continue; // همون provider رو دوباره امتحان کن
        }
        if (!waitMs && isTimeoutOrNetworkError(err.message) && timeoutRetries < MAX_TIMEOUT_RETRIES) {
          timeoutRetries++;
          console.warn(
            `provider "${p.name}" (${p.service}) در «${label}» تایم‌اوت/خطای شبکه خورد — تلاش دوباره (${timeoutRetries}/${MAX_TIMEOUT_RETRIES})`
          );
          await sleep(TIMEOUT_RETRY_DELAY_MS);
          continue; // همون provider رو دوباره امتحان کن
        }
        console.error(`provider "${p.name}" (${p.service}) در «${label}» شکست خورد:`, err.message);
        errors.push(`${p.name}: ${err.message}`);
        break; // برو سراغ provider بعدی
      }
    }
  }

  throw new Error(`همه‌ی ارائه‌دهنده‌های «${label}» شکست خوردن — ${errors.join(" | ")}`);
}

export async function generateText({ prompt, maxTokens, temperature, jsonMode }) {
  const text = await tryProviders("text", (entry, apiKey) =>
    entry.adapters.text({ apiKey, prompt, maxTokens, temperature, jsonMode })
  );
  if (!text || !text.trim()) throw new Error("پاسخ خالی از هوش مصنوعی دریافت شد");
  return text.trim();
}

// کشِ کوتاه‌مدتِ درون‌حافظه‌ای برای نتیجه‌ی جستجوهای عکس/کلیپ — همون
// کوئری با همون orientation/count تو یک بازه‌ی کوتاه (۱۰ دقیقه) دوباره
// درخواستِ API نمی‌زنه. مخصوصاً با retry ی تایم‌اوت که بالاتر اضافه شد
// مفیده: اگه تلاشِ اول واقعاً تو سمتِ Pexels موفق شده بود ولی جواب دیر
// رسیده (تایم‌اوتِ سمتِ ما، نه شکستِ واقعیِ provider)، تلاشِ دوم به‌جای
// یک کوئریِ کاملاً تازه، می‌تونه از کش جواب بگیره. کش فقط درون‌حافظه‌ست
// (نه دیتابیس) — با هر ری‌استارتِ سرور (رایج تو Render free tier) خودش
// خالی می‌شه، که برای این نوع بهینه‌سازیِ کوتاه‌مدت کاملاً کافیه. سقفِ
// تعدادِ ورودی هم می‌ذاریم که حافظه بی‌نهایت بزرگ نشه.
const MEDIA_CACHE_TTL_MS = 10 * 60 * 1000;
const MEDIA_CACHE_MAX_ENTRIES = 200;
const mediaCache = new Map();

function mediaCacheGet(key) {
  const entry = mediaCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > MEDIA_CACHE_TTL_MS) {
    mediaCache.delete(key);
    return null;
  }
  return entry.value;
}

function mediaCacheSet(key, value) {
  if (mediaCache.size >= MEDIA_CACHE_MAX_ENTRIES) {
    const oldestKey = mediaCache.keys().next().value;
    mediaCache.delete(oldestKey);
  }
  mediaCache.set(key, { value, at: Date.now() });
}

export async function fetchImages({ text, keyword, count, orientation }) {
  const cacheKey = `image:${JSON.stringify({ text, keyword, count, orientation })}`;
  const cached = mediaCacheGet(cacheKey);
  if (cached) return cached;
  try {
    const result = await tryProviders("image", (entry, apiKey) =>
      entry.adapters.image({ apiKey, text, keyword, count, orientation })
    );
    mediaCacheSet(cacheKey, result);
    return result;
  } catch (err) {
    const items = localFallbackItems("images", count);
    if (!items) throw err;
    console.warn(
      `fetchImages: همه‌ی ارائه‌دهنده‌ها شکست خوردن (${err.message}) — از پوشه‌ی محلیِ fallback-media استفاده شد`
    );
    return { images: items }; // نتیجه‌ی fallback عمداً کش نمی‌شه — می‌خوایم دفعه‌ی بعد provider واقعی دوباره امتحان بشه
  }
}

export async function fetchClips({ text, keyword, count, orientation }) {
  const cacheKey = `video:${JSON.stringify({ text, keyword, count, orientation })}`;
  const cached = mediaCacheGet(cacheKey);
  if (cached) return cached;
  try {
    const result = await tryProviders("video", (entry, apiKey) =>
      entry.adapters.video({ apiKey, text, keyword, count, orientation })
    );
    mediaCacheSet(cacheKey, result);
    return result;
  } catch (err) {
    const items = localFallbackItems("videos", count);
    if (!items) throw err;
    console.warn(
      `fetchClips: همه‌ی ارائه‌دهنده‌ها شکست خوردن (${err.message}) — از پوشه‌ی محلیِ fallback-media استفاده شد`
    );
    return { clips: items };
  }
}

export async function synthesizeSpeech({ text, voice }) {
  return tryProviders("audio", (entry, apiKey) => entry.adapters.audio({ apiKey, text, voice }));
}
