"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

const CAP_LABELS = { text: "متن", image: "عکس", video: "ویدیو", audio: "صدا" };
const CAP_ORDER = ["text", "image", "video", "audio"];

function CapBadges({ capabilities }) {
  if (!capabilities || capabilities.length === 0) {
    return <span style={{ color: "#999", fontSize: "0.75rem" }}>—</span>;
  }
  return (
    <span style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
      {capabilities.map((c) => (
        <span
          key={c}
          style={{
            fontSize: "0.7rem",
            padding: "0.1rem 0.4rem",
            borderRadius: "4px",
            background: "#e3f2fd",
            color: "#1565c0",
          }}
        >
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
      <main style={{ padding: "2rem", textAlign: "center", maxWidth: "700px", margin: "0 auto" }}>
        <p>برای مدیریت ارائه‌دهنده‌ها باید وارد بشی.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "1rem", maxWidth: "700px", margin: "0 auto" }}>
      <h2>🔌 ارائه‌دهنده‌های API</h2>

      <div
        style={{
          background: "#fff8e1",
          border: "1px solid #ffe082",
          borderRadius: "8px",
          padding: "0.8rem",
          fontSize: "0.85rem",
          marginBottom: "1.2rem",
        }}
      >
        یک اسم دلخواه و کلید API هر سرویسی رو بده (OpenAI، Groq، Anthropic،
        ElevenLabs، Stability AI، Pexels و...) — سیستم خودش با تست عملی
        تشخیص می‌ده این کلید چیکار می‌تونه بکنه (متن/عکس/ویدیو/صدا). اگه
        نشناخت، خودت از لیست انتخاب کن. برای هر نوع کار، وقتی چند
        ارائه‌دهنده باشه، ترتیب اولویت پایین همین صفحه مشخص می‌کنه کدوم
        اول امتحان بشه.
      </div>

      {error && <p style={{ color: "#c62828" }}>{error}</p>}

      <h3>ارائه‌دهنده‌های فعلی</h3>
      {loading ? (
        <p>در حال بارگذاری...</p>
      ) : providers.length === 0 ? (
        <p style={{ color: "#777" }}>هنوز ارائه‌دهنده‌ای اضافه نشده.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ddd", textAlign: "right" }}>
              <th style={{ padding: "0.4rem" }}>اسم</th>
              <th style={{ padding: "0.4rem" }}>سرویس</th>
              <th style={{ padding: "0.4rem" }}>قابلیت‌ها</th>
              <th style={{ padding: "0.4rem" }}>وضعیت</th>
              <th style={{ padding: "0.4rem" }}>فعال</th>
              <th style={{ padding: "0.4rem" }}></th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.4rem" }}>
                  {p.name}
                  {p.built_in && (
                    <span style={{ fontSize: "0.7rem", color: "#999" }}> (پیش‌فرض)</span>
                  )}
                </td>
                <td style={{ padding: "0.4rem" }}>
                  {p.service === "unknown" ? (
                    <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                      <select
                        value={pendingManual[p.id] ?? ""}
                        onChange={(e) =>
                          setPendingManual((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        style={{ fontSize: "0.8rem" }}
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
                        onClick={() => handleAssignService(p.id)}
                        disabled={!pendingManual[p.id]}
                        style={{ fontSize: "0.75rem" }}
                      >
                        ثبت
                      </button>
                    </div>
                  ) : (
                    services[p.service]?.label || p.service
                  )}
                </td>
                <td style={{ padding: "0.4rem" }}>
                  <CapBadges capabilities={p.capabilities} />
                </td>
                <td style={{ padding: "0.4rem" }}>
                  {p.last_check_ok === true && <span style={{ color: "#2e7d32" }}>✅</span>}
                  {p.last_check_ok === false && (
                    <span style={{ color: "#c62828" }} title={p.last_check_message}>
                      ❌
                    </span>
                  )}
                  {p.last_check_ok == null && <span style={{ color: "#999" }}>—</span>}
                  <button
                    type="button"
                    onClick={() => handleCheck(p.id)}
                    disabled={!!checking[p.id]}
                    style={{ fontSize: "0.7rem", marginRight: "0.3rem" }}
                  >
                    {checking[p.id] ? "..." : "تست"}
                  </button>
                </td>
                <td style={{ padding: "0.4rem" }}>
                  <input type="checkbox" checked={p.enabled} onChange={() => handleToggleEnabled(p)} />
                </td>
                <td style={{ padding: "0.4rem" }}>
                  <button type="button" onClick={() => handleDelete(p.id)} style={{ fontSize: "0.75rem" }}>
                    حذف
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>افزودن ارائه‌دهنده‌ی جدید</h3>
      <form onSubmit={handleAdd} style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "2rem" }}>
        <label>
          اسم (دلخواه):{" "}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثلاً: OpenAI اصلی"
            required
          />
        </label>
        <label>
          کلید API:{" "}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            required
            style={{ width: "100%", maxWidth: "320px" }}
          />
        </label>
        <button type="submit" disabled={adding}>
          {adding ? "در حال تشخیص و افزودن..." : "➕ افزودن (تشخیص خودکار)"}
        </button>
        {addMessage && <p style={{ fontSize: "0.85rem" }}>{addMessage}</p>}
      </form>

      <h3>اولویت هر نوع کار</h3>
      <p style={{ fontSize: "0.8rem", color: "#777" }}>
        وقتی چند ارائه‌دهنده یک کار رو انجام می‌دن، اولین موردی که تو لیست
        زیر بالاتره امتحان می‌شه؛ اگه شکست خورد، خودکار میره سراغ بعدی.
      </p>
      {CAP_ORDER.map((taskType) => {
        const list = getOrderedProviders(taskType);
        return (
          <div key={taskType} style={{ marginBottom: "1.2rem" }}>
            <strong style={{ fontSize: "0.85rem" }}>
              {taskLabels[taskType] || CAP_LABELS[taskType]}
            </strong>
            {list.length === 0 ? (
              <p style={{ fontSize: "0.8rem", color: "#999", margin: "0.3rem 0" }}>
                هیچ ارائه‌دهنده‌ی فعالی برای این کار نیست.
              </p>
            ) : (
              <ol style={{ margin: "0.3rem 0", paddingRight: "1.2rem" }}>
                {list.map((p, i) => (
                  <li key={p.id} style={{ fontSize: "0.85rem", marginBottom: "0.2rem" }}>
                    {p.name} ({services[p.service]?.label || p.service}){" "}
                    <button
                      type="button"
                      onClick={() => movePriority(taskType, i, -1)}
                      disabled={i === 0}
                      style={{ fontSize: "0.7rem" }}
                    >
                      ▲
                    </button>{" "}
                    <button
                      type="button"
                      onClick={() => movePriority(taskType, i, 1)}
                      disabled={i === list.length - 1}
                      style={{ fontSize: "0.7rem" }}
                    >
                      ▼
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </main>
  );
}
