// src/lib/providers/registry.js
//
// «دفترچه‌ی» سرویس‌های شناخته‌شده. هر ورودی می‌گه یک سرویس چه قابلیت‌هایی
// داره (text/image/video/audio)، چطور می‌شه فهمید یک کلید مال همون
// سرویسه (detect — یک تماس سبک و رایگان/تقریباً‌رایگان)، و برای هر
// قابلیت چطور واقعاً باید صداش زد (adapters).
//
// افزودن یک سرویس جدید = یک ورودی جدید اینجا؛ بقیه‌ی سیستم (تشخیص خودکار،
// روتر، صفحه‌ی مدیریت) خودکار می‌شناستش.
//
// شکل مشترک خروجی هر adapter:
//   text:  رشته
//   audio: { buffer: Buffer, mimeType: string }
//   image/video: { query: string, images/clips: Array<string | {buffer: Buffer, ext: string}> }
//     — یعنی هر آیتم یا یک URL قابل‌دانلوده (سرویس‌های استوک مثل Pexels)
//     یا بایت خام (سرویس‌های تولیدکننده مثل OpenAI/Stability). videoRender.js
//     و mayaThumbnail.js هر دو شکل رو می‌فهمن.

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { extractKeywords } from "./textUtils.js";
import { pickMayaPose } from "../rendering/index.js";

const GROQ_TEXT_MODEL = "openai/gpt-oss-120b";
const OPENAI_TEXT_MODEL = "gpt-4o-mini";
const OPENAI_IMAGE_MODEL = "gpt-image-1";
const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const ANTHROPIC_TEXT_MODEL = "claude-sonnet-5";
const ELEVENLABS_MODEL = "eleven_multilingual_v2";
const ELEVENLABS_DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // یک صدای عمومیِ همیشه‌در‌دسترس؛ هر voice_id معتبر دیگه از حساب کاربر هم کار می‌کنه

// --- کمک‌کننده‌های مشترکِ عکس/کلیپِ استوک (منتقل‌شده از media.js قبلی) ---

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

function imagePromptFromQuery(query) {
  return `Cinematic, photo-realistic image representing: ${query}. Calm, warm, mindful aesthetic, soft natural light, high quality, no text, no watermark, no logos.`;
}

// ===================== متن (text) =====================

async function groqText({ apiKey, prompt, maxTokens, temperature, jsonMode }) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_TEXT_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: temperature ?? 1,
      max_tokens: maxTokens || 2000,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "خطای Groq");
  return (data?.choices?.[0]?.message?.content || "").trim();
}

async function openaiText({ apiKey, prompt, maxTokens, temperature, jsonMode }) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_TEXT_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: temperature ?? 1,
      max_tokens: maxTokens || 2000,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "خطای OpenAI");
  return (data?.choices?.[0]?.message?.content || "").trim();
}

async function anthropicText({ apiKey, prompt, maxTokens, temperature }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_TEXT_MODEL,
      max_tokens: maxTokens || 2000,
      temperature: temperature ?? 1,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "خطای Anthropic");
  return (data?.content || []).map((b) => b.text || "").join("").trim();
}

// ===================== عکس (image) =====================

async function pexelsImages({ apiKey, text, keyword, count, orientation }) {
  const perPage = Math.min(Math.max(parseInt(count) || 6, 1), 40);
  const { query, safeOrientation } = resolveQueryAndOrientation({ text, keyword, orientation });
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=${safeOrientation}`,
    { headers: { Authorization: apiKey } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "خطا در دریافت عکس از Pexels");
  const images = (data.photos || []).map((p) => ({ path: p.src.large2x }));
  if (images.length === 0) throw new Error("عکسی برای این موضوع پیدا نشد");
  return { query, images };
}

async function pexelsClips({ apiKey, text, keyword, count, orientation }) {
  const perPage = Math.min(Math.max(parseInt(count) || 6, 1), 30);
  const { query, safeOrientation } = resolveQueryAndOrientation({ text, keyword, orientation });
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=${safeOrientation}`,
    { headers: { Authorization: apiKey } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "خطا در دریافت کلیپ از Pexels");
  const clips = (data.videos || [])
    .map((v) => pickVideoFile(v.video_files, safeOrientation === "portrait"))
    .filter(Boolean)
    .map((f) => ({ path: f.link, durationSec: f.duration }));
  if (clips.length === 0) throw new Error("کلیپی برای این موضوع پیدا نشد");
  return { query, clips };
}

// تولید عکس با OpenAI (gpt-image-1) — همیشه base64 برمی‌گردونه، هیچ‌وقت URL.
// هر تماس تا ۱۰ تا عکس می‌ده (سقف خودِ API)؛ برای count بیشتر چند تماس
// پشت‌سرهم می‌زنیم، با یک سقف منطقی که هزینه/زمان از کنترل خارج نشه.
async function openaiImages({ apiKey, text, keyword, count, orientation }) {
  const { query, safeOrientation } = resolveQueryAndOrientation({ text, keyword, orientation });
  const size = safeOrientation === "portrait" ? "1024x1536" : "1536x1024";
  const total = Math.min(Math.max(parseInt(count) || 1, 1), 24);
  const images = [];
  while (images.length < total) {
    const n = Math.min(10, total - images.length);
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: OPENAI_IMAGE_MODEL,
        prompt: imagePromptFromQuery(query),
        n,
        size,
        quality: "medium",
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || "خطای تولید عکس OpenAI");
    for (const item of data.data || []) {
      if (item.b64_json) images.push({ buffer: Buffer.from(item.b64_json, "base64"), ext: "png" });
      else if (item.url) images.push({ path: item.url });
    }
    if (!data.data || data.data.length === 0) break; // جلوی حلقه‌ی بی‌نهایت
  }
  if (images.length === 0) throw new Error("عکسی از OpenAI برنگشت");
  return { query, images };
}

// تولید عکس با Stability AI (Stable Image Core) — هر تماس دقیقاً یک عکس
// می‌ده، پس برای count بیشتر پشت‌سرهم صدا می‌زنیم (با سقف، چون هر تماس
// هزینه/زمان واقعی داره).
async function stabilityImages({ apiKey, text, keyword, count, orientation }) {
  const { query, safeOrientation } = resolveQueryAndOrientation({ text, keyword, orientation });
  const aspectRatio = safeOrientation === "portrait" ? "9:16" : "16:9";
  const total = Math.min(Math.max(parseInt(count) || 1, 1), 12);
  const images = [];
  for (let i = 0; i < total; i++) {
    const form = new FormData();
    form.append("prompt", imagePromptFromQuery(query));
    form.append("aspect_ratio", aspectRatio);
    form.append("output_format", "jpeg");
    const res = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "image/*" },
      body: form,
    });
    if (!res.ok) {
      let msg = "خطای تولید عکس Stability AI";
      try {
        const d = await res.json();
        msg = d?.errors?.[0] || d?.message || msg;
      } catch {}
      throw new Error(msg);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    images.push({ buffer, ext: "jpg" });
  }
  return { query, images };
}

// ===================== ویدیوی کلیپ (video) =====================
// فعلاً فقط استوک‌سرچ (Pexels) رو پشتیبانی می‌کنیم. سرویس‌های تولید ویدیوی
// واقعی (Runway/Pika/Luma/Kling و...) کارشون async و job-polling هست —
// دقیقه‌ها طول می‌کشه و با محدودیت رم/timeout همین پروژه (Render free tier)
// جور درنمیاد. زیرساخت طوری طراحی شده که بعداً یک آداپتور video جدید
// اضافه کردن فقط یعنی یک ورودی جدید تو REGISTRY، بدون تغییر جای دیگه —
// ولی خودِ آداپتور امروز نوشته نشده، تا یک چیز نصفه‌کاره/شکننده قالب نشه.

// ===================== صدا (audio) =====================

// msedge-tts فقط دو حالت voice داره که اینجا استفاده می‌شن — نه بر اساسِ
// یک provider دیگه، فقط پیش‌فرضِ خودِ msedge-tts وقتی caller صراحتاً
// voice نخواسته. بر اساسِ حال‌وهوای غالبِ متن (همون امتیازدهیِ
// pickMayaPose که برای تامبنیل/BGM هم استفاده می‌شه، پس سیگنالِ همه‌جا
// یکیه) بینِ دو صدای msedge-tts متفاوت انتخاب می‌شه — نه یک صدای ثابت
// برای همه‌ی ویدیوها.
const CALM_TTS_MOODS = new Set(["meditating", "caring", "thinking", "surprised"]);

async function msedgeTts({ text, voice }) {
  const resolvedVoice =
    voice || (CALM_TTS_MOODS.has(pickMayaPose()(text)) ? "en-US-JennyNeural" : "en-US-AriaNeural");
  const tts = new MsEdgeTTS();
  await tts.setMetadata(resolvedVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(text);
  const chunks = [];
  for await (const chunk of audioStream) chunks.push(chunk);
  return { buffer: Buffer.concat(chunks), mimeType: "audio/mpeg" };
}

async function openaiTts({ apiKey, text, voice }) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      input: text,
      voice: voice || "alloy",
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    let msg = "خطای صدای OpenAI";
    try {
      const d = await res.json();
      msg = d?.error?.message || msg;
    } catch {}
    throw new Error(msg);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType: "audio/mpeg" };
}

async function elevenlabsTts({ apiKey, text, voice }) {
  const voiceId = voice || ELEVENLABS_DEFAULT_VOICE;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey, Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL }),
  });
  if (!res.ok) {
    let msg = "خطای صدای ElevenLabs";
    try {
      const d = await res.json();
      msg = d?.detail?.message || d?.detail || msg;
    } catch {}
    throw new Error(msg);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType: "audio/mpeg" };
}

// ===================== تشخیص خودکار سرویس (detect) =====================
// هر کدوم یک تماسِ سبک/ارزون که فقط می‌گه «این کلید معتبرِ همین سرویسه یا نه».

async function probeGroq(apiKey) {
  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return res.ok;
}

async function probeOpenAI(apiKey) {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return res.ok;
}

async function probeAnthropic(apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  return res.ok;
}

async function probeElevenLabs(apiKey) {
  const res = await fetch("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": apiKey },
  });
  return res.ok;
}

async function probeStability(apiKey) {
  const res = await fetch("https://api.stability.ai/v1/user/account", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return res.ok;
}

async function probePexels(apiKey) {
  const res = await fetch("https://api.pexels.com/v1/search?query=test&per_page=1", {
    headers: { Authorization: apiKey },
  });
  return res.ok;
}

// ===================== دفترچه‌ی اصلی =====================

export const REGISTRY = {
  groq: {
    label: "Groq",
    capabilities: ["text"],
    detect: probeGroq,
    adapters: { text: groqText },
  },
  openai: {
    label: "OpenAI",
    capabilities: ["text", "image", "audio"],
    detect: probeOpenAI,
    adapters: { text: openaiText, image: openaiImages, audio: openaiTts },
  },
  anthropic: {
    label: "Anthropic (Claude)",
    capabilities: ["text"],
    detect: probeAnthropic,
    adapters: { text: anthropicText },
  },
  elevenlabs: {
    label: "ElevenLabs",
    capabilities: ["audio"],
    detect: probeElevenLabs,
    adapters: { audio: elevenlabsTts },
  },
  stability: {
    label: "Stability AI",
    capabilities: ["image"],
    detect: probeStability,
    adapters: { image: stabilityImages },
  },
  pexels: {
    label: "Pexels",
    capabilities: ["image", "video"],
    detect: probePexels,
    adapters: { image: pexelsImages, video: pexelsClips },
  },
  "msedge-tts": {
    label: "msedge-tts (رایگان، بدون کلید)",
    capabilities: ["audio"],
    noKeyNeeded: true,
    adapters: { audio: msedgeTts },
  },
};

export const TASK_LABELS = {
  text: "متن (اسکریپت، عنوان، ترجمه، پست کامیونیتی)",
  image: "عکس",
  video: "ویدیوی کلیپ",
  audio: "صدا (تبدیل متن به گفتار)",
};

export const KNOWN_SERVICES = Object.keys(REGISTRY).filter((id) => !REGISTRY[id].noKeyNeeded);

// اول با هم/موازی همه‌ی سرویس‌های شناخته‌شده رو امتحان می‌کنه (سریع‌تر از
// پشت‌سرهم)، اولین تطابق موفق رو برمی‌گردونه. اگه هیچ‌کدوم جواب نداد،
// service:'unknown' برمی‌گرده تا کاربر خودش دستی مشخص کنه.
export async function detectService(apiKey) {
  const candidates = Object.entries(REGISTRY).filter(([, entry]) => entry.detect);
  const results = await Promise.allSettled(
    candidates.map(([id, entry]) => entry.detect(apiKey).then((ok) => ({ id, ok })))
  );
  const matched = results.find((r) => r.status === "fulfilled" && r.value.ok);
  if (matched) {
    const id = matched.value.id;
    return { service: id, capabilities: REGISTRY[id].capabilities };
  }
  return { service: "unknown", capabilities: [] };
}
