// ست کوچیکِ آیکن‌های inline SVG برای بازطراحیِ AI Studio (۲۰۲۶-۰۹-۰۵).
// عمداً به‌جای یک کتابخونه‌ی جدید (مثلاً lucide-react) — که معلوم نیست
// اصلاً تو package.json نصب باشه یا نه، و اضافه‌کردنِ یک import ناموجود
// دقیقاً همون کلاسِ باگی بود که همین امروز build رو ۴ بار شکونده بود —
// چندتا مسیرِ SVG دستی و ساده اینجا نگه داشته می‌شن. فقط برای المان‌های
// اصلی/پرتکرار (نه هر آیکنِ ریز)؛ بقیه‌ی جاها همون سبکِ ایموجیِ رایج تو
// این پروژه (NavBar، PRESETS و...) حفظ شده.

const PATHS = {
  sparkle: "M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z",
  text: "M4 5h16M4 12h16M4 19h10",
  image: "M4 5h16v14H4V5zm2 11l4-4 3 3 3-4 4 5H6z M8.5 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  video: "M4 5h11v14H4V5zm11 5l5-3v10l-5-3v-4z",
  audio: "M5 10v4h3l4 4V6L8 10H5z M15.5 9a4 4 0 010 6 M18 7a7 7 0 010 10",
  code: "M9 6l-5 6 5 6 M15 6l5 6-5 6 M13 4l-2 16",
  document: "M6 3h8l4 4v14H6V3zm8 0v4h4",
  more: "M5 12a1.3 1.3 0 102.6 0 1.3 1.3 0 00-2.6 0zM10.7 12a1.3 1.3 0 102.6 0 1.3 1.3 0 00-2.6 0zM16.4 12a1.3 1.3 0 102.6 0 1.3 1.3 0 00-2.6 0z",
  robot: "M9 8V5h6v3 M6 8h12v10a2 2 0 01-2 2H8a2 2 0 01-2-2V8z M9 13v2 M15 13v2 M4 10h2v4H4v-4z M18 10h2v4h-2v-4z",
  combine: "M6 6a3 3 0 100 6 3 3 0 000-6zM18 12a3 3 0 100 6 3 3 0 000-6z M8.5 8.5L15.5 15.5",
  puzzle: "M9 4h4v2.2a1.8 1.8 0 003.5.6L18 6l1 4h-2.2a1.8 1.8 0 000 3.5L18 15l-1 4h-4v-2.2a1.8 1.8 0 00-3.5-.6L9 18l-1-4h2.2a1.8 1.8 0 000-3.5L9 8l1-4z",
  plus: "M12 5v14M5 12h14",
  edit: "M4 20l1-4.5L15.5 5 19 8.5 8.5 19 4 20z",
  analyze: "M5 19V9M11 19V5M17 19v-7",
  automate: "M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3 M15 5h4V1 M9 19H5v4",
  agents: "M8 11a3 3 0 100-6 3 3 0 000 6zM16 11a3 3 0 100-6 3 3 0 000 6z M2 20c0-3 3-5 6-5s6 2 6 5 M14 15c2.2.4 4 2.1 4 5",
  assets: "M4 8l8-4 8 4-8 4-8-4zM4 8v8l8 4 8-4V8 M12 12v8",
  publish: "M12 4l5 5h-3v7h-4v-7H7l5-5zM5 20h14",
  templates: "M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z",
  workflows: "M5 6h5v5H5V6zm9 7h5v5h-5v-5zM10 8.5h4a2 2 0 012 2V13",
  plug: "M9 3v4M15 3v4M6 9h12l-1 5a5 5 0 01-10 0L6 9zM12 18v3",
  settings: "M12 8a4 4 0 100 8 4 4 0 000-8z M4.5 12h2M17.5 12h2M12 4.5v2M12 17.5v2M6.8 6.8l1.4 1.4M15.8 15.8l1.4 1.4M6.8 17.2l1.4-1.4M15.8 8.2l1.4-1.4",
  idea: "M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.4.9 1 .9 1.7v.4h5.2v-.4c0-.7.3-1.3.9-1.7A6 6 0 0012 3z",
  research: "M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3",
  script: "M6 3h9l4 4v14H6V3zm9 0v4h4M9 12h6M9 15h6M9 9h3",
  generate: "M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z",
  render: "M4 6h16v9H4V6zM8 19h8M9 15l3-3 3 3",
  output: "M4 5h16v14H4V5zm4 9l3-3 2 2 4-4",
  copy: "M8 8h11v11H8V8zM5 16V4h11",
  check: "M5 12l4 4 10-10",
  clock: "M12 7v5l3.5 2 M12 21a9 9 0 100-18 9 9 0 000 18z",
};

export function Icon({ name, className = "w-5 h-5", strokeWidth = 1.75 }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
