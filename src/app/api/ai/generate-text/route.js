import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { getProviderById, logStudioActivity } from "@/lib/db";
import { generateText, resolveApiKey } from "@/lib/providers/router";
import { REGISTRY } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌ید" }, { status: 401 });
  }

  const { prompt, providerId, maxTokens, temperature, jsonMode } = await req.json();

  if (!prompt || !prompt.trim()) {
    return NextResponse.json({ error: "پرامپت لازمه" }, { status: 400 });
  }

  const startedAt = Date.now();
  let providerService = null;

  try {
    let text;
    let usage = null;
    if (providerId) {
      // کاربر provider خاصی انتخاب کرده — مستقیم از اون استفاده کن
      const provider = await getProviderById(providerId);
      if (!provider) {
        return NextResponse.json({ error: "ارائه‌دهنده پیدا نشد" }, { status: 404 });
      }
      providerService = provider.service;
      const entry = REGISTRY[provider.service];
      if (!entry || !entry.adapters.text) {
        return NextResponse.json({ error: "این سرویس از تولید متن پشتیبانی نمی‌کنه" }, { status: 400 });
      }
      const apiKey = entry.noKeyNeeded ? null : resolveApiKey(provider);
      if (!entry.noKeyNeeded && !apiKey) {
        return NextResponse.json({ error: "کلید API در دسترس نیست" }, { status: 400 });
      }
      // ۲۰۲۶-۰۹-۰۶ — وقتی adapter نسخه‌ی «raw» داره (توکن هم برمی‌گردونه)
      // ازش استفاده کن؛ وگرنه عیناً همون مسیرِ قدیمی.
      if (entry.adapters.textRaw) {
        const raw = await entry.adapters.textRaw({ apiKey, prompt, maxTokens, temperature, jsonMode });
        text = raw.text;
        usage = raw.usage;
      } else {
        text = await entry.adapters.text({ apiKey, prompt, maxTokens, temperature, jsonMode });
      }
    } else {
      // از روترِ پیش‌فرض (فیلتر→اولویت→فول‌بک) استفاده کن
      text = await generateText({ prompt, maxTokens, temperature, jsonMode });
    }

    if (!text || !text.trim()) {
      throw new Error("پاسخ خالی دریافت شد");
    }

    logStudioActivity({
      tool: "text",
      providerService,
      ok: true,
      summary: `متن — ${text.trim().length.toLocaleString("fa-IR")} نویسه`,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      durationMs: Date.now() - startedAt,
    }).catch((e) => console.error("logStudioActivity failed:", e.message));

    return NextResponse.json({ text: text.trim(), usage });
  } catch (err) {
    console.error("generate-text error:", err);
    logStudioActivity({
      tool: "text",
      providerService,
      ok: false,
      summary: err.message,
      durationMs: Date.now() - startedAt,
    }).catch((e) => console.error("logStudioActivity failed:", e.message));
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}