"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";

const NAV_ITEMS = [
  { href: "/", label: "خانه" },
  { href: "/long", label: "ویدیوی لانگ" },
  { href: "/short", label: "ویدیوی شورت" },
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
    <header style={{ borderBottom: "1px solid #ddd", marginBottom: "1.5rem" }}>
      <div style={{ maxWidth: "700px", margin: "0 auto", padding: "0.75rem 1rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <Link
            href="/"
            style={{ fontWeight: "bold", fontSize: "1.1rem", textDecoration: "none", color: "#222" }}
          >
            🎬 استودیوی یوتیوب
          </Link>

          {session ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <img
                src={session.user.image}
                alt="profile"
                style={{ borderRadius: "50%", width: "28px", height: "28px" }}
              />
              <span style={{ fontSize: "0.85rem" }}>{session.user.name}</span>
              <button onClick={() => signOut()} style={{ fontSize: "0.8rem" }}>
                خروج
              </button>
            </div>
          ) : (
            <button onClick={() => signIn("google")} style={{ fontSize: "0.85rem" }}>
              ورود با گوگل
            </button>
          )}
        </div>

        {session && (
          <nav style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    fontSize: "0.8rem",
                    padding: "0.3rem 0.6rem",
                    borderRadius: "6px",
                    textDecoration: "none",
                    color: active ? "#fff" : "#333",
                    background: active ? "#2196F3" : "#f0f0f0",
                  }}
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
