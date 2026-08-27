'use client';

import { useState, useEffect, useCallback } from 'react';

const CRITERIA = [
  { key: 'score_search_growth', label: 'Search growth', max: 25 },
  { key: 'score_view_growth', label: 'YouTube view growth', max: 25 },
  { key: 'score_freshness', label: 'Freshness', max: 15 },
  { key: 'score_competition', label: 'Low competition', max: 15 },
  { key: 'score_shorts_fit', label: 'Shorts fit', max: 10 },
  { key: 'score_long_fit', label: 'Long fit', max: 10 },
];

function scoreEmoji(total) {
  if (total >= 90) return '🔥';
  if (total >= 83) return '⭐';
  if (total >= 75) return '👍';
  return '';
}

function scoreColor(total) {
  if (total >= 90) return 'text-orange-400 border-orange-400/40 bg-orange-400/10';
  if (total >= 83) return 'text-violet-300 border-violet-400/40 bg-violet-400/10';
  return 'text-slate-300 border-slate-500/40 bg-slate-500/10';
}

function StageRow({ event }) {
  const stageLabels = {
    google_trends: 'Google Trends',
    youtube: 'YouTube',
    tiktok_reddit: 'TikTok / Reddit',
    news: 'News',
    ai_analyzer: 'AI Analyzer',
  };
  const label = stageLabels[event.stage] || event.stage;
  return (
    <div className="flex items-center justify-between text-sm text-slate-400 py-1">
      <span>{label}</span>
      <span className="text-slate-500">
        {event.status === 'running' ? (event.progress ? event.progress : 'running…') : event.status}
      </span>
    </div>
  );
}

export default function TrendFinder() {
  const [topics, setTopics] = useState([]);
  const [latestScan, setLatestScan] = useState(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [progressEvents, setProgressEvents] = useState([]);
  const [error, setError] = useState(null);

  const loadTopics = useCallback(async (status) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status && status !== 'all') params.set('status', status);
      const res = await fetch(`/api/trends?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTopics(data.topics || []);
      setLatestScan(data.latestScan || null);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTopics(statusFilter);
  }, [statusFilter, loadTopics]);

  async function runScanNow() {
    setScanning(true);
    setProgressEvents([]);
    setError(null);
    try {
      const res = await fetch('/api/trends/scan-now', { method: 'POST' });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          setProgressEvents((prev) => [...prev.slice(-8), event]);
          if (event.stage === 'error') setError(event.message);
        }
      }
      await loadTopics(statusFilter);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }

  async function setTopicStatus(id, status) {
    setTopics((prev) => prev.filter((t) => t.id !== id || status === 'pending'));
    try {
      const res = await fetch(`/api/trends/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError(err.message);
      loadTopics(statusFilter);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 text-slate-100">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Trend Finder</h1>
          <p className="text-sm text-slate-400 mt-1">
            {latestScan
              ? `Last scan: ${new Date(latestScan.started_at).toLocaleString()} — ${latestScan.status}${
                  latestScan.topics_found ? ` — ${latestScan.topics_found} topics qualified` : ''
                }`
              : 'No scan has run yet.'}
          </p>
        </div>
        <button
          onClick={runScanNow}
          disabled={scanning}
          className="shrink-0 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition"
        >
          {scanning ? 'Scanning…' : 'Run scan now'}
        </button>
      </div>

      {scanning && (
        <div className="mb-6 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
          {progressEvents.map((e, i) => (
            <StageRow key={i} event={e} />
          ))}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-sm p-3">
          {error}
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {['pending', 'approved', 'rejected', 'all'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              statusFilter === s
                ? 'bg-violet-600 border-violet-600 text-white'
                : 'border-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : topics.length === 0 ? (
        <p className="text-slate-500 text-sm">
          No {statusFilter !== 'all' ? statusFilter : ''} topics yet. Run a scan to find some.
        </p>
      ) : (
        <div className="space-y-3">
          {topics.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-medium text-white">
                    {t.topic} <span>{scoreEmoji(Number(t.score_total))}</span>
                  </h3>
                  {t.angle && <p className="text-sm text-slate-400 mt-0.5">{t.angle}</p>}
                </div>
                <span
                  className={`shrink-0 rounded-full border px-3 py-1 text-sm font-semibold ${scoreColor(
                    Number(t.score_total)
                  )}`}
                >
                  {Math.round(Number(t.score_total))}/100
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
                {CRITERIA.map((c) => (
                  <div key={c.key} className="text-xs text-slate-400">
                    {c.label}: <span className="text-slate-200">{Math.round(Number(t[c.key] ?? 0))}</span>/{c.max}
                  </div>
                ))}
              </div>

              {t.reasoning && <p className="text-xs text-slate-500 mt-3 italic">{t.reasoning}</p>}

              <div className="flex flex-wrap gap-2 mt-4">
                {t.status === 'pending' && (
                  <>
                    <button
                      onClick={() => setTopicStatus(t.id, 'approved')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => setTopicStatus(t.id, 'rejected')}
                      className="px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-300 text-xs font-medium"
                    >
                      Reject
                    </button>
                  </>
                )}
                {t.status === 'approved' && (
                  <>
                    <a
                      href={`/long?topic=${encodeURIComponent(t.topic)}`}
                      className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium"
                    >
                      Create long video
                    </a>
                    <a
                      href={`/short?topic=${encodeURIComponent(t.topic)}`}
                      className="px-3 py-1.5 rounded-lg bg-violet-600/80 hover:bg-violet-500 text-white text-xs font-medium"
                    >
                      Create short
                    </a>
                  </>
                )}
                {t.status === 'rejected' && (
                  <span className="text-xs text-slate-600">Rejected</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
