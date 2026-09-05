"use client";

import { useState } from "react";
import { Icon } from "./StudioIcons";
import { METHODS } from "./StudioMethodBoard";
import { TextGenerator } from "./TextGenerator";
import { ImageGenerator } from "./ImageGenerator";
import { VideoGenerator } from "./VideoGenerator";
import { AudioGenerator } from "./AudioGenerator";

const TOOL_TABS = [
  { id: "text", icon: "text", label: "متن" },
  { id: "image", icon: "image", label: "عکس" },
  { id: "video", icon: "video", label: "ویدیو" },
  { id: "audio", icon: "audio", label: "صدا" },
];

const CONTRIBUTION_BY_METHOD = {
  "ai-only": { ai: 100, code: 0 },
  "code-only": { ai: 0, code: 100 },
  "ai-code": { ai: 55, code: 45 },
  hybrid: { ai: 40, code: 30 },
  other: { ai: null, code: null },
};

const ORCHESTRATION_OPTIONS = ["AI تصمیم می‌گیرد", "کد تصمیم می‌گیرد", "دستیِ کاربر"];

export default function StudioBuildPanel({
  selectedMethod,
  selectedTool,
  onSelectTool,
  providers,
  providersLoading,
}) {
  const [orchestration, setOrchestration] = useState(ORCHESTRATION_OPTIONS[0]);
  const [autoOptimize, setAutoOptimize] = useState(true);

  const method = METHODS.find((m) => m.id === selectedMethod) || METHODS[0];
  const contribution = CONTRIBUTION_BY_METHOD[selectedMethod] || CONTRIBUTION_BY_METHOD["ai-only"];

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-text-muted mb-3">انتخاب و ترکیبِ روش‌ها</h2>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
        {/* ستونِ تنظیماتِ ترکیب — نمایشیه؛ فقط برایِ «فقط هوش مصنوعی» عدد
            واقعاً معنی داره (۱۰۰٪ AI)، بقیه صرفاً نسبتِ نمونه‌این. */}
        <div className="space-y-3">
          <p className="field-label">تنظیماتِ ترکیب</p>

          <div>
            <div className="flex items-center justify-between text-xs text-text-muted mb-1">
              <span>سهمِ هوش مصنوعی</span>
              <span className="readout">{contribution.ai ?? "—"}٪</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${contribution.ai ?? 0}%` }} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs text-text-muted mb-1">
              <span>سهمِ کد</span>
              <span className="readout">{contribution.code ?? "—"}٪</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${contribution.code ?? 0}%` }} />
            </div>
          </div>

          <div>
            <label className="field-label">تصمیم‌گیری</label>
            <select
              value={orchestration}
              onChange={(e) => setOrchestration(e.target.value)}
              className="field-select"
            >
              {ORCHESTRATION_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={autoOptimize}
              onChange={(e) => setAutoOptimize(e.target.checked)}
              className="accent-amber w-4 h-4"
            />
            بهینه‌سازیِ خودکار
          </label>
          <p className="text-[11px] text-text-faint">
            این بخش فعلاً نمایشیه — روی خروجیِ واقعی اثر نمی‌ذاره.
          </p>
        </div>

        {/* ستونِ ابزار و خروجی */}
        <div>
          {method.available ? (
            <>
              <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
                {TOOL_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onSelectTool(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm shrink-0 border transition-colors ${
                      selectedTool === tab.id
                        ? "bg-amber/20 border-amber text-amber"
                        : "border-border text-text-muted hover:bg-surface-raised"
                    }`}
                  >
                    <Icon name={tab.icon} className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </div>

              {providersLoading ? (
                <p className="text-sm text-text-muted py-6 text-center">در حال بارگذاری providerها...</p>
              ) : (
                <>
                  {selectedTool === "text" && <TextGenerator providers={providers.text} />}
                  {selectedTool === "image" && <ImageGenerator providers={providers.image} />}
                  {selectedTool === "video" && <VideoGenerator providers={providers.video} />}
                  {selectedTool === "audio" && <AudioGenerator providers={providers.audio} />}

                  {providers[selectedTool]?.length === 0 && (
                    <div className="mt-3 rounded-lg border border-amber-dim bg-amber/10 p-3 text-xs text-amber">
                      هیچ providerِ فعالی برای «{TOOL_TABS.find((t) => t.id === selectedTool)?.label}» تنظیم
                      نشده — از صفحه‌ی{" "}
                      <a href="/providers" className="underline">
                        ارائه‌دهنده‌های API
                      </a>{" "}
                      اضافه کن.
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-surface-raised/50 p-6 text-center">
              <div className="w-10 h-10 rounded-lg bg-surface-raised border border-border-light flex items-center justify-center mx-auto mb-3 text-text-faint">
                <Icon name={method.icon} className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium mb-1">«{method.title}» هنوز پیاده‌سازی نشده</p>
              <p className="text-xs text-text-faint max-w-xs mx-auto">
                فعلاً فقط «فقط هوش مصنوعی» (متن/عکس/ویدیو/صدا) واقعاً کار می‌کنه.
              </p>
              <button type="button" disabled className="btn-primary mt-4">
                تولید / ساخت
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
