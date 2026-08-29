import sharp from "sharp";
import fs from "fs";
import path from "path";

const CANVAS_W = 1280;
const CANVAS_H = 720;

export function escapeDrawtextForShort(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

const POSE_KEYWORDS = {
  excited: ["amazing", "exciting", "celebrate", "celebration", "joy", "wonderful", "fantastic", "awesome"],
  thinking: ["wonder", "think", "why", "question", "curious", "ponder", "consider"],
  meditating: ["peace", "calm", "meditation", "meditate", "breathe", "breath", "relax", "stillness", "quiet"],
  caring: ["love", "grateful", "gratitude", "thank", "heart", "care", "kindness", "compassion"],
  // ۲۰۲۶-۰۸-۲۹ — طبق بازخوردِ Gemini («چهره‌ی مایا باید ری‌اکشن/احساس
  // داشته باشه: تعجب، استرس یا آرامش»): استرس/اضطراب یکی از پرتکرارترین
  // موضوعاتِ این کاناله، ولی قبلاً هیچ کلیدواژه‌ای براش نبود — یعنی این
  // ویدیوها همیشه به پوزِ پیش‌فرضِ عمومی (greeting/confident) می‌فتادن،
  // نه یک حالتِ متناسب با موضوع. تا وقتی یک عکسِ ژستِ مخصوصِ «استرس/
  // نگرانی» واقعاً اضافه بشه، نزدیک‌ترین ژستِ بصریِ موجود بهش surprised
  // (شوکه/بهت‌زده) هست — امن‌تر از ساختنِ یک pose تازه که فایلِ عکسش
  // وجود نداره.
  surprised: [
    "surprising", "shocking", "unbelievable", "wow", "amazed", "astonishing", "incredible",
    "stress", "stressed", "anxiety", "anxious", "overwhelm", "overwhelmed", "overwhelming",
    "panic", "worried", "worry", "burnout", "burnt out",
  ],
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

// سقفِ سخت‌گیرانه‌ی «حداکثر N کلمه» رو خودِ کد هم اعمال می‌کنه، نه فقط
// پرامپتِ AI (metadataGen.js) — چون هیچ تضمینی نیست خروجیِ AI همیشه دقیقاً
// به همون قانون پایبند بمونه؛ این یک لایه‌ی دفاعیِ اضافه‌ست، نه جایگزینِ
// پرامپت.
export function capThumbnailWords(text, maxWords) {
  const words = String(text || "New Video").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
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
  const displayText = capThumbnailWords(thumbnailText || title, 4);
  const grade = VARIANT_GRADES[variant] || VARIANT_GRADES.A;
  const ranked = posePool || pickMayaPoseRanked(script || title || "");
  const pose = variant === "B" ? ranked[1] || ranked[0] : ranked[0];
  const posePath = path.join(process.cwd(), "public", "maya", `${pose}.png`);
  const mayaBuffer = fs.readFileSync(posePath);

  // --- Background: blurred/darkened source image, or brand gradient fallback ---
  let bg = null;
  if (bgImageUrl) {
    try {
      // فیکسِ ۲۰۲۶-۰۸-۲۲ — bgImageUrl سه شکل ممکنه داشته باشه: رشته‌ی
      // خامِ URL، آبجکتِ {buffer, ext} (وقتی provider تولیدکننده‌ی عکسه،
      // مثلِ OpenAI/Stability)، یا آبجکتِ {path: url} (وقتی از استوک‌سرچ
      // میاد، مثلِ Pexels — provider پیش‌فرض/رایگان). قبلاً فقط دو حالتِ
      // اول رو می‌فهمید؛ برای {path: url} می‌رفت رو fetch(bgImageUrl) که
      // چون ورودیش آبجکته نه رشته throw می‌کرد و بی‌صدا می‌فتاد رو
      // گرادیانِ پیش‌فرض — یعنی برای رایج‌ترین provider، تامبنیل هیچ‌وقت
      // از عکسِ واقعیِ ویدیو استفاده نمی‌کرد.
      let arrBuf;
      if (typeof bgImageUrl === "object" && bgImageUrl.buffer) {
        arrBuf = bgImageUrl.buffer;
      } else {
        const url = typeof bgImageUrl === "object" ? bgImageUrl.path : bgImageUrl;
        const res = await fetch(url);
        arrBuf = await res.arrayBuffer();
      }
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

  // --- سایه‌ی نرمِ پشتِ مایا — یک سیلوئتِ مشکیِ کم‌شفاف و بلورشده از همون
  // ماسکِ آلفای عکسِ مایا (نه یک بیضی/جعبه‌ی حدسی)، یک‌کم افست‌شده — تا
  // مایا از پس‌زمینه (چه گرادیانِ برند، چه عکسِ بلورشده) بیشتر جدا دیده
  // بشه، حسِ عمق بگیره.
  let mayaShadow = null;
  try {
    const mayaMask = await sharp(mayaResized).extractChannel(3).toBuffer();
    const shadowAlpha = await sharp(mayaMask).linear(0.5, 0).blur(16).toBuffer();
    const blackRgb = await sharp({
      create: {
        width: mayaMeta.width,
        height: mayaMeta.height,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
    mayaShadow = await sharp(blackRgb).joinChannel(shadowAlpha).png().toBuffer();
  } catch (shadowErr) {
    // شکستِ ساختِ سایه (فرمتِ غیرمنتظره‌ی فایلِ pose) نباید کلِ تامنیل رو
    // بشکنه — فقط بدونِ سایه ادامه می‌دیم.
    console.error("ساختِ سایه‌ی مایا شکست خورد:", shadowErr.message);
    mayaShadow = null;
  }
  const SHADOW_DX = 14;
  const SHADOW_DY = 18;

  // --- Thumbnail text (SVG, bold with outline for contrast) ---
  // متن حداکثر ۴ کلمه‌ست (capThumbnailWords بالاتر تضمینش می‌کنه)، پس
  // فونت کوچیک‌تر و فقط ۲ خط کافیه؛ به‌جای چسبیدن به لبه‌ی چپ (x=56)، هر
  // خط داخل فضای موجود قبل از مایا (از ۰ تا mayaX) به‌صورت افقی وسط‌چین
  // می‌شه — موضع مرکزیِ واضح‌تر.
  const lines = wrapText(displayText, 22, 2);
  const fontSize = 62;
  const lineHeight = 74;
  const textBlockHeight = lines.length * lineHeight;
  const startY = (CANVAS_H - textBlockHeight) / 2 + fontSize;
  const textCenterX = mayaX / 2;

  // رنگِ متن رو بر اساسِ روشناییِ *واقعیِ* همون ناحیه‌ای از پس‌زمینه که
  // متن واقعاً روش می‌شینه انتخاب می‌کنیم، نه همیشه فرضِ سفید — یک عکسِ
  // روشن (مثلاً آسمون/برف) حتی بعدِ تیره‌شدنِ عمدیِ بالاتر (brightness
  // 0.55) ممکنه هنوز به‌قدرِ کافی روشن بمونه که متنِ سفید توش کم‌کنتراست
  // بشه؛ گرادیانِ برند هم اگه یه روز روشن‌تر شد همین‌جوری خودکار جواب
  // می‌ده. resize به ۱×۱ پیکسل رنگِ میانگینِ همون ناحیه رو ارزون می‌گیره.
  let fontColor = "#ffffff";
  let strokeColor = "#3a1d4d";
  try {
    const [r, g, b] = await sharp(bg)
      .extract({ left: 0, top: 0, width: Math.max(1, mayaX), height: CANVAS_H })
      .resize(1, 1)
      .raw()
      .toBuffer();
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // نکته‌ی مهمِ کالیبراسیون: عکس‌های واقعی قبل از این مرحله با
    // modulate({brightness:0.55}) عمداً تیره شدن (بالاتر تو همین فایل) —
    // یعنی حتی یک عکسِ کاملاً سفید هم به این مرحله که می‌رسه سقفش حدودِ
    // luminance≈۰.۵۱ ـه، نه ۱. آستانه‌ی ۰.۶ عملاً هیچ‌وقت رد نمی‌شد و این
    // چک برای مسیرِ عکسِ واقعی همیشه بی‌اثر می‌موند؛ با تست مستقیمِ همین
    // pipeline (چند سطحِ روشناییِ منبع) به ۰.۴۲ رسیدم — عکس‌های واقعاً
    // روشن (نزدیکِ سفید/برف/آسمون) رو به متنِ تیره سوییچ می‌کنه، عکس‌های
    // معمولی/تیره همچنان متنِ سفیدِ پیش‌فرض رو نگه می‌دارن.
    if (luminance > 0.42) {
      fontColor = "#1a1a1a";
      strokeColor = "#ffffff";
    }
  } catch (contrastErr) {
    console.error(
      "تشخیصِ کنتراستِ پس‌زمینه‌ی تامنیل شکست خورد، پیش‌فرضِ سفید استفاده می‌شه:",
      contrastErr.message
    );
  }

  const textSvgLines = lines
    .map(
      (line, i) =>
        `<text x="${textCenterX}" y="${startY + i * lineHeight}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="${fontSize}" fill="${fontColor}" stroke="${strokeColor}" stroke-width="6" paint-order="stroke" stroke-linejoin="round">${escapeXml(line)}</text>`
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
      ...(mayaShadow
        ? [{ input: mayaShadow, left: mayaX + SHADOW_DX, top: mayaY + SHADOW_DY }]
        : []),
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
