import { Suspense } from "react";
import VideoStudio from "../../components/studio/VideoStudio";

export const metadata = {
  title: "ویدیوی لانگ | استودیوی یوتیوب",
};

export default function LongVideoPage() {
  // فیکسِ ۲۰۲۶-۰۸-۲۷ — VideoStudio حالا از useSearchParams() برای
  // پرکردنِ خودکارِ موضوع (از لینکِ Trend Finder: /long?topic=...)
  // استفاده می‌کنه؛ طبقِ نیازِ App Router، هر جزیی که از این هوک
  // استفاده می‌کنه باید زیرِ یک Suspense boundary باشه.
  return (
    <Suspense fallback={null}>
      <VideoStudio mode="long" />
    </Suspense>
  );
}
