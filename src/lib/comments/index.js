// پیش‌نویسِ پاسخِ خودکار به کامنت‌های برتر — برخلافِ community/index.js
// (که API عمومی‌ای برای پست‌کردن نداره)، یوتیوب واقعاً یک endpoint برای
// پاسخ‌دادن به کامنت داره (comments.insert) — ولی همین‌جا هم عمداً فقط
// *پیش‌نویس* تولید و ذخیره می‌شه، هیچ‌جا خودکار پابلیش نمی‌شه؛ ارسالِ
// واقعی یک تصمیمِ جداست که این ماژول براش تصمیم نمی‌گیره.

import { google } from "googleapis";
import pg from "pg";
import { generateText } from "../providers/router.js";

const { Pool } = pg;

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

let schemaReady = false;
async function ensureCommentsSchema() {
  if (schemaReady) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS comment_replies (
      id SERIAL PRIMARY KEY,
      video_id TEXT NOT NULL,
      comment_id TEXT NOT NULL,
      author_name TEXT,
      comment_text TEXT,
      comment_like_count INTEGER DEFAULT 0,
      reply_draft TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(video_id, comment_id)
    );
  `);
  schemaReady = true;
}

async function fetchTopComments(accessToken, videoId, maxResults = 5) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  const res = await youtube.commentThreads.list({
    part: "snippet",
    videoId,
    order: "relevance", // همون ترتیبی که خودِ یوتیوب زیرِ ویدیو «کامنت‌های برتر» نشون می‌ده
    maxResults,
    textFormat: "plainText",
  });

  return (res.data.items || []).map((item) => {
    const top = item.snippet.topLevelComment.snippet;
    return {
      commentId: item.snippet.topLevelComment.id,
      authorName: top.authorDisplayName,
      text: top.textDisplay,
      likeCount: top.likeCount || 0,
    };
  });
}

async function generateReplyDraft({ videoTitle, commentText, authorName }) {
  const prompt = `You are Maya, the warm and energetic host of the YouTube mindfulness channel "The Mindful Path", replying to a comment on your own video.

Video title: "${videoTitle}"
Comment from ${authorName || "a viewer"}: "${commentText}"

Write ONE short reply (1-3 sentences, under 300 characters) in Maya's voice — warm, personal, first person. React to something SPECIFIC the commenter actually said, don't write a generic "thanks for watching!" reply. If the comment shares a struggle or story, acknowledge it genuinely before responding. If it's a question, answer it briefly and honestly. Never sound like a template.

Reply with ONLY the reply text itself, nothing else — no quotation marks, no "Reply:" prefix.`;

  const raw = await generateText({ prompt, temperature: 0.8, maxTokens: 150 });
  return raw.trim().replace(/^["']|["']$/g, "");
}

/**
 * کامنت‌های برتر رو می‌گیره، برایِ هرکدوم (اگه پیش‌نویسِ قبلی نداشته
 * باشه) یک پاسخِ AI می‌سازه، و همه رو ذخیره می‌کنه. پیش‌نویس‌هایِ
 * ازقبل‌ساخته‌شده (همون video_id+comment_id) دوباره تولید نمی‌شن — تا
 * صدا زدنِ دوباره‌ی این تابع رویِ همون ویدیو، هزینه‌ی AI رو دوباره
 * نسوزونه.
 */
export async function generateCommentReplyDrafts({ accessToken, videoId, videoTitle, maxComments = 5 }) {
  await ensureCommentsSchema();
  const comments = await fetchTopComments(accessToken, videoId, maxComments);

  const { rows: existing } = await getPool().query(
    `SELECT comment_id FROM comment_replies WHERE video_id = $1`,
    [videoId]
  );
  const existingIds = new Set(existing.map((r) => r.comment_id));

  const results = [];
  for (const comment of comments) {
    if (existingIds.has(comment.commentId)) continue;
    try {
      const draft = await generateReplyDraft({
        videoTitle,
        commentText: comment.text,
        authorName: comment.authorName,
      });
      await getPool().query(
        `INSERT INTO comment_replies (video_id, comment_id, author_name, comment_text, comment_like_count, reply_draft)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (video_id, comment_id) DO NOTHING`,
        [videoId, comment.commentId, comment.authorName, comment.text, comment.likeCount, draft]
      );
      results.push({ ...comment, replyDraft: draft });
    } catch (err) {
      // یک کامنت که پاسخش شکست خورد نباید بقیه رو متوقف کنه
      console.error(`generateCommentReplyDrafts: پاسخ برایِ کامنتِ ${comment.commentId} شکست خورد:`, err.message);
    }
  }
  return results;
}

export async function getRepliesForVideo(videoId) {
  await ensureCommentsSchema();
  const { rows } = await getPool().query(
    `SELECT * FROM comment_replies WHERE video_id = $1 ORDER BY comment_like_count DESC`,
    [videoId]
  );
  return rows;
}
