import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { synthesizeSpeech } from "../../../lib/providers/router";

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { text, voice } = await req.json();

  if (!text) {
    return NextResponse.json({ error: "متنی ارسال نشده" }, { status: 400 });
  }

  try {
    // voice اختیاریه — هر ارائه‌دهنده‌ی صدا (msedge-tts، OpenAI،
    // ElevenLabs...) فضای اسم صدای خودش رو داره، پس اگه فرستاده نشه
    // همون پیش‌فرض provider انتخاب‌شده استفاده می‌شه.
    const { buffer, mimeType } = await synthesizeSpeech({ text, voice });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeType || "audio/mpeg",
        "Content-Disposition": "attachment; filename=narration.mp3",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
