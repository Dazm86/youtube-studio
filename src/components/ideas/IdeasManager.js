"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession, signIn } from "next-auth/react";

const FORMATS = [
  { key: "both", label: "هر دو (لانگ یا شورت)" },
  { key: "long", label: "فقط لانگ" },
  { key: "short", label: "فقط شورت" },
];
const FORMAT_BADGE = { both: "لانگ/شورت", long: "لانگ", short: "شورت" };

const TABS = [
  { key: "queue", label: "در صف" },
  { key: "used", label: "ساخته شده" },
  { key: "skipped", label: "کنار گذاشته" },
];

function inTab(idea, tab) {
  if (tab === "queue") return idea.status === "pending" || idea.status === "in_progress";
  return idea.status === tab;
}

export default function IdeasManager() {
  const { data: session, status: sessionStatus } = useSession();
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("queue");
  const [idea, setIdea] = useState("");
  const [notes, setNotes] = useState("");
  const [format, setFormat] = useState("both");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ideas");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در دریافتِ ایده‌ها");
      setIdeas(data.ideas || []);
      setError("");
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  async function addIdea() {
    if (saving || idea.trim().length < 3) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, notes, format }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در ذخیره");
      setIdea("");
      setNotes("");
      setTab("queue");
      await load();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function setStatus(id, status) {
    setError("");
    const res = await fetch(`/api/ideas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "خطا");
    await load();
  }

  async function remove(id) {
    if (!window.confirm("این ایده حذف بشه؟")) return;
    setError("");
    const res = await fetch(`/api/ideas/${id}`, { method: "DELETE" });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "خطا");
    await load();
  }

  if (sessionStatus === "loading") return null;
  if (!session) {
    return (
      <main className="min-h-screen bg-bg text-text flex flex-col items-center justify-center px-6 gap-4 text-center">
        <p className="text-text-muted">برای ثبتِ ایده باید وارد بشی.</p>
        <button onClick={() => signIn("google")} className="btn-primary px-6">
          ورود با گوگل
        </button>
      </main>
    );
  }

  const visible = ideas.filter((i) => inTab(i, tab));
  const queueCount = ideas.filter((i) => inTab(i, "queue")).length;

  return (
    <main className="min-h-screen bg-bg text-text px-4 py-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-1">💡 ایده‌های من</h1>
      <p className="text-sm text-text-muted mb-5">
        ایده‌ات رو اینجا بنویس. آپلودِ خودکار و «ساختِ کاملاً خودکار» اول از همین صف (به ترتیبِ ورود) برمی‌دارن؛
        اگه صف خالی باشه، مثلِ قبل خودِ هوش‌مصنوعی موضوع انتخاب می‌کنه. می‌تونی به فارسی هم بنویسی — اسکریپت
        همچنان انگلیسی ساخته می‌شه.
      </p>

      <div className="card mb-5">
        <label className="field-label">ایده / موضوعِ ویدیو</label>
        <input
          className="field-input w-full mb-3"
          value={idea}
          maxLength={300}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="مثلاً: چرا شب‌ها نمی‌تونم ذهنم رو خاموش کنم"
        />
        <label className="field-label">توضیحِ اختیاری (زاویه، نکته، چیزی که حتماً بگه)</label>
        <textarea
          className="field-input w-full mb-3"
          rows={2}
          value={notes}
          maxLength={600}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="مثلاً: با یه مثالِ واقعی از سرِ کار شروع بشه"
        />
        <div className="flex gap-2 items-center">
          <select className="field-input flex-1" value={format} onChange={(e) => setFormat(e.target.value)}>
            {FORMATS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <button onClick={addIdea} disabled={saving || idea.trim().length < 3} className="btn-primary px-5 shrink-0">
            {saving ? "..." : "افزودن"}
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-danger mb-3">{error}</div>}

      <div className="flex gap-2 mb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={tab === t.key ? "btn-secondary" : "btn-ghost"}
          >
            {t.label}
            {t.key === "queue" ? ` (${queueCount})` : ""}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-text-muted text-sm">در حال بارگذاری...</p>
      ) : visible.length === 0 ? (
        <p className="text-text-muted text-sm">
          {tab === "queue" ? "صف خالیه — یه ایده اضافه کن." : "چیزی اینجا نیست."}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((i) => (
            <li key={i.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium break-words">{i.idea}</p>
                  {i.notes && <p className="text-xs text-text-muted mt-1 break-words">{i.notes}</p>}
                </div>
                <span className="badge-neutral shrink-0">{FORMAT_BADGE[i.format] || i.format}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {i.status === "in_progress" && <span className="text-xs text-text-muted">⏳ در حال ساخت...</span>}
                {i.status === "used" && i.video_id && (
                  <a
                    className="text-xs underline"
                    href={`https://www.youtube.com/watch?v=${i.video_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ▶ دیدنِ ویدیو
                  </a>
                )}
                {i.status === "pending" && (
                  <button className="btn-ghost text-xs" onClick={() => setStatus(i.id, "skipped")}>
                    کنار بگذار
                  </button>
                )}
                {i.status === "skipped" && (
                  <button className="btn-ghost text-xs" onClick={() => setStatus(i.id, "pending")}>
                    برگردان به صف
                  </button>
                )}
                {i.status !== "in_progress" && (
                  <button className="btn-ghost text-xs" onClick={() => remove(i.id)}>
                    حذف
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
