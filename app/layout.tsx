import type {Metadata} from "next";
import {IBM_Plex_Mono, IBM_Plex_Sans} from "next/font/google";
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

export const metadata: Metadata = {
    metadataBase: new URL("https://yt2mp.onrender.com"),
    title: "yt2mp — YouTube to MP3/MP4, run locally",
    description:
        "A Windows desktop app that downloads YouTube audio/video as MP3 or MP4. No server, no account, no ads — open source under GPL-3.0.",
    icons: {icon: "/icon.png"},
    openGraph: {
        title: "yt2mp — YouTube to MP3/MP4, run locally",
        description:
            "A Windows desktop app that downloads YouTube audio/video as MP3 or MP4. No server, no account, no ads.",
        images: ["/icon.png"],
    },
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
