import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF Chat Agent",
  description: "PDF 检索与审核 Chat Agent",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
