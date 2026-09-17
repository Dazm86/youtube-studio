import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { runAssistantChat } from "@/lib/assistant";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { messages } = await req.json();
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages لازمه" }, { status: 400 });
  }

  try {
    const result = await runAssistantChat(messages);
    return NextResponse.json(result);
  } catch (err) {
    console.error("assistant/chat error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
