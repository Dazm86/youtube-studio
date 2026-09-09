import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { logEvent } from "@/lib/activityLog.js";

async function getGenerateThemedCommunityPosts() {
  const { generateThemedCommunityPosts } = await import("@/lib/community");
  return generateThemedCommunityPosts;
}

// POST { theme } → ۳ پیش‌نویسِ پستِ کامیونیتی (poll + discussion + teaser)
// حول یک تِمِ کلی، برای پرکردنِ فاصله‌ی بینِ آپلودها — بر خلافِ
// api/community (که همیشه بهِ یک videoId مشخص وصله)، اینجا هیچ ویدیویی
// درکار نیست، پس هیچ‌جا ذخیره نمی‌شه؛ فقط برمی‌گرده تا کاربر کپی/پیست
// کنه.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { theme } = await req.json();
  if (!theme || !theme.trim()) {
    return NextResponse.json({ error: "تم/موضوع ارسال نشده" }, { status: 400 });
  }

  try {
    const generateThemedCommunityPosts = await getGenerateThemedCommunityPosts();
    const posts = await generateThemedCommunityPosts({ theme });
    logEvent({
      type: "themed_community_posts_created",
      message: `۳ پیش‌نویسِ پستِ کامیونیتیِ تمی برای «${theme}» ساخته شد`,
      metadata: { theme },
    });
    return NextResponse.json({
      ...posts,
      note:
        "این پیش‌نویسه، نه پستِ منتشرشده — YouTube Data API v3 راهی برای پست خودکار تو تب Community نداره. متن رو کپی کن و از اپ/سایت یوتیوب دستی پیست کن.",
    });
  } catch (err) {
    console.error("community/theme error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
