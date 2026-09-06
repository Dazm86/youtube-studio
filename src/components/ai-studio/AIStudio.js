"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Icon } from "./StudioIcons";
import StudioSidebar from "./StudioSidebar";
import StudioMethodBoard from "./StudioMethodBoard";
import StudioWorkflow from "./StudioWorkflow";
import StudioBuildPanel from "./StudioBuildPanel";
import StudioRightPanel from "./StudioRightPanel";
import StudioTemplates from "./StudioTemplates";

export default function AIStudio() {
  const { data: session, status: sessionStatus } = useSession();
  const [selectedMethod, setSelectedMethod] = useState("ai-only");
  const [selectedTool, setSelectedTool] = useState("text");
  const [projectName, setProjectName] = useState("");
  const [providers, setProviders] = useState({});
  const [loading, setLoading] = useState(true);
  const [sessionLog, setSessionLog] = useState([]);
  const [usageSummary, setUsageSummary] = useState(null);

  useEffect(() => {
    if (session) {
      loadProviders();
      loadActivity();
    }
  }, [session]);

  async function loadProviders() {
    try {
      const res = await fetch("/api/providers");
      const data = await res.json();
      if (res.ok) {
        setProviders({
          text: data.providers?.filter((p) => p.capabilities.includes("text") && p.enabled) || [],
          image: data.providers?.filter((p) => p.capabilities.includes("image") && p.enabled) || [],
          video: data.providers?.filter((p) => p.capabilities.includes("video") && p.enabled) || [],
          audio: data.providers?.filter((p) => p.capabilities.includes("audio") && p.enabled) || [],
        });
      }
    } catch (err) {
      console.error("Failed to load providers:", err);
    }
    setLoading(false);
  }

  // ۲۰۲۶-۰۹-۰۶ — تاریخچه و پایشِ منابع حالا واقعاً پایدارن (جدولِ
  // studio_activity، پرشده از خودِ route هایِ generate-*)، نه فقط
  // همین‌نشست. این fetch نسخه‌ی واقعیِ همه‌ی نشست‌های قبلی رو میاره؛
  // handleActivity پایین فقط رویِ همینه که برایِ بازخوردِ فوری (بدونِ
  // صبر برایِ رفرش) رویِ همون لیست optimistic اضافه می‌کنه.
  async function loadActivity() {
    try {
      const res = await fetch("/api/ai-studio/activity");
      const data = await res.json();
      if (res.ok) {
        setSessionLog(
          (data.activity || []).map((row) => ({
            id: row.id,
            tool: row.tool,
            ok: row.ok,
            summary: row.summary,
            durationMs: row.duration_ms,
            at: new Date(row.created_at),
          }))
        );
        setUsageSummary(data.usage || null);
      }
    } catch (err) {
      console.error("Failed to load AI Studio activity:", err);
    }
  }

  // بازخوردِ فوریِ سمتِ کلاینت — خودِ رویدادِ واقعی از قبل تو
  // generate-*/route.js سمتِ سرور لاگ شده (این‌جا فقط دوباره نمایشش
  // می‌ده تا لازم نباشه صبر کنی صفحه رفرش بشه).
  function handleActivity(activity) {
    if (activity.phase === "start") return;
    setSessionLog((prev) => [
      {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        tool: activity.tool,
        ok: activity.phase === "done",
        summary: activity.phase === "done" ? activity.summary : activity.message,
        durationMs: activity.durationMs,
        at: new Date(),
      },
      ...prev,
    ]);
  }

  // «پروژه‌ی جدید» فقط نمایشِ محلی رو پاک می‌کنه — چیزی از
  // studio_activity واقعاً حذف نمی‌شه؛ با رفرش دوباره‌ی صفحه، تاریخچه‌ی
  // کامل (شاملِ چیزهایی که همین‌جا موقتاً پنهون شدن) دوباره میاد.
  function handleNewProject() {
    setSelectedMethod("ai-only");
    setSelectedTool("text");
    setProjectName("");
    setSessionLog([]);
  }

  if (sessionStatus === "loading") return null;
  if (!session) {
    return (
      <main className="min-h-screen bg-bg text-text px-4 py-10 max-w-3xl mx-auto text-center">
        <p className="text-text-muted">برای استفاده از AI Studio باید وارد بشی.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-text px-4 py-6 max-w-[100rem] mx-auto">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
            <Icon name="sparkle" className="w-6 h-6 text-amber" />
            AI Studio
          </h1>
          <p className="text-text-muted text-sm">
            هر چیزی را، به هر روشی بساز — با هوش مصنوعی، با کد، یا هر ترکیبِ دیگری
          </p>
        </div>
        <button onClick={handleNewProject} className="btn-primary lg:hidden shrink-0">
          <Icon name="plus" className="w-4 h-4" />
          جدید
        </button>
      </header>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <StudioSidebar onNewProject={handleNewProject} usageSummary={usageSummary} />

        <div className="flex-1 min-w-0 w-full space-y-4">
          <StudioMethodBoard
            selectedMethod={selectedMethod}
            onSelectMethod={setSelectedMethod}
            selectedTool={selectedTool}
            onSelectTool={setSelectedTool}
          />

          <StudioWorkflow />

          <StudioBuildPanel
            selectedMethod={selectedMethod}
            selectedTool={selectedTool}
            onSelectTool={setSelectedTool}
            providers={providers}
            providersLoading={loading}
            onActivity={handleActivity}
          />

          <StudioTemplates />
        </div>

        <StudioRightPanel
          selectedMethod={selectedMethod}
          session={session}
          projectName={projectName}
          onProjectNameChange={setProjectName}
          sessionLog={sessionLog}
        />
      </div>
    </main>
  );
}