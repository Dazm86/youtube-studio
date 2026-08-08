import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { generateScript } from "../../../lib/scriptGen";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { topic, mode } = await req.json();

  try {
    const result = await generateScript({ topic, mode, accessToken: session.accessToken });
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
