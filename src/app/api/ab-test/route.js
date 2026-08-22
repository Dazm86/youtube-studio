import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { google } from "googleapis";
import { Readable } from "stream";
import { getVideoByVideoId, setActiveVariant } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Dynamic import sharp to avoid build-time issues on unsupported platforms
async function getBuildMayaThumbnail() {
  // فیکسِ ۲۰۲۶-۰۸-۲۲ — rendering/index.js اصلاً export مستقیمی به اسمِ
  // buildMayaThumbnail نداره (فقط از طریقِ getMayaThumbnailExports()
  // در دسترسه) — این خط همیشه undefined می‌شد و صداکردنش با
  // TypeError می‌ترکید (تو try/catch پایین قورت می‌شد، پس همیشه
  // thumbnailStatus="failed" بود، بدونِ این‌که خودِ سوییچِ عنوان
  // تحت‌تأثیر قرار بگیره).
  const { getMayaThumbnailExports } = await import("@/lib/rendering");
  const { buildMayaThumbnail } = await getMayaThumbnailExports();
  return buildMayaThumbnail;
}

// نکته‌ی مهم: یوتیوب هیچ راهی برای نمایش هم‌زمانِ دو عنوان/تامبنیل به
// دو گروه بیننده (یعنی split-test واقعی) از طریق API عمومی نمی‌ده —
// فیچر "Test & Compare" فقط داخل خودِ YouTube Studio و به‌صورت دستیه.
// این روت معادلِ صادقانه‌ای می‌سازه: نسخه‌ی انتخاب‌شده رو واقعاً روی
// ویدیوی زنده اعمال می‌کنه (videos.update + thumbnails.set) و لحظه‌ی
// سوییچ رو ثبت می‌کنه، تا کاربر بتونه CTR قبل/بعدِ سوییچ رو تو
// آنالیتیکس کانال مقایسه کنه (یعنی A/B ترتیبی، نه هم‌زمان).
export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { videoId, variant } = await req.json();
  if (!videoId || (variant !== "A" && variant !== "B")) {
    return NextResponse.json(
      { error: "videoId و variant ('A' یا 'B') لازمه" },
      { status: 400 }
    );
  }

  try {
    const video = await getVideoByVideoId(videoId);
    if (!video) {
      return NextResponse.json({ error: "ویدیو پیدا نشد" }, { status: 404 });
    }

    const newTitle = variant === "A" ? video.title_a : video.title_b;
    const newThumbText = variant === "A" ? video.thumbnail_text_a : video.thumbnail_text_b;
    if (!newTitle) {
      return NextResponse.json(
        { error: `نسخه‌ی ${variant} برای این ویدیو ذخیره نشده` },
        { status: 400 }
      );
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: session.accessToken });
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    // برای update باید snippet فعلی رو هم بفرستیم (یوتیوب snippet رو
    // کامل جایگزین می‌کنه، نه فقط فیلد title رو).
    const current = await youtube.videos.list({ part: ["snippet"], id: [videoId] });
    const currentSnippet = current.data.items?.[0]?.snippet;
    if (!currentSnippet) {
      return NextResponse.json({ error: "خوندن اطلاعات فعلیِ ویدیو از یوتیوب ناموفق بود" }, { status: 500 });
    }

    await youtube.videos.update({
      part: ["snippet"],
      requestBody: {
        id: videoId,
        snippet: { ...currentSnippet, title: newTitle },
      },
    });

    let thumbnailStatus = "skipped";
    try {
      const buildMayaThumbnail = await getBuildMayaThumbnail();
      const thumbBuffer = await buildMayaThumbnail({
        title: newTitle,
        thumbnailText: newThumbText,
        script: video.script,
        variant,
      });
      await youtube.thumbnails.set({
        videoId,
        media: { mimeType: "image/png", body: Readable.from(thumbBuffer) },
      });
      thumbnailStatus = "ok";
    } catch (thumbErr) {
      console.error("ab-test thumbnail switch error:", thumbErr.message);
      thumbnailStatus = "failed: " + thumbErr.message;
    }

    await setActiveVariant(videoId, variant);

    return NextResponse.json({
      success: true,
      activeVariant: variant,
      title: newTitle,
      thumbnailStatus,
    });
  } catch (err) {
    console.error("ab-test error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
