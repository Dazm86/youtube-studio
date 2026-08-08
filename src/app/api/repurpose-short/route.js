import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { google } from "googleapis";
import { Readable } from "stream";
import {
  renderVerticalShortFromSource,
  probeDurationSec,
} from "../../../lib/videoRender";
import { getRetentionCurve, findBestRetentionWindow } from "../../../lib/repurpose";
import { recordRepurposedShort } from "../../../lib/db";
import fsp from "fs/promises";
import os from "os";
import path from "path";

// نکته‌ی مهم درباره‌ی طراحیِ این روت: YouTube Data API v3 هیچ راهی برای
// دانلود دوباره‌ی فایل خودِ ویدیوی از قبل آپلودشده نمی‌ده (نه
// videos.download و نه معادلش) — فقط متادیتا و آمار قابل خوندنه، نه
// بایت‌های خودِ ویدیو. برای همین این endpoint فایل منبع رو مستقیم از
// کاربر (همون فایلی که موقع رندر اولیه رو دستگاهش/سرور موقتاً بود) به
// شکل multipart می‌گیره، نه این‌که با videoId بره سراغ خودِ یوتیوب برای
// گرفتن فایل. videoId فقط برای خوندن منحنیِ نگه‌داشت (Analytics) لازمه.
export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("video");
  const sourceVideoId = formData.get("videoId"); // آیدیِ یوتیوبِ ویدیوی بلندِ منبع
  const targetDurationSec = Math.min(
    90,
    Math.max(15, parseInt(formData.get("targetDurationSec")) || 45)
  );
  const title = formData.get("title") || "";
  const autoUpload = formData.get("autoUpload") === "true";
  let captionLinesRaw = formData.get("captions"); // JSON اختیاری: [{text,startSec,endSec}]

  if (!file) {
    return NextResponse.json({ error: "فایل ویدیوی منبع ارسال نشده" }, { status: 400 });
  }
  if (!sourceVideoId) {
    return NextResponse.json(
      { error: "videoId ویدیوی بلندِ منبع ارسال نشده (برای خوندن نگه‌داشت مخاطب لازمه)" },
      { status: 400 }
    );
  }

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "repurpose-"));
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const sourcePath = path.join(tmpDir, "source_input.mp4");
    await fsp.writeFile(sourcePath, buffer);

    const totalDurationSec = await probeDurationSec(sourcePath);
    if (totalDurationSec <= targetDurationSec) {
      return NextResponse.json(
        { error: "ویدیوی منبع کوتاه‌تر از بازه‌ی درخواستیِ شورته" },
        { status: 400 }
      );
    }

    // منحنیِ نگه‌داشت رو از YouTube Analytics می‌گیریم؛ اگه ویدیو خیلی
    // تازه باشه یا هنوز داده‌ی کافی نداشته باشه، بدون شکست خوردنِ کل
    // درخواست، به یک بازه‌ی heuristic معقول برمی‌گردیم (خودِ
    // findBestRetentionWindow این حالت رو مدیریت می‌کنه).
    let curve = [];
    try {
      curve = await getRetentionCurve(session.accessToken, sourceVideoId);
    } catch (err) {
      console.error("retention curve fetch failed, using heuristic window:", err.message);
    }

    const { startSec, endSec, source: retentionSource } = findBestRetentionWindow(
      curve,
      totalDurationSec,
      targetDurationSec
    );

    let captionLines = [];
    if (captionLinesRaw) {
      try {
        const parsed = JSON.parse(captionLinesRaw);
        // فقط خط‌هایی که با بازه‌ی انتخاب‌شده هم‌پوشانی دارن رو نگه
        // می‌داریم و زمان‌شون رو نسبت به شروعِ خودِ شورت جابه‌جا می‌کنیم.
        captionLines = (Array.isArray(parsed) ? parsed : [])
          .filter((c) => c.endSec > startSec && c.startSec < endSec)
          .map((c) => ({
            text: c.text,
            startSec: Math.max(0, c.startSec - startSec),
            endSec: Math.min(endSec - startSec, c.endSec - startSec),
          }));
      } catch {
        captionLines = [];
      }
    }

    const shortBuffer = await renderVerticalShortFromSource({
      sourceBuffer: buffer,
      startSec,
      durationSec: endSec - startSec,
      captionLines,
    });

    if (!autoUpload) {
      // آپلود خودکار نخواسته → خودِ فایلِ mp4 آماده برمی‌گرده که کاربر
      // دانلود کنه یا هر پلتفرمی (اینستاگرام Reels/تیک‌تاک/شورتز) بخواد
      // دستی آپلودش کنه — هدفِ "بازتوزیع چندپلتفرمی" با یک فایلِ خروجیِ
      // پلتفرم-agnostic برآورده می‌شه.
      await recordRepurposedShort({
        sourceVideoId,
        shortVideoId: null,
        startSec,
        endSec,
        retentionSource,
      });
      return new Response(shortBuffer, {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Disposition": 'attachment; filename="short.mp4"',
          "X-Retention-Source": retentionSource,
          "X-Window-Start-Sec": String(Math.round(startSec)),
          "X-Window-End-Sec": String(Math.round(endSec)),
        },
      });
    }

    // آپلود خودکار به یوتیوب به‌عنوان Short
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: session.accessToken });
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    const uploadRes = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: (title || "Mindful Moment") + " #Shorts",
          description: "#shorts #themindfulpath",
        },
        status: { privacyStatus: "private" },
      },
      media: { body: Readable.from(shortBuffer) },
    });
    const shortVideoId = uploadRes.data.id;

    await recordRepurposedShort({
      sourceVideoId,
      shortVideoId,
      startSec,
      endSec,
      retentionSource,
    });

    return NextResponse.json({
      shortVideoId,
      startSec: Math.round(startSec),
      endSec: Math.round(endSec),
      retentionSource,
    });
  } catch (err) {
    console.error("repurpose-short error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
