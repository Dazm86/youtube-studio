cat > src/app/page.js << 'EOF_PAGE_JS'
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
          {videoGenStatus && (
            <p style={{ fontSize: "0.85rem" }}>
              {videoGenStatus}
              {generatingVideo ? ` (${videoGenProgress}%)` : ""}
            </p>
          )}
          {generatingVideo && (
            <p style={{ fontSize: "0.8rem", color: "#666" }}>
              ⏱️ زمان سپری‌شده: {formatDuration(elapsedSeconds)}
              {videoGenProgress > 3 &&
                ` — تخمین باقی‌مونده: ~${formatDuration(
                  (elapsedSeconds / videoGenProgress) * (100 - videoGenProgress)
                )}`}
            </p>
          )}
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
EOF_PAGE_JS
