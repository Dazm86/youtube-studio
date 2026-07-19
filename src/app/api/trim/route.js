import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "وارد نشده‌اید" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("video");
  const startTime = formData.get("startTime") || "0";
  const duration = formData.get("duration");

  if (!file || !duration) {
    return NextResponse.json({ error: "فایل ویدیو یا مدت زمان ارسال نشده" }, { status: 400 });
  }

  const id = randomUUID();
  const inputPath = join(tmpdir(), `input-${id}.mp4`);
  const outputPath = join(tmpdir(), `output-${id}.mp4`);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, buffer);

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(startTime)
        .setDuration(duration)
        .outputOptions(["-c", "copy"])
        .output(outputPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    const trimmedBuffer = await readFile(outputPath);

    await unlink(inputPath);
    await unlink(outputPath);

    return new NextResponse(trimmedBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": "attachment; filename=trimmed.mp4",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
