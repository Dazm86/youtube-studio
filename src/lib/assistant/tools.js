// src/lib/assistant/tools.js
//
// ابزارهایی که دستیار می‌تونه صدا بزنه — همه فقط-خواندنی (read-only)،
// هیچ‌کدوم چیزی رو تغییر نمی‌دن. هر تابع دقیقاً از همون توابعِ DB ای که
// بقیه‌ی سایت هم استفاده می‌کنن می‌خونه (هیچ کوئریِ جدیدی نساختیم)، پس
// دستیار همیشه دقیقاً همون داده‌ای رو می‌بینه که خودِ صفحات (/, /trends,
// /schedule, /activity) نشون می‌دن.

import { getAllVideos, listSchedules, listRecentScheduleRuns } from "../db/index.js";
import { listRecentEvents } from "../activityLog.js";
import { listTrendTopics, getLatestScan } from "../trends/db.js";

const GITHUB_OWNER = process.env.GITHUB_REPOSITORY_OWNER || "Dazm86";
const GITHUB_REPO = process.env.GITHUB_REPOSITORY_NAME || "youtube-studio";

async function githubFetch(path) {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
  if (!token) throw new Error("GITHUB_TOKEN تنظیم نشده — دسترسی به گیت‌هاب ممکن نیست.");
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`GitHub API خطای ${res.status} داد`);
  return res.json();
}

// شکلِ JSON Schema ای که Groq (سازگار با فرمتِ OpenAI tools) می‌خواد.
export const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_recent_videos",
      description: "لیستِ ویدیوهای اخیراً ساخته/آپلودشده رو با آمارشون (بازدید، لایک، CTR تامبنیل، درصدِ نگه‌داشت) برمی‌گردونه.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "حداکثر تعداد ویدیو، پیش‌فرض ۱۰" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_schedule_status",
      description: "زمان‌بندی‌های آپلودِ خودکار (روزها، ساعت، فعال/غیرفعال) و آخرین اجراهاشون رو برمی‌گردونه.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_trend_topics",
      description: "موضوعاتِ ترندِ پیداشده توسطِ Trend Finder رو برمی‌گردونه، به‌همراه اطلاعاتِ آخرین اسکن.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "فیلترِ وضعیت: pending, approved, rejected, produced (اختیاری، پیش‌فرض همه)" },
          limit: { type: "number", description: "حداکثر تعداد، پیش‌فرض ۱۰" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_activity_log",
      description: "رخدادهای اخیرِ ثبت‌شده تو سایت (آپلود موفق/ناموفق، اسکنِ ترند، هشدارها و غیره) رو برمی‌گردونه.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "فیلترِ نوعِ رخداد (اختیاری، مثلاً video_uploaded, video_failed, trend_scan_completed)" },
          limit: { type: "number", description: "حداکثر تعداد، پیش‌فرض ۲۰" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_github_workflow_runs",
      description: "اجراهای اخیرِ GitHub Actions (مثلاً worker رندر) رو با وضعیت‌شون (موفق/شکست/در حال اجرا) برمی‌گردونه.",
      parameters: {
        type: "object",
        properties: {
          workflow: { type: "string", description: "اسمِ فایلِ workflow برای فیلتر، مثلاً render-worker.yml (اختیاری، پیش‌فرض همه)" },
          limit: { type: "number", description: "حداکثر تعداد، پیش‌فرض ۱۰" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_github_recent_commits",
      description: "commit های اخیرِ ریپازیتوریِ پروژه رو (پیام، نویسنده، تاریخ) برمی‌گردونه.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "حداکثر تعداد، پیش‌فرض ۱۰" } },
      },
    },
  },
];

export const TOOL_EXECUTORS = {
  get_recent_videos: async ({ limit = 10 } = {}) => {
    const videos = await getAllVideos();
    return videos.slice(0, limit).map((v) => ({
      title: v.title,
      mode: v.video_mode,
      views: v.views,
      likes: v.likes,
      thumbnailCtr: v.thumbnail_ctr,
      retentionPct: v.retention_pct,
      createdAt: v.created_at,
    }));
  },

  get_schedule_status: async () => {
    const schedules = await listSchedules();
    const recentRuns = await listRecentScheduleRuns(10);
    return { schedules, recentRuns };
  },

  get_trend_topics: async ({ status, limit = 10 } = {}) => {
    const topics = await listTrendTopics({ status, limit });
    const latestScan = await getLatestScan();
    return { topics, latestScan };
  },

  get_activity_log: async ({ type, limit = 20 } = {}) => {
    return await listRecentEvents({ type, limit });
  },

  get_github_workflow_runs: async ({ workflow, limit = 10 } = {}) => {
    const path = workflow
      ? `/actions/workflows/${workflow}/runs?per_page=${limit}`
      : `/actions/runs?per_page=${limit}`;
    const data = await githubFetch(path);
    return (data.workflow_runs || []).map((r) => ({
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      createdAt: r.created_at,
      url: r.html_url,
    }));
  },

  get_github_recent_commits: async ({ limit = 10 } = {}) => {
    const data = await githubFetch(`/commits?per_page=${limit}`);
    return (data || []).map((c) => ({
      message: c.commit?.message,
      author: c.commit?.author?.name,
      date: c.commit?.author?.date,
      sha: c.sha?.slice(0, 7),
    }));
  },
};
