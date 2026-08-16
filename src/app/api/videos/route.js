import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { getAllVideos } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  try {
    const videos = await getAllVideos();
    return NextResponse.json({ videos });
  } catch (err) {
    console.error("videos list error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
