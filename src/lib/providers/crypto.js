// رمزنگاری کلیدهای API قبل از ذخیره تو دیتابیس. به‌جای یک متغیر محیطی
// جدید، از همون NEXTAUTH_SECRET که از قبل تنظیم شده به‌عنوان کلید
// AES-256-GCM استفاده می‌کنیم (هش می‌شه تا دقیقاً ۳۲ بایت بشه) — این‌طوری
// کلیدهای شخص ثالث (OpenAI، ElevenLabs و...) به‌صورت متن ساده تو Postgres
// نمی‌شینن، بدون این‌که یک secret جدید تو Render لازم باشه.

import crypto from "crypto";

const ALGO = "aes-256-gcm";

function getKey() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET تنظیم نشده — برای ذخیره‌ی امن کلیدهای API لازمه (همون متغیری که NextAuth هم استفاده می‌کنه)."
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(payload) {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
