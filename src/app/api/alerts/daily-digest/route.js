import { NextResponse } from "next/server";
import { composeDailyDigest } from "@/lib/dailyDigest";
import { logEvent, listRecentEvents } from "@/lib/activityLog.js";

export const dynamic = "force-dynamic";

// دقیقاً همون الگویِ احرازِ هویتِ api/scheduler/run — یک cron رایگانِ
// بیرونی (همونی که هر ۱۰ دقیقه scheduler/run رو صدا می‌زنه) این‌جا رو
// هم صدا می‌زنه، ولی با یک زمان‌بندیِ جداگانه‌ی یک‌بار-در-روز (مثلاً هر
// روز ۰۸:۰۰). از همون CRON_SECRETِ موجود استفاده می‌کنه — env var جدیدی
// لازم نیست.
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
    // محافظِ idempotency — اگه cron به هر دلیلی (تنظیمِ اشتباه، ری‌تراییِ
    // هم‌پوشان) تو کمتر از ۲۰ ساعتِ اخیر یک‌بار دیگه هم صدا زده باشه،
    // دوباره نفرست. خودِ ثبتِ رویدادِ daily_digest تو activity_log
    // به‌عنوانِ «آخرین بار کِی فرستاده شد» استفاده می‌شه — نیازی به جدولِ
    // جدا نیست.
    const [lastSent] = await listRecentEvents({ type: "daily_digest", limit: 1 });
    if (lastSent && Date.now() - new Date(lastSent.created_at).getTime() < 20 * 60 * 60 * 1000) {
      return NextResponse.json({ sent: false, reason: "در ۲۰ ساعتِ اخیر قبلاً فرستاده شده" });
    }

    const digest = await composeDailyDigest();
    if (!digest) {
      return NextResponse.json({ sent: false, reason: "چیزِ نگران‌کننده‌ای نبود" });
    }

    // logEvent هم تو activity_log ثبت می‌کنه، هم خودکار از طریقِ
    // Telegram/Discord (اگه تنظیم شده باشن) می‌فرسته — زیرساختِ
    // موجودِ ۲۰۲۶-۰۸-۳۰، بدونِ نیاز به کدِ ارسالِ جدید.
    await logEvent({ type: "daily_digest", message: digest });

    return NextResponse.json({ sent: true, digest });
  } catch (err) {
    console.error("alerts/daily-digest error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
