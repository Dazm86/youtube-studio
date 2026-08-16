import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getGenerateScript() {
  const { generateScript } = await import("@/lib/script");
  return generateScript;
}

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { topic, mode } = await req.json();

  try {
    const generateScript = await getGenerateScript();
    const result = await generateScript({ topic, mode, accessToken: session.accessToken });
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
