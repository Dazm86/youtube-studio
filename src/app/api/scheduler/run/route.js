import { NextResponse } from "next/server";
import { refreshAccessToken } from "../../auth/authOptions";
import { generateScript } from "../../../../lib/scriptGen";
import { generateMetadata } from "../../../../lib/metadataGen";
import { runPipeline } from "../../../../lib/pipeline";
import {
  listSchedules,
  markScheduleRan,
  startScheduleRun,
  finishScheduleRun,
  getRefreshToken,
} from "../../../../lib/db";

// چرا این endpoint وجود داره (و نه یک setInterval داخل خودِ اپ):
// Render پلن رایگان بعد از ۱۵ دقیقه بدون درخواست HTTP ورودیِ تازه سرویس
// رو می‌خوابونه — یعنی وقتی سرویس خوابه، هیچ کد جاوااسکریپتی (نه حتی
// setInterval) اجرا نمی‌شه، پس یک زمان‌بند «داخلیِ» صرف اصلاً کار نمی‌کنه.
// راه‌حل: یک سرویسِ cron رایگانِ بیرونی (مثلاً cron-job.org) هر ۱۰ دقیقه
// یک درخواست GET به همین آدرس می‌زنه — همین درخواست هم سرویس رو بیدار
// می‌کنه (cold start) و هم «آیا الان زمانِ چیزی رسیده؟» رو چک می‌کنه.
// اگه چیزی due باشه، بلافاصله جواب سریع می‌دیم (که خودِ pinger تایم‌اوت
// نکنه) و کارِ واقعی (اسکریپت→رندر→آپلود، که ۱۵-۴۰ دقیقه طول می‌کشه) رو
// در پس‌زمینه‌ی همون پروسه‌ی Node ادامه می‌دیم — چون Render اینجا یک
// سرویسِ persistent هست (نه serverless)، پروسه بعد از فرستادنِ جواب هم
// زنده می‌مونه و ادامه‌ی کار واقعاً اجرا می‌شه؛ خودِ pipeline هم دقیقاً
// همون self-ping هر ۵ دقیقه‌ای که در آپلود دستی استفاده می‌شه رو این‌جا
// هم به‌کار می‌بره تا سرویس وسط رندر نخوابه.
const TOLERANCE_MINUTES = 15;

function getNowInTimezone(timezone) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = map.hour === "24" ? "00" : map.hour; // بعضی ICU ها نیمه‌شب رو "24" می‌دن
  return {
    weekday: weekdayMap[map.weekday],
    dateStr: `${map.year}-${map.month}-${map.day}`,
    timeStr: `${hour}:${map.minute}`,
  };
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function isDue(schedule, nowInfo) {
  if (!schedule.enabled) return false;
  if (schedule.last_run_date === nowInfo.dateStr) return false; // امروز قبلاً اجرا شده
  if (!schedule.days_of_week.includes(nowInfo.weekday)) return false;
  const diff = toMinutes(nowInfo.timeStr) - toMinutes(schedule.time_of_day);
  return diff >= 0 && diff <= TOLERANCE_MINUTES;
}

async function runScheduledPipeline(schedule) {
  const runId = await startScheduleRun(schedule.id);
  const selfPingUrl = process.env.NEXTAUTH_URL;
  const selfPing = selfPingUrl
    ? setInterval(() => {
        fetch(`${selfPingUrl}/api/status`).catch((err) =>
          console.error("scheduler self-ping failed:", err.message)
        );
      }, 5 * 60 * 1000)
    : null;

  try {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
      throw new Error(
        "هیچ حساب گوگلی وصل نیست — یک‌بار باید از خودِ سایت وارد شده باشی تا زمان‌بند بتونه توکن بگیره."
      );
    }
    const getFreshAccessToken = async () => {
      const refreshed = await refreshAccessToken({ refreshToken });
      if (refreshed.error) throw new Error("تمدید توکن گوگل شکست خورد");
      return refreshed.accessToken;
    };

    const accessToken = await getFreshAccessToken();

    console.log(`[scheduler] run ${runId}: در حال ساخت اسکریپت (${schedule.video_mode})...`);
    const { script } = await generateScript({ mode: schedule.video_mode, accessToken });

    console.log(`[scheduler] run ${runId}: در حال ساخت متادیتا...`);
    const metadata = await generateMetadata(script);

    console.log(`[scheduler] run ${runId}: شروع پایپ‌لاین رندر/آپلود...`);
    const result = await runPipeline(
      {
        script,
        title: metadata.titleA,
        description: metadata.description,
        thumbnailText: metadata.thumbnailTextA,
        tags: (metadata.tags || []).join(", "),
        privacyStatus: schedule.privacy_status || "public",
        videoMode: schedule.video_mode,
        useVideoClips: false,
        imageKeyword: "",
        titleB: metadata.titleB,
        thumbnailTextB: metadata.thumbnailTextB,
        accessToken,
        getUploadAccessToken: getFreshAccessToken,
      },
      { emit: (obj) => obj.status && console.log(`[scheduler] run ${runId}: ${obj.status}`) }
    );

    await finishScheduleRun(runId, { status: "ok", videoId: result.videoId });
    console.log(`[scheduler] run ${runId}: تمام شد ✅ videoId=${result.videoId}`);
  } catch (err) {
    console.error(`[scheduler] run ${runId} failed:`, err.message);
    await finishScheduleRun(runId, { status: "failed", error: err.message });
  } finally {
    if (selfPing) clearInterval(selfPing);
  }
}

export async function GET(req) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET تنظیم نشده — این endpoint غیرفعاله تا وقتی تنظیم بشه." },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const providedSecret = url.searchParams.get("secret") || req.headers.get("x-cron-secret");
  if (providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  }

  try {
    const schedules = await listSchedules();
    const dueSchedules = [];

    // هر schedule تایم‌زونِ خودش رو داره؛ باید جدا محاسبه بشه (نه یک
    // "الان" مشترک برای همه).
    for (const schedule of schedules) {
      const nowInfo = getNowInTimezone(schedule.timezone || "Asia/Tehran");
      if (isDue(schedule, nowInfo)) {
        dueSchedules.push(schedule);
        // claim فوری، قبل از شروعِ کارِ واقعی — تا یک ping هم‌پوشان دوباره
        // همین رو due تشخیص نده.
        await markScheduleRan(schedule.id, nowInfo.dateStr);
      }
    }

    // کارِ واقعی (که ۱۵-۴۰ دقیقه طول می‌کشه) رو بدون await در پس‌زمینه
    // شروع می‌کنیم، تا جواب به pinger سریع برگرده.
    for (const schedule of dueSchedules) {
      runScheduledPipeline(schedule).catch((err) =>
        console.error("runScheduledPipeline top-level error:", err.message)
      );
    }

    return NextResponse.json({
      checked: schedules.length,
      triggered: dueSchedules.map((s) => ({ id: s.id, videoMode: s.video_mode })),
    });
  } catch (err) {
    console.error("scheduler/run error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
