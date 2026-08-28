"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession, signIn } from "next-auth/react";

const CRITERIA = [
  { key: "score_search_growth", label: "رشد جست‌وجو", max: 25 },
  { key: "score_view_growth", label: "رشد بازدید یوتیوب", max: 25 },
  { key: "score_freshness", label: "تازگی", max: 15 },
  { key: "score_competition", label: "رقابت کم", max: 15 },
  { key: "score_shorts_fit", label: "قابلیت شورت", max: 10 },
  { key: "score_long_fit", label: "قابلیت لانگ", max: 10 },
];

const STAGE_LABELS = {
  google_trends: "Google Trends",
  youtube: "یوتیوب",
  tiktok_reddit: "تیک‌تاک / ردیت",
  news: "اخبار",
  ai_analyzer: "تحلیل‌گر هوش‌مصنوعی",
};

const STATUS_TABS = [
  { key: "pending", label: "در انتظار" },
  { key: "approved", label: "تأیید شده" },
  { key: "rejected", label: "رد شده" },
  { key: "produced", label: "ساخته شده" },
  { key: "all", label: "همه" },
];

function scoreEmoji(total) {
  if (total >= 90) return "🔥";
  if (total >= 83) return "⭐";
  if (total >= 75) return "👍";
  return "";
}

function scoreBadgeClass(total) {
  if (total >= 83) return "badge-ok";
  if (total >= 75) return "badge-neutral";
  return "badge-fail";
}

async function streamNdjson(url, body, onEvent) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `خطای HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalEvent = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.ping) continue;
      onEvent(event);
      if (event.done || event.error) finalEvent = event;
    }
  }
  if (finalEvent?.error) throw new Error(finalEvent.error);
  return finalEvent;
}

export default function TrendFinder() {
  const { data: session, status: sessionStatus } = useSession();

  const [topics, setTopics] = useState([]);
  const [latestScan, setLatestScan] = useState(null);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanEvents, setScanEvents] = useState([]);
  const [error, setError] = useState(null);

  // آیدیِ موضوعی که الان در حالِ ساخت خودکار (تولید ویدیو) هست — فقط یکی
  // در آنِ واحد، برای ساده موندنِ UI.
  const [producingId, setProducingId] = useState(null);
  const [producingMode, setProducingMode] = useState(null);
  const [produceStatus, setProduceStatus] = useState("");
  const [produceResult, setProduceResult] = useState(null);

  const loadTopics = useCallback(async (status) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status && status !== "all") params.set("status", status);
      const res = await fetch(`/api/trends?${params.toString()}`);
      if (!res.ok) throw new Error(`خطای HTTP ${res.status}`);
      const data = await res.json();
      setTopics(data.topics || []);
      setLatestScan(data.latestScan || null);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (session) loadTopics(statusFilter);
  }, [session, statusFilter, loadTopics]);

  async function runScanNow() {
    setScanning(true);
    setScanEvents([]);
    setError(null);
    try {
      await streamNdjson("/api/trends/scan-now", {}, (event) => {
        setScanEvents((prev) => [...prev.slice(-7), event]);
      });
      await loadTopics(statusFilter);
    } catch (err) {
      setError(err.message);
    }
    setScanning(false);
  }

  async function setTopicStatus(id, status) {
    const prevTopics = topics;
    setTopics((prev) => prev.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/trends/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`خطای HTTP ${res.status}`);
    } catch (err) {
      setError(err.message);
      setTopics(prevTopics);
    }
  }

  async function handleAutoProduce(topic, mode) {
    setProducingId(topic.id);
    setProducingMode(mode);
    setProduceStatus("در حال شروع...");
    setProduceResult(null);
    setError(null);
    try {
      const final = await streamNdjson(
        "/api/auto-produce",
        { mode, topicId: topic.id },
        (event) => {
          if (event.status) setProduceStatus(event.status);
        }
      );
      setProduceResult({ ok: true, ...final });
      loadTopics(statusFilter);
    } catch (err) {
      setProduceResult({ ok: false, error: err.message });
    }
    setProducingId(null);
    setProducingMode(null);
  }

  if (sessionStatus === "loading") return null;
  if (!session) {
    return (
      <main className="min-h-screen bg-bg text-text flex flex-col items-center justify-center px-6 gap-4 text-center">
        <p className="text-text-muted">برای استفاده از Trend Finder باید وارد بشی.</p>
        <button onClick={() => signIn("google")} className="btn-primary px-6">
          ورود با گوگل
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-text px-4 py-6 max-w-2xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold">📈 یافتن ترند</h1>
          <p className="text-sm text-text-muted mt-1">
            {latestScan
              ? `آخرین اسکن: ${new Date(latestScan.started_at).toLocaleString("fa-IR")} — ${
                  latestScan.status === "completed"
                    ? "کامل ✅"
                    : latestScan.status === "failed"
                    ? "شکست ❌"
                    : "در حال اجرا ⏳"
                }${latestScan.topics_found ? ` — ${latestScan.topics_found} موضوع واجد شرایط` : ""}`
              : "هنوز هیچ اسکنی اجرا نشده."}
          </p>
        </div>
        <button onClick={runScanNow} disabled={scanning} className="btn-primary shrink-0">
          {scanning ? "در حال اسکن..." : "اسکن الان"}
        </button>
      </div>

      {scanning && (
        <div className="card mb-5">
          {scanEvents.length === 0 && <p className="text-sm text-text-muted">در حال شروع...</p>}
          {scanEvents.map((e, i) => (
            <div key={i} className="flex items-center justify-between text-sm py-1">
              <span className="text-text-muted">{STAGE_LABELS[e.stage] || e.stage || e.status}</span>
              <span className="text-text-faint readout text-xs">
                {e.progress || e.status || e.count || ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-danger-dim bg-danger/10 text-sm p-3 mb-5 text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center gap-1.5 overflow-x-auto mb-4 -mx-1 px-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={
              "whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium min-h-[38px] transition-colors " +
              (statusFilter === tab.key
                ? "bg-amber text-white"
                : "bg-surface-raised text-text-muted hover:text-text border border-border")
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-text-muted">در حال بارگذاری...</p>
      ) : topics.length === 0 ? (
        <p className="text-sm text-text-muted">
          موضوعی با این وضعیت پیدا نشد. یک اسکن اجرا کن تا موضوع‌های تازه پیدا بشن.
        </p>
      ) : (
        <div className="space-y-3">
          {topics.map((t) => {
            const total = Math.round(Number(t.score_total));
            const isProducingThis = producingId === t.id;
            return (
              <div key={t.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-text">
                      {t.topic} {scoreEmoji(total)}
                    </h3>
                    {t.angle && <p className="text-sm text-text-muted mt-0.5">{t.angle}</p>}
                  </div>
                  <span className={"shrink-0 " + scoreBadgeClass(total)}>{total}/۱۰۰</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 mt-3">
                  {CRITERIA.map((c) => (
                    <div key={c.key} className="text-xs text-text-muted">
                      {c.label}: <span className="text-text">{Math.round(Number(t[c.key] ?? 0))}</span>/{c.max}
                    </div>
                  ))}
                </div>

                {t.reasoning && <p className="text-xs text-text-faint mt-3 leading-relaxed">{t.reasoning}</p>}

                {t.status === "pending" && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button onClick={() => setTopicStatus(t.id, "approved")} className="btn-secondary">
                      تأیید
                    </button>
                    <button onClick={() => setTopicStatus(t.id, "rejected")} className="btn-ghost">
                      رد کردن
                    </button>
                  </div>
                )}

                {t.status === "approved" && (
                  <div className="mt-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleAutoProduce(t, "long")}
                        disabled={producingId !== null}
                        className="btn-primary"
                      >
                        {isProducingThis && producingMode === "long" ? "در حال ساخت..." : "🚀 بساز و آپلود کن (لانگ)"}
                      </button>
                      <button
                        onClick={() => handleAutoProduce(t, "short")}
                        disabled={producingId !== null}
                        className="btn-primary"
                      >
                        {isProducingThis && producingMode === "short" ? "در حال ساخت..." : "🚀 بساز و آپلود کن (شورت)"}
                      </button>
                      <a href={`/long?topic=${encodeURIComponent(t.topic)}`} className="btn-ghost">
                        باز کردن دستی (لانگ)
                      </a>
                      <a href={`/short?topic=${encodeURIComponent(t.topic)}`} className="btn-ghost">
                        باز کردن دستی (شورت)
                      </a>
                    </div>
                    {isProducingThis && (
                      <p className="text-xs text-text-muted mt-2 readout">{produceStatus}</p>
                    )}
                    {!isProducingThis && produceResult && producingId === null && (
                      <p className={"text-xs mt-2 " + (produceResult.ok ? "text-teal" : "text-danger")}>
                        {produceResult.ok
                          ? produceResult.jobId
                            ? produceResult.message
                            : `آپلود شد ✅ (videoId: ${produceResult.videoId})`
                          : `خطا: ${produceResult.error}`}
                      </p>
                    )}
                  </div>
                )}

                {t.status === "produced" && (
                  <p className="text-xs text-teal mt-4">
                    ساخته شد ✅ {t.video_id && <span className="readout">(videoId: {t.video_id})</span>}
                  </p>
                )}

                {t.status === "rejected" && <p className="text-xs text-text-faint mt-4">رد شده</p>}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
