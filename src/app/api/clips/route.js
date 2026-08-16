import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getFetchClips() {
  const { fetchClips } = await import("@/lib/media");
  return fetchClips;
}

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { text, keyword, count, orientation } = await req.json();

  if (!text && !keyword) {
    return NextResponse.json({ error: "متنی ارسال نشده" }, { status: 400 });
  }

  try {
    const fetchClips = await getFetchClips();
    const result = await fetchClips({ text, keyword, count, orientation });
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
