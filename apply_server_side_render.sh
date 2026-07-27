mkdir -p src/lib src/app/api/generate-and-upload

cat > package.json << 'EOF_PACKAGE_JSON'
{
  "name": "youtube-studio",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  },
  "dependencies": {
    "@ffmpeg-installer/ffmpeg": "^1.1.0",
    "@ffmpeg/ffmpeg": "^0.12.15",
    "@ffmpeg/util": "^0.12.2",
    "googleapis": "^173.0.0",
    "msedge-tts": "^2.0.7",
    "next": "16.2.10",
    "next-auth": "^4.24.14",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "sharp": "^0.33.5"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.10",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
EOF_PACKAGE_JSON

cat > next.config.ts << 'EOF_NEXT_CONFIG_TS'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
};

export default nextConfig;
EOF_NEXT_CONFIG_TS

cat > src/app/page.js << 'EOF_SRC_APP_PAGE_JS'
"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

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
  const [uploadedVideoId, setUploadedVideoId] = useState(null);
  const [videoBgImageUrl, setVideoBgImageUrl] = useState("");
  const [useVideoClips, setUseVideoClips] = useState(false);
  const [tagsStr, setTagsStr] = useState("");
  const [suggestingMeta, setSuggestingMeta] = useState(false);
  const [suggestMetaStatus, setSuggestMetaStatus] = useState("");

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

  return (
    <main style={{ padding: "2rem", textAlign: "center", maxWidth: "500px", margin: "0 auto" }}>
      <h1>استودیوی یوتیوب</h1>

      {session ? (
        <div>
          <p>سلام {session.user.name}</p>
          <img
            src={session.user.image}
            alt="profile"
            style={{ borderRadius: "50%", width: "60px" }}
          />
          <br />
          <button onClick={() => signOut()} style={{ marginBottom: "2rem" }}>
            خروج
          </button>

          <div
            style={{
              border: "2px solid #4CAF50",
              borderRadius: "8px",
              padding: "1rem",
              marginBottom: "1.5rem",
              textAlign: "left",
            }}
          >
            <h3 style={{ marginTop: 0 }}>ساخت خودکار ویدیو</h3>

            <div style={{ display: "flex", gap: "1rem", marginBottom: "0.75rem" }}>
              <label>
                <input
                  type="radio"
                  name="videoMode"
                  checked={videoMode === "long"}
                  onChange={() => setVideoMode("long")}
                />{" "}
                لانگ (۵-۱۰ دقیقه، افقی)
              </label>
              <label>
                <input
                  type="radio"
                  name="videoMode"
                  checked={videoMode === "short"}
                  onChange={() => setVideoMode("short")}
                />{" "}
                شورت (۳۰-۶۰ ثانیه، عمودی)
              </label>
            </div>

            <input
              type="text"
              placeholder="موضوع ویدیو (اختیاری - خالی بذاری خودش یه موضوع تازه انتخاب می‌کنه)"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              style={{ width: "100%", marginBottom: "0.5rem" }}
            />
            <button
              type="button"
              onClick={handleGenerateScript}
              disabled={generatingScript}
              style={{ marginBottom: "0.5rem" }}
            >
              {generatingScript ? "در حال نوشتن..." : "✍️ بنویس سناریو"}
            </button>
            {scriptGenStatus && (
              <p style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                {scriptGenStatus}
              </p>
            )}

            <textarea
              placeholder="متن ویدیو رو اینجا بنویس (به انگلیسی)..."
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={5}
              style={{ width: "100%", marginBottom: "0.5rem" }}
            />
            <input
              type="text"
              placeholder="کلیدواژه‌ی جستجوی عکس (اختیاری - خالی بذاری خودکار حدس می‌زنه)"
              value={imageKeyword}
              onChange={(e) => setImageKeyword(e.target.value)}
              style={{ width: "100%", marginBottom: "0.5rem" }}
            />
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.85rem",
                marginBottom: "0.5rem",
              }}
            >
              <input
                type="checkbox"
                checked={useVideoClips}
                onChange={(e) => setUseVideoClips(e.target.checked)}
              />
              استفاده از کلیپ ویدیویی به‌جای عکس ثابت (حس زنده‌تر)
            </label>
            <button type="button" onClick={handleGenerateVoice} disabled={generatingVoice}>
              {generatingVoice ? "در حال ساخت صدا..." : "🔊 پیش‌شنیدن صدا"}
            </button>
            {voiceStatus && <p style={{ fontSize: "0.85rem" }}>{voiceStatus}</p>}
            {audioUrl && (
              <audio controls src={audioUrl} style={{ width: "100%", marginTop: "0.5rem" }} />
            )}
          </div>

          <button
            type="button"
            onClick={handleSuggestMetadata}
            disabled={suggestingMeta}
            style={{ marginBottom: "0.5rem" }}
          >
            {suggestingMeta
              ? "در حال پیشنهاد..."
              : "✨ پیشنهاد خودکار عنوان، توضیحات و تگ"}
          </button>
          {suggestMetaStatus && (
            <p style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
              {suggestMetaStatus}
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1rem", textAlign: "left" }}>
            <input
              type="text"
              placeholder="عنوان ویدیو"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              placeholder="توضیحات"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
            <input
              type="text"
              placeholder="تگ‌ها (با کاما جدا کن)"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
            />

            <select
              value={privacyStatus}
              onChange={(e) => setPrivacyStatus(e.target.value)}
            >
              <option value="private">خصوصی</option>
              <option value="unlisted">لیست نشده</option>
              <option value="public">عمومی</option>
            </select>

            <div>
              <label style={{ fontSize: "0.9rem" }}>
                زمان‌بندی انتشار (اختیاری):
              </label>
              <input
                type="datetime-local"
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
                style={{ width: "100%", marginTop: "0.3rem" }}
              />
              <p style={{ fontSize: "0.75rem", color: "#666" }}>
                اگه پر کنی، ویدیو به‌صورت خصوصی آپلود می‌شه و خودکار در این تاریخ/ساعت عمومی می‌شه.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGenerateAndUpload}
            disabled={generatingVideo}
            style={{
              width: "100%",
              fontWeight: "bold",
              padding: "0.75rem",
              marginBottom: "0.5rem",
              background: "#2196F3",
              color: "white",
              border: "none",
              borderRadius: "8px",
            }}
          >
            {generatingVideo
              ? "در حال پردازش روی سرور..."
              : "🚀 ساخت و آپلود خودکار (روی سرور)"}
          </button>
          {videoGenStatus && <p style={{ fontSize: "0.85rem" }}>{videoGenStatus}</p>}
          {generatingVideo && (
            <div style={{ width: "100%", background: "#eee", borderRadius: "8px", overflow: "hidden" }}>
              <div
                style={{
                  width: videoGenProgress + "%",
                  background: "#2196F3",
                  height: "10px",
                  transition: "width 0.2s",
                }}
              />
            </div>
          )}
          {uploadedVideoId && (
            <p style={{ marginTop: "0.5rem" }}>
              <a
                href={`https://www.youtube.com/watch?v=${uploadedVideoId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                ▶️ مشاهده‌ی ویدیو در یوتیوب
              </a>
            </p>
          )}

          <hr style={{ margin: "2rem 0" }} />
          <p style={{ fontSize: "0.85rem", color: "#666" }}>
            یا یک فایل ویدیوی آماده رو دستی آپلود کن:
          </p>

          <input
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files[0])}
            style={{ marginBottom: "1rem" }}
          />

          <div
            style={{
              border: "1px solid #ccc",
              borderRadius: "8px",
              padding: "1rem",
              marginBottom: "1.5rem",
              textAlign: "left",
            }}
          >
            <h3 style={{ marginTop: 0 }}>برش ویدیو (اختیاری - داخل مرورگر انجام می‌شه)</h3>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: "0.85rem" }}>شروع (ثانیه)</label>
                <input
                  type="number"
                  min="0"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: "0.85rem" }}>مدت (ثانیه)</label>
                <input
                  type="number"
                  min="1"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
            </div>
            <button type="button" onClick={handleTrim} disabled={trimming}>
              {trimming ? "در حال برش..." : "برش بزن"}
            </button>
            {trimStatus && <p style={{ fontSize: "0.85rem" }}>{trimStatus}</p>}
          </div>

          <form onSubmit={handleUpload}>
            <button type="submit" disabled={uploading} style={{ width: "100%" }}>
              {uploading ? "در حال آپلود... " + progress + "%" : "آپلود دستی در یوتیوب"}
            </button>

            {uploading && (
              <div style={{ width: "100%", background: "#eee", borderRadius: "8px", overflow: "hidden" }}>
                <div
                  style={{
                    width: progress + "%",
                    background: "#4CAF50",
                    height: "10px",
                    transition: "width 0.2s",
                  }}
                />
              </div>
            )}
          </form>

          {status && <p style={{ marginTop: "1rem" }}>{status}</p>}
        </div>
      ) : (
        <button onClick={() => signIn("google")}>ورود با گوگل</button>
      )}
    </main>
  );
}
EOF_SRC_APP_PAGE_JS

cat > src/lib/media.js << 'EOF_SRC_LIB_MEDIA_JS'
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "to", "of", "in", "on", "at", "for", "with", "by", "from",
  "as", "that", "this", "these", "those", "it", "its", "i", "you", "he",
  "she", "we", "they", "them", "his", "her", "our", "your", "their", "not",
  "no", "so", "if", "then", "than", "too", "very", "can", "will", "just",
  "about", "into", "over", "after", "before", "up", "down", "out", "off",
  "again", "there", "here", "what", "when", "where", "why", "how", "all",
  "any", "both", "each", "few", "more", "most", "other", "some", "such",
  "only", "own", "same", "also",
]);

export function extractKeywords(text, count = 4) {
  const words = (text || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([w]) => w)
    .join(" ");
}

function pickVideoFile(videoFiles, isPortrait) {
  const mp4s = (videoFiles || []).filter((f) => f.file_type === "video/mp4");
  if (mp4s.length === 0) return null;

  const longEdge = (f) => (isPortrait ? f.height : f.width);

  const atLeastHD = mp4s
    .filter((f) => longEdge(f) >= 1280)
    .sort((a, b) => longEdge(a) - longEdge(b));
  if (atLeastHD.length > 0) return atLeastHD[0];

  return mp4s.sort((a, b) => longEdge(b) - longEdge(a))[0];
}

function resolveQueryAndOrientation({ text, keyword, orientation }) {
  const query = (keyword && keyword.trim()) || extractKeywords(text) || "nature";
  const safeOrientation = orientation === "portrait" ? "portrait" : "landscape";
  return { query, safeOrientation };
}

export async function fetchImages({ text, keyword, count, orientation }) {
  const perPage = Math.min(Math.max(parseInt(count) || 6, 1), 40);
  const { query, safeOrientation } = resolveQueryAndOrientation({
    text,
    keyword,
    orientation,
  });

  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(
      query
    )}&per_page=${perPage}&orientation=${safeOrientation}`,
    { headers: { Authorization: process.env.PEXELS_API_KEY } }
  );
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "خطا در دریافت عکس از Pexels");
  }

  const images = (data.photos || []).map((p) => p.src.large2x);

  if (images.length === 0) {
    throw new Error("عکسی برای این موضوع پیدا نشد، متن دیگه‌ای امتحان کن");
  }

  return { query, images };
}

export async function fetchClips({ text, keyword, count, orientation }) {
  const perPage = Math.min(Math.max(parseInt(count) || 6, 1), 30);
  const { query, safeOrientation } = resolveQueryAndOrientation({
    text,
    keyword,
    orientation,
  });

  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(
      query
    )}&per_page=${perPage}&orientation=${safeOrientation}`,
    { headers: { Authorization: process.env.PEXELS_API_KEY } }
  );
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "خطا در دریافت کلیپ از Pexels");
  }

  const clips = (data.videos || [])
    .map((v) => pickVideoFile(v.video_files, safeOrientation === "portrait"))
    .filter(Boolean)
    .map((f) => f.link);

  if (clips.length === 0) {
    throw new Error("کلیپی برای این موضوع پیدا نشد، متن دیگه‌ای امتحان کن");
  }

  return { query, clips };
}
EOF_SRC_LIB_MEDIA_JS

cat > src/lib/scriptTiming.js << 'EOF_SRC_LIB_SCRIPTTIMING_JS'
export function splitSentences(text) {
  return (text.match(/[^.!?]+[.!?]*/g) || [text])
    .map((s) => s.trim())
    .filter(Boolean);
}

export function distributeDurations(script, imageCount, totalDuration) {
  const sentences = splitSentences(script);
  const wordCounts = sentences.map(
    (s) => s.split(/\s+/).filter(Boolean).length || 1
  );
  const totalWords = wordCounts.reduce((a, b) => a + b, 0) || 1;

  const buckets = new Array(imageCount).fill(0);
  const bucketText = new Array(imageCount).fill("");
  let acc = 0;
  let bucketIndex = 0;
  for (let i = 0; i < sentences.length; i++) {
    acc += wordCounts[i];
    buckets[bucketIndex] += wordCounts[i];
    bucketText[bucketIndex] += (bucketText[bucketIndex] ? " " : "") + sentences[i];
    const shareSoFar = acc / totalWords;
    if (
      shareSoFar >= (bucketIndex + 1) / imageCount &&
      bucketIndex < imageCount - 1
    ) {
      bucketIndex++;
    }
  }

  const minShare = 0.4 / imageCount;
  let shares = buckets.map((w) => Math.max(w / totalWords, minShare));
  const shareSum = shares.reduce((a, b) => a + b, 0);
  shares = shares.map((s) => s / shareSum);

  return {
    durations: shares.map((s) => totalDuration * s),
    captions: bucketText,
  };
}

export function escapeDrawtext(text) {
  return text
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

export function wrapCaption(text, maxCharsPerLine) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? current + " " + w : w;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.join("\\n");
}
EOF_SRC_LIB_SCRIPTTIMING_JS

cat > src/lib/videoRender.js << 'EOF_SRC_LIB_VIDEORENDER_JS'
import { spawn } from "child_process";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { distributeDurations, escapeDrawtext, wrapCaption } from "./scriptTiming";

const ffmpegPath = ffmpegInstaller.path;

// msedge-tts is requested at a fixed 48kbps CBR mono mp3, so duration can be
// computed directly from the file size without needing ffprobe.
function estimateAudioDurationSec(audioBuffer) {
  return audioBuffer.length / 6000; // 48000 bits/s = 6000 bytes/s
}

function parseTimeToSeconds(str) {
  const m = str.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (!m) return null;
  const [, hh, mm, ss, cs] = m;
  return (
    parseInt(hh) * 3600 + parseInt(mm) * 60 + parseInt(ss) + parseInt(cs) / 100
  );
}

function runFfmpeg(args, totalDurationSec, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderrTail = "";

    proc.stderr.on("data", (chunk) => {
      const str = chunk.toString();
      stderrTail = (stderrTail + str).slice(-4000);
      const t = parseTimeToSeconds(str);
      if (t !== null && totalDurationSec > 0 && onProgress) {
        onProgress(Math.max(0, Math.min(1, t / totalDurationSec)));
      }
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail}`));
    });
  });
}

export async function renderVideo({
  script,
  videoMode,
  useVideoClips,
  mediaItems,
  audioBuffer,
  onStatus,
  onProgress,
}) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "render-"));

  try {
    const isShort = videoMode === "short";
    const W = isShort ? 720 : 1280;
    const H = isShort ? 1280 : 720;
    const N = mediaItems.length;

    const audioDurationSec = estimateAudioDurationSec(audioBuffer);
    const { durations: perImageDurations, captions } = distributeDurations(
      script,
      N,
      audioDurationSec
    );

    onStatus && onStatus(`در حال دانلود ${N} فایل رسانه...`);
    const mediaExt = useVideoClips ? "mp4" : "jpg";
    const mediaPaths = [];
    for (let i = 0; i < N; i++) {
      const res = await fetch(mediaItems[i]);
      if (!res.ok) throw new Error(`دانلود رسانه ${i + 1} ناموفق بود`);
      const buf = Buffer.from(await res.arrayBuffer());
      const filePath = path.join(tmpDir, `media${i}.${mediaExt}`);
      await fsp.writeFile(filePath, buf);
      mediaPaths.push(filePath);
      onProgress && onProgress((i + 1) / N / 4); // media download ~= first quarter
    }

    const audioPath = path.join(tmpDir, "narration.mp3");
    await fsp.writeFile(audioPath, audioBuffer);

    const fontPath = path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf");
    const outputPath = path.join(tmpDir, "output.mp4");

    const skipZoom = useVideoClips || !isShort;
    const FADE = Math.min(0.5, Math.min(...perImageDurations) / 3);
    const compensation = (FADE * (N - 1)) / N;
    const clipDurations = perImageDurations.map((d) => d + compensation);

    const args = [];
    for (let i = 0; i < N; i++) {
      if (useVideoClips) {
        args.push(
          "-stream_loop", "-1",
          "-t", clipDurations[i].toFixed(2),
          "-i", mediaPaths[i]
        );
      } else {
        args.push(
          "-loop", "1",
          "-framerate", "25",
          "-t", clipDurations[i].toFixed(2),
          "-i", mediaPaths[i]
        );
      }
    }
    args.push("-i", audioPath);
    const musicIdx = N + 1;
    args.push(
      "-f", "lavfi",
      "-i",
      `aevalsrc=0.05*sin(2*PI*110*t)+0.035*sin(2*PI*164.81*t)+0.025*sin(2*PI*220*t):s=44100:d=${audioDurationSec.toFixed(
        2
      )}`
    );

    let filter = "";
    for (let i = 0; i < N; i++) {
      const captionText = wrapCaption(escapeDrawtext(captions[i] || ""), isShort ? 22 : 38);
      const visualChain = skipZoom
        ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=25`
        : `scale=900:1600:force_original_aspect_ratio=increase,` +
          `crop=900:1600,` +
          `zoompan=z='min(zoom+0.0012,1.25)':d=1:` +
          `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=720x1280:fps=25`;
      filter +=
        `[${i}:v]${visualChain},` +
        `format=yuv420p,setsar=1,` +
        `drawtext=fontfile=${fontPath}:text='${captionText}':fontsize=44:` +
        `fontcolor=white:borderw=3:bordercolor=black@0.8:box=1:` +
        `boxcolor=black@0.35:boxborderw=18:x=(w-text_w)/2:y=h-th-70:` +
        `line_spacing=10[v${i}];`;
    }

    let finalLabel = "v0";
    if (N > 1) {
      let cumulative = clipDurations[0];
      let prevLabel = "v0";
      for (let i = 1; i < N; i++) {
        const offset = cumulative - FADE;
        const outLabel = `x${i}`;
        filter += `[${prevLabel}][v${i}]xfade=transition=fade:duration=${FADE.toFixed(
          2
        )}:offset=${offset.toFixed(2)}[${outLabel}];`;
        cumulative = cumulative + clipDurations[i] - FADE;
        prevLabel = outLabel;
      }
      finalLabel = prevLabel;
    }

    const audioMixFilter = `[${N}:a][${musicIdx}:a]amix=inputs=2:duration=first:normalize=0[aout]`;
    filter = filter.replace(/;$/, "") + ";" + audioMixFilter;

    args.push("-filter_complex", filter);
    args.push("-map", `[${finalLabel}]`);
    args.push("-map", "[aout]");
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-b:v", "2500k");
    args.push("-c:a", "aac", "-b:a", "128k");
    args.push("-shortest");
    args.push("-y", outputPath);

    onStatus && onStatus("در حال رندر نهایی ویدیو...");
    await runFfmpeg(args, audioDurationSec, (p) => {
      onProgress && onProgress(0.25 + p * 0.75); // render = remaining 75%
    });

    const outputBuffer = await fsp.readFile(outputPath);
    return outputBuffer;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
EOF_SRC_LIB_VIDEORENDER_JS

cat > src/app/api/generate-and-upload/route.js << 'EOF_SRC_APP_API_GENERATE-AND-UPLOAD_ROUTE_JS'
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { google } from "googleapis";
import { Readable } from "stream";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { fetchImages, fetchClips } from "../../../lib/media";
import { renderVideo } from "../../../lib/videoRender";
import { buildMayaThumbnail } from "../../../lib/mayaThumbnail";

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const body = await req.json();
  const {
    script,
    title,
    description,
    tags: tagsRaw,
    privacyStatus,
    publishAt,
    videoMode,
    useVideoClips,
    imageKeyword,
  } = body;

  if (!script || !script.trim()) {
    return NextResponse.json({ error: "متنی ارسال نشده" }, { status: 400 });
  }

  const accessToken = session.accessToken;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // کنترلر ممکنه از قبل بسته شده باشه؛ مهم نیست
        }
      };

      try {
        // --- ۱. ساخت صدا ---
        send({ status: "مرحله ۱ از ۵: در حال ساخت صدا...", progress: 2 });
        const tts = new MsEdgeTTS();
        await tts.setMetadata(
          "en-US-JennyNeural",
          OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
        );
        const { audioStream } = await tts.toStream(script);
        const chunks = [];
        for await (const chunk of audioStream) chunks.push(chunk);
        const audioBuffer = Buffer.concat(chunks);
        send({ status: "صدا ساخته شد ✅", progress: 8 });

        // --- ۲. گرفتن عکس/کلیپ ---
        const isShort = videoMode === "short";
        const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
        const estimatedSeconds = (wordCount / 140) * 60;
        const mediaCount = isShort
          ? 6
          : Math.min(24, Math.max(6, Math.ceil(estimatedSeconds / 15)));

        send({
          status: useVideoClips
            ? "مرحله ۲ از ۵: در حال گرفتن کلیپ ویدیویی..."
            : "مرحله ۲ از ۵: در حال گرفتن عکس...",
          progress: 10,
        });
        const orientation = isShort ? "portrait" : "landscape";
        const mediaResult = useVideoClips
          ? await fetchClips({
              text: script,
              keyword: imageKeyword,
              count: mediaCount,
              orientation,
            })
          : await fetchImages({
              text: script,
              keyword: imageKeyword,
              count: mediaCount,
              orientation,
            });
        const mediaItems = useVideoClips ? mediaResult.clips : mediaResult.images;
        const bgImageUrl = mediaItems[0] || "";
        send({ status: "رسانه‌ها آماده شد ✅", progress: 15 });

        // --- ۳. رندر ویدیو ---
        send({ status: "مرحله ۳ از ۵: در حال رندر ویدیو...", progress: 16 });
        const videoBuffer = await renderVideo({
          script,
          videoMode,
          useVideoClips,
          mediaItems,
          audioBuffer,
          onStatus: (s) => send({ status: "مرحله ۳ از ۵: " + s }),
          onProgress: (p) => send({ progress: 15 + p * 65 }),
        });
        send({ status: "ویدیو رندر شد ✅", progress: 80 });

        // --- ۴. آپلود در یوتیوب ---
        send({ status: "مرحله ۴ از ۵: در حال آپلود در یوتیوب...", progress: 85 });
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: accessToken });
        const youtube = google.youtube({ version: "v3", auth: oauth2Client });

        const tags = (tagsRaw || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);

        const uploadRes = await youtube.videos.insert({
          part: ["snippet", "status"],
          requestBody: {
            snippet: {
              title: title || "بدون عنوان",
              description: description || "",
              tags,
            },
            status: publishAt
              ? {
                  privacyStatus: "private",
                  publishAt: new Date(publishAt).toISOString(),
                }
              : { privacyStatus: privacyStatus || "private" },
          },
          media: { body: Readable.from(videoBuffer) },
        });
        const videoId = uploadRes.data.id;
        send({ status: "مرحله ۵ از ۵: در حال تنظیم تامبنیل...", progress: 92 });

        // --- ۵. تامبنیل ---
        let thumbnailStatus = "skipped";
        try {
          const thumbBuffer = await buildMayaThumbnail({ title, script, bgImageUrl });
          await youtube.thumbnails.set({
            videoId,
            media: { mimeType: "image/png", body: Readable.from(thumbBuffer) },
          });
          thumbnailStatus = "ok";
        } catch (thumbErr) {
          console.error("thumbnail error:", thumbErr.message);
          thumbnailStatus = "failed: " + thumbErr.message;
        }

        send({ done: true, videoId, thumbnailStatus, progress: 100 });
      } catch (err) {
        console.error("generate-and-upload error:", err);
        send({ error: err.message || "خطای نامشخص" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
EOF_SRC_APP_API_GENERATE-AND-UPLOAD_ROUTE_JS

cat > src/app/api/images/route.js << 'EOF_SRC_APP_API_IMAGES_ROUTE_JS'
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { fetchImages } from "../../../lib/media";

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { text, keyword, count, orientation } = await req.json();

  if (!text && !keyword) {
    return NextResponse.json({ error: "متنی ارسال نشده" }, { status: 400 });
  }

  try {
    const result = await fetchImages({ text, keyword, count, orientation });
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
EOF_SRC_APP_API_IMAGES_ROUTE_JS

cat > src/app/api/clips/route.js << 'EOF_SRC_APP_API_CLIPS_ROUTE_JS'
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { fetchClips } from "../../../lib/media";

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { text, keyword, count, orientation } = await req.json();

  if (!text && !keyword) {
    return NextResponse.json({ error: "متنی ارسال نشده" }, { status: 400 });
  }

  try {
    const result = await fetchClips({ text, keyword, count, orientation });
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
EOF_SRC_APP_API_CLIPS_ROUTE_JS

