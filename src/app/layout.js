import "./globals.css";
import Providers from "./providers";
import NavBar from "../components/NavBar";

export const metadata = {
  title: "استودیوی یوتیوب",
  description: "My video upload app",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <Providers>
          <NavBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
