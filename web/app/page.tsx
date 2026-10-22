import Image from "next/image";
import CopyCommand from "@/components/CopyCommand";
import Reveal from "@/components/Reveal";
import {GITHUB_URL, LINUX_URL, REPO_URL, LICENSE_URL, ISSUES_URL, SITE_URL, VERSION, INSTALLER_NAME, INSTALLER_SHA256, INSTALLER_SIZE, APPIMAGE_NAME} from "@/lib/site";

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
            description: "Free, open-source desktop app that downloads video and audio from YouTube, Spotify, TikTok, Instagram, X and Twitch as MP3 or MP4, and converts files to 34 formats. Runs locally with no server, no account and no ads.",
            url: SITE_URL,
            downloadUrl: GITHUB_URL,
            installUrl: GITHUB_URL,
            releaseNotes: `${REPO_URL}/releases/latest`,
            image: `${SITE_URL}/og.png`,
            license: LICENSE_URL,
            isAccessibleForFree: true,
            offers: {"@type": "Offer", price: "0", priceCurrency: "USD"},
            author: {"@type": "Person", name: "Albis0", url: REPO_URL},
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
                        text: "Downloads and conversions run entirely on your own machine and talk only to the site you are downloading from. There is no server component. The optional AI search feature is the one exception: it sends your search text to an AI service to turn it into a search query.",
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
                        text: "yt2mp runs on Windows 10 and Windows 11 (x64) as an installer, and on Linux x64 as a portable AppImage. yt-dlp and ffmpeg are included, so there is nothing to install separately and nothing to download the first time you open it.",
                    },
                },
            ],
        },
    ],
};

function LinuxIcon() {
    return (
        <svg viewBox="0 0 24 24" width="15" height="18" aria-hidden="true">
            <path
                fill="currentColor"
                d="M12.005 0C9.27 0 8.165 2.527 8.165 4.5c0 1.34.34 2.06.34 3.4 0 .9-.74 1.62-1.49 2.85-.86 1.4-1.83 3.02-1.83 5.02 0 .77.2 1.45.2 2.05 0 .67-.5 1.07-.95 1.6-.5.6-.98 1.2-.98 2.06 0 1.18 1.07 1.74 2.4 2.02 1.2.25 2.6.5 3.86.5h4.55c1.27 0 2.66-.25 3.86-.5 1.33-.28 2.4-.84 2.4-2.02 0-.86-.48-1.46-.98-2.06-.45-.53-.95-.93-.95-1.6 0-.6.2-1.28.2-2.05 0-2-.97-3.62-1.83-5.02-.75-1.23-1.49-1.95-1.49-2.85 0-1.34.34-2.06.34-3.4C15.845 2.527 14.74 0 12.005 0z"
            />
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
                        <a className="btn btn-solid" href="#download">
                            Download
                        </a>
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
                            Each site has its own tab, so you always know what the app is about to do. Every quality shows its exact size before you pick one, so a 4K download never surprises you.
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
