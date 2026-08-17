"use client";

import { useState } from "react";

const PRESETS = [
  { id: "script-long", label: "📄 اسکریپت لانگ‌فرم (۱۲۰۰+ کلمه)", prompt: "Write a spoken narration script for a long-form YouTube video (1200-1500 words) on the topic below. Structure: Hook + Root Cause, Symptoms, Real Story, Actionable Steps (3-5), Closing with personal question + subscribe nudge. First-person as Maya. No markdown. No emojis." },
  { id: "script-short", label: "⚡ اسکریپت شورت (۹۰-۱۳۰ کلمه)", prompt: "Write a spoken narration script for a YouTube Short (90-130 words, 30-60 sec). Structure: Hook (3 sec), Empathy (10 sec), Insight (30 sec), Closing with specific personal question + subtle subscribe nudge + callback to hook. First-person as Maya. No markdown. No emojis." },
  { id: "title", label: "🎯 عنوان جذاب", prompt: "Generate 5 click-worthy YouTube titles for the topic below. Varied styles: question, curiosity gap, benefit-driven, story-hint, contrarian. Return as numbered list only." },
  { id: "translate", label: "🌐 ترجمه", prompt: "Translate the text below to natural, conversational Persian. Keep the tone warm and personal. Return only the translation." },
  { id: "community", label: "📱 پست کامیونیتی", prompt: "Write an engaging YouTube Community post for the topic below. Friendly, conversational, ends with a question to drive comments. Include 3-5 relevant hashtags. Under 2000 chars." },
];

export function TextGenerator({ providers }) {
  const [preset, setPreset] = useState("script-long");
  const [topic, setTopic] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [provider, setProvider] = useState(providers[0]?.id || "");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedPreset = PRESETS.find((p) => p.id === preset);
  const isCustom = preset === "custom";

  async function handleGenerate(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult("");

    try {
      const prompt = isCustom ? customPrompt : `${selectedPreset.prompt}\n\nTopic: "${topic.trim()}"`;
      const res = await fetch("/api/ai/generate-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, providerId: provider, maxTokens: 3000, temperature: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در تولید متن");
      setResult(data.text);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      {/* Preset selector */}
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

      {/* Input */}
      {!isCustom ? (
        <div>
          <label className="field-label">موضوع / ورودی</label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            className="field-input"
            placeholder="موضوع ویدیو، متن برای ترجمه، یا هر ورودی دیگری..."
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
            placeholder="پرامپت کامل رو اینجا بنویس..."
            required
          />
        </div>
      )}

      {/* Provider selector */}
      {providers.length > 1 && (
        <div>
          <label className="field-label">ارائه‌دهنده (اولویت پیش‌فرض از تنظیمات)</label>
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
        {loading ? "⏳ در حال تولید..." : "تولید متن"}
      </button>

      {error && <p className="text-danger text-sm">{error}</p>}

      {result && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <strong>نتیجه</strong>
            <button
              onClick={() => navigator.clipboard.writeText(result)}
              className="btn-ghost text-xs"
              title="کپی"
            >
              📋 کپی
            </button>
          </div>
          <pre className="whitespace-pre-wrap text-sm bg-surface-raised p-3 rounded max-h-96 overflow-auto">{result}</pre>
        </div>
      )}
    </div>
  );
}