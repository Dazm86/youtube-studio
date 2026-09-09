"use client";

import { useState } from "react";

// ۲۰۲۶-۰۹-۰۸ — بر خلافِ دکمه‌ی «پیش‌نویس پست کامیونیتی» تو VideoActions
// (که همیشه بهِ یک ویدیوی مشخص وصله)، این کارت یک تِمِ آزاد می‌گیره و
// ۳ پست برای پرکردنِ فاصله‌ی بینِ آپلودها می‌سازه — چیزی که قبلاً روی
// سایت اصلاً وجود نداشت. هیچ‌جا ذخیره نمی‌شه (چون community_posts
// video_id رو NOT NULL می‌خواد و اینجا ویدیویی درکار نیست)، فقط نمایش
// داده می‌شه تا کاربر خودش کپی/پیست کنه.
export default function ThemedCommunityPosts() {
  const [theme, setTheme] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [posts, setPosts] = useState(null);

  async function handleGenerate() {
    if (!theme.trim()) return;
    setLoading(true);
    setError("");
    setPosts(null);
    try {
      const res = await fetch("/api/community/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در ساختِ پست‌ها");
      setPosts(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="card mb-4">
      <h3 className="font-semibold mb-2">📌 پست‌های کامیونیتیِ تمی (بینِ آپلودها)</h3>
      <p className="text-xs text-text-muted mb-2">
        یک تم/موضوعِ کلی بده، ۳ پیش‌نویس (نظرسنجی + سوالِ بحث + نکته‌ی تیزری) می‌سازه — جدا از پستِ خودکارِ بعدِ هر آپلود.
      </p>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          placeholder="مثلاً: عادت‌های صبحگاهی"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          className="field-input flex-1"
        />
        <button type="button" onClick={handleGenerate} disabled={loading || !theme.trim()} className="btn-secondary shrink-0">
          {loading ? "..." : "بساز"}
        </button>
      </div>

      {error && <div className="text-xs text-danger mb-1.5">{error}</div>}

      {posts && (
        <div className="space-y-2">
          <div className="text-xs bg-surface-raised border border-border rounded-md p-2">
            <strong>نظرسنجی:</strong> {posts.poll.postText}
            {posts.poll.pollOptions?.length > 0 && (
              <ul className="mt-1 pr-4 list-disc">
                {posts.poll.pollOptions.map((opt, i) => (
                  <li key={i}>{opt}</li>
                ))}
              </ul>
            )}
            {posts.poll.visual && <div className="text-text-muted mt-1">🎨 {posts.poll.visual}</div>}
          </div>
          <div className="text-xs bg-surface-raised border border-border rounded-md p-2">
            <strong>سوالِ بحث:</strong> {posts.discussion.postText}
            {posts.discussion.visual && <div className="text-text-muted mt-1">🎨 {posts.discussion.visual}</div>}
          </div>
          <div className="text-xs bg-surface-raised border border-border rounded-md p-2">
            <strong>تیزر/نکته:</strong> {posts.teaser.postText}
            {posts.teaser.visual && <div className="text-text-muted mt-1">🎨 {posts.teaser.visual}</div>}
          </div>
          <p className="text-xs text-text-muted">{posts.note}</p>
        </div>
      )}
    </div>
  );
}
