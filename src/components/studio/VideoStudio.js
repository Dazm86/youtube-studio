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
  const [thumbnailText, setThumbnailText] = useState("");
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

  // اگه از /trends (یا هر جای دیگه‌ای) با ?topic=... اومده باشیم، همون
  // موضوع رو از قبل تو فیلد پر می‌کنیم — هم برای شروعِ دستی، هم به‌عنوانِ
  // موضوعِ پیش‌فرضِ دکمه‌ی «ساخت کاملاً خودکار» پایین. از window.location
  // مستقیم می‌خونیم (نه هوکِ useSearchParams) که نیازی به Suspense
  // boundary تو long/page.js و short/page.js نباشه.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromQuery = new URLSearchParams(window.location.search).get("topic");
    if (fromQuery) setTopic(fromQuery);
  }, []);

  const [autoProducing, setAutoProducing] = useState(false);

  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoGenStatus, setVideoGenStatus] = useState("");
  const [videoGenProgress, setVideoGenProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const genStartRef = useRef(null);
  const [uploadedVideoId, setUploadedVideoId] = useState(null);
  const [videoBgImageUrl, setVideoBgImageUrl] = useState("");
  const [useVideoClips, setUseVideoClips] = useState(false);

  // فیکسِ ۲۰۲۶-۰۸-۲۲ — قبلاً videoBgImageUrl هیچ‌وقت set نمی‌شد، پس
  // آپلودِ دستی همیشه bgImageUrl خالی می‌فرستاد و تامبنیل همیشه فقط
  // گرادیانِ پیش‌فرض می‌شد. حالا با تغییرِ imageKeyword (یا title، اگه
  // کلیدواژه خالی باشه)، با یه تأخیرِ کوتاه یک عکسِ واقعی از همون
  // provider هایی که خودِ pipeline استفاده می‌کنه می‌گیره.
  useEffect(() => {
    const query = imageKeyword || title;
    if (!query || !query.trim()) {
      setVideoBgImageUrl("");
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: query, count: 1, orientation: mode === "short" ? "portrait" : "landscape" }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const firstUrl = data?.images?.[0]?.path;
        if (firstUrl) setVideoBgImageUrl(firstUrl);
      } catch {
        // اگه شکست بخوره، همون گرادیانِ پیش‌فرض می‌مونه — مشکلی نیست
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [imageKeyword, title, mode]);

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
        body: JSON.stringify({ text: script }),
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
          thumbnailText,
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
      let streamEndedCleanly = false;
      let dispatchedJobId = null;

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
            streamEndedCleanly = true;
          }
          if (obj.done && obj.jobId && obj.status === "queued") {
            // ۲۰۲۶-۰۸-۱۸ — این یعنی ویدیو به Worker (GitHub Actions) سپرده
            // شد، نه این‌که کارش تموم شده. استریمِ این درخواست همین‌جا
            // طبیعتاً می‌بنده (نه یک قطعیِ اتصال) — رندر/آپلودِ واقعی چند
            // دقیقه‌ی دیگه، جدا از این اتصال، تو worker انجام می‌شه؛ بعد از
            // پایانِ حلقه‌ی پایین با poll کردنِ jobId دنبالش می‌کنیم.
            streamEndedCleanly = true;
            dispatchedJobId = obj.jobId;
            setVideoGenStatus(obj.message || `در صف Worker (Job: ${obj.jobId})...`);
          } else if (obj.done) {
            streamEndedCleanly = true;
            setUploadedVideoId(obj.videoId);
            setVideoGenProgress(100);
            const thumbNote =
              obj.thumbnailStatus === "ok"
                ? " (تامبنیل مایا هم ست شد)"
                : " (تامبنیل ست نشد ⚠️ — احتمالاً کانال نیاز به تأیید شماره تلفن داره)";
            const captionNote =
              obj.captionStatus === "ok"
                ? " (زیرنویس هم آپلود شد)"
                : obj.captionStatus && obj.captionStatus.startsWith("failed")
                ? " (زیرنویس آپلود نشد ⚠️)"
                : "";
            const translatedNote = obj.translatedCaptionsSummary
              ? ` (زیرنویس چندزبانه: ${obj.translatedCaptionsSummary})`
              : "";
            setVideoGenStatus("آپلود کامل شد ✅" + thumbNote + captionNote + translatedNote);
          }
        }
      }

      if (finalError) {
        throw new Error(finalError);
      } else if (dispatchedJobId) {
        await pollJobStatus(dispatchedJobId);
      } else if (!streamEndedCleanly) {
        throw new Error(
          "اتصال به سرور وسط پردازش قطع شد — مشخص نیست ویدیو کامل شده یا نه. کانالت رو چک کن، یا دوباره امتحان کن."
        );
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

  // ۲۰۲۶-۰۸-۲۸ — «ساخت کاملاً خودکار»: به‌جای این‌که کاربر اول سناریو
  // بنویسه، بعد متادیتا، بعد دستی بزنه «ساخت+آپلود»، این یک درخواستِ
  // واحده که خودِ سرور از اول (انتخابِ موضوع از Trend Finder، یا همون
  // topic ای که تو فیلده) تا آخر (آپلود) رو پشتِ‌سرهم انجام می‌ده.
  // از همون stateهای handleGenerateAndUpload استفاده می‌کنه (نوارِ
  // پیشرفت و پیامِ موفقیت یکیه) و در پایان فیلدهای سناریو/عنوان/توضیحات
  // رو هم پر می‌کنه تا معلوم باشه دقیقاً چی ساخته شده.
  async function handleAutoProduce() {
    setAutoProducing(true);
    setGeneratingVideo(true);
    setVideoGenProgress(0);
    setUploadedVideoId(null);
    setVideoGenStatus("در حال شروع تولید کاملاً خودکار...");
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
      const res = await fetch("/api/auto-produce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          topic: topic.trim() || undefined,
          privacyStatus,
          publishAt,
          useVideoClips,
        }),
      });

      if (!res.ok || !res.body) {
        let errMsg = "خطا در شروع تولید خودکار";
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
      let streamEndedCleanly = false;
      let dispatchedJobId = null;

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
            streamEndedCleanly = true;
          }
          if (obj.done && obj.jobId && obj.status === "queued") {
            streamEndedCleanly = true;
            dispatchedJobId = obj.jobId;
            setVideoGenStatus(obj.message || `در صف Worker (Job: ${obj.jobId})...`);
          } else if (obj.done) {
            streamEndedCleanly = true;
            setUploadedVideoId(obj.videoId);
            setVideoGenProgress(100);
            const thumbNote =
              obj.thumbnailStatus === "ok"
                ? " (تامبنیل مایا هم ست شد)"
                : " (تامبنیل ست نشد ⚠️)";
            const captionNote = obj.captionStatus === "ok" ? " (زیرنویس هم آپلود شد)" : "";
            setVideoGenStatus("تولید و آپلود کامل شد ✅" + thumbNote + captionNote);
          }
          // چه در حالتِ صف‌شده و چه کامل‌شده، اگه سرور سناریو/متادیتا رو
          // برگردونده باشه، فیلدهای فرم رو باهاش پر می‌کنیم تا معلوم باشه
          // دقیقاً چی ساخته شده (و قابلِ ویرایش/بازبینی بمونه).
          if (obj.script) setScript(obj.script);
          if (obj.topic) setTopic(obj.topic);
          if (obj.title) setTitle(obj.title);
          if (obj.thumbnailText) setThumbnailText(obj.thumbnailText);
          if (obj.description) setDescription(obj.description);
          if (obj.tags) setTagsStr(obj.tags);
        }
      }

      if (finalError) {
        throw new Error(finalError);
      } else if (dispatchedJobId) {
        await pollJobStatus(dispatchedJobId);
      } else if (!streamEndedCleanly) {
        throw new Error(
          "اتصال به سرور وسط پردازش قطع شد — مشخص نیست ویدیو کامل شده یا نه. کانالت رو چک کن، یا دوباره امتحان کن."
        );
      }
    } catch (err) {
      console.error("auto-produce error:", err);
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
    setAutoProducing(false);
  }

  // ۲۰۲۶-۰۸-۱۸ — بعد از dispatch به Worker، هر ۱۰ ثانیه وضعیتِ jobId رو
  // چک می‌کنه تا کامل/شکست‌خورده بشه، حداکثر تا ۴۰ دقیقه (سقفِ
  // timeout=45 دقیقه‌ی خودِ render-worker.yml). اگه شبکه لحظه‌ای قطع بشه
  // فقط دورِ بعدی رو امتحان می‌کنه، throw نمی‌کنه — فقط شکستِ *واقعیِ* job
  // (status="failed" از خودِ worker) throw می‌شه.
  async function pollJobStatus(jobId) {
    const maxAttempts = 240;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      let data;
      try {
        const res = await fetch(`/api/jobs/status?jobId=${encodeURIComponent(jobId)}`);
        data = await res.json();
        if (!res.ok) continue;
      } catch {
        continue;
      }
      if (data.status === "completed") {
        setUploadedVideoId(data.result?.videoId);
        setVideoGenProgress(100);
        const thumbNote =
          data.result?.thumbnailStatus === "ok" ? " (تامبنیل مایا هم ست شد)" : " (تامبنیل ست نشد ⚠️)";
        const captionNote = data.result?.captionStatus === "ok" ? " (زیرنویس هم آپلود شد)" : "";
        setVideoGenStatus("آپلود کامل شد ✅" + thumbNote + captionNote);
        return;
      }
      if (data.status === "failed") {
        throw new Error(data.error || "رندر توی Worker شکست خورد");
      }
      setVideoGenStatus(`در حال پردازش توی Worker... (بررسیِ ${i + 1})`);
    }
    throw new Error(
      "بررسیِ وضعیتِ Worker بیشتر از ۴۰ دقیقه طول کشید — رندر شاید هنوز در حال انجامه؛ از تبِ Actions تو گیت‌هاب یا خودِ کانالت چک کن."
    );
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
      setThumbnailText(data.thumbnailText || "");
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
    // فیکسِ ۲۰۲۶-۰۸-۲۲ — قبلاً از unpkg.com (CDNِ خارجی) لود می‌شد، در
    // حالی که همین فایل‌ها از قبل تو public/ffmpeg-core/ خودِ پروژه
    // بودن (۳۲ مگابایت که کاملاً بلااستفاده مونده بود) — یعنی هم این
    // فایل‌ها بی‌دلیل رو دیپلوی سوار بودن، هم خودِ فیچرِ trim به دسترسی
    // به unpkg.com از مرورگرِ کاربر وابسته بود.
    const baseURL = "/ffmpeg-core";
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
    formData.append("thumbnailText", thumbnailText);
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
      <main className="min-h-screen bg-bg text-text px-4 py-10 max-w-lg mx-auto text-center">
        <h2 className="text-xl font-bold mb-2">{isShort ? "⚡ ویدیوی شورت" : "🎬 ویدیوی لانگ"}</h2>
        <p className="text-text-muted">برای استفاده از این بخش، اول از بالای صفحه با گوگل وارد شو.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-text px-4 py-6 max-w-lg mx-auto">
      <div className="mb-6">
        <p className="label-plate text-teal mb-1">
          {isShort ? "۳۰-۶۰ ثانیه، عمودی" : "۵-۱۰ دقیقه، افقی"}
        </p>
        <h1 className="text-xl font-bold">
          {isShort ? "⚡ ساخت خودکار ویدیوی شورت" : "🎬 ساخت خودکار ویدیوی لانگ"}
        </h1>
      </div>

      {/* ساخت کاملاً خودکار — از انتخاب موضوع (Trend Finder یا هوش‌مصنوعی)
          تا سناریو، عنوان/تگ، صدا، رسانه، رندر، زیرنویس و آپلود، همه با
          یک درخواست. مسیرِ دستیِ پایین (۰۱ تا ۰۳) دست‌نخورده می‌مونه برای
          وقتی که کنترلِ قدم‌به‌قدم بخوای. */}
      <section className="card mb-4">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="font-semibold">🚀 ساخت کاملاً خودکار</h2>
        </div>
        <p className="text-sm text-text-muted mb-3 leading-relaxed">
          موضوع (اگه بالا خالی بذاری: اول از موضوع‌های تأییدشده‌ی{" "}
          <a href="/trends" className="text-amber underline">
            Trend Finder
          </a>
          ، وگرنه خودِ هوش‌مصنوعی) → سناریو → عنوان/توضیحات/تگ → صدا → عکس/ویدیو → رندر →
          زیرنویس → آپلود — همه خودکار، پشتِ‌سرهم.
        </p>
        <button
          type="button"
          onClick={handleAutoProduce}
          disabled={generatingVideo}
          className="btn-primary w-full"
        >
          {autoProducing ? "در حال ساخت..." : "🚀 بساز و آپلود کن"}
        </button>
        {autoProducing && videoGenStatus && (
          <p className="text-sm text-text-muted mt-2 readout">
            {videoGenStatus} {generatingVideo ? `(${videoGenProgress}%)` : ""}
          </p>
        )}
      </section>

      {/* ۰۱ — سناریو */}
      <section className="card mb-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="label-plate text-amber">۰۱</span>
          <h2 className="font-semibold">سناریو و صدا</h2>
        </div>

        <label className="field-label">موضوع (اختیاری)</label>
        <input
          type="text"
          placeholder="خالی بذاری خودش یه موضوع تازه انتخاب می‌کنه"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="field-input mb-3"
        />

        <button type="button" onClick={handleGenerateScript} disabled={generatingScript} className="btn-secondary w-full mb-2">
          {generatingScript ? "در حال نوشتن..." : "✍️ بنویس سناریو"}
        </button>
        {scriptGenStatus && <p className="text-sm text-text-muted mb-3">{scriptGenStatus}</p>}

        <label className="field-label">متن ویدیو (به انگلیسی)</label>
        <textarea
          placeholder="متن ویدیو رو اینجا بنویس (به انگلیسی)..."
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={5}
          className="field-textarea mb-3"
        />

        <label className="field-label">کلیدواژه‌ی جستجوی عکس (اختیاری)</label>
        <input
          type="text"
          placeholder="خالی بذاری خودکار حدس می‌زنه"
          value={imageKeyword}
          onChange={(e) => setImageKeyword(e.target.value)}
          className="field-input mb-3"
        />

        <label className="flex items-center gap-2 text-sm text-text-muted mb-3 min-h-[2.25rem]">
          <input
            type="checkbox"
            checked={useVideoClips}
            onChange={(e) => setUseVideoClips(e.target.checked)}
            className="w-4 h-4 accent-amber"
          />
          استفاده از کلیپ ویدیویی به‌جای عکس ثابت (حس زنده‌تر)
        </label>

        <button type="button" onClick={handleGenerateVoice} disabled={generatingVoice} className="btn-secondary w-full">
          {generatingVoice ? "در حال ساخت صدا..." : "🔊 پیش‌شنیدن صدا"}
        </button>
        {voiceStatus && <p className="text-sm text-text-muted mt-2">{voiceStatus}</p>}
        {audioUrl && <audio controls src={audioUrl} className="w-full mt-2" />}
      </section>

      {/* ۰۲ — عنوان، تامبنیل و توضیحات */}
      <section className="card mb-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="label-plate text-amber">۰۲</span>
            <h2 className="font-semibold">عنوان، تامبنیل و توضیحات</h2>
          </div>
        </div>

        <button type="button" onClick={handleSuggestMetadata} disabled={suggestingMeta} className="btn-secondary w-full mb-2">
          {suggestingMeta ? "در حال پیشنهاد..." : "✨ پیشنهاد خودکار عنوان، توضیحات و تگ"}
        </button>
        {suggestMetaStatus && <p className="text-sm text-text-muted mb-3">{suggestMetaStatus}</p>}

        <label className="field-label">عنوان ویدیو</label>
        <input
          type="text"
          placeholder="عنوان ویدیو"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="field-input mb-3"
        />

        <label className="field-label">متن صورت کوچک (۴-۶ کلمه، جدا از عنوان)</label>
        <input
          type="text"
          placeholder="متن صورت کوچک"
          value={thumbnailText}
          onChange={(e) => setThumbnailText(e.target.value)}
          className="field-input"
        />
        <div
          className="relative w-full rounded-lg overflow-hidden mt-2"
          style={{
            aspectRatio: "16 / 9",
            backgroundImage: videoBgImageUrl
              ? `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)), url(${videoBgImageUrl})`
              : "linear-gradient(135deg, #7a3e9d, #e8672c)",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <span
            className="absolute text-center font-bold px-2"
            style={{
              top: "50%",
              left: 0,
              width: "62%",
              transform: "translateY(-50%)",
              fontSize: "clamp(0.85rem, 4vw, 1.3rem)",
              lineHeight: 1.25,
              color: "#fff",
              textShadow:
                "-2px -2px 0 #3a1d4d, 2px -2px 0 #3a1d4d, -2px 2px 0 #3a1d4d, 2px 2px 0 #3a1d4d, 0 0 8px rgba(58,29,77,0.8)",
            }}
          >
            {thumbnailText || title || "متن صورت کوچک اینجا نمایش داده می‌شه"}
          </span>
          <img
            src="/maya/greeting.png"
            alt="مایا"
            onError={(e) => {
              e.target.style.display = "none";
            }}
            className="absolute bottom-0"
            style={{ right: "4%", height: "92%", objectFit: "contain" }}
          />
        </div>
        <p className="text-xs text-text-muted mt-1.5 mb-4">
          پیش‌نمایش تقریبیِ صورت کوچک — پس‌زمینه‌ی واقعی و ژست مایا موقع رندر نهایی ست می‌شن.
        </p>

        <label className="field-label">توضیحات</label>
        <textarea
          placeholder="توضیحات"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="field-textarea mb-3"
        />

        <label className="field-label">تگ‌ها (با کاما جدا کن)</label>
        <input
          type="text"
          placeholder="تگ‌ها"
          value={tagsStr}
          onChange={(e) => setTagsStr(e.target.value)}
          className="field-input"
        />
      </section>

      {/* ۰۳ — انتشار */}
      <section className="card mb-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="label-plate text-amber">۰۳</span>
          <h2 className="font-semibold">تنظیمات انتشار</h2>
        </div>

        <label className="field-label">حریم خصوصی</label>
        <select value={privacyStatus} onChange={(e) => setPrivacyStatus(e.target.value)} className="field-select mb-3">
          <option value="private">خصوصی</option>
          <option value="unlisted">لیست نشده</option>
          <option value="public">عمومی</option>
        </select>

        <label className="field-label">زمان‌بندی انتشار (اختیاری)</label>
        <input
          type="datetime-local"
          value={publishAt}
          onChange={(e) => setPublishAt(e.target.value)}
          className="field-input"
        />
        <p className="text-xs text-text-muted mt-1.5 mb-4">
          اگه پر کنی، ویدیو به‌صورت خصوصی آپلود می‌شه و خودکار در این تاریخ/ساعت عمومی می‌شه.
        </p>

        <button type="button" onClick={handleGenerateAndUpload} disabled={generatingVideo} className="btn-primary w-full">
          {generatingVideo ? "در حال پردازش روی سرور..." : "🚀 ساخت و آپلود خودکار (روی سرور)"}
        </button>

        {videoGenStatus && (
          <p className="text-sm text-text-muted mt-2">
            {videoGenStatus}
            {generatingVideo ? ` (${videoGenProgress}%)` : ""}
          </p>
        )}
        {generatingVideo && (
          <p className="text-xs text-text-muted mt-1">
            ⏱️ زمان سپری‌شده: <span className="readout">{formatDuration(elapsedSeconds)}</span>
            {videoGenProgress > 3 &&
              <> — تخمین باقی‌مونده: ~<span className="readout">{formatDuration((elapsedSeconds / videoGenProgress) * (100 - videoGenProgress))}</span></>}
          </p>
        )}
        {generatingVideo && (
          <div className="progress-track mt-2">
            <div className="progress-fill" style={{ width: videoGenProgress + "%" }} />
          </div>
        )}
        {uploadedVideoId && (
          <p className="mt-3">
            <a
              href={`https://www.youtube.com/watch?v=${uploadedVideoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal font-medium hover:underline"
            >
              ▶️ مشاهده‌ی ویدیو در یوتیوب
            </a>
          </p>
        )}
      </section>

      {/* آپلود دستی */}
      <section className="card">
        <p className="text-sm text-text-muted mb-3">یا یک فایل ویدیوی آماده رو دستی آپلود کن:</p>

        <input
          type="file"
          accept="video/*"
          onChange={(e) => setFile(e.target.files[0])}
          className="text-sm text-text-muted mb-4 w-full file:btn-ghost file:mr-3 file:cursor-pointer"
        />

        <div className="rounded-md border border-border-light p-3 mb-4">
          <h3 className="text-sm font-semibold mb-2">برش ویدیو (اختیاری - داخل مرورگر انجام می‌شه)</h3>
          <div className="flex gap-2 mb-2">
            <div className="flex-1">
              <label className="field-label">شروع (ثانیه)</label>
              <input
                type="number"
                min="0"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="field-input"
              />
            </div>
            <div className="flex-1">
              <label className="field-label">مدت (ثانیه)</label>
              <input
                type="number"
                min="1"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="field-input"
              />
            </div>
          </div>
          <button type="button" onClick={handleTrim} disabled={trimming} className="btn-ghost">
            {trimming ? "در حال برش..." : "برش بزن"}
          </button>
          {trimStatus && <p className="text-sm text-text-muted mt-2">{trimStatus}</p>}
        </div>

        <form onSubmit={handleUpload}>
          <button type="submit" disabled={uploading} className="btn-secondary w-full">
            {uploading ? "در حال آپلود... " + progress + "%" : "آپلود دستی در یوتیوب"}
          </button>

          {uploading && (
            <div className="progress-track mt-2">
              <div className="progress-fill" style={{ width: progress + "%", backgroundColor: "var(--color-teal)" }} />
            </div>
          )}
        </form>

        {status && <p className="text-sm text-text-muted mt-3">{status}</p>}
      </section>
    </main>
  );
}
