// One-click "produce a whole video" orchestrator, requested 2026-08-28.
// Chains together pieces that already exist rather than reimplementing
// any of them: Trend Finder (topic selection) -> generateScript() ->
// generateMetadata() -> runPipeline() (which itself already does voice +
// media search + render + captions + upload as one call). Verified
// against the real signatures in lib/script/index.js, lib/metadata/
// index.js, and lib/pipeline.js — nothing here is guessed.

import { generateScript } from './script/index.js';
import { generateMetadata } from './metadata/index.js';
import { runPipeline } from './pipeline.js';
import { getTrendTopicById, listTrendTopics, markTrendTopicProduced } from './trends/db.js';
import { getAllVideos } from './db/index.js';
import { findSimilarTitles } from './utils/topicSimilarity.js';
import { claimNextIdea, markIdeaUsed, releaseIdea } from './ideas/db.js';
import { buildIdeaTopic } from './ideas/pick.js';

/**
 * Steps 1-3 only (topic selection, script, metadata) — split out so the
 * API route can reuse it for BOTH paths: in-process (this file's own
 * autoProduceVideo below) and worker-dispatch (mirrors how
 * generate-and-upload/route.js already generates the script up front,
 * then only hands the render+upload part to the worker).
 */
// عنوانِ ویدیوهایِ قبلیِ کانال برایِ تشخیصِ تکراری. هر شکستی (DB و...) یعنی
// «بدونِ تشخیصِ تکراری ادامه بده» — این چک هیچ‌وقت نباید تولید رو بگیره.
async function existingVideoTitles() {
  try {
    return (await getAllVideos()).map((v) => v.title).filter(Boolean);
  } catch (err) {
    console.error("existingVideoTitles failed (duplicate check skipped):", err.message);
    return [];
  }
}

export async function prepareAutoProduceScript({ mode, topicId, topic, accessToken }, { emit = () => {} } = {}) {
  emit({ status: "در حال انتخاب موضوع...", progress: 1 });
  let trendTopicRow = null;
  let ideaRow = null;
  let topicText = "";
  if (topicId) {
    trendTopicRow = await getTrendTopicById(topicId);
    if (!trendTopicRow) throw new Error(`موضوع ترند با id=${topicId} پیدا نشد`);
    topicText = trendTopicRow.topic;
    if (trendTopicRow.status === 'produced') {
      emit({ status: `⚠️ از این موضوع قبلاً ویدیو ساخته شده${trendTopicRow.video_id ? ` (${trendTopicRow.video_id})` : ''} — دوباره ساخته می‌شه چون صراحتاً انتخابش کردی`, progress: 2 });
    }
  } else if (topic && topic.trim()) {
    // موضوعی که کاربر خودش تو فیلدِ استودیو تایپ کرده (یا از لینکِ
    // «باز کردن دستی» یک موضوعِ تأییدشده پر شده) — اولویتش از
    // auto-pick بیشتره، ولی هیچ ردیفِ trend_topics ای بهش وصل نیست
    // (پس در پایان چیزی به‌عنوانِ «produced» علامت زده نمی‌شه).
    topicText = topic.trim();
  } else {
    // ۲۰۲۶-۱۰-۰۱ — اولویتِ اول: «ایده‌هایِ من» (صفی که صاحبِ کانال دستی پر
    // می‌کنه، صفحه‌ی /ideas). ایده اتمیک «ادعا» می‌شه (in_progress) تا هیچ
    // اجرایِ هم‌زمانِ دیگه‌ای برش نداره؛ شکستِ بعدی ایده رو به صف برمی‌گردونه
    // (releaseIdea) و موفقیت «used» علامتش می‌زنه. هر خطایِ DB اینجا یعنی «بدونِ
    // ایده ادامه بده» — صفِ ایده‌ها نباید تولید رو بگیره.
    try {
      ideaRow = await claimNextIdea(mode);
    } catch (ideaErr) {
      console.error("claimNextIdea failed (continuing without user ideas):", ideaErr.message);
    }
    if (ideaRow) {
      topicText = buildIdeaTopic(ideaRow);
      emit({ status: `💡 از ایده‌های شما: «${ideaRow.idea}»`, progress: 2 });
    }
  }
  if (!topicId && !(topic && topic.trim()) && !ideaRow) {
    // ۲۰۲۶-۱۰-۰۱ — انتخابِ خودکار: بینِ چند موضوعِ تأییدشده، اولین موضوعی که
    // شبیهِ ویدیوهایِ قبلیِ کانال نیست. اگه همه شبیه بودن، بهترین امتیاز
    // همچنان انتخاب می‌شه (تولید نباید متوقف بشه) ولی هشدار می‌دیم.
    const approved = await listTrendTopics({ status: "approved", limit: 8 });
    if (approved.length > 0) {
      const titles = await existingVideoTitles();
      const fresh = approved.find((t) => findSimilarTitles(t.topic, titles).length === 0);
      trendTopicRow = fresh || approved[0];
      topicText = trendTopicRow.topic;
      if (!fresh && titles.length > 0) {
        emit({ status: "⚠️ همه‌ی موضوع‌هایِ تأییدشده شبیهِ ویدیوهایِ قبلی‌ان — بهترین امتیاز انتخاب شد", progress: 2 });
      } else if (fresh && fresh !== approved[0]) {
        emit({ status: "موضوعِ بالاتر شبیهِ یک ویدیوی قبلی بود — موضوعِ بعدی انتخاب شد", progress: 2 });
      }
    }
  }
  // موضوعِ دستی/انتخاب‌شده توسطِ کاربر هرگز بلاک نمی‌شه، فقط هشدار.
  if (topicText && (topicId || (topic && topic.trim()))) {
    const similar = findSimilarTitles(topicText, await existingVideoTitles());
    if (similar.length > 0) {
      emit({ status: `⚠️ این موضوع شبیهِ ویدیوی قبلیه: «${similar[0].title}»`, progress: 2 });
    }
  }
  emit({
    status: topicText
      ? `موضوع: «${ideaRow ? ideaRow.idea : topicText}»${trendTopicRow ? " (از Trend Finder)" : ""}${ideaRow ? " (از ایده‌های شما)" : ""} ✅`
      : "موضوع مشخصی تعیین نشده — خودِ هوش‌مصنوعی یک موضوع تازه انتخاب می‌کنه",
    progress: 3,
  });

  // اگه نوشتنِ سناریو/متادیتا شکست بخوره، ایده‌ی ادعاشده به صف برمی‌گرده.
  let script, meta;
  try {
    emit({ status: "در حال نوشتن سناریو...", progress: 5 });
    ({ script } = await generateScript({ topic: topicText, mode, accessToken }));
    emit({ status: "سناریو نوشته شد ✅", progress: 12 });

    emit({ status: "در حال نوشتن عنوان و تگ‌ها...", progress: 14 });
    meta = await generateMetadata(script);
    // این مسیر برخلافِ فرمِ دستی، هیچ انسانی قبل از رندر+آپلود عنوان رو
    // نمی‌بینه — پس این‌جا زودتر (قبل از صرفِ چند دقیقه رندر) fail
    // می‌کنیم به‌جای این‌که یوتیوب موقعِ آپلود با یک خطای گنگ ردش کنه.
    // generateMetadata() خودش هم دیگه (۲۰۲۶-۰۸-۲۸) این حالت رو به
    // heuristicMetadata برمی‌گردونه، این فقط یک لایه‌ی محافظِ اضافه‌ست.
    const resolvedTitle = meta.titleA || meta.title || "";
    if (!resolvedTitle.trim()) {
      throw new Error("هوش‌مصنوعی نتونست عنوانی برای این ویدیو تولید کنه — دوباره امتحان کن.");
    }
    emit({ status: "متادیتا آماده شد ✅", progress: 18 });

  } catch (prepErr) {
    if (ideaRow) await releaseIdea(ideaRow.id).catch((e) => console.error("releaseIdea failed:", e.message));
    throw prepErr;
  }

  return { script, meta, trendTopicRow, ideaRow };
}

/**
 * @param {object} opts
 * @param {"long"|"short"} opts.mode
 * @param {number|string} [opts.topicId] - a specific trend_topics.id to
 *   produce. If omitted, the best-scoring 'approved' trend topic not yet
 *   produced is used automatically; if there are none, topic selection is
 *   left to generateScript() itself — exactly what already happens today
 *   when a person clicks "بساز" with the topic field empty.
 * @param {string} opts.accessToken
 * @param {() => Promise<string>} opts.getUploadAccessToken
 * @param {string} [opts.privacyStatus]
 * @param {string} [opts.publishAt]
 * @param {boolean} [opts.useVideoClips]
 * @param {(event: object) => void} [emit] - forwarded straight through to
 *   runPipeline's own emit, plus a few extra events for the script/
 *   metadata/topic-selection steps runPipeline doesn't cover.
 *
 * In-process only (voice+media+render+captions+upload all happen in THIS
 * request). For USE_RENDER_WORKER=true deployments, the API route uses
 * prepareAutoProduceScript() + dispatchAndTrackJob() directly instead of
 * this function — see app/api/auto-produce/route.js.
 */
export async function autoProduceVideo(
  { mode, topicId, topic, accessToken, getUploadAccessToken, privacyStatus, publishAt, useVideoClips },
  { emit = () => {} } = {}
) {
  const { script, meta, trendTopicRow, ideaRow } = await prepareAutoProduceScript(
    { mode, topicId, topic, accessToken },
    { emit }
  );

  let result;
  try {
  result = await runPipeline(
    {
      script,
      title: meta.titleA || meta.title,
      description: meta.description,
      thumbnailText: meta.thumbnailTextA || meta.thumbnailText,
      tags: (meta.tags || []).join(", "),
      titleB: meta.titleB,
      thumbnailTextB: meta.thumbnailTextB,
      privacyStatus: privacyStatus || "private",
      publishAt,
      videoMode: mode,
      useVideoClips: !!useVideoClips,
      imageKeyword: "",
      accessToken,
      getUploadAccessToken,
    },
    // runPipeline's own progress already runs roughly 2-100; rescale it
    // into the 18-100 range so the topic/script/metadata steps above
    // stay visible instead of the bar jumping backwards to ~2%.
    {
      emit: (e) =>
        emit({
          ...e,
          progress: typeof e.progress === "number" ? 18 + (e.progress / 100) * 82 : undefined,
        }),
    }
  );

  } catch (pipeErr) {
    if (ideaRow) await releaseIdea(ideaRow.id).catch((e) => console.error("releaseIdea failed:", e.message));
    throw pipeErr;
  }

  if (ideaRow) {
    await markIdeaUsed(ideaRow.id, result?.videoId).catch((err) => {
      console.error("markIdeaUsed failed (video already uploaded fine):", err.message);
    });
  }

  if (trendTopicRow && result?.videoId) {
    await markTrendTopicProduced(trendTopicRow.id, result.videoId).catch((err) => {
      console.error("markTrendTopicProduced failed (video already uploaded fine):", err.message);
    });
  }

  return {
    ...result,
    script,
    title: meta.titleA || meta.title,
    thumbnailText: meta.thumbnailTextA || meta.thumbnailText,
    description: meta.description,
    tags: (meta.tags || []).join(", "),
    topic: trendTopicRow?.topic || topic || "",
    trendTopicId: trendTopicRow?.id || null,
    ideaId: ideaRow?.id || null,
  };
}
