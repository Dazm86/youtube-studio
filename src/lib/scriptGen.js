import { getRecentVideoTitles } from "./channelHistory";
import { getTopPerformingVideos } from "./db";
import { generateText } from "./providers/router";

// این تابع دقیقاً همون منطقِ api/generate-script/route.js هست، فقط از
// یک route جدا شده تا هم مسیر تعاملی (کاربر تو UI دکمه می‌زنه) و هم
// زمان‌بند خودکار (بدون هیچ درخواست HTTP/کاربری) بتونن صداش بزنن.
export async function generateScript({ topic, mode, accessToken }) {
  const isShort = mode === "short";

  let topicInstruction;
  if (topic && topic.trim()) {
    topicInstruction = `The topic/theme for this video is: "${topic.trim()}"`;
  } else {
    const recentTitles = await getRecentVideoTitles(accessToken, 15);
    const avoidList =
      recentTitles.length > 0
        ? `\n\nVideos already published on this channel (do NOT repeat these topics or angles, pick something genuinely different):\n${recentTitles
            .map((t) => `- ${t}`)
            .join("\n")}`
        : "";
    topicInstruction = `Pick a fresh, specific mindfulness or motivational theme yourself (avoid generic or overused topics like just "gratitude" or "believe in yourself" on their own — find a specific angle or story-like framing).${avoidList}`;
  }

  const structureInstruction = isShort
    ? `Write a spoken narration script for a short video (30-60 seconds when read aloud, roughly 90-130 words), structured in four beats:
1. Hook (first ~3 seconds): one line that immediately grabs attention — a surprising claim, a "you've probably felt this" moment, or a direct question.
2. Empathy (next ~10 seconds): show you understand the viewer's struggle, in their own words.
3. Insight (next ~30 seconds): the core reframe or unexpected angle — the heart of the video, not just a slogan.
4. Closing (final ~15-20 seconds): end with one specific, personal question tied directly to this video's topic, then explicitly invite viewers to answer in the comments (in the spirit of: "What's a memory you can't seem to shake? Tell me in the comments." — always reworded and specific to this video's actual topic, never a generic "what do you think?"). Not a call to subscribe.`
    : `Write a spoken narration script for a long-form video that MUST run past the 8-minute mark when read aloud — target 1200-1500 words, never fewer than 1200. Structure it around 3-4 deep sub-sections that each get real room to breathe (a few hundred words each, packed with concrete detail — this is a deep dive, not a quick overview):
1. Hook + Root Cause: open with a question or short story that pulls the viewer in, then dig into WHY this problem actually happens — the real, underlying cause most people never examine.
2. Symptoms / How It Shows Up: describe, specifically and relatably, how this plays out in someone's actual daily life — enough detail that the viewer recognizes themselves in it.
3. Real Story: one real-feeling story, experience, or scenario — a specific character or moment, not an abstraction — that makes it concrete.
4. Actionable Steps: 3-5 concrete, specific steps the viewer can actually take, each explained enough to be genuinely useful, not just listed in passing.
Close with a brief, inspiring wrap-up that invites reflection, then end with one specific, personal question tied directly to this video's topic, explicitly inviting viewers to share their answer in the comments (in the spirit of: "What's a memory you can't seem to shake? Let me know in the comments." — always reworded and specific to this video's actual topic, never a generic "what do you think?"). Not just a request to subscribe.
Vary sentence rhythm so it doesn't feel repetitive over the longer length. Do not rush any section to hit a shorter length — if a section feels thin, expand it with more concrete detail, examples, or explanation rather than moving on early.`;

  // حلقه‌ی بازخورد: بهترین ویدیوهای قبلی از نظر نگه‌داشت مخاطب (اگه داده‌ای
  // باشه) — فقط جمله‌ی اول هرکدوم رو می‌فرستیم، نه کل اسکریپت، تا هزینه‌ی
  // پرامپت زیاد نشه.
  let feedbackContext = "";
  try {
    const topVideos = await getTopPerformingVideos(5);
    if (topVideos.length > 0) {
      const examples = topVideos
        .map((v) => {
          const opener = (v.script || "").trim().split(/(?<=[.!?])\s+/).slice(0, 1).join(" ");
          return `- "${v.title}" (${Math.round(v.retention_pct)}% average retention) opened with: "${opener}"`;
        })
        .join("\n");
      feedbackContext = `\n\nThis channel's best-performing past videos by audience retention — notice what kind of opening/angle earns attention, and let that instinct guide you (never copy these lines):\n${examples}\n`;
    }
  } catch (err) {
    console.error("feedback loop lookup failed (continuing without it):", err.message);
  }

  const prompt = `You are the scriptwriter for Maya, the host of a YouTube channel called "The Mindful Path". This is insight and personal-growth content, not pure entertainment — viewers come for a feeling, an idea, or a shift in perspective, so every script should follow the arc: STORY -> EMOTION -> INSIGHT -> ACTION.

Maya's personality: energetic and inspiring. She talks like she genuinely can't wait to tell you this — real excitement, not forced hype. Short, punchy sentences. She reacts to her own points as she says them (a little surprise, a laugh in the phrasing) instead of stating things flatly. She speaks directly to "you", and calls the viewer "friend" sometimes, naturally, never stiffly.

Give her a few recurring verbal habits so she feels like a consistent host, not a generic narrator — but reword them fresh each time so nothing ever feels copy-pasted between videos:
- Swinging into the big idea, in the spirit of (don't reuse verbatim): "Okay, here's the part that changes everything." / "But here's the thing nobody tells you." / "Ready? Because this one's good."
- A short reactive aside here and there, in the spirit of: "I know, right?" / "Stay with me." / "Yes — really."
- A punchy, energizing sign-off, in the spirit of: "Go be unstoppable, friend." — always reworded, never the same line twice.
Use at most two of these habits in one script — enough to feel like her, not so many it feels gimmicky.
${feedbackContext}
${topicInstruction}

${structureInstruction}

Requirements:
- Plain spoken English text only. No titles, no headers, no stage directions, no markdown, no emojis, no beat labels like "Hook:" or "Insight:" — just the flowing narration itself.
- Written in first person as Maya.
- The very first sentence must be a strong hook: a surprising statement, a relatable "you've probably felt this" moment, or a direct question — something that makes someone stop scrolling in the first 3 seconds. Do not start with a slow or generic opener like "I want to share something with you."
- Introduce something new roughly every 20-30 seconds of spoken time — a new question, a real example, an impactful line, or a clear beat change — so the script never idles on one point too long.
- Never use standalone generic motivational clichés ("just believe in yourself", "never give up", "you can do anything") without a story, reason, or concrete example behind them.
- Do not repeat the same idea twice.

Respond with ONLY the narration text itself, nothing else.`;

  const script = await generateText({
    prompt,
    temperature: 1,
    maxTokens: isShort ? 400 : 3000,
  });

  return { script };
}
