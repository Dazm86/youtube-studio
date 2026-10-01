// ۲۰۲۶-۱۰-۰۱ — تشخیصِ سلام/معرفیِ ابتدایی. تو Shorts هر ثانیه‌ی اول با
// «Hey, I\'m Maya» تلف می‌شه و بیننده همون‌جا رد می‌شه؛ هوک باید مستقیم
// وارد موضوع بشه. فقط ابتدای متن چک می‌شه (نه وسطِ جمله‌ها).
const GREETING_RE =
  /^\s*["'“]?\s*(?:hi|hey|hello|hiya|howdy|welcome|good\s+(?:morning|evening|afternoon)|greetings|what'?s\s+up|(?:hi|hey|hello)\s+(?:there|everyone|friends|guys)|i['’]?m\s+maya|my\s+name\s+is\s+maya|this\s+is\s+maya|today\s+(?:we['’]?re|i['’]?m|we\s+are)|in\s+this\s+(?:video|short)|let['’]?s\s+(?:talk|dive|get\s+started))\b/i;

export function startsWithGreeting(script) {
  return GREETING_RE.test(script || "");
}
