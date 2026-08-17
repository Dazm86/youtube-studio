import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { getProviderById } from "@/lib/db";
import { fetchClips, resolveApiKey } from "@/lib/providers/router";
import { REGISTRY } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌ید" }, { status: 401 });
  }

  const { prompt, providerId, count, orientation } = await req.json();

  if (!prompt || !prompt.trim()) {
    return NextResponse.json({ error: "پرامپت لازمه" }, { status: 400 });
  }

  try {
    let result;
    if (providerId) {
      const provider = await getProviderById(providerId);
      if (!provider) {
        return NextResponse.json({ error: "ارائه‌دهنده پیدا نشد" }, { status: 404 });
      }
      const entry = REGISTRY[provider.service];
      if (!entry || !entry.adapters.video) {
        return NextResponse.json({ error: "این سرویس از جستجوی ویدیو پشتیبانی نمی‌کنه" }, { status: 400 });
      }
      const apiKey = entry.noKeyNeeded ? null : resolveApiKey(provider);
      if (!entry.noKeyNeeded && !apiKey) {
        return NextResponse.json({ error: "کلید API در دسترس نیست" }, { status: 400 });
      }
      result = await entry.adapters.video({ apiKey, text: prompt, keyword: "", count, orientation });
    } else {
      result = await fetchClips({ text: prompt, keyword: "", count, orientation });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("generate-video error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}