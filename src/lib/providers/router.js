// src/lib/providers/router.js
//
// نقطه‌ی ورودِ واحد برای «یک کار بده، بهترین provider موجود انجامش بده».
// اولویت provider ها برای هر task_type از دیتابیس میاد (کاربر خودش از
// صفحه‌ی /providers مرتب‌شون می‌کنه)؛ اگه اولی شکست خورد، خودکار میره
// سراغ بعدی — دقیقاً همون فلسفه‌ی «تخریب آرومِ» بقیه‌ی این پروژه (مثلاً
// fallback موسیقی/heuristic متادیتا).

import { getProvidersForCapability } from "../db";
import { REGISTRY, TASK_LABELS } from "./registry";
import { decrypt } from "./crypto";

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

    try {
      return await invoke(entry, apiKey);
    } catch (err) {
      console.error(`provider "${p.name}" (${p.service}) در «${label}» شکست خورد:`, err.message);
      errors.push(`${p.name}: ${err.message}`);
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

export async function fetchImages({ text, keyword, count, orientation }) {
  return tryProviders("image", (entry, apiKey) =>
    entry.adapters.image({ apiKey, text, keyword, count, orientation })
  );
}

export async function fetchClips({ text, keyword, count, orientation }) {
  return tryProviders("video", (entry, apiKey) =>
    entry.adapters.video({ apiKey, text, keyword, count, orientation })
  );
}

export async function synthesizeSpeech({ text, voice }) {
  return tryProviders("audio", (entry, apiKey) => entry.adapters.audio({ apiKey, text, voice }));
}
