import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { addIdea, listIdeas } from "@/lib/ideas/db.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  try {
    return NextResponse.json({ ideas: await listIdeas() });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const idea = await addIdea(body);
    return NextResponse.json({ idea });
  } catch (err) {
    // خطای اعتبارسنجی (۴۰۰) با خطای سرور/DB (۵۰۰) فرق داره
    const isValidation = /ایده|توضیحات|فرمت/.test(err.message);
    return NextResponse.json({ error: err.message }, { status: isValidation ? 400 : 500 });
  }
}
