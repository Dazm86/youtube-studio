import { google } from "googleapis";

// از خودِ یوتیوب به‌عنوان «حافظه» استفاده می‌کنیم — عنوان چند ویدیوی اخیر
// کانال رو می‌گیریم تا سناریوی جدید تکراری نشه. اگه هر جای این مسیر خطا
// بده (مثلاً کانال هنوز ویدیویی نداره)، فقط یک آرایه‌ی خالی برمی‌گردونه؛
// این هیچ‌وقت نباید کل فرایند سناریونویسی رو متوقف کنه.
export async function getRecentVideoTitles(accessToken, maxResults = 15) {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    const channelRes = await youtube.channels.list({
      mine: true,
      part: ["contentDetails"],
    });
    const uploadsPlaylistId =
      channelRes.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return [];

    const itemsRes = await youtube.playlistItems.list({
      playlistId: uploadsPlaylistId,
      part: ["snippet"],
      maxResults,
    });

    return (itemsRes.data?.items || [])
      .map((item) => item.snippet?.title)
      .filter(Boolean);
  } catch (err) {
    console.error("getRecentVideoTitles failed:", err.message);
    return [];
  }
}
