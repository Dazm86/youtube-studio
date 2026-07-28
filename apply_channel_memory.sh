mkdir -p src/lib

cat > src/lib/channelHistory.js << 'EOF_SRC_LIB_CHANNELHISTORY_JS'
import { google } from "googleapis";

// از خودِ یوتیوب به‌عنوان «حافظه» استفاده می‌کنیم — عنوان چند ویدیوی اخیر
// کانال رو می‌گیریم تا سناریوی جدید تکراری نشه. اگه هر جای این مسیر خطا
// بده (مثلاً کانال هنوز ویدیویی نداره)، فقط یک آرایه‌ی خالی برمی‌گردونه؛
// این هیچ‌وقت نباید کل فرایند سناریونویسی رو متوقف کنه.
export async function getRecentVideoTitles(accessToken, maxResults = 15) {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    const channelRes = await youtube.channels.list({
      mine: true,
      part: ["contentDetails"],
    });
    const uploadsPlaylistId =
      channelRes.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return [];

    const itemsRes = await youtube.playlistItems.list({
      playlistId: uploadsPlaylistId,
      part: ["snippet"],
      maxResults,
    });

    return (itemsRes.data?.items || [])
      .map((item) => item.snippet?.title)
      .filter(Boolean);
  } catch (err) {
    console.error("getRecentVideoTitles failed:", err.message);
    return [];
  }
}
EOF_SRC_LIB_CHANNELHISTORY_JS

cat > src/app/api/generate-script/route.js << 'EOF_SRC_APP_API_GENERATE-SCRIPT_ROUTE_JS'
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { getRecentVideoTitles } from "../../../lib/channelHistory";

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

  const { topic, mode } = await req.json();
  const isShort = mode === "short";

  let topicInstruction;
  if (topic && topic.trim()) {
    topicInstruction = `The topic/theme for this video is: "${topic.trim()}"`;
  } else {
    const recentTitles = await getRecentVideoTitles(session.accessToken, 15);
    const avoidList =
      recentTitles.length > 0
        ? `\n\nVideos already published on this channel (do NOT repeat these topics or angles, pick something genuinely different):\n${recentTitles
            .map((t) => `- ${t}`)
            .join("\n")}`
        : "";
    topicInstruction = `Pick a fresh, specific mindfulness or motivational theme yourself (avoid generic or overused topics like just "gratitude" or "believe in yourself" on their own — find a specific angle or story-like framing).${avoidList}`;
  }

  const lengthInstruction = isShort
    ? `Write a spoken narration script for a short video (about 30-60 seconds when read aloud, roughly 90-130 words).`
    : `Write a spoken narration script for a long-form video (about 7-8 minutes when read aloud, roughly 950-1150 words). Structure it with a clear hook/intro, 2-4 developed points or a short story with examples, and a closing takeaway. Vary sentence rhythm so it doesn't feel repetitive over the longer length.`;

  const prompt = `You are the scriptwriter for Maya, the host of a YouTube channel called "The Mindful Path". Maya is warm, cheerful, and speaks directly to the viewer like a caring friend.

${topicInstruction}

${lengthInstruction}

Requirements:
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
        max_tokens: isShort ? 400 : 2500,
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
EOF_SRC_APP_API_GENERATE-SCRIPT_ROUTE_JS

