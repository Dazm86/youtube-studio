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

  // بخش برش ویدیو
  const [startTime, setStartTime] = useState("0");
  const [duration, setDuration] = useState("");
  const [trimming, setTrimming] = useState(false);
  const [trimStatus, setTrimStatus] = useState("");
  const ffmpegRef = useRef(new FFmpeg());
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);

  // بخش ساخت ویدیوی خودکار (اسکریپت -> صدا)
  const [script, setScript] = useState("");
  const [generatingVoice, setGeneratingVoice] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);

  async function handleGenerateVoice() {
    if (!script.trim()) {
      setVoiceStatus("اول یک متن اسکریپت بنویسید.");
      return;
    }

    setGeneratingVoice(true);
    setVoiceStatus("در حال تولید صدا...");
    setAudioUrl(null);

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: script, voice: "en-US-GuyNeural" }),
      });

      if (!res.ok) {
        const errData = await res.json();
        setVoiceStatus(`❌ خطا: ${errData.error}`);
        setGeneratingVoice(false);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setVoiceStatus("✅ صدا تولید شد.");
    } catch (err) {
      setVoiceStatus(`❌ خطا: ${err.message}`);
    }

    setGeneratingVoice(false);
  }

  async function loadFFmpeg() {
    if (ffmpegLoaded) return;
    setTrimStatus("در حال بارگذاری موتور برش (فقط بار اول)...");
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    const ffmpeg = ffmpegRef.current;
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    setFfmpegLoaded(true);
  }

  async function handleTrim() {
    if (!file) {
      setTrimStatus("اول یک فایل ویدیو انتخاب کنید.");
      return;
    }
    if (!duration) {
      setTrimStatus("مدت زمان برش را وارد کنید.");
      return;
    }

    setTrimming(true);
    try {
      await loadFFmpeg();
      setTrimStatus("در حال برش ویدیو...");

      const ffmpeg = ffmpegRef.current;
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
      setTrimStatus("✅ برش انجام شد.
