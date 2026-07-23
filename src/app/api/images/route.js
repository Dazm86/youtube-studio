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

function extractKeywords(text, count = 4) {
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
    .map(([w]) => w)
    .join(" ");
}

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { text, keyword } = await req.json();

  if (!text && !keyword) {
    return NextResponse.json({ error: "متنی ارسال نشده" }, { status: 400 });
  }

  const query = (keyword && keyword.trim()) || extractKeywords(text) || "nature";

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(
        query
      )}&per_page=6&orientation=landscape`,
      { headers: { Authorization: process.env.PEXELS_API_KEY } }
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "خطا در دریافت عکس از Pexels" },
        { status: 500 }
      );
    }

    const images = (data.photos || []).map((p) => p.src.large);

    if (images.length === 0) {
      return NextResponse.json(
        { error: "عکسی برای این موضوع پیدا نشد، متن دیگه‌ای امتحان کن" },
        { status: 404 }
      );
    }

    return NextResponse.json({ query, images });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
