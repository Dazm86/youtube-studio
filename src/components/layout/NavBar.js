"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";

const NAV_ITEMS = [
  { href: "/", label: "خانه" },
  { href: "/long", label: "ویدیوی لانگ" },
  { href: "/short", label: "ویدیوی شورت" },
  { href: "/ai-studio", label: "🎨 AI Studio" },
  { href: "/providers", label: "🔌 ارائه‌دهنده‌های API" },
  { href: "/api-check", label: "بررسی API ها" },
  { href: "/analytics", label: "آنالیز کانال" },
  { href: "/schedule", label: "⏰ زمان‌بندی خودکار" },
];

export default function NavBar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  // اگه توکن گوگل منقضی و قابل تمدید نبود، خودکار خارج کن — این چک
  // قبلاً توی صفحه‌ی اصلی بود، الان چون NavBar توی همه‌ی صفحه‌ها هست
  // یک‌بار برای همیشه اینجا انجام می‌شه.
  useEffect(() => {
    if (session?.error === "RefreshAccessTokenError") {
      signOut({ redirect: false });
    }
  }, [session]);

  return (
    <header className="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-border">
      <div className="max-w-3xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 font-bold text-text shrink-0">
            <span className="text-lg leading-none">🎬</span>
            <span className="hidden xs:inline">استودیوی یوتیوب</span>
          </Link>

          {session ? (
            <div className="flex items-center gap-2 shrink-0">
              <img
                src={session.user.image}
                alt=""
                className="w-8 h-8 rounded-full border border-border-light"
              />
              <span className="hidden sm:inline text-sm text-text-muted max-w-[9rem] truncate">
                {session.user.name}
              </span>
              <button onClick={() => signOut()} className="btn-ghost">
                خروج
              </button>
            </div>
          ) : (
            <button onClick={() => signIn("google")} className="btn-primary">
              ورود با گوگل
            </button>
          )}
        </div>

        {session && (
          <nav
            className="flex items-center gap-1.5 overflow-x-auto mt-3 -mx-4 px-4 pb-1"
            style={{ scrollbarWidth: "thin" }}
          >
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium min-h-[38px] flex items-center transition-colors " +
                    (active
                      ? "bg-amber text-bg"
                      : "bg-surface-raised text-text-muted hover:text-text border border-border")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
