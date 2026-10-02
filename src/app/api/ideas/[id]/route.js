import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { updateIdeaStatus, deleteIdea } from "@/lib/ideas/db.js";

export const dynamic = "force-dynamic";

// کاربر فقط می‌تونه بین pending و skipped جابه‌جا کنه؛ used/in_progress رو
// فقط خودِ سیستم (بعد از ساختِ ویدیو) ست می‌کنه.
const USER_STATUSES = ["pending", "skipped"];

export async function PATCH(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  const { id } = await params; // Next 15+: params async است
  const { status } = await req.json().catch(() => ({}));
  if (!USER_STATUSES.includes(status)) {
    return NextResponse.json({ error: `status باید یکی از ${USER_STATUSES.join("، ")} باشه` }, { status: 400 });
  }
  try {
    const idea = await updateIdeaStatus(Number(id), status);
    if (!idea) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });
    return NextResponse.json({ idea });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(_req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  const { id } = await params;
  try {
    const ok = await deleteIdea(Number(id));
    if (!ok) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
