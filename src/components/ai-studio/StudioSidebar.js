"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./StudioIcons";

// هرکدوم از اینا یا به یک صفحه‌ی واقعی وصلن (href داره) یا هنوز صفحه‌ای
// پشتشون نیست (href نداره → غیرفعال نمایش داده می‌شه، نه یک لینکِ مرده).
// فهرستِ صفحاتِ واقعی از PROJECT_STATE.md → «Pages» گرفته شده، نه حدس.
const NAV_ITEMS = [
  { icon: "sparkle", label: "ساخت", href: "/ai-studio", description: "متن، عکس، ویدیو، صدا" },
  { icon: "edit", label: "ویرایش", href: null, description: "اصلاح و تنظیمِ خروجی‌ها" },
  { icon: "analyze", label: "تحلیل", href: "/analytics", description: "آنالیزِ کانال" },
  { icon: "automate", label: "خودکارسازی", href: "/schedule", description: "زمان‌بندیِ خودکار" },
  { icon: "agents", label: "فضای Agentها", href: null, description: "همکاریِ چند-Agent" },
  { icon: "assets", label: "دارایی‌ها", href: null, description: "مدیریتِ فایل‌ها" },
  { icon: "publish", label: "انتشار", href: null, description: "پابلیش در همه‌جا" },
];

const NAV_SECONDARY = [
  { icon: "templates", label: "قالب‌ها", href: null },
  { icon: "workflows", label: "جریان‌های کاری", href: null },
  { icon: "plug", label: "مدل‌ها و Providerها", href: "/providers" },
  { icon: "settings", label: "تنظیمات", href: null },
];

function NavRow({ item }) {
  const pathname = usePathname();
  const active = item.href && pathname === item.href;

  const content = (
    <>
      <Icon name={item.icon} className="w-[18px] h-[18px] shrink-0" />
      <span className="flex flex-col items-start leading-tight">
        <span className="text-sm font-medium">{item.label}</span>
        {item.description && (
          <span className="text-[11px] text-text-faint">{item.description}</span>
        )}
      </span>
      {!item.href && (
        <span className="mr-auto text-[10px] text-text-faint border border-border rounded-full px-1.5 py-0.5">
          به‌زودی
        </span>
      )}
    </>
  );

  const rowClasses =
    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors " +
    (active
      ? "bg-amber/15 text-amber"
      : item.href
      ? "text-text-muted hover:bg-surface-raised hover:text-text"
      : "text-text-faint cursor-not-allowed opacity-60");

  if (item.href) {
    return (
      <Link href={item.href} className={rowClasses} aria-current={active ? "page" : undefined}>
        {content}
      </Link>
    );
  }
  return (
    <div className={rowClasses} aria-disabled="true">
      {content}
    </div>
  );
}

export default function StudioSidebar({ onNewProject }) {
  return (
    <aside className="lg:w-60 shrink-0 flex lg:flex-col gap-4 lg:gap-6 overflow-x-auto lg:overflow-visible">
      <div className="hidden lg:block">
        <div className="flex items-center gap-2 mb-1">
          <Icon name="sparkle" className="w-6 h-6 text-amber" />
          <span className="text-lg font-bold">AI Studio</span>
        </div>
        <p className="text-xs text-text-faint">هر چیزی را، به هر روشی بساز</p>
      </div>

      <button onClick={onNewProject} className="btn-primary hidden lg:flex w-full">
        <Icon name="plus" className="w-4 h-4" />
        پروژه‌ی جدید
      </button>

      <nav className="flex lg:flex-col gap-1 shrink-0" aria-label="بخش‌های AI Studio">
        {NAV_ITEMS.map((item) => (
          <div key={item.label} className="lg:block shrink-0 min-w-[9rem] lg:min-w-0">
            <NavRow item={item} />
          </div>
        ))}
      </nav>

      <div className="hidden lg:block h-px bg-border" />

      <nav className="hidden lg:flex lg:flex-col gap-1" aria-label="ابزارهای بیشتر">
        {NAV_SECONDARY.map((item) => (
          <NavRow key={item.label} item={item} />
        ))}
      </nav>

      {/* Resource Monitor — عمداً صفر/خالیه، نه عددِ ساختگی: هنوز هیچ‌جا
          مصرفِ API/توکن/فضا برای این صفحه محاسبه نمی‌شه. */}
      <div className="hidden lg:block mt-auto">
        <div className="card !p-3 space-y-3">
          <p className="field-label !mb-0">پایشِ منابع</p>
          {[
            { label: "هزینه‌ی API", note: "هنوز محاسبه نمی‌شه" },
            { label: "توکن‌ها", note: "به‌زودی" },
            { label: "فضای ذخیره", note: "به‌زودی" },
          ].map((row) => (
            <div key={row.label}>
              <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                <span>{row.label}</span>
                <span className="text-text-faint">{row.note}</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: "0%" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
