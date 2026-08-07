import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "to", "of", "in", "on", "at", "for", "with", "by", "from",
  "as", "that", "this", "these", "those", "it", "its", "i", "you", "he",
  "she", "we", "they", "them", "his", "her", "our", "your", "their", "not",
  "no", "so", "if", "then", "than", "too", "very", "can", "will", "just",
  "about", "into", "over", "after", "before", "up", "down", "out", "off",
  "again", "there", "here", "what", "when", "where", "why", "how", "all",
  "any", "both", "each", "few", "more", "most", "other", "some", "such",
  "only", "own", "same", "also",
]);

function extractKeywords(text, count) {
  const words = (text || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([w]) => w);
}

function heuristicMetadata(script) {
  const keywords = extractKeywords(script, 12);
  const firstSentence = (script.match(/[^.!?]+[.!?]?/) || [script])[0].trim();
  // زیر ۴۸ کاراکتر نگه می‌داریم تا با " | The Mindful Path" اضافه‌شده
  // عنوان کامل هنوز زیر ~۷۰ کاراکتر بمونه.
  const hook =
    firstSentence.length > 48
      ? firstSentence.slice(0, 45) + "..."
      : firstSentence;
  const title = `${hook} | The Mindful Path`;

  // متن جدای صورت کوچک: ۴-۶ کلمه‌ی اول جمله، جدا از عنوان کامل
  const thumbnailText =
    firstSentence.split(/\s+/).slice(0, 5).join(" ") ||
    (keywords[0] ? keywords[0][0].toUpperCase() + keywords[0].slice(1) : "Mindful Moment");

  return {
    title,
    thumbnailText,
    description: script.slice(0, 300),
    tags: keywords,
    source: "heuristic",
  };
}

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { script } = await req.json();
  if (!script || !script.trim()) {
    return NextResponse.json({ error: "متنی ارسال نشده" }, { status: 400 });
  }

  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(heuristicMetadata(script));
  }

  const prompt = `You are helping write YouTube upload metadata for a short motivational/mindfulness video on a channel called "The Mindful Path", hosted by an animated character named Maya.

Video script:
"""
${script}
"""

Respond with ONLY a JSON object (no markdown, no code fences, no explanation) in this exact shape:
{"title": "...", "thumbnailText": "...", "description": "...", "tags": ["...", "..."]}

Rules:
- title: MUST open with a strong hook pulled straight from the video's topic — a specific keyword, a number, or a named problem/pain point (e.g. "5 Signs...", "Anxiety Doesn't...", "Why You Can't Stop..."). Never open with a generic phrase, a greeting, or a full sentence copied from the script. Follow the hook with the rest of the title, then end with exactly " | The Mindful Path". Keep everything before that suffix under ~48 characters so the full title stays under ~70.
- thumbnailText: 4-6 words only, written to sit as bold text on a thumbnail image (short, punchy, high-curiosity). Must NOT restate or shorten the title — give it a different angle or emotional beat from the same topic. No trailing punctuation.
- description: the FIRST LINE must open directly with the video's main keyword/topic — no "Hey!", "Welcome", "In this video" or similar greetings, since that first line is all viewers see before "Show more". After that keyword-led opening line, add 2-3 more warm sentences summarizing the video's message, ending with 3-5 relevant hashtags.
- tags: 10-15 short relevant keywords/phrases for YouTube SEO (lowercase, no # symbol)`;

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
      }),
    });

    const aiData = await aiRes.json();

    if (!aiRes.ok) {
      console.error("Groq API error:", aiData);
      return NextResponse.json(heuristicMetadata(script));
    }

    const rawText = aiData?.choices?.[0]?.message?.content || "";
    const cleaned = rawText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(heuristicMetadata(script));
    }

    return NextResponse.json({
      title: parsed.title || "",
      thumbnailText: parsed.thumbnailText || "",
      description: parsed.description || "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      source: "ai",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(heuristicMetadata(script));
  }
}
