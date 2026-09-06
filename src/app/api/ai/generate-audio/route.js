import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { getProviderById, logStudioActivity } from "@/lib/db";
import { synthesizeSpeech, resolveApiKey } from "@/lib/providers/router";
import { REGISTRY } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌ید" }, { status: 401 });
  }

  const { text, providerId, voice } = await req.json();

  if (!text || !text.trim()) {
    return NextResponse.json({ error: "متن لازمه" }, { status: 400 });
  }

  const startedAt = Date.now();
  let providerService = null;

  try {
    let result;
    if (providerId) {
      const provider = await getProviderById(providerId);
      if (!provider) {
        return NextResponse.json({ error: "ارائه‌دهنده پیدا نشد" }, { status: 404 });
      }
      providerService = provider.service;
      const entry = REGISTRY[provider.service];
      if (!entry || !entry.adapters.audio) {
        return NextResponse.json({ error: "این سرویس از تولید صدا پشتیبانی نمی‌کنه" }, { status: 400 });
      }
      const apiKey = entry.noKeyNeeded ? null : resolveApiKey(provider);
      if (!entry.noKeyNeeded && !apiKey) {
        return NextResponse.json({ error: "کلید API در دسترس نیست" }, { status: 400 });
      }
      result = await entry.adapters.audio({ apiKey, text, voice });
    } else {
      result = await synthesizeSpeech({ text, voice });
    }

    // Return base64 data URL for direct playback/download
    const base64 = result.buffer.toString("base64");
    const audioUrl = `data:${result.mimeType};base64,${base64}`;

    logStudioActivity({
      tool: "audio",
      providerService,
      ok: true,
      summary: `صدا — ~${Math.round(result.buffer.length / 1024).toLocaleString("fa-IR")} کیلوبایت`,
      durationMs: Date.now() - startedAt,
    }).catch((e) => console.error("logStudioActivity failed:", e.message));

    return NextResponse.json({
      audioUrl,
      mimeType: result.mimeType,
      size: result.buffer.length,
    });
  } catch (err) {
    console.error("generate-audio error:", err);
    logStudioActivity({
      tool: "audio",
      providerService,
      ok: false,
      summary: err.message,
      durationMs: Date.now() - startedAt,
    }).catch((e) => console.error("logStudioActivity failed:", e.message));
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}