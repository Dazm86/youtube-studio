import "./globals.css";
import { Vazirmatn, JetBrains_Mono } from "next/font/google";
import Providers from "./providers";
import NavBar from "../components/layout/NavBar";

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

// دارک تم رو به مرورگر هم اعلام می‌کنیم، نه فقط با CSS خودمون — این باعث
// می‌شه کنترل‌های بومی مرورگر (select، تقویم date/time، اسکرول‌بار) هم به‌جای
// پیش‌فرض روشن، خودشون رو با تم تیره‌ی سایت هماهنگ کنن.
export const viewport = {
  themeColor: "#14120F",
  colorScheme: "dark",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl" className={`${vazirmatn.variable} ${monoReadout.variable}`}>
      <body>
        <Providers>
          <NavBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
