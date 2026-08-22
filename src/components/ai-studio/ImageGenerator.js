"use client";

import { useState } from "react";

const PRESETS = [
  { id: "prompt", label: "🎨 عکس از پرامپت", prompt: "Generate a detailed, cinematic image prompt for the concept below. Include style, lighting, composition, mood. Return ONLY the image prompt, no explanations." },
  { id: "thumbnail", label: "🖼️ تامبنیل یوتیوب", prompt: "Design a YouTube thumbnail concept for the topic below. Describe: main visual, text overlay (max 4 words), color scheme, Maya pose suggestion, background. Return as structured description." },
  { id: "keywords", label: "🔍 کلمات کلیدی عکس", prompt: "Extract 5-8 visual search keywords for stock image search (Pexels/Unsplash) for the topic below. Optimize for cinematic, mindful aesthetic. Return as comma-separated list." },
];

// فیکسِ ۲۰۲۶-۰۸-۲۲ — این کامپوننت تو مرورگر اجرا می‌شه، جایی که Buffer
// (globalِ Node.js) اصلاً وجود نداره. وقتی provider عکس چیزی غیر از
// Pexels باشه (که URLِ مستقیم می‌ده)، نتیجه بایتِ خامه — و چون از
// سرور با JSON.stringify رد شده، شکلش {type:"Buffer", data:[...]}ه،
// نه یک Buffer واقعی و نه یک رشته‌ی base64. این تابع بدونِ نیاز به
// Buffer، خودِ آرایه‌ی بایت رو (تکه‌تکه، برای جلوگیری از سرریزِ استکِ
// String.fromCharCode رو آرایه‌های بزرگ) به base64 تبدیل می‌کنه.
function bytesToBase64(bufferLike) {
  const bytes = Array.isArray(bufferLike) ? bufferLike : bufferLike?.data || [];
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

export function ImageGenerator({ providers }) {
  const [preset, setPreset] = useState("prompt");
  const [topic, setTopic] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [provider, setProvider] = useState(providers[0]?.id || "");
  const [count, setCount] = useState(4);
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
      const res = await fetch("/api/ai/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, providerId: provider, count, orientation }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در تولید عکس");
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
            placeholder="توضیح مختصر برای عکس مورد نظر..."
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
            placeholder="پرامپت کامل تولید عکس..."
            required
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">تعداد</label>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="field-select">
            <option value="1">۱</option>
            <option value="2">۲</option>
            <option value="4">۴</option>
            <option value="6">۶</option>
            <option value="8">۸</option>
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
        {loading ? "⏳ در حال تولید..." : "تولید عکس"}
      </button>

      {error && <p className="text-danger text-sm">{error}</p>}

      {result && (
        <div className="card">
          <strong className="block mb-3">نتایج ({result.images?.length || 0} عکس)</strong>
          <div className="grid grid-cols-2 gap-3">
            {result.images?.map((img, i) => (
              <div key={i} className="relative group">
                {img.path ? (
                  <img src={img.path} alt={`Generated ${i + 1}`} className="w-full aspect-square object-cover rounded border border-border" />
                ) : img.buffer ? (
                  <img src={`data:image/${img.ext || "png"};base64,${bytesToBase64(img.buffer)}`} alt={`Generated ${i + 1}`} className="w-full aspect-square object-cover rounded border border-border" />
                ) : (
                  <div className="w-full aspect-square bg-surface-raised rounded border border-border flex items-center justify-center text-text-faint">نامعتبر</div>
                )}
                {(img.path || img.buffer) && (
                  <a
                    href={img.path || `data:image/${img.ext || "png"};base64,${bytesToBase64(img.buffer)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute bottom-2 right-2 btn-icon bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    title="دانلود"
                    download
                  >
                    ⬇️
                  </a>
                )}
              </div>
            ))}
          </div>
          {result.query && <p className="text-xs text-text-faint mt-2">جستجو: {result.query}</p>}
        </div>
      )}
    </div>
  );
}