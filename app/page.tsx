import Image from "next/image";
import CopyCommand from "@/components/CopyCommand";
import {GITHUB_URL, LINUX_URL, REPO_URL, LICENSE_URL, ISSUES_URL, SITE_URL, VERSION, INSTALLER_NAME, INSTALLER_SHA256, INSTALLER_SIZE, APPIMAGE_NAME} from "@/lib/site";

// Structured data: a SoftwareApplication node so the download surfaces as a
// rich result, plus an FAQPage built from the questions the page already
// answers — both feed Google rich results and AI Overviews.
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
            description: "Free, open-source desktop app that downloads video and audio from YouTube, TikTok, Instagram, X and Twitch as MP3 or MP4. Runs locally — no server, no account, no ads.",
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
                        text: "Downloads run entirely on your own machine and talk only to the site you are downloading from — there is no server component. The optional AI search feature is the one exception: it sends your search text to Groq's API to turn it into a search query.",
                    },
                },
                {
                    "@type": "Question",
                    name: "Which sites does yt2mp support?",
                    acceptedAnswer: {
                        "@type": "Answer",
                        text: "YouTube, TikTok, Instagram, X (Twitter) and Twitch each have their own tab, an 'Any link' tab accepts anything else yt-dlp supports — roughly 1750 sites — and an AI search tab finds a video on YouTube from a description instead of a link. Instagram and TikTok hide most posts from logged-out visitors, so yt2mp can borrow the login from a browser you are already signed into.",
                    },
                },
                {
                    "@type": "Question",
                    name: "What formats can yt2mp download?",
                    acceptedAnswer: {
                        "@type": "Answer",
                        text: "MP3 (best available audio re-encoded at 192 kbps) and MP4 (best available video, with a quality picker for the resolutions the source offers). It also supports playlists, and downloads over 1 GB can be paused and resumed.",
                    },
                },
                {
                    "@type": "Question",
                    name: "Which operating systems does yt2mp support?",
                    acceptedAnswer: {
                        "@type": "Answer",
                        text: "yt2mp runs on Windows 10 and Windows 11 (x64) as an installer, and on Linux x64 as a portable AppImage. It fetches yt-dlp and ffmpeg itself the first time you open it, so there is nothing to install separately.",
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
                fill="#000"
                d="M12.005 0C9.27 0 8.165 2.527 8.165 4.5c0 1.34.34 2.06.34 3.4 0 .9-.74 1.62-1.49 2.85-.86 1.4-1.83 3.02-1.83 5.02 0 .77.2 1.45.2 2.05 0 .67-.5 1.07-.95 1.6-.5.6-.98 1.2-.98 2.06 0 1.18 1.07 1.74 2.4 2.02 1.2.25 2.6.5 3.86.5h4.55c1.27 0 2.66-.25 3.86-.5 1.33-.28 2.4-.84 2.4-2.02 0-.86-.48-1.46-.98-2.06-.45-.53-.95-.93-.95-1.6 0-.6.2-1.28.2-2.05 0-2-.97-3.62-1.83-5.02-.75-1.23-1.49-1.95-1.49-2.85 0-1.34.34-2.06.34-3.4C15.845 2.527 14.74 0 12.005 0z"
            />
            <ellipse cx="9.6" cy="6.5" rx="1.5" ry="1.9" fill="#fff" />
            <ellipse cx="14.4" cy="6.5" rx="1.5" ry="1.9" fill="#fff" />
            <circle cx="9.9" cy="6.8" r="0.85" fill="#000" />
            <circle cx="14.1" cy="6.8" r="0.85" fill="#000" />
            <path fill="#f4b400" d="M12 7.4c-1.1 0-2.5 1.1-2.5 1.9 0 .6 1.3 1.1 2.5 1.1s2.5-.5 2.5-1.1c0-.8-1.4-1.9-2.5-1.9z" />
            <path fill="#fff" d="M12 11.2c-2.4 0-4 3.6-4 6.6 0 2.7 1.8 4.4 4 4.4s4-1.7 4-4.4c0-3-1.6-6.6-4-6.6z" />
            <path fill="#f4b400" d="M6.3 20.6c-.7 1.2-1.9 1.6-1.8 2.4.1.7 1.1.6 1.9.5.8-.1 1.4-.5 1.4-1.1 0-.8-.9-3-1.5-1.8zm11.4 0c.7 1.2 1.9 1.6 1.8 2.4-.1.7-1.1.6-1.9.5-.8-.1-1.4-.5-1.4-1.1 0-.8.9-3 1.5-1.8z" />
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

function DownloadIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="m7 11 5 5 5-5" />
            <path d="M4 20h16" />
        </svg>
    );
}

// The seven tabs, in the order the app shows them. Icons are the same
// silhouettes the app draws, so the page and the product agree.
const SITE_ROWS = [
    {
        id: "youtube",
        name: "YouTube",
        what: "Videos, Shorts and full playlists",
        note: "",
        path: "M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.5 15.6V8.4l6.3 3.6-6.3 3.6z",
    },
    {
        id: "tiktok",
        name: "TikTok",
        what: "Posts, photo carousels and sounds",
        note: "broken upstream",
        warn: true,
        path: "M16.6 5.8a4.8 4.8 0 0 1-1-2.8h-3.3v13.2a2.9 2.9 0 1 1-2-2.8v-3.3a6.2 6.2 0 1 0 5.3 6.1V9.4a8 8 0 0 0 4.7 1.5V7.6a4.8 4.8 0 0 1-3.7-1.8z",
    },
    {
        id: "instagram",
        name: "Instagram",
        what: "Reels, posts and IGTV",
        note: "sign-in needed",
        path: "M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4 1.3-.1 1.7-.1 4.8-.1zm0 3.1a6.7 6.7 0 1 0 0 13.4 6.7 6.7 0 0 0 0-13.4zm0 11a4.3 4.3 0 1 1 0-8.6 4.3 4.3 0 0 1 0 8.6zm6.9-11.3a1.6 1.6 0 1 1-3.1 0 1.6 1.6 0 0 1 3.1 0z",
    },
    {
        id: "twitter",
        name: "X",
        what: "Video from any public post",
        note: "",
        path: "M18.2 2.3h3.4l-7.4 8.5 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9.1L.9 2.3h7l4.8 6.4 5.5-6.4zm-1.2 18h1.9L7.1 4.2H5.1L17 20.3z",
    },
    {
        id: "twitch",
        name: "Twitch",
        what: "Clips, VODs and highlights",
        note: "",
        path: "M4.3 1.7 1.7 6v14.6h5V24h2.8l2.9-3.4h4.3l5.4-5.4V1.7H4.3zm15.9 12.2-3.1 3.1h-4.9l-2.7 2.7v-2.7H5.3V3.6h14.9v10.3zm-4.1-6.7v5.4h-2V7.2h2zm-5.4 0v5.4h-2V7.2h2z",
    },
    {
        id: "other",
        name: "Any link",
        what: "The catch-all tab for everything else",
        note: "~1,750 sites",
        path: "M10.6 13.4a1 1 0 0 1 0-1.4l1.4-1.4a1 1 0 0 1 1.4 1.4l-1.4 1.4a1 1 0 0 1-1.4 0zm-2.8 5.7a4 4 0 0 1 0-5.7l2.8-2.8 1.4 1.4-2.8 2.9a2 2 0 0 0 2.8 2.8l2.9-2.8 1.4 1.4-2.8 2.8a4 4 0 0 1-5.7 0zm8.5-8.5-1.4-1.4 2.8-2.9a2 2 0 0 0-2.8-2.8l-2.9 2.8-1.4-1.4 2.8-2.8a4 4 0 0 1 5.7 5.7l-2.8 2.8z",
    },
    {
        id: "ai",
        name: "AI search",
        what: "Describe a video instead of finding its link",
        note: "YouTube only",
        path: "M12 2l2.2 6.1L20.4 10l-6.2 2.2L12 18.4 9.8 12.2 3.6 10l6.2-1.9L12 2zm6.6 12.2l1 2.7 2.8 1-2.8 1-1 2.8-1-2.8-2.7-1 2.7-1 1-2.7z",
    },
];

export default function Home() {
    return (
        <div className="page">
            <script type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify(jsonLd)}} />

            <div className="mobile-block">
                <div className="mobile-block-inner">
                    <Image src="/icon.png" alt="" width={44} height={44} />
                    <p className="mobile-block-title">yt2mp is a desktop app</p>
                    <p className="mobile-block-text">
                        It installs and runs on a Windows 10/11 or Linux desktop — there&apos;s nothing to open here on a phone. Open this page on your computer when you&apos;re ready to install it,
                        or read the source below.
                    </p>
                    <a className="mobile-block-link" href={REPO_URL}>
                        View the repository on GitHub →
                    </a>
                </div>
            </div>

            <div className="desktop-only">
                <header className="wrap">
                    <div className="topbar">
                        <div className="topbar-id">
                            <Image src="/icon.png" alt="" width={22} height={22} />
                            <span className="topbar-name">yt2mp</span>
                            <span className="topbar-version">v{VERSION}</span>
                        </div>
                        <nav className="topbar-links">
                            <a href={REPO_URL} target="_blank" rel="noreferrer">
                                source
                            </a>
                            <a href={ISSUES_URL} target="_blank" rel="noreferrer">
                                issues
                            </a>
                            <a href={LICENSE_URL} target="_blank" rel="noreferrer">
                                license
                            </a>
                        </nav>
                    </div>
                </header>

                <main>
                    <section className="wrap hero">
                        <h1 className="hero-title">
                            Paste a link.
                            <br />
                            Get <span className="hero-em">MP3</span> or <span className="hero-em">MP4</span>.
                        </h1>
                        <p className="hero-dek">
                            A desktop downloader for YouTube, TikTok, Instagram, X and Twitch. It runs on your own machine — no account, no upload, no ads, and nothing to configure.
                        </p>

                        <div className="hero-actions">
                            <a className="btn btn-primary" href={GITHUB_URL}>
                                <DownloadIcon />
                                Download for Windows
                            </a>
                            <a className="btn btn-ghost" href={LINUX_URL}>
                                <LinuxIcon />
                                Linux AppImage
                            </a>
                            <a className="btn btn-ghost" href={REPO_URL} target="_blank" rel="noreferrer">
                                <GitHubIcon />
                                Source
                            </a>
                        </div>

                        <p className="hero-meta">
                            <span>{INSTALLER_NAME}</span>
                            {INSTALLER_SIZE ? (
                                <>
                                    <span className="dot">·</span>
                                    <span>{INSTALLER_SIZE}</span>
                                </>
                            ) : null}
                            <span className="dot">·</span>
                            <span>Windows 10/11</span>
                            <span className="dot">·</span>
                            <span>GPL-3.0</span>
                        </p>

                        {/* Both themes, side by side and at a size that keeps
                            the whole result card legible without letting one
                            screenshot own the fold. */}
                        <div className="shots">
                            <figure className="shot">
                                <Image
                                    src="/shots/app-dark.png"
                                    alt="The yt2mp window in dark theme with a YouTube video fetched, showing the MP3 button and video qualities from 2160p to 720p with their file sizes"
                                    width={900}
                                    height={1076}
                                    sizes="(max-width: 900px) 100vw, 430px"
                                    priority
                                />
                            </figure>
                            <figure className="shot">
                                <Image
                                    src="/shots/app-light.png"
                                    alt="The same window in light theme, showing the identical layout on a light background"
                                    width={900}
                                    height={1076}
                                    sizes="(max-width: 900px) 100vw, 430px"
                                />
                            </figure>
                        </div>
                        <p className="shot-caption">The same screen in both themes. Dark by default; light is one click away.</p>
                    </section>

                    <section className="wrap band">
                        <h2 className="band-title">A tab per site</h2>
                        <p className="band-dek">
                            Each site gets its own tab with the link format it expects, so you always know what the app is about to do. The tab colours the window it opens in.
                        </p>

                        <div className="sites">
                            {SITE_ROWS.map((s) => (
                                <div className="site-row" key={s.id}>
                                    <span className={`site-name site-${s.id}`}>
                                        <span className="site-icon">
                                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                                                <path d={s.path} />
                                            </svg>
                                        </span>
                                        {s.name}
                                    </span>
                                    <span className="site-what">{s.what}</span>
                                    <span className={`site-note${s.warn ? " site-note-warn" : ""}`}>{s.note}</span>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="wrap band">
                        <h2 className="band-title">Pick the file you actually want</h2>
                        <p className="band-dek">
                            The quality list shows the exact size of every option before you commit to one, so a 4K download never surprises you. Large downloads can be paused and resumed.
                        </p>
                        <div className="shot shot-inline">
                            <Image
                                src="/shots/app-formats.png"
                                alt="The format list: MP3 at 3.3 MB, then video options from 2160p at 345.3 MB down to 720p at 25.2 MB, each with its size"
                                width={1524}
                                height={512}
                                sizes="(max-width: 760px) 100vw, 720px"
                            />
                        </div>
                    </section>

                    <section className="wrap band">
                        <h2 className="band-title">The details</h2>

                        <div className="pair">
                            <div className="card">
                                <h3 className="card-title">Why it runs on your machine</h3>
                                <p className="card-text">
                                    This used to be a web app. Two things broke under real use: YouTube blocks downloads from shared cloud IP ranges, and a free 512&nbsp;MB instance gets OOM-killed the
                                    moment two people download at once.
                                </p>
                                <p className="card-text">
                                    Both problems belong to the server, so the server is gone. Downloads now run from your own connection — which also lets sites that need a login use the browser
                                    session you already have.
                                </p>
                            </div>

                            <div className="card">
                                <h3 className="card-title">Signing in to Instagram and TikTok</h3>
                                <p className="card-text">
                                    Both hide most posts from logged-out visitors. yt2mp never asks for your password — it borrows the session from a browser you are already signed into. Press one
                                    button and it tries each installed browser, then keeps the one that works.
                                </p>
                                <p className="card-text">
                                    Firefox, Chrome, Edge, Brave, Opera, Vivaldi and the forks (Zen, LibreWolf, Waterfox, Floorp, Opera&nbsp;GX, Arc) are recognised. A session is only ever sent to the
                                    site it came from.
                                </p>
                            </div>

                            <div className="card">
                                <h3 className="card-title">A small installer, and small updates</h3>
                                <p className="card-text">
                                    yt2mp draws its window with the WebView already in your OS rather than bundling a second copy of Chromium, so the download is {INSTALLER_SIZE}. The tools that do
                                    the actual work — ffmpeg, yt-dlp and a small JavaScript runtime — are fetched once on first run instead of riding along inside the installer.
                                </p>
                                <div className="sizebar">
                                    <div className="seg seg-app" style={{flexGrow: 3}}>
                                        installer
                                    </div>
                                    <div className="seg seg-ffmpeg" style={{flexGrow: 98}}>
                                        ffmpeg
                                    </div>
                                    <div className="seg seg-ytdlp" style={{flexGrow: 17}}>
                                        yt-dlp
                                    </div>
                                    <div className="seg seg-quickjs" style={{flexGrow: 2}} />
                                </div>
                                <div className="sizekey">
                                    <span className="sizekey-item">
                                        <span className="swatch seg-app" />
                                        installer {INSTALLER_SIZE}
                                    </span>
                                    <span className="sizekey-item">
                                        <span className="swatch seg-ffmpeg" />
                                        ffmpeg 98 MB
                                    </span>
                                    <span className="sizekey-item">
                                        <span className="swatch seg-ytdlp" />
                                        yt-dlp 17 MB
                                    </span>
                                    <span className="sizekey-item">
                                        <span className="swatch seg-quickjs" />
                                        QuickJS 2 MB
                                    </span>
                                </div>
                                <p className="card-text">
                                    That split is what keeps updates quick: a new version is {INSTALLER_SIZE}, not a hundred. The old Electron build was ~215&nbsp;MB installed. It also means yt-dlp
                                    can be updated on its own from inside the app — which is how a site that suddenly stops working starts working again, without waiting for a new release.
                                </p>
                            </div>

                            <div className="card">
                                <h3 className="card-title">Updates and signing</h3>
                                <p className="card-text">
                                    yt2mp checks for a new version when it starts and tells you if one exists. It never installs anything without asking, and it will not interrupt a download that is
                                    already running. Every update is cryptographically signed — the app refuses anything that does not carry a valid signature.
                                </p>
                                <p className="card-text">
                                    The installer itself is unsigned, so Windows SmartScreen warns the first time you run it. That is a missing code-signing certificate, not a detected threat.
                                    {INSTALLER_SHA256 ? (
                                        <>
                                            {" "}
                                            To check the file you downloaded, run <code className="inline-code">Get-FileHash {INSTALLER_NAME}</code> and compare it with the hash below.
                                        </>
                                    ) : null}
                                </p>
                                {INSTALLER_SHA256 ? (
                                    <div className="hash">
                                        <span className="hash-label">sha256</span>
                                        <code className="hash-value">{INSTALLER_SHA256}</code>
                                    </div>
                                ) : null}
                                <table className="spec">
                                    <tbody>
                                        <tr>
                                            <th scope="row">Platform</th>
                                            <td>Windows 10/11 (x64) · Linux x64</td>
                                        </tr>
                                        <tr>
                                            <th scope="row">Built with</th>
                                            <td>Rust and Tauri</td>
                                        </tr>
                                        <tr>
                                            <th scope="row">Dependencies</th>
                                            <td>none — fetched on first run</td>
                                        </tr>
                                        <tr>
                                            <th scope="row">Network</th>
                                            <td>only the site you download from</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div className="card card-wide">
                                <h3 className="card-title">Running it on Linux</h3>
                                <p className="card-text">
                                    The Linux build is a portable AppImage — nothing to install. Download it, mark it executable, run it. It fetches yt-dlp and ffmpeg on first launch, same as on Windows.
                                </p>
                                <div className="cmd-list">
                                    <CopyCommand command={`chmod +x ${APPIMAGE_NAME}`} />
                                    <CopyCommand command={`./${APPIMAGE_NAME}`} />
                                </div>
                                <p className="card-text">
                                    If it won&apos;t start, your distro may be missing FUSE — install it (<code className="inline-code">sudo apt install libfuse2</code>) or run with{" "}
                                    <code className="inline-code">--appimage-extract-and-run</code>. Built and tested on x64.
                                </p>
                            </div>

                            <div className="card card-wide">
                                <h3 className="card-title">Before you download</h3>
                                <p className="card-text">
                                    Free software, provided as-is, no warranty. You are responsible for what you download with it — keep it to content you have the right to save: your own uploads,
                                    public domain, Creative Commons, or anything else you are permitted to keep. Downloading from YouTube may go against{" "}
                                    <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
                                        its Terms of Service
                                    </a>
                                    . This project is not built for copyright infringement, and the authors are not liable for how it is used.
                                </p>
                            </div>
                        </div>
                    </section>
                </main>

                <footer className="wrap">
                    <div className="site-footer">
                        <span>yt2mp v{VERSION}</span>
                        <span className="dot">·</span>
                        <a href={LICENSE_URL} target="_blank" rel="noreferrer">
                            GPL-3.0-or-later
                        </a>
                        <span className="dot">·</span>
                        <a href={REPO_URL} target="_blank" rel="noreferrer">
                            source
                        </a>
                    </div>
                </footer>
            </div>
        </div>
    );
}
