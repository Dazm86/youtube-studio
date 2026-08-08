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
    ok: { text: "موفق ✅", color: "#2e7d32" },
    failed: { text: "شکست ❌", color: "#c62828" },
    running: { text: "در حال اجرا ⏳", color: "#1565c0" },
  };
  const s = map[status] || { text: status, color: "#666" };
  return <span style={{ color: s.color, fontWeight: "bold" }}>{s.text}</span>;
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
      <main style={{ padding: "2rem", textAlign: "center", maxWidth: "700px", margin: "0 auto" }}>
        <p>برای تنظیم زمان‌بندی باید وارد بشی.</p>
      </main>
    );
  }

  const cronUrl = `${origin}/api/scheduler/run?secret=CRON_SECRET_شما`;

  return (
    <main style={{ padding: "1rem", maxWidth: "700px", margin: "0 auto" }}>
      <h2>⏰ زمان‌بندی آپلود خودکار</h2>

      <div
        style={{
          background: "#fff8e1",
          border: "1px solid #ffe082",
          borderRadius: "8px",
          padding: "0.8rem",
          fontSize: "0.85rem",
          marginBottom: "1.2rem",
        }}
      >
        <strong>راه‌اندازی یک‌باره (بیرون از این سایت):</strong>
        <ol style={{ paddingRight: "1.2rem", margin: "0.4rem 0" }}>
          <li>
            تو Render، یک متغیر محیطی جدید به اسم <code>CRON_SECRET</code> بساز (یک رشته‌ی تصادفی
            دلخواه، مثلاً از یک تولیدکننده‌ی پسورد).
          </li>
          <li>
            تو یک سرویس cron رایگان (پیشنهاد: <strong>cron-job.org</strong>) یک job جدید بساز که هر{" "}
            <strong>۱۰ دقیقه</strong> یک درخواست GET به این آدرس بزنه (به‌جای{" "}
            <code>CRON_SECRET_شما</code> همون مقداری که تو Render گذاشتی):
          </li>
        </ol>
        <code style={{ display: "block", background: "#fff", padding: "0.4rem", borderRadius: "4px", wordBreak: "break-all" }}>
          {cronUrl}
        </code>
        <p style={{ margin: "0.4rem 0 0" }}>
          این endpoint خودش چک می‌کنه چیزی الان due هست یا نه — هر ۱۰ دقیقه که pinger بزنه هزینه‌ای
          نداره، فقط وقتی زمانِ یکی از زمان‌بندی‌های زیر برسه، واقعاً تولید و آپلود شروع می‌شه.
        </p>
      </div>

      {error && <p style={{ color: "#c62828" }}>{error}</p>}

      <h3>زمان‌بندی‌های فعلی</h3>
      {loading ? (
        <p>در حال بارگذاری...</p>
      ) : schedules.length === 0 ? (
        <p style={{ color: "#777" }}>هنوز زمان‌بندی‌ای اضافه نشده.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ddd", textAlign: "right" }}>
              <th style={{ padding: "0.4rem" }}>نوع</th>
              <th style={{ padding: "0.4rem" }}>روزها</th>
              <th style={{ padding: "0.4rem" }}>ساعت</th>
              <th style={{ padding: "0.4rem" }}>حریم خصوصی</th>
              <th style={{ padding: "0.4rem" }}>فعال</th>
              <th style={{ padding: "0.4rem" }}></th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.4rem" }}>{s.video_mode === "short" ? "شورت" : "لانگ"}</td>
                <td style={{ padding: "0.4rem" }}>
                  {s.days_of_week.length === 7
                    ? "هر روز"
                    : s.days_of_week.map((d) => DAY_LABELS[d]).join("، ")}
                </td>
                <td style={{ padding: "0.4rem" }}>
                  {s.time_of_day} ({s.timezone})
                </td>
                <td style={{ padding: "0.4rem" }}>{s.privacy_status}</td>
                <td style={{ padding: "0.4rem" }}>
                  <input type="checkbox" checked={s.enabled} onChange={() => handleToggleEnabled(s)} />
                </td>
                <td style={{ padding: "0.4rem" }}>
                  <button type="button" onClick={() => handleDelete(s.id)} style={{ fontSize: "0.75rem" }}>
                    حذف
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>افزودن زمان‌بندی جدید</h3>
      <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "2rem" }}>
        <label>
          نوع ویدیو:{" "}
          <select value={videoMode} onChange={(e) => setVideoMode(e.target.value)}>
            <option value="short">شورت</option>
            <option value="long">لانگ</option>
          </select>
        </label>

        <div>
          روزها:
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.3rem" }}>
            {DAY_DISPLAY_ORDER.map((d) => (
              <label key={d} style={{ fontSize: "0.85rem" }}>
                <input type="checkbox" checked={days.has(d)} onChange={() => toggleDay(d)} />{" "}
                {DAY_LABELS[d]}
              </label>
            ))}
          </div>
        </div>

        <label>
          ساعت:{" "}
          <input type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} required />
        </label>

        <label>
          منطقه‌ی زمانی (IANA):{" "}
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Asia/Tehran"
          />
        </label>

        <label>
          حریم خصوصی آپلود:{" "}
          <select value={privacyStatus} onChange={(e) => setPrivacyStatus(e.target.value)}>
            <option value="public">عمومی</option>
            <option value="unlisted">لینک‌دار (فهرست‌نشده)</option>
            <option value="private">خصوصی</option>
          </select>
        </label>

        <button type="submit" disabled={saving}>
          {saving ? "در حال ذخیره..." : "➕ افزودن زمان‌بندی"}
        </button>
      </form>

      <h3>اجراهای اخیر</h3>
      {runs.length === 0 ? (
        <p style={{ color: "#777" }}>هنوز هیچ اجرای خودکاری ثبت نشده.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ddd", textAlign: "right" }}>
              <th style={{ padding: "0.4rem" }}>شروع</th>
              <th style={{ padding: "0.4rem" }}>وضعیت</th>
              <th style={{ padding: "0.4rem" }}>ویدیو</th>
              <th style={{ padding: "0.4rem" }}>خطا</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.4rem" }}>{formatDate(r.started_at)}</td>
                <td style={{ padding: "0.4rem" }}>
                  <StatusBadge status={r.status} />
                </td>
                <td style={{ padding: "0.4rem" }}>
                  {r.video_id ? (
                    <a href={`https://www.youtube.com/watch?v=${r.video_id}`} target="_blank" rel="noopener noreferrer">
                      مشاهده
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td style={{ padding: "0.4rem", color: "#c62828" }}>{r.error || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
