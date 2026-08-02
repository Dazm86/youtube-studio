#!/bin/bash
# این اسکریپت سایت رو از یک صفحه‌ی تکی به ۴ صفحه تبدیل می‌کنه:
# /long (ویدیوی لانگ)، /short (ویدیوی شورت)، /api-check (بررسی API ها)، /analytics (آنالیز کانال)
# به‌همراه یک نوار ناوبری مشترک و صفحه‌ی اصلی جدید.
set -e

mkdir -p src/app
mkdir -p src/app/analytics
mkdir -p src/app/api-check
mkdir -p src/app/api/status
mkdir -p src/app/api/status/groq
mkdir -p src/app/api/status/pexels
mkdir -p src/app/api/status/youtube
mkdir -p src/app/api/videos
mkdir -p src/app/long
mkdir -p src/app/short
mkdir -p src/components
mkdir -p src/lib

cat > src/lib/db.js << 'EOF_SRC_LIB_DB_JS'
import { Pool } from "pg";

let pool = null;
let schemaReady = null;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL تنظیم نشده");
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(`
      CREATE TABLE IF NOT EXISTS videos (
        id SERIAL PRIMARY KEY,
        video_id TEXT NOT NULL,
        title TEXT,
        script TEXT,
        video_mode TEXT,
        use_video_clips BOOLEAN,
        image_keyword TEXT,
        views INTEGER,
        subscribers_gained INTEGER,
        likes INTEGER,
        avg_view_duration_sec NUMERIC,
        stats_updated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
  }
  await schemaReady;
}

export async function getDbStatus() {
  if (!process.env.DATABASE_URL) {
    return { connected: false, error: "DATABASE_URL تنظیم نشده" };
  }
  try {
    await ensureSchema();
    const countRes = await getPool().query("SELECT COUNT(*) FROM videos");
    const lastRes = await getPool().query(
      "SELECT video_id, title, created_at FROM videos ORDER BY created_at DESC LIMIT 3"
    );
    return {
      connected: true,
      videoCount: parseInt(countRes.rows[0].count, 10),
      lastVideos: lastRes.rows,
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

export async function recordVideo({
  videoId,
  title,
  script,
  videoMode,
  useVideoClips,
  imageKeyword,
}) {
  try {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO videos (video_id, title, script, video_mode, use_video_clips, image_keyword)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [videoId, title || "", script || "", videoMode || "", !!useVideoClips, imageKeyword || ""]
    );
  } catch (err) {
    // ثبت آمار هیچ‌وقت نباید کل فرایند آپلود رو خراب کنه
    console.error("recordVideo failed:", err.message);
  }
}

export async function getAllVideoIds() {
  await ensureSchema();
  const res = await getPool().query("SELECT DISTINCT video_id FROM videos");
  return res.rows.map((r) => r.video_id);
}

// برای صفحه‌ی «آنالیز کانال» — لیست کامل ویدیوها به‌همراه آمارشون.
export async function getAllVideos() {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT video_id, title, video_mode, use_video_clips, image_keyword,
            views, subscribers_gained, likes, avg_view_duration_sec,
            stats_updated_at, created_at
     FROM videos
     ORDER BY created_at DESC
     LIMIT 200`
  );
  return res.rows;
}

export async function updateVideoStats(videoId, stats) {
  await ensureSchema();
  await getPool().query(
    `UPDATE videos
     SET views = $2, subscribers_gained = $3, likes = $4,
         avg_view_duration_sec = $5, stats_updated_at = now()
     WHERE video_id = $1`,
    [
      videoId,
      stats.views ?? 0,
      stats.subscribersGained ?? 0,
      stats.likes ?? 0,
      stats.avgViewDurationSec ?? 0,
    ]
  );
}
EOF_SRC_LIB_DB_JS

cat > src/components/NavBar.js << 'EOF_SRC_COMPONENTS_NAVBAR_JS'
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";

const NAV_ITEMS = [
  { href: "/", label: "خانه" },
  { href: "/long", label: "ویدیوی لانگ" },
  { href: "/short", label: "ویدیوی شورت" },
  { href: "/api-check", label: "بررسی API ها" },
  { href: "/analytics", label: "آنالیز کانال" },
];

export default function NavBar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  // اگه توکن گوگل منقضی و قابل تمدید نبود، خودکار خارج کن — این چک
  // قبلاً توی صفحه‌ی اصلی بود، الان چون NavBar توی همه‌ی صفحه‌ها هست
  // یک‌بار برای همیشه اینجا انجام می‌شه.
  useEffect(() => {
    if (session?.error === "RefreshAccessTokenError") {
      signOut({ redirect: false });
    }
  }, [session]);

  return (
    <header style={{ borderBottom: "1px solid #ddd", marginBottom: "1.5rem" }}>
      <div style={{ maxWidth: "700px", margin: "0 auto", padding: "0.75rem 1rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <Link
            href="/"
            style={{ fontWeight: "bold", fontSize: "1.1rem", textDecoration: "none", color: "#222" }}
          >
            🎬 استودیوی یوتیوب
          </Link>

          {session ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <img
                src={session.user.image}
                alt="profile"
                style={{ borderRadius: "50%", width: "28px", height: "28px" }}
              />
              <span style={{ fontSize: "0.85rem" }}>{session.user.name}</span>
              <button onClick={() => signOut()} style={{ fontSize: "0.8rem" }}>
                خروج
              </button>
            </div>
          ) : (
            <button onClick={() => signIn("google")} style={{ fontSize: "0.85rem" }}>
              ورود با گوگل
            </button>
          )}
        </div>

        {session && (
          <nav style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    fontSize: "0.8rem",
                    padding: "0.3rem 0.6rem",
                    borderRadius: "6px",
                    textDecoration: "none",
                    color: active ? "#fff" : "#333",
                    background: active ? "#2196F3" : "#f0f0f0",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
EOF_SRC_COMPONENTS_NAVBAR_JS

cat > src/components/HomeDashboard.js << 'EOF_SRC_COMPONENTS_HOMEDASHBOARD_JS'
"use client";

import Link from "next/link";
import { useSession, signIn } from "next-auth/react";

const SECTIONS = [
  {
    href: "/long",
    emoji: "🎬",
    title: "ویدیوی لانگ",
    desc: "نوشتن سناریو، ساخت صدا و رندر خودکار ویدیوی بلند افقی",
  },
  {
    href: "/short",
    emoji: "⚡",
    title: "ویدیوی شورت",
    desc: "ساخت خودکار شورت عمودی برای یوتیوب",
  },
  {
    href: "/api-check",
    emoji: "🔌",
    title: "بررسی API ها",
    desc: "وضعیت اتصال به گوگل، Groq، Pexels و دیتابیس",
  },
  {
    href: "/analytics",
    emoji: "📊",
    title: "آنالیز کانال",
    desc: "آمار واقعی بازدید، لایک و سابسکرایب ویدیوهای منتشرشده",
  },
];

export default function HomeDashboard() {
  const { data: session, status: sessionStatus } = useSession();

  if (sessionStatus === "loading") return null;

  if (!session) {
    return (
      <main style={{ padding: "2rem", textAlign: "center", maxWidth: "500px", margin: "0 auto" }}>
        <h1>استودیوی یوتیوب</h1>
        <p style={{ color: "#666" }}>برای شروع، اول با حساب گوگل وارد شو.</p>
        <button onClick={() => signIn("google")}>ورود با گوگل</button>
      </main>
    );
  }

  return (
    <main style={{ padding: "1rem", maxWidth: "700px", margin: "0 auto" }}>
      <h1 style={{ textAlign: "center" }}>سلام {session.user.name} 👋</h1>
      <p style={{ textAlign: "center", color: "#666", marginBottom: "1.5rem" }}>
        از یکی از بخش‌های زیر شروع کن:
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1rem",
        }}
      >
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            style={{
              display: "block",
              border: "1px solid #ddd",
              borderRadius: "10px",
              padding: "1.25rem",
              textDecoration: "none",
              color: "#222",
            }}
          >
            <div style={{ fontSize: "1.8rem" }}>{s.emoji}</div>
            <div style={{ fontWeight: "bold", margin: "0.4rem 0" }}>{s.title}</div>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>{s.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
EOF_SRC_COMPONENTS_HOMEDASHBOARD_JS

cat > src/components/VideoStudio.js << 'EOF_SRC_COMPONENTS_VIDEOSTUDIO_JS'
"use client";

import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

// این کامپوننت هم برای صفحه‌ی «ویدیوی لانگ» و هم «ویدیوی شورت» استفاده می‌شه.
// mode: "long" | "short"
export default function VideoStudio({ mode }) {
  const { data: session, status: sessionStatus } = useSession();

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
        body: JSON.stringify({ topic, mode }),
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
          videoMode: mode,
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

  const isShort = mode === "short";

  if (sessionStatus === "loading") return null;

  if (!session) {
    return (
      <main style={{ padding: "2rem", textAlign: "center", maxWidth: "500px", margin: "0 auto" }}>
        <h2>{isShort ? "⚡ ویدیوی شورت" : "🎬 ویدیوی لانگ"}</h2>
        <p style={{ color: "#666" }}>برای استفاده از این بخش، اول از بالای صفحه با گوگل وارد شو.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem", textAlign: "center", maxWidth: "500px", margin: "0 auto" }}>
      <div
        style={{
          border: "2px solid #4CAF50",
          borderRadius: "8px",
          padding: "1rem",
          marginBottom: "1.5rem",
          textAlign: "left",
        }}
      >
        <h3 style={{ marginTop: 0 }}>
          {isShort
            ? "⚡ ساخت خودکار ویدیوی شورت (۳۰-۶۰ ثانیه، عمودی)"
            : "🎬 ساخت خودکار ویدیوی لانگ (۵-۱۰ دقیقه، افقی)"}
        </h3>

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
    </main>
  );
}
EOF_SRC_COMPONENTS_VIDEOSTUDIO_JS

cat > src/components/ApiStatus.js << 'EOF_SRC_COMPONENTS_APISTATUS_JS'
"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

export default function ApiStatus() {
  const { data: session, status: sessionStatus } = useSession();
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");

  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState({});

  async function loadStatus() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در دریافت وضعیت");
      setInfo(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (session) queueMicrotask(() => loadStatus());
  }, [session]);

  async function runTest(key, url) {
    setTesting((t) => ({ ...t, [key]: true }));
    try {
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      setTestResults((r) => ({ ...r, [key]: data }));
    } catch (err) {
      setTestResults((r) => ({ ...r, [key]: { ok: false, error: err.message } }));
    }
    setTesting((t) => ({ ...t, [key]: false }));
  }

  if (sessionStatus === "loading") return null;

  if (!session) {
    return (
      <main style={{ padding: "2rem", textAlign: "center", maxWidth: "500px", margin: "0 auto" }}>
        <h2>🔌 بررسی API ها</h2>
        <p style={{ color: "#666" }}>برای مشاهده‌ی این بخش، اول از بالای صفحه با گوگل وارد شو.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "1rem", maxWidth: "500px", margin: "0 auto" }}>
      <h2 style={{ textAlign: "center" }}>🔌 بررسی API ها</h2>

      {loading && <p style={{ textAlign: "center" }}>در حال بررسی...</p>}
      {error && <p style={{ color: "#e53935", textAlign: "center" }}>خطا: {error}</p>}

      {info && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Row label="ورود گوگل" ok={info.auth.signedIn}>
            <p style={{ fontSize: "0.8rem", color: "#666", margin: 0 }}>
              {info.auth.user}
              {info.auth.tokenError ? ` — خطای توکن: ${info.auth.tokenError}` : ""}
            </p>
          </Row>

          <Row label="تنظیمات ورود گوگل (Client ID/Secret)" ok={info.auth.googleClientConfigured} />

          <Row label="NEXTAUTH_SECRET" ok={info.nextAuth.secretConfigured} />
          <Row label="NEXTAUTH_URL" ok={info.nextAuth.urlConfigured} />

          <Row label="کلید Groq (نوشتن سناریو و متادیتا)" ok={info.groq.configured}>
            <TestButton
              disabled={!info.groq.configured}
              testing={testing.groq}
              result={testResults.groq}
              onClick={() => runTest("groq", "/api/status/groq")}
            />
          </Row>

          <Row label="کلید Pexels (عکس و کلیپ پس‌زمینه)" ok={info.pexels.configured}>
            <TestButton
              disabled={!info.pexels.configured}
              testing={testing.pexels}
              result={testResults.pexels}
              onClick={() => runTest("pexels", "/api/status/pexels")}
            />
          </Row>

          <Row label="اتصال YouTube Data API" ok={info.auth.hasAccessToken}>
            <TestButton
              disabled={!info.auth.hasAccessToken}
              testing={testing.youtube}
              result={testResults.youtube}
              onClick={() => runTest("youtube", "/api/status/youtube")}
            />
          </Row>

          <Row label="دیتابیس (ثبت آمار ویدیوها)" ok={info.database.connected}>
            {info.database.connected ? (
              <p style={{ fontSize: "0.8rem", color: "#666", margin: 0 }}>
                {info.database.videoCount} ویدیو ثبت شده
              </p>
            ) : (
              <p style={{ fontSize: "0.8rem", color: "#e53935", margin: 0 }}>
                {info.database.error}
              </p>
            )}
          </Row>
        </div>
      )}

      <button
        type="button"
        onClick={loadStatus}
        style={{ marginTop: "1.5rem", width: "100%" }}
        disabled={loading}
      >
        🔄 بررسی دوباره
      </button>
    </main>
  );
}

function Badge({ ok }) {
  const style = {
    display: "inline-block",
    padding: "0.15rem 0.5rem",
    borderRadius: "999px",
    fontSize: "0.75rem",
    fontWeight: "bold",
    color: "#fff",
    background: ok ? "#4CAF50" : "#e53935",
    whiteSpace: "nowrap",
  };
  return <span style={style}>{ok ? "تنظیم شده ✅" : "تنظیم نشده ❌"}</span>;
}

function Row({ label, ok, children }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <strong style={{ fontSize: "0.9rem" }}>{label}</strong>
        <Badge ok={ok} />
      </div>
      {children && <div style={{ marginTop: "0.4rem" }}>{children}</div>}
    </div>
  );
}

function TestButton({ onClick, disabled, testing, result }) {
  return (
    <div>
      <button type="button" onClick={onClick} disabled={disabled || testing} style={{ fontSize: "0.8rem" }}>
        {testing ? "در حال تست..." : "تست اتصال"}
      </button>
      {result && (
        <p
          style={{
            fontSize: "0.8rem",
            marginTop: "0.3rem",
            color: result.ok ? "#4CAF50" : "#e53935",
          }}
        >
          {result.ok ? result.message : "خطا: " + result.error}
        </p>
      )}
    </div>
  );
}
EOF_SRC_COMPONENTS_APISTATUS_JS

cat > src/components/ChannelAnalytics.js << 'EOF_SRC_COMPONENTS_CHANNELANALYTICS_JS'
"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fa-IR");
  } catch {
    return iso;
  }
}

export default function ChannelAnalytics() {
  const { data: session, status: sessionStatus } = useSession();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");

  // توجه: این تابع عمداً setState رو قبل از اولین await صدا نمی‌زنه، چون
  // از useEffect زیر هم فراخوانی می‌شه و React الان به‌خاطر ریندرهای زنجیره‌ای
  // نسبت به setState سنکرون داخل افکت هشدار می‌ده.
  async function loadVideos() {
    try {
      const res = await fetch("/api/videos");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در دریافت لیست ویدیوها");
      setVideos(data.videos || []);
      setError("");
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (session) queueMicrotask(() => loadVideos());
  }, [session]);

  async function handleSync() {
    setSyncing(true);
    setSyncStatus("در حال گرفتن آمار از یوتیوب...");
    try {
      const res = await fetch("/api/sync-stats", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در به‌روزرسانی آمار");
      setSyncStatus(
        data.updated !== undefined
          ? `آمار ${data.updated} از ${data.total ?? data.updated} ویدیو به‌روز شد ✅`
          : data.message || "به‌روزرسانی انجام شد"
      );
      await loadVideos();
    } catch (err) {
      setSyncStatus("خطا: " + (err.message || "خطای نامشخص"));
    }
    setSyncing(false);
  }

  if (sessionStatus === "loading") return null;

  if (!session) {
    return (
      <main style={{ padding: "2rem", textAlign: "center", maxWidth: "700px", margin: "0 auto" }}>
        <h2>📊 آنالیز کانال</h2>
        <p style={{ color: "#666" }}>برای مشاهده‌ی این بخش، اول از بالای صفحه با گوگل وارد شو.</p>
      </main>
    );
  }

  const totals = videos.reduce(
    (acc, v) => {
      acc.views += Number(v.views) || 0;
      acc.likes += Number(v.likes) || 0;
      acc.subs += Number(v.subscribers_gained) || 0;
      if (v.video_mode === "short") acc.short += 1;
      else acc.long += 1;
      return acc;
    },
    { views: 0, likes: 0, subs: 0, long: 0, short: 0 }
  );

  return (
    <main style={{ padding: "1rem", maxWidth: "700px", margin: "0 auto" }}>
      <h2 style={{ textAlign: "center" }}>📊 آنالیز کانال</h2>

      <button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        style={{ width: "100%", marginBottom: "0.5rem" }}
      >
        {syncing ? "در حال دریافت آمار..." : "🔄 به‌روزرسانی آمار واقعی ویدیوها"}
      </button>
      {syncStatus && <p style={{ fontSize: "0.85rem", textAlign: "center" }}>{syncStatus}</p>}

      {loading && <p style={{ textAlign: "center" }}>در حال بارگذاری...</p>}
      {error && <p style={{ color: "#e53935", textAlign: "center" }}>خطا: {error}</p>}

      {!loading && !error && videos.length === 0 && (
        <p style={{ textAlign: "center", color: "#666" }}>هنوز ویدیویی ثبت نشده.</p>
      )}

      {videos.length > 0 && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: "0.5rem",
              margin: "1rem 0",
            }}
          >
            <StatCard label="کل ویدیوها" value={videos.length} />
            <StatCard label="لانگ / شورت" value={`${totals.long} / ${totals.short}`} />
            <StatCard label="مجموع بازدید" value={totals.views.toLocaleString("fa-IR")} />
            <StatCard label="مجموع لایک" value={totals.likes.toLocaleString("fa-IR")} />
            <StatCard label="سابسکرایب جذب‌شده" value={totals.subs.toLocaleString("fa-IR")} />
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd", textAlign: "right" }}>
                  <th style={{ padding: "0.4rem" }}>عنوان</th>
                  <th style={{ padding: "0.4rem" }}>نوع</th>
                  <th style={{ padding: "0.4rem" }}>بازدید</th>
                  <th style={{ padding: "0.4rem" }}>لایک</th>
                  <th style={{ padding: "0.4rem" }}>سابسکرایب</th>
                  <th style={{ padding: "0.4rem" }}>میانگین تماشا</th>
                  <th style={{ padding: "0.4rem" }}>تاریخ</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr key={v.video_id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "0.4rem" }}>
                      <a
                        href={`https://www.youtube.com/watch?v=${v.video_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {v.title || "بدون عنوان"}
                      </a>
                    </td>
                    <td style={{ padding: "0.4rem" }}>{v.video_mode === "short" ? "شورت" : "لانگ"}</td>
                    <td style={{ padding: "0.4rem" }}>{Number(v.views || 0).toLocaleString("fa-IR")}</td>
                    <td style={{ padding: "0.4rem" }}>{Number(v.likes || 0).toLocaleString("fa-IR")}</td>
                    <td style={{ padding: "0.4rem" }}>
                      {Number(v.subscribers_gained || 0).toLocaleString("fa-IR")}
                    </td>
                    <td style={{ padding: "0.4rem" }}>{formatDuration(v.avg_view_duration_sec)}</td>
                    <td style={{ padding: "0.4rem" }}>{formatDate(v.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "0.6rem", textAlign: "center" }}>
      <div style={{ fontSize: "1.1rem", fontWeight: "bold" }}>{value}</div>
      <div style={{ fontSize: "0.75rem", color: "#666" }}>{label}</div>
    </div>
  );
}
EOF_SRC_COMPONENTS_CHANNELANALYTICS_JS

cat > src/app/layout.js << 'EOF_SRC_APP_LAYOUT_JS'
import "./globals.css";
import Providers from "./providers";
import NavBar from "../components/NavBar";

export const metadata = {
  title: "استودیوی یوتیوب",
  description: "My video upload app",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <Providers>
          <NavBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
EOF_SRC_APP_LAYOUT_JS

cat > src/app/page.js << 'EOF_SRC_APP_PAGE_JS'
import HomeDashboard from "../components/HomeDashboard";

export default function HomePage() {
  return <HomeDashboard />;
}
EOF_SRC_APP_PAGE_JS

cat > src/app/long/page.js << 'EOF_SRC_APP_LONG_PAGE_JS'
import VideoStudio from "../../components/VideoStudio";

export const metadata = {
  title: "ویدیوی لانگ | استودیوی یوتیوب",
};

export default function LongVideoPage() {
  return <VideoStudio mode="long" />;
}
EOF_SRC_APP_LONG_PAGE_JS

cat > src/app/short/page.js << 'EOF_SRC_APP_SHORT_PAGE_JS'
import VideoStudio from "../../components/VideoStudio";

export const metadata = {
  title: "ویدیوی شورت | استودیوی یوتیوب",
};

export default function ShortVideoPage() {
  return <VideoStudio mode="short" />;
}
EOF_SRC_APP_SHORT_PAGE_JS

cat > src/app/api-check/page.js << 'EOF_SRC_APP_API_CHECK_PAGE_JS'
import ApiStatus from "../../components/ApiStatus";

export const metadata = {
  title: "بررسی API ها | استودیوی یوتیوب",
};

export default function ApiCheckPage() {
  return <ApiStatus />;
}
EOF_SRC_APP_API_CHECK_PAGE_JS

cat > src/app/analytics/page.js << 'EOF_SRC_APP_ANALYTICS_PAGE_JS'
import ChannelAnalytics from "../../components/ChannelAnalytics";

export const metadata = {
  title: "آنالیز کانال | استودیوی یوتیوب",
};

export default function AnalyticsPage() {
  return <ChannelAnalytics />;
}
EOF_SRC_APP_ANALYTICS_PAGE_JS

cat > src/app/api/status/route.js << 'EOF_SRC_APP_API_STATUS_ROUTE_JS'
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { getDbStatus } from "../../../lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const database = await getDbStatus();

  return NextResponse.json({
    auth: {
      signedIn: true,
      user: session.user?.name || session.user?.email || null,
      hasAccessToken: !!session.accessToken,
      tokenError: session.error || null,
      googleClientConfigured: !!(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ),
    },
    nextAuth: {
      secretConfigured: !!process.env.NEXTAUTH_SECRET,
      urlConfigured: !!process.env.NEXTAUTH_URL,
    },
    groq: { configured: !!process.env.GROQ_API_KEY },
    pexels: { configured: !!process.env.PEXELS_API_KEY },
    database,
  });
}
EOF_SRC_APP_API_STATUS_ROUTE_JS

cat > src/app/api/status/groq/route.js << 'EOF_SRC_APP_API_STATUS_GROQ_ROUTE_JS'
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/authOptions";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ ok: false, error: "GROQ_API_KEY تنظیم نشده" });
  }

  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    });
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        error: data.error?.message || `خطای Groq (کد ${res.status})`,
      });
    }

    const modelCount = Array.isArray(data.data) ? data.data.length : 0;
    return NextResponse.json({
      ok: true,
      message: `اتصال برقراره ✅ — ${modelCount} مدل در دسترسه`,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
EOF_SRC_APP_API_STATUS_GROQ_ROUTE_JS

cat > src/app/api/status/pexels/route.js << 'EOF_SRC_APP_API_STATUS_PEXELS_ROUTE_JS'
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/authOptions";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  if (!process.env.PEXELS_API_KEY) {
    return NextResponse.json({ ok: false, error: "PEXELS_API_KEY تنظیم نشده" });
  }

  try {
    const res = await fetch(
      "https://api.pexels.com/v1/search?query=nature&per_page=1",
      { headers: { Authorization: process.env.PEXELS_API_KEY } }
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        error: data.error || `خطای Pexels (کد ${res.status})`,
      });
    }

    return NextResponse.json({ ok: true, message: "اتصال به Pexels برقراره ✅" });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
EOF_SRC_APP_API_STATUS_PEXELS_ROUTE_JS

cat > src/app/api/status/youtube/route.js << 'EOF_SRC_APP_API_STATUS_YOUTUBE_ROUTE_JS'
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/authOptions";
import { google } from "googleapis";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  if (!session.accessToken) {
    return NextResponse.json({
      ok: false,
      error: "توکن دسترسی گوگل موجود نیست، یک‌بار خارج و دوباره وارد شو",
    });
  }

  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: session.accessToken });
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    const res = await youtube.channels.list({ mine: true, part: ["snippet"] });
    const channel = res.data?.items?.[0];

    if (!channel) {
      return NextResponse.json({ ok: false, error: "کانالی برای این حساب پیدا نشد" });
    }

    return NextResponse.json({
      ok: true,
      message: `اتصال برقراره ✅ — کانال: ${channel.snippet?.title || "بدون نام"}`,
    });
  } catch (err) {
    const isScopeError =
      err.message && (err.message.includes("insufficient") || err.message.includes("403"));
    return NextResponse.json({
      ok: false,
      error: isScopeError
        ? "دسترسی کافی نیست — یک‌بار از سایت خارج و دوباره با گوگل وارد شو."
        : err.message,
    });
  }
}
EOF_SRC_APP_API_STATUS_YOUTUBE_ROUTE_JS

cat > src/app/api/videos/route.js << 'EOF_SRC_APP_API_VIDEOS_ROUTE_JS'
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { getAllVideos } from "../../../lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  try {
    const videos = await getAllVideos();
    return NextResponse.json({ videos });
  } catch (err) {
    console.error("videos list error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
EOF_SRC_APP_API_VIDEOS_ROUTE_JS

echo "همه‌ی فایل‌ها با موفقیت نوشته شدن. حالا:"
echo "1) git add -A && git commit -m 'convert to 4 pages: long/short/api-check/analytics'"
echo "2) git push"
echo "بعد از پوش، Render خودکار دیپلوی می‌کنه."