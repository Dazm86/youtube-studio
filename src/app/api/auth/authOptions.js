import GoogleProvider from "next-auth/providers/google";
import { saveRefreshToken } from "../../../lib/db";

export async function refreshAccessToken(token) {
  try {
    const url = "https://oauth2.googleapis.com/token";

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });

    const refreshedTokens = await response.json();

    if (!response.ok) {
      throw refreshedTokens;
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
    };
  } catch (error) {
    console.error("خطا در تمدید توکن:", error);
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/yt-analytics.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpires = Date.now() + account.expires_in * 1000;
        // فاز ۴: این refresh_token رو تو DB هم ذخیره می‌کنیم (نه فقط تو
        // کوکیِ رمزنگاری‌شده‌ی NextAuth) — چون پایپ‌لاینِ زمان‌بندی‌شده
        // (بدون نشست مرورگرِ فعال) باید بتونه هر وقت خواست توکن تازه
        // بگیره. خطای اینجا نباید جلوی ورود کاربر رو بگیره.
        saveRefreshToken(account.refresh_token).catch((err) =>
          console.error("saveRefreshToken failed:", err.message)
        );
        return token;
      }

      if (Date.now() < token.accessTokenExpires) {
        return token;
      }

      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      return session;
    },
  },
};
