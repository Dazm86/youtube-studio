"use client";

import { useState, useEffect } from "react";

const VOICES = {
  "msedge-tts": [
    { id: "en-US-AriaNeural", label: "Aria (US, Female, Natural)" },
    { id: "en-US-JennyNeural", label: "Jenny (US, Female, Calm)" },
    { id: "en-US-GuyNeural", label: "Guy (US, Male)" },
    { id: "en-GB-LibbyNeural", label: "Libby (UK, Female)" },
    { id: "en-AU-NatashaNeural", label: "Natasha (AU, Female)" },
  ],
  openai: [
    { id: "alloy", label: "Alloy" },
    { id: "echo", label: "Echo" },
    { id: "fable", label: "Fable" },
    { id: "onyx", label: "Onyx" },
    { id: "nova", label: "Nova" },
    { id: "shimmer", label: "Shimmer" },
  ],
  elevenlabs: [
    { id: "JBFqnCBsd6RMkjVDRZzb", label: "Default (Multilingual v2)" },
  ],
};

export function AudioGenerator({ providers }) {
  const [text, setText] = useState("");
  const [provider, setProvider] = useState(providers[0]?.id || "");
  const [voice, setVoice] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const providerInfo = providers.find((p) => p.id === provider);
  const availableVoices = providerInfo ? VOICES[providerInfo.service] || [] : [];

  // فیکسِ ۲۰۲۶-۰۸-۲۲ — قبلاً اینجا useState(fn) بود، نه useEffect(fn,
  // deps). initializerِ useState فقط یک‌بار (موقعِ mount) اجرا می‌شه،
  // نه هر بار provider عوض بشه — یعنی بعد از سوییچِ provider (که voice
  // رو خالی می‌کنه)، این منطق دیگه هیچ‌وقت دوباره اجرا نمی‌شد و دکمه‌ی
  // تولید بدونِ دلیلِ واضح غیرفعال می‌موند.
  useEffect(() => {
    if (provider && availableVoices.length > 0 && !voice) {
      setVoice(availableVoices[0].id);
    }
  }, [provider, availableVoices, voice]);

  async function handleGenerate(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/ai/generate-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, providerId: provider, voice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در تولید صدا");
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="field-label">متن برای تبدیل به گفتار</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="field-input"
          placeholder="متن رو اینجا بنویس... (پیشنهاد: زیر ۵۰۰۰ کاراکتر برای سرعت بهتر)"
          required
        />
        <p className="text-xs text-text-faint mt-1">{text.length} کاراکتر</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">ارائه‌دهنده</label>
          <select value={provider} onChange={(e) => { setProvider(e.target.value); setVoice(""); }} className="field-select">
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.service})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">صدا</label>
          <select value={voice} onChange={(e) => setVoice(e.target.value)} className="field-select">
            {availableVoices.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>

      <button onClick={handleGenerate} disabled={loading || !text.trim() || !voice} className="btn-primary w-full">
        {loading ? "⏳ در حال تولید صدا..." : "تولید صدا"}
      </button>

      {error && <p className="text-danger text-sm">{error}</p>}

      {result && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <strong>فایل صوتی تولید شد</strong>
            <a
              href={result.audioUrl}
              download="tts-output.mp3"
              className="btn-primary text-sm"
            >
              ⬇️ دانلود MP3
            </a>
          </div>
          <audio controls src={result.audioUrl} className="w-full" />
          <p className="text-xs text-text-faint mt-2">
            مود: {result.mimeType} • سایز: ~{Math.round((result.size || 0) / 1024)} KB
          </p>
        </div>
      )}
    </div>
  );
}