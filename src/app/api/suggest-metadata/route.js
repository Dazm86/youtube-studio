import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { generateMetadata } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { script } = await req.json();
  if (!script || !script.trim()) {
    return NextResponse.json({ error: "متنی ارسال نشده" }, { status: 400 });
  }

  const result = await generateMetadata(script);
  return NextResponse.json(result);
}
