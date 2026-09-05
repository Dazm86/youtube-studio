"use client";

// نمونه‌های ترکیب — صرفاً الهام‌بخشن (مثلِ ردیفِ پایینِ تصویرِ مرجع)، هیچ‌کدوم
// کلیک‌پذیر نیستن. محتواشون هم انتزاعی نیست: هرکدوم یا الان تو خودِ سایت
// (جای دیگه‌ای، نه این صفحه) واقعاً وجود داره یا مسیرِ منطقیِ بعدیه.
const COMBOS = [
  { color: "teal", lines: ["ایده از یابنده‌ی ترند", "اسکریپتِ خودکار"] },
  { color: "secondary", lines: ["روایتِ صوتی (TTS)", "زیرنویسِ خودکار"] },
  { color: "amber", lines: ["پیش‌نویسِ پاسخِ کامنت", "بازبینیِ دستی"] },
  { color: "warning", lines: ["پستِ کامیونیتی", "هشتگ‌های پیشنهادی"] },
  { color: "muted", lines: ["تحلیلِ بازخوردِ نگه‌داری", "پیشنهادِ موضوعِ بعدی"] },
];

const COLOR_CLASSES = {
  teal: "border-teal/40 bg-teal/5",
  secondary: "border-secondary/40 bg-secondary/5",
  amber: "border-amber/40 bg-amber/5",
  warning: "border-warning/40 bg-warning/5",
  muted: "border-border-light bg-surface-raised",
};

export default function StudioTemplates() {
  return (
    <div>
      <h2 className="text-sm font-semibold text-text-muted mb-2">نمونه‌ی ترکیبِ روش‌ها</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {COMBOS.map((combo, i) => (
          <div
            key={i}
            className={`rounded-xl border p-3 text-center text-xs text-text-muted space-y-1 ${COLOR_CLASSES[combo.color]}`}
          >
            <p>{combo.lines[0]}</p>
            <p className="text-text-faint">+</p>
            <p>{combo.lines[1]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
