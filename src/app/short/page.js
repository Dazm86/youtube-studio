import { Suspense } from "react";
import VideoStudio from "../../components/studio/VideoStudio";

export const metadata = {
  title: "ویدیوی شورت | استودیوی یوتیوب",
};

export default function ShortVideoPage() {
  // همون فیکسِ /long/page.js — نگاهش کن.
  return (
    <Suspense fallback={null}>
      <VideoStudio mode="short" />
    </Suspense>
  );
}
