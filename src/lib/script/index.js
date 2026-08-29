import { getRecentVideoTitles } from "../utils/channelHistory.js";
import { getTopPerformingVideos } from "../db/index.js";
import { generateText } from "../providers/router.js";

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
4. Closing (final ~15-20 seconds): end with one specific, personal question tied directly to this video's topic, then explicitly invite viewers to answer in the comments (in the spirit of: "What's a memory you can't seem to shake? Tell me in the comments." — always reworded and specific to this video's actual topic, never a generic "what do you think?" — the easier it is to answer in just a few words, the better, since friction kills comments). Woven into that same closing breath (not a separate beat), add one quick, natural nudge toward subscribing — never the bare phrase "like and subscribe"; instead make the viewer feel they'd be missing something specific if they scrolled past, not that they'd be doing Maya a favor (e.g. hinting this is one piece of something ongoing). One clause is enough — it should feel like part of the goodbye, not an ad break. Additionally, land the very last line on a word, phrase, or image that echoes the opening hook (not a literal repeat of the same sentence — a callback that makes the ending loop back into the beginning), so a viewer who watches on repeat feels the video connect into itself rather than just stopping.`
    : `Write a spoken narration script for a long-form video that MUST run past the 8-minute mark when read aloud — target 1200-1500 words, never fewer than 1200. Structure it around 3-4 deep sub-sections that each get real room to breathe (a few hundred words each, packed with concrete detail — this is a deep dive, not a quick overview):
1. Hook + Root Cause: open with a question or short story that pulls the viewer in, then dig into WHY this problem actually happens — the real, underlying cause most people never examine.
2. Symptoms / How It Shows Up: describe, specifically and relatably, how this plays out in someone's actual daily life — enough detail that the viewer recognizes themselves in it.
3. Real Story: one real-feeling story, experience, or scenario — a specific character or moment, not an abstraction — that makes it concrete.
4. Actionable Steps: 3-5 concrete, specific steps the viewer can actually take, each explained enough to be genuinely useful, not just listed in passing.
Close with a brief, inspiring wrap-up that invites reflection, then end with one specific, personal question tied directly to this video's topic, explicitly inviting viewers to share their answer in the comments (in the spirit of: "What's a memory you can't seem to shake? Let me know in the comments." — always reworded and specific to this video's actual topic, never a generic "what do you think?" — the easier it is to answer in a few words, the better). Somewhere in that same closing, weave in ONE reason to subscribe that makes the viewer feel it's for THEM, not a favor to the channel — pick whichever fits this video best, reworded fresh every time, never the bare phrase "like and subscribe":
  (a) tease something specific and concrete coming in a future video that this one sets up, so subscribing means not missing the next piece;
  (b) name the kind of person who needs this channel ("if you're someone who's tired of X, this is where you belong") so subscribing feels like joining something, not doing a favor;
  (c) speak to an ongoing relationship ("I'll be here every week working through this with you") rather than a one-time transaction.
Choose ONE, keep it to a sentence or two, and it must feel like a continuation of her voice, not a tonal shift into ad-read mode.
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

Maya's personality: energetic and inspiring. She talks like she genuinely can't wait to tell you this — real excitement, not forced hype. Short, punchy sentences — when a point really needs to land, break it down into quick 3-5 word bursts instead of one long flowing sentence, so the pacing itself feels alive. She reacts to her own points as she says them (a little surprise, a laugh in the phrasing) instead of stating things flatly. She speaks directly to "you", and calls the viewer "friend" sometimes, naturally, never stiffly.

Give her a few recurring verbal habits so she feels like a consistent host, not a generic narrator — but reword them fresh each time so nothing ever feels copy-pasted between videos:
- Swinging into the big idea, in the spirit of (don't reuse verbatim): "Okay, here's the part that changes everything." / "But here's the thing nobody tells you." / "Ready? Because this one's good."
- A short reactive aside here and there, in the spirit of: "I know, right?" / "Stay with me." / "Yes — really."
- A brief personal self-disclosure right in the empathy beat, in the spirit of (don't reuse verbatim): "I've been exactly there." / "I used to feel this every single night." / "This one's personal for me too." — makes the empathy feel lived, not observed from the outside.
- A punchy, energizing sign-off, in the spirit of: "Go be unstoppable, friend." — always reworded, never the same line twice.
Use at most two of these habits in one script — enough to feel like her, not so many it feels gimmicky.
${feedbackContext}
${topicInstruction}

${structureInstruction}

Requirements:
- Plain spoken English text only. No titles, no headers, no stage directions, no markdown, no emojis, no beat labels like "Hook:" or "Insight:" — just the flowing narration itself.
- Written in first person as Maya.
- The very first sentence must be a strong hook: a surprising statement, a relatable "you've probably felt this" moment, or a direct question — something that makes someone stop scrolling in the first 3 seconds. Do not start with a slow or generic opener like "I want to share something with you."
- Whatever the hook promises, the Insight section must concretely deliver it. If the hook implies an answer, a method, or a fix, state that specific thing plainly somewhere in the middle — not just related musing around it. A viewer should be able to say, in one plain sentence, exactly what they learned or walked away with; if they can't, the script hasn't actually delivered on its own opening.
- Match the emotional weight of the delivery to the actual size of the idea. A small, simple, practical insight should sound warm and clear, not epic or heavy — save the bigger emotional swings (the "this changes everything" register) for ideas that genuinely earn it. Overplaying a small point reads as forced, not inspiring.
- Introduce something new roughly every 20-30 seconds of spoken time — a new question, a real example, an impactful line, or a clear beat change — so the script never idles on one point too long.
- Never use standalone generic motivational clichés ("just believe in yourself", "never give up", "you can do anything") without a story, reason, or concrete example behind them.
- Do not repeat the same idea twice.
- When explaining an internal/emotional state (not in every script, just where it genuinely fits), reach for one concrete nature or sensory image instead of an abstract label — a storm instead of "overwhelmed", roots holding through wind instead of "resilience", a river finding its way around a rock instead of "adapting". Use this occasionally, as a seasoning, never forced into a script where it doesn't naturally fit.

Respond with ONLY the narration text itself, nothing else.`;

  let script = await generateText({
    prompt,
    temperature: 1,
    // قبلاً ۴۰۰ بود — با مدلِ reasoning جدید (gpt-oss-120b، از ۲۰۲۶-۰۸-۱۸)
    // حتی با reasoning_effort="low" یه مقدار توکن صرفِ فکرکردنِ پنهان
    // می‌شه؛ ۷۰۰ برای یک اسکریپتِ ۹۰-۱۳۰ کلمه‌ای (~۱۵۰-۲۰۰ توکن) حاشیه‌ی
    // امنِ کافی می‌ذاره تا content خالی برنگرده.
    maxTokens: isShort ? 700 : 3000,
  });

  // شبکه‌ی ایمنیِ کیفیت: طول + تنوعِ شروعِ جمله + وجودِ حداقل یک مثال/عددِ
  // مشخص (نه صرفاً کلیاتِ انگیزشی). پرامپتِ بالا صراحتاً هرسه‌تا رو
  // می‌خواد، ولی مدل‌ها گاهی ازش کوتاه میان — این‌جا فقط تشخیص می‌دیم، نه
  // اصلاحِ دستی؛ اگه هرکدوم افتاد، یک تلاشِ دومِ صریح‌تر (با تأکید روی
  // همونی که افتاده) امتحان می‌کنیم و با همون نتیجه (حتی اگه بازم افتاد)
  // ادامه می‌دیم — کل پایپ‌لاین رو به‌خاطرِ یک شرطِ نرم متوقف نمی‌کنیم.
  const wordCount = () => script.trim().split(/\s+/).filter(Boolean).length;

  // جمله‌ها رو با یک split سبک (نه یک پارسرِ کامل) جدا می‌کنیم؛ برای
  // تشخیصِ الگو کافیه، نیازی به دقتِ زبان‌شناسیِ کامل نیست.
  function startsWithIOrYouShare(text) {
    const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length < 4) return 0; // اسکریپتِ خیلی کوتاه، این چک بی‌معنیه
    const iOrYouCount = sentences.filter((s) => /^(I|You)\b/i.test(s)).length;
    return iOrYouCount / sentences.length;
  }
  function hasConcreteExample(text) {
    // یا یه عددِ مشخص (حداقل یکی/دو رقم یا یه عددِ نوشته‌شده با کلمه) یا
    // عبارت‌های رایجِ معرفیِ مثال/داستانِ واقعی.
    return (
      /\b\d{1,3}(,\d{3})*(\.\d+)?\b/.test(text) ||
      /\b(one|two|three|four|five|six|seven|first|second|third)\b/i.test(text) ||
      /\b(for example|for instance|like the time|I remember when|one day|last (week|month|year))\b/i.test(text)
    );
  }

  if (!isShort) {
    const starterShare = startsWithIOrYouShare(script);
    const hasExample = hasConcreteExample(script);
    const tooShort = wordCount() < 1150;
    const issues = [];
    if (tooShort) issues.push(`طول کافی نیست (فقط ~${wordCount()} کلمه، حداقل ۱۲۰۰+ لازمه)`);
    if (starterShare > 0.6)
      issues.push(`بیش‌ازحد جمله‌ها با "I"/"You" شروع می‌شن (${Math.round(starterShare * 100)}٪) — تنوعِ ساختارِ جمله کمه`);
    if (!hasExample) issues.push("هیچ عدد/مثال/رویدادِ مشخصی نداره — بیش‌ازحد کلی و انتزاعیه");

    if (issues.length > 0) {
      console.warn(`generateScript: اولین پیش‌نویس مشکل داشت (${issues.join("؛ ")}) — یک تلاشِ دومِ صریح‌تر`);
      script = await generateText({
        prompt: `${prompt}\n\nIMPORTANT — your previous draft had these specific problems, fix ALL of them in this rewrite:\n${issues
          .map((s) => `- ${s}`)
          .join("\n")}\nThe absolute length requirement is 1200+ words. Vary how sentences start — not every sentence should begin with "I" or "You". Include at least one specific number, concrete example, or real story detail, not just general motivational statements.`,
        temperature: 1,
        maxTokens: 3000,
      });
      if (wordCount() < 1150) {
        console.warn(`generateScript: تلاشِ دوم هم کوتاه موند (~${wordCount()} کلمه) — با همین ادامه می‌دیم`);
      }
    }
  }

  return { script };
}
