import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ ok: false, error: "GROQ_API_KEY تنظیم نشده" });
  }

  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    });
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        error: data.error?.message || `خطای Groq (کد ${res.status})`,
      });
    }

    const modelCount = Array.isArray(data.data) ? data.data.length : 0;
    return NextResponse.json({
      ok: true,
      message: `اتصال برقراره ✅ — ${modelCount} مدل در دسترسه`,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
