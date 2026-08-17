"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { TextGenerator } from "./TextGenerator";
import { ImageGenerator } from "./ImageGenerator";
import { VideoGenerator } from "./VideoGenerator";
import { AudioGenerator } from "./AudioGenerator";

const TABS = [
  { id: "text", label: "📝 متن", description: "اسکریپت، عنوان، ترجمه، پست" },
  { id: "image", label: "🖼️ عکس", description: "تولید عکس از متن، استوک" },
  { id: "video", label: "🎬 ویدیو", description: "کلیپ استوک، ویدیوهای کوتاه" },
  { id: "audio", label: "🔊 صدا", description: "تبدیل متن به گفتار (TTS)" },
];

export default function AIStudio() {
  const { data: session, status: sessionStatus } = useSession();
  const [activeTab, setActiveTab] = useState("text");
  const [providers, setProviders] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (session) loadProviders();
  }, [session]);

  async function loadProviders() {
    try {
      const res = await fetch("/api/providers");
      const data = await res.json();
      if (res.ok) {
        setProviders({
          text: data.providers?.filter((p) => p.capabilities.includes("text") && p.enabled) || [],
          image: data.providers?.filter((p) => p.capabilities.includes("image") && p.enabled) || [],
          video: data.providers?.filter((p) => p.capabilities.includes("video") && p.enabled) || [],
          audio: data.providers?.filter((p) => p.capabilities.includes("audio") && p.enabled) || [],
        });
      }
    } catch (err) {
      console.error("Failed to load providers:", err);
    }
    setLoading(false);
  }

  if (sessionStatus === "loading") return null;
  if (!session) {
    return (
      <main className="min-h-screen bg-bg text-text px-4 py-10 max-w-3xl mx-auto text-center">
        <p className="text-text-muted">برای استفاده از AI Studio باید وارد بشی.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-text px-4 py-6 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold mb-1">🎨 AI Studio</h1>
        <p className="text-text-muted">
          تولید محتوای هوش مصنوعی — متن، عکس، ویدیو و صدا با providerهای تنظیم‌شده
        </p>
      </header>

      {/* Tab Navigation */}
      <nav className="mb-4 flex gap-1 overflow-x-auto pb-2" aria-label="AI Studio tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm shrink-0 transition-colors ${
              activeTab === tab.id
                ? "bg-amber/20 text-amber border border-amber"
                : "text-text-muted hover:bg-surface-raised"
            }`}
            aria-current={activeTab === tab.id ? "page" : undefined}
          >
            <span>{tab.label}</span>
            <span className="text-xs text-text-faint hidden sm:inline">{tab.description}</span>
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-text-muted">در حال بارگذاری providerها...</div>
      ) : (
        <>
          {activeTab === "text" && (
            <TextGenerator providers={providers.text} />
          )}
          {activeTab === "image" && (
            <ImageGenerator providers={providers.image} />
          )}
          {activeTab === "video" && (
            <VideoGenerator providers={providers.video} />
          )}
          {activeTab === "audio" && (
            <AudioGenerator providers={providers.audio} />
          )}
        </>
      )}

      {/* Provider status hint */}
      {providers[activeTab]?.length === 0 && (
        <div className="mt-6 rounded-lg border border-amber-dim bg-amber/10 p-4 text-sm text-amber">
          <strong>⚠️ هیچ provider فعالی برای این نوع کار تنظیم نشده.</strong>
          <p className="mt-1">به صفحه <a href="/providers" className="underline hover:text-amber">ارائه‌دهنده‌های API</a> برو و برای "{TABS.find((t) => t.id === activeTab)?.label}" یک provider اضافه کن.
          </p>
        </div>
      )}
    </main>
  );
}