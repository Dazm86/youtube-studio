// src/lib/translateCaptions.js
//
// Translates the caption/segment texts (same ones used to build the English
// SRT) into another language via the configured "text" provider. Length/order
// must match the input exactly, since the translated text gets zipped back
// with the *same* `durations` array to build that language's SRT — a
// mismatched length would misalign every subtitle after the first difference.
//
// If the model returns the wrong segment count on the first try, we retry
// once with a stricter prompt (lower temperature, explicit warning) before
// giving up — same "give it one more focused shot" pattern used for the
// 8-minute script-length safety net in scriptGen.js.

import { generateText } from "./providers/router";

async function requestTranslation(captions, languageName, strict) {
  const strictNote = strict
    ? `\n\nIMPORTANT: a previous attempt returned the wrong number of segments. Double-check before answering: the output array must have exactly one entry per input entry, in the same order. Never merge two input segments into one output entry, never split one into two, never skip a short/odd-looking segment — translate every single one on its own.`
    : "";

  const prompt = `Translate this list of ${captions.length} video subtitle segments into ${languageName}. This is spoken narration from an energetic, warm host — translate for natural spoken tone in ${languageName}, not a stiff literal translation.

Critical: return EXACTLY ${captions.length} items, in the same order, each the translation of the input item at that same index. Never merge, split, drop, or reorder segments, even if that makes one run a little long or short.${strictNote}

Return ONLY this JSON shape, nothing else:
{"segments": ["...", "..."]}

Input segments (JSON array, in order):
${JSON.stringify(captions)}`;

  const rawText = await generateText({
    prompt,
    jsonMode: true,
    temperature: strict ? 0.1 : 0.3,
    maxTokens: 4000,
  });

  let parsed;
  try {
    parsed = JSON.parse(rawText);
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

export async function translateCaptions(captions, languageName) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await requestTranslation(captions, languageName, attempt > 1);
    } catch (err) {
      lastError = err;
      if (attempt === 1) {
        console.warn(
          `ترجمه‌ی ${languageName} بار اول شکست خورد (${err.message}) — یک تلاش دیگه با prompt سخت‌گیرانه‌تر...`
        );
      }
    }
  }
  throw lastError;
}
