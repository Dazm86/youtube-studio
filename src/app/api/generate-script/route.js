import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      {
        error:
          "کلید Groq تنظیم نشده. اول GROQ_API_KEY رو توی Render اضافه کن (همون کاری که برای پیشنهاد عنوان/تگ انجام دادی).",
      },
      { status: 400 }
    );
  }

  const { topic } = await req.json();

  const topicInstruction =
    topic && topic.trim()
      ? `The topic/theme for this video is: "${topic.trim()}"`
      : `Pick a fresh, specific mindfulness or motivational theme yourself (avoid generic or overused topics like just "gratitude" or "believe in yourself" on their own — find a specific angle or story-like framing).`;

  const prompt = `You are the scriptwriter for Maya, the host of a YouTube channel called "The Mindful Path". Maya is warm, cheerful, and speaks directly to the viewer like a caring friend.

${topicInstruction}

Write a spoken narration script for a short video (about 45-65 seconds when read aloud, roughly 130-170 words). Requirements:
- Plain spoken English text only. No titles, no headers, no stage directions, no markdown, no emojis.
- Written in first person as Maya, speaking directly to "you".
- Warm, sincere tone, plain everyday words, short sentences.
- Has a clear beginning (hook), middle (the insight/lesson), and end (an encouraging, actionable takeaway).
- Do not repeat the same idea twice.

Respond with ONLY the narration text itself, nothing else.`;

  try {
    const aiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 1,
      }),
    });

    const aiData = await aiRes.json();

    if (!aiRes.ok) {
      console.error("Groq API error:", aiData);
      return NextResponse.json(
        { error: "خطا در ارتباط با Groq" },
        { status: 500 }
      );
    }

    const script = (aiData?.choices?.[0]?.message?.content || "").trim();

    if (!script) {
      return NextResponse.json(
        { error: "پاسخ خالی از هوش مصنوعی دریافت شد" },
        { status: 500 }
      );
    }

    return NextResponse.json({ script });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
