"use client";

import { Icon } from "./StudioIcons";

const TOOLS = [
  { id: "text", icon: "text", label: "متن" },
  { id: "image", icon: "image", label: "عکس" },
  { id: "video", icon: "video", label: "ویدیو" },
  { id: "audio", icon: "audio", label: "صدا" },
  { id: "code", icon: "code", label: "کد", disabled: true },
  { id: "document", icon: "document", label: "سند", disabled: true },
  { id: "more", icon: "more", label: "بیشتر", disabled: true },
];

// رنگ‌بندیِ هرکدوم عمداً از توکن‌های رنگیِ خودِ پروژه گرفته شده (نه یک
// پالتِ تازه) — چهار رنگی که globals.css از قبل تعریف کرده (amber/teal/
// secondary/warning) دقیقاً همون تنوعِ رنگیِ کارت‌های تصویرِ مرجع رو می‌ده.
export const METHODS = [
  {
    id: "ai-only",
    icon: "robot",
    color: "teal",
    title: "فقط هوش مصنوعی",
    description: "متن، عکس، ویدیو و صدا — با providerهای واقعیِ تنظیم‌شده",
    available: true,
  },
  {
    id: "code-only",
    icon: "code",
    color: "secondary",
    title: "فقط کد",
    description: "ساخت با الگوریتم و کدنویسیِ قطعی، بدون AI",
    available: false,
  },
  {
    id: "ai-code",
    icon: "combine",
    color: "amber",
    title: "هوش مصنوعی + کد",
    description: "ترکیبِ AI برای ایده‌پردازی و کد برای اجرای دقیق",
    available: false,
  },
  {
    id: "hybrid",
    icon: "puzzle",
    color: "warning",
    title: "ترکیبِ پیشرفته",
    description: "ترکیبِ چند روش به‌صورتِ خودکار و بهینه",
    available: false,
  },
  {
    id: "other",
    icon: "more",
    color: "muted",
    title: "روش‌های دیگر",
    description: "ابزارهای خارجی و سرویس‌های سفارشی",
    available: false,
  },
];

const COLOR_CLASSES = {
  teal: { chip: "bg-teal/15 text-teal", ring: "border-teal shadow-[0_0_0_1px_var(--color-teal)]" },
  secondary: { chip: "bg-secondary/15 text-secondary", ring: "border-secondary shadow-[0_0_0_1px_var(--color-secondary)]" },
  amber: { chip: "bg-amber/15 text-amber", ring: "border-amber shadow-[0_0_0_1px_var(--color-amber)]" },
  warning: { chip: "bg-warning/15 text-warning", ring: "border-warning shadow-[0_0_0_1px_var(--color-warning)]" },
  muted: { chip: "bg-surface-raised text-text-muted", ring: "border-border-light" },
};

export default function StudioMethodBoard({ selectedMethod, onSelectMethod, selectedTool, onSelectTool }) {
  return (
    <div className="space-y-4">
      {/* ردیفِ آیکن‌های بالا — چهارتای اول واقعاً کار می‌کنن */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {TOOLS.map((tool) => {
          const active = !tool.disabled && selectedTool === tool.id && selectedMethod === "ai-only";
          return (
            <button
              key={tool.id}
              type="button"
              disabled={tool.disabled}
              onClick={() => {
                onSelectTool(tool.id);
                onSelectMethod("ai-only");
              }}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-4 py-3 min-w-[4.5rem] shrink-0 transition-colors ${
                active
                  ? "border-amber bg-amber/10 text-text"
                  : tool.disabled
                  ? "border-border text-text-faint opacity-50 cursor-not-allowed"
                  : "border-border text-text-muted hover:border-border-light hover:bg-surface-raised"
              }`}
            >
              <Icon name={tool.icon} className="w-5 h-5" />
              <span className="text-xs font-medium">{tool.label}</span>
            </button>
          );
        })}
      </div>

      {/* کارت‌های روشِ ساخت */}
      <div>
        <h2 className="text-sm font-semibold text-text-muted mb-2">روش‌های ساخت</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {METHODS.map((method) => {
            const c = COLOR_CLASSES[method.color];
            const active = selectedMethod === method.id;
            return (
              <button
                key={method.id}
                type="button"
                onClick={() => onSelectMethod(method.id)}
                className={`text-right rounded-xl border bg-surface p-3 transition-colors ${
                  active ? c.ring : "border-border hover:border-border-light"
                }`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2 ${c.chip}`}>
                  <Icon name={method.icon} className="w-5 h-5" />
                </div>
                <p className="text-sm font-semibold mb-0.5">{method.title}</p>
                <p className="text-[11px] text-text-faint leading-relaxed">{method.description}</p>
                {!method.available && (
                  <span className="inline-block mt-1.5 text-[10px] text-text-faint border border-border rounded-full px-1.5 py-0.5">
                    به‌زودی
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
