// ۲۰۲۶-۰۹-۲۲ — با حذفِ session.accessToken از authOptions.js، مسیرهایِ
// سرور دیگه نمی‌تونن از getServerSession().accessToken استفاده کنن؛ باید
// از getToken() (next-auth/jwt) بخونن — فقط سمتِ سرور، هیچ‌وقت به کلاینت
// نمی‌ره. ولی getToken() برخلافِ getServerSession() callbackِ jwt رو
// دوباره اجرا نمی‌کنه، یعنی تمدیدِ خودکارِ توکنِ منقضی رو انجام نمی‌ده؛
// این تابع همون منطقِ تمدید رو صریح اینجا تکرار می‌کنه.
// عمداً تو فایلِ جدا از authOptions.js گذاشته شده تا worker (که
// authOptions رو زیرِ ESM خالصِ Node ممکنه لود کنه) وابسته‌ی next-auth/jwt
// نشه.
import { getToken } from "next-auth/jwt";
import { refreshAccessToken } from "./authOptions.js";

export async function getAccessTokenFromRequest(req) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token || !token.accessToken) return null;
  if (token.accessTokenExpires && Date.now() >= token.accessTokenExpires - 60 * 1000) {
    const refreshed = await refreshAccessToken(token);
    if (refreshed.error || !refreshed.accessToken) return null;
    return refreshed.accessToken;
  }
  return token.accessToken;
}

// برایِ routeهایی که فقط لازم دارن بدونن کاربر وارد شده یا نه، و
// اطلاعاتِ نمایشی (نام/ایمیل) — بدونِ خودِ توکن.
export async function getTokenIdentity(req) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return null;
  return {
    name: token.name || null,
    email: token.email || null,
    hasAccessToken: !!token.accessToken,
    tokenError: token.error || null,
  };
}
