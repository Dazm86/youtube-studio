"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";

// ترتیب و محتوای این لیست عمداً با NAV_ITEMS توی NavBar.js همسو نگه داشته
// می‌شه — قبلاً «زمان‌بندی خودکار» توی نوار بالا بود ولی اینجا نبود، یعنی
// از صفحه‌ی اصلی اصلاً قابل کشف نبود.
const sections = [
  {
    index: "01",
    href: "/long",
    title: "ویدیوی لانگ",
    desc: "ساخت و آپلود ویدیوهای ۵ تا ۱۰ دقیقه‌ای، افقی",
  },
  {
    index: "02",
    href: "/short",
    title: "ویدیوی شورت",
    desc: "ساخت و آپلود ویدیوهای ۳۰ تا ۶۰ ثانیه‌ای، عمودی",
  },
  {
    index: "03",
    href: "/trends",
    title: "📈 یافتن ترند",
    desc: "هر ۶ ساعت خودکار: Google Trends + یوتیوب + ردیت + اخبار، امتیازدهی، و صف تأیید موضوع",
  },
  {
    index: "04",
    href: "/activity",
    title: "📋 گزارش فعالیت",
    desc: "هر آپلود، اسکنِ ترند، و اجرای خودکارِ زمان‌بندی‌شده — یک فیدِ زنده از هر اتفاقِ سایت",
  },
  {
    index: "05",
    href: "/ai-studio",
    title: "🎨 AI Studio",
    desc: "تولید متن، عکس، ویدیو و صدا با هوش مصنوعی",
  },
  {
    index: "06",
    href: "/providers",
    title: "ارائه‌دهنده‌های API",
    desc: "یک کلید بده، خودش تشخیص می‌ده چیکار می‌تونه بکنه و اولویتش رو تنظیم کن",
  },
  {
    index: "07",
    href: "/api-check",
    title: "بررسی API ها",
    desc: "وضعیت اتصال Pexels، Groq، یوتیوب، دیتابیس",
  },
  {
    index: "08",
    href: "/analytics",
    title: "آنالیز کانال",
    desc: "آمار واقعی ویدیوها: ویو، سابسکرایب، لایک",
  },
  {
    index: "09",
    href: "/schedule",
    title: "زمان‌بندی خودکار",
    desc: "ساخت و انتشار خودکار ویدیو در روز و ساعت مشخص، بدون دست زدن",
  },
];

export default function Home() {
  const { data: session } = useSession();

  if (!session) {
    return (
      <main className="min-h-screen bg-bg text-text flex flex-col items-center justify-center px-6 gap-6">
        <div className="text-center">
          <p className="label-plate text-teal mb-2">THE MINDFUL PATH — STUDIO</p>
          <h1 className="text-2xl font-bold">استودیوی یوتیوب</h1>
        </div>
        <button onClick={() => signIn("google")} className="btn-primary px-6">
          ورود با گوگل
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-text px-4 py-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-border">
        <div>
          <p className="label-plate text-teal">THE MINDFUL PATH — STUDIO</p>
          <p className="text-sm text-text-muted mt-0.5">{session.user.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <img src={session.user.image} alt="" className="w-9 h-9 rounded-full border border-border-light" />
          <button onClick={() => signOut()} className="btn-ghost">
            خروج
          </button>
        </div>
      </div>

      <div className="grid gap-3">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="block bg-surface border border-border rounded-lg p-4 hover:border-amber transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="label-plate text-amber">{s.index}</span>
              <h2 className="font-semibold">{s.title}</h2>
            </div>
            <p className="text-sm text-text-muted">{s.desc}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
