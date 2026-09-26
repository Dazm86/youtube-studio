import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getAllVideoIds, updateVideoStats } from "@/lib/db";
import { fetchStatsForVideos } from "@/lib/analytics";

export async function POST(req) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token || !token.accessToken) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  try {
    const videoIds = await getAllVideoIds();
    if (videoIds.length === 0) {
      return NextResponse.json({ updated: 0, message: "هنوز ویدیویی ثبت نشده" });
    }

    const stats = await fetchStatsForVideos(token.accessToken, videoIds);

    let updated = 0;
    for (const videoId of videoIds) {
      if (stats[videoId]) {
        await updateVideoStats(videoId, stats[videoId]);
        updated++;
      }
    }

    return NextResponse.json({ updated, total: videoIds.length });
  } catch (err) {
    console.error("sync-stats error:", err.message);
    const isScopeError =
      err.message && (err.message.includes("insufficient") || err.message.includes("403"));
    return NextResponse.json(
      {
        error: isScopeError
          ? "دسترسی آمار یوتیوب فعال نیست — یک‌بار از سایت خارج و دوباره با گوگل وارد شو تا دسترسی جدید تأیید بشه."
          : err.message,
      },
      { status: 500 }
    );
  }
}
