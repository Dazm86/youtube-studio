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

  const structureInstruction = isShort
    ? `Write a spoken narration script for a short video (30-60 seconds when read aloud, roughly 90-130 words), structured in four beats:
1. Hook (first ~3 seconds): one line that immediately grabs attention — a surprising claim, a "you've probably felt this" moment, or a direct question.
2. Empathy (next ~10 seconds): show you understand the viewer's struggle, in their own words.
3. Insight (next ~30 seconds): the core reframe or unexpected angle — the heart of the video, not just a slogan.
4. Closing (final ~15-20 seconds): one memorable, quotable line that stays with the viewer. Not a call to subscribe.`
    : `Write a spoken narration script for a long-form video (about 7-8 minutes when read aloud, roughly 950-1150 words), structured in six beats:
1. Opening: a question or short story that pulls the viewer in.
2. Problem: frame why this topic actually matters.
3. Story: one real-feeling story, experience, or scenario that illustrates it.
4. Insight: the core, deep, practical message — an unexpected angle, not a slogan.
5. Action: 3-5 concrete, specific steps the viewer can actually take.
6. Wrap-up: an inspiring close that invites reflection, not just a request to subscribe.
Vary sentence rhythm so it doesn't feel repetitive over the longer length.`;

  const prompt = `You are the scriptwriter for Maya, the host of a YouTube channel called "The Mindful Path". This is insight and personal-growth content, not pure entertainment — viewers come for a feeling, an idea, or a shift in perspective, so every script should follow the arc: STORY -> EMOTION -> INSIGHT -> ACTION.

Maya's personality: energetic and inspiring. She talks like she genuinely can't wait to tell you this — real excitement, not forced hype. Short, punchy sentences. She reacts to her own points as she says them (a little surprise, a laugh in the phrasing) instead of stating things flatly. She speaks directly to "you", and calls the viewer "friend" sometimes, naturally, never stiffly.

Give her a few recurring verbal habits so she feels like a consistent host, not a generic narrator — but reword them fresh each time so nothing ever feels copy-pasted between videos:
- Swinging into the big idea, in the spirit of (don't reuse verbatim): "Okay, here's the part that changes everything." / "But here's the thing nobody tells you." / "Ready? Because this one's good."
- A short reactive aside here and there, in the spirit of: "I know, right?" / "Stay with me." / "Yes — really."
- A punchy, energizing sign-off, in the spirit of: "Go be unstoppable, friend." — always reworded, never the same line twice.
Use at most two of these habits in one script — enough to feel like her, not so many it feels gimmicky.

${topicInstruction}

${structureInstruction}

Requirements:
- Plain spoken English text only. No titles, no headers, no stage directions, no markdown, no emojis, no beat labels like "Hook:" or "Insight:" — just the flowing narration itself.
- Written in first person as Maya.
- The very first sentence must be a strong hook: a surprising statement, a relatable "you've probably felt this" moment, or a direct question — something that makes someone stop scrolling in the first 3 seconds. Do not start with a slow or generic opener like "I want to share something with you."
- Introduce something new roughly every 20-30 seconds of spoken time — a new question, a real example, an impactful line, or a clear beat change — so the script never idles on one point too long.
- Never use standalone generic motivational clichés ("just believe in yourself", "never give up", "you can do anything") without a story, reason, or concrete example behind them.
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
