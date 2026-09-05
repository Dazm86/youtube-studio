"use client";

import { Icon } from "./StudioIcons";

// این استریپ صرفاً توضیحیه (چطور یک ویدیو از خط تولیدِ واقعیِ خودِ سایت
// درمیاد) — نه یک progress tracker زنده برای این صفحه. مرحله‌ها و
// نقش‌ها عیناً معادلِ چیزیه که ROADMAP.md/PROJECT_STATE.md توصیف می‌کنن
// (Trend Finder → اسکریپت → TTS/رسانه → رندرِ FFmpeg → کنترلِ کیفیت →
// آپلود)، نه یک مفهومِ انتزاعیِ «بساز هرچی رو با هر روشی».
const STEPS = [
  { icon: "idea", label: "ایده" },
  { icon: "research", label: "تحقیق (Trend Finder)" },
  { icon: "script", label: "اسکریپت" },
  { icon: "generate", label: "تولید هوش‌مصنوعی" },
  { icon: "render", label: "پردازش (رندرِ FFmpeg)" },
  { icon: "edit", label: "کنترلِ کیفیت" },
  { icon: "output", label: "خروجیِ ویدیو" },
  { icon: "publish", label: "انتشار در یوتیوب" },
];

const ROLES = [
  { icon: "research", label: "یابنده‌ی ترند" },
  { icon: "script", label: "نویسنده‌ی اسکریپت" },
  { icon: "audio", label: "صداپیشه (TTS)" },
  { icon: "render", label: "رندرگر" },
  { icon: "check", label: "ناظرِ کیفیت" },
];

export default function StudioWorkflow() {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-text-muted mb-3">
        جریانِ کار (مسیرِ واقعیِ ساختِ یک ویدیو)
      </h2>

      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((step, i) => (
          <div key={step.label} className="flex items-center gap-1 shrink-0">
            <div className="flex flex-col items-center gap-1.5 w-20">
              <div className="w-10 h-10 rounded-lg bg-surface-raised border border-border-light flex items-center justify-center text-amber">
                <Icon name={step.icon} className="w-5 h-5" />
              </div>
              <span className="text-[11px] text-text-muted text-center leading-tight">{step.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <span className="text-text-faint text-sm shrink-0 -mt-4">←</span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-border border-dashed">
        <p className="text-xs text-text-faint mb-2">نقش‌های درگیر در این مسیر</p>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((role) => (
            <span
              key={role.label}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-xs text-text-muted"
            >
              <Icon name={role.icon} className="w-3.5 h-3.5 text-amber" />
              {role.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
