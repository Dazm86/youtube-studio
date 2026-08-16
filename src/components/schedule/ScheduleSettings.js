"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

const DAY_LABELS = { 0: "یکشنبه", 1: "دوشنبه", 2: "سه‌شنبه", 3: "چهارشنبه", 4: "پنجشنبه", 5: "جمعه", 6: "شنبه" };
const DAY_DISPLAY_ORDER = [6, 0, 1, 2, 3, 4, 5]; // شنبه اول، مطابق هفته‌ی ایرانی

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
}

function StatusBadge({ status }) {
  const map = {
    ok: { text: "موفق ✅", cls: "text-teal" },
    failed: { text: "شکست ❌", cls: "text-danger" },
    running: { text: "در حال اجرا ⏳", cls: "text-amber" },
  };
  const s = map[status] || { text: status, cls: "text-text-muted" };
  return <span className={"font-bold " + s.cls}>{s.text}</span>;
}

export default function ScheduleSettings() {
  const { data: session, status: sessionStatus } = useSession();
  const [schedules, setSchedules] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState("");

  // فرم ساخت زمان‌بندی جدید
  const [videoMode, setVideoMode] = useState("short");
  const [days, setDays] = useState(new Set([0, 1, 2, 3, 4, 5, 6]));
  const [timeOfDay, setTimeOfDay] = useState("12:00");
  const [timezone, setTimezone] = useState("Asia/Tehran");
  const [privacyStatus, setPrivacyStatus] = useState("public");

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/schedules");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در بارگذاری");
      setSchedules(data.schedules || []);
      setRuns(data.runs || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  function toggleDay(d) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (days.size === 0) {
      setError("حداقل یک روز رو انتخاب کن");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoMode,
          daysOfWeek: Array.from(days),
          timeOfDay,
          timezone,
          privacyStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در ساخت زمان‌بندی");
      await loadData();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function handleToggleEnabled(schedule) {
    try {
      await fetch("/api/schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: schedule.id, enabled: !schedule.enabled }),
      });
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    try {
      await fetch(`/api/schedules?id=${id}`, { method: "DELETE" });
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  if (sessionStatus === "loading") return null;
  if (!session) {
    return (
      <main className="min-h-screen bg-bg text-text px-4 py-10 max-w-2xl mx-auto text-center">
        <p className="text-text-muted">برای تنظیم زمان‌بندی باید وارد بشی.</p>
      </main>
    );
  }

  const cronUrl = `${origin}/api/scheduler/run?secret=CRON_SECRET_شما`;

  return (
    <main className="min-h-screen bg-bg text-text px-4 py-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-3">⏰ زمان‌بندی آپلود خودکار</h1>

      <div className="rounded-lg border border-amber-dim bg-amber/10 text-sm p-3 mb-5 leading-relaxed">
        <strong>راه‌اندازی یک‌باره (بیرون از این سایت):</strong>
        <ol className="pr-5 my-2 list-decimal space-y-1">
          <li>
            تو Render، یک متغیر محیطی جدید به اسم <code className="readout">CRON_SECRET</code> بساز (یک رشته‌ی
            تصادفی دلخواه، مثلاً از یک تولیدکننده‌ی پسورد).
          </li>
          <li>
            تو یک سرویس cron رایگان (پیشنهاد: <strong>cron-job.org</strong>) یک job جدید بساز که هر{" "}
            <strong>۱۰ دقیقه</strong> یک درخواست GET به این آدرس بزنه (به‌جای{" "}
            <code className="readout">CRON_SECRET_شما</code> همون مقداری که تو Render گذاشتی):
          </li>
        </ol>
        <code className="block bg-surface-raised border border-border rounded-md p-2 break-all readout text-xs">
          {cronUrl}
        </code>
        <p className="mt-2">
          این endpoint خودش چک می‌کنه چیزی الان due هست یا نه — هر ۱۰ دقیقه که pinger بزنه هزینه‌ای
          نداره، فقط وقتی زمانِ یکی از زمان‌بندی‌های زیر برسه، واقعاً تولید و آپلود شروع می‌شه.
        </p>
      </div>

      {error && <p className="text-danger mb-3">{error}</p>}

      <h2 className="font-semibold mb-2">زمان‌بندی‌های فعلی</h2>
      {loading ? (
        <p className="text-text-muted">در حال بارگذاری...</p>
      ) : schedules.length === 0 ? (
        <p className="text-text-muted mb-6">هنوز زمان‌بندی‌ای اضافه نشده.</p>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto mb-6">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-border text-right">
                  <th className="p-2 text-text-muted font-medium">نوع</th>
                  <th className="p-2 text-text-muted font-medium">روزها</th>
                  <th className="p-2 text-text-muted font-medium">ساعت</th>
                  <th className="p-2 text-text-muted font-medium">حریم خصوصی</th>
                  <th className="p-2 text-text-muted font-medium">فعال</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} className="border-b border-border">
                    <td className="p-2">{s.video_mode === "short" ? "شورت" : "لانگ"}</td>
                    <td className="p-2 text-text-muted">
                      {s.days_of_week.length === 7 ? "هر روز" : s.days_of_week.map((d) => DAY_LABELS[d]).join("، ")}
                    </td>
                    <td className="p-2 readout">
                      {s.time_of_day} ({s.timezone})
                    </td>
                    <td className="p-2 text-text-muted">{s.privacy_status}</td>
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        onChange={() => handleToggleEnabled(s)}
                        className="w-4 h-4 accent-amber"
                      />
                    </td>
                    <td className="p-2">
                      <button type="button" onClick={() => handleDelete(s.id)} className="btn-danger-ghost">
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden flex flex-col gap-3 mb-6">
            {schedules.map((s) => (
              <div key={s.id} className="card">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-medium">{s.video_mode === "short" ? "⚡ شورت" : "🎬 لانگ"}</span>
                  <label className="flex items-center gap-1.5 text-xs text-text-muted">
                    فعال
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={() => handleToggleEnabled(s)}
                      className="w-4 h-4 accent-amber"
                    />
                  </label>
                </div>
                <p className="text-sm text-text-muted mb-1">
                  {s.days_of_week.length === 7 ? "هر روز" : s.days_of_week.map((d) => DAY_LABELS[d]).join("، ")} —{" "}
                  <span className="readout">{s.time_of_day}</span> ({s.timezone})
                </p>
                <p className="text-xs text-text-faint mb-2">حریم خصوصی: {s.privacy_status}</p>
                <button type="button" onClick={() => handleDelete(s.id)} className="btn-danger-ghost w-full">
                  حذف
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="font-semibold mb-2">افزودن زمان‌بندی جدید</h2>
      <form onSubmit={handleCreate} className="card flex flex-col gap-4 mb-6">
        <div>
          <label className="field-label">نوع ویدیو</label>
          <select value={videoMode} onChange={(e) => setVideoMode(e.target.value)} className="field-select">
            <option value="short">شورت</option>
            <option value="long">لانگ</option>
          </select>
        </div>

        <div>
          <label className="field-label">روزها</label>
          <div className="flex flex-wrap gap-1.5">
            {DAY_DISPLAY_ORDER.map((d) => (
              <label key={d} className={"day-chip" + (days.has(d) ? " day-chip-active" : "")}>
                <input
                  type="checkbox"
                  checked={days.has(d)}
                  onChange={() => toggleDay(d)}
                  className="sr-only"
                />
                {DAY_LABELS[d]}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="field-label">ساعت</label>
          <input type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} required className="field-input" />
        </div>

        <div>
          <label className="field-label">منطقه‌ی زمانی (IANA)</label>
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Asia/Tehran"
            className="field-input"
            dir="ltr"
          />
        </div>

        <div>
          <label className="field-label">حریم خصوصی آپلود</label>
          <select value={privacyStatus} onChange={(e) => setPrivacyStatus(e.target.value)} className="field-select">
            <option value="public">عمومی</option>
            <option value="unlisted">لینک‌دار (فهرست‌نشده)</option>
            <option value="private">خصوصی</option>
          </select>
        </div>

        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? "در حال ذخیره..." : "➕ افزودن زمان‌بندی"}
        </button>
      </form>

      <h2 className="font-semibold mb-2">اجراهای اخیر</h2>
      {runs.length === 0 ? (
        <p className="text-text-muted">هنوز هیچ اجرای خودکاری ثبت نشده.</p>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-border text-right">
                  <th className="p-2 text-text-muted font-medium">شروع</th>
                  <th className="p-2 text-text-muted font-medium">وضعیت</th>
                  <th className="p-2 text-text-muted font-medium">ویدیو</th>
                  <th className="p-2 text-text-muted font-medium">خطا</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-border">
                    <td className="p-2 text-text-muted">{formatDate(r.started_at)}</td>
                    <td className="p-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="p-2">
                      {r.video_id ? (
                        <a
                          href={`https://www.youtube.com/watch?v=${r.video_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-teal hover:underline"
                        >
                          مشاهده
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-2 text-danger">{r.error || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden flex flex-col gap-2">
            {runs.map((r) => (
              <div key={r.id} className="card py-2.5">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm text-text-muted">{formatDate(r.started_at)}</span>
                  <StatusBadge status={r.status} />
                </div>
                {r.video_id && (
                  <a
                    href={`https://www.youtube.com/watch?v=${r.video_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal hover:underline text-sm"
                  >
                    ▶️ مشاهده‌ی ویدیو
                  </a>
                )}
                {r.error && <p className="text-danger text-xs mt-1">{r.error}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
