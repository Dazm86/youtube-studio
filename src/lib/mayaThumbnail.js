import sharp from "sharp";
import fs from "fs";
import path from "path";

const CANVAS_W = 1280;
const CANVAS_H = 720;

const POSE_KEYWORDS = {
  excited: ["amazing", "exciting", "celebrate", "celebration", "joy", "wonderful", "fantastic", "awesome"],
  thinking: ["wonder", "think", "why", "question", "curious", "ponder", "consider"],
  meditating: ["peace", "calm", "meditation", "meditate", "breathe", "breath", "relax", "stillness", "quiet"],
  caring: ["love", "grateful", "gratitude", "thank", "heart", "care", "kindness", "compassion"],
  surprised: ["surprising", "shocking", "unbelievable", "wow", "amazed", "astonishing", "incredible"],
  teaching: ["learn", "how to", "guide", "explain", "steps", "lesson", "teach", "tips", "tutorial"],
  confident: ["achieve", "strong", "confident", "success", "believe", "power", "you can", "overcome", "unstoppable"],
};

export function pickMayaPose(text) {
  return pickMayaPoseRanked(text)[0];
}

// همون امتیازدهی pickMayaPose، ولی کل رتبه‌بندی رو برمی‌گردونه — برای
// تست A/B تامبنیل لازمه که نسخه‌ی B یک ژست *متفاوت* (نه لزوماً بی‌ربط)
// از همون متن انتخاب کنه، نه اینکه هر دو نسخه ژست یکسان داشته باشن.
function pickMayaPoseRanked(text) {
  const t = (text || "").toLowerCase();
  const scored = Object.entries(POSE_KEYWORDS).map(([pose, words]) => {
    let score = 0;
    for (const w of words) if (t.includes(w)) score++;
    return { pose, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const ranked = scored.filter((s) => s.score > 0).map((s) => s.pose);
  if (ranked.length === 0) return ["greeting", "confident"];
  if (ranked.length === 1) ranked.push("confident" === ranked[0] ? "excited" : "confident");
  return ranked;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text, maxCharsPerLine, maxLines) {
  const words = String(text || "New Video").split(/\s+/);
  const lines = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (test.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
      if (lines.length === maxLines) break;
    } else {
      current = test;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,3}$/, "…");
  }
  return lines;
}

// دو کانسپت رنگی برای تست A/B. A همون گرید بنفش-نارنجیِ برند فعلیه؛
// B یک گرید سردتر آبی-فیروزه‌ای (پس‌زمینه هم modulate hue می‌گیره)، تا
// دو نسخه از نظر بصری واقعاً قابل تمایز باشن، نه فقط متن‌شون فرق کنه.
const VARIANT_GRADES = {
  A: { gradientFrom: "#7a3e9d", gradientTo: "#e8672c", hue: 0, saturation: 1 },
  B: { gradientFrom: "#0f6e8c", gradientTo: "#0fb59e", hue: 200, saturation: 1.15 },
};

export async function buildMayaThumbnail({
  title,
  thumbnailText,
  script,
  bgImageUrl,
  variant = "A",
  posePool,
}) {
  const displayText = thumbnailText || title;
  const grade = VARIANT_GRADES[variant] || VARIANT_GRADES.A;
  const ranked = posePool || pickMayaPoseRanked(script || title || "");
  const pose = variant === "B" ? ranked[1] || ranked[0] : ranked[0];
  const posePath = path.join(process.cwd(), "public", "maya", `${pose}.png`);
  const mayaBuffer = fs.readFileSync(posePath);

  // --- Background: blurred/darkened source image, or brand gradient fallback ---
  let bg = null;
  if (bgImageUrl) {
    try {
      const res = await fetch(bgImageUrl);
      const arrBuf = await res.arrayBuffer();
      bg = await sharp(Buffer.from(arrBuf))
        .resize(CANVAS_W, CANVAS_H, { fit: "cover" })
        .modulate({ brightness: 0.55, saturation: grade.saturation, hue: grade.hue })
        .blur(6)
        .png()
        .toBuffer();
    } catch (e) {
      bg = null;
    }
  }
  if (!bg) {
    const svgGradient = `
      <svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${grade.gradientFrom}"/>
            <stop offset="100%" stop-color="${grade.gradientTo}"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
      </svg>`;
    bg = await sharp(Buffer.from(svgGradient)).png().toBuffer();
  }

  // --- Maya cutout, resized ---
  const mayaResized = await sharp(mayaBuffer).resize({ height: 680 }).toBuffer();
  const mayaMeta = await sharp(mayaResized).metadata();
  const mayaX = CANVAS_W - mayaMeta.width - 10;
  const mayaY = CANVAS_H - mayaMeta.height;

  // --- Thumbnail text (SVG, bold with outline for contrast) ---
  // متن کوتاه‌تره (۴-۶ کلمه) پس فونت کوچیک‌تر و فقط ۲ خط کافیه؛ به‌جای
  // چسبیدن به لبه‌ی چپ (x=56)، هر خط داخل فضای موجود قبل از مایا
  // (از ۰ تا mayaX) به‌صورت افقی وسط‌چین می‌شه — موضع مرکزیِ واضح‌تر.
  const lines = wrapText(displayText, 22, 2);
  const fontSize = 62;
  const lineHeight = 74;
  const textBlockHeight = lines.length * lineHeight;
  const startY = (CANVAS_H - textBlockHeight) / 2 + fontSize;
  const textCenterX = mayaX / 2;

  const textSvgLines = lines
    .map(
      (line, i) =>
        `<text x="${textCenterX}" y="${startY + i * lineHeight}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#ffffff" stroke="#3a1d4d" stroke-width="6" paint-order="stroke" stroke-linejoin="round">${escapeXml(line)}</text>`
    )
    .join("\n");

  const textBuffer = await sharp(
    Buffer.from(`<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">${textSvgLines}</svg>`)
  )
    .png()
    .toBuffer();

  const finalImage = await sharp(bg)
    .resize(CANVAS_W, CANVAS_H)
    .composite([
      { input: mayaResized, left: mayaX, top: mayaY },
      { input: textBuffer, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();

  return finalImage;
}

// دو نسخه‌ی تامبنیل (A/B) رو با یک بار دانلود/پردازش پس‌زمینه می‌سازه —
// pose ranking یک‌بار حساب می‌شه و بین هر دو نسخه به اشتراک گذاشته
// می‌شه، تا نسخه‌ی B همیشه دومین ژست منطقی رو بگیره (نه یک ژست تصادفی).
export async function buildMayaThumbnailVariants({
  title,
  thumbnailTextA,
  thumbnailTextB,
  script,
  bgImageUrl,
}) {
  const posePool = pickMayaPoseRanked(script || title || "");
  const [a, b] = await Promise.all([
    buildMayaThumbnail({
      title,
      thumbnailText: thumbnailTextA,
      script,
      bgImageUrl,
      variant: "A",
      posePool,
    }),
    buildMayaThumbnail({
      title,
      thumbnailText: thumbnailTextB || thumbnailTextA,
      script,
      bgImageUrl,
      variant: "B",
      posePool,
    }),
  ]);
  return { a, b };
}
