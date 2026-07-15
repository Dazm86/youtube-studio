import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "YouTube Studio",
  description: "My video upload app",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
