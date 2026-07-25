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
  const title =
    firstSentence.length > 65
      ? firstSentence.slice(0, 62) + "..."
      : firstSentence;

  return {
    title,
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
{"title": "...", "description": "...", "tags": ["...", "..."]}

Rules:
- title: under 70 characters, compelling and honest (no false claims), for a motivational/mindfulness audience
- description: 2-4 warm sentences summarizing the video's message, ending with 3-5 relevant hashtags
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
      description: parsed.description || "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      source: "ai",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(heuristicMetadata(script));
  }
}
