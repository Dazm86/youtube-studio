"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fa-IR");
  } catch {
    return iso;
  }
}

export default function ChannelAnalytics() {
  const { data: session, status: sessionStatus } = useSession();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");

  // توجه: این تابع عمداً setState رو قبل از اولین await صدا نمی‌زنه، چون
  // از useEffect زیر هم فراخوانی می‌شه و React الان به‌خاطر ریندرهای زنجیره‌ای
  // نسبت به setState سنکرون داخل افکت هشدار می‌ده.
  async function loadVideos() {
    try {
      const res = await fetch("/api/videos");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در دریافت لیست ویدیوها");
      setVideos(data.videos || []);
      setError("");
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (session) queueMicrotask(() => loadVideos());
  }, [session]);

  async function handleSync() {
    setSyncing(true);
    setSyncStatus("در حال گرفتن آمار از یوتیوب...");
    try {
      const res = await fetch("/api/sync-stats", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در به‌روزرسانی آمار");
      setSyncStatus(
        data.updated !== undefined
          ? `آمار ${data.updated} از ${data.total ?? data.updated} ویدیو به‌روز شد ✅`
          : data.message || "به‌روزرسانی انجام شد"
      );
      await loadVideos();
    } catch (err) {
      setSyncStatus("خطا: " + (err.message || "خطای نامشخص"));
    }
    setSyncing(false);
  }

  if (sessionStatus === "loading") return null;

  if (!session) {
    return (
      <main style={{ padding: "2rem", textAlign: "center", maxWidth: "700px", margin: "0 auto" }}>
        <h2>📊 آنالیز کانال</h2>
        <p style={{ color: "#666" }}>برای مشاهده‌ی این بخش، اول از بالای صفحه با گوگل وارد شو.</p>
      </main>
    );
  }

  const totals = videos.reduce(
    (acc, v) => {
      acc.views += Number(v.views) || 0;
      acc.likes += Number(v.likes) || 0;
      acc.subs += Number(v.subscribers_gained) || 0;
      if (v.video_mode === "short") acc.short += 1;
      else acc.long += 1;
      return acc;
    },
    { views: 0, likes: 0, subs: 0, long: 0, short: 0 }
  );

  return (
    <main style={{ padding: "1rem", maxWidth: "700px", margin: "0 auto" }}>
      <h2 style={{ textAlign: "center" }}>📊 آنالیز کانال</h2>

      <button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        style={{ width: "100%", marginBottom: "0.5rem" }}
      >
        {syncing ? "در حال دریافت آمار..." : "🔄 به‌روزرسانی آمار واقعی ویدیوها"}
      </button>
      {syncStatus && <p style={{ fontSize: "0.85rem", textAlign: "center" }}>{syncStatus}</p>}

      {loading && <p style={{ textAlign: "center" }}>در حال بارگذاری...</p>}
      {error && <p style={{ color: "#e53935", textAlign: "center" }}>خطا: {error}</p>}

      {!loading && !error && videos.length === 0 && (
        <p style={{ textAlign: "center", color: "#666" }}>هنوز ویدیویی ثبت نشده.</p>
      )}

      {videos.length > 0 && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: "0.5rem",
              margin: "1rem 0",
            }}
          >
            <StatCard label="کل ویدیوها" value={videos.length} />
            <StatCard label="لانگ / شورت" value={`${totals.long} / ${totals.short}`} />
            <StatCard label="مجموع بازدید" value={totals.views.toLocaleString("fa-IR")} />
            <StatCard label="مجموع لایک" value={totals.likes.toLocaleString("fa-IR")} />
            <StatCard label="سابسکرایب جذب‌شده" value={totals.subs.toLocaleString("fa-IR")} />
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd", textAlign: "right" }}>
                  <th style={{ padding: "0.4rem" }}>عنوان</th>
                  <th style={{ padding: "0.4rem" }}>نوع</th>
                  <th style={{ padding: "0.4rem" }}>بازدید</th>
                  <th style={{ padding: "0.4rem" }}>لایک</th>
                  <th style={{ padding: "0.4rem" }}>سابسکرایب</th>
                  <th style={{ padding: "0.4rem" }}>میانگین تماشا</th>
                  <th style={{ padding: "0.4rem" }}>تاریخ</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr key={v.video_id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "0.4rem" }}>
                      <a
                        href={`https://www.youtube.com/watch?v=${v.video_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {v.title || "بدون عنوان"}
                      </a>
                    </td>
                    <td style={{ padding: "0.4rem" }}>{v.video_mode === "short" ? "شورت" : "لانگ"}</td>
                    <td style={{ padding: "0.4rem" }}>{Number(v.views || 0).toLocaleString("fa-IR")}</td>
                    <td style={{ padding: "0.4rem" }}>{Number(v.likes || 0).toLocaleString("fa-IR")}</td>
                    <td style={{ padding: "0.4rem" }}>
                      {Number(v.subscribers_gained || 0).toLocaleString("fa-IR")}
                    </td>
                    <td style={{ padding: "0.4rem" }}>{formatDuration(v.avg_view_duration_sec)}</td>
                    <td style={{ padding: "0.4rem" }}>{formatDate(v.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "0.6rem", textAlign: "center" }}>
      <div style={{ fontSize: "1.1rem", fontWeight: "bold" }}>{value}</div>
      <div style={{ fontSize: "0.75rem", color: "#666" }}>{label}</div>
    </div>
  );
}
