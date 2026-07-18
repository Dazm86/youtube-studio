"use client";

import { useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

export default function Home() {
  const { data: session } = useSession();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState("private");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  function handleUpload(e) {
    e.preventDefault();
    if (!file) {
      setStatus("لطفاً یک فایل ویدیو انتخاب کنید.");
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
          setStatus(`✅ آپلود موفق! Video ID: ${data.videoId}`);
        } else {
          setStatus(`❌ خطا: ${data.error}`);
        }
      } catch {
        setStatus("❌ خطای نامشخص در پاسخ سرور");
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setStatus("❌ خطا در ارتباط با سرور");
    };

    xhr.open("POST", "/api/upload");
    xhr.send(formData);
  }

  return (
    <main style={{ padding: "2rem", textAlign: "center", maxWidth: "500px", margin: "0 auto" }}>
      <h1>YouTube Studio</h1>

      {session ? (
        <div>
          <p>سلام {session.user.name} 👋</p>
          <img
            src={session.user.image}
            alt="profile"
            style={{ borderRadius: "50%", width: "60px" }}
          />
          <br />
          <button onClick={() => signOut()} style={{ marginBottom: "2rem" }}>
            خروج
          </button>

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
              <option value="private">خصوصی (Private)</option>
              <option value="unlisted">لینک‌دار (Unlisted)</option>
              <option value="public">عمومی (Public)</option>
            </select>

            <input
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files[0])}
              required
            />

            <button type="submit" disabled={uploading}>
              {uploading ? `در حال آپلود... ${progress}%` : "آپلود در یوتیوب"}
            </button>

            {uploading && (
              <div style={{ width: "100%", background: "#eee", borderRadius: "8px", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${progress}%`,
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
