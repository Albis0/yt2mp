import Image from "next/image";
import CopyCommand from "@/components/CopyCommand";
import {GITHUB_URL, DRIVE_URL, LINUX_URL, REPO_URL, LICENSE_URL, ISSUES_URL, METADEFENDER_URL, SITE_URL, VERSION, INSTALLER_NAME, INSTALLER_SHA256} from "@/lib/site";

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
            fileSize: "215 MB",
            inLanguage: "en",
            description: "Free, open-source Windows desktop app that downloads YouTube videos as MP3 or MP4. Runs locally — no server, no account, no ads.",
            url: SITE_URL,
            downloadUrl: GITHUB_URL,
            installUrl: GITHUB_URL,
            releaseNotes: `${REPO_URL}/releases/latest`,
            image: `${SITE_URL}/og.png`,
            license: LICENSE_URL,
            isAccessibleForFree: true,
            offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
            },
            author: {
                "@type": "Person",
                name: "Albis0",
                url: REPO_URL,
            },
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
                        text: "Downloads run entirely on your own machine and talk only to youtube.com — there is no server component. The optional AI search feature is the one exception: it sends your search text to Groq's API to turn it into a search query.",
                    },
                },
                {
                    "@type": "Question",
                    name: "What formats can yt2mp download?",
                    acceptedAnswer: {
                        "@type": "Answer",
                        text: "MP3 (best available audio re-encoded at 192 kbps) and MP4 (best available video at any resolution offered). It also supports playlists.",
                    },
                },
                {
                    "@type": "Question",
                    name: "Which operating systems does yt2mp support?",
                    acceptedAnswer: {
                        "@type": "Answer",
                        text: "yt2mp runs on Windows 10 and Windows 11 (x64) as an installer, and on Linux x64 as a portable AppImage. yt-dlp and ffmpeg ship inside the download, so there are no separate dependencies to install.",
                    },
                },
            ],
        },
    ],
};

function DriveIcon() {
    return (
        <svg viewBox="0 0 87.3 78" width="16" height="16" aria-hidden="true">
            <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
            <path fill="#00ac47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" />
            <path fill="#ea4335" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
            <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
            <path fill="#2684fc" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
            <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
        </svg>
    );
}

// Tux, the Linux mascot, in his standard colours (black body, white belly,
// yellow beak and feet). Simplified vector path that stays crisp at icon size.
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

export default function Home() {
    return (
        <div className="page">
            <script type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify(jsonLd)}} />
            <div className="mobile-block">
                <div className="mobile-block-inner">
                    <Image src="/icon.png" alt="" width={40} height={40} />
                    <p className="mobile-block-title">yt2mp is a Windows app</p>
                    <p className="mobile-block-text">
                        It installs and runs on a Windows 10/11 desktop — there&apos;s nothing to open here on a phone. Pull this page up on your computer when you&apos;re ready to install it, or jump
                        to the source below.
                    </p>
                    <a className="mobile-block-link" href={REPO_URL}>
                        View the repository on GitHub →
                    </a>
                </div>
            </div>

            <div className="desktop-only">
                <header className="topbar">
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
                </header>

                <main className="main">
                    {/* Hero: two zones side by side, not stacked — left is the
                        pitch + action, right is a real reference table, so the
                        full viewport width carries content instead of margin. */}
                    <section className="hero">
                        <div className="hero-pitch">
                            <h1 className="hero-title">
                                Download YouTube
                                <br />
                                as MP3 or MP4.
                            </h1>
                            <p className="hero-dek">Paste a link, pick a format, the file lands in your Downloads folder. Runs on your own machine — no account, no upload, no ads.</p>

                            <div className="get">
                                <a className="get-btn" href={GITHUB_URL}>
                                    Download for Windows
                                </a>
                                <div className="get-meta">
                                    <span className="get-name">{INSTALLER_NAME}</span>
                                    <span className="get-sep">·</span>
                                    <span>~215 MB</span>
                                    <span className="get-sep">·</span>
                                    <span>Windows 10/11</span>
                                </div>
                                <div className="get-alt">
                                    <a className="icon-link" href={LINUX_URL} title="Linux AppImage" aria-label="Download the Linux AppImage">
                                        <LinuxIcon />
                                        <span>Linux AppImage</span>
                                    </a>
                                    <a className="icon-link" href={DRIVE_URL} title="Google Drive mirror" aria-label="Google Drive mirror">
                                        <DriveIcon />
                                        <span>Drive mirror</span>
                                    </a>
                                    <a className="icon-link" href={REPO_URL} target="_blank" rel="noreferrer" title="GitHub releases" aria-label="GitHub releases">
                                        <GitHubIcon />
                                        <span>GitHub releases</span>
                                    </a>
                                </div>
                                <div className="get-linux-hint">
                                    <span className="get-linux-label">After the AppImage downloads:</span>
                                    <CopyCommand command={`chmod +x yt2mp-${VERSION}.AppImage`} />
                                    <CopyCommand command={`./yt2mp-${VERSION}.AppImage`} />
                                </div>
                            </div>
                        </div>

                        <div className="hero-panel">
                            <h2 className="panel-title">What you get</h2>
                            <table className="info-table">
                                <tbody>
                                    <tr>
                                        <th scope="row">MP3</th>
                                        <td>best available audio, re-encoded at 192 kbps</td>
                                    </tr>
                                    <tr>
                                        <th scope="row">MP4</th>
                                        <td>best available video, any resolution offered</td>
                                    </tr>
                                    <tr>
                                        <th scope="row">Preview</th>
                                        <td>title, duration and uploader before you download</td>
                                    </tr>
                                    <tr>
                                        <th scope="row">AI search</th>
                                        <td>describe what you want instead of finding a link</td>
                                    </tr>
                                    <tr>
                                        <th scope="row">Playlists</th>
                                        <td>paste a playlist link, pick which tracks to grab</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* Reference grid: every other section sits two-up so the
                        page reads left-to-right in pairs instead of one long
                        single-column scroll. */}
                    <div className="grid">
                        <section className="cell">
                            <h2 className="cell-title">Why it runs locally</h2>
                            <p className="cell-text">
                                This used to be a web app on a free Render instance. Two things broke under real use: YouTube blocks downloads from shared cloud IP ranges (&quot;Sign in to confirm
                                you&apos;re not a bot&quot;), and a free 512&nbsp;MB instance gets OOM-killed the moment more than one person downloads at once.
                            </p>
                            <p className="cell-text cell-text-tight">
                                Both problems belong to the server, not the idea — so the server is gone. Downloads now run from your own IP, with no shared memory budget for anyone to exceed.
                            </p>
                        </section>

                        <section className="cell">
                            <h2 className="cell-title">How AI search works</h2>
                            <p className="cell-text">
                                Switch to AI search and type a request instead of a link — &quot;that troye sivan song called rush&quot; works the same as pasting the URL. A small model (Groq&apos;s
                                Llama&nbsp;3.1&nbsp;8B) turns your phrasing into a clean search query, then yt-dlp searches YouTube for it directly — no link required, nothing leaves YouTube&apos;s
                                own search.
                            </p>
                            <p className="cell-text cell-text-tight">
                                This runs on a handful of free-tier API keys that rotate if one is rate-limited; if every key fails, your original text is searched as-is instead of breaking the
                                feature. Worth knowing: unlike everything else in this app, the AI step does send your search text to Groq&apos;s API.
                            </p>
                        </section>

                        <section className="cell cell-wide">
                            <h2 className="cell-title">Running on Linux</h2>
                            <p className="cell-text">
                                The Linux build is a portable AppImage — there&apos;s nothing to install. Download it, mark it executable, and run it. yt-dlp and ffmpeg are bundled inside, same as
                                on Windows.
                            </p>
                            <div className="cmd-list">
                                <CopyCommand command={`chmod +x yt2mp-${VERSION}.AppImage`} />
                                <CopyCommand command={`./yt2mp-${VERSION}.AppImage`} />
                            </div>
                            <p className="cell-text cell-text-tight">
                                If it won&apos;t start, your distro may be missing FUSE — either install it (<code className="inline-code">sudo apt install libfuse2</code>) or run with{" "}
                                <code className="inline-code">--appimage-extract-and-run</code>. Built and tested on x64.
                            </p>
                        </section>

                        <section className="cell">
                            <h2 className="cell-title">Why the installer is ~215 MB</h2>
                            <p className="cell-text">Most of it isn&apos;t this app&apos;s code — it&apos;s the runtime and tools it ships with:</p>
                            <table className="info-table info-table-tight">
                                <tbody>
                                    <tr>
                                        <th scope="row">Chromium (the browser engine)</th>
                                        <td>~75 MB</td>
                                    </tr>
                                    <tr>
                                        <th scope="row">Electron + Node + app code</th>
                                        <td>~45 MB</td>
                                    </tr>
                                    <tr>
                                        <th scope="row">ffmpeg.exe</th>
                                        <td>~77 MB</td>
                                    </tr>
                                    <tr>
                                        <th scope="row">yt-dlp.exe</th>
                                        <td>~18 MB</td>
                                    </tr>
                                </tbody>
                            </table>
                        </section>

                        <section className="cell">
                            <h2 className="cell-title">What&apos;s next</h2>
                            <p className="cell-text">Things on the list, not promised on a timeline:</p>
                            <table className="info-table info-table-tight">
                                <tbody>
                                    <tr>
                                        <th scope="row">Code signing</th>
                                        <td>remove the SmartScreen warning on first run</td>
                                    </tr>
                                    <tr>
                                        <th scope="row">Batch downloads</th>
                                        <td>queue multiple links at once outside of a playlist</td>
                                    </tr>
                                </tbody>
                            </table>
                        </section>

                        <section className="cell cell-wide">
                            <h2 className="cell-title">Specifications</h2>
                            <table className="info-table info-table-tight">
                                <tbody>
                                    <tr>
                                        <th scope="row">Platform</th>
                                        <td>Windows 10 / 11 (x64) installer · Linux x64 AppImage</td>
                                    </tr>
                                    <tr>
                                        <th scope="row">License</th>
                                        <td>
                                            <a href={LICENSE_URL} target="_blank" rel="noreferrer">
                                                GPL-3.0-or-later
                                            </a>
                                        </td>
                                    </tr>
                                    <tr>
                                        <th scope="row">Dependencies</th>
                                        <td>none — yt-dlp/ffmpeg ship inside the installer</td>
                                    </tr>
                                    <tr>
                                        <th scope="row">Network</th>
                                        <td>talks only to youtube.com</td>
                                    </tr>
                                    <tr>
                                        <th scope="row">Server component</th>
                                        <td>none — your download never touches our server</td>
                                    </tr>
                                </tbody>
                            </table>
                        </section>

                        <section className="cell cell-wide">
                            <h2 className="cell-title">Verify what you downloaded</h2>
                            <p className="cell-text">
                                The installer is unsigned, so Windows SmartScreen will warn on first run — that&apos;s the missing code-signing certificate, not a detected threat.{" "}
                                <a href={METADEFENDER_URL} target="_blank" rel="noreferrer">
                                    See the MetaDefender scan
                                </a>{" "}
                                for this build, or check the hash below against what you downloaded.
                            </p>
                            <div className="hash-row">
                                <span className="hash-label">sha256</span>
                                <code className="hash-value">{INSTALLER_SHA256}</code>
                            </div>
                        </section>

                        <section className="cell cell-wide cell-split">
                            <h2 className="cell-title">Before you download</h2>
                            <div className="split-cols">
                                <p className="cell-text">
                                    Free software, provided as-is, no warranty. You&apos;re responsible for what you download with it — keep it to content you have the right to save: your own uploads,
                                    public domain, Creative Commons, or anything else you&apos;re permitted to keep.
                                </p>
                                <p className="cell-text">
                                    Downloading from YouTube may go against{" "}
                                    <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
                                        its Terms of Service
                                    </a>
                                    . This project isn&apos;t built for copyright infringement, and the authors aren&apos;t liable for how it&apos;s used.
                                </p>
                            </div>
                        </section>
                    </div>
                </main>

                <footer className="site-footer">
                    <span>yt2mp v{VERSION}</span>
                    <span className="footer-dot">·</span>
                    <a href={LICENSE_URL} target="_blank" rel="noreferrer">
                        GPL-3.0-or-later
                    </a>
                    <span className="footer-dot">·</span>
                    <a href={REPO_URL} target="_blank" rel="noreferrer">
                        source
                    </a>
                </footer>
            </div>
        </div>
    );
}
