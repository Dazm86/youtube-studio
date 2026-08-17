import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { getProviderById } from "@/lib/db";
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

  try {
    let text;
    if (providerId) {
      // کاربر provider خاصی انتخاب کرده — مستقیم از اون استفاده کن
      const provider = await getProviderById(providerId);
      if (!provider) {
        return NextResponse.json({ error: "ارائه‌دهنده پیدا نشد" }, { status: 404 });
      }
      const entry = REGISTRY[provider.service];
      if (!entry || !entry.adapters.text) {
        return NextResponse.json({ error: "این سرویس از تولید متن پشتیبانی نمی‌کنه" }, { status: 400 });
      }
      const apiKey = entry.noKeyNeeded ? null : resolveApiKey(provider);
      if (!entry.noKeyNeeded && !apiKey) {
        return NextResponse.json({ error: "کلید API در دسترس نیست" }, { status: 400 });
      }
      text = await entry.adapters.text({ apiKey, prompt, maxTokens, temperature, jsonMode });
    } else {
      // از روترِ پیش‌فرض (فیلتر→اولویت→فول‌بک) استفاده کن
      text = await generateText({ prompt, maxTokens, temperature, jsonMode });
    }

    if (!text || !text.trim()) {
      return NextResponse.json({ error: "پاسخ خالی دریافت شد" }, { status: 500 });
    }

    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    console.error("generate-text error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}