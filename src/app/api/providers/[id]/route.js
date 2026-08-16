import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { updateProvider, deleteProvider } from "@/lib/db";
import { REGISTRY } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

export async function PUT(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }
  const { id } = await params;
  const { name, service, apiKey, capabilities, enabled } = await req.json();

  if (service && !REGISTRY[service]) {
    return NextResponse.json({ error: "سرویس ناشناخته" }, { status: 400 });
  }

  try {
    // اگه کاربر نوع سرویس رو دستی عوض/تعیین کرد، قابلیت‌ها رو هم از
    // دفترچه‌ی همون سرویس بگیر (مگر این‌که خودش صریح یک لیست دیگه فرستاده باشه)
    const finalCapabilities = capabilities || (service ? REGISTRY[service].capabilities : null);
    await updateProvider(id, { name, service, apiKey, capabilities: finalCapabilities, enabled });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }
  const { id } = await params;
  try {
    await deleteProvider(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
