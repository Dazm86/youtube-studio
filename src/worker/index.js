#!/usr/bin/env node
/**
 * Video Render Worker Entry Point
 *
 * بازسازیِ ۲۰۲۶-۰۸-۱۸ — نسخه‌ی قبلی این فایل فقط رندر می‌کرد و نتیجه رو
 * (شاملِ بافرِ خامِ ویدیو) به‌عنوان یک خطِ JSON عظیم رو stdout چاپ
 * می‌کرد؛ نه آپلود به یوتیوب داشت، نه تامبنیل/زیرنویس/رکوردِ دیتابیس،
 * نه هیچ callbackی به وب‌اپ. طراحیِ جدید ساده‌تره: worker دقیقاً همون
 * runPipeline رو که خودِ generate-and-upload (مسیرِ بدونِ worker) صدا
 * می‌زنه، از اول تا آخر خودش کامل اجرا می‌کنه (اسکریپت که از قبل آماده
 * می‌رسه، پس فقط رندر+آپلود+تامبنیل+زیرنویس+ثبت دیتابیس)، و در آخر یک
 * POST به callbackUrl (که تو payload اومده) با نتیجه/خطا می‌زنه — دقیقاً
 * همون چیزی که WORKER_ARCHITECTURE.md از اول توصیفش کرده بود.
 *
 * فیکسِ ۲۰۲۶-۰۸-۲۰ — قبلاً worker خودش مستقیم با GOOGLE_CLIENT_ID/SECRET
 * به گوگل رفرش می‌زد (مثلِ scheduler/run)، ولی نگه‌داشتنِ یه کپیِ دومِ
 * این اعتبارنامه‌ها تو GitHub secrets چند دور خطای مختلف داد
 * (invalid_client، deleted_client). حالا به‌جاش از یک endpointِ داخلیِ
 * خودِ وب‌اپ (`/api/internal/youtube-token`) توکن می‌گیره — همون کدِ
 * رفرشی که لاگینِ سایت باهاش کار می‌کنه، رو همون Render اجرا می‌شه؛
 * worker فقط با WORKER_SIGNING_SECRET (که همون secretیه که امضای
 * جاب‌ها و callbackها رو هم تأیید می‌کنه، پس مطمئنیم درست sync شده)
 * احراز هویت می‌کنه. دیگه هیچ اعتبارنامه‌ی گوگلی تو GitHub لازم نیست.
 *
 * Usage: node src/worker/index.js <job_id> <job_type> <payload_json>
 */

import { runPipeline } from "../lib/pipeline.js";
import { verifyJobPayload } from "../lib/jobs/index.js";

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...data }));
}

async function getUploadAccessToken() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const signingSecret = process.env.WORKER_SIGNING_SECRET || process.env.WORKER_API_KEY;
  if (!appUrl || !signingSecret) {
    throw new Error("NEXT_PUBLIC_APP_URL یا WORKER_SIGNING_SECRET تو worker تنظیم نشده");
  }
  const res = await fetch(`${appUrl}/api/internal/youtube-token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signingSecret}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.accessToken) {
    throw new Error(data.error || `گرفتنِ توکنِ آپلود از وب‌اپ شکست خورد (${res.status})`);
  }
  return data.accessToken;
}

// نتیجه/خطا رو به وب‌اپ گزارش می‌ده — همون Authorization: Bearer که
// generate-and-upload موقعِ dispatch ساخته و تو payload.credential
// گذاشته (قبلاً credential ساخته می‌شد ولی هیچ‌وقت پیوست نمی‌شد؛ الان تو
// jobs/index.js:dispatchAndTrackJob درست وصل شده). اگه این POST خودش
// شکست بخوره (مثلاً وب‌اپ لحظه‌ای پایینه)، فقط لاگ می‌کنیم — worker
// نباید صرفاً به‌خاطرِ شکستِ گزارش‌دهی با کدِ خطا خارج بشه، چون رندر و
// آپلودِ واقعی (اگه موفق بوده) از قبل انجام شده.
async function reportResult(payload, { status, result, error }) {
  const callbackUrl = payload?.metadata?.callbackUrl;
  const credential = payload?.credential;
  if (!callbackUrl || !credential) {
    log("warn", "callbackUrl یا credential موجود نیست — نتیجه فقط تو لاگِ همین اجرا می‌مونه", {
      hasCallbackUrl: !!callbackUrl,
      hasCredential: !!credential,
    });
    return;
  }
  try {
    const res = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
      body: JSON.stringify({ status, result, error }),
    });
    if (!res.ok) {
      log("error", "callback به وب‌اپ با خطا برگشت", { httpStatus: res.status, body: await res.text() });
    } else {
      log("info", "callback به وب‌اپ موفق بود");
    }
  } catch (err) {
    log("error", "فرستادنِ callback به وب‌اپ شکست خورد", { error: err.message });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error("Usage: node src/worker/index.js <job_id> <job_type> <payload_json>");
    process.exit(1);
  }
  const [jobId, jobType, payloadJson] = args;

  let payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch (err) {
    log("error", "payload JSON نامعتبره", { error: err.message });
    process.exit(1);
  }

  // امضای کلِ payload رو چک می‌کنیم (قبلاً هیچ‌جا verifyJobPayload صدا
  // زده نمی‌شد، با این‌که برای همین ساخته شده بود). signature/credential
  // خودشون جزوِ payloadِ امضاشده نبودن (بعد از امضا اضافه شدن)، پس برای
  // چک باید جداشون کنیم.
  const { signature, credential, ...corePayload } = payload;
  if (!signature || !verifyJobPayload(corePayload, signature)) {
    log("error", "امضای payload نامعتبره — job رد شد", { jobId });
    process.exit(1);
  }

  log("info", "شروعِ job", { jobId, jobType });

  try {
    if (jobType !== "render_video" && jobType !== "render_short") {
      throw new Error(`نوع jobِ ناشناخته یا دیگه پشتیبانی‌نشده: ${jobType}`);
    }

    const input = payload.input || {};
    const result = await runPipeline(
      { ...input, getUploadAccessToken },
      { emit: (data) => log("info", "پیشرفتِ pipeline", data) }
    );

    log("info", "job با موفقیت تموم شد", { jobId, videoId: result?.videoId });
    await reportResult(payload, { status: "completed", result });
    process.exit(0);
  } catch (err) {
    log("error", "job شکست خورد", { jobId, error: err.message });
    await reportResult(payload, { status: "failed", error: err.message });
    process.exit(1);
  }
}

main();
