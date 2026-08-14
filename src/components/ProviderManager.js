"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

const CAP_LABELS = { text: "متن", image: "عکس", video: "ویدیو", audio: "صدا" };
const CAP_ORDER = ["text", "image", "video", "audio"];

function CapBadges({ capabilities }) {
  if (!capabilities || capabilities.length === 0) {
    return <span className="text-text-faint text-xs">—</span>;
  }
  return (
    <span className="flex gap-1 flex-wrap">
      {capabilities.map((c) => (
        <span key={c} className="badge-neutral !bg-teal/15 !text-teal">
          {CAP_LABELS[c] || c}
        </span>
      ))}
    </span>
  );
}

export default function ProviderManager() {
  const { data: session, status: sessionStatus } = useSession();
  const [providers, setProviders] = useState([]);
  const [priorities, setPriorities] = useState({});
  const [services, setServices] = useState({});
  const [taskLabels, setTaskLabels] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // فرم افزودن
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addMessage, setAddMessage] = useState("");

  // ردیف‌هایی که تشخیص خودکار نشناختشون و منتظر انتخاب دستی سرویس هستن
  const [pendingManual, setPendingManual] = useState({}); // { [providerId]: selectedServiceId }

  const [checking, setChecking] = useState({}); // { [providerId]: true }

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/providers");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در بارگذاری");
      setProviders(data.providers || []);
      setPriorities(data.priorities || {});
      setServices(data.services || {});
      setTaskLabels(data.taskLabels || {});
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  async function handleAdd(e) {
    e.preventDefault();
    setAdding(true);
    setAddMessage("");
    setError("");
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در افزودن");
      setAddMessage(data.message || "");
      if (!data.recognized) {
        setPendingManual((prev) => ({ ...prev, [data.id]: "" }));
      }
      setName("");
      setApiKey("");
      await loadData();
    } catch (err) {
      setError(err.message);
    }
    setAdding(false);
  }

  async function handleAssignService(providerId) {
    const service = pendingManual[providerId];
    if (!service) return;
    try {
      await fetch(`/api/providers/${providerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      });
      setPendingManual((prev) => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleEnabled(p) {
    try {
      await fetch(`/api/providers/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !p.enabled }),
      });
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    try {
      await fetch(`/api/providers/${id}`, { method: "DELETE" });
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCheck(id) {
    setChecking((prev) => ({ ...prev, [id]: true }));
    try {
      await fetch(`/api/providers/${id}/check`, { method: "POST" });
      await loadData();
    } catch (err) {
      setError(err.message);
    }
    setChecking((prev) => ({ ...prev, [id]: false }));
  }

  function getOrderedProviders(taskType) {
    const capable = providers.filter((p) => p.capabilities.includes(taskType) && p.enabled);
    const order = priorities[taskType] || [];
    const inOrder = order.map((id) => capable.find((p) => p.id === id)).filter(Boolean);
    const rest = capable
      .filter((p) => !order.includes(p.id))
      .sort((a, b) => a.id - b.id);
    return [...inOrder, ...rest];
  }

  async function movePriority(taskType, index, direction) {
    const list = getOrderedProviders(taskType);
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= list.length) return;
    const reordered = [...list];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];
    try {
      await fetch("/api/providers/priority", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType, order: reordered.map((p) => p.id) }),
      });
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  if (sessionStatus === "loading") return null;
  if (!session) {
    return (
      <main className="min-h-screen bg-bg text-text px-4 py-10 max-w-2xl mx-auto text-center">
        <p className="text-text-muted">برای مدیریت ارائه‌دهنده‌ها باید وارد بشی.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-text px-4 py-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-3">🔌 ارائه‌دهنده‌های API</h1>

      <div className="rounded-lg border border-amber-dim bg-amber/10 text-sm p-3 mb-5 leading-relaxed">
        یک اسم دلخواه و کلید API هر سرویسی رو بده (OpenAI، Groq، Anthropic،
        ElevenLabs، Stability AI، Pexels و...) — سیستم خودش با تست عملی
        تشخیص می‌ده این کلید چیکار می‌تونه بکنه (متن/عکس/ویدیو/صدا). اگه
        نشناخت، خودت از لیست انتخاب کن. برای هر نوع کار، وقتی چند
        ارائه‌دهنده باشه، ترتیب اولویت پایین همین صفحه مشخص می‌کنه کدوم
        اول امتحان بشه.
      </div>

      {error && <p className="text-danger mb-3">{error}</p>}

      <h2 className="font-semibold mb-2">ارائه‌دهنده‌های فعلی</h2>
      {loading ? (
        <p className="text-text-muted">در حال بارگذاری...</p>
      ) : providers.length === 0 ? (
        <p className="text-text-muted mb-6">هنوز ارائه‌دهنده‌ای اضافه نشده.</p>
      ) : (
        <>
          {/* دسکتاپ: جدول */}
          <div className="hidden md:block overflow-x-auto mb-6">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-border text-right">
                  <th className="p-2 text-text-muted font-medium">اسم</th>
                  <th className="p-2 text-text-muted font-medium">سرویس</th>
                  <th className="p-2 text-text-muted font-medium">قابلیت‌ها</th>
                  <th className="p-2 text-text-muted font-medium">وضعیت</th>
                  <th className="p-2 text-text-muted font-medium">فعال</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.id} className="border-b border-border">
                    <td className="p-2">
                      {p.name}
                      {p.built_in && <span className="text-xs text-text-faint"> (پیش‌فرض)</span>}
                    </td>
                    <td className="p-2">
                      <ServiceCell
                        p={p}
                        services={services}
                        pendingManual={pendingManual}
                        setPendingManual={setPendingManual}
                        onAssign={handleAssignService}
                      />
                    </td>
                    <td className="p-2">
                      <CapBadges capabilities={p.capabilities} />
                    </td>
                    <td className="p-2">
                      <CheckCell p={p} checking={checking} onCheck={handleCheck} />
                    </td>
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={() => handleToggleEnabled(p)}
                        className="w-4 h-4 accent-amber"
                      />
                    </td>
                    <td className="p-2">
                      <button type="button" onClick={() => handleDelete(p.id)} className="btn-danger-ghost">
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* موبایل: کارت */}
          <div className="md:hidden flex flex-col gap-3 mb-6">
            {providers.map((p) => (
              <div key={p.id} className="card">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="font-medium">
                    {p.name}
                    {p.built_in && <span className="text-xs text-text-faint"> (پیش‌فرض)</span>}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-text-muted">
                    فعال
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={() => handleToggleEnabled(p)}
                      className="w-4 h-4 accent-amber"
                    />
                  </label>
                </div>
                <div className="mb-2">
                  <ServiceCell
                    p={p}
                    services={services}
                    pendingManual={pendingManual}
                    setPendingManual={setPendingManual}
                    onAssign={handleAssignService}
                  />
                </div>
                <div className="mb-2">
                  <CapBadges capabilities={p.capabilities} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <CheckCell p={p} checking={checking} onCheck={handleCheck} />
                  <button type="button" onClick={() => handleDelete(p.id)} className="btn-danger-ghost">
                    حذف
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="font-semibold mb-2">افزودن ارائه‌دهنده‌ی جدید</h2>
      <form onSubmit={handleAdd} className="card flex flex-col gap-3 mb-6">
        <div>
          <label className="field-label">اسم (دلخواه)</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثلاً: OpenAI اصلی"
            required
            className="field-input"
          />
        </div>
        <div>
          <label className="field-label">کلید API</label>
          <div className="flex gap-2">
            <input
              type={showApiKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              required
              className="field-input flex-1"
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              className="btn-icon shrink-0"
              aria-label={showApiKey ? "پنهان کردن کلید" : "نمایش کلید"}
              title={showApiKey ? "پنهان کردن کلید" : "نمایش کلید"}
            >
              {showApiKey ? "🙈" : "👁️"}
            </button>
          </div>
        </div>
        <button type="submit" disabled={adding} className="btn-primary">
          {adding ? "در حال تشخیص و افزودن..." : "➕ افزودن (تشخیص خودکار)"}
        </button>
        {addMessage && <p className="text-sm text-text-muted">{addMessage}</p>}
      </form>

      <h2 className="font-semibold mb-1">اولویت هر نوع کار</h2>
      <p className="text-sm text-text-muted mb-3">
        وقتی چند ارائه‌دهنده یک کار رو انجام می‌دن، اولین موردی که تو لیست
        زیر بالاتره امتحان می‌شه؛ اگه شکست خورد، خودکار میره سراغ بعدی.
      </p>
      {CAP_ORDER.map((taskType) => {
        const list = getOrderedProviders(taskType);
        return (
          <div key={taskType} className="card mb-3">
            <strong className="text-sm">{taskLabels[taskType] || CAP_LABELS[taskType]}</strong>
            {list.length === 0 ? (
              <p className="text-sm text-text-faint mt-1.5">هیچ ارائه‌دهنده‌ی فعالی برای این کار نیست.</p>
            ) : (
              <div className="flex flex-col gap-1.5 mt-2">
                {list.map((p, i) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-surface-raised border border-border px-2.5 py-1.5"
                  >
                    <span className="text-sm">
                      {p.name} <span className="text-text-muted">({services[p.service]?.label || p.service})</span>
                    </span>
                    <div className="flex gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => movePriority(taskType, i, -1)}
                        disabled={i === 0}
                        className="btn-icon !w-8 !h-8"
                        aria-label="بالاتر"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => movePriority(taskType, i, 1)}
                        disabled={i === list.length - 1}
                        className="btn-icon !w-8 !h-8"
                        aria-label="پایین‌تر"
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </main>
  );
}

function ServiceCell({ p, services, pendingManual, setPendingManual, onAssign }) {
  if (p.service !== "unknown") {
    return <span>{services[p.service]?.label || p.service}</span>;
  }
  return (
    <div className="flex gap-1.5 items-center flex-wrap">
      <select
        value={pendingManual[p.id] ?? ""}
        onChange={(e) => setPendingManual((prev) => ({ ...prev, [p.id]: e.target.value }))}
        className="field-select !py-1.5 !text-sm w-auto"
      >
        <option value="">ناشناخته — انتخاب کن</option>
        {Object.entries(services).map(([id, s]) => (
          <option key={id} value={id}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onAssign(p.id)}
        disabled={!pendingManual[p.id]}
        className="btn-ghost"
      >
        ثبت
      </button>
    </div>
  );
}

function CheckCell({ p, checking, onCheck }) {
  return (
    <div className="flex items-center gap-2">
      {p.last_check_ok === true && <span className="badge-ok">✅ سالم</span>}
      {p.last_check_ok === false && (
        <span className="badge-fail" title={p.last_check_message}>
          ❌ خطا
        </span>
      )}
      {p.last_check_ok == null && <span className="badge-neutral">—</span>}
      <button type="button" onClick={() => onCheck(p.id)} disabled={!!checking[p.id]} className="btn-ghost">
        {checking[p.id] ? "..." : "تست"}
      </button>
    </div>
  );
}
