// ۲۰۲۶-۰۹-۱۲ — قبلاً این مسیر POST + NDJSON-stream بود، و فقط از طریقِ یک
// GitHub Actions workflow جداگانه (trend-scan.yml, هر ۶ ساعت) صدا زده
// می‌شد — یعنی یک وابستگیِ بیرونیِ کاملاً جدا (با CRON_SECRET مخصوصِ
// خودش تو GitHub Actions secrets، جدا از همونی که تو Render هست؛ دقیقاً
// همین جدابودن یک بار باعثِ سردرگمی شد: secret فقط تو Render ست شده
// بود، نه تو گیت‌هاب). کاربر خواست کلِ این به‌جای گیت‌هاب، از داخلِ خودِ
// سایت اجرا بشه — دقیقاً همون الگویی که scheduler/run/route.js براش
// ثابت‌شده و در حالِ کار کردنه (UptimeRobot).
//
// چرا نمی‌شه فقط streaming رو نگه داشت و UptimeRobot رو مستقیم به همون
// POST قبلی زد: UptimeRobot (حتی تو پلن رایگان) حداکثر ۶۰ ثانیه صبر
// می‌کنه (پیش‌فرض ۳۰ ثانیه) قبل از اینکه monitor رو "Down" علامت بزنه —
// در حالی که یک اسکنِ واقعی (چند منبع: Google Trends، یوتیوب،
// TikTok/Reddit، اخبار، تحلیلِ AI) به‌راحتی چند دقیقه طول می‌کشه
// (maxDuration=300 پایین همین دلیل رو داشت). یعنی یک تبدیلِ ساده‌ی
// «همون مسیر، فقط UptimeRobot صداش بزنه» هر بار تایم‌اوت می‌خورد. برای
// همین این مسیر از streaming (منتظرِ اتمامِ کامل موندن) به fire-and-
// forget تبدیل شد — دقیقاً مثلِ scheduler/run: جواب رو فوری برمی‌گردونه
// (زیرِ ۱ ثانیه)، و کارِ واقعی در پس‌زمینه‌ی همون پروسه ادامه پیدا می‌کنه.
// runTrendScan() از قبل (بدونِ هیچ تغییری) نتیجه/خطاش رو هم از طریقِ
// logEvent() (قابل‌مشاهده تو /activity) و هم finishScanRow() (قابل‌مشاهده
// تو خودِ صفحه‌ی /trends) ثبت می‌کنه — کاملاً مستقل از اینکه کسی داره
// stream رو می‌بینه یا نه، پس چیزی از نظرِ visibility از دست نمی‌ره.
//
// نکته‌ی مهمِ دیگه: بر خلافِ scheduler (که هر schedule زمانِ خودش رو تو
// دیتابیس داره)، اینجا خودِ UptimeRobot زمان‌بندی نمی‌کنه — تو پلنِ
// رایگانش حداقلِ فاصله‌ی بینِ چک‌ها ۵ دقیقه‌ست، نه ۶ ساعت (اصلاً امکانِ
// تنظیمِ فاصله‌ی ۶ ساعته‌ای رو نداره). پس این مسیر باید خودش تصمیم بگیره
// که آیا واقعاً وقتِ یک اسکنِ جدیده یا نه — با چک‌کردنِ آخرین اسکنِ ثبت‌شده
// تو دیتابیس. اگه UptimeRobot هر ۵ دقیقه بزنه، ۹۹٪ اون درخواست‌ها فقط
// یک «نه، هنوز زوده» سریع می‌گیرن و برمی‌گردن — دقیقاً همون چیزی که
// می‌خوایم؛ بدونِ این چک، هر پینگِ ۵دقیقه‌ای یک اسکنِ واقعیِ جدید
// می‌ساخت (به‌جای هر ۶ ساعت، هر ۵ دقیقه) و سهمیه‌ی همه‌ی providerها
// (Groq، YouTube Data API، و غیره) رو خیلی سریع می‌سوزوند.

import { NextResponse } from "next/server";
import { runTrendScan } from "@/lib/trends";
import { ensureTrendsSchema, getLatestScan } from "@/lib/trends/db";

export const dynamic = "force-dynamic";

const MIN_HOURS_BETWEEN_SCANS = Number(process.env.TREND_SCAN_MIN_HOURS || 6);

export async function GET(request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET تنظیم نشده — این endpoint غیرفعاله تا وقتی تنظیم بشه." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  }

  try {
    await ensureTrendsSchema();
    const latest = await getLatestScan();
    if (latest) {
      const hoursSince = (Date.now() - new Date(latest.started_at).getTime()) / 3600000;
      if (hoursSince < MIN_HOURS_BETWEEN_SCANS) {
        return NextResponse.json({
          skipped: true,
          reason: `آخرین اسکن ${hoursSince.toFixed(1)} ساعت پیش شروع شده — کمتر از حداقلِ ${MIN_HOURS_BETWEEN_SCANS} ساعت`,
        });
      }
    }
  } catch (err) {
    // اگه خودِ چکِ «آیا وقتشه» شکست خورد (مثلاً یک لغزشِ موقتِ دیتابیس)،
    // به‌جای اینکه بی‌صدا هیچ‌وقت اسکن نشه (دقیقاً همون کلاس‌باگی که امروز
    // زودتر تو scheduler/run پیدا و فیکس شد)، محتاطانه ادامه می‌دیم —
    // اگه واقعاً دیتابیس مشکل داره، خودِ runTrendScan توش to createScanRow
    // برمی‌خوره و شکستِ خودش رو جدا گزارش می‌کنه.
    console.error("trends/scan: چکِ due شکست خورد، با احتیاط ادامه می‌دیم:", err.message);
  }

  // کارِ واقعی (چند دقیقه طول می‌کشه) رو بدون await در پس‌زمینه شروع
  // می‌کنیم، تا جواب به UptimeRobot سریع برگرده.
  runTrendScan().catch((err) => {
    console.error("trends/scan (پس‌زمینه) خطای سطحِ بالا:", err.message);
  });

  return NextResponse.json({ started: true });
}
