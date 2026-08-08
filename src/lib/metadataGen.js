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
  const secondSentence = (
    script.match(/[^.!?]+[.!?]?/g) || [script]
  )[1]?.trim();
  const clip = (s) => (s && s.length > 52 ? s.slice(0, 49) + "..." : s);
  const topKeyword = keywords[0]
    ? keywords[0][0].toUpperCase() + keywords[0].slice(1)
    : "This";

  const titleA = `${clip(firstSentence) || topKeyword} | The Mindful Path`;
  const titleB = `Why ${topKeyword} Feels So Hard (And What Helps) | The Mindful Path`;

  const thumbnailTextA =
    firstSentence.split(/\s+/).slice(0, 5).join(" ") || topKeyword;
  const thumbnailTextB =
    (secondSentence || firstSentence).split(/\s+/).slice(0, 5).join(" ") ||
    topKeyword;

  return {
    title: titleA,
    thumbnailText: thumbnailTextA,
    titleA,
    titleB,
    thumbnailTextA,
    thumbnailTextB,
    description: script.slice(0, 300),
    tags: keywords,
    source: "heuristic",
  };
}

// دقیقاً همون منطقِ api/suggest-metadata/route.js، از یک route جدا شده
// تا زمان‌بند خودکار هم بتونه بدون یک round-trip HTTP اضافه صداش بزنه.
// هیچ‌وقت throw نمی‌کنه — هر مسیر شکست به heuristicMetadata برمی‌گرده،
// دقیقاً مثل رفتار قبلیِ route.
export async function generateMetadata(script) {
  if (!process.env.GROQ_API_KEY) {
    return heuristicMetadata(script);
  }

  const prompt = `You are helping write YouTube upload metadata for a short motivational/mindfulness video on a channel called "The Mindful Path", hosted by an animated character named Maya.

Video script:
"""
${script}
"""

Respond with ONLY a JSON object (no markdown, no code fences, no explanation) in this exact shape:
{"titleA": "...", "titleB": "...", "thumbnailTextA": "...", "thumbnailTextB": "...", "description": "...", "tags": ["...", "..."]}

Rules:
- titleA and titleB: TWO distinct title options for an A/B test — same video, genuinely different hooks/angles (e.g. one framed as a direct "why" problem+solution, the other as a number/list framing, or a curiosity-gap question), not just two rewordings of the same sentence. Each MUST present a concrete problem and promise a solution — this is the most important rule and overrides any pull toward something clever-sounding. Strictly forbidden: artistic, poetic, vague, or abstract titles (never something like "Memory Echoes" or "The Weight We Carry") — a viewer must understand exactly what problem this video solves within one glance. Prefer the pattern "[Problem statement or question] (And How to [Solution/Fix])" (e.g. "Why You Can't Let Go of the Past (And How to Stop)", "5 Signs You're Burning Out (And What Actually Helps)") — a number or a direct why/how framing both work as the opening hook, but each title must always resolve toward a solution being promised, never just name a feeling. Follow the hook with the rest of the title, then end with exactly " | The Mindful Path". Keep everything before that suffix under ~52 characters so the full title stays under ~72.
- thumbnailTextA and thumbnailTextB: 4-6 words each, written to sit as bold text on a thumbnail image (short, punchy, high-curiosity). Each must pair with its matching title (A with A, B with B) but must NOT restate or shorten that title — give it a different angle or emotional beat from the same topic. No trailing punctuation. The two thumbnail texts should also read differently from each other.
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
      return heuristicMetadata(script);
    }

    const rawText = aiData?.choices?.[0]?.message?.content || "";
    const cleaned = rawText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return heuristicMetadata(script);
    }

    const titleA = parsed.titleA || parsed.title || "";
    const thumbnailTextA = parsed.thumbnailTextA || parsed.thumbnailText || "";
    return {
      title: titleA,
      thumbnailText: thumbnailTextA,
      titleA,
      titleB: parsed.titleB || "",
      thumbnailTextA,
      thumbnailTextB: parsed.thumbnailTextB || "",
      description: parsed.description || "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      source: "ai",
    };
  } catch (err) {
    console.error(err);
    return heuristicMetadata(script);
  }
}
