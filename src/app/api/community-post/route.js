import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { generateCommunityPost } from "../../../lib/communityPost";
import { getVideoByVideoId, recordCommunityPost, getCommunityPostsForVideo } from "../../../lib/db";

// POST { videoId } → یک پیش‌نویس پست کامیونیتی (poll/quote) تولید و
// ذخیره می‌کنه. چون یوتیوب هیچ endpoint عمومی‌ای برای انتشار خودکار تو
// تب Community نداره، این هیچ‌وقت واقعاً چیزی رو "منتشر" نمی‌کنه —
// فقط متن آماده رو برمی‌گردونه تا کاربر با یک کپی سریع خودش پیستش کنه.
export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { videoId, title: titleOverride, script: scriptOverride } = await req.json();
  if (!videoId) {
    return NextResponse.json({ error: "videoId ارسال نشده" }, { status: 400 });
  }

  try {
    let title = titleOverride;
    let script = scriptOverride;
    if (!title) {
      const video = await getVideoByVideoId(videoId);
      if (!video) {
        return NextResponse.json({ error: "ویدیو با این videoId پیدا نشد" }, { status: 404 });
      }
      title = video.title;
      script = video.script;
    }

    const draft = await generateCommunityPost({ title, script });
    const saved = await recordCommunityPost({ videoId, ...draft });

    return NextResponse.json({
      ...draft,
      id: saved.id,
      createdAt: saved.created_at,
      published: false,
      note:
        "این پیش‌نویسه، نه پستِ منتشرشده — YouTube Data API v3 راهی برای پست خودکار تو تب Community نداره. متن رو کپی کن و از اپ/سایت یوتیوب دستی پیست کن.",
    });
  } catch (err) {
    console.error("community-post error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET ?videoId=... → لیست پیش‌نویس‌های ذخیره‌شده برای یک ویدیو
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
    const posts = await getCommunityPostsForVideo(videoId);
    return NextResponse.json({ posts });
  } catch (err) {
    console.error("community-post GET error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
