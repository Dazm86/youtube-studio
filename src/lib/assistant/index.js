// src/lib/assistant/index.js
//
// حلقه‌ی «agent» — کلاسیک: پیام رو به مدل می‌دیم، اگه مدل خواست یک
// ابزار صدا بزنه (tool_calls)، ابزار رو واقعاً اجرا می‌کنیم، نتیجه رو
// برمی‌گردونیم بهش، و دوباره می‌پرسیم — تا وقتی یک جوابِ متنیِ نهایی
// بده (یا سقفِ تلاش تموم بشه).
//
// چرا این تابع مستقیم به Groq وصله (نه از طریقِ providers/router.js:
// generateText که بقیه‌ی سایت استفاده می‌کنه): اون تابع برای fallback
// بینِ چند provider (Groq/OpenAI/Anthropic) طراحی شده، با یک امضای
// ساده‌ی «prompt → text». اینجا نیاز به چیزیِ متفاوته: تاریخچه‌ی کاملِ
// پیام‌ها (نه یک prompt تکی) + پارامترِ tools + پردازشِ tool_calls —
// چیزی که هر provider شکلِ دقیقاً یکسانی براش نداره. چون Groq (با مدلِ
// همینِ الان‌مون (openai/gpt-oss-120b) رسماً از tool calling
// پشتیبانی می‌کنه (تأییدشده از مستنداتِ خودِ Groq، ۲۰۲۶-۰۹-۱۶) و همین
// الان provider اصلیِ متنِ کلِ سایته، این نسخه فقط رویِ Groq کار می‌کنه —
// اگه Groq تنظیم نشده باشه، دستیار به‌جای fallback به یک provider دیگه
// (که shape تفاوت داره)، پیامِ خطایِ واضح می‌ده.

import { getProvidersForCapability } from "../db/index.js";
import { resolveApiKey } from "../providers/router.js";
import { TOOLS, TOOL_EXECUTORS } from "./tools.js";

const GROQ_MODEL = "openai/gpt-oss-120b";
const MAX_TOOL_ROUNDS = 5;

async function getGroqApiKey() {
  const providers = await getProvidersForCapability("text");
  const groqEntry = providers.find((p) => p.service === "groq");
  if (!groqEntry) {
    throw new Error("Groq تنظیم نشده — اول از صفحه‌ی «ارائه‌دهنده‌های API» یک کلیدِ Groq برایِ «متن» اضافه کن.");
  }
  const apiKey = resolveApiKey(groqEntry);
  if (!apiKey) throw new Error("کلیدِ Groq در دسترس نیست.");
  return apiKey;
}

const SYSTEM_PROMPT = `تو دستیارِ داخلیِ سایتِ استودیوی یوتیوبِ کانالِ "The Mindful Path" هستی. به داده‌های واقعیِ سایت (ویدیوها و آمارشون، زمان‌بندیِ آپلودِ خودکار، موضوعاتِ ترند، لاگِ فعالیت) و مخزنِ گیت‌هابِ خودِ پروژه (commit های اخیر، اجراهایِ GitHub Actions) از طریقِ ابزارهای در دسترس دسترسی داری.

قوانین:
- برای هر سوالی که جواب دقیقش تو یکی از این داده‌هاست، حتماً ابزارِ مربوطه رو صدا بزن — هیچ‌وقت عدد، وضعیت، یا تاریخ رو حدس نزن یا از خودت نساز.
- اگه یک ابزار خطا داد یا داده‌ای برنگردوند، همینو صادقانه به کاربر بگو؛ وانمود نکن که جواب داری.
- جواب‌ها رو کوتاه، دقیق، و به فارسی بده — بدونِ مقدمه‌چینیِ اضافه.
- اگه سوال خارج از حیطه‌ی این سایت/پروژه‌ست (مثلاً یک سوالِ عمومی بی‌ربط)، مودبانه بگو که فقط درباره‌ی همین سایت/پروژه می‌تونی کمک کنی.`;

async function callGroq(apiKey, messages) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      tools: TOOLS,
      temperature: 0.4,
      max_tokens: 1500,
      // همون نکته‌ای که تو groqTextRaw هست: مدلِ reasoning، بدونِ این
      // ممکنه کل بودجه‌ی توکن صرفِ فکرکردنِ پنهان بشه و content خالی
      // برگرده.
      reasoning_effort: "low",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "خطای Groq");
  return data.choices?.[0]?.message;
}

// conversationHistory: آرایه‌ای از {role: "user"|"assistant", content: string}
// — تاریخچه‌ی کاملِ گفتگو، از سمتِ کلاینت نگه‌داشته و هر بار کامل
// فرستاده می‌شه (خودِ این تابع و route اش stateless ان، چیزی بینِ
// درخواست‌ها تو سرور ذخیره نمی‌شه).
export async function runAssistantChat(conversationHistory) {
  const apiKey = await getGroqApiKey();
  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...conversationHistory];
  const toolCallsUsed = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const message = await callGroq(apiKey, messages);
    if (!message) throw new Error("پاسخِ نامعتبر از Groq");
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { reply: message.content || "", toolCallsUsed };
    }

    for (const toolCall of message.tool_calls) {
      const fnName = toolCall.function?.name;
      const executor = TOOL_EXECUTORS[fnName];
      let resultText;
      let args = {};
      try {
        args = JSON.parse(toolCall.function?.arguments || "{}");
        const result = executor ? await executor(args) : { error: `ابزارِ ناشناخته: ${fnName}` };
        resultText = JSON.stringify(result);
      } catch (err) {
        resultText = JSON.stringify({ error: err.message });
      }
      toolCallsUsed.push({ name: fnName, args });
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: resultText });
    }
  }

  return {
    reply: "بعدِ چند تلاش نتونستم به یک جوابِ قطعی برسم — لطفاً سوال رو ساده‌تر یا دقیق‌تر بپرس.",
    toolCallsUsed,
  };
}
