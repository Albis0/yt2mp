import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "yt2mp",
  description: "Ad-free, fast YouTube MP3/MP4 downloader.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
