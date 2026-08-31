"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession, signIn } from "next-auth/react";

const TYPE_META = {
  video_uploaded: { icon: "🎬", label: "آپلود ویدیو", color: "text-teal" },
  video_failed: { icon: "❌", label: "شکستِ ساختِ ویدیو", color: "text-danger" },
  trend_scan_completed: { icon: "📈", label: "اسکنِ ترند", color: "text-secondary" },
  trend_scan_failed: { icon: "📈", label: "شکستِ اسکنِ ترند", color: "text-danger" },
  schedule_triggered: { icon: "⏰", label: "زمان‌بندی", color: "text-amber" },
  repurpose_completed: { icon: "♻️", label: "بازتولید شورت", color: "text-secondary" },
  community_post_created: { icon: "💬", label: "پستِ کامیونیتی", color: "text-secondary" },
  comment_replies_drafted: { icon: "💬", label: "پاسخِ کامنت", color: "text-secondary" },
};

const FILTERS = [
  { key: "", label: "همه" },
  { key: "video_uploaded", label: "آپلودها" },
  { key: "video_failed", label: "خطاها" },
  { key: "trend_scan_completed", label: "ترند" },
  { key: "schedule_triggered", label: "زمان‌بندی" },
];

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "همین الان";
  if (mins < 60) return `${mins} دقیقه پیش`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ساعت پیش`;
  const days = Math.floor(hours / 24);
  return `${days} روز پیش`;
}

export default function ActivityFeed() {
  const { data: session, status: sessionStatus } = useSession();
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (type) => {
    try {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      const res = await fetch(`/api/activity?${params.toString()}`);
      if (!res.ok) throw new Error(`خطای HTTP ${res.status}`);
      const data = await res.json();
      setEvents(data.events || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    load(filter);
    const interval = setInterval(() => load(filter), 30000);
    return () => clearInterval(interval);
  }, [session, filter, load]);

  if (sessionStatus === "loading") return null;
  if (!session) {
    return (
      <main className="min-h-screen bg-bg text-text flex flex-col items-center justify-center px-6 gap-4 text-center">
        <p className="text-text-muted">برای دیدنِ گزارشِ فعالیت باید وارد بشی.</p>
        <button onClick={() => signIn("google")} className="btn-primary px-6">
          ورود با گوگل
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-text px-4 py-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold">📋 گزارشِ فعالیت</h1>
          <p className="text-sm text-text-muted mt-1">هر آپلود، اسکنِ ترند، و اجرای خودکار — همه‌جا</p>
        </div>
        <button onClick={() => load(filter)} className="btn-ghost text-sm">
          به‌روزرسانی
        </button>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto mb-4 -mx-1 px-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={
              "whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium min-h-[38px] transition-colors " +
              (filter === f.key
                ? "bg-amber text-white"
                : "bg-surface-raised text-text-muted hover:text-text border border-border")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-danger-dim bg-danger/10 text-sm p-3 mb-5 text-danger">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-text-muted">در حال بارگذاری...</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-text-muted">هنوز هیچ رویدادی ثبت نشده.</p>
      ) : (
        <div className="space-y-2">
          {events.map((e) => {
            const meta = TYPE_META[e.type] || { icon: "•", label: e.type, color: "text-text-muted" };
            return (
              <div key={e.id} className="card flex items-start gap-3 py-3">
                <span className="text-xl leading-none shrink-0">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text">{e.message}</p>
                  <p className={`text-xs mt-1 ${meta.color}`}>
                    {meta.label} · {timeAgo(e.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
