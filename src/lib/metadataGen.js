import { generateText } from "./providers/router";

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
    firstSentence.split(/\s+/).slice(0, 4).join(" ") || topKeyword;
  const thumbnailTextB =
    (secondSentence || firstSentence).split(/\s+/).slice(0, 4).join(" ") ||
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

// فصل‌بندیِ خودکار (Chapters) برای توضیحاتِ ویدیوهای بلند. این تابع فقط
// نشانه‌های متنی (عنوانِ فصل + چند کلمه‌ی اولِ همون فصل تو اسکریپت) رو
// برمی‌گردونه، نه زمان‌بندیِ واقعی — چون در لحظه‌ی صدازدنِ این تابع (پیش‌
// نمایشِ متادیتا تو UI) هنوز audioDurationSec معلوم نیست؛ محاسبه‌ی
// تایم‌استمپِ واقعی (بر اساسِ همون مدلِ نسبت‌به‌موقعیتِ کلمه که
// scriptTiming.js/distributeDurations هم استفاده می‌کنه) توی pipeline.js
// بعد از ساختِ صدا انجام می‌شه.
export async function generateChapters(script) {
  const prompt = `Here is a spoken video script:
"""
${script}
"""

Identify 3 to 5 natural chapter breaks in this script — points where the topic/focus genuinely shifts (e.g. moving from explaining a problem to telling a story, or from a story to actionable steps). This is for YouTube chapter markers.

Respond with ONLY a JSON object, nothing else:
{"chapters": [{"title": "...", "firstWords": "..."}, ...]}

Rules:
- 3 to 5 chapters total, listed in the order they occur in the script.
- The FIRST chapter must start at the very beginning — its "firstWords" must be the first few words of the script itself, copied verbatim.
- "title": a short (2-5 word) label describing what that chapter covers (e.g. "Why This Happens", "A Real Story", "3 Steps to Fix It") — a clear label, not a full sentence, not clickbait.
- "firstWords": the exact first 4-6 words of the sentence where that chapter begins, copied verbatim from the script (so its position can be located later) — never paraphrased.`;

  const rawText = await generateText({ prompt, jsonMode: true, temperature: 0.3, maxTokens: 500 });
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.chapters) || parsed.chapters.length < 3) {
    throw new Error(`تعداد فصلِ نامعتبر برگشت (${parsed.chapters?.length ?? "نامعتبر"})`);
  }
  return parsed.chapters;
}

// دقیقاً همون منطقِ api/suggest-metadata/route.js، از یک route جدا شده
// تا زمان‌بند خودکار هم بتونه بدون یک round-trip HTTP اضافه صداش بزنه.
// هیچ‌وقت throw نمی‌کنه — هر مسیر شکست به heuristicMetadata برمی‌گرده،
// دقیقاً مثل رفتار قبلیِ route.
export async function generateMetadata(script) {
  const prompt = `You are helping write YouTube upload metadata for a short motivational/mindfulness video on a channel called "The Mindful Path", hosted by an animated character named Maya.

Video script:
"""
${script}
"""

Respond with ONLY a JSON object (no markdown, no code fences, no explanation) in this exact shape:
{"titleA": "...", "titleB": "...", "thumbnailTextA": "...", "thumbnailTextB": "...", "description": "...", "tags": ["...", "..."]}

Rules:
- titleA and titleB: TWO distinct title options for an A/B test — same video, genuinely different hooks/angles (e.g. one framed as a direct "why" problem+solution, the other as a number/list framing, or a curiosity-gap question), not just two rewordings of the same sentence. Each MUST present a concrete problem and promise a solution — this is the most important rule and overrides any pull toward something clever-sounding. Push the promise as big and specific as the script honestly supports — a bold claim about a concrete timeframe, a specific number, or a surprising hidden cause earns far more clicks than a mild description (e.g. "The Real Reason You Can't Focus (It's Not What You Think)", "I Fixed My Anxiety In One Week Doing This", "3 Signs You're About to Burn Out"). The bigger the promise, the more the script must actually pay it off — never promise something the video doesn't deliver, since YouTube ranks on watch time, not clicks, so an unearned promise costs more than it gains. Strictly forbidden: artistic, poetic, vague, or abstract titles (never something like "Memory Echoes" or "The Weight We Carry") — a viewer must understand exactly what problem this video solves within one glance. Prefer the pattern "[Problem statement or question] (And How to [Solution/Fix])" (e.g. "Why You Can't Let Go of the Past (And How to Stop)", "5 Signs You're Burning Out (And What Actually Helps)") — a number or a direct why/how framing both work as the opening hook, but each title must always resolve toward a solution being promised, never just name a feeling. Follow the hook with the rest of the title, then end with exactly " | The Mindful Path". Also make the two titles deliberately different in LENGTH, not just angle — make titleA short and punchy (aim for well under half the character budget below, e.g. just the hook itself), and let titleB run fuller/more descriptive using more of the available room. Keep everything before that suffix under ~52 characters so the full title stays under ~72 — this is a ceiling for titleB, not a target both should hit.
- thumbnailTextA and thumbnailTextB: STRICTLY 3-4 words each (never more — this is a hard limit, not a target), written to sit as large bold text on a thumbnail image (short, punchy, high-curiosity — think of the biggest, simplest words that would work shouted across a room). Each must pair with its matching title (A with A, B with B) but must NOT restate or shorten that title — give it a different angle or emotional beat from the same topic. No trailing punctuation. The two thumbnail texts should also read differently from each other.
- description: the FIRST LINE must open directly with the video's main keyword/topic — no "Hey!", "Welcome", "In this video" or similar greetings, since that first line is all viewers see before "Show more". After that keyword-led opening line, add 2-3 more warm sentences summarizing the video's message, ending with 3-5 relevant hashtags.
- tags: 10-15 short relevant keywords/phrases for YouTube SEO (lowercase, no # symbol)`;

  try {
    const rawText = await generateText({ prompt, jsonMode: true });
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
