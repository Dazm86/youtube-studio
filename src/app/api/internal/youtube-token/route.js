import { NextResponse } from "next/server";
import crypto from "crypto";
import { getRefreshToken } from "@/lib/db";
import { refreshAccessToken } from "@/lib/auth/authOptions";

// ۲۰۲۶-۰۸-۲۰ — بعد از چند دور دست‌وپنجه‌نرم‌کردن با اعتبارنامه‌ی گوگل
// تو GitHub Actions (invalid_client، deleted_client، ...)، این route
// جایگزینِ اون مسیر شد: worker دیگه خودش مستقیم به گوگل رفرش نمی‌زنه
// (که یعنی GOOGLE_CLIENT_ID/SECRET دیگه لازم نیست تو GitHub secrets هم
// کپی بشه — همون‌جایی که این دردسرها از اونجا شروع شده بود). worker
// فقط با WORKER_API_KEY (که از قبل بینِ Render و GitHub جفت‌وجورِ درستی
// داره) یه توکنِ آماده از همین‌جا می‌گیره — همون کدِ رفرشی که خودِ
// لاگینِ سایت باهاش کار می‌کنه، همین‌جا رو Render اجرا می‌شه، نه تو
// runnerِ گیت‌هاب.
// ۲۰۲۶-۰۸-۲۱ — از WORKER_SIGNING_SECRET استفاده می‌کنیم، نه
// WORKER_API_KEY. WORKER_API_KEY تا امروز هیچ‌وقت واقعاً جایی چک نمی‌شد
// (فقط یه fallback برای WORKER_SIGNING_SECRET بود که خودِ کاربر صریحاً
// ستش کرده بود) — یعنی هیچ‌کس مطمئن نبود دو تا کپیِ WORKER_API_KEY
// (Render و GitHub) واقعاً یکی‌ان. WORKER_SIGNING_SECRET برعکس، امروز
// بارها امتحان پس داده: هر callbackِ موفقِ امروز دقیقاً به یکی‌بودنِ
// همین مقدار بینِ دو طرف بستگی داشته.
export async function POST(request) {
  const authHeader = request.headers.get("authorization");
  const provided = authHeader?.replace("Bearer ", "") || "";
  const expected = process.env.WORKER_SIGNING_SECRET || process.env.WORKER_API_KEY || "";

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  const valid =
    expected.length > 0 &&
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
      return NextResponse.json(
        { error: "هیچ حساب گوگلی وصل نیست — یک‌بار باید از خودِ سایت وارد شده باشی." },
        { status: 404 }
      );
    }

    const refreshed = await refreshAccessToken({ refreshToken });
    if (refreshed.error || !refreshed.accessToken) {
      return NextResponse.json({ error: "تمدید توکن گوگل شکست خورد" }, { status: 502 });
    }

    return NextResponse.json({ accessToken: refreshed.accessToken });
  } catch (err) {
    console.error("youtube-token internal route error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
