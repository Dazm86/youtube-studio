import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { getProviderById, recordProviderCheck } from "@/lib/db";
import { REGISTRY } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getResolveApiKey() {
  const { resolveApiKey } = await import("@/lib/providers/router");
  return resolveApiKey;
}

export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const provider = await getProviderById(id);
    if (!provider) {
      return NextResponse.json({ error: "provider پیدا نشد" }, { status: 404 });
    }
    const entry = REGISTRY[provider.service];
    if (!entry) {
      await recordProviderCheck(id, { ok: false, message: "سرویس ناشناخته" });
      return NextResponse.json({ ok: false, message: "سرویس ناشناخته" });
    }

    if (entry.noKeyNeeded) {
      await recordProviderCheck(id, { ok: true, message: "همیشه در دسترسه ✅" });
      return NextResponse.json({ ok: true, message: "همیشه در دسترسه ✅" });
    }

    const resolveApiKey = await getResolveApiKey();
    const apiKey = resolveApiKey(provider);
    if (!apiKey) {
      const msg = "کلیدی در دسترس نیست";
      await recordProviderCheck(id, { ok: false, message: msg });
      return NextResponse.json({ ok: false, message: msg });
    }

    const ok = await entry.detect(apiKey);
    const message = ok ? `اتصال برقراره ✅ — ${entry.label}` : "کلید معتبر نیست یا سرویس در دسترس نیست";
    await recordProviderCheck(id, { ok, message });
    return NextResponse.json({ ok, message });
  } catch (err) {
    await recordProviderCheck(id, { ok: false, message: err.message });
    return NextResponse.json({ ok: false, message: err.message });
  }
}
