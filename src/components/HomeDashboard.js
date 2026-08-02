"use client";

import Link from "next/link";
import { useSession, signIn } from "next-auth/react";

const SECTIONS = [
  {
    href: "/long",
    emoji: "🎬",
    title: "ویدیوی لانگ",
    desc: "نوشتن سناریو، ساخت صدا و رندر خودکار ویدیوی بلند افقی",
  },
  {
    href: "/short",
    emoji: "⚡",
    title: "ویدیوی شورت",
    desc: "ساخت خودکار شورت عمودی برای یوتیوب",
  },
  {
    href: "/api-check",
    emoji: "🔌",
    title: "بررسی API ها",
    desc: "وضعیت اتصال به گوگل، Groq، Pexels و دیتابیس",
  },
  {
    href: "/analytics",
    emoji: "📊",
    title: "آنالیز کانال",
    desc: "آمار واقعی بازدید، لایک و سابسکرایب ویدیوهای منتشرشده",
  },
];

export default function HomeDashboard() {
  const { data: session, status: sessionStatus } = useSession();

  if (sessionStatus === "loading") return null;

  if (!session) {
    return (
      <main style={{ padding: "2rem", textAlign: "center", maxWidth: "500px", margin: "0 auto" }}>
        <h1>استودیوی یوتیوب</h1>
        <p style={{ color: "#666" }}>برای شروع، اول با حساب گوگل وارد شو.</p>
        <button onClick={() => signIn("google")}>ورود با گوگل</button>
      </main>
    );
  }

  return (
    <main style={{ padding: "1rem", maxWidth: "700px", margin: "0 auto" }}>
      <h1 style={{ textAlign: "center" }}>سلام {session.user.name} 👋</h1>
      <p style={{ textAlign: "center", color: "#666", marginBottom: "1.5rem" }}>
        از یکی از بخش‌های زیر شروع کن:
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1rem",
        }}
      >
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            style={{
              display: "block",
              border: "1px solid #ddd",
              borderRadius: "10px",
              padding: "1.25rem",
              textDecoration: "none",
              color: "#222",
            }}
          >
            <div style={{ fontSize: "1.8rem" }}>{s.emoji}</div>
            <div style={{ fontWeight: "bold", margin: "0.4rem 0" }}>{s.title}</div>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>{s.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
