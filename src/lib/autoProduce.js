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

/**
 * Steps 1-3 only (topic selection, script, metadata) — split out so the
 * API route can reuse it for BOTH paths: in-process (this file's own
 * autoProduceVideo below) and worker-dispatch (mirrors how
 * generate-and-upload/route.js already generates the script up front,
 * then only hands the render+upload part to the worker).
 */
export async function prepareAutoProduceScript({ mode, topicId, topic, accessToken }, { emit = () => {} } = {}) {
  emit({ status: "در حال انتخاب موضوع...", progress: 1 });
  let trendTopicRow = null;
  let topicText = "";
  if (topicId) {
    trendTopicRow = await getTrendTopicById(topicId);
    if (!trendTopicRow) throw new Error(`موضوع ترند با id=${topicId} پیدا نشد`);
    topicText = trendTopicRow.topic;
  } else if (topic && topic.trim()) {
    // موضوعی که کاربر خودش تو فیلدِ استودیو تایپ کرده (یا از لینکِ
    // «باز کردن دستی» یک موضوعِ تأییدشده پر شده) — اولویتش از
    // auto-pick بیشتره، ولی هیچ ردیفِ trend_topics ای بهش وصل نیست
    // (پس در پایان چیزی به‌عنوانِ «produced» علامت زده نمی‌شه).
    topicText = topic.trim();
  } else {
    const approved = await listTrendTopics({ status: "approved", limit: 1 });
    if (approved.length > 0) {
      trendTopicRow = approved[0];
      topicText = trendTopicRow.topic;
    }
  }
  emit({
    status: topicText
      ? `موضوع: «${topicText}»${trendTopicRow ? " (از Trend Finder)" : ""} ✅`
      : "موضوع مشخصی تعیین نشده — خودِ هوش‌مصنوعی یک موضوع تازه انتخاب می‌کنه",
    progress: 3,
  });

  emit({ status: "در حال نوشتن سناریو...", progress: 5 });
  const { script } = await generateScript({ topic: topicText, mode, accessToken });
  emit({ status: "سناریو نوشته شد ✅", progress: 12 });

  emit({ status: "در حال نوشتن عنوان و تگ‌ها...", progress: 14 });
  const meta = await generateMetadata(script);
  emit({ status: "متادیتا آماده شد ✅", progress: 18 });

  return { script, meta, trendTopicRow };
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
  const { script, meta, trendTopicRow } = await prepareAutoProduceScript(
    { mode, topicId, topic, accessToken },
    { emit }
  );

  const result = await runPipeline(
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
  };
}
