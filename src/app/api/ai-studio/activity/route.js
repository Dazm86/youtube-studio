import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { getStudioActivity, getStudioUsageSummary } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// پشتِ دو پنلِ واقعی تو AI Studio: «تاریخچه» (فهرست) و «پایشِ منابع»
// (خلاصه‌ی جمع‌شده). هر دو از همون جدولِ studio_activity میان — یک
// درخواست به‌جای دوتا.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌ید" }, { status: 401 });
  }

  try {
    const [activity, usage] = await Promise.all([getStudioActivity(30), getStudioUsageSummary()]);
    return NextResponse.json({ activity, usage });
  } catch (err) {
    console.error("ai-studio/activity error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
