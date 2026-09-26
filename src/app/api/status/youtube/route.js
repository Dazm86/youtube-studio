import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { google } from "googleapis";

export async function POST(req) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  if (!token.accessToken) {
    return NextResponse.json({
      ok: false,
      error: "توکن دسترسی گوگل موجود نیست، یک‌بار خارج و دوباره وارد شو",
    });
  }

  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token.accessToken });
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    const res = await youtube.channels.list({ mine: true, part: ["snippet"] });
    const channel = res.data?.items?.[0];

    if (!channel) {
      return NextResponse.json({ ok: false, error: "کانالی برای این حساب پیدا نشد" });
    }

    return NextResponse.json({
      ok: true,
      message: `اتصال برقراره ✅ — کانال: ${channel.snippet?.title || "بدون نام"}`,
    });
  } catch (err) {
    const isScopeError =
      err.message && (err.message.includes("insufficient") || err.message.includes("403"));
    return NextResponse.json({
      ok: false,
      error: isScopeError
        ? "دسترسی کافی نیست — یک‌بار از سایت خارج و دوباره با گوگل وارد شو."
        : err.message,
    });
  }
}
