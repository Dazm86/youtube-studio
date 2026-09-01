// پلی‌لیست‌بندیِ خوشه‌ای: هر ویدیوی تازه با کلمه‌های معنی‌دارِ اسکریپتش با
// یک لیستِ خوشه‌هایِ ثابتِ موضوعی (که با seed keywords ای که Trend Finder
// هم استفاده می‌کنه هم‌خونه) مقایسه می‌شه؛ اگه تطبیقِ به‌اندازه‌ی کافی
// قوی پیدا شد، ویدیو به همون پلی‌لیستِ یوتیوب اضافه می‌شه (اگه پلی‌لیست
// هنوز وجود نداشته باشه، همون لحظه ساخته می‌شه و تویِ دیتابیس ثبت
// می‌شه تا دفعه‌هایِ بعد دوباره ساخته نشه).

import { getPlaylistForCluster, savePlaylistForCluster } from "../db/index.js";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "to", "of", "in", "on", "at", "for", "with", "by", "from",
  "as", "that", "this", "these", "those", "it", "its", "i", "you", "he",
  "she", "we", "they", "them", "his", "her", "our", "your", "their", "not",
  "no", "so", "if", "then", "than", "too", "very", "can", "will", "just",
  "about", "into", "over", "after", "before", "up", "down", "out", "off",
  "again", "there", "here", "what", "when", "where", "why", "how", "all",
  "any", "both", "each", "few", "more", "most", "other", "some", "such",
  "only", "own", "same", "also",
]);

// خوشه‌های ثابتِ کانال — با seed keywords ی که Trend Finder استفاده
// می‌کنه هم‌خونه (lib/trends/seeds.js) ولی این‌جا به‌صورتِ گروه‌بندی‌شده،
// چون یک پلی‌لیست باید چند کلیدواژه‌ی نزدیک به هم رو پوشش بده، نه
// دقیقاً یک seed تنها.
export const PLAYLIST_CLUSTERS = [
  {
    key: "anxiety",
    title: "Managing Anxiety & Overthinking",
    keywords: ["anxiety", "anxious", "overthinking", "overthink", "worry", "worried", "panic", "stress", "stressed"],
  },
  {
    key: "burnout",
    title: "Burnout & Recovery",
    keywords: ["burnout", "exhausted", "exhaustion", "rest", "recovery", "overwhelmed", "overwhelm"],
  },
  {
    key: "mindfulness",
    title: "Mindfulness & Meditation",
    keywords: ["meditation", "meditate", "mindfulness", "mindful", "breathe", "breathing", "presence", "calm", "peace"],
  },
  {
    key: "discipline",
    title: "Discipline & Productivity",
    keywords: ["discipline", "productivity", "productive", "habits", "habit", "focus", "routine", "procrastination"],
  },
  {
    key: "confidence",
    title: "Self-Love & Confidence",
    keywords: ["confidence", "confident", "selflove", "love", "esteem", "imposter", "worth", "worthy"],
  },
  {
    key: "stoicism",
    title: "Stoicism & Inner Peace",
    keywords: ["stoicism", "stoic", "acceptance", "control", "wisdom", "philosophy"],
  },
  {
    key: "relationships",
    title: "Relationships & Boundaries",
    keywords: ["boundaries", "boundary", "relationships", "relationship", "loneliness", "lonely", "connection"],
  },
];

function extractWordSet(text) {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

/**
 * بهترین خوشه‌ی مرتبط رو با یک اسکریپت پیدا می‌کنه. حداقل ۲ کلمه‌ی
 * مشترک لازمه، وگرنه null (یعنی این ویدیو به هیچ خوشه‌ای تعلق نداره —
 * قابلِ قبوله، هر ویدیویی لازم نیست تو یک پلی‌لیست بیفته).
 */
export function matchCluster(script) {
  const scriptWords = extractWordSet(script);
  if (scriptWords.size === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const cluster of PLAYLIST_CLUSTERS) {
    let overlap = 0;
    for (const kw of cluster.keywords) {
      if (scriptWords.has(kw)) overlap++;
    }
    if (overlap > bestScore) {
      bestScore = overlap;
      best = cluster;
    }
  }
  return bestScore >= 2 ? best : null;
}

/**
 * پلی‌لیستِ واقعیِ یوتیوب برایِ این خوشه رو برمی‌گردونه — اگه از قبل
 * (تویِ دیتابیس) ساخته شده، همون رو؛ وگرنه یکیِ تازه با youtube.playlists.insert
 * می‌سازه و ثبتش می‌کنه.
 * @param {import('googleapis').youtube_v3.Youtube} youtube - کلاینتِ
 *   یوتیوبِ از‌قبل‌احرازشده (همونی که pipeline.js برایِ آپلود می‌سازه —
 *   نه یک accessTokenِ خام، تا از ساختنِ دوباره‌ی OAuth client جلوگیری بشه)
 */
export async function ensurePlaylistForCluster(youtube, cluster) {
  const existing = await getPlaylistForCluster(cluster.key);
  if (existing) return existing.youtube_playlist_id;

  const res = await youtube.playlists.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: cluster.title,
        description: `Videos from The Mindful Path about ${cluster.title.toLowerCase()}.`,
      },
      status: { privacyStatus: "public" },
    },
  });
  const playlistId = res.data.id;
  await savePlaylistForCluster(cluster.key, playlistId, cluster.title);
  // شرایطِ مسابقه‌ی نادر: اگه دو ویدیو هم‌زمان اولین ویدیویِ یک خوشه‌ی
  // تازه باشن، ممکنه هر دو یک پلی‌لیستِ واقعی بسازن ولی فقط یکیشون تو
  // دیتابیس بمونه (ON CONFLICT DO NOTHING تو savePlaylistForCluster) —
  // این‌جا دوباره از دیتابیس می‌خونیم تا مطمئن بشیم همیشه همون IDای که
  // *واقعاً* ثبت شده استفاده می‌شه، نه لزوماً همینی که همین الان ساختیم.
  const authoritative = await getPlaylistForCluster(cluster.key);
  return authoritative.youtube_playlist_id;
}

export async function addVideoToPlaylist(youtube, playlistId, videoId) {
  await youtube.playlistItems.insert({
    part: ["snippet"],
    requestBody: {
      snippet: {
        playlistId,
        resourceId: { kind: "youtube#video", videoId },
      },
    },
  });
}

/**
 * چکِ کامل: اسکریپت رو با خوشه‌ها مقایسه می‌کنه، اگه تطبیقی پیدا شد
 * پلی‌لیستش رو تضمین می‌کنه و ویدیو رو بهش اضافه می‌کنه. هیچ‌وقت throw
 * نمی‌کنه — این یک بونوسِ جانبیه، شکستش نباید آپلودِ اصلی رو خراب کنه.
 */
export async function assignVideoToCluster(youtube, script, videoId) {
  const cluster = matchCluster(script);
  if (!cluster) return { assigned: false, reason: "no matching cluster" };

  try {
    const playlistId = await ensurePlaylistForCluster(youtube, cluster);
    await addVideoToPlaylist(youtube, playlistId, videoId);
    return { assigned: true, cluster: cluster.key, clusterTitle: cluster.title, playlistId };
  } catch (err) {
    return { assigned: false, reason: err.message };
  }
}
