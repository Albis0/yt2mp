import type {Metadata} from "next";
import {IBM_Plex_Mono, IBM_Plex_Sans} from "next/font/google";
import {SITE_URL} from "@/lib/site";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
    variable: "--font-plex-sans",
    subsets: ["latin"],
    weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
    variable: "--font-plex-mono",
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
});

const TITLE = "yt2mp — YouTube to MP3/MP4 Downloader for Windows";
const DESCRIPTION =
    "Free, open-source Windows app that downloads YouTube videos as MP3 or MP4. Runs locally on your own machine — no server, no account, no ads, no upload. GPL-3.0.";

export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    title: {
        default: TITLE,
        template: "%s — yt2mp",
    },
    description: DESCRIPTION,
    applicationName: "yt2mp",
    keywords: [
        "YouTube to MP3",
        "YouTube to MP4",
        "YouTube downloader",
        "YouTube MP3 converter",
        "download YouTube video",
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
                alt: "yt2mp — download YouTube as MP3 or MP4 on Windows",
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
        <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
            <body>{children}</body>
        </html>
    );
}
