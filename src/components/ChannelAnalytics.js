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
  // فاز ۳: وضعیت هر اکشن (پست کامیونیتی / سوییچ A-B) به‌ازای هر videoId،
  // جدا نگه داشته می‌شه تا کلیک روی یک ردیف بقیه رو تحت تاثیر قرار نده.
  const [postDrafts, setPostDrafts] = useState({});
  const [postLoading, setPostLoading] = useState({});
  const [abLoading, setAbLoading] = useState({});
  const [abStatus, setAbStatus] = useState({});

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

  // فاز ۳: پیش‌نویس پست کامیونیتی رو برای یک ویدیوی مشخص می‌سازه و
  // ذخیره می‌کنه (فقط پیش‌نویس — یوتیوب انتشار خودکار تو Community
  // نمی‌ده، برای همین متن آماده‌ی کپی برمی‌گرده).
  async function handleCommunityPost(videoId) {
    setPostLoading((s) => ({ ...s, [videoId]: true }));
    try {
      const res = await fetch("/api/community-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در ساخت پیش‌نویس");
      setPostDrafts((s) => ({ ...s, [videoId]: data }));
    } catch (err) {
      setPostDrafts((s) => ({ ...s, [videoId]: { error: err.message } }));
    }
    setPostLoading((s) => ({ ...s, [videoId]: false }));
  }

  // فاز ۳: سوییچ نسخه‌ی فعالِ عنوان/تامبنیل (A/B ترتیبی — توضیح کامل تو
  // api/ab-test/route.js).
  async function handleSwitchVariant(videoId, variant) {
    setAbLoading((s) => ({ ...s, [videoId]: true }));
    try {
      const res = await fetch("/api/ab-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, variant }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در سوییچ نسخه");
      setAbStatus((s) => ({ ...s, [videoId]: `نسخه‌ی ${variant} فعال شد ✅` }));
      await loadVideos();
    } catch (err) {
      setAbStatus((s) => ({ ...s, [videoId]: "خطا: " + err.message }));
    }
    setAbLoading((s) => ({ ...s, [videoId]: false }));
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-bg text-text px-4 py-10 max-w-2xl mx-auto text-center">
        <h2 className="text-xl font-bold mb-2">📊 آنالیز کانال</h2>
        <p className="text-text-muted">برای مشاهده‌ی این بخش، اول از بالای صفحه با گوگل وارد شو.</p>
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
    <main className="min-h-screen bg-bg text-text px-4 py-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-4">📊 آنالیز کانال</h1>

      <button type="button" onClick={handleSync} disabled={syncing} className="btn-secondary w-full mb-2">
        {syncing ? "در حال دریافت آمار..." : "🔄 به‌روزرسانی آمار واقعی ویدیوها"}
      </button>
      {syncStatus && <p className="text-sm text-text-muted text-center mb-2">{syncStatus}</p>}

      {loading && <p className="text-center text-text-muted">در حال بارگذاری...</p>}
      {error && <p className="text-center text-danger">خطا: {error}</p>}

      {!loading && !error && videos.length === 0 && (
        <p className="text-center text-text-muted">هنوز ویدیویی ثبت نشده.</p>
      )}

      {videos.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 my-4">
            <StatCard label="کل ویدیوها" value={videos.length} />
            <StatCard label="لانگ / شورت" value={`${totals.long} / ${totals.short}`} />
            <StatCard label="مجموع بازدید" value={totals.views.toLocaleString("fa-IR")} />
            <StatCard label="مجموع لایک" value={totals.likes.toLocaleString("fa-IR")} />
            <StatCard label="سابسکرایب جذب‌شده" value={totals.subs.toLocaleString("fa-IR")} />
          </div>

          {/* دسکتاپ: جدول کامل */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-border text-right">
                  <th className="p-2 text-text-muted font-medium">عنوان</th>
                  <th className="p-2 text-text-muted font-medium">نوع</th>
                  <th className="p-2 text-text-muted font-medium">بازدید</th>
                  <th className="p-2 text-text-muted font-medium">لایک</th>
                  <th className="p-2 text-text-muted font-medium">سابسکرایب</th>
                  <th className="p-2 text-text-muted font-medium">میانگین تماشا</th>
                  <th className="p-2 text-text-muted font-medium">نگه‌داشت</th>
                  <th className="p-2 text-text-muted font-medium">CTR تامبنیل</th>
                  <th className="p-2 text-text-muted font-medium">تاریخ</th>
                  <th className="p-2 text-text-muted font-medium">اکشن‌ها</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr key={v.video_id} className="border-b border-border">
                    <td className="p-2">
                      <a
                        href={`https://www.youtube.com/watch?v=${v.video_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal hover:underline"
                      >
                        {v.title || "بدون عنوان"}
                      </a>
                    </td>
                    <td className="p-2 text-text-muted">{v.video_mode === "short" ? "شورت" : "لانگ"}</td>
                    <td className="p-2 readout">{Number(v.views || 0).toLocaleString("fa-IR")}</td>
                    <td className="p-2 readout">{Number(v.likes || 0).toLocaleString("fa-IR")}</td>
                    <td className="p-2 readout">{Number(v.subscribers_gained || 0).toLocaleString("fa-IR")}</td>
                    <td className="p-2 readout">{formatDuration(v.avg_view_duration_sec)}</td>
                    <td className="p-2 readout">{v.retention_pct ? `${Number(v.retention_pct).toFixed(0)}%` : "—"}</td>
                    <td className="p-2 readout">{v.thumbnail_ctr ? `${Number(v.thumbnail_ctr).toFixed(1)}%` : "—"}</td>
                    <td className="p-2 text-text-muted">{formatDate(v.created_at)}</td>
                    <td className="p-2 min-w-[200px]">
                      <VideoActions
                        v={v}
                        postLoading={postLoading}
                        postDrafts={postDrafts}
                        abLoading={abLoading}
                        abStatus={abStatus}
                        onCommunityPost={handleCommunityPost}
                        onSwitchVariant={handleSwitchVariant}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* موبایل: کارت به‌ازای هر ویدیو */}
          <div className="md:hidden flex flex-col gap-3">
            {videos.map((v) => (
              <div key={v.video_id} className="card">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <a
                    href={`https://www.youtube.com/watch?v=${v.video_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal hover:underline font-medium leading-snug"
                  >
                    {v.title || "بدون عنوان"}
                  </a>
                  <span className="badge-neutral shrink-0">{v.video_mode === "short" ? "شورت" : "لانگ"}</span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center mb-2">
                  <MiniStat label="بازدید" value={Number(v.views || 0).toLocaleString("fa-IR")} />
                  <MiniStat label="لایک" value={Number(v.likes || 0).toLocaleString("fa-IR")} />
                  <MiniStat label="سابسکرایب" value={Number(v.subscribers_gained || 0).toLocaleString("fa-IR")} />
                  <MiniStat label="میانگین تماشا" value={formatDuration(v.avg_view_duration_sec)} />
                  <MiniStat label="نگه‌داشت" value={v.retention_pct ? `${Number(v.retention_pct).toFixed(0)}%` : "—"} />
                  <MiniStat label="CTR" value={v.thumbnail_ctr ? `${Number(v.thumbnail_ctr).toFixed(1)}%` : "—"} />
                </div>
                <p className="text-xs text-text-muted mb-2">{formatDate(v.created_at)}</p>

                <VideoActions
                  v={v}
                  postLoading={postLoading}
                  postDrafts={postDrafts}
                  abLoading={abLoading}
                  abStatus={abStatus}
                  onCommunityPost={handleCommunityPost}
                  onSwitchVariant={handleSwitchVariant}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card text-center py-3">
      <div className="text-lg font-bold readout">{value}</div>
      <div className="text-xs text-text-muted mt-0.5">{label}</div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-md bg-surface-raised border border-border py-1.5">
      <div className="text-sm font-semibold readout">{value}</div>
      <div className="text-[0.65rem] text-text-muted mt-0.5">{label}</div>
    </div>
  );
}

// فاز ۳: بلوک اکشن‌های هر ویدیو (پست کامیونیتی + سوییچ A/B) — بین نسخه‌ی
// جدول دسکتاپ و نسخه‌ی کارت موبایل مشترکه تا رفتار و استایل دقیقاً یکی باشه.
function VideoActions({ v, postLoading, postDrafts, abLoading, abStatus, onCommunityPost, onSwitchVariant }) {
  return (
    <div>
      {v.video_mode !== "short" && (
        <button
          type="button"
          onClick={() => onCommunityPost(v.video_id)}
          disabled={postLoading[v.video_id]}
          className="btn-ghost w-full mb-1.5"
        >
          {postLoading[v.video_id] ? "..." : "📝 پیش‌نویس پست کامیونیتی"}
        </button>
      )}
      {postDrafts[v.video_id] &&
        (postDrafts[v.video_id].error ? (
          <div className="text-xs text-danger mb-1.5">{postDrafts[v.video_id].error}</div>
        ) : (
          <div className="text-xs bg-surface-raised border border-border rounded-md p-2 mb-1.5">
            <strong>{postDrafts[v.video_id].postType === "poll" ? "نظرسنجی" : "نقل‌قول"}:</strong>{" "}
            {postDrafts[v.video_id].postText}
            {postDrafts[v.video_id].pollOptions && (
              <ul className="mt-1 pr-4 list-disc">
                {postDrafts[v.video_id].pollOptions.map((opt, i) => (
                  <li key={i}>{opt}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      {v.title_b && (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onSwitchVariant(v.video_id, "A")}
            disabled={abLoading[v.video_id]}
            className={"btn-ghost flex-1 " + (v.active_variant === "A" ? "border-amber text-amber" : "")}
          >
            عنوان A
          </button>
          <button
            type="button"
            onClick={() => onSwitchVariant(v.video_id, "B")}
            disabled={abLoading[v.video_id]}
            className={"btn-ghost flex-1 " + (v.active_variant === "B" ? "border-amber text-amber" : "")}
          >
            عنوان B
          </button>
        </div>
      )}
      {abStatus[v.video_id] && <div className="text-xs text-text-muted mt-1">{abStatus[v.video_id]}</div>}
    </div>
  );
}
