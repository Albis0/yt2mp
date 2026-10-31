import Image from "next/image";
import CopyCommand from "@/components/CopyCommand";
import Reveal from "@/components/Reveal";
import DownloadSplit from "@/components/DownloadSplit";
import {GITHUB_URL, LINUX_URL, REPO_URL, LICENSE_URL, ISSUES_URL, SITE_URL, VERSION, INSTALLER_NAME, INSTALLER_SHA256, INSTALLER_SIZE, APPIMAGE_NAME, ANDROID_URL, APK_NAME, APK_REPO_URL} from "@/lib/site";

// Structured data: a SoftwareApplication node so the download surfaces as a
// rich result, plus an FAQPage built from the questions the page already
// answers. Both feed Google rich results and AI Overviews.
const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
        {
            "@type": "SoftwareApplication",
            name: "yt2mp",
            applicationCategory: "MultimediaApplication",
            operatingSystem: "Windows 10, Windows 11, Linux",
            softwareVersion: VERSION,
            softwareRequirements: "Windows 10/11 (x64) or a Linux x64 distribution",
            ...(INSTALLER_SIZE ? {fileSize: INSTALLER_SIZE} : {}),
            inLanguage: "en",
            description: "Free, open-source desktop app that downloads video and audio from YouTube, Spotify, TikTok, Instagram, X and Twitch as MP3 or MP4, and converts files to 34 formats. Runs on your own PC with no account and no ads.",
            url: SITE_URL,
            downloadUrl: GITHUB_URL,
            installUrl: GITHUB_URL,
            releaseNotes: `${REPO_URL}/releases/latest`,
            image: `${SITE_URL}/og.png`,
            license: LICENSE_URL,
            isAccessibleForFree: true,
            offers: {"@type": "Offer", price: "0", priceCurrency: "USD"},
            author: {"@type": "Person", name: "Albis0", url: REPO_URL},
            sameAs: [REPO_URL],
        },
        {
            "@type": "WebSite",
            name: "yt2mp",
            alternateName: ["yt2mp downloader", "yt2mp YouTube to MP3"],
            url: SITE_URL,
        },
        {
            "@type": "FAQPage",
            mainEntity: [
                {
                    "@type": "Question",
                    name: "Is yt2mp free?",
                    acceptedAnswer: {
                        "@type": "Answer",
                        text: "Yes. yt2mp is free and open source under the GPL-3.0 license, with no account, ads, or upload required.",
                    },
                },
                {
                    "@type": "Question",
                    name: "Does yt2mp work offline or send my data anywhere?",
                    acceptedAnswer: {
                        "@type": "Answer",
                        text: "Downloads and conversions run entirely on your own machine and talk only to the site you are downloading from. The optional AI features are the one exception: AI search sends the words you typed, and the Spotify match check a song title, artist and length, to the yt2mp server, which passes them to Groq and keeps no copy. With your own Groq key the app talks to Groq directly.",
                    },
                },
                {
                    "@type": "Question",
                    name: "Which sites does yt2mp support?",
                    acceptedAnswer: {
                        "@type": "Answer",
                        text: "YouTube, Spotify (songs and playlists are matched on YouTube Music), TikTok, Instagram, X (Twitter) and Twitch each have their own tab. A Link tab accepts anything else yt-dlp supports, roughly 1750 sites, and an AI search tab finds a video on YouTube from a description. Instagram and TikTok hide most posts from logged-out visitors, so yt2mp can borrow the login from a browser you are already signed into.",
                    },
                },
                {
                    "@type": "Question",
                    name: "Should I download YouTube video as H.264 or AV1?",
                    acceptedAnswer: {
                        "@type": "Answer",
                        text: "H.264 is the default because it plays on every phone, TV and PC. AV1 holds the same picture in up to half the bytes, but older computers can stutter on it and Windows may need an extra add-on to open it. yt2mp shows a switch above the quality list, and the size on each row follows the choice, so the number you see is the file you get. Resolutions above 1080p only exist as AV1 on YouTube.",
                    },
                },
                {
                    "@type": "Question",
                    name: "What can yt2mp convert?",
                    acceptedAnswer: {
                        "@type": "Answer",
                        text: "Videos, songs and pictures you already have, in 34 formats: MP4, MKV, WebM, MOV and more for video, MP3, M4A, FLAC, WAV and more for audio, and PNG, JPG, WebP, AVIF and more for pictures. Many files can be queued at once, and quality, size, trimming and sound options are available.",
                    },
                },
                {
                    "@type": "Question",
                    name: "Which operating systems does yt2mp support?",
                    acceptedAnswer: {
                        "@type": "Answer",
                        text: "yt2mp runs on Windows 10 and Windows 11 (x64) as an installer, on Linux x64 as a portable AppImage, and on Android 10 and up as an APK. yt-dlp and ffmpeg are included, so there is nothing to install separately and nothing to download the first time you open it.",
                    },
                },
            ],
        },
    ],
};

function LinuxIcon() {
    return (
        <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
            <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 00-.402-.533 1.45 1.45 0 00-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 00.314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 01.647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 01-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z" />
        </svg>
    );
}

function AndroidIcon() {
    return (
        <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
            <path d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.86 3.22a11.4 11.4 0 0 0-9.84 0L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
        </svg>
    );
}

function WindowsIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M3 5.5 10.5 4.4v7.1H3V5.5zm8.5-1.2L21 3v8.5h-9.5V4.3zM3 12.5h7.5v7.1L3 18.5v-6zm8.5 0H21V21l-9.5-1.3v-7.2z" />
        </svg>
    );
}

function GitHubIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
    );
}

// The tabs the app shows down its left side, with the same silhouettes the
// app draws, so the page and the product agree.
const SITE_ROWS = [
    {
        id: "youtube",
        name: "YouTube",
        note: "Videos, Shorts, playlists",
        path: "M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.5 15.6V8.4l6.3 3.6-6.3 3.6z",
    },
    {
        id: "spotify",
        name: "Spotify",
        note: "Songs and playlists",
        path: "M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z",
    },
    {
        id: "tiktok",
        name: "TikTok",
        note: "Posts and photo carousels",
        path: "M16.6 5.8a4.8 4.8 0 0 1-1-2.8h-3.3v13.2a2.9 2.9 0 1 1-2-2.8v-3.3a6.2 6.2 0 1 0 5.3 6.1V9.4a8 8 0 0 0 4.7 1.5V7.6a4.8 4.8 0 0 1-3.7-1.8z",
    },
    {
        id: "instagram",
        name: "Instagram",
        note: "Reels, posts and IGTV",
        path: "M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4 1.3-.1 1.7-.1 4.8-.1zm0 3.1a6.7 6.7 0 1 0 0 13.4 6.7 6.7 0 0 0 0-13.4zm0 11a4.3 4.3 0 1 1 0-8.6 4.3 4.3 0 0 1 0 8.6zm6.9-11.3a1.6 1.6 0 1 1-3.1 0 1.6 1.6 0 0 1 3.1 0z",
    },
    {
        id: "twitter",
        name: "X",
        note: "Video from any public post",
        path: "M18.2 2.3h3.4l-7.4 8.5 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9.1L.9 2.3h7l4.8 6.4 5.5-6.4zm-1.2 18h1.9L7.1 4.2H5.1L17 20.3z",
    },
    {
        id: "twitch",
        name: "Twitch",
        note: "Clips, VODs, highlights",
        path: "M4.3 1.7 1.7 6v14.6h5V24h2.8l2.9-3.4h4.3l5.4-5.4V1.7H4.3zm15.9 12.2-3.1 3.1h-4.9l-2.7 2.7v-2.7H5.3V3.6h14.9v10.3zm-4.1-6.7v5.4h-2V7.2h2zm-5.4 0v5.4h-2V7.2h2z",
    },
    {
        id: "other",
        name: "Any link",
        note: "About 1,750 more sites",
        path: "M10.6 13.4a1 1 0 0 1 0-1.4l1.4-1.4a1 1 0 0 1 1.4 1.4l-1.4 1.4a1 1 0 0 1-1.4 0zm-2.8 5.7a4 4 0 0 1 0-5.7l2.8-2.8 1.4 1.4-2.8 2.9a2 2 0 0 0 2.8 2.8l2.9-2.8 1.4 1.4-2.8 2.8a4 4 0 0 1-5.7 0zm8.5-8.5-1.4-1.4 2.8-2.9a2 2 0 0 0-2.8-2.8l-2.9 2.8-1.4-1.4 2.8-2.8a4 4 0 0 1 5.7 5.7l-2.8 2.8z",
    },
    {
        id: "ai",
        name: "AI search",
        note: "Describe it, find it",
        path: "M12 2l2.2 6.1L20.4 10l-6.2 2.2L12 18.4 9.8 12.2 3.6 10l6.2-1.9L12 2zm6.6 12.2l1 2.7 2.8 1-2.8 1-1 2.8-1-2.8-2.7-1 2.7-1 1-2.7z",
    },
];

const FORMATS = {
    Video: ["MP4", "MKV", "WebM", "MOV", "AVI", "TS", "MPEG", "WMV", "FLV", "3GP", "OGV"],
    Audio: ["MP3", "M4A", "WAV", "FLAC", "ALAC", "Opus", "OGG", "AAC", "WMA", "AIFF", "AC3", "MP2", "AMR"],
    Picture: ["PNG", "JPG", "WebP", "AVIF", "BMP", "TIFF", "ICO"],
    Animation: ["GIF", "Animated WebP", "APNG"],
};

export default function Home() {
    return (
        <div className="page">
            <script type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify(jsonLd)}} />

            <header className="nav">
                <div className="nav-in">
                    <a className="nav-id" href="#top" aria-label="yt2mp, back to the top">
                        <Image src="/icon.png" alt="" width={24} height={24} />
                        <span>yt2mp</span>
                    </a>
                    <nav className="nav-links" aria-label="Page">
                        <a href="#sites">Sites</a>
                        <a href="#convert">Convert</a>
                        <a href="#more">More</a>
                        <a href={REPO_URL} target="_blank" rel="noreferrer">
                            Source
                        </a>
                    </nav>
                    <a className="btn btn-solid btn-small" href="#download">
                        Download
                    </a>
                </div>
            </header>

            <main id="top">
                <section className="hero wrap">
                    <h1 className="hero-title">
                        Paste a link.
                        <br />
                        <span className="dim">Keep the file.</span>
                    </h1>
                    <p className="hero-dek">Download from YouTube, Spotify, TikTok, Instagram, X and Twitch, then convert to 34 formats. Free, on your own PC.</p>
                    <div className="hero-actions">
                        <DownloadSplit
                            fallbackHref="#download"
                            targets={[
                                {name: "Windows", href: GITHUB_URL, icon: <WindowsIcon />},
                                {name: "Linux", href: LINUX_URL, icon: <LinuxIcon />},
                                {name: "Android", href: ANDROID_URL, icon: <AndroidIcon />},
                            ]}
                        />
                        <a className="btn btn-quiet" href={REPO_URL} target="_blank" rel="noreferrer">
                            <GitHubIcon />
                            Source on GitHub
                        </a>
                    </div>

                    <div className="hero-shot">
                        <div className="window">
                            <Image
                                src="/shots/app-youtube.webp"
                                alt="The yt2mp window with a YouTube video fetched: the MP3 option at 3.3 MB and video qualities from 2160p at 345 MB down to 720p, each with its size"
                                width={2250}
                                height={1900}
                                sizes="(max-width: 1100px) 100vw, 1000px"
                                priority
                            />
                        </div>
                    </div>
                </section>

                <section id="sites" className="band wrap">
                    <Reveal>
                        <h2 className="band-title">
                            One window for <span className="dim">every site you save from.</span>
                        </h2>
                    </Reveal>
                    <Reveal delay={80}>
                        <ul className="sites">
                            {SITE_ROWS.map((s) => (
                                <li className="site" key={s.id}>
                                    <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true">
                                        <path d={s.path} />
                                    </svg>
                                    <span className="site-name">{s.name}</span>
                                    <span className="site-note">{s.note}</span>
                                </li>
                            ))}
                        </ul>
                    </Reveal>
                    <Reveal delay={120}>
                        <p className="band-dek">
                            Each site has its own tab, so you always know what the app is about to do. Every quality shows the size of the file you will actually get, and a switch picks H.264, which plays everywhere, or AV1, which is smaller, so a big download never surprises you.
                        </p>
                    </Reveal>
                </section>

                <section id="convert" className="band wrap">
                    <Reveal>
                        <h2 className="band-title">
                            Then turn it into <span className="dim">anything else.</span>
                        </h2>
                        <p className="band-dek">
                            Drop in videos, songs or pictures from anywhere and pick what they should become. A whole folder converts in one go, and every file keeps its own format choice.
                        </p>
                    </Reveal>
                    <Reveal delay={80} className="convert-shot">
                        <div className="window">
                            <Image
                                src="/shots/app-convert.webp"
                                alt="The Convert tab after three files were converted: an MKV, an M4A and a JPG, each ready to download"
                                width={2250}
                                height={1000}
                                sizes="(max-width: 1100px) 100vw, 1000px"
                            />
                        </div>
                    </Reveal>
                    <Reveal delay={120}>
                        <div className="formats" aria-label="Formats yt2mp converts to">
                            {Object.entries(FORMATS).map(([group, list]) => (
                                <div className="format-group" key={group}>
                                    <span className="format-title">{group}</span>
                                    <span className="format-list">{list.join("  ")}</span>
                                </div>
                            ))}
                        </div>
                    </Reveal>
                </section>

                <section className="band wrap numbers" aria-label="In numbers">
                    <Reveal className="number">
                        <span className="number-big">34</span>
                        <span className="number-what">formats to convert to</span>
                    </Reveal>
                    <Reveal delay={80} className="number">
                        <span className="number-big">1,750</span>
                        <span className="number-what">sites it can read</span>
                    </Reveal>
                    <Reveal delay={160} className="number">
                        <span className="number-big">0</span>
                        <span className="number-what">accounts, ads or uploads</span>
                    </Reveal>
                </section>

                <section id="more" className="band wrap">
                    <Reveal>
                        <h2 className="band-title">
                            And a few things <span className="dim">you did not expect.</span>
                        </h2>
                    </Reveal>
                    <div className="bento">
                        <Reveal className="tile tile-browser">
                            <h3 className="tile-title">A browser built in</h3>
                            <p className="tile-text">
                                Tabs, history and a saved sign-in, right in the title bar. Browse YouTube or TikTok inside the app, press Download on the page you like, and the link lands in the right tab.
                            </p>
                            <div className="tile-icons" aria-hidden="true">
                                {[0, 2, 3, 4, 5].map((i) => (
                                    <svg key={i} viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                                        <path d={SITE_ROWS[i].path} />
                                    </svg>
                                ))}
                            </div>
                            <p className="tile-note">Windows only for now</p>
                        </Reveal>
                        <Reveal delay={80} className="tile tile-spotify">
                            <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor" aria-hidden="true">
                                <path d={SITE_ROWS[1].path} />
                            </svg>
                            <h3 className="tile-title">Spotify, matched</h3>
                            <p className="tile-text">Paste a song or a whole playlist. Each track is found on YouTube Music and saved as MP3.</p>
                        </Reveal>
                        <Reveal delay={80} className="tile tile-ai">
                            <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor" aria-hidden="true">
                                <path d={SITE_ROWS[7].path} />
                            </svg>
                            <h3 className="tile-title">Describe it, find it</h3>
                            <p className="tile-text">Forgot the title? Write what you remember and it finds the video on YouTube.</p>
                        </Reveal>
                        <Reveal delay={160} className="tile tile-fresh">
                            <h3 className="tile-title">It repairs itself</h3>
                            <p className="tile-text">
                                Sites change and break downloaders all the time. yt2mp updates itself, and can update the part that reads the sites on its own, so a site that stopped working usually starts again without waiting for a new release.
                            </p>
                        </Reveal>
                    </div>
                </section>

                <section className="band wrap private">
                    <Reveal>
                        <p className="private-text">
                            It runs on your computer. <span className="dim">Nothing is uploaded, nothing is tracked, and there is no account to make. Downloads go straight from the site to your disk.</span>
                        </p>
                    </Reveal>
                </section>

                <section id="download" className="band wrap">
                    <Reveal>
                        <h2 className="band-title">
                            Get yt2mp. <span className="dim">It is free.</span>
                        </h2>
                    </Reveal>
                    <div className="get">
                        <Reveal className="get-card">
                            <div className="get-head">
                                <WindowsIcon />
                                <h3 className="get-title">Windows</h3>
                            </div>
                            <p className="get-text">Windows 10 and 11, 64-bit. One installer with everything inside, no setup step and nothing to fetch on first launch.</p>
                            <a className="btn btn-solid" href={GITHUB_URL}>
                                Download for Windows
                            </a>
                            <p className="get-meta">
                                {INSTALLER_NAME}
                                {INSTALLER_SIZE ? ` (${INSTALLER_SIZE})` : ""}
                            </p>
                        </Reveal>
                        <Reveal delay={80} className="get-card">
                            <div className="get-head">
                                <LinuxIcon />
                                <h3 className="get-title">Linux</h3>
                            </div>
                            <p className="get-text">A portable AppImage, 64-bit. Download it, mark it executable, run it. Nothing to install.</p>
                            <a className="btn btn-outline" href={LINUX_URL}>
                                Download the AppImage
                            </a>
                            <div className="cmd-list">
                                <CopyCommand command={`chmod +x ${APPIMAGE_NAME}`} />
                                <CopyCommand command={`./${APPIMAGE_NAME}`} />
                            </div>
                        </Reveal>
                        <Reveal delay={160} className="get-card">
                            <div className="get-head">
                                <AndroidIcon />
                                <h3 className="get-title">Android</h3>
                            </div>
                            <p className="get-text">The same app on your phone: every tab, the converter, history and settings. Download it, open the file, and allow installs from your browser when Android asks.</p>
                            <a className="btn btn-outline" href={ANDROID_URL}>
                                Download the APK
                            </a>
                            <p className="get-meta">
                                {APK_NAME}. Android 10 and up. <a href={APK_REPO_URL}>Source</a>.
                            </p>
                        </Reveal>
                    </div>
                    <p className="get-foot">
                        Version {VERSION}. GPL-3.0, <a href={REPO_URL}>read every line of it</a>.
                    </p>
                </section>

                <section className="band wrap">
                    <Reveal>
                        <h2 className="band-title band-title-small">The small print</h2>
                    </Reveal>
                    <Reveal delay={60} className="details">
                        <details>
                            <summary>Why Windows warns you on the first run</summary>
                            <div className="detail-body">
                                <p>
                                    The installer is not signed with a paid code-signing certificate, so Windows SmartScreen shows a warning the first time. That is a missing certificate, not a detected threat.
                                    Updates inside the app are different: every one is cryptographically signed, and the app refuses anything that is not.
                                </p>
                                {INSTALLER_SHA256 ? (
                                    <p>
                                        To check the file you downloaded, run <code className="inline-code">Get-FileHash {INSTALLER_NAME}</code> and compare it with this hash:
                                        <code className="hash">{INSTALLER_SHA256}</code>
                                    </p>
                                ) : null}
                            </div>
                        </details>
                        <details id="signing">
                            <summary>Code signing policy</summary>
                            <div className="detail-body">
                                <p>
                                    Windows installers are not code-signed yet. We are applying for free code signing for open source projects from{" "}
                                    <a href="https://signpath.org/" target="_blank" rel="noreferrer">
                                        SignPath Foundation
                                    </a>
                                    . Once it is approved, this section will say so, and every release will be signed with the foundation&apos;s certificate after a manual approval.
                                </p>
                                <p>
                                    Roles: <a href="https://github.com/Albis0">Albis0</a> is the author, reviewer and approver of every release. Releases are built from the public source by GitHub
                                    Actions, and only from that source. The app is free software under the GPL-3.0 and carries no proprietary components.
                                </p>
                            </div>
                        </details>
                        <details id="privacy">
                            <summary>Privacy</summary>
                            <div className="detail-body">
                                <p>
                                    yt2mp has no account, no analytics and no tracking. It sends nothing to us. It talks to other services only when you ask it to, and only with what that needs:
                                </p>
                                <ul className="detail-list">
                                    <li>The link you paste goes to the site it belongs to, to fetch the file.</li>
                                    <li>
                                        AI search sends the words you typed, and the Spotify match check a song title, artist and length, to this site's server, which passes them to Groq and keeps no copy. Nothing else, and not when you use neither. With your own Groq key the app talks to Groq directly.
                                    </li>
                                    <li>The update check asks GitHub whether a newer version exists. Tool updates come from the tools&apos; own GitHub pages.</li>
                                    <li>
                                        If you let it use a browser session, the cookies stay on your computer and go only to the site they belong to.
                                    </li>
                                </ul>
                                <p>Downloads, history and settings are stored on your computer and nowhere else. Removing the app removes them.</p>
                            </div>
                        </details>
                        <details>
                            <summary>Signing in to Instagram and TikTok</summary>
                            <div className="detail-body">
                                <p>
                                    Both sites hide most posts from logged-out visitors. yt2mp never asks for your password. It borrows the session from a browser you are already signed into: press one button
                                    and it tries each installed browser, then keeps the one that works.
                                </p>
                                <p>
                                    Firefox, Chrome, Edge, Brave, Opera, Vivaldi and the forks (Zen, LibreWolf, Waterfox, Floorp, Opera GX, Arc) are recognised. A session is only ever sent to the site it came from.
                                </p>
                            </div>
                        </details>
                        <details>
                            <summary>What is inside the installer</summary>
                            <div className="detail-body">
                                <p>
                                    The tools that do the real work are already in the box: ffmpeg (about 98 MB), yt-dlp (17 MB) and a small JavaScript runtime (2 MB), around the app itself (5 MB). That is why
                                    it works offline from the first launch.
                                </p>
                                <p>
                                    It draws its window with the WebView your system already has, instead of carrying a second copy of Chromium, so it stays far smaller than the Electron build it replaced.
                                </p>
                            </div>
                        </details>
                        <details>
                            <summary>Why it is an app and not a website</summary>
                            <div className="detail-body">
                                <p>
                                    This used to be a web app. Two things broke under real use: YouTube blocks downloads from shared cloud IP ranges, and a small free server runs out of memory the moment two
                                    people download at once. Both problems belong to the server, so the server is gone. Downloads now run from your own connection, which also lets sites that need a login use the
                                    browser session you already have.
                                </p>
                            </div>
                        </details>
                        <details>
                            <summary>Before you download</summary>
                            <div className="detail-body">
                                <p>
                                    Free software, provided as is, no warranty. You are responsible for what you download with it. Keep it to content you have the right to save: your own uploads, public
                                    domain, Creative Commons, or anything else you are permitted to keep. Downloading from YouTube may go against{" "}
                                    <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
                                        its Terms of Service
                                    </a>
                                    . This project is not built for copyright infringement, and the authors are not liable for how it is used.
                                </p>
                            </div>
                        </details>
                    </Reveal>
                </section>
            </main>

            <footer className="foot">
                <div className="foot-in wrap">
                    <span>yt2mp {VERSION}</span>
                    <nav className="foot-links" aria-label="Project">
                        <a href={LICENSE_URL} target="_blank" rel="noreferrer">
                            GPL-3.0-or-later
                        </a>
                        <a href={REPO_URL} target="_blank" rel="noreferrer">
                            Source
                        </a>
                        <a href={ISSUES_URL} target="_blank" rel="noreferrer">
                            Issues
                        </a>
                    </nav>
                </div>
            </footer>
        </div>
    );
}
