// ۲۰۲۶-۰۹-۱۷ — cron-secret-gated، دقیقاً همون secret ای که scheduler/run
// و trends/scan استفاده می‌کنن. برخلافِ اون دو تا، اینجا نیازی به
// fire-and-forget نیست — همه‌ی چک‌ها سبک و سریع‌ان (چند ثانیه جمعاً)،
// پس مستقیم await می‌کنیم و نتیجه رو تو همون جواب برمی‌گردونیم.
//
// نکته‌ی مهم: status code به‌جای همیشه ۲۰۰، به نتیجه‌ی چک‌ها بستگی داره —
// ۲۰۰ اگه همه‌چی سالم، ۵۰۳ اگه یک موردِ critical شکست خورده باشه. یعنی
// اگه یک مانیتورِ UptimeRobotِ جدا رویِ همینِ آدرس بذاری (با alert
// contact)، خودِ UptimeRobot این ۵۰۳ رو «Down» می‌بینه و طبقِ تنظیماتِ
// خودت (ایمیل و غیره) بهت خبر می‌ده — بدونِ اینکه لازم باشه یک سیستمِ
// اطلاع‌رسانیِ جدا بسازیم.

import { NextResponse } from "next/server";
import { runHealthCheck } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET تنظیم نشده — این endpoint غیرفعاله تا وقتی تنظیم بشه." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 401 });
  }

  const summary = await runHealthCheck();
  return NextResponse.json(summary, { status: summary.ok ? 200 : 503 });
}
