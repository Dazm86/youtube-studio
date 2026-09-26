import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getDbStatus } from "@/lib/db";

export async function GET(req) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const database = await getDbStatus();

  return NextResponse.json({
    auth: {
      signedIn: true,
      user: token.name || token.email || null,
      hasAccessToken: !!token.accessToken,
      tokenError: token.error || null,
      googleClientConfigured: !!(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ),
    },
    nextAuth: {
      secretConfigured: !!process.env.NEXTAUTH_SECRET,
      urlConfigured: !!process.env.NEXTAUTH_URL,
    },
    groq: { configured: !!process.env.GROQ_API_KEY },
    pexels: { configured: !!process.env.PEXELS_API_KEY },
    database,
  });
}
