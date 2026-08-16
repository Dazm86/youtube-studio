import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { setPriorityOrder } from "@/lib/db";

export async function PUT(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }
  const { taskType, order } = await req.json();
  if (!taskType || !Array.isArray(order)) {
    return NextResponse.json({ error: "taskType و order (آرایه‌ی id ها) لازمه" }, { status: 400 });
  }
  try {
    await setPriorityOrder(taskType, order);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
