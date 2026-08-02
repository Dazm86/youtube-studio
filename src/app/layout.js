import "./globals.css";
import { Vazirmatn, JetBrains_Mono } from "next/font/google";
import Providers from "./providers";

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  variable: "--font-vazirmatn",
  display: "swap",
});

const monoReadout = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-readout",
  display: "swap",
});

export const metadata = {
  title: "The Mindful Path — استودیو",
  description: "استودیوی ساخت و انتشار خودکار ویدیو",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl" className={`${vazirmatn.variable} ${monoReadout.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
