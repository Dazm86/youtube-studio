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

export function extractKeywords(text, count = 4) {
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

function pickVideoFile(videoFiles, isPortrait) {
  const mp4s = (videoFiles || []).filter((f) => f.file_type === "video/mp4");
  if (mp4s.length === 0) return null;

  const longEdge = (f) => (isPortrait ? f.height : f.width);

  const atLeastHD = mp4s
    .filter((f) => longEdge(f) >= 1280)
    .sort((a, b) => longEdge(a) - longEdge(b));
  if (atLeastHD.length > 0) return atLeastHD[0];

  return mp4s.sort((a, b) => longEdge(b) - longEdge(a))[0];
}

function resolveQueryAndOrientation({ text, keyword, orientation }) {
  const query = (keyword && keyword.trim()) || extractKeywords(text) || "nature";
  const safeOrientation = orientation === "portrait" ? "portrait" : "landscape";
  return { query, safeOrientation };
}

export async function fetchImages({ text, keyword, count, orientation }) {
  const perPage = Math.min(Math.max(parseInt(count) || 6, 1), 40);
  const { query, safeOrientation } = resolveQueryAndOrientation({
    text,
    keyword,
    orientation,
  });

  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(
      query
    )}&per_page=${perPage}&orientation=${safeOrientation}`,
    { headers: { Authorization: process.env.PEXELS_API_KEY } }
  );
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "خطا در دریافت عکس از Pexels");
  }

  const images = (data.photos || []).map((p) => p.src.large2x);

  if (images.length === 0) {
    throw new Error("عکسی برای این موضوع پیدا نشد، متن دیگه‌ای امتحان کن");
  }

  return { query, images };
}

export async function fetchClips({ text, keyword, count, orientation }) {
  const perPage = Math.min(Math.max(parseInt(count) || 6, 1), 30);
  const { query, safeOrientation } = resolveQueryAndOrientation({
    text,
    keyword,
    orientation,
  });

  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(
      query
    )}&per_page=${perPage}&orientation=${safeOrientation}`,
    { headers: { Authorization: process.env.PEXELS_API_KEY } }
  );
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "خطا در دریافت کلیپ از Pexels");
  }

  const clips = (data.videos || [])
    .map((v) => pickVideoFile(v.video_files, safeOrientation === "portrait"))
    .filter(Boolean)
    .map((f) => f.link);

  if (clips.length === 0) {
    throw new Error("کلیپی برای این موضوع پیدا نشد، متن دیگه‌ای امتحان کن");
  }

  return { query, clips };
}
