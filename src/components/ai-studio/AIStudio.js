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

  useEffect(() => {
    if (session) loadProviders();
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

  // «پروژه‌ی جدید» صرفاً یک ریست محلیه — چیزی رو تو دیتابیس ذخیره/حذف
  // نمی‌کنه، چون این صفحه هنوز مفهومِ «پروژه»‌ی پایدار نداره.
  function handleNewProject() {
    setSelectedMethod("ai-only");
    setSelectedTool("text");
    setProjectName("");
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
        <StudioSidebar onNewProject={handleNewProject} />

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
          />

          <StudioTemplates />
        </div>

        <StudioRightPanel
          selectedMethod={selectedMethod}
          session={session}
          projectName={projectName}
          onProjectNameChange={setProjectName}
        />
      </div>
    </main>
  );
}