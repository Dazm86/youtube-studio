import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { google } from "googleapis";
import { Readable } from "stream";

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

    return NextResponse.json({ success: true, videoId: response.data.id });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
