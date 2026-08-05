// src/lib/translateCaptions.js
//
// Translates the caption/segment texts (same ones used to build the English
// SRT) into another language via Groq. Length/order must match the input
// exactly, since the translated text gets zipped back with the *same*
// `durations` array to build that language's SRT — a mismatched length
// would misalign every subtitle after the first difference.

const GROQ_MODEL = "llama-3.3-70b-versatile";

export async function translateCaptions(captions, languageName) {
  const prompt = `Translate this list of ${captions.length} video subtitle segments into ${languageName}. This is spoken narration from an energetic, warm host — translate for natural spoken tone in ${languageName}, not a stiff literal translation.

Critical: return EXACTLY ${captions.length} items, in the same order, each the translation of the input item at that same index. Never merge, split, drop, or reorder segments, even if that makes one run a little long or short.

Return ONLY this JSON shape, nothing else:
{"segments": ["...", "..."]}

Input segments (JSON array, in order):
${JSON.stringify(captions)}`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `ترجمه به ${languageName} ناموفق بود`);
  }

  let parsed;
  try {
    parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
  } catch {
    throw new Error(`پاسخ ترجمه‌ی ${languageName} یک JSON معتبر نبود`);
  }

  const segments = parsed.segments;
  if (!Array.isArray(segments) || segments.length !== captions.length) {
    throw new Error(
      `ترجمه‌ی ${languageName} تعداد بخش نامعتبر برگردوند (${
        Array.isArray(segments) ? segments.length : "نامعتبر"
      } به‌جای ${captions.length})`
    );
  }

  return segments;
}
