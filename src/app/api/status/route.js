import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { getDbStatus } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const database = await getDbStatus();

  return NextResponse.json({
    auth: {
      signedIn: true,
      user: session.user?.name || session.user?.email || null,
      hasAccessToken: !!session.accessToken,
      tokenError: session.error || null,
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
