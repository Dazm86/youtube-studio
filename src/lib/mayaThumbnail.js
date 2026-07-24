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
  const t = (text || "").toLowerCase();
  let best = "greeting";
  let bestScore = 0;
  for (const [pose, words] of Object.entries(POSE_KEYWORDS)) {
    let score = 0;
    for (const w of words) {
      if (t.includes(w)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = pose;
    }
  }
  return best;
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

export async function buildMayaThumbnail({ title, script, bgImageUrl }) {
  const pose = pickMayaPose(script || title || "");
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
        .modulate({ brightness: 0.55 })
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
            <stop offset="0%" stop-color="#7a3e9d"/>
            <stop offset="100%" stop-color="#e8672c"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
      </svg>`;
    bg = await sharp(Buffer.from(svgGradient)).png().toBuffer();
  }

  // --- Maya cutout, resized ---
  const mayaResized = await sharp(mayaBuffer).resize({ height: 760 }).toBuffer();
  const mayaMeta = await sharp(mayaResized).metadata();
  const mayaX = CANVAS_W - mayaMeta.width - 10;
  const mayaY = CANVAS_H - mayaMeta.height;

  // --- Title text (SVG, bold with outline for contrast) ---
  const lines = wrapText(title, 16, 3);
  const fontSize = 74;
  const lineHeight = 86;
  const textBlockHeight = lines.length * lineHeight;
  const startY = (CANVAS_H - textBlockHeight) / 2 + fontSize;

  const textSvgLines = lines
    .map(
      (line, i) =>
        `<text x="56" y="${startY + i * lineHeight}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#ffffff" stroke="#3a1d4d" stroke-width="7" paint-order="stroke" stroke-linejoin="round">${escapeXml(line)}</text>`
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
