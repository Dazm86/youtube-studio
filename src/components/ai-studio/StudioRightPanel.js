"use client";

import { useState } from "react";
import { Icon } from "./StudioIcons";
import { METHODS } from "./StudioMethodBoard";

const OPTIMIZE_OPTIONS = ["کیفیت", "سرعت", "هزینه"];

const CHECKLIST = [
  { done: true, label: "۴ ابزارِ واقعی: متن، عکس، ویدیو، صدا" },
  { done: true, label: "برای هرکدوم providerِ جدا انتخاب کن" },
  { done: true, label: "نتیجه رو مستقیم کپی یا دانلود کن" },
  { done: true, label: "مدت و تاریخچه‌ی همین‌نشست واقعی‌ان" },
  { done: false, label: "روش‌های Code Only / AI+Code / ترکیبِ پیشرفته" },
  { done: false, label: "پیگیریِ خودکارِ هزینه (توکن/دلار)" },
];

function formatDuration(ms) {
  if (ms === undefined || ms === null) return "—";
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toLocaleString("fa-IR", { maximumFractionDigits: 1 })} ثانیه`;
  const min = Math.floor(totalSec / 60);
  const sec = Math.round(totalSec % 60);
  return `${min}:${String(sec).padStart(2, "0")} دقیقه`;
}

export default function StudioRightPanel({ selectedMethod, session, projectName, onProjectNameChange, sessionLog = [] }) {
  const [autoSelect, setAutoSelect] = useState(true);
  const [optimizeFor, setOptimizeFor] = useState(OPTIMIZE_OPTIONS[0]);
  const [createdAt] = useState(() => new Date());
  const lastActivity = sessionLog[0];

  return (
    <aside className="lg:w-80 shrink-0 space-y-4">
      {/* جزئیاتِ روش‌ها */}
      <div className="card">
        <p className="field-label">روش‌های ساخت (جزئیات)</p>
        <div className="space-y-2.5 mt-2">
          {METHODS.map((m) => (
            <div
              key={m.id}
              className={`flex items-start gap-2 text-xs rounded-lg p-1.5 -mx-1.5 ${
                selectedMethod === m.id ? "bg-surface-raised" : ""
              }`}
            >
              <Icon name={m.icon} className="w-4 h-4 mt-0.5 text-amber shrink-0" />
              <div>
                <p className="text-text font-medium">{m.title}</p>
                <p className="text-text-faint leading-relaxed">{m.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* تنظیماتِ پیشرفته — نمایشی */}
      <div className="card space-y-3">
        <p className="field-label">تنظیماتِ پیشرفته</p>

        <label className="flex items-center justify-between text-sm cursor-pointer">
          <span className="text-text-muted">انتخابِ خودکارِ بهترین روش</span>
          <input
            type="checkbox"
            checked={autoSelect}
            onChange={(e) => setAutoSelect(e.target.checked)}
            className="accent-amber w-4 h-4"
          />
        </label>

        <div>
          <label className="field-label">بهینه برایِ</label>
          <select value={optimizeFor} onChange={(e) => setOptimizeFor(e.target.value)} className="field-select">
            {OPTIMIZE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[11px] text-text-faint -mt-2">
          این دوتای بالا فعلاً نمایشی‌ان — روشِ دیگه‌ای غیر از «فقط هوش
          مصنوعی» نیست که بینشون انتخاب کنه.
        </p>

        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">تلاشِ خودکارِ مجدد</span>
          <span className="badge-ok">همیشه فعاله</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">استفاده از چند Provider</span>
          <span className="badge-ok">همیشه فعاله</span>
        </div>
        <p className="text-[11px] text-text-faint">
          این دوتا واقعاً همیشه روشنن، نه یک تنظیمِ قابل‌خاموش‌کردن — لایه‌ی
          providerها (lib/providers/router.js) بدونِ قید‌وشرط هم
          rate-limit/تایم‌اوت رو retry می‌کنه، هم به providerِ بعدی
          fallback می‌کنه.
        </p>
      </div>

      {/* اطلاعاتِ پروژه — بیشترش واقعیه (نام، کاربر، زمانِ شروع، وضعیت،
          مدت از رویِ sessionLog)؛ فقط هزینه صادقانه خالیه، چون هیچ‌جا
          توکن/دلار محاسبه نمی‌شه */}
      <div className="card space-y-2.5">
        <p className="field-label">اطلاعاتِ پروژه</p>
        <div>
          <label className="field-label !text-[10px]">نامِ پروژه</label>
          <input
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            className="field-input !py-1.5 !text-sm"
            placeholder="پروژه‌ی بدون‌نام"
          />
        </div>
        <dl className="text-xs space-y-1.5">
          <div className="flex justify-between">
            <dt className="text-text-faint">ساخته‌شده توسط</dt>
            <dd className="text-text-muted">{session?.user?.name || "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-faint">زمانِ شروع</dt>
            <dd className="text-text-muted readout">
              {createdAt.toLocaleString("fa-IR", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-faint">وضعیت</dt>
            <dd>
              {!lastActivity && <span className="badge-ok">آماده</span>}
              {lastActivity?.ok && <span className="badge-ok">تکمیل شد</span>}
              {lastActivity && !lastActivity.ok && <span className="badge-fail">خطا</span>}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-faint">هزینه</dt>
            <dd className="text-text-faint">—</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-faint">مدت</dt>
            <dd className="text-text-muted readout">{formatDuration(lastActivity?.durationMs)}</dd>
          </div>
        </dl>
      </div>

      {/* تاریخچه — واقعیه، ولی فقط تویِ همین نشست (رفرش پاکش می‌کنه)،
          چون هنوز جایی سمتِ سرور ذخیره نمی‌شه */}
      <div className="card">
        <p className="field-label">تاریخچه (همین نشست)</p>
        {sessionLog.length === 0 ? (
          <p className="text-xs text-text-faint mt-2 leading-relaxed">
            بعد از اولین ساخت، اینجا نمایش داده می‌شه.
          </p>
        ) : (
          <ul className="space-y-2.5 mt-2 max-h-64 overflow-y-auto">
            {sessionLog.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2 text-xs">
                <Icon
                  name={entry.ok ? "check" : "close"}
                  className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${entry.ok ? "text-teal" : "text-danger"}`}
                />
                <div className="min-w-0">
                  <p className={entry.ok ? "text-text-muted" : "text-danger"}>{entry.summary}</p>
                  <p className="text-text-faint readout">
                    {entry.at.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}
                    {entry.durationMs != null ? ` · ${formatDuration(entry.durationMs)}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* قابلیت‌ها */}
      <div className="card">
        <p className="field-label mb-2.5">قابلیت‌ها</p>
        <ul className="space-y-2">
          {CHECKLIST.map((item) => (
            <li key={item.label} className="flex items-start gap-2 text-xs">
              <Icon
                name={item.done ? "check" : "clock"}
                className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${item.done ? "text-teal" : "text-text-faint"}`}
              />
              <span className={item.done ? "text-text-muted" : "text-text-faint"}>{item.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
