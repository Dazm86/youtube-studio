// خلاصه‌ی روزانه‌ی سلامتِ کانال — ۲۰۲۶-۰۹. طبقِ تصمیمِ صریح: این endpoint
// هر روز یک‌بار (از طریقِ همون cron بیرونی‌ای که scheduler/run رو صدا
// می‌زنه، با یک URL و زمان‌بندیِ جدا) چک می‌شه، ولی فقط وقتی *واقعاً*
// چیزی برای نگرانی هست پیام می‌فرسته — نه یک «همه‌چی اوکیه ✅» روتین که
// بعدِ چند روز نادیده گرفته بشه. اگه هیچ jobِ گیرکرده و هیچ خطای ۲۴
// ساعتِ اخیری نباشه، composeDailyDigest() فقط null برمی‌گردونه و هیچ
// پیامی نمی‌ره.
import { listRecentEvents } from "./activityLog.js";
import { listStaleWorkerJobs, listSchedules } from "./db/index.js";

// جوبی که بیشتر از این مدت رو صف/در حالِ پردازشه، یعنی به‌احتمالِ زیاد
// گیر کرده (رندر+آپلودِ معمولی ۱۵-۴۰ دقیقه طول می‌کشه؛ ۶۰ دقیقه حاشیه‌ی
// امنِ کافیه تا false-positive برای jobهای کند ولی سالم نده).
const STUCK_JOB_MINUTES = 60;
const ERROR_WINDOW_HOURS = 24;
const WEEKDAY_FA = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

// همون تکنیکِ scheduler/run/route.js — چون از اونجا export نمی‌شه، اینجا
// دوباره (کوچیک و خودکفا) نوشته شده، هم‌شکل با بقیه‌ی پروژه که این
// هلپرهای محلی رو به‌جای اشتراک‌گذاریِ زودهنگام، جدا نگه می‌داره.
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
  const hour = map.hour === "24" ? "00" : map.hour;
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

// نزدیک‌ترین اجرای بعدیِ یک زمان‌بندی، به‌شکلِ یک برچسبِ فارسیِ خوانا +
// تعدادِ دقیقه‌ی مونده (برای مرتب‌سازیِ بینِ چند زمان‌بندی با تایم‌زونِ
// احتمالاً متفاوت). دقتِ به‌اندازه‌ی یک digestِ روزانه کافیه، نیازی به
// محاسبه‌ی instant دقیقِ UTC (و اضافه‌کردنِ یک dependency‌ی تایم‌زونِ
// جدید فقط برای همین) نیست.
function nextOccurrenceLabel(schedule) {
  const nowInfo = getNowInTimezone(schedule.timezone || "Asia/Tehran");
  const nowMinutes = toMinutes(nowInfo.timeStr);

  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const weekday = (nowInfo.weekday + dayOffset) % 7;
    if (!schedule.days_of_week.includes(weekday)) continue;

    if (dayOffset === 0) {
      const targetMinutes = toMinutes(schedule.time_of_day);
      // امروز قبلاً اجرا شده یا ساعتش گذشته → امروز کاندیدِ معتبری نیست
      if (targetMinutes <= nowMinutes || schedule.last_run_date === nowInfo.dateStr) continue;
      return { minutesUntil: targetMinutes - nowMinutes, label: `امروز ساعت ${schedule.time_of_day}` };
    }

    const label = dayOffset === 1 ? "فردا" : WEEKDAY_FA[weekday];
    return {
      minutesUntil: dayOffset * 1440 + toMinutes(schedule.time_of_day) - nowMinutes,
      label: `${label} ساعت ${schedule.time_of_day}`,
    };
  }
  return null;
}

export async function composeDailyDigest() {
  const lines = [];
  let hasIssue = false;

  const stuck = await listStaleWorkerJobs(STUCK_JOB_MINUTES);
  if (stuck.length > 0) {
    hasIssue = true;
    const types = [...new Set(stuck.map((j) => j.job_type))].join("، ");
    lines.push(`⏳ ${stuck.length} job بیشتر از یک ساعته رو صف/در حال پردازش گیر کرده (${types})`);
  }

  const recent = await listRecentEvents({ limit: 100 });
  const cutoff = Date.now() - ERROR_WINDOW_HOURS * 60 * 60 * 1000;
  const errors = recent.filter(
    (e) => e.type.endsWith("_failed") && new Date(e.created_at).getTime() > cutoff
  );
  if (errors.length > 0) {
    hasIssue = true;
    lines.push(`❌ ${errors.length} خطا تو ۲۴ ساعتِ اخیر:`);
    for (const e of errors.slice(0, 5)) {
      lines.push(`  • ${e.message}`);
    }
    if (errors.length > 5) lines.push(`  ...و ${errors.length - 5} موردِ دیگه`);
  }

  // طبقِ تصمیم: وقتی هیچ jobِ گیرکرده و هیچ خطایی نیست، اصلاً پیامی
  // ساخته نمی‌شه — فراخوان (route) باید null رو به‌معنیِ «چیزی نفرست»
  // بگیره.
  if (!hasIssue) return null;

  try {
    const schedules = (await listSchedules()).filter((s) => s.enabled);
    const next = schedules
      .map(nextOccurrenceLabel)
      .filter(Boolean)
      .sort((a, b) => a.minutesUntil - b.minutesUntil)[0];
    if (next) lines.push(`📅 انتشارِ بعدی: ${next.label}`);
  } catch (err) {
    // این بخش صرفاً context ـه، نه دلیلِ اصلیِ پیام؛ خرابیش نباید جلویِ
    // ارسالِ خودِ هشدار رو بگیره.
    console.error("dailyDigest: next-schedule lookup failed (نادیده گرفته می‌شه):", err.message);
  }

  return lines.join("\n");
}
