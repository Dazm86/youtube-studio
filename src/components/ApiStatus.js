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
