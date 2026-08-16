"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

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
      <main className="min-h-screen bg-bg text-text px-4 py-10 max-w-lg mx-auto text-center">
        <h2 className="text-xl font-bold mb-2">🔌 بررسی API ها</h2>
        <p className="text-text-muted">برای مشاهده‌ی این بخش، اول از بالای صفحه با گوگل وارد شو.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-text px-4 py-6 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-2">🔌 بررسی API ها</h1>
      <p className="text-sm text-text-muted mb-4">
        این صفحه فقط کلیدهای قدیمی Groq/Pexels (متغیر محیطی توی Render) رو چک می‌کنه. برای هر
        ارائه‌دهنده‌ی دیگه‌ای که اضافه کردی، وضعیتش رو از{" "}
        <Link href="/providers" className="text-teal hover:underline">
          ارائه‌دهنده‌های API
        </Link>{" "}
        ببین.
      </p>

      {loading && <p className="text-center text-text-muted">در حال بررسی...</p>}
      {error && <p className="text-center text-danger">خطا: {error}</p>}

      {info && (
        <div className="flex flex-col gap-3">
          <Row label="ورود گوگل" ok={info.auth.signedIn}>
            <p className="text-sm text-text-muted">
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
              <p className="text-sm text-text-muted">{info.database.videoCount} ویدیو ثبت شده</p>
            ) : (
              <p className="text-sm text-danger">{info.database.error}</p>
            )}
          </Row>
        </div>
      )}

      <button type="button" onClick={loadStatus} disabled={loading} className="btn-secondary w-full mt-6">
        🔄 بررسی دوباره
      </button>
    </main>
  );
}

function Badge({ ok }) {
  return <span className={ok ? "badge-ok" : "badge-fail"}>{ok ? "تنظیم شده ✅" : "تنظیم نشده ❌"}</span>;
}

function Row({ label, ok, children }) {
  return (
    <div className="card">
      <div className="flex justify-between items-center gap-2">
        <strong className="text-sm">{label}</strong>
        <Badge ok={ok} />
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

function TestButton({ onClick, disabled, testing, result }) {
  return (
    <div>
      <button type="button" onClick={onClick} disabled={disabled || testing} className="btn-ghost">
        {testing ? "در حال تست..." : "تست اتصال"}
      </button>
      {result && (
        <p className={"text-sm mt-1.5 " + (result.ok ? "text-teal" : "text-danger")}>
          {result.ok ? result.message : "خطا: " + result.error}
        </p>
      )}
    </div>
  );
}
