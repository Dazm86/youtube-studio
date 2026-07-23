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
  const [generatingVoice, setGeneratingVoice] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);

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
        body: JSON.stringify({ text: script, voice: "en-US-GuyNeural" }),
      });

      if (!res.ok) {
        const errData = await res.json();
        setVoiceStatus("خطا: " + errData.error);
        setGeneratingVoice(false);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setVoiceStatus("صدا با موفقیت ساخته شد");
    } catch (err) {
      setVoiceStatus("خطا: " + err.message);
    }

    setGeneratingVoice(false);
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
          setStatus("آپلود موفق! شناسه ویدیو: " + data.videoId);
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
            <button type="button" onClick={handleGenerateVoice} disabled={generatingVoice}>
              {generatingVoice ? "در حال ساخت صدا..." : "ساخت صدا از متن"}
            </button>
            {voiceStatus && <p style={{ fontSize: "0.85rem" }}>{voiceStatus}</p>}
            {audioUrl && (
              <audio controls src={audioUrl} style={{ width: "100%", marginTop: "0.5rem" }} />
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
