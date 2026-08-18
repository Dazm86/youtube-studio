// نکته‌ی مهم: YouTube Data API v3 هیچ resource/endpoint عمومی‌ای برای
// پست کردن تو تب Community کانال نداره (نه communityPosts.insert، نه
// معادلش) — این یک محدودیتِ شناخته‌شده‌ی خودِ API عمومیِ یوتیوبه، نه
// چیزی که با تنظیمات یا اسکوپ OAuth بیشتر حل بشه. برای همین این ماژول
// فقط متنِ آماده (پست‌کردنی) رو با provider «متن»یِ فعال تولید می‌کنه؛
// روتِ کنارش (api/community-post) اون رو به‌عنوان پیش‌نویس ذخیره می‌کنه
// تا کاربر خودش با یک کپی‌پیست تو اپ یوتیوب منتشرش کنه.

import { generateText } from "../providers/router.js";

export async function generateCommunityPost({ title, script }) {
  const prompt = `You write Community Tab posts for a YouTube mindfulness channel called "The Mindful Path", hosted by Maya (energetic, warm personality).

A new video just went up:
Title: "${title}"
Script (for context only, don't quote it directly): """${(script || "").slice(0, 1200)}"""

Write ONE Community Tab post to drive engagement/watch-through on this video. Choose whichever of these two formats fits the topic better:
- A POLL: a short, genuinely curious question directly tied to the video's topic, with 2-4 short answer options (each under 5 words).
- A QUOTE: one short, original, quotable line (not from the script verbatim) that captures the video's core idea, written as something worth screenshotting.

Respond with ONLY this JSON shape, nothing else:
{"type": "poll" or "quote", "text": "...", "options": ["...", "..."] or null}

Rules:
- text: under 200 characters, in Maya's warm/energetic voice, first person where natural.
- If type is "poll", options must have 2-4 short entries. If type is "quote", options must be null.
- Never mention "link in bio", "swipe up", or generic engagement-bait phrases ("comment below", "like this post") — let the content itself invite interaction.`;

  const rawText = await generateText({ prompt, jsonMode: true, temperature: 0.8, maxTokens: 600 });

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("پاسخ پست کامیونیتی یک JSON معتبر نبود");
  }

  const postType = parsed.type === "poll" ? "poll" : "quote";
  return {
    postType,
    postText: parsed.text || "",
    pollOptions: postType === "poll" && Array.isArray(parsed.options) ? parsed.options : null,
  };
}
