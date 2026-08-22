import GoogleProviderModule from "next-auth/providers/google";
import { saveRefreshToken } from "../db/index.js";

// ۲۰۲۶-۰۸-۱۹ — این پکیج CommonJSه (exports.default = Google). زیرِ
// باندلرِ Next.js (که تا الان همیشه این فایل رو ازش لود می‌کردیم)،
// import پیش‌فرض خودش .default رو باز می‌کنه و مستقیم تابع رو می‌ده.
// ولی زیرِ ESM خالصِ Node (که worker باهاش اجرا می‌شه)، import پیش‌فرض
// از یک ماژولِ CJS برابرِ کل module.exports می‌شه — یعنی نتیجه‌اش
// `{ default: Google }` هست (خودِ تابع، تو دلِ یک آبجکت)، نه خودِ تابع؛
// همین باعثِ «GoogleProvider is not a function» شد. این خط هر دو حالت
// رو درست هندل می‌کنه.
const GoogleProvider = GoogleProviderModule.default || GoogleProviderModule;

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
        // فیکسِ ۲۰۲۶-۰۸-۲۲ (باگِ اصلیِ بررسیِ ۲۰۲۶-۰۸-۱۸) — next-auth v4
        // برای Google، فیلدِ account.expires_at (timestamp به ثانیه) رو
        // می‌ده، نه account.expires_in که اینجا استفاده می‌شد. نتیجه
        // همیشه NaN بود، یعنی چکِ `Date.now() < token.accessTokenExpires`
        // همیشه false می‌شد و refreshAccessToken روی *هر* فراخوانیِ jwt
        // callback صدا زده می‌شد (نه فقط وقتی واقعاً نزدیکِ انقضا بود) —
        // فشارِ غیرضروریِ مکرر رو endpointِ رفرشِ گوگل.
        token.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 3600 * 1000;
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
