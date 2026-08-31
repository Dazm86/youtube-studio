import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { getVideoByVideoId } from "@/lib/db";
import { fetchStatsForVideoInRange } from "@/lib/analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toDateStr(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// آمارِ همون روزی که سوییچ توش اتفاق افتاده رو تو *هردو* دوره حساب
// نمی‌کنیم — یک روزِ مشترک باعثِ آلوده‌شدنِ مقایسه می‌شه (بخشی از اون
// روز نسخه‌ی قدیم بوده، بخشی جدید). دوره‌ی «قبل» تا یک روز قبل از
// سوییچ می‌ره، دوره‌ی «بعد» از فردایِ سوییچ شروع می‌شه.
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get("videoId");
  if (!videoId) {
    return NextResponse.json({ error: "videoId لازمه" }, { status: 400 });
  }

  try {
    const video = await getVideoByVideoId(videoId);
    if (!video) {
      return NextResponse.json({ error: "ویدیو پیدا نشد" }, { status: 404 });
    }
    if (!video.variant_switched_at) {
      return NextResponse.json({
        available: false,
        reason: "هنوز هیچ سوییچی بینِ نسخه‌ی A و B انجام نشده — چیزی برایِ مقایسه نیست.",
      });
    }

    const switchDate = toDateStr(video.variant_switched_at);
    const uploadDate = toDateStr(video.created_at);
    const today = toDateStr(new Date());

    const beforeEnd = addDays(switchDate, -1);
    const afterStart = addDays(switchDate, 1);

    const beforeDays = Math.max(
      1,
      Math.round((new Date(beforeEnd) - new Date(uploadDate)) / 86400000) + 1
    );
    const afterDays = Math.max(1, Math.round((new Date(today) - new Date(afterStart)) / 86400000) + 1);

    if (afterDays < 2) {
      return NextResponse.json({
        available: false,
        reason: `فقط ${afterDays} روز از سوییچ گذشته — دیتایِ یوتیوب آنالیتیکس معمولاً ۱-۲ روز تأخیر داره، برایِ یک مقایسه‌ی معنی‌دار چند روزِ دیگه صبر کن.`,
      });
    }
    if (new Date(beforeEnd) < new Date(uploadDate)) {
      return NextResponse.json({
        available: false,
        reason: "سوییچ خیلی زود بعد از آپلود انجام شده — دوره‌ی «قبل» به‌اندازه‌ی کافی داده نداره.",
      });
    }

    const [before, after] = await Promise.all([
      fetchStatsForVideoInRange(session.accessToken, videoId, uploadDate, beforeEnd),
      fetchStatsForVideoInRange(session.accessToken, videoId, afterStart, today),
    ]);

    const beforeViewsPerDay = before.views / beforeDays;
    const afterViewsPerDay = after.views / afterDays;

    // سیگنالِ اصلی برایِ یک تستِ عنوان/تامبنیل، CTR ـه (نه بازدیدِ خام —
    // بازدیدِ خام از عواملِ دیگه‌ای مثلِ الگوریتم/زمانِ روز هم تأثیر
    // می‌گیره، در حالی که CTR مستقیماً واکنش به همون چیزیه که عوض شده).
    let verdict = "نزدیک به هم — تفاوتِ معنی‌داری دیده نمی‌شه";
    const ctrDiff = after.thumbnailCtr - before.thumbnailCtr;
    if (before.thumbnailImpressions > 50 && after.thumbnailImpressions > 50) {
      if (ctrDiff > 0.3) verdict = `نسخه‌ی فعلی (${video.active_variant}) بهتر عمل می‌کنه — CTR بالاتر`;
      else if (ctrDiff < -0.3) verdict = `نسخه‌ی قبلی بهتر بود — CTR بعد از سوییچ افت کرده`;
    } else {
      verdict = "تعدادِ نمایشِ تامبنیل (impressions) هنوز کمه — CTR قابلِ‌اعتماد نیست، صبر کن";
    }

    return NextResponse.json({
      available: true,
      switchDate,
      activeVariant: video.active_variant,
      before: { ...before, days: beforeDays, viewsPerDay: Math.round(beforeViewsPerDay * 10) / 10 },
      after: { ...after, days: afterDays, viewsPerDay: Math.round(afterViewsPerDay * 10) / 10 },
      verdict,
    });
  } catch (err) {
    console.error("ab-test results error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
