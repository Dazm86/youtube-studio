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

// Pick the best mp4 file for our purposes: closest to 1280px wide,
// preferring options at or above that width to avoid upscaling blur.
function pickVideoFile(videoFiles) {
  const mp4s = (videoFiles || []).filter((f) => f.file_type === "video/mp4");
  if (mp4s.length === 0) return null;

  const atLeastHD = mp4s
    .filter((f) => f.width >= 1280)
    .sort((a, b) => a.width - b.width);
  if (atLeastHD.length > 0) return atLeastHD[0];

  return mp4s.sort((a, b) => b.width - a.width)[0];
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
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(
        query
      )}&per_page=6&orientation=landscape`,
      { headers: { Authorization: process.env.PEXELS_API_KEY } }
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "خطا در دریافت کلیپ از Pexels" },
        { status: 500 }
      );
    }

    const clips = (data.videos || [])
      .map((v) => pickVideoFile(v.video_files))
      .filter(Boolean)
      .map((f) => f.link);

    if (clips.length === 0) {
      return NextResponse.json(
        { error: "کلیپی برای این موضوع پیدا نشد، متن دیگه‌ای امتحان کن" },
        { status: 404 }
      );
    }

    return NextResponse.json({ query, clips });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
