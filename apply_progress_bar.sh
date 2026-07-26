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
  const [ffmpegMultiThreaded, setFfmpegMultiThreaded] = useState(false);

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
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState(null);
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
    const bucketText = new Array(imageCount).fill("");
    let acc = 0;
    let bucketIndex = 0;
    for (let i = 0; i < sentences.length; i++) {
      acc += wordCounts[i];
      buckets[bucketIndex] += wordCounts[i];
      bucketText[bucketIndex] +=
        (bucketText[bucketIndex] ? " " : "") + sentences[i];
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

  function escapeDrawtext(text) {
    return text
      .replace(/'/g, "\u2019")
      .replace(/:/g, "\\:")
      .replace(/%/g, "\\%");
  }

  function wrapCaption(text, maxCharsPerLine) {
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
    setVideoGenProgress(0);

    let wakeLock = null;
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch {
      // مهم نیست اگه پشتیبانی نشه یا رد بشه؛ ساخت ویدیو بدونش هم ادامه پیدا می‌کنه
    }

    try {
      let blob = audioBlob;
      let url = audioUrl;

      if (!blob) {
        setVideoGenStatus("مرحله ۱ از ۵: در حال ساخت صدا...");
        setVideoGenProgress(5);
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
      setVideoGenProgress(15);

      const isShort = videoMode === "short";
      const W = isShort ? 720 : 1280;
      const H = isShort ? 1280 : 720;

      const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
      const estimatedSeconds = (wordCount / 140) * 60;
      const mediaCount = isShort
        ? 6
        : Math.min(24, Math.max(6, Math.ceil(estimatedSeconds / 15)));

      setVideoGenStatus(
        useVideoClips
          ? "مرحله ۲ از ۵: در حال گرفتن کلیپ ویدیویی مرتبط با موضوع..."
          : "مرحله ۲ از ۵: در حال گرفتن عکس مرتبط با موضوع..."
      );
      const mediaRes = await fetch(useVideoClips ? "/api/clips" : "/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: script,
          keyword: imageKeyword,
          count: mediaCount,
          orientation: isShort ? "portrait" : "landscape",
        }),
      });
      const mediaData = await mediaRes.json();
      if (!mediaRes.ok) {
        throw new Error(
          mediaData.error ||
            (useVideoClips
              ? "خطا در دریافت کلیپ از سرور"
              : "خطا در دریافت عکس از سرور")
        );
      }
      const mediaItems = useVideoClips ? mediaData.clips : mediaData.images;
      setVideoBgImageUrl(mediaItems[0] || "");
      setVideoGenProgress(20);

      setVideoGenStatus(
        "مرحله ۳ از ۵: در حال آماده‌سازی موتور ویدیو (فقط بار اول کمی طول می‌کشه)..."
      );
      await loadFFmpeg(setVideoGenStatus);
      setVideoGenProgress(35);
      const ffmpeg = getFfmpeg();

      const duration = await getAudioDuration(url);
      const { durations: perImageDurations, captions } = distributeDurations(
        script,
        mediaItems.length,
        duration
      );

      setVideoGenStatus(
        useVideoClips
          ? "مرحله ۴ از ۵: در حال دانلود کلیپ‌ها..."
          : "مرحله ۴ از ۵: در حال دانلود عکس‌ها..."
      );
      const mediaExt = useVideoClips ? "mp4" : "jpg";
      for (let i = 0; i < mediaItems.length; i++) {
        const data = await fetchFile(mediaItems[i]);
        await ffmpeg.writeFile(`media${i}.${mediaExt}`, data);
        setVideoGenProgress(35 + Math.round(((i + 1) / mediaItems.length) * 15));
      }

      await ffmpeg.writeFile("narration.mp3", await fetchFile(blob));
      await ffmpeg.writeFile("font.ttf", await fetchFile("/fonts/DejaVuSans-Bold.ttf"));
      setVideoGenProgress(50);

      // --- Ken Burns (zoompan, images only) + crossfade (xfade) between clips ---
      const N = mediaItems.length;
      const FADE = Math.min(0.5, Math.min(...perImageDurations) / 3);
      const compensation = (FADE * (N - 1)) / N;
      const clipDurations = perImageDurations.map((d) => d + compensation);

      const args = [];
      for (let i = 0; i < N; i++) {
        if (useVideoClips) {
          args.push(
            "-stream_loop", "-1",
            "-t", clipDurations[i].toFixed(2),
            "-i", `media${i}.mp4`
          );
        } else {
          args.push(
            "-loop", "1",
            "-framerate", "25",
            "-t", clipDurations[i].toFixed(2),
            "-i", `media${i}.jpg`
          );
        }
      }
      args.push("-i", "narration.mp3");
      const musicIdx = N + 1;
      args.push(
        "-f", "lavfi",
        "-i",
        `aevalsrc=0.05*sin(2*PI*110*t)+0.035*sin(2*PI*164.81*t)+0.025*sin(2*PI*220*t):s=44100:d=${duration.toFixed(
          2
        )}`
      );

      const skipZoom = useVideoClips || !isShort;

      let filter = "";
      for (let i = 0; i < N; i++) {
        const captionText = wrapCaption(
          escapeDrawtext(captions[i] || ""),
          isShort ? 22 : 38
        );
        const visualChain = skipZoom
          ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=25`
          : `scale=900:1600:force_original_aspect_ratio=increase,` +
            `crop=900:1600,` +
            `zoompan=z='min(zoom+0.0012,1.25)':d=1:` +
            `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=720x1280:fps=25`;
        filter +=
          `[${i}:v]${visualChain},` +
          `format=yuv420p,setsar=1,` +
          `drawtext=fontfile=font.ttf:text='${captionText}':fontsize=44:` +
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
      args.push(
        "-filter_complex",
        filter.replace(/;$/, "") + ";" + audioMixFilter
      );
      args.push("-map", `[${finalLabel}]`);
      args.push("-map", "[aout]");
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-b:v", "2500k");
      args.push("-c:a", "aac", "-b:a", "128k");
      args.push("-shortest");
      args.push("output.mp4");

      setVideoGenStatus(
        "مرحله ۵ از ۵: " +
          (useVideoClips
            ? "در حال ساخت ویدیو نهایی با کلیپ‌های ویدیویی (ممکنه چند دقیقه طول بکشه)..."
            : "در حال ساخت ویدیو نهایی با افکت زوم و ترانزیشن (ممکنه چند دقیقه طول بکشه)...")
      );
      const onExecProgress = ({ progress: p }) => {
        const pct = Math.max(0, Math.min(1, p));
        setVideoGenProgress(50 + Math.round(pct * 50));
        setVideoGenStatus(`مرحله ۵ از ۵: در حال رندر نهایی... ${Math.round(pct * 100)}%`);
      };
      ffmpeg.on("progress", onExecProgress);
      try {
        await ffmpeg.exec(args);
      } finally {
        if (typeof ffmpeg.off === "function") {
          ffmpeg.off("progress", onExecProgress);
        }
      }

      const out = await ffmpeg.readFile("output.mp4");
      const videoBlob = new Blob([out.buffer], { type: "video/mp4" });
      const videoFile = new File([videoBlob], "generated.mp4", { type: "video/mp4" });

      setFile(videoFile);
      setGeneratedVideoUrl(URL.createObjectURL(videoBlob));
      setVideoGenProgress(100);
      setVideoGenStatus("ویدیو ساخته شد! پایین صفحه آماده‌ی آپلود به یوتیوبه.");
    } catch (err) {
      console.error("video generation error:", err);
      const msg =
        (err && err.message) ||
        (typeof err === "string" ? err : "") ||
        (() => {
          try {
            return JSON.stringify(err);
          } catch {
            return String(err);
          }
        })();
      setVideoGenStatus("خطا: " + (msg || "خطای نامشخص (جزئیات توی کنسول مرورگره)"));
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

  async function loadFFmpeg(onStatus) {
    const report = onStatus || setTrimStatus;
    if (ffmpegLoaded) return;
    report("در حال بررسی امکان پردازش چندهسته‌ای...");
    const ffmpeg = getFfmpeg();

    if (typeof window !== "undefined" && window.crossOriginIsolated) {
      try {
        report("در حال بارگذاری موتور چندهسته‌ای (حداکثر ۱۵ ثانیه)...");
        const mtBaseURL = "https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/umd";
        const loadMT = async () => {
          await ffmpeg.load({
            coreURL: await toBlobURL(mtBaseURL + "/ffmpeg-core.js", "text/javascript"),
            wasmURL: await toBlobURL(mtBaseURL + "/ffmpeg-core.wasm", "application/wasm"),
            workerURL: await toBlobURL(
              mtBaseURL + "/ffmpeg-core.worker.js",
              "text/javascript"
            ),
          });
        };
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("زمان بارگذاری چندهسته‌ای تموم شد")),
            15000
          )
        );
        await Promise.race([loadMT(), timeoutPromise]);
        setFfmpegLoaded(true);
        setFfmpegMultiThreaded(true);
        report("موتور چندهسته‌ای آماده شد ⚡");
        return;
      } catch (err) {
        console.error("چندهسته‌ای لود نشد یا زمان تموم شد، برمی‌گردیم به تک‌هسته‌ای:", err);
        ffmpegRef.current = new FFmpeg();
        report("چندهسته‌ای در دسترس نبود؛ در حال بارگذاری موتور تک‌هسته‌ای...");
      }
    } else {
      report("در حال بارگذاری موتور تک‌هسته‌ای...");
    }

    const singleThreadFfmpeg = getFfmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await singleThreadFfmpeg.load({
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
            <h3 style={{ marginTop: 0 }}>ساخت خودکار ویدیو (بتا)</h3>

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
              استفاده از کلیپ ویدیویی به‌جای عکس ثابت (حجم دانلود بیشتر، حس زنده‌تر)
            </label>
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
              {generatingVideo
                ? "در حال ساخت ویدیو..."
                : useVideoClips
                ? "🎬 ساخت خودکار ویدیو (صدا + کلیپ)"
                : "🎬 ساخت خودکار ویدیو (صدا + عکس)"}
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
            {ffmpegLoaded && (
              <p style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                {ffmpegMultiThreaded
                  ? "⚡ حالت چندهسته‌ای فعاله"
                  : "حالت تک‌هسته‌ای (چندهسته‌ای در دسترس نبود)"}
              </p>
            )}
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
EOF_PAGE_JS
