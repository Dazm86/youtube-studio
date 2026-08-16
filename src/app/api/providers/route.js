import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { listProviders, createProvider, getAllPriorities } from "@/lib/db";
import { detectService, REGISTRY, TASK_LABELS } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }
  try {
    const [providers, priorities] = await Promise.all([listProviders(), getAllPriorities()]);
    const services = Object.fromEntries(
      Object.entries(REGISTRY).map(([id, e]) => [id, { label: e.label, capabilities: e.capabilities }])
    );
    return NextResponse.json({ providers, priorities, services, taskLabels: TASK_LABELS });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const { name, apiKey, service: manualService, capabilities: manualCapabilities } = await req.json();

  if (!name || !name.trim()) {
    return NextResponse.json({ error: "اسم لازمه" }, { status: 400 });
  }
  if (!apiKey || !apiKey.trim()) {
    return NextResponse.json({ error: "کلید API لازمه" }, { status: 400 });
  }

  try {
    let service;
    let capabilities;
    let detected = true;

    if (manualService && REGISTRY[manualService]) {
      // کاربر خودش نوع سرویس رو انتخاب کرده (چون تشخیص خودکار نشناخته بود)
      service = manualService;
      capabilities = REGISTRY[manualService].capabilities;
      detected = false;
    } else {
      const result = await detectService(apiKey.trim());
      service = result.service;
      capabilities = result.capabilities;
      if (service === "unknown" && Array.isArray(manualCapabilities)) {
        capabilities = manualCapabilities;
      }
    }

    const id = await createProvider({ name: name.trim(), service, apiKey: apiKey.trim(), capabilities });

    return NextResponse.json({
      id,
      service,
      capabilities,
      recognized: service !== "unknown",
      message:
        service === "unknown"
          ? "این کلید رو نشناختم — نوع سرویس رو دستی از لیست انتخاب کن."
          : `شناخته شد: ${REGISTRY[service]?.label || service} ✅`,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
