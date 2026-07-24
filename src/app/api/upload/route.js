import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { google } from "googleapis";
import { Readable } from "stream";
import { buildMayaThumbnail } from "../../../lib/mayaThumbnail";

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("video");
  const title = formData.get("title") || "بدون عنوان";
  const description = formData.get("description") || "";
  const privacyStatus = formData.get("privacyStatus") || "private";
  const publishAt = formData.get("publishAt") || null;
  const script = formData.get("script") || "";
  const bgImageUrl = formData.get("bgImageUrl") || "";

  if (!file) {
    return NextResponse.json({ error: "فایل ویدیو ارسال نشده" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const stream = Readable.from(buffer);

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.accessToken });

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  try {
    const response = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title,
          description,
        },
        status: publishAt
          ? {
              privacyStatus: "private", // یوتیوب برای زمان‌بندی الزام می‌کنه private باشه
              publishAt: new Date(publishAt).toISOString(),
            }
          : {
              privacyStatus,
            },
      },
      media: {
        body: stream,
      },
    });

    const videoId = response.data.id;
    let thumbnailStatus = "skipped";

    try {
      const thumbBuffer = await buildMayaThumbnail({ title, script, bgImageUrl });
      await youtube.thumbnails.set({
        videoId,
        media: {
          mimeType: "image/png",
          body: Readable.from(thumbBuffer),
        },
      });
      thumbnailStatus = "ok";
    } catch (thumbErr) {
      console.error("thumbnail error:", thumbErr.message);
      thumbnailStatus = "failed: " + thumbErr.message;
    }

    return NextResponse.json({ success: true, videoId, thumbnailStatus });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
