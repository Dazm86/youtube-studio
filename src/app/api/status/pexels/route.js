import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/authOptions";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  if (!process.env.PEXELS_API_KEY) {
    return NextResponse.json({ ok: false, error: "PEXELS_API_KEY تنظیم نشده" });
  }

  try {
    const res = await fetch(
      "https://api.pexels.com/v1/search?query=nature&per_page=1",
      { headers: { Authorization: process.env.PEXELS_API_KEY } }
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        error: data.error || `خطای Pexels (کد ${res.status})`,
      });
    }

    return NextResponse.json({ ok: true, message: "اتصال به Pexels برقراره ✅" });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
