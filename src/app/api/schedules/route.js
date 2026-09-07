import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  listRecentScheduleRuns,
} from "@/lib/db";

// ۲۰۲۶-۰۹-۰۸ — قبلاً هیچ اعتبارسنجی‌ای رویِ timezone نبود؛ فیلدِ متناظر
// تو ScheduleSettings.js صرفاً یک <input type="text"> آزاده (placeholder
// "Asia/Tehran" فقط یک راهنماست، نه یک select محدود). یک تایپوی ساده
// (مثلاً "Tehran" به‌جای "Asia/Tehran") بی‌صدا تو دیتابیس ذخیره می‌شد و
// بعداً، هر بار که scheduler/run سعی می‌کرد الانِ اون timezone رو حساب
// کنه، یک RangeError پرت می‌شد — که (قبل از فیکسِ همون فایل) کلِ آپلودِ
// خودکار رو برای *همه‌ی* زمان‌بندی‌ها می‌خابوند. اینجا همون تستِ واقعی‌ای
// که Intl.DateTimeFormat خودش موقعِ اجرا انجام می‌ده رو زودتر، موقعِ
// ثبت/ویرایش، انجام می‌دیم تا یک ورودیِ خراب اصلاً وارد دیتابیس نشه.
function isValidTimeZone(tz) {
  if (!tz) return true; // خالی یعنی از پیش‌فرضِ دیتابیس (Asia/Tehran) استفاده می‌شه
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }
  try {
    const [schedules, runs] = await Promise.all([listSchedules(), listRecentScheduleRuns(20)]);
    return NextResponse.json({ schedules, runs });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }
  const { videoMode, daysOfWeek, timeOfDay, timezone, privacyStatus } = await req.json();
  if (!videoMode || !Array.isArray(daysOfWeek) || daysOfWeek.length === 0 || !timeOfDay) {
    return NextResponse.json(
      { error: "videoMode، daysOfWeek (حداقل یک روز) و timeOfDay لازمه" },
      { status: 400 }
    );
  }
  if (!isValidTimeZone(timezone)) {
    return NextResponse.json(
      { error: `منطقه‌ی زمانیِ «${timezone}» معتبر نیست — باید یک شناسه‌ی IANA درست باشه (مثلاً Asia/Tehran)` },
      { status: 400 }
    );
  }
  try {
    const created = await createSchedule({ videoMode, daysOfWeek, timeOfDay, timezone, privacyStatus });
    return NextResponse.json({ id: created.id });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }
  const { id, daysOfWeek, timeOfDay, timezone, privacyStatus, enabled } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "id لازمه" }, { status: 400 });
  }
  if (timezone && !isValidTimeZone(timezone)) {
    return NextResponse.json(
      { error: `منطقه‌ی زمانیِ «${timezone}» معتبر نیست — باید یک شناسه‌ی IANA درست باشه (مثلاً Asia/Tehran)` },
      { status: 400 }
    );
  }
  try {
    await updateSchedule(id, { daysOfWeek, timeOfDay, timezone, privacyStatus, enabled });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id لازمه" }, { status: 400 });
  }
  try {
    await deleteSchedule(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
