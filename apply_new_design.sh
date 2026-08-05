cat > src/app/globals.css << 'EOF_SRC_APP_GLOBALS_CSS'
@tailwind base;
@tailwind components;
@tailwind utilities;

@theme {
  --color-bg: #14120F;
  --color-surface: #1E1B17;
  --color-surface-raised: #262119;
  --color-border: #332E27;
  --color-border-light: #453E33;

  --color-amber: #E8963C;
  --color-amber-dim: #8A5D28;
  --color-teal: #4FB8AE;
  --color-teal-dim: #2E6E68;
  --color-danger: #E8674C;

  --color-text: #F2EEE7;
  --color-text-muted: #948C7E;
  --color-text-faint: #665D4E;

  --font-sans: var(--font-vazirmatn), system-ui, sans-serif;
  --font-mono: var(--font-mono-readout), ui-monospace, "SF Mono", Menlo, monospace;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
}

.readout {
  font-family: var(--font-mono);
  font-feature-settings: "tnum" 1;
  letter-spacing: 0.02em;
}

.label-plate {
  font-family: var(--font-mono);
  letter-spacing: 0.12em;
  font-size: 0.68rem;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

*:focus-visible {
  outline: 2px solid var(--color-amber);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
EOF_SRC_APP_GLOBALS_CSS

cat > src/app/layout.js << 'EOF_SRC_APP_LAYOUT_JS'
import "./globals.css";
import { Vazirmatn, JetBrains_Mono } from "next/font/google";
import Providers from "./providers";

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  variable: "--font-vazirmatn",
  display: "swap",
});

const monoReadout = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-readout",
  display: "swap",
});

export const metadata = {
  title: "The Mindful Path — استودیو",
  description: "استودیوی ساخت و انتشار خودکار ویدیو",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl" className={`${vazirmatn.variable} ${monoReadout.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
EOF_SRC_APP_LAYOUT_JS

cat > src/app/page.js << 'EOF_SRC_APP_PAGE_JS'
"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

function SegmentedBar({ percent }) {
  const segments = 24;
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * segments);
  return (
    <div className="flex gap-[3px] w-full" dir="ltr">
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className={`h-2 flex-1 rounded-[1px] transition-colors duration-300 ${
            i < filled ? "bg-amber" : "bg-surface-raised"
          }`}
        />
      ))}
    </div>
  );
}

function Panel({ index, title, children }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border">
        {index && <span className="label-plate text-amber">{index}</span>}
        <h2 className="label-plate">{title}</h2>
      </div>
      {children}
    </div>
  );
}

const inputCls =
  "w-full bg-surface-raised border border-border rounded-md px-3 py-2.5 text-text placeholder:text-text-faint focus:border-amber outline-none transition-colors";
const primaryBtnCls =
  "w-full bg-amber text-bg font-semibold rounded-md px-4 py-2.5 hover:bg-amber-dim disabled:opacity-35 disabled:cursor-not-allowed transition-colors";
const secondaryBtnCls =
  "w-full border border-border-light text-text rounded-md px-4 py-2.5 hover:border-amber hover:text-amber disabled:opacity-35 disabled:cursor-not-allowed transition-colors";
const statusCls = "readout text-xs text-text-muted mt-2";

export default function Home() {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.error === "RefreshAccessTokenError") {
      signOut({ redirect: false });
    }
  }, [session]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState("private");
  const [publishAt, setPublishAt] = useState("");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const [startTime, setStartTime] = useState("0");
  const [duration, setDuration] = useState("");
  const [trimming, setTrimming] = useState(false);
  const [trimStatus, setTrimStatus] = useState("");
  const ffmpegRef = useRef(null);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);

  function getFfmpeg() {
    if (!ffmpegRef.current) {
      ffmpegRef.current = new FFmpeg();
    }
    return ffmpegRef.current;
  }

  const [script, setScript] = useState("");
  const [topic, setTopic] = useState("");
  const [videoMode, setVideoMode] = useState("long");
  const [generatingScript, setGeneratingScript] = useState(false);
  const [scriptGenStatus, setScriptGenStatus] = useState("");
  const [imageKeyword, setImageKeyword] = useState("");
  const [generatingVoice, setGeneratingVoice] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioBlob, setAudioBlob] = useState(null);

  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoGenStatus, setVideoGenStatus] = useState("");
  const [videoGenProgress, setVideoGenProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const genStartRef = useRef(null);
  const [uploadedVideoId, setUploadedVideoId] = useState(null);
  const [videoBgImageUrl, setVideoBgImageUrl] = useState("");
  const [useVideoClips, setUseVideoClips] = useState(false);

  useEffect(() => {
    if (!generatingVideo) return;
    const interval = setInterval(() => {
      if (genStartRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - genStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [generatingVideo]);

  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }
  const [tagsStr, setTagsStr] = useState("");
  const [suggestingMeta, setSuggestingMeta] = useState(false);
  const [suggestMetaStatus, setSuggestMetaStatus] = useState("");
  const [syncingStats, setSyncingStats] = useState(false);
  const [syncStatsStatus, setSyncStatsStatus] = useState("");

  async function handleGenerateScript() {
    setGeneratingScript(true);
    setScriptGenStatus("در حال نوشتن سناریو...");
    try {
      const res = await fetch("/api/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, mode: videoMode }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "خطا در نوشتن سناریو");
      }
      setScript(data.script);
      setScriptGenStatus("سناریو نوشته شد ✅");
    } catch (err) {
      setScriptGenStatus("خطا: " + (err.message || "خطای نامشخص"));
    }
    setGeneratingScript(false);
  }

  async function handleGenerateVoice() {
    if (!script.trim()) {
      setVoiceStatus("اول متن رو بنویس");
      return;
    }

    setGeneratingVoice(true);
    setVoiceStatus("در حال ساخت صدا...");
    setAudioUrl(null);

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: script, voice: "en-US-JennyNeural" }),
      });

      if (!res.ok) {
        const errData = await res.json();
        setVoiceStatus("خطا: " + errData.error);
        setGeneratingVoice(false);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioBlob(blob);
      setAudioUrl(url);
      setVoiceStatus("صدا با موفقیت ساخته شد");
    } catch (err) {
      setVoiceStatus("خطا: " + err.message);
    }

    setGeneratingVoice(false);
  }

  // --- ساخت + آپلود خودکار: هر چیزی که سنگینه (صدا، رسانه، رندر FFmpeg،
  // آپلود) این‌بار روی خودِ سرور Render انجام می‌شه، نه داخل مرورگر گوشی.
  // این تابع فقط یک درخواست استریم‌شونده می‌فرسته و پیشرفت رو زنده نشون می‌ده.
  async function handleGenerateAndUpload() {
    if (!script.trim()) {
      setVideoGenStatus("اول متن رو بنویس");
      return;
    }

    setGeneratingVideo(true);
    setVideoGenProgress(0);
    setUploadedVideoId(null);
    setVideoGenStatus("در حال شروع پردازش روی سرور...");
    genStartRef.current = Date.now();
    setElapsedSeconds(0);

    let wakeLock = null;
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch {
      // مهم نیست اگه پشتیبانی نشه یا رد بشه
    }

    try {
      const res = await fetch("/api/generate-and-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script,
          title,
          description,
          tags: tagsStr,
          privacyStatus,
          publishAt,
          videoMode,
          useVideoClips,
          imageKeyword,
        }),
      });

      if (!res.ok || !res.body) {
        let errMsg = "خطا در شروع پردازش";
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch {
          // پاسخ JSON نبود
        }
        throw new Error(errMsg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalError = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          let obj;
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          if (obj.status) setVideoGenStatus(obj.status);
          if (typeof obj.progress === "number") {
            setVideoGenProgress(Math.round(obj.progress));
          }
          if (obj.error) {
            finalError = obj.error;
          }
          if (obj.done) {
            setUploadedVideoId(obj.videoId);
            setVideoGenProgress(100);
            setVideoGenStatus(
              "آپلود کامل شد ✅" +
                (obj.thumbnailStatus === "ok"
                  ? " (تامبنیل مایا هم ست شد)"
                  : " (تامبنیل ست نشد ⚠️ — احتمالاً کانال نیاز به تأیید شماره تلفن داره)")
            );
          }
        }
      }

      if (finalError) {
        throw new Error(finalError);
      }
    } catch (err) {
      console.error("generate-and-upload error:", err);
      setVideoGenStatus("خطا: " + (err.message || "خطای نامشخص"));
    }

    if (wakeLock) {
      try {
        await wakeLock.release();
      } catch {
        // مهم نیست
      }
    }
    setGeneratingVideo(false);
  }

  async function handleSyncStats() {
    setSyncingStats(true);
    setSyncStatsStatus("در حال گرفتن آمار از یوتیوب...");
    try {
      const res = await fetch("/api/sync-stats", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "خطا در به‌روزرسانی آمار");
      }
      setSyncStatsStatus(
        data.updated !== undefined
          ? `آمار ${data.updated} از ${data.total ?? data.updated} ویدیو به‌روز شد ✅`
          : data.message || "به‌روزرسانی انجام شد"
      );
    } catch (err) {
      setSyncStatsStatus("خطا: " + (err.message || "خطای نامشخص"));
    }
    setSyncingStats(false);
  }

  async function handleSuggestMetadata() {
    if (!script.trim()) {
      setSuggestMetaStatus("اول متن رو بنویس");
      return;
    }
    setSuggestingMeta(true);
    setSuggestMetaStatus("در حال پیشنهاد عنوان و تگ...");
    try {
      const res = await fetch("/api/suggest-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "خطا در دریافت پیشنهاد");
      }
      setTitle(data.title || "");
      setDescription(data.description || "");
      setTagsStr((data.tags || []).join(", "));
      setSuggestMetaStatus(
        data.source === "ai"
          ? "پیشنهاد با هوش مصنوعی ساخته شد ✅"
          : "پیشنهاد ساده ساخته شد (برای کیفیت بهتر، کلید Groq API رو تنظیم کن) ✅"
      );
    } catch (err) {
      setSuggestMetaStatus("خطا: " + (err.message || "خطای نامشخص"));
    }
    setSuggestingMeta(false);
  }

  // --- برش ویدیو دستی: هنوز داخل مرورگر (ffmpeg.wasm) انجام می‌شه، چون
  // فقط برای فایل‌هایی که خودت دستی انتخاب می‌کنی استفاده می‌شه، نه پایپ‌لاین
  // خودکار. همون محدودیت قبلی (بارگذاری موتور ~30 مگابایتی) هنوز اینجا هست.
  async function loadFFmpeg(onStatus) {
    const report = onStatus || setTrimStatus;
    if (ffmpegLoaded) return;
    report("در حال بارگذاری موتور ویدیو (فقط بار اول کمی طول می‌کشه)...");
    const ffmpeg = getFfmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await ffmpeg.load({
      coreURL: await toBlobURL(baseURL + "/ffmpeg-core.js", "text/javascript"),
      wasmURL: await toBlobURL(baseURL + "/ffmpeg-core.wasm", "application/wasm"),
    });
    setFfmpegLoaded(true);
    report("موتور آماده شد ✅");
  }

  async function handleTrim() {
    if (!file) {
      setTrimStatus("اول یک فایل ویدیو انتخاب کن");
      return;
    }
    if (!duration) {
      setTrimStatus("مدت زمان برش رو وارد کن");
      return;
    }

    setTrimming(true);
    try {
      await loadFFmpeg();
      setTrimStatus("در حال برش ویدیو...");

      const ffmpeg = getFfmpeg();
      const inputName = "input.mp4";
      const outputName = "output.mp4";

      await ffmpeg.writeFile(inputName, await fetchFile(file));

      await ffmpeg.exec([
        "-i", inputName,
        "-ss", String(startTime),
        "-t", String(duration),
        "-c", "copy",
        outputName,
      ]);

      const data = await ffmpeg.readFile(outputName);
      const trimmedBlob = new Blob([data.buffer], { type: "video/mp4" });
      const trimmedFile = new File([trimmedBlob], "trimmed.mp4", { type: "video/mp4" });

      setFile(trimmedFile);
      setTrimStatus("برش تموم شد، ویدیو آماده‌ی آپلوده");
    } catch (err) {
      setTrimStatus("خطا: " + err.message);
    }
    setTrimming(false);
  }

  function handleUpload(e) {
    e.preventDefault();
    if (!file) {
      setStatus("لطفاً یک فایل ویدیو انتخاب کن");
      return;
    }

    setUploading(true);
    setProgress(0);
    setStatus("در حال آپلود...");

    const formData = new FormData();
    formData.append("video", file);
    formData.append("title", title);
    formData.append("description", description);
    formData.append("privacyStatus", privacyStatus);
    formData.append("script", script);
    formData.append("bgImageUrl", videoBgImageUrl);
    formData.append("tags", tagsStr);
    if (publishAt) {
      formData.append("publishAt", publishAt);
    }

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setProgress(percent);
      }
    });

    xhr.onload = () => {
      setUploading(false);
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.success) {
          const thumbNote =
            data.thumbnailStatus === "ok"
              ? " (تامبنیل مایا هم ست شد ✅)"
              : data.thumbnailStatus && data.thumbnailStatus.startsWith("failed")
              ? " (تامبنیل ست نشد ⚠️ — احتمالاً کانال نیاز به تأیید شماره تلفن داره)"
              : "";
          setStatus("آپلود موفق! شناسه ویدیو: " + data.videoId + thumbNote);
        } else {
          setStatus("خطا: " + data.error);
        }
      } catch {
        setStatus("خطای ناشناخته سرور");
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setStatus("خطای اتصال");
    };

    xhr.open("POST", "/api/upload");
    xhr.send(formData);
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-bg text-text flex flex-col items-center justify-center px-6 gap-6">
        <div className="text-center">
          <p className="label-plate text-teal mb-2">THE MINDFUL PATH — STUDIO</p>
          <h1 className="text-2xl font-bold">استودیوی یوتیوب</h1>
        </div>
        <button
          onClick={() => signIn("google")}
          className="bg-amber text-bg font-semibold rounded-md px-6 py-3 hover:bg-amber-dim transition-colors"
        >
          ورود با گوگل
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-text px-4 py-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-border">
        <div>
          <p className="label-plate text-teal">THE MINDFUL PATH — STUDIO</p>
          <p className="text-sm text-text-muted mt-0.5">{session.user.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <img src={session.user.image} alt="" className="w-9 h-9 rounded-full border border-border-light" />
          <button
            onClick={() => signOut()}
            className="text-xs text-text-muted hover:text-amber border border-border rounded px-2.5 py-1.5 transition-colors"
          >
            خروج
          </button>
        </div>
      </div>

      <Panel index="01" title="سناریو">
        <div className="flex gap-2 mb-3">
          <label
            className={`flex-1 text-center text-sm rounded-md py-2 border cursor-pointer transition-colors ${
              videoMode === "long"
                ? "border-amber text-amber bg-amber/10"
                : "border-border text-text-muted"
            }`}
          >
            <input
              type="radio"
              name="videoMode"
              className="hidden"
              checked={videoMode === "long"}
              onChange={() => setVideoMode("long")}
            />
            لانگ (۵-۱۰ دقیقه)
          </label>
          <label
            className={`flex-1 text-center text-sm rounded-md py-2 border cursor-pointer transition-colors ${
              videoMode === "short"
                ? "border-amber text-amber bg-amber/10"
                : "border-border text-text-muted"
            }`}
          >
            <input
              type="radio"
              name="videoMode"
              className="hidden"
              checked={videoMode === "short"}
              onChange={() => setVideoMode("short")}
            />
            شورت (۳۰-۶۰ ثانیه)
          </label>
        </div>

        <input
          type="text"
          placeholder="موضوع ویدیو (اختیاری — خالی بذاری خودش انتخاب می‌کنه)"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className={`${inputCls} mb-2`}
        />
        <button type="button" onClick={handleGenerateScript} disabled={generatingScript} className={secondaryBtnCls}>
          {generatingScript ? "در حال نوشتن..." : "✍️ بنویس سناریو"}
        </button>
        {scriptGenStatus && <p className={statusCls}>{scriptGenStatus}</p>}

        <textarea
          placeholder="متن ویدیو رو اینجا بنویس (به انگلیسی)..."
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={5}
          className={`${inputCls} mt-3 mb-2`}
        />
        <input
          type="text"
          placeholder="کلیدواژه‌ی جستجوی عکس (اختیاری)"
          value={imageKeyword}
          onChange={(e) => setImageKeyword(e.target.value)}
          className={`${inputCls} mb-2`}
        />
        <label className="flex items-center gap-2 text-sm text-text-muted mb-3">
          <input
            type="checkbox"
            checked={useVideoClips}
            onChange={(e) => setUseVideoClips(e.target.checked)}
            className="accent-amber"
          />
          استفاده از کلیپ ویدیویی به‌جای عکس ثابت
        </label>
        <button type="button" onClick={handleGenerateVoice} disabled={generatingVoice} className={secondaryBtnCls}>
          {generatingVoice ? "در حال ساخت صدا..." : "🔊 پیش‌شنیدن صدا"}
        </button>
        {voiceStatus && <p className={statusCls}>{voiceStatus}</p>}
        {audioUrl && <audio controls src={audioUrl} className="w-full mt-2" />}
      </Panel>

      <button
        type="button"
        onClick={handleSuggestMetadata}
        disabled={suggestingMeta}
        className={`${secondaryBtnCls} mb-4`}
      >
        {suggestingMeta ? "در حال پیشنهاد..." : "✨ پیشنهاد خودکار عنوان، توضیحات و تگ"}
      </button>
      {suggestMetaStatus && <p className={`${statusCls} -mt-3 mb-4`}>{suggestMetaStatus}</p>}

      <Panel index="02" title="متادیتا">
        <input
          type="text"
          placeholder="عنوان ویدیو"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={`${inputCls} mb-2`}
        />
        <textarea
          placeholder="توضیحات"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className={`${inputCls} mb-2`}
        />
        <input
          type="text"
          placeholder="تگ‌ها (با کاما جدا کن)"
          value={tagsStr}
          onChange={(e) => setTagsStr(e.target.value)}
          className={`${inputCls} mb-2`}
        />
        <select
          value={privacyStatus}
          onChange={(e) => setPrivacyStatus(e.target.value)}
          className={`${inputCls} mb-2`}
        >
          <option value="private">خصوصی</option>
          <option value="unlisted">لیست نشده</option>
          <option value="public">عمومی</option>
        </select>
        <label className="block text-sm text-text-muted mb-1">زمان‌بندی انتشار (اختیاری)</label>
        <input
          type="datetime-local"
          value={publishAt}
          onChange={(e) => setPublishAt(e.target.value)}
          className={inputCls}
        />
        <p className="text-xs text-text-faint mt-1.5">
          اگه پر کنی، ویدیو به‌صورت خصوصی آپلود و خودکار در این تاریخ/ساعت عمومی می‌شه.
        </p>
      </Panel>

      <Panel index="03" title="ساخت و آپلود">
        <button type="button" onClick={handleGenerateAndUpload} disabled={generatingVideo} className={primaryBtnCls}>
          {generatingVideo ? "در حال پردازش روی سرور..." : "🚀 ساخت و آپلود خودکار (روی سرور)"}
        </button>

        {(videoGenStatus || generatingVideo) && (
          <div className="mt-4">
            <SegmentedBar percent={videoGenProgress} />
            <div className="flex items-center justify-between mt-2">
              <span className="readout text-xs text-text-muted">
                {generatingVideo ? formatDuration(elapsedSeconds) : ""}
                {generatingVideo && videoGenProgress > 3
                  ? ` / ~${formatDuration((elapsedSeconds / videoGenProgress) * 100)}`
                  : ""}
              </span>
              <span className="readout text-xs text-amber">
                {generatingVideo ? `${videoGenProgress}%` : ""}
              </span>
            </div>
            {videoGenStatus && <p className={statusCls}>{videoGenStatus}</p>}
          </div>
        )}

        {uploadedVideoId && (
          <a
            href={`https://www.youtube.com/watch?v=${uploadedVideoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-teal text-sm mt-3 hover:underline"
          >
            ▶️ مشاهده‌ی ویدیو در یوتیوب
          </a>
        )}
      </Panel>

      <button type="button" onClick={handleSyncStats} disabled={syncingStats} className={`${secondaryBtnCls} mb-2`}>
        {syncingStats ? "در حال دریافت آمار..." : "🔄 به‌روزرسانی آمار واقعی ویدیوها"}
      </button>
      {syncStatsStatus && <p className={`${statusCls} mb-6`}>{syncStatsStatus}</p>}

      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-border" />
        <span className="label-plate">یا آپلود دستی</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <Panel index="04" title="فایل آماده">
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setFile(e.target.files[0])}
          className="w-full text-sm text-text-muted mb-4 file:mr-3 file:rounded-md file:border file:border-border-light file:bg-surface-raised file:text-text file:px-3 file:py-1.5"
        />

        <div className="border border-border rounded-md p-3 mb-4">
          <p className="label-plate mb-2">برش ویدیو (اختیاری — داخل مرورگر)</p>
          <div className="flex gap-2 mb-2">
            <div className="flex-1">
              <label className="text-xs text-text-muted">شروع (ثانیه)</label>
              <input
                type="number"
                min="0"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-text-muted">مدت (ثانیه)</label>
              <input
                type="number"
                min="1"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <button type="button" onClick={handleTrim} disabled={trimming} className={secondaryBtnCls}>
            {trimming ? "در حال برش..." : "برش بزن"}
          </button>
          {trimStatus && <p className={statusCls}>{trimStatus}</p>}
        </div>

        <form onSubmit={handleUpload}>
          <button type="submit" disabled={uploading} className={primaryBtnCls}>
            {uploading ? `در حال آپلود... ${progress}%` : "آپلود دستی در یوتیوب"}
          </button>
          {uploading && (
            <div className="mt-3">
              <SegmentedBar percent={progress} />
            </div>
          )}
        </form>

        {status && <p className={`${statusCls} mt-3`}>{status}</p>}
      </Panel>
    </main>
  );
}
EOF_SRC_APP_PAGE_JS

