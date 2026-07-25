cat > src/app/page.js << 'EOF_SRC_APP_PAGE_JS'
"use client";

import { useState, useRef } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

export default function Home() {
  const { data: session } = useSession();
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
  const [imageKeyword, setImageKeyword] = useState("");
  const [generatingVoice, setGeneratingVoice] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioBlob, setAudioBlob] = useState(null);

  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoGenStatus, setVideoGenStatus] = useState("");
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState(null);
  const [videoBgImageUrl, setVideoBgImageUrl] = useState("");

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

  function splitSentences(text) {
    return (text.match(/[^.!?]+[.!?]*/g) || [text])
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function distributeDurations(script, imageCount, totalDuration) {
    const sentences = splitSentences(script);
    const wordCounts = sentences.map(
      (s) => s.split(/\s+/).filter(Boolean).length || 1
    );
    const totalWords = wordCounts.reduce((a, b) => a + b, 0) || 1;

    const buckets = new Array(imageCount).fill(0);
    let acc = 0;
    let bucketIndex = 0;
    for (let i = 0; i < sentences.length; i++) {
      acc += wordCounts[i];
      buckets[bucketIndex] += wordCounts[i];
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

    return shares.map((s) => totalDuration * s);
  }

  function getAudioDuration(blobUrl) {
    return new Promise((resolve, reject) => {
      const audioEl = new Audio();
      audioEl.src = blobUrl;
      audioEl.addEventListener("loadedmetadata", () => resolve(audioEl.duration));
      audioEl.addEventListener("error", () => reject(new Error("خطا در خواندن فایل صدا")));
    });
  }

  async function handleGenerateVideo() {
    if (!script.trim()) {
      setVideoGenStatus("اول متن رو بنویس");
      return;
    }

    setGeneratingVideo(true);

    try {
      let blob = audioBlob;
      let url = audioUrl;

      if (!blob) {
        setVideoGenStatus("در حال ساخت صدا...");
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: script, voice: "en-US-JennyNeural" }),
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error);
        }
        blob = await res.blob();
        url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
      }

      setVideoGenStatus("در حال گرفتن عکس مرتبط با موضوع...");
      const imgRes = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: script, keyword: imageKeyword }),
      });
      const imgData = await imgRes.json();
      if (!imgRes.ok) {
        throw new Error(imgData.error);
      }
      const images = imgData.images;
      setVideoBgImageUrl(images[0] || "");

      setVideoGenStatus("در حال آماده‌سازی موتور ویدیو (فقط بار اول کمی طول می‌کشه)...");
      await loadFFmpeg();
      const ffmpeg = getFfmpeg();

      const duration = await getAudioDuration(url);
      const perImageDurations = distributeDurations(script, images.length, duration);

      setVideoGenStatus("در حال دانلود عکس‌ها...");
      for (let i = 0; i < images.length; i++) {
        const data = await fetchFile(images[i]);
        await ffmpeg.writeFile(`img${i}.jpg`, data);
      }

      await ffmpeg.writeFile("narration.mp3", await fetchFile(blob));

      let listContent = "";
      for (let i = 0; i < images.length; i++) {
        listContent += `file 'img${i}.jpg'\nduration ${perImageDurations[i].toFixed(2)}\n`;
      }
      listContent += `file 'img${images.length - 1}.jpg'\n`;
      await ffmpeg.writeFile("list.txt", listContent);

      setVideoGenStatus("در حال ساخت ویدیو نهایی (ممکنه چند دقیقه طول بکشه)...");
      await ffmpeg.exec([
        "-f", "concat",
        "-safe", "0",
        "-i", "list.txt",
        "-i", "narration.mp3",
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-b:v", "2500k",
        "-c:a", "aac",
        "-b:a", "128k",
        "-shortest",
        "output.mp4",
      ]);

      const out = await ffmpeg.readFile("output.mp4");
      const videoBlob = new Blob([out.buffer], { type: "video/mp4" });
      const videoFile = new File([videoBlob], "generated.mp4", { type: "video/mp4" });

      setFile(videoFile);
      setGeneratedVideoUrl(URL.createObjectURL(videoBlob));
      setVideoGenStatus("ویدیو ساخته شد! پایین صفحه آماده‌ی آپلود به یوتیوبه.");
    } catch (err) {
      setVideoGenStatus("خطا: " + err.message);
    }

    setGeneratingVideo(false);
  }

  async function loadFFmpeg() {
    if (ffmpegLoaded) return;
    setTrimStatus("در حال بارگذاری موتور برش (فقط بار اول)...");
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    const ffmpeg = getFfmpeg();
    await ffmpeg.load({
      coreURL: await toBlobURL(baseURL + "/ffmpeg-core.js", "text/javascript"),
      wasmURL: await toBlobURL(baseURL + "/ffmpeg-core.wasm", "application/wasm"),
    });
    setFfmpegLoaded(true);
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
            <h3 style={{ marginTop: 0 }}>ساخت خودکار ویدیو (بتا)</h3>
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
            <button type="button" onClick={handleGenerateVoice} disabled={generatingVoice}>
              {generatingVoice ? "در حال ساخت صدا..." : "ساخت صدا از متن"}
            </button>
            {voiceStatus && <p style={{ fontSize: "0.85rem" }}>{voiceStatus}</p>}
            {audioUrl && (
              <audio controls src={audioUrl} style={{ width: "100%", marginTop: "0.5rem" }} />
            )}

            <button
              type="button"
              onClick={handleGenerateVideo}
              disabled={generatingVideo}
              style={{ marginTop: "0.75rem", fontWeight: "bold" }}
            >
              {generatingVideo ? "در حال ساخت ویدیو..." : "🎬 ساخت خودکار ویدیو (صدا + عکس)"}
            </button>
            {videoGenStatus && <p style={{ fontSize: "0.85rem" }}>{videoGenStatus}</p>}
            {generatedVideoUrl && (
              <div style={{ marginTop: "0.5rem" }}>
                <video
                  controls
                  src={generatedVideoUrl}
                  style={{ width: "100%", borderRadius: "6px" }}
                />
                <a
                  href={generatedVideoUrl}
                  download="generated.mp4"
                  style={{
                    display: "inline-block",
                    marginTop: "0.5rem",
                    fontSize: "0.85rem",
                  }}
                >
                  ⬇️ دانلود مستقیم فایل خام (قبل از آپلود در یوتیوب)
                </a>
              </div>
            )}
          </div>

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

          <form onSubmit={handleUpload} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <input
              type="text"
              placeholder="عنوان ویدیو"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <textarea
              placeholder="توضیحات"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />

            <select
              value={privacyStatus}
              onChange={(e) => setPrivacyStatus(e.target.value)}
            >
              <option value="private">خصوصی</option>
              <option value="unlisted">لیست نشده</option>
              <option value="public">عمومی</option>
            </select>

            <div style={{ textAlign: "left" }}>
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

            <button type="submit" disabled={uploading}>
              {uploading ? "در حال آپلود... " + progress + "%" : "آپلود در یوتیوب"}
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

cat > src/app/api/images/route.js << 'EOF_SRC_APP_API_IMAGES_ROUTE_JS'
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";

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

function extractKeywords(text, count = 4) {
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

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { text, keyword } = await req.json();

  if (!text && !keyword) {
    return NextResponse.json({ error: "متنی ارسال نشده" }, { status: 400 });
  }

  const query = (keyword && keyword.trim()) || extractKeywords(text) || "nature";

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(
        query
      )}&per_page=6&orientation=landscape`,
      { headers: { Authorization: process.env.PEXELS_API_KEY } }
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "خطا در دریافت عکس از Pexels" },
        { status: 500 }
      );
    }

    const images = (data.photos || []).map((p) => p.src.large2x);

    if (images.length === 0) {
      return NextResponse.json(
        { error: "عکسی برای این موضوع پیدا نشد، متن دیگه‌ای امتحان کن" },
        { status: 404 }
      );
    }

    return NextResponse.json({ query, images });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
EOF_SRC_APP_API_IMAGES_ROUTE_JS

