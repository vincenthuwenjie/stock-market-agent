import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Market Agent",
  description: "Dynamic market dashboard for macro, M7 equities, options, rates, FX, and risk posture.",
  icons: {
    icon: "/bull.png",
    shortcut: "/bull.png",
    apple: "/bull.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
