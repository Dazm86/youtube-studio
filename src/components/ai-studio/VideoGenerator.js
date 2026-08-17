"use client";

import { useState } from "react";

const PRESETS = [
  { id: "keywords", label: "🔍 کلمات کلیدی کلیپ", prompt: "Extract 5-8 visual search keywords for stock video search (Pexels) for the topic below. Focus on cinematic, b-roll style footage. Return as comma-separated list." },
  { id: "broll", label: "🎬 لیست B-roll", prompt: "Create a shot list of 8-10 specific B-roll clips for a video on the topic below. Each line: brief visual description + suggested duration. Optimized for mindfulness/motivation content. Numbered list only." },
];

export function VideoGenerator({ providers }) {
  const [preset, setPreset] = useState("keywords");
  const [topic, setTopic] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [provider, setProvider] = useState(providers[0]?.id || "");
  const [count, setCount] = useState(6);
  const [orientation, setOrientation] = useState("landscape");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isCustom = preset === "custom";

  async function handleGenerate(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const prompt = isCustom ? customPrompt : `${PRESETS.find((p) => p.id === preset).prompt}\n\nTopic: "${topic.trim()}"`;
      const res = await fetch("/api/ai/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, providerId: provider, count, orientation }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در جستجوی کلیپ");
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="field-label">نوع تولید</label>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                preset === p.id
                  ? "bg-amber/20 border-amber text-amber"
                  : "border-border text-text-muted hover:bg-surface-raised"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPreset("custom")}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${
              preset === "custom"
                ? "bg-amber/20 border-amber text-amber"
                : "border-border text-text-muted hover:bg-surface-raised"
            }`}
          >
            ✏️ سفارشی
          </button>
        </div>
      </div>

      {!isCustom ? (
        <div>
          <label className="field-label">موضوع / ایده</label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            className="field-input"
            placeholder="موضوع ویدیو برای جستجوی کلیپ‌های مرتبط..."
            required
          />
        </div>
      ) : (
        <div>
          <label className="field-label">پرامپت کامل سفارشی</label>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            rows={6}
            className="field-input"
            placeholder="پرامپت کامل جستجوی ویدیو..."
            required
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">تعداد</label>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="field-select">
            <option value="4">۴</option>
            <option value="6">۶</option>
            <option value="8">۸</option>
            <option value="10">۱۰</option>
          </select>
        </div>
        <div>
          <label className="field-label">جهت</label>
          <select value={orientation} onChange={(e) => setOrientation(e.target.value)} className="field-select">
            <option value="landscape">منظره (۱۶:۹)</option>
            <option value="portrait">چهره (۹:۱۶)</option>
          </select>
        </div>
      </div>

      {providers.length > 1 && (
        <div>
          <label className="field-label">ارائه‌دهنده</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="field-select">
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.service})
              </option>
            ))}
          </select>
        </div>
      )}

      <button onClick={handleGenerate} disabled={loading || (!isCustom && !topic.trim()) || (isCustom && !customPrompt.trim())} className="btn-primary w-full">
        {loading ? "⏳ در حال جستجو..." : "جستجوی کلیپ"}
      </button>

      {error && <p className="text-danger text-sm">{error}</p>}

      {result && (
        <div className="card">
          <strong className="block mb-3">نتایج ({result.clips?.length || 0} کلیپ)</strong>
          <div className="grid grid-cols-2 gap-3">
            {result.clips?.map((clip, i) => (
              <div key={i} className="relative group">
                <video
                  src={clip.path}
                  className="w-full aspect-video object-cover rounded border border-border"
                  muted
                  preload="metadata"
                />
                <div className="absolute bottom-2 left-2 right-2 flex justify-between text-xs bg-black/60 text-white px-2 py-1 rounded">
                  <span>{Math.round(clip.durationSec || 0)}s</span>
                  <a href={clip.path} target="_blank" rel="noopener noreferrer" className="btn-icon" title="باز کردن در تب جدید">🔗</a>
                </div>
              </div>
            ))}
          </div>
          {result.query && <p className="text-xs text-text-faint mt-2">جستجو: {result.query}</p>}
        </div>
      )}
    </div>
  );
}