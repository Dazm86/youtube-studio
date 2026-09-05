"use client";

import { useState } from "react";
import { Icon } from "./StudioIcons";
import { METHODS } from "./StudioMethodBoard";

const OPTIMIZE_OPTIONS = ["کیفیت", "سرعت", "هزینه"];

const CHECKLIST = [
  { done: true, label: "۴ ابزارِ واقعی: متن، عکس، ویدیو، صدا" },
  { done: true, label: "برای هرکدوم providerِ جدا انتخاب کن" },
  { done: true, label: "نتیجه رو مستقیم کپی یا دانلود کن" },
  { done: false, label: "روش‌های Code Only / AI+Code / ترکیبِ پیشرفته" },
  { done: false, label: "پیگیریِ خودکارِ هزینه و زمانِ ساخت" },
];

export default function StudioRightPanel({ selectedMethod, session, projectName, onProjectNameChange }) {
  const [autoSelect, setAutoSelect] = useState(true);
  const [optimizeFor, setOptimizeFor] = useState(OPTIMIZE_OPTIONS[0]);
  const [autoRetry, setAutoRetry] = useState(true);
  const [multiProvider, setMultiProvider] = useState(true);
  const [createdAt] = useState(() => new Date());

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

        <label className="flex items-center justify-between text-sm cursor-pointer">
          <span className="text-text-muted">تلاشِ خودکارِ مجدد</span>
          <input
            type="checkbox"
            checked={autoRetry}
            onChange={(e) => setAutoRetry(e.target.checked)}
            className="accent-amber w-4 h-4"
          />
        </label>
        <label className="flex items-center justify-between text-sm cursor-pointer">
          <span className="text-text-muted">استفاده از چند Provider</span>
          <input
            type="checkbox"
            checked={multiProvider}
            onChange={(e) => setMultiProvider(e.target.checked)}
            className="accent-amber w-4 h-4"
          />
        </label>
        <p className="text-[11px] text-text-faint">فعلاً نمایشیه — به‌زودی به تنظیماتِ واقعیِ providerها وصل می‌شه.</p>
      </div>

      {/* اطلاعاتِ پروژه — بخشی واقعیه (نام، کاربر، زمان)، بخشی صادقانه خالیه (هزینه/مدت) */}
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
              <span className="badge-ok">آماده</span>
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-faint">هزینه</dt>
            <dd className="text-text-faint">—</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-faint">مدت</dt>
            <dd className="text-text-faint">—</dd>
          </div>
        </dl>
      </div>

      {/* تاریخچه‌ی نسخه‌ها — صادقانه خالی، نه عددِ ساختگی */}
      <div className="card">
        <div className="flex items-center justify-between">
          <p className="field-label !mb-0">تاریخچه‌ی نسخه‌ها</p>
        </div>
        <p className="text-xs text-text-faint mt-2 leading-relaxed">
          بعد از اولین ساخت، نسخه‌ها اینجا نمایش داده می‌شن.
        </p>
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
