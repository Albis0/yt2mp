import type {Metadata} from "next";
import {Geist, Geist_Mono} from "next/font/google";
import "./globals.css";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    metadataBase: new URL("https://yt2mp.onrender.com"),
    title: "yt2mp — clean YouTube to MP3 / MP4",
    description:
        "A clean, ad-free YouTube downloader that runs on your own computer. No upload limits, no shared server, no waiting.",
    icons: {icon: "/icon.png"},
    openGraph: {
        title: "yt2mp — clean YouTube to MP3 / MP4",
        description:
            "A clean, ad-free YouTube downloader that runs on your own computer.",
        images: ["/icon.png"],
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
            <body>{children}</body>
        </html>
    );
}
