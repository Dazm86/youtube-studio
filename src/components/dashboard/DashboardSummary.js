"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const TYPE_EMOJI = {
  video_uploaded: "🎬",
  video_failed: "❌",
  trend_scan_completed: "📈",
  trend_scan_failed: "📈",
  schedule_triggered: "⏰",
  repurpose_completed: "♻️",
  community_post_created: "💬",
  comment_replies_drafted: "💬",
  playlist_assigned: "🗂️",
  script_review_flagged: "📝",
};

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "همین الان";
  if (mins < 60) return `${mins} دقیقه پیش`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ساعت پیش`;
  return `${Math.floor(hours / 24)} روز پیش`;
}

export default function DashboardSummary() {
  const [activity, setActivity] = useState(null);
  const [trends, setTrends] = useState(null);
  const [schedules, setSchedules] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [activityRes, trendsRes, schedulesRes] = await Promise.all([
          fetch("/api/activity?limit=4"),
          fetch("/api/trends?status=pending&limit=50"),
          fetch("/api/schedules"),
        ]);
        const [activityData, trendsData, schedulesData] = await Promise.all([
          activityRes.json(),
          trendsRes.json(),
          schedulesRes.json(),
        ]);
        if (cancelled) return;
        setActivity(activityData.events || []);
        setTrends(trendsData);
        setSchedules(schedulesData);
      } catch {
        // داشبورد فقط یک خلاصه‌ست — اگه گرفتنِ دیتا شکست بخوره، صفحه‌ی
        // اصلی همچنان با کارت‌هایِ ناوبریِ پایین‌تر قابلِ‌استفاده می‌مونه.
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return null;

  const pendingTrendCount = trends?.topics?.length ?? null;
  const enabledSchedules = schedules?.schedules?.filter((s) => s.enabled) || [];
  const lastRun = schedules?.runs?.[0];

  return (
    <div className="grid gap-3 mb-6">
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/trends"
          className="bg-surface border border-border rounded-lg p-3 hover:border-amber transition-colors"
        >
          <p className="text-xs text-text-muted mb-1">📈 یافتن ترند</p>
          <p className="text-lg font-semibold text-text">
            {pendingTrendCount !== null ? `${pendingTrendCount} موضوع` : "—"}
          </p>
          <p className="text-xs text-text-faint">
            {trends?.latestScan
              ? `آخرین اسکن: ${timeAgo(trends.latestScan.started_at)}`
              : "هنوز اسکنی نشده"}
          </p>
        </Link>
        <Link
          href="/schedule"
          className="bg-surface border border-border rounded-lg p-3 hover:border-amber transition-colors"
        >
          <p className="text-xs text-text-muted mb-1">⏰ زمان‌بندی</p>
          <p className="text-lg font-semibold text-text">{enabledSchedules.length} فعال</p>
          <p className="text-xs text-text-faint">
            {lastRun
              ? `آخرین اجرا: ${lastRun.status === "completed" ? "موفق ✅" : lastRun.status === "failed" ? "شکست ❌" : "در حال اجرا"}`
              : "هنوز اجرا نشده"}
          </p>
        </Link>
      </div>

      {activity && activity.length > 0 && (
        <Link
          href="/activity"
          className="bg-surface border border-border rounded-lg p-3 hover:border-amber transition-colors block"
        >
          <p className="text-xs text-text-muted mb-2">📋 آخرین فعالیت</p>
          <div className="space-y-1.5">
            {activity.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-xs">
                <span>{TYPE_EMOJI[e.type] || "•"}</span>
                <span className="text-text truncate flex-1">{e.message}</span>
                <span className="text-text-faint shrink-0">{timeAgo(e.created_at)}</span>
              </div>
            ))}
          </div>
        </Link>
      )}
    </div>
  );
}
