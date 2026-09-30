import { NextResponse } from "next/server";
import { getTokenIdentity } from "@/lib/auth/requestToken";
import { getDbStatus } from "@/lib/db";

export async function GET(req) {
  const identity = await getTokenIdentity(req);
  if (!identity) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const database = await getDbStatus();

  return NextResponse.json({
    auth: {
      signedIn: true,
      user: identity.name || identity.email || null,
      hasAccessToken: identity.hasAccessToken,
      tokenError: identity.tokenError,
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
