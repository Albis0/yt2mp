import type {Metadata} from "next";
import {Geist, Geist_Mono} from "next/font/google";
import {SITE_URL} from "@/lib/site";
import "./globals.css";

// Geist for the page and Geist Mono for figures. The app's own screenshots
// carry the product's typography; the page around them stays out of the way.
const geist = Geist({
    variable: "--font-geist",
    subsets: ["latin"],
    weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
    weight: ["400", "500"],
});

// YouTube stays first in both: it is the highest-volume term by a wide margin
// and the page's existing ranking rests on it. The other sites are additions,
// not a replacement.
const TITLE = "yt2mp - YouTube, TikTok & Instagram to MP3/MP4 Downloader and Converter";
const DESCRIPTION =
    "Free, open-source desktop app that downloads YouTube, Spotify, TikTok, Instagram, X and Twitch as MP3 or MP4, then converts files to 34 formats. Runs on your own machine: no account, no ads, no upload. Windows and Linux. GPL-3.0.";

export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    title: {
        default: TITLE,
        template: "%s - yt2mp",
    },
    description: DESCRIPTION,
    applicationName: "yt2mp",
    keywords: [
        "YouTube to MP3",
        "YouTube to MP4",
        "YouTube downloader",
        "YouTube MP3 converter",
        "download YouTube video",
        "Spotify playlist downloader",
        "TikTok video downloader",
        "Instagram reel downloader",
        "Twitch VOD downloader",
        "X video downloader",
        "video converter",
        "Windows YouTube downloader",
        "offline YouTube downloader",
        "open source YouTube downloader",
        "yt-dlp GUI",
        "yt2mp",
    ],
    authors: [{name: "Albis0"}],
    creator: "Albis0",
    alternates: {
        canonical: "/",
    },
    manifest: "/site.webmanifest",
    icons: {
        icon: [
            {url: "/favicon-16x16.png", sizes: "16x16", type: "image/png"},
            {url: "/favicon-32x32.png", sizes: "32x32", type: "image/png"},
        ],
        shortcut: "/favicon.ico",
        apple: "/apple-touch-icon.png",
    },
    openGraph: {
        type: "website",
        url: SITE_URL,
        siteName: "yt2mp",
        title: TITLE,
        description: DESCRIPTION,
        images: [
            {
                url: "/og.png",
                width: 1200,
                height: 630,
                alt: "yt2mp: download YouTube, TikTok and Instagram video as MP3 or MP4, and convert files",
            },
        ],
    },
    twitter: {
        card: "summary_large_image",
        title: TITLE,
        description: DESCRIPTION,
        images: ["/og.png"],
    },
    verification: {
        google: "MN26jb5KvOYIpGQud3ERpaVjvTAvGIrq8MijxbxrX-Y",
    },
    robots: {
        index: true,
        follow: true,
        googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
        },
    },
    category: "technology",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
            <body>{children}</body>
        </html>
    );
}
