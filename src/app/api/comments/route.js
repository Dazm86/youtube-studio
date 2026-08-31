import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { getVideoByVideoId } from "@/lib/db";
import { logEvent } from "@/lib/activityLog.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getCommentsLib() {
  const { generateCommentReplyDrafts, getRepliesForVideo } = await import("@/lib/comments");
  return { generateCommentReplyDrafts, getRepliesForVideo };
}

// POST { videoId, title? } → کامنت‌های برتر رو می‌گیره، برایِ هرکدوم
// (اگه پیش‌نویسِ قبلی نداشته باشه) یک پاسخِ AI پیش‌نویس می‌سازه و ذخیره
// می‌کنه. مثلِ پستِ کامیونیتی، هیچ‌وقت خودکار پابلیش نمی‌شه — فقط متنِ
// آماده برمی‌گرده تا کاربر با یک کپی سریع خودش تو یوتیوب پیستش کنه.
export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { videoId, title: titleOverride } = await req.json();
  if (!videoId) {
    return NextResponse.json({ error: "videoId ارسال نشده" }, { status: 400 });
  }

  try {
    let videoTitle = titleOverride;
    if (!videoTitle) {
      const video = await getVideoByVideoId(videoId);
      if (!video) {
        return NextResponse.json({ error: "ویدیو با این videoId پیدا نشد" }, { status: 404 });
      }
      videoTitle = video.title;
    }

    const { generateCommentReplyDrafts } = await getCommentsLib();
    const drafted = await generateCommentReplyDrafts({
      accessToken: session.accessToken,
      videoId,
      videoTitle,
    });

    if (drafted.length > 0) {
      logEvent({
        type: "comment_replies_drafted",
        message: `${drafted.length} پیش‌نویسِ پاسخِ کامنت برایِ «${videoTitle}» ساخته شد`,
        metadata: { videoId, count: drafted.length },
      });
    }

    return NextResponse.json({
      drafted,
      note: "این‌ها پیش‌نویس‌ان — خودکار ارسال نمی‌شن. متن رو کپی کن و زیرِ همون کامنت تو یوتیوب دستی پیست کن.",
    });
  } catch (err) {
    console.error("comments POST error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET ?videoId=... → همه‌ی پیش‌نویس‌هایِ ذخیره‌شده برایِ یک ویدیو (چه
// همین الان ساخته شده باشن، چه از قبل)
export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const videoId = new URL(req.url).searchParams.get("videoId");
  if (!videoId) {
    return NextResponse.json({ error: "videoId ارسال نشده" }, { status: 400 });
  }

  try {
    const { getRepliesForVideo } = await getCommentsLib();
    const replies = await getRepliesForVideo(videoId);
    return NextResponse.json({ replies });
  } catch (err) {
    console.error("comments GET error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
