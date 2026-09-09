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

// ۲۰۲۶-۰۹-۰۸ — generateCommunityPost بالا همیشه دقیقاً بعدِ آپلودِ یک
// ویدیوی خاص صدا زده می‌شه (یک پست، تیدِ همون ویدیو). این تابعِ جدا برای
// یک نیازِ متفاوته: پرکردنِ فاصله‌ی *بینِ* آپلودها با یک تِم/موضوعِ کلی
// (نه یک ویدیویِ خاص) — برای همین یک videoId نمی‌گیره و نتیجه‌ش تو
// community_posts ذخیره نمی‌شه (اون جدول video_id رو NOT NULL می‌خواد؛
// اینجا اصلاً ویدیویی درکار نیست) — فقط پیش‌نویس رو برمی‌گردونه تا کاربر
// خودش کپی/پیست کنه، دقیقاً مثلِ همون فلسفه‌ی بالا.
export async function generateThemedCommunityPosts({ theme }) {
  const prompt = `You write Community Tab posts for a YouTube mindfulness channel called "The Mindful Path", hosted by Maya (energetic, warm personality). This channel makes short and long-form videos about practical psychology and mental habits.

I need 3 distinct Community Tab posts to keep engagement going BETWEEN video uploads, all loosely tied to this theme:
Theme: "${theme}"

Generate exactly 3 posts, one of each format:
1. POLL: a short, genuinely curious 4-option poll testing viewers on a relatable mental habit tied to the theme.
2. DISCUSSION: a thought-provoking, low-friction open question asking viewers to share a quick experience related to the theme — easy to answer in a few words.
3. TEASER: a 2-sentence bite-sized tip from Maya, ending with a soft teaser for an upcoming video (without naming a specific title, since none exists yet).

Respond with ONLY this JSON shape, nothing else:
{"poll": {"text": "...", "options": ["...", "...", "...", "..."], "visual": "..."}, "discussion": {"text": "...", "visual": "..."}, "teaser": {"text": "...", "visual": "..."}}

Rules:
- Each "text": under 200 characters, in Maya's warm/energetic voice, first person where natural.
- poll.options: exactly 4 short entries (each under 5 words).
- "visual": one short bracketed-style suggestion (a few words) for an image/graphic to pair with that post — e.g. "soft gradient background with a single quote card", "simple 4-icon poll graphic".
- Never mention "link in bio", "swipe up", or generic engagement-bait phrases ("comment below", "like this post") — let the content itself invite interaction.`;

  const rawText = await generateText({ prompt, jsonMode: true, temperature: 0.8, maxTokens: 800 });

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("پاسخ پست‌های تمِ کامیونیتی یک JSON معتبر نبود");
  }

  return {
    poll: {
      postType: "poll",
      postText: parsed.poll?.text || "",
      pollOptions: Array.isArray(parsed.poll?.options) ? parsed.poll.options : [],
      visual: parsed.poll?.visual || "",
    },
    discussion: {
      postType: "discussion",
      postText: parsed.discussion?.text || "",
      visual: parsed.discussion?.visual || "",
    },
    teaser: {
      postType: "teaser",
      postText: parsed.teaser?.text || "",
      visual: parsed.teaser?.visual || "",
    },
  };
}
