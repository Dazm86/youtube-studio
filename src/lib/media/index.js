// این فایل قبلاً مستقیم به Pexels وصل می‌شد؛ الان فقط یک لایه‌ی نازک
// روی lib/providers/router.js هست — امضای fetchImages/fetchClips دقیقاً
// همونیه که قبلاً بود (api/images، api/clips، pipeline.js بدون تغییر
// همینا رو صدا می‌زنن)، ولی پشتِ صحنه router بر اساس اولویتِ تنظیم‌شده
// تو صفحه‌ی «ارائه‌دهنده‌های API» تصمیم می‌گیره از کدوم سرویس استفاده کنه.

export { extractKeywords } from "../providers/textUtils.js";
export { fetchImages, fetchClips } from "../providers/router.js";
